import { apiFetch, savedBrowserReports, clearLocalReports } from "./lib/browser-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Plus,
  Disc3,
  Download,
  ChevronDown,
  SlidersHorizontal,
  Search,
  Info,
  X,
  Check,
  Layers,
  Link2,
  Mail,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getDemoInput } from "./lib/demo-data";
import {
  type MusicReport,
  type RankedTrack,
  type PlatformId,
  type ReportInput,
} from "./lib/report";
import { copy, type Language } from "./lib/i18n";
import { IS_BROWSER_STORAGE, IS_UI_PREVIEW, UI_PREVIEW_LABEL, UI_PREVIEW_CONNECTION_REASON } from "./lib/runtime-mode";
import { Record } from "./components/Record";
import { Modal } from "./components/Modal";
import { Connections } from "./components/Connections";
import { PosterDialog } from "./components/PosterDialog";
import { MonthPicker } from "./components/MonthPicker";
import { HistoryImport } from "./components/HistoryImport";
import { GenreDonut } from "./components/GenreDonut";
import { PlatformDonut } from "./components/PlatformDonut";
import { PlatformIcon } from "./components/PlatformIcon";
import { TrackDetails } from "./components/TrackDetails";
import { ReportLoading } from "./components/ReportLoading";
import { ReadStatus } from "./components/ReadStatus";
import { OverviewNavigator } from "./components/OverviewNavigator";
import { PeriodWelcome } from "./components/PeriodWelcome";
import { ListeningTimeValue, TimePerspective } from "./components/TimePerspective";
import { resolveReportListeningTime } from "./lib/listening-time";
import { buildMusicPersona } from "./lib/music-persona";
import { useReportSlides } from "./lib/use-report-slides";
import { connectionErrorMessage, connectionResponseError } from "./lib/connection-errors";
import { unifiedTracks, knownGenreDistribution } from "./lib/unified-tracks";
import { crossPlatformMatches } from "./lib/cross-platform";
import { buildTrackHistory, withTrackHistory } from "./lib/track-history";
import { mergeMonthlyInputs } from "./lib/months";
import "./components/tracks.css";
import "./components/connection-welcome.css";

type Filter = "all" | PlatformId;

const PERSONAL_MONTHS_KEY = "zmusicstats-personal-months";
const PERIOD_PENDING_KEY = "zmusicstats-period-pending";
const INCOMPLETE_READ_CODES = new Set(["READ_FAILED","UPSTREAM_TIMEOUT","UPSTREAM_UNAVAILABLE","UPSTREAM_REJECTED","UPSTREAM_INVALID_RESPONSE","RATE_LIMITED","CONNECTION_EXPIRED","PERIOD_MISMATCH","PERIOD_UNCONFIRMED","TOP_RANK_PARTIAL"]);

function mergeMonthSnapshot(previous: ReportInput | undefined, incoming: ReportInput): ReportInput {
  if (!previous || previous.mode !== incoming.mode || previous.period.start !== incoming.period.start) return incoming;
  const platforms = new Map(previous.platforms.map(platform => [platform.id, platform]));
  for (const platform of incoming.platforms) platforms.set(platform.id, platform);
  return {...incoming,platforms:[...platforms.values()],expectedPlatforms:[...new Set([...(previous.expectedPlatforms ?? []),...(incoming.expectedPlatforms ?? [])])]};
}

function rememberedMonths(): string[] {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const currentMonth = `${year}-${String(month).padStart(2, "0")}`;
  const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PERSONAL_MONTHS_KEY) ?? "null");
    if (Array.isArray(saved)) {
      const months = [...new Set(saved.filter((value): value is string => typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) && value <= currentMonth))].sort();
      if (months.length) return months;
    }
  } catch { /* Storage is optional. */ }
  return [previousMonth];
}

function Cover({ index, title, artworkUrl }: { index: number; title: string; artworkUrl?: string }) {
  const [failedUrl, setFailedUrl] = useState("");
  return (
    <div className={`album-cover cover-${index % 8}`} aria-hidden="true">
      <div className="cover-shape" />
      <span>{title.slice(0, 1)}</span>
      {artworkUrl && artworkUrl !== failedUrl && <img src={artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(artworkUrl)} />}
    </div>
  );
}

