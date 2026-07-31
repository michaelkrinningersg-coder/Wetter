import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CloudRain, Sparkles, Thermometer, TrendingDown, TrendingUp } from 'lucide-react'

import { useApi } from '../lib/api'
import { mm, num, signed, temp } from '../lib/format'
import type { ForecastMonth, ForecastResponse, YtdTrajectoryPoint } from '../types'
import {
  Card,
  CHART,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
} from './ui'

const VIEWS = [
  { value: 'temp', label: 'Temperatur' },
  { value: 'precip', label: 'Niederschlag' },
  { value: 'ytd', label: 'Ø-Verlauf (YTD)' },
] as const

type View = (typeof VIEWS)[number]['value']

export function Forecast({ stationId }: { stationId: string }) {
  const [view, setView] = useState<View>('temp')

  const { data, loading, error, reload } = useApi<ForecastResponse>(
    `/api/weather/forecast?stationId=${encodeURIComponent(stationId)}`,
  )

  const monthly = useMemo(
    () =>
      (data?.monthlyData ?? []).map((m) => ({
        ...m,
        name: m.monthName,
        // Split each series so observed months render solid and forecast
        // months render as the projection, with one shared month bridging.
        observedTemp: m.isFullyObserved || m.isPartiallyObserved ? (m.observedTemp ?? m.forecastTemp) : null,
        projectedTemp: m.isFullyForecasted || m.isPartiallyObserved ? m.forecastTemp : null,
        observedPrecip: m.isFullyObserved || m.isPartiallyObserved ? (m.observedPrecip ?? m.forecastPrecip) : null,
        projectedPrecip: m.isFullyForecasted || m.isPartiallyObserved ? m.forecastPrecip : null,
      })),
    [data],
  )

  if (loading) return <Loading message="Berechne Prognose-Modelle…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <ErrorState message="Keine Prognosedaten verfügbar." onRetry={reload} />

  const tempWarmer = data.tempDifference >= 0
  const precipWetter = data.precipDifference >= 0
  const observedShare = (data.observedDaysCount / 365) * 100
  const remainingShare = (data.remainingDaysCount / 365) * 100

  return (
    <>
      <InfoPanel icon={Sparkles} title={`Klimatologische Jahresprognose ${data.runningYear}`}>
        Gemessen sind die DWD-Werte bis zum <strong>{data.cutOffDateStr}</strong> (
        {data.observedDaysCount} Tage). Für die verbleibenden{' '}
        {data.remainingDaysCount} Tage wird das Jahr{' '}
        <strong>{data.ensembleSize}-mal zu Ende gerechnet</strong> — je einmal so, wie
        der Rest des Jahres in jedem Jahr von {data.ensembleFrom} bis {data.ensembleTo}
        {' '}tatsächlich verlaufen ist. Angegeben ist der Median dieser{' '}
        {data.ensembleSize} Ergebnisse; der wahrscheinliche Bereich umfasst das 10. bis
        90. Perzentil. Das ist eine Klimatologie-Fortschreibung, keine Wettervorhersage.
      </InfoPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="label flex items-center gap-1.5">
                <Thermometer className="size-3.5 text-brand" aria-hidden />
                Jahresmitteltemperatur {data.runningYear}
              </p>
              <div className="mt-1.5 flex items-baseline gap-2.5">
                <span className="numeric text-3xl font-semibold tracking-tight text-ink">
                  {temp(data.forecastTempP50, 1)}
                </span>
                <span
                  className={`numeric flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${
                    tempWarmer ? 'bg-warm/10 text-warm' : 'bg-cold/10 text-cold'
                  }`}
                >
                  {tempWarmer ? (
                    <TrendingUp className="size-3.5" aria-hidden />
                  ) : (
                    <TrendingDown className="size-3.5" aria-hidden />
                  )}
                  {signed(data.tempDifference, 2, '°C')}
                </span>
              </div>
            </div>
          </div>

          <p className="numeric mt-1.5 text-[11px] text-ink-muted">
            Wahrscheinlicher Bereich{' '}
            <span className="font-semibold text-ink">
              {temp(data.forecastTempP10, 1)} – {temp(data.forecastTempP90, 1)}
            </span>
          </p>
          <Spread
            p10={data.forecastTempP10}
            p50={data.forecastTempP50}
            p90={data.forecastTempP90}
            reference={data.baselineTempAvg}
            format={(v) => temp(v, 1)}
            accent="bg-warm"
          />

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-3 text-xs">
            <div>
              <p className="label">Klimareferenz (30 J.)</p>
              <p className="numeric mt-0.5 font-semibold text-ink">
                {temp(data.baselineTempAvg, 2)}
              </p>
            </div>
            <div>
              <p className="label">Bisher gemessen (YTD)</p>
              <p className="numeric mt-0.5 font-semibold text-brand">
                {temp(data.observedTempAvg, 2)}
              </p>
            </div>
          </div>

          <Progress
            observed={observedShare}
            remaining={remainingShare}
            observedLabel={`${data.observedDaysCount} Tage gemessen`}
            remainingLabel={`${data.remainingDaysCount} Tage projiziert`}
            observedClass="bg-brand"
            remainingClass="bg-brand/25"
          />
        </Card>

        <Card>
          <div>
            <p className="label flex items-center gap-1.5">
              <CloudRain className="size-3.5 text-wet" aria-hidden />
              Jahresniederschlag {data.runningYear}
            </p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-2.5">
              <span className="numeric text-3xl font-semibold tracking-tight text-ink">
                {mm(data.forecastPrecipP50, 0)}
              </span>
              <span
                className={`numeric flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${
                  precipWetter ? 'bg-wet/10 text-wet' : 'bg-dry/10 text-dry'
                }`}
              >
                {precipWetter ? (
                  <TrendingUp className="size-3.5" aria-hidden />
                ) : (
                  <TrendingDown className="size-3.5" aria-hidden />
                )}
                {signed(data.precipDifference, 1, 'mm')} (
                {signed(data.precipDifferencePercent, 1, '%')})
              </span>
            </div>
          </div>

          <p className="numeric mt-1.5 text-[11px] text-ink-muted">
            Wahrscheinlicher Bereich{' '}
            <span className="font-semibold text-ink">
              {mm(data.forecastPrecipP10, 0)} – {mm(data.forecastPrecipP90, 0)}
            </span>
          </p>
          <Spread
            p10={data.forecastPrecipP10}
            p50={data.forecastPrecipP50}
            p90={data.forecastPrecipP90}
            reference={data.baselinePrecipSum}
            format={(v) => mm(v, 0)}
            accent="bg-wet"
          />

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-3 text-xs">
            <div>
              <p className="label">Klimareferenz (30 J.)</p>
              <p className="numeric mt-0.5 font-semibold text-ink">
                {mm(data.baselinePrecipSum)}
              </p>
            </div>
            <div>
              <p className="label">Bisher gemessen (YTD)</p>
              <p className="numeric mt-0.5 font-semibold text-wet">
                {mm(data.observedPrecipSum)}
              </p>
            </div>
          </div>

          <Progress
            observed={observedShare}
            remaining={remainingShare}
            observedLabel={`${num(data.observedPrecipSum, 0)} mm gemessen`}
            remainingLabel={`${num(data.remainingForecastPrecipSum, 0)} mm projiziert`}
            observedClass="bg-wet"
            remainingClass="bg-wet/25"
          />
        </Card>
      </div>

      <Card>
        <SectionHeading
          title="Monatlicher Verlauf im Vergleich"
          hint="Gemessene und projizierte Monate gegenüber dem 30-jährigen Mittel."
          actions={
            <ChoiceGroup label="Ansicht" value={view} choices={VIEWS} onChange={setView} size="sm" />
          }
        />

        <ChartFrame height={340}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              // Two different row shapes share one chart; Recharts' generic
              // data prop cannot express that union.
              data={
                (view === 'ytd'
                  ? data.ytdTrajectoryData
                  : monthly) as unknown as Record<string, unknown>[]
              }
              margin={{ top: 8, right: 8, left: -18, bottom: 4 }}
            >
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey={view === 'ytd' ? 'dateLabel' : 'name'}
                stroke={CHART.axis}
                tick={{ ...CHART.tick, fontSize: 10 }}
                tickLine={false}
              />
              <YAxis
                stroke={CHART.axis}
                tick={CHART.tick}
                tickLine={false}
                unit={view === 'precip' ? ' mm' : ' °C'}
              />
              <Tooltip
                content={<ForecastTooltip view={view} runningYear={data.runningYear} />}
                cursor={{ fill: 'oklch(100% 0 0 / 0.03)' }}
              />
              <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 10 }} />

              {view === 'ytd' && (
                <>
                  <Area
                    name="Bandbreite aller 30 Szenarien"
                    type="monotone"
                    // Range area: Recharts accepts a [low, high] key pair at
                    // runtime, but its types only declare the scalar form.
                    dataKey={['ytdTempMin', 'ytdTempMax'] as unknown as string}
                    stroke="none"
                    fill={CHART.colors.warm}
                    fillOpacity={0.07}
                  />
                  <Area
                    name="Wahrscheinlicher Bereich (10.–90. Perzentil)"
                    type="monotone"
                    dataKey={['ytdTempP10', 'ytdTempP90'] as unknown as string}
                    stroke="none"
                    fill={CHART.colors.warm}
                    fillOpacity={0.18}
                  />
                  <Line
                    name="Mittel 1968–1997"
                    type="monotone"
                    dataKey="baseline1968YtdTemp"
                    stroke={CHART.colors.cold}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    name="Mittel letzte 30 Jahre"
                    type="monotone"
                    dataKey="baseline30YrYtdTemp"
                    stroke={CHART.colors.neutral}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    name={`Verlauf ${data.runningYear}`}
                    type="monotone"
                    dataKey="runningYtdTemp"
                    stroke={CHART.colors.brand}
                    strokeWidth={2.5}
                    dot={false}
                  />
                </>
              )}

              {view === 'temp' && (
                <>
                  <Line
                    name="30-jähriges Mittel"
                    type="monotone"
                    dataKey="baselineTemp"
                    stroke={CHART.colors.neutral}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                  <Line
                    name="Projiziert"
                    type="monotone"
                    dataKey="projectedTemp"
                    stroke={CHART.colors.hot}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    connectNulls
                    dot={{ r: 3 }}
                  />
                  <Line
                    name="Gemessen"
                    type="monotone"
                    dataKey="observedTemp"
                    stroke={CHART.colors.warm}
                    strokeWidth={2.5}
                    connectNulls
                    dot={{ r: 3 }}
                  />
                </>
              )}

              {view === 'precip' && (
                <>
                  <Bar
                    name="Gemessen"
                    dataKey="observedPrecip"
                    fill={CHART.colors.wet}
                    fillOpacity={0.6}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    name="Projiziert"
                    dataKey="projectedPrecip"
                    fill={CHART.colors.wet}
                    fillOpacity={0.22}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={28}
                  />
                  <Line
                    name="30-jähriges Mittel"
                    type="monotone"
                    dataKey="baselinePrecip"
                    stroke={CHART.colors.neutral}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>

        <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          <p>
            <strong className="text-ink-muted">Ø-Verlauf (YTD)</strong> zeigt die
            kumulierte Durchschnittstemperatur vom 1. Januar bis zum jeweiligen Stichtag.
            Künftige Abschnitte sind mit dem 30-jährigen Mittel fortgeschrieben.
          </p>
          <p>
            Das <strong className="text-ink-muted">Unsicherheitsband</strong> spannt auf,
            wo das Jahr landen würde, wenn der Rest exakt dem wärmsten bzw. kältesten
            Einzeljahr der letzten 30 Jahre entspräche.
          </p>
        </div>
      </Card>
    </>
  )
}

