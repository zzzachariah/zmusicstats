interface MusicKitInstance {
  authorize(): Promise<string | undefined>;
  musicUserToken?: string;
}
interface MusicKitAPI {
  configure(options: {
    developerToken: string;
    app: { name: string; build: string };
  }): Promise<MusicKitInstance> | MusicKitInstance;
  getInstance(): MusicKitInstance;
}
declare global {
  interface Window {
    MusicKit?: MusicKitAPI;
  }
}

let preparation: Promise<MusicKitInstance> | null = null;

export function prepareAppleMusic(): Promise<MusicKitInstance> {
  if (preparation) return preparation;
  preparation = (async () => {
    const response = await fetch("/api/auth/apple/config");
    if (!response.ok) throw new Error("APPLE_NOT_CONFIGURED");
    const config = await response.json();
    if (typeof config.developerToken !== "string" || !config.developerToken)
      throw new Error("APPLE_NOT_CONFIGURED");
    if (!window.MusicKit)
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
        script.async = true;
        const cleanup = () => {
          clearTimeout(timeout);
          document.removeEventListener("musickitloaded", onReady);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const timeout = setTimeout(() => {
          cleanup();
          script.remove();
          reject(new Error("APPLE_SDK_TIMEOUT"));
        }, 15000);
        document.addEventListener("musickitloaded", onReady, { once: true });
        script.onerror = () => {
          cleanup();
          script.remove();
          reject(new Error("APPLE_SDK_FAILED"));
        };
        document.head.appendChild(script);
      });
    if (!window.MusicKit) throw new Error("APPLE_SDK_FAILED");
    return await window.MusicKit.configure({
      developerToken: config.developerToken,
      app: { name: "zmusicstats", build: "0.1.0" },
    });
  })().catch((error) => {
    preparation = null;
    throw error;
  });
  return preparation;
}

export async function connectAppleMusic(
  instance: MusicKitInstance,
): Promise<void> {
  const authorized = await instance.authorize();
  const musicUserToken = authorized || instance.musicUserToken;
  if (!musicUserToken) throw new Error("APPLE_AUTH_CANCELLED");
  const response = await fetch("/api/auth/apple/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ musicUserToken }),
  });
  if (!response.ok) throw new Error("APPLE_AUTH_FAILED");
}
