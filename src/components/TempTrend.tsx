import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Filter, Snowflake, Sun, TrendingUp } from 'lucide-react'

import { useApi } from '../lib/api'
import { extremeBy, linearFit, mean } from '../lib/stats'
import { coverage, signed, temp } from '../lib/format'
import type { TempTrendRecord } from '../types'
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

const PERIODS = [
  { value: '30', label: 'Letzte 30 Jahre' },
  { value: '50', label: 'Letzte 50 Jahre' },
  { value: '100', label: 'Letzte 100 Jahre' },
  { value: 'all', label: 'Gesamte Messreihe' },
] as const

type Period = (typeof PERIODS)[number]['value']

interface Point {
  year: number
  temp: number
  completeTemp: number | null
  incompleteTemp: number | null
  isIncomplete: boolean
  validDays: number
  totalDays: number
  trend: number | null
}

export function TempTrend({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [period, setPeriod] = useState<Period>('100')
  const { data, loading, error, reload } = useApi<TempTrendRecord[]>(
    `/api/weather/trends/temp?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data ?? [], [data])

  const points = useMemo<Point[]>(() => {
    if (records.length === 0) return []

    // Anchor the window to the newest year in the data, not to the wall clock.
    // The original used `new Date().getFullYear()`, so a station whose import
    // was months stale silently showed fewer years than the label promised.
    const latestYear = Math.max(...records.map((r) => r.year))
    const cutoff =
      period === 'all' ? -Infinity : latestYear - Number(period) + 1

    const rows = records
      .filter((r) => r.year >= cutoff)
      .map<Point>((r) => {
        const value = Number(r.avg_temp.toFixed(2))
        return {
          year: r.year,
          temp: value,
          completeTemp: r.isIncomplete ? null : value,
          incompleteTemp: r.isIncomplete ? value : null,
          isIncomplete: r.isIncomplete === true,
          validDays: r.valid_days,
          totalDays: r.total_days,
          trend: null,
        }
      })

    // Bridge the dashed "running year" segment back to the last complete year
    // so the two series visually connect.
    const firstIncomplete = rows.findIndex((r) => r.isIncomplete)
    if (firstIncomplete > 0) {
      const previous = rows[firstIncomplete - 1]
      if (previous) previous.incompleteTemp = previous.temp
    }

    const fit = linearFit(
      rows.filter((r) => !r.isIncomplete).map((r) => ({ x: r.year, y: r.temp })),
    )
    if (!fit) return rows

    return rows.map((r) => ({ ...r, trend: Number(fit.at(r.year).toFixed(2)) }))
  }, [records, period])

  const summary = useMemo(() => {
    const complete = points.filter((p) => !p.isIncomplete)
    if (complete.length === 0) return null

    const warmest = extremeBy(complete, (p) => p.temp, 'max')
    const coldest = extremeBy(complete, (p) => p.temp, 'min')
    const first = complete[0]
    const last = complete[complete.length - 1]
    const warming =
      first?.trend !== null && first?.trend !== undefined && last?.trend != null
        ? last.trend - first.trend
        : null

    return {
      average: mean(complete.map((p) => p.temp)),
      warmest,
      coldest,
      warming,
      years: complete.length,
    }
  }, [points])

  if (loading) return <Loading message="Berechne Temperaturtrends…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <Card>
        <SectionHeading
          icon={Filter}
          title="Zeitraum der Trendanalyse"
          hint="Die lineare Regression wird ausschließlich über vollständige Jahre gerechnet. Das laufende Jahr wird separat ausgewiesen und fließt nicht in den Trend ein."
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
        <EmptyState message="Für diesen Zeitraum liegen keine ausreichenden Trenddaten vor." />
      ) : (
        <>
          {summary && (
            <StatGrid>
              <StatTile
                label="Mittel im Zeitraum"
                value={temp(summary.average, 2)}
                caption={`Über ${summary.years} vollständige Jahre`}
                accent="brand"
              />
              <StatTile
                label="Wärmstes Jahr"
                value={temp(summary.warmest?.temp, 2)}
                caption={summary.warmest ? `Gemessen ${summary.warmest.year}` : undefined}
                accent="warm"
                icon={Sun}
              />
              <StatTile
                label="Kältestes Jahr"
                value={temp(summary.coldest?.temp, 2)}
                caption={summary.coldest ? `Gemessen ${summary.coldest.year}` : undefined}
                accent="cold"
                icon={Snowflake}
              />
              <StatTile
                label="Erwärmung im Zeitraum"
                value={signed(summary.warming, 2, '°C')}
                caption="Anstieg der linearen Trendgeraden"
                accent={summary.warming !== null && summary.warming >= 0 ? 'warm' : 'cold'}
                icon={TrendingUp}
              />
            </StatGrid>
          )}

          <Card>
            <SectionHeading
              title={`Jahresmitteltemperatur ${stationName}`}
              hint="Graue Linie: gemessene Jahresmittel. Gestrichelt: laufendes Jahr inklusive Klimaprognose. Gelb: lineare Trendgerade."
            />
            <ChartFrame height={400}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
                  <YAxis
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    domain={['dataMin - 0.5', 'dataMax + 0.5']}
                    unit=" °C"
                  />
                  <Tooltip content={<TrendTooltip />} />
                  <Legend verticalAlign="top" height={32} iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    name="Jahresmittel (vollständig)"
                    type="monotone"
                    dataKey="completeTemp"
                    stroke={CHART.colors.neutral}
                    strokeWidth={1.5}
                    dot={{ r: 1.8, fill: CHART.colors.neutral, stroke: 'none' }}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                  />
                  <Line
                    name="Laufendes Jahr (inkl. Prognose)"
                    type="monotone"
                    dataKey="incompleteTemp"
                    stroke={CHART.colors.accent}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    connectNulls
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    name="Trend (linear)"
                    type="monotone"
                    dataKey="trend"
                    stroke={CHART.colors.brand}
                    strokeWidth={2.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          <Card>
            <SectionHeading
              title={`Jahreswerte (${points.length} Jahre)`}
              hint="Gelistet werden nur Jahre, für die mindestens 90 % aller Tage geprüfte Messwerte enthalten — analog zur DWD-Praxis für Jahresmittel."
            />
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky-head">
                  <tr className="border-b border-line">
                    <th scope="col" className="label px-3 py-2.5">Jahr</th>
                    <th scope="col" className="label px-3 py-2.5">Jahresmittel</th>
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
                          className={`numeric px-3 py-2 font-semibold ${p.isIncomplete ? 'text-ink-muted' : 'text-ink'}`}
                        >
                          {temp(p.temp, 2)}
                        </td>
                        <td className="numeric px-3 py-2 text-brand-dim">
                          {temp(p.trend, 2)}
                        </td>
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

function TrendTooltip({
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
      subtitle={point.isIncomplete ? 'Laufendes Jahr — YTD + Prognose' : undefined}
      rows={[
        {
          label: 'Ø Temperatur',
          value: temp(point.temp, 2),
          className: point.isIncomplete ? 'text-[oklch(74%_0.17_340)]' : 'text-ink',
        },
        { label: 'Trendwert', value: temp(point.trend, 2), className: 'text-brand' },
      ]}
      footer={`Datenabdeckung ${coverage(point.validDays, point.totalDays)}`}
    />
  )
}
