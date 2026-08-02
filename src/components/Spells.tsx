import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CalendarRange, Flame, Snowflake, Sun, CloudRain, Droplets, IceCream } from 'lucide-react'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num } from '../lib/format'
import type { SpellsResponse } from '../types'
import {
  Card,
  CHART,
  ChartFrame,
  ChartTooltip,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

interface Kind {
  id: string
  label: string
  icon: ComponentType<LucideProps>
  accent: 'warm' | 'hot' | 'dry' | 'wet' | 'cool' | 'cold'
}

const KINDS: Kind[] = [
  { id: 'heat', label: 'Hitze', icon: Flame, accent: 'warm' },
  { id: 'summer', label: 'Sommer', icon: Sun, accent: 'hot' },
  { id: 'dry', label: 'Trockenheit', icon: Droplets, accent: 'dry' },
  { id: 'wet', label: 'Niederschlag', icon: CloudRain, accent: 'wet' },
  { id: 'frost', label: 'Frost', icon: Snowflake, accent: 'cool' },
  { id: 'ice', label: 'Dauerfrost', icon: IceCream, accent: 'cold' },
]

const BAR_COLOR: Record<Kind['accent'], string> = {
  warm: CHART.colors.warm,
  hot: CHART.colors.hot,
  dry: CHART.colors.brand,
  wet: CHART.colors.wet,
  cool: CHART.colors.cool,
  cold: CHART.colors.cold,
}

export function Spells({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [kindId, setKindId] = useUrlState<string>('art', KINDS[0]!.id, {
    allowed: KINDS.map((k) => k.id),
  })
  const kind = KINDS.find((k) => k.id === kindId) ?? KINDS[0]!

  const { data, loading, error, reload } = useApi<SpellsResponse>(
    `/api/weather/spells?kind=${encodeURIComponent(kindId)}&stationId=${encodeURIComponent(stationId)}`,
  )

  const longest = data?.records[0] ?? null

  // The first and last decade are truncated by the start of the record and by
  // today's date. Comparing them would read as a trend where there is only a
  // shorter counting window, so both are dropped from the comparison.
  const completeDecades = (data?.byDecade ?? []).slice(1, -1)
  const earlier = completeDecades[0] ?? null
  const recent = completeDecades.at(-1) ?? null

  return (
    <>
      <InfoPanel icon={CalendarRange} title={`Zusammenhängende Perioden — ${stationName}`}>
        Einzelne Rekordtage sagen wenig darüber aus, wie belastend ein Sommer war —
        entscheidend ist, wie lange eine Lage <strong>anhält</strong>. Hier zählt jede
        ununterbrochene Serie von Tagen, die dasselbe Kriterium erfüllen. Ein fehlender
        Messwert oder eine Lücke im Datenbestand{' '}
        <strong>beendet eine Serie</strong>, statt sie stillschweigend zu verlängern —
        sonst würde eine Datenlücke von 1902 als Rekordhitzewelle erscheinen.
      </InfoPanel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {KINDS.map((k) => {
          const active = k.id === kindId
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={active}
              onClick={() => setKindId(k.id)}
              className={`flex h-20 cursor-pointer flex-col justify-between rounded-card border p-3 text-left transition-colors ${
                active
                  ? 'border-brand bg-brand/15'
                  : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <k.icon
                className={`size-4 ${active ? 'text-brand' : 'text-ink-faint'}`}
                aria-hidden
              />
              <span
                className={`text-[11px] font-medium leading-tight ${active ? 'text-brand' : 'text-ink-muted'}`}
              >
                {k.label}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <Loading message="Suche zusammenhängende Perioden…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.records.length === 0 ? (
        <EmptyState message="Für diese Kategorie wurden keine Perioden gefunden." />
      ) : (
        <>
          <StatGrid>
            <StatTile
              label="Längste Periode"
              value={`${longest?.days ?? '—'} Tage`}
              caption={
                longest
                  ? `${isoToGerman(longest.start)} – ${isoToGerman(longest.end)}`
                  : undefined
              }
              accent={kind.accent}
              icon={kind.icon}
            />
            <StatTile
              label={data.summaryLabel}
              value={num(longest?.value, 1, data.unit)}
              caption="Während der längsten Periode"
              accent={kind.accent}
            />
            <StatTile
              label="Perioden gesamt"
              value={String(data.totalCount)}
              caption={`Ab ${data.minDays} zusammenhängenden Tagen`}
              accent="brand"
            />
            <StatTile
              label="Jahrzehnt-Vergleich"
              value={
                earlier && recent ? `${earlier.count} → ${recent.count}` : '—'
              }
              caption={
                earlier && recent
                  ? `${earlier.decade}er gegenüber ${recent.decade}ern (vollständige Jahrzehnte)`
                  : 'Zu wenige vollständige Jahrzehnte'
              }
              accent="brand"
            />
          </StatGrid>

          <Card>
            <SectionHeading
              title="Perioden je Jahrzehnt"
              hint={data.description}
            />
            <ChartFrame height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.byDecade}
                  margin={{ top: 8, right: 8, left: -22, bottom: 4 }}
                >
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="decade"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}er`}
                  />
                  <YAxis stroke={CHART.axis} tick={CHART.tick} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    content={<DecadeTooltip />}
                    cursor={{ fill: CHART.cursorSoft }}
                  />
                  <Bar
                    dataKey="count"
                    fill={BAR_COLOR[kind.accent]}
                    fillOpacity={0.7}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
              Das jüngste und das älteste Jahrzehnt sind in der Regel unvollständig —
              das erste beginnt mit dem Messbeginn, das letzte endet am aktuellen
              Datenstand. Für den Vergleich zählen die Jahrzehnte dazwischen.
            </p>
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-0 sm:p-6 sm:pb-0">
              <SectionHeading
                title={`Längste Perioden — ${data.label}`}
                hint={`Die ${data.records.length} längsten Serien der gesamten Messreihe.`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="border-y border-line bg-raised">
                    <th scope="col" className="label px-3 py-2.5">Rang</th>
                    <th scope="col" className="label px-3 py-2.5">Dauer</th>
                    <th scope="col" className="label px-3 py-2.5">Beginn</th>
                    <th scope="col" className="label px-3 py-2.5">Ende</th>
                    <th scope="col" className="label px-3 py-2.5">{data.summaryLabel}</th>
                    <th scope="col" className="label px-3 py-2.5">Verlauf</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {data.records.map((spell, index) => (
                    <tr
                      key={`${spell.start}-${spell.end}`}
                      className="transition-colors hover:bg-raised"
                    >
                      <td className="px-3 py-2.5">
                        <span
                          className={`numeric inline-grid size-6 place-items-center rounded text-[10px] font-bold ${
                            index === 0 ? 'bg-brand text-canvas' : 'bg-inset text-ink-faint'
                          }`}
                        >
                          {index + 1}
                        </span>
                      </td>
                      <td className="numeric px-3 py-2.5 font-semibold text-ink">
                        {spell.days} Tage
                      </td>
                      <td className="numeric px-3 py-2.5 text-ink-muted">
                        {isoToGerman(spell.start)}
                      </td>
                      <td className="numeric px-3 py-2.5 text-ink-muted">
                        {isoToGerman(spell.end)}
                      </td>
                      <td className="numeric px-3 py-2.5 font-semibold text-ink">
                        {num(spell.value, 1, data.unit)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: `${Math.max(4, (spell.days / (longest?.days ?? 1)) * 100)}%`,
                            backgroundColor: BAR_COLOR[kind.accent],
                          }}
                          role="img"
                          aria-label={`${spell.days} Tage`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}

function DecadeTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: { decade: number; count: number } }[]
}) {
  const d = payload?.[0]?.payload
  if (!active || !d) return null

  return (
    <ChartTooltip
      title={`${d.decade}er Jahre`}
      rows={[{ label: 'Perioden', value: String(d.count), className: 'text-brand' }]}
    />
  )
}
