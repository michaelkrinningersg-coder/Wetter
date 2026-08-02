import { useMemo } from 'react'
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
import { CloudRain, Droplets, Filter, Sun } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { centeredMovingAverage, extremeBy, linearFit, mean } from '../lib/stats'
import { coverage, mm, num, signed } from '../lib/format'
import type { PrecipTrendRecord } from '../types'
import {
  Card,
  CHART,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'
import { DataQuality } from './DataQuality'

const PERIODS = [
  { value: '30', label: 'Letzte 30 Jahre' },
  { value: '50', label: 'Letzte 50 Jahre' },
  { value: '100', label: 'Letzte 100 Jahre' },
  { value: 'all', label: 'Gesamte Messreihe' },
] as const

type Period = (typeof PERIODS)[number]['value']

interface Point {
  year: number
  precip: number
  completePrecip: number | null
  incompletePrecip: number | null
  isIncomplete: boolean
  validDays: number
  totalDays: number
  trend: number | null
  trendBand: [number, number] | null
  smooth: number | null
}

const SMOOTH_WINDOW = 30

export function PrecipTrend({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [period, setPeriod] = useUrlState<Period>('zeitraum', '100')
  const { data, loading, error, reload } = useApi<PrecipTrendRecord[]>(
    `/api/weather/trends/precip?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data ?? [], [data])

  const points = useMemo<Point[]>(() => {
    if (records.length === 0) return []

    const latestYear = Math.max(...records.map((r) => r.year))
    const cutoff = period === 'all' ? -Infinity : latestYear - Number(period) + 1

    const rows = records
      .filter((r) => r.year >= cutoff)
      .map<Point>((r) => {
        const value = Number(r.sum_precipitation.toFixed(1))
        return {
          year: r.year,
          precip: value,
          completePrecip: r.isIncomplete ? null : value,
          incompletePrecip: r.isIncomplete ? value : null,
          isIncomplete: r.isIncomplete === true,
          validDays: r.valid_days,
          totalDays: r.total_days,
          trend: null,
          trendBand: null,
          smooth: null,
        }
      })

    const fit = linearFit(
      rows.filter((r) => !r.isIncomplete).map((r) => ({ x: r.year, y: r.precip })),
    )

    // Computed over the unfiltered series so narrowing the period does not
    // eat the first and last 15 years of the curve.
    const smoothed = centeredMovingAverage(
      records
        .filter((r) => !r.isIncomplete)
        .map((r) => ({ x: r.year, y: r.sum_precipitation })),
      SMOOTH_WINDOW,
    )

    return rows.map((r) => {
      const centre = fit ? fit.at(r.year) : null
      const halfWidth = fit ? fit.confidenceAt(r.year) : 0
      return {
        ...r,
        trend: centre === null ? null : Number(centre.toFixed(1)),
        trendBand:
          centre === null
            ? null
            : ([
                Number((centre - halfWidth).toFixed(1)),
                Number((centre + halfWidth).toFixed(1)),
              ] as [number, number]),
        smooth: smoothed.has(r.year) ? Number(smoothed.get(r.year)!.toFixed(1)) : null,
      }
    })
  }, [records, period])

  const fitStats = useMemo(() => {
    const complete = points
      .filter((p) => !p.isIncomplete)
      .map((p) => ({ x: p.year, y: p.precip }))
    const fit = linearFit(complete)
    if (!fit) return null
    return {
      perDecade: fit.slope * 10,
      perDecadeError: fit.slopeError * 10,
      r2: fit.r2,
      isSignificant: fit.isSignificant,
    }
  }, [points])

  const summary = useMemo(() => {
    const complete = points.filter((p) => !p.isIncomplete)
    if (complete.length === 0) return null

    const first = complete[0]
    const last = complete[complete.length - 1]
    return {
      average: mean(complete.map((p) => p.precip)),
      wettest: extremeBy(complete, (p) => p.precip, 'max'),
      driest: extremeBy(complete, (p) => p.precip, 'min'),
      trendDiff:
        first?.trend != null && last?.trend != null ? last.trend - first.trend : null,
      years: complete.length,
    }
  }, [points])

  if (loading) return <Loading message="Berechne Niederschlagstrends…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <Card>
        <SectionHeading
          icon={Filter}
          title="Zeitraum der Trendanalyse"
          hint="Jahressummen des Niederschlags. Unvollständige Jahre werden getrennt dargestellt und fließen nicht in die Regression ein."
          actions={
            <ChoiceGroup
              label="Zeitraum"
              value={period}
              choices={PERIODS}
              onChange={setPeriod}
            />
          }
        />
      </Card>

      {points.length === 0 ? (
        <EmptyState message="Für diesen Zeitraum liegen keine ausreichenden Niederschlagsdaten vor." />
      ) : (
        <>
          {summary && (
            <StatGrid>
              <StatTile
                label="Ø Jahresniederschlag"
                value={mm(summary.average, 1)}
                caption={`Über ${summary.years} vollständige Jahre`}
                accent="brand"
              />
              <StatTile
                label="Nassestes Jahr"
                value={mm(summary.wettest?.precip)}
                caption={summary.wettest ? `Gemessen ${summary.wettest.year}` : undefined}
                accent="wet"
                icon={Droplets}
              />
              <StatTile
                label="Trockenstes Jahr"
                value={mm(summary.driest?.precip)}
                caption={summary.driest ? `Gemessen ${summary.driest.year}` : undefined}
                accent="dry"
                icon={Sun}
              />
              <StatTile
                label="Trend je Jahrzehnt"
                value={signed(fitStats?.perDecade, 1, 'mm')}
                caption={
                  fitStats
                    ? `± ${num(fitStats.perDecadeError, 1)} · R² ${num(fitStats.r2, 2)} · ${
                        fitStats.isSignificant
                          ? 'statistisch signifikant (95 %)'
                          : 'nicht signifikant (95 %)'
                      }`
                    : undefined
                }
                accent={fitStats && fitStats.perDecade >= 0 ? 'wet' : 'dry'}
                icon={CloudRain}
              />
            </StatGrid>
          )}

          <Card>
            <SectionHeading
              title={`Jährliche Niederschlagssumme ${stationName}`}
              hint={`Die durchgezogene Linie ist das gleitende ${SMOOTH_WINDOW}-Jahres-Mittel. Es ist zentriert und endet daher ${SMOOTH_WINDOW / 2} Jahre vor dem Reihenende. Niederschlag schwankt von Jahr zu Jahr stark — erst die Glättung macht sichtbar, ob sich überhaupt etwas verschiebt.`}
            />
            <ChartFrame height={400}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
                  <YAxis
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    domain={[
                      (min: number) => Math.max(0, Math.floor((min - 50) / 50) * 50),
                      (max: number) => Math.ceil((max + 50) / 50) * 50,
                    ]}
                    unit=" mm"
                  />
                  <Tooltip content={<PrecipTooltip />} cursor={{ fill: CHART.cursorSoft }} />
                  <Legend verticalAlign="top" height={32} iconType="square" wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    name="Jahressumme (vollständig)"
                    dataKey="completePrecip"
                    fill={CHART.colors.wet}
                    fillOpacity={0.55}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={40}
                  />
                  <Bar
                    name="Laufendes Jahr (unvollständig)"
                    dataKey="incompletePrecip"
                    fill={CHART.colors.accent}
                    fillOpacity={0.7}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={40}
                  />
                  <Area
                    name="95 %-Konfidenzband des Trends"
                    type="monotone"
                    dataKey="trendBand"
                    stroke="none"
                    fill={CHART.colors.brand}
                    fillOpacity={0.14}
                  />
                  <Line
                    name="Trend (linear)"
                    type="monotone"
                    dataKey="trend"
                    stroke={CHART.colors.brand}
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    dot={false}
                  />
                  <Line
                    name={`Gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel`}
                    type="monotone"
                    dataKey="smooth"
                    stroke={CHART.colors.brand}
                    strokeWidth={3}
                    dot={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          <DataQuality stationId={stationId} />

          <Card>
            <SectionHeading title={`Jahressummen (${points.length} Jahre)`} />
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky-head">
                  <tr className="border-b border-line">
                    <th scope="col" className="label px-3 py-2.5">Jahr</th>
                    <th scope="col" className="label px-3 py-2.5">Jahressumme</th>
                    <th scope="col" className="label px-3 py-2.5">Trendwert</th>
                    <th scope="col" className="label px-3 py-2.5">Datenabdeckung</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {points
                    .slice()
                    .reverse()
                    .map((p) => (
                      <tr key={p.year} className="transition-colors hover:bg-raised">
                        <td className="numeric px-3 py-2 font-semibold text-ink">
                          {p.year}
                          {p.isIncomplete && (
                            <span className="ml-2 rounded border border-line-strong px-1 py-0.5 text-[9px] font-medium uppercase text-ink-faint">
                              laufend
                            </span>
                          )}
                        </td>
                        <td
                          className={`numeric px-3 py-2 font-semibold ${p.isIncomplete ? 'text-ink-muted' : 'text-wet'}`}
                        >
                          {mm(p.precip)}
                        </td>
                        <td className="numeric px-3 py-2 text-brand-dim">{mm(p.trend)}</td>
                        <td className="numeric px-3 py-2 text-ink-faint">
                          {coverage(p.validDays, p.totalDays)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}

function PrecipTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { payload: Point }[]
  label?: string | number
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <ChartTooltip
      title={`Jahr ${label}`}
      subtitle={point.isIncomplete ? 'Laufendes Jahr — unvollständig' : undefined}
      rows={[
        { label: 'Jahressumme', value: mm(point.precip), className: 'text-wet' },
        { label: 'Trendwert (linear)', value: mm(point.trend), className: 'text-brand' },
        ...(point.smooth !== null
          ? [
              {
                label: `${SMOOTH_WINDOW}-Jahres-Mittel`,
                value: mm(point.smooth),
                className: 'text-brand',
              },
            ]
          : []),
      ]}
      footer={`Datenabdeckung ${coverage(point.validDays, point.totalDays)}`}
    />
  )
}
