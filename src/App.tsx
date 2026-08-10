import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  CalendarHeart,
  CalendarRange,
  CloudRain,
  Flag,
  Flame,
  Fingerprint,
  Flower2,
  Gauge,
  Grid3x3,
  Hourglass,
  LineChart,
  Landmark,
  LayoutDashboard,
  Newspaper,
  Layers,
  Leaf,
  Map,
  MapPin,
  Scale,
  Snowflake,
  SlidersHorizontal,
  Sprout,
  Umbrella,
  Radio,
  Waves,
  Wind,
  ListOrdered,
  Sparkles,
  Table2,
  Thermometer,
  TrendingUp,
  Trophy,
} from 'lucide-react'

import { apiGet } from './lib/api'
import { readParam, setTabParam, useUrlNumber, useUrlState } from './lib/url-state'
import type { ImportStatus, Station } from './types'
import { Header } from './components/Header'
import { SystemBar } from './components/SystemBar'
import { Loading } from './components/ui'
import { Dashboard } from './components/Dashboard'

/* -------------------------------------------------------------------------- */
/* Lazily loaded views                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Every view except the one the app opens on is fetched when it is first
 * shown. Twenty-eight views in one bundle meant that reading the monthly table
 * also downloaded the Germany map, the phenology charts and the air-quality
 * analyses — and two thirds of that weight is the chart library, which ten of
 * the views never touch.
 *
 * The loaders are named rather than inlined into `lazy()` so the same function
 * can be called again on hover: the download then starts before the click
 * lands, and on a fast connection the chunk has arrived before the pointer
 * stops moving. `lazy(LOAD.X)` still infers X's props, which an untyped
 * registry would have thrown away.
 */
const LOAD = {
  MonthlyView: () =>
    import('./components/MonthlyView').then((m) => ({ default: m.MonthlyView })),
  TempTrend: () => import('./components/TempTrend').then((m) => ({ default: m.TempTrend })),
  PrecipTrend: () => import('./components/PrecipTrend').then((m) => ({ default: m.PrecipTrend })),
  AnnualMeans: () => import('./components/AnnualMeans').then((m) => ({ default: m.AnnualMeans })),
  Heatmap: () => import('./components/Heatmap').then((m) => ({ default: m.Heatmap })),
  Extremes: () => import('./components/Extremes').then((m) => ({ default: m.Extremes })),
  ExtremeMonths: () => import('./components/ExtremeMonths').then((m) => ({ default: m.ExtremeMonths })),
  ClimateDiagram: () => import('./components/ClimateDiagram').then((m) => ({ default: m.ClimateDiagram })),
  Comparison: () => import('./components/Comparison').then((m) => ({ default: m.Comparison })),
  YtdTemp: () => import('./components/YtdTemp').then((m) => ({ default: m.YtdTemp })),
  AnnualOverview: () => import('./components/AnnualOverview').then((m) => ({ default: m.AnnualOverview })),
  Forecast: () => import('./components/Forecast').then((m) => ({ default: m.Forecast })),
  Periods: () => import('./components/Periods').then((m) => ({ default: m.Periods })),
  Vegetation: () => import('./components/Vegetation').then((m) => ({ default: m.Vegetation })),
  Seasons: () => import('./components/Seasons').then((m) => ({ default: m.Seasons })),
  RecordBalance: () => import('./components/RecordBalance').then((m) => ({ default: m.RecordBalance })),
  PrecipIntensity: () => import('./components/PrecipIntensity').then((m) => ({ default: m.PrecipIntensity })),
  DayInHistory: () => import('./components/DayInHistory').then((m) => ({ default: m.DayInHistory })),
  Rivers: () => import('./components/Rivers').then((m) => ({ default: m.Rivers })),
  Soil: () => import('./components/Soil').then((m) => ({ default: m.Soil })),
  Germany: () => import('./components/Germany').then((m) => ({ default: m.Germany })),
  GermanyMap: () => import('./components/GermanyMap').then((m) => ({ default: m.GermanyMap })),
  Indices: () => import('./components/Indices').then((m) => ({ default: m.Indices })),
  Notable: () => import('./components/Notable').then((m) => ({ default: m.Notable })),
  Records: () => import('./components/Records').then((m) => ({ default: m.Records })),
  Air: () => import('./components/Air').then((m) => ({ default: m.Air })),
  Radiation: () => import('./components/Radiation').then((m) => ({ default: m.Radiation })),
  Pollen: () => import('./components/Pollen').then((m) => ({ default: m.Pollen })),
  Phenology: () => import('./components/Phenology').then((m) => ({ default: m.Phenology })),
  Regional: () => import('./components/Regional').then((m) => ({ default: m.Regional })),
  Pressure: () => import('./components/Pressure').then((m) => ({ default: m.Pressure })),
  FrostRisk: () => import('./components/FrostRisk').then((m) => ({ default: m.FrostRisk })),
  Distribution: () =>
    import('./components/Distribution').then((m) => ({ default: m.Distribution })),
  Nationwide: () =>
    import('./components/Nationwide').then((m) => ({ default: m.Nationwide })),
  RecordHistory: () =>
    import('./components/RecordHistory').then((m) => ({ default: m.RecordHistory })),
  Twins: () => import('./components/Twins').then((m) => ({ default: m.Twins })),
  Retrospect: () => import('./components/Retrospect').then((m) => ({ default: m.Retrospect })),
  National: () =>
    import('./components/National').then((m) => ({ default: m.National })),
  Newsroom: () => import('./components/Newsroom').then((m) => ({ default: m.Newsroom })),
}

