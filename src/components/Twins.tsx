import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Fingerprint } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf, year as yearOf } from '../lib/format'
import type { TwinDay, TwinField, TwinsResponse } from '../types'
import {
  CHART,
  Card,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

function fieldValue(field: TwinField, value: number | undefined): string {
  if (value === undefined) return '—'
  if (field.unit === 'm/s') return `${num(value * 3.6, 0)} km/h`
  return `${num(value, field.decimals)} ${field.unit}`
}

/**
 * How a distance reads in words.
 *
 * The number is in standard deviations and means nothing without the archive's
 * own scale, which the payload carries as the median best match.
 */
function verdict(distance: number, median: number): { text: string; tone: string } {
  if (distance <= median * 0.75) return { text: 'ungewöhnlich ähnlich', tone: 'text-good' }
  if (distance <= median * 1.25) return { text: 'so ähnlich wie üblich', tone: 'text-ink' }
  if (distance <= median * 2) return { text: 'nur entfernt ähnlich', tone: 'text-warm' }
  return { text: 'ohne echtes Gegenstück', tone: 'text-hot' }
}

export function Twins({ stationId, stationName }: { stationId: string; stationName: string }) {
  const [date, setDate] = useUrlState<string>('datum', null)
  const [setKey, setSetKey] = useUrlState<string>('satz', 'kern')

  const query = [`stationId=${stationId}`, date ? `datum=${date}` : '', `satz=${setKey}`]
    .filter(Boolean)
    .join('&')
  const { data, loading, error } = useApi<TwinsResponse>(`/api/weather/twins?${query}`, [
    stationId,
    date,
    setKey,
  ])

  if (loading && !data) return <Loading message="Wetterzwillinge werden gesucht …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const fields = data.fields ?? []
  const best: TwinDay | undefined = data.twins[0]
  const median = data.baseline?.median ?? 0
  const call = best && median > 0 ? verdict(best.distance, median) : null

  const step = (days: number) => {
    const base = data.reference?.date ?? data.available.last
    const at = new Date(`${base}T00:00:00Z`)
    at.setUTCDate(at.getUTCDate() + days)
    const iso = at.toISOString().slice(0, 10)
    if (iso >= data.available.first && iso <= data.available.last) setDate(iso)
  }

  return (
    <div className="space-y-6">
      <InfoPanel title={`Wetterzwillinge von ${stationName}`}>
        <p>
          Jede andere Auswertung hier zerlegt das Archiv in eine Größe nach der
          anderen. Diese fragt umgekehrt: nimmt man einen ganzen Tag, wie er war
          — wie warm, wie nass, wie bewölkt, was das Barometer sagte —, hat es so
          etwas schon einmal gegeben?
        </p>
        <p>
          Verglichen wird in Standardabweichungen, nicht in den Einheiten der
          Größen: 5 mm Regen und 5 °C sind keine vergleichbaren Mengen. Jede
          Größe wird über die ganze Reihe standardisiert, und der Abstand zweier
          Tage ist das quadratische Mittel ihrer standardisierten Differenzen.
          Ein Abstand von eins bedeutet, dass sich zwei Tage im Schnitt so stark
          unterscheiden wie zwei zufällig gezogene.
        </p>
        <p>
          Über die Jahreszeit wird nichts vorgegeben — sie ergibt sich. Ein
          Januartag liegt allein in der Temperatur drei Standardabweichungen von
          einem Julitag entfernt, deshalb ist der nächste Nachbar eines
          Januartages immer wieder ein Wintertag. Ausgeschlossen sind nur die{' '}
          {num(data.minGapDays ?? 7, 0)} Tage vor und nach dem Bezugstag: der
          Vortag ist immer der ähnlichste und gehört zur selben Wetterlage.
        </p>
      </InfoPanel>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Fingerprint}
            title={
              data.reference
                ? `Der ${isoToGerman(data.reference.date)} und seine Zwillinge`
                : 'Wetterzwillinge'
            }
            hint={`${num(data.available.days, 0)} vollständig gemessene Tage von ${isoToGerman(
              data.available.first,
            )} bis ${isoToGerman(data.available.last)}.`}
            actions={
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Vorheriger Tag"
                  className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <input
                  type="date"
                  value={data.reference?.date ?? data.available.last}
                  min={data.available.first}
                  max={data.available.last}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  aria-label="Bezugstag"
                  className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink"
                />
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Nächster Tag"
                  className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
            }
          />
          <ChoiceGroup
            label="Größen"
            value={data.set}
            choices={data.sets.map((s) => ({ value: s.key, label: s.label, title: s.note }))}
            onChange={setSetKey}
            size="sm"
          />
        </div>

        <p className="mt-3 text-[11px] text-ink-faint">
          {data.sets.find((s) => s.key === data.set)?.note}
        </p>

        {data.hint && <EmptyState message={data.hint} />}
      </Card>

      {data.reference && best && (
        <>
          <StatGrid>
            <StatTile
              label="Ähnlichster Tag"
              value={isoToGerman(best.date)}
              caption={`${num(best.yearsApart, 0)} Jahre entfernt · im Kalender ${num(best.calendarGap, 0)} Tage`}
              accent="brand"
              icon={Copy}
            />
            <StatTile
              label="Abstand"
              value={num(best.distance, 2)}
              caption={`in Standardabweichungen · üblich sind ${num(median, 2)}`}
              accent="neutral"
              icon={Fingerprint}
            />
            <StatTile
              label="Einordnung"
              value={call?.text ?? '—'}
              caption={
                data.percentile !== null && data.percentile !== undefined
                  ? `${shareOf(data.percentile)} aller Tage haben einen näheren Zwilling`
                  : undefined
              }
              accent={
                call?.tone === 'text-hot'
                  ? 'hot'
                  : call?.tone === 'text-warm'
                    ? 'warm'
                    : call?.tone === 'text-good'
                      ? 'good'
                      : 'neutral'
              }
            />
            <StatTile
              label="Kalenderabstand"
              value={`${num(best.calendarGap, 0)} Tage`}
              caption="wie weit die beiden im Jahreslauf auseinanderliegen — ohne Vorgabe entstanden"
              accent="cool"
              icon={CalendarRange}
            />
          </StatGrid>

          {/* -------------------------------------------------------------- */}

          <Card>
            <SectionHeading
              icon={Copy}
              title="Die beiden Tage nebeneinander"
              hint="Links der Bezugstag, rechts sein Zwilling, dazwischen die Differenz in Standardabweichungen."
            />

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-line text-ink-muted">
                    <th className="py-2 pr-3 text-left font-medium">Größe</th>
                    <th className="px-2 py-2 text-right font-medium">
                      {isoToGerman(data.reference.date)}
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      {isoToGerman(best.date)}
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Differenz</th>
                    <th className="px-2 py-2 text-right font-medium">in σ</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => {
                    const diff = best.differences.find((d) => d.key === field.key)
                    return (
                      <tr key={field.key} className="border-b border-line/60 last:border-0">
                        <td className="py-1.5 pr-3 text-ink">{field.label}</td>
                        <td className="numeric px-2 py-1.5 text-right font-semibold text-ink">
                          {fieldValue(field, data.reference!.values[field.key])}
                        </td>
                        <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                          {fieldValue(field, best.values[field.key])}
                        </td>
                        <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                          {diff ? num(diff.difference, field.decimals) : '—'} {field.unit}
                        </td>
                        <td
                          className={`numeric px-2 py-1.5 text-right ${
                            diff && Math.abs(diff.sigma) > 0.3 ? 'text-warm' : 'text-ink-muted'
                          }`}
                        >
                          {diff ? num(diff.sigma, 2) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* -------------------------------------------------------------- */}

          <Card>
            <SectionHeading
              icon={Fingerprint}
              title="Die acht nächsten Tage"
              hint="Balkenlänge ist der Abstand — kürzer ist ähnlicher. Die gestrichelte Linie ist der übliche beste Treffer im Archiv."
            />

            <div className="mt-4">
              <ChartFrame height={Math.max(240, data.twins.length * 30 + 40)}>
                <ResponsiveContainer>
                  <BarChart
                    data={data.twins}
                    layout="vertical"
                    margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
                  >
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      stroke={CHART.axis}
                      tick={CHART.tick}
                      tickFormatter={(v: number) => num(v, 2)}
                    />
                    <YAxis
                      type="category"
                      dataKey="date"
                      stroke={CHART.axis}
                      tick={{ ...CHART.tick, fontSize: 10 }}
                      width={90}
                      interval={0}
                      tickFormatter={isoToGerman}
                    />
                    <ReferenceLine x={median} stroke={CHART.axis} strokeDasharray="4 3" />
                    <Tooltip
                      cursor={{ fill: CHART.cursor }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const row = payload[0]!.payload as TwinDay
                        return (
                          <ChartTooltip
                            title={isoToGerman(row.date)}
                            subtitle={`${num(row.yearsApart, 0)} Jahre entfernt`}
                            rows={[
                              { label: 'Abstand', value: num(row.distance, 3) },
                              {
                                label: 'im Kalender',
                                value: `${num(row.calendarGap, 0)} Tage`,
                              },
                              ...fields.slice(0, 4).map((f) => ({
                                label: f.label,
                                value: fieldValue(f, row.values[f.key]),
                              })),
                            ]}
                          />
                        )
                      }}
                    />
                    <Bar dataKey="distance" radius={[0, 3, 3, 0]}>
                      {data.twins.map((twin) => (
                        <Cell
                          key={twin.date}
                          fill={
                            twin.distance <= median
                              ? CHART.colors.good
                              : twin.distance <= median * 2
                                ? CHART.colors.brand
                                : CHART.colors.warm
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>

            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
              Der übliche beste Treffer im Archiv liegt bei{' '}
              <span className="numeric">{num(median, 2)}</span>, gemessen an{' '}
              {num(data.baseline?.sampled ?? 0, 0)} gleichmäßig über die Reihe verteilten
              Tagen; ein Zehntel der Tage findet einen Zwilling näher als{' '}
              <span className="numeric">{num(data.baseline?.p10 ?? 0, 2)}</span>, ein Zehntel
              keinen näher als <span className="numeric">{num(data.baseline?.p90 ?? 0, 2)}</span>.
              Ohne diese Skala wäre eine einzelne Abstandszahl unlesbar.
            </p>
          </Card>

          {/* -------------------------------------------------------------- */}

          <Card>
            <SectionHeading
              icon={CalendarRange}
              title="Aus welchen Jahren die Zwillinge kommen"
              hint="Wenn die nächsten Nachbarn eines heutigen Tages alle aus dem 19. Jahrhundert stammen, ist das eine Aussage."
            />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-line text-ink-muted">
                    <th className="py-2 pr-3 text-left font-medium">Tag</th>
                    <th className="px-2 py-2 text-right font-medium">Abstand</th>
                    <th className="px-2 py-2 text-right font-medium">Jahre entfernt</th>
                    <th className="px-2 py-2 text-right font-medium">im Kalender</th>
                    <th className="px-2 py-2 text-right font-medium">Tagesmittel</th>
                  </tr>
                </thead>
                <tbody>
                  {data.twins.map((twin) => (
                    <tr key={twin.date} className="border-b border-line/60 last:border-0">
                      <td className="numeric py-1.5 pr-3 text-ink">{isoToGerman(twin.date)}</td>
                      <td className="numeric px-2 py-1.5 text-right font-semibold text-brand">
                        {num(twin.distance, 3)}
                      </td>
                      <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                        {num(twin.yearsApart, 0)}
                      </td>
                      <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                        {num(twin.calendarGap, 0)} d
                      </td>
                      <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                        {num(twin.values.temp_mean ?? 0, 1)} °C
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Die Jahre der acht nächsten Nachbarn reichen von{' '}
              {yearOf(Math.min(...data.twins.map((t) => Number(t.date.slice(0, 4)))))} bis{' '}
              {yearOf(Math.max(...data.twins.map((t) => Number(t.date.slice(0, 4)))))}. Ein
              einzelner Zwilling aus einem fernen Jahr ist Zufall; acht davon wären
              es nicht.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
