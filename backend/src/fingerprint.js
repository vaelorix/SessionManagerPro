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
  const all = fs
    .readdirSync(FPTS_DIR)
    .filter((f) => f.endsWith(".json.gz") || f.endsWith(".json"));
  // Prioritize genuine Chrome fingerprints (_C.json.gz)
  const chromeFiles = all.filter((f) => f.endsWith("_C.json.gz"));
  return chromeFiles.length > 0 ? chromeFiles : all;
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
    const data = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (data.brands && Array.isArray(data.brands)) {
      data.brands = data.brands.map((b) =>
        /brave/i.test(b.brand) ? { ...b, brand: "Google Chrome" } : b
      );
    }
    if (data.fullVersionList && Array.isArray(data.fullVersionList)) {
      data.fullVersionList = data.fullVersionList.map((b) =>
        /brave/i.test(b.brand) ? { ...b, brand: "Google Chrome" } : b
      );
    }
    return data;
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

  let webglVendor = raw.webgl_properties?.unmaskedVendor || "Google Inc. (Intel)";
  let webglRenderer =
    raw.webgl_properties?.unmaskedRenderer ||
    "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)";
  if (/brave/i.test(webglVendor) || /brave/i.test(webglRenderer)) {
    webglVendor = "Google Inc. (Intel)";
    webglRenderer = "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)";
  }

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
      vendor: webglVendor,
      renderer: webglRenderer,
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

    const nativeStrings = new WeakMap();
    const origToString = Function.prototype.toString;

    const pToString = new Proxy(origToString, {
      apply(target, thisArg, args) {
        if (typeof thisArg === 'function' && nativeStrings.has(thisArg)) {
          return nativeStrings.get(thisArg);
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
    nativeStrings.set(pToString, 'function toString() { [native code] }');
    nativeStrings.set(origToString, 'function toString() { [native code] }');
    try {
      Object.defineProperty(Function.prototype, 'toString', {
        value: pToString,
        writable: true,
        configurable: true,
        enumerable: false
      });
    } catch (e) {}

    function wrapNative(fn, name, length = 0) {
      try {
        Object.defineProperty(fn, 'name', { value: name, configurable: true });
        Object.defineProperty(fn, 'length', { value: length, configurable: true });
      } catch (e) {}
      nativeStrings.set(fn, 'function ' + name + '() { [native code] }');
      return fn;
    }

    function overrideNavProp(prop, getValue) {
      const getter = wrapNative(function () {
        if (!(this instanceof Navigator) && this !== navigator) {
          throw new TypeError('Illegal invocation');
        }
        return getValue();
      }, 'get ' + prop, 0);

      try {
        Object.defineProperty(Navigator.prototype, prop, {
          get: getter,
          configurable: true,
          enumerable: true
        });
      } catch (e) {}
    }

    function overrideScreenProp(prop, getValue) {
      const getter = wrapNative(function () {
        if (!(this instanceof Screen) && this !== screen) {
          throw new TypeError('Illegal invocation');
        }
        return getValue();
      }, 'get ' + prop, 0);

      try {
        Object.defineProperty(Screen.prototype, prop, {
          get: getter,
          configurable: true,
          enumerable: true
        });
      } catch (e) {}
    }

    // 1. Navigator properties (strictly on Navigator.prototype)
    if (fp.hardwareConcurrency) overrideNavProp('hardwareConcurrency', () => Number(fp.hardwareConcurrency));
    if (fp.deviceMemory) overrideNavProp('deviceMemory', () => Number(fp.deviceMemory));
    if (fp.platform) overrideNavProp('platform', () => fp.platform);
    if (fp.maxTouchPoints !== undefined) overrideNavProp('maxTouchPoints', () => Number(fp.maxTouchPoints));
    if (fp.vendor) overrideNavProp('vendor', () => fp.vendor);
    if (fp.userAgent) overrideNavProp('userAgent', () => fp.userAgent);
    if (fp.appVersion) overrideNavProp('appVersion', () => fp.appVersion);
    if (fp.languages && fp.languages.length) {
      overrideNavProp('languages', () => Object.freeze([...fp.languages]));
      overrideNavProp('language', () => fp.languages[0]);
    }
    overrideNavProp('pdfViewerEnabled', () => true);

    // 2. Screen properties (strictly on Screen.prototype)
    if (fp.screen) {
      const scr = fp.screen;
      if (scr.width) overrideScreenProp('width', () => Number(scr.width));
      if (scr.height) overrideScreenProp('height', () => Number(scr.height));
      if (scr.availWidth) overrideScreenProp('availWidth', () => Number(scr.availWidth));
      if (scr.availHeight) overrideScreenProp('availHeight', () => Number(scr.availHeight));
      if (scr.colorDepth) overrideScreenProp('colorDepth', () => Number(scr.colorDepth));
      if (scr.pixelDepth) overrideScreenProp('pixelDepth', () => Number(scr.pixelDepth));
      overrideScreenProp('availLeft', () => 0);
      overrideScreenProp('availTop', () => 0);
    }
    if (fp.viewport && fp.viewport.deviceScaleFactor) {
      const dprGetter = wrapNative(function () {
        return Number(fp.viewport.deviceScaleFactor);
      }, 'get devicePixelRatio', 0);
      try {
        Object.defineProperty(window, 'devicePixelRatio', {
          get: dprGetter,
          configurable: true,
          enumerable: true
        });
      } catch (e) {}
    }

    // 3. WebGL GPU Unmasked Vendor & Renderer
    const patchWebGL = (proto) => {
      if (!proto || !proto.getParameter) return;
      const origGetParameter = proto.getParameter;
      proto.getParameter = wrapNative(function getParameter(param) {
        if (!(this instanceof proto.constructor)) {
          return origGetParameter.apply(this, arguments);
        }
        if (param === 37445) {
          return (fp.webgl && fp.webgl.vendor) || "Google Inc. (Intel)";
        }
        if (param === 37446) {
          return (fp.webgl && fp.webgl.renderer) || "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)";
        }
        return origGetParameter.apply(this, arguments);
      }, 'getParameter', 1);
    };
    if (typeof WebGLRenderingContext !== 'undefined') patchWebGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext.prototype);

    // 4. Client Hints (userAgentData on NavigatorUAData.prototype)
    if (typeof NavigatorUAData !== 'undefined' && fp.userAgentData) {
      const uad = fp.userAgentData;
      if (uad.brands) {
        const bGetter = wrapNative(function () {
          if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
          return Object.freeze([...uad.brands]);
        }, 'get brands', 0);
        try {
          Object.defineProperty(NavigatorUAData.prototype, 'brands', {
            get: bGetter,
            configurable: true,
            enumerable: true
          });
        } catch (e) {}
      }
      if (uad.mobile !== undefined) {
        const mGetter = wrapNative(function () {
          if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
          return Boolean(uad.mobile);
        }, 'get mobile', 0);
        try {
          Object.defineProperty(NavigatorUAData.prototype, 'mobile', {
            get: mGetter,
            configurable: true,
            enumerable: true
          });
        } catch (e) {}
      }
      if (uad.platform) {
        const pGetter = wrapNative(function () {
          if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
          return uad.platform;
        }, 'get platform', 0);
        try {
          Object.defineProperty(NavigatorUAData.prototype, 'platform', {
            get: pGetter,
            configurable: true,
            enumerable: true
          });
        } catch (e) {}
      }

      const origGHEV = NavigatorUAData.prototype.getHighEntropyValues;
      NavigatorUAData.prototype.getHighEntropyValues = wrapNative(async function getHighEntropyValues(hints) {
        if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
        const res = await origGHEV.apply(this, arguments);
        if (uad.architecture) res.architecture = uad.architecture;
        if (uad.bitness) res.bitness = uad.bitness;
        if (uad.brands) res.brands = uad.brands;
        if (uad.fullVersionList) res.fullVersionList = uad.fullVersionList;
        if (uad.model !== undefined) res.model = uad.model;
        if (uad.platform) res.platform = uad.platform;
        if (uad.platformVersion) res.platformVersion = uad.platformVersion;
        if (uad.wow64 !== undefined) res.wow64 = Boolean(uad.wow64);
        return res;
      }, 'getHighEntropyValues', 1);
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
