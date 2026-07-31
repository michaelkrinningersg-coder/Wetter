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
         SUM(CASE WHEN temp_mean IS NOT NULL THEN 1 END) AS valid_days
  FROM daily
  WHERE station_id = ?
  GROUP BY year, month
  HAVING valid_days >= ?
  ORDER BY year, month
`)

export function heatmap(stationId) {
  const rows = monthlyMeansStmt
    .all(stationId, MIN_MONTH_DAYS)
    .filter((r) => r.avg_temp !== null)

  // Rank each month against the same calendar month in every other year.
  const byMonth = new Map()
  for (const row of rows) {
    if (!byMonth.has(row.month)) byMonth.set(row.month, [])
    byMonth.get(row.month).push(row)
  }

  const monthMinMax = {}
  const ranked = []

  for (const [month, group] of byMonth) {
    const sorted = [...group].sort((a, b) => b.avg_temp - a.avg_temp)
    const total = sorted.length
    monthMinMax[month] = {
      min: sorted[total - 1].avg_temp,
      max: sorted[0].avg_temp,
    }
    sorted.forEach((row, index) => {
      ranked.push({
        year: row.year,
        month,
        avg_temp: row.avg_temp,
        rank: index + 1,
        total_years_for_month: total,
      })
    })
  }

  ranked.sort((a, b) => a.year - b.year || a.month - b.month)
  return { records: ranked, monthMinMax }
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

const MONTH_CATEGORIES = {
  temp_mean_max: ['AVG(temp_mean)', 'temp_mean', 'DESC'],
  temp_mean_min: ['AVG(temp_mean)', 'temp_mean', 'ASC'],
  precipitation_max: ['SUM(precipitation)', 'precipitation', 'DESC'],
  precipitation_min: ['SUM(precipitation)', 'precipitation', 'ASC'],
  wind_mean_max: ['AVG(wind_mean)', 'wind_mean', 'DESC'],
  wind_mean_min: ['AVG(wind_mean)', 'wind_mean', 'ASC'],
}

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
         SUM(CASE WHEN temp_max  > 30 THEN 1 ELSE 0 END) AS days_max_above_30,
         SUM(CASE WHEN temp_max  > 25 THEN 1 ELSE 0 END) AS days_max_above_25,
         SUM(CASE WHEN temp_max  > 20 THEN 1 ELSE 0 END) AS days_max_above_20,
         SUM(CASE WHEN temp_max  > 15 THEN 1 ELSE 0 END) AS days_max_above_15,
         SUM(CASE WHEN temp_min  <  0 THEN 1 ELSE 0 END) AS days_min_below_0,
         SUM(CASE WHEN temp_mean <  0 THEN 1 ELSE 0 END) AS days_mean_below_0,
         SUM(CASE WHEN temp_mean > 20 THEN 1 ELSE 0 END) AS days_mean_above_20
  FROM daily
  WHERE station_id = ?
  GROUP BY year
  ORDER BY year DESC
`)

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

    return {
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
      forecast_days_max_above_30:
        row.days_max_above_30 + remaining.reduce((s, d) => s + d.share.max30, 0),
      forecast_days_max_above_25:
        row.days_max_above_25 + remaining.reduce((s, d) => s + d.share.max25, 0),
      forecast_days_max_above_20:
        row.days_max_above_20 + remaining.reduce((s, d) => s + d.share.max20, 0),
      forecast_days_max_above_15:
        row.days_max_above_15 + remaining.reduce((s, d) => s + d.share.max15, 0),
      forecast_days_min_below_0:
        row.days_min_below_0 + remaining.reduce((s, d) => s + d.share.min0, 0),
      forecast_days_mean_below_0:
        row.days_mean_below_0 + remaining.reduce((s, d) => s + d.share.mean0, 0),
      forecast_days_mean_above_20:
        row.days_mean_above_20 + remaining.reduce((s, d) => s + d.share.mean20, 0),
    }
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
         AVG(CASE WHEN temp_max  > 30 THEN 1.0 ELSE 0.0 END) AS max30,
         AVG(CASE WHEN temp_max  > 25 THEN 1.0 ELSE 0.0 END) AS max25,
         AVG(CASE WHEN temp_max  > 20 THEN 1.0 ELSE 0.0 END) AS max20,
         AVG(CASE WHEN temp_max  > 15 THEN 1.0 ELSE 0.0 END) AS max15,
         AVG(CASE WHEN temp_min  <  0 THEN 1.0 ELSE 0.0 END) AS min0,
         AVG(CASE WHEN temp_mean <  0 THEN 1.0 ELSE 0.0 END) AS mean0,
         AVG(CASE WHEN temp_mean > 20 THEN 1.0 ELSE 0.0 END) AS mean20
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
        max30: r.max30 ?? 0, max25: r.max25 ?? 0, max20: r.max20 ?? 0,
        max15: r.max15 ?? 0, min0: r.min0 ?? 0, mean0: r.mean0 ?? 0,
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

