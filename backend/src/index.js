#!/usr/bin/env node
const fs = require("fs");
const {
  createSessionRecord,
  getSession,
  parseProxy,
  generateFingerprint,
  PROXY_FILE,
  STORE_PATH,
} = require("./manager");

async function selfcheck() {
  const line = fs
    .readFileSync(PROXY_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim());
  const p = parseProxy(line);
  if (!p.host || !p.port) throw new Error("proxy parse failed");

  const a = await generateFingerprint(p);
  if (!a.userAgent || !a.viewport.width || !a.webgl.vendor || !a.timezone || !a.file) {
    throw new Error("fingerprint incomplete");
  }

  const rec = await createSessionRecord("demo@outlook.com", { email: "demo@outlook.com" });
  const again = getSession("demo@outlook.com");
  if (again.id !== "demo@outlook.com") throw new Error("email not used as session id");
  if (!again.userDataDir.endsWith("demo@outlook.com")) throw new Error("email not used as profile folder");
  if (again.proxy.host !== rec.proxy.host) throw new Error("proxy not sticky");
  if (again.fingerprint.userAgent !== rec.fingerprint.userAgent) throw new Error("fingerprint not sticky");
  if (!again.fingerprintFile || again.fingerprintFile !== rec.fingerprintFile) {
    throw new Error("fingerprint file not sticky");
  }

  const { parseCsvAccounts } = require("./manager");
  const { writeSessionSheet, CSV_PATH, HTML_PATH } = require("./sheet");
  const accounts = parseCsvAccounts();
  if (!accounts.length || !String(accounts[0]).includes("@")) throw new Error("account file parse failed");
  writeSessionSheet([rec]);
  if (!fs.existsSync(CSV_PATH) || !fs.existsSync(HTML_PATH)) throw new Error("session sheet not written");

  const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  delete store.sessions["demo@outlook.com"];
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  fs.rmSync(rec.userDataDir, { recursive: true, force: true });
  // Verify invisible_playwright worker environment with Python 3.11.9
  const { findPythonExe } = require("./worker_runner");
  const { execSync } = require("child_process");
  const pyExe = findPythonExe();
  if (!fs.existsSync(pyExe)) throw new Error("Python virtual environment executable not found: " + pyExe);

  const pyVer = execSync(`"${pyExe}" --version`, { encoding: "utf8" }).trim();
  if (!pyVer.includes("3.11")) {
    throw new Error(`Expected Python 3.11.x runtime, but found: ${pyVer}`);
  }

  // Verify invisible_playwright module import
  execSync(`"${pyExe}" -c "from invisible_playwright import InvisiblePlaywright"`, { encoding: "utf8" });

  console.log(`selfcheck ok — ${pyVer} + invisible_playwright stealth engine verified`);
}

async function main() {
  if (process.argv[2] === "selfcheck") return selfcheck();
  const { run } = require("./cli");
  await run();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
