import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Clock, Ruler, Waves } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, signed } from '../lib/format'
import type { CycleProfile, GaugeCycleResponse, GaugesResponse } from '../types'
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
} from './ui'

const SPLIT_COLORS: Record<string, string> = {
  all: CHART.colors.brand,
  weekday: CHART.colors.warm,
  weekend: CHART.colors.cool,
}

const colorOf = (key: string | undefined) => SPLIT_COLORS[key ?? 'all'] ?? CHART.colors.brand

const clock = (hour: number | null) => (hour === null ? '—' : `${String(hour).padStart(2, '0')} Uhr`)

/**
 * How much a profile may be believed.
 *
 * Not a verdict on the river but on the sample: an hour of the clock that was
 * never measured cannot be averaged, and a curve built from four days is a
 * curve of those four days. Both numbers are stated rather than turned into a
 * traffic light, because the reader can weigh them and a threshold cannot.
 */
function Evidence({ profile }: { profile: CycleProfile }) {
  const thin = profile.hours.filter((h) => h.mean !== null && h.days < 5).length
  return (
    <p className="mt-1 text-[11px] text-ink-faint">
      {profile.days === 0
        ? 'Noch keine Stunde, deren Umgebung vollständig genug für einen Vergleich wäre.'
        : `${num(profile.days, 0)} ${profile.days === 1 ? 'Tag' : 'Tage'}, ${num(profile.coveredHours, 0)} der 24 Stunden belegt` +
          (thin > 0 ? ` · ${num(thin, 0)} davon aus weniger als fünf Tagen` : '')}
    </p>
  )
}

