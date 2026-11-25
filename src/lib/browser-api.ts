import { IS_BROWSER_STORAGE } from "./runtime-mode.ts";
import { indexedStore, type LocalStore } from "./browser-storage.ts";
import type { PlatformId, ReportInput } from "./report.ts";

type Provider = { id: PlatformId; connected: boolean; reportScope?: string; connectionId?: string; account?: { nickname: string } };
type Issue = { provider?: PlatformId; code: string; message: string };
type Report = { mode: "live"; input: ReportInput; issues: Issue[]; fetchedAt: string };
type Cached = { platform: ReportInput["platforms"][number]; issues: Issue[]; storedAt: number };
type MonthState = { month: string; state: string; full: boolean; issues: Issue[] };
type Job = { state: string; total: number; completed: number; succeeded: number; failed: number; cached: number; inFlight: string[]; availableMonths: string[]; months: MonthState[]; finishedAt?: number; error?: Issue };
const informational = new Set(["GENRE_NOT_AVAILABLE", "DURATION_MAPPING_REQUIRED", "OFFICIAL_MONTH_DURATION_UNAVAILABLE", "APPLE_RECENT_NOT_PERIOD"]);
const monthValid = (value: unknown): value is string => typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
const json = (value: unknown, status = 200) => Response.json(value, { status });
const blankJob = (): Job => ({ state: "idle", total: 0, completed: 0, succeeded: 0, failed: 0, cached: 0, inFlight: [], availableMonths: [], months: [] });
const period = (month: string) => ({ start: `${month}-01`, end: `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()}`, timeZone: "Asia/Shanghai" });

