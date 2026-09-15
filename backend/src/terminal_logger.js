/**
 * SessionManagerPro — Dedicated External Terminal Logger
 * High-performance, beautifully styled, colored live console monitor
 * with ASCII art banner, real-time WebSocket streaming, and status metrics.
 */
const WebSocket = require("ws");
const chalk = require("chalk");
const http = require("http");

const PORT = process.env.PORT || 3001;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const STATS_URL = `http://127.0.0.1:${PORT}/api/stats`;

// Set terminal window title
if (process.stdout.isTTY) {
  process.stdout.write("\x1b]2;SessionManagerPro — Live Stealth Console\x07");
}

const mint = chalk.hex("#00f5a0");
const cyan = chalk.hex("#00d2ff");
const emerald = chalk.hex("#10b981");
const amber = chalk.hex("#fbbf24");
const violet = chalk.hex("#a855f7");
const fuchsia = chalk.hex("#ec4899");
const sky = chalk.hex("#38bdf8");
const dim = chalk.hex("#64748b");
const slate = chalk.hex("#94a3b8");
const dark = chalk.hex("#1e293b");

const BANNER_ART = `
  ███████╗███████╗███████╗███████╗██╗ ██████╗ ███╗   ██╗
  ██╔════╝██╔════╝██╔════╝██╔════╝██║██╔═══██╗████╗  ██║
  ███████╗█████╗  ███████╗███████╗██║██║   ██║██╔██╗ ██║
  ╚════██║██╔══╝  ╚════██║╚════██║██║██║   ██║██║╚██╗██║
  ███████║███████╗███████║███████║██║╚██████╔╝██║ ╚████║
  ╚══════╝╚══════╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
`;

let currentStats = null;
let currentPool = null;

function fetchStats() {
  return new Promise((resolve) => {
    http
      .get(STATS_URL, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      })
      .on("error", () => resolve(null));
  });
}

function printHeader() {
  console.clear();
  console.log();
  const bannerLines = BANNER_ART.trim().split("\n");
  const colors = [mint, cyan, sky, cyan, emerald, mint];
  bannerLines.forEach((line, i) => {
    const col = colors[i % colors.length];
    console.log(col(line));
  });

  console.log(
    `   ${mint.bold("S E S S I O N   M A N A G E R   P R O")}  ${dim("•")}  ${cyan("I N V I S I B L E   P L A Y W R I G H T   E N G I N E")}`
  );
  console.log(
    `   ${slate("Undetected Firefox Fingerprinting")}  ${dim("•")}  ${slate("C++ Source Stealth")}  ${dim("•")}  ${slate("Bezier Mouse Motion")}`
  );
  console.log();

  printStatusBar();

  console.log(
    `  ${dim("TIME")}        ${dim("CATEGORY")}       ${dim("STATUS")}    ${dim("SESSION")}                 ${dim("EVENT / ACTIVITY")}`
  );
  console.log(
    `  ${dim("──────────── ──────────── ───────── ─────────────────────── ─────────────────────────────────────────────────────────────")}`
  );
}

function printStatusBar() {
  const active = currentPool?.activeCount ?? currentStats?.activeThreads ?? 0;
  const limit = currentPool?.threadLimit ?? currentStats?.threadLimit ?? 5;
  const queued = currentPool?.queuedCount ?? currentStats?.queuedCount ?? 0;
  const total = currentStats?.sessionsTotal ?? 0;
  const proxies = currentStats?.proxiesTotal ?? 0;
  const freeProxies = currentStats?.proxiesFree ?? 0;

  const boxWidth = 92;
  const hLine = "─".repeat(boxWidth - 2);

  console.log(`  ${dim("┌" + hLine + "┐")}`);
  console.log(
    `  ${dim("│")}  ${cyan.bold("ENGINE:")} ${mint("InvisiblePlaywright (Firefox 151.0 • C++ Native)")}   ${dim("│")}  ${cyan.bold("THREADS:")} ${active > 0 ? emerald.bold(`${active}/${limit} LIVE`) : dim(`0/${limit} IDLE`)}  ${queued > 0 ? amber.bold(`(${queued} queued)`) : ""} ${dim("│")}`
  );
  console.log(
    `  ${dim("│")}  ${cyan.bold("PROFILES:")} ${chalk.white.bold(total)} saved                  ${cyan.bold("PROXIES:")} ${chalk.white.bold(proxies)} total (${freeProxies} free)    ${dim("│")}  ${cyan.bold("STREAM:")} ${emerald.bold("● LIVE WS")}         ${dim("│")}`
  );
  console.log(`  ${dim("└" + hLine + "┘")}`);
  console.log();
}

