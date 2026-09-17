const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PROFILES_DIR = path.join(ROOT, "data", "profiles");

/**
 * Scan running processes on Windows/POSIX and identify launcher-associated Firefox or Python workers.
 * @returns {Array<{pid: number, name: string, cmd: string}>}
 */
function findLauncherProcesses() {
  if (process.platform === "win32") {
    try {
      const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'firefox.exe' or Name = 'python.exe'\\" | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress"`;
      const out = execSync(psCmd, { encoding: "utf8", timeout: 8000 }).trim();
      if (!out) return [];

      let raw;
      try {
        raw = JSON.parse(out);
      } catch {
        return [];
      }
      const list = Array.isArray(raw) ? raw : [raw];
      const results = [];

      const normalizedRoot = ROOT.toLowerCase().replace(/\\/g, "/");

      for (const p of list) {
        if (!p || !p.ProcessId) continue;
        const cmd = (p.CommandLine || "").toLowerCase().replace(/\\/g, "/");
        const name = (p.Name || "").toLowerCase();

        // Check if Firefox process was spawned with juggler-pipe, our cache directory, or our data/profiles
        const isOurFirefox =
          name.includes("firefox") &&
          (cmd.includes("-juggler-pipe") ||
            cmd.includes("invisible-playwright") ||
            cmd.includes(normalizedRoot + "/data/profiles"));

        // Check if Python worker is running browser_worker.py in this repo
        const isOurWorker =
          name.includes("python") &&
          cmd.includes("browser_worker.py") &&
          cmd.includes(normalizedRoot);

        if (isOurFirefox || isOurWorker) {
          results.push({
            pid: p.ProcessId,
            name: p.Name,
            cmd: p.CommandLine || "",
          });
        }
      }
      return results;
    } catch (err) {
      return [];
    }
  } else {
    // POSIX fallback
    try {
      const out = execSync("pgrep -a -f 'firefox|browser_worker.py'", { encoding: "utf8", timeout: 5000 }).trim();
      if (!out) return [];
      const lines = out.split("\n");
      const results = [];
      for (const line of lines) {
        const [pidStr, ...rest] = line.trim().split(" ");
        const pid = parseInt(pidStr, 10);
        if (pid) {
          results.push({ pid, name: rest[0] || "process", cmd: rest.join(" ") });
        }
      }
      return results;
    } catch {
      return [];
    }
  }
}

/**
 * Terminate a list of process IDs safely.
 */
function killPids(pids = []) {
  if (!pids.length) return 0;
  let killed = 0;
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid} >nul 2>&1`, { timeout: 3000 });
      } else {
        process.kill(pid, "SIGKILL");
      }
      killed++;
    } catch {
      // Process already terminated or inaccessible
    }
  }
  return killed;
}

/**
 * Terminate any launcher Firefox or Python processes that are NOT in the activePids whitelist.
 * @param {Set<number>} activePids
 * @returns {{found: number, reaped: number, pids: number[]}}
 */
function cleanOrphanProcesses(activePids = new Set()) {
  const procs = findLauncherProcesses();
  const toKill = procs.filter((p) => !activePids.has(p.pid)).map((p) => p.pid);
  const reaped = killPids(toKill);

  return {
    found: procs.length,
    reaped,
    pids: toKill,
  };
}

const STALE_LOCK_FILES = [
  "parent.lock",
  ".startup-incomplete",
  "MarionetteActivePort",
  "sessionstore.jsonlz4",
  "sessionstore-backups",
];

/**
 * Clean lingering locks and crash artifacts in one profile or all profile directories.
 * @param {string|null} targetProfileDir
 * @returns {{cleanedDirectories: number, filesRemoved: string[]}}
 */
function cleanStaleLocks(targetProfileDir = null) {
  const dirs = [];
  if (targetProfileDir && fs.existsSync(targetProfileDir)) {
    dirs.push(targetProfileDir);
  } else if (fs.existsSync(PROFILES_DIR)) {
    const entries = fs.readdirSync(PROFILES_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        dirs.push(path.join(PROFILES_DIR, ent.name));
      }
    }
  }

  const filesRemoved = [];
  let cleanedDirectories = 0;

  for (const dir of dirs) {
    let dirCleaned = false;
    for (const fileName of STALE_LOCK_FILES) {
      const fullPath = path.join(dir, fileName);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
        filesRemoved.push(fullPath);
        dirCleaned = true;
      } catch {
        // May be locked by an active process
      }
    }
    if (dirCleaned) cleanedDirectories++;
  }

  return {
    cleanedDirectories,
    filesRemoved,
  };
}

/**
 * Full startup sanitation routine:
 * 1. Kills orphaned invisible-playwright / worker processes left over from prior runs
 * 2. Clears dangling lock files across all profile directories
 */
function startupSanitize() {
  const processResult = cleanOrphanProcesses(new Set());
  const lockResult = cleanStaleLocks();

  return {
    processesReaped: processResult.reaped,
    reapedPids: processResult.pids,
    profilesCleaned: lockResult.cleanedDirectories,
    locksRemoved: lockResult.filesRemoved.length,
  };
}

module.exports = {
  findLauncherProcesses,
  cleanOrphanProcesses,
  cleanStaleLocks,
  startupSanitize,
};
