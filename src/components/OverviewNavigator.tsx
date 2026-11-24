import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Link2 } from "lucide-react";
import type { Language } from "../lib/i18n";
import "./overview-navigator.css";

const sections = [
  { id: "summary", zh: "音乐画像", en: "Portrait" },
  { id: "platforms", zh: "听歌平台", en: "Platforms" },
  { id: "ranking", zh: "歌曲排名", en: "Tracks" },
  { id: "palette", zh: "曲风偏好", en: "Genres" },
  { id: "overlap", zh: "共同偏爱", en: "Shared" },
  { id: "share", zh: "分享海报", en: "Share" },
] as const;
const mobileLabels = { zh: ["画像", "平台", "歌曲", "曲风", "共同偏爱", "分享"], en: ["You", "Apps", "Songs", "Genres", "Shared", "Share"] };

export function OverviewNavigator({ language, onLanguageToggle, onConnections }: {
  language: Language;
  onLanguageToggle?: () => void;
  onConnections?: () => void;
}) {
  const [active, setActive] = useState<string>("summary");
  const [stuck, setStuck] = useState(false);
  const navigation = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const preferred = useRef<string>("summary");
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      setStuck((navigation.current?.getBoundingClientRect().top ?? 1) <= (desktop ? -23.5 : .5));
      const line = Math.min(window.innerHeight * .28, 180);
      const reached = sections.map(section => {
        const element = document.getElementById(`report-${section.id}`);
        return {id:section.id,top:element?.getBoundingClientRect().top ?? Infinity};
      }).filter(section=>section.top<=line);
      const lastTop=Math.max(...reached.map(section=>section.top));
      const row=reached.filter(section=>Math.abs(section.top-lastTop)<3);
      setActive(row.find(section=>section.id===preferred.current)?.id ?? row[0]?.id ?? "summary");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  useEffect(() => {
    const container = rail.current;
    const link = container?.querySelector<HTMLElement>(`[href="#report-${active}"]`);
    if (!container || !link) return;
    const reveal = (smooth = false) => {
      const parent = container.getBoundingClientRect(), item = link.getBoundingClientRect();
      if (item.left < parent.left || item.right > parent.right) {
        container.scrollTo({ left: container.scrollLeft + item.left - parent.left - (parent.width-item.width)/2, behavior: smooth && !reducedMotion ? "smooth" : "auto" });
      }
    };
    reveal(true);
    const resize = () => reveal();
    const observer = new ResizeObserver(resize);
    observer.observe(container); observer.observe(link);
    window.addEventListener("resize",resize);
    return () => {observer.disconnect();window.removeEventListener("resize",resize);};
  }, [active,language,reducedMotion]);
  const goToSection = (id: string) => {
    preferred.current = id;
    setActive(id);
    const target = document.getElementById(`report-${id}`);
    if (!target) return;
    const stickyHeight = window.matchMedia("(min-width: 1024px)").matches ? 56 : 104;
    // Use one offset; browser scroll-padding and section scroll-margin must not add up.
    // The first chapter includes the period toolbar and the extra 24px of the
    // expanded navigation. Returning to it must restore the complete first view.
    window.scrollTo({ top: id === "summary" ? 0 : Math.max(0, window.scrollY + target.getBoundingClientRect().top - stickyHeight),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  };
  return <nav ref={navigation} className={`overview-navigator${stuck ? " is-stuck" : ""}`} aria-label={language === "zh" ? "报告章节导航" : "Report sections"}>
    <div className="overview-navigator-row">
      <a className="overview-brand" href="#report-summary" aria-label={language === "zh" ? "zmusicstats，返回报告开头" : "zmusicstats, back to the beginning"}
        onClick={event => { event.preventDefault(); preferred.current = "summary"; setActive("summary"); window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" }); }}>
        <span className="overview-brand-record" aria-hidden="true" /><span>zmusicstats<span className="overview-brand-period">.</span></span>
      </a>
    <div className="overview-navigator-rail" ref={rail}>
      {sections.map((section,index) => <a key={section.id} href={`#report-${section.id}`} aria-label={section[language]}
        aria-current={active === section.id ? "location" : undefined}
        onClick={event => {
          event.preventDefault();
          goToSection(section.id);
        }}><span className="overview-nav-full">{section[language]}</span><span className="overview-nav-short">{mobileLabels[language][index]}</span>{active === section.id && <motion.span className="overview-nav-indicator" layoutId="overview-section-indicator" aria-hidden="true" transition={reducedMotion ? {duration:0} : {type:"spring",stiffness:380,damping:34}} />}</a>)}
    </div>
    <div className="overview-nav-actions">
      <button className="overview-language" onClick={onLanguageToggle} disabled={!onLanguageToggle} aria-label={language === "zh" ? "Switch to English" : "切换为中文"}>{language === "zh" ? "EN" : "中"}</button>
      <span className="overview-action-divider" aria-hidden="true" />
      <button className="overview-connections" onClick={onConnections} disabled={!onConnections} aria-label={language === "zh" ? "管理音乐平台连接" : "Manage music platform connections"}>
        <Link2 size={15} aria-hidden="true" /><span>{language === "zh" ? "管理连接" : "Manage"}</span>
      </button>
    </div>
    </div>
  </nav>;
}
