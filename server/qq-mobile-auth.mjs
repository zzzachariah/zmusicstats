import jsQR from "jsqr";
import pngjs from "pngjs";

const { PNG } = pngjs;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const AUTH_PATH = "/m/client/qr_code_login/authorize.html";
const SHORT_PATH = "/base/fcgi-bin/u";
const descriptor = { kind: "app-authorization", verification: "device-test-required" };
class MobileAuthError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function officialUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new MobileAuthError("MOBILE_AUTH_URL_REJECTED"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
    throw new MobileAuthError("MOBILE_AUTH_URL_REJECTED");
  const field = url.hostname === "c6.y.qq.com" && url.pathname === SHORT_PATH ? "__"
    : url.hostname === "y.qq.com" && url.pathname === AUTH_PATH ? "qrcode_id" : null;
  const entries = [...url.searchParams.entries()];
  if (!field || entries.length !== 1 || entries[0][0] !== field || !/^[A-Za-z0-9_-]{1,512}$/.test(entries[0][1]))
    throw new MobileAuthError("MOBILE_AUTH_URL_REJECTED");
  return url;
}

export function decodeQqQrImage(image) {
  const prefix = "data:image/png;base64,";
  if (typeof image !== "string" || !image.startsWith(prefix) || image.length > 1_000_000)
    throw new MobileAuthError("MOBILE_AUTH_QR_UNREADABLE");
  const encoded = image.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new MobileAuthError("MOBILE_AUTH_QR_UNREADABLE");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw new MobileAuthError("MOBILE_AUTH_QR_UNREADABLE");
  // Inspect dimensions before inflation: a tiny compressed image must not allocate huge buffers.
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024)
    throw new MobileAuthError("MOBILE_AUTH_QR_UNREADABLE");
  const decoded = PNG.sync.read(bytes);
  const qr = jsQR(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
  if (!qr?.data) throw new MobileAuthError("MOBILE_AUTH_QR_UNREADABLE");
  return qr.data;
}

export async function resolveQqAuthorizationUrl(qrText, { fetchImpl = fetch, signal } = {}) {
  let url = officialUrl(qrText);
  for (let hop = 0; hop < 3; hop++) {
    if (url.hostname === "y.qq.com") return url.href;
    const response = await fetchImpl(url, {
      method: "GET", redirect: "manual", credentials: "omit", signal,
      headers: { Accept: "text/html", "Cache-Control": "no-store" },
    });
    const location = response.headers.get("location");
    // Only the Location header matters; do not fetch or persist authorization page content.
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status) || !location)
      throw new MobileAuthError("MOBILE_AUTH_REDIRECT_UNAVAILABLE");
    url = officialUrl(new URL(location, url).href);
  }
  if (url.hostname === "y.qq.com") return url.href;
  throw new MobileAuthError("MOBILE_AUTH_REDIRECT_UNAVAILABLE");
}

export async function qqMobileAuth(image, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  try {
    const url = await resolveQqAuthorizationUrl(decodeQqQrImage(image), {
      fetchImpl, signal: AbortSignal.timeout(timeoutMs),
    });
    // These exact two layers come from QQ Music's own music-react SDK. Keep the
    // original QR's qrcode_id inside its authorization page; never launch ui/myTab.
    const scheme = `qqmusic://qq.com/ui/openUrl?p=${encodeURIComponent(JSON.stringify({ url, _from_outside: "1" }))}`;
    return { ...descriptor, status: "available", url: `https://music.qq.com/unilink/download.html?scheme=${encodeURIComponent(scheme)}` };
  } catch (error) {
    const code = error instanceof MobileAuthError ? error.code
      : ["TimeoutError", "AbortError"].includes(error?.name) ? "MOBILE_AUTH_TIMEOUT" : "MOBILE_AUTH_UNAVAILABLE";
    // A missing mobile link never invalidates the original scannable QR. Raw errors can
    // include its short-lived authorization URL, so expose only stable error codes.
    return { ...descriptor, status: "unavailable", code };
  }
}
