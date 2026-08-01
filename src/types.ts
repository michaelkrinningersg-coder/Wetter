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
  /** Days carrying a mean temperature; below the minimum the month is unranked. */
  validDays: number
  days: number
  rated: boolean
  rank: number | null
  total_years_for_month: number | null
}

export interface HeatmapResponse {
  records: HeatmapRecord[]
  monthMinMax: Record<string, { min: number; max: number }>
  minMonthDays: number
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
  /** DWD-Kenntage (inclusive thresholds). */
  days_hot: number
  days_summer: number
  days_tropical_night: number
  days_frost: number
  days_ice: number
  /** Additional thresholds, not part of the DWD Kenntag definitions. */
  days_max_above_20: number
  days_max_above_15: number
  days_mean_below_0: number
  days_mean_above_20: number
  forecast_min_temp?: number | null
  forecast_max_temp?: number | null
  forecast_warmest_day_mean?: number | null
  forecast_coldest_day_mean?: number | null
  forecast_avg_temp?: number | null
  forecast_precip_sum?: number | null
  forecast_days_hot?: number
  forecast_days_summer?: number
  forecast_days_tropical_night?: number
  forecast_days_frost?: number
  forecast_days_ice?: number
  forecast_days_max_above_20?: number
  forecast_days_max_above_15?: number
  forecast_days_mean_below_0?: number
  forecast_days_mean_above_20?: number
}

export interface VegetationRecord {
  year: number
  startDate: string
  startDayOfYear: number
  endDate: string
  endDayOfYear: number
  lengthDays: number
  growingDegreeDays: number
  seasonClosed: boolean
}

export interface VegetationResponse {
  base: number
  runLength: number
  records: VegetationRecord[]
}

export interface CoverageResponse {
  totalDays: number
  variables: {
    column: string
    label: string
    present: number
    share: number
    firstYear: number | null
    lastYear: number | null
  }[]
  byDecade: { decade: number; tempShare: number; precipShare: number }[]
}

export interface SeasonRecord {
  year: number
  label: string
  avg_temp: number
  precip_sum: number | null
  valid_days: number
  total_days: number
}

export interface SeasonsResponse {
  seasons: {
    key: string
    label: string
    months: number[]
    records: SeasonRecord[]
  }[]
}

export interface RecordHolder {
  year: number
  month: number
  day: number
  value: number
}

export interface RecordBalanceResponse {
  warmRecordCount: number
  coldRecordCount: number
  measuredYears: number
  expectedPerDecade: number
  byDecade: { decade: number; warm: number; cold: number }[]
  topWarm: RecordHolder[]
  topCold: RecordHolder[]
}

export interface PrecipIntensityRecord {
  year: number
  total: number
  heavyShare: number
  r95Share: number
  heavyDays: number
  wetDays: number
  /** Highest total over five consecutive days (ETCCDI RX5day). */
  rx5day: number | null
  rx5Start: string | null
  rx5End: string | null
}

export interface PrecipIntensityResponse {
  heavyThreshold: number
  r95Threshold: number | null
  r95From: number
  r95To: number
  rxWindow: number
  records: PrecipIntensityRecord[]
}

export interface DayHistoryRow {
  year: number
  date: string
  temp_mean: number | null
  temp_max: number | null
  temp_min: number | null
  precipitation: number | null
  wind_max: number | null
}

export interface DayInHistoryResponse {
  month: number
  day: number
  count: number
  firstYear?: number
  lastYear?: number
  meanOfDay?: number | null
  holders: Partial<
    Record<
      'warmest' | 'coldest' | 'wettest' | 'windiest' | 'warmestMean' | 'coldestMean',
      { year: number; value: number } | null
    >
  >
  records: DayHistoryRow[]
}

export interface Spell {
  start: string
  end: string
  days: number
  year: number
  month: number
  value: number
}

export interface SpellsResponse {
  kind: string
  label: string
  description: string
  minDays: number
  unit: string
  summaryLabel: string
  totalCount: number
  byDecade: { decade: number; count: number }[]
  records: Spell[]
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
  ytdTempP10: number
  ytdTempP90: number
}

export interface YtdTrajectoryPoint {
  dateLabel: string
  month: number
  day: number
  runningYtdTemp: number
  baseline30YrYtdTemp: number
  baseline1968YtdTemp: number
  /** Ensemble spread: 10th/90th percentile and the full envelope. */
  ytdTempP10: number
  ytdTempP90: number
  ytdTempMin: number
  ytdTempMax: number
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
  /** Number of baseline years replayed to build the uncertainty range. */
  ensembleSize: number
  ensembleFrom: number
  ensembleTo: number
  forecastTempP10: number
  forecastTempP50: number
  forecastTempP90: number
  forecastPrecipP10: number
  forecastPrecipP50: number
  forecastPrecipP90: number
  monthlyData: ForecastMonth[]
  ytdTrajectoryData: YtdTrajectoryPoint[]
}