const MonthlyView = lazy(LOAD.MonthlyView)
const TempTrend = lazy(LOAD.TempTrend)
const PrecipTrend = lazy(LOAD.PrecipTrend)
const AnnualMeans = lazy(LOAD.AnnualMeans)
const Heatmap = lazy(LOAD.Heatmap)
const Extremes = lazy(LOAD.Extremes)
const ExtremeMonths = lazy(LOAD.ExtremeMonths)
const ClimateDiagram = lazy(LOAD.ClimateDiagram)
const Comparison = lazy(LOAD.Comparison)
const YtdTemp = lazy(LOAD.YtdTemp)
const AnnualOverview = lazy(LOAD.AnnualOverview)
const Forecast = lazy(LOAD.Forecast)
const Periods = lazy(LOAD.Periods)
const Vegetation = lazy(LOAD.Vegetation)
const Seasons = lazy(LOAD.Seasons)
const RecordBalance = lazy(LOAD.RecordBalance)
const PrecipIntensity = lazy(LOAD.PrecipIntensity)
const DayInHistory = lazy(LOAD.DayInHistory)
const Rivers = lazy(LOAD.Rivers)
const Soil = lazy(LOAD.Soil)
const Germany = lazy(LOAD.Germany)
const GermanyMap = lazy(LOAD.GermanyMap)
const Indices = lazy(LOAD.Indices)
const Notable = lazy(LOAD.Notable)
const Records = lazy(LOAD.Records)
const Air = lazy(LOAD.Air)
const Radiation = lazy(LOAD.Radiation)
const Pollen = lazy(LOAD.Pollen)
const Phenology = lazy(LOAD.Phenology)
const Regional = lazy(LOAD.Regional)
const National = lazy(LOAD.National)
const Pressure = lazy(LOAD.Pressure)
const FrostRisk = lazy(LOAD.FrostRisk)
const Distribution = lazy(LOAD.Distribution)
const Nationwide = lazy(LOAD.Nationwide)
const RecordHistory = lazy(LOAD.RecordHistory)
const Twins = lazy(LOAD.Twins)
const Retrospect = lazy(LOAD.Retrospect)
const Newsroom = lazy(LOAD.Newsroom)

/**
 * Which module a tab renders.
 *
 * Spelled out rather than derived from the tab id: 'overview' renders
 * MonthlyView and 'climate' renders ClimateDiagram, so any rule that turned
 * one into the other would be a rule with exceptions. The opening view is
 * absent because it is imported eagerly — preloading what is already there
 * would be a wasted request.
 */