function Profile({
  profile,
  color,
  unit = 'cm',
}: {
  profile: CycleProfile
  color: string
  unit?: string
}) {
  const data = useMemo(
    () => profile.hours.map((h) => ({ ...h, label: String(h.hour).padStart(2, '0') })),
    [profile],
  )

  return (
    <ChartFrame height={260}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={CHART.tick}
            stroke={CHART.axis}
            interval={2}
            tickFormatter={(v: string) => `${v}h`}
          />
          <YAxis
            tick={CHART.tick}
            stroke={CHART.axis}
            width={52}
            tickFormatter={(v: number) => signed(v, 1)}
          />
          {/* The zero line is the day's own level — the whole point of the
              detrending is that this line means something. */}
          <ReferenceLine y={0} stroke={CHART.axis} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ stroke: CHART.cursorSoft, strokeWidth: 24 }}
            content={({ active, payload }) => {
              const first = payload?.[0]
              if (!active || !first) return null
              const row = first.payload as (typeof data)[number]
              return (
                <ChartTooltip
                  title={clock(row.hour)}
                  rows={[
                    {
                      label: 'gegenüber dem Tag',
                      value: row.mean === null ? '—' : `${signed(row.mean, 2)} ${unit}`,
                    },
                    { label: 'Messwerte', value: num(row.readings, 0) },
                    { label: 'aus Tagen', value: num(row.days, 0) },
                  ]}
                />
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="mean"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2, fill: color }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function GaugeCycle() {
  const [gaugeId, setGaugeId] = useUrlState<string>('pegel', null)
  const [showMonths, setShowMonths] = useState(false)

  // The register only, without touching the sources: this view asks about
  // months of history, not about the last quarter of an hour.
  const list = useApi<GaugesResponse>('/api/gauges?days=1&refresh=false')
  const gauges = list.data?.gauges ?? []
  const active = gauges.find((g) => g.id === gaugeId) ?? gauges[0]

  const { data, loading, error, reload } = useApi<GaugeCycleResponse>(
    active ? `/api/gauges/${encodeURIComponent(active.id)}/cycle` : null,
    [active?.id],
  )

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />
  if (!active || (loading && !data)) {
    return <Loading message="Die Stunden werden gegen ihren Tag gerechnet …" />
  }
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const all = data.splits.find((s) => s.key === 'all')
  const weekday = data.splits.find((s) => s.key === 'weekday')
  const weekend = data.splits.find((s) => s.key === 'weekend')
  const dropped = data.range.hours - data.range.usableHours

  return (
    <div className="space-y-6">
      <InfoPanel icon={Clock} title="Der Tag im Pegel">
        <p>
          Ein Wasserstand schwankt nicht um einen festen Wert, er wandert über
          Wochen. Ein Mittel nach Tageszeit über einen Hochwasserfrühling und
          einen trockenen August sagt deshalb vor allem, welche Wochen zufällig
          gemessen wurden. Hier wird jede Stunde stattdessen gegen{' '}
          <strong className="text-ink">die 24 Stunden um sie herum</strong>{' '}
          gerechnet: Ein voller Tag enthält jede Uhrzeit genau einmal, kann also
          selbst keinen Tagesgang tragen — was nach dem Abziehen übrig bleibt,
          ist die Abweichung von der Höhe dieses Tages und sonst nichts.
        </p>
        <p>
          <strong className="text-ink">Das ist nicht dasselbe wie ein
          Kalendertagsmittel</strong>, und der Unterschied ist keine
          Feinheit. Auf einer erfundenen Reihe, die nur fällt und keinen
          Tagesgang hat, erzeugt der Vergleich gegen das Kalendertagsmittel
          eine Scheinamplitude von 1,4 cm mit Hoch um Mitternacht und Tief um
          23 Uhr — schlicht, weil das Tagesmittel für die Morgenstunden zu
          niedrig und für die Abendstunden zu hoch liegt. Das zentrierte
          Fenster liefert auf derselben Reihe 0,02 cm.
        </p>
        <p>
          <strong className="text-ink">Wie viele Messungen dahinterstehen,
          steht dabei.</strong> Die Weser liefert bei jedem Abruf 30 Tage
          rückwirkend mit, ihre Messzeitpunkte sind also gleichmäßig über den
          Tag verteilt. Leine und Rhume veröffentlichen nur den aktuellen Wert:
          Dort existiert ausschließlich, was jemand abgefragt hat, und wenn das
          Abfragen selbst einen Rhythmus hat — ein Rechner, der tagsüber läuft
          und nachts aus ist — stünde dieser Rhythmus in der Kurve statt dem
          des Flusses. Deshalb nennt jede Stunde ihre Zahl.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={Waves}
          title={`${active.water} bei ${active.name}`}
          hint={
            data.range.first
              ? `${num(data.range.readings, 0)} Messwerte, ${isoToGerman(data.range.first.slice(0, 10))} bis ${isoToGerman(data.range.last!.slice(0, 10))}`
              : 'Noch keine Messwerte im Archiv.'
          }
          actions={
            <ChoiceGroup
              label="Pegel"
              value={active.id}
              choices={gauges.map((g) => ({ value: g.id, label: g.name }))}
              onChange={setGaugeId}
              size="sm"
            />
          }
        />

        {all && all.days > 0 ? (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
              {[
                {
                  label: 'Amplitude',
                  value: all.amplitude === null ? '—' : `${num(all.amplitude, 2)} cm`,
                },
                { label: 'Höchststand', value: clock(all.highHour) },
                { label: 'Tiefststand', value: clock(all.lowHour) },
                { label: 'Tage', value: num(all.days, 0) },
              ].map((entry) => (
                <div key={entry.label} className="flex items-baseline justify-between gap-2">
                  <dt className="text-ink-muted">{entry.label}</dt>
                  <dd className="numeric text-ink">{entry.value}</dd>
                </div>
              ))}
            </dl>
            <Profile profile={all} color={colorOf('all')} />
            <Evidence profile={all} />
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            Für diesen Pegel liegt noch keine Stunde vor, deren Umgebung
            vollständig genug wäre. Es braucht mindestens{' '}
            {num(data.method.minHoursInWindow, 0)} der 24 Stunden im Fenster von{' '}
            {num(data.method.halfWindow, 0)} Stunden um eine Messung herum —
            und die kommen mit der Laufzeit von selbst zusammen.
          </p>
        )}

        {dropped > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-[11px] text-ink-faint">
            {num(data.range.hours, 0)} gemessene Stunden, davon{' '}
            {num(dropped, 0)} ohne ausreichend vollständige Umgebung und deshalb
            nicht verwendet.
          </p>
        )}
      </Card>

      {weekday && weekend && (weekday.days > 0 || weekend.days > 0) && (
        <Card>
          <SectionHeading
            icon={Ruler}
            title="Werktag gegen Wochenende"
            hint="Trennt zwei Ursachen, die im Tagesgang gleich aussehen: Verdunstung kennt keinen Sonntag, ein Wehr- oder Kraftwerksbetrieb schon."
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {[weekday, weekend].map((profile) => (
              <div key={profile.key}>
                <p className="mb-1 text-xs font-medium text-ink">{profile.label}</p>
                <p className="mb-2 text-[11px] text-ink-muted">
                  Amplitude{' '}
                  <span className="numeric">
                    {profile.amplitude === null ? '—' : `${num(profile.amplitude, 2)} cm`}
                  </span>
                  {profile.highHour !== null && (
                    <>
                      {' '}· hoch {clock(profile.highHour)}, tief {clock(profile.lowHour)}
                    </>
                  )}
                </p>
                <Profile profile={profile} color={colorOf(profile.key)} />
                <Evidence profile={profile} />
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-line pt-3 text-[11px] text-ink-faint">
            Ein Unterschied zwischen beiden Hälften ist erst dann einer, wenn
            beide auf genügend Tagen beruhen — bei zehn Wochenendtagen entscheidet
            noch das Wetter dieser zehn Tage mit.
          </p>
        </Card>
      )}

      {data.months.length > 0 && (
        <Card>
          <SectionHeading
            icon={Clock}
            title="Der Gang im Jahreslauf"
            hint="Ein Tagesgang, der im Sommer entsteht und im Winter verschwindet, spricht für die Verdunstung; einer, der bleibt, für den Betrieb."
            actions={
              <button
                type="button"
                onClick={() => setShowMonths((v) => !v)}
                className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-brand hover:text-brand"
              >
                {showMonths ? 'Kurven ausblenden' : 'Kurven zeigen'}
              </button>
            }
          />

          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                <th className="pb-2 font-medium">Monat</th>
                <th className="pb-2 text-right font-medium">Amplitude</th>
                <th className="pb-2 text-right font-medium">hoch</th>
                <th className="pb-2 text-right font-medium">tief</th>
                <th className="pb-2 text-right font-medium">Tage</th>
                <th className="pb-2 text-right font-medium">Stunden</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} className="border-b border-line/60">
                  <td className="py-1.5 text-ink">{m.label}</td>
                  <td className="numeric py-1.5 text-right text-ink">
                    {m.amplitude === null ? '—' : `${num(m.amplitude, 2)} cm`}
                  </td>
                  <td className="numeric py-1.5 text-right text-ink-muted">{clock(m.highHour)}</td>
                  <td className="numeric py-1.5 text-right text-ink-muted">{clock(m.lowHour)}</td>
                  <td className="numeric py-1.5 text-right text-ink-muted">{num(m.days, 0)}</td>
                  <td className="numeric py-1.5 text-right text-ink-faint">
                    {num(m.coveredHours, 0)}/24
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {showMonths && (
            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {data.months.map((m) => (
                <div key={m.month}>
                  <p className="mb-2 text-xs font-medium text-ink">{m.label}</p>
                  <Profile profile={m} color={CHART.colors.brand} />
                  <Evidence profile={m} />
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 border-t border-line pt-3 text-[11px] text-ink-faint">
            Diese Tabelle ist erst nach einem vollen Jahr eine Aussage. Bis
            dahin steht hier, was das Archiv bisher gesehen hat — und die
            Spalte „Tage" sagt, wie ernst eine Zeile zu nehmen ist.
          </p>
        </Card>
      )}
    </div>
  )
}
