import { db } from './db.js'
import { listDays } from './germany-csv.js'
import { listYears, readAll, readStations } from './nationwide-csv.js'
import { addReading, finishShape, LOWLAND_LIMIT, MIN_FOR_FIT } from './nationwide-shape.js'

/**
 * One day of German weather, reduced to its shape — for 145 years.
 *
 * Four questions live here, and they share a table because they share a pass
 * over the data: how far apart the warmest and coldest places were, how
 * temperature fell with altitude, how it fell across the country, and which
 * station held each extreme.
 *
 * The series has two halves that must not show a seam. Everything before the
 * daily archive begins comes from `data/nationwide/`, written once from the DWD
 * historical archives; everything after is recomputed here from the archive the
 * repository already carries. Both halves run through the same arithmetic in
 * `nationwide-shape.js`, which is the only reason they meet cleanly.
 *
 * Only the climate network takes part, in both halves. The precipitation
 * network is four times larger but measures no temperature, and letting it in
 * would make the station count jump where its history begins rather than where
 * the weather changed.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

// The state table first: `dropIfStale` has to clear the signature it holds.
db.exec(`
  CREATE TABLE IF NOT EXISTS nationwide_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

/**
 * Drop the table when its columns no longer match this file.
 *
 * Everything in it is derived from files in the repository, so throwing it away
 * costs four seconds of rebuilding and nothing else. Without this a column added
 * here would leave an old database silently missing it, and the failure would
 * surface as a null in a chart rather than as an error.
 */
function dropIfStale(table, columns) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  if (existing.length === 0) return
  if (columns.every((c) => existing.includes(c)) && existing.length === columns.length) return

  // The signature has to go with it. Left behind, it would tell the loader the
  // data is current and the freshly emptied table would stay empty.
  db.exec(`DROP TABLE ${table}`)
  db.prepare("DELETE FROM nationwide_state WHERE key = 'signature'").run()
}

dropIfStale('nationwide_daily', [
  'date', 'stations',
  'mean_hi_station', 'mean_hi', 'mean_lo_station', 'mean_lo',
  'abs_hi_station', 'abs_hi', 'abs_lo_station', 'abs_lo',
  'low_hi_station', 'low_hi', 'low_lo_station', 'low_lo',
  'low_abs_hi_station', 'low_abs_hi', 'low_abs_lo_station', 'low_abs_lo',
  'wet_station', 'wet', 'gust_station', 'gust',
  'lapse', 'lapse_r2', 'grad_n', 'grad_e', 'grad_h', 'grad_r2', 'source',
])

db.exec(`
  CREATE TABLE IF NOT EXISTS nationwide_daily (
    date            TEXT PRIMARY KEY,
    stations        INTEGER NOT NULL,
    mean_hi_station TEXT,
    mean_hi         REAL,
    mean_lo_station TEXT,
    mean_lo         REAL,
    abs_hi_station  TEXT,
    abs_hi          REAL,
    abs_lo_station  TEXT,
    abs_lo          REAL,
    low_hi_station  TEXT,
    low_hi          REAL,
    low_lo_station  TEXT,
    low_lo          REAL,
    low_abs_hi_station TEXT,
    low_abs_hi      REAL,
    low_abs_lo_station TEXT,
    low_abs_lo      REAL,
    wet_station     TEXT,
    wet             REAL,
    gust_station    TEXT,
    gust            REAL,
    lapse           REAL,
    lapse_r2        REAL,
    grad_n          REAL,
    grad_e          REAL,
    grad_h          REAL,
    grad_r2         REAL,
    source          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nationwide_stations ON nationwide_daily (stations);
`)

const readState = db.prepare('SELECT value FROM nationwide_state WHERE key = ?')
const writeState = db.prepare(
  'INSERT INTO nationwide_state (key, value) VALUES (?, ?)' +
    ' ON CONFLICT (key) DO UPDATE SET value = excluded.value',
)

