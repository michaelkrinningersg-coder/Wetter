import { db } from './db.js'
import { AIR_STATIONS, COMPONENTS, COMPONENT_BY_KEY, FIELDS, STATION_BY_ID } from './air-sources.js'
import { listDays, readDay } from './air-csv.js'

/**
 * Air quality for Göttingen, as a queryable series.
 *
 * The archive holds hours; almost every question here is about a shape rather
 * than a value. When in the day is nitrogen dioxide highest, and does that
 * answer differ between a road and the urban background 2.7 km away? Does
 * ozone follow the heat we already measure at the DWD station? Those are the
 * things two stations and a decade of hours can actually answer, and none of
 * them survives being averaged to a day before it is asked.
 *
 * Daily figures are still needed — limit values are written in terms of them —
 * so they are materialised once at import rather than recomputed per request.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

const meanCols = FIELDS.map((f) => `${f}_mean REAL`).join(', ')
const maxCols = FIELDS.map((f) => `${f}_max REAL`).join(', ')
const hourCols = FIELDS.map((f) => `${f}_hours INTEGER NOT NULL DEFAULT 0`).join(', ')

db.exec(`
  CREATE TABLE IF NOT EXISTS air_hourly (
    station TEXT    NOT NULL,
    date    TEXT    NOT NULL,
    hour    INTEGER NOT NULL,
    ${FIELDS.map((f) => `${f} REAL`).join(', ')},
    PRIMARY KEY (station, date, hour)
  );

  CREATE TABLE IF NOT EXISTS air_daily (
    station  TEXT    NOT NULL,
    date     TEXT    NOT NULL,
    year     INTEGER NOT NULL,
    month    INTEGER NOT NULL,
    weekday  INTEGER NOT NULL,
    ${meanCols},
    ${maxCols},
    ${hourCols},
    -- The highest running eight-hour mean of the day; ozone's limit value is
    -- written in terms of it and it cannot be derived from the daily mean.
    o3_max8h REAL,
    PRIMARY KEY (station, date)
  );

  CREATE INDEX IF NOT EXISTS idx_air_hourly_hour ON air_hourly (station, hour);
  CREATE INDEX IF NOT EXISTS idx_air_daily_year  ON air_daily (station, year);

  CREATE TABLE IF NOT EXISTS air_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const readState = db.prepare('SELECT value FROM air_state WHERE key = ?')
const writeState = db.prepare(
  'INSERT INTO air_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
)

/* -------------------------------------------------------------------------- */
/* Daily aggregation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Hours a day needs before it gets a mean.
 *
 * Three quarters of the day, the same rule the UBA applies when it publishes
 * daily figures. Below that the mean is not a bad mean, it is a mean of
 * whichever hours happened to work — and for pollutants with a strong daily
 * cycle that is a systematic error, not noise.
 */
const MIN_HOURS_FOR_DAY_MEAN = 18

/** Hours a running eight-hour window needs before it counts. */
const MIN_HOURS_FOR_8H = 6

/**
 * The highest running eight-hour mean ending on each day.
 *
 * Windows are formed across day boundaries and attributed to the day their
 * last hour falls in — so the first windows of a day still reach back into the
 * evening before. That is the convention the limit value is written for;
 * restarting the window at midnight would systematically understate a morning
 * that inherited a high evening.
 */
function maxEightHourMeans(rows) {
  const out = new Map()
  const window = []

  for (const row of rows) {
    window.push(row)
    if (window.length > 8) window.shift()
    if (window.length < 8) continue

    // Only a window of eight consecutive hours is a valid eight-hour mean; a
    // gap in the series must not be closed by pretending the surrounding hours
    // sat next to each other.
    const spanned = hourDistance(window[0], window[7])
    if (spanned !== 7) continue

    const values = window.map((r) => r.o3).filter((v) => v !== null && v !== undefined)
    if (values.length < MIN_HOURS_FOR_8H) continue

    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const day = window[7].date
    if (!out.has(day) || mean > out.get(day)) out.set(day, mean)
  }
  return out
}

