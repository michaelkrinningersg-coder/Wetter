import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CalendarHeart, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'

import { useApi } from '../lib/api'
import { MONTHS, isoToGerman, mm, monthName, num, temp } from '../lib/format'
import type { DayHistoryRow, DayInHistoryResponse } from '../types'
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

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const RECORD_LABELS: Record<string, { label: string; className: string }> = {
  warmest: { label: 'Wärmster', className: 'bg-warm/15 text-warm' },
  coldest: { label: 'Kältester', className: 'bg-cold/15 text-cold' },
  wettest: { label: 'Nassester', className: 'bg-wet/15 text-wet' },
  windiest: { label: 'Stürmischster', className: 'bg-good/15 text-good' },
  warmestMean: { label: 'Höchstes Tagesmittel', className: 'bg-hot/15 text-hot' },
  coldestMean: { label: 'Tiefstes Tagesmittel', className: 'bg-cool/15 text-cool' },
}

export function DayInHistory({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const today = useMemo(() => new Date(), [])
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [day, setDay] = useState(today.getDate())

  const isToday = month === today.getMonth() + 1 && day === today.getDate()

  const { data, loading, error, reload } = useApi<DayInHistoryResponse>(
    `/api/weather/day-in-history?month=${month}&day=${day}&stationId=${encodeURIComponent(stationId)}`,
    [month, day],
  )

  /** Which years hold which record for this calendar day. */
  const recordsByYear = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const [key, holder] of Object.entries(data?.holders ?? {})) {
      if (!holder) continue
      if (!map.has(holder.year)) map.set(holder.year, [])
      map.get(holder.year)!.push(key)
    }
    return map
  }, [data])

  const chart = useMemo(
    () =>
      (data?.records ?? [])
        .slice()
        .reverse()
        .map((r) => ({
          ...r,
          isRecord: recordsByYear.has(r.year),
          recordMean: recordsByYear.has(r.year) ? r.temp_mean : null,
        })),
    [data, recordsByYear],
  )

  function step(delta: number) {
    let d = day + delta
    let m = month
    if (d < 1) {
      m = m === 1 ? 12 : m - 1
      d = DAYS_IN_MONTH[m - 1]!
    } else if (d > DAYS_IN_MONTH[m - 1]!) {
      m = m === 12 ? 1 : m + 1
      d = 1
    }
    setMonth(m)
    setDay(d)
  }

  return (
    <>
      <InfoPanel icon={CalendarHeart} title={`Dieser Tag in der Geschichte — ${stationName}`}>
        Alle Messwerte für den <strong>{day}. {monthName(month)}</strong> über die
        gesamte Messreihe. Hervorgehoben sind die Jahre, die für dieses Kalenderdatum{' '}
        <strong>bis heute einen Rekord halten</strong> — den höchsten oder tiefsten
        Wert, die größte Regenmenge oder die stärkste Böe. Bei Gleichstand gilt das
        frühere Jahr, das den Rekord tatsächlich aufgestellt hat.
      </InfoPanel>

      <Card>
        <SectionHeading
          title="Kalendertag wählen"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Vorheriger Tag"
                className="grid size-8 cursor-pointer place-items-center rounded-md border border-line bg-raised text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>

              <label>
                <span className="sr-only">Tag</span>
                <select
                  value={day}
                  onChange={(e) => setDay(Number(e.target.value))}
                  className="numeric cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
                >
                  {Array.from({ length: DAYS_IN_MONTH[month - 1]! }, (_, i) => (
                    <option key={i + 1} value={i + 1} className="bg-canvas">
                      {i + 1}.
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="sr-only">Monat</span>
                <select
                  value={month}
                  onChange={(e) => {
                    const m = Number(e.target.value)
                    setMonth(m)
                    setDay((d) => Math.min(d, DAYS_IN_MONTH[m - 1]!))
                  }}
                  className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
                >
                  {MONTHS.map((name, i) => (
                    <option key={name} value={i + 1} className="bg-canvas">
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Nächster Tag"
                className="grid size-8 cursor-pointer place-items-center rounded-md border border-line bg-raised text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>

              {!isToday && (
                <button
                  type="button"
                  onClick={() => {
                    setMonth(today.getMonth() + 1)
                    setDay(today.getDate())
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-brand hover:text-brand"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Heute
                </button>
              )}
            </div>
          }
        />
      </Card>

      {loading ? (
        <Loading message={`Lade den ${day}. ${monthName(month)} aus allen Jahren…`} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.records.length === 0 ? (
        <EmptyState
          message={`Für den ${day}. ${monthName(month)} liegen keine Messwerte vor.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(data.holders).map(([key, holder]) => {
              if (!holder) return null
              const meta = RECORD_LABELS[key]
              if (!meta) return null
              const unit =
                key === 'wettest' ? 'mm' : key === 'windiest' ? 'm/s' : '°C'
              return (
                <div
                  key={key}
                  className="rounded-card border border-line bg-raised p-4"
                >
                  <span className={`label rounded px-1.5 py-0.5 ${meta.className}`}>
                    {meta.label}
                  </span>
                  <p className="numeric mt-2 text-2xl font-semibold tracking-tight text-ink">
                    {num(holder.value, 1, unit)}
                  </p>
                  <p className="numeric mt-1 text-[11px] text-ink-faint">
                    aufgestellt {holder.year} · steht seit{' '}
                    {(data.lastYear ?? holder.year) - holder.year} Jahren
                  </p>
                </div>
              )
            })}
          </div>

          <Card>
            <SectionHeading
              title={`${day}. ${monthName(month)} über ${data.count} Jahre`}
              hint={`Messreihe ${data.firstYear}–${data.lastYear}. Die gestrichelte Linie ist das Mittel dieses Kalendertags (${temp(data.meanOfDay, 1)}); markierte Punkte halten einen Rekord.`}
            />
            <ChartFrame height={340}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
                  <YAxis stroke={CHART.axis} tick={CHART.tick} tickLine={false} unit=" °C" />
                  <Tooltip content={<DayTooltip recordsByYear={recordsByYear} />} />
                  <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
                  {data.meanOfDay !== null && data.meanOfDay !== undefined && (
                    <ReferenceLine
                      y={data.meanOfDay}
                      stroke={CHART.colors.brand}
                      strokeDasharray="5 5"
                    />
                  )}
                  <Line
                    name="Maximum"
                    type="linear"
                    dataKey="temp_max"
                    stroke={CHART.colors.warm}
                    strokeWidth={1.2}
                    dot={false}
                  />
                  <Line
                    name="Minimum"
                    type="linear"
                    dataKey="temp_min"
                    stroke={CHART.colors.cold}
                    strokeWidth={1.2}
                    dot={false}
                  />
                  <Line
                    name="Tagesmittel"
                    type="linear"
                    dataKey="temp_mean"
                    stroke={CHART.colors.neutral}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Scatter
                    name="Rekordhalter"
                    dataKey="recordMean"
                    fill={CHART.colors.brand}
                    shape="circle"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-0 sm:p-6 sm:pb-0">
              <SectionHeading title="Alle Jahre im Einzelnen" />
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="sticky-head">
                  <tr className="border-y border-line">
                    <th scope="col" className="label px-3 py-2.5">Jahr</th>
                    <th scope="col" className="label px-3 py-2.5">Ø Temp.</th>
                    <th scope="col" className="label px-3 py-2.5">Max</th>
                    <th scope="col" className="label px-3 py-2.5">Min</th>
                    <th scope="col" className="label px-3 py-2.5">Niederschlag</th>
                    <th scope="col" className="label px-3 py-2.5">Böe</th>
                    <th scope="col" className="label px-3 py-2.5">Rekord</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {data.records.map((r) => {
                    const held = recordsByYear.get(r.year) ?? []
                    return (
                      <tr
                        key={r.year}
                        className={`transition-colors hover:bg-raised ${held.length > 0 ? 'bg-brand/[0.04]' : ''}`}
                      >
                        <td className="numeric px-3 py-2 font-semibold text-ink">
                          {r.year}
                        </td>
                        <td className="numeric px-3 py-2 text-ink">{temp(r.temp_mean)}</td>
                        <td className="numeric px-3 py-2 text-warm">{temp(r.temp_max)}</td>
                        <td className="numeric px-3 py-2 text-cold">{temp(r.temp_min)}</td>
                        <td
                          className={`numeric px-3 py-2 ${r.precipitation ? 'text-wet' : 'text-ink-faint'}`}
                        >
                          {mm(r.precipitation)}
                        </td>
                        <td className="numeric px-3 py-2 text-ink-muted">
                          {num(r.wind_max, 1, 'm/s')}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            {held.map((key) => {
                              const meta = RECORD_LABELS[key]
                              return meta ? (
                                <span
                                  key={key}
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
                                >
                                  {meta.label}
                                </span>
                              ) : null
                            })}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
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
  label,
  recordsByYear,
}: {
  active?: boolean
  payload?: { payload: DayHistoryRow }[]
  label?: string | number
  recordsByYear: Map<number, string[]>
}) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null

  const held = recordsByYear.get(r.year) ?? []

  return (
    <ChartTooltip
      title={isoToGerman(r.date)}
      subtitle={
        held.length > 0
          ? held.map((k) => RECORD_LABELS[k]?.label ?? k).join(' · ')
          : undefined
      }
      rows={[
        { label: 'Maximum', value: temp(r.temp_max), className: 'text-warm' },
        { label: 'Tagesmittel', value: temp(r.temp_mean) },
        { label: 'Minimum', value: temp(r.temp_min), className: 'text-cold' },
        { label: 'Niederschlag', value: mm(r.precipitation), className: 'text-wet' },
      ]}
      footer={label !== undefined ? `Jahr ${label}` : undefined}
    />
  )
}
