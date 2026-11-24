import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const AAD = Buffer.from("zmusicstats/local-history-store/v1");
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const INFO_ISSUES = new Set(["GENRE_NOT_AVAILABLE", "DURATION_MAPPING_REQUIRED", "OFFICIAL_MONTH_DURATION_UNAVAILABLE"]);
const ACTIVE = new Set(["discovering", "running"]);
const clone = value => structuredClone(value);

function problem(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function currentMonth(now) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date(now));
  return `${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}`;
}

function periodFor(month) {
  const [year, index] = month.split("-").map(Number);
  return { start: `${month}-01`, end: `${month}-${new Date(Date.UTC(year, index, 0)).getUTCDate()}`, timeZone: "Asia/Shanghai" };
}

function samePeriod(actual, expected) {
  return actual?.start === expected.start && actual?.end === expected.end && actual?.timeZone === expected.timeZone;
}

function connectionHash(connection) {
  return createHash("sha256").update(JSON.stringify([connection.credential.kind, connection.credential.secret, connection.connectedAt])).digest("hex");
}

function sessionScope(session, now) {
  const connection = session?.connections?.netease;
  if (!/^[A-Za-z0-9_-]{43}$/.test(session?.id ?? "") || !(session.expiresAt > now) || !connection?.credential?.secret) return null;
  return { sessionId: session.id, connectionHash: connectionHash(connection), expiresAt: session.expiresAt };
}

function keyFor(scope, month) { return `${scope.sessionId}:${scope.connectionHash}:${month}`; }

function publicError(error) {
  const code = typeof error?.code === "string" && /^[A-Z_]{3,64}$/.test(error.code) ? error.code : "READ_FAILED";
  // Never pass through upstream URLs, credential-bearing exception text or arbitrary error details.
  const messages = {
    CONNECTION_EXPIRED: "账号连接已失效，请重新连接后继续读取。",
    UPSTREAM_TIMEOUT: "音乐平台响应超时，可稍后重试这个月份。",
    RATE_LIMITED: "音乐平台暂时限制读取，请稍后继续。",
    EMPTY_RESULT: "这个月份未返回可确认的听歌记录，不代表没有听歌。",
    PERIOD_MISMATCH: "返回数据的日期与所选月份不一致，未保存这份结果。",
    HISTORY_STORE_UNAVAILABLE: "历史记录暂时无法保存，本次导入已停止。",
  };
  return { code, message: messages[code] ?? "暂时无法读取这个月份，可稍后重试。" };
}

function inspectResult(month, result) {
  const platform = result?.platform;
  const period = periodFor(month);
  if (!platform || platform.id !== "netease" || !samePeriod(platform.period, period))
    throw problem("PERIOD_MISMATCH", "返回日期不匹配。");
  const issues = Array.isArray(result.issues) ? result.issues.filter(issue => issue && typeof issue.code === "string").map(issue => ({ provider: "netease", ...publicError(issue) })) : [];
  const hasTracks = samePeriod(platform.rankingPeriod, period) && Array.isArray(platform.tracks) && platform.tracks.length > 0;
  const hasDuration = platform.durationKind === "actual-total" && platform.coverageComplete === true && Number.isFinite(platform.listenSeconds) && platform.listenSeconds >= 0;
  if (!hasTracks && !hasDuration) {
    const issue = issues.find(item => !INFO_ISSUES.has(item.code));
    throw problem(issue?.code ?? "EMPTY_RESULT", issue?.message ?? "没有可确认的记录。");
  }
  const full = hasDuration && (hasTracks || platform.listenSeconds === 0) && samePeriod(platform.rankingPeriod, period) && !issues.some(issue => !INFO_ISSUES.has(issue.code));
  const retryable = issues.some(issue => !INFO_ISSUES.has(issue.code)) || (!hasTracks && platform.listenSeconds !== 0);
  // Preserve trusted adapter diagnostics in the report itself; public job errors stay sanitized.
  return { result: clone(result), full, retryable, issues };
}

