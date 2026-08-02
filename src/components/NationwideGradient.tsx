import {
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Compass, MoveHorizontal, MoveVertical, Waves } from 'lucide-react'

import { useApi } from '../lib/api'
import { linearFit } from '../lib/stats'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf, signed } from '../lib/format'
import type { GradientDay, GradientResponse } from '../types'
import {
  CHART,
  Card,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  ErrorState,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/* -------------------------------------------------------------------------- */

function DayList({ days }: { days: GradientDay[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-line text-ink-muted">
            <th className="py-2 pr-3 text-left font-medium">Tag</th>
            <th className="px-2 py-2 text-right font-medium">nach Norden</th>
            <th className="px-2 py-2 text-right font-medium">nach Osten</th>
            <th className="px-2 py-2 text-right font-medium">wärmer Richtung</th>
            <th className="px-2 py-2 text-left font-medium">wärmster / kältester Ort</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date} className="border-b border-line/60 last:border-0">
              <td className="numeric py-1.5 pr-3 text-ink">{isoToGerman(day.date)}</td>
              <td
                className={`numeric px-2 py-1.5 text-right font-semibold ${
                  day.gradN >= 0 ? 'text-hot' : 'text-cold'
                }`}
              >
                {signed(day.gradN, 2)} K
              </td>
              <td
                className={`numeric px-2 py-1.5 text-right font-semibold ${
                  day.gradE >= 0 ? 'text-hot' : 'text-cold'
                }`}
              >
                {signed(day.gradE, 2)} K
              </td>
              <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                {day.compass}
                <span className="ml-1.5 text-[10px] text-ink-faint">
                  {num(day.magnitude, 2)} K
                </span>
              </td>
              <td className="px-2 py-1.5 text-ink-muted">
                <span className="text-hot">{num(day.absHi, 1)} °C</span> {day.absHiStation.name}
                <span className="block text-[10px] text-ink-faint">
                  <span className="text-cold">{num(day.absLo, 1)} °C</span>{' '}
                  {day.absLoStation.name}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-ink-faint">
        Beide Angaben in K je 100 km, jeweils mit den anderen beiden Einflüssen —
        Höhe und der jeweils anderen Richtung — festgehalten.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function NationwideGradient() {
  const [extremeKey, setExtremeKey] = useUrlState<string>('richtung', 'westWarm')
  const { data, loading, error } = useApi<GradientResponse>('/api/nationwide/gradient')

  if (loading && !data) return <Loading message="Gefälle wird geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { overall } = data
  const january = data.monthly.find((m) => m.month === 1)
  const june = data.monthly.find((m) => m.month === 6)
  const extreme = data.extremes.find((e) => e.key === extremeKey) ?? data.extremes[0]

  const trendN = linearFit(data.annual.map((y) => ({ x: y.year, y: y.gradN })))
  const trendE = linearFit(data.annual.map((y) => ({ x: y.year, y: y.gradE })))

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading
          icon={Compass}
          title="In welche Richtung es wärmer wird"
          hint="Aus derselben Anpassung wie das Höhengefälle: wie sich die Temperatur je 100 km nach Norden und je 100 km nach Osten ändert, jeweils mit den anderen Einflüssen festgehalten."
        />
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
          Beide Zahlen zusammen sind ein Vektor — eine Richtung und eine
          Steilheit —, und dieser Vektor dreht sich im Lauf des Jahres. Im Januar
          ist die Nord-Süd-Komponente fast null und die Ost-West-Komponente stark
          negativ: Deutschland ist dann nicht im Norden kälter, sondern im Osten.
          Im Juni kehrt sich das um. Das ist Kontinentalität, gemessen statt
          behauptet — im Winter wärmt der Atlantik, was ihm nahe liegt, im Sommer
          kühlt er es.
        </p>
      </Card>

      <StatGrid>
        <StatTile
          label="Nach Norden"
          value={`${signed(overall.gradN, 2)} K`}
          caption={`je 100 km, im Mittel über ${num(overall.days, 0)} Tage`}
          accent="cold"
          icon={MoveVertical}
        />
        <StatTile
          label="Nach Osten"
          value={`${signed(overall.gradE, 2)} K`}
          caption={
            january && june
              ? `im Januar ${signed(january.gradE, 2)}, im Juni ${signed(june.gradE, 2)}`
              : undefined
          }
          accent="brand"
          icon={MoveHorizontal}
        />
        <StatTile
          label="Wärmer Richtung"
          value={overall.compass}
          caption={`${num(overall.magnitude, 2)} K je 100 km in dieser Richtung`}
          accent="warm"
          icon={Compass}
        />
        <StatTile
          label="Osten wärmer als Westen"
          value={june ? shareOf(june.eastWarmerShare) : '—'}
          caption={
            january
              ? `der Junitage — im Januar nur ${shareOf(january.eastWarmerShare)}`
              : undefined
          }
          accent="hot"
          icon={Waves}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Compass}
          title="Der Jahreslauf als Schleife"
          hint="Ein Punkt je Monat. Rechts liegt der wärmere Osten, oben der wärmere Norden."
        />

        <div className="mt-4">
          <ChartFrame height={400}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="gradE"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  domain={['dataMin - 0.1', 'dataMax + 0.1']}
                  tickFormatter={(v: number) => signed(v, 1)}
                  label={{
                    value: '← Westen wärmer     ·     Osten wärmer →',
                    position: 'insideBottom',
                    offset: -12,
                    fill: 'var(--color-chart-tick)',
                    fontSize: 11,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="gradN"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={56}
                  domain={['dataMin - 0.1', 'dataMax + 0.1']}
                  tickFormatter={(v: number) => signed(v, 1)}
                  label={{
                    value: '← Süden wärmer  ·  Norden wärmer →',
                    angle: -90,
                    position: 'insideLeft',
                    fill: 'var(--color-chart-tick)',
                    fontSize: 11,
                    style: { textAnchor: 'middle' },
                  }}
                />
                <ReferenceLine x={0} stroke={CHART.axis} />
                <ReferenceLine y={0} stroke={CHART.axis} />
                <Tooltip
                  cursor={{ stroke: CHART.cursorSoft }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as GradientResponse['monthly'][number]
                    if (!row.label) return null
                    return (
                      <ChartTooltip
                        title={row.label}
                        rows={[
                          { label: 'nach Norden', value: `${signed(row.gradN, 2)} K/100 km` },
                          { label: 'nach Osten', value: `${signed(row.gradE, 2)} K/100 km` },
                          { label: 'wärmer Richtung', value: row.compass },
                          {
                            label: 'Osten wärmer an',
                            value: shareOf(row.eastWarmerShare),
                          },
                          { label: 'Tage', value: num(row.days, 0) },
                        ]}
                      />
                    )
                  }}
                />
                <Scatter
                  data={data.monthly}
                  fill={CHART.colors.brand}
                  line={{ stroke: CHART.colors.brand, strokeWidth: 1.5 }}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="label"
                    position="right"
                    offset={8}
                    style={{ fill: 'var(--color-chart-label)', fontSize: 10 }}
                    formatter={(v: unknown) => String(v).slice(0, 3)}
                  />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
          Die Schleife läuft von links unten nach rechts unten und zurück. Im
          Winter sitzt Deutschland links: der Westen ist milder, der Norden kaum
          kälter als der Süden. Im Sommer rutscht es nach rechts und weit nach
          unten: der Osten wird wärmer als der Westen, und das Süd-Nord-Gefälle
          erreicht sein Maximum. Der Weg dazwischen ist keine Gerade, weil beide
          Komponenten unterschiedlich schnell umschlagen — die Ost-West-Achse
          kippt im April, die Nord-Süd-Achse hat ihr Maximum schon im Juni.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={MoveHorizontal}
          title="Beide Achsen im Jahresgang"
          hint="Dieselben zwölf Punkte, getrennt nach Richtung."
        />

        <div className="mt-4">
          <ChartFrame height={280}>
            <ResponsiveContainer>
              <LineChart data={data.monthly} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: string) => v.slice(0, 3)}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={56}
                  tickFormatter={(v: number) => signed(v, 1)}
                />
                <ReferenceLine y={0} stroke={CHART.axis} strokeDasharray="4 3" />
                <Tooltip
                  cursor={{ stroke: CHART.cursorSoft, strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as GradientResponse['monthly'][number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        rows={[
                          {
                            label: 'nach Norden',
                            value: `${signed(row.gradN, 2)} K`,
                            className: 'text-cold',
                          },
                          {
                            label: 'nach Osten',
                            value: `${signed(row.gradE, 2)} K`,
                            className: 'text-brand',
                          },
                          { label: 'Steilheit', value: `${num(row.magnitude, 2)} K/100 km` },
                        ]}
                      />
                    )
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)' }}
                  iconType="plainline"
                />
                <Line
                  type="monotone"
                  dataKey="gradN"
                  name="je 100 km nach Norden"
                  stroke={CHART.colors.cold}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="gradE"
                  name="je 100 km nach Osten"
                  stroke={CHART.colors.brand}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={MoveVertical}
          title="Über die Jahre"
          hint="Ob sich die Achsen langfristig verschoben haben."
        />

        <div className="mt-4">
          <ChartFrame height={280}>
            <ResponsiveContainer>
              <LineChart data={data.annual} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} minTickGap={40} />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={56}
                  tickFormatter={(v: number) => signed(v, 1)}
                />
                <ReferenceLine y={0} stroke={CHART.axis} strokeDasharray="4 3" />
                <Tooltip
                  cursor={{ stroke: CHART.cursorSoft, strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as GradientResponse['annual'][number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        rows={[
                          {
                            label: 'nach Norden',
                            value: `${signed(row.gradN, 2)} K`,
                            className: 'text-cold',
                          },
                          {
                            label: 'nach Osten',
                            value: `${signed(row.gradE, 2)} K`,
                            className: 'text-brand',
                          },
                          { label: 'R² der Anpassung', value: num(row.gradR2, 2) },
                        ]}
                      />
                    )
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)' }}
                  iconType="plainline"
                />
                <Line
                  type="monotone"
                  dataKey="gradN"
                  name="nach Norden"
                  stroke={CHART.colors.cold}
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="gradE"
                  name="nach Osten"
                  stroke={CHART.colors.brand}
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[11px] text-ink-muted">
          {(
            [
              { label: 'nach Norden', fit: trendN, tone: 'text-cold' },
              { label: 'nach Osten', fit: trendE, tone: 'text-brand' },
            ] as const
          ).map((row) => (
            <li key={row.label}>
              <span className={row.tone}>{row.label}</span>:{' '}
              {row.fit ? (
                <>
                  <span className="numeric">{signed(row.fit.slope * 10, 3)} K</span> je
                  Jahrzehnt, R² {num(row.fit.r2, 2)}
                  {row.fit.isSignificant ? '' : ' — nicht signifikant'}
                </>
              ) : (
                '—'
              )}
            </li>
          ))}
        </ul>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Beide Achsen schwanken von Jahr zu Jahr um mehrere Zehntel — das ist
          Witterung, nicht Klima: ein Jahr mit vielen Westlagen im Winter
          verschiebt das Ost-West-Gefälle spürbar. Ein langfristiger Trend wäre
          etwas anderes, und er müsste sich gegen diese Schwankung durchsetzen.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      {extreme && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHeading
              icon={Compass}
              title={`Die ${data.top} Tage: ${extreme.label}`}
              hint={extreme.note}
            />
            <ChoiceGroup
              label="Richtung"
              value={extreme.key}
              choices={data.extremes.map((e) => ({ value: e.key, label: e.label }))}
              onChange={setExtremeKey}
              size="sm"
            />
          </div>
          <div className="mt-4">
            <DayList days={extreme.days} />
          </div>
        </Card>
      )}
    </div>
  )
}
