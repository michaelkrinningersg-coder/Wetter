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
import { CloudRain, Droplets, Gauge, Waves } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { centeredMovingAverage, linearFit, mean } from '../lib/stats'
import { isoToGerman, mm, num, percent, signed } from '../lib/format'
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
  StatTile,
} from './ui'
import { DataQuality } from './DataQuality'

const SMOOTH_WINDOW = 30

const INDICES = [
  { value: 'heavy', label: 'Feste Schwelle' },
  { value: 'r95', label: 'WMO-Index R95p' },
  { value: 'rx5', label: 'Max. 5-Tages-Summe' },
] as const

type Index = (typeof INDICES)[number]['value']

export function PrecipIntensity({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [index, setIndex] = useUrlState<Index>('kennzahl', 'heavy')

  const { data, loading, error, reload } = useApi<PrecipIntensityResponse>(
    `/api/weather/precip-intensity?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data?.records ?? [], [data])
  const field =
    index === 'heavy' ? 'heavyShare' : index === 'r95' ? 'r95Share' : 'rx5day'
  /** RX5day is a millimetre total, the other two are percentages. */
  const isAmount = index === 'rx5'

  const points = useMemo(() => {
    const smoothHeavy = centeredMovingAverage(
      records.map((r) => ({ x: r.year, y: r.heavyShare })),
      SMOOTH_WINDOW,
    )
    const smoothR95 = centeredMovingAverage(
      records.map((r) => ({ x: r.year, y: r.r95Share })),
      SMOOTH_WINDOW,
    )
    const smoothRx5 = centeredMovingAverage(
      records.filter((r) => r.rx5day !== null).map((r) => ({ x: r.year, y: r.rx5day! })),
      SMOOTH_WINDOW,
    )
    return records.map((r) => ({
      ...r,
      smoothHeavy: smoothHeavy.get(r.year) ?? null,
      smoothR95: smoothR95.get(r.year) ?? null,
      smoothRx5: smoothRx5.get(r.year) ?? null,
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

    const withRx5 = records.filter((r) => r.rx5day !== null)
    const rx5Fit = linearFit(withRx5.map((r) => ({ x: r.year, y: r.rx5day! })))
    const allTimeRx5 = withRx5.reduce<typeof withRx5[number] | null>(
      (best, r) => (!best || r.rx5day! > best.rx5day! ? r : best),
      null,
    )

    return {
      earlyLabel: `${early[0]!.year}–${early[early.length - 1]!.year}`,
      recentLabel: `${recent[0]!.year}–${recent[recent.length - 1]!.year}`,
      heavyEarly: mean(early.map((r) => r.heavyShare)),
      heavyRecent: mean(recent.map((r) => r.heavyShare)),
      r95Early: mean(early.map((r) => r.r95Share)),
      r95Recent: mean(recent.map((r) => r.r95Share)),
      totalEarly: mean(early.map((r) => r.total)),
      totalRecent: mean(recent.map((r) => r.total)),
      rx5Early: mean(early.filter((r) => r.rx5day !== null).map((r) => r.rx5day!)),
      rx5Recent: mean(recent.filter((r) => r.rx5day !== null).map((r) => r.rx5day!)),
      allTimeRx5,
      totalTrend: fitOf('total'),
      heavyTrend: fitOf('heavyShare'),
      r95Trend: fitOf('r95Share'),
      rx5Trend: rx5Fit
        ? { perDecade: rx5Fit.slope * 10, significant: rx5Fit.isSignificant }
        : null,
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
        Die Jahressumme allein sagt wenig darüber, wie der Regen fällt. Drei Indizes
        beschreiben, wie stark er sich auf wenige Tage konzentriert:
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
        <br />
        <strong>Max. {data?.rxWindow ?? 5}-Tages-Summe</strong> (RX5day) — der höchste
        Niederschlag über {data?.rxWindow ?? 5} aufeinanderfolgende Tage eines Jahres.
        Nicht ein Anteil, sondern eine Menge: das Standardmaß dafür, wie viel Wasser in
        kurzer Zeit zusammenkommt und damit für Hochwasser relevant wird. Ein Fenster
        zählt nur, wenn alle {data?.rxWindow ?? 5} Tage lückenlos vorliegen.
      </InfoPanel>

      {summary && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
            label={`Max. ${data?.rxWindow ?? 5}-Tages-Summe`}
            value={mm(summary.rx5Recent, 0)}
            caption={`${signed(
              summary.rx5Recent !== null && summary.rx5Early !== null
                ? summary.rx5Recent - summary.rx5Early
                : null,
              0,
              'mm',
            )} gegenüber ${summary.earlyLabel}`}
            accent="cold"
            icon={Waves}
          />
          <StatTile
            label="Trend der Intensität"
            value={
              index === 'rx5'
                ? signed(summary.rx5Trend?.perDecade, 1, 'mm')
                : signed(
                    index === 'heavy'
                      ? summary.heavyTrend?.perDecade
                      : summary.r95Trend?.perDecade,
                    2,
                    'Pp.',
                  )
            }
            caption={`Je Jahrzehnt · ${
              (index === 'heavy'
                ? summary.heavyTrend
                : index === 'r95'
                  ? summary.r95Trend
                  : summary.rx5Trend
              )?.significant
                ? 'signifikant (95 %)'
                : 'nicht signifikant'
            }`}
            accent="warm"
          />
        </div>
      )}

      {summary?.allTimeRx5 && (
        <Card className="border-cold/25 bg-cold/[0.05]">
          <p className="text-xs leading-relaxed text-ink-muted">
            <strong className="text-ink">Höchste {data?.rxWindow ?? 5}-Tages-Summe der
            Messreihe:</strong>{' '}
            <span className="numeric font-semibold text-cold">
              {mm(summary.allTimeRx5.rx5day, 1)}
            </span>{' '}
            vom {isoToGerman(summary.allTimeRx5.rx5Start)} bis{' '}
            {isoToGerman(summary.allTimeRx5.rx5End)} — mehr als ein Fünftel dessen, was
            in einem durchschnittlichen Jahr insgesamt fällt.
          </p>
        </Card>
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
          title={
            isAmount
              ? `Höchste ${data?.rxWindow ?? 5}-Tages-Summe je Jahr`
              : 'Anteil des Starkregens an der Jahressumme'
          }
          hint={`Balken: Einzeljahre. Linie: gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel, zentriert.`}
          actions={
            <ChoiceGroup label="Index" value={index} choices={INDICES} onChange={setIndex} size="sm" />
          }
        />
        <ChartFrame height={380}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              // Millimetre values reach three digits; the tighter negative
              // margin used for the percentage views clips their axis labels.
              margin={{ top: 8, right: 8, left: isAmount ? -4 : -20, bottom: 4 }}
            >
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
              <YAxis
                stroke={CHART.axis}
                tick={CHART.tick}
                tickLine={false}
                unit={isAmount ? ' mm' : ' %'}
                width={isAmount ? 62 : 48}
              />
              <Tooltip
                content={
                  <IntensityTooltip
                    threshold={data?.heavyThreshold ?? 20}
                    window={data?.rxWindow ?? 5}
                  />
                }
                cursor={{ fill: CHART.cursorSoft }}
              />
              <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
              <Bar
                name={
                  index === 'heavy'
                    ? `Anteil aus Tagen ab ${data?.heavyThreshold ?? 20} mm`
                    : index === 'r95'
                      ? 'Anteil R95p'
                      : `Höchste ${data?.rxWindow ?? 5}-Tages-Summe`
                }
                dataKey={field}
                fill={CHART.colors.wet}
                fillOpacity={0.45}
                radius={[2, 2, 0, 0]}
                maxBarSize={14}
              />
              <Line
                name={`Gleitendes ${SMOOTH_WINDOW}-Jahres-Mittel`}
                type="monotone"
                dataKey={
                  index === 'heavy'
                    ? 'smoothHeavy'
                    : index === 'r95'
                      ? 'smoothR95'
                      : 'smoothRx5'
                }
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
                <th scope="col" className="label px-3 py-2.5">
                  Max. {data?.rxWindow ?? 5} Tage
                </th>
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
                  <td
                    className="numeric px-3 py-2 text-cold"
                    title={
                      r.rx5Start && r.rx5End
                        ? `${isoToGerman(r.rx5Start)} bis ${isoToGerman(r.rx5End)}`
                        : undefined
                    }
                  >
                    {mm(r.rx5day, 1)}
                  </td>
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
  window: windowDays,
}: {
  active?: boolean
  payload?: {
    payload: {
      total: number
      heavyShare: number
      r95Share: number
      heavyDays: number
      rx5day: number | null
      rx5Start: string | null
      rx5End: string | null
    }
  }[]
  label?: string | number
  threshold: number
  window: number
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
        {
          label: `Max. ${windowDays} Tage`,
          value: mm(r.rx5day, 1),
          className: 'text-cold',
        },
      ]}
      footer={
        r.rx5Start && r.rx5End
          ? `Stärkstes Fenster ${isoToGerman(r.rx5Start)} bis ${isoToGerman(r.rx5End)}`
          : `${r.heavyDays} Tage mit mindestens ${threshold} mm`
      }
    />
  )
}