const TAB_MODULE: Record<string, string> = {
  newsroom: 'Newsroom',
  overview: 'MonthlyView',
  'annual-overview': 'AnnualOverview',
  'day-in-history': 'DayInHistory',
  'temp-trend': 'TempTrend',
  'precip-trend': 'PrecipTrend',
  'annual-means': 'AnnualMeans',
  'ytd-temp': 'YtdTemp',
  'seasons': 'Seasons',
  'vegetation': 'Vegetation',
  'precip-intensity': 'PrecipIntensity',
  'indices': 'Indices',
  'pressure': 'Pressure',
  'frost-risk': 'FrostRisk',
  'distribution': 'Distribution',
  'nationwide': 'Nationwide',
  'record-history': 'RecordHistory',
  'twins': 'Twins',
  // The tab id predates the sub-navigation that now sits inside it; renaming it
  // would break every link that was shared while it was the yearbook alone.
  'yearbook': 'Retrospect',
  'heatmap': 'Heatmap',
  'extremes': 'Extremes',
  'extreme-months': 'ExtremeMonths',
  // The tab id predates the sub-navigation that now sits inside it.
  'spells': 'Periods',
  'record-balance': 'RecordBalance',
  'climate': 'ClimateDiagram',
  'comparison': 'Comparison',
  'forecast': 'Forecast',
  'gauges': 'Rivers',
  'soil': 'Soil',
  'air': 'Air',
  'radiation': 'Radiation',
  'pollen': 'Pollen',
  'phenology': 'Phenology',
  'germany': 'Germany',
  'germany-map': 'GermanyMap',
  'records': 'Records',
  'notable': 'Notable',
  'regional': 'Regional',
  'national': 'National',
}

/** Start a view's download without rendering it. */
function preload(tab: string) {
  const load = (LOAD as Record<string, undefined | (() => Promise<unknown>)>)[TAB_MODULE[tab] ?? '']
  void load?.()
}

const FALLBACK_STATIONS: Station[] = [
  { id: '01691', name: 'Göttingen', altitude: 167 },
  { id: '00722', name: 'Brocken', altitude: 1141 },
  { id: '05792', name: 'Zugspitze', altitude: 2964 },
]

type TabId =
  | 'dashboard'
  | 'newsroom'
  | 'overview'
  | 'temp-trend'
  | 'precip-trend'
  | 'annual-means'
  | 'heatmap'
  | 'extremes'
  | 'extreme-months'
  | 'climate'
  | 'comparison'
  | 'ytd-temp'
  | 'annual-overview'
  | 'forecast'
  | 'spells'
  | 'vegetation'
  | 'seasons'
  | 'record-balance'
  | 'precip-intensity'
  | 'indices'
  | 'pressure'
  | 'frost-risk'
  | 'distribution'
  | 'day-in-history'
  | 'gauges'
  | 'soil'
  | 'air'
  | 'radiation'
  | 'pollen'
  | 'phenology'
  | 'germany'
  | 'germany-map'
  | 'records'
  | 'notable'
  | 'regional'
  | 'national'
  | 'nationwide'
  | 'record-history'
  | 'twins'
  | 'yearbook'

interface TabDef {
  id: TabId
  label: string
  icon: typeof Thermometer
  group:
    | 'Überblick'
    | 'Messwerte'
    | 'Trends'
    | 'Rekorde'
    | 'Klimatologie'
    | 'Umwelt'
    | 'Deutschland'
}

