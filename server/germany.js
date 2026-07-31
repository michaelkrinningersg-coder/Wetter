import { db } from './db.js'
import { FIELDS } from './germany-sources.js'
import { listDays, readDay, readStations } from './germany-csv.js'

/**
 * Nationwide daily superlatives.
 *
 * The committed CSV archive is the source of truth; this module mirrors it
 * into SQLite on startup so the views can query it, and derives the rankings.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS germany_stations (
    id        TEXT PRIMARY KEY,
    network   TEXT NOT NULL,
    name      TEXT NOT NULL,
    state     TEXT NOT NULL,
    lat       REAL,
    lon       REAL,
    elevation REAL
  );

  CREATE TABLE IF NOT EXISTS germany_daily (
    date          TEXT NOT NULL,
    station_id    TEXT NOT NULL,
    temp_mean     REAL,
    temp_max      REAL,
    temp_min      REAL,
    precipitation REAL,
    wind_max      REAL,
    wind_mean     REAL,
    sunshine      REAL,
    cloud         REAL,
    pressure      REAL,
    humidity      REAL,
    snow          REAL,
    -- Date first: every ranking is "one day, all stations".
    PRIMARY KEY (date, station_id)
  );
`)

/* -------------------------------------------------------------------------- */
/* Archive -> database                                                        */
/* -------------------------------------------------------------------------- */

const insertStation = db.prepare(`
  INSERT INTO germany_stations (id, network, name, state, lat, lon, elevation)
  VALUES (@id, @network, @name, @state, @lat, @lon, @elevation)
  ON CONFLICT (id) DO UPDATE SET
    network = excluded.network, name = excluded.name, state = excluded.state,
    lat = excluded.lat, lon = excluded.lon, elevation = excluded.elevation
`)

const insertDay = db.prepare(`
  INSERT INTO germany_daily (date, station_id, ${FIELDS.join(', ')})
  VALUES (@date, @station_id, ${FIELDS.map((f) => `@${f}`).join(', ')})
  ON CONFLICT (date, station_id) DO NOTHING
`)

const importStations = db.transaction((stations) => {
  for (const s of stations) insertStation.run(s)
})

const importRows = db.transaction((rows) => {
  for (const row of rows) {
    insertDay.run({
      ...Object.fromEntries(FIELDS.map((f) => [f, null])),
      ...row,
    })
  }
})

const presentDates = db.prepare('SELECT DISTINCT date FROM germany_daily')

/**
 * Load the committed archive.
 *
 * Only days the database does not already hold are read, so the cost is paid
 * once per clone rather than on every restart — the archive is nearly two
 * years of readings and re-inserting all of it at every boot would be a
 * pointless few seconds each time.
 */
export function importArchive() {
  const stations = readStations()
  if (stations.size > 0) importStations([...stations.values()])

  const have = new Set(presentDates.all().map((r) => r.date))
  const missing = listDays().filter((d) => !have.has(d))

  let rows = 0
  for (const date of missing) {
    const day = readDay(date)
    importRows(day)
    rows += day.length
  }
  return { days: missing.length, rows, stations: stations.size }
}

