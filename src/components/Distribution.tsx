import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Layers, Move3d, Snowflake, Thermometer } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, signed } from '../lib/format'
import type { DistributionResponse } from '../types'
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

/**
 * The three reference periods, oldest to newest.
 *
 * Colour carries the reading here: the oldest period cold, the newest hot, the
 * one between them neutral. A reader who sees the blue curve sitting to the
 * left of the red one has understood the chart before reading a single number.
 */
const PERIOD_COLORS = [CHART.colors.cold, CHART.colors.neutral, CHART.colors.hot]

/** P1, P5, … Median … — the middle one gets its name because it has one. */
function quantileLabel(p: number): string {
  if (p === 0.5) return 'Median'
  return `P${num(p * 100, (p * 100) % 1 === 0 ? 0 : 1)}`
}

/**
 * Round tick positions for a numeric axis.
 *
 * Left to itself recharts derives the ticks from the data bounds, and the
 * bounds here are band midpoints like −21 and 27 — so the last two labels land
 * three units apart and overlap. Picking the step from the range instead puts
 * them on multiples of five, which is also how one reads a temperature scale.
 */
function niceTicks(min: number, max: number, target = 8): number[] {
  const raw = (max - min) / target
  if (!Number.isFinite(raw) || raw <= 0) return []
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude

  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)))
  }
  return ticks
}

/* -------------------------------------------------------------------------- */

