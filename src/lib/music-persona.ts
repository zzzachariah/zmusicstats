import type { Localized, MusicReport } from "./report.ts";
import { knownGenreDistribution, unifiedTracks } from "./unified-tracks.ts";

export interface MusicPersona {
  line: Localized;
  evidence: Localized;
  kind: "replay" | "explorer" | "rhythm" | "quiet" | "melody" | "waiting";
}

/** An editorial description of this selection's listening habits, never a personality test. */
export function buildMusicPersona(report: MusicReport): MusicPersona {
  const tracks = unifiedTracks(report).tracks;
  const distribution = knownGenreDistribution(tracks);
  const genres = [...distribution.genres].sort((a, b) => b.percentage - a.percentage);
  const leading = genres[0];
  if (!leading) return {
    kind: "waiting",
    line: { zh: "你的音乐故事，正慢慢显影。", en: "Your listening story is coming into focus." },
    evidence: { zh: "取得本期常听歌曲的曲风资料后，这句话会为你而写。", en: "A portrait will appear when genre tags arrive for this selection." },
  };
  const first = [...tracks].filter(track => typeof track.count === "number" && Number.isFinite(track.count) && track.count > 10)
    .sort((a, b) => b.count! - a.count!)[0];
  const repeated = first && first.count! >= 100;
  let kind: MusicPersona["kind"] = "melody";
  let line: Localized = { zh: "你是把日常过成一段旋律的人。", en: "You turn ordinary days into a melody." };
  const tags = leading.name.toLowerCase();
  if (genres.length >= 5 && leading.percentage < 35) {
    kind = "explorer";
    line = { zh: "你是耳朵很有好奇心，不肯只住在一种声音里的人。", en: "Your curious ears never settle for just one world of sound." };
  } else if (repeated) {
    kind = "replay";
    line = { zh: "你是把熟悉旋律，听成生活背景的人。", en: "You turn familiar melodies into the backdrop of your life." };
  } else if (/rock|metal|electronic|dance|hip.hop|rap|funk/.test(tags)) {
    kind = "rhythm";
    line = { zh: "你是习惯让节拍，替日常加一点劲的人。", en: "You give everyday life a little more rhythm." };
  } else if (/classical|ambient|easy|folk|jazz|piano|instrumental/.test(tags)) {
    kind = "quiet";
    line = { zh: "你是会为一段声音，留出慢下来时间的人。", en: "You make room to slow down and stay with a sound." };
  }
  const genreName = { zh: leading.nameZh, en: leading.nameEn ?? leading.name };
  const share = leading.percentage.toFixed(1);
  const evidence: Localized = {
    zh: `本期已识别的常听样本中，${genreName.zh}占 ${share}%。${kind === "replay" ? `《${first!.title}》在已取得的榜单里出现了 ${first!.count!.toLocaleString("zh-CN")} 次播放。` : kind === "explorer" ? `你的常听歌曲跨越了 ${genres.length} 种曲风。` : "这一句，写的是你在这段时间的听歌习惯。"}`,
    en: `${genreName.en} makes up ${share}% of this selection's identified frequent-song mix. ${kind === "replay" ? `“${first!.title}” has ${first!.count!.toLocaleString("en")} plays in the retrieved rankings.` : kind === "explorer" ? `Your frequent songs span ${genres.length} genres.` : "This line describes how you listened during this period."}`,
  };
  return { line, evidence, kind };
}
