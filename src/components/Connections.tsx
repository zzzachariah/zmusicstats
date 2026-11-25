import { apiFetch } from "../lib/browser-api";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, LoaderCircle, RefreshCw, QrCode, ExternalLink, Download, ListChecks } from "lucide-react";
import { Modal } from "./Modal";
import { PlatformIcon } from "./PlatformIcon";
import { copy, type Language } from "../lib/i18n";
import type { PlatformId } from "../lib/report";
import { prepareAppleMusic, connectAppleMusic } from "../lib/apple-music";
import { connectionErrorMessage, connectionResponseError } from "../lib/connection-errors";
import { canOpenMobileAuth, readMobileAuth, mobileLaunchScheme, type MobileAuth } from "../lib/mobile-auth";
import { IS_BROWSER_STORAGE, IS_UI_PREVIEW, UI_PREVIEW_LABEL, UI_PREVIEW_CONNECTION_REASON } from "../lib/runtime-mode";
import "./connections.css";

type Provider = {
  id: PlatformId;
  name: string;
  configured: boolean;
  connected: boolean;
  methods: string[];
  reasonCode: string | null;
  account: { nickname: string } | null;
};
type QR = {
  id: string;
  qrImage: string;
  expiresAt: number;
  provider: PlatformId;
  attempt: number;
  state: "waiting" | "scanned" | "expired" | "connected";
  mobileAuth?: MobileAuth;
};

interface ConnectionsProps {
  language: Language;
  onClose: () => void;
  onSync: (provider?: PlatformId) => void;
  syncing: boolean;
  onDisconnected: (id: PlatformId) => void;
  open?: boolean;
  embedded?: boolean;
  historyContent?: ReactNode;
  initialTab?: "connections" | "history";
}

/** The preview branch has no authorization actions, SDK setup, or background requests. */
export function Connections(props: ConnectionsProps) {
  return IS_UI_PREVIEW ? <PreviewConnections {...props} /> : <LiveConnections {...props} />;
}

function PreviewConnections({ language, onClose, open = true, embedded = false }: ConnectionsProps) {
  if (!embedded && !open) return null;
  const t = copy[language];
  const content = <div className={`connections-content${embedded ? " connections-embedded" : ""}`}>
    <p className="scope-note">{UI_PREVIEW_LABEL[language]} · {UI_PREVIEW_CONNECTION_REASON[language]}</p>
    <div className="connection-list">
      {(["netease", "qq", "apple"] as const).map(id => <div className="connection-card" key={id}>
        <div className={`platform-icon ${id}`} aria-hidden="true"><PlatformIcon platform={id} size={40} /></div>
        <div className="connection-description"><strong>{t[id]}</strong><span className="connection-availability">{language === "zh" ? "真实连接未启用" : "Real connections disabled"}</span></div>
        <button type="button" className="small-button connection-control" disabled><Link2 size={16} aria-hidden="true" />{language === "zh" ? "预览模式" : "Preview only"}</button>
        <p className="connection-help">{UI_PREVIEW_CONNECTION_REASON[language]}</p>
      </div>)}
    </div>
    <p className="modal-footnote">{language === "zh" ? "可以浏览示例报告、切换月份和导出海报。此版本不会请求音乐账号授权，也不会接收账号凭据或读取真实播放记录。" : "Explore sample reports, switch months, and export posters. This version does not request account authorization, receive credentials, or read real listening records."}</p>
  </div>;
  return embedded ? content : <Modal title={language === "zh" ? "平台连接 · 界面预览" : "Connections · UI preview"} subtitle={UI_PREVIEW_CONNECTION_REASON[language]} closeLabel={t.close} onClose={onClose}>{content}</Modal>;
}

