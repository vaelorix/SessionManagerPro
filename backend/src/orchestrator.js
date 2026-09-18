const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const {
  ensureSessions,
  openSession,
  getSession,
  saveSessionPatch,
} = require("./manager");

class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this.live = new Map(); // id -> { id, handle, startedAt, url }
    this.queue = [];
    this.threadLimit = 5;
    this.defaultUrl = "";
    this.filling = false;
    this.stopping = false;
    this.logs = [];
    this.maxLogs = 500;
    this.logCounter = 0;
    this.sessionLaunchOpts = new Map();

    // Point to root updates folder
    this.updatesDir = path.resolve(__dirname, "..", "..", "updates");
    this.logFilePath = path.join(this.updatesDir, "session_status.log");
  }

  log(level, category, message, sessionId = null) {
    const entry = {
      id: ++this.logCounter,
      timestamp: new Date().toISOString(),
      level, // 'info' | 'success' | 'warn' | 'error'
      category, // 'SESSION' | 'PROXY' | 'FINGERPRINT' | 'BROWSER' | 'QUEUE' | 'COOKIE'
      message,
      sessionId,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.emit("log", entry);

    try {
      if (!fs.existsSync(this.updatesDir)) {
        fs.mkdirSync(this.updatesDir, { recursive: true });
      }
      fs.appendFileSync(
        this.logFilePath,
        `[${entry.timestamp}] [${entry.category}] ${sessionId ? `${sessionId} : ` : ""}${entry.level.toUpperCase()} : ${entry.message}\n`
      );
    } catch {
      // ignore write errors
    }
    return entry;
  }

  getLogs(limit = 100) {
    return this.logs.slice(-Math.min(limit, this.logs.length));
  }

  getStatus() {
    const liveSessions = [];
    for (const [id, item] of this.live.entries()) {
      const s = getSession(id);
      liveSessions.push({
        id,
        startedAt: item.startedAt,
        url: item.url,
        proxy: s?.proxy,
        fingerprintFile: s?.fingerprintFile,
      });
    }
    return {
      live: liveSessions,
      queued: [...this.queue],
      threadLimit: this.threadLimit,
      defaultUrl: this.defaultUrl,
      activeCount: this.live.size,
      queuedCount: this.queue.length,
      isFilling: this.filling,
    };
  }

  async markResult(id, status, reason) {
    try {
      await saveSessionPatch(id, {
        lastResult: { status, reason, at: new Date().toISOString() },
      });
      this.emit("session:update", { id, status, reason });
    } catch (err) {
      // ignore patch errors on deleted sessions
    }
  }

  watchHandle(handle, url) {
    handle.closedByUser = false;
    handle.error = null;

    const flag = (why) => {
      if (!handle.error) handle.error = why;
    };

    handle.on("error", (err) => {
      const msg = err?.message || String(err);
      flag(msg);
      this.log("error", "BROWSER", `Browser worker error in ${handle.id}: ${msg}`, handle.id);
    });

    const proc = handle.process || (typeof handle.browser?.process === "function" ? handle.browser.process() : null);
    if (proc) {
      proc.on("exit", (code, signal) => {
        if (code && code !== 0) {
          flag(`Worker exit code ${code}${signal ? ` ${signal}` : ""}`);
        }
      });
    }

    const emitter = typeof handle.once === "function" ? handle : handle.browser;
    emitter.once("disconnected", async (reasonMsg) => {
      this.live.delete(handle.id);
      let status, reason;
      if (handle.closedByUser || reasonMsg === "closed by user" || reasonMsg === "browser closed") {
        status = "success";
        reason = "closed by user";
      } else if (handle.error) {
        status = "error";
        reason = handle.error;
      } else {
        status = "success";
        reason = reasonMsg || "browser terminated normally";
      }

      await this.markResult(handle.id, status, reason);
      this.log(
        status === "error" ? "error" : "success",
        "SESSION",
        `Session finished: ${status} (${reason})`,
        handle.id
      );
      this.emit("pool:update", this.getStatus());

      // Auto refill the pool with next queued item
      this.fillPool();
    });
  }

  async startOne(name, customUrl = null) {
    try {
      this.log("info", "QUEUE", `Initializing session: ${name}`, name);
      await ensureSessions([name]);
      const rec = getSession(name);

      if (rec?.proxy?.host) {
        this.log(
          "info",
          "PROXY",
          `Assigned sticky proxy: ${rec.proxy.host}:${rec.proxy.port}${rec.proxy.username ? " (authenticated)" : ""}`,
          name
        );
      } else {
        this.log("warn", "PROXY", "No proxy attached or direct connection", name);
      }

      const vp = rec?.fingerprint?.viewport || {};
      this.log(
        "info",
        "FINGERPRINT",
        `Applied fingerprint: ${rec?.fingerprintFile || "Bayesian Profile"} (Chromium Stealth, seed: ${rec?.seed || "auto"}, ${vp.width || 1920}x${vp.height || 1080}, TZ: ${rec?.fingerprint?.timezone || "auto"})`,
        name
      );

      await this.markResult(name, "running", "launching zendriver browser");
      const launchOpts = this.sessionLaunchOpts.get(name) || {};
      this.sessionLaunchOpts.delete(name);
      const url = customUrl || launchOpts.url || this.defaultUrl || undefined;
      const handle = await openSession(name, { url, ...launchOpts });

      this.watchHandle(handle, url);
      this.live.set(name, {
        id: name,
        handle,
        startedAt: new Date().toISOString(),
        url: url || "restore tabs",
      });

      this.log(
        "success",
        "BROWSER",
        `Zendriver Chromium window opened successfully (${this.live.size}/${this.threadLimit} live)`,
        name
      );
      this.emit("pool:update", this.getStatus());
    } catch (err) {
      const reason = err.message || String(err);
      this.log("error", "SESSION", `Failed to launch ${name}: ${reason}`, name);
      await this.markResult(name, "error", reason);
      this.emit("pool:update", this.getStatus());
    }
  }

  async fillPool() {
    if (this.stopping || this.filling) return;
    this.filling = true;
    try {
      const jobs = [];
      while (this.live.size + jobs.length < this.threadLimit && this.queue.length) {
        const name = this.queue.shift();
        if (!name || this.live.has(name)) continue;
        jobs.push(this.startOne(name));
        if (this.live.size + jobs.length < this.threadLimit && this.queue.length) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      this.emit("pool:update", this.getStatus());
      await Promise.all(jobs);
    } finally {
      this.filling = false;
      if (!this.stopping && this.live.size < this.threadLimit && this.queue.length) {
        this.fillPool();
      }
    }
  }

  async launch(names, opts = {}) {
    const list = [...new Set(names)].filter(
      (n) => n && !this.live.has(n) && !this.queue.includes(n)
    );
    if (!list.length) return false;

    if (opts.threads && Number(opts.threads) > 0) {
      this.threadLimit = Number(opts.threads);
    }
    if (opts.url !== undefined) {
      this.defaultUrl = String(opts.url).trim();
    }

    for (const n of list) {
      this.sessionLaunchOpts.set(n, opts);
    }

    this.queue.push(...list);
    this.log(
      "info",
      "QUEUE",
      `Queued ${list.length} sessions (Thread cap: ${this.threadLimit})`
    );
    this.emit("pool:update", this.getStatus());

    this.fillPool();
    return true;
  }

  async stop(id) {
    const item = this.live.get(id);
    if (!item) {
      // Remove from queue if present
      const qIdx = this.queue.indexOf(id);
      if (qIdx >= 0) {
        this.queue.splice(qIdx, 1);
        this.log("info", "QUEUE", `Removed from queue: ${id}`, id);
        this.emit("pool:update", this.getStatus());
        return true;
      }
      return false;
    }
    this.log("info", "BROWSER", `Closing browser window for ${id}...`, id);
    item.handle.closedByUser = true;
    try {
      await item.handle.close();
    } catch {
      // browser may already be closing
    }
    return true;
  }

  async stopAll() {
    this.stopping = true;
    this.queue = [];
    this.log("warn", "QUEUE", "Stopping all running browsers and clearing queue");
    const handles = [...this.live.values()];
    for (const item of handles) {
      item.handle.closedByUser = true;
      try {
        await item.handle.close();
      } catch {}
    }
    this.live.clear();
    this.stopping = false;
    this.emit("pool:update", this.getStatus());
    return true;
  }
}

const orchestrator = new Orchestrator();
module.exports = orchestrator;
