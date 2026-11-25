import type { Locale } from "./report.ts";

const messages: Record<string, [string,string]> = {
  BROWSER_STORAGE_UNAVAILABLE: ["浏览器无法保存报告，请检查隐私模式或剩余存储空间。", "This browser cannot save reports. Check private browsing settings and available storage."],
  CLOUD_SERVICE_UNAVAILABLE: ["线上连接服务暂不可用，请稍后重试。", "The connection service is temporarily unavailable. Please retry."],
  CLOUD_NOT_CONFIGURED: ["线上连接服务尚未配置完成。", "The online connection service is not ready yet."],
  QR_RELAY_INTERRUPTED: ["QQ 音乐扫码连接已中断，请重新生成二维码。", "The QQ Music QR connection was interrupted. Generate a new QR code."],
  SESSION_BUSY: ["账号状态正在更新，请稍后重试。", "Your connection is being updated. Please retry shortly."],
  UPSTREAM_TIMEOUT: ["音乐平台响应超时，请稍后重试。", "The music platform timed out. Please retry shortly."],
  RATE_LIMITED: ["请求过于频繁，请稍等一分钟再试。", "Too many requests. Wait a minute and retry."],
  CONNECTION_EXPIRED: ["账号授权已过期，请重新连接。", "Authorization has expired. Connect again."],
  HISTORY_DIRECTORY_UNAVAILABLE: ["暂时无法取得平台的历史月份目录，请重试。已保存的报告仍然保留。", "The platform's history directory is unavailable. Retry; your saved reports are preserved."],
  HISTORY_DIRECTORY_INVALID: ["平台返回的历史月份格式异常，暂未继续读取，请重试。", "The platform returned an invalid history directory. Retry to continue reading."],
  QR_UNAVAILABLE: ["未能生成登录二维码，请重新连接。", "The login QR code could not be created. Try connecting again."],
  QR_CHECK_UNAVAILABLE: ["暂时无法查询授权状态，正在自动重试。", "The authorization status is unavailable. Retrying automatically."],
  QR_STATE_INVALID: ["音乐平台返回了无法识别的授权状态，请重新连接。", "The music platform returned an unexpected authorization status. Connect again."],
  QR_INVALID: ["收到的登录二维码不完整，请重新生成。", "The login QR code is incomplete. Generate another one."],
  APP_LAUNCH_UNAVAILABLE: ["当前登录方式尚未提供可验证的 App 授权入口，可先使用二维码。", "This login method has no verified app authorization link yet. Use its QR code."],
  APP_LAUNCH_UNCONFIRMED: ["尚未确认 App 已打开。请检查是否安装对应 App，或改用二维码；打开 App 本身不代表已授权。", "The app launch has not been confirmed. Check that the app is installed or use the QR code. Opening the app does not complete authorization."],
  APP_AUTH_PENDING: ["尚未收到授权确认，请在音乐 App 内确认后返回本页。", "Authorization is still pending. Confirm in the music app, then return here."],
  MOBILE_AUTH_UNAVAILABLE: ["这次连接暂时无法取得 QQ 音乐 App 授权入口。可以使用二维码，或重新生成后再试。", "The QQ Music app authorization link is unavailable for this attempt. Use the QR code or generate a new one."],
  MOBILE_AUTH_QR_UNREADABLE: ["未能从这次二维码中读取 App 授权入口。二维码仍可用于扫码登录。", "The app authorization link could not be read from this QR. You can still scan the QR code."],
  MOBILE_AUTH_URL_REJECTED: ["未能验证这次 App 授权链接，已保留二维码登录方式。", "This app authorization link could not be verified. QR sign-in is still available."],
  MOBILE_AUTH_REDIRECT_UNAVAILABLE: ["QQ 音乐授权页面暂时无法访问。请使用二维码，或稍后重新生成。", "The QQ Music authorization page is unavailable. Use the QR code or generate another one later."],
  MOBILE_AUTH_TIMEOUT: ["获取 App 授权入口超时。二维码仍然有效，可以扫码继续。", "The app authorization link timed out. The QR code remains available for sign-in."],
  APPLE_NOT_READY: ["Apple Music 登录组件还没准备好，请稍后重试。", "Apple Music sign-in is still preparing. Please retry shortly."],
  APPLE_NOT_CONFIGURED: ["Apple Music 授权服务尚未就绪，请稍后重试。", "The Apple Music authorization service is not ready. Please retry shortly."],
  APPLE_SDK_TIMEOUT: ["Apple Music 登录组件加载超时，请检查网络后重试。", "Apple Music sign-in timed out while loading. Check the connection and retry."],
  APPLE_SDK_FAILED: ["Apple Music 登录组件加载失败，请检查网络或浏览器限制。", "Apple Music sign-in could not load. Check your network or browser restrictions."],
  APPLE_AUTH_CANCELLED: ["Apple Music 授权已取消，可以重新开始。", "Apple Music authorization was cancelled. You can try again."],
  APPLE_AUTH_FAILED: ["未能验证 Apple Music 授权，请确认账号可使用 Apple Music 后重试。", "Apple Music authorization could not be verified. Check the account's Apple Music access and retry."],
  DISCONNECT_FAILED: ["未能断开连接，当前账号仍然保留，请重试。", "The connection could not be removed. Your account is still connected; please retry."],
  NETWORK_ERROR: ["无法连接报告服务，请检查网络后重试。", "Cannot reach the report service. Check your connection and retry."],
};

export async function connectionResponseError(response: Response, fallback: string): Promise<Error> {
  try {const data=await response.json();if(typeof data.error?.code === "string"&&/^[A-Z][A-Z_]{2,64}$/.test(data.error.code))return new Error(data.error.code);} catch { /* Keep an explicit stage when the service returns no usable code. */ }
  return new Error(fallback);
}

export function connectionErrorMessage(error: unknown, locale: Locale): string {
  const raw=error instanceof Error?error.message:"";
  const code=error instanceof Error && (error.name==="TimeoutError" || error.name==="AbortError") ? "UPSTREAM_TIMEOUT" : /^[A-Z][A-Z_]{2,64}$/.test(raw)?raw:"NETWORK_ERROR";
  const pair=messages[code]??["音乐平台未能完成这一步，请重试。", "The music platform could not complete this step. Please retry."];
  return `${pair[locale==="zh"?0:1]} (${code})`;
}
