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
import { CalendarRange, Flame, Gauge, Layers, Ruler, Timer } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, year as yearOf } from '../lib/format'
import type { Episode, EpisodeKindMeta, EpisodesResponse } from '../types'
import {
  Card,
  CHART,
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
  type Accent,
} from './ui'

const BAR_COLOR: Record<string, string> = {
  hot: CHART.colors.hot,
  warm: CHART.colors.warm,
  cool: CHART.colors.cool,
  cold: CHART.colors.cold,
  wet: CHART.colors.wet,
  dry: CHART.colors.brand,
}

/** Mirrors `EPISODE_KEYS` in server/episodes.js; an unknown value falls back. */
const KIND_KEYS = ['heat', 'summer', 'frost', 'ice', 'wet', 'dry', 'warm', 'cold']

const LISTS = [
  { value: 'staerkste', label: 'Nach Stärke' },
  { value: 'laengste', label: 'Nach Länge' },
  { value: 'juengste', label: 'Zuletzt' },
] as const

type ListKey = (typeof LISTS)[number]['value']

/* -------------------------------------------------------------------------- */
/* One episode                                                                */
/* -------------------------------------------------------------------------- */

/** "17 Tage, davon 12 am Stück" — never one number where two are needed. */
function lengths(episode: Episode): string {
  if (episode.breaks === 0) return `${num(episode.span, 0)} Tage am Stück`
  return `${num(episode.span, 0)} Tage, davon ${num(episode.core, 0)} am Stück`
}

