import { useEffect, useState } from "react";
import { Check, Download, LoaderCircle, Share2 } from "lucide-react";
import { Modal } from "./Modal";
import { copy, type Language } from "../lib/i18n";
import type { MusicReport } from "../lib/report";
import {
  exportPoster,
  exportPosterSeries,
  downloadPoster,
  type PosterExport,
  type PosterFormat,
} from "../lib/poster";

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
  const [results, setResults] = useState<PosterExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let current: PosterExport[] = [];
    setLoading(true);
    setFailed(false);
    setResults([]);
    const generate = async () => {
      try {
        current =
          format === "cards"
            ? await exportPosterSeries(report, { language, theme })
            : [await exportPoster(report, { language, theme, format })];
        if (cancelled) {
          current.forEach((r) => URL.revokeObjectURL(r.url));
          return;
        }
        setResults(current);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void generate();
    return () => {
      cancelled = true;
      current.forEach((r) => URL.revokeObjectURL(r.url));
    };
  }, [report, language, theme, format, attempt]);
  const share = async () => {
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
          { id: "long", title: "完整长图", note: "时长、Top 10、曲风与洞察" },
          { id: "cards", title: "系列卡片", note: "4 张，可以分开发送" },
          { id: "cover", title: "唱片封面", note: "一张精简的音乐名片" },
        ]
      : [
          {
            id: "long",
            title: "The full story",
            note: "Time, top 10, genres & insights",
          },
          {
            id: "cards",
            title: "A set of cards",
            note: "4 images to share separately",
          },
          {
            id: "cover",
            title: "Record sleeve",
            note: "A concise personal cover",
          },
        ];
  const save = (r: PosterExport) => {
    downloadPoster(r);
    onToast(t.saved);
  };
  return (
    <Modal
      title={t.posterTitleModal}
      subtitle={t.posterSub}
      closeLabel={t.close}
      onClose={onClose}
      wide
    >
      <div className="poster-layout">
        <div className="poster-preview" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="loading-state">
              <LoaderCircle size={22} className="loading-spin" />
              {t.generating}
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
                    PNG · {format === "long" ? "1080 × 2880" : "1080 × 1440"}
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
                  onClick={() => setFormat(f.id)}
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
          <div>
            <span className="option-label">
              {language === "zh" ? "封面配色" : "COLOURWAY"}
            </span>
            <div className="segmented">
              <button
                className={theme === "ink" ? "active" : ""}
                aria-pressed={theme === "ink"}
                onClick={() => setTheme("ink")}
              >
                {t.posterInk}
              </button>
              <button
                className={theme === "paper" ? "active" : ""}
                aria-pressed={theme === "paper"}
                onClick={() => setTheme("paper")}
              >
                {t.posterPaper}
              </button>
            </div>
          </div>
          <div className="poster-actions">
            {format !== "cards" && (
              <button
                className="button primary"
                disabled={loading || !results.length}
                onClick={() => results[0] && save(results[0])}
              >
                <Download size={16} />
                {t.saveImage}
              </button>
            )}
            <button
              className={`button ${format === "cards" ? "primary" : "secondary"}`}
              disabled={loading || !results.length}
              onClick={() => void share()}
            >
              <Share2 size={16} />
              {t.shareImage}
            </button>
          </div>
          {format === "cards" && results.length > 0 && (
            <div className="poster-download-list">
              {results.map((r, i) => (
                <button
                  key={r.url}
                  className="small-button"
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
            {language === "zh"
              ? "手机也可以长按预览图保存。"
              : "On your phone, touch and hold an image to save it."}
          </p>
        </div>
      </div>
    </Modal>
  );
}
