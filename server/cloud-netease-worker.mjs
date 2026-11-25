import { parentPort } from "node:worker_threads";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Isolated stdout/stderr prevent this third-party library's errors from logging credentials.
const api = require("@neteasecloudmusicapienhanced/api");
const allowed = new Set(["login_qr_key", "login_qr_create", "login_qr_check", "user_account", "listen_data_report", "listen_data_year_report", "listen_data_song_play_rank", "song_detail", "song_wiki_summary", "api"]);
parentPort.on("message", async ({ id, method, params }) => {
  if (!allowed.has(method) || (method === "api" && params.uri !== "/api/vipmusic/newrecord/timedetail")) {
    parentPort.postMessage({ id, status: 404, body: { code: 404 } }); return;
  }
  try {
    const result = await api[method](params);
    parentPort.postMessage({ id, status: result.status ?? 200, body: result.body });
  } catch (error) {
    // Keep the gateway's structured API body, never Axios request/config/error objects.
    parentPort.postMessage({ id, status: Number(error?.status) || 502, body: error?.body ?? { code: 502 } });
  }
});