function TrackRows({
  tracks,
  language,
  limit,
  numbered = true,
}: {
  tracks: RankedTrack[];
  language: Language;
  limit?: number;
  numbered?: boolean;
}) {
  const t = copy[language];
  return (
    <div className="track-list detailed-tracks">
      <div className="track-table-head">
        <span>{t.song}</span>
        <span>{t.plays}</span>
        <span>{language === "zh" ? "详情" : "Info"}</span>
        <span>{language === "zh" ? "歌长" : "Length"}</span>
        <span>{language === "zh" ? "平台" : "Platform"}</span>
      </div>
      {tracks.slice(0, limit ?? tracks.length).map((track, index) => (
        <motion.div
          className={`track-row track-source-${track.platforms.length === 1 ? track.platforms[0] : "mixed"}`}
          key={`${track.id}-${track.platforms.join()}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.035 }}
        >
          <span className="track-rank">
            {numbered ? String(track.rank).padStart(2, "0") : "·"}
          </span>
          <Cover index={track.coverIndex} title={track.title} artworkUrl={track.artworkUrl} />
          <div className="track-title">
            <strong>{track.title}</strong>
            <span>{track.artist}</span>
          </div>
          <span className="track-count">
            {track.count === null ? (
              "—"
            ) : (
              <>
                {track.countIsPartial && <small>≥</small>}
                {track.count}
                <small>{t.playsShort}</small>
              </>
            )}
          </span>
          <TrackDetails track={track} language={language} />
          <span className="track-duration" title={language === "zh" ? "单首歌曲长度" : "Song length"}>
            {typeof track.durationSeconds === "number" && Number.isFinite(track.durationSeconds) && track.durationSeconds > 0
              ? `${Math.floor(track.durationSeconds / 60)}:${String(Math.floor(track.durationSeconds % 60)).padStart(2, "0")}` : "—"}
          </span>
          <span className="track-platforms">
            {track.platforms.map((p) => (
              <span key={p} className={`source-badge ${p}`} title={t[p]}>
                <PlatformIcon platform={p} size={22} />
              </span>
            ))}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function GenrePanel({
  report,
  language,
  expanded = false,
  metadataStatus = "",
  onRetryMetadata,
  onExplore,
}: {
  report: MusicReport;
  language: Language;
  expanded?: boolean;
  metadataStatus?: string;
  onRetryMetadata?: () => void;
  onExplore?: () => void;
}) {
  const t = copy[language];
  const allTracks = unifiedTracks(report).tracks;
  const frequentTracks = allTracks.filter(track => typeof track.count === "number" && track.count > 10);
  const timeTracks = report.platforms.filter(platform => platform.rankingMatchesPeriod && platform.rankingCoverage !== "undated").flatMap(platform => {
    const seen = new Set<string>();
    return platform.tracks.filter(track => {
      const key = track.canonicalId || track.id;
      if (seen.has(key) || typeof track.count !== "number" || track.count <= 10) return false;
      seen.add(key); return true;
    });
  });
  const recognized = knownGenreDistribution(allTracks);
  const available = recognized.genres;
  const noVerifiedGenre = frequentTracks.filter(track=>track.genreLookupComplete && !track.genres.some(genre=>genre.trim()&&!['unknown','未识别'].includes(genre.toLowerCase()))).length;
  const scope = recognized.notice;

  return (
    <section
      className={`genre-panel ${expanded ? "genre-expanded" : ""}`}
      id="report-palette" tabIndex={-1} data-report-slide
      aria-label={t.genreDistribution}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE SOUND OF YOU</span>
          <h2>{t.tasteTitle}</h2>
        </div>
        <span className="small-disc" aria-hidden="true" />
      </div>
      {metadataStatus && <p className="genre-loading" role="status">{metadataStatus}</p>}
      <GenreDonut genres={available} language={language} known={recognized.known} total={recognized.total} tracks={frequentTracks} timeTracks={timeTracks} showTrackDetails={expanded} />
      {!expanded && onExplore && <button className="genre-explore-link" onClick={onExplore}>
        <span>{language === "zh" ? "想看每种曲风里，你最常听哪些歌？" : "Which songs define each of your genres?"}<strong>{language === "zh" ? "前往曲风偏好，探索歌曲与播放次数" : "Explore songs and play counts in Your Taste"}</strong></span><ChevronRight size={18} />
      </button>}
      <details className="genre-method-notes"><summary>{language === "zh" ? "统计规则与数据说明" : "Method & data notes"}</summary><p className="scope-note genre-rules">{scope[language]}</p>
      {noVerifiedGenre > 0 && <p className="scope-note">{language === "zh" ? `${noVerifiedGenre} 首已查完资料，暂无可核实的曲风标签，暂不计入饼图。` : `${noVerifiedGenre} tracks have completed lookups without a verifiable genre tag and are excluded from this chart.`}</p>}
      {onRetryMetadata && <button className="text-button" onClick={onRetryMetadata}>{language === "zh" ? "重新补全曲风与封面" : "Refresh genres and covers"}</button>}</details>
    </section>
  );
}

export default function App() {
  const [hasSavedReports, setHasSavedReports] = useState(false);
  const [viewingSaved, setViewingSaved] = useState(false);
  useEffect(() => { if (IS_BROWSER_STORAGE) void savedBrowserReports().then(inputs => setHasSavedReports(inputs.length > 0)).catch(() => {}); }, []);
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem("zmusicstats-language") === "en"
        ? "en"
        : "zh";
    } catch {
      return "zh";
    }
  });
  const [selectedMonths, setSelectedMonths] = useState(["2026-10"]);
  const [entry, setEntry] = useState<"checking" | "connections" | "period" | "report">(IS_UI_PREVIEW ? "connections" : "checking");
  useEffect(() => { window.scrollTo({top:0,behavior:"instant"}); },[entry]);
  const [connectedProviders, setConnectedProviders] = useState<PlatformId[]>([]);
  const [rankingMode, setRankingMode] = useState("5");
  const [rankingInput, setRankingInput] = useState("30");
  const rankingScroll = useRef<HTMLDivElement>(null);
  const [monthlyInputs, setMonthlyInputs] = useState<ReportInput[]>(() => [getDemoInput("2026-10")]);
  const [historyInputs, setHistoryInputs] = useState<ReportInput[]>([]);
  const [readIssues, setReadIssues] = useState<{month: string; provider?: PlatformId; code: string; message: string}[]>([]);
  const [syncProgress, setSyncProgress] = useState("");
  const [syncCounts, setSyncCounts] = useState({done:0,total:0});
  const [metadataProgress, setMetadataProgress] = useState<{done:number;total:number;state:"idle"|"loading"|"done"|"error"}>({done:0,total:0,state:"idle"});
  const [reportReady,setReportReady] = useState(true);
  const [allowPartial,setAllowPartial] = useState(false);
  const [awaitingHistory,setAwaitingHistory] = useState(false);
  const [historyActive,setHistoryActive] = useState(false);
  const [ingestionError,setIngestionError] = useState("");
  const [connectingProvider,setConnectingProvider] = useState<PlatformId|undefined>();
  const [historyProgress,setHistoryProgress] = useState({completed:0,total:0,detail:""});
  const metadataAttempted = useRef(new Set<string>());
  const metadataCache = useRef(new Map<string,{artworkUrl?:string;genres?:string[];genreSource?:string;durationSeconds?:number;complete?:boolean}>());
  const withMetadata = (inputs: ReportInput[]) => inputs.map(input => input.mode !== "live" ? input : {...input,platforms:input.platforms.map(platform=>({...platform,tracks:platform.tracks.map(track=>{
    const metadata=metadataCache.current.get(`${platform.id}:${track.id}`);
    return metadata ? {...track,genreLookupComplete:metadata.complete===true,...(metadata.artworkUrl?{artworkUrl:metadata.artworkUrl}:{}),...(metadata.durationSeconds?{durationSeconds:metadata.durationSeconds}:{}),...(metadata.genres?.length?{genres:metadata.genres,genreSource:metadata.genreSource}:{})} : track;
  })}))});
  const [metadataRevision,setMetadataRevision] = useState(0);
  const month = selectedMonths.join(" / ");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [trackPage, setTrackPage] = useState(1);
  const [modal, setModal] = useState<"connections" | "poster" | "info" | "privacy" | "months" | null>(
    null,
  );
  const [toast, setToast] = useState("");
  const [connectionTab, setConnectionTab] = useState<"connections"|"history">("connections");
  const [syncing, setSyncing] = useState(false);
  const liveRequest = useRef(0);
  const liveController = useRef<AbortController | null>(null);
  const restorationController = useRef<AbortController | null>(null);
  const restorationRequest = useRef<number | null>(null);
  const connectionRequest = useRef(0);
  const connectionController = useRef<AbortController | null>(null);
  const finishHistoryWithSync = useRef(false);
  const cancelConnectionRead = () => { connectionRequest.current++; connectionController.current?.abort(); connectionController.current=null; finishHistoryWithSync.current=false; };
  useEffect(() => () => { liveRequest.current++; liveController.current?.abort(); connectionRequest.current++; connectionController.current?.abort(); }, []);
  const merged = useMemo(() => mergeMonthlyInputs(monthlyInputs, selectedMonths), [monthlyInputs, selectedMonths]);
  const trackHistory = useMemo(() => buildTrackHistory(merged.report.mode === "demo" ? monthlyInputs : [...historyInputs,...monthlyInputs]), [historyInputs,monthlyInputs,merged.report.mode]);
  const report = useMemo(() => {
    const base = merged.report;
    const list = unifiedTracks(base);
    const palette = knownGenreDistribution(list.tracks);
    const leading = palette.genres[0];
    return {...base, tracks:withTrackHistory(list.tracks,trackHistory), overlappingTracks:withTrackHistory(crossPlatformMatches(base),trackHistory), rankingMode:"combined" as const, rankingNotice:list.notice,
      genres:palette.genres,genreScope:palette.notice,
      insights:leading ? [{id:"known-music-palette",title:{zh:`${leading.nameZh}，是这一期的底色。`,en:`${leading.nameEn ?? leading.name} sets the tone.`},body:{
        zh:`在已取得曲风资料的 ${palette.known} 首曲目中，${leading.nameZh}占 ${Math.round(leading.percentage)}%。继续补全资料后，这张音乐画像也会更新。`,
        en:`${leading.nameEn ?? leading.name} represents ${Math.round(leading.percentage)}% of ${palette.known} tracks with verified genre information. Your profile updates as more tags arrive.`}}] : []};
  }, [merged,trackHistory]);
  const reportTime = useMemo(() => resolveReportListeningTime(report), [report]);
  const persona = useMemo(() => buildMusicPersona(report), [report]);
  const t = copy[language];
  const demo = report.mode === "demo";
  const closeModal = useCallback(() => setModal(null), []);
  const metadataSignature = useMemo(() => [...new Set(monthlyInputs.filter(input => input.mode === "live").flatMap(input => input.platforms.flatMap(platform => platform.tracks.map(track => `${platform.id}:${track.id}`))))].sort().join("|"), [monthlyInputs]);
  useEffect(() => {
    if (IS_UI_PREVIEW || viewingSaved || demo || syncing || awaitingHistory || historyActive) return;
    if (!metadataSignature) {setMetadataProgress({done:0,total:0,state:"done"});setReportReady(true);return;}
    let cancelled = false; const controller = new AbortController();
    const pause=(milliseconds:number)=>new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);controller.signal.removeEventListener("abort",done);resolve();};
      const timer=setTimeout(done,milliseconds);controller.signal.addEventListener("abort",done,{once:true});
      if(controller.signal.aborted)done();
    });
    const unique = new Map<string,{provider:PlatformId;id:string;title:string;artist:string;album?:string}>();
    const priorities = new Map<string,number>();
    for (const input of monthlyInputs) for (const platform of input.platforms) for (const track of platform.tracks) {
      const key = `${platform.id}:${track.id}`;
      priorities.set(key,(priorities.get(key) ?? 0) + (track.count ?? 0));
      if ((!track.artworkUrl || !track.genres.length || !track.durationSeconds) && !metadataAttempted.current.has(key)) unique.set(key,{provider:platform.id,id:track.id,title:track.title,artist:track.artist,album:track.album});
    }
    const queue = [...unique.values()].sort((a,b)=>(priorities.get(`${b.provider}:${b.id}`) ?? 0)-(priorities.get(`${a.provider}:${a.id}`) ?? 0));
    const total = priorities.size, alreadyComplete = total - queue.length;
    if (!queue.length) { setMetadataProgress({done:total,total,state:"done"}); setReportReady(true); return; }
    setMetadataProgress({done:alreadyComplete,total,state:"loading"});
    void (async () => {
      let incomplete = false;
      let completedLookup = alreadyComplete;
      for (let start=0; start<queue.length; start+=6) {
        if(cancelled)return;
        const batch=queue.slice(start,start+6);
        try {
          const load=async(requested=batch)=>{
            const fetchBatch=()=>apiFetch("/api/metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tracks:requested}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});
            let response=await fetchBatch();
            for(let retry=0;response.status===429&&retry<12;retry++){
              await pause(5000);if(cancelled)return response;
              response=await fetchBatch();
            }
            return response;
          };
          const response=await load();if(cancelled)return;
          if(!response.ok)throw Error();
          const data=await response.json();if(cancelled)return;
          if(!Array.isArray(data.items))throw Error();
          // Retry only unfinished lookups, with a smaller request after the upstream budget ends.
          // The initial connection should finish without asking the user to repeat successful work.
          for(let retry=0;retry<2;retry++){
            const pending=batch.filter(track=>!data.items.some((item:{provider:PlatformId;id:string;complete?:boolean})=>item.provider===track.provider&&item.id===track.id&&item.complete!==false));
            if(!pending.length)break;
            await pause(1000);if(cancelled)return;
            try {
              const next=await load(pending);if(cancelled)return;
              if(!next.ok)break;
              const nextData=await next.json();if(cancelled)return;
              if(!Array.isArray(nextData.items))break;
              const refreshed=new Map(data.items.map((item:{provider:PlatformId;id:string})=>[`${item.provider}:${item.id}`,item]));
              for(const item of nextData.items)if(pending.some(track=>track.provider===item.provider&&track.id===item.id))refreshed.set(`${item.provider}:${item.id}`,item);
              data.items=[...refreshed.values()];
            } catch {if(cancelled)return;break;}
          }
          const entries=new Map<string,{provider:PlatformId;id:string;artworkUrl?:string;genres?:string[];genreSource?:string;durationSeconds?:number;complete?:boolean}>(data.items.filter((item:{provider:PlatformId;id:string})=>batch.some(track=>track.provider===item.provider&&track.id===item.id)).map((item:{provider:PlatformId;id:string})=>[`${item.provider}:${item.id}`,item]));
          for(const [key,value] of entries)metadataCache.current.set(key,value);
          for(const item of batch){const key=`${item.provider}:${item.id}`;if(entries.has(key)&&entries.get(key)?.complete!==false){metadataAttempted.current.add(key);completedLookup++;}else incomplete=true;}
          setMonthlyInputs(current=>current.map(input=>input.mode!=="live"?input:{...input,platforms:input.platforms.map(platform=>({...platform,tracks:platform.tracks.map(track=>{
            const meta=entries.get(`${platform.id}:${track.id}`);if(!meta)return track;
            return {...track,genreLookupComplete:meta.complete===true,...(meta.artworkUrl?{artworkUrl:meta.artworkUrl}:{}),...(meta.durationSeconds?{durationSeconds:meta.durationSeconds}:{}),...(Array.isArray(meta.genres)&&meta.genres.length?{genres:meta.genres,genreSource:meta.genreSource}: {})};
          })}))}));
          setMetadataProgress({done:completedLookup,total,state:start+batch.length>=queue.length?(incomplete?"error":"done"):"loading"});
          if(start+batch.length>=queue.length&&!incomplete)setReportReady(true);
        } catch { if(!cancelled)setMetadataProgress({done:completedLookup,total,state:"error"}); return; }
      }
    })();
    return()=>{cancelled=true;controller.abort();};
  },[metadataSignature,demo,metadataRevision,syncing,awaitingHistory,historyActive,viewingSaved]);
  const retryMetadata = () => {setReportReady(false);setAllowPartial(false);metadataAttempted.current.clear();setMetadataRevision(revision=>revision+1);};
  const metadataStatus = metadataProgress.state === "loading" ? (language === "zh" ? `正在补全曲风与封面 · ${metadataProgress.done}/${metadataProgress.total} 首` : `Looking up genres and covers · ${metadataProgress.done}/${metadataProgress.total}`)
    : metadataProgress.state === "error" ? (language === "zh" ? "音乐资料读取暂时中断，可重新补全。已有报告仍可浏览。" : "Metadata lookup paused. Retry to continue; your report remains available.") : "";

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = IS_UI_PREVIEW ? `zmusicstats — ${UI_PREVIEW_LABEL[language]}` :
      language === "zh"
        ? "zmusicstats — 你的音乐，有迹可循"
        : "zmusicstats — Your month, on record";
    try {
      localStorage.setItem("zmusicstats-language", language);
    } catch {
      /* Storage is optional. */
    }
  }, [language]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  const cancelRestoration = () => {
    restorationController.current?.abort();
    restorationController.current = null;
    if (restorationRequest.current !== null && restorationRequest.current === liveRequest.current) {
      liveRequest.current++;
      liveController.current?.abort();
      liveController.current = null;
      setSyncing(false);
      setSyncProgress("");
    }
    restorationRequest.current = null;
  };
  const syncReport = async (months = selectedMonths, restoring = false) => {
    if (IS_UI_PREVIEW) return;
    const requestedMonths = [...new Set(months)].filter(value => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value)).sort();
    if (!requestedMonths.length) return;
    const request = ++liveRequest.current;
    restorationController.current?.abort();
    restorationRequest.current = restoring ? request : null;
    liveController.current?.abort();
    const controller = new AbortController();
    liveController.current = controller;
    const active = () => request === liveRequest.current && !controller.signal.aborted;
    const wait = (milliseconds: number) => new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, milliseconds);
      controller.signal.addEventListener("abort", done, { once: true });
      if (controller.signal.aborted) done();
    });
    const periodFor = (value: string) => {
      const [year, monthNumber] = value.split("-").map(Number);
      return { start: `${value}-01`, end: `${value}-${new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()}`, timeZone: "Asia/Shanghai" };
    };
    const inputs: ReportInput[] = [];
    const issues: typeof readIssues = [];
    let requiresReconnect = false;
    setSyncing(true);
    setSyncCounts({done:0,total:requestedMonths.length});
    setReportReady(false); setAllowPartial(false); setIngestionError("");
    setMetadataProgress({done:0,total:0,state:"idle"});
    setSelectedMonths(requestedMonths);
    setReadIssues([]);
    try {
      // Show the local archive immediately while refreshing the connected sources.
      // Long selections should never sit on a demo report until their final month returns.
      try {
        const archiveResponse = await apiFetch("/api/history/netease/reports", {signal:controller.signal});
        if (archiveResponse.ok) {
          const archive = await archiveResponse.json();
          if (!active()) return;
          if(Array.isArray(archive.inputs))setHistoryInputs(current=>[
            ...current.map(input=>({...input,platforms:input.platforms.filter(platform=>platform.id!=="netease")})).filter(input=>input.platforms.length),
            ...archive.inputs.filter((input:ReportInput)=>input?.mode==="live"),
          ]);
          const saved: ReportInput[] = Array.isArray(archive.inputs) ? archive.inputs.filter((input:ReportInput) => input?.mode === "live" && requestedMonths.includes(input.period?.start?.slice(0,7))) : [];
          setMonthlyInputs(current => {
            const retained = current.filter(input=>input.mode==="live"&&requestedMonths.includes(input.period.start.slice(0,7)));
            const byMonth = new Map(retained.map(input=>[input.period.start,input]));
            for(const input of saved)byMonth.set(input.period.start,mergeMonthSnapshot(byMonth.get(input.period.start),input));
            return withMetadata(byMonth.size ? [...byMonth.values()].sort((a,b)=>a.period.start.localeCompare(b.period.start)) : [{mode:"live",period:periodFor(requestedMonths[0]),platforms:[]}]);
          });
        }
      } catch { if (!active()) return; }
      for (const [index, selectedMonth] of [...requestedMonths].reverse().entries()) {
        if (!active()) return;
        setSyncProgress(`${language === "zh" ? "正在读取" : "Reading"} ${selectedMonth} · ${index + 1}/${requestedMonths.length}`);
        try {
          const load = () => apiFetch(`/api/report?month=${encodeURIComponent(selectedMonth)}`, { signal: controller.signal });
          let response = await load();
          if (!active()) return;
          // Rate-limited months stay in the queue; cancelling stops both the wait and the request.
          for (let retry = 0; response.status === 429 && retry < 12; retry++) {
            setSyncProgress(language === "zh" ? `稍候继续读取 ${selectedMonth} · ${index + 1}/${requestedMonths.length}` : `Continuing shortly: ${selectedMonth} · ${index + 1}/${requestedMonths.length}`);
            await wait(5000);
            if (!active()) return;
            response = await load();
            if (!active()) return;
          }
          if (response.status === 401) {
            requiresReconnect = true;
            issues.push({ month: selectedMonth, code: "CONNECTION_EXPIRED", message: "账号连接已失效，请重新连接后读取这个月份。" });
            break;
          }
          if (!response.ok) throw new Error("READ_FAILED");
          const data = await response.json();
          if (!active()) return;
          const candidate = data.input as ReportInput | undefined;
          const expectedPeriod = periodFor(selectedMonth);
          const knownPlatform = (value: unknown) => ["netease", "qq", "apple"].includes(String(value));
          if (!candidate || candidate.mode !== "live" || !Array.isArray(candidate.platforms)
            || candidate.period?.start !== expectedPeriod.start || candidate.period?.end !== expectedPeriod.end
            || candidate.period?.timeZone !== expectedPeriod.timeZone
            || (candidate.expectedPlatforms !== undefined && (!Array.isArray(candidate.expectedPlatforms) || !candidate.expectedPlatforms.every(knownPlatform)))
            || !candidate.platforms.every(platform => platform && knownPlatform(platform.id) && Array.isArray(platform.tracks)
              && platform.tracks.every(track => track && typeof track.id === "string" && typeof track.title === "string"
                && typeof track.artist === "string" && Array.isArray(track.genres)))) throw new Error("REPORT_INVALID");
          const monthIssues = Array.isArray(data.issues) ? data.issues.filter((issue: { code?: unknown; provider?: unknown }) =>
            issue && typeof issue.code === "string" && (issue.provider === undefined || knownPlatform(issue.provider))) : [];
          inputs.push(candidate);
          setHistoryInputs(current=>[...current.filter(input=>input.period.start!==candidate.period.start),mergeMonthSnapshot(current.find(input=>input.period.start===candidate.period.start),candidate)]);
          setMonthlyInputs(current => withMetadata([
            ...current.filter(input => input.mode === "live" && requestedMonths.includes(input.period.start.slice(0,7)) && input.period.start !== candidate.period.start), mergeMonthSnapshot(current.find(input=>input.mode==="live"&&input.period.start===candidate.period.start),candidate),
          ].sort((a,b)=>a.period.start.localeCompare(b.period.start))));
          for (const issue of monthIssues) issues.push({ ...issue, message: typeof issue.message === "string" ? issue.message : "", month: selectedMonth });
          for (const platform of candidate.platforms) {
            if (!platform.tracks.length && !monthIssues.some((issue: { provider?: string; code: string }) => issue.provider === platform.id && !["GENRE_NOT_AVAILABLE", "DURATION_MAPPING_REQUIRED"].includes(issue.code))) {
              issues.push({ month: selectedMonth, provider: platform.id, code: "EMPTY_RESULT", message: "" });
            }
          }
        } catch {
          if (!active()) return;
          // A failed or malformed month does not discard earlier successes or skip later months.
          issues.push({ month: selectedMonth, code: "READ_FAILED", message: "" });
        }
        setSyncCounts({done:index+1,total:requestedMonths.length});
      }
      if (!active()) return;
      // An empty personal snapshot carries no invented platforms, songs or zero listening time.
      // Keep the attempted selection and its diagnostics visible even if every month failed.
      const emptyReportInput: ReportInput = {
        mode: "live", period: periodFor(requestedMonths[0]), platforms: [],
        expectedPlatforms: [...new Set(monthlyInputs.filter(input => input.mode === "live")
          .flatMap(input => input.expectedPlatforms ?? input.platforms.map(platform => platform.id)))],
      };
      setMonthlyInputs(current => {
        const retained = current.filter(input => input.mode === "live" && requestedMonths.includes(input.period.start.slice(0,7)));
        const byMonth = new Map(retained.map(input => [input.period.start, input]));
        for (const input of inputs) byMonth.set(input.period.start, mergeMonthSnapshot(byMonth.get(input.period.start),input));
        return withMetadata(byMonth.size ? [...byMonth.values()].sort((a,b)=>a.period.start.localeCompare(b.period.start)) : [emptyReportInput]);
      });
      setSelectedMonths(requestedMonths);
      try { localStorage.setItem(PERSONAL_MONTHS_KEY, JSON.stringify(requestedMonths)); } catch { /* Storage is optional. */ }
      setReadIssues(issues);
      const unread=issues.filter(issue=>INCOMPLETE_READ_CODES.has(issue.code));
      if(unread.length)setIngestionError(language==="zh" ? `${unread.length} 项平台数据未读取完成，请重新读取。 (${unread[0].code})` : `${unread.length} source reports remain incomplete. Retry reading. (${unread[0].code})`);
      else setConnectingProvider(undefined);
      setFilter("all");
      if(requiresReconnect){setConnectionTab("connections");setModal("connections");}
      if (requiresReconnect) setToast(language === "zh" ? "请重新连接音乐账号，再读取报告。" : "Reconnect your music account to load your report.");
      else if (!inputs.length) setToast(t.reportFailed);
    } finally {
      if (active()) { setSyncing(false); setSyncProgress(""); liveController.current = null; }
      if (restorationRequest.current === request) restorationRequest.current = null;
    }
  };
  const syncReportRef = useRef(syncReport);
  useEffect(() => { syncReportRef.current = syncReport; });
  useEffect(() => {
    if (IS_UI_PREVIEW) return;
    const controller = new AbortController();
    restorationController.current = controller;
    const request = liveRequest.current;
    const timeout = setTimeout(() => controller.abort(), 10000);
    void (async () => {
      try {
        const response = await apiFetch("/api/connections", { signal: controller.signal });
        if (!response.ok || controller.signal.aborted || request !== liveRequest.current) return;
        const data = await response.json();
        if (controller.signal.aborted || request !== liveRequest.current) return;
        if (Array.isArray(data.providers) && data.providers.some((provider: { connected?: unknown }) => provider?.connected === true)) {
          setConnectedProviders(data.providers.filter((provider: { connected?: unknown }) => provider?.connected === true).map((provider: { id: PlatformId }) => provider.id));
          let periodPending = false;
          try { periodPending = localStorage.getItem(PERIOD_PENDING_KEY) === "true" || !localStorage.getItem(PERSONAL_MONTHS_KEY); } catch { /* Storage is optional. */ }
          if (periodPending) { setEntry("period"); return; }
          setEntry("report");
          clearTimeout(timeout);
          void syncReportRef.current(rememberedMonths(), true);
        }
      } catch { /* Connection management shows a retry if this check is unavailable. */ }
      finally { clearTimeout(timeout); if (restorationController.current === controller) setEntry(current => current === "checking" ? "connections" : current); }
    })();
    return () => {
      controller.abort();
      clearTimeout(timeout);
      if (restorationController.current === controller) restorationController.current = null;
    };
  }, []);
  const changeMonths = (values: string[]) => {
    if (!values.length) return;
    if (viewingSaved) { setSelectedMonths(values); setModal(null); return; }
    cancelConnectionRead();setAwaitingHistory(false);setConnectingProvider(undefined);
    cancelRestoration();
    if (demo) {
      liveRequest.current++;
      liveController.current?.abort();
      liveController.current = null;
      setSyncing(false);
      setSyncProgress("");
      setSelectedMonths(values);
      setMonthlyInputs(values.map(value => getDemoInput(value as "2026-10" | "2026-09")));
      setReadIssues([]);
      setModal(null);
    } else { setModal(null); void syncReport(values); }
  };
  const disconnectPlatform = (id: PlatformId) => {
    const remaining = connectedProviders.filter(provider => provider !== id);
    setConnectedProviders(remaining);
    if (!remaining.length) { setEntry("connections"); setModal(null); setConnectionTab("connections"); }
    cancelConnectionRead();setAwaitingHistory(false);setIngestionError("");setConnectingProvider(undefined);
    if(id==="netease")setHistoryActive(false);
    cancelRestoration();
    liveRequest.current++;
    liveController.current?.abort();
    liveController.current = null;
    setSyncing(false);
    setSyncProgress("");
    setReadIssues(current => current.filter(issue => issue.provider !== id));
    setHistoryInputs(current=>current.map(input=>({...input,platforms:input.platforms.filter(platform=>platform.id!==id)})));
    setMonthlyInputs(current => current.map(input => input.mode === "demo" ? input : {
      ...input, platforms:input.platforms.filter(platform => platform.id !== id), expectedPlatforms:input.expectedPlatforms?.filter(platform => platform !== id)
    }));
  };
  const loadImportedHistory = (inputs: ReportInput[], months: string[], issues: typeof readIssues) => {
    const finishInitialImport = finishHistoryWithSync.current;
    finishHistoryWithSync.current=false;
    setAwaitingHistory(false);setReportReady(false);setAllowPartial(false);
    const unread=issues.filter(issue=>INCOMPLETE_READ_CODES.has(issue.code));
    setIngestionError(unread.length ? (language==="zh" ? `${unread.length} 个月份尚未读取完成，请重试。 (${unread[0].code})` : `${unread.length} months remain incomplete. Please retry. (${unread[0].code})`) : "");
    const orderedMonths = [...new Set(months)].sort();
    setHistoryInputs(current=>[...current.map(input=>({...input,platforms:input.platforms.filter(platform=>platform.id!=="netease")})).filter(input=>input.platforms.length),...inputs]);
    cancelRestoration();
    liveRequest.current++; liveController.current?.abort(); setSyncing(false); setSyncProgress("");
    setMonthlyInputs(current => withMetadata(inputs.map(input => {
      const other = current.find(previous => previous.mode === "live" && previous.period.start === input.period.start);
      const otherPlatforms = other?.platforms.filter(platform => !input.platforms.some(incoming => incoming.id === platform.id)) ?? [];
      return { ...input, platforms:[...input.platforms,...otherPlatforms], expectedPlatforms:[...new Set([...(input.expectedPlatforms ?? []),...otherPlatforms.map(platform => platform.id)])] };
    })));
    setSelectedMonths(orderedMonths); setReadIssues(issues); setFilter("all");
    setSyncCounts({done:new Set(inputs.map(input=>input.period.start.slice(0,7))).size,total:orderedMonths.length});
    try { localStorage.setItem("zmusicstats-personal-months",JSON.stringify(orderedMonths)); } catch { /* optional */ }
    if(finishInitialImport)void syncReport(orderedMonths);
  };
  const connectAndRead = async (provider?:PlatformId) => {
    setViewingSaved(false);
    if (IS_UI_PREVIEW) return;
    if (provider) { setConnectedProviders(current => [...new Set([...current, provider])]); setEntry("report"); }
    cancelConnectionRead();
    if(!provider){setAwaitingHistory(false);setConnectingProvider(undefined);void syncReport();return;}
    const request=connectionRequest.current;
    const controller=new AbortController();connectionController.current=controller;
    const active=()=>request===connectionRequest.current&&!controller.signal.aborted;
    cancelRestoration();setConnectionTab("history");setReportReady(false);setAllowPartial(false);setIngestionError("");
    liveRequest.current++;liveController.current?.abort();setSyncing(false);setSyncProgress("");
    setConnectingProvider(provider);
    setMonthlyInputs(current=>current.some(input=>input.mode==="live")?current:[{mode:"live",period:monthlyInputs[0].period,expectedPlatforms:[provider],platforms:[]}]);
    if(provider==="netease"){
      finishHistoryWithSync.current=true;
      setAwaitingHistory(true);
      setMonthlyInputs(current=>current.some(input=>input.mode==="live")?current:[{mode:"live",period:monthlyInputs[0].period,expectedPlatforms:["netease"],platforms:[]}]);
      try {
        const response=await apiFetch("/api/history/netease",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
        if(!active())return;
        if(!response.ok)throw await connectionResponseError(response,"HISTORY_DIRECTORY_UNAVAILABLE");
      } catch(error){if(active()){setAwaitingHistory(false);setIngestionError(connectionErrorMessage(error,language));}}
      return;
    }
    if(provider==="qq"){
      setAwaitingHistory(true);
      try {
        const response=await apiFetch("/api/history/qq/months",{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});
        if(!active())return;
        if(!response.ok)throw await connectionResponseError(response,"HISTORY_DIRECTORY_UNAVAILABLE");
        const data=await response.json();
        if(!active())return;
        if(!Array.isArray(data.months)||!data.months.length)throw Error("HISTORY_DIRECTORY_UNAVAILABLE");
        setAwaitingHistory(false);await syncReport([...new Set([...selectedMonths,...data.months])]);
      }catch(error){if(active()){setAwaitingHistory(false);setIngestionError(connectionErrorMessage(error,language));}}
      return;
    }
    void syncReport();
  };
  const showDemo = () => {
    setViewingSaved(false);
    setEntry("report");
    cancelConnectionRead();setConnectingProvider(undefined);
    setAwaitingHistory(false);setIngestionError("");setReportReady(true);setAllowPartial(false);
    cancelRestoration();
    liveRequest.current++;
    liveController.current?.abort();
    liveController.current = null;
    setSyncing(false);
    setSyncProgress("");
    setSelectedMonths(["2026-10"]);
    setMonthlyInputs([getDemoInput("2026-10")]);
    setReadIssues([]);
    setFilter("all");
  };
  const openSavedReports = async () => {
    const inputs = await savedBrowserReports();
    if (!inputs.length) { setHasSavedReports(false); return; }
    cancelConnectionRead(); cancelRestoration(); liveRequest.current++; liveController.current?.abort();
    setViewingSaved(true); setSyncing(false); setAwaitingHistory(false); setHistoryActive(false); setIngestionError("");
    setMonthlyInputs(inputs); setHistoryInputs(inputs); setSelectedMonths(inputs.map(input => input.period.start.slice(0,7)));
    setReadIssues([]); setReportReady(true); setAllowPartial(false); setMetadataProgress({done:0,total:0,state:"done"}); setEntry("report");
    setToast(language === "zh" ? "正在查看保存在此浏览器的报告。" : "Viewing reports saved in this browser.");
  };
  const accountConnected = (provider?: PlatformId) => {
    if (IS_UI_PREVIEW) return;
    if (provider) setConnectedProviders(current => [...new Set([...current, provider])]);
    if (entry === "connections" || entry === "period") {
      try { localStorage.setItem(PERIOD_PENDING_KEY,"true"); } catch { /* Storage is optional. */ }
      setEntry("period"); setModal(null); setConnectionTab("connections");
    } else void connectAndRead(provider);
  };
  const startFirstReport = (months: string[] | null) => {
    if (IS_UI_PREVIEW) return;
    try { localStorage.removeItem(PERIOD_PENDING_KEY); } catch { /* Storage is optional. */ }
    setEntry("report"); setModal(null);
    if (months) { void syncReport(months); return; }
    const provider = connectedProviders.includes("netease") ? "netease" : connectedProviders.includes("qq") ? "qq" : connectedProviders[0];
    void connectAndRead(provider);
  };
  const unified = useMemo(() => unifiedTracks(report), [report]);
  const trackGroups = useMemo(() => [{ name: "", recent: false, tracks: unified.tracks.filter(track =>
    (filter === "all" || track.platforms.includes(filter)) && `${track.title} ${track.artist}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  )}], [unified, filter, query]);
  const trackTotal = trackGroups[0].tracks.length;
  const customCountValid = /^\d+$/.test(rankingInput) && Number.isSafeInteger(Number(rankingInput)) && Number(rankingInput) >= 1;
  const requestedTrackCount = rankingMode === "all" ? trackTotal : rankingMode === "custom" ? customCountValid ? Number(rankingInput) : 5 : Number(rankingMode);
  const displayedTrackCount = Math.min(trackTotal, requestedTrackCount);
  const trackPageCount = Math.max(1, Math.ceil(displayedTrackCount / 100));
  const currentTrackPage = Math.min(trackPage, trackPageCount);
  useEffect(() => setTrackPage(1), [filter, query, month, demo, rankingMode, rankingInput]);
  useEffect(() => { rankingScroll.current?.scrollTo({top:0}); }, [filter, query, month, rankingMode, rankingInput, currentTrackPage]);
  const changeTrackPage = (next: number) => {
    setTrackPage(Math.min(trackPageCount, Math.max(1, next)));
    document.querySelector(".tracks-panel")?.scrollIntoView({ behavior: "auto", block: "start" });
  };
  const titleMonth = selectedMonths.length > 1
    ? (language === "zh" ? `${selectedMonths.length} 个月` : `${selectedMonths.length} months`)
    : language === "zh" ? `${Number(selectedMonths[0].slice(5))} 月`
    : new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(`${selectedMonths[0]}-15T12:00:00`));
  const diagnostics = [
    ...merged.notices.map(notice => notice.message[language]),
    ...readIssues.map(issue => `${issue.month}${issue.provider ? ` · ${t[issue.provider]}` : ""} · ${issue.code === "EMPTY_RESULT"
      ? (language === "zh" ? "平台返回空列表，尚不能确认该月没有听歌。" : "The platform returned an empty list; this does not confirm no listening.")
      : issue.code === "READ_FAILED" ? (language === "zh" ? "读取失败，可重新同步。" : "Could not load; please sync again.")
      : issue.code === "DURATION_INCONSISTENT" ? (language === "zh" ? "平台时长与播放记录不一致，核实前不计为零。" : "Duration conflicts with the play records; it is not counted as zero.")
      : issue.code === "DURATION_MAPPING_REQUIRED" ? (language === "zh" ? "听歌时长尚待核实。" : "Listening duration is not yet verified.")
      : issue.code === "GENRE_NOT_AVAILABLE" ? (language === "zh" ? "平台暂未提供曲风标签。" : "Genre tags are unavailable.")
      : issue.code === "UPSTREAM_TIMEOUT" ? (language === "zh" ? "音乐平台暂时响应超时，已保留其他可用数据，可稍后重新同步。" : "The music platform timed out. Other available data is preserved; try syncing again later.")
      : issue.code === "MONTH_NOT_READY" ? (language === "zh" ? "平台尚未生成当月报告，请选择已结束的月份。" : "The platform has not generated this month's report yet. Choose a completed month.")
      : issue.code === "FUTURE_MONTH" ? (language === "zh" ? "这个月份尚未开始，请选择过去的月份。" : "This month has not started yet. Choose an earlier month.")
      : issue.code === "PERIOD_MISMATCH" || issue.code === "PERIOD_UNCONFIRMED" ? (language === "zh" ? "平台返回数据的日期未能匹配所选月份，未将其计入本月统计。" : "The returned data could not be matched to the selected month and is excluded from its statistics.")
      : issue.code === "TOP_RANK_PARTIAL" ? (language === "zh" ? "完整排行榜暂未响应，目前只展示月报中已确认的第 1 名歌曲，曲风分析也仅基于这份样本。" : "The full ranking is unavailable. Only the confirmed top song from the monthly report is shown; genre analysis uses this limited sample.")
      : issue.code === "CONNECTION_EXPIRED" ? (language === "zh" ? "账号连接已失效，请重新连接后读取。" : "Your account connection has expired. Reconnect to load this report.")
      : language === "zh" ? issue.message : `Data unavailable (${issue.code}).`}`)
  ];
  const preparing = syncing || (!demo && (awaitingHistory || historyActive || !reportReady || metadataProgress.state==="loading" || Boolean(ingestionError)));
  useReportSlides(entry === "report" && (!preparing || allowPartial) && modal === null);
  const preparationError = ingestionError || (!syncing&&!awaitingHistory&&metadataProgress.state==="error" ? (language==="zh" ? "部分歌曲资料未读取完成，请重试后再查看完整报告。 (METADATA_INCOMPLETE)" : "Some song metadata is incomplete. Retry before viewing the full report. (METADATA_INCOMPLETE)") : "");

  const historyContent = viewingSaved ? <p className="scope-note">{language === "zh" ? "正在查看本机保存的报告；重新连接平台后可以继续读取。" : "Viewing saved reports. Reconnect a platform to read more."}</p> : IS_UI_PREVIEW ? <p className="scope-note">{UI_PREVIEW_CONNECTION_REASON[language]}</p> : <>
    {demo ? <p className="scope-note">{language === "zh" ? "连接音乐账号后，这里会显示历史读取进度与各月份状态。" : "Connect an account to see reading progress and monthly availability here."}</p> : <>
      <ReadStatus language={language} inputs={monthlyInputs} months={selectedMonths} issues={readIssues} diagnostics={diagnostics}
        syncing={syncing} syncProgress={syncProgress} syncDone={syncCounts.done} syncTotal={syncCounts.total} metadataProgress={metadataProgress}
        actionsBusy={awaitingHistory || historyActive}
        onRetry={()=>void connectAndRead()} onRetryMetadata={retryMetadata} />
        {!demo && <HistoryImport language={language} onImported={loadImportedHistory} autoApply={awaitingHistory && connectingProvider==="netease"} onStatus={job=>{
          setHistoryActive(job.state==="running"||job.state==="discovering");
          if(job.state==="running"||job.state==="discovering"){
            setReportReady(false);
            setHistoryProgress({completed:job.completed,total:job.total,detail:job.inFlight.join(" · ")});
          }
          if(awaitingHistory && connectingProvider==="netease" && (job.state==="failed"||job.state==="cancelled"||(job.state==="complete"&&!job.availableMonths.length))){
            setAwaitingHistory(false);setIngestionError(job.error?.message ?? (language==="zh" ? "历史数据读取未完成，请重试。" : "History import did not finish. Retry."));
          }
        }} onError={error=>{setAwaitingHistory(false);setIngestionError(`${error.message} (${error.code})`);}} />}
    </>}
  </>;

  const reportToolbar = <div className="report-toolbar">
            <div className="report-status"><span className={`edition-badge ${demo ? "is-demo" : ""}`}>{IS_UI_PREVIEW ? UI_PREVIEW_LABEL[language] : demo ? t.demo : t.live}</span><span className="edition-caption">{demo ? t.demoNote : t.sourceData}</span>{!demo && <button className="text-button" onClick={showDemo}>{t.switchDemo}</button>}</div>
            <button className="period-select month-trigger" disabled={awaitingHistory || historyActive} onClick={() => {cancelRestoration();setModal("months");}} title={report.periodLabel[language]} aria-label={language === "zh" ? "选择报告月份" : "Choose report months"}><Disc3 size={15} /><span>{selectedMonths.length > 3 ? `${[...selectedMonths].sort()[0]} — ${[...selectedMonths].sort().at(-1)} · ${selectedMonths.length} ${language === "zh" ? "个月" : "months"}` : report.periodLabel[language]}</span><ChevronDown size={14} /></button>
          </div>;
  const navigationVisible = entry === "report" && (!preparing || allowPartial);

  return (
    <div className={`app-shell lang-${language}${entry === "connections" ? " is-welcome" : ""}${entry === "report" && preparing && !allowPartial ? " is-report-preparing" : ""}`}>
      <a className="skip-link" href="#main">{language === "zh" ? "跳到内容" : "Skip to content"}</a>
      {!navigationVisible && <header className="site-header">
        <a className="brand" href="#" onClick={event => { event.preventDefault(); window.scrollTo({top:0,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"}); }} aria-label="zmusicstats">
          <span className="brand-disc"><i /></span><span>zmusicstats<span className="brand-period">.</span></span>
        </a>
        <div className="header-actions">
          <button className="language-switch" onClick={() => setLanguage(language === "zh" ? "en" : "zh")} aria-label={language === "zh" ? t.english : t.chinese}>{language === "zh" ? "EN" : "中"}</button>
          {entry === "report" && <><span className="header-separator" /><button className="button connect-button" onClick={() => {setConnectionTab("connections");setModal("connections");}}><Plus size={17} /><span>{demo ? t.connect : t.accounts}</span></button></>}
        </div>
      </header>}
      {navigationVisible && <OverviewNavigator language={language} onLanguageToggle={()=>setLanguage(language === "zh" ? "en" : "zh")} onConnections={()=>{setConnectionTab("connections");setModal("connections");}} />}
      <main id="main" className="main-wrap">
        {entry === "checking" ? <div className="connection-welcome checking" role="status"><Disc3 className="loading-spin" size={30} /><p>{language === "zh" ? "正在恢复你的音乐连接…" : "Restoring your music connections…"}</p></div> : entry === "connections" ? <section className="connection-welcome">
          <span className="eyebrow">{IS_UI_PREVIEW ? UI_PREVIEW_LABEL[language] : "FIRST, YOUR MUSIC."}</span>
          <h1>{IS_UI_PREVIEW ? language === "zh" ? <>先看看，<br /><em>音乐的另一面。</em></> : <>A preview of<br /><em>your music story.</em></> : language === "zh" ? <>先连接，<br /><em>再听见自己。</em></> : <>Connect your music.<br /><em>Discover your story.</em></>}</h1>
          <p>{IS_UI_PREVIEW ? language === "zh" ? "这是使用虚构听歌数据的线上界面预览。可以探索完整示例报告与分享海报；真实音乐账号连接请使用本机版。" : "This online UI preview uses fictional listening data. Explore a full sample report and sharing posters; use the local app to connect real music accounts." : language === "zh" ? "连接音乐平台，把可读取的历史与曲风偏爱，收进同一张唱片。" : "Connect your music accounts. Bring your listening history and favorite sounds together."}</p>
          <div className="welcome-steps"><span><b>01</b>{IS_UI_PREVIEW ? language === "zh" ? "浏览示例" : "Explore" : language === "zh" ? "连接平台" : "Connect"}</span><i /><span><b>02</b>{language === "zh" ? "选择时段" : "Choose a period"}</span><i /><span><b>03</b>{IS_UI_PREVIEW ? language === "zh" ? "导出海报" : "Export" : language === "zh" ? "生成报告" : "Discover"}</span></div>
        </section> : entry === "period" ? <PeriodWelcome language={language} onContinue={startFirstReport} onBack={()=>{setConnectionTab("connections");setEntry("connections");}} /> : <>
          {preparing && !allowPartial && reportToolbar}
          {preparing && !allowPartial ? <ReportLoading language={language} phase={awaitingHistory||historyActive?"history":syncing?"reports":"metadata"}
            detail={awaitingHistory||historyActive?historyProgress.detail:syncing?syncProgress:(language==="zh"?"正在核对每首歌曲的曲风、封面和长度。":"Checking each song’s genres, artwork, and length.")}
            completed={awaitingHistory||historyActive?historyProgress.completed:syncing?syncCounts.done:metadataProgress.done} total={awaitingHistory||historyActive?historyProgress.total:syncing?syncCounts.total:metadataProgress.total}
            error={preparationError} onRetry={()=>{if(ingestionError){if(connectingProvider)void connectAndRead(connectingProvider);else void syncReport();}else retryMetadata();}}
            onDetails={()=>{setConnectionTab("history");setModal("connections");}}
            onPreview={!demo && report.sampleSongCount ? ()=>setAllowPartial(true):undefined} /> : <>
            {preparing && <div className="partial-report-status" role="status">{preparationError?<Info size={18}/>:<Disc3 className="loading-spin" size={18}/>}<span>{preparationError || (language==="zh" ? "这是正在补全的报告，尚未完成全部读取。" : "This report is still being completed.")} {!preparationError&&(syncProgress||metadataStatus||historyProgress.detail)}</span><button className="text-button" onClick={()=>{setConnectionTab("history");setModal("connections");}}>{language==="zh"?"读取详情":"Loading details"}</button></div>}
            <motion.div key={`${month}-${demo}`} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:.28}}>
              <section className="hero persona-hero" id="report-summary" tabIndex={-1} data-report-slide>
                {reportToolbar}
                <div className="hero-copy">
                  <div className="eyebrow"><span className="tiny-line" />{language === "zh" ? "你的音乐画像" : "YOUR LISTENING PORTRAIT"}</div>
                  <h1>{persona.line[language]}</h1><p className="hero-subtitle">{persona.evidence[language]}</p>
                  <div className="hero-duration">
                    <span>{report.periodLabel[language]} · {language === "zh" ? "音乐相伴" : "TIME WITH MUSIC"}</span>
                    <ListeningTimeValue time={reportTime} language={language} />
                    {(reportTime.kind === "estimated" || reportTime.partial) && <small className="known-duration-note">{reportTime.notice[language]}</small>}
                  </div>
                  {reportTime.seconds !== null && <TimePerspective hideHours compact language={language} seed="all-platforms" time={reportTime} />}
                  <div className="hero-meta"><span><b>{report.sampleSongCount}</b>{t.sampled}</span><i /><span><b>{report.platforms.length}</b>{t.platforms}</span></div>
                  <button className="button primary hero-cta" disabled={preparing} onClick={()=>setModal("poster")}><Download size={17} />{t.share}</button>
                </div>
                <Record report={report} language={language} />
              </section>
              <div id="report-platforms" tabIndex={-1} data-report-slide><PlatformDonut report={report} language={language} /></div>
              <div className="single-report-content">
                <section className="tracks-panel" id="report-ranking" tabIndex={-1} data-report-slide>
                  <div className="section-heading"><div><span className="eyebrow">ON REPEAT</span><h2>{t.mostPlayed}</h2></div>
                    <div className="ranking-size-control"><label htmlFor="ranking-size">{language === "zh" ? "显示" : "Show"}</label><select id="ranking-size" value={rankingMode} onChange={event=>setRankingMode(event.target.value)}>{[5,10,20,50,100].map(count=><option key={count} value={count}>Top {count}</option>)}<option value="custom">{language === "zh" ? "自定义" : "Custom"}</option><option value="all">{language === "zh" ? "全部" : "All tracks"}</option></select>
                    {rankingMode === "custom" && <input aria-label={language === "zh" ? "显示歌曲数量" : "Number of tracks to show"} type="number" min="1" step="1" inputMode="numeric" value={rankingInput} aria-invalid={!customCountValid} onChange={event=>setRankingInput(event.target.value)} />}</div>
                  </div>
                  {rankingMode === "custom" && !customCountValid && <p className="ranking-input-error" role="alert">{language === "zh" ? "请输入大于 0 的整数；暂显示前 5 首。" : "Enter a positive whole number. Showing the top 5 for now."}</p>}
                  <div className="track-controls">
                    <div className="filter-group" aria-label={t.from}>{(["all","netease","qq","apple"] as Filter[]).map(id=><button key={id} aria-pressed={filter===id} className={filter===id?"selected":""} onClick={()=>setFilter(id)}>{t[id]}</button>)}</div>
                    <label className="search-field"><Search size={16}/><input value={query} onChange={e=>{setQuery(e.target.value);if(e.target.value)setRankingMode("all");}} placeholder={t.search} aria-label={t.search}/></label>
                  </div>
                  <p className="track-interaction-hint"><Disc3 size={13} aria-hidden="true"/><span className="hint-pointer">{language === "zh" ? "悬停黑胶图标，查看歌曲详情与时间想象" : "Hover over a record for track details and a sense of time"}</span><span className="hint-touch">{language === "zh" ? "点击黑胶图标，查看歌曲详情与时间想象" : "Tap a record for track details and a sense of time"}</span></p>
                  <div className="ranking-scroll-area" ref={rankingScroll} tabIndex={0} role="region" aria-label={language === "zh" ? "歌曲排名，可上下滚动" : "Scrollable track ranking"}>
                    {trackTotal ? <TrackRows tracks={trackGroups[0].tracks.slice((currentTrackPage-1)*100,Math.min(currentTrackPage*100,displayedTrackCount))} language={language}/> : <p className="empty-state">{query?t.noResults:t.actualEmpty}</p>}
                  </div>
                  <div className="ranking-bottom-bar">
                    {trackTotal > 0 && <nav className="track-pagination" aria-label={language === "zh" ? "歌曲分页" : "Track pages"}>
                      <span className="track-page-range" role="status">{language === "zh" ? `显示第 ${(currentTrackPage-1)*100+1}–${Math.min(currentTrackPage*100,displayedTrackCount)} 首 · 已选 ${displayedTrackCount} / ${trackTotal} 首` : `${(currentTrackPage-1)*100+1}–${Math.min(currentTrackPage*100,displayedTrackCount)} · ${displayedTrackCount} of ${trackTotal} selected`}</span>
                      {trackPageCount > 1 && <div><button disabled={currentTrackPage===1} onClick={()=>changeTrackPage(currentTrackPage-1)} aria-label={language === "zh" ? "上一页" : "Previous page"}><ChevronLeft size={16}/></button><label><span className="sr-only">{language === "zh" ? "页码" : "Page"}</span><select value={currentTrackPage} onChange={event=>changeTrackPage(Number(event.target.value))}>{Array.from({length:trackPageCount},(_,index)=><option key={index+1} value={index+1}>{language === "zh" ? `第 ${index+1} / ${trackPageCount} 页` : `${index+1} / ${trackPageCount}`}</option>)}</select></label><button disabled={currentTrackPage===trackPageCount} onClick={()=>changeTrackPage(currentTrackPage+1)} aria-label={language === "zh" ? "下一页" : "Next page"}><ChevronRight size={16}/></button></div>}
                    </nav>}
                    <span className="slide-boundary-hint">{language === "zh" ? "在列表内滚动 · 到底停一下，再滑进入下一节" : "Scroll the list · pause at its end, then scroll again for the next chapter"}<ChevronDown size={13}/></span>
                  </div>
                  <p className="scope-note">{unified.notice[language]}</p>
                </section>
                <GenrePanel report={report} language={language} expanded metadataStatus={metadataStatus} onRetryMetadata={!demo&&metadataProgress.state!=="loading"?retryMetadata:undefined}/>
              </div>
              <section className="insights-section" id="report-overlap" tabIndex={-1} data-report-slide>
                <div className="overlap-panel">
                  <span className="eyebrow">THE COMMON GROUND</span><h2>{t.overlap}</h2><p>{t.overlapSub}</p>
                  {report.overlappingTracks.length>0 && <p className="scope-note">{language === "zh" ? "按相同或相近歌名匹配，忽略大小写与专辑封面；相近歌名同时参考歌手。" : "Matched by the same or similar titles, ignoring case and album art; similar titles also use the artist."}</p>}
                  <div className="overlap-tracks">{report.overlappingTracks.slice(0,3).map(track=><div className="overlap-track" key={track.id}><Cover index={track.coverIndex} title={track.title} artworkUrl={track.artworkUrl}/><div><strong>{track.title}</strong><span>{track.artist}</span></div><Link2 size={18}/></div>)}</div>
                  {!report.overlappingTracks.length&&<p className="scope-note">{t.noOverlap}</p>}
                </div>
                <div className="liner-note"><span className="eyebrow">LINER NOTES</span><span className="liner-quote" aria-hidden="true">“</span>{report.insights[0]?<><h2>{report.insights[0].title[language]}</h2><p>{report.insights[0].body[language]}</p></>:<p>{t.livePeriodHelp}</p>}<div className="liner-signature">{titleMonth}<span>on record.</span></div></div>
              </section>
            </motion.div>
          </>}
          <div className={`report-closing${preparing ? " is-loading" : ""}`} id="report-share" tabIndex={-1} data-report-slide={!preparing ? "" : undefined}>
          {!preparing&&<section className="share-callout"><div className="mini-sleeves" aria-hidden="true"><div className="mini-sleeve back"><div/></div><div className="mini-sleeve front"><span>YOUR<br/>MONTH.<br/>ON RECORD.</span><div/><small>zmusicstats</small></div></div><div className="share-callout-copy"><span className="eyebrow">{t.posterEyebrow}</span><h2>{t.posterTitle}</h2><p>{t.posterDesc}</p></div><button className="button primary" onClick={()=>setModal("poster")}><Layers size={17}/>{t.posterCta}</button></section>}
          <footer className="site-footer editorial-footer"><div className="footer-brand">zmusicstats<span>.</span><small>Created by Zach</small><small>© {new Date().getFullYear()} Zach. {language === "zh" ? "保留所有权利。" : "All rights reserved."}</small></div><div className="footer-links"><button className="text-button" onClick={()=>setModal("info")}><Info size={14}/>{t.dataNote}</button><button className="text-button" onClick={()=>setModal("privacy")}><ShieldCheck size={14}/>{language === "zh" ? "隐私与数据" : "Privacy & data"}</button><a href="https://github.com/zzzachariah/zmusicstats" target="_blank" rel="noreferrer"><Link2 size={14}/>GitHub</a><a href="https://github.com/zzzachariah/zmusicstats/issues" target="_blank" rel="noreferrer"><Mail size={14}/>Contact</a></div></footer>
          </div>
        </>}
      </main>
      <Connections
        embedded={entry === "connections"} open={entry === "connections" || modal === "connections"} initialTab={connectionTab} historyContent={historyContent}
        language={language} onClose={closeModal} onSync={accountConnected}
        syncing={syncing || awaitingHistory || historyActive || metadataProgress.state==="loading"} onDisconnected={disconnectPlatform}
      />
      {entry === "connections" && <div className="welcome-demo">{hasSavedReports && <button className="small-button" onClick={()=>void openSavedReports()}>{language === "zh" ? "查看本机报告" : "View saved reports"}</button>}{connectedProviders.length > 0 && <button className="button primary" onClick={()=>setEntry("period")}>{language === "zh" ? "已连接，选择统计时段" : "Connected · choose a period"}</button>}<button className="text-button" onClick={showDemo}>{language === "zh" ? "先看看示例报告 ↗" : "Explore a sample report ↗"}</button></div>}
      {entry === "connections" && <footer className="welcome-footer"><span>Created by Zach <small>© {new Date().getFullYear()} zmusicstats</small></span><div><button className="text-button" onClick={()=>setModal("privacy")}>{language === "zh" ? "隐私与数据" : "Privacy & data"}</button><a href="https://github.com/zzzachariah/zmusicstats" target="_blank" rel="noreferrer">GitHub</a><a href="https://github.com/zzzachariah/zmusicstats/issues" target="_blank" rel="noreferrer">Contact</a></div></footer>}
      <AnimatePresence>
        {modal === "months" && <MonthPicker language={language} selected={selectedMonths} demo={demo} onClose={closeModal} onApply={changeMonths} />}
        {modal === "poster" && (
          <PosterDialog
            report={report}
            language={language}
            onClose={closeModal}
            onToast={setToast}
          />
        )}
        {modal === "privacy" && <Modal title={language === "zh" ? "隐私与数据" : "Privacy & data"} closeLabel={t.close} onClose={closeModal}><div className="info-content">{IS_BROWSER_STORAGE && <><p>{language === "zh" ? "听歌报告保存在此浏览器中，分析和海报导出在设备上完成。读取数据时会经过中转服务；云端仅短期加密保存登录状态和扫码信息，不长期保存听歌报告。登录会话最多保留 12 小时，过期后重新连接即可。" : "Reports stay in this browser; analysis and poster export run on your device. Requests pass through our relay, which temporarily stores encrypted login and QR state, not listening reports. Login sessions expire after 12 hours."}</p><button className="small-button" onClick={()=>void clearLocalReports().then(()=>{setHasSavedReports(false);setToast(language === "zh" ? "已清除本机保存的报告。" : "Saved reports cleared.");})}>{language === "zh" ? "清除本机保存的报告" : "Clear saved reports"}</button></>}<p>{language === "zh" ? "音乐账号的授权用于读取你选择的听歌资料。请只连接你自己的账号，并在管理连接中查看读取范围或断开连接。" : "Account authorization is used to read the listening data you select. Connect only your own accounts; review reading status or disconnect in Manage connections."}</p><p>{language === "zh" ? "画像与时间比喻在本地规则中生成，不会把听歌记录发送给 AI 服务。导出的海报会包含你勾选的歌曲与统计信息，分享前可以自行取舍。" : "Listening portraits and time comparisons use local rules. Your listening records are not sent to an AI service. Exported posters contain only the modules you select, so review your choices before sharing."}</p><p>{language === "zh" ? "部分平台只提供月榜样本；估算时长标有 ≈，不能视为全部播放历史。" : "Some platforms provide monthly ranking samples only. Estimated time is marked ≈ and does not represent a complete playback history."}</p></div></Modal>}
        {modal === "info" && (
          <Modal title={t.sourceInfo} closeLabel={t.close} onClose={closeModal}>
            <div className="info-content">
              <p>
                <strong>{demo ? t.currentSample : t.sourceData}</strong>
              </p>
              <p>{report.durationNotice[language]}</p>
              <p>{unified.notice[language]}</p>
              <p>{report.genreScope[language]}</p>
              <p>{t.livePeriodHelp}</p>
              <span className="info-period">
                {report.periodLabel[language]}
                <br />
                {report.period.timeZone}
              </span>
            </div>
          </Modal>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <Info size={16} />
            <span>{toast}</span>
            <button
              className="icon-button"
              onClick={() => setToast("")}
              aria-label={t.closeNotice}
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
