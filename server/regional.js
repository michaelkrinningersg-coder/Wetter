import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dataDir } from './paths.js'
import { db } from './db.js'
import { PARAMETER_BY_KEY, PERIODS, REGIONAL_PARAMETERS } from './regional-sources.js'

/**
 * The DWD's official areal means, as a queryable series.
 *
 * These are the figures the service publishes for Germany and its states, back
 * to 1881 for temperature. Nothing here is aggregated by this project — the
 * spatial interpolation behind them uses the full station network, which open
 * daily data cannot reproduce.
 */

export const REGIONAL_DATA_DIR = dataDir('regional', process.env.REGIONAL_DATA_DIR)

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS regional_values (
    region    TEXT    NOT NULL,
    parameter TEXT    NOT NULL,
    period    TEXT    NOT NULL,   -- 'year', '01'…'12', 'winter'…'autumn'
    year      INTEGER NOT NULL,
    value     REAL    NOT NULL,
    PRIMARY KEY (parameter, period, region, year)
  );

  CREATE TABLE IF NOT EXISTS regional_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const insert = db.prepare(`
  INSERT INTO regional_values (region, parameter, period, year, value)
  VALUES (@region, @parameter, @period, @year, @value)
  ON CONFLICT (parameter, period, region, year) DO UPDATE SET value = excluded.value
`)
const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row)
})

const readState = db.prepare('SELECT value FROM regional_state WHERE key = ?')
const writeState = db.prepare(
  'INSERT INTO regional_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
)

/* -------------------------------------------------------------------------- */
/* Archive -> database                                                        */
/* -------------------------------------------------------------------------- */

function readCsv(period) {
  const file = join(REGIONAL_DATA_DIR, `${period}.csv`)
  if (!existsSync(file)) return []

  const rows = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('region,')) continue
    const [region, parameter, per, year, value] = trimmed.split(',')
    const numericYear = Number(year)
    const numericValue = Number(value)
    if (!region || !parameter || !Number.isFinite(numericYear) || !Number.isFinite(numericValue)) {
      continue
    }
    rows.push({ region, parameter, period: per, year: numericYear, value: numericValue })
  }
  return rows
}

/**
 * Load the committed archive.
 *
 * Guarded by a signature: the DWD revises past values a few times a year, so a
 * plain "already present" check would never pick those up, while re-inserting
 * 115,000 rows on every restart is pointless when nothing changed.
 */
export function importRegional({ force = false } = {}) {
  const all = []
  const stamps = []
  for (const period of PERIODS) {
    const file = join(REGIONAL_DATA_DIR, `${period}.csv`)
    if (!existsSync(file)) continue
    const rows = readCsv(period)
    stamps.push(`${period}:${rows.length}`)
    all.push(...rows)
  }
  if (all.length === 0) return { rows: 0 }

  const signature = stamps.join('|')
  if (!force && readState.get('signature')?.value === signature) {
    return { rows: 0, cached: true }
  }

  insertMany(all)
  writeState.run('signature', signature)
  return { rows: all.length }
}

const loaded = importRegional()
if (loaded.rows > 0) {
  console.log(`Gebietsmittel geladen: ${loaded.rows.toLocaleString('de-DE')} Werte`)
}

/* -------------------------------------------------------------------------- */
/* Regions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How to read a region name.
 *
 * The DWD does not publish Berlin, Hamburg and Bremen on their own — they only
 * appear inside a combination, and `Thueringen/Sachsen-Anhalt` overlaps two
 * states that are also listed individually. Marking the kind is what keeps a
 * reader from summing regions that share area.
 */
export function classifyRegion(name) {
  if (name === 'Deutschland') return 'national'
  return name.includes('/') ? 'combination' : 'state'
}

const regionsStmt = db.prepare(
  'SELECT DISTINCT region FROM regional_values ORDER BY region',
)

export function regionalRegions() {
  return regionsStmt.all().map((r) => ({ name: r.region, kind: classifyRegion(r.region) }))
}

/* -------------------------------------------------------------------------- */
/* Metadata                                                                   */
/* -------------------------------------------------------------------------- */

const coverageStmt = db.prepare(`
  SELECT parameter, period, MIN(year) AS first, MAX(year) AS last, COUNT(*) AS n
  FROM regional_values GROUP BY parameter, period
`)

