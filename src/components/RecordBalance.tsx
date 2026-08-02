import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Scale, Snowflake, Sun } from 'lucide-react'

import { useApi } from '../lib/api'
import { monthName, temp } from '../lib/format'
import type { RecordBalanceResponse, RecordHolder } from '../types'
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
  StatGrid,
  StatTile,
} from './ui'
import { DataQuality } from './DataQuality'

export function RecordBalance({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const { data, loading, error, reload } = useApi<RecordBalanceResponse>(
    `/api/weather/records-balance?stationId=${encodeURIComponent(stationId)}`,
  )

  const chart = useMemo(
    () =>
      (data?.byDecade ?? []).map((d) => ({
        ...d,
        // Cold records point downwards, so the imbalance is visible as a shape
        // rather than as two bars the reader has to compare by eye.
        coldNegative: -d.cold,
      })),
    [data],
  )

  /** Warm-to-cold ratio over the most recent three complete decades. */
  const recent = useMemo(() => {
    if (!data || data.byDecade.length < 4) return null
    const decades = data.byDecade.slice(-4, -1)
    const warm = decades.reduce((s, d) => s + d.warm, 0)
    const cold = decades.reduce((s, d) => s + d.cold, 0)
    return {
      warm,
      cold,
      label: `${decades[0]!.decade}er–${decades[decades.length - 1]!.decade}er`,
      ratio: cold > 0 ? warm / cold : null,
    }
  }, [data])

  if (loading) return <Loading message="Ermittle Tagesrekorde…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data || data.byDecade.length === 0) {
    return <EmptyState message="Keine Rekorddaten vorhanden." />
  }

  return (
    <>
      <InfoPanel icon={Scale} title={`Rekordbilanz — ${stationName}`}>
        Für jeden Kalendertag gibt es genau <strong>einen</strong> gültigen
        Wärmerekord und einen Kälterekord. Diese Ansicht fragt, in welchem Jahrzehnt
        sie aufgestellt wurden. Gezählt werden ausschließlich die{' '}
        <strong>heute noch stehenden</strong> Rekorde — eine Zählung nach dem Muster
        „war das wärmer als alles bisher Gesehene?" wäre zwangsläufig zu frühen
        Jahrzehnten hin verzerrt, weil am Anfang einer Messreihe fast jeder Wert ein
        Rekord ist. In einem stabilen Klima müssten sich die {data.warmRecordCount}{' '}
        Wärme- und {data.coldRecordCount} Kälterekorde gleichmäßig über die Jahrzehnte
        verteilen, im Mittel etwa {data.expectedPerDecade} je Jahrzehnt und Kategorie.
      </InfoPanel>

      <StatGrid>
        <StatTile
          label="Stehende Wärmerekorde"
          value={String(data.warmRecordCount)}
          caption="Je einer für jeden Kalendertag"
          accent="warm"
          icon={Sun}
        />
        <StatTile
          label="Stehende Kälterekorde"
          value={String(data.coldRecordCount)}
          caption="Je einer für jeden Kalendertag"
          accent="cold"
          icon={Snowflake}
        />
        <StatTile
          label="Erwartung je Jahrzehnt"
          value={String(data.expectedPerDecade)}
          caption={`Bei stabilem Klima, über ${data.measuredYears} Messjahre`}
          accent="neutral"
        />
        {recent && (
          <StatTile
            label="Verhältnis warm zu kalt"
            value={recent.ratio !== null ? `${recent.ratio.toFixed(1)} : 1` : '—'}
            caption={`${recent.label} · ${recent.warm} Wärme-, ${recent.cold} Kälterekorde`}
            accent="brand"
            icon={Scale}
          />
        )}
      </StatGrid>

      <Card>
        <SectionHeading
          title="Wann wurden die heute gültigen Rekorde aufgestellt?"
          hint="Wärmerekorde nach oben, Kälterekorde nach unten. Die gestrichelten Linien markieren, wie viele Rekorde ein Jahrzehnt bei gleichmäßiger Verteilung halten würde."
        />
        <ChartFrame height={380}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 8, left: -20, bottom: 4 }} stackOffset="sign">
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="decade"
                stroke={CHART.axis}
                tick={CHART.tick}
                tickLine={false}
                tickFormatter={(v: number) => `${v}er`}
              />
              <YAxis
                stroke={CHART.axis}
                tick={CHART.tick}
                tickLine={false}
                tickFormatter={(v: number) => String(Math.abs(v))}
              />
              <Tooltip content={<BalanceTooltip />} cursor={{ fill: CHART.cursorSoft }} />
              <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke={CHART.axis} />
              <ReferenceLine
                y={data.expectedPerDecade}
                stroke={CHART.colors.neutral}
                strokeDasharray="4 4"
              />
              <ReferenceLine
                y={-data.expectedPerDecade}
                stroke={CHART.colors.neutral}
                strokeDasharray="4 4"
              />
              <Bar
                name="Wärmerekorde"
                dataKey="warm"
                fill={CHART.colors.warm}
                fillOpacity={0.8}
                radius={[3, 3, 0, 0]}
                maxBarSize={38}
              />
              <Bar
                name="Kälterekorde"
                dataKey="coldNegative"
                fill={CHART.colors.cold}
                fillOpacity={0.8}
                radius={[0, 0, 3, 3]}
                maxBarSize={38}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          Das jüngste Jahrzehnt ist unvollständig und hält daher zwangsläufig weniger
          Rekorde, als es am Ende halten wird.
        </p>
      </Card>

      <DataQuality stationId={stationId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecordList
          title="Höchste stehende Wärmerekorde"
          records={data.topWarm}
          accent="text-warm"
        />
        <RecordList
          title="Tiefste stehende Kälterekorde"
          records={data.topCold}
          accent="text-cold"
        />
      </div>
    </>
  )
}

function RecordList({
  title,
  records,
  accent,
}: {
  title: string
  records: RecordHolder[]
  accent: string
}) {
  return (
    <Card padded={false}>
      <div className="p-5 pb-0 sm:p-6 sm:pb-0">
        <SectionHeading title={title} />
      </div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-y border-line bg-raised">
            <th scope="col" className="label px-3 py-2.5">Kalendertag</th>
            <th scope="col" className="label px-3 py-2.5">Aufgestellt</th>
            <th scope="col" className="label px-3 py-2.5">Wert</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {records.map((r) => (
            <tr key={`${r.month}-${r.day}`} className="transition-colors hover:bg-raised">
              <td className="px-3 py-2 text-ink">
                {r.day}. {monthName(r.month)}
              </td>
              <td className="numeric px-3 py-2 font-semibold text-ink-muted">{r.year}</td>
              <td className={`numeric px-3 py-2 font-semibold ${accent}`}>
                {temp(r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function BalanceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { payload: { warm: number; cold: number } }[]
  label?: string | number
}) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null

  return (
    <ChartTooltip
      title={`${label}er Jahre`}
      rows={[
        { label: 'Wärmerekorde', value: String(d.warm), className: 'text-warm' },
        { label: 'Kälterekorde', value: String(d.cold), className: 'text-cold' },
      ]}
      footer={
        d.cold > 0
          ? `Verhältnis ${(d.warm / d.cold).toFixed(1)} : 1`
          : 'Kein Kälterekord aus diesem Jahrzehnt'
      }
    />
  )
}
