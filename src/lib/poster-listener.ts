/** Vector counterpart of components/Record.tsx, using the same 100 20 370 450 viewBox. */
export function drawPosterListener(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
): void {
  const scale = Math.min(box.width / 370, box.height / 450);
  ctx.save();
  ctx.translate(box.x + (box.width - 370 * scale) / 2, box.y + (box.height - 450 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.translate(-100, -20);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const path = (data: string, fill: string | null, stroke: string | null = null, width = 1, opacity = 1) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    const outline = new Path2D(data);
    if (fill) { ctx.fillStyle = fill; ctx.fill(outline); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(outline); }
    ctx.restore();
  };
  const circle = (x: number, y: number, radius: number, fill: string | CanvasGradient | null, stroke: string | CanvasGradient | null = null, width = 1) => {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  };
  const headphone = (x: number, y: number, width: number, height: number, radius: number, angle: number, pivotX: number, pivotY: number, fill: string, stroke: string, lineWidth = 1) => {
    ctx.save(); ctx.translate(pivotX, pivotY); ctx.rotate(angle * Math.PI / 180); ctx.translate(-pivotX, -pivotY);
    ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); ctx.restore();
  };
  const line = "#acb398";
  const skin = "#caba9b";
  const skinLine = "#dfc8a4";

  ctx.save(); ctx.globalAlpha = .065;
  ctx.beginPath(); ctx.ellipse(267, 443, 151, 7, 0, 0, Math.PI * 2); ctx.fillStyle = "#c4b696"; ctx.fill(); ctx.restore();

  path("M202 270c-8 24-11 49-18 76l-23 55-16 23 29 5 22-34 28-55 17-48Z", "#222b21", line, 1.6);
  path("m226 275 26 20 4 39 20 58 25 29-22 10-34-38-26-55-18-36", "#222b21", line, 1.6);
  path("m219 303-10 34-22 49m51-81 3 32 20 51", null, line, 1, .4);
  path("m145 419 32 8-1 10h-46q-10-1-7-6l22-12Zm131-5 22 6 18 10q7 7-3 8h-37l-10-8Z", "#b4ba9f", "#d0d2b9", 1.2);
  path("M193 142q-19 26-17 67l17 67q25 18 63 7l16-56q6-44-27-80l-16-7Z", "#303a2d", line, 1.7);
  path("m190 163 7 40m-3 63q24 9 45 5", null, line, 1, .4);
  path("m202 123-3 22q11 12 28 0l-1-22", skin, skinLine, 1.3);
  path("M243 160q39-21 78-13 46 8 79 33", null, "#88957e", 8);
  path("M173 83q1-39 36-41 36-1 41 36l1 14 7 12-11 5q-4 25-28 25-32 0-41-29Z", skin, skinLine, 1.3);
  path("M175 93q-14-38 12-49 25-17 49 4 13 11 14 30-19-2-32-17-15 19-37 13l-6 19Z", "#1a231b", "#9aab8e", 1.1);
  path("M228 86h1m-1 27q9 1 14-5", null, "#39402e", 2);
  path("M168 86q-5-46 36-50 42-2 49 46", null, "#ce8d62", 3.8);
  headphone(243, 80, 12, 27, 6, -5, 249, 94, "#9e6c4d", "#ce8d62");
  headphone(162, 80, 17, 31, 8, -10, 170, 95, "#ce8d62", "#e3ac80", 1.1);
  path("m170 87 2 16", null, "#4d4735", 1.2, .5);

  const vinyl = ctx.createRadialGradient(298, 209, 0, 298, 209, 171);
  vinyl.addColorStop(0, "#30392d"); vinyl.addColorStop(.45, "#141b15"); vinyl.addColorStop(1, "#090e0a");
  ctx.save(); ctx.shadowColor = "#0004"; ctx.shadowBlur = 9; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 12;
  circle(325, 254, 112, vinyl, "#7b846d"); ctx.restore();
  for (const radius of [106, 101, 96, 91, 86, 81, 76, 71, 66, 61, 56, 51]) circle(325, 254, radius, null, "#bdc5ab29", .55);
  path("M230 215a103 103 0 0 1 63-59m73 193a103 103 0 0 0 58-63", null, "#c5c8af40", 8);
  path("M244 209a93 93 0 0 1 45-38m75 168a93 93 0 0 0 44-44", null, "#d3d4bb", 1, .3);
  circle(325, 254, 44, "#b34c43");
  circle(325, 254, 40, null, "#563c2e45", .6);
  // No rotation surrounds the label, matching the upright monogram on the homepage.
  path("M311 236h28v4l-23 27h18v-5h5v10h-29v-4l23-27h-17v5h-5Z", "#f1ddba");

  path("M185 164q-39 45-29 81 8 27 57 38", null, line, 9);
  path("m207 276 11-2q8-1 9 3l-1 4 8 4q3 3-1 5l-13-3-8 1-8-6Z", skin, skinLine, 1.1);
  path("m216 280 9 1m-9 3 8 2", null, "#83765d");
  path("m391 173 9-2 10 5 6 12q1 4-3 5l-7-9-7-2 4 7q1 4-3 4l-11-13Z", skin, skinLine, 1.1);
  path("m402 177 6 8", null, "#83765d");
  ctx.restore();
}
