import { useId, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { MusicReport } from "../lib/report";
import type { Language } from "../lib/i18n";
import "./record-companion.css";

export function Record({ language }: { report: MusicReport; language: Language }) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [cycle, setCycle] = useState(0);
  const id = useId().replace(/:/g, "");
  const toggle = () => {
    if (finished) { setCycle(value => value + 1); setFinished(false); setPaused(false); }
    else setPaused(value => !value);
  };
  const controlLabel = finished ? (language === "zh" ? "重播动画" : "Replay animation")
    : paused ? (language === "zh" ? "继续动画" : "Resume animation")
      : (language === "zh" ? "暂停动画" : "Pause animation");

  return <div className={`record-companion${paused ? " is-paused" : ""}`}>
    <svg className="record-companion-art" viewBox="100 20 370 450" role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>{language === "zh" ? "戴着耳机的小人，双手抱着一张黑胶唱片" : "A listener in headphones holding a vinyl record"}</title>
      <defs>
        <radialGradient id={`${id}-vinyl`} cx="38%" cy="30%" r="76%">
          <stop offset="0" stopColor="#30392d" /><stop offset=".45" stopColor="#141b15" /><stop offset="1" stopColor="#090e0a" />
        </radialGradient>
        <linearGradient id={`${id}-glint`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#c5c8af" stopOpacity=".03" /><stop offset=".45" stopColor="#c5c8af" stopOpacity=".45" /><stop offset="1" stopColor="#c5c8af" stopOpacity=".02" />
        </linearGradient>
      </defs>
      <ellipse className="rc-floor" cx="267" cy="443" rx="151" ry="7" />
      <g key={cycle} className="rc-sway" onAnimationEnd={event => { if (event.target === event.currentTarget) setFinished(true); }}>
        <g className="rc-body">
          <path className="rc-trouser" d="M202 270c-8 24-11 49-18 76l-23 55-16 23 29 5 22-34 28-55 17-48Z" />
          <path className="rc-trouser" d="m226 275 26 20 4 39 20 58 25 29-22 10-34-38-26-55-18-36" />
          <path className="rc-seam" d="m219 303-10 34-22 49m51-81 3 32 20 51" />
          <path className="rc-shoe" d="m145 419 32 8-1 10h-46q-10-1-7-6l22-12Zm131-5 22 6 18 10q7 7-3 8h-37l-10-8Z" />
          <path className="rc-shirt" d="M193 142q-19 26-17 67l17 67q25 18 63 7l16-56q6-44-27-80l-16-7Z" />
          <path className="rc-seam" d="m190 163 7 40m-3 63q24 9 45 5" />
          <path className="rc-neck" d="m202 123-3 22q11 12 28 0l-1-22" />
          <path className="rc-arm-back" d="M243 160q39-21 78-13 46 8 79 33" />
          <path className="rc-head" d="M173 83q1-39 36-41 36-1 41 36l1 14 7 12-11 5q-4 25-28 25-32 0-41-29Z" />
          <path className="rc-hair" d="M175 93q-14-38 12-49 25-17 49 4 13 11 14 30-19-2-32-17-15 19-37 13l-6 19Z" />
          <path className="rc-face" d="M228 86h1m-1 27q9 1 14-5" />
          <path className="rc-headband" d="M168 86q-5-46 36-50 42-2 49 46" />
          <rect className="rc-headphone-back" x="243" y="80" width="12" height="27" rx="6" transform="rotate(-5 249 94)" />
          <rect className="rc-headphone" x="162" y="80" width="17" height="31" rx="8" transform="rotate(-10 170 95)" />
          <path className="rc-headphone-detail" d="m170 87 2 16" />
        </g>
        <g className="rc-disc">
          <circle cx="325" cy="254" r="112" fill={`url(#${id}-vinyl)`} stroke="#7b846d" strokeWidth="1" />
          {[106, 101, 96, 91, 86, 81, 76, 71, 66, 61, 56, 51].map(radius => <circle key={radius} className="rc-groove" cx="325" cy="254" r={radius} />)}
          <g className="rc-disc-turn">
            <path d="M230 215a103 103 0 0 1 63-59m73 193a103 103 0 0 0 58-63" fill="none" stroke={`url(#${id}-glint)`} strokeWidth="8" />
            <path className="rc-fine-glint" d="M244 209a93 93 0 0 1 45-38m75 168a93 93 0 0 0 44-44" />
          </g>
          <circle className="rc-label" cx="325" cy="254" r="44" />
          <circle className="rc-label-rule" cx="325" cy="254" r="40" />
          <path className="rc-brand-z" d="M311 236h28v4l-23 27h18v-5h5v10h-29v-4l23-27h-17v5h-5Z" />
        </g>
        <path className="rc-arm-front" d="M185 164q-39 45-29 81 8 27 57 38" />
        <path className="rc-hand" d="m207 276 11-2q8-1 9 3l-1 4 8 4q3 3-1 5l-13-3-8 1-8-6Z" />
        <path className="rc-hand-detail" d="m216 280 9 1m-9 3 8 2" />
        <path className="rc-hand" d="m391 173 9-2 10 5 6 12q1 4-3 5l-7-9-7-2 4 7q1 4-3 4l-11-13Z" />
        <path className="rc-hand-detail" d="m402 177 6 8" />
      </g>
    </svg>
    {!reduced && <button className="record-companion-control" type="button" onClick={toggle} aria-label={controlLabel} title={controlLabel} aria-pressed={!paused && !finished}>
      {paused || finished ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
    </button>}
  </div>;
}
