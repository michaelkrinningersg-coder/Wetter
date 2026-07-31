import { useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { LineChart, Snowflake, Sun } from 'lucide-react'

import { useApi } from '../lib/api'
import { extremeBy } from '../lib/stats'
import { coverage, signed, temp } from '../lib/format'
import type { AnnualMeanRecord, AnnualMeansResponse } from '../types'
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
  SortHeader,
  StatGrid,
  StatTile,
} from './ui'
import { WarmingStripes } from './WarmingStripes'
import { DataQuality } from './DataQuality'

type SortKey = 'year' | 'temp' | 'anomaly'

export function AnnualMeans({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [sortKey, setSortKey] = useState<SortKey>('year')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')

  const { data, loading, error, reload } = useApi<AnnualMeansResponse>(
    `/api/weather/annual-means?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data?.records ?? [], [data])
  const overallAvg = data?.overallAvg ?? null

  const warmest = useMemo(
    () => extremeBy(records, (r) => r.avg_temp, 'max'),
    [records],
  )
  const coldest = useMemo(
    () => extremeBy(records, (r) => r.avg_temp, 'min'),
    [records],
  )

  const sorted = useMemo(() => {
    const factor = direction === 'asc' ? 1 : -1
    const value = (r: AnnualMeanRecord) =>
      sortKey === 'year'
        ? r.year
        : sortKey === 'temp'
          ? r.avg_temp
          : // Sorting by anomaly used `Math.abs` in the original, so the coldest
            // and warmest years interleaved and the column looked unsorted.
            r.anomaly
    return [...records].sort((a, b) => factor * (value(a) - value(b)))
  }, [records, sortKey, direction])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setDirection('desc')
    }
  }

  if (loading) return <Loading message="Berechne Jahresmittelwerte…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (records.length === 0) {
    return <EmptyState message="Keine Jahresmittelwerte vorhanden." />
  }

  return (
    <>
      <InfoPanel icon={LineChart} title={`Jahresmittel und Temperaturanomalien — ${stationName}`}>
        Berücksichtigt werden nur Jahre mit einer Datenabdeckung von{' '}
        <strong>mindestens 90 %</strong>. Die Anomalie beschreibt die Abweichung vom
        Gesamtmittelwert aller validierten Jahre ab {records[0]?.year} (
        {temp(overallAvg, 2)}).
      </InfoPanel>

      <Card>
        <SectionHeading
          title="Warming Stripes"
          hint="Jedes Jahr der Messreihe als ein Streifen, eingefärbt nach seiner Abweichung vom Gesamtmittel — bewusst ohne Achsen, weil es um den Gesamteindruck geht, nicht um Einzeljahre."
        />
        <WarmingStripes records={records} />
      </Card>

      <StatGrid>
        <StatTile
          label="Gesamtmittel"
          value={temp(overallAvg, 2)}
          caption={`Über ${records.length} validierte Jahre`}
          accent="brand"
        />
        <StatTile
          label="Wärmstes Jahr"
          value={temp(warmest?.avg_temp, 2)}
          caption={warmest ? `${warmest.year} · ${signed(warmest.anomaly, 2, '°C')}` : undefined}
          accent="warm"
          icon={Sun}
        />
        <StatTile
          label="Kältestes Jahr"
          value={temp(coldest?.avg_temp, 2)}
          caption={coldest ? `${coldest.year} · ${signed(coldest.anomaly, 2, '°C')}` : undefined}
          accent="cold"
          icon={Snowflake}
        />
      </StatGrid>

      <Card>
        <SectionHeading
          title="Temperaturanomalien im zeitlichen Verlauf"
          hint="Balken zeigen die Abweichung vom Gesamtmittel, die Linie das absolute Jahresmittel."
        />
        <ChartFrame height={380}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={records} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} tickLine={false} />
              <YAxis stroke={CHART.axis} tick={CHART.tick} tickLine={false} unit=" °C" />
              <Tooltip content={<MeansTooltip />} cursor={{ fill: 'oklch(100% 0 0 / 0.03)' }} />
              <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11 }} />
              {overallAvg !== null && (
                <ReferenceLine
                  y={overallAvg}
                  stroke={CHART.colors.brand}
                  strokeDasharray="5 5"
                  label={{
                    value: `Mittel ${temp(overallAvg, 2)}`,
                    fill: 'oklch(72% 0.008 260)',
                    position: 'insideTopLeft',
                    fontSize: 10,
                  }}
                />
              )}
              <Bar
                name="Abweichung"
                dataKey="anomaly"
                fill={CHART.colors.cool}
                fillOpacity={0.5}
                maxBarSize={8}
              />
              <Line
                name="Ø Temperatur"
                dataKey="avg_temp"
                stroke={CHART.colors.warm}
                strokeWidth={1.5}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Card>

      <DataQuality stationId={stationId} />

      <Card>
        <SectionHeading title={`Jahreswerte (${records.length} validierte Jahre)`} />
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky-head">
              <tr className="border-b border-line">
                <SortHeader
                  label="Jahr"
                  active={sortKey === 'year'}
                  direction={direction}
                  onClick={() => toggleSort('year')}
                />
                <SortHeader
                  label="Jahresmittel"
                  active={sortKey === 'temp'}
                  direction={direction}
                  onClick={() => toggleSort('temp')}
                />
                <SortHeader
                  label="Abweichung"
                  active={sortKey === 'anomaly'}
                  direction={direction}
                  onClick={() => toggleSort('anomaly')}
                />
                <th scope="col" className="label px-3 py-2.5">Datenabdeckung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {sorted.map((r) => (
                <tr key={r.year} className="transition-colors hover:bg-raised">
                  <td className="numeric px-3 py-2 font-semibold text-ink">{r.year}</td>
                  <td className="numeric px-3 py-2 font-semibold text-ink">
                    {temp(r.avg_temp, 2)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`numeric inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        r.anomaly >= 0
                          ? 'bg-warm/10 text-warm'
                          : 'bg-cool/10 text-cool'
                      }`}
                    >
                      {signed(r.anomaly, 2, '°C')}
                    </span>
                  </td>
                  <td className="numeric px-3 py-2 text-ink-faint">
                    {coverage(r.valid_days, r.total_days)}
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

function MeansTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { payload: AnnualMeanRecord }[]
  label?: string | number
}) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null

  return (
    <ChartTooltip
      title={`Jahr ${label}`}
      rows={[
        { label: 'Ø Temperatur', value: temp(r.avg_temp, 2) },
        {
          label: 'Abweichung',
          value: signed(r.anomaly, 2, '°C'),
          className: r.anomaly >= 0 ? 'text-warm' : 'text-cool',
        },
      ]}
      footer={`Datenabdeckung ${coverage(r.valid_days, r.total_days)}`}
    />
  )
}
