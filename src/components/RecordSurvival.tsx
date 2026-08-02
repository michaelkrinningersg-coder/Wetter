import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, AlertTriangle, Hourglass, Scale } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf } from '../lib/format'
import type { RecordSurvivalResponse, SurvivalEra, SurvivalSpell } from '../types'
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

/** Oldest era coolest, newest warmest — the eras are a sequence, not categories. */
const ERA_COLORS = [
  CHART.colors.cold,
  CHART.colors.cool,
  CHART.colors.warm,
  CHART.colors.hot,
]

function value(spell: SurvivalSpell, v: number | null): string {
  if (v === null) return '—'
  if (spell.unit === 'm/s') return `${num(v * 3.6, 0)} km/h`
  return `${num(v, spell.decimals)} ${spell.unit}`
}

function SpellTable({ spells, running }: { spells: SurvivalSpell[]; running: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-line text-ink-muted">
            <th className="py-2 pr-3 text-left font-medium">Größe</th>
            <th className="px-2 py-2 text-right font-medium">Wert</th>
            <th className="px-2 py-2 text-right font-medium">aufgestellt</th>
            <th className="px-2 py-2 text-right font-medium">
              {running ? 'steht seit' : 'gefallen am'}
            </th>
            <th className="px-2 py-2 text-right font-medium">Dauer</th>
          </tr>
        </thead>
        <tbody>
          {spells.map((spell, i) => (
            <tr key={`${spell.field}-${spell.date}-${i}`} className="border-b border-line/60 last:border-0">
              <td className="py-1.5 pr-3 text-ink-muted">{spell.label}</td>
              <td className="numeric px-2 py-1.5 text-right font-semibold text-ink">
                {value(spell, spell.value)}
              </td>
              <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                {isoToGerman(spell.date)}
              </td>
              <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                {running ? (
                  <span className="text-good">läuft</span>
                ) : (
                  <>
                    {isoToGerman(spell.until)}
                    <span className="ml-1.5 text-[10px] text-ink-faint">
                      {value(spell, spell.untilValue)}
                    </span>
                  </>
                )}
              </td>
              <td className="numeric px-2 py-1.5 text-right text-base font-semibold text-brand">
                {num(spell.years, 0)} J
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RecordSurvival({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [groupKey, setGroupKey] = useUrlState<string>('gruppe', 'alle')
  const { data, loading, error } = useApi<RecordSurvivalResponse>(
    `/api/weather/record-survival?stationId=${stationId}`,
    [stationId],
  )

  const group = data?.groups[groupKey] ?? data?.groups.alle ?? null

  /** The four era curves merged onto one x-axis, once per clock. */
  const yearCurve = useMemo(() => {
    if (!group) return []
    const rows = new Map<number, Record<string, number>>()
    for (const era of group.eras) {
      for (const point of era.curve) {
        const row = rows.get(point.t) ?? { t: point.t }
        row[era.key] = point.survival
        rows.set(point.t, row)
      }
    }
    return [...rows.values()].sort((a, b) => a.t! - b.t!)
  }, [group])

  const stepCurve = useMemo(() => {
    if (!group) return []
    const rows = new Map<number, Record<string, number>>()
    for (const era of group.eras) {
      for (const point of era.steps?.curve ?? []) {
        if (point.ratio === null || point.ratio === undefined) continue
        const row = rows.get(point.t) ?? { t: point.t }
        row[era.key] = point.ratio
        row[`${era.key}_obs`] = point.survival
        row[`${era.key}_exp`] = point.expected ?? 0
        rows.set(point.t, row)
      }
    }
    return [...rows.values()].sort((a, b) => a.t! - b.t!)
  }, [group])

  if (loading && !data) return <Loading message="Überlebenskurven werden geschätzt …" />
  if (error) return <ErrorState message={error} />
  if (!data || !group) return null

  const first = group.eras[0]
  const last = group.eras.at(-1)
  const colorOf = (index: number) => ERA_COLORS[index] ?? CHART.colors.brand

  // The point that departs furthest from chance, so the paragraph below quotes
  // the selection's own numbers instead of a sentence written for one of them.
  const extreme = group.eras
    .flatMap((era) =>
      (era.steps?.curve ?? [])
        .filter((point) => point.ratio !== null && point.ratio !== undefined)
        .map((point) => ({ era, point })),
    )
    .sort((a, b) => Math.abs(b.point.ratio! - 1) - Math.abs(a.point.ratio! - 1))[0]

  return (
    <div className="space-y-6">
      <InfoPanel title={`Wie lange ein Rekord in ${stationName} überlebt`}>
        <p>
          Zwei Schwierigkeiten stecken in dieser Frage. Die Rekorde, die noch
          stehen, haben kein Enddatum — nur die bereits gefallenen zu mitteln,
          beantwortete eine andere und viel kürzere Frage. Und die
          Expositionszeit ist ungleich: ein Rekord von 1870 hatte 156 Jahre Zeit
          zu fallen, einer von 2019 sieben.
        </p>
        <p>
          Das Erste löst Kaplan-Meier: bei jedem Zeitpunkt, an dem Rekorde
          fielen, wird die Schätzung mit (1 − gefallen / noch im Risiko)
          multipliziert, und ein noch stehender Rekord verlässt die Risikogruppe,
          ohne je als gefallen zu zählen. Die Kurve wird nur so weit gezeichnet,
          wie die Daten reichen.
        </p>
        <p>
          Das Zweite ist schwerer, und die naheliegende Auswertung führt in die
          Irre. Ein Rekord, der bei der dritten Messung eines Kalendertages
          aufgestellt wurde, fällt schnell — zwei Drittel aller späteren Werte
          schlagen einen dritten Platz. Einer, der bei der hundertfünfzigsten
          aufgestellt wurde, hält lange, ganz ohne Klimawandel. Deshalb steht
          neben der Jahresuhr eine zweite Rechnung, die in Messungen zählt und
          gegen den Zufall vergleicht.
        </p>
      </InfoPanel>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Hourglass}
            title="Auf der Jahresuhr"
            hint="Anteil der Rekorde, die nach so vielen Jahren noch standen — je Epoche, in der sie aufgestellt wurden."
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
          <ChartFrame height={320}>
            <ResponsiveContainer>
              <LineChart data={yearCurve} margin={{ top: 8, right: 16, bottom: 24, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="log"
                  domain={[0.5, 125]}
                  ticks={[0.5, 1, 2, 5, 10, 20, 50, 100]}
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => (v < 1 ? `${num(v, 1)}` : num(v, 0))}
                  label={{
                    value: 'Jahre seit dem Rekord (logarithmisch)',
                    position: 'insideBottom',
                    offset: -8,
                    fill: 'var(--color-chart-tick)',
                    fontSize: 11,
                  }}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={48}
                  domain={[0, 1]}
                  tickFormatter={(v: number) => `${num(v * 100, 0)} %`}
                />
                <ReferenceLine y={0.5} stroke={CHART.axis} strokeDasharray="4 3" />
                <Tooltip
                  cursor={{ stroke: CHART.cursorSoft, strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <ChartTooltip
                        title={`nach ${num(Number(label), 1)} Jahren`}
                        rows={group.eras.map((era, i) => ({
                          label: era.label,
                          value:
                            typeof payload[0]!.payload[era.key] === 'number'
                              ? shareOf(payload[0]!.payload[era.key])
                              : '—',
                          className:
                            i === 0 ? 'text-cold' : i === group.eras.length - 1 ? 'text-hot' : 'text-ink',
                        }))}
                      />
                    )
                  }}
                />
                <Legend
                  verticalAlign="top"
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)', paddingBottom: 8 }}
                  iconType="plainline"
                />
                {group.eras.map((era, i) => (
                  <Line
                    key={era.key}
                    type="stepAfter"
                    dataKey={era.key}
                    name={era.label}
                    stroke={colorOf(i)}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <div className="mt-4 flex gap-3 rounded-card border border-warm/40 bg-raised p-3">
          <AlertTriangle className="size-4 shrink-0 translate-y-0.5 text-warm" aria-hidden />
          <p className="text-[11px] leading-relaxed text-ink-muted">
            Diese Kurven sehen nach einem Befund aus und sind vor allem eine
            Buchhaltung. Rekorde der frühen Jahrzehnte fielen schnell, weil das
            Archiv damals kurz war und fast jeder neue Wert etwas schlug — im
            Mittel saßen sie auf der{' '}
            <span className="numeric">{num(first?.steps?.meanOrdinal ?? 0, 0)}</span>. Messung
            ihres Kalendertages, die der jüngsten Epoche auf der{' '}
            <span className="numeric">{num(last?.steps?.meanOrdinal ?? 0, 0)}</span>. Wer daraus
            liest, Rekorde hielten heute länger, misst die Länge des Archivs.
            Die nächste Karte rechnet das heraus.
          </p>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Scale}
          title="Auf der Beobachtungsuhr, gegen den Zufall"
          hint="Verhältnis von beobachtetem zu erwartetem Überleben. Ein Rekord der k-ten Messung überlebt die nächsten m mit Wahrscheinlichkeit k/(k+m) — das ist die Eins."
        />

        <div className="mt-4">
          <ChartFrame height={320}>
            <ResponsiveContainer>
              <LineChart data={stepCurve} margin={{ top: 8, right: 16, bottom: 24, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => num(v, 0)}
                  label={{
                    value: 'weitere Messungen desselben Kalendertages',
                    position: 'insideBottom',
                    offset: -8,
                    fill: 'var(--color-chart-tick)',
                    fontSize: 11,
                  }}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={48}
                  domain={[
                    (min: number) => Math.min(0.9, Math.floor(min * 20) / 20),
                    (max: number) => Math.max(1.1, Math.ceil(max * 20) / 20),
                  ]}
                  tickFormatter={(v: number) => `${num(v, 2)}×`}
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
                  cursor={{ stroke: CHART.cursorSoft, strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as Record<string, number>
                    return (
                      <ChartTooltip
                        title={`nach ${num(Number(label), 0)} weiteren Messungen`}
                        rows={group.eras.flatMap((era) =>
                          typeof row[era.key] === 'number'
                            ? [
                                {
                                  label: era.label,
                                  value: `${shareOf(row[`${era.key}_obs`]!)} statt ${shareOf(
                                    row[`${era.key}_exp`]!,
                                  )} — ${num(row[era.key]!, 2)}×`,
                                  className:
                                    row[era.key]! >= 1.05
                                      ? 'text-cold'
                                      : row[era.key]! <= 0.95
                                        ? 'text-hot'
                                        : 'text-ink',
                                },
                              ]
                            : [],
                        )}
                        footer="Über 1 heißt: haltbarer als der Zufall. Unter 1: die Rekorde fielen schneller, als sie sollten."
                      />
                    )
                  }}
                />
                <Legend
                  verticalAlign="top"
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)', paddingBottom: 8 }}
                  iconType="plainline"
                />
                {group.eras.map((era, i) => (
                  <Line
                    key={era.key}
                    type="monotone"
                    dataKey={era.key}
                    name={era.label}
                    stroke={colorOf(i)}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
          Auf dieser Uhr verschwindet der größte Teil des Epochenunterschieds —
          der Sprung in der oberen Karte war wirklich Buchhaltung. Was übrig
          bleibt, geht in die erwartete Richtung: warme Rekorde fallen schneller,
          als der Zufall hergibt, kalte halten länger.
          {extreme && (
            <>
              {' '}In dieser Auswahl weicht die Kurve am weitesten bei{' '}
              <span className="text-ink">{extreme.era.label}</span> ab — nach{' '}
              <span className="numeric">{num(extreme.point.t, 0)}</span> weiteren
              Messungen standen noch{' '}
              <span className="numeric">{shareOf(extreme.point.survival)}</span> statt der
              erwarteten <span className="numeric">{shareOf(extreme.point.expected ?? 0)}</span>,
              also{' '}
              <span
                className={
                  extreme.point.ratio! >= 1 ? 'numeric text-cold' : 'numeric text-hot'
                }
              >
                {num(extreme.point.ratio!, 2)}×
              </span>
              . Der Faktor sechs, den die Jahresuhr suggeriert, bleibt in keinem
              Fall übrig.
            </>
          )}
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <StatGrid>
        <StatTile
          label="Rekorde insgesamt"
          value={num(group.overall?.n ?? 0, 0)}
          caption={`${num(group.overall?.censored ?? 0, 0)} stehen noch — sie zählen als zensiert, nicht als gefallen`}
          accent="brand"
          icon={Activity}
        />
        <StatTile
          label="Median auf der Jahresuhr"
          value={group.overall?.median !== null && group.overall ? `${num(group.overall.median, 0)} Jahre` : '—'}
          caption="nach so langer Zeit stand die Hälfte noch"
          accent="neutral"
          icon={Hourglass}
        />
        <StatTile
          label="Frühe Epoche"
          value={first?.median !== null && first ? `${num(first.median, 0)} Jahre` : '—'}
          caption={`${first?.label} · ${num(first?.n ?? 0, 0)} Rekorde, im Mittel die ${num(first?.steps?.meanOrdinal ?? 0, 0)}. Messung`}
          accent="cold"
        />
        <StatTile
          label="Jüngste Epoche"
          value={last?.median !== null && last ? `${num(last.median, 0)} Jahre` : 'noch offen'}
          caption={`${last?.label} · ${num(last?.censored ?? 0, 0)} von ${num(last?.n ?? 0, 0)} stehen noch`}
          accent="hot"
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading icon={Scale} title="Die Epochen in Zahlen" />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Epoche</th>
                <th className="px-2 py-2 text-right font-medium">Rekorde</th>
                <th className="px-2 py-2 text-right font-medium">stehen noch</th>
                <th className="px-2 py-2 text-right font-medium">Median</th>
                <th className="px-2 py-2 text-right font-medium">nach 10 J</th>
                <th className="px-2 py-2 text-right font-medium">mittleres k</th>
                <th className="px-2 py-2 text-right font-medium">gegen Zufall</th>
              </tr>
            </thead>
            <tbody>
              {group.eras.map((era: SurvivalEra, i) => {
                const ratio = era.steps?.curve.find((c) => c.t === 12)?.ratio ?? null
                return (
                  <tr key={era.key} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 pr-3">
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: colorOf(i) }}
                      />
                      <span className="text-ink">{era.label}</span>
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                      {num(era.n, 0)}
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                      {num(era.censored, 0)}
                    </td>
                    <td className="numeric px-2 py-1.5 text-right font-semibold text-ink">
                      {era.median !== null ? `${num(era.median, 0)} J` : 'offen'}
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                      {era.at10 !== null ? shareOf(era.at10) : '—'}
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                      {num(era.steps?.meanOrdinal ?? 0, 0)}
                    </td>
                    <td
                      className={`numeric px-2 py-1.5 text-right font-semibold ${
                        ratio === null
                          ? 'text-ink-faint'
                          : ratio >= 1.05
                            ? 'text-cold'
                            : ratio <= 0.95
                              ? 'text-hot'
                              : 'text-ink'
                      }`}
                    >
                      {ratio !== null ? `${num(ratio, 2)}×` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          „Median" ist die Zeit, nach der die Hälfte der Rekorde gefallen war;
          „offen" heißt, dass in dieser Epoche noch mehr als die Hälfte steht und
          der Median deshalb nicht schätzbar ist — nicht, dass er unendlich wäre.
          „Mittleres k" ist die Nummer der Messung, bei der die Rekorde dieser
          Epoche im Mittel aufgestellt wurden, und erklärt den größten Teil des
          Unterschieds in der Spalte davor. „Gegen Zufall" vergleicht nach zwölf
          weiteren Messungen.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Hourglass}
          title="Die langlebigsten gefallenen Rekorde"
          hint="Werte, die ein Jahrhundert und länger standen, bevor sie eingeholt wurden."
        />
        <div className="mt-4">
          <SpellTable spells={data.longest.completed} running={false} />
        </div>
      </Card>

      <Card>
        <SectionHeading
          icon={Activity}
          title="Die am längsten laufenden Rekorde"
          hint="Sie stehen noch — ihre endgültige Dauer ist unbekannt und geht als zensiert in die Schätzung ein."
        />
        <div className="mt-4">
          <SpellTable spells={data.longest.standing} running />
        </div>
      </Card>
    </div>
  )
}