export function createBrowserApi({ store, nativeFetch = fetch, now = Date.now }: { store: LocalStore; nativeFetch?: typeof fetch; now?: () => number }) {
  let providers: Provider[] | null = null, job = blankJob(), controller: AbortController | undefined, jobScope = "", generation = 0;
  const reportKey = (provider: Provider, month = "") => `report:${provider.reportScope ?? provider.connectionId}:${provider.id}:${month}`;
  const refresh = async () => {
    const response = await nativeFetch("/api/connections");
    if (!response.ok) throw Error("CONNECTION_EXPIRED");
    const data = await response.json(); providers = data.providers;
    return data;
  };
  const currentProviders = async () => { if (!providers) await refresh(); return providers!.filter(p => p.connected && (p.reportScope || p.connectionId)); };
  async function archive() {
    const provider = (await currentProviders()).find(p => p.id === "netease");
    if (!provider) return { inputs: [], months: [], issues: [] };
    const saved = await store.entries<Cached>(reportKey(provider));
    saved.sort(([a], [b]) => a.localeCompare(b));
    return { inputs: saved.map(([, record]) => ({ mode: "live", period: record.platform.period, expectedPlatforms: ["netease"], platforms: [record.platform] })),
      months: saved.map(([key]) => key.slice(-7)), issues: saved.flatMap(([key, record]) => record.issues.map(issue => ({ ...issue, month: key.slice(-7) }))) };
  }
  async function readReport(url: URL, init?: RequestInit) {
    const month = url.searchParams.get("month"); if (!monthValid(month)) return json({ error: { code: "INVALID_MONTH" } }, 400);
    const selected = (await currentProviders()).filter(p => !url.searchParams.has("providers") || url.searchParams.get("providers")!.split(",").includes(p.id));
    if (!selected.length) return json({ error: { code: "NOT_CONNECTED" } }, 401);
    const revision = generation, platforms: ReportInput["platforms"] = [], issues: Issue[] = [], missing: Provider[] = [];
    for (const provider of selected) {
      const cached = await store.get<Cached>(reportKey(provider, month));
      const immutable = month < new Date(now()).toISOString().slice(0, 7) && provider.id !== "apple";
      if (cached && url.searchParams.get("refresh") !== "true" && (immutable || now() - cached.storedAt < 5 * 60_000) && cached.issues.every(issue => informational.has(issue.code))) { platforms.push(cached.platform); issues.push(...cached.issues); }
      else missing.push(provider);
    }
    let fetchedAt = new Date(now()).toISOString();
    if (missing.length) {
      const response = await nativeFetch(`/api/report?month=${month}&providers=${missing.map(p => p.id).join(",")}`, init);
      if (!response.ok) return response;
      const result = await response.json() as Report;
      if (generation !== revision || init?.signal?.aborted) throw Error("CONNECTION_CHANGED");
      const expected = period(month);
      if (result.input?.mode !== "live" || result.input.period?.start !== expected.start || result.input.period?.end !== expected.end || !Array.isArray(result.input.platforms)) throw Error("REPORT_INVALID");
      for (const platform of result.input.platforms) {
        const provider = missing.find(p => p.id === platform.id);
        if (!provider || !Array.isArray(platform.tracks)) throw Error("REPORT_INVALID");
        const sourceIssues = (result.issues ?? []).filter(issue => issue.provider === provider.id);
        if (platform.tracks.length || typeof platform.listenSeconds === "number") await store.set(reportKey(provider, month), { platform, issues: sourceIssues, storedAt: now() });
        platforms.push(platform);
      }
      issues.push(...(result.issues ?? [])); fetchedAt = result.fetchedAt;
    }
    return json({ mode: "live", input: { mode: "live", period: period(month), platforms, expectedPlatforms: selected.map(p => p.id) }, issues, fetchedAt });
  }
  const summarize = () => {
    job.total = job.months.length; job.completed = job.months.filter(m => ["complete", "cached", "failed"].includes(m.state)).length;
    job.succeeded = job.months.filter(m => ["complete", "cached"].includes(m.state)).length; job.failed = job.months.filter(m => m.state === "failed").length;
    job.cached = job.months.filter(m => m.state === "cached").length; job.inFlight = job.months.filter(m => m.state === "reading").map(m => m.month);
    job.availableMonths = job.months.filter(m => ["complete", "cached"].includes(m.state)).map(m => m.month);
    return job;
  };
  async function importHistory(scope: string, signal: AbortSignal, revision: number) {
    const active = () => !signal.aborted && revision === generation && scope === jobScope;
    const save = async () => { if (active()) await store.set(`job:${scope}`, summarize()); };
    try {
      const response = await nativeFetch("/api/history/netease/months", { signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]) });
      const directory = await response.json(); if (!response.ok) throw Error(directory.error?.code ?? "HISTORY_DIRECTORY_UNAVAILABLE");
      if (!active()) return;
      if (!Array.isArray(directory.months) || !directory.months.every(monthValid)) throw Error("HISTORY_DIRECTORY_INVALID");
      const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date(now()));
      job.months = [...new Set<string>(directory.months)].filter(month => month < current).sort().reverse().map(month => ({ month, state: "queued", full: false, issues: [] }));
      job.state = "running"; await save();
      // Browser owns the queue. Each request is bounded; closing this tab stops new work.
      for (const item of job.months) {
        if (!active()) return;
        item.state = "reading"; await save();
        try {
          let response: Response | undefined;
          for (let attempt = 0; attempt < 14; attempt++) {
            response = await readReport(new URL(`/api/report?month=${item.month}&providers=netease`, "https://local.invalid"), { signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]) });
            if (response.status !== 429) break;
            await new Promise<void>((resolve, reject) => { const done = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(); }; const abort = () => { done(); reject(Error("IMPORT_CANCELLED")); }; const timer = setTimeout(done, 5000); signal.addEventListener("abort", abort, { once: true }); });
          }
          const data = await response!.json() as Report & { error?: { code: string } };
          if (!active()) return;
          if (!response!.ok) throw Error(data.error?.code ?? "READ_FAILED");
          const platform = data.input.platforms.find(p => p.id === "netease");
          item.issues = data.issues;
          if (!platform || (!platform.tracks.length && typeof platform.listenSeconds !== "number")) throw Error(data.issues.find(i => !informational.has(i.code))?.code ?? "EMPTY_RESULT");
          item.state = "complete"; item.full = !data.issues.some(i => !informational.has(i.code));
        } catch (error) {
          if (!active()) return;
          item.state = "failed"; item.issues = [{ code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "READ_FAILED", message: "这个月份尚未读完，可继续重试。" }];
          if (["CONNECTION_EXPIRED", "NOT_CONNECTED", "BROWSER_STORAGE_UNAVAILABLE"].includes(item.issues[0].code)) throw error;
        }
        await save();
      }
      job.state = "complete"; job.finishedAt = now(); await save();
    } catch (error) {
      if (!active()) return;
      job.state = "failed"; job.error = { code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "READ_FAILED", message: "历史读取已暂停，请检查连接后继续。" };
      job.finishedAt = now(); await save().catch(() => {});
    }
  }
  return async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
    try {
      const url = new URL(input, "https://local.invalid"), method = init?.method ?? "GET";
      if (url.pathname === "/api/report") return await readReport(url, init);
      if (url.pathname === "/api/history/netease/reports") return json(await archive());
      if (url.pathname === "/api/history/netease") {
        const provider = (await currentProviders()).find(p => p.id === "netease"), scope = provider?.reportScope ?? provider?.connectionId;
        if (!scope) return method === "GET" ? json({ job: blankJob() }) : json({ error: { code: "NOT_CONNECTED" } }, 401);
        if (scope !== jobScope) {
          controller?.abort(); jobScope = scope; job = await store.get<Job>(`job:${scope}`) ?? blankJob();
          if (["running", "discovering"].includes(job.state)) { job.state = "cancelled"; job.months.forEach(m => { if (["queued", "reading"].includes(m.state)) m.state = "cancelled"; }); }
        }
        if (method === "POST" && !["running", "discovering"].includes(job.state)) {
          job = { ...blankJob(), state: "discovering" }; controller = new AbortController();
          await store.set(`job:${scope}`, job);
          void importHistory(scope, controller.signal, generation);
        }
        if (method === "DELETE") { controller?.abort(); job.state = "cancelled"; job.months.forEach(m => { if (["queued", "reading"].includes(m.state)) m.state = "cancelled"; }); await store.set(`job:${scope}`, summarize()); }
        return json({ job: summarize() });
      }
      if (url.pathname === "/api/metadata" && method === "POST") {
        const { tracks } = JSON.parse(String(init?.body)), items = [], missing = [];
        for (const track of tracks) { const cached = await store.get<{ complete?: boolean }>(`metadata:${track.provider}:${track.id}`); if (cached?.complete) items.push(cached); else missing.push(track); }
        if (missing.length) {
          const response = await nativeFetch(input, { ...init, body: JSON.stringify({ tracks: missing }) }); if (!response.ok) return response;
          const data = await response.json();
          for (const item of data.items ?? []) { if (!missing.some(t => t.provider === item.provider && t.id === item.id)) continue; await store.set(`metadata:${item.provider}:${item.id}`, item); items.push(item); }
        }
        return json({ items });
      }
      const response = await nativeFetch(input, init);
      if (url.pathname === "/api/connections" && response.ok) {
        const data = await response.clone().json();
        const previous = providers?.map(p => `${p.id}:${p.connectionId}`).join();
        if (previous && previous !== data.providers.map((p: Provider) => `${p.id}:${p.connectionId}`).join()) { generation++; controller?.abort(); }
        providers = data.providers;
        const connected = providers!.filter(p => p.connected && (p.reportScope || p.connectionId));
        if (connected.length) await store.set("settings:last-providers", connected);
      }
      if (method === "DELETE" && url.pathname.startsWith("/api/connections/") && response.ok) { generation++; controller?.abort(); providers = null; job = blankJob(); jobScope = ""; }
      return response;
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      const code = error instanceof Error && /^[A-Z_]{3,64}$/.test(error.message) ? error.message : "NETWORK_ERROR";
      return json({ error: { code, message: code === "BROWSER_STORAGE_UNAVAILABLE" ? "浏览器无法保存报告，请检查隐私模式或存储空间后重试。" : "本次读取尚未完成，请重试。" } }, code === "CONNECTION_EXPIRED" ? 401 : 503);
    }
  };
}