/** Every parameter and the periods it actually offers, with its year span. */
export function regionalMeta() {
  const coverage = coverageStmt.all()
  const byParameter = new Map()
  for (const row of coverage) {
    if (!byParameter.has(row.parameter)) byParameter.set(row.parameter, [])
    byParameter.get(row.parameter).push({
      period: row.period,
      first: row.first,
      last: row.last,
      count: row.n,
    })
  }

  const parameters = REGIONAL_PARAMETERS.filter((p) => byParameter.has(p.key)).map((p) => {
    const periods = byParameter.get(p.key).sort((a, b) => a.period.localeCompare(b.period))
    return {
      key: p.key,
      label: p.label,
      unit: p.unit,
      decimals: p.decimals,
      direction: p.direction,
      periods: periods.map((x) => x.period),
      // Sunshine starts in 1951 while temperature starts in 1881; the view has
      // to say which span it is drawing.
      first: Math.min(...periods.map((x) => x.first)),
      last: Math.max(...periods.map((x) => x.last)),
    }
  })

  return { parameters, regions: regionalRegions() }
}

/* -------------------------------------------------------------------------- */
/* Series                                                                     */
/* -------------------------------------------------------------------------- */

const seriesStmt = db.prepare(`
  SELECT region, year, value FROM regional_values
  WHERE parameter = ? AND period = ?
  ORDER BY region, year
`)

/**
 * One parameter and period across every region.
 *
 * The whole set is small — seventeen regions over 145 years is under 2500
 * points — so it travels in one response and the view fits its own trend lines
 * with the same `linearFit` the station charts use. A second implementation on
 * the server would be a second thing to keep honest.
 */
export function regionalSeries(parameterKey, period) {
  const parameter = PARAMETER_BY_KEY.get(parameterKey)
  if (!parameter) return null

  const rows = seriesStmt.all(parameterKey, period)
  if (rows.length === 0) return null

  const byRegion = new Map()
  for (const row of rows) {
    if (!byRegion.has(row.region)) byRegion.set(row.region, [])
    byRegion.get(row.region).push({ year: row.year, value: row.value })
  }

  return {
    parameter: {
      key: parameter.key,
      label: parameter.label,
      unit: parameter.unit,
      decimals: parameter.decimals,
      direction: parameter.direction,
    },
    period,
    regions: [...byRegion.entries()].map(([name, points]) => ({
      name,
      kind: classifyRegion(name),
      first: points[0].year,
      last: points.at(-1).year,
      points,
    })),
  }
}

/** Which (parameter, period) pairs exist — the static build enumerates these. */
export function regionalPairs() {
  return coverageStmt.all().map((r) => ({ parameter: r.parameter, period: r.period }))
}

/* -------------------------------------------------------------------------- */
/* Record balance                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The record question, asked of the whole country instead of one station.
 *
 * The areal means reach back to 1881 and cover sixteen federal states plus
 * Germany, which is the one way this project can put "are records still falling
 * evenly" to more than a single thermometer in Göttingen. Every combination of
 * region, parameter and period is its own series of annual values, and a year
 * sets a record when it beats every year before it.
 *
 * Counted raw, the answer would be the same artefact as everywhere else: the
 * 1880s set records because there was nothing to beat. So the count is measured
 * against what chance would give — the k-th year of a series is a record with
 * probability 1/k in each direction — exactly as the station's own record
 * vintages are. A ratio above one means more records than a stationary climate
 * produces.
 *
 * "High" and "low" rather than "warm" and "cold": for precipitation a new
 * maximum is a wet record, for frost days a new maximum is a *cold* one. The
 * view names them by the parameter's own direction; the arithmetic here does
 * not need to know.
 */
const balanceStmt = db.prepare(`
  SELECT region, period, year, value FROM regional_values
  WHERE parameter = ?
  ORDER BY region, period, year
`)

const DECADE = 10

/** The stretch the summary tile reports: the three most recent decades. */
const RECENT_FROM = 2000

/** Season and month keys in the order a reader expects them. */
const PERIOD_LABELS = {
  year: 'Jahr',
  winter: 'Winter',
  spring: 'Frühling',
  summer: 'Sommer',
  autumn: 'Herbst',
  '01': 'Januar', '02': 'Februar', '03': 'März', '04': 'April',
  '05': 'Mai', '06': 'Juni', '07': 'Juli', '08': 'August',
  '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Dezember',
}

