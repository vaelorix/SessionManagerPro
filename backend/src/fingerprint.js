const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Point to root resources/fpts
const FPTS_DIR = path.resolve(__dirname, "..", "..", "resources", "fpts");

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
];

function timezoneFromHost(host) {
  let n = 0;
  for (const ch of String(host)) n = (n + ch.charCodeAt(0)) % TIMEZONES.length;
  return TIMEZONES[n];
}

function listFptFiles() {
  if (!fs.existsSync(FPTS_DIR)) return [];
  return fs
    .readdirSync(FPTS_DIR)
    .filter((f) => f.endsWith(".json.gz") || f.endsWith(".json"));
}

function loadFptRaw(file) {
  const buf = fs.readFileSync(path.join(FPTS_DIR, file));
  const raw = file.endsWith(".gz") ? zlib.gunzipSync(buf) : buf;
  return JSON.parse(raw.toString("utf8"));
}

function parseLang(lang) {
  const parts = String(lang || "en-US")
    .split(",")
    .map((s) => s.split(";")[0].trim())
    .filter(Boolean);
  return {
    locale: parts[0] || "en-US",
    languages: parts.length ? parts : ["en-US", "en"],
  };
}

function decodeUserAgentData(b64) {
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function lookupProxyGeo(proxy) {
  if (!proxy?.host) return null;
  try {
    const res = await fetch(
      `http://ip-api.com/json/${proxy.host}?fields=status,timezone,countryCode,lat,lon`,
      { signal: AbortSignal.timeout(2500) },
    );
    const data = await res.json();
    if (data.status === "success" && data.timezone) return data;
  } catch {
    // offline or rate-limited
  }
  return null;
}

async function buildFingerprint(file, proxy) {
  const raw = loadFptRaw(file);
  const attr = raw.attr || {};
  const ua = raw.ua || attr["navigator.userAgent"] || "";
  const chromeVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || "149.0.0.0";
  const { locale, languages } = parseLang(raw.lang);
  const geo = await lookupProxyGeo(proxy);
  const width = Number(attr["screen.width"] || raw.width || 1920);
  const height = Number(attr["screen.height"] || raw.height || 1080);
  const dpr = Number(attr["window.devicePixelRatio"] || 1) || 1;
  return {
    file,
    chromeVersion,
    userAgent: ua,
    platform: attr["navigator.platform"] || "Win32",
    locale,
    languages,
    timezone: geo?.timezone || (proxy?.host ? timezoneFromHost(proxy.host) : "America/New_York"),
    hardwareConcurrency: Number(attr.hardwareConcurrency || 8),
    deviceMemory: Number(attr.deviceMemory || 8),
    maxTouchPoints: Number(attr.maxTouchPoints || 0),
    vendor: attr["navigator.vendor"] || "Google Inc.",
    appVersion: attr["navigator.appVersion"] || "",
    viewport: { width, height, deviceScaleFactor: dpr },
    screen: {
      width,
      height,
      availWidth: Number(attr["screen.availWidth"] || width),
      availHeight: Number(attr["screen.availHeight"] || height),
      colorDepth: Number(attr["screen.colorDepth"] || 24),
      pixelDepth: Number(attr["screen.pixelDepth"] || 24),
    },
    webgl: {
      vendor: raw.webgl_properties?.unmaskedVendor || "Google Inc. (Intel)",
      renderer:
        raw.webgl_properties?.unmaskedRenderer ||
        "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    userAgentData: decodeUserAgentData(raw.useragentdata),
    geo: geo
      ? { countryCode: geo.countryCode, lat: geo.lat, lon: geo.lon }
      : undefined,
  };
}

async function generateFingerprint(proxy, usedFiles = []) {
  const free = listFptFiles().filter((f) => !usedFiles.includes(f));
  if (!free.length) throw new Error("no unused fingerprints left in resources/fpts");
  return buildFingerprint(free[Math.floor(Math.random() * free.length)], proxy);
}

function chromeMajor(fp) {
  return String(fp.chromeVersion || "149").split(".")[0];
}

async function applyFingerprint(page, fp) {
  const major = chromeMajor(fp);
  const uad = fp.userAgentData;
  await page.setUserAgent(fp.userAgent);
  await page.setExtraHTTPHeaders({
    "Accept-Language": `${fp.locale},${fp.languages.filter((l) => l !== fp.locale).join(",")};q=0.9`,
  });
  const client = await page.createCDPSession();
  await client.send("Emulation.setTimezoneOverride", { timezoneId: fp.timezone });
  await client.send("Emulation.setLocaleOverride", { locale: fp.locale });
  await client.send("Emulation.setUserAgentOverride", {
    userAgent: fp.userAgent,
    acceptLanguage: fp.locale,
    platform: fp.platform === "Win32" ? "Windows" : fp.platform,
    userAgentMetadata: uad
      ? {
          brands: uad.brands || [],
          fullVersion: uad.fullVersion || fp.chromeVersion,
          fullVersionList: uad.fullVersionList || [],
          platform: uad.platform || "Windows",
          platformVersion: uad.platformVersion || "15.0.0",
          architecture: uad.architecture || "x86",
          model: uad.model || "",
          mobile: Boolean(uad.mobile),
          bitness: uad.bitness || "64",
          wow64: Boolean(uad.wow64),
        }
      : {
          brands: [
            { brand: "Google Chrome", version: major },
            { brand: "Chromium", version: major },
            { brand: "Not.A/Brand", version: "24" },
          ],
          fullVersion: fp.chromeVersion,
          platform: "Windows",
          platformVersion: "15.0.0",
          architecture: "x86",
          model: "",
          mobile: false,
          bitness: "64",
          wow64: false,
        },
  });
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: fp.viewport.width,
    height: fp.viewport.height,
    deviceScaleFactor: fp.viewport.deviceScaleFactor,
    mobile: false,
  });
  if (fp.geo?.lat != null && fp.geo?.lon != null) {
    await client.send("Emulation.setGeolocationOverride", {
      latitude: fp.geo.lat,
      longitude: fp.geo.lon,
      accuracy: 80,
    });
  }
  await page.evaluateOnNewDocument((fp) => {
    const nav = {
      hardwareConcurrency: fp.hardwareConcurrency,
      deviceMemory: fp.deviceMemory,
      platform: fp.platform,
      language: fp.locale,
      languages: fp.languages,
      userAgent: fp.userAgent,
      vendor: fp.vendor || "Google Inc.",
      maxTouchPoints: fp.maxTouchPoints || 0,
    };
    if (fp.appVersion) nav.appVersion = fp.appVersion;
    for (const [key, value] of Object.entries(nav)) {
      Object.defineProperty(navigator, key, { get: () => value });
    }
    for (const [key, value] of Object.entries(fp.screen)) {
      Object.defineProperty(screen, key, { get: () => value });
    }
    const patchWebGL = (glProto) => {
      if (!glProto) return;
      const original = glProto.getParameter;
      glProto.getParameter = function (param) {
        if (param === 37445) return fp.webgl.vendor;
        if (param === 37446) return fp.webgl.renderer;
        return original.call(this, param);
      };
    };
    if (typeof WebGLRenderingContext !== "undefined") {
      patchWebGL(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== "undefined") {
      patchWebGL(WebGL2RenderingContext.prototype);
    }
  }, fp);
}

function buildInitScript(fp) {
  if (!fp) return "";
  const jsonStr = JSON.stringify({
    hardwareConcurrency: fp.hardwareConcurrency,
    deviceMemory: fp.deviceMemory,
    platform: fp.platform,
    maxTouchPoints: fp.maxTouchPoints,
    userAgent: fp.userAgent,
    appVersion: fp.appVersion,
    vendor: fp.vendor,
    languages: fp.languages,
    locale: fp.locale,
    screen: fp.screen,
    viewport: fp.viewport,
    webgl: fp.webgl,
    userAgentData: fp.userAgentData,
  });

  return `
(function() {
  try {
    const fp = ${jsonStr};
    if (!fp) return;

    // 1. Hardware Concurrency & Device Memory (Strictly from Fingerprint)
    if (fp.hardwareConcurrency) {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => Number(fp.hardwareConcurrency),
        configurable: true,
        enumerable: true
      });
    }
    if (fp.deviceMemory) {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => Number(fp.deviceMemory),
        configurable: true,
        enumerable: true
      });
    }
    if (fp.platform) {
      Object.defineProperty(navigator, 'platform', {
        get: () => fp.platform,
        configurable: true,
        enumerable: true
      });
    }
    if (fp.maxTouchPoints !== undefined) {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => Number(fp.maxTouchPoints),
        configurable: true,
        enumerable: true
      });
    }
    if (fp.vendor) {
      Object.defineProperty(navigator, 'vendor', {
        get: () => fp.vendor,
        configurable: true,
        enumerable: true
      });
    }
    if (fp.userAgent) {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => fp.userAgent,
        configurable: true,
        enumerable: true
      });
    }
    if (fp.appVersion) {
      Object.defineProperty(navigator, 'appVersion', {
        get: () => fp.appVersion,
        configurable: true,
        enumerable: true
      });
    }
    if (fp.languages && fp.languages.length) {
      Object.defineProperty(navigator, 'languages', {
        get: () => Object.freeze([...fp.languages]),
        configurable: true,
        enumerable: true
      });
      Object.defineProperty(navigator, 'language', {
        get: () => fp.languages[0],
        configurable: true,
        enumerable: true
      });
    }

    // 2. Screen & Device Metrics (Strictly from Fingerprint)
    if (fp.screen) {
      const scr = fp.screen;
      const metrics = {
        width: scr.width,
        height: scr.height,
        availWidth: scr.availWidth || scr.width,
        availHeight: scr.availHeight || scr.height,
        colorDepth: scr.colorDepth || 24,
        pixelDepth: scr.pixelDepth || scr.colorDepth || 24
      };
      for (const [k, v] of Object.entries(metrics)) {
        if (v !== undefined) {
          Object.defineProperty(screen, k, {
            get: () => Number(v),
            configurable: true,
            enumerable: true
          });
        }
      }
    }
    if (fp.viewport && fp.viewport.deviceScaleFactor) {
      Object.defineProperty(window, 'devicePixelRatio', {
        get: () => Number(fp.viewport.deviceScaleFactor),
        configurable: true,
        enumerable: true
      });
    }

    // 3. WebGL GPU Unmasked Vendor & Renderer
    const patchWebGL = (proto) => {
      if (!proto || !proto.getParameter) return;
      const origGetParameter = proto.getParameter;
      proto.getParameter = function(param) {
        if (param === 37445) {
          return (fp.webgl && fp.webgl.vendor) || "Google Inc. (Intel)";
        }
        if (param === 37446) {
          return (fp.webgl && fp.webgl.renderer) || "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)";
        }
        return origGetParameter.apply(this, arguments);
      };
    };
    if (typeof WebGLRenderingContext !== 'undefined') patchWebGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext.prototype);

    // 4. Client Hints (navigator.userAgentData)
    if (fp.userAgentData) {
      const uad = fp.userAgentData;
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands: uad.brands || [
            { brand: "Google Chrome", version: "131" },
            { brand: "Chromium", version: "131" },
            { brand: "Not_A Brand", version: "24" }
          ],
          mobile: Boolean(uad.mobile),
          platform: uad.platform || (fp.platform === "Win32" ? "Windows" : fp.platform || "Windows"),
          getHighEntropyValues: async (hints) => ({
            architecture: uad.architecture || "x86",
            bitness: uad.bitness || "64",
            brands: uad.brands || [],
            fullVersionList: uad.fullVersionList || [],
            mobile: Boolean(uad.mobile),
            model: uad.model || "",
            platform: uad.platform || "Windows",
            platformVersion: uad.platformVersion || "15.0.0",
            wow64: Boolean(uad.wow64)
          })
        }),
        configurable: true,
        enumerable: true
      });
    }
  } catch(e) {}
})();
`;
}

const CACHE_FILE = path.resolve(__dirname, "..", "..", "data", "fingerprints_cache.json");
let memoryCache = null;
let saveTimer = null;

function loadCache() {
  if (memoryCache) return memoryCache;
  memoryCache = new Map();
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      for (const [k, v] of Object.entries(data)) {
        memoryCache.set(k, v);
      }
    }
  } catch {}
  return memoryCache;
}

