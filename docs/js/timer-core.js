// Timer and stopwatch helpers: reading searches like "set a timer for 5 minutes", and showing times.
// Pure functions only (no page code), so they can be tested on their own.

const UNIT = {
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
};
export const MAX_SECONDS = 99 * 3600 + 59 * 60 + 59;

/** "5 minutes", "1h30m", "90 sec", "2:30", "1:02:03", or just "5" (minutes) -> seconds, or null. */
export function parseDuration(text) {
  let s = String(text).toLowerCase().trim();
  if (!s) return null;
  s = s.replace(/\bhalf an? hour\b/g, "30 minutes").replace(/\ban? hour and a half\b/g, "90 minutes")
    .replace(/\ban? (hour|minute|second)s?\b/g, "1 $1").replace(/\band\b|,/g, " ").replace(/\s+/g, " ").trim();
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const total = m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
    return total >= 1 && total <= MAX_SECONDS ? total : null;
  }
  if (/^\d+(\.\d+)?$/.test(s)) { const t = Math.round(parseFloat(s) * 60); return t >= 1 && t <= MAX_SECONDS ? t : null; } // bare number = minutes
  let total = 0, left = s;
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/g;
  left = s.replace(re, (_, n, u) => { total += parseFloat(n) * UNIT[u]; return " "; });
  if (left.trim()) return null; // leftover words: not a plain duration
  total = Math.round(total);
  return total >= 1 && total <= MAX_SECONDS ? total : null;
}

/**
 * Reads a search. Returns null, { kind: "timer", seconds: number|null } or { kind: "stopwatch" }.
 * Only searches that are really a timer ask ("timer", "10 min timer"); "best kitchen timer" is left alone.
 */
export function parseTimerQuery(q) {
  let t = String(q).toLowerCase().trim().replace(/\s+/g, " ");
  if (!t || t.length > 80) return null;
  if (/^((online|free|digital|simple|a|an|the|my|open|start|set)\s+)*stop ?watch(\s+online)?$/.test(t)) return { kind: "stopwatch" };
  if (!/\b(timer|countdown|count down)\b/.test(t)) return null;
  // a few spoken-style numbers first, then drop filler words
  t = t.replace(/\bhalf an? hour\b/g, "30 minutes").replace(/\ban? (hour|minute|second)s?\b/g, "1 $1");
  t = t.replace(/\b(timer|countdown|count down|set|start|create|make|run|me|a|an|the|for|of|on|to|my|please|online|free|new)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return { kind: "timer", seconds: null };
  const seconds = parseDuration(t);
  return seconds ? { kind: "timer", seconds } : null;
}

const two = (n) => String(n).padStart(2, "0");
/** 305 -> "05:05", 3725 -> "1:02:05" */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}
/** Stopwatch time in milliseconds -> "01:23.45" or "1:01:23.45" */
export function formatStopwatch(ms) {
  const cs = Math.floor(Math.max(0, ms) / 10);
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h > 0 ? h + ":" + two(m) : two(m)}:${two(s)}.${two(c)}`;
}
/** 90 -> "1 minute 30 seconds", for screen readers and short labels */
export function describe(totalSeconds) {
  const s = Math.round(totalSeconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const part = (n, w) => (n ? `${n} ${w}${n === 1 ? "" : "s"}` : "");
  return [part(h, "hour"), part(m, "minute"), part(sec, "second")].filter(Boolean).join(" ") || "0 seconds";
}