/* -------------------------------------------------------------------------- */
/* River gauges                                                               */
/* -------------------------------------------------------------------------- */

export interface GaugeLevel {
  cm: number
  mNN: number | null
}

export interface GaugeNamedLevel extends GaugeLevel {
  date: string | null
  label?: string
}

export interface GaugeSummary {
  id: string
  name: string
  water: string
  catchment: number
  source: 'nlwkn' | 'pegelonline'
  fetchedAt: string | null
  latest: { ts: string; value: number } | null
  window: {
    days: number
    count: number
    first: string | null
    last: string | null
    min: number | null
    max: number | null
    mean: number | null
  }
  /** Everything ever collected, across the committed CSV archive. */
  archive?: { count: number; first: string | null }
  gaugeDatum?: number | null
  current?: { cm: number; mNN: number | null; measuredAt: string | null } | null
  trend?: string | null
  change?: number | null
  currentLevel?: number | null
  thresholds?: { level: number; cm: number; mNN: number | null }[]
  characteristic?: {
    period: string | null
    lowest: GaugeNamedLevel | null
    meanLow: GaugeNamedLevel | null
    mean: GaugeNamedLevel | null
    meanHigh: GaugeNamedLevel | null
    highest: GaugeNamedLevel | null
  }
  extremes?: { period: string | null; records: GaugeNamedLevel[] }
  floodScenarios?: { label: string; cm: number; mNN: number | null }[]
  operator?: string | null
  sourceUrl?: string
}

export interface GaugesResponse {
  days: number
  gauges: GaugeSummary[]
}

export interface GaugeSeriesResponse {
  id: string
  days: number
  readings: { ts: string; value: number }[]
}

/* -------------------------------------------------------------------------- */
/* Germany-wide superlatives                                                  */
/* -------------------------------------------------------------------------- */

export interface GermanyRank {
  station_id: string
  name: string
  state: string
  elevation: number | null
  lat: number | null
  lon: number | null
  value: number
}

export interface GermanyScope {
  /** Stations that reported this parameter — the size of the field, not of the podium. */
  count: number
  top: GermanyRank[]
}

export interface GermanyCategory {
  key: string
  label: string
  short: string
  unit: string
  decimals: number
  direction: 'max' | 'min'
  all: GermanyScope
  lowland: GermanyScope
  lowlandDiffers: boolean
}

export interface GermanyDay {
  date: string
  stations: {
    total: number
    lowland: number
    byNetwork: { kl: number; rr: number }
  }
  lowlandLimit: number
  highestStation: { name: string; elevation: number } | null
  categories: GermanyCategory[]
}

export interface GermanyResponse {
  range: { days: number; first: string | null; last: string | null }
  dates: string[]
  day: GermanyDay | null
  /** All-time station records broken on the shown day. */
  records?: number
  hint?: string
}

/* -------------------------------------------------------------------------- */
/* All-time station records                                                   */
/* -------------------------------------------------------------------------- */

export interface RecordEvent {
  station_id: string
  name: string
  state: string
  elevation: number | null
  kind: string
  label: string
  unit: string
  decimals: number
  direction: 'max' | 'min'
  value: number
  previous: number
  previousDate: string
  since: string
  /** Days with a valid reading for this parameter, at the time of the event. */
  days: number
  years: number
}

export interface RecordsResponse {
  range: {
    events: number
    stations: number
    first: string | null
    last: string | null
    cutoff: string | null
  }
  days: { date: string; count: number }[]
  day: { date: string; events: RecordEvent[] } | null
  hint?: string
}

/* -------------------------------------------------------------------------- */
/* Areal means for Germany and the federal states                             */
/* -------------------------------------------------------------------------- */

export type RegionKind = 'state' | 'combination' | 'national'

export interface RegionalParameter {
  key: string
  label: string
  unit: string
  decimals: number
  direction: 'warm' | 'cold' | 'wet'
  /** 'year', '01'…'12', 'winter'…'autumn' — only those the DWD publishes. */
  periods: string[]
  first: number
  last: number
}

export interface RegionalRegion {
  name: string
  kind: RegionKind
  first: number
  last: number
  points: { year: number; value: number }[]
}

export interface RegionalResponse {
  parameters: RegionalParameter[]
  regions: { name: string; kind: RegionKind }[]
  series: {
    parameter: Omit<RegionalParameter, 'periods' | 'first' | 'last'>
    period: string
    regions: RegionalRegion[]
  } | null
  hint?: string
}
