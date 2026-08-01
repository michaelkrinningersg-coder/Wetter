import { db } from './db.js'

/** DWD practice: a year only counts once ≥90 % of its days carry a value. */
const COVERAGE = 0.9

/** Extreme-month lists ignore months with fewer valid days than this. */
const MIN_MONTH_DAYS = 25

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysInYear = (y) => (isLeap(y) ? 366 : 365)

/* -------------------------------------------------------------------------- */
/* Shared lookups                                                             */
/* -------------------------------------------------------------------------- */

const boundsStmt = db.prepare(`
  SELECT COUNT(*) AS rowCount, MIN(date) AS minDate, MAX(date) AS maxDate
  FROM daily WHERE station_id = ?
`)

export function getBounds(stationId) {
  const row = boundsStmt.get(stationId)
  return {
    rowCount: row.rowCount ?? 0,
    minDate: row.minDate ?? null,
    maxDate: row.maxDate ?? null,
  }
}

/**
 * The last day present in the database, used as the year-to-date cut-off so
 * every year is compared over the same calendar window.
 */
function getCutOff(stationId) {
  const { maxDate } = getBounds(stationId)
  if (!maxDate) return null
  const [year, month, day] = maxDate.split('-').map(Number)
  return {
    year,
    month,
    day,
    label: `${day}. ${MONTHS[month - 1]}`,
    /** Ordinal day-of-year of the cut-off in a non-leap year. */
    dayOfYear: dayOfYearOf(month, day, 2001),
  }
}

const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

function dayOfYearOf(month, day, year) {
  const leapAdjust = month > 2 && isLeap(year) ? 1 : 0
  return CUMULATIVE_DAYS[month - 1] + day + leapAdjust
}

/* -------------------------------------------------------------------------- */
/* Annual temperature trend                                                   */
/* -------------------------------------------------------------------------- */

const annualTempStmt = db.prepare(`
  SELECT year,
         AVG(temp_mean)                                   AS avg_temp,
         SUM(CASE WHEN temp_mean IS NOT NULL THEN 1 END)  AS valid_days
  FROM daily
  WHERE station_id = ?
  GROUP BY year
  ORDER BY year
`)

export function annualTemperatures(stationId) {
  const runningYear = getCutOff(stationId)?.year ?? null

  return annualTempStmt
    .all(stationId)
    .map((row) => {
      const total = daysInYear(row.year)
      return {
        year: row.year,
        avg_temp: row.avg_temp,
        valid_days: row.valid_days ?? 0,
        total_days: total,
        isIncomplete: row.year === runningYear,
      }
    })
    .filter(
      (row) =>
        row.avg_temp !== null &&
        (row.isIncomplete || row.valid_days / row.total_days >= COVERAGE),
    )
}

/** Trend series: the running year carries its blended forecast value. */
export function tempTrend(stationId) {
  const rows = annualTemperatures(stationId)
  const forecast = buildForecast(stationId)

  return rows.map((row) =>
    row.isIncomplete && forecast
      ? { ...row, avg_temp: forecast.forecastTempAvg }
      : row,
  )
}

/* -------------------------------------------------------------------------- */
/* Annual precipitation trend                                                 */
/* -------------------------------------------------------------------------- */

const annualPrecipStmt = db.prepare(`
  SELECT year,
         SUM(precipitation)                                   AS sum_precipitation,
         SUM(CASE WHEN precipitation IS NOT NULL THEN 1 END)  AS valid_days
  FROM daily
  WHERE station_id = ?
  GROUP BY year
  ORDER BY year
`)

export function precipTrend(stationId) {
  const runningYear = getCutOff(stationId)?.year ?? null

  return annualPrecipStmt
    .all(stationId)
    .map((row) => {
      const total = daysInYear(row.year)
      return {
        year: row.year,
        sum_precipitation: row.sum_precipitation,
        valid_days: row.valid_days ?? 0,
        total_days: total,
        isIncomplete: row.year === runningYear,
      }
    })
    .filter(
      (row) =>
        row.sum_precipitation !== null &&
        (row.isIncomplete || row.valid_days / row.total_days >= COVERAGE),
    )
}

/* -------------------------------------------------------------------------- */
/* Annual means and anomalies                                                 */
/* -------------------------------------------------------------------------- */

export function annualMeans(stationId) {
  const records = annualTemperatures(stationId).filter((r) => !r.isIncomplete)
  if (records.length === 0) return { records: [], overallAvg: 0 }

  const overallAvg =
    records.reduce((sum, r) => sum + r.avg_temp, 0) / records.length

  return {
    records: records.map(({ isIncomplete: _ignored, ...r }) => ({
      ...r,
      anomaly: r.avg_temp - overallAvg,
    })),
    overallAvg,
  }
}

/* -------------------------------------------------------------------------- */
/* Monthly heatmap                                                            */
/* -------------------------------------------------------------------------- */

const monthlyMeansStmt = db.prepare(`
  SELECT year, month,
         AVG(temp_mean)                                  AS avg_temp,
         SUM(CASE WHEN temp_mean IS NOT NULL THEN 1 END) AS valid_days,
         COUNT(*)                                        AS days
  FROM daily
  WHERE station_id = ?
  GROUP BY year, month
  ORDER BY year, month
`)

/**
 * Monthly means, ranked against the same calendar month in other years.
 *
 * Months with fewer than `MIN_MONTH_DAYS` valid readings are reported but not
 * ranked: a mean over twenty-one days is not comparable with one over
 * thirty-one, and letting it into the ranking would move every other month's
 * position. Reporting it anyway matters because the alternative is what this
 * view used to do — drop the month silently, leaving a blank cell that reads
 * as "no data" when the truth is "measured, but too sparse to place". Göttingen
 * lost nine days to a station outage in July 2026; across the whole database
 * thirty-two months are in that state.
 */
export function heatmap(stationId) {
  const all = monthlyMeansStmt.all(stationId).filter((r) => r.avg_temp !== null)
  const rated = all.filter((r) => r.valid_days >= MIN_MONTH_DAYS)

  const byMonth = new Map()
  for (const row of rated) {
    if (!byMonth.has(row.month)) byMonth.set(row.month, [])
    byMonth.get(row.month).push(row)
  }

  const monthMinMax = {}
  const ranks = new Map()

  for (const [month, group] of byMonth) {
    const sorted = [...group].sort((a, b) => b.avg_temp - a.avg_temp)
    const total = sorted.length
    monthMinMax[month] = {
      min: sorted[total - 1].avg_temp,
      max: sorted[0].avg_temp,
    }
    sorted.forEach((row, index) => {
      ranks.set(`${row.year}-${month}`, { rank: index + 1, total })
    })
  }

  const records = all
    .map((row) => {
      const placed = ranks.get(`${row.year}-${row.month}`)
      return {
        year: row.year,
        month: row.month,
        avg_temp: row.avg_temp,
        validDays: row.valid_days,
        // The calendar length, not the number of imported rows: for the month
        // in progress those differ, and "21 of 30" for a 31-day July would be
        // its own small untruth.
        days: new Date(Date.UTC(row.year, row.month, 0)).getUTCDate(),
        rated: Boolean(placed),
        rank: placed?.rank ?? null,
        total_years_for_month: placed?.total ?? null,
      }
    })
    .sort((a, b) => a.year - b.year || a.month - b.month)

  return { records, monthMinMax, minMonthDays: MIN_MONTH_DAYS }
}

/* -------------------------------------------------------------------------- */
/* Climate diagram                                                            */
/* -------------------------------------------------------------------------- */

