import test from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "./report.ts";
import { getDemoInput } from "./demo-data.ts";
import { buildMusicPersona } from "./music-persona.ts";
import { buildPosterLayout, exportPosterSeries, formatPosterPeriod, parsePosterTrackLimit, planPosterExports, posterArtworkUrl, posterPlatformData, posterTrackPage, selectedPosterModules, selectPosterTracks } from "./poster.ts";
import type { PosterOptions } from "./poster.ts";

test("monthly posters exclude Apple recent tracks with no matching ranking period", () => {
  const input = getDemoInput();
  const apple = input.platforms.find((platform) => platform.id === "apple")!;
  apple.rankingPeriod = null;
  apple.countKind = "unknown";
  apple.countDefinition = null;
  const report = buildReport(input);

  assert.equal(report.rankingMode, "separate");
  assert.ok(
    report.platforms.find((platform) => platform.id === "apple")!.tracks
      .length > 0,
  );
  const selected = selectPosterTracks(report, 10);
  assert.ok(selected.length > 0);
  assert.ok(selected.every((track) => !track.platforms.includes("apple")));
  assert.ok(selected.some((track) => track.platforms.includes("netease")));
  assert.ok(selected.some((track) => track.platforms.includes("qq")));
});

test("monthly poster has no Top tracks when every platform has an unknown ranking period", () => {
  const input = getDemoInput();
  input.platforms.forEach((platform) => {
    platform.rankingPeriod = null;
  });
  const report = buildReport(input);

  assert.ok(report.platforms.every((platform) => platform.tracks.length > 0));
  assert.deepEqual(selectPosterTracks(report, 10), []);
  assert.deepEqual(report.genres, []);
});

test("consecutive months compact into ranges without concealing a gap", () => {
  const report = buildReport(getDemoInput());
  report.periodLabel = { zh: "2026 年 3、4、5、9、10 月", en: "Mar, Apr, May, Sep, Oct 2026" };
  assert.deepEqual(formatPosterPeriod(report), { zh: "2026 年 3 月—5 月、2026 年 9 月—10 月", en: "March–May 2026; September–October 2026" });
  report.periodLabel = { zh: "2025 年 11、12 月；2026 年 1、2 月", en: "Nov, Dec 2025; Jan, Feb 2026" };
  assert.deepEqual(formatPosterPeriod(report), { zh: "2025 年 11 月—2026 年 2 月", en: "November 2025–February 2026" });
  report.periodLabel = { zh: "2026-10-12 至 2026-10-31", en: "12–31 October 2026" };
  assert.equal(formatPosterPeriod(report), report.periodLabel);
  report.periodLabel = { zh: "2026 年 1–3 月；2027 年 5 月", en: "January–March 2026; May 2027" };
  assert.equal(formatPosterPeriod(report), report.periodLabel, "an existing range must not disappear when a later single month is parseable");
});

test("hiding modules removes their layout blocks and shifts later content up", () => {
  const report = buildReport(getDemoInput());
  const full = buildPosterLayout(report, { language: "zh", format: "long" });
  const fewer = buildPosterLayout(report, { language: "zh", format: "long", modules: ["summary", "persona", "tracks", "genres"] });
  assert.ok(fewer.height < full.height);
  assert.deepEqual(fewer.blocks.map((block) => block.module), ["tracks", "genres"]);
  assert.ok(fewer.blocks[0].y < full.blocks.find((block) => block.module === "tracks")!.y);
  assert.equal(fewer.blocks[1].y, fewer.blocks[0].y + fewer.blocks[0].height + 60);
  const portraitOnly = buildPosterLayout(report, { language: "zh", modules: [] });
  assert.deepEqual(portraitOnly.blocks, []);
  assert.ok(portraitOnly.heroHeight < full.heroHeight);
  assert.deepEqual(selectedPosterModules({ language: "zh", modules: ["tracks", "tracks", "summary"] }), ["summary", "tracks"]);
});