const browserStore = indexedStore();
export const clearLocalReports = () => browserStore.clear();
export async function savedBrowserReports(): Promise<ReportInput[]> {
  const profiles = await browserStore.get<Provider[]>("settings:last-providers") ?? [];
  const byMonth = new Map<string, ReportInput>();
  for (const provider of profiles) {
    const entries = await browserStore.entries<Cached>(`report:${provider.reportScope ?? provider.connectionId}:${provider.id}:`);
    for (const [, record] of entries) {
      const platform = structuredClone(record.platform), month = platform.period?.start?.slice(0, 7);
      if (!monthValid(month)) continue;
      for (const track of platform.tracks) {
        const metadata = await browserStore.get<{ artworkUrl?: string; durationSeconds?: number; genres?: string[]; genreSource?: string; complete?: boolean }>(`metadata:${provider.id}:${track.id}`);
        if (metadata) Object.assign(track, { ...(metadata.artworkUrl ? { artworkUrl: metadata.artworkUrl } : {}), ...(metadata.genres?.length ? { genres: metadata.genres, genreSource: metadata.genreSource } : {}), ...(metadata.durationSeconds ? { durationSeconds: metadata.durationSeconds } : {}), genreLookupComplete: metadata.complete === true });
      }
      const input = byMonth.get(month) ?? { mode: "live", period: period(month), expectedPlatforms: [], platforms: [] };
      input.platforms.push(platform); input.expectedPlatforms!.push(platform.id); byMonth.set(month, input);
    }
  }
  return [...byMonth.values()].sort((a, b) => a.period.start.localeCompare(b.period.start));
}
const localFetch = createBrowserApi({ store: browserStore });
export const apiFetch = (input: string, init?: RequestInit) => IS_BROWSER_STORAGE ? localFetch(input, init) : fetch(input, init);