/**
 * Ensemble spread: the 10–90 % band, the median marker and where the 30-year
 * climate reference falls inside it. Communicates at a glance whether the year
 * is clearly off-normal or whether normal is still well within reach.
 */
function Spread({
  p10,
  p50,
  p90,
  reference,
  format,
  accent,
}: {
  p10: number
  p50: number
  p90: number
  reference: number
  format: (value: number) => string
  accent: string
}) {
  const lo = Math.min(p10, reference)
  const hi = Math.max(p90, reference)
  const span = hi - lo || 1
  const at = (value: number) => ((value - lo) / span) * 100

  return (
    <div className="mt-3">
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-2 h-1 rounded-full bg-inset" />
        <div
          className={`absolute top-2 h-1 rounded-full ${accent} opacity-40`}
          style={{ left: `${at(p10)}%`, width: `${at(p90) - at(p10)}%` }}
        />
        <div
          className={`absolute top-0.5 size-3 -translate-x-1/2 rounded-full ${accent}`}
          style={{ left: `${at(p50)}%` }}
          title={`Median ${format(p50)}`}
        />
        <div
          className="absolute top-0 h-5 w-px -translate-x-1/2 bg-ink"
          style={{ left: `${at(reference)}%` }}
          title={`Klimareferenz ${format(reference)}`}
        />
      </div>
      {/* The reference caption sits under its own tick, not centred, so the
          label always points at the mark it describes. */}
      <div className="relative mt-0.5 h-3.5">
        <span className="numeric absolute left-0 text-[10px] text-ink-faint">
          {format(p10)}
        </span>
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-ink-muted"
          style={{ left: `${Math.min(88, Math.max(12, at(reference)))}%` }}
        >
          Referenz
        </span>
        <span className="numeric absolute right-0 text-[10px] text-ink-faint">
          {format(p90)}
        </span>
      </div>
    </div>
  )
}

