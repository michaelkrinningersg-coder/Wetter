/** Shapes returned by the `/api` server. Mirrors `server/queries.js`. */

export interface Station {
  id: string
  name: string
  altitude: number
}

export interface ImportStatus {
  importInProgress: boolean
  lastError: string | null
  rowCount: number
  minDate: string | null
  maxDate: string | null
}

export interface ImportResult {
  success: boolean
  newRecordsCount?: number
  newMaxDate?: string | null
  previousMaxDate?: string | null
  error?: string
}

export interface DailyRecord {
  date: string
  year: number
  month: number
  day: number
  temp_mean: number | null
  temp_max: number | null
  temp_min: number | null
  precipitation: number | null
  wind_max: number | null
  wind_mean: number | null
  pressure: number | null
}

export interface MonthlyResponse {
  days: DailyRecord[]
  summary: {
    tempAvg: number | null
    maxTemp: number | null
    minTemp: number | null
    precipSum: number | null
    maxWind: number | null
  }
  monthlyStats: {
    month: number
    tempAvg: number | null
    precipSum: number | null
    maxWind: number | null
    maxPrecip: number | null
  }[]
}

export interface TempTrendRecord {
  year: number
  avg_temp: number
  valid_days: number
  total_days: number
  isIncomplete: boolean
}

export interface PrecipTrendRecord {
  year: number
  sum_precipitation: number
  valid_days: number
  total_days: number
  isIncomplete: boolean
}

export interface AnnualMeanRecord {
  year: number
  avg_temp: number
  valid_days: number
  total_days: number
  anomaly: number
}

export interface AnnualMeansResponse {
  records: AnnualMeanRecord[]
  overallAvg: number
}

export interface HeatmapRecord {
  year: number
  month: number
  avg_temp: number | null
  rank: number
  total_years_for_month: number
}

export interface HeatmapResponse {
  records: HeatmapRecord[]
  monthMinMax: Record<string, { min: number; max: number }>
}

export interface ClimateDiagramRecord {
  month: number
  avg_temp: number
  avg_precipitation: number
}

export interface ComparisonRecord {
  period: string
  avg_temp: number | null
  valid_years_count: number
}

export interface ExtremeDay {
  date: string
  year: number
  month: number
  day: number
  value: number
}

export interface ExtremeMonth {
  year: number
  month: number
  value: number
  validDays: number
}

export interface YtdRecord {
  year: number
  avg_temp: number | null
  valid_days: number
  total_days: number
}

export interface YtdResponse {
  records: YtdRecord[]
  cutOffDateStr: string
}

export interface AnnualOverviewRecord {
  year: number
  min_temp: number | null
  max_temp: number | null
  warmest_day_mean: number | null
  coldest_day_mean: number | null
  avg_temp: number | null
  precip_sum: number | null
  valid_days: number
  is_running_year: boolean
  days_max_above_30: number
  days_max_above_25: number
  days_max_above_20: number
  days_max_above_15: number
  days_min_below_0: number
  days_mean_below_0: number
  days_mean_above_20: number
  forecast_min_temp?: number | null
  forecast_max_temp?: number | null
  forecast_warmest_day_mean?: number | null
  forecast_coldest_day_mean?: number | null
  forecast_avg_temp?: number | null
  forecast_precip_sum?: number | null
  forecast_days_max_above_30?: number
  forecast_days_max_above_25?: number
  forecast_days_max_above_20?: number
  forecast_days_max_above_15?: number
  forecast_days_min_below_0?: number
  forecast_days_mean_below_0?: number
  forecast_days_mean_above_20?: number
}

export interface ForecastMonth {
  month: number
  monthName: string
  baselineTemp: number
  baselinePrecip: number
  observedTemp: number | null
  observedPrecip: number | null
  forecastTemp: number
  forecastPrecip: number
  isPartiallyObserved: boolean
  isFullyObserved: boolean
  isFullyForecasted: boolean
  ytdTempRunning: number
  ytdTemp30Yr: number
  ytdTemp1968_1997: number
  ytdTempHottest: number
  ytdTempColdest: number
}

export interface YtdTrajectoryPoint {
  dateLabel: string
  month: number
  day: number
  runningYtdTemp: number
  baseline30YrYtdTemp: number
  baseline1968YtdTemp: number
  hottestYtdTemp: number
  coldestYtdTemp: number
  isForecast: boolean
}

export interface ForecastResponse {
  runningYear: number
  cutOffDateStr: string
  cutOffMonth: number
  cutOffDay: number
  observedDaysCount: number
  remainingDaysCount: number
  forecastTempAvg: number
  forecastPrecipSum: number
  observedTempAvg: number | null
  observedPrecipSum: number
  remainingForecastTempAvg: number
  remainingForecastPrecipSum: number
  baselineTempAvg: number
  baselinePrecipSum: number
  tempDifference: number
  precipDifference: number
  precipDifferencePercent: number
  monthlyData: ForecastMonth[]
  ytdTrajectoryData: YtdTrajectoryPoint[]
}