function scheduleSaveCache() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!memoryCache) return;
      const dataDir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const obj = Object.fromEntries(memoryCache);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
    } catch {}
  }, 1000);
}

function parseFilenameMeta(file) {
  const parts = file.replace(/\.json(\.gz)?$/, "").split("_");
  const hash = parts[0] || file;
  const country = parts[1] || "GLOBAL";
  const browserCode = parts[2] || "C";
  const browserName = browserCode === "F" ? "Firefox" : "Chrome";
  return {
    shortId: hash.slice(0, 8),
    country,
    browserName,
  };
}

function inspectFingerprint(file) {
  const cache = loadCache();
  if (cache.has(file)) {
    return cache.get(file);
  }

  const meta = parseFilenameMeta(file);
  try {
    const raw = loadFptRaw(file);
    const attr = raw.attr || {};
    const ua = raw.ua || attr["navigator.userAgent"] || "";
    const chromeVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || "120.0";
    const width = Number(attr["screen.width"] || raw.width || 1920);
    const height = Number(attr["screen.height"] || raw.height || 1080);
    const details = {
      file,
      shortId: meta.shortId,
      country: meta.country,
      browserName: meta.browserName,
      format: file.endsWith(".gz") ? "json.gz" : "json",
      userAgent: ua,
      chromeVersion,
      platform: attr["navigator.platform"] || "Win32",
      viewport: `${width}x${height}`,
      webglVendor: raw.webgl_properties?.unmaskedVendor || "Google Inc. (Intel)",
      webglRenderer: raw.webgl_properties?.unmaskedRenderer || "Direct3D11",
      hardwareConcurrency: Number(attr.hardwareConcurrency || 8),
      deviceMemory: Number(attr.deviceMemory || 8),
      lang: raw.lang || "en-US",
    };
    cache.set(file, details);
    scheduleSaveCache();
    return details;
  } catch (err) {
    const fallback = {
      file,
      shortId: meta.shortId,
      country: meta.country,
      browserName: meta.browserName,
      format: file.endsWith(".gz") ? "json.gz" : "json",
      userAgent: "",
      chromeVersion: "120.0",
      platform: "Win32",
      viewport: "1920x1080",
      webglVendor: "Default",
      webglRenderer: "Default",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      lang: "en-US",
      error: err.message,
    };
    cache.set(file, fallback);
    return fallback;
  }
}

// Pre-warm cache synchronously if cache file exists, or lazy load
function warmFingerprintsCache() {
  const files = listFptFiles();
  const cache = loadCache();
  let dirty = false;
  for (const file of files) {
    if (!cache.has(file)) {
      inspectFingerprint(file);
      dirty = true;
    }
  }
  if (dirty) {
    try {
      const dataDir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
    } catch {}
  }
}

module.exports = {
  FPTS_DIR,
  listFptFiles,
  loadFptRaw,
  inspectFingerprint,
  warmFingerprintsCache,
  buildFingerprint,
  generateFingerprint,
  applyFingerprint,
  buildInitScript,
};
