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
} from "lucide-react";
import { getDemoInput, DEMO_MONTHS } from "./lib/demo-data";
import {
  buildReport,
  type MusicReport,
  type RankedTrack,
  type PlatformId,
  type ReportInput,
} from "./lib/report";
import { copy, type Language } from "./lib/i18n";
import { Record } from "./components/Record";
import { Modal } from "./components/Modal";
import { Connections } from "./components/Connections";
import { PosterDialog } from "./components/PosterDialog";

type Tab = "overview" | "tracks" | "taste";
type Filter = "all" | PlatformId;

function Cover({ index, title }: { index: number; title: string }) {
  return (
    <div className={`album-cover cover-${index % 8}`} aria-hidden="true">
      <div className="cover-shape" />
      <span>{title.slice(0, 1)}</span>
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
    <div className="track-list">
      <div className="track-table-head">
        <span>{t.song}</span>
        <span>{t.from}</span>
        <span>{t.plays}</span>
      </div>
      {tracks.slice(0, limit ?? tracks.length).map((track, index) => (
        <motion.div
          className="track-row"
          key={`${track.id}-${track.platforms.join()}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.035 }}
        >
          <span className="track-rank">
            {numbered ? String(track.rank).padStart(2, "0") : "·"}
          </span>
          <Cover index={track.coverIndex} title={track.title} />
          <div className="track-title">
            <strong>{track.title}</strong>
            <span>{track.artist}</span>
          </div>
          <span className="track-platforms">
            {track.platforms.map((p) => (
              <span key={p} className={`source-badge ${p}`} title={t[p]}>
                {p === "netease" ? "N" : p === "apple" ? "A" : "Q"}
              </span>
            ))}
          </span>
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
        </motion.div>
      ))}
    </div>
  );
}

function GenrePanel({
  report,
  language,
  expanded = false,
}: {
  report: MusicReport;
  language: Language;
  expanded?: boolean;
}) {
  const t = copy[language];
  const [sourceId, setSourceId] = useState<PlatformId | null>(null);
  const sources = report.platforms.filter((p) => p.genres.length > 0);
  const source = sources.find((p) => p.id === sourceId) ?? sources[0];
  const separate = report.genres.length === 0;
  const available = separate ? (source?.genres ?? []) : report.genres;
  const genres = expanded ? available : available.slice(0, 5);
  const scope = separate && source ? source.genreScope : report.genreScope;
  return (
    <section
      className={`genre-panel ${expanded ? "genre-expanded" : ""}`}
      aria-label={t.genreDistribution}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE SOUND OF YOU</span>
          <h2>{t.tasteTitle}</h2>
        </div>
        <span className="small-disc" aria-hidden="true" />
      </div>
      {genres.length ? (
        <>
          {separate && source && (
            <div className="genre-source-picker">
              {sources.map((p) => (
                <button
                  key={p.id}
                  className={source.id === p.id ? "selected" : ""}
                  onClick={() => setSourceId(p.id)}
                >
                  {language === "zh" ? p.name : p.nameEn}
                </button>
              ))}
            </div>
          )}
          <div className="genre-leading">
            <span>{t.style}</span>
            <strong>
              {available[0].name === "Unknown" ? t.unknown : available[0].name}
              <i> / {Math.round(available[0].percentage)}%</i>
            </strong>
          </div>
          <div className="genre-bars">
            {genres.map((g, index) => (
              <div className="genre-row" key={g.name}>
                <div>
                  <span>
                    <i style={{ background: g.color }} />
                    {language === "zh" ? g.nameZh : g.name}
                  </span>
                  <span>
                    {g.percentage.toFixed(1)}
                    <small>%</small>
                  </span>
                </div>
                <div className="genre-track">
                  <motion.div
                    style={{ background: g.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${g.percentage}%` }}
                    transition={{
                      duration: 0.75,
                      delay: index * 0.06,
                      ease: [0.2, 0.8, 0.2, 1],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="scope-note">{scope[language]}</p>
        </>
      ) : (
        <p className="empty-state">{t.emptyGenre}</p>
      )}
    </section>
  );
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem("zmusicstats-language") === "en"
        ? "en"
        : "zh";
    } catch {
      return "zh";
    }
  });
  const [month, setMonth] = useState("2026-10");
  const [input, setInput] = useState<ReportInput>(() =>
    getDemoInput("2026-10"),
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"connections" | "poster" | "info" | null>(
    null,
  );
  const [toast, setToast] = useState("");
  const [syncing, setSyncing] = useState(false);
  const liveRequest = useRef(0);
  const report = useMemo(() => buildReport(input), [input]);
  const t = copy[language];
  const demo = report.mode === "demo";
  const closeModal = useCallback(() => setModal(null), []);
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title =
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
  const syncReport = async (selectedMonth = month) => {
    const request = ++liveRequest.current;
    setSyncing(true);
    try {
      const r = await fetch(
        `/api/report?month=${encodeURIComponent(selectedMonth)}`,
      );
      if (!r.ok) throw Error();
      const data = await r.json();
      if (request !== liveRequest.current) return;
      if (!data.input || !Array.isArray(data.input.platforms)) throw Error();
      setInput(data.input);
      setMonth(selectedMonth);
      setFilter("all");
      setModal(null);
      if (data.issues?.length) setToast(t.livePeriodHelp);
    } catch {
      if (request === liveRequest.current) setToast(t.reportFailed);
    } finally {
      if (request === liveRequest.current) setSyncing(false);
    }
  };
  const changeMonth = (value: string) => {
    if (demo) {
      setMonth(value);
      setInput(getDemoInput(value as "2026-10" | "2026-09"));
    } else void syncReport(value);
  };
  const disconnectPlatform = (id: PlatformId) => {
    liveRequest.current++;
    setSyncing(false);
    setInput((current) =>
      current.mode === "demo"
        ? current
        : {
            ...current,
            platforms: current.platforms.filter((p) => p.id !== id),
            expectedPlatforms: current.expectedPlatforms?.filter(
              (p) => p !== id,
            ),
          },
    );
  };
  const showDemo = () => {
    liveRequest.current++;
    setSyncing(false);
    setMonth("2026-10");
    setInput(getDemoInput("2026-10"));
    setFilter("all");
  };
  const trackGroups = useMemo(() => {
    const match = (track: RankedTrack) =>
      `${track.title} ${track.artist}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase());
    if (filter !== "all") {
      const p = report.platforms.find((p) => p.id === filter);
      return p
        ? [
            {
              name: p.rankingMatchesPeriod
                ? ""
                : language === "zh"
                  ? `${p.name} · 最近可用曲目（非本月排行）`
                  : `${p.nameEn} · Recent tracks, not a monthly ranking`,
              tracks: p.tracks.filter(match),
              recent: !p.rankingMatchesPeriod,
            },
          ]
        : [];
    }
    return report.rankingMode === "combined"
      ? [{ name: "", tracks: report.tracks.filter(match), recent: false }]
      : report.platforms.map((p) => ({
          name:
            (language === "zh" ? p.name : p.nameEn) +
            (p.rankingMatchesPeriod
              ? ""
              : language === "zh"
                ? " · 最近可用曲目（非本月排行）"
                : " · Recent tracks, not a monthly ranking"),
          tracks: p.tracks.filter(match),
          recent: !p.rankingMatchesPeriod,
        }));
  }, [report, filter, query, language]);
  const liveMonths = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return {
          value,
          label: new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
            year: "numeric",
            month: "long",
          }).format(d),
        };
      }),
    [language],
  );
  const titleMonth =
    language === "zh"
      ? `${Number(month.slice(5))} 月`
      : new Intl.DateTimeFormat("en", { month: "long" }).format(
          new Date(`${month}-15T12:00:00`),
        );

  return (
    <div className={`app-shell lang-${language}`}>
      <a className="skip-link" href="#main">
        {language === "zh" ? "跳到报告" : "Skip to report"}
      </a>
      <header className="site-header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setTab("overview");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          aria-label="zmusicstats"
        >
          <span className="brand-disc">
            <i />
          </span>
          <span>
            zmusicstats<span className="brand-period">.</span>
          </span>
        </a>
        <nav
          className="desktop-nav"
          aria-label={language === "zh" ? "报告导航" : "Report navigation"}
        >
          {(["overview", "tracks", "taste"] as Tab[]).map((id) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setQuery("");
              }}
              className={tab === id ? "active" : ""}
            >
              {t[id]}
              {tab === id && (
                <motion.span layoutId="desktop-tab" className="nav-indicator" />
              )}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="language-switch"
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            aria-label={language === "zh" ? t.english : t.chinese}
          >
            {language === "zh" ? "EN" : "中"}
          </button>
          <span className="header-separator" />
          <button
            className="button connect-button"
            onClick={() => setModal("connections")}
          >
            <Plus size={17} />
            <span>{demo ? t.connect : t.accounts}</span>
          </button>
        </div>
      </header>
      <main id="main" className="main-wrap">
        <div className="report-toolbar">
          <div className="report-status">
            <span className={`edition-badge ${demo ? "is-demo" : ""}`}>
              {demo ? t.demo : t.live}
            </span>
            <span className="edition-caption">
              {demo ? t.demoNote : t.sourceData}
            </span>
            {!demo && (
              <button className="text-button" onClick={showDemo}>
                {t.switchDemo}
              </button>
            )}
          </div>
          <label className="period-select">
            <Disc3 size={15} />
            <span className="sr-only">{t.period}</span>
            <select
              value={month}
              onChange={(e) => changeMonth(e.target.value)}
              disabled={syncing}
            >
              {demo
                ? DEMO_MONTHS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m[language]}
                    </option>
                  ))
                : liveMonths.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        <nav
          className="mobile-nav"
          aria-label={language === "zh" ? "报告导航" : "Report navigation"}
        >
          {(["overview", "tracks", "taste"] as Tab[]).map((id) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setQuery("");
              }}
              className={tab === id ? "active" : ""}
            >
              {t[id]}
            </button>
          ))}
        </nav>
        <AnimatePresence mode="wait">
          <motion.div
            key={`${tab}-${month}-${demo}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.28 }}
          >
            {tab === "overview" && (
              <>
                <section className="hero">
                  <div className="hero-copy">
                    <div className="eyebrow">
                      <span className="tiny-line" />
                      {t.eyebrow}
                    </div>
                    <h1>
                      {t.title1}
                      <br />
                      <em>{t.title2}</em>
                    </h1>
                    <p className="hero-subtitle">{t.subtitle}</p>
                    <div className="hero-duration">
                      <span>{t.totalTime}</span>
                      <div>
                        {report.totalHours !== null ? (
                          <>
                            <strong>{report.totalHours.toFixed(1)}</strong>
                            <span>{t.hours}</span>
                          </>
                        ) : (
                          <strong className="missing-duration">
                            —<span>{t.noTime}</span>
                          </strong>
                        )}
                      </div>
                    </div>
                    <div className="hero-meta">
                      <span>
                        <b>{report.sampleSongCount}</b>
                        {t.sampled}
                      </span>
                      <i />
                      <span>
                        <b>{report.platforms.length}</b>
                        {t.platforms}
                      </span>
                    </div>
                    <button
                      className="button primary hero-cta"
                      onClick={() => setModal("poster")}
                    >
                      <Download size={17} />
                      {t.share}
                    </button>
                  </div>
                  <Record report={report} language={language} />
                </section>
                <section
                  className="platform-breakdown"
                  aria-label={t.listeningTime}
                >
                  <div className="platform-heading">
                    <span className="eyebrow">LISTENING TIME</span>
                    <h2>{t.timeSplit}</h2>
                  </div>
                  <div className="platform-values">
                    {report.platforms.map((p) => (
                      <div className="platform-value" key={p.id}>
                        <span className="platform-name">
                          <i style={{ background: p.color }} />
                          {language === "zh" ? p.name : p.nameEn}
                        </span>
                        <div>
                          <strong>
                            {p.hours === null ? "—" : p.hours.toFixed(1)}
                          </strong>
                          <span>{t.hours}</span>
                          {report.platformShares.find((s) => s.id === p.id) && (
                            <small>
                              {report.platformShares
                                .find((s) => s.id === p.id)!
                                .percentage.toFixed(1)}
                              %
                            </small>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!report.durationComparable && (
                    <p className="scope-note duration-note">
                      {report.durationNotice[language]}
                    </p>
                  )}
                </section>
              </>
            )}
            {tab === "tracks" && (
              <div className="page-heading">
                <span className="eyebrow">
                  ON REPEAT · {month.replace("-", ".")}
                </span>
                <h1>{t.fullList}</h1>
                <p>{t.mostPlayedSub}</p>
              </div>
            )}
            {tab === "taste" && (
              <div className="page-heading">
                <span className="eyebrow">
                  YOUR SONIC PALETTE · {month.replace("-", ".")}
                </span>
                <h1>{t.tasteTitle}</h1>
                <p>{t.tasteSub}</p>
              </div>
            )}
            <div
              className={`content-grid ${tab !== "overview" ? "full-content" : ""}`}
            >
              {tab !== "taste" && (
                <section className="tracks-panel">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">ON REPEAT</span>
                      <h2>
                        {tab === "overview" ? t.mostPlayed : t.topCollection}
                      </h2>
                    </div>
                    {tab === "overview" && (
                      <button
                        className="text-button"
                        onClick={() => setTab("tracks")}
                      >
                        {t.viewAll}
                      </button>
                    )}
                  </div>
                  <div className="track-controls">
                    <div className="filter-group" aria-label={t.from}>
                      {(["all", "netease", "qq", "apple"] as Filter[]).map(
                        (id) => (
                          <button
                            key={id}
                            aria-pressed={filter === id}
                            className={filter === id ? "selected" : ""}
                            onClick={() => setFilter(id)}
                          >
                            {t[id]}
                          </button>
                        ),
                      )}
                    </div>
                    {tab === "tracks" && (
                      <label className="search-field">
                        <Search size={16} />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder={t.search}
                          aria-label={t.search}
                        />
                      </label>
                    )}
                  </div>
                  {trackGroups.some((g) => g.tracks.length > 0) ? (
                    trackGroups.map((g, i) => (
                      <div key={g.name || i}>
                        {g.name && (
                          <h3 className="platform-group-heading">{g.name}</h3>
                        )}
                        <TrackRows
                          tracks={g.tracks}
                          language={language}
                          numbered={!g.recent}
                          limit={tab === "overview" ? 5 : undefined}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="empty-state">
                      {query ? t.noResults : t.actualEmpty}
                    </p>
                  )}
                  <p className="scope-note">{report.rankingNotice[language]}</p>
                </section>
              )}
              {tab !== "tracks" && (
                <GenrePanel
                  report={report}
                  language={language}
                  expanded={tab === "taste"}
                />
              )}
            </div>
            {tab !== "tracks" && (
              <section className="insights-section">
                <div className="overlap-panel">
                  <span className="eyebrow">THE COMMON GROUND</span>
                  <h2>{t.overlap}</h2>
                  <p>{t.overlapSub}</p>
                  <div className="overlap-tracks">
                    {report.overlappingTracks.slice(0, 3).map((track) => (
                      <div className="overlap-track" key={track.id}>
                        <Cover index={track.coverIndex} title={track.title} />
                        <div>
                          <strong>{track.title}</strong>
                          <span>{track.artist}</span>
                        </div>
                        <Link2 size={18} />
                      </div>
                    ))}
                  </div>
                  {!report.overlappingTracks.length && (
                    <p className="scope-note">{t.noOverlap}</p>
                  )}
                </div>
                <div className="liner-note">
                  <span className="eyebrow">LINER NOTES</span>
                  <span className="liner-quote" aria-hidden="true">
                    “
                  </span>
                  {report.insights[0] ? (
                    <>
                      <h2>{report.insights[0].title[language]}</h2>
                      <p>{report.insights[0].body[language]}</p>
                    </>
                  ) : (
                    <p>{t.livePeriodHelp}</p>
                  )}
                  <div className="liner-signature">
                    {titleMonth}
                    <span>on record.</span>
                  </div>
                </div>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
        <section className="share-callout">
          <div className="mini-sleeves" aria-hidden="true">
            <div className="mini-sleeve back">
              <div />
            </div>
            <div className="mini-sleeve front">
              <span>
                YOUR
                <br />
                MONTH.
                <br />
                ON RECORD.
              </span>
              <div />
              <small>zmusicstats</small>
            </div>
          </div>
          <div className="share-callout-copy">
            <span className="eyebrow">{t.posterEyebrow}</span>
            <h2>{t.posterTitle}</h2>
            <p>{t.posterDesc}</p>
          </div>
          <button className="button primary" onClick={() => setModal("poster")}>
            <Layers size={17} />
            {t.posterCta}
          </button>
        </section>
        <footer className="site-footer">
          <div className="footer-brand">
            zmusicstats<span>.</span>
            <small>{t.footer}</small>
          </div>
          <div>
            <button className="text-button" onClick={() => setModal("info")}>
              <Info size={14} />
              {t.dataNote}
            </button>
            <span>{t.privacy}</span>
          </div>
        </footer>
      </main>
      <AnimatePresence>
        {modal === "connections" && (
          <Connections
            language={language}
            onClose={closeModal}
            onSync={() => void syncReport()}
            syncing={syncing}
            onDisconnected={disconnectPlatform}
          />
        )}
        {modal === "poster" && (
          <PosterDialog
            report={report}
            language={language}
            onClose={closeModal}
            onToast={setToast}
          />
        )}
        {modal === "info" && (
          <Modal title={t.sourceInfo} closeLabel={t.close} onClose={closeModal}>
            <div className="info-content">
              <p>
                <strong>{demo ? t.currentSample : t.sourceData}</strong>
              </p>
              <p>{report.durationNotice[language]}</p>
              <p>{report.rankingNotice[language]}</p>
              <p>{report.genreScope[language]}</p>
              <p>{t.livePeriodHelp}</p>
              <span className="info-period">
                {report.period.start} — {report.period.end}
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
