#!/usr/bin/env node
// Fetches the venue repertoire from Bilešu Paradīze and writes a slim data.json
// for the static page to read same-origin. No dependencies; Node 18+.
//
// The API sends no CORS headers, so the browser cannot call it directly —
// this runs server-side (GitHub Actions) instead.

import { readFileSync, writeFileSync } from "node:fs";

const VENUE_ID = process.env.VENUE_ID || "360";
const ENDPOINT = `https://www.bilesuparadize.lv/api/venue/${VENUE_ID}/repertoire`;
const DATA_FILE = "data.json";
const FINISHED_MAX = 10;

// The API exposes only `prices[].count` (tickets remaining) — there is no
// capacity or sold-count field. The hall seats 60 and no event has ever
// reported more than that, so: sold = 60 − remaining.
const CAPACITY = 60;

// The API has no "cancelled" state either: a cancelled show reports 0 remaining
// and is indistinguishable from a sellout. Those have to be listed by hand,
// otherwise they inflate the season total by a full house each.
const CANCELLED_IDS = new Set([
  175651, // 2026-09-29 "Divi duči sārtu rožu" — atcelta, nevis izpārdota
]);

// How long an observed sale stays visible as a "▼" on the row. A single run's
// drop is invisible in practice — the page is scraped every 30 min, so a badge
// that lived one tick would almost never be on screen when someone looks.
// Drops are kept per show and expire by age instead.
const DROP_WINDOW_DAYS = 7;

// The season runs August–May and always breaks over June–July. Rolling over on
// 1 July puts the boundary inside that dead gap, so a season is never cut in
// half — and it keeps a run like Aug 2026 → Jan 2027 counted as one season
// rather than split by the calendar year.
const SEASON_START_MONTH = 7; // July

const isCancelled = (id) => CANCELLED_IDS.has(id);

function soldOf(e) {
  if (!e || isCancelled(e.id)) return 0;
  return Math.max(0, CAPACITY - (Number(e.n) || 0));
}

// "2026-09-29T19:00:00" → "2026/2027"
function seasonIdOf(iso) {
  const y = +String(iso).slice(0, 4);
  const m = +String(iso).slice(5, 7);
  const start = m >= SEASON_START_MONTH ? y : y - 1;
  return `${start}/${start + 1}`;
}

const currentSeason = seasonIdOf(new Date().toISOString());

// ── Previous snapshot ───────────────────────────────────────────────────────
// Missing or malformed file (first run) must not be fatal — start from zero.
function readPrevious() {
  try {
    const p = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    const isMap = p.banked && typeof p.banked === "object" && !Array.isArray(p.banked);
    const banked = isMap ? { ...p.banked } : {};
    // Migration from the single-season shape, where `archived` was a bare number.
    if (!isMap && Number.isFinite(p.archived)) banked[currentSeason] = p.archived;
    return {
      events: Array.isArray(p.events) ? p.events : [],
      finished: Array.isArray(p.finished) ? p.finished : [],
      banked,
    };
  } catch {
    return { events: [], finished: [], banked: {} };
  }
}

// ── Fetch ───────────────────────────────────────────────────────────────────
// Everything below the write barrier must succeed before data.json is touched,
// so a failed run leaves the snapshot, the finished list and every season
// total exactly as they were.
const res = await fetch(ENDPOINT, { headers: { Accept: "application/json" } });
if (!res.ok) {
  console.error(`API returned ${res.status} ${res.statusText}`);
  process.exit(1);
}

const raw = await res.json();
if (!Array.isArray(raw) || raw.length === 0) {
  // Refuse to overwrite good data with an empty list.
  console.error("Unexpected or empty API response — aborting.");
  process.exit(1);
}

// ── Shape ───────────────────────────────────────────────────────────────────
// Runner clock is UTC, event times are Riga-local; the buffer absorbs the skew
// and keeps today's earlier performances visible.
const cutoff = Date.now() - 12 * 3600e3;

const events = raw
  .map((e) => ({
    id: e.id,
    d: e.dateTime,                                        // "YYYY-MM-DDThh:mm:ss"
    t: e.performance?.titles?.lv ?? "",
    n: (e.prices ?? []).reduce((sum, p) => sum + (p.count ?? 0), 0),
    u: e.urls?.lv ?? null,
    s: e.sales?.start ?? null,                            // distinguishes "not on sale yet"
    ...(isCancelled(e.id) ? { cancelled: true } : {}),
    // Transient: a response carrying no price rows at all is more likely a
    // glitch than an instant sellout, so it must not bank a fake sale.
    hasPrices: Array.isArray(e.prices) && e.prices.length > 0,
  }))
  .filter((e) => e.id != null && e.d && e.t && new Date(e.d).getTime() > cutoff)
  .sort((a, b) => a.d.localeCompare(b.d));                // ISO strings sort correctly

