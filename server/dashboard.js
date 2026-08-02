import { db } from './db.js'
import * as api from './queries.js'
import { findStation } from './stations.js'
import { GAUGES, gaugeSummary } from './gauges.js'
import { archiveRange, superlatives } from './germany.js'
import { recordCount, recordDays, recordsForDate } from './records.js'
import { pollenLatest } from './pollen.js'
import { AIR_STATIONS, COMPONENT_BY_KEY } from './air-sources.js'
import { odlProbes, odlRange } from './odl.js'
import { twinHeadline } from './twins.js'
import { tickerHeadlines } from './ticker.js'
import { monthBalanceHeadline } from './month-balance.js'

/**
 * One answer for the opening view.
 *
 * Everything here already existed, spread across eight tabs nobody sees until
 * they go looking. The dashboard does not compute anything new; it picks the
 * one figure from each area that is worth a glance and hands over a link into
 * the view it came from.
 *
 * Assembled on the server rather than by eight requests from the browser, for
 * two reasons: eight round trips would make the first paint the slowest thing
 * in the app, and the static build wants one file, not eight.
 */

const STATION_ID = '01691'

/* -------------------------------------------------------------------------- */
/* Daily normals                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The reference period every anomaly on this page is measured against.
 *
 * 1991–2020 is the current WMO normal period, the same one the DWD uses when it
 * calls a day "warmer than usual".
 */
const REFERENCE = { from: 1991, to: 2020 }

/**
 * Half-width of the window a daily normal is drawn from.
 *
 * A single calendar day over thirty years is thirty numbers, and thirty numbers
 * of a German July scatter by ten degrees — the "normal" would wobble by more
 * than the anomaly it is meant to measure. Eleven days around the date give 330
 * values and a normal that moves smoothly through the year, which is what the
 * DWD's own smoothed normals do.
 */
const WINDOW_DAYS = 5

const normalStmt = db.prepare(`
  SELECT AVG(temp_mean) AS temp_mean, AVG(temp_max) AS temp_max, AVG(temp_min) AS temp_min,
         AVG(precipitation) AS precipitation, COUNT(*) AS days
  FROM daily
  WHERE station_id = @station AND year BETWEEN @from AND @to
    AND (
      julianday(date) - julianday(printf('%04d-01-01', year))
      - (julianday(@date) - julianday(printf('%04d-01-01', CAST(substr(@date, 1, 4) AS INTEGER))))
    ) BETWEEN -@window AND @window
`)

function dailyNormal(date) {
  const row = normalStmt.get({
    station: STATION_ID,
    from: REFERENCE.from,
    to: REFERENCE.to,
    date,
    window: WINDOW_DAYS,
  })
  if (!row || row.days < 100) return null
  return {
    temp_mean: row.temp_mean,
    temp_max: row.temp_max,
    temp_min: row.temp_min,
    precipitation: row.precipitation,
    days: row.days,
  }
}

/* -------------------------------------------------------------------------- */
/* Yesterday at the station                                                   */
/* -------------------------------------------------------------------------- */

const lastDayStmt = db.prepare(
  `SELECT date, year, month, day, temp_mean, temp_max, temp_min, precipitation,
          wind_max, wind_mean, sunshine, snow
   FROM daily WHERE station_id = ? ORDER BY date DESC LIMIT 1`,
)

/** How this day ranks among every same-date day on record. */
const rankStmt = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM daily
     WHERE station_id = @station AND month = @month AND day = @day
       AND temp_mean IS NOT NULL AND temp_mean > @value) AS warmerDays,
    (SELECT COUNT(*) FROM daily
     WHERE station_id = @station AND month = @month AND day = @day
       AND temp_mean IS NOT NULL) AS total
