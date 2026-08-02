import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CalendarClock, Leaf, Sprout, Sun } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { centeredMovingAverage, mean } from '../lib/stats'
import { MONTHS_SHORT, isoToGerman, num, signed } from '../lib/format'
import type { VegetationRecord, VegetationResponse } from '../types'
import {
  Card,
  CHART,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'
import { DataQuality } from './DataQuality'

const VIEWS = [
  { value: 'season', label: 'Länge & Lage' },
  { value: 'gdd', label: 'Wachstumsgradtage' },
] as const

type View = (typeof VIEWS)[number]['value']

const SMOOTH_WINDOW = 30

/** Day-of-year -> "1. Mär", for axis ticks and tooltips. */
function dayLabel(doy: number): string {
  const cumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
  for (let month = 11; month >= 0; month--) {
    if (doy > cumulative[month]!) {
      return `${doy - cumulative[month]!}. ${MONTHS_SHORT[month]}`
    }
  }
  return `${doy}. Jan`
}

export function Vegetation({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [view, setView] = useUrlState<View>('ansicht', 'season')

  const { data, loading, error, reload } = useApi<VegetationResponse>(
    `/api/weather/vegetation?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data?.records ?? [], [data])

  const points = useMemo(() => {
    const smoothLength = centeredMovingAverage(
      records.map((r) => ({ x: r.year, y: r.lengthDays })),
      SMOOTH_WINDOW,
    )
    const smoothGdd = centeredMovingAverage(
      records.map((r) => ({ x: r.year, y: r.growingDegreeDays })),
      SMOOTH_WINDOW,
    )
    return records.map((r) => ({
      ...r,
      // The season band is drawn as two stacked areas: a transparent one up to
      // the start day, then the visible one on top of it. Recharts' [low, high]
      // range form fills the complement of the range here, so stacking is the
      // reliable way to shade "between these two dates".
      seasonSpan: r.endDayOfYear - r.startDayOfYear,
      smoothLength: smoothLength.get(r.year) ?? null,
      smoothGdd: smoothGdd.get(r.year) ?? null,
    }))
  }, [records])

  /** Compare the first and last complete 30-year block in the series. */
  const shift = useMemo(() => {
    if (records.length < 60) return null
    const window = (from: number, to: number) =>
      records.filter((r) => r.year >= from && r.year <= to)

    const lastYear = records[records.length - 1]!.year
    const firstYear = records[0]!.year
    const recent = window(lastYear - 29, lastYear)
    const early = window(firstYear, firstYear + 29)
    if (recent.length < 10 || early.length < 10) return null

    const avg = (rows: VegetationRecord[], key: keyof VegetationRecord) =>
      mean(rows.map((r) => Number(r[key]))) ?? 0

    return {
      earlyLabel: `${early[0]!.year}–${early[early.length - 1]!.year}`,
      recentLabel: `${recent[0]!.year}–${recent[recent.length - 1]!.year}`,
      lengthEarly: avg(early, 'lengthDays'),
      lengthRecent: avg(recent, 'lengthDays'),
      startEarly: avg(early, 'startDayOfYear'),
      startRecent: avg(recent, 'startDayOfYear'),
      endEarly: avg(early, 'endDayOfYear'),
      endRecent: avg(recent, 'endDayOfYear'),
      gddEarly: avg(early, 'growingDegreeDays'),
      gddRecent: avg(recent, 'growingDegreeDays'),
    }
  }, [records])

  if (loading) return <Loading message="Bestimme Vegetationsperioden…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (records.length === 0) {
    return <EmptyState message="Keine ausreichenden Daten für die Vegetationsperiode." />
  }

  return (
    <>
      <InfoPanel icon={Leaf} title={`Vegetationsperiode — ${stationName}`}>
        Die thermische Vegetationsperiode <strong>beginnt</strong> am ersten Tag der
        ersten Serie von {data?.runLength ?? 6} aufeinanderfolgenden Tagen mit einem
        Tagesmittel ab {data?.base ?? 5} °C und <strong>endet</strong> am Tag vor der
        ersten solchen Serie darunter nach dem 1. Juli. Die{' '}
        <strong>Wachstumsgradtage</strong> summieren über das Jahr, um wie viel das
        Tagesmittel die {data?.base ?? 5} °C übersteigt — das Wärmeangebot, das
        Pflanzen tatsächlich zur Verfügung steht.
      </InfoPanel>

      {shift && (
        <StatGrid>
          <StatTile
            label="Länge der Periode"
            value={`${Math.round(shift.lengthRecent)} Tage`}
            caption={`${shift.recentLabel} · ${signed(shift.lengthRecent - shift.lengthEarly, 0, 'Tage')} gegenüber ${shift.earlyLabel}`}
            accent="good"
            icon={Sprout}
          />
          <StatTile
            label="Beginn im Mittel"
            value={dayLabel(Math.round(shift.startRecent))}
            caption={`${signed(shift.startRecent - shift.startEarly, 0, 'Tage')} gegenüber ${shift.earlyLabel}`}
            accent="warm"
            icon={CalendarClock}
          />
          <StatTile
            label="Ende im Mittel"
            value={dayLabel(Math.round(shift.endRecent))}
            caption={`${signed(shift.endRecent - shift.endEarly, 0, 'Tage')} gegenüber ${shift.earlyLabel}`}
            accent="cool"
            icon={CalendarClock}
          />
          <StatTile
            label="Wachstumsgradtage"
            value={num(shift.gddRecent, 0, 'Kd')}
            caption={`${signed(shift.gddRecent - shift.gddEarly, 0, 'Kd')} gegenüber ${shift.earlyLabel}`}
            accent="brand"
            icon={Sun}
          />
        </StatGrid>
      )}

      <Card>
        <SectionHeading
          title={
            view === 'season'
              ? 'Lage und Länge der Vegetationsperiode'
              : 'Wachstumsgradtage je Jahr'
          }
          hint={
            view === 'season'
              ? `Das Band spannt zwischen Beginn und Ende auf. Die kräftige Linie ist das gleitende ${SMOOTH_WINDOW}-Jahres-Mittel der Länge (rechte Achse).`
              : `Summe der Tagesüberschüsse über ${data?.base ?? 5} °C in Kelvintagen, mit gleitendem ${SMOOTH_WINDOW}-Jahres-Mittel.`
          }
          actions={
            <ChoiceGroup label="Ansicht" value={view} choices={VIEWS} onChange={setView} size="sm" />
          }
        />

        <ChartFrame height={400}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 4, left: -14, bottom: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />

              {view === 'season' ? (
                <>
                  <YAxis
                    yAxisId="doy"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    domain={[0, 366]}
                    ticks={[1, 60, 121, 182, 244, 305, 365]}
                    tickFormatter={dayLabel}
                    width={58}
                  />
                  <YAxis
                    yAxisId="len"
                    orientation="right"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    unit=" d"
                  />
                  <Tooltip content={<SeasonTooltip />} cursor={{ fill: 'oklch(100% 0 0 / 0.03)' }} />
                  <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    yAxisId="doy"
                    stackId="season"
                    name="Vor Vegetationsbeginn"
                    type="monotone"
                    dataKey="startDayOfYear"
                    stroke="none"
                    fill="none"
                    fillOpacity={0}
                    legendType="none"
                    tooltipType="none"
                  />
                  <Area
                    yAxisId="doy"
                    stackId="season"
                    name="Vegetationsperiode"
                    type="monotone"
                    dataKey="seasonSpan"
                    stroke={CHART.colors.brand}
                    strokeOpacity={0.35}
                    strokeWidth={1}
                    fill={CHART.colors.brand}
                    fillOpacity={0.22}
                  />
                  <Line
                    yAxisId="len"
                    name={`Länge — gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel`}
                    type="monotone"
                    dataKey="smoothLength"
                    stroke={CHART.colors.warm}
                    strokeWidth={3}
                    dot={false}
                    connectNulls={false}
                  />
                </>
              ) : (
                <>
                  <YAxis
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    unit=" Kd"
                    width={62}
                  />
                  <Tooltip content={<GddTooltip />} cursor={{ fill: 'oklch(100% 0 0 / 0.03)' }} />
                  <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    name="Wachstumsgradtage"
                    type="monotone"
                    dataKey="growingDegreeDays"
                    stroke={CHART.colors.neutral}
                    strokeWidth={1.2}
                    dot={false}
                  />
                  <Line
                    name={`Gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel`}
                    type="monotone"
                    dataKey="smoothGdd"
                    stroke={CHART.colors.brand}
                    strokeWidth={3}
                    dot={false}
                    connectNulls={false}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Card>

      <DataQuality stationId={stationId} />

      <Card padded={false}>
        <div className="p-5 pb-0 sm:p-6 sm:pb-0">
          <SectionHeading title={`Jahreswerte (${records.length} Jahre)`} />
        </div>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="sticky-head">
              <tr className="border-y border-line">
                <th scope="col" className="label px-3 py-2.5">Jahr</th>
                <th scope="col" className="label px-3 py-2.5">Beginn</th>
                <th scope="col" className="label px-3 py-2.5">Ende</th>
                <th scope="col" className="label px-3 py-2.5">Länge</th>
                <th scope="col" className="label px-3 py-2.5">Wachstumsgradtage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {[...records].reverse().map((r) => (
                <tr key={r.year} className="transition-colors hover:bg-raised">
                  <td className="numeric px-3 py-2 font-semibold text-ink">{r.year}</td>
                  <td className="numeric px-3 py-2 text-warm">{isoToGerman(r.startDate)}</td>
                  <td className="numeric px-3 py-2 text-cool">
                    {isoToGerman(r.endDate)}
                    {!r.seasonClosed && (
                      <span
                        className="ml-2 rounded border border-line-strong px-1 py-0.5 text-[9px] text-ink-faint"
                        title="Die Periode war am Jahresende noch nicht beendet."
                      >
                        offen
                      </span>
                    )}
                  </td>
                  <td className="numeric px-3 py-2 font-semibold text-ink">
                    {r.lengthDays} Tage
                  </td>
                  <td className="numeric px-3 py-2 text-brand-dim">
                    {num(r.growingDegreeDays, 0, 'Kd')}
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

function SeasonTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { payload: VegetationRecord & { smoothLength: number | null } }[]
  label?: string | number
}) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null

  return (
    <ChartTooltip
      title={`Jahr ${label}`}
      rows={[
        { label: 'Beginn', value: isoToGerman(r.startDate), className: 'text-warm' },
        { label: 'Ende', value: isoToGerman(r.endDate), className: 'text-cool' },
        { label: 'Länge', value: `${r.lengthDays} Tage` },
        ...(r.smoothLength !== null
          ? [
              {
                label: '30-Jahres-Mittel',
                value: `${Math.round(r.smoothLength)} Tage`,
                className: 'text-warm',
              },
            ]
          : []),
      ]}
    />
  )
}

function GddTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { payload: VegetationRecord & { smoothGdd: number | null } }[]
  label?: string | number
}) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null

  return (
    <ChartTooltip
      title={`Jahr ${label}`}
      rows={[
        {
          label: 'Wachstumsgradtage',
          value: num(r.growingDegreeDays, 0, 'Kd'),
          className: 'text-ink',
        },
        ...(r.smoothGdd !== null
          ? [
              {
                label: '30-Jahres-Mittel',
                value: num(r.smoothGdd, 0, 'Kd'),
                className: 'text-brand',
              },
            ]
          : []),
      ]}
    />
  )
}