const climateStmt = db.prepare(`
  -- The 90 % rule has to hold for BOTH parameters, otherwise a year with a
  -- complete temperature series but a half-empty rain gauge would still shape
  -- the precipitation bars.
  WITH valid_years AS (
    SELECT year
    FROM daily
    WHERE station_id = @station
    GROUP BY year
    HAVING SUM(CASE WHEN temp_mean     IS NOT NULL THEN 1 END) >= 365 * @coverage
       AND SUM(CASE WHEN precipitation IS NOT NULL THEN 1 END) >= 365 * @coverage
  ),
  monthly AS (
    SELECT year, month,
           AVG(temp_mean) AS temp,
           SUM(precipitation) AS precip
    FROM daily
    WHERE station_id = @station AND year IN (SELECT year FROM valid_years)
    GROUP BY year, month
  )
  SELECT month,
         AVG(temp)   AS avg_temp,
         AVG(precip) AS avg_precipitation
  FROM monthly
  GROUP BY month
  ORDER BY month
`)

export function climateDiagram(stationId) {
  return climateStmt
    .all({ station: stationId, coverage: COVERAGE })
    .filter((r) => r.avg_temp !== null && r.avg_precipitation !== null)
}

/* -------------------------------------------------------------------------- */
/* Reference periods                                                          */
/* -------------------------------------------------------------------------- */

const PERIODS = [
  [1960, 1990],
  [1968, 1998],
  [1970, 2000],
  [1980, 2010],
  [1990, 2020],
  [1995, 2025],
]

