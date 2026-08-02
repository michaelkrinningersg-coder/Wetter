import { useMemo } from 'react'
import {
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
import { BarChart3 } from 'lucide-react'

import { useApi } from '../lib/api'
import { MONTHS_SHORT, mm, monthName, temp } from '../lib/format'
import type { ClimateDiagramRecord } from '../types'
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

interface Row {
  month: number
  short: string
  full: string
  temp: number
  precip: number
  /** Walter–Lieth: a month is humid while precipitation stays above 2×T. */
  humid: boolean
}

export function ClimateDiagram({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const { data, loading, error, reload } = useApi<ClimateDiagramRecord[]>(
    `/api/weather/climate-diagram?stationId=${encodeURIComponent(stationId)}`,
  )

  const rows = useMemo<Row[]>(
    () =>
      (data ?? []).map((r) => ({
        month: r.month,
        short: MONTHS_SHORT[r.month - 1] ?? String(r.month),
        full: monthName(r.month),
        temp: Number(r.avg_temp.toFixed(1)),
        precip: Number(r.avg_precipitation.toFixed(1)),
        humid: r.avg_precipitation > 2 * r.avg_temp,
      })),
    [data],
  )

  const allHumid = rows.length > 0 && rows.every((r) => r.humid)

  if (loading) return <Loading message="Berechne monatliche Klimamittelwerte…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (rows.length === 0) return <EmptyState message="Keine Klimadiagrammdaten verfügbar." />

  return (
    <>
      <InfoPanel icon={BarChart3} title={`Klimadiagramm nach Walter & Lieth — ${stationName}`}>
        Langfristige Monatsmittel aus allen Jahren, die die 90-%-Qualitätsregel für
        Temperatur und Niederschlag erfüllen. Die Achsen stehen im Verhältnis{' '}
        <strong>1 °C : 2 mm</strong>; solange die Niederschlagskurve über der
        Temperaturkurve liegt, ist der Monat humid.{' '}
        {allHumid ? (
          <>
            An dieser Station ist <strong>jeder Monat humid</strong> — das Klima ist
            vollhumid.
          </>
        ) : (
          <>
            Aride Monate (Niederschlag unter der Temperaturkurve) sind in der Tabelle
            markiert.
          </>
        )}
      </InfoPanel>

      <Card>
        <SectionHeading title="Monatliche Klimamittel" />
        <ChartFrame height={420}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 4, left: -12, bottom: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="short" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
              {/* Left axis = temperature, right axis = 2x that range, which is
                  what makes the Walter–Lieth reading rule valid. The original
                  hard-coded [-5, 25] and [0, 120]; on the Zugspitze (mean below
                  -4 °C) that clipped the curve straight off the chart. */}
              <YAxis
                yAxisId="temp"
                stroke={CHART.colors.warm}
                tick={CHART.tick}
                tickLine={false}
                unit=" °C"
                domain={[
                  (min: number) => Math.floor(Math.min(min, 0) / 5) * 5,
                  (max: number) => Math.ceil(max / 5) * 5,
                ]}
              />
              <YAxis
                yAxisId="precip"
                orientation="right"
                stroke={CHART.colors.wet}
                tick={CHART.tick}
                tickLine={false}
                unit=" mm"
                domain={[
                  (min: number) => Math.floor(Math.min(min, 0) / 10) * 10 * 2,
                  (max: number) => Math.ceil(max / 10) * 10 * 2,
                ]}
              />
              <Tooltip content={<ClimateTooltip />} cursor={{ fill: CHART.cursorSoft }} />
              <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="precip"
                name="Ø Niederschlag"
                dataKey="precip"
                fill={CHART.colors.wet}
                fillOpacity={0.5}
                radius={[2, 2, 0, 0]}
                maxBarSize={44}
              />
              <Line
                yAxisId="temp"
                name="Ø Temperatur"
                type="monotone"
                dataKey="temp"
                stroke={CHART.colors.warm}
                strokeWidth={2.5}
                dot={{ r: 3, fill: CHART.colors.warm, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Card>

      <Card>
        <SectionHeading title="Klimatabelle" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="label px-3 py-2.5">Monat</th>
                <th scope="col" className="label px-3 py-2.5">Ø Temperatur</th>
                <th scope="col" className="label px-3 py-2.5">Ø Niederschlag</th>
                <th scope="col" className="label px-3 py-2.5">Einordnung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r) => (
                <tr key={r.month} className="transition-colors hover:bg-raised">
                  <td className="px-3 py-2 font-medium text-ink">{r.full}</td>
                  <td className="numeric px-3 py-2 font-semibold text-warm">
                    {temp(r.temp)}
                  </td>
                  <td className="numeric px-3 py-2 font-semibold text-wet">
                    {mm(r.precip)}
                  </td>
                  <td className="px-3 py-2">
                    {/* The original printed the literal string "Humid
                        (Niederschlag > 2 * Temp)" on every row without ever
                        evaluating the condition. */}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        r.humid ? 'bg-good/10 text-good' : 'bg-dry/10 text-dry'
                      }`}
                    >
                      {r.humid ? 'humid' : 'arid'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function ClimateTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: Row }[]
}) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null

  return (
    <ChartTooltip
      title={r.full}
      rows={[
        { label: 'Ø Temperatur', value: temp(r.temp), className: 'text-warm' },
        { label: 'Ø Niederschlag', value: mm(r.precip), className: 'text-wet' },
      ]}
      footer={r.humid ? 'Humid — Niederschlag über 2 × Temperatur' : 'Arid'}
    />
  )
}