const insert = db.prepare(`
  INSERT INTO nationwide_daily (
    date, stations, mean_hi_station, mean_hi, mean_lo_station, mean_lo,
    abs_hi_station, abs_hi, abs_lo_station, abs_lo,
    low_hi_station, low_hi, low_lo_station, low_lo,
    low_abs_hi_station, low_abs_hi, low_abs_lo_station, low_abs_lo,
    wet_station, wet,
    gust_station, gust, lapse, lapse_r2, grad_n, grad_e, grad_h, grad_r2, source
  ) VALUES (
    @date, @stations, @meanHiStation, @meanHi, @meanLoStation, @meanLo,
    @absHiStation, @absHi, @absLoStation, @absLo,
    @lowHiStation, @lowHi, @lowLoStation, @lowLo,
    @lowAbsHiStation, @lowAbsHi, @lowAbsLoStation, @lowAbsLo,
    @wetStation, @wet,
    @gustStation, @gust, @lapse, @lapseR2, @gradN, @gradE, @gradH, @gradR2, @source
  )
  ON CONFLICT (date) DO UPDATE SET
    stations = excluded.stations,
    mean_hi_station = excluded.mean_hi_station, mean_hi = excluded.mean_hi,
    mean_lo_station = excluded.mean_lo_station, mean_lo = excluded.mean_lo,
    abs_hi_station = excluded.abs_hi_station, abs_hi = excluded.abs_hi,
    abs_lo_station = excluded.abs_lo_station, abs_lo = excluded.abs_lo,
    low_hi_station = excluded.low_hi_station, low_hi = excluded.low_hi,
    low_lo_station = excluded.low_lo_station, low_lo = excluded.low_lo,
    low_abs_hi_station = excluded.low_abs_hi_station, low_abs_hi = excluded.low_abs_hi,
    low_abs_lo_station = excluded.low_abs_lo_station, low_abs_lo = excluded.low_abs_lo,
    wet_station = excluded.wet_station, wet = excluded.wet,
    gust_station = excluded.gust_station, gust = excluded.gust,
    lapse = excluded.lapse, lapse_r2 = excluded.lapse_r2,
    grad_n = excluded.grad_n, grad_e = excluded.grad_e,
    grad_h = excluded.grad_h, grad_r2 = excluded.grad_r2,
    source = excluded.source
`)

const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row)
})

/* -------------------------------------------------------------------------- */
/* The live half                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Recompute the days the daily archive covers.
 *
 * The historical download stops at the archive's first day; from there the
 * repository's own CSVs are the better source, and they grow every night. Only
 * the climate network takes part, and only stations whose coordinates are
 * known — the same filter the collector applies.
 */
const liveStmt = db.prepare(`
  SELECT d.date, d.station_id, d.temp_mean, d.temp_max, d.temp_min,
         d.precipitation, d.wind_max, s.lat, s.lon, s.elevation
  FROM germany_daily d
  JOIN germany_stations s ON s.id = d.station_id
  WHERE s.network = 'kl' AND d.date >= ?
    AND s.lat IS NOT NULL AND s.lon IS NOT NULL AND s.elevation IS NOT NULL
  ORDER BY d.date
`)

function liveShape(cutoff) {
  const shape = new Map()
  for (const row of liveStmt.all(cutoff)) {
    addReading(shape, row.date, {
      id: row.station_id,
      lat: row.lat,
      lon: row.lon,
      elevation: row.elevation,
    }, row)
  }
  return finishShape(shape)
}

/* -------------------------------------------------------------------------- */
/* Load                                                                       */
/* -------------------------------------------------------------------------- */

const countStmt = db.prepare('SELECT COUNT(*) AS n FROM nationwide_daily')

export function loadNationwide({ force = false } = {}) {
  const years = listYears()
  const days = listDays()
  const cutoff = days[0] ?? null

  const signature = [years.length, years.at(-1) ?? '', days.length, days.at(-1) ?? ''].join('|')
  const held = countStmt.get()?.n ?? 0
  // The row count is part of the test, not just the signature. A signature left
  // behind by a schema change would otherwise report an empty table as current,
  // and the page would show nothing with no error anywhere.
  if (!force && held > 0 && readState.get('signature')?.value === signature) {
    return { days: held, cached: true }
  }

  const archive = readAll().map((row) => ({ ...row, source: 'archiv' }))
  const live = cutoff ? liveShape(cutoff).map((row) => ({ ...row, source: 'tagesarchiv' })) : []

  db.exec('DELETE FROM nationwide_daily')
  insertMany([...archive, ...live])
  writeState.run('signature', signature)
  if (cutoff) writeState.run('cutoff', cutoff)

  return { days: archive.length + live.length, archive: archive.length, live: live.length }
}