/**
 * Spelled out, not derived from the labels above.
 *
 * `Object.keys` would hoist '10', '11' and '12' to the front: they are
 * canonical array indices, and JavaScript orders those numerically before every
 * other key. The table then began with October.
 */
const PERIOD_ORDER = [
  'year',
  'winter', 'spring', 'summer', 'autumn',
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
]

export function regionalBalance(parameterKey) {
  const parameter = PARAMETER_BY_KEY.get(parameterKey)
  if (!parameter) return null

  const rows = balanceStmt.all(parameterKey)
  if (rows.length === 0) return null

  // region -> period -> ordered values
  const series = new Map()
  for (const row of rows) {
    let byPeriod = series.get(row.region)
    if (!byPeriod) {
      byPeriod = new Map()
      series.set(row.region, byPeriod)
    }
    if (!byPeriod.has(row.period)) byPeriod.set(row.period, [])
    byPeriod.get(row.period).push(row)
  }

  const regions = []
  for (const [name, byPeriod] of series) {
    const decades = new Map()
    const periods = []
    let first = Infinity
    let last = -Infinity

    for (const period of PERIOD_ORDER) {
      const values = byPeriod.get(period)
      if (!values || values.length === 0) continue

      let high = values[0]
      let low = values[0]
      let k = 0

      for (const row of values) {
        k++
        const decade = Math.floor(row.year / DECADE) * DECADE
        let entry = decades.get(decade)
        if (!entry) {
          entry = { decade, high: 0, low: 0, expected: 0, series: 0 }
          decades.set(decade, entry)
        }
        // One expectation per direction: the k-th value is a new maximum with
        // probability 1/k and a new minimum with the same probability.
        entry.expected += 1 / k
        entry.series++

        if (k === 1 || row.value > high.value) {
          entry.high++
          high = row
        }
        if (k === 1 || row.value < low.value) {
          entry.low++
          low = row
        }
      }

      first = Math.min(first, values[0].year)
      last = Math.max(last, values.at(-1).year)

      periods.push({
        period,
        label: PERIOD_LABELS[period] ?? period,
        years: values.length,
        high: { year: high.year, value: high.value },
        low: { year: low.year, value: low.value },
      })
    }

    if (periods.length === 0) continue

    const byDecade = [...decades.values()]
      .sort((a, b) => a.decade - b.decade)
      .map((entry) => ({
        ...entry,
        expected: Number(entry.expected.toFixed(2)),
        highRatio: entry.expected > 0 ? entry.high / entry.expected : null,
        lowRatio: entry.expected > 0 ? entry.low / entry.expected : null,
      }))

    const totals = byDecade.reduce(
      (a, d) => ({ high: a.high + d.high, low: a.low + d.low, expected: a.expected + d.expected }),
      { high: 0, low: 0, expected: 0 },
    )

    regions.push({
      name,
      kind: classifyRegion(name),
      first,
      last,
      periods,
      decades: byDecade,
      totals: { ...totals, expected: Number(totals.expected.toFixed(1)) },
      /** How the last three decades stand — the number the view leads with. */
      recent: (() => {
        const late = byDecade.filter((d) => d.decade >= RECENT_FROM)
        const high = late.reduce((a, d) => a + d.high, 0)
        const low = late.reduce((a, d) => a + d.low, 0)
        const expected = late.reduce((a, d) => a + d.expected, 0)
        return {
          from: late[0]?.decade ?? null,
          high,
          low,
          expected: Number(expected.toFixed(1)),
          highRatio: expected > 0 ? high / expected : null,
          lowRatio: expected > 0 ? low / expected : null,
        }
      })(),
    })
  }

  return {
    parameter: {
      key: parameter.key,
      label: parameter.label,
      unit: parameter.unit,
      decimals: parameter.decimals,
      direction: parameter.direction,
    },
    periods: PERIOD_ORDER.filter((p) => regions[0]?.periods.some((x) => x.period === p)).map(
      (p) => ({ period: p, label: PERIOD_LABELS[p] ?? p }),
    ),
    regions: regions.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** Which parameters the balance is offered for — every one that exists. */
export function regionalBalanceParameters() {
  return regionalMeta().parameters.map((p) => p.key)
}
