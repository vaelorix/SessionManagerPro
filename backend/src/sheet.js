const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// Point to root updates directory
const UPDATES_DIR = path.resolve(__dirname, "..", "..", "updates");
const CSV_PATH = path.join(UPDATES_DIR, "sessions.csv");
const HTML_PATH = path.join(UPDATES_DIR, "sessions.html");

const COLUMNS = [
  "Name",
  "Proxy",
  "Chrome",
  "Timezone",
  "Locale",
  "Viewport",
  "WebGL",
  "Cookies",
  "Tabs",
  "LastOpened",
  "Created",
  "ProfileDir",
  "Notes",
  "Result",
  "Reason",
  "Fingerprint",
];

function proxyUrl(p) {
  if (!p?.host) return "";
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || "")}@`
    : "";
  return `http://${auth}${p.host}:${p.port}`;
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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

function rowFromSession(s) {
  const fp = s.fingerprint || {};
  const vp = fp.viewport || {};
  return {
    Name: s.email || s.id,
    Proxy: proxyUrl(s.proxy),
    Chrome: fp.chromeVersion || "",
    Timezone: fp.timezone || "",
    Locale: fp.locale || "",
    Viewport: vp.width ? `${vp.width}x${vp.height}` : "",
    WebGL: fp.webgl?.renderer || "",
    Cookies: s.cookieCount || 0,
    Tabs: (s.tabs || []).join(" | "),
    LastOpened: s.lastOpenedAt || "",
    Created: s.createdAt || "",
    ProfileDir: s.userDataDir || "",
    Notes: s.notes || "",
    Result: s.lastResult?.status || "",
    Reason: s.lastResult?.reason || "",
    Fingerprint: s.fingerprintFile || s.fingerprint?.file || "",
  };
}

function writeCsv(rows) {
  const lines = [
    COLUMNS.join(","),
    ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(",")),
  ];
  fs.writeFileSync(CSV_PATH, lines.join("\n") + "\n");
}

