const chalk = require("chalk");
const { version } = require("../package.json");

const mint = chalk.hex("#06b6d4"); // Cyan
const mute = chalk.hex("#475569"); // Slate
const ink = chalk.hex("#f8fafc"); // White
const dim = chalk.hex("#94a3b8"); // Light slate

function strip(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

function padVisible(line, width) {
  const extra = width - strip(line).length;
  return extra > 0 ? line + " ".repeat(extra) : line;
}

const ART = [
  "   ███████╗███╗   ███╗   ",
  "   ██╔════╝████╗ ████║   ",
  "   ███████╗██╔████╔██║   ",
  "   ╚════██║██║╚██╔╝██║   ",
  "   ███████║██║ ╚═╝ ██║   ",
  "   ╚══════╝╚═╝     ╚═╝   ",
];

function columns(left, right, gap = 6) {
  const width = Math.max(...left.map((l) => strip(l).length));
  const rows = Math.max(left.length, right.length);
  const out = [];
  for (let i = 0; i < rows; i++) {
    const L = padVisible(left[i] || "", width);
    const R = right[i] || "";
    out.push(`  ${L}${" ".repeat(gap)}${R}`);
  }
  return out;
}

function splash({ names = 0, saved = 0, open = 0, threads = 5, queued = 0 } = {}) {
  const right = [
    "",
    mint.bold("Session Manager Pro"),
    ink("Zendriver CDP Stealth Orchestrator"),
    mute(`v${version}`),
    "",
    mute("╭────────────────────────────────╮"),
    mute("│ ") + ink("Status") + mute("                         │"),
    mute("├────────────────────────────────┤"),
    mute("│ ") + dim("Names:    ") + ink(names.toString().padEnd(19)) + mute("│"),
    mute("│ ") + dim("Saved:    ") + ink(saved.toString().padEnd(19)) + mute("│"),
    mute("│ ") + dim("Threads:  ") + mint(`${open}/${threads}`.padEnd(19)) + mute("│"),
    mute("│ ") + dim("Queued:   ") + ink(queued.toString().padEnd(19)) + mute("│"),
    mute("╰────────────────────────────────╯"),
  ];
  console.log();
  for (const line of columns(ART.map((l) => mint(l)), right)) {
    console.log(line);
  }
  console.log();
}

function rule(label = "") {
  if (!label) return mute("  ────────────────────────────────────────");
  const dashCount = Math.max(2, 38 - strip(label).length);
  return mute(`  ── `) + ink.bold(label.toUpperCase()) + mute(` ${"─".repeat(dashCount)}`);
}

module.exports = { splash, mint, mute, ink, dim, rule, strip };