function hourDistance(a, b) {
  const at = Date.UTC(+a.date.slice(0, 4), +a.date.slice(5, 7) - 1, +a.date.slice(8, 10), a.hour)
  const bt = Date.UTC(+b.date.slice(0, 4), +b.date.slice(5, 7) - 1, +b.date.slice(8, 10), b.hour)
  return Math.round((bt - at) / 3_600_000)
}

const insertDaily = db.prepare(`
  INSERT INTO air_daily (
    station, date, year, month, weekday,
    ${FIELDS.map((f) => `${f}_mean`).join(', ')},
    ${FIELDS.map((f) => `${f}_max`).join(', ')},
    ${FIELDS.map((f) => `${f}_hours`).join(', ')},
    o3_max8h
  ) VALUES (
    @station, @date, @year, @month, @weekday,
    ${FIELDS.map((f) => `@${f}_mean`).join(', ')},
    ${FIELDS.map((f) => `@${f}_max`).join(', ')},
    ${FIELDS.map((f) => `@${f}_hours`).join(', ')},
    @o3_max8h
  )
  ON CONFLICT (station, date) DO UPDATE SET
    ${FIELDS.map((f) => `${f}_mean = excluded.${f}_mean`).join(', ')},
    ${FIELDS.map((f) => `${f}_max = excluded.${f}_max`).join(', ')},
    ${FIELDS.map((f) => `${f}_hours = excluded.${f}_hours`).join(', ')},
    o3_max8h = excluded.o3_max8h
`)

function buildDaily() {
  const byStation = db
    .prepare('SELECT DISTINCT station FROM air_hourly ORDER BY station')
    .all()
    .map((r) => r.station)

  const readHours = db.prepare(
    `SELECT date, hour, ${FIELDS.join(', ')} FROM air_hourly WHERE station = ? ORDER BY date, hour`,
  )

  let days = 0
  const write = db.transaction((rows) => {
    for (const row of rows) insertDaily.run(row)
  })

  for (const station of byStation) {
    const rows = readHours.all(station)
    const eight = maxEightHourMeans(rows)

    const byDate = new Map()
    for (const row of rows) {
      if (!byDate.has(row.date)) byDate.set(row.date, [])
      byDate.get(row.date).push(row)
    }

    const out = []
    for (const [date, hours] of byDate) {
      const at = new Date(`${date}T00:00:00Z`)
      const record = {
        station,
        date,
        year: at.getUTCFullYear(),
        month: at.getUTCMonth() + 1,
        // 0 = Monday, so a weekday chart reads Monday to Sunday without a
        // special case for the week starting on Sunday.
        weekday: (at.getUTCDay() + 6) % 7,
        o3_max8h: eight.get(date) ?? null,
      }

      for (const field of FIELDS) {
        const values = hours.map((h) => h[field]).filter((v) => v !== null && v !== undefined)
        record[`${field}_hours`] = values.length
        record[`${field}_max`] = values.length > 0 ? Math.max(...values) : null
        record[`${field}_mean`] =
          values.length >= MIN_HOURS_FOR_DAY_MEAN
            ? values.reduce((a, b) => a + b, 0) / values.length
            : null
      }
      out.push(record)
    }

    write(out)
    days += out.length
  }
  return days
}

/* -------------------------------------------------------------------------- */
/* Archive -> database                                                        */
/* -------------------------------------------------------------------------- */

const insertHour = db.prepare(`
  INSERT INTO air_hourly (station, date, hour, ${FIELDS.join(', ')})
  VALUES (@station, @date, @hour, ${FIELDS.map((f) => `@${f}`).join(', ')})
  ON CONFLICT (station, date, hour) DO UPDATE SET
    ${FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')}
`)

const insertHours = db.transaction((rows) => {
  for (const row of rows) insertHour.run(row)
})

/**
 * Load the committed archive.
 *
 * Guarded by a signature over the day list rather than a row count: the daily
 * collector rewrites the last week as the UBA validates it, so days already
 * present can still change content without changing in number.
 */