const loaded = loadNationwide()
if (loaded.days > 0 && !loaded.cached) {
  console.log(
    `Deutschlandtage: ${loaded.days.toLocaleString('de-DE')} Tage` +
      ` (${loaded.archive.toLocaleString('de-DE')} aus dem Archiv,` +
      ` ${loaded.live.toLocaleString('de-DE')} aus dem Tagesarchiv)`,
  )
}

/* -------------------------------------------------------------------------- */
/* Station names                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Names for every station the archive can name, open or closed.
 *
 * The register that ships with the archive covers the stations the historical
 * pass used; the live register covers what reports today. They overlap almost
 * entirely, and the union is what makes "Deutschlands kältester Ort am
 * 12.02.1929" a place rather than a five-digit number.
 */
const stationIndex = new Map()
for (const s of readStations()) {
  stationIndex.set(s.id, { id: s.id, name: s.name, state: s.state, elevation: s.elevation })
}
for (const s of db.prepare('SELECT id, name, state, elevation FROM germany_stations').all()) {
  if (!stationIndex.has(s.id)) stationIndex.set(s.id, s)
}

export function stationOf(id) {
  if (!id) return null
  return stationIndex.get(id) ?? { id, name: id, state: '', elevation: null }
}

/* -------------------------------------------------------------------------- */
/* How many stations a statement needs                                        */
/* -------------------------------------------------------------------------- */

/**
 * The floor under every figure on this page.
 *
 * "Germany's warmest and coldest place" is a claim about the country, and in
 * 1881 it would rest on the two dozen stations that existed. The span between
 * two stations can only grow as stations are added, so a thin day understates
 * it — which is the dangerous direction: the series would show a rising span
 * that is nothing but the network growing.
 *
 * A hundred stations is where the count stops driving the answer. The station
 * count travels with every row so the view can show what the threshold cost.
 */
export const MIN_STATIONS = 100

export const nationwideRange = () => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS days, MIN(date) AS first, MAX(date) AS last,
              SUM(CASE WHEN stations >= ? THEN 1 ELSE 0 END) AS counted,
              MIN(CASE WHEN stations >= ? THEN date END) AS countedFrom
       FROM nationwide_daily`,
    )
    .get(MIN_STATIONS, MIN_STATIONS)

  return {
    days: row?.days ?? 0,
    first: row?.first ?? null,
    last: row?.last ?? null,
    counted: row?.counted ?? 0,
    countedFrom: row?.countedFrom ?? null,
    cutoff: readState.get('cutoff')?.value ?? null,
    minStations: MIN_STATIONS,
    minForFit: MIN_FOR_FIT,
  }
}

/* -------------------------------------------------------------------------- */
/* The span of a day                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Two spans, and they answer different questions.
 *
 * The *mean* span compares the warmest place with the coldest on the day's
 * average temperature — the fairest comparison between two places, because it
 * does not depend on when each station happened to peak.
 *
 * The *absolute* span is the whole country's range that day: the highest
 * maximum anywhere against the lowest minimum anywhere. It is always the larger
 * and it is the number people mean when they say "and meanwhile in Bavaria" —
 * but the two readings may be twelve hours apart.
 *
 * Both come in two scopes. Over all stations the cold end is the Zugspitze on
 * almost every day of the year, which makes the span a measure of how high
 * Germany's highest mountain is. Below a thousand metres it becomes a question
 * about places people live.
 */
export const SPAN_SCOPES = [
  {
    key: 'alle',
    label: 'Alle Stationen',
    note: 'Mit den Bergstationen. Das kalte Ende hält fast immer die Zugspitze.',
    hi: 'mean_hi',
    lo: 'mean_lo',
    absHi: 'abs_hi',
    absLo: 'abs_lo',
  },
  {
    key: 'flachland',
    label: `Unter ${LOWLAND_LIMIT} m`,
    note: 'Ohne die Gipfel — die Spanne zwischen Orten, an denen Menschen wohnen.',
    hi: 'low_hi',
    lo: 'low_lo',
    absHi: 'low_abs_hi',
    absLo: 'low_abs_lo',
  },
]

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

/** The 90 % rule this project applies to every annual figure. */
const MIN_DAYS_PER_YEAR = 330

/** How many days each ranking shows. */
const TOP = 15

const complete = (scope) =>
  `stations >= ? AND ${scope.hi} IS NOT NULL AND ${scope.lo} IS NOT NULL
   AND ${scope.absHi} IS NOT NULL AND ${scope.absLo} IS NOT NULL`

const selectFor = (scope) => `
  date, stations, source,
  ${scope.hi} AS meanHi, ${scope.hi.replace(/_hi$/, '_hi_station')} AS meanHiStation,
  ${scope.lo} AS meanLo, ${scope.lo.replace(/_lo$/, '_lo_station')} AS meanLoStation,
  ${scope.absHi} AS absHi, ${scope.absHi}_station AS absHiStation,
  ${scope.absLo} AS absLo, ${scope.absLo}_station AS absLoStation,
  ${scope.hi} - ${scope.lo} AS meanSpan,
  ${scope.absHi} - ${scope.absLo} AS absSpan
