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
  lat: number | null
  lon: number | null
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
  day: { date: string; events: RecordEvent[]; spread: RecordSpread | null } | null
  hint?: string
}

/** How far across the country one day's records reached. */
export interface RecordSpread {
  located: number
  states: number
  stations: number
  /** Extent of the affected stations, in kilometres. */
  northSouth: number
  westEast: number
  widest: { km: number; from: string; to: string } | null
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

/* -------------------------------------------------------------------------- */
/* Germany map                                                                */
/* -------------------------------------------------------------------------- */

export interface GermanyMapField {
  key: string
  label: string
  unit: string
  decimals: number
  scale: 'diverging' | 'sequential'
}

export interface GermanyStationRegister {
  count: number
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }
  fields: GermanyMapField[]
  /** [id, name, state, lat, lon, elevation] — tuples keep the largest file small. */
  stations: [string, string, string, number, number, number][]
}

export interface GermanyMapResponse {
  range: { days: number; first: string | null; last: string | null }
  dates: string[]
  day: {
    date: string
    stations: number
    /** parameter -> [stationId, value] for every station that measured it. */
    values: Record<string, [string, number][]>
  } | null
  /** The day's fitted shape, so the altitude view needs no request of its own. */
  shape?: DayShape | null
}

/* -------------------------------------------------------------------------- */
/* Further indices                                                            */
/* -------------------------------------------------------------------------- */

export interface ExtraIndexMeta {
  key: string
  label: string
  unit: string
  decimals: number
  /** The threshold or aggregation in words, shown so it can be checked. */
  note: string
  first: number
  last: number
  years: number
}

export interface ExtraIndicesResponse {
  indices: ExtraIndexMeta[]
  series: Record<string, { year: number; value: number; validDays: number }[]>
}

/* -------------------------------------------------------------------------- */
/* Notable days                                                               */
/* -------------------------------------------------------------------------- */

export interface NotableKind {
  key: string
  label: string
  note: string
  unit: string
  decimals: number
}

export interface NotableCategory {
  kind: NotableKind
  minStations?: number
  days: { date: string; value: number; stations: number }[]
}

export interface NotableResponse {
  range: { days: number; first: string | null; last: string | null }
  minStations: number
  categories: NotableCategory[]
  records: NotableCategory
}

/* -------------------------------------------------------------------------- */
/* Air quality                                                                */
/* -------------------------------------------------------------------------- */

export interface AirLimit {
  /** Which statistic the threshold applies to — the same pollutant has several. */
  stat: 'hour' | 'day_mean' | 'day_max' | 'day_max8h' | 'year_mean'
  value: number
  /** How often it may be passed per year before it counts as exceeded. */
  allowance: number
  label: string
}

export interface AirComponent {
  key: string
  label: string
  short: string
  unit: string
  decimals: number
  limits: AirLimit[]
}

export interface AirStation {
  id: string
  name: string
  kind: 'background' | 'traffic'
  kindLabel: string
  address: string
  lat: number
  lon: number
  components: string[]
}

export interface AirCoverage {
  station: string
  component: string
  hours: number
  first: string | null
  last: string | null
  /** Measured hours over archived hours — sulphur dioxide reaches only 40 %. */
  share: number
}

export interface AirAnnualPoint {
  year: number
  mean: number | null
  days: number
  peak: number | null
  complete: boolean
  /** Keyed `${stat}_${value}`; null where the limit is a value, not a count. */
  exceedances: Record<string, number | null>
}

export interface AirAnnualSeries {
  station: string
  component: string
  points: AirAnnualPoint[]
}

export interface AirBand {
  from: number
  to: number
  days: number
  mean: number
  max: number
}

export interface AirOzoneHeat {
  station: string
  dwdStation: string
  months: string
  target: number | null
  days: number
  binned: AirBand[]
  exceedanceByBand: { from: number; to: number; days: number; over: number; share: number }[]
}