export function comparisons(stationId) {
  const byYear = new Map(
    annualMeans(stationId).records.map((r) => [r.year, r.avg_temp]),
  )

  return PERIODS.map(([from, to]) => {
    const values = []
    for (let year = from; year <= to; year++) {
      const value = byYear.get(year)
      if (value !== undefined) values.push(value)
    }
    return {
      period: `${from} - ${to}`,
      avg_temp:
        values.length > 0
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null,
      valid_years_count: values.length,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Extremes                                                                   */
/* -------------------------------------------------------------------------- */

const DAY_CATEGORIES = {
  temp_mean_max: ['temp_mean', 'DESC'],
  temp_max_max: ['temp_max', 'DESC'],
  temp_min_min: ['temp_min', 'ASC'],
  temp_min_max: ['temp_min', 'DESC'],
  temp_max_min: ['temp_max', 'ASC'],
  precipitation_max: ['precipitation', 'DESC'],
  wind_max_max: ['wind_max', 'DESC'],
  wind_mean_max: ['wind_mean', 'DESC'],
  pressure_max: ['pressure', 'DESC'],
  pressure_min: ['pressure', 'ASC'],
}

export function extremeDays(stationId, category, limit = 50) {
  const spec = DAY_CATEGORIES[category]
  if (!spec) return null
  const [column, direction] = spec

  // Column and direction come from the whitelist above, never from the request.
  const stmt = db.prepare(`
    SELECT date, year, month, day, ${column} AS value
    FROM daily
    WHERE station_id = ? AND ${column} IS NOT NULL
    ORDER BY ${column} ${direction}, date ASC
    LIMIT ?
  `)
  return stmt.all(stationId, limit)
}

export const DAY_CATEGORY_KEYS = Object.keys(DAY_CATEGORIES)

const MONTH_CATEGORIES = {
  temp_mean_max: ['AVG(temp_mean)', 'temp_mean', 'DESC'],
  temp_mean_min: ['AVG(temp_mean)', 'temp_mean', 'ASC'],
  precipitation_max: ['SUM(precipitation)', 'precipitation', 'DESC'],
  precipitation_min: ['SUM(precipitation)', 'precipitation', 'ASC'],
  wind_mean_max: ['AVG(wind_mean)', 'wind_mean', 'DESC'],
  wind_mean_min: ['AVG(wind_mean)', 'wind_mean', 'ASC'],
}

export const MONTH_CATEGORY_KEYS = Object.keys(MONTH_CATEGORIES)

export function extremeMonths(stationId, category, limit = 50) {
  const spec = MONTH_CATEGORIES[category]
  if (!spec) return null
  const [aggregate, column, direction] = spec

  const stmt = db.prepare(`
    SELECT year, month,
           ${aggregate} AS value,
           SUM(CASE WHEN ${column} IS NOT NULL THEN 1 END) AS validDays
    FROM daily
    WHERE station_id = ?
    GROUP BY year, month
    HAVING validDays >= ?
    ORDER BY value ${direction}
    LIMIT ?
  `)
  return stmt.all(stationId, MIN_MONTH_DAYS, limit)
}

/* -------------------------------------------------------------------------- */
/* Monthly detail                                                             */
/* -------------------------------------------------------------------------- */

const daysStmt = db.prepare(`
  SELECT date, year, month, day, temp_mean, temp_max, temp_min,
         precipitation, wind_max, wind_mean, pressure
  FROM daily
  WHERE station_id = ? AND year = ? AND month = ?
  ORDER BY day
`)

const monthStatsStmt = db.prepare(`
  SELECT month,
         AVG(temp_mean)     AS tempAvg,
         SUM(precipitation) AS precipSum,
         MAX(wind_max)      AS maxWind,
         MAX(precipitation) AS maxPrecip
  FROM daily
  WHERE station_id = ? AND year = ?
  GROUP BY month
  ORDER BY month
`)

const monthSummaryStmt = db.prepare(`
  SELECT AVG(temp_mean)     AS tempAvg,
         MAX(temp_max)      AS maxTemp,
         MIN(temp_min)      AS minTemp,
         SUM(precipitation) AS precipSum,
         MAX(wind_max)      AS maxWind
  FROM daily
  WHERE station_id = ? AND year = ? AND month = ?
`)

export function monthlyDetail(stationId, year, month) {
  return {
    days: daysStmt.all(stationId, year, month),
    summary: monthSummaryStmt.get(stationId, year, month) ?? {
      tempAvg: null, maxTemp: null, minTemp: null, precipSum: null, maxWind: null,
    },
    monthlyStats: monthStatsStmt.all(stationId, year),
  }
}

/* -------------------------------------------------------------------------- */
/* Year-to-date temperatures                                                  */
/* -------------------------------------------------------------------------- */

const ytdStmt = db.prepare(`
  SELECT year,
         AVG(temp_mean)                                  AS avg_temp,
         SUM(CASE WHEN temp_mean IS NOT NULL THEN 1 END) AS valid_days
  FROM daily
  WHERE station_id = @station
    AND (month < @month OR (month = @month AND day <= @day))
  GROUP BY year
  ORDER BY year DESC
`)

export function ytdTemperatures(stationId) {
  const cutOff = getCutOff(stationId)
  if (!cutOff) return { records: [], cutOffDateStr: '—', cutOffMonth: null, cutOffDay: null }

  const records = ytdStmt
    .all({ station: stationId, month: cutOff.month, day: cutOff.day })
    .map((r) => ({
      year: r.year,
      avg_temp: r.avg_temp,
      valid_days: r.valid_days ?? 0,
      // Length of the calendar window, not the number of rows present. Using
      // the row count would rate a year with only 40 stored days as "100 %
      // covered" and let it into the comparison.
      total_days: dayOfYearOf(cutOff.month, cutOff.day, r.year),
    }))
    .filter((r) => r.avg_temp !== null && r.valid_days / r.total_days >= COVERAGE)

  return {
    records,
    cutOffDateStr: cutOff.label,
    cutOffMonth: cutOff.month,
    cutOffDay: cutOff.day,
  }
}

/* -------------------------------------------------------------------------- */
/* Annual overview                                                            */
/* -------------------------------------------------------------------------- */

const overviewStmt = db.prepare(`
  SELECT year,
         MIN(temp_min)      AS min_temp,
         MAX(temp_max)      AS max_temp,
         MAX(temp_mean)     AS warmest_day_mean,
         MIN(temp_mean)     AS coldest_day_mean,
         AVG(temp_mean)     AS avg_temp,
         SUM(precipitation) AS precip_sum,
         SUM(CASE WHEN temp_mean IS NOT NULL THEN 1 END) AS valid_days,
         -- DWD-Kenntage. The thresholds are inclusive ("ein heißer Tag ist ein
         -- Tag mit Tmax >= 30,0 °C"); a strict > drops every day that lands
         -- exactly on the threshold — 40 hot days and 144 summer days in
         -- Göttingen alone.
         SUM(CASE WHEN temp_max  >= 30 THEN 1 ELSE 0 END) AS days_hot,
         SUM(CASE WHEN temp_max  >= 25 THEN 1 ELSE 0 END) AS days_summer,
         SUM(CASE WHEN temp_min  >= 20 THEN 1 ELSE 0 END) AS days_tropical_night,
         SUM(CASE WHEN temp_min  <   0 THEN 1 ELSE 0 END) AS days_frost,
         SUM(CASE WHEN temp_max  <   0 THEN 1 ELSE 0 END) AS days_ice,
         -- Additional thresholds the app already showed; not DWD Kenntage.
         SUM(CASE WHEN temp_max  >= 20 THEN 1 ELSE 0 END) AS days_max_above_20,
         SUM(CASE WHEN temp_max  >= 15 THEN 1 ELSE 0 END) AS days_max_above_15,
         SUM(CASE WHEN temp_mean <   0 THEN 1 ELSE 0 END) AS days_mean_below_0,
         SUM(CASE WHEN temp_mean >= 20 THEN 1 ELSE 0 END) AS days_mean_above_20
  FROM daily
  WHERE station_id = ?
  GROUP BY year
  ORDER BY year DESC
`)

/** Field pairs used to project the running year from the climatology. */
const COUNT_FIELDS = [
  ['days_hot', 'hot'],
  ['days_summer', 'summer'],
  ['days_tropical_night', 'tropicalNight'],
  ['days_frost', 'frost'],
  ['days_ice', 'ice'],
  ['days_max_above_20', 'max20'],
  ['days_max_above_15', 'max15'],
  ['days_mean_below_0', 'mean0'],
  ['days_mean_above_20', 'mean20'],
]

export function annualOverview(stationId) {
  const cutOff = getCutOff(stationId)
  const runningYear = cutOff?.year ?? null
  const rows = overviewStmt.all(stationId)

  if (runningYear === null) {
    return rows.map((r) => ({ ...r, is_running_year: false }))
  }

  const climatology = dailyClimatology(stationId, runningYear)

  return rows.map((row) => {
    const isRunning = row.year === runningYear
    const base = { ...row, is_running_year: isRunning }
    if (!isRunning || !climatology) return base

    // Project the rest of the year from the 30-year daily climatology.
    const remaining = climatology.days.filter(
      (d) => dayOfYearOf(d.month, d.day, runningYear) > cutOff.dayOfYear,
    )

    const observedTempSum = (row.avg_temp ?? 0) * (row.valid_days ?? 0)
    const projectedTempSum = remaining.reduce((s, d) => s + d.temp, 0)
    const totalDays = (row.valid_days ?? 0) + remaining.length

    const projected = {
      ...base,
      forecast_min_temp: Math.min(
        row.min_temp ?? Infinity,
        ...remaining.map((d) => d.tempMin),
      ),
      forecast_max_temp: Math.max(
        row.max_temp ?? -Infinity,
        ...remaining.map((d) => d.tempMax),
      ),
      forecast_warmest_day_mean: Math.max(
        row.warmest_day_mean ?? -Infinity,
        ...remaining.map((d) => d.temp),
      ),
      forecast_coldest_day_mean: Math.min(
        row.coldest_day_mean ?? Infinity,
        ...remaining.map((d) => d.temp),
      ),
      forecast_avg_temp: totalDays > 0
        ? (observedTempSum + projectedTempSum) / totalDays
        : null,
      forecast_precip_sum:
        (row.precip_sum ?? 0) + remaining.reduce((s, d) => s + d.precip, 0),
    }

    for (const [field, share] of COUNT_FIELDS) {
      projected[`forecast_${field}`] =
        row[field] + remaining.reduce((s, d) => s + d.share[share], 0)
    }

    return projected
  })
}

/* -------------------------------------------------------------------------- */
/* Daily climatology + forecast                                               */
/* -------------------------------------------------------------------------- */

const climatologyStmt = db.prepare(`
  SELECT month, day,
         AVG(temp_mean)     AS temp,
         AVG(temp_max)      AS tempMax,
         AVG(temp_min)      AS tempMin,
         AVG(precipitation) AS precip,
         AVG(CASE WHEN temp_max  >= 30 THEN 1.0 ELSE 0.0 END) AS hot,
         AVG(CASE WHEN temp_max  >= 25 THEN 1.0 ELSE 0.0 END) AS summer,
         AVG(CASE WHEN temp_min  >= 20 THEN 1.0 ELSE 0.0 END) AS tropicalNight,
         AVG(CASE WHEN temp_min  <   0 THEN 1.0 ELSE 0.0 END) AS frost,
         AVG(CASE WHEN temp_max  <   0 THEN 1.0 ELSE 0.0 END) AS ice,
         AVG(CASE WHEN temp_max  >= 20 THEN 1.0 ELSE 0.0 END) AS max20,
         AVG(CASE WHEN temp_max  >= 15 THEN 1.0 ELSE 0.0 END) AS max15,
         AVG(CASE WHEN temp_mean <   0 THEN 1.0 ELSE 0.0 END) AS mean0,
         AVG(CASE WHEN temp_mean >= 20 THEN 1.0 ELSE 0.0 END) AS mean20
  FROM daily
  WHERE station_id = @station AND year BETWEEN @from AND @to
    AND temp_mean IS NOT NULL
  GROUP BY month, day
  ORDER BY month, day
`)

/**
 * Day-of-year climatology over the 30 complete calendar years preceding
 * `runningYear`. 29 February is dropped in non-leap running years.
 */
function dailyClimatology(stationId, runningYear) {
  const from = runningYear - 30
  const to = runningYear - 1

  const rows = climatologyStmt
    .all({ station: stationId, from, to })
    .filter((r) => r.temp !== null)
    .filter((r) => isLeap(runningYear) || !(r.month === 2 && r.day === 29))

  if (rows.length === 0) return null

  return {
    from,
    to,
    days: rows.map((r) => ({
      month: r.month,
      day: r.day,
      temp: r.temp,
      tempMax: r.tempMax ?? r.temp,
      tempMin: r.tempMin ?? r.temp,
      precip: r.precip ?? 0,
      share: {
        hot: r.hot ?? 0,
        summer: r.summer ?? 0,
        tropicalNight: r.tropicalNight ?? 0,
        frost: r.frost ?? 0,
        ice: r.ice ?? 0,
        max20: r.max20 ?? 0,
        max15: r.max15 ?? 0,
        mean0: r.mean0 ?? 0,
        mean20: r.mean20 ?? 0,
      },
    })),
  }
}

const observedDaysStmt = db.prepare(`
  SELECT month, day, temp_mean AS temp, precipitation AS precip
  FROM daily
  WHERE station_id = ? AND year = ?
  ORDER BY month, day
`)

const baselineDaysStmt = db.prepare(`
  SELECT year, month, day, temp_mean AS temp, precipitation AS precip
  FROM daily
  WHERE station_id = @station AND year BETWEEN @from AND @to
  ORDER BY year, month, day
`)

/** Percentile over an ascending array, linearly interpolated. */
function pct(sorted, p) {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo)
}

const period1968Stmt = db.prepare(`
  SELECT month, day, AVG(temp_mean) AS temp
  FROM daily
  WHERE station_id = ? AND year BETWEEN 1968 AND 1997 AND temp_mean IS NOT NULL
  GROUP BY month, day
  ORDER BY month, day
`)

export function buildForecast(stationId) {
  const cutOff = getCutOff(stationId)
  if (!cutOff) return null

  const runningYear = cutOff.year
  const climatology = dailyClimatology(stationId, runningYear)
  if (!climatology) return null

  const key = (m, d) => m * 100 + d
  const climByDay = new Map(climatology.days.map((d) => [key(d.month, d.day), d]))

  const observed = observedDaysStmt
    .all(stationId, runningYear)
    .filter((d) => d.temp !== null || d.precip !== null)

  const observedByDay = new Map(observed.map((d) => [key(d.month, d.day), d]))

  /**
   * Build the full 365/366-day series: measured where available, else
   * climatology.
   *
   * A day counts as observed purely by calendar position. Days that lie in the
   * past but carry no measurement are gap-filled from the climatology rather
   * than dropped — otherwise the "days observed" figure and the annual mean
   * would silently disagree with /api/weather/ytd-temp.
   */
  const series = climatology.days.map((clim) => {
    const obs = observedByDay.get(key(clim.month, clim.day))
    const isObserved =
      dayOfYearOf(clim.month, clim.day, runningYear) <= cutOff.dayOfYear
    return {
      month: clim.month,
      day: clim.day,
      isObserved,
      temp: isObserved && obs?.temp != null ? obs.temp : clim.temp,
      precip: isObserved && obs?.precip != null ? obs.precip : clim.precip,
      baselineTemp: clim.temp,
      baselinePrecip: clim.precip,
      observedTemp: isObserved ? (obs?.temp ?? null) : null,
      observedPrecip: isObserved ? (obs?.precip ?? null) : null,
    }
  })

  const observedDays = series.filter((d) => d.isObserved)
  const remainingDays = series.filter((d) => !d.isObserved)

  const sum = (rows, field) => rows.reduce((s, r) => s + (r[field] ?? 0), 0)
  const avg = (rows, field) =>
    rows.length > 0 ? sum(rows, field) / rows.length : null

  const observedTempValues = observedDays.filter((d) => d.observedTemp !== null)

  const forecastTempAvg = avg(series, 'temp')
  const forecastPrecipSum = sum(series, 'precip')
  const baselineTempAvg = avg(series, 'baselineTemp')
  const baselinePrecipSum = sum(series, 'baselinePrecip')

  const base1968 = new Map(
    period1968Stmt.all(stationId).map((d) => [key(d.month, d.day), d.temp]),
  )

  /* ---- ensemble ------------------------------------------------------------
   * Instead of a single point value, the rest of the year is replayed once per
   * baseline year: "what would this year end at if the remainder went like
   * 1998? like 2003? like 2010?". That yields 30 possible outcomes, and their
   * spread is a defensible uncertainty range — unlike a headline number quoted
   * to two decimals, which suggests a precision the method does not have.
   */
  const memberYears = []
  const memberDays = new Map()
  for (const row of baselineDaysStmt.all({
    station: stationId,
    from: climatology.from,
    to: climatology.to,
  })) {
    let year = memberDays.get(row.year)
    if (!year) {
      year = new Map()
      memberDays.set(row.year, year)
      memberYears.push(row.year)
    }
    year.set(key(row.month, row.day), row)
  }

  /** Per member: the full-year daily temperature/precipitation it implies. */
  const members = memberYears.map((year) => {
    const days = memberDays.get(year)
    const temp = new Array(series.length)
    const precip = new Array(series.length)
    series.forEach((d, i) => {
      const alt = days.get(key(d.month, d.day))
      temp[i] = d.isObserved ? d.temp : (alt?.temp ?? d.baselineTemp)
      precip[i] = d.isObserved ? d.precip : (alt?.precip ?? d.baselinePrecip)
    })
    return { year, temp, precip }
  })

  /** Running YTD mean per member, so the band widens as the year progresses. */
  const memberYtd = members.map((m) => {
    const out = new Array(series.length)
    let acc = 0
    for (let i = 0; i < series.length; i++) {
      acc += m.temp[i]
      out[i] = acc / (i + 1)
    }
    return out
  })

  const spreadAt = (index) => {
    const values = memberYtd.map((m) => m[index]).sort((a, b) => a - b)
    return {
      p10: pct(values, 0.1),
      p50: pct(values, 0.5),
      p90: pct(values, 0.9),
      min: values[0],
      max: values[values.length - 1],
    }
  }

  /* ---- cumulative YTD trajectories ---------------------------------------- */
  const trajectory = []
  let runSum = 0
  let base30Sum = 0
  let base1968Sum = 0
  let base1968Count = 0

  series.forEach((d, index) => {
    const k = key(d.month, d.day)
    runSum += d.temp
    base30Sum += d.baselineTemp
    const b1968 = base1968.get(k)
    if (b1968 !== undefined) {
      base1968Sum += b1968
      base1968Count += 1
    }

    const n = index + 1
    if (n % 10 !== 0) return

    const r3 = (v) => (v === null ? null : Number(v.toFixed(3)))
    const spread = spreadAt(index)
    trajectory.push({
      dateLabel: `${d.day}. ${MONTHS[d.month - 1].slice(0, 3)}`,
      month: d.month,
      day: d.day,
      runningYtdTemp: r3(runSum / n),
      baseline30YrYtdTemp: r3(base30Sum / n),
      baseline1968YtdTemp: r3(base1968Count > 0 ? base1968Sum / base1968Count : 0),
      ytdTempP10: r3(spread.p10),
      ytdTempP90: r3(spread.p90),
      ytdTempMin: r3(spread.min),
      ytdTempMax: r3(spread.max),
      isForecast: !d.isObserved,
    })
  })

  /* ---- per-month roll-up --------------------------------------------------- */
  const monthlyData = []
  for (let month = 1; month <= 12; month++) {
    const days = series.filter((d) => d.month === month)
    if (days.length === 0) continue

    const observedInMonth = days.filter((d) => d.isObserved)
    const monthEnd = cumulativeAt(series, month)
    const r = (v, digits = 2) =>
      v === null || v === undefined ? null : Number(v.toFixed(digits))

    monthlyData.push({
      month,
      monthName: MONTHS[month - 1],
      baselineTemp: r(avg(days, 'baselineTemp'), 1),
      baselinePrecip: r(sum(days, 'baselinePrecip'), 1),
      observedTemp:
        observedInMonth.length > 0 ? r(avg(observedInMonth, 'temp'), 1) : null,
      observedPrecip:
        observedInMonth.length > 0 ? r(sum(observedInMonth, 'precip'), 1) : null,
      forecastTemp: r(avg(days, 'temp'), 1),
      forecastPrecip: r(sum(days, 'precip'), 1),
      isFullyObserved: observedInMonth.length === days.length,
      isPartiallyObserved:
        observedInMonth.length > 0 && observedInMonth.length < days.length,
      isFullyForecasted: observedInMonth.length === 0,
      ytdTempRunning: r(monthEnd.running),
      ytdTemp30Yr: r(monthEnd.baseline30),
      ytdTemp1968_1997: r(monthEnd.baseline1968),
      ytdTempP10: r(monthEnd.p10),
      ytdTempP90: r(monthEnd.p90),
    })
  }

  function cumulativeAt(allDays, throughMonth) {
    let run = 0, b30 = 0, b68 = 0, b68n = 0, n = 0
    for (const d of allDays) {
      if (d.month > throughMonth) break
      run += d.temp
      b30 += d.baselineTemp
      const v = base1968.get(key(d.month, d.day))
      if (v !== undefined) { b68 += v; b68n += 1 }
      n += 1
    }
    const spread = n > 0 ? spreadAt(n - 1) : null
    return {
      running: n > 0 ? run / n : 0,
      baseline30: n > 0 ? b30 / n : 0,
      baseline1968: b68n > 0 ? b68 / b68n : 0,
      p10: spread?.p10 ?? 0,
      p90: spread?.p90 ?? 0,
    }
  }

  const observedTempAvg =
    observedTempValues.length > 0 ? avg(observedTempValues, 'observedTemp') : null
  const observedPrecipSum = sum(observedDays, 'observedPrecip')
  const remainingForecastTempAvg = avg(remainingDays, 'temp')
  const remainingForecastPrecipSum = sum(remainingDays, 'precip')

  const round = (v, digits = 2) =>
    v === null || v === undefined ? null : Number(v.toFixed(digits))

  /* ---- headline uncertainty from the ensemble ----------------------------- */
  const tempSpread = spreadAt(series.length - 1)
  const precipOutcomes = members
    .map((m) => m.precip.reduce((s, v) => s + v, 0))
    .sort((a, b) => a - b)

  return {
    runningYear,
    cutOffDateStr: cutOff.label,
    cutOffMonth: cutOff.month,
    cutOffDay: cutOff.day,
    observedDaysCount: observedDays.length,
    remainingDaysCount: remainingDays.length,
    forecastTempAvg: round(forecastTempAvg),
    forecastPrecipSum: round(forecastPrecipSum, 1),
    observedTempAvg: round(observedTempAvg),
    observedPrecipSum: round(observedPrecipSum, 1),
    remainingForecastTempAvg: round(remainingForecastTempAvg),
    remainingForecastPrecipSum: round(remainingForecastPrecipSum, 1),
    baselineTempAvg: round(baselineTempAvg),
    baselinePrecipSum: round(baselinePrecipSum, 1),
    tempDifference: round(forecastTempAvg - baselineTempAvg),
    precipDifference: round(forecastPrecipSum - baselinePrecipSum, 1),
    precipDifferencePercent:
      baselinePrecipSum > 0
        ? round(
            ((forecastPrecipSum - baselinePrecipSum) / baselinePrecipSum) * 100,
            1,
          )
        : 0,
    ensembleSize: members.length,
    ensembleFrom: climatology.from,
    ensembleTo: climatology.to,
    forecastTempP10: round(tempSpread.p10),
    forecastTempP50: round(tempSpread.p50),
    forecastTempP90: round(tempSpread.p90),
    forecastPrecipP10: round(pct(precipOutcomes, 0.1), 1),
    forecastPrecipP50: round(pct(precipOutcomes, 0.5), 1),
    forecastPrecipP90: round(pct(precipOutcomes, 0.9), 1),
    monthlyData,
    ytdTrajectoryData: trajectory,
  }
}

/* -------------------------------------------------------------------------- */
/* Meteorological seasons                                                     */
/* -------------------------------------------------------------------------- */

export const SEASONS = [
  { key: 'DJF', label: 'Winter', months: [12, 1, 2] },
  { key: 'MAM', label: 'Frühling', months: [3, 4, 5] },
  { key: 'JJA', label: 'Sommer', months: [6, 7, 8] },
  { key: 'SON', label: 'Herbst', months: [9, 10, 11] },
]

const seasonStmt = db.prepare(`
  SELECT
    -- Meteorological winter spans the turn of the year: December belongs to
    -- the winter that ends in the following January.
    CASE WHEN month = 12 THEN year + 1 ELSE year END AS seasonYear,
    CASE
      WHEN month IN (12, 1, 2) THEN 'DJF'
      WHEN month IN (3, 4, 5)  THEN 'MAM'
      WHEN month IN (6, 7, 8)  THEN 'JJA'
      ELSE 'SON'
    END AS season,
    AVG(temp_mean)     AS avg_temp,
    SUM(precipitation) AS precip_sum,
    SUM(CASE WHEN temp_mean IS NOT NULL THEN 1 END) AS valid_days,
    COUNT(*)                                        AS total_days
  FROM daily
  WHERE station_id = ?
  GROUP BY seasonYear, season
  ORDER BY seasonYear
`)

export function seasons(stationId) {
  const rows = seasonStmt.all(stationId)

  const bySeason = {}
  for (const spec of SEASONS) bySeason[spec.key] = []

  for (const row of rows) {
    if (row.avg_temp === null) continue
    // A season is ~90 days; the same 90 % rule as everywhere else. Winters at
    // the very start and end of the record are inevitably truncated.
    if (row.total_days < 88 || row.valid_days / row.total_days < COVERAGE) continue

    bySeason[row.season].push({
      year: row.seasonYear,
      label:
        row.season === 'DJF'
          ? `${row.seasonYear - 1}/${String(row.seasonYear).slice(2)}`
          : String(row.seasonYear),
      avg_temp: row.avg_temp,
      precip_sum: row.precip_sum,
      valid_days: row.valid_days,
      total_days: row.total_days,
    })
  }

  return {
    seasons: SEASONS.map((spec) => ({
      ...spec,
      records: bySeason[spec.key],
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* Record balance — warm against cold daily records                           */
/* -------------------------------------------------------------------------- */

const recordDaysStmt = db.prepare(`
  SELECT year, month, day, temp_max, temp_min
  FROM daily
  WHERE station_id = ? AND (temp_max IS NOT NULL OR temp_min IS NOT NULL)
  ORDER BY year
`)

/**
 * Which decade holds today's record for each calendar day?
 *
 * Counting "was this warmer than anything before it" is heavily biased towards
 * the start of a series, because early on almost every value is a record. This
 * instead looks only at the record that still stands: exactly one warm and one
 * cold record per calendar day, attributed to the decade that set it. In a
 * stable climate both would spread evenly across the decades.
 *
 * Ties go to the earlier year — the later occurrence merely equalled the record,
 * it did not set it.
 */
export function recordBalance(stationId) {
  const rows = recordDaysStmt.all(stationId)

  const warm = new Map()
  const cold = new Map()
  const observedYears = new Map()

  for (const row of rows) {
    const key = row.month * 100 + row.day
    observedYears.set(key, (observedYears.get(key) ?? 0) + 1)

    if (row.temp_max !== null) {
      const held = warm.get(key)
      if (!held || row.temp_max > held.value) {
        warm.set(key, { value: row.temp_max, year: row.year, month: row.month, day: row.day })
      }
    }
    if (row.temp_min !== null) {
      const held = cold.get(key)
      if (!held || row.temp_min < held.value) {
        cold.set(key, { value: row.temp_min, year: row.year, month: row.month, day: row.day })
      }
    }
  }

  const decades = new Map()
  const bump = (year, field) => {
    const decade = Math.floor(year / 10) * 10
    if (!decades.has(decade)) decades.set(decade, { decade, warm: 0, cold: 0 })
    decades.get(decade)[field] += 1
  }
  for (const r of warm.values()) bump(r.year, 'warm')
  for (const r of cold.values()) bump(r.year, 'cold')

  const byDecade = [...decades.values()].sort((a, b) => a.decade - b.decade)

  /** How many calendar days a decade would hold if records fell evenly. */
  const measuredYears = new Set(rows.map((r) => r.year)).size
  const expectedPerYear = warm.size / Math.max(1, measuredYears)

  const toList = (map, direction) =>
    [...map.values()]
      .sort((a, b) => (direction === 'warm' ? b.value - a.value : a.value - b.value))
      .slice(0, 10)

  return {
    warmRecordCount: warm.size,
    coldRecordCount: cold.size,
    measuredYears,
    /** Days a decade is expected to hold under a stable climate. */
    expectedPerDecade: Number((expectedPerYear * 10).toFixed(1)),
    byDecade,
    /** The most extreme standing records, for context. */
    topWarm: toList(warm, 'warm'),
    topCold: toList(cold, 'cold'),
  }
}

/* -------------------------------------------------------------------------- */
/* Precipitation intensity                                                    */
/* -------------------------------------------------------------------------- */

/** ETCCDI reference period for R95p. */
const R95_FROM = 1961
const R95_TO = 1990
/** A "wet day" in the ETCCDI definition. */
const WET_DAY = 1
/** Fixed threshold for the plainly readable index. */
const HEAVY_DAY = 20

const precipDaysStmt = db.prepare(`
  SELECT year, month, day, precipitation AS p
  FROM daily
  WHERE station_id = ? AND precipitation IS NOT NULL
  ORDER BY year, month, day
`)

/** Length of the sliding window for RX5day. */
const RX_WINDOW = 5

/**
 * RX5day — the highest total over five consecutive days in a year.
 *
 * A window only counts when all five days are actually present and follow each
 * other without a gap. Summing across a hole in the record would invent a
 * downpour out of missing data, which is exactly the kind of artefact that
 * makes a heavy-rain statistic worthless.
 *
 * Windows stay inside the calendar year, so each year's value is attributable
 * to that year alone.
 */
function maxWindowSum(days) {
  let best = null

  for (let end = RX_WINDOW - 1; end < days.length; end++) {
    const start = end - (RX_WINDOW - 1)

    // Reject the window unless the five days are calendar-consecutive.
    let contiguous = true
    for (let i = start; i < end; i++) {
      if (!isNextDay(days[i].iso, days[i + 1].iso)) {
        contiguous = false
        break
      }
    }
    if (!contiguous) continue

    let sum = 0
    for (let i = start; i <= end; i++) sum += days[i].p

    if (!best || sum > best.sum) {
      best = { sum, start: days[start].iso, end: days[end].iso }
    }
  }

  return best
}

const precipCoverageStmt = db.prepare(`
  SELECT year, SUM(CASE WHEN precipitation IS NOT NULL THEN 1 END) AS valid_days
  FROM daily WHERE station_id = ? GROUP BY year
`)

export function precipIntensity(stationId) {
  const rows = precipDaysStmt.all(stationId)
  const coverage = new Map(
    precipCoverageStmt.all(stationId).map((r) => [r.year, r.valid_days ?? 0]),
  )

  // R95p threshold: 95th percentile of wet-day totals in the reference period.
  const referenceWetDays = rows
    .filter((r) => r.year >= R95_FROM && r.year <= R95_TO && r.p >= WET_DAY)
    .map((r) => r.p)
    .sort((a, b) => a - b)
  const r95Threshold = pct(referenceWetDays, 0.95)

  const byYear = new Map()
  for (const row of rows) {
    if (!byYear.has(row.year)) {
      byYear.set(row.year, {
        year: row.year,
        total: 0,
        heavy: 0,
        r95: 0,
        heavyDays: 0,
        wetDays: 0,
        days: [],
      })
    }
    const y = byYear.get(row.year)
    y.total += row.p
    y.days.push({
      iso: `${row.year}-${String(row.month).padStart(2, '0')}-${String(row.day).padStart(2, '0')}`,
      p: row.p,
    })
    if (row.p >= WET_DAY) y.wetDays += 1
    if (row.p >= HEAVY_DAY) {
      y.heavy += row.p
      y.heavyDays += 1
    }
    if (r95Threshold !== null && row.p > r95Threshold && row.p >= WET_DAY) {
      y.r95 += row.p
    }
  }

  const records = [...byYear.values()]
    .filter((y) => {
      const valid = coverage.get(y.year) ?? 0
      return valid / daysInYear(y.year) >= COVERAGE && y.total > 0
    })
    .map((y) => {
      const rx5 = maxWindowSum(y.days)
      return {
        year: y.year,
        total: Number(y.total.toFixed(1)),
        heavyShare: Number(((y.heavy / y.total) * 100).toFixed(2)),
        r95Share: Number(((y.r95 / y.total) * 100).toFixed(2)),
        heavyDays: y.heavyDays,
        wetDays: y.wetDays,
        rx5day: rx5 ? Number(rx5.sum.toFixed(1)) : null,
        rx5Start: rx5?.start ?? null,
        rx5End: rx5?.end ?? null,
      }
    })
    .sort((a, b) => a.year - b.year)

  return {
    heavyThreshold: HEAVY_DAY,
    r95Threshold: r95Threshold === null ? null : Number(r95Threshold.toFixed(1)),
    r95From: R95_FROM,
    r95To: R95_TO,
    rxWindow: RX_WINDOW,
    records,
  }
}

/* -------------------------------------------------------------------------- */
/* This day in history                                                        */
/* -------------------------------------------------------------------------- */

const dayHistoryStmt = db.prepare(`
  SELECT year, date, temp_mean, temp_max, temp_min, precipitation, wind_max
  FROM daily
  WHERE station_id = ? AND month = ? AND day = ?
  ORDER BY year DESC
`)

/**
 * Every year's measurement for one calendar day, with the years that still
 * hold a record for that day marked.
 */
export function dayInHistory(stationId, month, day) {
  const rows = dayHistoryStmt.all(stationId, month, day)
  if (rows.length === 0) {
    return { month, day, records: [], holders: {}, count: 0 }
  }

  const holder = (field, direction) => {
    let best = null
    for (const row of rows) {
      const value = row[field]
      if (value === null) continue
      if (
        !best ||
        (direction === 'max' ? value > best.value : value < best.value) ||
        // Ties go to the earlier year, which actually set the record.
        (value === best.value && row.year < best.year)
      ) {
        best = { year: row.year, value }
      }
    }
    return best
  }

  const holders = {
    warmest: holder('temp_max', 'max'),
    coldest: holder('temp_min', 'min'),
    wettest: holder('precipitation', 'max'),
    windiest: holder('wind_max', 'max'),
    warmestMean: holder('temp_mean', 'max'),
    coldestMean: holder('temp_mean', 'min'),
  }

  const values = rows.map((r) => r.temp_mean).filter((v) => v !== null)

  return {
    month,
    day,
    count: rows.length,
    firstYear: rows[rows.length - 1].year,
    lastYear: rows[0].year,
    meanOfDay: values.length > 0 ? mean(values) : null,
    holders,
    records: rows,
  }
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length
}

/* -------------------------------------------------------------------------- */
/* Vegetation period and growing degree days                                  */
/* -------------------------------------------------------------------------- */

const VEGETATION_BASE = 5
/** Days that must hold above/below the threshold before the season flips. */
const VEGETATION_RUN = 6

const vegetationStmt = db.prepare(`
  SELECT year, month, day, temp_mean AS temp
  FROM daily
  WHERE station_id = ?
  ORDER BY year, month, day
`)

/**
 * Thermal growing season after the common German convention:
 *
 *  - it begins on the first day of the first run of six consecutive days with
 *    a daily mean at or above 5 °C;
 *  - it ends on the day before the first such run *below* 5 °C that starts
 *    after 1 July (the July guard stops a cold snap in May from closing the
 *    season).
 *
 * Growing degree days accumulate max(0, Tmean − 5) over the whole year.
 */
export function vegetation(stationId) {
  const rows = vegetationStmt.all(stationId)

  const byYear = new Map()
  for (const row of rows) {
    if (!byYear.has(row.year)) byYear.set(row.year, [])
    byYear.get(row.year).push(row)
  }

  const records = []

  for (const [year, days] of byYear) {
    const measured = days.filter((d) => d.temp !== null)
    // Too sparse to locate a season boundary reliably.
    if (measured.length / daysInYear(year) < COVERAGE) continue

    const doy = (d) => dayOfYearOf(d.month, d.day, year)

    const findRun = (predicate, fromDoy) => {
      let run = 0
      for (const d of days) {
        if (d.temp === null) {
          run = 0
          continue
        }
        if (doy(d) < fromDoy) {
          run = predicate(d.temp) ? run + 1 : 0
          continue
        }
        run = predicate(d.temp) ? run + 1 : 0
        if (run >= VEGETATION_RUN) {
          // Step back to the first day of the run.
          const endIndex = days.indexOf(d)
          return days[endIndex - (VEGETATION_RUN - 1)] ?? d
        }
      }
      return null
    }

    const startDay = findRun((t) => t >= VEGETATION_BASE, 1)
    if (!startDay) continue

    const julyFirst = dayOfYearOf(7, 1, year)
    const closingDay = findRun((t) => t < VEGETATION_BASE, julyFirst)

    const startDoy = doy(startDay)
    const endDoy = closingDay ? doy(closingDay) - 1 : daysInYear(year)
    if (endDoy <= startDoy) continue

    const gdd = measured.reduce(
      (sum, d) => sum + Math.max(0, d.temp - VEGETATION_BASE),
      0,
    )

    records.push({
      year,
      startDate: `${year}-${String(startDay.month).padStart(2, '0')}-${String(startDay.day).padStart(2, '0')}`,
      startDayOfYear: startDoy,
      endDate: closingDay
        ? `${year}-${String(closingDay.month).padStart(2, '0')}-${String(closingDay.day).padStart(2, '0')}`
        : `${year}-12-31`,
      endDayOfYear: endDoy,
      lengthDays: endDoy - startDoy + 1,
      growingDegreeDays: Number(gdd.toFixed(1)),
      /** False when the season never closed before the year ended. */
      seasonClosed: closingDay !== null,
    })
  }

  records.sort((a, b) => a.year - b.year)
  return { base: VEGETATION_BASE, runLength: VEGETATION_RUN, records }
}

/* -------------------------------------------------------------------------- */
/* Data coverage — the basis for the homogeneity caveat                       */
/* -------------------------------------------------------------------------- */

const VARIABLES = [
  ['temp_mean', 'Tagesmitteltemperatur'],
  ['temp_max', 'Tagesmaximum'],
  ['temp_min', 'Tagesminimum'],
  ['precipitation', 'Niederschlag'],
  ['pressure', 'Luftdruck'],
  ['wind_mean', 'Mittelwind'],
  ['wind_max', 'Windspitze'],
]

export function coverage(stationId) {
  const total = db
    .prepare('SELECT COUNT(*) AS n FROM daily WHERE station_id = ?')
    .get(stationId).n

  const variables = VARIABLES.map(([column, label]) => {
    const row = db
      .prepare(
        `SELECT COUNT(${column}) AS present,
                MIN(CASE WHEN ${column} IS NOT NULL THEN year END) AS firstYear,
                MAX(CASE WHEN ${column} IS NOT NULL THEN year END) AS lastYear
         FROM daily WHERE station_id = ?`,
      )
      .get(stationId)
    return {
      column,
      label,
      present: row.present ?? 0,
      share: total > 0 ? (row.present ?? 0) / total : 0,
      firstYear: row.firstYear ?? null,
      lastYear: row.lastYear ?? null,
    }
  })

  const byDecade = db
    .prepare(
      `SELECT (year / 10) * 10 AS decade,
              COUNT(*) AS days,
              COUNT(temp_mean) AS temp,
              COUNT(precipitation) AS precip
       FROM daily WHERE station_id = ?
       GROUP BY decade ORDER BY decade`,
    )
    .all(stationId)
    .map((r) => ({
      decade: r.decade,
      tempShare: r.days > 0 ? r.temp / r.days : 0,
      precipShare: r.days > 0 ? r.precip / r.days : 0,
    }))

  return { totalDays: total, variables, byDecade }
}

/* -------------------------------------------------------------------------- */
/* Spells — heat waves, dry periods, frost periods                            */
/* -------------------------------------------------------------------------- */

const allDaysStmt = db.prepare(`
  SELECT date, year, month, day, temp_mean, temp_max, temp_min, precipitation
  FROM daily
  WHERE station_id = ?
  ORDER BY date
`)

/** A calendar day difference, without going through Date arithmetic twice. */
function isNextDay(previousIso, currentIso) {
  const prev = Date.parse(`${previousIso}T00:00:00Z`)
  const cur = Date.parse(`${currentIso}T00:00:00Z`)
  return cur - prev === 86_400_000
}

/**
 * Categories of consecutive-day runs.
 *
 * `test` returns null when the day carries no usable measurement — such a day
 * breaks the run rather than silently extending it, so a data gap in 1902
 * cannot be reported as a 40-day heat wave.
 */
const SPELL_KINDS = {
  heat: {
    label: 'Hitzeperioden',
    description: 'Aufeinanderfolgende Tage mit einem Maximum von mindestens 30 °C.',
    minDays: 3,
    unit: '°C',
    test: (d) => (d.temp_max === null ? null : d.temp_max >= 30),
    summarise: (days) => Math.max(...days.map((d) => d.temp_max)),
    summaryLabel: 'Höchstwert',
  },
  summer: {
    label: 'Sommerperioden',
    description: 'Aufeinanderfolgende Sommertage mit einem Maximum von mindestens 25 °C.',
    minDays: 5,
    unit: '°C',
    test: (d) => (d.temp_max === null ? null : d.temp_max >= 25),
    summarise: (days) => Math.max(...days.map((d) => d.temp_max)),
    summaryLabel: 'Höchstwert',
  },
  dry: {
    label: 'Trockenperioden',
    description:
      'Aufeinanderfolgende Tage mit weniger als 1 mm Niederschlag — die meteorologische Definition eines niederschlagsfreien Tages.',
    minDays: 10,
    unit: 'mm',
    test: (d) => (d.precipitation === null ? null : d.precipitation < 1),
    summarise: (days) => days.reduce((s, d) => s + d.precipitation, 0),
    summaryLabel: 'Summe',
  },
  wet: {
    label: 'Niederschlagsperioden',
    description: 'Aufeinanderfolgende Tage mit mindestens 1 mm Niederschlag.',
    minDays: 7,
    unit: 'mm',
    test: (d) => (d.precipitation === null ? null : d.precipitation >= 1),
    summarise: (days) => days.reduce((s, d) => s + d.precipitation, 0),
    summaryLabel: 'Summe',
  },
  frost: {
    label: 'Frostperioden',
    description: 'Aufeinanderfolgende Frosttage mit einem Minimum unter 0 °C.',
    minDays: 10,
    unit: '°C',
    test: (d) => (d.temp_min === null ? null : d.temp_min < 0),
    summarise: (days) => Math.min(...days.map((d) => d.temp_min)),
    summaryLabel: 'Tiefstwert',
  },
  ice: {
    label: 'Eisperioden',
    description: 'Aufeinanderfolgende Eistage, an denen das Maximum unter 0 °C bleibt.',
    minDays: 5,
    unit: '°C',
    test: (d) => (d.temp_max === null ? null : d.temp_max < 0),
    summarise: (days) => Math.min(...days.map((d) => d.temp_max)),
    summaryLabel: 'Tiefstwert',
  },
}

export const SPELL_KEYS = Object.keys(SPELL_KINDS)

export function spells(stationId, kind, limit = 25) {
  const spec = SPELL_KINDS[kind]
  if (!spec) return null

  const rows = allDaysStmt.all(stationId)
  const found = []
  let current = []

  const close = () => {
    if (current.length >= spec.minDays) {
      const first = current[0]
      const last = current[current.length - 1]
      found.push({
        start: first.date,
        end: last.date,
        days: current.length,
        year: first.year,
        month: first.month,
        value: spec.summarise(current),
      })
    }
    current = []
  }

  for (const row of rows) {
    const passes = spec.test(row)
    const previous = current[current.length - 1]
    // A missing measurement or a gap in the date sequence ends the run.
    if (passes === null || (previous && !isNextDay(previous.date, row.date))) {
      close()
      if (passes === true) current = [row]
      continue
    }
    if (passes) current.push(row)
    else close()
  }
  close()

  found.sort((a, b) => b.days - a.days || Date.parse(a.start) - Date.parse(b.start))

  return {
    kind,
    label: spec.label,
    description: spec.description,
    minDays: spec.minDays,
    unit: spec.unit,
    summaryLabel: spec.summaryLabel,
    totalCount: found.length,
    /** All spells by decade, so the trend over time stays visible. */
    byDecade: Object.entries(
      found.reduce((acc, s) => {
        const decade = Math.floor(s.year / 10) * 10
        acc[decade] = (acc[decade] ?? 0) + 1
        return acc
      }, {}),
    )
      .map(([decade, count]) => ({ decade: Number(decade), count }))
      .sort((a, b) => a.decade - b.decade),
    records: found.slice(0, limit),
  }
}

/* -------------------------------------------------------------------------- */
/* Further indices — the columns the archive used to discard                   */
/* -------------------------------------------------------------------------- */

/**
 * Annual indices derived from snow depth, cloud cover, humidity, vapour
 * pressure, sunshine and ground minimum temperature.
 *
 * These columns sat unread in the DWD archives this project has been
 * downloading all along. For Göttingen they are not marginal: cloud cover
 * reaches back to 1860 and snow depth to 1858, which makes a snow-cover series
 * a century longer than most.
 *
 * The thresholds are stated in the view rather than hidden here, because two
 * of them are conventions rather than physics:
 *
 *   Schneedeckentag    snow depth of at least 1 cm
 *   Heiterer Tag       mean cloud cover at most 1.6 eighths
 *   Trüber Tag         mean cloud cover at least 6.4 eighths
 *   Schwüler Tag       mean vapour pressure at least 18.8 hPa
 *   Bodenfrosttag      minimum below 0 °C five centimetres above ground
 */
export const EXTRA_INDICES = [
  {
    key: 'snow_days',
    label: 'Schneedeckentage',
    column: 'snow',
    expression: 'SUM(CASE WHEN snow >= 1 THEN 1 ELSE 0 END)',
    unit: 'd',
    decimals: 0,
    note: 'Tage mit einer Schneedecke von mindestens 1 cm',
  },
  {
    key: 'snow_max',
    label: 'Höchste Schneehöhe',
    column: 'snow',
    expression: 'MAX(snow)',
    unit: 'cm',
    decimals: 0,
    note: 'größte im Kalenderjahr gemessene Schneehöhe',
  },
  {
    key: 'clear_days',
    label: 'Heitere Tage',
    column: 'cloud',
    expression: 'SUM(CASE WHEN cloud <= 1.6 THEN 1 ELSE 0 END)',
    unit: 'd',
    decimals: 0,
    note: 'Bedeckungsgrad im Tagesmittel höchstens 1,6 Achtel',
  },
  {
    key: 'overcast_days',
    label: 'Trübe Tage',
    column: 'cloud',
    expression: 'SUM(CASE WHEN cloud >= 6.4 THEN 1 ELSE 0 END)',
    unit: 'd',
    decimals: 0,
    note: 'Bedeckungsgrad im Tagesmittel mindestens 6,4 Achtel',
  },
  {
    key: 'cloud_mean',
    label: 'Mittlere Bewölkung',
    column: 'cloud',
    expression: 'AVG(cloud)',
    unit: '/8',
    decimals: 2,
    note: 'Jahresmittel des Bedeckungsgrads in Achteln',
  },
  {
    key: 'sunshine_hours',
    label: 'Sonnenscheindauer',
    column: 'sunshine',
    expression: 'SUM(sunshine)',
    unit: 'h',
    decimals: 0,
    note: 'Summe der Sonnenscheinstunden im Jahr',
  },
  {
    key: 'humidity_mean',
    label: 'Mittlere Luftfeuchte',
    column: 'humidity',
    expression: 'AVG(humidity)',
    unit: '%',
    decimals: 1,
    note: 'Jahresmittel der relativen Feuchte',
  },
  {
    key: 'sultry_days',
    label: 'Schwüle Tage',
    column: 'vapour_pressure',
    expression: 'SUM(CASE WHEN vapour_pressure >= 18.8 THEN 1 ELSE 0 END)',
    unit: 'd',
    decimals: 0,
    note: 'Dampfdruck im Tagesmittel mindestens 18,8 hPa',
  },
  {
    key: 'ground_frost_days',
    label: 'Bodenfrosttage',
    column: 'temp_ground_min',
    expression: 'SUM(CASE WHEN temp_ground_min < 0 THEN 1 ELSE 0 END)',
    unit: 'd',
    decimals: 0,
    note: 'Minimum 5 cm über dem Erdboden unter 0 °C',
  },
]

export const EXTRA_INDEX_KEYS = EXTRA_INDICES.map((i) => i.key)

/**
 * One station's annual series for every index it has data for.
 *
 * The 90 % rule applies per column, not per station: Göttingen measures cloud
 * cover from 1860 and sunshine only from 1927, and a year with two hundred
 * cloud readings would show far too few clear days if it were counted anyway.
 */
export function extraIndices(stationId) {
  const series = {}
  const available = []

  for (const index of EXTRA_INDICES) {
    const rows = db
      .prepare(
        `SELECT year,
                ${index.expression} AS value,
                COUNT(${index.column}) AS valid_days
         FROM daily
         WHERE station_id = ? AND ${index.column} IS NOT NULL
         GROUP BY year
         HAVING valid_days >= 365 * ?
         ORDER BY year`,
      )
      .all(stationId, COVERAGE)
      .filter((r) => r.value !== null)

    if (rows.length === 0) continue

    available.push({
      key: index.key,
      label: index.label,
      unit: index.unit,
      decimals: index.decimals,
      note: index.note,
      first: rows[0].year,
      last: rows.at(-1).year,
      years: rows.length,
    })
    series[index.key] = rows.map((r) => ({
      year: r.year,
      value: r.value,
      validDays: r.valid_days,
    }))
  }

  return { indices: available, series }
}
