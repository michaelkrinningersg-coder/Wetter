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
import { Crosshair, Dices, Ruler, Target } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf } from '../lib/format'
import type { NearDecade, NearField, NearMissesResponse } from '../types'
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

const TIER_LABELS: Record<number, string> = { 1: 'eng', 2: 'mittel', 4: 'weit' }

function value(field: NearField, v: number): string {
  if (field.unit === 'm/s') return `${num(v * 3.6, 0)} km/h`
  return `${num(v, field.decimals)} ${field.unit}`
}

/** The margin as a sentence a reader can check against the table below. */
function marginText(field: NearField, tier: number): string {
  const size = field.margin.value * tier
  return field.margin.relative
    ? `${num(size * 100, 0)} % des Rekords`
    : `${num(size, 1)} ${field.unit}`
}

function ratioTone(ratio: number | null): string {
  if (ratio === null) return 'text-ink-faint'
  if (ratio >= 1.3) return 'text-hot'
  if (ratio <= 0.77) return 'text-cold'
  return 'text-ink'
}

export function RecordNearMisses({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [fieldKey, setFieldKey] = useUrlState<string>('groesse', 'temp_max_high')
  const [tierKey, setTierKey] = useUrlState<string>('abstand', '1')
  const { data, loading, error } = useApi<NearMissesResponse>(
    `/api/weather/near-misses?stationId=${stationId}`,
    [stationId],
  )

  if (loading && !data) return <Loading message="Fast-Rekorde werden gesucht …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const field = data.fields.find((f) => f.key === fieldKey) ?? data.fields[0]
  if (!field) return null

  const tier = data.tiers.includes(Number(tierKey)) ? Number(tierKey) : data.tiers[0]!
  const late = field.decades.at(-1)
  const early = field.decades.find((d) => d.decade >= 1950) ?? field.decades[0]
  const nearTotal = field.totals.tiers[String(tier)] ?? 0
  const rankTotal = field.totals.rank2 + field.totals.rank3

  const rows = field.decades.map((d) => ({
    ...d,
    near: d.tiers[String(tier)] ?? 0,
    rate: d.rates[String(tier)] ?? 0,
  }))

  return (
    <div className="space-y-6">
      <InfoPanel title={`Die knapp verpassten Rekorde von ${stationName}`}>
        <p>
          Ein Rekord ist ein einziger Tag je Kalendertag und Größe; alles andere
          verschwindet, auch der Tag, der um ein Zehntel daneben lag. Davon gibt
          es sehr viel mehr — bei der Größe {field.label} stehen{' '}
          <span className="numeric">{num(rankTotal, 0)}</span> zweite und dritte
          Plätze gegen{' '}
          <span className="numeric">{num(field.totals.records, 0)}</span> Rekorde —
          und ihre Verteilung über die Zeit ist der belastbarere Befund. Ein
          Rekord kann ein Ausreißer sein, {num(rankTotal, 0)} Beinahe-Rekorde
          können es nicht.
        </p>
        <p>
          Zwei Lesarten stehen nebeneinander. <strong className="text-ink">Nach
          Abstand</strong> ist das, was man meint: innerhalb eines halben Grades
          des damals stehenden Rekords, bei Größen mit wachsenden Rekorden
          innerhalb eines Anteils davon. Anschaulich, aber nicht normiert — die
          Zahl der Messtage je Jahrzehnt ist verschieden, und wie extrem der
          Rekord schon war, auch.
        </p>
        <p>
          <strong className="text-ink">Nach Rang</strong> schließt diese Lücke:
          die k-te Messung eines Kalendertages ist mit Wahrscheinlichkeit 1/k
          seine zweitbeste — genauso, wie sie mit 1/k seine beste ist. Zweite und
          dritte Plätze tragen also dieselbe Erwartung wie Rekorde, und
          beobachtet gegen erwartet ist ohne weitere Annahme über die Jahrzehnte
          vergleichbar. Gezählt wird erst ab der{' '}
          {num(data.minObservation, 0)}. Messung eines Kalendertages; davor ist
          fast jeder Wert nah am Rekord, weil der Rekord noch nichts ist.
        </p>
      </InfoPanel>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Target}
            title="Auswahl"
            hint={`Abstand „${TIER_LABELS[tier] ?? tier}" bedeutet hier: ${marginText(field, tier)}.`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <ChoiceGroup
              label="Größe"
              value={field.key}
              choices={data.fields.map((f) => ({ value: f.key, label: f.short, title: f.label }))}
              onChange={setFieldKey}
              size="sm"
            />
            <span className="hidden h-5 w-px bg-line-strong sm:block" aria-hidden />
            <ChoiceGroup
              label="Abstand"
              value={String(tier)}
              choices={data.tiers.map((t) => ({
                value: String(t),
                label: TIER_LABELS[t] ?? `×${t}`,
                title: marginText(field, t),
              }))}
              onChange={setTierKey}
              size="sm"
            />
          </div>
        </div>
        {field.note && <p className="mt-3 text-[11px] text-ink-faint">{field.note}</p>}
      </Card>

      <StatGrid>
        <StatTile
          label="Fast-Rekorde"
          value={num(nearTotal, 0)}
          caption={`innerhalb von ${marginText(field, tier)} · gegen ${num(field.totals.records, 0)} echte Rekorde`}
          accent="warm"
          icon={Crosshair}
        />
        <StatTile
          label="Zweite und dritte Plätze"
          value={num(rankTotal, 0)}
          caption={`erwartbar wären ${num(2 * field.totals.expected, 0)} — ${num(
            rankTotal / Math.max(1, 2 * field.totals.expected),
            2,
          )}×`}
          accent="brand"
          icon={Dices}
        />
        <StatTile
          label={`Rangverhältnis ${early ? `${early.decade}er` : ''}`}
          value={early?.rankRatio !== null && early ? `${num(early.rankRatio, 2)}×` : '—'}
          caption={`${num(early?.rank2 ?? 0, 0)} zweite und ${num(early?.rank3 ?? 0, 0)} dritte Plätze`}
          accent="neutral"
        />
        <StatTile
          label={`Rangverhältnis ${late ? `${late.decade}er` : ''}`}
          value={late?.rankRatio !== null && late ? `${num(late.rankRatio, 2)}×` : '—'}
          caption={`${num(late?.rank2 ?? 0, 0)} zweite und ${num(late?.rank3 ?? 0, 0)} dritte Plätze`}
          accent={field.warm === false ? 'cold' : 'hot'}
          icon={Dices}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Ruler}
          title="Nach Abstand, je Jahrzehnt"
          hint="Balken sind die Zahl der Fast-Rekorde, die Linie ihre Rate je tausend Messtage — die Rate ist die vergleichbare Größe."
        />

        <div className="mt-4">
          <ChartFrame height={300}>
            <ResponsiveContainer>
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
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
                  width={44}
                  tickFormatter={(v: number) => num(v, 0)}
                />
                <YAxis
                  yAxisId="r"
                  orientation="right"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={48}
                  tickFormatter={(v: number) => `${num(v, 0)} ‰`}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof rows)[number]
                    return (
                      <ChartTooltip
                        title={`${row.decade}er Jahre`}
                        rows={[
                          { label: 'Fast-Rekorde', value: num(row.near, 0) },
                          { label: 'je 1.000 Messtage', value: `${num(row.rate, 1)} ‰` },
                          { label: 'echte Rekorde', value: num(row.records, 0) },
                          { label: 'Messtage', value: num(row.days, 0) },
                        ]}
                        footer={`Abstand: ${marginText(field, tier)}`}
                      />
                    )
                  }}
                />
                <Legend
                  verticalAlign="top"
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)', paddingBottom: 8 }}
                  iconType="plainline"
                />
                <Bar
                  yAxisId="n"
                  dataKey="near"
                  name="Fast-Rekorde"
                  fill={CHART.colors.warm}
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="r"
                  type="monotone"
                  dataKey="rate"
                  name="je 1.000 Messtage"
                  stroke={CHART.colors.accent}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Dices}
          title="Nach Rang, gegen den Zufall"
          hint="Zweite und dritte Plätze zusammen, geteilt durch das, was der Zufall gäbe. Die Eins ist ein unverändertes Klima."
        />

        <div className="mt-4">
          <ChartFrame height={300}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
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
                  width={48}
                  tickFormatter={(v: number) => `${num(v, 1)}×`}
                />
                <ReferenceLine
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
                    const row = payload[0]!.payload as NearDecade
                    return (
                      <ChartTooltip
                        title={`${row.decade}er Jahre`}
                        rows={[
                          { label: 'zweite Plätze', value: num(row.rank2, 0) },
                          { label: 'dritte Plätze', value: num(row.rank3, 0) },
                          { label: 'je Rang erwartbar', value: num(row.expected, 1) },
                          {
                            label: 'Verhältnis',
                            value: row.rankRatio !== null ? `${num(row.rankRatio, 2)}×` : '—',
                            className: ratioTone(row.rankRatio),
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Bar dataKey="rankRatio" radius={[3, 3, 0, 0]}>
                  {rows.map((row) => (
                    <Cell
                      key={row.decade}
                      fill={
                        row.rankRatio === null
                          ? CHART.colors.neutral
                          : row.rankRatio >= 1.3
                            ? CHART.colors.hot
                            : row.rankRatio <= 0.77
                              ? CHART.colors.cold
                              : CHART.colors.brand
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
          Diese Auswertung braucht keinen Schwellenwert und keine Einheit — nur
          die Reihenfolge der Werte. Sie sagt dasselbe wie die Rekordjahrgänge,
          stützt sich dabei aber auf gut sechsmal so viele Ereignisse, und genau
          das war der Grund, sie zu bauen.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Crosshair}
          title={`Die ${data.list} knappsten Verfehlungen`}
          hint={`Innerhalb von ${marginText(field, 1)} am damals stehenden Rekord vorbei.`}
        />

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Tag</th>
                <th className="px-2 py-2 text-right font-medium">Wert</th>
                <th className="px-2 py-2 text-right font-medium">Rekord damals</th>
                <th className="px-2 py-2 text-right font-medium">Abstand</th>
                <th className="px-2 py-2 text-right font-medium">Rang</th>
                <th className="px-2 py-2 text-right font-medium">Messung Nr.</th>
              </tr>
            </thead>
            <tbody>
              {field.closest.map((miss) => (
                <tr key={miss.date} className="border-b border-line/60 last:border-0">
                  <td className="numeric py-1.5 pr-3 text-ink">{isoToGerman(miss.date)}</td>
                  <td className="numeric px-2 py-1.5 text-right font-semibold text-ink">
                    {value(field, miss.value)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {value(field, miss.record)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right font-semibold text-warm">
                    {num(miss.gap, Math.max(1, field.decimals))} {field.unit}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">{miss.rank}.</td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                    {num(miss.observation, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          „Rekord damals" ist der Wert, der an diesem Kalendertag stand, als die
          Messung gemacht wurde — nicht der heutige. Ein Tag von 1960 wird gegen
          das gemessen, was er hätte schlagen müssen, und nicht gegen etwas, das
          erst 1994 aufgestellt wurde. „Messung Nr." sagt, die wievielte Messung
          dieses Kalendertages es war; je größer die Zahl, desto schwerer war der
          Rekord zu schlagen. Der Anteil aller Messtage, die knapp danebenlagen,
          liegt bei {shareOf(nearTotal / Math.max(1, rows.reduce((a, r) => a + r.days, 0)), 2)}.
        </p>
      </Card>
    </div>
  )
}
