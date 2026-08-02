import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowLeftRight, Mountain, Snowflake, Thermometer } from 'lucide-react'

import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf } from '../lib/format'
import { linearFit } from '../lib/stats'
import type { SpanDay, SpanResponse, SpanScope } from '../types'
import {
  CHART,
  Card,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/* -------------------------------------------------------------------------- */

function DayTable({
  days,
  caption,
  scope,
  limit,
}: {
  days: SpanDay[]
  caption: string
  scope: SpanScope
  limit: number
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-xs">
        <caption className="pb-2 text-left text-[11px] text-ink-faint">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-ink-muted">
            <th className="py-2 pr-3 text-left font-medium">Tag</th>
            <th className="px-2 py-2 text-right font-medium">Spanne</th>
            <th className="px-2 py-2 text-left font-medium">wärmster Ort</th>
            <th className="px-2 py-2 text-left font-medium">kältester Ort</th>
            <th className="px-2 py-2 text-right font-medium">Stationen</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date} className="border-b border-line/60 last:border-0">
              <td className="numeric py-1.5 pr-3 text-ink">{isoToGerman(day.date)}</td>
              <td className="numeric px-2 py-1.5 text-right text-lg font-semibold text-ink">
                {num(day.absSpan, 1)} K
              </td>
              <td className="px-2 py-1.5">
                <span className="text-hot">{num(day.absHi, 1)} °C</span>{' '}
                <span className="text-ink-muted">{day.absHiStation.name}</span>
                <span className="block text-[10px] text-ink-faint">
                  {day.absHiStation.state}
                  {day.absHiStation.elevation !== null &&
                    ` · ${num(day.absHiStation.elevation, 0)} m`}
                </span>
              </td>
              <td className="px-2 py-1.5">
                <span className="text-cold">{num(day.absLo, 1)} °C</span>{' '}
                <span className="text-ink-muted">{day.absLoStation.name}</span>
                <span className="block text-[10px] text-ink-faint">
                  {day.absLoStation.state}
                  {day.absLoStation.elevation !== null &&
                    ` · ${num(day.absLoStation.elevation, 0)} m`}
                </span>
              </td>
              <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                {num(day.stations, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-ink-faint">
        {scope.key === 'alle'
          ? 'Über alle Stationen, Gipfel eingeschlossen.'
          : `Nur Stationen unter ${num(limit, 0)} m.`}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function NationwideSpan({ data }: { data: SpanResponse }) {
  const [scopeKey, setScopeKey] = useUrlState<string>('umfang', 'flachland')

  const scope = data.scopes.find((s) => s.key === scopeKey) ?? data.scopes[0]
  if (!scope) return null

  const widest = scope.top.absolute[0]
  const narrowest = scope.top.narrow[0]
  const coldPole = scope.holders.cold[0]

  const trend = linearFit(scope.annual.map((y) => ({ x: y.year, y: y.absSpan })))
  const meanAbs =
    scope.annual.reduce((a, y) => a + y.absSpan, 0) / Math.max(1, scope.annual.length)

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={ArrowLeftRight}
            title="Wie weit Deutschland an einem Tag auseinanderliegt"
            hint="Der wärmste gegen den kältesten Ort des Landes, für jeden Tag seit 1936."
          />
          <ChoiceGroup
            label="Stationsauswahl"
            value={scope.key}
            choices={data.scopes.map((s) => ({ value: s.key, label: s.label, title: s.note }))}
            onChange={setScopeKey}
            size="sm"
          />
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">{scope.note}</p>
      </Card>

      <StatGrid>
        <StatTile
          label="Mittlere Spanne"
          value={`${num(meanAbs, 1)} K`}
          caption={`Höchstwert irgendwo minus Tiefstwert irgendwo, im Mittel über ${num(
            scope.annual.length,
            0,
          )} Jahre`}
          accent="brand"
          icon={ArrowLeftRight}
        />
        <StatTile
          label="Größte Spanne"
          value={widest ? `${num(widest.absSpan, 1)} K` : '—'}
          caption={
            widest
              ? `${isoToGerman(widest.date)} · ${widest.absHiStation.name} gegen ${widest.absLoStation.name}`
              : undefined
          }
          accent="hot"
          icon={Thermometer}
        />
        <StatTile
          label="Kleinste Spanne"
          value={narrowest ? `${num(narrowest.absSpan, 1)} K` : '—'}
          caption={narrowest ? `${isoToGerman(narrowest.date)} — im ganzen Land fast dasselbe Wetter` : undefined}
          accent="cool"
          icon={Snowflake}
        />
        <StatTile
          label="Häufigster Kältepol"
          value={coldPole?.name ?? '—'}
          caption={
            coldPole
              ? `an ${num(coldPole.days, 0)} von ${num(scope.days, 0)} Tagen — ${shareOf(
                  coldPole.days / scope.days,
                )}`
              : undefined
          }
          accent="cold"
          icon={Mountain}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={ArrowLeftRight}
          title="Die Spanne über die Jahre"
          hint="Jahresmittel beider Spannen, dazu die Zahl der Stationen, auf denen sie beruhen."
        />

        <div className="mt-4">
          <ChartFrame height={340}>
            <ResponsiveContainer>
              <ComposedChart data={scope.annual} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} minTickGap={40} />
                <YAxis
                  yAxisId="k"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={44}
                  tickFormatter={(v: number) => `${num(v, 0)} K`}
                />
                <YAxis
                  yAxisId="n"
                  orientation="right"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={44}
                  tickFormatter={(v: number) => num(v, 0)}
                />
                <Tooltip
                  cursor={{ stroke: CHART.cursorSoft, strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as SpanScope['annual'][number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        rows={[
                          {
                            label: 'Spanne absolut',
                            value: `${num(row.absSpan, 1)} K`,
                            className: 'text-hot',
                          },
                          {
                            label: 'Spanne im Tagesmittel',
                            value: `${num(row.meanSpan, 1)} K`,
                            className: 'text-cool',
                          },
                          { label: 'größter Tag', value: `${num(row.maxAbsSpan, 1)} K` },
                          { label: 'Stationen im Mittel', value: num(row.stations, 0) },
                          { label: 'Tage gezählt', value: num(row.days, 0) },
                        ]}
                      />
                    )
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)' }}
                  iconType="plainline"
                />
                <Area
                  yAxisId="n"
                  type="monotone"
                  dataKey="stations"
                  name="Stationen"
                  stroke="none"
                  fill={CHART.colors.neutral}
                  fillOpacity={0.1}
                />
                <Line
                  yAxisId="k"
                  type="monotone"
                  dataKey="absSpan"
                  name="absolute Spanne"
                  stroke={CHART.colors.hot}
                  strokeWidth={1.75}
                  dot={false}
                />
                <Line
                  yAxisId="k"
                  type="monotone"
                  dataKey="meanSpan"
                  name="Spanne im Tagesmittel"
                  stroke={CHART.colors.cool}
                  strokeWidth={1.75}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
          Die graue Fläche ist die Zahl der Stationen, und sie gehört in dieses
          Diagramm: eine Spanne zwischen zwei Stationen kann nur wachsen, wenn
          welche dazukommen. Von {scope.annual[0]?.year} bis{' '}
          {scope.annual.at(-1)?.year} hat sich das Netz von{' '}
          {num(scope.annual[0]?.stations ?? 0, 0)} auf{' '}
          {num(scope.annual.at(-1)?.stations ?? 0, 0)} Stationen gefüllt. Der Trend
          der absoluten Spanne beträgt{' '}
          {trend ? (
            <span className="numeric">
              {num(trend.slope * 10, 2)} K je Jahrzehnt, R² {num(trend.r2, 2)}
              {trend.isSignificant ? '' : ' — nicht signifikant'}
            </span>
          ) : (
            '—'
          )}
          . Vor diesem Hintergrund ist das eher eine Aussage über das Messnetz als
          über das Wetter, und deshalb steht die Fläche daneben statt in einer
          Fußnote.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Thermometer}
          title="Im Jahresgang"
          hint="In welchen Monaten das Land am weitesten auseinanderliegt."
        />

        <div className="mt-4">
          <ChartFrame height={260}>
            <ResponsiveContainer>
              <BarChart data={scope.monthly} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
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
                  width={44}
                  tickFormatter={(v: number) => `${num(v, 0)} K`}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as SpanScope['monthly'][number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        rows={[
                          { label: 'Spanne absolut', value: `${num(row.absSpan, 1)} K` },
                          { label: 'Spanne im Tagesmittel', value: `${num(row.meanSpan, 1)} K` },
                          { label: 'größter Tag', value: `${num(row.maxAbsSpan, 1)} K` },
                          { label: 'Tage', value: num(row.days, 0) },
                        ]}
                      />
                    )
                  }}
                />
                <Bar dataKey="absSpan" fill={CHART.colors.hot} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Mountain}
          title="Wer die Enden hält"
          hint="Wenn immer derselbe Ort das kalte Ende stellt, ist die Spanne eine Aussage über diesen Ort."
        />

        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          {(
            [
              { title: 'Kältester Ort des Tages', list: scope.holders.cold, tone: 'text-cold' },
              { title: 'Wärmster Ort des Tages', list: scope.holders.warm, tone: 'text-hot' },
            ] as const
          ).map((block) => (
            <div key={block.title}>
              <p className="label mb-2">{block.title}</p>
              <ul className="space-y-1.5">
                {block.list.map((station) => (
                  <li key={station.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-xs text-ink">
                      {station.name}
                      <span className="ml-1.5 text-[10px] text-ink-faint">
                        {station.elevation !== null && `${num(station.elevation, 0)} m`}
                      </span>
                    </span>
                    <span className={`numeric shrink-0 text-xs font-semibold ${block.tone}`}>
                      {shareOf(station.days / scope.days, 1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {scope.key === 'alle' && coldPole && (
          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
            Über alle Stationen ist das kalte Ende an{' '}
            <span className="numeric">{shareOf(coldPole.days / scope.days)}</span> aller Tage
            derselbe Gipfel. Damit misst diese Spanne vor allem, wie hoch der höchste
            Berg Deutschlands ist. Deshalb gibt es die zweite Auswahl — unterhalb{' '}
            {num(data.lowlandLimit, 0)} m wird daraus eine Frage über Orte, an denen
            Menschen wohnen.
          </p>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Thermometer}
          title={`Die ${data.top} Tage mit der größten Spanne`}
        />
        <div className="mt-4">
          <DayTable
            days={scope.top.absolute}
            caption="Höchster Tageshöchstwert irgendwo gegen tiefsten Tagestiefstwert irgendwo. Die beiden Messwerte können zwölf Stunden auseinanderliegen."
            scope={scope}
            limit={data.lowlandLimit}
          />
        </div>
      </Card>

      <Card>
        <SectionHeading
          icon={Snowflake}
          title={`Die ${data.top} Tage mit der kleinsten Spanne`}
          hint="Tage, an denen im ganzen Land fast dasselbe Wetter herrschte."
        />
        <div className="mt-4">
          <DayTable
            days={scope.top.narrow}
            caption="Meist bedeckte, windige Tage im Spätherbst: Wolken verhindern nächtliche Auskühlung wie Tageserwärmung, und der Wind mischt die Unterschiede weg."
            scope={scope}
            limit={data.lowlandLimit}
          />
        </div>
      </Card>
    </div>
  )
}
