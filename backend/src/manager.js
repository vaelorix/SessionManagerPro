const fs = require("fs");
const path = require("path");
const { generateFingerprint, applyFingerprint, buildFingerprint } = require("./fingerprint");
const { launchWorker, deriveSeed } = require("./worker_runner");

// Point ROOT to the workspace root (two levels up from backend/src)
const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "sessions.json");
const PROFILES_DIR = path.join(DATA_DIR, "profiles");
const PROXY_DIR = path.join(ROOT, "resources", "proxies");
const PROXY_FILE = fs.existsSync(path.join(PROXY_DIR, "proxies.txt"))
  ? path.join(PROXY_DIR, "proxies.txt")
  : path.join(PROXY_DIR, "proxiesgood.txt");
const ACCOUNT_FILE = path.join(ROOT, "resources", "AccountFile.csv");
const COOKIES_DIR = path.join(DATA_DIR, "cookies");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const MAX_BACKUPS_PER_SESSION = 5;

const { cleanStaleLocks } = require("./reaper");

// ponytail: global lock, per-account locks if create-throughput matters
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

function safeId(id) {
  const cleaned = String(id).trim().replace(/[<>:"/\\|?*]/g, "_").slice(0, 120);
  if (!cleaned) throw new Error("session id is empty");
  return cleaned;
}

function cookiePath(id) {
  return path.join(COOKIES_DIR, `${safeId(id)}.json`);
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsvAccounts() {
  if (!fs.existsSync(ACCOUNT_FILE)) return [];
  const lines = fs
    .readFileSync(ACCOUNT_FILE, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const headers = splitCsvLine(lines[0]);
  const iEmail = headers.indexOf("Email");
  if (iEmail < 0) throw new Error("AccountFile.csv is missing an Email column");
  const names = [];
  for (const line of lines.slice(1)) {
    const name = (splitCsvLine(line)[iEmail] || "").trim();
    if (name) names.push(name);
  }
  return names;
}

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { sessions: {} };
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
  try {
    require("./sheet").writeSessionSheet(Object.values(store.sessions || {}));
  } catch {
    // sheet is a view; do not fail the save
  }
}

function parseProxy(line) {
  const u = new URL(String(line).trim());
  const proxy = {
    host: u.hostname,
    port: Number(u.port),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
  // "host:port" with no scheme does NOT throw — URL reads it as protocol + path and
  // hands back an empty host. That object is truthy, so it would be stored as a real
  // proxy and then dropped at launch, opening the browser on the operator's own IP.
  if (!proxy.host || !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
    throw new Error(`invalid proxy "${line}" — expected scheme://user:pass@host:port`);
  }
  return proxy;
}

function loadProxies() {
  const files = fs.existsSync(PROXY_DIR)
    ? fs.readdirSync(PROXY_DIR).filter((f) => f.endsWith(".txt"))
    : [];
  const lines = [];
  for (const file of files.length ? files : ["proxiesgood.txt"]) {
    const full = path.join(PROXY_DIR, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) lines.push(trimmed);
    }
  }
  // One malformed line must not take down the whole resources endpoint, which the
  // panel would otherwise render as an authoritative "no proxies configured".
  const proxies = [];
  for (const line of new Set(lines)) {
    try {
      proxies.push(parseProxy(line));
    } catch (err) {
      console.warn(`[proxies] skipping unusable line: ${err.message}`);
    }
  }
  return proxies;
}

function proxyKey(p) {
  return `${p.host}:${p.port}`;
}

function pickUnusedProxy(store) {
  const used = new Set(
    Object.values(store.sessions).map((s) => s.proxy && proxyKey(s.proxy)).filter(Boolean),
  );
  const free = loadProxies().filter((p) => !used.has(proxyKey(p)));
  if (!free.length) throw new Error("no unused proxies left in resources/proxies");
  return free[Math.floor(Math.random() * free.length)];
}

function pickUnusedFpt(store) {
  const { listFptFiles } = require("./fingerprint");
  const used = new Set(
    Object.values(store.sessions).map((s) => s.fingerprintFile).filter(Boolean),
  );
  const free = listFptFiles().filter((f) => !used.has(f));
  if (!free.length) throw new Error("no unused fingerprints left in resources/fpts");
  return free[Math.floor(Math.random() * free.length)];
}

function createSessionRecord(id, extras = {}) {
  return withLock(async () => {
    const sid = safeId(id);
    const store = readStore();
    if (store.sessions[sid]) return store.sessions[sid];
    const proxy = extras.proxy || pickUnusedProxy(store);
    const fingerprintFile = extras.fingerprintFile || pickUnusedFpt(store);
    const seed = extras.seed || deriveSeed(sid);
    const record = {
      id: sid,
      email: extras.email || sid,
      seed,
      proxy,
      fingerprintFile,
      fingerprint: extras.fingerprint || (await buildFingerprint(fingerprintFile, proxy)),
      userDataDir: path.join(PROFILES_DIR, sid),
      tabs: [],
      cookieCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(record.userDataDir, { recursive: true });
    store.sessions[sid] = record;
    writeStore(store);
    return record;
  });
}

async function ensureSessions(names) {
  const created = [];
  const existing = [];
  for (const name of names) {
    const already = getSession(name);
    if (already) existing.push(already);
    else created.push(await createSessionRecord(name, { email: name }));
  }
  return { created, existing };
}

function getSession(id) {
  return readStore().sessions[safeId(id)] || null;
}

function listSessions() {
  return Object.values(readStore().sessions);
}

function nextSessionIds(count, prefix = "session") {
  const existing = new Set(listSessions().map((s) => s.id));
  const ids = [];
  let n = 1;
  while (ids.length < count) {
    const id = `${prefix}-${n}`;
    if (!existing.has(id)) ids.push(id);
    n += 1;
  }
  return ids;
}

function deleteSession(id) {
  return withLock(() => {
    const sid = safeId(id);
    const store = readStore();
    const rec = store.sessions[sid];
    if (!rec) return false;
    delete store.sessions[sid];
    writeStore(store);
    fs.rmSync(rec.userDataDir, { recursive: true, force: true });
    fs.rmSync(cookiePath(sid), { force: true });
    return true;
  });
}

async function syncSheetEdits() {
  const { readSessionSheet, writeSessionSheet } = require("./sheet");
  const rows = readSessionSheet();
  if (!rows) {
    writeSessionSheet(listSessions());
    return { updated: 0, created: 0 };
  }
  let updated = 0;
  let created = 0;
  for (const row of rows) {
    const name = (row.Name || row.Email || "").trim();
    if (!name) continue;
    let rec = getSession(name);
    if (!rec) {
      let proxy;
      try {
        proxy = row.Proxy ? parseProxy(row.Proxy) : undefined;
      } catch {
        proxy = undefined;
      }
      await createSessionRecord(name, { email: name, proxy });
      created += 1;
      continue;
    }
    const patch = {};
    if (row.Proxy) {
      try {
        const p = parseProxy(row.Proxy);
        const cur = rec.proxy || {};
        if (
          p.host !== cur.host ||
          Number(p.port) !== Number(cur.port) ||
          p.username !== cur.username ||
          p.password !== cur.password
        ) {
          patch.proxy = p;
        }
      } catch {
        // keep existing proxy if the cell is invalid
      }
    }
    if (row.Notes !== undefined && row.Notes !== (rec.notes || "")) {
      patch.notes = row.Notes;
    }
    if (Object.keys(patch).length) {
      await saveSessionPatch(name, patch);
      updated += 1;
    }
  }
  writeSessionSheet(listSessions());
  return { updated, created };
}

function saveSessionPatch(id, patch) {
  return withLock(() => {
    const sid = safeId(id);
    const store = readStore();
    const rec = store.sessions[sid];
    if (!rec) throw new Error(`unknown session: ${sid}`);
    Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
    store.sessions[sid] = rec;
    writeStore(store);
    return rec;
  });
}

// Essential profile files and folders to back up
const BACKUP_ENTRIES = [
  "cookies.sqlite",
  "cookies.sqlite-wal",
  "cookies.sqlite-shm",
  "places.sqlite",
  "favicons.sqlite",
  "key4.db",
  "cert9.db",
  "logins.json",
  "logins.db",
  "user.js",
  "prefs.js",
  "storage",
  "extensions",
  "extension-preferences.json",
];

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const ent of entries) {
    const srcPath = path.join(source, ent.name);
    const dstPath = path.join(target, ent.name);
    if (ent.isDirectory()) {
      copyFolderRecursiveSync(srcPath, dstPath);
    } else {
      try {
        fs.copyFileSync(srcPath, dstPath);
      } catch {}
    }
  }
}

function getFolderSizeBytes(folderPath) {
  if (!fs.existsSync(folderPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(folderPath, ent.name);
      if (ent.isDirectory()) {
        total += getFolderSizeBytes(fullPath);
      } else {
        try {
          total += fs.statSync(fullPath).size;
        } catch {}
      }
    }
  } catch {}
  return total;
}

async function backupSessionProfile(id, label = "manual") {
  const sid = safeId(id);
  const profileDir = path.join(PROFILES_DIR, sid);
  if (!fs.existsSync(profileDir)) {
    throw new Error(`Profile directory does not exist for session ${sid}`);
  }

  const sessionBackupDir = path.join(BACKUPS_DIR, sid);
  fs.mkdirSync(sessionBackupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `backup_${timestamp}_${label}`;
  const backupPath = path.join(sessionBackupDir, backupName);
  fs.mkdirSync(backupPath, { recursive: true });

  let fileCount = 0;
  for (const entryName of BACKUP_ENTRIES) {
    const srcPath = path.join(profileDir, entryName);
    const dstPath = path.join(backupPath, entryName);
    if (!fs.existsSync(srcPath)) continue;

    try {
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        copyFolderRecursiveSync(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
      fileCount++;
    } catch {}
  }

  // Also backup cookies.json if present
  const cookiesJson = cookiePath(sid);
  if (fs.existsSync(cookiesJson)) {
    try {
      fs.copyFileSync(cookiesJson, path.join(backupPath, "cookies.json"));
      fileCount++;
    } catch {}
  }

  const sizeBytes = getFolderSizeBytes(backupPath);
  const session = getSession(sid);

  const manifest = {
    sessionId: sid,
    backupName,
    label,
    createdAt: new Date().toISOString(),
    sizeBytes,
    fileCount,
    cookieCount: session?.cookieCount || 0,
    tabs: session?.tabs || [],
  };
  fs.writeFileSync(path.join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Enforce rotation: keep newest MAX_BACKUPS_PER_SESSION
  try {
    const allBackups = listSessionBackups(sid);
    if (allBackups.length > MAX_BACKUPS_PER_SESSION) {
      const toRemove = allBackups.slice(MAX_BACKUPS_PER_SESSION);
      for (const b of toRemove) {
        const p = path.join(sessionBackupDir, b.backupName);
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
  } catch {}

  return manifest;
}

function listSessionBackups(id) {
  const sid = safeId(id);
  const sessionBackupDir = path.join(BACKUPS_DIR, sid);
  if (!fs.existsSync(sessionBackupDir)) return [];

  const entries = fs.readdirSync(sessionBackupDir, { withFileTypes: true });
  const backups = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const manifestPath = path.join(sessionBackupDir, ent.name, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        backups.push(manifest);
      } catch {
        backups.push({ backupName: ent.name, createdAt: ent.name, sizeBytes: 0, fileCount: 0 });
      }
    } else {
      backups.push({ backupName: ent.name, createdAt: ent.name, sizeBytes: 0, fileCount: 0 });
    }
  }

  backups.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return backups;
}

async function restoreSessionBackup(id, backupName) {
  const sid = safeId(id);
  const sessionBackupDir = path.join(BACKUPS_DIR, sid);
  const backupPath = path.join(sessionBackupDir, backupName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup ${backupName} not found for session ${sid}`);
  }

  const profileDir = path.join(PROFILES_DIR, sid);
  fs.mkdirSync(profileDir, { recursive: true });

  cleanStaleLocks(profileDir);

  let restoredCount = 0;
  for (const entryName of BACKUP_ENTRIES) {
    const srcPath = path.join(backupPath, entryName);
    const dstPath = path.join(profileDir, entryName);
    if (!fs.existsSync(srcPath)) continue;

    try {
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        copyFolderRecursiveSync(srcPath, dstPath);
      } else {
        fs.copyFileSync(srcPath, dstPath);
      }
      restoredCount++;
    } catch {}
  }

  const backupCookieJson = path.join(backupPath, "cookies.json");
  if (fs.existsSync(backupCookieJson)) {
    try {
      fs.copyFileSync(backupCookieJson, cookiePath(sid));
      restoredCount++;
    } catch {}
  }

  return {
    ok: true,
    sessionId: sid,
    restoredBackup: backupName,
    restoredCount,
    restoredAt: new Date().toISOString(),
  };
}

function deleteSessionBackup(id, backupName) {
  const sid = safeId(id);
  const backupPath = path.join(BACKUPS_DIR, sid, backupName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup ${backupName} not found`);
  }
  fs.rmSync(backupPath, { recursive: true, force: true });
  return { ok: true, deleted: backupName };
}

async function openSession(id, opts = {}) {
  const record = getSession(id) || (await createSessionRecord(id));

  // Clean any stale locks before spawning worker
  try {
    cleanStaleLocks(record.userDataDir);
  } catch {}

  const handle = await launchWorker(record, opts);

  handle.on("tabs", (tabs) => {
    try {
      saveSessionPatch(record.id, { tabs });
    } catch {}
  });

  handle.on("cookies", (cookieCount) => {
    try {
      saveSessionPatch(record.id, { cookieCount });
    } catch {}
  });

  handle.once("disconnected", () => {
    try {
      saveSessionPatch(record.id, {
        tabs: handle.tabs || [],
        cookieCount: handle.cookieCount || 0,
      });

      // Automatically create snapshot backup on clean disconnect
      backupSessionProfile(record.id, "auto").catch((err) => {
        console.warn(`[manager] Auto-backup notice for session ${record.id}:`, err.message);
      });
    } catch {}
  });

  await saveSessionPatch(record.id, { lastOpenedAt: new Date().toISOString() });
  handle.session = getSession(record.id);

  return handle;
}

async function openMany(ids, opts = {}) {
  const threads = Math.max(1, Number(opts.threads) || ids.length);
  const out = new Array(ids.length);
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= ids.length) return;
      out[i] = await openSession(ids[i], opts);
      done += 1;
      opts.onProgress?.(ids[i], done, ids.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(threads, ids.length) }, () => worker()));
  return out;
}

function listAllProxies() {
  const store = readStore();
  const assignedMap = new Map();
  for (const s of Object.values(store.sessions)) {
    if (s.proxy) assignedMap.set(proxyKey(s.proxy), s.id);
  }
  const proxies = loadProxies();
  return proxies.map((p) => {
    const key = proxyKey(p);
    const assignedSessionId = assignedMap.get(key) || null;
    return {
      key,
      host: p.host,
      port: p.port,
      username: p.username || "",
      isAssigned: Boolean(assignedSessionId),
      assignedTo: assignedSessionId,
      url: `http://${p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || "")}@` : ""}${p.host}:${p.port}`,
    };
  });
}

function listAllFingerprints() {
  const { listFptFiles, inspectFingerprint } = require("./fingerprint");
  const store = readStore();
  const assignedMap = new Map();
  for (const s of Object.values(store.sessions)) {
    if (s.fingerprintFile) assignedMap.set(s.fingerprintFile, s.id);
  }
  const files = listFptFiles();
  return files.map((file) => {
    const details = inspectFingerprint(file);
    const assignedSessionId = assignedMap.get(file) || null;
    return {
      ...details,
      isAssigned: Boolean(assignedSessionId),
      assignedTo: assignedSessionId,
    };
  });
}

function getSystemStats() {
  const sessions = listSessions();
  const proxies = listAllProxies();
  const { listFptFiles } = require("./fingerprint");
  const files = listFptFiles();
  const assignedFpts = new Set(sessions.map((s) => s.fingerprintFile).filter(Boolean));
  const accounts = parseCsvAccounts();
  const totalCookies = sessions.reduce((acc, s) => acc + (s.cookieCount || 0), 0);
  return {
    sessionsTotal: sessions.length,
    proxiesTotal: proxies.length,
    proxiesFree: proxies.filter((p) => !p.isAssigned).length,
    fingerprintsTotal: files.length,
    fingerprintsFree: files.filter((f) => !assignedFpts.has(f)).length,
    accountsTotal: accounts.length,
    totalCookies,
  };
}

module.exports = {
  createSessionRecord,
  getSession,
  listSessions,
  nextSessionIds,
  deleteSession,
  parseCsvAccounts,
  ensureSessions,
  syncSheetEdits,
  saveSessionPatch,
  openSession,
  openMany,
  parseProxy,
  loadProxies,
  listAllProxies,
  listAllFingerprints,
  getSystemStats,
  generateFingerprint,
  backupSessionProfile,
  listSessionBackups,
  restoreSessionBackup,
  deleteSessionBackup,
  cleanStaleLocks,
  PROXY_FILE,
  ACCOUNT_FILE,
  STORE_PATH,
};

// [fix] stale lock check
