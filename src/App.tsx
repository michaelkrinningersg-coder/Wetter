import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  CalendarHeart,
  CalendarRange,
  CloudRain,
  Flame,
  Gauge,
  Grid3x3,
  LineChart,
  Layers,
  Leaf,
  Scale,
  Snowflake,
  Umbrella,
  ListOrdered,
  Sparkles,
  Table2,
  Thermometer,
  TrendingUp,
} from 'lucide-react'

import { apiGet } from './lib/api'
import type { ImportStatus, Station } from './types'
import { Header } from './components/Header'
import { MonthlyOverview } from './components/MonthlyOverview'
import { TempTrend } from './components/TempTrend'
import { PrecipTrend } from './components/PrecipTrend'
import { AnnualMeans } from './components/AnnualMeans'
import { Heatmap } from './components/Heatmap'
import { Extremes } from './components/Extremes'
import { ExtremeMonths } from './components/ExtremeMonths'
import { ClimateDiagram } from './components/ClimateDiagram'
import { Comparison } from './components/Comparison'
import { YtdTemp } from './components/YtdTemp'
import { AnnualOverview } from './components/AnnualOverview'
import { Forecast } from './components/Forecast'
import { Spells } from './components/Spells'
import { Vegetation } from './components/Vegetation'
import { Seasons } from './components/Seasons'
import { RecordBalance } from './components/RecordBalance'
import { PrecipIntensity } from './components/PrecipIntensity'
import { DayInHistory } from './components/DayInHistory'

const FALLBACK_STATIONS: Station[] = [
  { id: '01691', name: 'Göttingen', altitude: 167 },
  { id: '00722', name: 'Brocken', altitude: 1141 },
  { id: '05792', name: 'Zugspitze', altitude: 2964 },
]

type TabId =
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
  | 'day-in-history'

interface TabDef {
  id: TabId
  label: string
  icon: typeof Thermometer
  group: 'Messwerte' | 'Trends' | 'Rekorde' | 'Klimatologie'
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Monatsübersicht', icon: CalendarDays, group: 'Messwerte' },
  { id: 'annual-overview', label: 'Jahresübersicht', icon: Table2, group: 'Messwerte' },
  { id: 'day-in-history', label: 'Dieser Tag', icon: CalendarHeart, group: 'Messwerte' },
  { id: 'temp-trend', label: 'Temperaturtrend', icon: TrendingUp, group: 'Trends' },
  { id: 'precip-trend', label: 'Niederschlagstrend', icon: CloudRain, group: 'Trends' },
  { id: 'annual-means', label: 'Jahresmittelwerte', icon: LineChart, group: 'Trends' },
  { id: 'ytd-temp', label: 'Mitteltemp. YTD', icon: Gauge, group: 'Trends' },
  { id: 'seasons', label: 'Jahreszeiten', icon: Snowflake, group: 'Trends' },
  { id: 'vegetation', label: 'Vegetationsperiode', icon: Leaf, group: 'Trends' },
  { id: 'precip-intensity', label: 'Starkregenanteil', icon: Umbrella, group: 'Trends' },
  { id: 'heatmap', label: 'Monats-Heatmap', icon: Grid3x3, group: 'Rekorde' },
  { id: 'extremes', label: 'Spitzenwerte', icon: Flame, group: 'Rekorde' },
  { id: 'extreme-months', label: 'Spitzenmonate', icon: ListOrdered, group: 'Rekorde' },
  { id: 'spells', label: 'Perioden & Serien', icon: CalendarRange, group: 'Rekorde' },
  { id: 'record-balance', label: 'Rekordbilanz', icon: Scale, group: 'Rekorde' },
  { id: 'climate', label: 'Klimadiagramm', icon: BarChart3, group: 'Klimatologie' },
  { id: 'comparison', label: 'Referenzperioden', icon: Layers, group: 'Klimatologie' },
  { id: 'forecast', label: 'Prognose', icon: Sparkles, group: 'Klimatologie' },
]

const GROUPS = ['Messwerte', 'Trends', 'Rekorde', 'Klimatologie'] as const

const STORAGE_KEY = 'selected_station_id'

function readStoredStation(): string {
  // localStorage throws in private-mode Safari and in sandboxed iframes; the
  // original app read it unguarded during useState initialisation, which took
  // the whole app down with a white screen.
  try {
    return localStorage.getItem(STORAGE_KEY) ?? FALLBACK_STATIONS[0]!.id
  } catch {
    return FALLBACK_STATIONS[0]!.id
  }
}

export default function App() {
  const [stations, setStations] = useState<Station[]>(FALLBACK_STATIONS)
  const [stationId, setStationId] = useState<string>(readStoredStation)
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [tab, setTab] = useState<TabId>('overview')

  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)

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
  }, [])

  const navigateToMonth = useCallback((year: number, month: number) => {
    setSelectedYear(year)
    setSelectedMonth(month)
    setTab('overview')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

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
            {tab === 'overview' && (
              <MonthlyOverview
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
              <Spells stationId={stationId} stationName={stationName} />
            )}
            {tab === 'forecast' && <Forecast stationId={stationId} />}
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
