import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Gauge, TrendingDown, Wind } from 'lucide-react'

import { useApi } from '../lib/api'
import { isoToGerman, num, signed } from '../lib/format'
import { linearFit } from '../lib/stats'
import type { PressureBand, PressureResponse } from '../types'
import {
  CHART,
  Card,
  ChartFrame,
  ChartTooltip,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/** Wind is published in metres per second and read in kilometres per hour. */
const kmh = (ms: number) => `${num(ms * 3.6, 0)} km/h`

function BandChart({
  bands,
  unit,
  label,
  diverging = false,
}: {
  bands: PressureBand[]
  unit: string
  label: string
  diverging?: boolean
}) {
  const rows = bands.map((b) => ({ ...b, band: `${b.from}` }))

  return (
    <ChartFrame height={260}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="band"
            stroke={CHART.axis}
            tick={CHART.tick}
            label={{
              value: label,
              position: 'insideBottom',
              offset: -8,
              fill: CHART.axis,
              fontSize: 11,
            }}
          />
          <YAxis
            stroke={CHART.axis}
            tick={CHART.tick}
            width={44}
            label={{
              value: 'm/s',
              angle: -90,
              position: 'insideLeft',
              fill: CHART.axis,
              fontSize: 11,
            }}
          />
          {diverging && <ReferenceLine x="0" stroke={CHART.axis} strokeDasharray="4 4" />}
          <Tooltip
            cursor={{ fill: CHART.cursor }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]!.payload as (typeof rows)[number]
              return (
                <ChartTooltip
                  title={`${row.from} bis ${row.to} ${unit}`}
                  subtitle={`${num(row.days, 0)} Tage`}
                  rows={[
                    { label: 'Mittlere Bö', value: `${num(row.mean, 1)} m/s · ${kmh(row.mean)}` },
                    { label: 'Stärkste Bö', value: `${num(row.max, 1)} m/s · ${kmh(row.max)}` },
                  ]}
                />
              )
            }}
          />
          <Bar dataKey="mean" radius={[3, 3, 0, 0]}>
            {rows.map((row) => (
              <Cell
                key={row.from}
                fill={
                  diverging
                    ? row.from < 0
                      ? CHART.colors.warm
                      : CHART.colors.cool
                    : CHART.colors.brand
                }
                fillOpacity={0.4 + Math.min(row.mean / 20, 0.55)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */

export function Pressure({ stationId, stationName }: { stationId: string; stationName: string }) {
  const { data, loading, error } = useApi<PressureResponse>(
    `/api/weather/pressure?stationId=${stationId}`,
    [stationId],
  )

  if (loading && !data) return <Loading message="Luftdruckreihe wird ausgewertet …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { wind, range } = data
  const trend = linearFit(data.annual.map((a) => ({ x: a.year, y: a.mean })))
  const deepTrend = linearFit(data.annual.map((a) => ({ x: a.year, y: a.deep })))

  const lowest = data.extremes.lowest[0]
  const highest = data.extremes.highest[0]

  const annualRows = data.annual.map((a) => ({
    ...a,
    fit: trend ? trend.intercept + trend.slope * a.year : null,
  }))

  return (
    <div className="space-y-6">
      <InfoPanel title={`Luftdruck in ${stationName}`}>
        <p>
          Die längste Reihe dieser Anwendung nach der Temperatur:{' '}
          {num(range.days, 0)} Tage von {isoToGerman(range.first)} bis{' '}
          {isoToGerman(range.last)}. Sie wurde bisher nur für zwei Rekordlisten
          gelesen — dabei ist der Luftdruck die einzige Größe hier, die etwas
          über die Mechanik des Wetters sagt statt über sein Ergebnis.
        </p>
        <p>
          <strong className="text-ink">{data.note}</strong>
        </p>
      </InfoPanel>

      <StatGrid>
        <StatTile
          label="Tiefster Wert"
          value={`${num(lowest?.pressure ?? 0, 1)} hPa`}
          caption={lowest ? isoToGerman(lowest.date) : undefined}
          accent="cold"
          icon={TrendingDown}
        />
        <StatTile
          label="Höchster Wert"
          value={`${num(highest?.pressure ?? 0, 1)} hPa`}
          caption={highest ? isoToGerman(highest.date) : undefined}
          accent="warm"
          icon={Gauge}
        />
        <StatTile
          label="Tiefdrucktage"
          value={num(wind.deep.days, 0)}
          caption={`unter ${num(wind.deep.limit, 1)} hPa — das unterste Prozent der Reihe`}
          accent="cool"
        />
        <StatTile
          label="Trend des Jahresmittels"
          value={trend ? `${num(trend.slope * 10, 2)} hPa` : '—'}
          caption={
            trend
              ? `je Jahrzehnt · R² ${num(trend.r2, 2)}${trend.isSignificant ? '' : ' · nicht signifikant'}`
              : undefined
          }
          accent="neutral"
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Wind}
          title="Was der Druck mit dem Wind macht"
          hint={`Aus ${num(wind.days, 0)} Tagen, an denen beides gemessen wurde.`}
        />

        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
          An den {num(wind.deep.days, 0)} Tagen im untersten Druckprozent liegt
          die mittlere Bö bei{' '}
          <strong className="text-ink">{num(wind.deep.meanGust ?? 0, 1)} m/s</strong>{' '}
          ({kmh(wind.deep.meanGust ?? 0)}) gegen{' '}
          {num(wind.deep.otherMeanGust ?? 0, 1)} m/s an allen übrigen — knapp die
          Hälfte mehr. Noch deutlicher sind die stärksten Druckstürze: an den{' '}
          {num(wind.fall.days, 0)} Tagen mit mehr als{' '}
          {num(Math.abs(wind.fall.limit ?? 0), 1)} hPa Fall binnen eines Tages
          werden im Mittel{' '}
          <strong className="text-ink">{num(wind.fall.meanGust ?? 0, 1)} m/s</strong>{' '}
          erreicht.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div>
            <p className="label mb-2">Mittlere Bö nach Druckband</p>
            <BandChart bands={wind.byPressure} unit="hPa" label="Luftdruck (hPa)" />
            <p className="mt-2 text-[11px] text-ink-faint">
              Streng monoton: von {num(wind.byPressure.at(-1)?.mean ?? 0, 1)} m/s im
              höchsten Band auf {num(wind.byPressure[0]?.mean ?? 0, 1)} im tiefsten.
            </p>
          </div>

          <div>
            <p className="label mb-2">Mittlere Bö nach Tagesänderung</p>
            <BandChart bands={wind.byChange} unit="hPa" label="Änderung zum Vortag (hPa)" diverging />
            <p className="mt-2 text-[11px] text-ink-faint">
              Hier liegt eine U-Form: nicht nur der Sturz, auch der starke
              Anstieg dahinter bringt Wind. Deshalb ist die einfache Korrelation
              mit der vorzeichenbehafteten Änderung nur{' '}
              <span className="numeric">{num(wind.correlation.change ?? 0, 2)}</span>,
              die mit ihrem Betrag aber{' '}
              <span className="numeric">{num(wind.correlation.magnitude ?? 0, 2)}</span>.
            </p>
          </div>
        </div>

        <p className="mt-4 border-t border-line pt-3 text-[11px] text-ink-faint">
          Bänder unter {data.minDaysPerBand} Tagen sind weggelassen — sie zeigten
          einen einzelnen Sturm statt eines Musters. Korrelation mit dem Druck
          selbst: <span className="numeric">{num(wind.correlation.pressure ?? 0, 2)}</span>.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Gauge}
          title="Jahresmittel und Tiefdrucktage"
          hint={`Nur Jahre mit mindestens ${data.minDaysPerYear} Messtagen — dieselbe 90-%-Regel wie überall.`}
        />

        <div className="mt-4">
          <ChartFrame height={320}>
            <ResponsiveContainer>
              <ComposedChart data={annualRows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} minTickGap={40} />
                <YAxis
                  yAxisId="p"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={52}
                  domain={['dataMin - 1', 'dataMax + 1']}
                  // Without this the ticks are the raw domain bounds — sixteen
                  // digits of float that overflow the axis and show only their
                  // tail, so 1000.3076712328767 renders as "2328767".
                  tickFormatter={(v: number) => num(v, 0)}
                  label={{
                    value: 'hPa',
                    angle: -90,
                    position: 'insideLeft',
                    fill: CHART.axis,
                    fontSize: 11,
                  }}
                />
                <YAxis
                  yAxisId="d"
                  orientation="right"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={36}
                  allowDecimals={false}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof annualRows)[number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        subtitle={`${num(row.days, 0)} Messtage`}
                        rows={[
                          { label: 'Jahresmittel', value: `${num(row.mean, 1)} hPa` },
                          {
                            label: 'Spanne',
                            value: `${num(row.min, 1)} bis ${num(row.max, 1)} hPa`,
                          },
                          {
                            label: 'Tiefdrucktage',
                            value: num(row.deep, 0),
                            className: 'text-cool',
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Bar
                  yAxisId="d"
                  dataKey="deep"
                  fill={CHART.colors.cool}
                  fillOpacity={0.3}
                  radius={[2, 2, 0, 0]}
                />
                <Line
                  yAxisId="p"
                  type="monotone"
                  dataKey="mean"
                  stroke={CHART.colors.brand}
                  strokeWidth={1.5}
                  dot={false}
                />
                {trend && (
                  <Line
                    yAxisId="p"
                    type="linear"
                    dataKey="fit"
                    stroke={CHART.colors.brand}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 text-[11px] text-ink-muted">
          Balken sind Tiefdrucktage (rechte Achse), die Linie das Jahresmittel
          (linke). Über {range.years} vollständige Jahre bewegt sich das Mittel
          kaum: {trend ? `${num(trend.slope * 10, 2)} hPa je Jahrzehnt` : '—'} bei
          R² {trend ? num(trend.r2, 2) : '—'}
          {deepTrend && (
            <>
              , die Zahl der Tiefdrucktage um{' '}
              {signed(deepTrend.slope * 10, 2)} je Jahrzehnt
            </>
          )}
          . Das ist der Gegensatz zur Temperatur, die im selben Zeitraum klar
          steigt — Luftdruck ist eine Größe ohne Trend, und genau das zu sehen
          hat seinen Wert.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeading icon={TrendingDown} title="Die zehn tiefsten Tage" />
          <ol className="mt-3 space-y-1">
            {data.extremes.lowest.map((row, i) => (
              <li key={row.date} className="flex items-baseline gap-3 text-[11px]">
                <span className="w-4 shrink-0 text-ink-faint">{i + 1}.</span>
                <span className="numeric w-20 shrink-0 font-semibold text-cold">
                  {num(row.pressure, 1)}
                </span>
                <span className="w-24 shrink-0 text-ink-muted">{isoToGerman(row.date)}</span>
                <span className="numeric text-ink-faint">
                  {row.wind_max === null ? '—' : `Bö ${num(row.wind_max, 1)} m/s`}
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <SectionHeading icon={Gauge} title="Die zehn höchsten Tage" />
          <ol className="mt-3 space-y-1">
            {data.extremes.highest.map((row, i) => (
              <li key={row.date} className="flex items-baseline gap-3 text-[11px]">
                <span className="w-4 shrink-0 text-ink-faint">{i + 1}.</span>
                <span className="numeric w-20 shrink-0 font-semibold text-warm">
                  {num(row.pressure, 1)}
                </span>
                <span className="w-24 shrink-0 text-ink-muted">{isoToGerman(row.date)}</span>
                <span className="numeric text-ink-faint">
                  {row.wind_max === null ? '—' : `Bö ${num(row.wind_max, 1)} m/s`}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card>
        <SectionHeading
          icon={Gauge}
          title="Jahresgang"
          hint="Monatsmittel über den gesamten Bestand."
        />
        <div className="mt-4">
          <ChartFrame height={240}>
            <ResponsiveContainer>
              <BarChart data={data.monthly} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(l: string) => l.slice(0, 3)}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={52}
                  domain={['dataMin - 0.5', 'dataMax + 0.5']}
                  tickFormatter={(v: number) => num(v, 1)}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof data.monthly)[number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        subtitle={`${num(row.days, 0)} Tage`}
                        rows={[
                          { label: 'Mittel', value: `${num(row.mean, 1)} hPa` },
                          {
                            label: 'Spanne',
                            value: `${num(row.min, 1)} bis ${num(row.max, 1)} hPa`,
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Bar dataKey="mean" fill={CHART.colors.brand} fillOpacity={0.7} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Der Jahresgang ist flach — gut ein Hektopascal zwischen dem tiefsten
          und dem höchsten Monat. Die Achse ist auf diese Spanne skaliert, sonst
          wäre die Grafik eine gerade Linie.
        </p>
      </Card>
    </div>
  )
}