`)

function latestDay() {
  const row = lastDayStmt.get(STATION_ID)
  if (!row) return null

  const normal = dailyNormal(row.date)
  const rank =
    row.temp_mean === null
      ? null
      : rankStmt.get({
          station: STATION_ID,
          month: row.month,
          day: row.day,
          value: row.temp_mean,
        })

  return {
    ...row,
    normal,
    anomaly: normal
      ? {
          temp_mean: row.temp_mean === null ? null : row.temp_mean - normal.temp_mean,
          temp_max: row.temp_max === null ? null : row.temp_max - normal.temp_max,
          temp_min: row.temp_min === null ? null : row.temp_min - normal.temp_min,
        }
      : null,
    /** `place` counts from the warm end: 1 means the warmest such date ever. */
    rank: rank && rank.total > 0 ? { place: rank.warmerDays + 1, of: rank.total } : null,
    reference: REFERENCE,
    windowDays: WINDOW_DAYS,
  }
}

/* -------------------------------------------------------------------------- */
/* The year so far                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The running year against the same stretch of every other year.
 *
 * Compared day-for-day, not year-for-year: on 2 August a full-year mean would
 * be a different quantity, and the honest comparison is January-to-July against
 * every other January-to-July.
 */
function yearToDate() {
  const ytd = api.ytdTemperatures(STATION_ID)
  if (!ytd?.records?.length) return null

  const records = ytd.records.filter((r) => r.avg_temp !== null)
  if (records.length === 0) return null

  // `ytdTemperatures` returns newest first, not oldest first.
  const current = records[0]
  const reference = records.filter(
    (r) => r.year >= REFERENCE.from && r.year <= REFERENCE.to,
  )
  const mean =
    reference.length > 0
      ? reference.reduce((a, r) => a + r.avg_temp, 0) / reference.length
      : null

  const warmer = records.filter((r) => r.avg_temp > current.avg_temp).length

  return {
    year: current.year,
    upTo: ytd.cutOffDateStr,
    mean: current.avg_temp,
    days: current.valid_days,
    referenceMean: mean,
    anomaly: mean === null ? null : current.avg_temp - mean,
    place: warmer + 1,
    of: records.length,
    reference: REFERENCE,
  }
}

/* -------------------------------------------------------------------------- */
/* Germany yesterday                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The four superlatives worth a tile.
 *
 * The Germany view offers eight categories in two rankings; picking a subset
 * here is a decision about what a first glance should carry, not a limitation —
 * the tile links into the full view.
 */
const HIGHLIGHT_KEYS = ['warmest_max', 'coldest_min', 'wettest', 'windiest_gust']

function germanyHighlights() {
  const range = archiveRange()
  if (!range.last) return null

  const day = superlatives(range.last, { limit: 1 })
  if (!day) return null

  const picks = []
  for (const key of HIGHLIGHT_KEYS) {
    const category = day.categories?.find((c) => c.key === key)
    const top = category?.all?.top?.[0]
    if (!category || !top) continue
    picks.push({
      key,
      label: category.label,
      short: category.short,
      unit: category.unit,
      decimals: category.decimals,
      station: top.name,
      state: top.state,
      elevation: top.elevation,
      value: top.value,
    })
  }

  return {
    date: range.last,
    stations: day.stations?.total ?? null,
    highest: day.highestStation ?? null,
    picks,
  }
}

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

function latestRecords() {
  const days = recordDays()
  if (days.length === 0) return null

  const date = days[0].date
  const events = recordsForDate(date) ?? []

  return {
    date,
    count: recordCount(date) ?? events.length,
    events: events.slice(0, 3),
  }
}

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

const latestAirStmt = db.prepare(
  'SELECT date, hour FROM air_hourly ORDER BY date DESC, hour DESC LIMIT 1',
)

function airNow() {
  const at = latestAirStmt.get()
  if (!at) return null

  const values = []
  for (const station of AIR_STATIONS) {
    const row = db
      .prepare('SELECT * FROM air_hourly WHERE station = ? AND date = ? AND hour = ?')
      .get(station.id, at.date, at.hour)
    if (!row) continue

    for (const key of station.components) {
      if (row[key] === null || row[key] === undefined) continue
      const component = COMPONENT_BY_KEY.get(key)
      values.push({
        station: station.id,
        stationName: station.name,
        kind: station.kind,
        component: key,
        short: component?.short ?? key,
        unit: component?.unit ?? '',
        decimals: component?.decimals ?? 0,
        value: row[key],
      })
    }
  }
  return { date: at.date, hour: at.hour, values }
}

function pollenNow() {
  const latest = pollenLatest()
  if (!latest) return null

  const home = latest.regions.find((r) => r.home) ?? latest.regions[0]
  if (!home) return null

  const today = home.kinds
    .map((kind) => ({ ...kind, horizon: kind.horizons[0] }))
    .filter((k) => k.horizon)

  return {
    issued: latest.issued,
    active: today
      .filter((k) => (k.horizon.level ?? 0) > 0)
      .map((k) => ({ label: k.label, value: k.horizon.value, level: k.horizon.level })),
    total: today.length,
  }
}

function radiationNow() {
  const range = odlRange()
  if (!range.last) return null

  const probes = odlProbes().filter((p) => p.latest)
  if (probes.length === 0) return null

  // The probe at the weather station, if it is reporting; otherwise the nearest.
  const probe = probes[0]
  return {
    probe: probe.name,
    distance: probe.distance,
    value: probe.latest.value,
    date: probe.latest.date,
    hour: probe.latest.hour,
    mean: probe.mean,
    days: range.days,
  }
}

function gaugesNow() {
  return GAUGES.map((gauge) => {
    const summary = gaugeSummary(gauge, 7)
    return {
      id: gauge.id,
      name: gauge.name,
      water: gauge.water,
      value: summary.latest?.value ?? null,
      ts: summary.latest?.ts ?? null,
      trend: summary.trend ?? null,
      level: summary.currentLevel ?? null,
      mean: summary.characteristic?.mean?.cm ?? null,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* This day in history                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Today's calendar date across the whole record.
 *
 * Deliberately today rather than the last measured day: it is the one thing on
 * the page that answers "what about right now", and the archive always has the
 * date even when yesterday's measurement has not arrived yet.
 */
function todayInHistory() {
  const now = new Date()
  const month = now.getUTCMonth() + 1
  const day = now.getUTCDate()

  const history = api.dayInHistory(STATION_ID, month, day)
  if (!history || history.count === 0) return null

  return {
    month,
    day,
    count: history.count,
    firstYear: history.firstYear ?? null,
    lastYear: history.lastYear ?? null,
    meanOfDay: history.meanOfDay ?? null,
    holders: history.holders ?? {},
  }
}

/* -------------------------------------------------------------------------- */
/* The assembled answer                                                       */
/* -------------------------------------------------------------------------- */

export function dashboard() {
  const station = findStation(STATION_ID)

  return {
    station: station
      ? { id: station.id, name: station.name, altitude: station.altitude }
      : { id: STATION_ID, name: 'Göttingen', altitude: null },
    latest: latestDay(),
    year: yearToDate(),
    germany: germanyHighlights(),
    records: latestRecords(),
    today: todayInHistory(),
    /**
     * One sentence from the twin search: has a day like the latest happened
     * before? It costs a cached matrix lookup, and it is the only line on the
     * dashboard that compares a whole day rather than one quantity.
     */
    twin: twinHeadline(STATION_ID),
    /**
     * The only figures on this page that change every single day: the streaks
     * that are still running. Filtered to the rare ones — a five-day dry spell
     * happens eighteen times a year and is not news.
     */
    ticker: tickerHeadlines(STATION_ID),
    /** Where the running month stands, and how much of it is still open. */
    monthBalance: monthBalanceHeadline(STATION_ID),
    environment: {
      pollen: pollenNow(),
      air: airNow(),
      radiation: radiationNow(),
      gauges: gaugesNow(),
    },
  }
}
