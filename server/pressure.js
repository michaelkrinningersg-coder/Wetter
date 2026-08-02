import { db } from './db.js'

/**
 * Air pressure, and what it does to the wind.
 *
 * The column has been in the database since the first import and has only ever
 * been read for two record lists. It carries 57,439 days at Göttingen — a
 * longer run than sunshine, humidity or snow — and it is the one quantity here
 * that says something about the weather's machinery rather than its outcome.
 *
 * **These are station readings, not reduced to sea level.** Göttingen averages
 * 996.5 hPa at 167 m, the Brocken 882 at 1141 m, the Zugspitze 706 at 2964 m.
 * Every threshold people know — "below 990 is a storm low" — refers to
 * sea-level pressure and does not apply. Rather than reduce the values with a
 * formula whose temperature assumptions would be one more thing to defend, the
 * thresholds here come from the station's own record and are named as
 * percentiles of it.
 */

/* -------------------------------------------------------------------------- */
/* Thresholds                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How far into the tail a day has to reach to count as deep or as a steep fall.
 *
 * One percent of a 57,000-day record is 574 days, which is enough to average
 * over and rare enough to mean something. Both thresholds are computed once
 * from the whole record and then held fixed, so a count per year compares like
 * with like instead of shifting as the archive grows.
 */
const TAIL = 0.01

const percentileStmt = db.prepare(`
  SELECT pressure FROM daily
  WHERE station_id = ? AND pressure IS NOT NULL
  ORDER BY pressure
  LIMIT 1 OFFSET CAST((SELECT COUNT(pressure) FROM daily WHERE station_id = ? AND pressure IS NOT NULL) * ? AS INTEGER)
`)

function pressurePercentile(stationId, p) {
  return percentileStmt.get(stationId, stationId, p)?.pressure ?? null
}

/* -------------------------------------------------------------------------- */
/* Series                                                                     */
/* -------------------------------------------------------------------------- */

const dailyStmt = db.prepare(`
  SELECT date, year, month, pressure, wind_max
  FROM daily WHERE station_id = ? AND pressure IS NOT NULL
  ORDER BY date
`)

/**
 * Every pressure day, with the change from the day before.
 *
 * The change is only defined where the previous row is literally the previous
 * calendar day — the record has gaps, and a "daily change" spanning a
 * three-week hole would be a fabricated storm.
 */