export function importAir({ force = false } = {}) {
  const days = listDays()
  if (days.length === 0) return { rows: 0 }

  const signature = `${days.length}|${days[0]}|${days.at(-1)}|${days.slice(-8).join(',')}`
  if (!force && readState.get('signature')?.value === signature) {
    return { rows: 0, cached: true }
  }

  let rows = 0
  const batch = []
  for (const date of days) {
    for (const row of readDay(date)) {
      const record = { station: row.station, date: row.date, hour: row.hour }
      for (const field of FIELDS) record[field] = row[field] ?? null
      batch.push(record)
      rows++
    }
    // Written in chunks so a decade does not sit in one transaction.
    if (batch.length >= 20_000) {
      insertHours(batch)
      batch.length = 0
    }
  }
  if (batch.length > 0) insertHours(batch)

  const dayCount = buildDaily()
  writeState.run('signature', signature)
  return { rows, days: dayCount }
}

const loaded = importAir()
if (loaded.rows > 0) {
  console.log(
    `Luftqualität geladen: ${loaded.rows.toLocaleString('de-DE')} Stundenwerte,` +
      ` ${loaded.days.toLocaleString('de-DE')} Tage`,
  )
}

/* -------------------------------------------------------------------------- */
/* Metadata                                                                   */
/* -------------------------------------------------------------------------- */

const rangeStmt = db.prepare(
  'SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS days FROM (SELECT DISTINCT date FROM air_daily)',
)

export function airRange() {
  const row = rangeStmt.get()
  return { first: row?.first ?? null, last: row?.last ?? null, days: row?.days ?? 0 }
}

/**
 * How much of each series actually exists.
 *
 * Stated per station and component because the answer differs sharply:
 * sulphur dioxide reports roughly a third of the hours the other components
 * do. A chart drawn from it is not wrong, but it is drawn from a quarter of the
 * decade and the reader has to be told so.
 */
export function airCoverage() {
  const out = []
  for (const station of AIR_STATIONS) {
    for (const key of station.components) {
      const row = db
        .prepare(
          `SELECT COUNT(${key}) AS hours, MIN(date) AS first, MAX(date) AS last
           FROM air_hourly WHERE station = ? AND ${key} IS NOT NULL`,
        )
        .get(station.id)
      const possible = db
        .prepare('SELECT COUNT(*) AS n FROM air_hourly WHERE station = ?')
        .get(station.id)

      out.push({
        station: station.id,
        component: key,
        hours: row?.hours ?? 0,
        first: row?.first ?? null,
        last: row?.last ?? null,
        share: possible?.n > 0 ? (row?.hours ?? 0) / possible.n : 0,
      })
    }
  }
  return out
}

function publicComponents() {
  return COMPONENTS.map((c) => ({
    key: c.key,
    label: c.label,
    short: c.short,
    unit: c.unit,
    decimals: c.decimals,
    limits: c.limits,
  }))
}

function publicStations() {
  return AIR_STATIONS.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    kindLabel: s.kindLabel,
    address: s.address,
    lat: s.lat,
    lon: s.lon,
    components: s.components,
  }))
}

/* -------------------------------------------------------------------------- */
/* Annual series and exceedances                                              */
/* -------------------------------------------------------------------------- */

/**
 * One year per row: the annual mean and how often each limit was passed.
 *
 * A year is only given a mean once it has 300 valid days, and the partial
 * current year is marked rather than dropped — the point of the newest bar is
 * that it is still growing, and hiding it would make the chart look finished.
 */
const MIN_DAYS_FOR_YEAR = 300

