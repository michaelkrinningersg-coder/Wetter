import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CalendarRange, MapPin, Trophy } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf } from '../lib/format'
import type { ExtremeKind, ExtremesResponse } from '../types'
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

const SCOPES = [
  { value: 'flachland', label: 'Unter 1000 m' },
  { value: 'alle', label: 'Alle Stationen' },
] as const

/** Wind is published in m/s; everyone reads gusts in km/h. */
function extremeValue(kind: ExtremeKind, value: number | null): string {
  if (value === null) return '—'
  if (kind.unit === 'm/s') return `${num(value * 3.6, 0)} km/h`
  return `${num(value, 1)} ${kind.unit}`
}

export function NationwideExtremes() {
  const [kindKey, setKindKey] = useUrlState<string>('art', 'cold')
  const [scopeKey, setScopeKey] = useUrlState<string>('umfang', 'flachland')
  const { data, loading, error } = useApi<ExtremesResponse>('/api/nationwide/extremes')

  if (loading && !data) return <Loading message="Extrempunkte werden gezählt …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const kind = data.kinds.find((k) => k.key === kindKey) ?? data.kinds[0]
  if (!kind) return null

  const scope = kind.scoped ? (kind.scopes[scopeKey] ?? kind.scopes.alle!) : kind.scopes.alle!
  const leader = scope.stations[0]
  const turnover = new Set(scope.decades.map((d) => d.station.id)).size

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Trophy}
            title="Wer Deutschlands Extreme hält"
            hint="Das Archiv nennt zu jedem Tagesextrem die Station dahinter. Neunzig Jahre davon sind eine Zählaufgabe."
          />
          <div className="flex flex-wrap items-center gap-2">
            <ChoiceGroup
              label="Kategorie"
              value={kind.key}
              choices={data.kinds.map((k) => ({ value: k.key, label: k.label, title: k.note }))}
              onChange={setKindKey}
              size="sm"
            />
            {kind.scoped && (
              <span className="hidden h-5 w-px bg-line-strong sm:block" aria-hidden />
            )}
            {kind.scoped && (
              <ChoiceGroup
                label="Stationsauswahl"
                value={scopeKey}
                choices={SCOPES.map((s) => ({ value: s.value, label: s.label }))}
                onChange={setScopeKey}
                size="sm"
              />
            )}
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
          {kind.note}
          {kind.scoped
            ? ` · gezählt über ${scopeKey === 'alle' ? 'alle Stationen' : `Stationen unter ${num(data.lowlandLimit, 0)} m`}`
            : ' · für diese Größe führt das Archiv keine Höhengrenze'}
          .
        </p>
      </Card>

      <StatGrid>
        <StatTile
          label="Häufigster Halter"
          value={leader?.name ?? '—'}
          caption={
            leader
              ? `${num(leader.days, 0)} von ${num(scope.total, 0)} Tagen — ${shareOf(leader.share, 1)}`
              : undefined
          }
          accent="brand"
          icon={MapPin}
        />
        <StatTile
          label="Höhe"
          value={leader?.elevation !== null && leader ? `${num(leader.elevation, 0)} m` : '—'}
          caption={leader?.state}
          accent="neutral"
        />
        <StatTile
          label="Bester Wert dieser Station"
          value={leader ? extremeValue(kind, leader.extreme) : '—'}
          caption={leader ? `im Titel von ${isoToGerman(leader.first)} bis ${isoToGerman(leader.last)}` : undefined}
          accent={kind.direction === 'max' ? 'hot' : 'cold'}
        />
        <StatTile
          label="Wechsel über die Jahrzehnte"
          value={`${num(turnover, 0)} von ${num(scope.decades.length, 0)}`}
          caption="verschiedene Stationen als Jahrzehntsieger"
          accent="warm"
          icon={CalendarRange}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Trophy}
          title={`Die ${data.holders} häufigsten Halter`}
          hint="Anteil an allen gezählten Tagen. Eine Station kann nur zählen, solange sie gemeldet hat — die Spalte daneben sagt, wann das war."
        />

        <div className="mt-4">
          <ChartFrame height={Math.max(260, scope.stations.length * 22 + 40)}>
            <ResponsiveContainer>
              <BarChart
                data={scope.stations}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
              >
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => num(v, 0)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke={CHART.axis}
                  tick={{ ...CHART.tick, fontSize: 10 }}
                  width={170}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof scope.stations)[number]
                    return (
                      <ChartTooltip
                        title={row.name}
                        subtitle={`${row.state}${row.elevation !== null ? ` · ${num(row.elevation, 0)} m` : ''}`}
                        rows={[
                          { label: 'Tage im Titel', value: num(row.days, 0) },
                          { label: 'Anteil', value: shareOf(row.share, 1) },
                          { label: 'Bester Wert', value: extremeValue(kind, row.extreme) },
                          {
                            label: 'Zeitraum',
                            value: `${isoToGerman(row.first)} – ${isoToGerman(row.last)}`,
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Bar
                  dataKey="days"
                  fill={kind.direction === 'max' ? CHART.colors.hot : CHART.colors.cold}
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
          icon={CalendarRange}
          title="Der Sieger jedes Jahrzehnts"
          hint="Eine Bestenliste über neunzig Jahre belohnt lange geöffnete Stationen. Je Jahrzehnt ist das Feld gleich."
        />

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Jahrzehnt</th>
                <th className="px-2 py-2 text-left font-medium">Station</th>
                <th className="px-2 py-2 text-right font-medium">Tage</th>
                <th className="px-2 py-2 text-right font-medium">Anteil</th>
                <th className="px-2 py-2 text-right font-medium">gezählte Tage</th>
              </tr>
            </thead>
            <tbody>
              {scope.decades.map((row) => (
                <tr key={row.decade} className="border-b border-line/60 last:border-0">
                  <td className="numeric py-1.5 pr-3 text-ink">{row.decade}er</td>
                  <td className="px-2 py-1.5 text-ink-muted">
                    {row.station.name}
                    <span className="block text-[10px] text-ink-faint">
                      {row.station.state}
                      {row.station.elevation !== null && ` · ${num(row.station.elevation, 0)} m`}
                    </span>
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink">{num(row.topDays, 0)}</td>
                  <td className="numeric px-2 py-1.5 text-right font-semibold text-brand">
                    {shareOf(row.share, 1)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                    {num(row.days, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          Wechselt der Sieger von Jahrzehnt zu Jahrzehnt, ist die Kategorie eine
          Wetterfrage — der nasseste Ort eines Tages ist meist der, über dem
          zufällig ein Gewitter stand. Bleibt derselbe Name über Jahrzehnte
          stehen, ist sie eine Frage der Geografie. Ein Wechsel kann aber auch
          bedeuten, dass eine Station geschlossen oder eine neue eröffnet wurde,
          und das lässt sich hier nicht von einer Klimaänderung unterscheiden.
        </p>
      </Card>
    </div>
  )
}
