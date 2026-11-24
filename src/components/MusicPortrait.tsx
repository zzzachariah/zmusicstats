import { buildMusicPersona } from "../lib/music-persona";
import { useRef } from "react";
import { useInView } from "motion/react";
import type { Locale, MusicReport } from "../lib/report";
import "./music-portrait.css";

export function MusicPortrait({ report, language }: { report: MusicReport; language: Locale }) {
  const portrait = buildMusicPersona(report);
  const element = useRef<HTMLElement>(null);
  const inView = useInView(element, { once: true, amount: .25 });
  const zh = language === "zh";
  return <section ref={element} className={`music-portrait is-${portrait.kind}${inView ? " is-in-view" : ""}`} lang={zh ? "zh-CN" : "en"} aria-label={zh ? "你的音乐画像" : "Your listening portrait"}>
    <div className="music-portrait-art" aria-hidden="true">
      <svg viewBox="0 0 200 200" fill="none">
        <ellipse className="portrait-orbit" cx="100" cy="103" rx="85" ry="78" />
        <path className="portrait-floor" d="M40 166 Q100 176 160 166" />
        <g className="portrait-person">
          <circle className="portrait-head" cx="100" cy="64" r="20" />
          <path className="portrait-phones" d="M76 67v-9a24 24 0 0 1 48 0v9M76 60v14M124 60v14" />
          <path className="portrait-body" d="M100 85v37m0-22-24 16-13-12m37-4 23 17 15-15m-38 20-19 41m19-41 22 41" />
          <path className="portrait-face" d="M96 70q4 4 8 0" />
        </g>
        <g className="portrait-note note-one"><path d="M153 55v18m0-18 12-3v17" /><ellipse cx="149" cy="74" rx="4" ry="3" /><ellipse cx="161" cy="70" rx="4" ry="3" /></g>
        <g className="portrait-note note-two"><path d="M44 84V67l9-3" /><ellipse cx="40" cy="85" rx="4" ry="3" /></g>
        <circle className="portrait-star" cx="52" cy="43" r="2" /><circle className="portrait-star" cx="158" cy="124" r="2" />
      </svg>
      <span>{zh ? "这一期的你" : "YOU, THIS CHAPTER"}</span>
    </div>
    <div className="music-portrait-copy">
      <span className="eyebrow">{zh ? "音乐画像 · A LISTENING PORTRAIT" : "A LISTENING PORTRAIT"}</span>
      <h2>{portrait.line[language]}</h2>
      <p>{portrait.evidence[language]}</p>
      <small>{zh ? "来自所选月份的常听样本 · 随你的音乐而变化" : "Drawn from the selected months · changes with your music"}</small>
    </div>
  </section>;
}
