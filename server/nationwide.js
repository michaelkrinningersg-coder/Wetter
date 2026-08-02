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

/**
 * Just the extent of the archive.
 *
 * Every sub-view fetches its own payload, but they all share one preamble —
 * how far the archive reaches and what it rests on. Two hundred bytes, so the
 * shell can say it without pulling in a whole analysis the reader may not open.
 */
export function nationwideOverview() {
  const range = nationwideRange()
  return range.days === 0 ? null : { range, lowlandLimit: LOWLAND_LIMIT }
}

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

/* -------------------------------------------------------------------------- */
/* How temperature falls with altitude                                        */
/* -------------------------------------------------------------------------- */

/**
 * Two answers to the same question, and their difference is the point.
 *
 * Regressing temperature on altitude alone gives about −0.4 K per 100 m over
 * this record. That is too shallow, and the reason is that Germany's high
 * ground is in the south and the south is also further from the sea: the naive
 * fit blames altitude for part of what is really geography, and geography here
 * works against it. Fitting altitude together with north and east — the same
 * fit the gradients use — gives about −0.55, and the goodness of fit rises from
 * 0.40 to 0.70.
 *
 * Both numbers ship. The naive one is what a scatter plot of temperature
 * against altitude actually shows, and hiding it would make the chart disagree
 * with the number printed beside it.
 */
const lapseComplete = 'stations >= ? AND lapse IS NOT NULL AND grad_h IS NOT NULL'

const lapseAnnualStmt = db.prepare(`
  SELECT CAST(strftime('%Y', date) AS INTEGER) AS year,
         COUNT(*) AS days,
         AVG(lapse) AS lapse, AVG(lapse_r2) AS lapseR2,
         AVG(grad_h) AS gradH, AVG(grad_r2) AS gradR2,
         SUM(CASE WHEN grad_h > 0 THEN 1 ELSE 0 END) AS inversionDays,
         AVG(stations) AS stations
  FROM nationwide_daily
  WHERE ${lapseComplete}
  GROUP BY year HAVING days >= ? ORDER BY year
`)

const lapseMonthlyStmt = db.prepare(`
  SELECT CAST(strftime('%m', date) AS INTEGER) AS month,
         COUNT(*) AS days,
         AVG(lapse) AS lapse, AVG(lapse_r2) AS lapseR2,
         AVG(grad_h) AS gradH, AVG(grad_r2) AS gradR2,
         SUM(CASE WHEN grad_h > 0 THEN 1 ELSE 0 END) AS inversionDays
  FROM nationwide_daily
  WHERE ${lapseComplete}
  GROUP BY month ORDER BY month
`)

const lapseDaySelect = `
  date, stations, source, lapse, lapse_r2 AS lapseR2,
  grad_h AS gradH, grad_n AS gradN, grad_e AS gradE, grad_r2 AS gradR2,
  abs_hi AS absHi, abs_hi_station AS absHiStation,
  abs_lo AS absLo, abs_lo_station AS absLoStation
`

const lapseTopStmt = (order) =>
  db.prepare(
    `SELECT ${lapseDaySelect} FROM nationwide_daily
     WHERE ${lapseComplete} ORDER BY grad_h ${order} LIMIT ?`,
  )

const strongestInversionStmt = lapseTopStmt('DESC')
const steepestLapseStmt = lapseTopStmt('ASC')

/**
 * The distribution of the daily gradient, in steps of 0.05 K per 100 m.
 *
 * A mean of −0.55 could be a narrow cluster or two seasons pulling apart. The
 * histogram settles it, and it puts the inversion days where they belong: not
 * as an anomaly in a footnote but as the right-hand tail of an ordinary
 * distribution.
 */
const LAPSE_BIN = 0.05

const lapseHistogramStmt = db.prepare(`
  SELECT CAST(FLOOR(grad_h / ${LAPSE_BIN}) AS INTEGER) AS bin, COUNT(*) AS days
  FROM nationwide_daily WHERE ${lapseComplete}
  GROUP BY bin ORDER BY bin
`)

const withLapseStations = (row) => ({
  ...row,
  absHiStation: stationOf(row.absHiStation),
  absLoStation: stationOf(row.absLoStation),
})