function writeHtml(rows) {
  const data = JSON.stringify(rows);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Session Manager</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      background: #f4f6f8;
      color: #111827;
    }
    header {
      position: sticky; top: 0; z-index: 5;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      padding: 16px 22px;
      background: #0f172a;
      color: #fff;
    }
    h1 { margin: 0; font-size: 20px; letter-spacing: .02em; }
    .meta { opacity: .75; font-size: 13px; }
    input[type="search"] {
      margin-left: auto;
      padding: 8px 12px;
      border: 0;
      border-radius: 8px;
      min-width: 240px;
      font: inherit;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 8px 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      background: #38bdf8;
      color: #0f172a;
    }
    main { padding: 18px 22px 40px; }
    .wrap { overflow: auto; background: #fff; border-radius: 12px; box-shadow: 0 8px 30px rgba(15,23,42,.08); }
    table { border-collapse: collapse; width: max-content; min-width: 100%; }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 8px 10px;
      font-size: 13px;
      vertical-align: top;
      white-space: nowrap;
    }
    th {
      position: sticky; top: 0;
      color: #fff;
      font-weight: 800;
      text-align: left;
    }
    td.email { font-weight: 800; }
    td[contenteditable="true"] { outline: none; }
    td[contenteditable="true"]:focus { box-shadow: inset 0 0 0 2px #0f172a; }
    tr:nth-child(even) td { filter: saturate(1.05); }
    .Name { background: #1d4ed8; } td.Name { background: #dbeafe; }
    .Proxy { background: #b45309; } td.Proxy { background: #ffedd5; }
    .Chrome { background: #7c3aed; } td.Chrome { background: #ede9fe; }
    .Timezone { background: #0f766e; } td.Timezone { background: #ccfbf1; }
    .Locale { background: #0369a1; } td.Locale { background: #e0f2fe; }
    .Viewport { background: #4f46e5; } td.Viewport { background: #e0e7ff; }
    .WebGL { background: #be185d; } td.WebGL { background: #fce7f3; }
    .Cookies { background: #15803d; } td.Cookies { background: #dcfce7; }
    .Tabs { background: #0e7490; } td.Tabs { background: #cffafe; }
    .LastOpened { background: #334155; } td.LastOpened { background: #e2e8f0; }
    .Created { background: #475569; } td.Created { background: #f1f5f9; }
    .ProfileDir { background: #57534e; } td.ProfileDir { background: #f5f5f4; }
    .Notes { background: #a16207; } td.Notes { background: #fef9c3; }
    .Result { background: #166534; } td.Result { background: #dcfce7; }
    .Reason { background: #9f1239; } td.Reason { background: #ffe4e6; }
  </style>
</head>
<body>
  <header>
    <h1>SESSION SHEET</h1>
    <div class="meta">${rows.length} sessions · edit Proxy / Notes here or in sessions.csv</div>
    <input id="q" type="search" placeholder="Filter emails, proxy, timezone..." />
    <button id="save">Save CSV</button>
  </header>
  <main>
    <div class="wrap">
      <table id="grid"></table>
    </div>
  </main>
  <script>
    const COLUMNS = ${JSON.stringify(COLUMNS)};
    const EDITABLE = new Set(["Proxy", "Notes"]);
    const rows = ${data};

    function render(list) {
      const table = document.getElementById("grid");
      table.innerHTML = "<thead><tr>" + COLUMNS.map(c => "<th class=\\"" + c + "\\">" + c + "</th>").join("") + "</tr></thead>";
      const body = document.createElement("tbody");
      for (const row of list) {
        const tr = document.createElement("tr");
        for (const c of COLUMNS) {
          const td = document.createElement("td");
          td.className = c + (c === "Name" ? " email" : "");
          td.textContent = row[c] ?? "";
          if (EDITABLE.has(c)) td.contentEditable = "true";
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      table.appendChild(body);
    }

    function currentRows() {
      return [...document.querySelectorAll("#grid tbody tr")].map(tr => {
        const cells = [...tr.children];
        const row = {};
        COLUMNS.forEach((c, i) => { row[c] = cells[i].textContent; });
        return row;
      });
    }

    function csvCell(v) {
      const s = String(v ?? "");
      return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    document.getElementById("q").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      render(rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q))));
    });

    document.getElementById("save").addEventListener("click", () => {
      const csv = [COLUMNS.join(","), ...currentRows().map(r => COLUMNS.map(c => csvCell(r[c])).join(","))].join("\\n") + "\\n";
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sessions.csv";
      a.click();
    });

    render(rows);
  </script>
</body>
</html>
`;
  fs.writeFileSync(HTML_PATH, html);
}

function writeSessionSheet(sessions) {
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  const rows = (sessions || []).map(rowFromSession);
  writeCsv(rows);
  writeHtml(rows);
  return { csv: CSV_PATH, html: HTML_PATH, count: rows.length };
}

function readSessionSheet() {
  if (!fs.existsSync(CSV_PATH)) return null;
  const lines = fs
    .readFileSync(CSV_PATH, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] || "";
    });
    return row;
  });
}

function openFile(file) {
  const abs = path.resolve(file);
  if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", abs], { windowsHide: true });
  } else {
    execFile(process.platform === "darwin" ? "open" : "xdg-open", [abs]);
  }
}

function openSessionSheet() {
  if (!fs.existsSync(HTML_PATH)) writeSessionSheet([]);
  openFile(HTML_PATH);
}

function openSessionCsv() {
  if (!fs.existsSync(CSV_PATH)) writeSessionSheet([]);
  openFile(CSV_PATH);
}

module.exports = {
  UPDATES_DIR,
  CSV_PATH,
  HTML_PATH,
  writeSessionSheet,
  readSessionSheet,
  openSessionSheet,
  openSessionCsv,
};

// [sheet] recovery email
