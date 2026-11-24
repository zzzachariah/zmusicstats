import { buildReport } from "./report.ts";
import type {
  MusicReport,
  PlatformId,
  ReportInput,
  ReportPeriod,
  TrackInput,
} from "./report.ts";

export type DemoMonth = "2026-10" | "2026-09";

/** Fictional listening counts and classifications for demonstrating the product. */
export const DEMO_MONTHS: { value: DemoMonth; zh: string; en: string }[] = [
  { value: "2026-10", zh: "2026 年 10 月", en: "October 2026" },
  { value: "2026-09", zh: "2026 年 9 月", en: "September 2026" },
];

const CATALOG: Omit<TrackInput, "id" | "count">[] = [
  {
    canonicalId: "demo:lovesong:studio",
    title: "Love Song",
    artist: "方大同",
    album: "未来",
    genres: ["R&B", "Soul"],
    coverIndex: 0,
  },
  {
    canonicalId: "demo:redbean:studio",
    title: "红豆",
    artist: "王菲",
    album: "唱游",
    genres: ["Pop"],
    coverIndex: 1,
  },
  {
    canonicalId: "demo:myjinji:studio",
    title: "My Jinji",
    artist: "落日飞车",
    album: "JINJI KIKKO",
    genres: ["Indie", "Pop"],
    coverIndex: 2,
  },
  {
    canonicalId: "demo:airplane:studio",
    title: "飞机场的10:30",
    artist: "陶喆",
    album: "陶喆",
    genres: ["R&B"],
    coverIndex: 3,
  },
  {
    canonicalId: "demo:slowdancing:studio",
    title: "Slow Dancing in the Dark",
    artist: "Joji",
    album: "BALLADS 1",
    genres: ["R&B", "Pop"],
    coverIndex: 4,
  },
  {
    canonicalId: "demo:sunny:studio",
    title: "晴天",
    artist: "周杰伦",
    album: "叶惠美",
    genres: ["Pop"],
    coverIndex: 5,
  },
  {
    canonicalId: "demo:loveislove:studio",
    title: "爱爱爱",
    artist: "方大同",
    album: "爱爱爱",
    genres: ["R&B", "Soul"],
    coverIndex: 6,
  },
  {
    canonicalId: "demo:comewithme:studio",
    title: "Come Away With Me",
    artist: "Norah Jones",
    album: "Come Away With Me",
    genres: ["Jazz"],
    coverIndex: 7,
  },
  {
    canonicalId: "demo:mountainsea:studio",
    title: "山海",
    artist: "草东没有派对",
    album: "丑奴儿",
    genres: ["Indie", "Rock"],
    coverIndex: 8,
  },
  {
    canonicalId: "demo:mysteryoflove:studio",
    title: "Mystery of Love",
    artist: "Sufjan Stevens",
    album: "Call Me by Your Name",
    genres: [],
    coverIndex: 9,
  },
];

function tracks(
  platform: PlatformId,
  values: [number, number][],
): TrackInput[] {
  return values.map(([catalogIndex, count]) => ({
    ...CATALOG[catalogIndex],
    id: `${platform}:demo:${catalogIndex}`,
    genres: [...CATALOG[catalogIndex].genres],
    count,
  }));
}

export function getDemoInput(month: DemoMonth = "2026-10"): ReportInput {
  const october = month === "2026-10";
  const period: ReportPeriod = {
    start: `${month}-01`,
    end: `${month}-${october ? "31" : "30"}`,
    timeZone: "Asia/Shanghai",
  };
  const neteaseTracks: [number, number][] = october
    ? [
        [0, 86],
        [2, 62],
        [1, 48],
        [4, 37],
        [6, 34],
        [7, 29],
        [8, 23],
        [9, 12],
      ]
    : [
        [2, 72],
        [1, 60],
        [8, 54],
        [7, 41],
        [0, 38],
        [5, 32],
        [4, 24],
        [9, 14],
      ];
  const qqTracks: [number, number][] = october
    ? [
        [0, 42],
        [3, 38],
        [6, 32],
        [1, 25],
        [5, 24],
        [4, 19],
        [7, 13],
        [2, 11],
      ]
    : [
        [5, 51],
        [1, 46],
        [2, 39],
        [3, 36],
        [7, 28],
        [0, 23],
        [6, 17],
        [4, 10],
      ];
  const appleTracks: [number, number][] = october
    ? [
        [7, 72],
        [4, 48],
        [9, 35],
        [2, 31],
        [0, 24],
        [1, 19],
        [6, 12],
        [5, 10],
      ]
    : [
        [4, 67],
        [7, 58],
        [9, 40],
        [2, 34],
        [0, 28],
        [1, 21],
        [5, 14],
        [8, 11],
      ];
  return {
    mode: "demo",
    period,
    expectedPlatforms: ["netease", "qq", "apple"],
    platforms: [
      {
        id: "netease",
        period: { ...period },
        listenSeconds: october ? 218520 : 176400,
        durationKind: "actual-total",
        coverageComplete: true,
        rankingPeriod: { ...period },
        countKind: "plays",
        countDefinition: "fictional-demo-play-v1",
        rankCoverage: "top",
        tracks: tracks("netease", neteaseTracks),
      },
      {
        id: "qq",
        period: { ...period },
        listenSeconds: october ? 138600 : 151920,
        durationKind: "actual-total",
        coverageComplete: true,
        rankingPeriod: { ...period },
        countKind: "plays",
        countDefinition: "fictional-demo-play-v1",
        rankCoverage: "top",
        tracks: tracks("qq", qqTracks),
      },
      {
        id: "apple",
        period: { ...period },
        listenSeconds: october ? 97920 : 118080,
        durationKind: "actual-total",
        coverageComplete: true,
        rankingPeriod: { ...period },
        countKind: "plays",
        countDefinition: "fictional-demo-play-v1",
        rankCoverage: "top",
        tracks: tracks("apple", appleTracks),
      },
    ],
  };
}

export function getDemoReport(month: DemoMonth = "2026-10"): MusicReport {
  return buildReport(getDemoInput(month));
}
