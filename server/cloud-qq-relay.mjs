import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import { createMqttListenOver } from "@yakult-green-tea/qq-music-api/mqtt";
import { ApiError } from "./adapters.mjs";

const connect = (url, protocol, handlers) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, protocol, { handshakeTimeout: 12_000 });
  socket.on("message", data => handlers.message(data));
  socket.on("close", () => handlers.close());
  socket.on("error", error => { handlers.error(error); reject(new Error("MQTT connection failed")); });
  socket.once("open", () => resolve({ send: data => socket.send(data), close: () => socket.close() }));
});

export function createQqRelay({ store, waitUntil, listen = createMqttListenOver(connect), now = Date.now }) {
  const key = id => `qq-relay:${id}`;
  const unavailable = () => new ApiError(502, "QR_RELAY_INTERRUPTED", "QQ 音乐扫码连接已中断，请重新生成二维码。");
  async function read(id) {
    const { value } = await store.read(key(id));
    if (!value || value.state === "failed" || (value.state === "ready" && now() - value.heartbeat > 45_000)) throw unavailable();
    return value;
  }
  return {
    async open(id, image, ttlMs) {
      const owner = randomBytes(16).toString("hex"), expiresAt = now() + Math.min(ttlMs, 185_000);
      const record = await store.update(key(id), current => current ? undefined : { owner, image, expiresAt, heartbeat: now(), state: "opening", events: [] });
      if (record.owner !== owner) { if (record.state !== "ready") throw unavailable(); return; }
      let writes = Promise.resolve(), failed = false;
      const listener = listen(id, event => {
        writes = writes.then(() => store.update(key(id), current => {
          if (!current || current.owner !== owner || current.state === "closed") return undefined;
          if (current.events.length >= 24) throw unavailable();
          current.events.push(event); current.heartbeat = now(); return current;
        })).catch(() => { failed = true; listener.close(); });
      }, Math.max(1, expiresAt - now()));
      // Always register the finite listener lifetime with the hosting runtime, before returning a QR.
      let interval;
      const lifetime = (async () => {
        try {
          await listener.ready;
          interval = setInterval(() => {
            writes = writes.then(() => store.update(key(id), current => {
              if (!current || current.owner !== owner || current.state === "closed") { listener.close(); return undefined; }
              current.heartbeat = now(); return current;
            })).catch(() => { failed = true; listener.close(); });
          }, 15_000);
          await listener.done;
        } catch { failed = true; }
        finally {
          clearInterval(interval); listener.close(); await writes;
          await store.update(key(id), current => {
            if (!current || current.owner !== owner || current.state === "closed") return undefined;
            current.state = failed ? "failed" : "finished"; return current;
          }).catch(() => {});
        }
      })();
      waitUntil(lifetime);
      try {
        await listener.ready;
        await store.update(key(id), current => {
          if (!current || current.owner !== owner || failed) throw unavailable();
          current.state = "ready"; current.heartbeat = now(); return current;
        });
      } catch { listener.close(); throw unavailable(); }
    },
    async image(id) { return (await read(id)).image; },
    async poll(id) { return (await read(id)).events; },
    async close(id) { await store.update(key(id), current => current ? { ...current, state: "closed" } : undefined); },
  };
}
