import { db } from './db.js'
import { ORIGIN, RADIUS_KM } from './pheno-sources.js'
import { hasArchive, readNames, readObservations, readStations } from './pheno-csv.js'

/**
 * Phenology around Göttingen, as a queryable archive.
 *
 * Everything else in this project measures the weather. This measures what the
 * weather did: the day a hazel first flowered, an apple was ready to pick, an
 * oak dropped its leaves. Those dates are observations of the climate's effect,
 * recorded by volunteers, and they move.
 *
 * Two honest limits, both properties of the source rather than of this code:
 *
 *   - Of the 46 reporter stations inside the radius, only fourteen ever
 *     reported, and most stopped decades ago. Only one reaches 2023; the one at
 *     the weather station itself ends in 2015.
 *   - The series therefore ends where it ends. This archive does not grow, and
 *     no view here draws an axis to the present pretending otherwise.
 *
 * A year's value is the mean across whichever stations reported it. Within
 * 25 km and under 200 m of relief that is defensible; it is stated with the
 * station count so a year resting on one observer is visible as such.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS pheno_observations (
    station TEXT    NOT NULL,
    year    INTEGER NOT NULL,
    plant   INTEGER NOT NULL,
    phase   INTEGER NOT NULL,
    date    TEXT    NOT NULL,
    julian  INTEGER NOT NULL,
    quality INTEGER,
    PRIMARY KEY (station, year, plant, phase)
  );

  CREATE INDEX IF NOT EXISTS idx_pheno_combo ON pheno_observations (plant, phase, year);

  CREATE TABLE IF NOT EXISTS pheno_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const readState = db.prepare('SELECT value FROM pheno_state WHERE key = ?')
const writeState = db.prepare(
  'INSERT INTO pheno_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
)

const insert = db.prepare(`
  INSERT INTO pheno_observations (station, year, plant, phase, date, julian, quality)
  VALUES (@station, @year, @plant, @phase, @date, @julian, @quality)
  ON CONFLICT (station, year, plant, phase) DO UPDATE SET
    date = excluded.date, julian = excluded.julian, quality = excluded.quality
`)
const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row)
})

let NAMES = { plants: new Map(), phases: new Map() }
let STATIONS = new Map()

export function importPheno({ force = false } = {}) {
  if (!hasArchive()) return { rows: 0 }

  const rows = readObservations()
  NAMES = readNames()
  STATIONS = readStations()
  if (rows.length === 0) return { rows: 0 }

  const signature = `${rows.length}|${STATIONS.size}|${NAMES.plants.size}`
  if (!force && readState.get('signature')?.value === signature) {
    return { rows: 0, cached: true }
  }

  insertMany(rows)
  writeState.run('signature', signature)
  return { rows: rows.length, stations: STATIONS.size }
}

const loaded = importPheno()
if (loaded.rows > 0) {
  console.log(
    `Phänologie geladen: ${loaded.rows.toLocaleString('de-DE')} Beobachtungen,` +
      ` ${loaded.stations} Stationen`,
  )
} else if (hasArchive()) {
  // The dictionaries live in memory, not in the database, so they have to be
  // read even when the observations were already imported on a previous start.
  NAMES = readNames()
  STATIONS = readStations()
}

const plantName = (id) => NAMES.plants.get(id) ?? `Pflanze ${id}`
const phaseName = (id) => NAMES.phases.get(id) ?? `Phase ${id}`

/* -------------------------------------------------------------------------- */
/* The ten phenological seasons                                               */
/* -------------------------------------------------------------------------- */

/**
 * The indicator phases the DWD defines its phenological year by.
 *
 * Each season begins when one named plant reaches one named phase — that is the
 * whole definition, and it is spelled out here and in the view so a reader can
 * check the result against it rather than take it on faith.
 *
 * Two of them need a note:
 *
 *   - Vollfrühling. Until 1990 the DWD recorded one undivided "Apfel"; from
 *     1991 it splits into early- and late-ripening varieties. The bloom series
 *     is therefore spliced from plant 310 up to 1990 and plant 311 afterwards.
 *     The alternative — showing a series that stops in 1990 and another that
 *     starts in 1991 — would hide a continuous phenomenon behind a change of
 *     bookkeeping.
 *   - Spätsommer. The apple's ripeness phase is "Pflückreife Beginn" (29), not
 *     the "erste reife Früchte" (62) used for the wild species.
 */
