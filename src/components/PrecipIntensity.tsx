import { useMemo, useState } from 'react'
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
import { CloudRain, Droplets, Gauge } from 'lucide-react'

import { useApi } from '../lib/api'
import { centeredMovingAverage, linearFit, mean } from '../lib/stats'
import { mm, num, percent, signed } from '../lib/format'
import type { PrecipIntensityResponse } from '../types'
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

const SMOOTH_WINDOW = 30

const INDICES = [
  { value: 'heavy', label: 'Feste Schwelle' },
  { value: 'r95', label: 'WMO-Index R95p' },
] as const

type Index = (typeof INDICES)[number]['value']

export function PrecipIntensity({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [index, setIndex] = useState<Index>('heavy')

  const { data, loading, error, reload } = useApi<PrecipIntensityResponse>(
    `/api/weather/precip-intensity?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data?.records ?? [], [data])
  const field = index === 'heavy' ? 'heavyShare' : 'r95Share'

  const points = useMemo(() => {
    const smoothHeavy = centeredMovingAverage(
      records.map((r) => ({ x: r.year, y: r.heavyShare })),
      SMOOTH_WINDOW,
    )
    const smoothR95 = centeredMovingAverage(
      records.map((r) => ({ x: r.year, y: r.r95Share })),
      SMOOTH_WINDOW,
    )
    return records.map((r) => ({
      ...r,
      smoothHeavy: smoothHeavy.get(r.year) ?? null,
      smoothR95: smoothR95.get(r.year) ?? null,
    }))
  }, [records])

  const summary = useMemo(() => {
    if (records.length < 60) return null
    const first = records[0]!.year
    const last = records[records.length - 1]!.year
    const early = records.filter((r) => r.year <= first + 29)
    const recent = records.filter((r) => r.year >= last - 29)

    const fitOf = (key: 'heavyShare' | 'r95Share' | 'total') => {
      const fit = linearFit(records.map((r) => ({ x: r.year, y: r[key] })))
      return fit ? { perDecade: fit.slope * 10, significant: fit.isSignificant } : null
    }

    return {
      earlyLabel: `${early[0]!.year}–${early[early.length - 1]!.year}`,
      recentLabel: `${recent[0]!.year}–${recent[recent.length - 1]!.year}`,
      heavyEarly: mean(early.map((r) => r.heavyShare)),
      heavyRecent: mean(recent.map((r) => r.heavyShare)),
      r95Early: mean(early.map((r) => r.r95Share)),
      r95Recent: mean(recent.map((r) => r.r95Share)),
      totalEarly: mean(early.map((r) => r.total)),
      totalRecent: mean(recent.map((r) => r.total)),
      totalTrend: fitOf('total'),
      heavyTrend: fitOf('heavyShare'),
      r95Trend: fitOf('r95Share'),
    }
  }, [records])

  if (loading) return <Loading message="Berechne Niederschlagsintensität…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (records.length === 0) {
    return <EmptyState message="Keine Niederschlagsdaten vorhanden." />
  }

  return (
    <>
      <InfoPanel icon={CloudRain} title={`Niederschlagsintensität — ${stationName}`}>
        Die Jahressumme allein sagt wenig darüber, wie der Regen fällt. Zwei Indizes
        beschreiben, welcher Anteil davon auf wenige intensive Tage entfällt:
        <br />
        <strong>Feste Schwelle</strong> — Anteil aus Tagen mit mindestens{' '}
        {data?.heavyThreshold ?? 20} mm. Sofort verständlich, aber die Schwelle bedeutet
        an jeder Station etwas anderes.
        <br />
        <strong>R95p</strong> — Anteil aus Tagen über dem 95. Perzentil aller Regentage
        der Referenzperiode {data?.r95From}–{data?.r95To}
        {data?.r95Threshold !== null && data?.r95Threshold !== undefined && (
          <> (hier {mm(data.r95Threshold)})</>
        )}
        . Der WMO-Standard, über Stationen hinweg vergleichbar.
      </InfoPanel>

      {summary && (
        <StatGrid>
          <StatTile
            label="Jahressumme"
            value={mm(summary.totalRecent, 0)}
            caption={`${summary.recentLabel} · ${signed(
              summary.totalRecent !== null && summary.totalEarly !== null
                ? summary.totalRecent - summary.totalEarly
                : null,
              0,
              'mm',
            )} gegenüber ${summary.earlyLabel}`}
            accent="wet"
            icon={Droplets}
          />
          <StatTile
            label={`Anteil aus Tagen ab ${data?.heavyThreshold ?? 20} mm`}
            value={percent(summary.heavyRecent, 1)}
            caption={`${signed(
              summary.heavyRecent !== null && summary.heavyEarly !== null
                ? summary.heavyRecent - summary.heavyEarly
                : null,
              1,
              'Prozentpunkte',
            )} gegenüber ${summary.earlyLabel}`}
            accent="brand"
            icon={CloudRain}
          />
          <StatTile
            label="Anteil R95p"
            value={percent(summary.r95Recent, 1)}
            caption={`${signed(
              summary.r95Recent !== null && summary.r95Early !== null
                ? summary.r95Recent - summary.r95Early
                : null,
              1,
              'Prozentpunkte',
            )} gegenüber ${summary.earlyLabel}`}
            accent="cool"
            icon={Gauge}
          />
          <StatTile
            label="Trend der Intensität"
            value={signed(
              index === 'heavy'
                ? summary.heavyTrend?.perDecade
                : summary.r95Trend?.perDecade,
              2,
              'Pp.',
            )}
            caption={`Je Jahrzehnt · ${
              (index === 'heavy' ? summary.heavyTrend : summary.r95Trend)?.significant
                ? 'signifikant (95 %)'
                : 'nicht signifikant'
            }`}
            accent="warm"
          />
        </StatGrid>
      )}

      {summary?.totalTrend && (
        <Card className="border-brand/20 bg-brand/[0.04]">
          <p className="text-xs leading-relaxed text-ink-muted">
            <strong className="text-ink">Die Kernaussage:</strong> Die Jahressumme
            verändert sich mit {signed(summary.totalTrend.perDecade, 1, 'mm')} je
            Jahrzehnt{' '}
            {summary.totalTrend.significant ? 'signifikant' : 'nicht signifikant'} — der
            Anteil, der an wenigen intensiven Tagen fällt, steigt jedoch von{' '}
            {percent(summary.heavyEarly, 1)} auf {percent(summary.heavyRecent, 1)}. Es
            regnet also nicht unbedingt mehr, sondern konzentrierter.
          </p>
        </Card>
      )}

      <Card>
        <SectionHeading
          title="Anteil des Starkregens an der Jahressumme"
          hint={`Balken: Einzeljahre. Linie: gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel, zentriert.`}
          actions={
            <ChoiceGroup label="Index" value={index} choices={INDICES} onChange={setIndex} size="sm" />
          }
        />
        <ChartFrame height={380}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
              <YAxis stroke={CHART.axis} tick={CHART.tick} tickLine={false} unit=" %" />
              <Tooltip
                content={<IntensityTooltip threshold={data?.heavyThreshold ?? 20} />}
                cursor={{ fill: 'oklch(100% 0 0 / 0.03)' }}
              />
              <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
              <Bar
                name={index === 'heavy' ? `Anteil aus Tagen ab ${data?.heavyThreshold ?? 20} mm` : 'Anteil R95p'}
                dataKey={field}
                fill={CHART.colors.wet}
                fillOpacity={0.45}
                radius={[2, 2, 0, 0]}
                maxBarSize={14}
              />
              <Line
                name={`Gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel`}
                type="monotone"
                dataKey={index === 'heavy' ? 'smoothHeavy' : 'smoothR95'}
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

      <Card padded={false}>
        <div className="p-5 pb-0 sm:p-6 sm:pb-0">
          <SectionHeading title={`Jahreswerte (${records.length} Jahre)`} />
        </div>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="sticky-head">
              <tr className="border-y border-line">
                <th scope="col" className="label px-3 py-2.5">Jahr</th>
                <th scope="col" className="label px-3 py-2.5">Jahressumme</th>
                <th scope="col" className="label px-3 py-2.5">
                  Anteil ab {data?.heavyThreshold ?? 20} mm
                </th>
                <th scope="col" className="label px-3 py-2.5">Anteil R95p</th>
                <th scope="col" className="label px-3 py-2.5">Starkregentage</th>
                <th scope="col" className="label px-3 py-2.5">Regentage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {[...records].reverse().map((r) => (
                <tr key={r.year} className="transition-colors hover:bg-raised">
                  <td className="numeric px-3 py-2 font-semibold text-ink">{r.year}</td>
                  <td className="numeric px-3 py-2 text-wet">{mm(r.total, 0)}</td>
                  <td className="numeric px-3 py-2 font-semibold text-ink">
                    {percent(r.heavyShare, 1)}
                  </td>
                  <td className="numeric px-3 py-2 text-cool">{percent(r.r95Share, 1)}</td>
                  <td className="numeric px-3 py-2 text-ink-muted">{num(r.heavyDays, 0)}</td>
                  <td className="numeric px-3 py-2 text-ink-faint">{num(r.wetDays, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function IntensityTooltip({
  active,
  payload,
  label,
  threshold,
}: {
  active?: boolean
  payload?: { payload: { total: number; heavyShare: number; r95Share: number; heavyDays: number } }[]
  label?: string | number
  threshold: number
}) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null

  return (
    <ChartTooltip
      title={`Jahr ${label}`}
      rows={[
        { label: 'Jahressumme', value: mm(r.total, 0), className: 'text-wet' },
        { label: `Anteil ab ${threshold} mm`, value: percent(r.heavyShare, 1) },
        { label: 'Anteil R95p', value: percent(r.r95Share, 1), className: 'text-cool' },
      ]}
      footer={`${r.heavyDays} Tage mit mindestens ${threshold} mm`}
    />
  )
}