const TABS: TabDef[] = [
  { id: 'dashboard', label: 'Überblick', icon: LayoutDashboard, group: 'Überblick' },
  { id: 'newsroom', label: 'Newsroom', icon: Newspaper, group: 'Überblick' },
  { id: 'overview', label: 'Monatsübersicht', icon: CalendarDays, group: 'Messwerte' },
  { id: 'annual-overview', label: 'Jahresübersicht', icon: Table2, group: 'Messwerte' },
  { id: 'day-in-history', label: 'Dieser Tag', icon: CalendarHeart, group: 'Messwerte' },
  { id: 'twins', label: 'Wetterzwillinge', icon: Fingerprint, group: 'Messwerte' },
  { id: 'yearbook', label: 'Rückblick & Kurioses', icon: Sparkles, group: 'Messwerte' },
  { id: 'temp-trend', label: 'Temperaturtrend', icon: TrendingUp, group: 'Trends' },
  { id: 'precip-trend', label: 'Niederschlagstrend', icon: CloudRain, group: 'Trends' },
  { id: 'annual-means', label: 'Jahresmittelwerte', icon: LineChart, group: 'Trends' },
  { id: 'ytd-temp', label: 'Mitteltemp. YTD', icon: Gauge, group: 'Trends' },
  { id: 'seasons', label: 'Jahreszeiten', icon: Snowflake, group: 'Trends' },
  { id: 'vegetation', label: 'Vegetationsperiode', icon: Leaf, group: 'Trends' },
  { id: 'frost-risk', label: 'Spätfrostrisiko', icon: AlertTriangle, group: 'Trends' },
  { id: 'precip-intensity', label: 'Starkregenanteil', icon: Umbrella, group: 'Trends' },
  { id: 'indices', label: 'Weitere Kenngrößen', icon: Snowflake, group: 'Trends' },
  { id: 'pressure', label: 'Luftdruck', icon: Gauge, group: 'Trends' },
  { id: 'distribution', label: 'Verteilungsverschiebung', icon: SlidersHorizontal, group: 'Trends' },
  { id: 'heatmap', label: 'Monats-Heatmap', icon: Grid3x3, group: 'Rekorde' },
  { id: 'extremes', label: 'Spitzenwerte', icon: Flame, group: 'Rekorde' },
  { id: 'extreme-months', label: 'Spitzenmonate', icon: ListOrdered, group: 'Rekorde' },
  { id: 'spells', label: 'Perioden & Episoden', icon: CalendarRange, group: 'Rekorde' },
  { id: 'record-balance', label: 'Rekordbilanz', icon: Scale, group: 'Rekorde' },
  { id: 'record-history', label: 'Rekordgeschichte', icon: Hourglass, group: 'Rekorde' },
  { id: 'climate', label: 'Klimadiagramm', icon: BarChart3, group: 'Klimatologie' },
  { id: 'comparison', label: 'Referenzperioden', icon: Layers, group: 'Klimatologie' },
  { id: 'forecast', label: 'Prognose', icon: Sparkles, group: 'Klimatologie' },
  { id: 'gauges', label: 'Flusspegel', icon: Waves, group: 'Umwelt' },
  { id: 'soil', label: 'Boden', icon: Layers, group: 'Umwelt' },
  { id: 'air', label: 'Luftqualität', icon: Wind, group: 'Umwelt' },
  { id: 'radiation', label: 'Ortsdosisleistung', icon: Radio, group: 'Umwelt' },
  { id: 'pollen', label: 'Pollenflug', icon: Flower2, group: 'Umwelt' },
  { id: 'phenology', label: 'Phänologie', icon: Sprout, group: 'Umwelt' },
  { id: 'germany', label: 'Deutschland gestern', icon: Map, group: 'Deutschland' },
  { id: 'germany-map', label: 'Karte', icon: MapPin, group: 'Deutschland' },
  { id: 'nationwide', label: 'Deutschlandtage', icon: ArrowLeftRight, group: 'Deutschland' },
  { id: 'records', label: 'Allzeitrekorde', icon: Trophy, group: 'Deutschland' },
  { id: 'notable', label: 'Markante Tage', icon: Sparkles, group: 'Deutschland' },
  { id: 'regional', label: 'Bundesländer', icon: Landmark, group: 'Deutschland' },
  { id: 'national', label: 'Bundesvergleich', icon: Flag, group: 'Deutschland' },
]

const GROUPS = [
  'Überblick',
  'Messwerte',
  'Trends',
  'Rekorde',
  'Klimatologie',
  'Umwelt',
  'Deutschland',
] as const

const TAB_IDS = TABS.map((t) => t.id)

const STORAGE_KEY = 'selected_station_id'

/**
 * Which station to open on.
 *
 * The URL wins where it says something — a link has to land where it points,
 * whatever the recipient looked at last. Otherwise the remembered choice, then
 * the first station.
 *
 * localStorage throws in private-mode Safari and in sandboxed iframes; the
 * original app read it unguarded during useState initialisation, which took the
 * whole app down with a white screen.
 */
function initialStation(): string {
  const fromUrl = readParam('station')
  if (fromUrl) return fromUrl
  try {
    return localStorage.getItem(STORAGE_KEY) ?? FALLBACK_STATIONS[0]!.id
  } catch {
    return FALLBACK_STATIONS[0]!.id
  }
}