function formatCategory(cat) {
  const c = String(cat || "SYS").toUpperCase();
  switch (c) {
    case "SESSION":
      return cyan.bold("[SESSION ]");
    case "PROXY":
      return amber.bold("[ PROXY  ]");
    case "FINGERPRINT":
      return violet.bold("[ FPT    ]");
    case "BROWSER":
      return emerald.bold("[BROWSER ]");
    case "QUEUE":
      return fuchsia.bold("[ QUEUE  ]");
    case "COOKIE":
      return sky.bold("[ COOKIE ]");
    default:
      return slate(`[ ${c.padEnd(6).slice(0, 6)} ]`);
  }
}

function formatLevel(lvl) {
  const l = String(lvl || "info").toLowerCase();
  switch (l) {
    case "success":
      return emerald.bold("✔ SUCCESS");
    case "error":
      return chalk.red.bold("✖ ERROR  ");
    case "warn":
      return amber.bold("▲ WARN   ");
    default:
      return dim("● INFO   ");
  }
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return dim(`${h}:${m}:${s}.${ms}`);
  } catch {
    return dim("00:00:00.000");
  }
}

function formatSessionId(id) {
  if (!id) return dim("───────────────────────");
  const str = String(id);
  if (str.length > 21) {
    return chalk.yellow.bold(str.slice(0, 19) + "…").padEnd(23);
  }
  return chalk.yellow.bold(str).padEnd(23);
}

function formatMessage(msg, level) {
  const text = String(msg || "");
  if (level === "error") {
    return chalk.red(text);
  }
  if (level === "success") {
    return mint(text);
  }

  // Highlight IPs, ports, URLs, seeds
  return text
    .replace(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+)/g, amber("$1"))
    .replace(/(https?:\/\/[^\s]+)/g, cyan("$1"))
    .replace(/(seed: \d+)/g, violet("$1"))
    .replace(/(\d+x\d+)/g, sky("$1"));
}

function printLog(log) {
  const time = formatTime(log.timestamp);
  const cat = formatCategory(log.category);
  const lvl = formatLevel(log.level);
  const sid = formatSessionId(log.sessionId);
  const text = formatMessage(log.message, log.level);

  console.log(`  ${time} ${cat} ${lvl} ${sid} ${text}`);
}

function connect() {
  printHeader();
  console.log(`  ${dim("Connecting to SessionManagerPro orchestrator stream at")} ${cyan(WS_URL)} ...\n`);

  fetchStats().then((s) => {
    if (s) {
      currentStats = s;
      printHeader();
    }
  });

  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    printHeader();
    console.log(`  ${emerald.bold("✔ Successfully connected to orchestrator stream.")} ${dim("Monitoring live events...")}\n`);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString("utf8"));
      if (msg.type === "log" && msg.data) {
        printLog(msg.data);
      } else if (msg.type === "pool" && msg.data) {
        currentPool = msg.data;
      } else if (msg.type === "logs" && Array.isArray(msg.data)) {
        // Print initial backlog if not too long
        msg.data.slice(-15).forEach((item) => printLog(item));
      }
    } catch {}
  });

  ws.on("error", () => {
    console.log(`\n  ${amber("▲ Waiting for SessionManagerPro backend server on port " + PORT + "...")}`);
  });

  ws.on("close", () => {
    console.log(`\n  ${dim("Connection closed. Reconnecting in 3 seconds...")}`);
    setTimeout(connect, 3000);
  });
}

// Keyboard shortcuts: C to clear, R to refresh banner, Q to quit
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key) => {
    if (key === "\u0003" || key === "q" || key === "Q") {
      process.exit(0);
    } else if (key === "c" || key === "C" || key === "r" || key === "R") {
      fetchStats().then((s) => {
        if (s) currentStats = s;
        printHeader();
      });
    }
  });
}

connect();

// [logger] timestamp ms