function LiveConnections({
  language, onClose, onSync, syncing, onDisconnected, open: requestedOpen = true, embedded = false, historyContent, initialTab = "connections",
}: ConnectionsProps) {
  const open = embedded || requestedOpen;
  const t = copy[language];
  const [tab, setTab] = useState(initialTab);
  const tabId = useId();
  const [historyHost] = useState(() => document.createElement("div"));
  const historyParking = useRef<HTMLDivElement>(null);
  const historySlot = useRef<HTMLDivElement>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<PlatformId | null>(null);
  const [qr, setQr] = useState<QR | null>(null);
  const [mobileLayout, setMobileLayout] = useState(() => matchMedia("(max-width:600px),(hover:none),(pointer:coarse)").matches);
  const [showQrFallback, setShowQrFallback] = useState(false);
  const [mobileStatus, setMobileStatus] = useState<"idle" | "opening" | "pending" | "checking" | "unconfirmed">("idle");
  const appLaunchQr = useRef<string | null>(null);
  const appLeftPage = useRef(false);
  const appLaunchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const checkQrNow = useRef<(() => void) | null>(null);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [apple, setApple] = useState<Awaited<ReturnType<typeof prepareAppleMusic>> | null>(null);
  const mounted = useRef(false);
  const actionSequence = useRef(0);
  const refreshSequence = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  const completedLogins = useRef(new Set<string>());
  const onSyncRef = useRef(onSync);
  const copyRef = useRef(t);
  const languageRef = useRef(language); languageRef.current = language;
  onSyncRef.current = onSync;
  copyRef.current = t;

  useEffect(() => {
    const media = matchMedia("(max-width:600px),(hover:none),(pointer:coarse)");
    const update = () => setMobileLayout(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  useLayoutEffect(() => {
    // Keep the portal target stable: moving its DOM host does not remount HistoryImport.
    // Modal itself only exists while open, so its focus trap and body lock stay scoped.
    const destination = open ? historySlot.current : historyParking.current;
    destination?.appendChild(historyHost);
    historyHost.hidden = !open || tab !== "history";
    return () => { historyHost.remove(); };
  }, [open, tab, historyHost, embedded]);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 10000);
    try {
      const response = await apiFetch("/api/connections", { signal: controller.signal });
      if (!response.ok) throw new Error("CONNECTIONS_UNAVAILABLE");
      const data = await response.json();
      if (!Array.isArray(data.providers)) throw new Error("CONNECTIONS_INVALID");
      if (!mounted.current || controller.signal.aborted || sequence !== refreshSequence.current) return;
      setProviders(data.providers);
      setRefreshError("");
    } catch {
      if (mounted.current && !signal?.aborted && sequence === refreshSequence.current) {
        setRefreshError(copyRef.current.backendOffline);
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (mounted.current && !signal?.aborted && sequence === refreshSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      actionSequence.current++;
      actionController.current?.abort();
      clearTimeout(appLaunchTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [open, refresh]);

  useEffect(() => {
    if (!IS_BROWSER_STORAGE || open || !qr || qr.state === "connected") return;
    const id = qr.id, provider = qr.provider;
    actionSequence.current++; actionController.current?.abort();
    void apiFetch(`/api/auth/${provider}/qr/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).finally(() => setQr(current => current?.id === id ? null : current));
  }, [open, qr]);

  const appleConfigured = providers.some(provider => provider.id === "apple" && provider.configured);
  useEffect(() => {
    if (!open || !appleConfigured || apple) return;
    let cancelled = false;
    prepareAppleMusic()
      .then(instance => { if (!cancelled) setApple(instance); })
      .catch(error => { if (!cancelled) setError(connectionErrorMessage(error,languageRef.current)); });
    return () => { cancelled = true; };
  }, [open, appleConfigured, apple]);

  const finishConnection = useCallback(async (
    key: string, provider: PlatformId, attempt: number, signal: AbortSignal,
  ) => {
    if (!mounted.current || signal.aborted || attempt !== actionSequence.current || completedLogins.current.has(key)) return;
    completedLogins.current.add(key);
    setBusy(provider);
    setError("");
    // Authorization already succeeded. A slow nickname lookup must not make it look disconnected.
    setProviders(current => current.map(item => item.id === provider ? { ...item, connected: true } : item));
    await refresh(signal);
    if (!mounted.current || signal.aborted || attempt !== actionSequence.current) return;
    setBusy(null);
    setTab("history");
    onSyncRef.current(provider);
  }, [refresh]);

  // Depend on the QR identity, not its state. Marking a login connected must not abort
  // the nickname refresh and automatic report sync that follow the successful poll.
  const qrId = qr?.id;
  const qrProvider = qr?.provider;
  const qrExpiresAt = qr?.expiresAt;
  const qrAttempt = qr?.attempt;
  useEffect(() => {
    if (!qrId || !qrProvider || qrExpiresAt === undefined || qrAttempt === undefined) return;
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    const currentAttempt = () => mounted.current && qrAttempt === actionSequence.current;
    const expire = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      clearTimeout(expiryTimer);
      controller.abort();
      if (!currentAttempt()) return;
      setQr(current => current?.id === qrId ? { ...current, state: "expired" } : current);
      clearTimeout(appLaunchTimer.current);
      setMobileStatus("idle");
      setError("");
    };
    const schedule = (delay: number) => {
      if (stopped || controller.signal.aborted) return;
      const remaining = qrExpiresAt - Date.now();
      if (remaining <= 0) { expire(); return; }
      timer = setTimeout(poll, Math.min(delay, remaining));
    };
    const poll = async () => {
      if (stopped || polling || !currentAttempt()) return;
      if (Date.now() >= qrExpiresAt) { expire(); return; }
      polling = true;
      try {
        const response = await apiFetch(`/api/auth/${qrProvider}/qr/${encodeURIComponent(qrId)}`, { signal: controller.signal });
        if (controller.signal.aborted || !currentAttempt()) return;
        if (response.status === 404 || response.status === 410) { expire(); return; }
        if (!response.ok) throw await connectionResponseError(response,"QR_CHECK_UNAVAILABLE");
        const result = await response.json();
        if (controller.signal.aborted || !currentAttempt()) return;
        if (result.state === "expired") { expire(); return; }
        if (!["waiting", "scanned", "connected"].includes(result.state)) throw new Error("QR_STATE_INVALID");
        setError("");
        setQr(current => current?.id === qrId ? { ...current, state: result.state } : current);
        if (appLaunchQr.current === qrId) {
          if (result.state !== "connected" && appLeftPage.current && document.visibilityState === "visible") setShowQrFallback(true);
          setMobileStatus(current => result.state === "connected" ? "idle"
            : result.state === "scanned" || current === "checking" ? "pending" : current);
        }
        if (result.state === "connected") {
          stopped = true;
          clearTimeout(appLaunchTimer.current);
          clearTimeout(expiryTimer);
          await finishConnection(`qr:${qrId}`, qrProvider, qrAttempt, controller.signal);
          return;
        }
        schedule(2500);
      } catch (error) {
        if (controller.signal.aborted || stopped || !currentAttempt()) return;
        if (appLaunchQr.current === qrId) {
          setShowQrFallback(true);
          setMobileStatus(current => current === "checking" ? "pending" : current);
        }
        setError(connectionErrorMessage(error,languageRef.current));
        schedule(5000);
      } finally { polling=false; }
    };
    const checkNow = () => {
      if (stopped) return;
      if (appLaunchQr.current === qrId) setMobileStatus("checking");
      clearTimeout(timer);
      void poll();
    };
    checkQrNow.current = checkNow;
    const resume = () => {
      if (appLaunchQr.current === qrId) {
        clearTimeout(appLaunchTimer.current);
        if (document.visibilityState !== "visible") { appLeftPage.current = true; setMobileStatus("pending"); }
      }
      if (document.visibilityState === "visible") checkNow();
    };
    document.addEventListener("visibilitychange",resume);
    window.addEventListener("pageshow",resume);
    expiryTimer = setTimeout(expire, Math.max(0, qrExpiresAt - Date.now()));
    schedule(1800);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(expiryTimer);
      clearTimeout(appLaunchTimer.current);
      if (checkQrNow.current === checkNow) checkQrNow.current = null;
      document.removeEventListener("visibilitychange",resume);
      window.removeEventListener("pageshow",resume);
    };
  }, [qrId, qrProvider, qrExpiresAt, qrAttempt, finishConnection]);

  const launchApp = (challenge: QR, automatic = false) => {
    const scheme = mobileLaunchScheme(challenge.mobileAuth);
    if (!scheme || !canOpenMobileAuth(challenge.mobileAuth, challenge.state)) {
      setShowQrFallback(true);
      return false;
    }
    appLaunchQr.current = challenge.id;
    appLeftPage.current = false;
    setShowQrFallback(false);
    setMobileStatus("opening");
    clearTimeout(appLaunchTimer.current);
    appLaunchTimer.current = setTimeout(() => {
      if (mounted.current && appLaunchQr.current === challenge.id && document.visibilityState === "visible") {
        setMobileStatus("unconfirmed");
        setShowQrFallback(true);
      }
    }, 3500);
    if (automatic) {
      try { window.location.assign(scheme); }
      catch { clearTimeout(appLaunchTimer.current); setMobileStatus("unconfirmed"); setShowQrFallback(true); }
    }
    return true;
  };

  const connect = async (provider: PlatformId) => {
    const attempt = ++actionSequence.current;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(provider); setError(""); setQr(null);
    appLaunchQr.current = null; appLeftPage.current = false; clearTimeout(appLaunchTimer.current); setMobileStatus("idle"); setShowQrFallback(false);
    try {
      if (provider === "apple") {
        if (!apple) throw new Error("APPLE_NOT_READY");
        await connectAppleMusic(apple);
        await finishConnection(`apple:${attempt}`, provider, attempt, controller.signal);
        return;
      }
      const response = await apiFetch(`/api/auth/${provider}/qr`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal,
      });
      if (!response.ok) throw await connectionResponseError(response,"QR_UNAVAILABLE");
      const data = await response.json();
      if (!mounted.current || controller.signal.aborted || attempt !== actionSequence.current) return;
      if (typeof data.id !== "string" || typeof data.qrImage !== "string" || !data.qrImage.startsWith("data:image/")
        || typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)) throw new Error("QR_INVALID");
      setError("");
      const challenge: QR = { id: data.id, qrImage: data.qrImage, expiresAt: data.expiresAt, provider, attempt, state: "waiting",
        mobileAuth: readMobileAuth(provider, data.mobileAuth, data.expiresAt),
      };
      setQr(challenge);
      if (mobileLayout) launchApp(challenge, true);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && attempt === actionSequence.current) setError(connectionErrorMessage(error,languageRef.current));
    } finally {
      if (mounted.current && attempt === actionSequence.current) setBusy(null);
    }
  };

  const disconnect = async (id: PlatformId) => {
    const attempt = ++actionSequence.current;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(id); setError(""); setQr(null);
    try {
      const response = await apiFetch(`/api/connections/${id}`, { method: "DELETE", signal: controller.signal });
      if (!response.ok) throw await connectionResponseError(response,"DISCONNECT_FAILED");
      if (!mounted.current || controller.signal.aborted || attempt !== actionSequence.current) return;
      setProviders(current => current.map(item => item.id === id ? { ...item, connected: false, account: null } : item));
      onDisconnected(id);
      await refresh(controller.signal);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && attempt === actionSequence.current) setError(connectionErrorMessage(error,languageRef.current));
    } finally {
      if (mounted.current && attempt === actionSequence.current) setBusy(null);
    }
  };

  const connected = providers.some(provider => provider.connected);
  const qrActive = qr?.state === "waiting" || qr?.state === "scanned";
  const qrVisible = !mobileLayout || showQrFallback;
  const mobileMessage = mobileStatus === "opening"
    ? (language === "zh" ? `正在尝试打开${qr ? t[qr.provider] : "App"}…` : `Trying to open ${qr ? t[qr.provider] : "the app"}…`)
    : mobileStatus === "checking"
      ? (language === "zh" ? "正在检查这次连接的授权结果…" : "Checking authorization for this connection…")
      : mobileStatus === "unconfirmed"
        ? connectionErrorMessage(new Error("APP_LAUNCH_UNCONFIRMED"), language)
        : mobileStatus === "pending" ? connectionErrorMessage(new Error("APP_AUTH_PENDING"), language) : "";
  const content = <div className={`connections-content${embedded ? " connections-embedded" : ""}`}>
      <div className="connection-tabs" role="tablist" aria-label={language === "zh" ? "连接管理" : "Connection management"}>
        {(["connections", "history"] as const).map((item, index) => <button
          key={item} id={`${tabId}-${item}-tab`} role="tab" aria-selected={tab === item}
          aria-controls={`${tabId}-${item}-panel`} tabIndex={tab === item ? 0 : -1}
          onClick={() => setTab(item)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "connections" : event.key === "End" ? "history" : index === 0 ? "history" : "connections";
            setTab(next); document.getElementById(`${tabId}-${next}-tab`)?.focus();
          }}>
          {item === "connections" ? <Link2 size={16} aria-hidden="true" /> : <ListChecks size={16} aria-hidden="true" />}
          {item === "connections" ? (language === "zh" ? "平台连接" : "Platforms") : (language === "zh" ? "读取详情" : "Import details")}
          {item === "history" && syncing && <span className="connection-tab-dot" aria-label={t.syncing} />}
        </button>)}
      </div>
      <section id={`${tabId}-connections-panel`} role="tabpanel" aria-labelledby={`${tabId}-connections-tab`} hidden={tab !== "connections"}>
      {loading && <div className={`loading-state${providers.length ? " connection-refreshing" : ""}`} role="status"><LoaderCircle className="loading-spin" aria-hidden="true" />{t.loading}</div>}
      {providers.length > 0 && <div className="connection-list">
        {providers.map(provider => <div className={`connection-card${provider.connected ? " is-connected" : ""}`} key={provider.id}>
          <div className={`platform-icon ${provider.id}`} aria-hidden="true"><PlatformIcon platform={provider.id} size={40} /></div>
          <div className="connection-description">
            <strong>{t[provider.id]}</strong>
            {provider.connected ? <div className="connection-account">
              <span className="connection-nickname">{provider.account?.nickname?.trim() || (language === "zh" ? "账号已授权" : "Account authorized")}</span>
              <span className="connection-status"><Check size={12} aria-hidden="true" />{t.connected}</span>
            </div> : <span className="connection-availability">{provider.configured ? t.notConnected : t.unavailable}</span>}
          </div>
          {provider.connected ? <button className="quiet-button connection-control" disabled={!!busy || syncing} onClick={() => void disconnect(provider.id)} aria-label={`${t.disconnect} ${t[provider.id]}`}>{busy === provider.id ? <LoaderCircle size={15} className="loading-spin" aria-hidden="true" /> : null}{t.disconnect}</button>
            : <button className="small-button connection-control" disabled={!provider.configured || !!busy || syncing || (provider.id === "apple" && !apple)} onClick={() => void connect(provider.id)}>
              {busy === provider.id ? <LoaderCircle size={16} className="loading-spin" aria-hidden="true" /> : provider.id === "apple" ? <Link2 size={16} aria-hidden="true" /> : mobileLayout ? <ExternalLink size={16} aria-hidden="true" /> : <QrCode size={16} aria-hidden="true" />}
              {provider.id === "apple" ? (language === "zh" ? "Apple 账号授权" : embedded ? "Authorize" : "Authorize Apple") : mobileLayout ? (language === "zh" ? "打开 App 连接" : "Connect") : embedded && language === "en" ? "Connect" : t.connectButton}
            </button>}
          {!provider.configured && <p className="connection-help">{t.unavailableHelp}</p>}
        </div>)}
      </div>}
      {qr && <div className={`qr-section${mobileLayout && qrActive ? " qr-section-mobile-app" : ""}`}>
        {qr.state === "connected" ? <div className="qr-complete" role="status"><Check size={42} aria-hidden="true" /><strong>{t.connected}</strong>{syncing && <span>{t.syncing}</span>}</div>
          : qr.state === "expired" ? <div className="qr-complete" role="status"><p>{t.qrExpired}</p><button className="button" disabled={!!busy || syncing} onClick={() => void connect(qr.provider)}><RefreshCw size={16} aria-hidden="true" />{t.retry}</button></div>
            : <div className="qr-visual" hidden={!qrVisible}>
              <div className="qr-paper"><img src={qr.qrImage} width="200" height="200" alt={`${t[qr.provider]} — ${t.connectButton}`} /></div>
              <strong role="status" aria-live="polite">{qr.state === "scanned" ? t.qrScanned : t.qrWait}</strong>
              <p>{t.qrHint}</p>
            </div>}
        {qrActive && mobileLayout && <div className="mobile-login-tools">
          <strong>{language === "zh" ? "先在 App 中继续" : "Continue in the app"}</strong>
          <p>{qr.provider === "netease"
            ? (language === "zh" ? "网易云会尝试打开扫一扫。此入口仍需识别二维码；返回本页后可保存图片，再从扫一扫的相册中选择。" : "NetEase opens its scanner. It still needs the QR image: return here to save it, then select it from the scanner’s photo library.")
            : (language === "zh" ? "在 QQ 音乐中确认本次连接。返回后自动检查；未完成时会展开同一次连接的二维码。" : "Confirm this connection in QQ Music. We check when you return and reveal the same QR if authorization is incomplete.")}</p>
          {qr.mobileAuth?.status === "available" ? <a className="small-button mobile-app-authorize" href={qr.mobileAuth.url}
            target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
            onClick={event => { if (!launchApp(qr)) event.preventDefault(); }}>
            <ExternalLink size={15} aria-hidden="true" />{qr.provider === "netease"
              ? (language === "zh" ? "打开网易云扫一扫" : "Open NetEase scanner")
              : (language === "zh" ? "打开 QQ 音乐继续授权" : "Continue in QQ Music")}
          </a> : <p className="mobile-login-limitation" role="status">{connectionErrorMessage(new Error(qr.mobileAuth?.status === "unavailable" ? qr.mobileAuth.code : "MOBILE_AUTH_UNAVAILABLE"), language)}</p>}
          {mobileMessage && <p className="mobile-auth-status" role="status" aria-live="polite">
            {(mobileStatus === "opening" || mobileStatus === "checking") && <LoaderCircle size={16} className="loading-spin" aria-hidden="true" />}{mobileMessage}
          </p>}
          <div className="mobile-auth-actions">
            <button className="small-button" disabled={mobileStatus === "checking"} onClick={() => checkQrNow.current?.()}>
              {mobileStatus === "checking" ? <LoaderCircle size={15} className="loading-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
              {language === "zh" ? "我已确认，检查连接" : "Check connection"}
            </button>
            {!showQrFallback && <button className="small-button" onClick={() => { clearTimeout(appLaunchTimer.current); setShowQrFallback(true); setMobileStatus("idle"); }}>
              <QrCode size={15} aria-hidden="true" />{language === "zh" ? "改用二维码" : "Use QR instead"}
            </button>}
          </div>
          {showQrFallback && <p className="mobile-qr-fallback">{language === "zh" ? "可保存下方二维码，在 App 的扫一扫中从相册识别；也可用另一台设备展示后扫码。微信内无法打开 App 时，请在 Safari 或系统浏览器中重试。" : "Save the QR below and choose it in the app’s scanner, or display it on another device. If an in-app browser blocks opening the app, retry in Safari or your system browser."}</p>}
        </div>}
        {qrActive && mobileLayout && showQrFallback && <a className="small-button mobile-save-qr" href={qr.qrImage} download={`zmusicstats-${qr.provider}-login.png`}><Download size={15} aria-hidden="true" />{language === "zh" ? "保存登录二维码" : "Save login QR"}</a>}
      </div>}
      {refreshError && <div className="connection-refresh-error" role="alert"><p className="inline-error">{refreshError}</p><button className="small-button" disabled={loading} onClick={() => void refresh()}>{loading ? <LoaderCircle size={15} className="loading-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}{t.retry}</button></div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!connected && <p className="modal-footnote">{t.noAccount}</p>}
      {connected && !qrActive && <button className="text-button connection-details-link" onClick={() => setTab("history")}>
        <ListChecks size={15} aria-hidden="true" />{language === "zh" ? "查看数据读取详情" : "View import details"}
      </button>}
      </section>
      <section id={`${tabId}-history-panel`} className="connection-history-panel" role="tabpanel" aria-labelledby={`${tabId}-history-tab`} hidden={tab !== "history"}>
      <div className="connection-history-intro"><strong>{language === "zh" ? "从平台到你的听歌报告" : "From your platforms to your report"}</strong><p>{language === "zh" ? "历史月份、歌曲资料与读取状态都在这里。切换页面后，读取会继续。" : "Historical months, song details, and import status live here. Reading continues when you switch views."}</p></div>
      <div ref={historySlot} className="connection-history-content" />
      {!historyContent && <p className="connection-history-empty">{language === "zh" ? "连接平台后，读取进度会显示在这里。" : "Connect a platform to see its import progress here."}</p>}
      <button className="button primary modal-action" disabled={!connected || syncing || !!busy || qrActive} onClick={()=>onSync()}>
        {syncing || !!busy ? <LoaderCircle className="loading-spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}{syncing ? t.syncing : language === "zh" ? "重新读取已连接平台" : "Read connected platforms again"}
      </button>
      {!connected && <p className="modal-footnote">{t.noAccount}</p>}
      </section>
    </div>;
  return <>
    <div ref={historyParking} hidden aria-hidden="true" />
    {createPortal(historyContent, historyHost)}
    {open && (embedded ? content : <Modal title={t.connectionTitle} subtitle={t.connectionSub} closeLabel={t.close} onClose={onClose}>{content}</Modal>)}
  </>;
}
