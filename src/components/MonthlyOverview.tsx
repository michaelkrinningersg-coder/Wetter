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
import { CalendarDays, CloudRain, Snowflake, Sun, Thermometer, Wind } from 'lucide-react'

import { useApi } from '../lib/api'
import { MONTHS, MONTHS_SHORT, isoToGerman, mm, monthName, num, temp } from '../lib/format'
import type { DailyRecord, MonthlyResponse } from '../types'
import {
  Card,
  CHART,
  ChartFrame,
  ChartTooltip,
  EmptyState,
  ErrorState,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

export function MonthlyOverview({
  stationId,
  stationName,
  year,
  month,
  onYearChange,
  onMonthChange,
  minYear,
  maxYear,
}: {
  stationId: string
  stationName: string
  year: number
  month: number
  onYearChange: (year: number) => void
  onMonthChange: (month: number) => void
  minYear: number
  maxYear: number
}) {
  const { data, loading, error, reload } = useApi<MonthlyResponse>(
    `/api/weather/monthly?year=${year}&month=${month}&stationId=${encodeURIComponent(stationId)}`,
  )

  // Quick-pick the six most recent years; everything older via the select.
  // The original hard-coded [2026 … 2021], so the shortcuts silently went
  // stale each January and the dropdown always started at 1858 regardless of
  // which station was selected.
  const quickYears = useMemo(() => {
    const years: number[] = []
    for (let y = maxYear; y > maxYear - 6 && y >= minYear; y--) years.push(y)
    return years
  }, [minYear, maxYear])

  const allYears = useMemo(() => {
    const years: number[] = []
    for (let y = maxYear; y >= minYear; y--) years.push(y)
    return years
  }, [minYear, maxYear])

  const chartData = useMemo(
    () =>
      (data?.days ?? []).map((d) => ({
        ...d,
        label: String(d.day),
      })),
    [data],
  )

  const yearChart = useMemo(
    () =>
      (data?.monthlyStats ?? []).map((s) => ({
        ...s,
        label: MONTHS_SHORT[s.month - 1] ?? String(s.month),
        isSelected: s.month === month,
      })),
    [data, month],
  )

  return (
    <>
      <Card>
        <SectionHeading icon={CalendarDays} title="Zeitraum auswählen" />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label w-12 shrink-0">Jahr</span>
            {quickYears.map((y) => (
              <button
                key={y}
                type="button"
                aria-pressed={y === year}
                onClick={() => onYearChange(y)}
                className={`numeric cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  y === year
                    ? 'bg-brand text-canvas'
                    : 'border border-line bg-raised text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {y}
              </button>
            ))}
            <label className="ml-1">
              <span className="sr-only">Weiteres Jahr wählen</span>
              <select
                value={quickYears.includes(year) ? '' : year}
                onChange={(e) => e.target.value && onYearChange(Number(e.target.value))}
                className="numeric cursor-pointer rounded-md border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink-muted focus:border-brand focus:outline-none"
              >
                <option value="">Weitere Jahre…</option>
                {allYears
                  .filter((y) => !quickYears.includes(y))
                  .map((y) => (
                    <option key={y} value={y} className="bg-canvas">
                      {y}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="label w-12 shrink-0">Monat</span>
            {MONTHS.map((name, i) => {
              const m = i + 1
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={m === month}
                  title={name}
                  onClick={() => onMonthChange(m)}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    m === month
                      ? 'bg-brand text-canvas'
                      : 'border border-line bg-raised text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {MONTHS_SHORT[i]}
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      {loading ? (
        <Loading message={`Lade Klimadaten für ${monthName(month)} ${year}…`} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.days.length === 0 ? (
        <EmptyState
          message={`Für ${monthName(month)} ${year} liegen an der Station ${stationName} keine Messwerte vor.`}
        />
      ) : (
        <>
          <StatGrid>
            <StatTile
              label="Ø Temperatur"
              value={temp(data.summary.tempAvg)}
              caption="Mittel der Tagesmittel"
              accent="brand"
              icon={Thermometer}
            />
            <StatTile
              label="Höchsttemperatur"
              value={temp(data.summary.maxTemp)}
              caption="Höchstes Tagesmaximum"
              accent="warm"
              icon={Sun}
            />
            <StatTile
              label="Tiefsttemperatur"
              value={temp(data.summary.minTemp)}
              caption="Niedrigstes Tagesminimum"
              accent="cold"
              icon={Snowflake}
            />
            <StatTile
              label="Niederschlag"
              value={mm(data.summary.precipSum)}
              caption="Monatssumme"
              accent="wet"
              icon={CloudRain}
            />
          </StatGrid>

          <Card>
            <SectionHeading
              title={`Tagesverlauf — ${monthName(month)} ${year}`}
              hint="Balken zeigen den Tagesniederschlag, die Linien Minimum, Mittel und Maximum der Temperatur."
              actions={
                data.summary.maxWind !== null ? (
                  <span className="numeric flex items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1.5 text-[11px] text-ink-muted">
                    <Wind className="size-3.5 text-ink-faint" aria-hidden />
                    Spitzenböe {num(data.summary.maxWind, 1, 'm/s')}
                  </span>
                ) : undefined
              }
            />
            <ChartFrame height={340}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: -18, bottom: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
                  <YAxis
                    yAxisId="temp"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    unit=" °C"
                  />
                  <YAxis
                    yAxisId="precip"
                    orientation="right"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    unit=" mm"
                  />
                  <Tooltip content={<DayTooltip />} cursor={{ fill: CHART.cursorSoft }} />
                  <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    yAxisId="precip"
                    name="Niederschlag"
                    dataKey="precipitation"
                    fill={CHART.colors.wet}
                    fillOpacity={0.45}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={18}
                  />
                  <Line
                    yAxisId="temp"
                    name="Maximum"
                    // Daily values are discrete measurements — spline
                    // smoothing would invent maxima between days.
                    type="linear"
                    dataKey="temp_max"
                    stroke={CHART.colors.warm}
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    yAxisId="temp"
                    name="Mittel"
                    type="linear"
                    dataKey="temp_mean"
                    stroke={CHART.colors.brand}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="temp"
                    name="Minimum"
                    type="linear"
                    dataKey="temp_min"
                    stroke={CHART.colors.cold}
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          <Card>
            <SectionHeading
              title={`Jahresverlauf ${year} im Überblick`}
              hint="Monatsmittel der Temperatur und Monatssummen des Niederschlags des ausgewählten Jahres."
            />
            <ChartFrame height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={yearChart} margin={{ top: 8, right: 4, left: -18, bottom: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
                  <YAxis yAxisId="temp" stroke={CHART.axis} tick={CHART.tick} tickLine={false} unit=" °C" />
                  <YAxis yAxisId="precip" orientation="right" stroke={CHART.axis} tick={CHART.tick} tickLine={false} unit=" mm" />
                  <Tooltip content={<MonthTooltip />} cursor={{ fill: CHART.cursorSoft }} />
                  <Bar
                    yAxisId="precip"
                    name="Niederschlag"
                    dataKey="precipSum"
                    fill={CHART.colors.wet}
                    fillOpacity={0.45}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={32}
                  />
                  <Line
                    yAxisId="temp"
                    name="Ø Temperatur"
                    type="monotone"
                    dataKey="tempAvg"
                    stroke={CHART.colors.warm}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-0 sm:p-6 sm:pb-0">
              <SectionHeading title={`Tageswerte — ${monthName(month)} ${year}`} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead>
                  <tr className="border-y border-line bg-raised">
                    <th scope="col" className="label px-3 py-2.5">Datum</th>
                    <th scope="col" className="label px-3 py-2.5">Ø Temp.</th>
                    <th scope="col" className="label px-3 py-2.5">Max</th>
                    <th scope="col" className="label px-3 py-2.5">Min</th>
                    <th scope="col" className="label px-3 py-2.5">Niederschlag</th>
                    <th scope="col" className="label px-3 py-2.5">Wind Ø</th>
                    <th scope="col" className="label px-3 py-2.5">Böe</th>
                    <th scope="col" className="label px-3 py-2.5">Luftdruck</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {data.days.map((d) => (
                    <tr key={d.date} className="transition-colors hover:bg-raised">
                      <td className="numeric px-3 py-2 font-semibold text-ink">
                        {isoToGerman(d.date)}
                      </td>
                      <td className="numeric px-3 py-2 text-ink">{temp(d.temp_mean)}</td>
                      <td className="numeric px-3 py-2 text-warm">{temp(d.temp_max)}</td>
                      <td className="numeric px-3 py-2 text-cold">{temp(d.temp_min)}</td>
                      <td
                        className={`numeric px-3 py-2 ${d.precipitation ? 'text-wet' : 'text-ink-faint'}`}
                      >
                        {mm(d.precipitation)}
                      </td>
                      <td className="numeric px-3 py-2 text-ink-muted">
                        {num(d.wind_mean, 1, 'm/s')}
                      </td>
                      <td className="numeric px-3 py-2 text-ink-muted">
                        {num(d.wind_max, 1, 'm/s')}
                      </td>
                      <td className="numeric px-3 py-2 text-ink-faint">
                        {num(d.pressure, 1, 'hPa')}
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

function DayTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: DailyRecord }[]
}) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null

  return (
    <ChartTooltip
      title={isoToGerman(d.date)}
      rows={[
        { label: 'Maximum', value: temp(d.temp_max), className: 'text-warm' },
        { label: 'Mittel', value: temp(d.temp_mean), className: 'text-brand' },
        { label: 'Minimum', value: temp(d.temp_min), className: 'text-cold' },
        { label: 'Niederschlag', value: mm(d.precipitation), className: 'text-wet' },
        { label: 'Spitzenböe', value: num(d.wind_max, 1, 'm/s') },
      ]}
    />
  )
}

function MonthTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: { month: number; tempAvg: number | null; precipSum: number | null } }[]
}) {
  const m = payload?.[0]?.payload
  if (!active || !m) return null

  return (
    <ChartTooltip
      title={monthName(m.month)}
      rows={[
        { label: 'Ø Temperatur', value: temp(m.tempAvg), className: 'text-warm' },
        { label: 'Niederschlag', value: mm(m.precipSum), className: 'text-wet' },
      ]}
    />
  )
}
