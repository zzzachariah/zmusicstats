import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, LoaderCircle, RefreshCw, QrCode, ExternalLink, Download, ListChecks } from "lucide-react";
import { Modal } from "./Modal";
import { PlatformIcon } from "./PlatformIcon";
import { copy, type Language } from "../lib/i18n";
import type { PlatformId } from "../lib/report";
import { prepareAppleMusic, connectAppleMusic } from "../lib/apple-music";
import { connectionErrorMessage, connectionResponseError } from "../lib/connection-errors";
import { canOpenMobileAuth, readQQMobileAuth, type MobileAuth } from "../lib/mobile-auth";
import { IS_UI_PREVIEW, UI_PREVIEW_LABEL, UI_PREVIEW_CONNECTION_REASON } from "../lib/runtime-mode";
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
  const [mobileStatus, setMobileStatus] = useState<"idle" | "opening" | "pending" | "checking" | "unconfirmed">("idle");
  const appLaunchQr = useRef<string | null>(null);
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
      const response = await fetch("/api/connections", { signal: controller.signal });
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
        const response = await fetch(`/api/auth/${qrProvider}/qr/${encodeURIComponent(qrId)}`, { signal: controller.signal });
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
          setMobileStatus(current => result.state === "connected" ? "idle"
            : result.state === "scanned" || current === "checking" ? "pending" : current);
        }
        if (result.state === "connected") {
          stopped = true;
          clearTimeout(expiryTimer);
          await finishConnection(`qr:${qrId}`, qrProvider, qrAttempt, controller.signal);
          return;
        }
        schedule(2500);
      } catch (error) {
        if (controller.signal.aborted || stopped || !currentAttempt()) return;
        if (appLaunchQr.current === qrId) setMobileStatus(current => current === "checking" ? "pending" : current);
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
        if (document.visibilityState !== "visible") setMobileStatus("pending");
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

  const connect = async (provider: PlatformId) => {
    const attempt = ++actionSequence.current;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(provider); setError(""); setQr(null);
    appLaunchQr.current = null; clearTimeout(appLaunchTimer.current); setMobileStatus("idle");
    try {
      if (provider === "apple") {
        if (!apple) throw new Error("APPLE_NOT_READY");
        await connectAppleMusic(apple);
        await finishConnection(`apple:${attempt}`, provider, attempt, controller.signal);
        return;
      }
      const response = await fetch(`/api/auth/${provider}/qr`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal,
      });
      if (!response.ok) throw await connectionResponseError(response,"QR_UNAVAILABLE");
      const data = await response.json();
      if (!mounted.current || controller.signal.aborted || attempt !== actionSequence.current) return;
      if (typeof data.id !== "string" || typeof data.qrImage !== "string" || !data.qrImage.startsWith("data:image/")
        || typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt)) throw new Error("QR_INVALID");
      setError("");
      setQr({ id: data.id, qrImage: data.qrImage, expiresAt: data.expiresAt, provider, attempt, state: "waiting",
        ...(provider === "qq" ? { mobileAuth: readQQMobileAuth(data.mobileAuth, data.expiresAt) } : {}),
      });
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
      const response = await fetch(`/api/connections/${id}`, { method: "DELETE", signal: controller.signal });
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
  const mobileMessage = mobileStatus === "opening"
    ? (language === "zh" ? "正在打开 QQ 音乐，请在 App 内确认授权。" : "Opening QQ Music. Confirm authorization in the app.")
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
              {busy === provider.id ? <LoaderCircle size={16} className="loading-spin" aria-hidden="true" /> : provider.id === "apple" ? <Link2 size={16} aria-hidden="true" /> : <QrCode size={16} aria-hidden="true" />}
              {provider.id === "apple" ? (language === "zh" ? "Apple 账号授权" : "Authorize Apple") : t.connectButton}
            </button>}
          {!provider.configured && <p className="connection-help">{t.unavailableHelp}</p>}
        </div>)}
      </div>}
      {qr && <div className={`qr-section${qr.provider === "qq" && qrActive ? " qr-section-mobile-app" : ""}`}>
        {qr.state === "connected" ? <div className="qr-complete" role="status"><Check size={42} aria-hidden="true" /><strong>{t.connected}</strong><span>{t.syncing}</span></div>
          : qr.state === "expired" ? <div className="qr-complete" role="status"><p>{t.qrExpired}</p><button className="button" disabled={!!busy || syncing} onClick={() => void connect(qr.provider)}><RefreshCw size={16} aria-hidden="true" />{t.retry}</button></div>
            : <><div className="qr-paper"><img src={qr.qrImage} width="200" height="200" alt={`${t[qr.provider]} — ${t.connectButton}`} /></div><strong role="status" aria-live="polite">{qr.state === "scanned" ? t.qrScanned : t.qrWait}</strong></>}
        {qr.state !== "connected" && <p>{t.qrHint}</p>}
        {qrActive && <div className="mobile-login-tools">
          <strong>{language === "zh" ? "正在用这台手机？" : "Using this phone?"}</strong>
          {qr.provider === "qq" ? <>
            <p>{language === "zh" ? "在 QQ 音乐中确认本次连接，再返回此页检查。无需重新生成二维码。" : "Confirm this connection in QQ Music, then return here to check. You do not need a new QR code."}</p>
            {qr.mobileAuth?.status === "available" ? <a className="small-button mobile-app-authorize" href={qr.mobileAuth.url}
              referrerPolicy="no-referrer" onClick={event => {
                if (!canOpenMobileAuth(qr.mobileAuth, qr.state)) {
                  event.preventDefault();
                  setQr(current => current?.id === qr.id ? { ...current, state: "expired" } : current);
                  return;
                }
                appLaunchQr.current = qr.id;
                setMobileStatus("opening");
                clearTimeout(appLaunchTimer.current);
                appLaunchTimer.current = setTimeout(() => {
                  if (mounted.current && appLaunchQr.current === qr.id && document.visibilityState === "visible") {
                    setMobileStatus(current => current === "opening" ? "unconfirmed" : current);
                  }
                }, 3500);
              }}><ExternalLink size={15} aria-hidden="true" />{language === "zh" ? "打开 QQ 音乐继续授权" : "Continue in QQ Music"}</a>
              : <p className="mobile-login-limitation" role="status">{connectionErrorMessage(new Error(qr.mobileAuth?.status === "unavailable" ? qr.mobileAuth.code : "MOBILE_AUTH_UNAVAILABLE"), language)}</p>}
            {mobileStatus !== "idle" && <button className="small-button" disabled={mobileStatus === "checking"} onClick={() => checkQrNow.current?.()}>
              {mobileStatus === "checking" ? <LoaderCircle size={15} className="loading-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
              {language === "zh" ? "我已确认，检查连接" : "I confirmed — check connection"}
            </button>}
            {mobileMessage && <p className="mobile-auth-status" role="status" aria-live="polite">{mobileMessage}</p>}
            {qr.mobileAuth?.status === "available" && <p className="mobile-login-limitation">{language === "zh" ? "手机授权入口待真机验证。若只打开了 App 首页，连接仍未完成；请改用二维码。微信内打不开时，可在 Safari 中重试。" : "This mobile authorization link still needs device testing. If only the app home opens, you are not connected; use the QR code. If WeChat blocks the link, retry in Safari."}</p>}
            <p className="mobile-qr-fallback">{language === "zh" ? "备用方式：用另一台设备展示二维码，再用 QQ 音乐扫一扫；也可尝试保存图片，在支持相册识别的扫一扫中打开。" : "Alternative: display the QR on another device and scan it in QQ Music, or save it if your scanner supports images from your photo library."}</p>
          </> : <p>{language === "zh" ? "先保存二维码，再在音乐 App 的扫一扫中从相册识别。确认后返回本页，会自动检查连接。" : "Save the QR image, then select it from the music app's scanner. Confirm and return here; the connection is checked automatically."}</p>}
          <a className="small-button" href={qr.qrImage} download={`zmusicstats-${qr.provider}-login.png`}><Download size={15} aria-hidden="true" />{language === "zh" ? "保存登录二维码" : "Save login QR"}</a>
          {qr.provider === "netease" && <a className="small-button" href="https://music.163.com/m/applink/?scheme=orpheus%3A%2F%2Fscancode" target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />{language === "zh" ? "打开网易云扫一扫" : "Open NetEase scanner"}</a>}
          {qr.provider === "netease" && <p className="mobile-login-limitation">{language === "zh" ? "此入口打开扫一扫，不会自动完成授权。如果未跳转，请手动打开 App。" : "This opens the scanner; it does not grant authorization. If it does not open, launch the app manually."}</p>}
        </div>}
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