/** A separate authenticated file shares the session key, with its own AAD and fresh random IVs. */
export function createEncryptedHistoryStore(filePath, { keyPath, now = Date.now } = {}) {
  const file = resolve(filePath);
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error("History store requires a private directory.");
  chmodSync(directory, 0o700);
  const secretPath = resolve(keyPath ?? join(directory, "session.key"));
  const privateFile = path => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("History store requires regular private files.");
    chmodSync(path, 0o600);
    return stat;
  };
  privateFile(secretPath);
  const secret = readFileSync(secretPath);
  if (secret.length !== 32) throw new Error("History store key is invalid.");
  if (existsSync(file)) privateFile(file);
  const clean = records => {
    if (!Array.isArray(records)) throw new Error("Invalid history records.");
    return records.filter(record => record && /^[A-Za-z0-9_-]{43}$/.test(record.sessionId ?? "")
      && /^[a-f0-9]{64}$/.test(record.connectionHash ?? "") && Number.isFinite(record.expiresAt)
      && record.expiresAt > now() && MONTH.test(record.month ?? "") && record.month < currentMonth(now())
      && typeof record.full === "boolean" && Number.isFinite(record.storedAt) && record.result?.platform?.id === "netease");
  };
  return {
    load() {
      if (!existsSync(file)) return [];
      try {
        if (privateFile(file).size > 128 * 1024 * 1024) throw new Error("History store is too large.");
        const envelope = JSON.parse(readFileSync(file, "utf8"));
        if (envelope.version !== 1) throw new Error("Unsupported history version.");
        const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(envelope.iv, "base64"));
        decipher.setAAD(AAD);
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
        try { return clean(JSON.parse(plaintext.toString("utf8"))); }
        finally { plaintext.fill(0); }
      } catch { throw new Error("Unable to restore encrypted listening history; existing data was preserved."); }
    },
    save(records) {
      const plaintext = Buffer.from(JSON.stringify(clean(records)));
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", secret, iv);
      cipher.setAAD(AAD);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      plaintext.fill(0);
      const envelope = JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
      const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        writeFileSync(temporary, envelope, { mode: 0o600, flag: "wx" });
        renameSync(temporary, file);
        chmodSync(file, 0o600);
      } catch {
        try { unlinkSync(temporary); } catch { /* Preserve the previous durable cache. */ }
        throw problem("HISTORY_STORE_UNAVAILABLE", "无法保存历史记录。");
      }
    },
  };
}

function boundedCall(operation, parentSignal, timeoutMs) {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", abort);
      fn(value);
    };
    const abort = () => { controller.abort(); finish(reject, problem("IMPORT_CANCELLED", "读取已取消。")); };
    const timer = setTimeout(() => { controller.abort(); finish(reject, problem("UPSTREAM_TIMEOUT", "读取超时。")); }, timeoutMs);
    parentSignal.addEventListener("abort", abort, { once: true });
    if (parentSignal.aborted) { abort(); return; }
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw problem("IMPORT_CANCELLED", "读取已取消。");
      return operation(controller.signal);
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