export function airAnnual() {
  const out = []

  for (const station of AIR_STATIONS) {
    for (const key of station.components) {
      const component = COMPONENT_BY_KEY.get(key)
      const years = db
        .prepare(
          `SELECT year,
                  AVG(${key}_mean)   AS mean,
                  COUNT(${key}_mean) AS days,
                  MAX(${key}_max)    AS peak
           FROM air_daily WHERE station = ? GROUP BY year ORDER BY year`,
        )
        .all(station.id)

      const points = years.map((row) => {
        const exceedances = {}
        for (const limit of component.limits) {
          exceedances[`${limit.stat}_${limit.value}`] = countExceedances(
            station.id,
            key,
            row.year,
            limit,
          )
        }
        return {
          year: row.year,
          mean: row.days >= MIN_DAYS_FOR_YEAR ? row.mean : null,
          days: row.days,
          peak: row.peak,
          complete: row.days >= MIN_DAYS_FOR_YEAR,
          exceedances,
        }
      })

      out.push({ station: station.id, component: key, points })
    }
  }
  return out
}

function countExceedances(station, key, year, limit) {
  if (limit.stat === 'hour') {
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM air_hourly
         WHERE station = ? AND ${key} > ? AND date >= ? AND date <= ?`,
      )
      .get(station, limit.value, `${year}-01-01`, `${year}-12-31`).n
  }
  if (limit.stat === 'day_mean') {
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM air_daily WHERE station = ? AND year = ? AND ${key}_mean > ?`,
      )
      .get(station, year, limit.value).n
  }
  if (limit.stat === 'day_max') {
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM air_daily WHERE station = ? AND year = ? AND ${key}_max > ?`,
      )
      .get(station, year, limit.value).n
  }
  if (limit.stat === 'day_max8h') {
    return db
      .prepare('SELECT COUNT(*) AS n FROM air_daily WHERE station = ? AND year = ? AND o3_max8h > ?')
      .get(station, year, limit.value).n
  }
  // A year mean is a value, not a count; the view compares it directly.
  return null
}

/* -------------------------------------------------------------------------- */
/* Profiles                                                                   */
/* -------------------------------------------------------------------------- */

/** Meteorological seasons, so the diurnal profile can be split by them. */
const SEASONS = [
  { key: 'winter', label: 'Winter', months: [12, 1, 2] },
  { key: 'spring', label: 'Frühling', months: [3, 4, 5] },
  { key: 'summer', label: 'Sommer', months: [6, 7, 8] },
  { key: 'autumn', label: 'Herbst', months: [9, 10, 11] },
]

/**
 * The shapes one component takes: by hour, by hour and season, by weekday, by
 * month — at every station that measures it.
 *
 * The hourly profile is the reason the archive stores hours. Nitrogen dioxide
 * at a road and ozone in the background are close to mirror images of one
 * another over a day, and a daily mean shows neither.
 */
export function airProfiles(componentKey) {
  const component = COMPONENT_BY_KEY.get(componentKey)
  if (!component) return null

  const stations = AIR_STATIONS.filter((s) => s.components.includes(componentKey))
  if (stations.length === 0) return null

  const series = stations.map((station) => {
    const diurnal = db
      .prepare(
        `SELECT hour, AVG(${componentKey}) AS mean, COUNT(${componentKey}) AS n
         FROM air_hourly WHERE station = ? AND ${componentKey} IS NOT NULL
         GROUP BY hour ORDER BY hour`,
      )
      .all(station.id)

    const bySeason = SEASONS.map((season) => ({
      key: season.key,
      label: season.label,
      points: db
        .prepare(
          `SELECT h.hour AS hour, AVG(h.${componentKey}) AS mean, COUNT(h.${componentKey}) AS n
           FROM air_hourly h
           WHERE h.station = ? AND h.${componentKey} IS NOT NULL
             AND CAST(strftime('%m', h.date) AS INTEGER) IN (${season.months.join(',')})
           GROUP BY h.hour ORDER BY h.hour`,
        )
        .all(station.id),
    }))

    const weekday = db
      .prepare(
        `SELECT weekday, AVG(${componentKey}_mean) AS mean, COUNT(${componentKey}_mean) AS n
         FROM air_daily WHERE station = ? AND ${componentKey}_mean IS NOT NULL
         GROUP BY weekday ORDER BY weekday`,
      )
      .all(station.id)

    const monthly = db
      .prepare(
        `SELECT month, AVG(${componentKey}_mean) AS mean, COUNT(${componentKey}_mean) AS n
         FROM air_daily WHERE station = ? AND ${componentKey}_mean IS NOT NULL
         GROUP BY month ORDER BY month`,
      )
      .all(station.id)

    return {
      station: station.id,
      name: station.name,
      kind: station.kind,
      kindLabel: station.kindLabel,
      diurnal,
      bySeason,
      weekday,
      monthly,
    }
  })

  return {
    component: {
      key: component.key,
      label: component.label,
      short: component.short,
      unit: component.unit,
      decimals: component.decimals,
      limits: component.limits,
    },
    series,
  }
}

/** Every component with data — the static build enumerates these. */
export function airComponentKeys() {
  const keys = new Set()
  for (const station of AIR_STATIONS) for (const key of station.components) keys.add(key)
  return [...keys]
}

/* -------------------------------------------------------------------------- */
/* Ozone against the weather we already measure                               */
/* -------------------------------------------------------------------------- */

/** The DWD station this project is built around, 3 km from the background site. */
const DWD_STATION = '01691'

/**
 * Ozone's highest eight-hour mean against that day's maximum temperature.
 *
 * This is the one place the two archives meet. Ozone is not emitted; it forms
 * in sunlight out of other pollutants, so its summer peaks belong to the same
 * days the temperature chart calls hot. Pairing them turns two separate series
 * into one statement — and it only works because both stations sit in the same
 * town.
 *
 * Restricted to April through September: outside the photochemical season the
 * relationship is not weak, it is absent, and including those days would flatten
 * the slope by padding it with a different regime.
 */
export function airOzoneHeat() {
  const rows = db
    .prepare(
      `SELECT a.date AS date, a.o3_max8h AS ozone, d.temp_max AS temp, a.year AS year
       FROM air_daily a
       JOIN daily d ON d.station_id = ? AND d.date = a.date
       WHERE a.station = ? AND a.o3_max8h IS NOT NULL AND d.temp_max IS NOT NULL
         AND a.month BETWEEN 4 AND 9
       ORDER BY a.date`,
    )
    .all(DWD_STATION, 'DENI042')

  if (rows.length === 0) return null

  // Binned as well as scattered: a decade of points is a cloud, and the mean
  // per temperature band is what actually shows the rise.
  const bins = new Map()
  for (const row of rows) {
    const bin = Math.floor(row.temp / 2) * 2
    if (!bins.has(bin)) bins.set(bin, [])
    bins.get(bin).push(row.ozone)
  }

  const binned = [...bins.entries()]
    .filter(([, values]) => values.length >= 10)
    .map(([from, values]) => ({
      from,
      to: from + 2,
      days: values.length,
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      max: Math.max(...values),
    }))
    .sort((a, b) => a.from - b.from)

  const target = COMPONENT_BY_KEY.get('o3').limits.find((l) => l.stat === 'day_max8h')

  return {
    station: 'DENI042',
    dwdStation: DWD_STATION,
    months: 'April bis September',
    target: target?.value ?? null,
    days: rows.length,
    // The individual days are deliberately not shipped: at this sample size the
    // scatter is a cloud, the binned means are what carries the statement, and
    // 1900 unrendered points would be nine tenths of the payload.
    binned,
    /** Share of days above the target value, per temperature band. */
    exceedanceByBand: binned.map((b) => {
      const values = bins.get(b.from)
      const over = values.filter((v) => v > (target?.value ?? Infinity)).length
      return { from: b.from, to: b.to, days: values.length, over, share: over / values.length }
    }),
  }
}

/* -------------------------------------------------------------------------- */
/* The assembled answer                                                       */
/* -------------------------------------------------------------------------- */

export function airOverview() {
  return {
    range: airRange(),
    stations: publicStations(),
    components: publicComponents(),
    coverage: airCoverage(),
    annual: airAnnual(),
    ozoneHeat: airOzoneHeat(),
    minDaysForYear: MIN_DAYS_FOR_YEAR,
    minHoursForDayMean: MIN_HOURS_FOR_DAY_MEAN,
  }
}

export { STATION_BY_ID }