// ── Diff against the previous run, by id ────────────────────────────────────
// Only drives the per-show "recently sold" indicator; the season totals below
// are derived from capacity, not from these deltas.
const prev = readPrevious();
const prevById = new Map(prev.events.map((e) => [e.id, e]));

// Drops are logged per day rather than per run: same-day sales merge into one
// entry, so a show's log is capped at DROP_WINDOW_DAYS entries however often
// the workflow runs.
const today = new Date().toISOString().slice(0, 10);
const cutoffDay = new Date(Date.now() - DROP_WINDOW_DAYS * 864e5)
  .toISOString()
  .slice(0, 10);

let soldThisRun = 0;
for (const e of events) {
  const before = prevById.get(e.id);                      // absent = newly listed show

  // Carry the show's own drop log forward, expiring anything past the window.
  const log = (before?.drops ?? []).filter(
    (entry) => Array.isArray(entry) && entry[0] > cutoffDay
  );

  if (before && Number.isFinite(before.n) && e.hasPrices && !e.cancelled) {
    const dropped = before.n - e.n;
    if (dropped > 0) {
      const last = log[log.length - 1];
      if (last && last[0] === today) last[1] += dropped;
      else log.push([today, dropped]);
      soldThisRun += dropped;
    }
  }

  if (log.length) {
    e.drops = log;
    e.delta = log.reduce((sum, entry) => sum + entry[1], 0);
  }
  delete e.hasPrices;
}

// ── Recently finished ───────────────────────────────────────────────────────
// An id that was present before and is gone now has either been delisted by
// the venue or aged past our own 12h cutoff. Either way it finished — freeze
// its last-known title and count rather than letting it drop to zero silently.
const currentIds = new Set(events.map((e) => e.id));

const newlyFinished = prev.events
  .filter((e) => e.id != null && !currentIds.has(e.id))
  .sort((a, b) => String(b.d).localeCompare(String(a.d)));

const finished = [];
const seen = new Set();
for (const f of [...newlyFinished, ...prev.finished]) {
  if (!f || f.id == null || currentIds.has(f.id) || seen.has(f.id)) continue;
  seen.add(f.id);
  finished.push({ id: f.id, d: f.d, t: f.t, n: f.n });
  if (finished.length >= FINISHED_MAX) break;
}

// ── Season totals ───────────────────────────────────────────────────────────
// Each finished show is banked against the season it belongs to, keyed by its
// own date. Seasons therefore close themselves: no rollover event to run, and
// a show that finishes just after 1 July still lands in the season it played
// in. Shows already listed for next season don't count toward this one.
const banked = prev.banked;
for (const f of newlyFinished) {
  const sid = seasonIdOf(f.d);
  banked[sid] = (banked[sid] || 0) + soldOf(f);
}
if (!(currentSeason in banked)) banked[currentSeason] = 0;

const soldListed = events
  .filter((e) => seasonIdOf(e.d) === currentSeason)
  .reduce((sum, e) => sum + soldOf(e), 0);
const sold = banked[currentSeason] + soldListed;

const seasons = Object.keys(banked)
  .filter((id) => id !== currentSeason && banked[id] > 0)
  .sort()
  .reverse()
  .map((id) => ({ id, sold: banked[id] }));

// ── Write ───────────────────────────────────────────────────────────────────
const first = raw[0];
const venue = first.venue?.titles?.lv || first.hall?.titles?.lv || "";

const out = {
  updated: new Date().toISOString(),
  venue,
  capacity: CAPACITY,
  season: currentSeason,
  totals: {
    remaining: events.reduce((sum, e) => sum + e.n, 0),
    shows: events.length,
  },
  sold,
  banked,
  seasons,
  events,
  finished,
};

writeFileSync(DATA_FILE, JSON.stringify(out));

const nextSeason = events.filter((e) => seasonIdOf(e.d) !== currentSeason).length;
console.log(
  `${events.length} events (${out.totals.remaining} tickets left, ` +
  `${events.filter((e) => e.cancelled).length} cancelled, ${nextSeason} next season) ` +
  `→ data.json, ${JSON.stringify(out).length} bytes, from ${raw.length} raw\n` +
  `season ${currentSeason}: ${sold} = ${soldListed} listed + ${banked[currentSeason]} banked · ` +
  `recent drops: ${soldThisRun} across ${events.filter((e) => e.delta).length} show(s) · ` +
  `finished: ${finished.length} · past seasons: ${seasons.length}`
);