export function lapseAnalysis() {
  const range = nationwideRange()
  if (range.counted === 0) return null

  const overall = db
    .prepare(
      `SELECT COUNT(*) AS days,
              AVG(lapse) AS lapse, AVG(lapse_r2) AS lapseR2,
              AVG(grad_h) AS gradH, AVG(grad_r2) AS gradR2,
              SUM(CASE WHEN grad_h > 0 THEN 1 ELSE 0 END) AS inversionDays
       FROM nationwide_daily WHERE ${lapseComplete}`,
    )
    .get(MIN_STATIONS)

  return {
    range,
    minDaysPerYear: MIN_DAYS_PER_YEAR,
    binWidth: LAPSE_BIN,
    top: TOP,
    overall,
    annual: lapseAnnualStmt.all(MIN_STATIONS, MIN_DAYS_PER_YEAR),
    monthly: lapseMonthlyStmt.all(MIN_STATIONS).map((row) => ({
      ...row,
      label: MONTHS[row.month - 1],
      inversionShare: row.inversionDays / row.days,
    })),
    histogram: lapseHistogramStmt.all(MIN_STATIONS).map((row) => ({
      from: row.bin * LAPSE_BIN,
      to: (row.bin + 1) * LAPSE_BIN,
      days: row.days,
      share: row.days / (overall?.days ?? 1),
    })),
    inversions: strongestInversionStmt.all(MIN_STATIONS, TOP).map(withLapseStations),
    steepest: steepestLapseStmt.all(MIN_STATIONS, TOP).map(withLapseStations),
  }
}

/* -------------------------------------------------------------------------- */
/* One day's shape                                                            */
/* -------------------------------------------------------------------------- */

const shapeStmt = db.prepare(`
  SELECT ${lapseDaySelect},
         mean_hi AS meanHi, mean_hi_station AS meanHiStation,
         mean_lo AS meanLo, mean_lo_station AS meanLoStation,
         low_abs_hi AS lowAbsHi, low_abs_hi_station AS lowAbsHiStation,
         low_abs_lo AS lowAbsLo, low_abs_lo_station AS lowAbsLoStation
  FROM nationwide_daily WHERE date = ?
`)

/**
 * The fitted shape of a single day, to travel with that day's map.
 *
 * The map payload already carries every station's reading, so the scatter of
 * temperature against altitude can be drawn in the browser from what is
 * already there. What the browser cannot derive is the fit that holds position
 * constant — that needs the sums this table was built from — so it rides along
 * here rather than becoming a request of its own.
 */
export function shapeForDate(date) {
  const row = shapeStmt.get(date)
  if (!row) return null
  return {
    ...row,
    minStations: MIN_STATIONS,
    enough: row.stations >= MIN_STATIONS,
    absHiStation: stationOf(row.absHiStation),
    absLoStation: stationOf(row.absLoStation),
    meanHiStation: stationOf(row.meanHiStation),
    meanLoStation: stationOf(row.meanLoStation),
    lowAbsHiStation: stationOf(row.lowAbsHiStation),
    lowAbsLoStation: stationOf(row.lowAbsLoStation),
  }
}

/* -------------------------------------------------------------------------- */
/* The geographic gradient                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which way it gets warmer, and by how much.
 *
 * The same fit that produces the altitude coefficient produces two more: how
 * temperature changes per 100 km northward and per 100 km eastward, each with
 * the other two held constant. Together they are a vector — a direction and a
 * steepness — and that vector turns through the year in a way no single
 * coefficient shows.
 *
 * In January the north-south component is near zero and the east-west one is
 * strongly negative: the country is not colder in the north, it is colder in
 * the east. In June it reverses — the east is warmer and the north-south
 * gradient is at its steepest. That is continentality, measured rather than
 * asserted: in winter the Atlantic warms what is near it, in summer it cools it.
 */
const GRAD_COMPLETE = 'stations >= ? AND grad_n IS NOT NULL AND grad_e IS NOT NULL'

/** Compass points, for saying "warmer towards the south-west" in two letters. */
const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']

/**
 * The direction in which it gets warmer, as a bearing from north.
 *
 * `gradN` is K per 100 km northward, `gradE` per 100 km eastward, so the pair
 * is already a vector in (north, east). Its bearing is the direction of
 * steepest increase; its length is how steep, in K per 100 km, regardless of
 * which way the country happens to be tilted that day.
 */
function direction(gradN, gradE) {
  if (gradN === null || gradE === null) return null
  const magnitude = Math.hypot(gradN, gradE)
  const bearing = (((Math.atan2(gradE, gradN) * 180) / Math.PI) + 360) % 360
  return {
    magnitude,
    bearing,
    compass: COMPASS[Math.round(bearing / 45) % 8],
  }
}