function dailyWithChange(stationId) {
  const rows = dailyStmt.all(stationId)
  const day = 86_400_000

  for (let i = 0; i < rows.length; i++) {
    const previous = rows[i - 1]
    if (!previous) {
      rows[i].change = null
      continue
    }
    const gap = (Date.parse(`${rows[i].date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / day
    rows[i].change = gap === 1 ? rows[i].pressure - previous.pressure : null
  }
  return rows
}

/* -------------------------------------------------------------------------- */
/* Aggregations                                                               */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

/** The 90 % rule this project applies to every annual figure. */
const MIN_DAYS_PER_YEAR = 330

const annualStmt = db.prepare(`
  SELECT year, AVG(pressure) AS mean, MIN(pressure) AS min, MAX(pressure) AS max,
         COUNT(pressure) AS days
  FROM daily WHERE station_id = ? AND pressure IS NOT NULL
  GROUP BY year HAVING days >= ? ORDER BY year
`)

const monthlyStmt = db.prepare(`
  SELECT month, AVG(pressure) AS mean, MIN(pressure) AS min, MAX(pressure) AS max,
         COUNT(pressure) AS days
  FROM daily WHERE station_id = ? AND pressure IS NOT NULL
  GROUP BY month ORDER BY month
`)

const extremeStmt = (order) =>
  db.prepare(
    `SELECT date, pressure, wind_max FROM daily
     WHERE station_id = ? AND pressure IS NOT NULL
     ORDER BY pressure ${order} LIMIT 10`,
  )

const lowestStmt = extremeStmt('ASC')
const highestStmt = extremeStmt('DESC')

/**
 * Mean gust per band, for one binning of the data.
 *
 * Bands with fewer than thirty days are dropped: the tails of both binnings run
 * thin, and a band resting on four days would draw a spike that is one storm
 * rather than a pattern.
 */
const MIN_DAYS_PER_BAND = 30

function bandGusts(rows, valueOf, width) {
  const bands = new Map()
  for (const row of rows) {
    const value = valueOf(row)
    if (value === null || value === undefined || row.wind_max === null) continue

    const from = Math.floor(value / width) * width
    if (!bands.has(from)) bands.set(from, [])
    bands.get(from).push(row.wind_max)
  }

  return [...bands.entries()]
    .filter(([, gusts]) => gusts.length >= MIN_DAYS_PER_BAND)
    .map(([from, gusts]) => ({
      from,
      to: from + width,
      days: gusts.length,
      mean: gusts.reduce((a, b) => a + b, 0) / gusts.length,
      max: Math.max(...gusts),
    }))
    .sort((a, b) => a.from - b.from)
}

/** Pearson correlation, for stating the strength of a relationship plainly. */
function correlation(pairs) {
  if (pairs.length < 3) return null
  const n = pairs.length
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n
  const my = pairs.reduce((a, p) => a + p[1], 0) / n

  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy)
}

/* -------------------------------------------------------------------------- */
/* The assembled answer                                                       */
/* -------------------------------------------------------------------------- */

export function pressureAnalysis(stationId) {
  const rows = dailyWithChange(stationId)
  if (rows.length === 0) return null

  const deepLimit = pressurePercentile(stationId, TAIL)

  const withWind = rows.filter((r) => r.wind_max !== null)
  const withChange = withWind.filter((r) => r.change !== null)

  // The fall threshold is a percentile of the changes, not of the pressures.
  const changes = withChange.map((r) => r.change).sort((a, b) => a - b)
  const fallLimit = changes.length > 0 ? changes[Math.floor(changes.length * TAIL)] : null

  const deep = withWind.filter((r) => r.pressure <= deepLimit)
  const calm = withWind.filter((r) => r.pressure > deepLimit)
  const falls = withChange.filter((r) => r.change <= fallLimit)

  const meanGust = (list) =>
    list.length === 0 ? null : list.reduce((a, r) => a + r.wind_max, 0) / list.length

  /** Deep days per year — only for years that also satisfy the 90 % rule. */
  const deepByYear = new Map()
  for (const row of rows) {
    if (!deepByYear.has(row.year)) deepByYear.set(row.year, { deep: 0, days: 0 })
    const entry = deepByYear.get(row.year)
    entry.days++
    if (row.pressure <= deepLimit) entry.deep++
  }

  const annual = annualStmt.all(stationId, MIN_DAYS_PER_YEAR).map((year) => ({
    ...year,
    deep: deepByYear.get(year.year)?.deep ?? 0,
  }))

  return {
    range: {
      first: rows[0].date,
      last: rows.at(-1).date,
      days: rows.length,
      years: annual.length,
    },
    /** Stated in the payload so no view can forget it. */
    reduction: 'station',
    note:
      'Stationsdruck, nicht auf Meereshöhe reduziert. Die geläufigen Schwellen —' +
      ' „unter 990 hPa ist ein Sturmtief" — gelten für Meereshöhe und wären hier' +
      ' falsch; die Grenzen unten stammen aus der Reihe dieser Station selbst.',
    tail: TAIL,
    minDaysPerYear: MIN_DAYS_PER_YEAR,
    minDaysPerBand: MIN_DAYS_PER_BAND,

    monthly: monthlyStmt.all(stationId).map((row) => ({
      ...row,
      label: MONTHS[row.month - 1],
    })),
    annual,

    extremes: {
      lowest: lowestStmt.all(stationId),
      highest: highestStmt.all(stationId),
    },

    wind: {
      /** How many days carry both a pressure and a gust — far fewer than days. */
      days: withWind.length,
      changeDays: withChange.length,
      correlation: {
        pressure: correlation(withWind.map((r) => [r.pressure, r.wind_max])),
        change: correlation(withChange.map((r) => [r.change, r.wind_max])),
        magnitude: correlation(withChange.map((r) => [Math.abs(r.change), r.wind_max])),
      },
      deep: {
        limit: deepLimit,
        days: deep.length,
        meanGust: meanGust(deep),
        otherDays: calm.length,
        otherMeanGust: meanGust(calm),
      },
      fall: {
        limit: fallLimit,
        days: falls.length,
        meanGust: meanGust(falls),
      },
      byPressure: bandGusts(withWind, (r) => r.pressure, 10),
      byChange: bandGusts(withChange, (r) => r.change, 5),
    },
  }
}
