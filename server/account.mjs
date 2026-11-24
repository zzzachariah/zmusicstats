// Only display information crosses the browser boundary. Never forward a platform profile wholesale.
export function publicAccount(value) {
  if (!value || typeof value.nickname !== "string") return null;
  const nickname = value.nickname.trim().slice(0, 120);
  if (!nickname) return null;
  const account = { nickname };
  if (typeof value.avatarUrl === "string" && value.avatarUrl.length < 2048) {
    try {
      const url = new URL(value.avatarUrl);
      const allowed = ["music.126.net", "music.163.com", "gtimg.cn", "qlogo.cn", "qpic.cn"];
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password
        && allowed.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
        url.protocol = "https:";
        account.avatarUrl = url.href;
      }
    } catch { /* A malformed avatar must not prevent a valid connection. */ }
  }
  return account;
}
