import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Layers } from 'lucide-react'

import { useApi } from '../lib/api'
import { signed, temp } from '../lib/format'
import type { ComparisonRecord } from '../types'
import {
  Card,
  CHART,
  ChartFrame,
  ChartTooltip,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
} from './ui'

const BASELINE = '1960 - 1990'

interface Row extends ComparisonRecord {
  anomaly: number | null
  isBaseline: boolean
}

export function Comparison({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const { data, loading, error, reload } = useApi<ComparisonRecord[]>(
    `/api/weather/comparisons?stationId=${encodeURIComponent(stationId)}`,
  )

  const baseline = useMemo(
    () => data?.find((r) => r.period === BASELINE)?.avg_temp ?? null,
    [data],
  )

  const rows = useMemo<Row[]>(
    () =>
      (data ?? []).map((r) => ({
        ...r,
        isBaseline: r.period === BASELINE,
        anomaly:
          r.avg_temp !== null && baseline !== null ? r.avg_temp - baseline : null,
      })),
    [data, baseline],
  )

  if (loading) return <Loading message="Berechne Normalperioden…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (rows.length === 0) return <EmptyState message="Keine Periodendaten vorhanden." />

  return (
    <>
      <InfoPanel icon={Layers} title="Klimatologische Referenzperioden">
        In der Klimatologie werden 30-jährige Normalperioden verwendet, um kurzfristige
        Schwankungen zu glätten. Als Basis dient hier die Periode{' '}
        <strong>{BASELINE.replace(' - ', '–')}</strong>. Der Vergleich mit jüngeren
        Perioden zeigt die Erwärmung an der Station {stationName}. Hinweis: Die Perioden
        sind beidseitig einschließend und umfassen daher 31 Jahre — die WMO-Normalperiode
        1961–1990 umfasst 30.
      </InfoPanel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.period}
            className={`relative overflow-hidden rounded-card border bg-raised p-4 ${
              r.isBaseline ? 'border-line-strong' : 'border-warm/25'
            }`}
          >
            <span
              className={`absolute inset-y-0 left-0 w-0.5 ${r.isBaseline ? 'bg-line-strong' : 'bg-warm'}`}
              aria-hidden
            />
            <p className="label">Periode</p>
            <h3 className="numeric mt-0.5 text-sm font-semibold text-ink">{r.period}</h3>
            <p className="numeric mt-3 text-2xl font-semibold tracking-tight text-ink">
              {temp(r.avg_temp, 2)}
            </p>
            <div className="mt-2">
              {r.isBaseline ? (
                <span className="rounded bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                  Referenzbasis
                </span>
              ) : r.anomaly !== null ? (
                <span
                  className={`numeric rounded px-2 py-0.5 text-[11px] font-semibold ${
                    r.anomaly >= 0 ? 'bg-warm/10 text-warm' : 'bg-cool/10 text-cool'
                  }`}
                >
                  {signed(r.anomaly, 2, '°C')}
                </span>
              ) : (
                <span className="text-[11px] text-ink-faint">Keine Daten</span>
              )}
            </div>
            <p className="numeric mt-3 text-[11px] text-ink-faint">
              {r.valid_years_count} validierte Jahre
            </p>
          </div>
        ))}
      </div>

      <Card>
        <SectionHeading title="Temperaturvergleich der Normalperioden" />
        <ChartFrame height={340}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 24, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="period" stroke={CHART.axis} tick={{ ...CHART.tick, fontSize: 10 }} tickLine={false} />
              <YAxis
                stroke={CHART.axis}
                tick={CHART.tick}
                tickLine={false}
                domain={[
                  (min: number) => Math.floor(min - 1),
                  (max: number) => Math.ceil(max + 0.5),
                ]}
                unit=" °C"
              />
              <Tooltip
                content={<ComparisonTooltip baseline={baseline} />}
                cursor={{ fill: CHART.cursorSoft }}
              />
              <Bar dataKey="avg_temp" radius={[3, 3, 0, 0]} maxBarSize={56}>
                <LabelList
                  dataKey="avg_temp"
                  position="top"
                  fill={CHART.tick.fill}
                  fontSize={11}
                  formatter={(v: unknown) =>
                    typeof v === 'number' ? temp(v, 2) : ''
                  }
                />
                {rows.map((r) => (
                  <Cell
                    key={r.period}
                    fill={r.isBaseline ? CHART.colors.neutral : CHART.colors.warm}
                    fillOpacity={r.isBaseline ? 0.5 : 0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Card>
    </>
  )
}

function ComparisonTooltip({
  active,
  payload,
  baseline,
}: {
  active?: boolean
  payload?: { payload: Row }[]
  baseline: number | null
}) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null

  const rows = [{ label: 'Ø Temperatur', value: temp(r.avg_temp, 2) }]
  if (!r.isBaseline && r.anomaly !== null) {
    rows.push({
      label: `Abweichung zu ${BASELINE}`,
      value: signed(r.anomaly, 2, '°C'),
    })
  }

  return (
    <ChartTooltip
      title={r.period}
      subtitle={r.isBaseline ? 'Referenzperiode' : undefined}
      rows={rows}
      footer={
        baseline !== null && !r.isBaseline
          ? `Basis ${temp(baseline, 2)} · ${r.valid_years_count} validierte Jahre`
          : `${r.valid_years_count} validierte Jahre`
      }
    />
  )
}
