import { db } from './db.js'
import { LOWLAND_LIMIT } from './germany.js'
import { findStation } from './stations.js'

/**
 * Where this station stood in Germany, day by day.
 *
 * The nationwide archive has so far only ever been asked who the extremes were.
 * It can answer a different question with the same rows: on each of those days,
 * where did Göttingen sit among the two thousand stations that reported? A
 * single day's rank is small talk. Five hundred of them are a description of
 * the place — and one that gets sharper every day the collector runs.
 *
 * Two rankings, as everywhere else in this project: against every station, and
 * against everything below 1000 m. Göttingen sits at 167 m, and a ranking that
 * includes the Zugspitze is partly a ranking of altitude rather than of weather.
 */

const STATION_ID = '01691'

/**
 * The quantities worth ranking.
 *
 * Pressure is left out although the column exists: it is measured at station
 * level, so a nationwide ranking of it would order the stations by how high
 * they stand and nothing else.
 */
export const NATIONAL_FIELDS = [
  {
    key: 'temp_mean',
    label: 'Tagesmittel der Temperatur',
    short: 'Mitteltemperatur',
    unit: '°C',
    decimals: 1,
    /** What the high end of the scale means, for the axis and the wording. */
    high: 'wärmer',
    low: 'kälter',
  },
  {
    key: 'temp_max',
    label: 'Höchsttemperatur',
    short: 'Höchsttemperatur',
    unit: '°C',
    decimals: 1,
    high: 'wärmer',
    low: 'kälter',
  },
  {
    key: 'temp_min',
    label: 'Tiefsttemperatur',
    short: 'Tiefsttemperatur',
    unit: '°C',
    decimals: 1,
    high: 'milder',
    low: 'frostiger',
  },
  {
    key: 'precipitation',
    label: 'Niederschlag',
    short: 'Niederschlag',
    unit: 'mm',
    decimals: 1,
    high: 'nasser',
    low: 'trockener',
  },
  {
    key: 'wind_max',
    label: 'Stärkste Windböe',
    short: 'Windböe',
    unit: 'm/s',
    decimals: 1,
    high: 'windiger',
    low: 'ruhiger',
  },
  {
    key: 'sunshine',
    label: 'Sonnenscheindauer',
    short: 'Sonnenschein',
    unit: 'h',
    decimals: 1,
    high: 'sonniger',
    low: 'trüber',
  },
]

export const FIELD_BY_KEY = new Map(NATIONAL_FIELDS.map((f) => [f.key, f]))

/* -------------------------------------------------------------------------- */
/* Ranking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One field's daily standing.
 *
 * The percentile counts stations strictly below the value plus half of those
 * equal to it. That midrank is not pedantry here: the DWD publishes
 * temperatures to one decimal, so on a calm day a hundred stations share the
 * same figure, and counting them all as "below" would put Göttingen at the 96th
 * percentile for being exactly average.
 *
 * `lowland` repeats the whole calculation over stations below 1000 m.
 */
/**
 * Both rankings for one field, in a single pass.
 *
 * Three shapes were tried. Correlated subqueries re-read each day's 2300
 * stations once per counter; window functions read them once but sorted all
 * 1.28 million rows into partitions; this joins each of the 543 days against
 * its own day only, which the (date, station_id) primary key makes a range
 * scan with no sort at all. Counting the lowland ranking in the same pass
 * rather than repeating the query halves what is left. 6.8 s, then 12.5 s, now
 * 1.4 s for all six fields.
 */
