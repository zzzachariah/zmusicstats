import { Worker } from "node:worker_threads";
import { handleRequest } from "@yakult-green-tea/qq-music-api/serverless";
let worker, sequence = 0;
const pending = new Map();
function ncm(params, method, signal) {
  if (!worker) {
    worker = new Worker(new URL("./cloud-netease-worker.mjs", import.meta.url), { stdout: true, stderr: true, execArgv: [] });
    worker.stdout.resume(); worker.stderr.resume(); worker.unref();
    worker.on("message", result => pending.get(result.id)?.resolve(result));
    const instance = worker;
    const failed = () => { if (worker !== instance) return; worker = undefined; for (const item of [...pending.values()]) item.reject(new Error("Gateway unavailable")); };
    worker.once("error", failed); worker.once("exit", failed);
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const finish = (callback, value) => { pending.delete(id); signal?.removeEventListener("abort", abort); callback(value); };
    const abort = () => finish(reject, signal.reason ?? new DOMException("Aborted", "AbortError"));
    pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    worker.postMessage({ id, method, params });
  });
}
export function gatewayFetch({ relay, qqSecret, fetchImpl = fetch }) {
  return async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "netease.internal") {
      const params = { ...Object.fromEntries(url.searchParams), ...(init.body ? JSON.parse(init.body) : {}) };
      const result = await ncm(params, url.pathname.slice(1).replaceAll("/", "_"), init.signal);
      return Response.json(result.body, { status: Math.min(599, Math.max(200, result.status)) });
    }
    if (url.hostname === "qq.internal") return handleRequest(new Request(url, init), { QQ_SESSION_SECRET: qqSecret }, { qqRelay: relay });
    return fetchImpl(input, init);
  };
}
