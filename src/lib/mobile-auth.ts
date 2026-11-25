const unavailableCodes = ["MOBILE_AUTH_UNAVAILABLE", "MOBILE_AUTH_QR_UNREADABLE", "MOBILE_AUTH_URL_REJECTED", "MOBILE_AUTH_REDIRECT_UNAVAILABLE", "MOBILE_AUTH_TIMEOUT"] as const;
type UnavailableCode = typeof unavailableCodes[number];

export type MobileAuth =
  | { status: "available"; kind: "app-authorization" | "app-scanner"; url: string; expiresAt: number; verification: "device-test-required" }
  | { status: "unavailable"; code: UnavailableCode };

const unavailable: MobileAuth = { status: "unavailable", code: "MOBILE_AUTH_UNAVAILABLE" };

// NetEase's published mobile bundle exposes scancode, not a QR authorization route.
// Do not invent a login scheme or treat opening the scanner as authorization.
const neteaseScanner = "https://music.163.com/m/applink/?scheme=orpheus%3A%2F%2Fscancode";

export function readMobileAuth(provider: string, value: unknown, expiresAt: number): MobileAuth {
  if (provider === "netease" && Number.isFinite(expiresAt)) return {
    status: "available", kind: "app-scanner", url: neteaseScanner, expiresAt, verification: "device-test-required",
  };
  return provider === "qq" ? readQQMobileAuth(value, expiresAt) : unavailable;
}

/** An automatic custom-scheme attempt keeps this report page open for the QR fallback. */
export function mobileLaunchScheme(auth: MobileAuth | undefined): string | null {
  if (auth?.status !== "available") return null;
  if (auth.kind === "app-scanner") return auth.url === neteaseScanner ? "orpheus://scancode" : null;
  const validated = readQQMobileAuth(auth, auth.expiresAt);
  return validated.status === "available" ? new URL(validated.url).searchParams.get("scheme") : null;
}

/** Accept only the QQ Music authorization page wrapped by its official app link. */
export function readQQMobileAuth(value: unknown, expiresAt: number): MobileAuth {
  if (!value || typeof value !== "object") return unavailable;
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "unavailable") return { status: "unavailable", code: unavailableCodes.includes(candidate.code as UnavailableCode)
    ? candidate.code as UnavailableCode : "MOBILE_AUTH_UNAVAILABLE" };
  if (candidate.status !== "available" || candidate.kind !== "app-authorization"
    || candidate.verification !== "device-test-required" || candidate.expiresAt !== expiresAt
    || !Number.isFinite(expiresAt) || typeof candidate.url !== "string") return unavailable;
  try {
    const universal = new URL(candidate.url);
    if (universal.origin !== "https://music.qq.com" || universal.username || universal.password
      || universal.pathname !== "/unilink/download.html" || universal.hash) return unavailable;
    const scheme = new URL(universal.searchParams.get("scheme") || "");
    if (scheme.protocol !== "qqmusic:" || scheme.host !== "qq.com" || scheme.username || scheme.password
      || scheme.pathname !== "/ui/openUrl" || scheme.hash) return unavailable;
    const params = JSON.parse(scheme.searchParams.get("p") || "null");
    if (!params || typeof params.url !== "string" || params._from_outside !== "1") return unavailable;
    const target = new URL(params.url);
    if (target.origin !== "https://y.qq.com" || target.username || target.password
      || target.pathname !== "/m/client/qr_code_login/authorize.html" || target.hash
      || !target.searchParams.get("qrcode_id")?.trim()) return unavailable;
    return { status: "available", kind: "app-authorization", url: candidate.url, expiresAt, verification: "device-test-required" };
  } catch { return unavailable; }
}

export function canOpenMobileAuth(auth: MobileAuth | undefined, qrState: string, now = Date.now()): boolean {
  return auth?.status === "available" && auth.expiresAt > now && (qrState === "waiting" || qrState === "scanned");
}
