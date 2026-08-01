import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const here = dirname(fileURLToPath(import.meta.url))

export const REGIONAL_DATA_DIR =
  process.env.REGIONAL_DATA_DIR ?? join(here, '..', 'data', 'regional')

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
