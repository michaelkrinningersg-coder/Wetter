import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CalendarClock, ChevronLeft, ChevronRight, Gauge, ListOrdered } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { num, year as yearOf } from '../lib/format'
import { MONTHS } from '../lib/format'
import type { BalanceField, BalanceLive, MonthBalanceResponse } from '../types'
import {
  Card,
  CHART,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
  type Accent,
} from './ui'

const BAR_COLOR: Record<string, string> = {
  hot: CHART.colors.hot,
  wet: CHART.colors.wet,
  warm: CHART.colors.warm,
}

const ACCENT_TEXT: Record<string, string> = {
  hot: 'text-hot',
  wet: 'text-wet',
  warm: 'text-warm',
}

const ACCENT_BG: Record<string, string> = {
  hot: 'bg-hot',
  wet: 'bg-wet',
  warm: 'bg-warm',
}

/* -------------------------------------------------------------------------- */
/* The running month                                                          */
/* -------------------------------------------------------------------------- */

/** The ensemble spread as a bar: the full range, the middle eighty per cent, the median. */
function Spread({ live, field }: { live: BalanceLive; field: BalanceField }) {
  const projection = live.projection
  if (!projection) return null

  const span = projection.max - projection.min
  if (!(span > 0)) return null

  const at = (value: number) => ((value - projection.min) / span) * 100
  const p10 = projection.quantiles[0]!.value
  const p50 = projection.quantiles[1]!.value
  const p90 = projection.quantiles[2]!.value

  return (
    <div className="mt-2">
      <div className="relative h-2 rounded-full bg-line">
        <div
          className={`absolute inset-y-0 rounded-full ${ACCENT_BG[field.accent] ?? 'bg-brand'} opacity-40`}
          style={{ left: `${at(p10)}%`, width: `${Math.max(at(p90) - at(p10), 1)}%` }}
        />
        <div
          className={`absolute inset-y-0 w-0.5 ${ACCENT_BG[field.accent] ?? 'bg-brand'}`}
          style={{ left: `${at(p50)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
        <span className="numeric">
          {num(projection.min, field.decimals)} {field.unit}
        </span>
        <span>
          mittlere 80 %: {num(p10, field.decimals)} – {num(p90, field.decimals)} {field.unit}
        </span>
        <span className="numeric">
          {num(projection.max, field.decimals)} {field.unit}
        </span>
      </div>
    </div>
  )
}

function LiveRow({ field, monthName }: { field: BalanceField; monthName: string }) {
  const live = field.live
  if (!live) return null
  const tone = ACCENT_TEXT[field.accent] ?? 'text-ink'

  return (
    <li className="rounded-card border border-line bg-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-semibold text-ink">{field.label}</p>
        <p className={`numeric text-2xl font-semibold ${tone}`}>
          {live.value === null ? '—' : num(live.value, field.decimals)}
          <span className="ml-1 text-xs font-normal text-ink-muted">{field.unit}</span>
        </p>
      </div>

      <p className="mt-1 text-[11px] text-ink-muted">
        aus <span className="numeric text-ink">{num(live.measured, 0)}</span> von{' '}
        {num(live.cut, 0)} bisherigen Tagen
        {live.missing > 0 && (
          <span className="text-bad">
            {' '}
            · {num(live.missing, 0)} ohne Messwert
          </span>
        )}
        {field.kind === 'sum' && !live.complete && (
          <span className="text-ink-faint"> · eine Summe, die nur wachsen kann</span>
        )}
      </p>

      {!live.enough ? (
        <p className="mt-2 text-[11px] text-ink-faint">
          Für eine Einordnung fehlen Messwerte: nötig wären {num(live.needed, 0)} Tage
          {live.value === null ? ', bislang liegt kein einziger vor' : ''}.
        </p>
      ) : (
        <div className="mt-2 space-y-1 text-[11px] text-ink-muted">
          <p>
            <strong className="text-ink">Gemessen:</strong> Platz{' '}
            <span className="numeric text-ink">{num(live.window.rank, 0)}</span> von{' '}
            {num(live.window.total, 0)} — verglichen mit dem 1. bis {num(live.cut, 0)}.{' '}
            {monthName} aller anderen Jahre.
          </p>

          {live.projection && live.rankSpread ? (
            <>
              <p>
                <strong className="text-ink">Noch offen:</strong>{' '}
                {num(live.projection.restDays, 0)}{' '}
                {live.projection.restDays === 1 ? 'Tag' : 'Tage'}. Aus{' '}
                {num(live.projection.members, 0)} nachgespielten Jahren ergibt sich ein
                Endstand zwischen Platz{' '}
                <span className="numeric text-ink">{num(live.rankSpread.p90, 0)}</span> und{' '}
                <span className="numeric text-ink">{num(live.rankSpread.p10, 0)}</span>
                {live.rankSpread.best !== null && live.rankSpread.worst !== null && (
                  <span className="text-ink-faint">
                    {' '}
                    (im Extremfall {num(live.rankSpread.best, 0)} bis{' '}
                    {num(live.rankSpread.worst, 0)})
                  </span>
                )}
                .
              </p>
              <Spread live={live} field={field} />
            </>
          ) : (
            <p className="text-ink-faint">
              Der Monat ist durch — es bleibt nichts mehr offen.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* The view                                                                   */
/* -------------------------------------------------------------------------- */

export function MonthBalance({
  stationId,
  stationName,
  year,
  month,
  onYearChange,
  onMonthChange,
}: {
  stationId: string
  stationName: string
  year: number
  month: number
  onYearChange: (year: number) => void
  onMonthChange: (month: number) => void
}) {
  const [fieldKey, setFieldKey] = useUrlState<string>('groesse', 'temp', {
    allowed: ['temp', 'precip', 'sun'],
  })

  const { data, loading, error, reload } = useApi<MonthBalanceResponse>(
    `/api/weather/month-balance?monat=${month}&stationId=${encodeURIComponent(stationId)}`,
    [stationId, month],
  )

  if (loading && !data) return <Loading message="Monatsbilanz wird gerechnet …" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const field = data.fields.find((f) => f.key === fieldKey) ?? data.fields[0]!
  const rated = field.history.filter((h) => h.rated)
  const top = [...rated].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, 5)
  const bottom = [...rated].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, 5)
  const hasLive = data.running !== null
  // Every field shares the same cut, so one of them settles whether the month
  // still has days ahead of it.
  const closed = data.fields.every((f) => f.live?.complete !== false)
  const reference = data.reference.split('-').reverse().join('.')

  return (
    <div className="space-y-6">
      <InfoPanel icon={CalendarClock} title={`Monatsbilanz — ${stationName}`}>
        <p>
          Eine Monatszahl wird sonst erst genannt, wenn der Monat vorbei ist.
          Mitten darin ist sie die meistgestellte und am seltensten beantwortete
          Frage: Ist das ein warmer {data.monthName}? Die ehrliche Antwort hat
          zwei Teile, und die stehen hier getrennt.
        </p>
        <p>
          <strong className="text-ink">Gemessen</strong> wird der bereits belegte
          Teil gegen <em>dieselben Tage</em> jedes anderen Jahres — der 1. bis 15.{' '}
          {data.monthName} gegen jeden anderen 1. bis 15. {data.monthName}, nie
          gegen ganze Monate. Das ist eine Messung und braucht keine Prognose.
        </p>
        <p>
          <strong className="text-ink">Offen</strong> ist der Rest. Er wird aus
          jedem Jahr nachgespielt, das ihn vollständig gemessen hat — rund
          hundertfünfzig mögliche Ausgänge. Deren Streuung ist die Antwort auf
          „wie viel kann sich noch verschieben", und sie ist der Grund, warum
          dieselbe Ansicht am 2. fast nichts sagt und am 28. ziemlich viel: Für
          den Juli 2023 reichte der mögliche Endplatz nach zwei Tagen von 17 bis
          136 und nach achtundzwanzig Tagen von 40 bis 68. Der tatsächliche
          Endplatz war 47.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={ListOrdered}
          title={`${data.monthName} ${yearOf(year)}`}
          hint={`${num(data.years.length, 0)} Ausgaben dieses Monats im Archiv · Stichtag ${reference}`}
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onMonthChange(month === 1 ? 12 : month - 1)}
                aria-label="Vorheriger Monat"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <select
                value={month}
                onChange={(e) => onMonthChange(Number(e.target.value))}
                aria-label="Monat auswählen"
                className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink"
              >
                {MONTHS.map((name, at) => (
                  <option key={name} value={at + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onMonthChange(month === 12 ? 1 : month + 1)}
                aria-label="Nächster Monat"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
              <select
                value={year}
                onChange={(e) => onYearChange(Number(e.target.value))}
                aria-label="Jahr auswählen"
                className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink"
              >
                {[...data.years].reverse().map((y) => (
                  <option key={y} value={y}>
                    {yearOf(y)}
                  </option>
                ))}
              </select>
            </div>
          }
        />

        <StatGrid>
          {data.fields.map((f) => {
            const entry = f.history.find((h) => h.year === year)
            return (
              <StatTile
                key={f.key}
                label={f.label}
                value={
                  entry?.value === null || entry === undefined
                    ? '—'
                    : `${num(entry.value, f.decimals)} ${f.unit}`
                }
                caption={
                  entry === undefined
                    ? 'kein Eintrag für dieses Jahr'
                    : entry.rated
                      ? `Platz ${num(entry.rank, 0)} von ${num(entry.total, 0)} — ${f.high} zuerst`
                      : `nur ${num(entry.days, 0)} von ${num(entry.of, 0)} Tagen gemessen — nicht eingeordnet`
                }
                accent={f.accent as Accent}
              />
            )
          })}
        </StatGrid>
      </Card>

      {hasLive && (
        <Card>
          <SectionHeading
            icon={Gauge}
            title={`Der ${closed ? 'zuletzt erfasste' : 'laufende'} ${data.monthName} ${yearOf(data.running ?? 0)}`}
            hint={
              closed
                ? `Das Archiv reicht bis zum ${reference} und damit über diesen Monat hinaus — offen ist nichts mehr, die Einordnung hängt nur noch an der Zahl der Messtage.`
                : `Stand vom ${reference} — dem letzten Tag im Archiv, nicht heute.`
            }
          />
          <ul className="space-y-2.5">
            {data.fields.map((f) => (
              <LiveRow key={f.key} field={f} monthName={data.monthName} />
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SectionHeading
          icon={ListOrdered}
          title={`Alle ${data.monthName}-Ausgaben`}
          hint={`${num(field.rated, 0)} Monate mit mindestens ${num(data.minMonthDays, 0)} Messtagen — nur die sind eingeordnet.`}
          actions={
            <ChoiceGroup
              label="Größe"
              value={field.key}
              choices={data.fields.map((f) => ({ value: f.key, label: f.short }))}
              onChange={setFieldKey}
              size="sm"
            />
          }
        />
        <ChartFrame height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={field.history.filter((h) => h.rated)}
              margin={{ top: 8, right: 8, left: -22, bottom: 4 }}
            >
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="year"
                stroke={CHART.axis}
                tick={CHART.tick}
                tickLine={false}
                tickFormatter={(v: number) => yearOf(v)}
                minTickGap={28}
              />
              <YAxis
                stroke={CHART.axis}
                tick={CHART.tick}
                tickLine={false}
                domain={field.kind === 'mean' ? ['auto', 'auto'] : [0, 'auto']}
              />
              <Tooltip
                cursor={{ fill: CHART.cursorSoft }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as BalanceField['history'][number] | undefined
                  if (!active || !row) return null
                  return (
                    <ChartTooltip
                      title={`${data.monthName} ${yearOf(row.year)}`}
                      rows={[
                        {
                          label: field.label,
                          value: `${num(row.value, field.decimals)} ${field.unit}`,
                        },
                        {
                          label: 'Platz',
                          value: `${num(row.rank, 0)} von ${num(row.total, 0)}`,
                        },
                        { label: 'Messtage', value: `${num(row.days, 0)} von ${num(row.of, 0)}` },
                      ]}
                    />
                  )
                }}
              />
              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                {field.history
                  .filter((h) => h.rated)
                  .map((h) => (
                    <Cell
                      key={h.year}
                      fill={BAR_COLOR[field.accent] ?? CHART.colors.brand}
                      fillOpacity={h.year === year ? 1 : 0.45}
                    />
                  ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="label mb-1.5">{field.high} zuerst</p>
            <ul className="space-y-0.5 text-xs">
              {top.map((entry) => (
                <li
                  key={entry.year}
                  className={`flex items-baseline justify-between gap-3 ${entry.year === year ? 'text-ink' : 'text-ink-muted'}`}
                >
                  <span className="numeric">
                    {num(entry.rank, 0)}. {yearOf(entry.year)}
                  </span>
                  <span className="numeric">
                    {num(entry.value, field.decimals)} {field.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label mb-1.5">{field.low} zuerst</p>
            <ul className="space-y-0.5 text-xs">
              {bottom.map((entry) => (
                <li
                  key={entry.year}
                  className={`flex items-baseline justify-between gap-3 ${entry.year === year ? 'text-ink' : 'text-ink-muted'}`}
                >
                  <span className="numeric">
                    {num(entry.rank, 0)}. {yearOf(entry.year)}
                  </span>
                  <span className="numeric">
                    {num(entry.value, field.decimals)} {field.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeading
          icon={CalendarClock}
          title="Wie gerechnet wird"
          hint="Zwei Zahlen, weil zwei verschiedene Dinge gemeint sind."
        />
        <ul className="space-y-1.5 text-xs text-ink-muted">
          <li>
            <strong className="text-ink">Der Teilmonat wird gegen Teilmonate
            gestellt</strong>, nicht gegen ganze Monate. Sonst läge jeder laufende
            Monat bei den Summen automatisch hinten, einfach weil ihm Tage fehlen.
          </li>
          <li>
            <strong className="text-ink">Ein Ensemble-Mitglied muss den Rest
            vollständig gemessen haben.</strong> Eine Teilsumme auf volle Länge
            hochzurechnen erfände Regen, den niemand aufgezeichnet hat; bei über
            hundert Kandidaten ist das auch nicht nötig.
          </li>
          <li>
            <strong className="text-ink">Mittel und Summen verhalten sich
            verschieden.</strong> Ein Mittel über zwanzig Tage schätzt das
            Monatsmittel; eine Summe über zwanzig Tage ist keine Schätzung der
            Monatssumme, sondern sicher kleiner. Deshalb steht bei den Summen
            dabei, dass sie nur wachsen können.
          </li>
          <li>
            <strong className="text-ink">Eingeordnet wird erst ab{' '}
            {num(data.minMonthDays, 0)} Messtagen</strong> — dieselbe Regel, nach
            der auch die Monats-Heatmap arbeitet. Ein Monat mit neun fehlenden
            Tagen wird gezeigt, aber nicht bewertet; er beschriebe sonst die Tage,
            die zufällig gemessen wurden, statt den Monat.
          </li>
        </ul>
      </Card>
    </div>
  )
}
