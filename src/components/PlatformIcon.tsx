import { Music2 } from "lucide-react";
import type { PlatformId } from "../lib/report";
import "./platform-icon.css";

export function PlatformIcon({ platform, size = 24 }: { platform: PlatformId; size?: number }) {
  return <span className={`music-platform-icon ${platform}`} style={{ width: size, height: size }} aria-hidden="true">
    {platform === "apple" ? <Music2 size={size * 0.6} strokeWidth={2} /> : <img src={`/platforms/${platform}.ico`} alt="" />}
  </span>;
}
