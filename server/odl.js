import { db } from './db.js'
import { ORIGIN, QUANTITY, RADIUS_KM } from './odl-sources.js'
import { listDays, readDay, readProbes } from './odl-csv.js'

/**
 * Gamma dose rate around Göttingen, as a queryable series.
 *
 * This is the youngest archive in the project and the only one that cannot be
 * backfilled — the BfS keeps seven days. Everything here beyond that window
 * exists because the collector ran. The views therefore state the length of the
 * record prominently rather than drawing a decade's worth of chart furniture
 * around a fortnight of data.
 *
 * What is worth looking at from day one is the spread between probes. Eleven
 * sites within 25 km differ by nearly half again from lowest to highest, and
 * that difference is not noise: it is the ground they stand on. The BfS splits
 * each reading into a cosmic and a terrestrial share, and here the split is
 * one-sided — the cosmic share sits at 0.044 to 0.046 µSv/h across all eleven,
 * while the terrestrial share runs from 0.072 to 0.110. Physically the cosmic
 * part does climb with altitude, but 175 metres of relief is not enough to show
 * it at three decimal places, and the view should not pretend otherwise.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS odl_hourly (
    probe TEXT    NOT NULL,
    date  TEXT    NOT NULL,
    hour  INTEGER NOT NULL,
    value REAL    NOT NULL,
    PRIMARY KEY (probe, date, hour)
  );

  CREATE INDEX IF NOT EXISTS idx_odl_hourly_date ON odl_hourly (date);

  CREATE TABLE IF NOT EXISTS odl_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const readState = db.prepare('SELECT value FROM odl_state WHERE key = ?')
const writeState = db.prepare(
  'INSERT INTO odl_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
)

const insert = db.prepare(`
  INSERT INTO odl_hourly (probe, date, hour, value)
  VALUES (@probe, @date, @hour, @value)
  ON CONFLICT (probe, date, hour) DO UPDATE SET value = excluded.value
`)
const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row)
})

/**
 * Load the committed archive.
 *
 * The signature covers the tail of the day list because the collector rewrites
 * the newest days as the rolling window fills them in — a day already present
 * can still gain hours.
 */
export function importOdl({ force = false } = {}) {
  const days = listDays()
  if (days.length === 0) return { rows: 0 }

  const signature = `${days.length}|${days[0]}|${days.slice(-8).join(',')}`
  if (!force && readState.get('signature')?.value === signature) {
    return { rows: 0, cached: true }
  }

  let rows = 0
  const batch = []
  for (const date of days) {
    for (const row of readDay(date)) {
      batch.push(row)
      rows++
    }
    if (batch.length >= 20_000) {
      insertMany(batch)
      batch.length = 0
    }
  }
  if (batch.length > 0) insertMany(batch)

  writeState.run('signature', signature)
  return { rows, days: days.length }
}

const loaded = importOdl()
if (loaded.rows > 0) {
  console.log(
    `Ortsdosisleistung geladen: ${loaded.rows.toLocaleString('de-DE')} Stundenwerte,` +
      ` ${loaded.days} Tage`,
  )
}

/* -------------------------------------------------------------------------- */
/* Range                                                                      */
/* -------------------------------------------------------------------------- */

const rangeStmt = db.prepare(
  'SELECT MIN(date) AS first, MAX(date) AS last, COUNT(DISTINCT date) AS days FROM odl_hourly',
)

export function odlRange() {
  const row = rangeStmt.get()
  return { first: row?.first ?? null, last: row?.last ?? null, days: row?.days ?? 0 }
}

/* -------------------------------------------------------------------------- */
/* Probes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The register, joined with what the archive knows about each probe.
 *
 * Every probe carries its own statistics rather than being compared against a
 * shared scale: the sites differ by more than a third from one another, so a
 * value that is high for Göttingen would be unremarkable at Waake, and one
 * common colour scale across the map would say nothing but "geology".
 */
export function odlProbes() {
  const register = readProbes()
  const stats = db
    .prepare(
      `SELECT probe, COUNT(*) AS hours, AVG(value) AS mean,
              MIN(value) AS min, MAX(value) AS max,
              MAX(date) AS last_date
       FROM odl_hourly GROUP BY probe`,
    )
    .all()

  const byProbe = new Map(stats.map((s) => [s.probe, s]))

  const latest = db.prepare(
    'SELECT value, date, hour FROM odl_hourly WHERE probe = ? ORDER BY date DESC, hour DESC LIMIT 1',
  )

  const out = []
  for (const probe of register.values()) {
    const stat = byProbe.get(probe.id)
    const current = latest.get(probe.id)
    out.push({
      ...probe,
      hours: stat?.hours ?? 0,
      mean: stat?.mean ?? null,
      min: stat?.min ?? null,
      max: stat?.max ?? null,
      latest: current
        ? { value: current.value, date: current.date, hour: current.hour }
        : null,
    })
  }
  return out.sort((a, b) => a.distance - b.distance)
}

/* -------------------------------------------------------------------------- */
/* Series                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every probe's hourly values over the archive, as one timeline.
 *
 * Sent whole because it is small — eleven probes over a young archive — and
 * because the interesting feature is where the curves move together. A rainfall
 * event lifts all of them at once; an instrument problem lifts one.
 */
export function odlSeries({ days = 30 } = {}) {
  const range = odlRange()
  if (!range.last) return { range, probes: [], hours: [] }

  const from = new Date(`${range.last}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - (days - 1))
  const since = from.toISOString().slice(0, 10)

  const rows = db
    .prepare(
      'SELECT probe, date, hour, value FROM odl_hourly WHERE date >= ? ORDER BY date, hour, probe',
    )
    .all(since)

  const byProbe = new Map()
  for (const row of rows) {
    if (!byProbe.has(row.probe)) byProbe.set(row.probe, [])
    byProbe.get(row.probe).push({
      // A single sortable stamp keeps the frontend from reassembling one.
      at: `${row.date}T${String(row.hour).padStart(2, '0')}:00Z`,
      value: row.value,
    })
  }

  return {
    range,
    since,
    probes: [...byProbe.entries()].map(([probe, points]) => ({ probe, points })),
  }
}

/** Daily means per probe — the shape a longer archive will eventually show. */
export function odlDaily() {
  return db
    .prepare(
      `SELECT probe, date, AVG(value) AS mean, MIN(value) AS min,
              MAX(value) AS max, COUNT(*) AS hours
       FROM odl_hourly GROUP BY probe, date ORDER BY date, probe`,
    )
    .all()
}

/* -------------------------------------------------------------------------- */
/* The assembled answer                                                       */
/* -------------------------------------------------------------------------- */

export function odlOverview({ days = 30 } = {}) {
  const probes = odlProbes()
  const series = odlSeries({ days })

  return {
    quantity: QUANTITY,
    origin: ORIGIN,
    radiusKm: RADIUS_KM,
    range: series.range,
    since: series.since ?? null,
    probes,
    series: series.probes,
    daily: odlDaily(),
    /**
     * Stated in the payload so the view cannot forget it: this archive has no
     * history behind what was collected, and saying "seven days" once is
     * clearer than a footnote under every chart.
     */
    windowNote:
      'Das BfS hält ein Fenster von sieben Tagen vor. Alles darüber hinaus steht' +
      ' hier, weil es täglich mitgeschrieben wurde — rückwirkend ist es nicht zu' +
      ' beschaffen.',
  }
}
