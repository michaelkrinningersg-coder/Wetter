import { useMemo } from 'react'
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
import { Leaf, Snowflake, Sun, Wind } from 'lucide-react'

import { useApi } from '../lib/api'
import { centeredMovingAverage, linearFit, mean } from '../lib/stats'
import { num, signed, temp } from '../lib/format'
import type { SeasonsResponse } from '../types'
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
import { DataQuality } from './DataQuality'

const SMOOTH_WINDOW = 30

const STYLE: Record<
  string,
  { color: string; icon: typeof Sun; accent: string }
> = {
  DJF: { color: CHART.colors.cold, icon: Snowflake, accent: 'text-cold' },
  MAM: { color: CHART.colors.good, icon: Leaf, accent: 'text-good' },
  JJA: { color: CHART.colors.warm, icon: Sun, accent: 'text-warm' },
  SON: { color: CHART.colors.dry, icon: Wind, accent: 'text-dry' },
}

export function Seasons({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const { data, loading, error, reload } = useApi<SeasonsResponse>(
    `/api/weather/seasons?stationId=${encodeURIComponent(stationId)}`,
  )

  const seasons = useMemo(() => {
    return (data?.seasons ?? []).map((season) => {
      const smooth = centeredMovingAverage(
        season.records.map((r) => ({ x: r.year, y: r.avg_temp })),
        SMOOTH_WINDOW,
      )
      const fit = linearFit(season.records.map((r) => ({ x: r.year, y: r.avg_temp })))

      const first = season.records[0]?.year ?? 0
      const last = season.records[season.records.length - 1]?.year ?? 0
      const early = season.records.filter((r) => r.year <= first + 29)
      const recent = season.records.filter((r) => r.year >= last - 29)

      return {
        ...season,
        points: season.records.map((r) => ({
          ...r,
          smooth: smooth.get(r.year) ?? null,
        })),
        perDecade: fit ? fit.slope * 10 : null,
        r2: fit?.r2 ?? null,
        isSignificant: fit?.isSignificant ?? false,
        earlyLabel: early.length > 0 ? `${early[0]!.year}–${early[early.length - 1]!.year}` : '',
        recentLabel:
          recent.length > 0 ? `${recent[0]!.year}–${recent[recent.length - 1]!.year}` : '',
        earlyMean: mean(early.map((r) => r.avg_temp)),
        recentMean: mean(recent.map((r) => r.avg_temp)),
      }
    })
  }, [data])

  /** Merge all four seasons onto one year axis for the combined chart. */
  const combined = useMemo(() => {
    const byYear = new Map<number, Record<string, number | null>>()
    for (const season of seasons) {
      for (const p of season.points) {
        if (!byYear.has(p.year)) byYear.set(p.year, { year: p.year })
        byYear.get(p.year)![season.key] = p.smooth
      }
    }
    return [...byYear.values()].sort(
      (a, b) => (a.year as number) - (b.year as number),
    )
  }, [seasons])

  if (loading) return <Loading message="Berechne Jahreszeiten-Trends…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (seasons.length === 0) return <EmptyState message="Keine Jahreszeitendaten vorhanden." />

  const ranked = [...seasons].sort(
    (a, b) => (b.perDecade ?? -99) - (a.perDecade ?? -99),
  )
  const fastest = ranked[0]
  const slowest = ranked[ranked.length - 1]

  return (
    <>
      <InfoPanel icon={Sun} title={`Trends nach Jahreszeiten — ${stationName}`}>
        Meteorologische Jahreszeiten zu je drei vollen Monaten. Der Winter läuft über
        den Jahreswechsel und wird nach beiden Jahren benannt (
        <strong>Winter 2025/26</strong> = Dezember 2025 bis Februar 2026). Das
        Jahresmittel verdeckt, dass sich die Jahreszeiten sehr unterschiedlich
        entwickeln
        {fastest && slowest && fastest.key !== slowest.key && (
          <>
            {' '}
            — hier erwärmt sich der <strong>{fastest.label}</strong> am stärksten, der{' '}
            <strong>{slowest.label}</strong> am schwächsten
          </>
        )}
        .
      </InfoPanel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {seasons.map((season) => {
          const style = STYLE[season.key]!
          const delta =
            season.recentMean !== null && season.earlyMean !== null
              ? season.recentMean - season.earlyMean
              : null
          return (
            <div
              key={season.key}
              className="relative overflow-hidden rounded-card border border-line bg-raised p-4"
            >
              <span
                className="absolute inset-y-0 left-0 w-0.5"
                style={{ backgroundColor: style.color }}
                aria-hidden
              />
              <div className="flex items-start justify-between gap-2">
                <span className="label">{season.label}</span>
                <style.icon className={`size-4 ${style.accent}`} aria-hidden />
              </div>
              <p
                className="numeric mt-2 text-2xl font-semibold tracking-tight"
                style={{ color: style.color }}
              >
                {signed(season.perDecade, 2, '°C')}
              </p>
              <p className="text-[11px] leading-snug text-ink-faint">je Jahrzehnt</p>
              <dl className="mt-3 space-y-1 border-t border-line pt-2 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-faint">{season.earlyLabel}</dt>
                  <dd className="numeric text-ink-muted">{temp(season.earlyMean, 2)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-faint">{season.recentLabel}</dt>
                  <dd className="numeric font-semibold text-ink">
                    {temp(season.recentMean, 2)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-faint">Änderung</dt>
                  <dd className="numeric font-semibold" style={{ color: style.color }}>
                    {signed(delta, 2, '°C')}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-[10px] text-ink-faint">
                R² {num(season.r2, 2)} ·{' '}
                {season.isSignificant ? 'signifikant (95 %)' : 'nicht signifikant'}
              </p>
            </div>
          )
        })}
      </div>

      <Card>
        <SectionHeading
          title="Alle vier Jahreszeiten im Vergleich"
          hint={`Gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel je Jahreszeit — die Einzeljahre schwanken zu stark, um vier Reihen gleichzeitig lesbar zu halten. Zentriert, endet daher ${SMOOTH_WINDOW / 2} Jahre vor dem Reihenende.`}
        />
        <ChartFrame height={400}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={combined} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
              <YAxis stroke={CHART.axis} tick={CHART.tick} tickLine={false} unit=" °C" />
              <Tooltip content={<SeasonsTooltip seasons={seasons} />} />
              <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
              {seasons.map((season) => (
                <Line
                  key={season.key}
                  name={season.label}
                  type="monotone"
                  dataKey={season.key}
                  stroke={STYLE[season.key]!.color}
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Card>

      <DataQuality stationId={stationId} />

      <Card padded={false}>
        <div className="p-5 pb-0 sm:p-6 sm:pb-0">
          <SectionHeading
            title="Jahreszeiten im Einzelnen"
            hint="Die zehn wärmsten Ausprägungen je Jahreszeit."
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-y border-line bg-raised">
                <th scope="col" className="label px-3 py-2.5">Rang</th>
                {seasons.map((s) => (
                  <th key={s.key} scope="col" className="label px-3 py-2.5">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {Array.from({ length: 10 }, (_, index) => (
                <tr key={index} className="transition-colors hover:bg-raised">
                  <td className="px-3 py-2">
                    <span
                      className={`numeric inline-grid size-6 place-items-center rounded text-[10px] font-bold ${
                        index === 0 ? 'bg-brand text-canvas' : 'bg-inset text-ink-faint'
                      }`}
                    >
                      {index + 1}
                    </span>
                  </td>
                  {seasons.map((season) => {
                    const top = [...season.records]
                      .sort((a, b) => b.avg_temp - a.avg_temp)
                      .slice(0, 10)
                    const entry = top[index]
                    return (
                      <td key={season.key} className="numeric px-3 py-2">
                        {entry ? (
                          <>
                            <span className="font-semibold text-ink">{entry.label}</span>
                            <span className="ml-2 text-ink-faint">
                              {temp(entry.avg_temp, 2)}
                            </span>
                          </>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function SeasonsTooltip({
  active,
  payload,
  label,
  seasons,
}: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number }[]
  label?: string | number
  seasons: { key: string; label: string }[]
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <ChartTooltip
      title={`Jahr ${label}`}
      subtitle={`Gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel`}
      rows={payload.map((entry) => ({
        label:
          seasons.find((s) => s.key === entry.dataKey)?.label ?? String(entry.dataKey),
        value: temp(entry.value, 2),
      }))}
    />
  )
}