export function Distribution({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [fieldKey, setFieldKey] = useUrlState<string>('groesse', 'temp_mean')
  const { data, loading, error } = useApi<DistributionResponse>(
    `/api/weather/distribution?stationId=${stationId}`,
    [stationId],
  )

  if (loading && !data) return <Loading message="Verteilungen werden gerechnet …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const entry = data.fields.find((f) => f.field.key === fieldKey) ?? data.fields[0]
  if (!entry) return null

  const { field, periods, comparison } = entry
  const colorOf = (index: number) => PERIOD_COLORS[index] ?? CHART.colors.brand

  /** Band midpoints, so the curve sits over the bin rather than at its edge. */
  const curve: ({ from: number; to: number; mid: number } & Record<string, number>)[] =
    entry.bands.map((band) => ({ ...band, mid: band.from + field.width / 2 }))

  const changes = entry.bands.map((band) => ({
    from: band.from,
    to: band.to,
    mid: band.from + field.width / 2,
    change: (band[periods.at(-1)!.key] ?? 0) - (band[periods[0]!.key] ?? 0),
  }))

  const ticks = niceTicks(curve[0]?.mid ?? 0, curve.at(-1)?.mid ?? 0)

  const p1 = comparison.quantileChange.find((q) => q.p === 0.01)
  const p50 = comparison.quantileChange.find((q) => q.p === 0.5)
  const p99 = comparison.quantileChange.find((q) => q.p === 0.99)

  const bandLabel = (from: number, to: number) =>
    `${num(from, 0)} bis ${num(to, 0)} ${field.unit}`

  return (
    <div className="space-y-6">
      <InfoPanel title={`Verteilungsverschiebung in ${stationName}`}>
        <p>
          Jeder andere Trend hier gibt einen Mittelwert an: eine Zahl je
          Jahrzehnt, eine Gerade durch eine Wolke. „Ein Grad wärmer" ist richtig
          und sagt fast nichts darüber, <em>was</em> sich verändert hat. Ein
          Mittelwert kann steigen, weil der kalte Rand kürzer wurde, weil der
          warme Rand wuchs oder weil sich alles gemeinsam verschob — und das sind
          drei verschiedene Klimata.
        </p>
        <p>
          Bei {num(periods.reduce((a, p) => a + p.days, 0), 0)} Tagen in{' '}
          {periods.length} Perioden muss man nicht raten. Dieselben Tage, in
          Klassen von {field.width} {field.unit} sortiert und je Referenzperiode
          gezählt, zeigen, welcher Teil des Jahres sich tatsächlich bewegt hat.
          Aufgetragen sind Anteile, keine Stückzahlen: die Perioden enthalten
          unterschiedlich viele gültige Tage, und ein Balkendiagramm der rohen
          Zahlen würde vor allem das zeigen.
        </p>
      </InfoPanel>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Thermometer}
            title="Größe"
            hint="Tagesmittel, Höchst- und Tiefstwert verschieben sich nicht im selben Maß — das ist der Punkt."
          />
          <ChoiceGroup
            label="Größe"
            value={field.key}
            choices={data.fields.map((f) => ({ value: f.field.key, label: f.field.short }))}
            onChange={setFieldKey}
            size="sm"
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Periode</th>
                <th className="px-2 py-2 text-right font-medium">Tage</th>
                <th className="px-2 py-2 text-right font-medium">Mittel</th>
                <th className="px-2 py-2 text-right font-medium">Median</th>
                <th className="px-2 py-2 text-right font-medium">P5</th>
                <th className="px-2 py-2 text-right font-medium">P95</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period, i) => (
                <tr key={period.key} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-3">
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: colorOf(i) }}
                    />
                    <span className="text-ink">{period.label}</span>
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {num(period.days, 0)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right font-semibold text-ink">
                    {num(period.mean, field.decimals)} {field.unit}
                  </td>
                  {[0.5, 0.05, 0.95].map((p) => (
                    <td key={p} className="numeric px-2 py-1.5 text-right text-ink-muted">
                      {num(period.quantiles.find((q) => q.p === p)?.value, field.decimals)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-ink-faint">
          Eine Periode wird nur gezeigt, wenn sie mindestens {num(entry.minDays, 0)}{' '}
          gültige Tage hat — dreißig Jahre sind rund 10 900 Tage, darunter fehlt
          ein Fünftel und die Ränder sind mit einer vollständigen Periode nicht
          mehr vergleichbar.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <StatGrid>
        <StatTile
          label="Mittelwert"
          value={`${signed(comparison.meanChange, 2)} K`}
          caption={`${comparison.from} → ${comparison.to}`}
          accent="neutral"
          icon={Move3d}
        />
        <StatTile
          label="Kälteste Tage (P1)"
          value={p1?.change === null || p1 === undefined ? '—' : `${signed(p1.change, 2)} K`}
          caption={
            p1?.from === null || p1?.to === null || !p1
              ? '—'
              : `${num(p1.from, field.decimals)} → ${num(p1.to, field.decimals)} ${field.unit}`
          }
          accent="cold"
          icon={Snowflake}
        />
        <StatTile
          label="Median"
          value={p50?.change === null || p50 === undefined ? '—' : `${signed(p50.change, 2)} K`}
          caption="Der mittlere Tag — die Zahl, die ein Trend berichtet"
          accent="brand"
          icon={Layers}
        />
        <StatTile
          label="Wärmste Tage (P99)"
          value={p99?.change === null || p99 === undefined ? '—' : `${signed(p99.change, 2)} K`}
          caption={
            p99?.from === null || p99?.to === null || !p99
              ? '—'
              : `${num(p99.from, field.decimals)} → ${num(p99.to, field.decimals)} ${field.unit}`
          }
          accent="hot"
          icon={Thermometer}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={BarChart3}
          title={`Verteilung — ${field.label}`}
          hint={`Anteil aller Tage der Periode je Klasse von ${field.width} ${field.unit}.`}
        />

        <div className="mt-4">
          <ChartFrame height={340}>
            <ResponsiveContainer>
              <LineChart data={curve} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="mid"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  ticks={ticks}
                  tickFormatter={(v: number) => `${num(v, 0)}`}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={44}
                  tickFormatter={(v: number) => `${num(v, 0)} %`}
                />
                <Tooltip
                  cursor={{ stroke: CHART.cursorSoft, strokeWidth: 1 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof curve)[number]
                    return (
                      <ChartTooltip
                        title={bandLabel(row.from, row.to)}
                        subtitle="Anteil aller Tage der Periode"
                        rows={periods.map((period, i) => ({
                          label: period.label,
                          value: `${num(row[period.key] ?? 0, 2)} %`,
                          className: i === 0 ? 'text-cold' : i === periods.length - 1 ? 'text-hot' : 'text-ink',
                        }))}
                      />
                    )
                  }}
                />
                {periods.map((period, i) => (
                  <Line
                    key={period.key}
                    type="monotone"
                    dataKey={period.key}
                    name={period.label}
                    stroke={colorOf(i)}
                    strokeWidth={i === 0 || i === periods.length - 1 ? 2 : 1.25}
                    strokeDasharray={i === 0 || i === periods.length - 1 ? undefined : '4 3'}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-ink-muted">
          {periods.map((period, i) => (
            <li key={period.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ background: colorOf(i) }}
              />
              {period.label}
            </li>
          ))}
        </ul>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Move3d}
          title="Was sich je Klasse verändert hat"
          hint={`Differenz der Anteile, ${comparison.to} minus ${comparison.from}, in Prozentpunkten.`}
        />

        <div className="mt-4">
          <ChartFrame height={280}>
            <ResponsiveContainer>
              <BarChart data={changes} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="mid"
                  type="number"
                  domain={['dataMin - 1', 'dataMax + 1']}
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  ticks={ticks}
                  tickFormatter={(v: number) => `${num(v, 0)}`}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={48}
                  tickFormatter={(v: number) => `${signed(v, 1)}`}
                />
                <ReferenceLine y={0} stroke={CHART.axis} />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof changes)[number]
                    return (
                      <ChartTooltip
                        title={bandLabel(row.from, row.to)}
                        rows={[
                          {
                            label: 'Veränderung',
                            value: `${signed(row.change, 2)} Pp.`,
                            className: row.change >= 0 ? 'text-hot' : 'text-cold',
                          },
                        ]}
                        footer={`${comparison.to} gegenüber ${comparison.from}`}
                      />
                    )
                  }}
                />
                <Bar dataKey="change" radius={[2, 2, 2, 2]}>
                  {changes.map((row) => (
                    <Cell
                      key={row.from}
                      fill={row.change >= 0 ? CHART.colors.hot : CHART.colors.cold}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
          {comparison.biggestGain && (
            <>
              Am meisten gewonnen hat die Klasse{' '}
              <span className="text-hot">
                {bandLabel(comparison.biggestGain.from, comparison.biggestGain.to)}
              </span>{' '}
              mit <span className="numeric">{signed(comparison.biggestGain.change, 2)}</span>{' '}
              Prozentpunkten.
            </>
          )}
          {comparison.biggestLoss && (
            <>
              {' '}Am meisten verloren die Tage um{' '}
              <span className="text-cold">
                {bandLabel(comparison.biggestLoss.from, comparison.biggestLoss.to)}
              </span>{' '}
              mit <span className="numeric">{signed(comparison.biggestLoss.change, 2)}</span>{' '}
              Prozentpunkten.
            </>
          )}
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Layers}
          title="Die Ränder gegen die Mitte"
          hint="Ein Mittelwert kann sich verschieben, ohne dass sich die Ränder mitbewegen. Hier bewegen sie sich unterschiedlich stark."
        />

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[440px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Perzentil</th>
                <th className="px-2 py-2 text-right font-medium">{comparison.from}</th>
                <th className="px-2 py-2 text-right font-medium">{comparison.to}</th>
                <th className="px-2 py-2 text-right font-medium">Veränderung</th>
              </tr>
            </thead>
            <tbody>
              {comparison.quantileChange.map((q) => (
                <tr key={q.p} className="border-b border-line/60 last:border-0">
                  <td className={`py-1.5 pr-3 ${q.p === 0.5 ? 'text-ink' : 'text-ink-muted'}`}>
                    {quantileLabel(q.p)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {num(q.from, field.decimals)} {field.unit}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {num(q.to, field.decimals)} {field.unit}
                  </td>
                  <td
                    className={`numeric px-2 py-1.5 text-right font-semibold ${
                      q.change === null ? 'text-ink-faint' : q.change >= 0 ? 'text-hot' : 'text-cold'
                    }`}
                  >
                    {q.change === null ? '—' : `${signed(q.change, 2)} K`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-ink-faint">
          Steht in der letzten Spalte oben ein deutlich größerer Wert als in der
          Mitte, dann hat sich der kalte Rand stärker erwärmt als der
          Durchschnittstag — die Verteilung ist nicht nur verschoben, sondern
          auch schmaler geworden.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      {data.thresholds.length > 0 && (
        <Card>
          <SectionHeading
            icon={Snowflake}
            title="Kenntage je Jahr"
            hint="Dieselbe Verschiebung in der Einheit, in der man über Wetter spricht."
          />

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th className="py-2 pr-3 text-left font-medium">Kenntag</th>
                  {data.periods.map((p) => (
                    <th key={p.key} className="px-2 py-2 text-right font-medium">
                      {p.label}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Veränderung</th>
                </tr>
              </thead>
              <tbody>
                {data.thresholds.map((threshold) => (
                  <tr key={threshold.key} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 pr-3">
                      <span className="text-ink">{threshold.label}</span>
                      <span className="block text-[10px] text-ink-faint">{threshold.note}</span>
                    </td>
                    {data.periods.map((period) => {
                      const hit = threshold.periods.find((p) => p.key === period.key)
                      return (
                        <td
                          key={period.key}
                          className="numeric px-2 py-1.5 text-right text-ink-muted"
                        >
                          {hit ? num(hit.perYear, 1) : '—'}
                        </td>
                      )
                    })}
                    <td
                      className={`numeric px-2 py-1.5 text-right font-semibold ${
                        threshold.change >= 0 ? 'text-hot' : 'text-cold'
                      }`}
                    >
                      {signed(threshold.change, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-[11px] text-ink-muted">
            {data.thresholds.map((threshold) => (
              <li key={threshold.key}>
                <span className="text-ink">{threshold.label}</span>:{' '}
                {threshold.ever.days === 0 ? (
                  <>in der ganzen Reihe kein einziger Tag.</>
                ) : (
                  <>
                    <span className="numeric">{num(threshold.ever.days, 0)}</span>{' '}
                    {threshold.ever.days === 1 ? 'Tag' : 'Tage'} in der ganzen Reihe, der
                    erste am {isoToGerman(threshold.ever.first)}, der letzte am{' '}
                    {isoToGerman(threshold.ever.last)}.
                  </>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[11px] text-ink-faint">
            Ein Wert von 0,0 je Jahr heißt nicht, dass es den Tag nie gab — er
            heißt, dass er zu selten ist, um sich auf ein Jahr umzurechnen.
            Deshalb steht darüber, wie oft es ihn überhaupt gab. Gezählt wird
            eine Periode nur, wenn sie mindestens 25 Jahre mit Messwerten hat.
          </p>
        </Card>
      )}
    </div>
  )
}