test("all-track exports have bounded pages, consecutive offsets and no missing or duplicated rows", () => {
  const report = buildReport(getDemoInput());
  report.rankingMode = "combined";
  const template = report.tracks[0];
  report.tracks = Array.from({ length: 91 }, (_, index) => ({ ...template, id: `track:${index}`, rank: index + 1, title: `Track ${index + 1}` }));
  for (const format of ["long", "cover", "cards"] as const) {
    for (const size of [10, 20, 30] as const) {
      const options: PosterOptions = { language: "en", format, modules: ["tracks"], trackMode: "all", tracksPerPage: size };
      const plans = planPosterExports(report, options);
      const trackPages = plans.filter((plan) => plan.modules?.includes("tracks"));
      assert.equal(trackPages.length, Math.ceil(91 / size));
      const pages = trackPages.map((plan) => posterTrackPage(report, plan));
      assert.deepEqual(pages.flatMap((page) => page.tracks.map((track) => track.id)), report.tracks.map((track) => track.id));
      pages.forEach((page, index) => { assert.equal(page.offset, index * size); assert.ok(page.tracks.length <= size); });
      for (const plan of plans) assert.ok(buildPosterLayout(report, plan).height < 5000);
    }
  }
});

test("series respects all toggles and top five does not silently generate extra track pages", () => {
  const report = buildReport(getDemoInput());
  const plans = planPosterExports(report, { language: "zh", format: "cards", modules: ["summary", "persona", "genres"] });
  assert.deepEqual(plans.map((plan) => plan.section), ["cover", "genres"]);
  assert.deepEqual(plans[0].modules, ["summary", "persona"]);
  assert.equal(posterTrackPage(report, { language: "zh", trackMode: "top5" }).tracks.length, 5);
  assert.equal(posterTrackPage(report, { language: "zh", trackMode: "top5" }).pages, 1);
  assert.equal(planPosterExports(report, { language: "zh", format: "cards", modules: [] }).length, 1);
});

function reportWithTracks(count = 91) {
  const report = buildReport(getDemoInput());
  report.rankingMode = "combined";
  const template = report.tracks[0];
  report.tracks = Array.from({ length: count }, (_, index) => ({ ...template, id: `track:${index}`, rank: index + 1, title: `Track ${index + 1}` }));
  return report;
}

test("explicit Top counts export only the selected prefix with consecutive final-page ranks", () => {
  const report = reportWithTracks();
  for (const count of [5, 10, 20, 37]) {
    for (const format of ["long", "cover", "cards"] as const) {
      for (const size of [10, 20, 30] as const) {
        const options: PosterOptions = { language: "zh", format, modules: ["tracks"], trackLimit: count, tracksPerPage: size };
        const plans = planPosterExports(report, options);
        const trackPlans = plans.filter((plan) => plan.modules?.includes("tracks"));
        assert.equal(trackPlans.length, Math.ceil(count / size));
        assert.equal(plans.length, Math.ceil(count / size) + (format === "cards" ? 1 : 0));
        const pages = trackPlans.map((plan) => posterTrackPage(report, plan));
        assert.deepEqual(pages.flatMap((page) => page.tracks.map((track) => track.rank)), Array.from({ length: count }, (_, index) => index + 1));
        assert.ok(pages.every((page) => page.total === count));
        const last = pages.at(-1)!;
        assert.equal(last.offset + last.tracks.length, count);
        assert.equal(last.tracks.at(-1)!.rank, count);
      }
    }
  }
  assert.equal(posterTrackPage(report, { language: "zh", trackMode: "all", trackLimit: 5 }).total, 5, "explicit limits override legacy all mode");
});

test("custom track input rejects incomplete or out-of-range values while library limits stay bounded", () => {
  for (const value of ["", " ", "0", "-1", "2.5", "1e2", "Infinity", "NaN", "92", "9007199254740992"]) {
    assert.equal(parsePosterTrackLimit(value, 91), null, value);
  }
  assert.equal(parsePosterTrackLimit("37", 91), 37);
  assert.equal(parsePosterTrackLimit(" 5 ", 91), 5);
  assert.equal(parsePosterTrackLimit("1", 0), null);
  const report = reportWithTracks();
  assert.equal(selectPosterTracks(report, 999).length, 91);
  assert.equal(selectPosterTracks(report, -5).length, 1);
  assert.equal(selectPosterTracks(report, NaN).length, 0);
  assert.equal(posterTrackPage(report, { language: "zh", trackLimit: 999 }).total, 91);
});