export const PHENO_SEASONS = [
  { key: 'vorfruehling', label: 'Vorfrühling', plants: [113], phase: 5, order: 1 },
  { key: 'erstfruehling', label: 'Erstfrühling', plants: [109], phase: 5, order: 2 },
  {
    key: 'vollfruehling',
    label: 'Vollfrühling',
    plants: [310, 311],
    phase: 5,
    order: 3,
    note: 'Apfel; bis 1990 unaufgeteilt, ab 1991 die früh reifende Sorte.',
  },
  { key: 'fruehsommer', label: 'Frühsommer', plants: [129], phase: 5, order: 4 },
  { key: 'hochsommer', label: 'Hochsommer', plants: [130], phase: 5, order: 5 },
  {
    key: 'spaetsommer',
    label: 'Spätsommer',
    plants: [311],
    phase: 29,
    order: 6,
    note: 'Beginn der Pflückreife, nicht „erste reife Früchte".',
  },
  { key: 'fruehherbst', label: 'Frühherbst', plants: [129], phase: 62, order: 7 },
  { key: 'vollherbst', label: 'Vollherbst', plants: [132], phase: 62, order: 8 },
  { key: 'spaetherbst', label: 'Spätherbst', plants: [132], phase: 31, order: 9 },
  { key: 'winter', label: 'Winter', plants: [132], phase: 32, order: 10 },
]

const seriesStmt = (count) =>
  db.prepare(
    `SELECT year, AVG(julian) AS day, COUNT(*) AS reports,
            COUNT(DISTINCT station) AS stations, MIN(julian) AS earliest, MAX(julian) AS latest
     FROM pheno_observations
     WHERE plant IN (${'?,'.repeat(count).slice(0, -1)}) AND phase = ?
     GROUP BY year ORDER BY year`,
  )

/** One season's onset per year, averaged across whichever stations reported. */
export function seasonSeries(season) {
  const rows = seriesStmt(season.plants.length).all(...season.plants, season.phase)
  return rows.map((r) => ({
    year: r.year,
    day: r.day,
    reports: r.reports,
    stations: r.stations,
    earliest: r.earliest,
    latest: r.latest,
  }))
}

/**
 * All ten seasons with their series and the plants behind them.
 *
 * The trend is deliberately not fitted here — the frontend does it with the
 * same `linearFit` the temperature charts use, so a slope on this page and a
 * slope on that one mean the same thing.
 */