/** Session-scoped import jobs. Call clear on disconnect/account replacement and dispose on shutdown. */
export function createHistoryImporter({ discoverMonths, readMonth, storePath, sessionKeyPath, now = Date.now, concurrency = 2, timeoutMs = 75_000 } = {}) {
  if (typeof discoverMonths !== "function" || typeof readMonth !== "function") throw new Error("History import requires discovery and monthly readers.");
  const workerCount = Math.max(1, Math.min(2, Math.floor(concurrency) || 1));
  const store = storePath ? createEncryptedHistoryStore(storePath, { keyPath: sessionKeyPath, now }) : null;
  const cache = new Map((store?.load() ?? []).map(record => [keyFor(record, record.month), record]));
  const jobs = new Map();

  function persist() {
    for (const [key, record] of cache) if (record.expiresAt <= now()) cache.delete(key);
    store?.save([...cache.values()]);
  }
  function reports(session) {
    const scope = sessionScope(session, now());
    if (!scope) return [];
    return [...cache.values()].filter(record => record.sessionId === scope.sessionId && record.connectionHash === scope.connectionHash && record.expiresAt > now())
      .sort((a, b) => a.month.localeCompare(b.month)).map(({ month, result, full, storedAt }) => ({ month, result: clone(result), full, storedAt }));
  }
  function remember(session, month, result) {
    const scope = sessionScope(session, now());
    if (!scope || !MONTH.test(month) || month >= currentMonth(now())) return false;
    const inspected = inspectResult(month, result);
    const key = keyFor(scope, month);
    const previous = cache.get(key);
    // A transient partial response must not replace a previously complete month.
    if (previous?.full && !inspected.full) return true;
    cache.set(key, { ...scope, month, result: inspected.result, full: inspected.full, retryable: inspected.retryable, storedAt: now() });
    try { persist(); } catch (error) { if (previous) cache.set(key, previous); else cache.delete(key); throw error; }
    return true;
  }
  function valid(job) {
    const connection = job.session.connections.netease;
    return jobs.get(job.session.id) === job && job.session.version === job.version && job.session.expiresAt > now()
      && connection === job.connection && connectionHash(connection) === job.scope.connectionHash;
  }
  function stop(job, state = "cancelled", error) {
    job.state = state;
    job.error = error;
    job.finishedAt = now();
    job.controller.abort();
    for (const month of job.months) if (["queued", "reading"].includes(month.state)) month.state = "cancelled";
  }
  function status(session) {
    const scope = sessionScope(session, now());
    const job = jobs.get(session?.id);
    const matching = scope && job?.scope.connectionHash === scope.connectionHash;
    if (matching && ACTIVE.has(job.state) && !valid(job)) stop(job);
    const months = matching ? job.months : [];
    return clone({
      state: matching ? job.state : "idle",
      total: months.length,
      completed: months.filter(month => ["cached", "complete", "failed"].includes(month.state)).length,
      succeeded: months.filter(month => ["cached", "complete"].includes(month.state)).length,
      failed: months.filter(month => month.state === "failed").length,
      cached: months.filter(month => month.state === "cached").length,
      inFlight: months.filter(month => month.state === "reading").map(month => month.month),
      availableMonths: reports(session).map(record => record.month),
      months,
      discovery: matching ? job.discovery : null,
      startedAt: matching ? job.startedAt : null,
      finishedAt: matching ? job.finishedAt : null,
      ...(matching && job.error ? { error: job.error } : {}),
    });
  }
  async function run(job) {
    try {
      const savedMonths = job.refreshDuration ? reports(job.session).map(record => record.month) : null;
      const discovery = savedMonths
        ? { months: savedMonths, source: "cached-history", rangeVerified: false, years: [...new Set(savedMonths.map(month => Number(month.slice(0, 4))))] }
        : await boundedCall(signal => discoverMonths(job.session, signal), job.controller.signal, timeoutMs);
      if (!valid(job) || job.controller.signal.aborted) { if (ACTIVE.has(job.state)) stop(job); return; }
      if (!Array.isArray(discovery?.months)) throw problem("HISTORY_DIRECTORY_UNAVAILABLE", "无法确认历史月份范围。");
      job.discovery = {
        source: ["timedetail", "year-report", "cached-history"].includes(discovery.source) ? discovery.source : "candidate",
        rangeVerified: discovery.rangeVerified === true,
        years: [...new Set((discovery.years ?? []).filter(year => Number.isInteger(year) && year >= 2000 && year <= Number(currentMonth(now()).slice(0, 4))))].sort(),
      };
      job.months = [...new Set(discovery.months.filter(month => typeof month === "string" && MONTH.test(month) && month < currentMonth(now())))].sort().reverse()
        .map(month => {
          const cached = cache.get(keyFor(job.scope, month));
          const inspected = cached ? inspectResult(month, cached.result) : null;
          const platform = cached?.result?.platform;
          const hasDuration = platform?.durationKind === "actual-total" && platform.coverageComplete === true && Number.isFinite(platform.listenSeconds) && platform.listenSeconds >= 0;
          const skip = job.refreshDuration ? hasDuration : cached && !inspected.retryable;
          return { month, state: skip ? "cached" : "queued", full: cached?.full ?? false, issues: inspected?.issues ?? [] };
        });
      job.state = "running";
      let next = 0;
      const worker = async () => {
        while (valid(job) && !job.controller.signal.aborted) {
          const item = job.months[next++];
          if (!item) return;
          if (item.state === "cached") continue;
          item.state = "reading";
          try {
            const cached = job.refreshDuration ? cache.get(keyFor(job.scope, item.month))?.result : undefined;
            const result = await boundedCall(signal => readMonth(job.session, item.month, signal,
              { refreshDuration: job.refreshDuration, ...(cached ? { cached: clone(cached) } : {}) }), job.controller.signal, timeoutMs);
            if (!valid(job) || job.controller.signal.aborted) return;
            const inspected = inspectResult(item.month, result);
            remember(job.session, item.month, inspected.result);
            item.state = "complete";
            item.full = inspected.full;
            item.issues = inspected.issues;
          } catch (error) {
            if (!valid(job) || job.controller.signal.aborted) return;
            item.state = "failed";
            item.issues = [publicError(error)];
            if (["CONNECTION_EXPIRED", "HISTORY_STORE_UNAVAILABLE", "RATE_LIMITED"].includes(error?.code)) { stop(job, "failed", publicError(error)); return; }
          }
        }
      };
      await Promise.all(Array.from({ length: workerCount }, worker));
      if (ACTIVE.has(job.state)) {
        if (!valid(job) || job.controller.signal.aborted) stop(job);
        else { job.state = "complete"; job.finishedAt = now(); }
      }
    } catch (error) {
      if (ACTIVE.has(job.state)) stop(job, job.controller.signal.aborted || !valid(job) ? "cancelled" : "failed", job.controller.signal.aborted ? undefined : publicError(error));
    }
  }
  return {
    start(session, { refreshDuration = false } = {}) {
      const scope = sessionScope(session, now());
      if (!scope) throw problem("CONNECTION_EXPIRED", "请先连接网易云音乐账号。", 401);
      const previous = jobs.get(session.id);
      if (previous && ACTIVE.has(previous.state) && valid(previous)) return status(session);
      if (previous && ACTIVE.has(previous.state)) stop(previous);
      const job = { session, scope, connection: session.connections.netease, version: session.version, refreshDuration: refreshDuration === true, state: "discovering", months: [], discovery: null, startedAt: now(), finishedAt: null, controller: new AbortController() };
      jobs.set(session.id, job);
      void run(job);
      return status(session);
    },
    status,
    cancel(session) { const job = jobs.get(session?.id); if (job && ACTIVE.has(job.state)) stop(job); return status(session); },
    getCached(session, month) {
      const scope = sessionScope(session, now());
      const record = scope && cache.get(keyFor(scope, month));
      return record && record.expiresAt > now() ? clone(record.result) : null;
    },
    reports,
    remember,
    clear(sessionOrId) {
      const id = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
      const job = jobs.get(id);
      if (job) { stop(job); jobs.delete(id); }
      for (const [key, record] of cache) if (record.sessionId === id) cache.delete(key);
      persist();
    },
    dispose() { for (const job of jobs.values()) if (ACTIVE.has(job.state)) stop(job); },
  };
}
