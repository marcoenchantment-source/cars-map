// Community road changes ("the 50-driver rule"). A trace = where a car drove with no mapped
// road under it. Traces are quantised into geohash-7 cells (~150 m); a chain of cells is
// confirmed once enough DISTINCT drivers (pubkeys) passed every cell. Pure and DOM-free.
import { geohashEncode, haversine, simplify } from '../core/geo.js';
import { KIND, withAppTag, expirationTag, isTimely, expirationOf } from './events.js';
import { isLngLat, parseJsonObject, round } from './sanitize.js';

export const CELL_PRECISION = 7;
export const MAX_TRACE_POINTS = 200;
export const MAX_CELLS = 400;
export const TRACE_TTL_DAYS = 60;
const DENSIFY_STEP_M = 40;
const MIN_TRACE_M = 40;
const MAX_TRACE_M = 30000;
const MAX_SEGMENT_M = 5000;
const MAX_G_TAGS = 12;

/** Extra points every `stepM` so no ~150 m cell along a long straight segment is skipped. */
export function densify(coords, stepM = DENSIFY_STEP_M) {
  if (!coords || coords.length === 0) return [];
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const n = Math.min(500, Math.floor(haversine(a, b) / stepM));
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(b);
  }
  return out;
}

/** Ordered unique geohash cells a trace passes through. */
export function quantiseTrace(coords, precision = CELL_PRECISION) {
  const cells = new Set();
  for (const p of densify(coords)) cells.add(geohashEncode(p[1], p[0], precision));
  return [...cells].slice(0, MAX_CELLS);
}

export function lineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/** Simplify (6 m), cap at MAX_TRACE_POINTS and round to ~1 m. */
export function prepareTrace(points, toleranceM = 6) {
  let tol = toleranceM;
  let out = simplify(points, tol);
  while (out.length > MAX_TRACE_POINTS && tol < 400) {
    tol *= 1.6;
    out = simplify(points, tol);
  }
  if (out.length > MAX_TRACE_POINTS) {
    const step = (out.length - 1) / (MAX_TRACE_POINTS - 1);
    out = Array.from({ length: MAX_TRACE_POINTS }, (_, i) => out[Math.round(i * step)]);
  }
  return out.map((p) => [round(p[0], 5), round(p[1], 5)]);
}

/** Event template for a finished unmapped trace. */
export function traceTemplate({ trace, nowSec }) {
  const cells = quantiseTrace(trace);
  const g5 = [...new Set(cells.map((c) => c.slice(0, 5)))].slice(0, MAX_G_TAGS);
  return {
    kind: KIND.TRACE,
    created_at: nowSec,
    tags: withAppTag(...g5.map((g) => ['g', g]), expirationTag(nowSec, TRACE_TTL_DAYS * 86400)),
    content: JSON.stringify({ cells, trace }),
  };
}

/** Validate a trace event. Cells are recomputed from the trace, never trusted. */
export function parseTraceEvent(e, nowSec) {
  if (e?.kind !== KIND.TRACE || !isTimely(e, nowSec)) return null;
  const exp = expirationOf(e);
  if (exp != null && exp <= nowSec) return null;
  const body = parseJsonObject(e.content, 24000);
  const raw = body?.trace;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_TRACE_POINTS) return null;
  if (!raw.every(isLngLat)) return null;
  const trace = raw.map((p) => [p[0], p[1]]);
  for (let i = 1; i < trace.length; i++) if (haversine(trace[i - 1], trace[i]) > MAX_SEGMENT_M) return null;
  const len = lineLength(trace);
  if (len < MIN_TRACE_M || len > MAX_TRACE_M) return null;
  return { id: e.id, by: e.pubkey, at: e.created_at * 1000, trace, cells: quantiseTrace(trace), length: len };
}

/** Distinct drivers per cell. */
export function cellDrivers(traces) {
  const sets = new Map();
  for (const t of traces) {
    for (const c of t.cells) {
      let s = sets.get(c);
      if (!s) sets.set(c, (s = new Set()));
      s.add(t.by);
    }
  }
  return new Map([...sets].map(([c, s]) => [c, s.size]));
}

/** Runs of consecutive cells (in trace order) whose driver count is ≥ threshold. */
export function confirmedRuns(cells, counts, threshold) {
  const runs = [];
  let run = [];
  for (const c of cells) {
    if ((counts.get(c) ?? 0) >= threshold) run.push(c);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/** Pieces of a trace that lie inside `cellSet` (MultiLineString coordinates). */
export function linesInCells(trace, cellSet) {
  const lines = [];
  let line = [];
  for (const p of densify(trace)) {
    if (cellSet.has(geohashEncode(p[1], p[0], CELL_PRECISION))) line.push(p);
    else if (line.length) {
      if (line.length > 1) lines.push(simplify(line, 3));
      line = [];
    }
  }
  if (line.length > 1) lines.push(simplify(line, 3));
  return lines;
}

function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

const coveredShare = (cells, covered) => (cells.length ? cells.filter((c) => covered.has(c)).length / cells.length : 1);

/**
 * Road consensus across traces.
 * confirmed: chains every cell of which ≥ threshold distinct drivers passed (drawn once).
 * pending: other distinct traces with their driver count (median over their cells).
 * @param {{id,by,at,trace,cells,length}[]} traces
 */
export function roadConsensus(traces, { threshold = 50, me = null } = {}) {
  const counts = cellDrivers(traces);
  const ordered = [...traces].sort((a, b) => b.cells.length - a.cells.length || (a.id < b.id ? -1 : 1));
  const covered = new Set();
  const confirmed = [];
  for (const t of ordered) {
    for (const run of confirmedRuns(t.cells, counts, threshold)) {
      if (coveredShare(run, covered) > 0.5) continue;
      run.forEach((c) => covered.add(c));
      confirmed.push({
        id: `${t.id.slice(0, 16)}:${run[0]}`,
        cells: run,
        lines: linesInCells(t.trace, new Set(run)),
        drivers: Math.min(...run.map((c) => counts.get(c))),
      });
    }
  }
  const pendingCovered = new Set();
  const pending = [];
  for (const t of ordered) {
    if (coveredShare(t.cells, covered) >= 0.5 || coveredShare(t.cells, pendingCovered) > 0.5) continue;
    t.cells.forEach((c) => pendingCovered.add(c));
    pending.push({ id: t.id, drivers: median(t.cells.map((c) => counts.get(c) ?? 0)), mine: t.by === me, trace: t.trace, length: t.length });
  }
  pending.sort((a, b) => Number(b.mine) - Number(a.mine) || b.drivers - a.drivers);
  return { counts, confirmed, pending };
}