export interface AirOverviewResponse {
  range: { first: string | null; last: string | null; days: number }
  stations: AirStation[]
  components: AirComponent[]
  coverage: AirCoverage[]
  annual: AirAnnualSeries[]
  ozoneHeat: AirOzoneHeat | null
  minDaysForYear: number
  minHoursForDayMean: number
  hint?: string
}

export interface AirProfilePoint {
  hour: number
  mean: number
  n: number
}

export interface AirStationProfile {
  station: string
  name: string
  kind: 'background' | 'traffic'
  kindLabel: string
  diurnal: AirProfilePoint[]
  bySeason: { key: string; label: string; points: AirProfilePoint[] }[]
  weekday: { weekday: number; mean: number; n: number }[]
  monthly: { month: number; mean: number; n: number }[]
}

export interface AirProfilesResponse {
  component: AirComponent
  series: AirStationProfile[]
}

/* -------------------------------------------------------------------------- */
/* Gamma dose rate                                                            */
/* -------------------------------------------------------------------------- */

export interface OdlProbe {
  id: string
  code: string
  name: string
  lat: number
  lon: number
  elevation: number | null
  /** Kilometres from DWD station 01691. */
  distance: number
  status: string
  /** The site's split into cosmic and terrestrial share, as the BfS reports it. */
  cosmic: number | null
  terrestrial: number | null
  hours: number
  mean: number | null
  min: number | null
  max: number | null
  latest: { value: number; date: string; hour: number } | null
}

export interface OdlSeries {
  probe: string
  /** `at` is a UTC stamp — the BfS publishes this series in UTC. */
  points: { at: string; value: number }[]
}

export interface OdlDaily {
  probe: string
  date: string
  mean: number
  min: number
  max: number
  hours: number
}

export interface RadiationResponse {
  quantity: { key: string; label: string; short: string; unit: string; decimals: number; note: string }
  origin: { lat: number; lon: number; station: string }
  radiusKm: number
  range: { first: string | null; last: string | null; days: number }
  since: string | null
  probes: OdlProbe[]
  series: OdlSeries[]
  daily: OdlDaily[]
  windowNote: string
  hint?: string
}

/* -------------------------------------------------------------------------- */
/* Pollen                                                                     */
/* -------------------------------------------------------------------------- */

export interface PollenKind {
  key: string
  label: string
  order: number
}

export interface PollenLevel {
  value: string
  /** A rank over the DWD's seven steps, not a measurement — never averaged. */
  level: number
  label: string
}

export interface PollenHorizon {
  key: string
  label: string
  date: string
  value: string
  level: number | null
}

export interface PollenPoint {
  date: string
  value: string
  level: number | null
}

export interface PollenCalendarEntry {
  pollen: string
  label: string
  points: PollenPoint[]
  activeDays: number
  peak: PollenPoint | null
}

export interface PollenAccuracy {
  ready: boolean
  issues: number
  needed: number
  horizons: {
    offset: number
    label: string
    compared: number
    exact: number | null
    within: number | null
  }[]
}

export interface PollenResponse {
  region: string
  homePartregion: number
  partregions: number[]
  kinds: PollenKind[]
  levels: PollenLevel[]
  range: { first: string | null; last: string | null; issues: number }
  latest: {
    issued: string
    regions: {
      partregion: number
      home: boolean
      kinds: { pollen: string; label: string; order: number; horizons: PollenHorizon[] }[]
    }[]
  } | null
  calendar: PollenCalendarEntry[]
  accuracy: PollenAccuracy
  windowNote: string
  regionNote: string
  hint?: string
}

/* -------------------------------------------------------------------------- */
/* Phenology                                                                  */
/* -------------------------------------------------------------------------- */

export interface PhenoPoint {
  year: number
  /** Day of year, averaged over the stations that reported it. */
  day: number
  reports: number
  stations: number
  earliest?: number
  latest?: number
}

