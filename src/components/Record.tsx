import { useState, type CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { MusicReport } from "../lib/report";
import { copy, type Language } from "../lib/i18n";

export function Record({
  report,
  language,
}: {
  report: MusicReport;
  language: Language;
}) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const t = copy[language];
  const month = report.period.start.slice(5, 7);
  const shares = report.platformShares;
  let cursor = 0;
  const segments = shares
    .map((share) => {
      const start = cursor;
      cursor += share.percentage;
      return `${share.color} ${start}% ${cursor}%`;
    })
    .join(", ");
  const hasTime = report.durationComparable && (report.totalSeconds ?? 0) > 0;
  return (
    <div className="record-stage">
      <div className="record-artwork">
        <div className="record-corner corner-top" />
        <div className="record-corner corner-bottom" />
        <div className="record-sleeve">
          <span>
            PERSONAL
            <br />
            PRESSING
          </span>
          <span>33⅓ RPM</span>
        </div>
        <div className="record-shadow" />
        <div
          className="vinyl"
          role="img"
          aria-label={`${t.timeSplit}: ${shares.map((s) => `${language === "zh" ? s.name : s.nameEn} ${s.percentage.toFixed(1)}%`).join(", ") || t.noTime}`}
        >
          <div
            className="vinyl-grooves"
            style={{
              animationPlayState: paused || reduced ? "paused" : "running",
            }}
          />
          <div className="vinyl-sheen" />
          <div
            className="vinyl-data-ring"
            style={
              {
                "--ring": hasTime
                  ? `conic-gradient(${segments})`
                  : "conic-gradient(#3f4240, #6b6b60, #3f4240)",
              } as CSSProperties
            }
          />
          <svg
            className="record-label"
            viewBox="0 0 200 200"
            aria-hidden="true"
          >
            <circle cx="100" cy="100" r="99" fill="#d6b99d" />
            <circle
              cx="100"
              cy="100"
              r="95"
              fill="none"
              stroke="#bda487"
              strokeWidth=".6"
            />
            <g
              fill="#30372b"
              textAnchor="middle"
              fontFamily="Manrope Variable, sans-serif"
            >
              <text
                x="100"
                y="36"
                fontSize="14"
                fontWeight="650"
                letterSpacing="-.5"
              >
                zmusicstats.
              </text>
              <text
                x="100"
                y="65"
                fontSize="27"
                fontWeight="550"
                letterSpacing="-1.5"
              >
                ON
              </text>
              <text
                x="100"
                y="87"
                fontSize="27"
                fontWeight="550"
                letterSpacing="-1.5"
              >
                RECORD.
              </text>
              <circle
                cx="100"
                cy="102"
                r="6"
                fill="#171b15"
                stroke="#b69b80"
                strokeWidth="2"
              />
              <text x="100" y="128" fontSize="7" letterSpacing="1.4">
                PERSONAL PRESSING
              </text>
              <path d="M45 139H155" stroke="#6e73594f" strokeWidth=".8" />
              <text x="65" y="155" fontSize="8" fontWeight="500">
                {report.period.start.slice(0, 4)} / {month}
              </text>
              <text x="139" y="155" fontSize="8" fontWeight="500">
                STEREO
              </text>
            </g>
          </svg>
        </div>
      </div>
      <div className="record-bottom">
        <span>
          {language === "zh"
            ? "每一次播放，都留下纹路。"
            : "Every listen leaves a groove."}
        </span>
        {!reduced && (
          <button
            className="spin-button"
            onClick={() => setPaused(!paused)}
            aria-label={paused ? t.startSpin : t.stopSpin}
            aria-pressed={!paused}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}
