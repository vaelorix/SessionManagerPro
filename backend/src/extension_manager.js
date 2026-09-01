const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const EXT_TOOL = path.join(__dirname, "ext_tool.py");
const DATA_EXT_DIR = path.join(ROOT, "data", "extensions");
const RES_EXT_DIR = path.join(ROOT, "resources", "extensions");
const CONFIG_FILE = path.join(ROOT, "data", "extensions_config.json");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
}

function findPython() {
  const candidates = [
    path.join(ROOT, ".venv", "Scripts", "python.exe"),
    path.join(ROOT, ".venv", "bin", "python"),
    "C:\\Program Files\\Python311\\python.exe",
    "python",
    "py.exe",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "python";
}

function readConfig() {
  ensureDir(path.dirname(CONFIG_FILE));
  if (!fs.existsSync(CONFIG_FILE)) {
    return { global: [], profileExtensions: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return {
      global: Array.isArray(raw.global) ? raw.global : (Array.isArray(raw.enabled) ? raw.enabled : []),
      profileExtensions: raw.profileExtensions && typeof raw.profileExtensions === "object" ? raw.profileExtensions : {},
    };
  } catch {
    return { global: [], profileExtensions: {} };
  }
}

function writeConfig(config) {
  ensureDir(path.dirname(CONFIG_FILE));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

function runExtTool(command, targetPath, destPath = "") {
  const py = findPython();
  const cmd = `"${py}" "${EXT_TOOL}" ${command} "${targetPath}" ${destPath ? `"${destPath}"` : ""}`;
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    return JSON.parse(out);
  } catch (err) {
    console.error(`[ext_tool] Error running ${command}:`, err.message);
    return { error: err.message };
  }
}

function safeExtId(name) {
  return name.replace(/\.(xpi|crx|zip)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

function listExtensions() {
  ensureDir(DATA_EXT_DIR);
  const dirsToScan = [DATA_EXT_DIR];
  if (fs.existsSync(RES_EXT_DIR)) dirsToScan.push(RES_EXT_DIR);

  const config = readConfig();
  const globalSet = new Set(config.global.map(String));
  const profileMap = config.profileExtensions || {};

  const extensions = [];
  const seenIds = new Set();

  for (const baseDir of dirsToScan) {
    if (!fs.existsSync(baseDir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const fullPath = path.join(baseDir, ent.name);
      let extId = safeExtId(ent.name);
      if (seenIds.has(extId)) continue;

      let meta = null;
      if (ent.isDirectory()) {
        const manifestPath = path.join(fullPath, "manifest.json");
        if (fs.existsSync(manifestPath)) {
          meta = runExtTool("inspect", fullPath);
        }
      } else if (ent.isFile()) {
        const lower = ent.name.toLowerCase();
        if (lower.endsWith(".xpi") || lower.endsWith(".zip") || lower.endsWith(".crx")) {
          meta = runExtTool("inspect", fullPath);
        }
      }

      if (meta && !meta.error) {
        seenIds.add(extId);

        // Find which profiles have this extension assigned
        const assignedProfiles = [];
        for (const [sid, list] of Object.entries(profileMap)) {
          if (Array.isArray(list) && (list.includes(extId) || list.includes(meta.name) || list.includes(ent.name))) {
            assignedProfiles.push(sid);
          }
        }

        extensions.push({
          id: extId,
          name: meta.name || ent.name,
          version: meta.version || "1.0",
          description: meta.description || "",
          icon: meta.icon || "",
          type: meta.type || (ent.isDirectory() ? "directory" : "xpi"),
          path: fullPath,
          isGlobal: globalSet.has(extId) || globalSet.has(meta.name) || globalSet.has(ent.name),
          assignedProfiles,
        });
      }
    }
  }

  return extensions;
}

function installExtensionFromBuffer(buffer, originalFilename) {
  ensureDir(DATA_EXT_DIR);
  const extLower = path.extname(originalFilename).toLowerCase();
  const baseName = path.basename(originalFilename, extLower);
  const extId = safeExtId(baseName);

  if (extLower === ".xpi") {
    const destXpi = path.join(DATA_EXT_DIR, `${extId}.xpi`);
    fs.writeFileSync(destXpi, buffer);
    const meta = runExtTool("inspect", destXpi);
    return {
      id: extId,
      name: meta.name || baseName,
      version: meta.version || "1.0",
      description: meta.description || "",
      icon: meta.icon || "",
      type: "xpi",
      path: destXpi,
      isGlobal: false,
      assignedProfiles: [],
    };
  }

  // For .zip or .crx, save temp archive then unpack into data/extensions/<extId>/
  const tempArchive = path.join(DATA_EXT_DIR, `_tmp_${extId}${extLower}`);
  const destDir = path.join(DATA_EXT_DIR, extId);
  fs.writeFileSync(tempArchive, buffer);

  try {
    const meta = runExtTool("unpack", tempArchive, destDir);
    try { fs.unlinkSync(tempArchive); } catch {}

    if (meta.error) {
      throw new Error(meta.error);
    }

    return {
      id: extId,
      name: meta.name || baseName,
      version: meta.version || "1.0",
      description: meta.description || "",
      icon: meta.icon || "",
      type: "directory",
      path: destDir,
      isGlobal: false,
      assignedProfiles: [],
    };
  } catch (err) {
    try { fs.unlinkSync(tempArchive); } catch {}
    throw err;
  }
}

function toggleExtensionGlobal(extId, isGlobal) {
  const config = readConfig();
  const globalSet = new Set(config.global);

  if (isGlobal) {
    globalSet.add(extId);
  } else {
    globalSet.delete(extId);
  }

  config.global = Array.from(globalSet);
  writeConfig(config);
  return { ok: true, extId, isGlobal: Boolean(isGlobal) };
}

function assignExtensionToProfiles(extId, profileIds) {
  const config = readConfig();
  config.profileExtensions = config.profileExtensions || {};

  const targetSet = new Set(profileIds || []);

  // Update assignment for all known profiles in map plus newly added
  const allSids = new Set([...Object.keys(config.profileExtensions), ...targetSet]);
  for (const sid of allSids) {
    const list = new Set(config.profileExtensions[sid] || []);
    if (targetSet.has(sid)) {
      list.add(extId);
    } else {
      list.delete(extId);
    }
    config.profileExtensions[sid] = Array.from(list);
  }

  writeConfig(config);
  return { ok: true, extId, assignedProfiles: Array.from(targetSet) };
}

function deleteExtension(extId) {
  const all = listExtensions();
  const target = all.find((e) => e.id === extId);
  if (!target) {
    throw new Error(`Extension ${extId} not found`);
  }

  if (fs.existsSync(target.path)) {
    const stat = fs.statSync(target.path);
    if (stat.isDirectory()) {
      fs.rmSync(target.path, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target.path);
    }
  }

  // Clean config
  const config = readConfig();
  config.global = config.global.filter((id) => id !== extId);
  for (const sid of Object.keys(config.profileExtensions || {})) {
    config.profileExtensions[sid] = config.profileExtensions[sid].filter((id) => id !== extId);
  }
  writeConfig(config);

  return { ok: true, deleted: extId };
}

function getExtensionsForSession(sessionId) {
  const all = listExtensions();
  const config = readConfig();
  const globalSet = new Set(config.global.map(String));
  const assignedList = new Set(config.profileExtensions?.[sessionId] || []);

  const enabledPaths = [];
  for (const ext of all) {
    if (ext.isGlobal || globalSet.has(ext.id) || assignedList.has(ext.id)) {
      enabledPaths.push(ext.path);
    }
  }
  return enabledPaths;
}

module.exports = {
  listExtensions,
  installExtensionFromBuffer,
  toggleExtensionGlobal,
  assignExtensionToProfiles,
  deleteExtension,
  getExtensionsForSession,
  readConfig,
  writeConfig,
};
