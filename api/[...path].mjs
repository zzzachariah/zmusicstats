import { waitUntil } from "@vercel/functions";
import { createCloudApi } from "../server/cloud-api.mjs";
let handler;
export default async function api(request, response) {
  try {
    handler ??= createCloudApi({ waitUntil });
    const chunks = []; let length = 0;
    if (request.body !== undefined) chunks.push(Buffer.from(typeof request.body === "string" ? request.body : Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body)));
    else for await (const chunk of request) {
      length += chunk.length;
      if (length > 32768) { response.writeHead(413, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { code: "REQUEST_TOO_LARGE" } })); return; }
      chunks.push(chunk);
    }
    if (chunks.reduce((size, chunk) => size + chunk.length, 0) > 32768) { response.writeHead(413); response.end(); return; }
    const origin = `https://${request.headers.host}`;
    const controller = new AbortController();
    response.once("close", () => { if (!response.writableEnded) controller.abort(); });
    const input = new Request(new URL(request.url, origin), { method: request.method, headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(chunks), signal: controller.signal });
    const result = await handler(input);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: { code: "CLOUD_NOT_CONFIGURED", message: "线上连接服务尚未就绪。" } }));
  }
}
