import { useEffect, useState } from "react";
import { Check, Link2, LoaderCircle, RefreshCw, QrCode } from "lucide-react";
import { Modal } from "./Modal";
import { copy, type Language } from "../lib/i18n";
import type { PlatformId } from "../lib/report";
import { prepareAppleMusic, connectAppleMusic } from "../lib/apple-music";

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
  state?: string;
};

export function Connections({
  language,
  onClose,
  onSync,
  syncing,
  onDisconnected,
}: {
  language: Language;
  onClose: () => void;
  onSync: () => void;
  syncing: boolean;
  onDisconnected: (id: PlatformId) => void;
}) {
  const t = copy[language];
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [qr, setQr] = useState<QR | null>(null);
  const [error, setError] = useState("");
  const [apple, setApple] = useState<Awaited<
    ReturnType<typeof prepareAppleMusic>
  > | null>(null);
  const refresh = async () => {
    try {
      const r = await fetch("/api/connections");
      if (!r.ok) throw Error();
      const data = await r.json();
      setProviders(data.providers);
    } catch {
      setError(t.backendOffline);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const appleConfigured = providers.some(
    (p) => p.id === "apple" && p.configured,
  );
  useEffect(() => {
    if (!appleConfigured) return;
    let cancelled = false;
    prepareAppleMusic()
      .then((instance) => {
        if (!cancelled) setApple(instance);
      })
      .catch(() => {
        if (!cancelled) setError(t.connectionFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [appleConfigured]);
  useEffect(() => {
    if (!qr || qr.state === "expired" || qr.state === "connected") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/auth/${qr.provider}/qr/${encodeURIComponent(qr.id)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw Error();
        const result = await response.json();
        if (controller.signal.aborted) return;
        setQr((prev) =>
          prev?.id === qr.id ? { ...prev, state: result.state } : prev,
        );
        if (result.state === "connected") {
          await refresh();
          return;
        }
        if (result.state === "expired") return;
        timer = setTimeout(poll, 2500);
      } catch {
        if (!controller.signal.aborted) {
          setError(t.connectionFailed);
          timer = setTimeout(poll, 5000);
        }
      }
    };
    timer = setTimeout(poll, 1800);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [qr?.id, qr?.state === "connected", qr?.state === "expired", language]);
  const connect = async (provider: PlatformId) => {
    setBusy(provider);
    setError("");
    setQr(null);
    try {
      if (provider === "apple") {
        if (!apple) throw Error();
        await connectAppleMusic(apple);
        await refresh();
        return;
      }
      const r = await fetch(`/api/auth/${provider}/qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw Error();
      const data = await r.json();
      if (
        typeof data.qrImage !== "string" ||
        !data.qrImage.startsWith("data:image/")
      )
        throw Error();
      setQr({ ...data, state: "waiting" });
    } catch {
      setError(t.connectionFailed);
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async (id: PlatformId) => {
    setBusy(id);
    setError("");
    try {
      const r = await fetch(`/api/connections/${id}`, { method: "DELETE" });
      if (!r.ok) throw Error();
      setQr(null);
      onDisconnected(id);
      await refresh();
    } catch {
      setError(t.connectionFailed);
    } finally {
      setBusy(null);
    }
  };
  const connected = providers.some((p) => p.connected);
  return (
    <Modal
      title={t.connectionTitle}
      subtitle={t.connectionSub}
      closeLabel={t.close}
      onClose={onClose}
    >
      {loading ? (
        <div className="loading-state">
          <LoaderCircle className="loading-spin" />
          {t.loading}
        </div>
      ) : (
        <div className="connection-list">
          {providers.map((p) => (
            <div className="connection-card" key={p.id}>
              <div className={`platform-icon ${p.id}`}>
                {p.id === "netease" ? "云" : p.id === "apple" ? "♪" : "Q"}
              </div>
              <div className="connection-description">
                <strong>{t[p.id]}</strong>
                <span>
                  {p.connected
                    ? p.account?.nickname || t.connected
                    : p.configured
                      ? t.notConnected
                      : t.unavailable}
                </span>
              </div>
              {p.connected ? (
                <button
                  className="quiet-button"
                  disabled={!!busy}
                  onClick={() => disconnect(p.id)}
                >
                  {t.disconnect}
                </button>
              ) : (
                <button
                  className="small-button"
                  disabled={
                    !p.configured || !!busy || (p.id === "apple" && !apple)
                  }
                  onClick={() => connect(p.id)}
                >
                  {busy === p.id ? (
                    <LoaderCircle size={16} className="loading-spin" />
                  ) : p.id === "apple" ? (
                    <Link2 size={16} />
                  ) : (
                    <QrCode size={16} />
                  )}
                  {p.id === "apple"
                    ? language === "zh"
                      ? "Apple 账号授权"
                      : "Authorize Apple"
                    : t.connectButton}
                </button>
              )}
              {!p.configured && (
                <p className="connection-help">{t.unavailableHelp}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {qr && (
        <div className="qr-section">
          {qr.state === "connected" ? (
            <div className="qr-complete">
              <Check size={42} />
              <strong>{t.connected}</strong>
            </div>
          ) : qr.state === "expired" ? (
            <div className="qr-complete">
              <p>{t.qrExpired}</p>
              <button className="button" onClick={() => connect(qr.provider)}>
                <RefreshCw size={16} />
                {t.retry}
              </button>
            </div>
          ) : (
            <>
              <div className="qr-paper">
                <img
                  src={qr.qrImage}
                  width="200"
                  height="200"
                  alt={t.connectButton}
                />
              </div>
              <strong>{qr.state === "scanned" ? t.qrScanned : t.qrWait}</strong>
            </>
          )}
          <p>{t.qrHint}</p>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary modal-action"
        disabled={!connected || syncing || !!busy}
        onClick={onSync}
      >
        {syncing ? (
          <LoaderCircle className="loading-spin" size={18} />
        ) : (
          <Link2 size={18} />
        )}
        {syncing ? t.syncing : t.sync}
      </button>
      {!connected && <p className="modal-footnote">{t.noAccount}</p>}
    </Modal>
  );
}
