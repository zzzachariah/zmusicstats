import { useId, useRef, type ReactNode } from "react";
import { useInView } from "motion/react";
import type { TimeMetaphorAnimation } from "../lib/listening-time";
import "./time-scene.css";

function Earth({ radius = 17 }: { radius?: number }) {
  return <>
    <circle className="ts-earth" cx="50" cy="50" r={radius} />
    <ellipse className="ts-earth-grid" cx="50" cy="50" rx={radius * .48} ry={radius} />
    <path className="ts-earth-grid" d={`M${50 - radius} 50h${radius * 2}`} />
    <path className="ts-earth-shine" d={`M${50 - radius * .68} ${50 - radius * .36}q${radius * .18} ${-radius * .36} ${radius * .5} ${-radius * .4}`} />
  </>;
}

function Star({ x, y, size = 3, className = "" }: { x: number; y: number; size?: number; className?: string }) {
  return <path className={`ts-star ${className}`} d={`M${x} ${y - size}q0 ${size} ${size} ${size}q-${size} 0 -${size} ${size}q0 -${size} -${size} -${size}q${size} 0 ${size} -${size}Z`} />;
}

/** Small illustrations only: motion conveys the metaphor, never a measured rate. */
export function TimeScene({ animation }: { animation: TimeMetaphorAnimation }) {
  const element = useRef<SVGSVGElement>(null);
  const inView = useInView(element, { once: true, amount: .3 });
  const id = useId().replace(/:/g, "");
  let scene: ReactNode;
  switch (animation) {
    case "sunlight":
      scene = <>
        <circle className="ts-sun-halo" cx="19" cy="50" r="16" />
        <circle className="ts-sun" cx="19" cy="50" r="10" />
        <path className="ts-sun-rays" d="M19 28v-5m0 49v5M2 50h4m35 0h5M4 35l-4-4m34 34 4 4M4 65l-4 4m34-34 4-4" />
        <path className="ts-light-path" d="M34 50h37M35 42l35 4M35 58l35-4" />
        <g className="ts-photon"><circle className="ts-light-dot" cx="34" cy="50" r="2" /><path className="ts-light-tail" d="M27 50h5" /></g>
        <g transform="translate(30 0)"><Earth radius={9} /></g>
      </>;
      break;
    case "earth-spin":
      scene = <>
        <defs><clipPath id={`${id}-earth`}><circle cx="50" cy="50" r="29" /></clipPath></defs>
        <path className="ts-axis" d="M38 10l24 80" />
        <circle className="ts-earth" cx="50" cy="50" r="29" />
        <g clipPath={`url(#${id}-earth)`}>
          <g className="ts-globe-turn">
            <path className="ts-land" d="M22 31l11-7 10 5 2 8-8 7-3 12-7-4-4-11Zm37-9 15 7 8 13-6 6-10-4-4-9-7-5ZM47 58l8-8 10 5 3 9-7 14-8-4Z" />
            <ellipse className="ts-earth-grid" cx="36" cy="50" rx="15" ry="31" /><ellipse className="ts-earth-grid" cx="65" cy="50" rx="15" ry="31" />
          </g>
          <path className="ts-earth-grid" d="M17 50h66M24 35q26 8 52 0M24 65q26-8 52 0" />
        </g>
        <path className="ts-spin-arrow" d="M17 40C3 62 25 88 49 84m-5-3 6 3-6 4" />
      </>;
      break;
    case "earth-orbit":
      scene = <>
        <circle className="ts-orbit" cx="50" cy="50" r="35" />
        <circle className="ts-orbit-faint" cx="50" cy="50" r="23" />
        <circle className="ts-sun-halo" cx="50" cy="50" r="15" /><circle className="ts-sun" cx="50" cy="50" r="9" />
        <g className="ts-planet-orbit"><g transform="translate(0 -35)"><Earth radius={6.5} /></g></g>
        <Star x={85} y={72} size={2.2} /><circle className="ts-distant-star" cx="18" cy="78" r="1" />
      </>;
      break;
    case "moon-orbit":
      scene = <>
        <ellipse className="ts-orbit" cx="50" cy="50" rx="38" ry="30" transform="rotate(-24 50 50)" />
        <Earth radius={16} />
        <g className="ts-moon-journey"><circle className="ts-moon" cx="50" cy="17" r="7" /><circle className="ts-crater" cx="48" cy="15" r="2" /></g>
        <Star x={81} y={81} size={2.5} />
      </>;
      break;
    case "moon-phase":
      scene = <>
        <defs><clipPath id={`${id}-moon`}><circle cx="50" cy="48" r="27" /></clipPath></defs>
        <circle className="ts-moon" cx="50" cy="48" r="27" />
        <g clipPath={`url(#${id}-moon)`}>
          <circle className="ts-crater" cx="38" cy="39" r="5" /><circle className="ts-crater" cx="58" cy="60" r="7" /><circle className="ts-crater" cx="61" cy="33" r="3" />
          <circle className="ts-phase-shadow" cx="50" cy="48" r="28" />
        </g>
        <circle className="ts-moon-outline" cx="50" cy="48" r="27" />
        <path className="ts-phase-marks" d="M35 85h2m8 0h2m8 0h2m8 0h2" /><Star x={83} y={21} size={3} />
      </>;
      break;
    case "satellite":
      scene = <>
        <circle className="ts-orbit" cx="50" cy="50" r="34" /><Earth radius={20} />
        <g className="ts-satellite-orbit"><g transform="translate(50 16) rotate(20)">
          <path className="ts-satellite-wire" d="M-13 0h26M0-4v-6l4-3" />
          <rect className="ts-solar-panel" x="-18" y="-7" width="11" height="14" rx="1" /><rect className="ts-solar-panel" x="7" y="-7" width="11" height="14" rx="1" />
          <path className="ts-panel-grid" d="M-14-6V6m21-6h10M-17 0h10m7-6v12m13-12v12" />
          <rect className="ts-satellite-body" x="-4" y="-6" width="8" height="12" rx="2" />
        </g></g>
      </>;
      break;
    case "vinyl":
      scene = <>
        <circle className="ts-record" cx="47" cy="51" r="34" />
        {[28, 24, 20].map(radius => <circle key={radius} className="ts-groove" cx="47" cy="51" r={radius} />)}
        <g className="ts-vinyl-turn"><path className="ts-vinyl-glint" d="M22 43a27 27 0 0 1 17-17M57 75a27 27 0 0 0 15-16" /></g>
        <circle className="ts-record-label" cx="47" cy="51" r="12" />
        <path className="ts-record-z" transform="translate(47 51) scale(.42)" d="M-14-18h28v4l-23 27h18v-5h5v10h-29v-4l23-27h-17v5h-5Z" />
        <path className="ts-tonearm" d="M84 19v32L70 69" /><circle className="ts-tonearm-pivot" cx="84" cy="19" r="4" /><path className="ts-cartridge" d="m68 65 6 4-5 7-6-4Z" />
      </>;
      break;
    case "walk":
      scene = <>
        <path className="ts-ground" d="M14 82h72" /><path className="ts-path-dots" d="M14 89h6m10 0h6m10 0h6m10 0h6" />
        <g className="ts-walker"><circle className="ts-person-head" cx="49" cy="23" r="6" /><path className="ts-person" d="m49 32 1 25" />
          <path className="ts-person ts-walk-arm-a" d="m49 38-14 16" /><path className="ts-person ts-walk-arm-b" d="m49 38 15 10" />
          <path className="ts-person ts-walk-leg-a" d="m50 57-12 22h-5" /><path className="ts-person ts-walk-leg-b" d="m50 57 11 22h5" />
        </g><path className="ts-breeze" d="M70 31h13M74 38h9" />
      </>;
      break;
    case "dance":
      scene = <>
        <ellipse className="ts-stage" cx="50" cy="83" rx="28" ry="4" />
        <g className="ts-dancer"><circle className="ts-person-head" cx="50" cy="23" r="6" /><path className="ts-person" d="M50 33v23" />
          <path className="ts-person ts-dance-arm-a" d="m50 38-14-7-7-12" /><path className="ts-person ts-dance-arm-b" d="m50 38 14-7 7-12" />
          <path className="ts-person ts-dance-leg-a" d="m50 56-14 12 5 12" /><path className="ts-person ts-dance-leg-b" d="m50 56 11 24h6" />
        </g><path className="ts-music-note" d="M78 46V33l8-2v11m-8 4c-6-3-8 5-3 4 2 0 3-2 3-4Zm8-4c-6-3-8 5-3 4 2 0 3-2 3-4Z" />
      </>;
      break;
    case "bloom":
      scene = <>
        <path className="ts-stem" d="M50 53v36m0-10Q33 82 31 67q14-1 19 12m0-9q13 0 18-12-13-2-18 12" />
        <g className="ts-bloom">{Array.from({ length: 7 }, (_, index) => <ellipse key={index} className="ts-petal" cx="50" cy="30" rx="9" ry="20" transform={`rotate(${index * 360 / 7} 50 46)`} />)}<circle className="ts-flower-heart" cx="50" cy="46" r="6" /></g>
      </>;
      break;
    case "film":
      scene = <>
        <path className="ts-projector-beam" d="m72 49 22-13v44L72 65Z" />
        {[34, 60].map(x => <g key={x} className="ts-film-reel" style={{ transformOrigin: `${x}px 31px` }}><circle className="ts-reel" cx={x} cy="31" r="12" />{[0, 120, 240].map(angle => <circle key={angle} className="ts-reel-hole" cx={x} cy="24" r="3" transform={`rotate(${angle} ${x} 31)`} />)}<circle className="ts-pin" cx={x} cy="31" r="1.5" /></g>)}
        <rect className="ts-projector" x="23" y="45" width="45" height="29" rx="5" /><path className="ts-projector-lens" d="m68 51 7-3v22l-7-3Z" /><path className="ts-projector-detail" d="M30 53h17m-17 6h12m-7 15-5 9m25-9 5 9M24 84h40" />
      </>;
      break;
    case "rain":
      scene = <>
        <defs><clipPath id={`${id}-window`}><rect x="20" y="17" width="60" height="65" rx="5" /></clipPath></defs>
        <rect className="ts-window-glass" x="20" y="17" width="60" height="65" rx="5" />
        <g clipPath={`url(#${id}-window)`}>
          <path className="ts-rain ts-rain-a" d="m31 22-4 10m26-16-4 10m21 12-4 10M41 51l-4 10m23-1-4 10m-21 4-4 10" />
          <path className="ts-rain ts-rain-b" d="m42 18-4 9m24 4-4 9m-29 7-4 9m49 9-4 9M49 73l-4 9" />
        </g>
        <rect className="ts-window-frame" x="20" y="17" width="60" height="65" rx="5" /><path className="ts-window-frame" d="M50 17v65M20 51h60M15 86h70" />
      </>;
      break;
    case "tea":
      scene = <>
        <path className="ts-steam ts-steam-a" d="M37 42c-9-8 8-12 0-22" /><path className="ts-steam ts-steam-b" d="M50 39c-9-8 8-12 0-22" /><path className="ts-steam ts-steam-c" d="M62 42c-9-8 8-12 0-22" />
        <path className="ts-cup-handle" d="M72 51h5c17 0 12 22-7 19" /><path className="ts-cup" d="M25 49h48l-4 19c-2 8-9 12-20 12s-18-4-20-12Z" />
        <ellipse className="ts-tea" cx="49" cy="49" rx="24" ry="4" /><path className="ts-saucer" d="M18 82q31 12 62 0M24 88h50" />
      </>;
      break;
    case "bird":
      scene = <>
        <path className="ts-bird-trail" d="M15 66q13-1 19-8M17 74q9-1 14-5" />
        <g className="ts-bird-hover">
          <path className="ts-bird-wing ts-bird-wing-back" d="M48 49Q27 18 19 24q0 18 27 33Z" />
          <path className="ts-bird-body" d="m35 56-16 6 17 3q19 7 29-15l-13-6Z" />
          <path className="ts-bird-wing ts-bird-wing-front" d="M48 50Q33 12 44 15q14 7 13 32Z" />
          <circle className="ts-bird-head" cx="65" cy="43" r="9" /><path className="ts-bird-beak" d="m73 41 17-4" /><circle className="ts-animal-eye" cx="68" cy="40" r="1.3" />
        </g>
        <path className="ts-stem" d="M82 83V62m0 11 7-5" /><path className="ts-petal" d="M82 62q-11-13-3-14l3 6q2-13 7-10l-3 12q10-6 10 0-2 7-14 6Z" />
      </>;
      break;
    case "bee":
      scene = <>
        <path className="ts-bee-trail" d="M12 72q-8-14 8-15 18 1 8 13-7 9-15 5" />
        <g className="ts-bee-hover">
          <ellipse className="ts-bee-wing ts-bee-wing-left" cx="43" cy="38" rx="10" ry="17" transform="rotate(-34 43 38)" />
          <ellipse className="ts-bee-wing ts-bee-wing-right" cx="62" cy="37" rx="10" ry="17" transform="rotate(30 62 37)" />
          <ellipse className="ts-bee-body" cx="51" cy="57" rx="21" ry="13" transform="rotate(-12 51 57)" />
          <path className="ts-bee-stripe" d="m43 46 4 23m7-25 5 23" /><circle className="ts-bee-head" cx="72" cy="51" r="10" />
          <path className="ts-bee-antenna" d="m70 42-2-7m8 7 4-6M34 60l-6 3" /><circle className="ts-animal-eye" cx="76" cy="48" r="1.5" />
        </g>
      </>;
      break;
    case "wave":
      scene = <>
        <defs><clipPath id={`${id}-sea`}><rect x="12" y="17" width="76" height="67" rx="7" /></clipPath></defs>
        <circle className="ts-sea-sun" cx="73" cy="29" r="8" />
        <g clipPath={`url(#${id}-sea)`}>
          <path className="ts-wave-back" d="M2 48q12 12 24 0t24 0 24 0 24 0v36H2Z" />
          <path className="ts-wave-front" d="M5 67q17 3 24-18 7-19 23-10-11-2-10 9 0 10 16 15 13 5 28-1l18 23H5Z" />
          <path className="ts-wave-foam" d="M22 66q13-7 16-21 3-10 14-6m-9 11q9 16 31 16M19 77h15m18 0h12" />
        </g>
      </>;
      break;
    case "train":
      scene = <>
        <defs><clipPath id={`${id}-train`}><rect x="19" y="17" width="62" height="64" rx="12" /></clipPath></defs>
        <rect className="ts-window-glass" x="19" y="17" width="62" height="64" rx="12" />
        <g clipPath={`url(#${id}-train)`}>
          <circle className="ts-sea-sun" cx="67" cy="32" r="7" />
          <g className="ts-train-view"><path className="ts-train-hills" d="m-5 67 25-23 18 14 24-30 31 34 24-17 25 28v15H-5Z" /><path className="ts-train-fields" d="M-5 76q24-19 53-9t60-2M8 83l20-12m24 12 20-12m24 12 20-12" /><path className="ts-train-pole" d="M85 37v53m-8-48h16" /></g>
        </g>
        <rect className="ts-train-frame" x="16" y="14" width="68" height="70" rx="15" /><rect className="ts-window-frame" x="20" y="18" width="60" height="62" rx="11" /><path className="ts-train-sill" d="M13 87h74" />
      </>;
      break;
    case "bicycle":
      scene = <>
        <path className="ts-ground" d="M7 85h86" />
        {[25, 76].map(x => <g key={x}><circle className="ts-bicycle-wheel" cx={x} cy="65" r="17" /><g className="ts-bicycle-spokes" style={{transformOrigin:`${x}px 65px`}}><path d={`M${x - 15} 65h30m-15-15v30`} /></g><circle className="ts-pin" cx={x} cy="65" r="1.5" /></g>)}
        <path className="ts-bicycle-frame" d="m25 65 14-25 13 25H25m27 0 15-25H39m28 0 9 25m-9-25-3-9h9M33 38h12" />
        <g className="ts-cycle-rider"><circle className="ts-person-head" cx="55" cy="18" r="5" /><path className="ts-person" d="m49 26-10 11 14 11-1 17m-5-37 13 9 8-3" /></g>
        <g className="ts-bicycle-pedal"><path className="ts-cycle-crank" d="m46 69 12-8m-14 8h5m7-8h5" /></g>
      </>;
      break;
    case "book":
      scene = <>
        <path className="ts-book-cover" d="M12 27q20-7 38 4 18-11 38-4v51q-20-7-38 4-18-11-38-4Z" />
        <path className="ts-book-page" d="M17 23q18-5 33 7 15-12 33-7v49q-17-4-33 7-16-11-33-7Z" />
        <path className="ts-book-spine" d="M50 31v48" />
        <path className="ts-book-lines" d="m24 36 17 3m-17 6 17 3m-17 6 17 3m18-18 17-3m-17 12 17-3m-17 12 17-3" />
        <path className="ts-book-turn" d="M50 30q11-13 27-12v49q-15 1-27 12Z" />
        <path className="ts-bookmark" d="M68 23v15l4-3 4 1V21" />
      </>;
      break;
    case "stars":
      scene = <>
        <path className="ts-constellation" d="m22 58 18-29 19 15 18 24-28 10-27-20" />
        <Star x={22} y={58} size={4} className="ts-twinkle-a" /><Star x={40} y={29} size={5} className="ts-twinkle-b" /><Star x={59} y={44} size={3} className="ts-twinkle-a" /><Star x={77} y={68} size={5} className="ts-twinkle-b" /><Star x={49} y={78} size={3} />
        <circle className="ts-distant-star" cx="14" cy="27" r="1.3" /><circle className="ts-distant-star" cx="70" cy="19" r="1" /><circle className="ts-distant-star" cx="87" cy="43" r="1.4" />
        <path className="ts-shooting-star" d="m57 12 12 7" />
      </>;
      break;
  }
  return <svg ref={element} className={`time-scene ts-scene ts-scene-${animation}${inView ? " is-in-view" : ""}`} viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false">{scene}</svg>;
}