export interface PhenoSeason {
  key: string
  label: string
  order: number
  /** Why this season's definition needed a note, where it did. */
  note: string | null
  plants: { id: number; name: string }[]
  phase: { id: number; name: string }
  points: PhenoPoint[]
  first: number | null
  last: number | null
  years: number
}

export interface PhenoCalendarEntry {
  plant: number
  plantName: string
  phase: number
  phaseName: string
  years: number
  reports: number
  first: number
  last: number
  day: number
}

export interface PhenoStation {
  id: string
  name: string
  lat: number
  lon: number
  elevation: number | null
  distance: number
  landscape: string
  reports: number
  years: number
  first: number | null
  last: number | null
  plants: number
}

export interface PhenoTemperature {
  season: { key: string; label: string }
  dwdStation: string
  untilMonth: number
  monthsLabel: string
  points: { year: number; day: number; temp: number; stations: number }[]
}

export interface PhenologyResponse {
  origin: { lat: number; lon: number; station: string }
  radiusKm: number
  range: {
    first: number | null
    last: number | null
    reports: number
    stations: number
    plants: number
  }
  seasons: PhenoSeason[]
  calendar: PhenoCalendarEntry[]
  stations: PhenoStation[]
  temperature: PhenoTemperature | null
  minYears: number
  endedNote: string
  hint?: string
}