const gradAnnualStmt = db.prepare(`
  SELECT CAST(strftime('%Y', date) AS INTEGER) AS year, COUNT(*) AS days,
         AVG(grad_n) AS gradN, AVG(grad_e) AS gradE, AVG(grad_r2) AS gradR2
  FROM nationwide_daily WHERE ${GRAD_COMPLETE}
  GROUP BY year HAVING days >= ? ORDER BY year
`)

const gradMonthlyStmt = db.prepare(`
  SELECT CAST(strftime('%m', date) AS INTEGER) AS month, COUNT(*) AS days,
         AVG(grad_n) AS gradN, AVG(grad_e) AS gradE,
         AVG(grad_h) AS gradH, AVG(grad_r2) AS gradR2,
         SUM(CASE WHEN grad_e > 0 THEN 1 ELSE 0 END) AS eastWarmerDays,
         SUM(CASE WHEN grad_n > 0 THEN 1 ELSE 0 END) AS northWarmerDays
  FROM nationwide_daily WHERE ${GRAD_COMPLETE}
  GROUP BY month ORDER BY month
`)

const gradDaySelect = `
  date, stations, source,
  grad_n AS gradN, grad_e AS gradE, grad_h AS gradH, grad_r2 AS gradR2,
  abs_hi AS absHi, abs_hi_station AS absHiStation,
  abs_lo AS absLo, abs_lo_station AS absLoStation
`

const gradTopStmt = (order) =>
  db.prepare(
    `SELECT ${gradDaySelect} FROM nationwide_daily
     WHERE ${GRAD_COMPLETE} ORDER BY ${order} LIMIT ?`,
  )

/**
 * Four rankings, one per direction the country can tilt.
 *
 * Not "the biggest gradient" in the abstract: a day on which the south is
 * 6 K warmer than the north and one on which the east is 6 K colder than the
 * west are different weather, and a single ranking by magnitude would mix them.
 */
const GRAD_EXTREMES = [
  {
    key: 'southWarm',
    label: 'Süden am wärmsten',
    note: 'Föhnlagen und Frühjahrstage, an denen der Norden noch unter Meereinfluss steht.',
    order: 'grad_n ASC',
  },
  {
    key: 'northWarm',
    label: 'Norden am wärmsten',
    note: 'Meist Winterlagen mit milder Meeresluft im Norden und Kaltluftsee im Süden.',
    order: 'grad_n DESC',
  },
  {
    key: 'westWarm',
    label: 'Westen am wärmsten',
    note: 'Atlantische Milderung gegen kontinentale Kälte — die klassische Winterlage.',
    order: 'grad_e ASC',
  },
  {
    key: 'eastWarm',
    label: 'Osten am wärmsten',
    note: 'Sommerliche Kontinentalität: der Osten heizt sich auf, während der Westen Seewind bekommt.',
    order: 'grad_e DESC',
  },
]

const withGradStations = (row) => ({
  ...row,
  ...direction(row.gradN, row.gradE),
  absHiStation: stationOf(row.absHiStation),
  absLoStation: stationOf(row.absLoStation),
})

export function gradientAnalysis() {
  const range = nationwideRange()
  if (range.counted === 0) return null

  const overall = db
    .prepare(
      `SELECT COUNT(*) AS days, AVG(grad_n) AS gradN, AVG(grad_e) AS gradE,
              AVG(grad_h) AS gradH, AVG(grad_r2) AS gradR2,
              AVG(ABS(grad_n)) AS absN, AVG(ABS(grad_e)) AS absE
       FROM nationwide_daily WHERE ${GRAD_COMPLETE}`,
    )
    .get(MIN_STATIONS)

  return {
    range,
    minDaysPerYear: MIN_DAYS_PER_YEAR,
    top: TOP,
    overall: { ...overall, ...direction(overall.gradN, overall.gradE) },
    annual: gradAnnualStmt
      .all(MIN_STATIONS, MIN_DAYS_PER_YEAR)
      .map((row) => ({ ...row, ...direction(row.gradN, row.gradE) })),
    monthly: gradMonthlyStmt.all(MIN_STATIONS).map((row) => ({
      ...row,
      label: MONTHS[row.month - 1],
      eastWarmerShare: row.eastWarmerDays / row.days,
      northWarmerShare: row.northWarmerDays / row.days,
      ...direction(row.gradN, row.gradE),
    })),
    extremes: GRAD_EXTREMES.map((extreme) => ({
      ...extreme,
      days: gradTopStmt(extreme.order).all(MIN_STATIONS, TOP).map(withGradStations),
    })),
  }
}
