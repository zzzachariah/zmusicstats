// Monthly reports must be closed calendar periods; NetEase can otherwise silently return an older report.
export function neteaseMonthReadiness(period, now = Date.now()) {
  if (Date.parse(`${period.start}T00:00:00+08:00`) > now) return "FUTURE_MONTH";
  if (Date.parse(`${period.end}T23:59:59.999+08:00`) >= now) return "MONTH_NOT_READY";
  return null;
}

function shanghaiDate(value) {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value + 8 * 60 * 60 * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function neteasePeriodMatches(payload, period) {
  const data = payload?.data;
  if (!data || typeof data !== "object") return true;
  if (data.startTime != null && shanghaiDate(data.startTime) !== period.start) return false;
  if (data.endTime != null && shanghaiDate(data.endTime) !== period.end) return false;
  return true;
}

export function neteaseMonthSeconds(payload) {
  const block = payload?.data?.listenTimeBlock;
  // Verified monthly schema: this field and daily/time-of-day durations are minutes.
  // Year-report playDuration is seconds and must never flow through this conversion.
  // Cross-checked against real monthly totals, the platform's “听了…分” label,
  // and two independent client implementations (see docs/connectors.md).
  if (block?.blockType !== "LISTEN_TIME_MONTH_BLOCK" || !Number.isFinite(block.playDuration) || block.playDuration < 0) return null;
  return block.playDuration * 60;
}

export function neteaseTopSongFallback(payload) {
  // These fields were confirmed on the real month report. The headline song is rank #1,
  // and is useful when the separate Top 20 request fails; never describe this as a complete rank.
  const song = payload?.data?.topSongBlock;
  if (!song || !Number.isSafeInteger(song.songId) || song.songId <= 0
    || typeof song.songName !== "string" || !song.songName
    || !Number.isFinite(song.playCount) || song.playCount < 0) return [];
  return [{ id: String(song.songId), title: song.songName.slice(0, 500),
    artist: Array.isArray(song.artists) ? song.artists.map(item => typeof item?.name === "string" ? item.name : "").filter(Boolean).join(" / ") : "",
    count: song.playCount, genres: [] }];
}

export function neteaseHistoryDirectory({ timedetail, yearReport, account }, now = Date.now()) {
  const current = new Date(now + 8 * 3600_000).toISOString().slice(0, 7);
  const catalog = new Set();
  for (const item of Array.isArray(timedetail?.data) ? timedetail.data : []) {
    if (!Number.isInteger(item?.year) || !Array.isArray(item.month)) continue;
    for (const month of item.month) if (Number.isInteger(month) && month >= 1 && month <= 12)
      catalog.add(`${item.year}-${String(month).padStart(2, "0")}`);
  }
  const reportedYears = (yearReport?.data?.yearItems ?? []).map(item => item?.year)
    .filter(year => Number.isInteger(year) && year >= 2000 && year <= Number(current.slice(0, 4)));
  if (!catalog.size && !reportedYears.length) return null;
  const profile = account?.profile ?? account?.data?.profile;
  const creationDate = shanghaiDate(profile?.createTime);
  const accountCreatedMonth = creationDate?.slice(0, 7);
  const candidates = new Set(catalog);
  for (const year of [...reportedYears, Number(current.slice(0, 4))])
    for (let month = 1; month <= 12; month++) candidates.add(`${year}-${String(month).padStart(2, "0")}`);
  // Account creation is only a lower bound, not proof of listening or report availability.
  if (accountCreatedMonth && accountCreatedMonth >= "2000-01" && accountCreatedMonth < current) {
    const [startYear, startMonth] = accountCreatedMonth.split("-").map(Number);
    for (let index = startYear * 12 + startMonth - 1; index < Number(current.slice(0, 4)) * 12 + Number(current.slice(5)) - 1; index++)
      candidates.add(`${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`);
  }
  const months = [...candidates].filter(month => /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) && month < current && (!accountCreatedMonth || month >= accountCreatedMonth)).sort();
  return { months, source: catalog.size ? "timedetail" : "year-report", rangeVerified: false,
    years: [...new Set(months.map(month => Number(month.slice(0, 4))))],
    catalogMonths: [...catalog].filter(month => month < current).sort(),
    accountCreatedMonth: accountCreatedMonth ?? null,
  };
}