export default function App() {
  const [stations, setStations] = useState<Station[]>(FALLBACK_STATIONS)
  const [stationId, setStationId] = useUrlState<string>('station', initialStation())
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [tab] = useUrlState<TabId>('bereich', 'dashboard', { allowed: TAB_IDS })

  const now = new Date()
  const [selectedYear, setSelectedYear] = useUrlNumber('jahr', now.getFullYear(), {
    min: 1700,
    max: 2200,
  })
  const [selectedMonth, setSelectedMonth] = useUrlNumber('monat', now.getMonth() + 1, {
    min: 1,
    max: 12,
  })

  // A tab change pushes a history entry and clears the previous tab's own
  // parameters — see `setTabParam`, which also notifies every mounted
  // `useUrlState`, so no second write is needed to move the view.
  const setTab = useCallback((next: TabId) => setTabParam(next), [])

  const station = useMemo(
    () => stations.find((s) => s.id === stationId),
    [stations, stationId],
  )

  const refreshStatus = useCallback(async () => {
    try {
      const result = await apiGet<ImportStatus>(
        `/api/status?stationId=${encodeURIComponent(stationId)}`,
      )
      setStatus(result)
      return result
    } catch (err) {
      console.error('Status konnte nicht geladen werden:', err)
      return null
    }
  }, [stationId])

  useEffect(() => {
    let cancelled = false
    apiGet<Station[]>('/api/stations')
      .then((list) => {
        if (cancelled || !Array.isArray(list)) return
        setStations(
          list.map((s) => ({
            id: s.id,
            name: s.name,
            // The API sends altitude as "167 m"; keep parsing tolerant.
            altitude:
              typeof s.altitude === 'number'
                ? s.altitude
                : parseInt(String(s.altitude), 10) || 0,
          })),
        )
      })
      .catch((err) => console.error('Stationen konnten nicht geladen werden:', err))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Poll while an import runs. The original created the interval inside an
  // effect that also read `status`, so each poll re-ran the effect and leaked
  // a new interval every 3 seconds.
  useEffect(() => {
    if (!status?.importInProgress) return
    const id = setInterval(() => void refreshStatus(), 3000)
    return () => clearInterval(id)
  }, [status?.importInProgress, refreshStatus])

  const changeStation = useCallback((id: string) => {
    setStationId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* storage unavailable — selection stays for this session only */
    }
  }, [setStationId])

  const navigateToMonth = useCallback((year: number, month: number) => {
    setSelectedYear(year)
    setSelectedMonth(month)
    setTab('overview')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [setSelectedYear, setSelectedMonth, setTab])

  const stationName = station?.name ?? 'Station'
  const isEmpty = status !== null && status.rowCount === 0

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <Header
          status={status}
          stations={stations}
          stationId={stationId}
          onStationChange={changeStation}
          onImported={refreshStatus}
        />

        <SystemBar />

        {isEmpty && (
          <div className="mt-6 rounded-card border border-brand/30 bg-brand/[0.06] p-5">
            <h2 className="text-sm font-semibold text-brand">
              Für {stationName} sind noch keine Daten importiert
            </h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-muted">
              Klicke oben auf <strong className="text-ink">Synchronisieren</strong>, um
              die historischen und tagesaktuellen Messreihen vom DWD Open-Data-Server
              zu laden. Der erste Import dauert je nach Station einige Sekunden.
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Desktop: persistent grouped sidebar. The original rendered all
              twelve sections as a wrapping row of pill buttons that reflowed
              into three ragged lines and gave no sense of structure. */}
          <nav
            aria-label="Analysebereiche"
            className="hidden w-56 shrink-0 lg:block lg:sticky lg:top-6"
          >
            {GROUPS.map((group) => (
              <div key={group} className="mb-5 last:mb-0">
                <p className="label mb-1.5 px-2">{group}</p>
                <ul className="space-y-0.5">
                  {TABS.filter((t) => t.group === group).map((t) => {
                    const active = t.id === tab
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          aria-current={active ? 'page' : undefined}
                          onClick={() => setTab(t.id)}
                          onMouseEnter={() => preload(t.id)}
                          onFocus={() => preload(t.id)}
                          className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                            active
                              ? 'bg-brand/15 text-brand'
                              : 'text-ink-muted hover:bg-raised hover:text-ink'
                          }`}
                        >
                          <t.icon className="size-4 shrink-0" aria-hidden />
                          <span className="truncate">{t.label}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* Mobile / tablet: a horizontally scrollable strip keeps the nav to
              one line instead of consuming a third of the viewport. */}
          <nav
            aria-label="Analysebereiche"
            className="-mx-4 overflow-x-auto px-4 lg:hidden"
          >
            <ul className="flex w-max gap-1.5 pb-1">
              {TABS.map((t) => {
                const active = t.id === tab
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setTab(t.id)}
                      onTouchStart={() => preload(t.id)}
                      onFocus={() => preload(t.id)}
                      className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                        active
                          ? 'bg-brand text-canvas'
                          : 'border border-line bg-surface text-ink-muted'
                      }`}
                    >
                      <t.icon className="size-3.5" aria-hidden />
                      {t.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          <main className="min-w-0 flex-1 space-y-6">
            {/* One boundary for all views: only ever one is mounted, so a
                boundary per view would be twenty-eight copies of the same
                fallback. */}
            <Suspense fallback={<Loading message="Ansicht wird geladen …" />}>
            {tab === 'dashboard' && <Dashboard stationName={stationName} />}
            {tab === 'newsroom' && (
              <Newsroom stationId={stationId} stationName={stationName} />
            )}
            {tab === 'overview' && (
              <MonthlyView
                stationId={stationId}
                stationName={stationName}
                year={selectedYear}
                month={selectedMonth}
                onYearChange={setSelectedYear}
                onMonthChange={setSelectedMonth}
                maxYear={status?.maxDate ? Number(status.maxDate.slice(0, 4)) : now.getFullYear()}
                minYear={status?.minDate ? Number(status.minDate.slice(0, 4)) : 1858}
              />
            )}
            {tab === 'temp-trend' && (
              <TempTrend stationId={stationId} stationName={stationName} />
            )}
            {tab === 'precip-trend' && (
              <PrecipTrend stationId={stationId} stationName={stationName} />
            )}
            {tab === 'annual-means' && (
              <AnnualMeans stationId={stationId} stationName={stationName} />
            )}
            {tab === 'heatmap' && <Heatmap stationId={stationId} />}
            {tab === 'extremes' && (
              <Extremes
                stationId={stationId}
                stationName={stationName}
                onNavigateToMonth={navigateToMonth}
              />
            )}
            {tab === 'extreme-months' && (
              <ExtremeMonths
                stationId={stationId}
                stationName={stationName}
                onNavigateToMonth={navigateToMonth}
              />
            )}
            {tab === 'climate' && (
              <ClimateDiagram stationId={stationId} stationName={stationName} />
            )}
            {tab === 'comparison' && (
              <Comparison stationId={stationId} stationName={stationName} />
            )}
            {tab === 'ytd-temp' && <YtdTemp stationId={stationId} />}
            {tab === 'annual-overview' && <AnnualOverview stationId={stationId} />}
            {tab === 'day-in-history' && (
              <DayInHistory stationId={stationId} stationName={stationName} />
            )}
            {tab === 'seasons' && (
              <Seasons stationId={stationId} stationName={stationName} />
            )}
            {tab === 'precip-intensity' && (
              <PrecipIntensity stationId={stationId} stationName={stationName} />
            )}
            {tab === 'record-balance' && (
              <RecordBalance stationId={stationId} stationName={stationName} />
            )}
            {tab === 'vegetation' && (
              <Vegetation stationId={stationId} stationName={stationName} />
            )}
            {tab === 'spells' && (
              <Periods stationId={stationId} stationName={stationName} />
            )}
            {tab === 'forecast' && <Forecast stationId={stationId} />}
            {tab === 'indices' && <Indices stationId={stationId} />}
            {tab === 'pressure' && (
              <Pressure stationId={stationId} stationName={stationName} />
            )}
            {tab === 'frost-risk' && (
              <FrostRisk stationId={stationId} stationName={stationName} />
            )}
            {tab === 'distribution' && (
              <Distribution stationId={stationId} stationName={stationName} />
            )}

            {tab === 'gauges' && <Rivers />}

            {tab === 'soil' && <Soil />}

            {tab === 'air' && <Air />}

            {tab === 'radiation' && <Radiation />}

            {tab === 'pollen' && <Pollen />}

            {tab === 'phenology' && <Phenology />}

            {tab === 'germany' && <Germany />}

            {tab === 'germany-map' && <GermanyMap />}

            {tab === 'twins' && <Twins stationId={stationId} stationName={stationName} />}

            {tab === 'yearbook' && (
              <Retrospect stationId={stationId} stationName={stationName} />
            )}

            {tab === 'record-history' && (
              <RecordHistory stationId={stationId} stationName={stationName} />
            )}

            {tab === 'nationwide' && <Nationwide />}

            {tab === 'records' && <Records />}

            {tab === 'notable' && <Notable />}

            {tab === 'regional' && <Regional />}

            {tab === 'national' && <National />}
            </Suspense>
          </main>
        </div>

        <footer className="mt-12 rounded-card border border-line bg-surface px-5 py-4">
          <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
            <p className="text-[11px] text-ink-faint">
              Datenquelle:{' '}
              <a
                href="https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/"
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink-muted underline decoration-line-strong underline-offset-2 hover:text-brand"
              >
                DWD Climate Data Center
              </a>{' '}
              — Tageswerte, frei verwendbar unter GeoNutzV.
            </p>
            <p className="numeric text-[11px] text-ink-faint">
              {stationName} · Station {stationId} · {station?.altitude ?? '—'} m ü. NHN
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