export interface PhenoSeriesResponse {
  plant: number
  plantName: string
  phase: number
  phaseName: string
  points: PhenoPoint[]
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export interface DashboardLatest {
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
  sunshine: number | null
  snow: number | null
  normal: {
    temp_mean: number
    temp_max: number
    temp_min: number
    precipitation: number
    days: number
  } | null
  anomaly: { temp_mean: number | null; temp_max: number | null; temp_min: number | null } | null
  /** `place` counts from the warm end: 1 is the warmest such calendar date ever. */
  rank: { place: number; of: number } | null
  reference: { from: number; to: number }
  windowDays: number
}

export interface DashboardYear {
  year: number
  upTo: string
  mean: number
  days: number
  referenceMean: number | null
  anomaly: number | null
  place: number
  of: number
  reference: { from: number; to: number }
}

export interface DashboardPick {
  key: string
  label: string
  short: string
  unit: string
  decimals: number
  station: string
  state: string
  elevation: number | null
  value: number
}

export interface DashboardResponse {
  station: { id: string; name: string; altitude: number | null }
  latest: DashboardLatest | null
  year: DashboardYear | null
  germany: {
    date: string
    stations: number | null
    highest: { name: string; elevation: number } | null
    picks: DashboardPick[]
  } | null
  records: {
    date: string
    count: number
    events: { station: string; name: string; kind: string; label: string; value: number }[]
  } | null
  today: {
    month: number
    day: number
    count: number
    firstYear: number | null
    lastYear: number | null
    meanOfDay: number | null
    holders: Partial<
      Record<
        'warmest' | 'coldest' | 'wettest' | 'windiest' | 'warmestMean' | 'coldestMean',
        { year: number; value: number } | null
      >
    >
  } | null
  environment: {
    pollen: {
      issued: string
      active: { label: string; value: string; level: number | null }[]
      total: number
    } | null
    air: {
      date: string
      hour: number
      values: {
        station: string
        stationName: string
        kind: string
        component: string
        short: string
        unit: string
        decimals: number
        value: number
      }[]
    } | null
    radiation: {
      probe: string
      distance: number
      value: number
      date: string
      hour: number
      mean: number | null
      days: number
    } | null
    gauges: {
      id: string
      name: string
      water: string
      value: number | null
      ts: string | null
      trend: string | null
      level: number | null
      mean: number | null
    }[]
  }
}

/* -------------------------------------------------------------------------- */
/* National standing                                                          */
/* -------------------------------------------------------------------------- */

export interface NationalFieldMeta {
  key: string
  label: string
  short: string
  unit: string
  decimals: number
  /** What the ends of the scale mean, for wording and axis labels. */
  high: string
  low: string
}

export interface NationalPoint {
  date: string
  value: number
  total: number
  /** 100 = highest in Germany that day, 0 = lowest. Ties share the middle. */
  percentile: number
  rank: number
}

export interface NationalSummary {
  days: number
  mean: number
  top: number
  bottom: number
  highest: NationalPoint
  lowest: NationalPoint
  monthly: { month: number; label: string; days: number; mean: number }[]
}

export interface NationalOverviewResponse {
  station: { id: string; name: string; altitude: number | null }
  range: { first: string | null; last: string | null; days: number }
  lowlandLimit: number
  minDaysPerMonth: number
  fields: { field: NationalFieldMeta; all: NationalSummary; lowland: NationalSummary }[]
}

export interface NationalFieldResponse {
  field: NationalFieldMeta
  range: { first: string | null; last: string | null; days: number }
  lowlandLimit: number
  all: { points: NationalPoint[]; summary: NationalSummary }
  lowland: { points: NationalPoint[]; summary: NationalSummary }
}

/* -------------------------------------------------------------------------- */
/* Air pressure                                                               */
/* -------------------------------------------------------------------------- */

export interface PressureBand {
  from: number
  to: number
  days: number
  mean: number
  max: number
}

export interface PressureExtreme {
  date: string
  pressure: number
  wind_max: number | null
}

export interface PressureResponse {
  range: { first: string; last: string; days: number; years: number }
  /** Always 'station': these readings are not reduced to sea level. */
  reduction: 'station'
  note: string
  tail: number
  minDaysPerYear: number
  minDaysPerBand: number
  monthly: { month: number; label: string; mean: number; min: number; max: number; days: number }[]
  annual: { year: number; mean: number; min: number; max: number; days: number; deep: number }[]
  extremes: { lowest: PressureExtreme[]; highest: PressureExtreme[] }
  wind: {
    days: number
    changeDays: number
    correlation: { pressure: number | null; change: number | null; magnitude: number | null }
    deep: {
      limit: number
      days: number
      meanGust: number | null
      otherDays: number
      otherMeanGust: number | null
    }
    fall: { limit: number | null; days: number; meanGust: number | null }
    byPressure: PressureBand[]
    byChange: PressureBand[]
  }
}

/* -------------------------------------------------------------------------- */
/* Late-frost risk                                                            */
/* -------------------------------------------------------------------------- */

export interface FrostPoint {
  year: number
  /** Day of year the growing season began, by the six-day 5 °C rule. */
  start: number
  startDate: string
  /** Day of year of the last frost between February and June. */
  frost: number
  frostDate: string | null
  frostTemp: number | null
  frostDays: number
  /** Days of exposure; negative means the frost came before growth began. */
  window: number
}

export interface FrostSummary {
  earlyYears: [number, number]
  lateYears: [number, number]
  earlyStart: number
  lateStart: number
  earlyFrost: number
  lateFrost: number
  earlyWindow: number
  lateWindow: number
  exposedYears: number
  exposedShare: number
  widest: FrostPoint
}

export interface FrostVariant {
  key: string
  label: string
  note: string
  /** Earliest day of year a vegetation start may have to count. */
  minStart: number
  range: { first: number; last: number; years: number }
  points: FrostPoint[]
  summary: FrostSummary
}

export interface FrostRiskResponse {
  station: string
  frostWindow: { from: number; to: number }
  base: number
  runLength: number
  variants: FrostVariant[]
}

/* -------------------------------------------------------------------------- */
/* Distribution shift                                                         */
/* -------------------------------------------------------------------------- */

export interface DistributionPeriod {
  key: string
  from: number
  to: number
  label: string
  days: number
  mean: number
  quantiles: { p: number; value: number }[]
  bands: { from: number; to: number; days: number; share: number }[]
}

export interface DistributionField {
  field: {
    key: string
    column: string
    label: string
    short: string
    unit: string
    width: number
    decimals: number
  }
  minDays: number
  periods: DistributionPeriod[]
  /** One aligned band list; each period's share under its own key. */
  bands: ({ from: number; to: number } & Record<string, number>)[]
  comparison: {
    from: string
    to: string
    meanChange: number
    quantileChange: { p: number; from: number | null; to: number | null; change: number | null }[]
    biggestGain: { from: number; to: number; change: number } | null
    biggestLoss: { from: number; to: number; change: number } | null
  }
}

export interface ThresholdShift {
  key: string
  label: string
  note: string
  value: number
  periods: { key: string; label: string; perYear: number; years: number }[]
  change: number
  /** The whole record, so a threshold that is simply rare reads as rare. */
  ever: { days: number; first: string | null; last: string | null }
}

export interface DistributionResponse {
  station: string
  periods: { key: string; from: number; to: number; label: string }[]
  minDays: number
  quantiles: number[]
  fields: DistributionField[]
  thresholds: ThresholdShift[]
}

/* -------------------------------------------------------------------------- */
/* The shape of a German day                                                  */
/* -------------------------------------------------------------------------- */

export interface NationwideStation {
  id: string
  name: string
  state: string
  elevation: number | null
}

export interface NationwideRange {
  days: number
  first: string | null
  last: string | null
  /** Days that clear the station threshold — the ones any figure rests on. */
  counted: number
  countedFrom: string | null
  /** First day of the daily archive; everything before it comes from the one-off pass. */
  cutoff: string | null
  minStations: number
  minForFit: number
}

export interface SpanDay {
  date: string
  stations: number
  source: string
  meanHi: number
  meanHiStation: NationwideStation
  meanLo: number
  meanLoStation: NationwideStation
  absHi: number
  absHiStation: NationwideStation
  absLo: number
  absLoStation: NationwideStation
  meanSpan: number
  absSpan: number
}

export interface SpanScope {
  key: string
  label: string
  note: string
  days: number
  annual: {
    year: number
    days: number
    meanSpan: number
    maxMeanSpan: number
    absSpan: number
    maxAbsSpan: number
    stations: number
  }[]
  monthly: {
    month: number
    label: string
    days: number
    meanSpan: number
    absSpan: number
    maxAbsSpan: number
  }[]
  top: { absolute: SpanDay[]; mean: SpanDay[]; narrow: SpanDay[] }
  /** Which stations hold each end of the span, and on how many days. */
  holders: {
    warm: (NationwideStation & { days: number })[]
    cold: (NationwideStation & { days: number })[]
  }
}

export interface SpanResponse {
  range: NationwideRange
  lowlandLimit: number
  minDaysPerYear: number
  top: number
  scopes: SpanScope[]
}

export interface DayShape {
  date: string
  stations: number
  source: string
  minStations: number
  /** False when the day rests on too few stations for any of this to be stated. */
  enough: boolean
  /** Naive regression of temperature on altitude alone, K per 100 m. */
  lapse: number | null
  lapseR2: number | null
  /** The same slope with position held constant — the honest one. */
  gradH: number | null
  gradN: number | null
  gradE: number | null
  gradR2: number | null
  absHi: number | null
  absHiStation: NationwideStation
  absLo: number | null
  absLoStation: NationwideStation
  meanHi: number | null
  meanHiStation: NationwideStation
  meanLo: number | null
  meanLoStation: NationwideStation
  lowAbsHi: number | null
  lowAbsHiStation: NationwideStation
  lowAbsLo: number | null
  lowAbsLoStation: NationwideStation
}

export interface LapseDay {
  date: string
  stations: number
  source: string
  lapse: number
  lapseR2: number
  gradH: number
  gradN: number
  gradE: number
  gradR2: number
  absHi: number | null
  absHiStation: NationwideStation
  absLo: number | null
  absLoStation: NationwideStation
}

export interface LapseResponse {
  range: NationwideRange
  minDaysPerYear: number
  binWidth: number
  top: number
  overall: {
    days: number
    lapse: number
    lapseR2: number
    gradH: number
    gradR2: number
    inversionDays: number
  }
  annual: {
    year: number
    days: number
    lapse: number
    lapseR2: number
    gradH: number
    gradR2: number
    inversionDays: number
    stations: number
  }[]
  monthly: {
    month: number
    label: string
    days: number
    lapse: number
    lapseR2: number
    gradH: number
    gradR2: number
    inversionDays: number
    inversionShare: number
  }[]
  histogram: { from: number; to: number; days: number; share: number }[]
  inversions: LapseDay[]
  steepest: LapseDay[]
}

export interface NationwideOverview {
  range: NationwideRange
  lowlandLimit: number
}

/** The direction in which it gets warmer, as a vector. */
export interface GradientDirection {
  magnitude: number
  bearing: number
  compass: string
}

export interface GradientDay extends GradientDirection {
  date: string
  stations: number
  source: string
  gradN: number
  gradE: number
  gradH: number
  gradR2: number
  absHi: number | null
  absHiStation: NationwideStation
  absLo: number | null
  absLoStation: NationwideStation
}

export interface GradientResponse {
  range: NationwideRange
  minDaysPerYear: number
  top: number
  overall: GradientDirection & {
    days: number
    gradN: number
    gradE: number
    gradH: number
    gradR2: number
    absN: number
    absE: number
  }
  annual: (GradientDirection & {
    year: number
    days: number
    gradN: number
    gradE: number
    gradR2: number
  })[]
  monthly: (GradientDirection & {
    month: number
    label: string
    days: number
    gradN: number
    gradE: number
    gradH: number
    gradR2: number
    eastWarmerDays: number
    northWarmerDays: number
    eastWarmerShare: number
    northWarmerShare: number
  })[]
  extremes: { key: string; label: string; note: string; days: GradientDay[] }[]
}

export interface ExtremeHolder extends NationwideStation {
  days: number
  share: number
  first: string
  last: string
  /** The most extreme value this station ever held the title with. */
  extreme: number | null
}

export interface ExtremeDecade {
  decade: number
  days: number
  station: NationwideStation
  topDays: number
  share: number
}

export interface ExtremeScope {
  total: number
  stations: ExtremeHolder[]
  decades: ExtremeDecade[]
}

export interface ExtremeKind {
  key: string
  label: string
  note: string
  unit: string
  /** False for the categories the archive keeps only once, without a height limit. */
  scoped: boolean
  direction: 'max' | 'min'
  scopes: Record<string, ExtremeScope>
}

export interface ExtremesResponse {
  range: NationwideRange
  lowlandLimit: number
  holders: number
  kinds: ExtremeKind[]
}

/* -------------------------------------------------------------------------- */
/* Record history                                                             */
/* -------------------------------------------------------------------------- */

export interface StandingRecord {
  value: number
  date: string
  year: number
  /** True when this value took the calendar day without beating anything. */
  seeded: boolean
  observations: number
  days: number
  years: number
  runnerUp: { value: number; date: string; margin: number } | null
}

export interface RecordAgeField {
  key: string
  label: string
  short: string
  unit: string
  decimals: number
  direction: 'max' | 'min'
  /** True for warm records, false for cold, null where the question makes no sense. */
  warm: boolean | null
  note: string | null
  days: number
  first: string
  allTime: StandingRecord
  monthly: (StandingRecord & { month: number; label: string })[]
  meanMonthlyAge: number | null
}

export interface RecordAgesResponse {
  station: string
  /** Ages are measured against this day, not the wall clock. */
  last: string
  fields: RecordAgeField[]
  summary: {
    warmAge: number | null
    coldAge: number | null
    warmFields: number
    coldFields: number
  }
}
