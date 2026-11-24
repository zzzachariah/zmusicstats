import { getTimeMetaphors, type TimeMetaphor } from "./listening-time.ts";

export const TIME_METAPHOR_HISTORY_KEY = "zmusicstats:time-perspectives:v1";
export const TIME_METAPHOR_HISTORY_LIMITS = { entities: 128, recent: 16, deck: 256 } as const;

export interface MetaphorHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface EntityDeck {
  entity: string;
  order: string[];
  cursor: number;
  round: number;
}

interface HistoryState {
  version: 1;
  /** Oldest entity first: bounded without storing account names, track titles or timestamps. */
  entities: EntityDeck[];
  /** Oldest scene first, shared by song, platform and genre perspectives. */
  recent: string[];
}

const emptyHistory = (): HistoryState => ({ version: 1, entities: [], recent: [] });

function entityKey(seed: string): string {
  let first = 2166136261;
  let second = 5381;
  for (const character of seed) {
    const code = character.codePointAt(0)!;
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

const validId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,80}$/.test(value);

function readHistory(raw: string | null): HistoryState {
  if (!raw || raw.length > 512_000) return emptyHistory();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyHistory();
    const value = parsed as Partial<HistoryState>;
    if (value.version !== 1 || !Array.isArray(value.entities) || !Array.isArray(value.recent)) return emptyHistory();
    const entities: EntityDeck[] = [];
    for (const entry of value.entities.slice(-TIME_METAPHOR_HISTORY_LIMITS.entities)) {
      if (!entry || typeof entry !== "object" || typeof entry.entity !== "string"
        || !/^[a-z0-9]{1,7}:[a-z0-9]{1,7}$/.test(entry.entity)
        || !Array.isArray(entry.order) || entry.order.length > TIME_METAPHOR_HISTORY_LIMITS.deck
        || !entry.order.every(validId) || new Set(entry.order).size !== entry.order.length
        || !Number.isSafeInteger(entry.cursor) || entry.cursor < 0 || entry.cursor > entry.order.length
        || !Number.isSafeInteger(entry.round) || entry.round < 0) continue;
      // Corrupt duplicate records cannot cause a second deck for the same entity.
      const duplicate = entities.findIndex(candidate => candidate.entity === entry.entity);
      if (duplicate >= 0) entities.splice(duplicate, 1);
      entities.push({ entity: entry.entity, order: [...entry.order], cursor: entry.cursor, round: entry.round });
    }
    const recent = value.recent.filter(validId).slice(-TIME_METAPHOR_HISTORY_LIMITS.recent);
    return { version: 1, entities, recent: [...new Set(recent)] };
  } catch {
    return emptyHistory();
  }
}

function browserStorage(): MetaphorHistoryStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/**
 * Call only when a perspective becomes visible or the user asks for another one.
 * Each entity completes its shuffled deck before repeating; refresh resumes the cursor.
 * A small global window also avoids reusing a scene on adjacent songs where possible.
 */
export function createTimeMetaphorHistory(
  storage: () => MetaphorHistoryStorage | null = browserStorage,
): { next(seconds: number | null, seed: string): TimeMetaphor | null } {
  let memory = emptyHistory();
  let hasUnwrittenHistory = false;

  return {
    next(seconds, seed) {
      const choices = getTimeMetaphors(seconds, seed);
      if (!choices.length) return null;
      let store: MetaphorHistoryStorage | null = null;
      let history = memory;
      try {
        store = storage();
        // Read on every selection so sequential changes in another tab are respected.
        if (store && !hasUnwrittenHistory) history = readHistory(store.getItem(TIME_METAPHOR_HISTORY_KEY));
      } catch {
        // Private browsing, blocked storage and server rendering retain a local deck.
      }

      const entity = entityKey(seed);
      const available = new Map(choices.map(choice => [choice.id, choice]));
      const previous = history.entities.find(entry => entry.entity === entity);
      const deck: EntityDeck = previous
        ? { ...previous, order: [...previous.order] }
        : { entity, order: choices.map(choice => choice.id), cursor: 0, round: 0 };

      if (previous) {
        // A different month may change eligible comparisons. Preserve all still-eligible
        // used entries, and add newly eligible entries without prematurely repeating.
        const used = deck.order.slice(0, deck.cursor).filter(id => available.has(id));
        const unused = deck.order.slice(deck.cursor).filter(id => available.has(id));
        const existing = new Set([...used, ...unused]);
        deck.order = [...used, ...unused, ...choices.filter(choice => !existing.has(choice.id)).map(choice => choice.id)];
        deck.cursor = used.length;
      }

      if (deck.cursor >= deck.order.length) {
        deck.round = (deck.round + 1) % Number.MAX_SAFE_INTEGER;
        deck.order = getTimeMetaphors(seconds, `${seed}:round:${deck.round}`).map(choice => choice.id);
        deck.cursor = 0;
      }

      const remaining = deck.order.slice(deck.cursor);
      let offset = remaining.findIndex(id => !history.recent.includes(id));
      if (offset < 0) {
        // Near a cycle boundary all candidates may be recent. Use the oldest one,
        // rather than repeat the immediately preceding scene if an alternative exists.
        offset = remaining.reduce((oldest, id, index) => history.recent.indexOf(id)
          < history.recent.indexOf(remaining[oldest]) ? index : oldest, 0);
      }
      const chosen = deck.cursor + offset;
      [deck.order[deck.cursor], deck.order[chosen]] = [deck.order[chosen], deck.order[deck.cursor]];
      const id = deck.order[deck.cursor++];

      history = {
        version: 1,
        entities: [...history.entities.filter(entry => entry.entity !== entity), deck].slice(-TIME_METAPHOR_HISTORY_LIMITS.entities),
        recent: [...history.recent.filter(recentId => recentId !== id), id].slice(-TIME_METAPHOR_HISTORY_LIMITS.recent),
      };
      memory = history;
      hasUnwrittenHistory = true;
      try {
        if (store) {
          store.setItem(TIME_METAPHOR_HISTORY_KEY, JSON.stringify(history));
          hasUnwrittenHistory = false;
        }
      } catch {
        // Quota failures must not break the report or reset the in-memory deck.
      }
      return available.get(id)!;
    },
  };
}

/** Created without touching window/localStorage; storage is accessed only on next(). */
export const timeMetaphorHistory = createTimeMetaphorHistory();

export interface TimePerspectiveSelection {
  key: string;
  id: string | null;
}

export const timePerspectiveKey = (seconds: number | null, seed: string): string => JSON.stringify([seed, seconds]);

/** One mounted perspective owns one selection, regardless of effect replay or language. */
export function createTimePerspectiveSession(history = timeMetaphorHistory): {
  select(seconds: number | null, seed: string, visible: boolean, refresh?: boolean): TimePerspectiveSelection | null;
} {
  let current: TimePerspectiveSelection | null = null;
  return {
    select(seconds, seed, visible, refresh = false) {
      if (!visible) return null;
      const key = timePerspectiveKey(seconds, seed);
      if (!refresh && current?.key === key) return current;
      current = { key, id: history.next(seconds, seed)?.id ?? null };
      return current;
    },
  };
}
