const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const EventEmitter = require("events");
const { getExtensionsForSession } = require("./extension_manager");

// Point to root directory (two levels up from backend/src)
const ROOT = path.resolve(__dirname, "..", "..");
const WORKER_SCRIPT = path.join(__dirname, "browser_worker.py");

/**
 * Auto-heal pyvenv.cfg if the base Python installation moved or came from another machine
 */
function healPyvenvConfig() {
  const pyvenvCfgPath = path.join(ROOT, ".venv", "pyvenv.cfg");
  if (!fs.existsSync(pyvenvCfgPath)) return;

  try {
    const content = fs.readFileSync(pyvenvCfgPath, "utf8");
    const homeMatch = content.match(/^home\s*=\s*(.*)$/m);
    const execMatch = content.match(/^executable\s*=\s*(.*)$/m);

    const homePath = homeMatch ? homeMatch[1].trim().replace(/^['"]|['"]$/g, "") : "";
    const execPath = execMatch ? execMatch[1].trim().replace(/^['"]|['"]$/g, "") : "";

    const homeExists = homePath && fs.existsSync(homePath);
    const execExists = execPath && fs.existsSync(execPath);

    if (homeExists && execExists) {
      return; // Config is valid
    }

    const localApp = process.env.LOCALAPPDATA || "";
    const validBases = [
      "C:\\Program Files\\Python311",
      path.join(localApp, "Programs", "Python", "Python311"),
      "C:\\Program Files (x86)\\Python311",
    ];

    let foundBase = validBases.find((b) => fs.existsSync(path.join(b, "python.exe")));

    if (!foundBase) {
      try {
        const { execSync } = require("child_process");
        const out = execSync("py.exe -3.11 -c \"import sys; print(sys.base_prefix)\"", {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 3000,
        }).trim();
        if (out && fs.existsSync(path.join(out, "python.exe"))) {
          foundBase = out;
        }
      } catch {}
    }

    if (foundBase) {
      const fixedPython = path.join(foundBase, "python.exe");
      const updatedCfg = [
        `home = ${foundBase}`,
        "include-system-site-packages = false",
        "version = 3.11.9",
        `executable = ${fixedPython}`,
        `command = ${fixedPython} -m venv ${path.join(ROOT, ".venv")}`,
        "",
      ].join("\n");
      fs.writeFileSync(pyvenvCfgPath, updatedCfg, "utf8");
      console.log(`[worker_runner] Auto-healed .venv/pyvenv.cfg -> ${foundBase}`);
    }
  } catch (err) {
    console.warn(`[worker_runner] Failed to auto-heal pyvenv.cfg: ${err.message}`);
  }
}

/**
 * Locate the virtualenv Python executable
 */
function findPythonExe() {
  healPyvenvConfig();

  const localApp = process.env.LOCALAPPDATA || "";
  const candidates = [
    path.join(ROOT, "runtime", "python", "python.exe"),
    path.join(ROOT, ".venv", "Scripts", "python.exe"),
    path.join(ROOT, ".venv", "bin", "python"),
    path.join(__dirname, "..", ".venv", "Scripts", "python.exe"),
    "C:\\Program Files\\Python311\\python.exe",
    path.join(localApp, "Programs", "Python", "Python311", "python.exe"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Fallback to py launcher explicitly requesting 3.11
  return "py.exe";
}


/**
 * Deterministic 31-bit seed generator for session id
 */
function deriveSeed(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 2147483647 || 42;
}

/**
 * Convert existing fingerprint object / file attributes into zendriver pin dict
 */
function buildPinConfig(record) {
  const fp = record.fingerprint;
  if (!fp) return null;

  const pin = {};
  if (fp.viewport?.width) pin["screen.width"] = Number(fp.viewport.width);
  if (fp.viewport?.height) pin["screen.height"] = Number(fp.viewport.height);
  if (fp.hardwareConcurrency) pin["hardware.concurrency"] = Number(fp.hardwareConcurrency);
  if (fp.webgl?.vendor) pin["gpu.vendor"] = fp.webgl.vendor;
  if (fp.webgl?.renderer) pin["gpu.renderer"] = fp.webgl.renderer;

  return Object.keys(pin).length ? pin : null;
}

/**
 * Launch a zendriver browser session
 */
function launchWorker(record, opts = {}) {
  return new Promise((resolve, reject) => {
    const pythonExe = findPythonExe();
    const seed = record.seed || deriveSeed(record.id);
    const pin = buildPinConfig(record);

    const args = [
      WORKER_SCRIPT,
      "--id",
      record.id,
      "--profile-dir",
      record.userDataDir,
      "--seed",
      String(seed),
    ];

    // Multi-tab start URLs support
    const startUrls = [];
    if (Array.isArray(opts.startUrls) && opts.startUrls.length) {
      for (const u of opts.startUrls) {
        if (!u) continue;
        let clean = u.trim();
        if (!/^https?:\/\//i.test(clean) && !/^about:/i.test(clean)) clean = "https://" + clean;
        startUrls.push(clean);
      }
    } else if (opts.url) {
      let clean = opts.url.trim();
      if (!/^https?:\/\//i.test(clean) && !/^about:/i.test(clean)) clean = "https://" + clean;
      startUrls.push(clean);
    } else if (record.tabs && record.tabs.length) {
      startUrls.push(...record.tabs);
    }

    if (startUrls.length > 0) {
      args.push("--url", startUrls[0]);
      if (startUrls.length > 1) {
        args.push("--start-urls", JSON.stringify(startUrls));
      }
    }

    const isHeadless =
      opts.headless === true ||
      opts.headless === "true" ||
      opts.cloaked === true ||
      opts.cloaked === "true";
    if (isHeadless) {
      args.push("--headless");
    }

    if (opts.webrtcPolicy) {
      args.push("--webrtc-policy", opts.webrtcPolicy);
    }

    if (opts.ephemeral) {
      args.push("--ephemeral");
    }

    if (opts.extraPrefs && typeof opts.extraPrefs === "object") {
      args.push("--extra-prefs", JSON.stringify(opts.extraPrefs));
    }

    if (record.proxy?.host) {
      args.push(
        "--proxy",
        JSON.stringify({
          scheme: record.proxy.scheme || "http",
          host: record.proxy.host,
          port: Number(record.proxy.port),
          username: record.proxy.username || "",
          password: record.proxy.password || "",
        })
      );
    }

    if (pin) {
      args.push("--pin", JSON.stringify(pin));
    }

    // Exact fingerprint specification without randomization
    if (record.fingerprint) {
      args.push("--fingerprint-spec", JSON.stringify(record.fingerprint));
    }

    if (record.fingerprintFile) {
      args.push("--fingerprint-file", record.fingerprintFile);
    }

    if (record.fingerprint?.timezone) {
      args.push("--timezone", record.fingerprint.timezone);
    }

    if (record.fingerprint?.locale) {
      args.push("--locale", record.fingerprint.locale);
    }

    const cookiesFile = path.join(ROOT, "data", "cookies", `${record.id}.json`);
    args.push("--cookies-file", cookiesFile);

    try {
      const enabledExtensions = getExtensionsForSession(record.id);
      if (enabledExtensions && enabledExtensions.length > 0) {
        args.push("--extensions", JSON.stringify(enabledExtensions));
      }
    } catch (e) {
      console.warn(`[worker:${record.id}] Failed to get enabled extensions:`, e.message);
    }

    const spawnArgs = pythonExe.toLowerCase().endsWith("py.exe") ? ["-3.11", ...args] : args;

    const proc = spawn(pythonExe, spawnArgs, {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: false,
    });

    const handle = new EventEmitter();
    handle.id = record.id;
    handle.process = proc;
    handle.tabs = record.tabs || [];
    handle.cookieCount = record.cookieCount || 0;
    handle.seed = seed;
    handle.browser = handle; // Backwards-compatible proxy for orchestrator

    let settled = false;
    let stdoutBuffer = "";

    function sendCmd(cmd) {
      if (proc.stdin.writable) {
        try {
          proc.stdin.write(JSON.stringify(cmd) + "\n");
        } catch {}
      }
    }

    handle.close = async () => {
      handle.closedByUser = true;
      sendCmd({ cmd: "close" });

      return new Promise((res) => {
        const timeout = setTimeout(() => {
          try {
            proc.kill();
          } catch {}
          res();
        }, 3000);
        timeout.unref?.();

        proc.once("exit", () => {
          clearTimeout(timeout);
          res();
        });
      });
    };

    handle.newPage = async (url) => {
      sendCmd({ cmd: "new_page", url });
    };

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          const ev = msg.event;

          if (ev === "ready") {
            if (msg.tabs) handle.tabs = msg.tabs;
            if (msg.cookieCount !== undefined) handle.cookieCount = msg.cookieCount;
            if (msg.seed !== undefined) handle.seed = msg.seed;

            if (!settled) {
              settled = true;
              resolve(handle);
            }
            handle.emit("ready", msg);
          } else if (ev === "tabs") {
            if (msg.tabs) handle.tabs = msg.tabs;
            handle.emit("tabs", msg.tabs);
          } else if (ev === "cookies") {
            if (msg.count !== undefined) handle.cookieCount = msg.count;
            handle.emit("cookies", msg.count);
          } else if (ev === "extension_loaded") {
            handle.emit("extension_loaded", msg);
          } else if (ev === "disconnected" || ev === "closed") {
            handle.emit("disconnected", msg.reason || "browser closed");
          } else if (ev === "error") {
            handle.emit("error", new Error(msg.error || "Worker error"));
          }
        } catch {
          // Non-JSON worker message (debug log)
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      const txt = chunk.toString("utf8").trim();
      if (txt) {
        console.warn(`[worker:${record.id}] ${txt}`);
      }
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
      handle.emit("error", err);
    });

    proc.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Worker process exited prematurely with code ${code}`));
      }
      handle.emit("disconnected", code === 0 ? "browser closed" : `exit code ${code}`);
    });

    // Timeout safety: 120s to initialize (accounts for cold-start, proxy handshake, and extension installation)
    const safetyTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill();
        } catch {}
        reject(new Error("Timeout waiting for zendriver worker to be ready"));
      }
    }, 120000);
    safetyTimer.unref?.();
  });
}

module.exports = {
  findPythonExe,
  deriveSeed,
  launchWorker,
};