`

const cache = new Map()
const prepared = (sql) => {
  if (!cache.has(sql)) cache.set(sql, db.prepare(sql))
  return cache.get(sql)
}

function spanFor(scope) {
  const annual = prepared(`
    SELECT CAST(strftime('%Y', date) AS INTEGER) AS year,
           COUNT(*) AS days,
           AVG(${scope.hi} - ${scope.lo}) AS meanSpan,
           MAX(${scope.hi} - ${scope.lo}) AS maxMeanSpan,
           AVG(${scope.absHi} - ${scope.absLo}) AS absSpan,
           MAX(${scope.absHi} - ${scope.absLo}) AS maxAbsSpan,
           AVG(stations) AS stations
    FROM nationwide_daily
    WHERE ${complete(scope)}
    GROUP BY year HAVING days >= ? ORDER BY year
  `).all(MIN_STATIONS, MIN_DAYS_PER_YEAR)

  const monthly = prepared(`
    SELECT CAST(strftime('%m', date) AS INTEGER) AS month,
           COUNT(*) AS days,
           AVG(${scope.hi} - ${scope.lo}) AS meanSpan,
           AVG(${scope.absHi} - ${scope.absLo}) AS absSpan,
           MAX(${scope.absHi} - ${scope.absLo}) AS maxAbsSpan
    FROM nationwide_daily
    WHERE ${complete(scope)}
    GROUP BY month ORDER BY month
  `).all(MIN_STATIONS)

  const ranked = (order) =>
    prepared(
      `SELECT ${selectFor(scope)} FROM nationwide_daily
       WHERE ${complete(scope)} ORDER BY ${order} LIMIT ?`,
    )
      .all(MIN_STATIONS, TOP)
      .map(withStations)

  /**
   * Which station holds each end, and how often.
   *
   * One line that says more than the whole ranking: if the same place is the
   * cold end on four days in five, the span is a fact about that place.
   */
  const holders = (column) =>
    prepared(
      `SELECT ${column} AS id, COUNT(*) AS days FROM nationwide_daily
       WHERE stations >= ? AND ${column} IS NOT NULL
       GROUP BY ${column} ORDER BY days DESC LIMIT 5`,
    )
      .all(MIN_STATIONS)
      .map((row) => ({ ...stationOf(row.id), days: row.days }))

  const counted = prepared(
    `SELECT COUNT(*) AS n FROM nationwide_daily WHERE ${complete(scope)}`,
  ).get(MIN_STATIONS)?.n ?? 0

  return {
    ...scope,
    days: counted,
    annual,
    monthly: monthly.map((row) => ({ ...row, label: MONTHS[row.month - 1] })),
    top: {
      absolute: ranked(`${scope.absHi} - ${scope.absLo} DESC`),
      mean: ranked(`${scope.hi} - ${scope.lo} DESC`),
      narrow: ranked(`${scope.absHi} - ${scope.absLo} ASC`),
    },
    holders: {
      warm: holders(scope.hi.replace(/_hi$/, '_hi_station')),
      cold: holders(scope.lo.replace(/_lo$/, '_lo_station')),
    },
  }
}

const withStations = (row) => ({
  ...row,
  meanHiStation: stationOf(row.meanHiStation),
  meanLoStation: stationOf(row.meanLoStation),
  absHiStation: stationOf(row.absHiStation),
  absLoStation: stationOf(row.absLoStation),
})

export function spanAnalysis() {
  const range = nationwideRange()
  if (range.counted === 0) return null

  return {
    range,
    lowlandLimit: LOWLAND_LIMIT,
    minDaysPerYear: MIN_DAYS_PER_YEAR,
    top: TOP,
    scopes: SPAN_SCOPES.map(spanFor),
  }
}
