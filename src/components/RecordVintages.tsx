import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Award, Dices, Flame, Snowflake } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { num, year as yearOf } from '../lib/format'
import type { RecordVintagesResponse, VintageDecade, VintageYear } from '../types'
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

const GROUPS = [
  { value: 'alle', label: 'Alle Größen' },
  { value: 'warm', label: 'Warme Rekorde' },
  { value: 'kalt', label: 'Kalte Rekorde' },
] as const

/** Above one is more records than chance, below one fewer. */
function ratioTone(ratio: number | null): string {
  if (ratio === null) return 'text-ink-muted'
  if (ratio >= 1.5) return 'text-hot'
  if (ratio <= 0.67) return 'text-cold'
  return 'text-ink'
}

export function RecordVintages({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [groupKey, setGroupKey] = useUrlState<string>('gruppe', 'alle')
  const { data, loading, error } = useApi<RecordVintagesResponse>(
    `/api/weather/record-vintages?stationId=${stationId}`,
    [stationId],
  )

  if (loading && !data) return <Loading message="Rekordjahrgänge werden gezählt …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const group = data.groups[groupKey] ?? data.groups.alle
  if (!group) return null

  const top = [...group.years]
    .sort((a, b) => b.standing - a.standing || b.set - a.set)
    .slice(0, data.vintages)
  const leader = top[0]

  const warmLate = data.groups.warm?.decades.at(-1) ?? null
  const coldLate = data.groups.kalt?.decades.at(-1) ?? null
  const totalSet = group.decades.reduce((a, d) => a + d.set, 0)
  const totalExpected = group.decades.reduce((a, d) => a + d.expected, 0)

  return (
    <div className="space-y-6">
      <InfoPanel title={`Die Rekordjahrgänge von ${stationName}`}>
        <p>
          Zwei Fragen heißen beide „Rekordjahr". Die eine zählt, wie viele
          Tagesrekorde ein Jahr <em>heute noch hält</em> — das ist die
          anschauliche Lesart, sie bevorzugt aber späte Jahre, weil ein Rekord
          von 1900 ein Jahrhundert Zeit hatte zu fallen.
        </p>
        <p>
          Die andere zählt, wie viele Rekorde ein Jahr <em>damals aufgestellt</em>{' '}
          hat, und vergleicht das mit dem Zufall. Bei unverändertem Klima ist die
          k-te Messung eines Kalendertages mit Wahrscheinlichkeit 1/k ein Rekord;
          die erwartete Ausbeute eines Jahres ist also die Summe der 1/k über
          seine Tage. Diese Erwartung sinkt, während die Reihe wächst — und genau
          das ist die Korrektur, die die rohe Zählung braucht. Die 1880er stellten
          Hunderte von Rekorden auf, weil fast jeder Tag erst zum dritten Mal
          gemessen wurde, und das ist keine Nachricht.
        </p>
        <p>
          Bei Schneehöhe, Niederschlag und Sonnenschein zählen nur Tage, an denen
          die Größe überhaupt auftrat. Ein Maximum von 0 cm ist keine
          Rekordmarke, sondern die Auskunft, dass es an diesem Kalendertag nie
          geschneit hat — 179 der 192 vermeintlichen Rekorde des Jahres 1858
          waren genau das.
        </p>
      </InfoPanel>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Dices}
            title="Beobachtet gegen Zufall"
            hint="Je Jahrzehnt: wie viele Rekorde tatsächlich fielen und wie viele bei unverändertem Klima zu erwarten gewesen wären."
          />
          <ChoiceGroup
            label="Größen"
            value={groupKey}
            choices={GROUPS.map((g) => ({ value: g.value, label: g.label }))}
            onChange={setGroupKey}
            size="sm"
          />
        </div>

        <div className="mt-4">
          <ChartFrame height={340}>
            <ResponsiveContainer>
              <ComposedChart data={group.decades} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="decade"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => `${v}er`}
                  minTickGap={16}
                />
                <YAxis
                  yAxisId="n"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={48}
                  tickFormatter={(v: number) => num(v, 0)}
                />
                <YAxis
                  yAxisId="r"
                  orientation="right"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={44}
                  tickFormatter={(v: number) => `${num(v, 1)}×`}
                />
                <ReferenceLine
                  yAxisId="r"
                  y={1}
                  stroke={CHART.axis}
                  strokeDasharray="4 3"
                  label={{
                    value: 'Zufall',
                    position: 'right',
                    fill: 'var(--color-chart-label)',
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as VintageDecade
                    return (
                      <ChartTooltip
                        title={`${row.decade}er Jahre`}
                        rows={[
                          { label: 'Rekorde gefallen', value: num(row.set, 0) },
                          { label: 'bei Zufall zu erwarten', value: num(row.expected, 1) },
                          {
                            label: 'Verhältnis',
                            value: row.ratio !== null ? `${num(row.ratio, 2)}×` : '—',
                            className: ratioTone(row.ratio),
                          },
                          { label: 'davon heute noch gültig', value: num(row.standing, 0) },
                          { label: 'Messtage', value: num(row.opportunities, 0) },
                        ]}
                      />
                    )
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)' }}
                  iconType="plainline"
                />
                <Bar
                  yAxisId="n"
                  dataKey="set"
                  name="Rekorde gefallen"
                  radius={[3, 3, 0, 0]}
                  fill={CHART.colors.brand}
                >
                  {group.decades.map((d) => (
                    <Cell
                      key={d.decade}
                      fill={
                        d.ratio === null
                          ? CHART.colors.brand
                          : d.ratio >= 1.5
                            ? CHART.colors.hot
                            : d.ratio <= 0.67
                              ? CHART.colors.cold
                              : CHART.colors.brand
                      }
                    />
                  ))}
                </Bar>
                <Line
                  yAxisId="n"
                  type="monotone"
                  dataKey="expected"
                  name="bei Zufall zu erwarten"
                  stroke={CHART.colors.neutral}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                />
                <Line
                  yAxisId="r"
                  type="monotone"
                  dataKey="ratio"
                  name="Verhältnis"
                  stroke={CHART.colors.accent}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
          Über die ganze Reihe fielen{' '}
          <span className="numeric">{num(totalSet, 0)}</span> Rekorde, erwartbar
          wären <span className="numeric">{num(totalExpected, 0)}</span> gewesen —
          über alles gerechnet also nahe am Zufall. Die Aussage steckt nicht in
          der Summe, sondern in ihrer Verteilung: die gestrichelte Linie fällt,
          weil eine wachsende Reihe immer schwerer zu schlagen ist, und wo die
          Balken sie überragen, geschah mehr als Zufall.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <StatGrid>
        <StatTile
          label="Stärkster Jahrgang"
          value={leader ? yearOf(leader.year) : '—'}
          caption={
            leader
              ? `hält heute noch ${num(leader.standing, 0)} Tagesrekorde — damals ${num(leader.set, 0)} aufgestellt`
              : undefined
          }
          accent="brand"
          icon={Award}
        />
        <StatTile
          label="Warme Rekorde im letzten Jahrzehnt"
          value={warmLate?.ratio !== null && warmLate ? `${num(warmLate.ratio, 2)}×` : '—'}
          caption={
            warmLate
              ? `${num(warmLate.set, 0)} gefallen, ${num(warmLate.expected, 0)} erwartbar (${warmLate.decade}er)`
              : undefined
          }
          accent="hot"
          icon={Flame}
        />
        <StatTile
          label="Kalte Rekorde im letzten Jahrzehnt"
          value={coldLate?.ratio !== null && coldLate ? `${num(coldLate.ratio, 2)}×` : '—'}
          caption={
            coldLate
              ? `${num(coldLate.set, 0)} gefallen, ${num(coldLate.expected, 0)} erwartbar (${coldLate.decade}er)`
              : undefined
          }
          accent="cold"
          icon={Snowflake}
        />
        <StatTile
          label="Verhältnis der beiden"
          value={
            warmLate?.ratio && coldLate?.ratio
              ? `${num(warmLate.ratio / coldLate.ratio, 0)} : 1`
              : '—'
          }
          caption="warme gegen kalte Rekorde, jeweils gegen den Zufall gerechnet"
          accent="warm"
          icon={Dices}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Award}
          title="Wie viele Rekorde jedes Jahr heute noch hält"
          hint="Ein Balken je Jahr. Was hier steht, ist die Bilanz nach allem, was danach kam."
        />

        <div className="mt-4">
          <ChartFrame height={280}>
            <ResponsiveContainer>
              <BarChart data={group.years} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="year"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  minTickGap={40}
                  tickFormatter={(v: number) => yearOf(v)}
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
                    const row = payload[0]!.payload as VintageYear
                    return (
                      <ChartTooltip
                        title={yearOf(row.year)}
                        rows={[
                          { label: 'heute noch gültig', value: num(row.standing, 0) },
                          { label: 'damals aufgestellt', value: num(row.set, 0) },
                          { label: 'bei Zufall erwartbar', value: num(row.expected, 1) },
                          { label: 'Messtage', value: num(row.opportunities, 0) },
                        ]}
                      />
                    )
                  }}
                />
                <Bar dataKey="standing" fill={CHART.colors.brand} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <div className="mt-4 overflow-x-auto border-t border-line pt-3">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Jahr</th>
                <th className="px-2 py-2 text-right font-medium">heute gültig</th>
                <th className="px-2 py-2 text-right font-medium">damals aufgestellt</th>
                <th className="px-2 py-2 text-right font-medium">bei Zufall erwartbar</th>
                <th className="px-2 py-2 text-right font-medium">Verhältnis</th>
              </tr>
            </thead>
            <tbody>
              {top.map((row) => {
                const ratio = row.expected > 0 ? row.set / row.expected : null
                return (
                  <tr key={row.year} className="border-b border-line/60 last:border-0">
                    <td className="numeric py-1.5 pr-3 text-ink">{yearOf(row.year)}</td>
                    <td className="numeric px-2 py-1.5 text-right text-base font-semibold text-brand">
                      {num(row.standing, 0)}
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                      {num(row.set, 0)}
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                      {num(row.expected, 1)}
                    </td>
                    <td className={`numeric px-2 py-1.5 text-right ${ratioTone(ratio)}`}>
                      {ratio !== null ? `${num(ratio, 2)}×` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Flame}
          title="Jede Größe für sich"
          hint="Das Verhältnis von gefallenen zu erwartbaren Rekorden, für das jeweils letzte Jahrzehnt."
        />

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Größe</th>
                <th className="px-2 py-2 text-right font-medium">1970er</th>
                <th className="px-2 py-2 text-right font-medium">1990er</th>
                <th className="px-2 py-2 text-right font-medium">2010er</th>
                <th className="px-2 py-2 text-right font-medium">2020er</th>
                <th className="px-2 py-2 text-right font-medium">stärkster Jahrgang</th>
              </tr>
            </thead>
            <tbody>
              {data.fields.map((f) => {
                const at = (decade: number) => f.decades.find((d) => d.decade === decade) ?? null
                const best = f.top[0] ?? null
                return (
                  <tr key={f.key} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 pr-3">
                      <span
                        className={
                          f.warm === true
                            ? 'text-hot'
                            : f.warm === false
                              ? 'text-cold'
                              : 'text-ink'
                        }
                      >
                        {f.label}
                      </span>
                      <span className="block text-[10px] text-ink-faint">
                        Reihe seit {f.first.slice(0, 4)} · {num(f.totals.set, 0)} Rekorde gefallen
                      </span>
                    </td>
                    {[1970, 1990, 2010, 2020].map((decade) => {
                      const d = at(decade)
                      return (
                        <td
                          key={decade}
                          className={`numeric px-2 py-1.5 text-right ${ratioTone(d?.ratio ?? null)}`}
                        >
                          {d?.ratio !== null && d ? `${num(d.ratio, 2)}×` : '—'}
                        </td>
                      )
                    })}
                    <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                      {best ? `${yearOf(best.year)} (${num(best.standing, 0)})` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Ein Wert über 1 bedeutet mehr Rekorde als der Zufall hergibt, ein Wert
          darunter weniger. Niederschlag und Luftdruck sind die Kontrollgruppe:
          sie liegen nahe bei 1 und zeigen damit, dass die Methode nicht von sich
          aus einen Trend erzeugt. Die Sonnenscheindauer tut das nicht — sie
          liegt im letzten Jahrzehnt deutlich darüber. Das ist kein Fehler der
          Rechnung, sondern ein eigener Befund, den diese Seite nur feststellt
          und nicht erklärt.
        </p>
      </Card>
    </div>
  )
}