const loaded = importArchive()
if (loaded.rows > 0) {
  console.log(
    `Deutschlandarchiv geladen: ${loaded.rows.toLocaleString('de-DE')} Messwerte` +
      ` aus ${loaded.days} Tag(en), ${loaded.stations.toLocaleString('de-DE')} Stationen`,
  )
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sunshine is collected but not ranked: the DWD measures daily sunshine at
 * only about 70 of its stations, far too coarse a net to name "the sunniest
 * station in Germany" on a given day. The column stays in the archive so the
 * question can be revisited without re-fetching two years of data.
 */
export const CATEGORIES = [
  {
    key: 'warmest_mean',
    label: 'Wärmste Station im Mittel',
    short: 'Wärmste (Mittel)',
    field: 'temp_mean',
    direction: 'max',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'warmest_max',
    label: 'Höchste Temperatur',
    short: 'Wärmste (absolut)',
    field: 'temp_max',
    direction: 'max',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'coldest_mean',
    label: 'Kälteste Station im Mittel',
    short: 'Kälteste (Mittel)',
    field: 'temp_mean',
    direction: 'min',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'coldest_min',
    label: 'Tiefste Temperatur',
    short: 'Kälteste (absolut)',
    field: 'temp_min',
    direction: 'min',
    unit: '°C',
    decimals: 1,
  },
  {
    key: 'windiest_gust',
    label: 'Stärkste Windböe',
    short: 'Stärkste Bö',
    field: 'wind_max',
    direction: 'max',
    unit: 'm/s',
    decimals: 1,
  },
  {
    key: 'windiest_mean',
    label: 'Windigste Station im Mittel',
    short: 'Windigste (Mittel)',
    field: 'wind_mean',
    direction: 'max',
    unit: 'm/s',
    decimals: 1,
  },
  {
    key: 'wettest',
    label: 'Nasseste Station',
    short: 'Nasseste',
    field: 'precipitation',
    direction: 'max',
    unit: 'mm',
    decimals: 1,
  },
  {
    key: 'widest_range',
    label: 'Größte Tagesspanne',
    short: 'Größte Spanne',
    field: 'range',
    direction: 'max',
    unit: 'K',
    decimals: 1,
  },
]

/**
 * Mountain stations win two categories every single day — on 30 July 2026 the
 * Zugspitze was the coldest station both by mean and by minimum, the runner-up
 * more than nine kelvin behind. Ranking the lowland separately keeps the
 * genuine national extreme visible while also answering the question most
 * people actually mean.
 */
export const LOWLAND_LIMIT = 1000

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

const rangeStmt = db.prepare(
  'SELECT COUNT(DISTINCT date) AS days, MIN(date) AS first, MAX(date) AS last FROM germany_daily',
)

const dayStmt = db.prepare(`
  SELECT d.*, s.name, s.state, s.elevation, s.lat, s.lon, s.network
  FROM germany_daily d
  JOIN germany_stations s ON s.id = d.station_id
  WHERE d.date = ?
`)

export function archiveRange() {
  const r = rangeStmt.get()
  return { days: r?.days ?? 0, first: r?.first ?? null, last: r?.last ?? null }
}

/**
 * Every archived date, newest first — the view offers these for selection.
 *
 * The default covers several years so nothing is silently withheld; the static
 * build materialises one file per date, and a cap here would quietly shorten
 * the date picker rather than fail visibly.
 */
export function availableDates(limit = 5000) {
  return db
    .prepare('SELECT DISTINCT date FROM germany_daily ORDER BY date DESC LIMIT ?')
    .all(limit)
    .map((r) => r.date)
}

function valueOf(row, field) {
  if (field !== 'range') return row[field]
  if (row.temp_max === null || row.temp_min === null) return null
  return Math.round((row.temp_max - row.temp_min) * 10) / 10
}

function rank(rows, category, { limit = 5 } = {}) {
  const scored = []
  for (const row of rows) {
    const value = valueOf(row, category.field)
    if (value === null || value === undefined) continue
    scored.push({
      station_id: row.station_id,
      name: row.name,
      state: row.state,
      elevation: row.elevation,
      lat: row.lat,
      lon: row.lon,
      value,
    })
  }
  scored.sort((a, b) => (category.direction === 'max' ? b.value - a.value : a.value - b.value))
  return { count: scored.length, top: scored.slice(0, limit) }
}

/**
 * All categories for one day, each in two scopes.
 *
 * The whole day is read once (a few thousand rows) and ranked in memory rather
 * than issuing sixteen ordered queries — it is both faster and far easier to
 * keep consistent.
 *
 * The limit costs nothing worth optimising: reading and sorting the day's ~2200
 * rows takes about twelve milliseconds whether the answer carries three ranks
 * or fifty, because the slice happens after the sort either way. Fifty is the
 * depth the view offers — roughly 100 kB of JSON, 13 kB over the wire once
 * compressed.
 */
export function superlatives(date, { limit = 50 } = {}) {
  const rows = dayStmt.all(date)
  if (rows.length === 0) return null

  const lowland = rows.filter((r) => r.elevation !== null && r.elevation < LOWLAND_LIMIT)

  const categories = CATEGORIES.map((category) => {
    const all = rank(rows, category, { limit })
    const low = rank(lowland, category, { limit })
    return {
      key: category.key,
      label: category.label,
      short: category.short,
      unit: category.unit,
      decimals: category.decimals,
      direction: category.direction,
      all,
      lowland: low,
      // The view only shows the second line when it adds something.
      lowlandDiffers: Boolean(low.top[0] && all.top[0] && low.top[0].station_id !== all.top[0].station_id),
    }
  })

  const highest = rows.reduce(
    (best, r) => (r.elevation !== null && (!best || r.elevation > best.elevation) ? r : best),
    null,
  )

  return {
    date,
    stations: {
      total: rows.length,
      lowland: lowland.length,
      byNetwork: {
        kl: rows.filter((r) => r.network === 'kl').length,
        rr: rows.filter((r) => r.network === 'rr').length,
      },
    },
    lowlandLimit: LOWLAND_LIMIT,
    highestStation: highest
      ? { name: highest.name, elevation: highest.elevation }
      : null,
    categories,
  }
}
