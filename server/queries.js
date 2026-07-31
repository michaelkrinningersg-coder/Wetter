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
