import { db } from './db.js'
import {
  GAUGES,
  fetchNlwkn,
  fetchPegelonlineSeries,
  findGauge,
} from './gauge-sources.js'
import { appendReadings, readReadings } from './gauge-csv.js'

export { GAUGES, findGauge, fetchNlwkn, fetchPegelonlineSeries }

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS gauge_readings (
    gauge_id TEXT NOT NULL,
    ts       TEXT NOT NULL,   -- ISO 8601 with offset
    value    REAL NOT NULL,   -- water level in cm above gauge datum
    PRIMARY KEY (gauge_id, ts)
  );
  CREATE INDEX IF NOT EXISTS idx_gauge_readings_ts
    ON gauge_readings (gauge_id, ts DESC);

  CREATE TABLE IF NOT EXISTS gauge_meta (
    gauge_id   TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,  -- JSON: thresholds, characteristic values, …
    fetched_at TEXT NOT NULL
  );
`)

const insertReading = db.prepare(`
  INSERT INTO gauge_readings (gauge_id, ts, value) VALUES (?, ?, ?)
  ON CONFLICT (gauge_id, ts) DO UPDATE SET value = excluded.value
`)
const insertMany = db.transaction((gaugeId, rows) => {
  for (const r of rows) insertReading.run(gaugeId, r.ts, r.value)
})

const upsertMeta = db.prepare(`
  INSERT INTO gauge_meta (gauge_id, payload, fetched_at) VALUES (?, ?, ?)
  ON CONFLICT (gauge_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
`)
const readMeta = db.prepare('SELECT payload, fetched_at FROM gauge_meta WHERE gauge_id = ?')

/* -------------------------------------------------------------------------- */
/* CSV archive -> database                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Load the committed archive on startup.
 *
 * The scheduled workflow collects readings around the clock and commits them
 * as CSV. Without this step a fresh clone would show an empty chart for the
 * two state gauges even though months of history sit right there in the repo.
 */
export function importArchive() {
  const summary = []
  for (const gauge of GAUGES) {
    const rows = readReadings(gauge.id)
    if (rows.length > 0) insertMany(gauge.id, rows)
    summary.push({ gauge: gauge.id, imported: rows.length })
  }
  return summary
}

const archive = importArchive()
const archived = archive.reduce((sum, a) => sum + a.imported, 0)
if (archived > 0) {
  console.log(`Pegelarchiv geladen: ${archived.toLocaleString('de-DE')} Messwerte`)
}

/* -------------------------------------------------------------------------- */
/* Refresh                                                                    */
/* -------------------------------------------------------------------------- */

/** Serve from the database unless the stored metadata is older than this. */
const CACHE_MINUTES = 10

function isStale(fetchedAt) {
  if (!fetchedAt) return true
  const age = Date.now() - Date.parse(fetchedAt)
  return !Number.isFinite(age) || age > CACHE_MINUTES * 60_000
}

export async function refreshGauge(gauge) {
  // Thresholds and characteristic values only exist on the NLWKN page, so it
  // is fetched for every gauge — including Wahmbeck, whose readings come from
  // PEGELONLINE.
  const meta = await fetchNlwkn(gauge)

  let readings = []
  if (gauge.source === 'pegelonline') {
    readings = await fetchPegelonlineSeries(gauge)
  } else if (meta.current && meta.current.measuredAt) {
    readings = [{ ts: meta.current.measuredAt, value: meta.current.cm }]
  }

  insertMany(gauge.id, readings)
  // Keep the on-disk archive in step, so a locally running instance
  // contributes the same history the workflow collects.
  const appended = appendReadings(gauge.id, readings)

  upsertMeta.run(gauge.id, JSON.stringify(meta), new Date().toISOString())
  return { gauge: gauge.id, storedReadings: readings.length, appendedToArchive: appended }
}

export async function refreshAll({ force = false } = {}) {
  const results = []
  for (const gauge of GAUGES) {
    const cached = readMeta.get(gauge.id)
    if (!force && !isStale(cached?.fetched_at)) {
      results.push({ gauge: gauge.id, skipped: 'aktuell' })
      continue
    }
    try {
      results.push(await refreshGauge(gauge))
    } catch (error) {
      results.push({
        gauge: gauge.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

const seriesStmt = db.prepare(`
  SELECT ts, value FROM gauge_readings
  WHERE gauge_id = ? AND ts >= ?
  ORDER BY ts
`)

const rangeStmt = db.prepare(`
  SELECT COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last,
         MIN(value) AS minValue, MAX(value) AS maxValue, AVG(value) AS avgValue
  FROM gauge_readings WHERE gauge_id = ? AND ts >= ?
`)

const totalStmt = db.prepare(
  'SELECT COUNT(*) AS n, MIN(ts) AS first FROM gauge_readings WHERE gauge_id = ?',
)

const latestStmt = db.prepare(
  'SELECT ts, value FROM gauge_readings WHERE gauge_id = ? ORDER BY ts DESC LIMIT 1',
)

function sinceIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

export function gaugeSummary(gauge, days = 30) {
  const cached = readMeta.get(gauge.id)
  const meta = cached ? JSON.parse(cached.payload) : null
  const since = sinceIso(days)
  const range = rangeStmt.get(gauge.id, since)
  const total = totalStmt.get(gauge.id)
  const latest = latestStmt.get(gauge.id)

  return {
    id: gauge.id,
    name: gauge.name,
    water: gauge.water,
    catchment: gauge.catchment,
    source: gauge.source,
    fetchedAt: cached?.fetched_at ?? null,
    latest: latest ? { ts: latest.ts, value: latest.value } : null,
    window: {
      days,
      count: range?.n ?? 0,
      first: range?.first ?? null,
      last: range?.last ?? null,
      min: range?.minValue ?? null,
      max: range?.maxValue ?? null,
      mean: range?.avgValue ?? null,
    },
    /** Everything ever collected, across the whole archive. */
    archive: { count: total?.n ?? 0, first: total?.first ?? null },
    ...(meta ?? {}),
  }
}

export function gaugeSeries(gauge, days = 30) {
  return seriesStmt.all(gauge.id, sinceIso(days))
}