export function phenoSeasons() {
  return PHENO_SEASONS.map((season) => {
    const points = seasonSeries(season)
    return {
      key: season.key,
      label: season.label,
      order: season.order,
      note: season.note ?? null,
      plants: season.plants.map((id) => ({ id, name: plantName(id) })),
      phase: { id: season.phase, name: phaseName(season.phase) },
      points,
      first: points[0]?.year ?? null,
      last: points.at(-1)?.year ?? null,
      years: points.length,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Every observed combination                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How many years below which a combination is not offered.
 *
 * A slope over eight scattered years is arithmetic, not a trend, and the list
 * would fill with combinations nobody can read anything from.
 */
const MIN_YEARS = 20

const combosStmt = db.prepare(`
  SELECT plant, phase, COUNT(DISTINCT year) AS years, COUNT(*) AS reports,
         MIN(year) AS first, MAX(year) AS last, AVG(julian) AS day
  FROM pheno_observations
  GROUP BY plant, phase
  HAVING years >= ?
  ORDER BY day
`)

/** The phenological calendar: every well-covered combination, in season order. */
export function phenoCalendar() {
  return combosStmt.all(MIN_YEARS).map((row) => ({
    plant: row.plant,
    plantName: plantName(row.plant),
    phase: row.phase,
    phaseName: phaseName(row.phase),
    years: row.years,
    reports: row.reports,
    first: row.first,
    last: row.last,
    day: row.day,
  }))
}

const comboSeriesStmt = db.prepare(`
  SELECT year, AVG(julian) AS day, COUNT(DISTINCT station) AS stations, COUNT(*) AS reports
  FROM pheno_observations WHERE plant = ? AND phase = ?
  GROUP BY year ORDER BY year
`)

export function comboSeries(plant, phase) {
  const points = comboSeriesStmt.all(plant, phase)
  if (points.length === 0) return null
  return {
    plant,
    plantName: plantName(plant),
    phase,
    phaseName: phaseName(phase),
    points,
  }
}

/** The combinations the static build enumerates. */
export function phenoComboKeys() {
  return combosStmt.all(MIN_YEARS).map((r) => ({ plant: r.plant, phase: r.phase }))
}

/* -------------------------------------------------------------------------- */
/* Against the temperature we already measure                                 */
/* -------------------------------------------------------------------------- */

const DWD_STATION = '01691'

/**
 * Spring onset against the temperature of the months that drive it.
 *
 * The second place the two archives meet, after ozone and heat. A plant does
 * not read a calendar; it responds to accumulated warmth, so the hazel that
 * flowers in a mild February flowers earlier than the one in a cold February —
 * and both are recorded 3 km apart, by different people, for different reasons.
 *
 * The window ends the month before the season's own median onset, so the
 * temperature used is the one that preceded the event rather than one that
 * includes it.
 */
export function phenoAgainstTemperature(seasonKey = 'vorfruehling') {
  const season = PHENO_SEASONS.find((s) => s.key === seasonKey)
  if (!season) return null

  const points = seasonSeries(season)
  if (points.length < 10) return null

  const median = [...points.map((p) => p.day)].sort((a, b) => a - b)[
    Math.floor(points.length / 2)
  ]
  // Day-of-year to the month it falls in, then everything strictly before it.
  const untilMonth = Math.max(1, new Date(Date.UTC(2001, 0, Math.round(median))).getUTCMonth())

  const temps = db
    .prepare(
      `SELECT year, AVG(temp_mean) AS temp, COUNT(temp_mean) AS days
       FROM daily WHERE station_id = ? AND month <= ? GROUP BY year`,
    )
    .all(DWD_STATION, untilMonth)

  const byYear = new Map(temps.map((t) => [t.year, t]))
  const paired = []
  for (const point of points) {
    const temp = byYear.get(point.year)
    // Roughly complete months only — a mean over nine days of January is not
    // the January that the plant experienced.
    if (!temp || temp.days < untilMonth * 25) continue
    paired.push({ year: point.year, day: point.day, temp: temp.temp, stations: point.stations })
  }

  if (paired.length < 10) return null

  return {
    season: { key: season.key, label: season.label },
    dwdStation: DWD_STATION,
    untilMonth,
    monthsLabel: untilMonth === 1 ? 'Januar' : `Januar bis ${MONTHS[untilMonth - 1]}`,
    points: paired,
  }
}

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

/* -------------------------------------------------------------------------- */
/* Stations                                                                   */
/* -------------------------------------------------------------------------- */

const stationStatsStmt = db.prepare(`
  SELECT station, COUNT(*) AS reports, COUNT(DISTINCT year) AS years,
         MIN(year) AS first, MAX(year) AS last, COUNT(DISTINCT plant) AS plants
  FROM pheno_observations GROUP BY station ORDER BY reports DESC
`)

/**
 * The reporters, with what each actually contributed.
 *
 * Stations inside the radius that never reported are listed too, at zero — the
 * gap between 46 stations on the map and 14 in the data is the single most
 * important thing to know about this archive.
 */
export function phenoStations() {
  const stats = new Map(stationStatsStmt.all().map((s) => [s.station, s]))
  const out = []
  for (const station of STATIONS.values()) {
    const stat = stats.get(station.id)
    out.push({
      ...station,
      reports: stat?.reports ?? 0,
      years: stat?.years ?? 0,
      first: stat?.first ?? null,
      last: stat?.last ?? null,
      plants: stat?.plants ?? 0,
    })
  }
  return out.sort((a, b) => b.reports - a.reports || a.distance - b.distance)
}

/* -------------------------------------------------------------------------- */
/* Range and overview                                                         */
/* -------------------------------------------------------------------------- */

const rangeStmt = db.prepare(`
  SELECT MIN(year) AS first, MAX(year) AS last, COUNT(*) AS reports,
         COUNT(DISTINCT station) AS stations, COUNT(DISTINCT plant) AS plants
  FROM pheno_observations
`)

export function phenoRange() {
  const row = rangeStmt.get()
  return {
    first: row?.first ?? null,
    last: row?.last ?? null,
    reports: row?.reports ?? 0,
    stations: row?.stations ?? 0,
    plants: row?.plants ?? 0,
  }
}

export function phenoOverview() {
  return {
    origin: ORIGIN,
    radiusKm: RADIUS_KM,
    range: phenoRange(),
    seasons: phenoSeasons(),
    calendar: phenoCalendar(),
    stations: phenoStations(),
    temperature: phenoAgainstTemperature(),
    minYears: MIN_YEARS,
    endedNote:
      'Das Meldernetz in diesem Umkreis ist ausgedünnt: von den Stationen im' +
      ' Radius hat nur ein Teil je gemeldet, und die meisten hörten vor' +
      ' Jahrzehnten auf. Die Reihe endet damit, wo sie endet — sie wächst nicht' +
      ' weiter.',
  }
}