test("platform chart switches to track-source shares without substituting estimated time", () => {
  const report = buildReport(getDemoInput());
  const actual = posterPlatformData(report);
  assert.equal(actual.actualTime, true);
  assert.equal(actual.total, report.totalSeconds);
  report.durationComparable = false;
  report.platforms[0].listenSeconds = null;
  report.platforms[0].durationAvailable = false;
  report.platforms[0].tracks.push({ ...report.platforms[0].tracks[0] });
  const sample = posterPlatformData(report);
  assert.equal(sample.actualTime, false);
  assert.equal(sample.sources[0].seconds, null);
  assert.equal(sample.sources[0].sampleCount, report.platforms[0].tracks.length - 1);
  assert.equal(sample.total, sample.sources.reduce((sum, source) => sum + source.sampleCount, 0));
  assert.ok(Math.abs(sample.sources.reduce((sum, source) => sum + source.percentage, 0) - 100) < 1e-8);
});

async function withPosterCanvas(
  run: (state: { canvases: { width: number; height: number }[]; created: string[]; revoked: string[]; text: string[]; vectorPaths: string[]; imageDraws: { src: string; coordinates: number[] }[] }) => Promise<void>,
  beforeEncode?: (page: number) => void,
) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalPath = Object.getOwnPropertyDescriptor(globalThis, "Path2D");
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const state = { canvases: [] as { width: number; height: number }[], created: [] as string[], revoked: [] as string[], text: [] as string[], vectorPaths: [] as string[], imageDraws: [] as { src: string; coordinates: number[] }[] };
  Object.defineProperty(globalThis, "Path2D", { configurable: true, value: class {
    constructor(path: string) { state.vectorPaths.push(path); }
  } });
  const context = new Proxy<Record<string, unknown>>({
    measureText: (value: string) => ({ width: Array.from(value).length * 9 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    fillText: (value: string) => state.text.push(value),
    drawImage: (image: { src: string }, ...coordinates: number[]) => state.imageDraws.push({ src: image.src, coordinates }),
  }, { get: (target, key: string) => target[key] ?? (() => undefined) });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: (name: string) => {
      assert.equal(name, "canvas");
      const page = state.canvases.length + 1;
      const canvas = { width: 0, height: 0, getContext: () => context,
        toBlob: (done: (blob: Blob) => void) => { beforeEncode?.(page); queueMicrotask(() => done(new Blob([`page:${page}`], { type: "image/png" }))); },
      };
      state.canvases.push(canvas);
      return canvas;
    },
  } });
  URL.createObjectURL = () => { const url = `blob:test-${state.created.length + 1}`; state.created.push(url); return url; };
  URL.revokeObjectURL = (url) => { state.revoked.push(url); };
  try { await run(state); }
  finally {
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalPath) Object.defineProperty(globalThis, "Path2D", originalPath);
    else Reflect.deleteProperty(globalThis, "Path2D");
  }
}

test("every poster cover pairs the selected persona with the homepage listener, including portrait-only exports", async () => {
  const report = buildReport(getDemoInput());
  for (const format of ["long", "cover", "cards"] as const) {
    for (const language of ["zh", "en"] as const) {
      for (const modules of [["persona", "summary"], ["persona"], []] as PosterOptions["modules"][]) {
        await withPosterCanvas(async (state) => {
          const output = await exportPosterSeries(report, { language, format, modules });
          assert.equal(output.length, 1);
          assert.ok(state.vectorPaths.some((path) => path.startsWith("M193 142")), "the cover contains the listener's torso, not a standalone disc");
          assert.ok(state.vectorPaths.some((path) => path.startsWith("M311 236")), "the held vinyl retains the Z monogram");
          const words = state.text.join("");
          if (modules?.includes("persona")) assert.ok(words.replaceAll(" ", "").includes(buildMusicPersona(report).line[language].replaceAll(" ", "")));
          else assert.ok(words.includes(language === "zh" ? "你的音乐，这一面。" : "Your music,on record."));
        });
      }
    }
  }
});