function Progress({
  observed,
  remaining,
  observedLabel,
  remainingLabel,
  observedClass,
  remainingClass,
}: {
  observed: number
  remaining: number
  observedLabel: string
  remainingLabel: string
  observedClass: string
  remainingClass: string
}) {
  return (
    <div className="mt-4">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-inset">
        <div className={observedClass} style={{ width: `${observed}%` }} />
        <div className={remainingClass} style={{ width: `${remaining}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
        <span>{observedLabel}</span>
        <span>{remainingLabel}</span>
      </div>
    </div>
  )
}

function ForecastTooltip({
  active,
  payload,
  view,
  runningYear,
}: {
  active?: boolean
  payload?: { payload: (ForecastMonth & { name: string }) | YtdTrajectoryPoint }[]
  view: View
  runningYear: number
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  if (view === 'ytd') {
    const p = point as YtdTrajectoryPoint
    return (
      <ChartTooltip
        title={`Stand ${p.dateLabel} ${runningYear}`}
        subtitle={p.isForecast ? 'Mit Prognose fortgeschrieben' : 'Gemessenes Ist'}
        rows={[
          { label: `Verlauf ${runningYear}`, value: temp(p.runningYtdTemp, 2), className: 'text-brand' },
          { label: 'Mittel letzte 30 J.', value: temp(p.baseline30YrYtdTemp, 2) },
          { label: 'Mittel 1968–1997', value: temp(p.baseline1968YtdTemp, 2) },
          {
            label: 'Abw. zu 30 J.',
            value: signed(p.runningYtdTemp - p.baseline30YrYtdTemp, 2, '°C'),
            className: p.runningYtdTemp >= p.baseline30YrYtdTemp ? 'text-warm' : 'text-cold',
          },
        ]}
        footer={
          p.isForecast
            ? `Wahrscheinlicher Bereich ${temp(p.ytdTempP10, 2)} – ${temp(p.ytdTempP90, 2)} · gesamte Spanne ${temp(p.ytdTempMin, 2)} – ${temp(p.ytdTempMax, 2)}`
            : undefined
        }
      />
    )
  }

  const m = point as ForecastMonth & { name: string }
  const status = m.isFullyForecasted
    ? 'Klimamittel (Prognose)'
    : m.isPartiallyObserved
      ? 'Teilweise gemessen (blended)'
      : 'Gemessen'

  if (view === 'precip') {
    return (
      <ChartTooltip
        title={`${m.name} ${runningYear}`}
        subtitle={status}
        rows={[
          { label: 'Wert', value: mm(m.forecastPrecip), className: 'text-wet' },
          { label: '30-J. Mittel', value: mm(m.baselinePrecip) },
          {
            label: 'Abweichung',
            value: signed(m.forecastPrecip - m.baselinePrecip, 1, 'mm'),
            className: m.forecastPrecip >= m.baselinePrecip ? 'text-wet' : 'text-dry',
          },
        ]}
      />
    )
  }

  return (
    <ChartTooltip
      title={`${m.name} ${runningYear}`}
      subtitle={status}
      rows={[
        { label: 'Wert', value: temp(m.forecastTemp), className: 'text-warm' },
        { label: '30-J. Mittel', value: temp(m.baselineTemp) },
        {
          label: 'Abweichung',
          value: signed(m.forecastTemp - m.baselineTemp, 1, '°C'),
          className: m.forecastTemp >= m.baselineTemp ? 'text-warm' : 'text-cold',
        },
        { label: 'YTD inkl. Prognose', value: temp(m.ytdTempRunning, 2), className: 'text-brand' },
      ]}
    />
  )
}