function standingFor(field) {
  const rows = db
    .prepare(
      `WITH me AS (
         SELECT date, ${field} AS v FROM germany_daily
         WHERE station_id = ? AND ${field} IS NOT NULL
       )
       SELECT me.date AS date, me.v AS value,
              SUM(CASE WHEN d.${field} < me.v THEN 1 ELSE 0 END) AS below,
              SUM(CASE WHEN d.${field} = me.v THEN 1 ELSE 0 END) AS equal,
              COUNT(d.${field}) AS total,
              SUM(CASE WHEN d.${field} < me.v AND s.elevation < ${LOWLAND_LIMIT} THEN 1 ELSE 0 END)
                AS below_low,
              SUM(CASE WHEN d.${field} = me.v AND s.elevation < ${LOWLAND_LIMIT} THEN 1 ELSE 0 END)
                AS equal_low,
              SUM(CASE WHEN d.${field} IS NOT NULL AND s.elevation < ${LOWLAND_LIMIT} THEN 1 ELSE 0 END)
                AS total_low
       FROM me
       JOIN germany_daily d ON d.date = me.date
       LEFT JOIN germany_stations s ON s.id = d.station_id
       GROUP BY me.date ORDER BY me.date`,
    )
    .all(STATION_ID)

  const point = (date, value, below, equal, total) => ({
    date,
    value,
    total,
    /** 100 = highest in Germany, 0 = lowest. Ties share the middle. */
    percentile: ((below + equal / 2) / total) * 100,
    /** Plain rank from the top, for the wording of a single day. */
    rank: total - below - equal + 1,
  })

  return {
    all: rows
      .filter((r) => r.total > 0)
      .map((r) => point(r.date, r.value, r.below, r.equal, r.total)),
    lowland: rows
      .filter((r) => r.total_low > 0)
      .map((r) => point(r.date, r.value, r.below_low, r.equal_low, r.total_low)),
  }
}

/* -------------------------------------------------------------------------- */
/* Summaries                                                                  */
/* -------------------------------------------------------------------------- */

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

/**
 * How many days a month needs before its mean percentile is offered.
 *
 * The archive holds about eighteen months, so most months appear once or twice.
 * Below ten days the monthly figure would say more about which days happened to
 * be collected than about the month.
 */
const MIN_DAYS_PER_MONTH = 10

function summarise(points) {
  if (points.length === 0) return null

  const mean = points.reduce((a, p) => a + p.percentile, 0) / points.length
  const sorted = [...points].sort((a, b) => a.percentile - b.percentile)

  const byMonth = new Map()
  for (const point of points) {
    const month = Number(point.date.slice(5, 7))
    if (!byMonth.has(month)) byMonth.set(month, [])
    byMonth.get(month).push(point.percentile)
  }

  return {
    days: points.length,
    mean,
    /** Days in the highest and lowest tenth of the country. */
    top: points.filter((p) => p.percentile >= 90).length,
    bottom: points.filter((p) => p.percentile <= 10).length,
    highest: sorted.at(-1),
    lowest: sorted[0],
    monthly: [...byMonth.entries()]
      .filter(([, values]) => values.length >= MIN_DAYS_PER_MONTH)
      .map(([month, values]) => ({
        month,
        label: MONTHS[month - 1],
        days: values.length,
        mean: values.reduce((a, b) => a + b, 0) / values.length,
      }))
      .sort((a, b) => a.month - b.month),
  }
}

/* -------------------------------------------------------------------------- */
/* Public queries                                                             */
/* -------------------------------------------------------------------------- */

const rangeStmt = db.prepare(
  'SELECT MIN(date) AS first, MAX(date) AS last, COUNT(DISTINCT date) AS days FROM germany_daily',
)

export function nationalRange() {
  const row = rangeStmt.get()
  return { first: row?.first ?? null, last: row?.last ?? null, days: row?.days ?? 0 }
}

/** One field, both rankings, with their summaries. */
export function nationalField(fieldKey) {
  const field = FIELD_BY_KEY.get(fieldKey)
  if (!field) return null

  const { all, lowland } = standingFor(field.key)
  if (all.length === 0) return null

  return {
    field,
    range: nationalRange(),
    lowlandLimit: LOWLAND_LIMIT,
    all: { points: all, summary: summarise(all) },
    lowland: { points: lowland, summary: summarise(lowland) },
  }
}

/**
 * The overview: every field's summary, without the daily series.
 *
 * Sent separately because the series are the bulk — six fields with two
 * rankings each would be four times the size of everything else this app ships
 * per request, to draw one chart at a time.
 */
export function nationalOverview() {
  const station = findStation(STATION_ID)

  const fields = []
  for (const field of NATIONAL_FIELDS) {
    const { all, lowland } = standingFor(field.key)
    if (all.length === 0) continue
    fields.push({ field, all: summarise(all), lowland: summarise(lowland) })
  }

  return {
    station: station
      ? { id: station.id, name: station.name, altitude: station.altitude }
      : { id: STATION_ID, name: 'Göttingen', altitude: null },
    range: nationalRange(),
    lowlandLimit: LOWLAND_LIMIT,
    minDaysPerMonth: MIN_DAYS_PER_MONTH,
    fields,
  }
}

/** The field keys the static build enumerates. */
export const NATIONAL_FIELD_KEYS = NATIONAL_FIELDS.map((f) => f.key)