test("an already cancelled poster job never starts a canvas or reports progress", async () => {
  const controller = new AbortController(); controller.abort();
  let called = false;
  await assert.rejects(exportPosterSeries(buildReport(getDemoInput()), { language: "zh" }, {
    signal: controller.signal, onProgress: () => { called = true; },
  }), { name: "AbortError" });
  assert.equal(called, false);
});

test("poster artwork accepts only public music CDN URLs without credentials", () => {
  assert.equal(posterArtworkUrl("http://p2.music.126.net/cover.jpg"), "https://p2.music.126.net/cover.jpg");
  assert.equal(posterArtworkUrl("https://is1-ssl.mzstatic.com/image/{w}x{h}.{f}"), "https://is1-ssl.mzstatic.com/image/160x160.jpg");
  for (const url of [undefined, "javascript:alert(1)", "data:image/png;base64,abc", "https://evil.example/a.jpg", "https://y.gtimg.cn.evil.example/a.jpg", "https://secret@y.gtimg.cn/a.jpg", "http://127.0.0.1/a.jpg", "https://y.gtimg.cn:8080/a.jpg"]) assert.equal(posterArtworkUrl(url), null);
});

async function withPosterImages(run: (requests: { url: string; crossOrigin: string; referrerPolicy: string }[]) => Promise<void>, onRequest?: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const requests: { url: string; crossOrigin: string; referrerPolicy: string }[] = [];
  class TestImage {
    crossOrigin = "";
    referrerPolicy = "";
    decoding = "";
    naturalWidth = 800;
    naturalHeight = 600;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    currentSrc = "";
    set src(value: string) {
      this.currentSrc = value;
      requests.push({ url: value, crossOrigin: this.crossOrigin, referrerPolicy: this.referrerPolicy });
      onRequest?.();
      queueMicrotask(() => { if (this.currentSrc.includes("failed")) this.onerror?.(); else this.onload?.(); });
    }
    get src() { return this.currentSrc; }
    removeAttribute(name: string) { if (name === "src") this.currentSrc = ""; }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  try { await run(requests); }
  finally {
    if (previous) Object.defineProperty(globalThis, "Image", previous);
    else Reflect.deleteProperty(globalThis, "Image");
  }
}

test("album art follows Top 37 across every format and stays inside each row", async () => {
  const report = reportWithTracks();
  report.tracks.forEach((track, index) => { track.artworkUrl = `https://y.gtimg.cn/track-${index + 1}.jpg`; });
  for (const format of ["long", "cover", "cards"] as const) {
    await withPosterImages(async (requests) => {
      await withPosterCanvas(async (state) => {
        await exportPosterSeries(report, { language: "zh", format, modules: ["tracks"], trackLimit: 37, tracksPerPage: 20 });
        assert.equal(requests.length, 37);
        assert.equal(state.imageDraws.length, 37);
        assert.ok(requests.every((request) => request.crossOrigin === "anonymous" && request.referrerPolicy === "no-referrer"));
        assert.ok(requests.every((request) => request.url.startsWith("/api/artwork?url=")), "canvas art must use the same-origin proxy");
        assert.deepEqual(state.imageDraws.map((draw) => new URL(draw.src, "https://app.example").searchParams.get("url")), report.tracks.slice(0, 37).map((track) => track.artworkUrl));
        assert.ok(state.imageDraws.every(({ coordinates }) => coordinates[0] === 100 && coordinates[1] === 0 && coordinates[2] === 600 && coordinates[3] === 600), "rectangular art is center-cropped, never stretched");
        assert.ok(state.imageDraws.every(({ coordinates }) => coordinates[4] === 143 && coordinates[6] === 50 && coordinates[7] === 50), "covers fit the reserved 50 px column before the text");
        assert.ok(state.text.includes("TOP 37 · 21–37"));
        assert.ok(!state.text.includes("Track 38"));
      });
    });
  }
});

test("failed covers fall back cleanly without removing songs or breaking PNG export", async () => {
  const report = reportWithTracks(5);
  report.tracks[0].artworkUrl = "https://y.gtimg.cn/working.jpg";
  report.tracks[1].artworkUrl = "https://y.gtimg.cn/failed.jpg";
  report.tracks[2].artworkUrl = "https://untrusted.example/cover.jpg";
  await withPosterImages(async (requests) => {
    await withPosterCanvas(async (state) => {
      const output = await exportPosterSeries(report, { language: "en", format: "long", modules: ["tracks"] });
      assert.equal(output.length, 1);
      assert.deepEqual(output[0].artwork, { total: 5, loaded: 1, fallback: 4 });
      assert.equal(requests.length, 2, "untrusted and absent URLs do not make requests");
      assert.equal(state.imageDraws.length, 1);
      for (const track of report.tracks) assert.ok(state.text.includes(track.title));
    });
  });
});

test("cancelling while album covers load stops before drawing or creating a URL", async () => {
  const report = reportWithTracks(37);
  report.tracks.forEach((track, index) => { track.artworkUrl = `https://y.gtimg.cn/track-${index}.jpg`; });
  const controller = new AbortController();
  await withPosterImages(async (requests) => {
    await withPosterCanvas(async (state) => {
      await assert.rejects(exportPosterSeries(report, { language: "en", trackLimit: 37 }, { signal: controller.signal }), { name: "AbortError" });
      assert.equal(requests.length, 1);
      assert.equal(state.canvases.length, 0);
      assert.equal(state.created.length, 0);
    });
  }, () => controller.abort());
});

test("poster summary combines actual time with eligible sample estimates and marks approximation", async () => {
  const report = buildReport(getDemoInput());
  const netease = report.platforms.find((platform) => platform.id === "netease")!;
  const qq = report.platforms.find((platform) => platform.id === "qq")!;
  report.platforms = [netease, qq];
  netease.durationAvailable = true; netease.listenSeconds = 7200; netease.hours = 2;
  qq.durationAvailable = false; qq.listenSeconds = null; qq.hours = null;
  qq.rankingMatchesPeriod = true; qq.rankingCoverage = "partial";
  qq.tracks = [{ ...qq.tracks[0], count: 30, durationSeconds: 120, listenSeconds: undefined }];
  report.totalHours = null; report.totalSeconds = null; report.durationComparable = false;
  await withPosterCanvas(async (state) => {
    await exportPosterSeries(report, { language: "zh", format: "long", modules: ["summary"] });
    assert.ok(state.text.includes("≈ 3"));
    assert.ok(state.text.some((value) => value.includes("榜单样本估算")));
    assert.ok(state.text.some((value) => value.includes("非完整总时长")));
  });
});

test("poster platform duration includes eligible sample estimates without changing source shares", async () => {
  const report = buildReport(getDemoInput());
  const qq = report.platforms.find((platform) => platform.id === "qq")!;
  report.durationComparable = false;
  qq.durationAvailable = false; qq.listenSeconds = null; qq.hours = null;
  qq.rankingMatchesPeriod = true; qq.rankingCoverage = "partial";
  qq.tracks = [{ ...qq.tracks[0], count: 30, durationSeconds: 120, listenSeconds: undefined }];
  const source = posterPlatformData(report).sources.find((platform) => platform.id === "qq")!;
  assert.equal(source.seconds, 3600);
  assert.equal(source.time.kind, "estimated");
  assert.equal(source.value, 1, "the source chart keeps counting tracks, never estimated seconds");
  for (const format of ["long", "cards", "cover"] as const) {
    await withPosterCanvas(async (state) => {
      await exportPosterSeries(report, { language: "zh", format, modules: ["platforms"] });
      assert.ok(state.text.some((value) => /≈ 1 (?:小时|h) · 样本估算/.test(value)));
    });
  }
});

test("cancelling after the first page stops remaining pages and revokes every generated URL", async () => {
  const controller = new AbortController();
  const progress: number[] = [];
  await withPosterCanvas(async (state) => {
    await assert.rejects(exportPosterSeries(buildReport(getDemoInput()), { language: "zh", format: "cards" }, {
      signal: controller.signal,
      onProgress: ({ completed }) => { progress.push(completed); if (completed === 1) controller.abort(); },
    }), { name: "AbortError" });
    assert.deepEqual(progress, [0, 1]);
    assert.equal(state.canvases.length, 1);
    assert.deepEqual(state.revoked, state.created);
    assert.deepEqual(state.canvases[0], { ...state.canvases[0], width: 0, height: 0 });
  });
});

test("cancelling during a later PNG encoding discards that page and cleans earlier pages", async () => {
  const controller = new AbortController();
  await withPosterCanvas(async (state) => {
    await assert.rejects(exportPosterSeries(buildReport(getDemoInput()), { language: "en", format: "cards" }, { signal: controller.signal }), { name: "AbortError" });
    assert.equal(state.canvases.length, 2);
    assert.equal(state.created.length, 1);
    assert.deepEqual(state.revoked, state.created);
    assert.ok(state.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
  }, (page) => { if (page === 2) controller.abort(); });
});

test("successful batches report monotonic progress, yield between pages and retain correct footer dates", async () => {
  const report = buildReport(getDemoInput());
  report.periodLabel = { zh: "2026 年 3、4、5 月", en: "Mar, Apr, May 2026" };
  const progress: { completed: number; total: number }[] = [];
  let taskRan = true;
  await withPosterCanvas(async (state) => {
    const result = await exportPosterSeries(report, { language: "zh", format: "cards", modules: ["tracks", "genres"] }, {
      onProgress: (update) => { assert.ok(taskRan, "the browser task queue must get a turn between pages"); progress.push(update); taskRan = false; setTimeout(() => { taskRan = true; }, 0); },
    });
    assert.deepEqual(progress, [{ completed: 0, total: 3 }, { completed: 1, total: 3 }, { completed: 2, total: 3 }, { completed: 3, total: 3 }]);
    assert.equal(result.length, 3);
    assert.equal(state.revoked.length, 0, "successful result URLs belong to the caller");
    assert.ok(result.every((image) => image.width === 1080 && image.height > 0));
    assert.ok(state.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
    assert.equal(state.text.filter((value) => value === "2026 年 3 月—5 月").length, 6, "each card's heading and footer retain the compact month range");
  });
});

test("changing a count cancels the old batch and only generates the newly requested prefix", async () => {
  const report = reportWithTracks();
  const controller = new AbortController();
  await withPosterCanvas(async (state) => {
    const oldProgress: { completed: number; total: number }[] = [];
    await assert.rejects(exportPosterSeries(report, { language: "zh", format: "long", modules: ["tracks"], trackLimit: 37, tracksPerPage: 10 }, {
      signal: controller.signal,
      onProgress: (progress) => { oldProgress.push(progress); if (progress.completed === 1) controller.abort(); },
    }), { name: "AbortError" });
    const newProgress: { completed: number; total: number }[] = [];
    const result = await exportPosterSeries(report, { language: "zh", format: "long", modules: ["tracks"], trackLimit: 5, tracksPerPage: 10 }, { onProgress: (progress) => newProgress.push(progress) });
    assert.deepEqual(oldProgress, [{ completed: 0, total: 4 }, { completed: 1, total: 4 }]);
    assert.deepEqual(newProgress, [{ completed: 0, total: 1 }, { completed: 1, total: 1 }]);
    assert.equal(state.canvases.length, 2, "old pages 2–4 must never render after a new count is selected");
    assert.deepEqual(state.revoked, [state.created[0]]);
    assert.equal(result.length, 1);
    assert.ok(state.text.includes("TOP 5"));
    assert.ok(!state.text.includes("Track 11"));
  });
});

test("custom Top 37 exports accurate progress and a final page ending at 37", async () => {
  const report = reportWithTracks();
  await withPosterCanvas(async (state) => {
    const progress: { completed: number; total: number }[] = [];
    const result = await exportPosterSeries(report, { language: "zh", format: "long", modules: ["tracks"], trackLimit: 37, tracksPerPage: 20 }, { onProgress: (update) => progress.push(update) });
    assert.equal(result.length, 2);
    assert.deepEqual(progress, [{ completed: 0, total: 2 }, { completed: 1, total: 2 }, { completed: 2, total: 2 }]);
    assert.ok(state.text.includes("TOP 37 · 1–20"));
    assert.ok(state.text.includes("TOP 37 · 21–37"));
    assert.ok(state.text.includes("Track 37"));
    assert.ok(!state.text.includes("Track 38"));
  });
});