const extremeYearStmt = db.prepare(`
  SELECT year, AVG(temp_mean) AS temp
  FROM daily
  WHERE station_id = @station AND year BETWEEN @from AND @to
  GROUP BY year
  HAVING SUM(CASE WHEN temp_mean IS NOT NULL THEN 1 END) >= 330
  ORDER BY temp DESC
`)

const singleYearDaysStmt = db.prepare(`
  SELECT month, day, temp_mean AS temp
  FROM daily
  WHERE station_id = ? AND year = ? AND temp_mean IS NOT NULL
  ORDER BY month, day
`)

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

  /* ---- extreme scenarios: warmest / coldest single year of the baseline --- */
  const rankedYears = extremeYearStmt.all({
    station: stationId,
    from: climatology.from,
    to: climatology.to,
  })
  const hottestYear = rankedYears[0]?.year ?? null
  const coldestYear = rankedYears.at(-1)?.year ?? null

  const scenarioDays = (year) => {
    if (year === null) return new Map()
    return new Map(
      singleYearDaysStmt.all(stationId, year).map((d) => [key(d.month, d.day), d.temp]),
    )
  }
  const hottest = scenarioDays(hottestYear)
  const coldest = scenarioDays(coldestYear)
  const base1968 = new Map(
    period1968Stmt.all(stationId).map((d) => [key(d.month, d.day), d.temp]),
  )

  /* ---- cumulative YTD trajectories ---------------------------------------- */
  const trajectory = []
  let runSum = 0
  let base30Sum = 0
  let base1968Sum = 0
  let hotSum = 0
  let coldSum = 0
  let base1968Count = 0

  series.forEach((d, index) => {
    const k = key(d.month, d.day)
    runSum += d.temp
    base30Sum += d.baselineTemp
    hotSum += d.isObserved ? d.temp : (hottest.get(k) ?? d.baselineTemp)
    coldSum += d.isObserved ? d.temp : (coldest.get(k) ?? d.baselineTemp)
    const b1968 = base1968.get(k)
    if (b1968 !== undefined) {
      base1968Sum += b1968
      base1968Count += 1
    }

    const n = index + 1
    if (n % 10 !== 0) return

    const r3 = (v) => Number(v.toFixed(3))
    trajectory.push({
      dateLabel: `${d.day}. ${MONTHS[d.month - 1].slice(0, 3)}`,
      month: d.month,
      day: d.day,
      runningYtdTemp: r3(runSum / n),
      baseline30YrYtdTemp: r3(base30Sum / n),
      baseline1968YtdTemp: r3(base1968Count > 0 ? base1968Sum / base1968Count : 0),
      hottestYtdTemp: r3(hotSum / n),
      coldestYtdTemp: r3(coldSum / n),
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
      ytdTempHottest: r(monthEnd.hottest),
      ytdTempColdest: r(monthEnd.coldest),
    })
  }

  function cumulativeAt(allDays, throughMonth) {
    let run = 0, b30 = 0, b68 = 0, b68n = 0, hot = 0, cold = 0, n = 0
    for (const d of allDays) {
      if (d.month > throughMonth) break
      const k = key(d.month, d.day)
      run += d.temp
      b30 += d.baselineTemp
      hot += d.isObserved ? d.temp : (hottest.get(k) ?? d.baselineTemp)
      cold += d.isObserved ? d.temp : (coldest.get(k) ?? d.baselineTemp)
      const v = base1968.get(k)
      if (v !== undefined) { b68 += v; b68n += 1 }
      n += 1
    }
    return {
      running: n > 0 ? run / n : 0,
      baseline30: n > 0 ? b30 / n : 0,
      baseline1968: b68n > 0 ? b68 / b68n : 0,
      hottest: n > 0 ? hot / n : 0,
      coldest: n > 0 ? cold / n : 0,
    }
  }

  const observedTempAvg =
    observedTempValues.length > 0 ? avg(observedTempValues, 'observedTemp') : null
  const observedPrecipSum = sum(observedDays, 'observedPrecip')
  const remainingForecastTempAvg = avg(remainingDays, 'temp')
  const remainingForecastPrecipSum = sum(remainingDays, 'precip')

  const round = (v, digits = 2) =>
    v === null || v === undefined ? null : Number(v.toFixed(digits))

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
    monthlyData,
    ytdTrajectoryData: trajectory,
  }
}
