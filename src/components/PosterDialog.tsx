import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Download, LoaderCircle, Share2 } from "lucide-react";
import { Modal } from "./Modal";
import { copy, type Language } from "../lib/i18n";
import type { MusicReport } from "../lib/report";
import {
  exportPosterSeries,
  downloadPoster,
  planPosterExports,
  parsePosterTrackLimit,
  POSTER_MODULES,
  selectPosterTracks,
  type PosterExport,
  type PosterFormat,
  type PosterModule,
} from "../lib/poster";
import "./poster-options.css";

export function PosterDialog({
  report,
  language,
  onClose,
  onToast,
}: {
  report: MusicReport;
  language: Language;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const t = copy[language];
  const [theme, setTheme] = useState<"ink" | "paper">("ink");
  const [format, setFormat] = useState<PosterFormat>("long");
  const [modules, setModules] = useState<PosterModule[]>([...POSTER_MODULES]);
  const [trackChoice, setTrackChoice] = useState<5 | 10 | 20 | "custom">(5);
  const [customTrackLimit, setCustomTrackLimit] = useState("5");
  const [tracksPerPage, setTracksPerPage] = useState<10 | 20 | 30>(20);
  const [results, setResults] = useState<PosterExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef<AbortController | null>(null);
  const close = useCallback(() => { generation.current?.abort(); onClose(); }, [onClose]);
  const customInputId = useId();
  const availableTracks = useMemo(() => selectPosterTracks(report, Number.MAX_SAFE_INTEGER).length, [report]);
  const trackLimit = trackChoice === "custom" ? parsePosterTrackLimit(customTrackLimit, availableTracks) : Math.min(trackChoice, availableTracks);
  const invalidTrackLimit = modules.includes("tracks") && trackChoice === "custom" && trackLimit === null;
  const trackLimitMessage = language === "zh"
    ? `请输入 1 至 ${availableTracks} 之间的整数。`
    : `Enter a whole number from 1 to ${availableTracks}.`;
  const plannedCount = invalidTrackLimit ? 0 : planPosterExports(report, { language, theme, format, modules, trackLimit: trackLimit ?? 5, tracksPerPage }).length;
  const changeOptions = (update: () => void) => {
    generation.current?.abort();
    setResults([]);
    setLoading(true);
    update();
  };
  useEffect(() => {
    const controller = new AbortController();
    generation.current = controller;
    let cancelled = false;
    let current: PosterExport[] = [];
    setLoading(true);
    setFailed(false);
    setResults([]);
    setProgress({ completed: 0, total: plannedCount });
    if (invalidTrackLimit) {
      setLoading(false);
      return () => { cancelled = true; controller.abort(); };
    }
    const generate = async () => {
      try {
        current = await exportPosterSeries(report, { language, theme, format, modules, trackLimit: trackLimit ?? 5, tracksPerPage }, {
          signal: controller.signal,
          onProgress: (next) => { if (!cancelled) setProgress(next); },
        });
        if (cancelled) {
          current.forEach((r) => URL.revokeObjectURL(r.url));
          return;
        }
        setResults(current);
      } catch {
        if (!cancelled && !controller.signal.aborted) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void generate();
    return () => {
      cancelled = true;
      controller.abort();
      current.forEach((r) => URL.revokeObjectURL(r.url));
    };
  }, [report, language, theme, format, modules, trackChoice, customTrackLimit, trackLimit, invalidTrackLimit, plannedCount, tracksPerPage, attempt]);
  const canExport = !loading && !invalidTrackLimit && results.length > 0;
  const fallbackCovers = results.reduce((count, result) => count + (result.artwork?.fallback ?? 0), 0);
  const toggleModule = (module: PosterModule) => changeOptions(() => setModules((current) => current.includes(module)
    ? current.filter((item) => item !== module) : [...current, module]));
  const moduleLabels: Record<PosterModule, [string, string]> = {
    summary: ["收听概览", "Listening summary"], platforms: ["音乐平台来源", "Platform sources"],
    tracks: ["常听的旋律", "Frequent tracks"], genres: ["音乐底色", "Genre palette"],
    persona: ["音乐画像", "Listening portrait"], overlap: ["跨平台共同歌曲", "Songs across platforms"],
    metaphor: ["时间的另一种形状", "A time comparison"],
  };
  const share = async () => {
    if (!canExport) return;
    const files = results.map(
      (r) => new File([r.blob], r.filename, { type: "image/png" }),
    );
    try {
      if (navigator.canShare?.({ files }))
        await navigator.share({ files, title: "zmusicstats" });
      else onToast(t.shareUnsupported);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        onToast(t.shareUnsupported);
    }
  };
  const formats: { id: PosterFormat; title: string; note: string }[] =
    language === "zh"
      ? [
          { id: "long", title: "完整长图", note: "沿用报告布局，自选包含模块" },
          { id: "cards", title: "系列卡片", note: "按所选内容分成独立卡片" },
          { id: "cover", title: "唱片封面", note: "一张精简的音乐名片" },
        ]
      : [
          {
            id: "long",
            title: "The full story",
            note: "Your report layout, with chosen sections",
          },
          {
            id: "cards",
            title: "A set of cards",
            note: "Separate cards for selected sections",
          },
          {
            id: "cover",
            title: "Record sleeve",
            note: "A concise personal cover",
          },
        ];
  const save = (r: PosterExport) => {
    if (!canExport) return;
    downloadPoster(r);
    onToast(t.saved);
  };
  return (
    <Modal
      title={t.posterTitleModal}
      subtitle={t.posterSub}
      closeLabel={t.close}
      onClose={close}
      wide
    >
      <div className="poster-layout poster-dialog-layout">
        <div className="poster-preview" aria-live="polite" aria-busy={loading}>
          {invalidTrackLimit ? (
            <div className="empty-state poster-input-prompt"><p>{trackLimitMessage}</p><small>{language === "zh" ? "填写歌曲数量后，再生成预览。" : "The preview will update once the track count is valid."}</small></div>
          ) : loading ? (
            <div className="loading-state poster-generating" role="status">
              <LoaderCircle size={25} className="loading-spin" aria-hidden="true" />
              <span>{t.generating}</span>
              <strong>{language === "zh" ? `已生成 ${progress.completed} / ${progress.total || plannedCount} 张` : `${progress.completed} / ${progress.total || plannedCount} images generated`}</strong>
              <div className="poster-generation-meter" role="progressbar" aria-label={language === "zh" ? "海报生成进度" : "Poster generation progress"}
                aria-valuemin={0} aria-valuemax={progress.total || plannedCount} aria-valuenow={progress.completed}>
                <span style={{ width: `${Math.max(2, progress.completed / Math.max(1, progress.total || plannedCount) * 100)}%` }} />
              </div>
              <small>{language === "zh" ? "切换选项会停止上一组生成，关闭即可取消。" : "Changing options stops the previous batch. Close to cancel."}</small>
            </div>
          ) : failed ? (
            <div className="empty-state">
              <p>{t.exportError}</p>
              <button
                className="button"
                onClick={() => setAttempt(attempt + 1)}
              >
                {t.retry}
              </button>
            </div>
          ) : (
            results.map((r, i) => (
              <div className="poster-preview-item" key={r.url}>
                <img
                  src={r.url}
                  alt={`${t.posterTitleModal}${results.length > 1 ? ` ${i + 1}` : ""}`}
                />
                <div className="poster-metadata">
                  <span>
                    PNG · {r.width} × {r.height}
                  </span>
                  <span>
                    {i + 1} / {results.length}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="poster-options">
          <div>
            <span className="option-label">
              {language === "zh" ? "分享形式" : "FORMAT"}
            </span>
            <div className="poster-format-list">
              {formats.map((f) => (
                <button
                  key={f.id}
                  className={format === f.id ? "active" : ""}
                  aria-pressed={format === f.id}
                  onClick={() => { if (format !== f.id) changeOptions(() => setFormat(f.id)); }}
                >
                  <span>
                    {f.title}
                    <small>{f.note}</small>
                  </span>
                  {format === f.id && <Check size={15} />}
                </button>
              ))}
            </div>
          </div>
          <fieldset className="poster-module-options">
            <legend className="option-label">{language === "zh" ? "包含内容" : "INCLUDE"}</legend>
            {POSTER_MODULES.map((module) => <label key={module}>
              <input type="checkbox" checked={modules.includes(module)} onChange={() => toggleModule(module)} />
              <span>{moduleLabels[module][language === "zh" ? 0 : 1]}</span>
            </label>)}
          </fieldset>
          {modules.includes("tracks") && <div className="poster-track-options">
            <span className="option-label">{language === "zh" ? "歌曲范围" : "TRACK SELECTION"}</span>
            <div className="segmented poster-track-presets">
              {([5, 10, 20, "custom"] as const).map((choice) => <button key={choice} aria-pressed={trackChoice === choice} className={trackChoice === choice ? "active" : ""}
                onClick={() => { if (trackChoice !== choice) changeOptions(() => {
                  if (choice === "custom") setCustomTrackLimit(String(trackLimit || 5));
                  setTrackChoice(choice);
                }); }}>
                {choice === "custom" ? (language === "zh" ? "自定义" : "Custom") : `Top ${choice}`}
              </button>)}
            </div>
            {trackChoice === "custom" && <div className="poster-custom-count">
              <label htmlFor={customInputId}>{language === "zh" ? "包含前多少首歌曲" : "Number of leading tracks"}</label>
              <div className="poster-custom-input-row">
                <input id={customInputId} type="number" inputMode="numeric" min={1} max={availableTracks} step={1} value={customTrackLimit}
                  aria-invalid={invalidTrackLimit} aria-describedby={`${customInputId}-hint`}
                  onChange={(event) => changeOptions(() => setCustomTrackLimit(event.target.value))} />
                <span>{language === "zh" ? `首 / 共 ${availableTracks} 首` : `of ${availableTracks} tracks`}</span>
              </div>
              <small id={`${customInputId}-hint`} className={invalidTrackLimit ? "poster-input-error" : ""} role={invalidTrackLimit ? "alert" : undefined}>
                {invalidTrackLimit ? trackLimitMessage : language === "zh" ? "只包含前面选定的歌曲，不会导出其余曲目。" : "Only the chosen leading tracks will be included."}
              </small>
            </div>}
            {trackLimit !== null && trackLimit > 10 && <label className="poster-page-size">{language === "zh" ? "每张歌曲页" : "Tracks per page"}
              <select value={tracksPerPage} onChange={(event) => changeOptions(() => setTracksPerPage(Number(event.target.value) as 10 | 20 | 30))}>
                {[10, 20, 30].map((size) => <option value={size} key={size}>{size} {language === "zh" ? "首" : "tracks"}</option>)}
              </select>
            </label>}
          </div>}
          <p className="poster-export-count" role="status">{invalidTrackLimit ? (language === "zh" ? "等待填写有效歌曲数量" : "Waiting for a valid track count") : language === "zh" ? `将生成 ${plannedCount} 张图片` : `${plannedCount} ${plannedCount === 1 ? "image" : "images"} will be generated`}
            {!invalidTrackLimit && modules.includes("tracks") && <small>{language === "zh" ? `包含前 ${trackLimit} 首歌曲${trackLimit !== null && trackLimit > tracksPerPage ? "，连续编号并分张保存" : ""}。` : `Includes the first ${trackLimit} tracks${trackLimit !== null && trackLimit > tracksPerPage ? ", numbered consecutively across pages" : ""}.`}</small>}
          </p>
          <div>
            <span className="option-label">
              {language === "zh" ? "封面配色" : "COLOURWAY"}
            </span>
            <div className="segmented">
              <button
                className={theme === "ink" ? "active" : ""}
                aria-pressed={theme === "ink"}
                onClick={() => { if (theme !== "ink") changeOptions(() => setTheme("ink")); }}
              >
                {t.posterInk}
              </button>
              <button
                className={theme === "paper" ? "active" : ""}
                aria-pressed={theme === "paper"}
                onClick={() => { if (theme !== "paper") changeOptions(() => setTheme("paper")); }}
              >
                {t.posterPaper}
              </button>
            </div>
          </div>
          <div className="poster-actions">
            {results.length <= 1 && (
              <button
                className="button primary"
                disabled={!canExport}
                onClick={() => results[0] && save(results[0])}
              >
                <Download size={16} />
                {t.saveImage}
              </button>
            )}
            <button
              className={`button ${results.length > 1 ? "primary" : "secondary"}`}
              disabled={!canExport}
              onClick={() => void share()}
            >
              <Share2 size={16} />
              {t.shareImage}
            </button>
          </div>
          {results.length > 1 && (
            <div className="poster-download-list">
              {results.map((r, i) => (
                <button
                  key={r.url}
                  className="small-button"
                  disabled={!canExport}
                  onClick={() => save(r)}
                >
                  <Download size={14} />
                  {language === "zh"
                    ? `保存第 ${i + 1} 张`
                    : `Save card ${i + 1}`}
                </button>
              ))}
            </div>
          )}
          <p className="scope-note">
            {report.mode === "demo" ? t.currentSample : t.sourceData}
            <br />
            {canExport && fallbackCovers > 0 && <>{language === "zh" ? `${fallbackCovers} 处专辑封面未能读取，已用唱片图案代替。` : `${fallbackCovers} album covers were unavailable and use a record illustration.`}<br /></>}
            {language === "zh"
              ? "手机也可以长按预览图保存。"
              : "On your phone, touch and hold an image to save it."}
          </p>
        </div>
      </div>
    </Modal>
  );
}
