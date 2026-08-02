import { useMemo } from 'react'
import {
  Bar,
  BarChart,
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
import { Dices, Landmark, Scale, TrendingUp } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { num, year as yearOf } from '../lib/format'
import type { BalanceDecade, BalanceRegion, RegionalBalanceResponse } from '../types'
import {
  CHART,
  Card,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/** The DWD transliterates umlauts in its region names; German readers do not. */
const DISPLAY: Record<string, string> = {
  'Baden-Wuerttemberg': 'Baden-Württemberg',
  Thueringen: 'Thüringen',
  'Thueringen/Sachsen-Anhalt': 'Thüringen/Sachsen-Anhalt',
}

const label = (name: string) => DISPLAY[name] ?? name

/**
 * What a new maximum means depends on the quantity.
 *
 * A record high in mean temperature is a warm record; a record high in frost
 * days is a cold one. The arithmetic on the server does not know the
 * difference, so the naming happens here, once.
 */
function directionNames(direction: string): { high: string; low: string; highIsWarm: boolean } {
  switch (direction) {
    case 'cold':
      return { high: 'kalte Rekorde', low: 'milde Rekorde', highIsWarm: false }
    case 'wet':
      return { high: 'nasse Rekorde', low: 'trockene Rekorde', highIsWarm: true }
    default:
      return { high: 'warme Rekorde', low: 'kalte Rekorde', highIsWarm: true }
  }
}

function ratioTone(ratio: number | null): string {
  if (ratio === null) return 'text-ink-faint'
  if (ratio >= 1.5) return 'text-hot'
  if (ratio <= 0.67) return 'text-cold'
  return 'text-ink'
}

export function RegionalBalance() {
  const [parameterKey, setParameterKey] = useUrlState<string>('groesse', 'temp_mean')
  const [regionName, setRegionName] = useUrlState<string>('region', 'Deutschland')

  const { data, loading, error } = useApi<RegionalBalanceResponse>(
    `/api/regional/balance?parameter=${parameterKey}`,
    [parameterKey],
  )

  const balance = data?.balance ?? null
  const region: BalanceRegion | null = useMemo(() => {
    if (!balance) return null
    return balance.regions.find((r) => r.name === regionName) ?? balance.regions[0] ?? null
  }, [balance, regionName])

  if (loading && !data) return <Loading message="Rekordbilanz wird gerechnet …" />
  if (error) return <ErrorState message={error} />
  if (!data || !balance || !region) return null

  const names = directionNames(balance.parameter.direction)
  const highColor = names.highIsWarm ? CHART.colors.hot : CHART.colors.cold
  const lowColor = names.highIsWarm ? CHART.colors.cold : CHART.colors.hot

  const yearRow = region.periods.find((p) => p.period === 'year') ?? region.periods[0]

  /** Every region's most recent ratio, so the map of the country can be a list. */
  const ranking = [...balance.regions]
    .filter((r) => r.kind !== 'combination')
    .sort((a, b) => (b.recent.highRatio ?? 0) - (a.recent.highRatio ?? 0))

  return (
    <div className="space-y-6">
      <InfoPanel title="Rekordbilanz der Gebietsmittel">
        <p>
          Die Rekordfrage, an das ganze Land gestellt statt an ein Thermometer.
          Die amtlichen DWD-Gebietsmittel reichen bis 1881 zurück und decken die
          sechzehn Bundesländer und Deutschland ab; jede Kombination aus Region,
          Größe und Zeitraum ist eine eigene Reihe, und ein Jahr setzt einen
          Rekord, wenn es alle Jahre davor schlägt.
        </p>
        <p>
          Roh gezählt wäre die Antwort dasselbe Artefakt wie überall: die 1880er
          stellten Rekorde auf, weil es nichts zu schlagen gab. Deshalb steht der
          Zählung gegenüber, was der Zufall gäbe — das k-te Jahr einer Reihe ist
          in jeder Richtung mit Wahrscheinlichkeit 1/k ein Rekord. Ein Verhältnis
          über eins bedeutet mehr Rekorde, als ein unverändertes Klima
          hervorbringt.
        </p>
        <p>
          Gezählt wird über alle siebzehn Zeiträume einer Region — zwölf Monate,
          vier Jahreszeiten und das Jahr. Ein einzelner Monatsrekord ist Wetter;
          siebzehn Reihen nebeneinander sind eine Bilanz.
        </p>
      </InfoPanel>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Scale}
            title={`${balance.parameter.label}: ${label(region.name)}`}
            hint={`${yearOf(region.first)}–${yearOf(region.last)} · ${
              region.periods.length === 1
                ? 'nur die Jahresreihe'
                : `${num(region.periods.length, 0)} Zeiträume je Region`
            }`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <ChoiceGroup
              label="Größe"
              value={parameterKey}
              choices={data.parameters.map((p) => ({ value: p.key, label: p.label }))}
              onChange={setParameterKey}
              size="sm"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="label mb-1.5 block" htmlFor="balance-region">
            Region
          </label>
          <select
            id="balance-region"
            value={region.name}
            onChange={(e) => setRegionName(e.target.value)}
            className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink"
          >
            {balance.regions.map((r) => (
              <option key={r.name} value={r.name}>
                {label(r.name)}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <StatGrid>
        <StatTile
          label={`${names.high} seit ${yearOf(region.recent.from)}`}
          value={
            region.recent.highRatio !== null ? `${num(region.recent.highRatio, 1)}×` : '—'
          }
          caption={`${num(region.recent.high, 0)} gefallen, ${num(region.recent.expected, 1)} erwartbar`}
          accent={names.highIsWarm ? 'hot' : 'cold'}
          icon={TrendingUp}
        />
        <StatTile
          label={`${names.low} seit ${yearOf(region.recent.from)}`}
          value={region.recent.lowRatio !== null ? `${num(region.recent.lowRatio, 1)}×` : '—'}
          caption={`${num(region.recent.low, 0)} gefallen, ${num(region.recent.expected, 1)} erwartbar`}
          accent={names.highIsWarm ? 'cold' : 'hot'}
          icon={Dices}
        />
        <StatTile
          label="Höchster Jahreswert"
          value={
            yearRow
              ? `${num(yearRow.high.value, balance.parameter.decimals)} ${balance.parameter.unit}`
              : '—'
          }
          caption={yearRow ? `${yearRow.label} ${yearOf(yearRow.high.year)}` : undefined}
          accent={names.highIsWarm ? 'hot' : 'cold'}
        />
        <StatTile
          label="Tiefster Jahreswert"
          value={
            yearRow
              ? `${num(yearRow.low.value, balance.parameter.decimals)} ${balance.parameter.unit}`
              : '—'
          }
          caption={yearRow ? `${yearRow.label} ${yearOf(yearRow.low.year)}` : undefined}
          accent={names.highIsWarm ? 'cold' : 'hot'}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Dices}
          title="Rekorde je Jahrzehnt gegen den Zufall"
          hint="Balken sind gefallene Rekorde über alle siebzehn Zeiträume, die gestrichelte Linie ist die Erwartung je Richtung."
        />

        <div className="mt-4">
          <ChartFrame height={320}>
            <ResponsiveContainer>
              <ComposedChart data={region.decades} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="decade"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => `${v}er`}
                  minTickGap={16}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={44}
                  tickFormatter={(v: number) => num(v, 0)}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as BalanceDecade
                    return (
                      <ChartTooltip
                        title={`${row.decade}er Jahre`}
                        rows={[
                          {
                            label: names.high,
                            value: `${num(row.high, 0)} — ${row.highRatio !== null ? `${num(row.highRatio, 2)}×` : '—'}`,
                            className: ratioTone(row.highRatio),
                          },
                          {
                            label: names.low,
                            value: `${num(row.low, 0)} — ${row.lowRatio !== null ? `${num(row.lowRatio, 2)}×` : '—'}`,
                            className: ratioTone(row.lowRatio),
                          },
                          { label: 'je Richtung erwartbar', value: num(row.expected, 2) },
                          { label: 'Reihenjahre gezählt', value: num(row.series, 0) },
                        ]}
                      />
                    )
                  }}
                />
                <Legend
                  verticalAlign="top"
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)', paddingBottom: 8 }}
                  iconType="plainline"
                />
                <Bar dataKey="high" name={names.high} fill={highColor} radius={[3, 3, 0, 0]} />
                <Bar dataKey="low" name={names.low} fill={lowColor} radius={[3, 3, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="expected"
                  name="je Richtung erwartbar"
                  stroke={CHART.colors.neutral}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
          Die gestrichelte Linie fällt, weil eine wachsende Reihe immer schwerer
          zu schlagen ist — sie ist keine Zielmarke, sondern die Nulllinie. Über
          die ganze Reihe fielen in {label(region.name)}{' '}
          <span className="numeric">{num(region.totals.high, 0)}</span> {names.high} und{' '}
          <span className="numeric">{num(region.totals.low, 0)}</span> {names.low}, erwartbar
          wären je Richtung <span className="numeric">{num(region.totals.expected, 0)}</span>{' '}
          gewesen.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Landmark}
          title={`Die Länder im Vergleich, seit ${yearOf(region.recent.from)}`}
          hint="Verhältnis der gefallenen zu den erwartbaren Rekorden, in beide Richtungen. Kombinationsregionen sind ausgelassen, sie wiederholen ihre Teile."
        />

        <div className="mt-4">
          <ChartFrame height={Math.max(280, ranking.length * 26 + 40)}>
            <ResponsiveContainer>
              <BarChart
                data={ranking}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
              >
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => `${num(v, 0)}×`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke={CHART.axis}
                  tick={{ ...CHART.tick, fontSize: 10 }}
                  width={160}
                  interval={0}
                  tickFormatter={label}
                />
                <ReferenceLine x={1} stroke={CHART.axis} strokeDasharray="4 3" />
                <Legend
                  verticalAlign="top"
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)', paddingBottom: 8 }}
                  iconType="plainline"
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as BalanceRegion
                    return (
                      <ChartTooltip
                        title={label(row.name)}
                        rows={[
                          {
                            label: names.high,
                            value: `${num(row.recent.high, 0)} — ${row.recent.highRatio !== null ? `${num(row.recent.highRatio, 2)}×` : '—'}`,
                            className: ratioTone(row.recent.highRatio),
                          },
                          {
                            label: names.low,
                            value: `${num(row.recent.low, 0)} — ${row.recent.lowRatio !== null ? `${num(row.recent.lowRatio, 2)}×` : '—'}`,
                            className: ratioTone(row.recent.lowRatio),
                          },
                          { label: 'erwartbar je Richtung', value: num(row.recent.expected, 1) },
                        ]}
                      />
                    )
                  }}
                />
                <Bar
                  dataKey="recent.highRatio"
                  name={names.high}
                  fill={highColor}
                  radius={[0, 3, 3, 0]}
                />
                <Bar
                  dataKey="recent.lowRatio"
                  name={names.low}
                  fill={lowColor}
                  radius={[0, 3, 3, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Scale}
          title={`Die Rekordhalter von ${label(region.name)}`}
          hint="Für jeden Zeitraum das höchste und das tiefste je gemessene Gebietsmittel."
        />

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Zeitraum</th>
                <th className="px-2 py-2 text-right font-medium">höchster Wert</th>
                <th className="px-2 py-2 text-right font-medium">Jahr</th>
                <th className="px-2 py-2 text-right font-medium">tiefster Wert</th>
                <th className="px-2 py-2 text-right font-medium">Jahr</th>
                <th className="px-2 py-2 text-right font-medium">Jahre</th>
              </tr>
            </thead>
            <tbody>
              {region.periods.map((row) => (
                <tr key={row.period} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-3 text-ink">{row.label}</td>
                  <td
                    className={`numeric px-2 py-1.5 text-right font-semibold ${names.highIsWarm ? 'text-hot' : 'text-cold'}`}
                  >
                    {num(row.high.value, balance.parameter.decimals)} {balance.parameter.unit}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {yearOf(row.high.year)}
                  </td>
                  <td
                    className={`numeric px-2 py-1.5 text-right font-semibold ${names.highIsWarm ? 'text-cold' : 'text-hot'}`}
                  >
                    {num(row.low.value, balance.parameter.decimals)} {balance.parameter.unit}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {yearOf(row.low.year)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                    {num(row.years, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Gebietsmittel sind Flächenwerte, keine Stationswerte: der wärmste
          deutsche Sommer ist hier das Mittel über die Fläche des Landes, nicht
          der höchste Wert, den irgendein Thermometer gesehen hat. Beides sind
          verschiedene Rekorde, und nur der zweite steht in den Zeitungen.
        </p>
      </Card>
    </div>
  )
}
