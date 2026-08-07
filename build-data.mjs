#!/usr/bin/env node
// Fetches the venue repertoire from Bilešu Paradīze and writes a slim data.json
// for the static page to read same-origin. No dependencies; Node 18+.
//
// The API sends no CORS headers, so the browser cannot call it directly —
// this runs server-side (GitHub Actions) instead.

import { writeFileSync } from "node:fs";

const VENUE_ID = process.env.VENUE_ID || "360";
const ENDPOINT = `https://www.bilesuparadize.lv/api/venue/${VENUE_ID}/repertoire`;

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

// Runner clock is UTC, event times are Riga-local; the buffer absorbs the skew
// and keeps today's earlier performances visible.
const cutoff = Date.now() - 12 * 3600e3;

const events = raw
  .map((e) => ({
    d: e.dateTime,                                        // "YYYY-MM-DDThh:mm:ss"
    t: e.performance?.titles?.lv ?? "",
    n: (e.prices ?? []).reduce((sum, p) => sum + (p.count ?? 0), 0),
    u: e.urls?.lv ?? null,
  }))
  .filter((e) => e.d && e.t && new Date(e.d).getTime() > cutoff)
  .sort((a, b) => a.d.localeCompare(b.d));                // ISO strings sort correctly

const first = raw[0];
const venue = first.venue?.titles?.lv || first.hall?.titles?.lv || "";

const out = { updated: new Date().toISOString(), venue, events };
writeFileSync("data.json", JSON.stringify(out));

const soldOut = events.filter((e) => e.n === 0).length;
console.log(
  `${events.length} events (${soldOut} sold out) → data.json, ` +
  `${JSON.stringify(out).length} bytes, from ${raw.length} raw`
);