function EpisodeRow({
  episode,
  kind,
  years,
}: {
  episode: Episode
  kind: EpisodeKindMeta
  years: number
}) {
  const value = (v: number, d = kind.decimals) => num(v, d)

  return (
    <li className="rounded-card border border-line bg-raised p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="numeric text-sm font-semibold text-ink">
          {isoToGerman(episode.start)} – {isoToGerman(episode.end)}
          {episode.current && (
            <span className="ml-2 rounded-md border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
              läuft noch
            </span>
          )}
        </p>
        <p className="numeric text-sm font-semibold text-ink">
          {value(episode.severity, kind.severityDecimals)}{' '}
          <span className="text-[11px] font-normal text-ink-muted">{kind.severityUnit}</span>
        </p>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11px] text-ink-muted">
        <span>{lengths(episode)}</span>
        {episode.breaks > 0 && (
          <span className="text-ink-faint">
            {num(episode.breaks, 0)}{' '}
            {episode.breaks === 1 ? 'Tag darunter' : 'Tage darunter'}, überbrückt
          </span>
        )}
        {episode.peak && (
          <span>
            {kind.peakLabel} {value(episode.peak.value)} {kind.unit} am{' '}
            {isoToGerman(episode.peak.date)}
          </span>
        )}
        {kind.peak === 'sum' && (
          <span>
            {kind.peakLabel} {value(episode.total, 1)} {kind.unit}
          </span>
        )}
        {kind.mode === 'relativ' && (
          <span className="text-ink-faint">
            Schwelle im Mittel {value(episode.limitMean)} {kind.unit}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-[11px] text-ink-faint">
        Platz {num(episode.rank, 0)} nach Stärke —{' '}
        {episode.returnYears !== null
          ? `so stark oder stärker war es ${num(episode.rank, 0)}-mal in ${num(years, 0)} Jahren, im Mittel alle ${num(episode.returnYears, 0)} Jahre`
          : 'zu kurze Reihe für eine Einordnung'}
      </p>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Charts                                                                     */
/* -------------------------------------------------------------------------- */

function DecadeTooltip({
  active,
  payload,
  kind,
}: {
  active?: boolean
  payload?: { payload: EpisodesResponse['decades'][number] }[]
  kind: EpisodeKindMeta
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <ChartTooltip
      title={`${yearOf(row.decade)}er`}
      rows={[
        { label: 'Episoden', value: num(row.count, 0) },
        { label: 'Tage insgesamt', value: num(row.days, 0) },
        {
          label: `${kind.severityLabel} im Mittel`,
          value:
            row.meanSeverity === null
              ? '—'
              : `${num(row.meanSeverity, kind.severityDecimals)} ${kind.severityUnit}`,
        },
      ]}
      footer={`${num(row.measured, 0)} Messtage im Jahrzehnt (${num(row.share * 100, 0)} % der Tage)`}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* The view                                                                   */
/* -------------------------------------------------------------------------- */

export function Episodes({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  // The same parameter the threshold view uses, and the six threshold keys are
  // spelled identically there — so switching between the two sub-views keeps
  // the category instead of dropping back to heat.
  const [kindKey, setKindKey] = useUrlState<string>('art', 'heat', { allowed: KIND_KEYS })
  const [list, setList] = useUrlState<ListKey>('liste', 'staerkste', {
    allowed: LISTS.map((l) => l.value),
  })

  const { data, loading, error, reload } = useApi<EpisodesResponse>(
    `/api/weather/episodes?kind=${encodeURIComponent(kindKey)}&stationId=${encodeURIComponent(stationId)}`,
  )

  if (loading && !data) return <Loading message="Episoden werden gesucht …" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const { kind } = data
  const byMode = (mode: string) =>
    data.kinds.filter((k) => k.mode === mode).map((k) => ({ value: k.key, label: k.short, title: k.label }))

  const episodes =
    list === 'laengste' ? data.longest : list === 'juengste' ? data.recent : data.strongest

  // The first and last decade are cut short by the start of the record and by
  // today's date; a bar that covers four years must not be read as a quiet one.
  const partial = new Set(
    data.decades.filter((d) => d.share < 0.9).map((d) => d.decade),
  )

  const strongest = data.strongest[0] ?? null
  const longest = data.longest[0] ?? null

  return (
    <div className="space-y-6">
      <InfoPanel icon={CalendarRange} title={`Episoden statt Tage — ${stationName}`}>
        <p>
          Niemand erinnert den 9. August 2003, erinnert wird <em>der Sommer 2003</em>.
          Eine Episode ist eine Folge von Tagen, die zusammengehören, und sie trägt
          drei Zahlen, die ein einzelner Tag nicht hat: wie lange sie dauerte, wie
          stark sie war und wie oft es so etwas schon gab.
        </p>
        <p>
          <strong className="text-ink">Zwei Definitionen</strong> stehen
          nebeneinander. Die <em>Schwellen</em> sind die meteorologischen
          Konventionen — 30 °C, 25 °C, 0 °C, 1 mm — und jeder Satz daraus ist
          wörtlich nachprüfbar. Die <em>relative</em> Betrachtung misst jeden Tag am
          90. beziehungsweise 10. Perzentil seines eigenen Kalendertages aus der
          Basisperiode 1961–1990, so wie es die ETCCDI-Indizes WSDI und CSDI tun.
          Nur die zweite findet die Warmepisode, die am 20. Dezember 2022 begann und
          20 Tage dauerte: 12 °C im Dezember sind so weit über dem Üblichen wie
          33 °C im August.
        </p>
        <p>
          Die Basisperiode ist <strong className="text-ink">fest</strong>, nicht die
          ganze Reihe. Ein Perzentil über 1858–2026 würde mit dem Klima mitwandern,
          das es messen soll — per Konstruktion läge ein Zehntel aller Tage darüber,
          gleichmäßig verteilt, und der Trend verschwände in seinem eigenen Maßstab.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={Layers}
          title="Was gesucht wird"
          hint={`${kind.note} Eine Episode zählt ab ${num(kind.minDays, 0)} zusammenhängenden Tagen.`}
        />
        <div className="space-y-3">
          <div>
            <p className="label mb-1.5">Feste Schwellen</p>
            <ChoiceGroup
              label="Episodenart mit fester Schwelle"
              value={kindKey}
              choices={byMode('schwelle')}
              onChange={setKindKey}
              size="sm"
            />
          </div>
          <div>
            <p className="label mb-1.5">Relativ zum Kalendertag (1961–1990)</p>
            <ChoiceGroup
              label="Episodenart relativ zum Kalendertag"
              value={kindKey}
              choices={byMode('relativ')}
              onChange={setKindKey}
              size="sm"
            />
          </div>
        </div>
      </Card>

      {data.hint && <EmptyState message={data.hint} />}

      {data.counts && data.range && data.counts.episodes > 0 && (
        <>
          <StatGrid>
            <StatTile
              label="Stärkste Episode"
              value={
                strongest
                  ? `${num(strongest.severity, kind.severityDecimals)} ${kind.severityUnit}`
                  : '—'
              }
              caption={
                strongest
                  ? `${isoToGerman(strongest.start)} – ${isoToGerman(strongest.end)}`
                  : undefined
              }
              accent={kind.accent as Accent}
              icon={Flame}
            />
            <StatTile
              label="Längste Episode"
              value={longest ? `${num(longest.span, 0)} Tage` : '—'}
              caption={longest ? lengths(longest) : undefined}
              accent={kind.accent as Accent}
              icon={Ruler}
            />
            <StatTile
              label="Episoden gesamt"
              value={num(data.counts.episodes, 0)}
              caption={`${num(data.counts.perDecade, 1)} je Jahrzehnt · ${num(data.counts.withBreaks, 0)} mit überbrücktem Tag`}
              accent="brand"
              icon={Timer}
            />
            <StatTile
              label="Reihe"
              value={`${yearOf(Number(data.range.first?.slice(0, 4)))}–${yearOf(Number(data.range.last?.slice(0, 4)))}`}
              caption={`${num(data.range.days, 0)} Tage mit ${kind.mode === 'relativ' ? 'Messwert und Schwelle' : 'Messwert'}`}
              accent="neutral"
              icon={Gauge}
            />
          </StatGrid>

          <Card>
            <SectionHeading
              icon={CalendarRange}
              title="Episoden je Jahrzehnt"
              hint={
                partial.size > 0
                  ? 'Blass gezeichnete Balken stehen für Jahrzehnte, in denen weniger als 90 % der Tage gemessen wurden — das erste und das letzte sind fast immer angeschnitten.'
                  : undefined
              }
            />
            <ChartFrame height={260}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.decades} margin={{ top: 8, right: 8, left: -22, bottom: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="decade"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    tickFormatter={(v: number) => `${yearOf(v)}er`}
                  />
                  <YAxis
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={<DecadeTooltip kind={kind} />}
                    cursor={{ fill: CHART.cursorSoft }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={40}>
                    {data.decades.map((d) => (
                      <Cell
                        key={d.decade}
                        fill={BAR_COLOR[kind.accent] ?? CHART.colors.brand}
                        fillOpacity={partial.has(d.decade) ? 0.25 : 0.75}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          <Card>
            <SectionHeading
              icon={CalendarRange}
              title="In welchem Monat sie beginnen"
              hint={
                kind.mode === 'relativ'
                  ? 'Der eigentliche Gewinn der relativen Definition: Warm- und Kälteepisoden gibt es in jedem Monat, nicht nur im Hochsommer und im Hochwinter.'
                  : 'Wo eine feste Schwelle an die Jahreszeit gebunden ist, deckt die Verteilung nur einen Teil des Jahres ab — 30 °C gibt es im Februar nicht. Trockenheit und Niederschlag zeigen dagegen das ganze Jahr.'
              }
            />
            <ChartFrame height={220}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.months} margin={{ top: 8, right: 8, left: -22, bottom: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    tickFormatter={(v: string) => v.slice(0, 3)}
                  />
                  <YAxis
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: CHART.cursorSoft }}
                    content={({ active, payload, label }) =>
                      active && payload?.[0] ? (
                        <ChartTooltip
                          title={String(label)}
                          rows={[
                            {
                              label: 'Episoden mit Beginn in diesem Monat',
                              value: num(Number(payload[0].value), 0),
                            },
                          ]}
                        />
                      ) : null
                    }
                  />
                  <Bar
                    dataKey="count"
                    fill={BAR_COLOR[kind.accent] ?? CHART.colors.brand}
                    fillOpacity={0.7}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </Card>

          <Card>
            <SectionHeading
              icon={Ruler}
              title={kind.label}
              hint={
                kind.key === 'dry'
                  ? `Die Stärke zählt die trockenen Tage selbst, nicht die Spanne — überbrückte Regentage zählen also nicht mit.`
                  : `Die Stärke misst ${kind.severityLabel} und legt damit Dauer und Intensität in eine Zahl. Eine viertägige Episode bei 38 °C wiegt so schwerer als eine neuntägige, die nie über 30 °C hinauskam.`
              }
              actions={
                <ChoiceGroup
                  label="Sortierung"
                  value={list}
                  choices={LISTS}
                  onChange={setList}
                  size="sm"
                />
              }
            />
            <ul className="space-y-2">
              {episodes.map((episode) => (
                <EpisodeRow
                  key={episode.start}
                  episode={episode}
                  kind={kind}
                  years={data.range?.years ?? 0}
                />
              ))}
            </ul>
          </Card>

          <Card>
            <SectionHeading
              icon={Layers}
              title="Wie eine Episode abgegrenzt wird"
              hint="Zwei Längen, weil keine allein ehrlich wäre."
            />
            <ul className="space-y-1.5 text-xs text-ink-muted">
              <li>
                <strong className="text-ink">Ein einzelner Tag unter der Schwelle
                beendet die Episode nicht.</strong> Ein 29-°C-Tag mitten im August 2018
                beendet die Hitzewelle nicht so, wie sie erlebt wurde — überbrückt
                dauert sie 17 Tage. Damit „17 Tage" nicht als 17 Tage über 30 °C
                gelesen wird, steht die längste ununterbrochene Strecke daneben: 12.
                Nach diesem zweiten Maß gehört der Rekord weiter dem August 2003 mit
                13 Tagen ohne jede Unterbrechung.
              </li>
              <li>
                <strong className="text-ink">Überbrücken verlängert, es erschafft
                nicht.</strong> Die längste ununterbrochene Strecke muss die
                Mindestdauer schon allein erreichen. Ohne diese Regel würden zwei
                zweitägige Hitzespitzen um einen kühlen Tag herum zu einer
                „fünftägigen Hitzewelle", und aus den 88 Hitzeepisoden dieser
                Station würden 190.
              </li>
              <li>
                <strong className="text-ink">Nur ein gemessener Tag darf
                überbrücken.</strong> Eine Lücke im Archiv beendet die Episode, denn
                von einem Tag, den niemand aufgezeichnet hat, lässt sich nicht
                behaupten, er sei knapp darunter gewesen.
              </li>
              <li>
                <strong className="text-ink">Trockenepisoden überbrücken am
                häufigsten</strong>, weil ein einzelner Regentag häufig ist — eine
                80-Tage-Episode kann dreizehn davon enthalten. Deshalb zählt ihre
                Stärke nur die trockenen Tage selbst und nicht die Spanne, und
                beide Zahlen stehen in jeder Zeile.
              </li>
              <li>
                <strong className="text-ink">Die Einordnung ist empirisch.</strong>{' '}
                „Im Mittel alle 40 Jahre" heißt: so stark oder stärker war es in{' '}
                {num(data.range.years, 0)} Jahren so oft, wie der Platz sagt. Das ist
                eine Auszählung, keine angepasste Verteilung — für seltene Ereignisse
                ist die Unsicherheit entsprechend groß.
              </li>
            </ul>
          </Card>
        </>
      )}

      {data.counts && data.counts.episodes === 0 && (
        <EmptyState message="Für diese Art wurde in der ganzen Reihe keine Episode gefunden." />
      )}
    </div>
  )
}
