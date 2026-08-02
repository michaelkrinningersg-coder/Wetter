import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Flame,
  Snowflake,
  ThermometerSnowflake,
  ThermometerSun,
  Trophy,
  Wind,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num } from '../lib/format'
import type { RecordEvent, RecordsResponse } from '../types'
import {
  type Accent,
  Card,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

const STYLE: Record<string, { icon: ComponentType<LucideProps>; accent: Accent }> = {
  temp_max: { icon: Flame, accent: 'hot' },
  temp_min: { icon: Snowflake, accent: 'cold' },
  temp_mean_high: { icon: ThermometerSun, accent: 'warm' },
  temp_mean_low: { icon: ThermometerSnowflake, accent: 'cool' },
  precipitation: { icon: CloudRain, accent: 'wet' },
  wind_max: { icon: Wind, accent: 'brand' },
}

const FALLBACK = { icon: Trophy, accent: 'neutral' as Accent }

const ACCENT_TEXT: Record<Accent, string> = {
  brand: 'text-brand',
  warm: 'text-warm',
  hot: 'text-hot',
  cool: 'text-cool',
  cold: 'text-cold',
  wet: 'text-wet',
  dry: 'text-dry',
  good: 'text-good',
  neutral: 'text-ink',
}

/** Year alone — the day a century-old series began is noise. */
function startYear(iso: string): string {
  return iso.slice(0, 4)
}

function value(event: RecordEvent, v: number): string {
  if (event.unit === 'm/s') return `${num(v * 3.6, 1)} km/h`
  return `${num(v, event.decimals)} ${event.unit}`
}

/** The raw unit, shown alongside for wind only. */
function raw(event: RecordEvent, v: number): string | null {
  return event.unit === 'm/s' ? `${num(v, 1)} m/s` : null
}

function margin(event: RecordEvent): string {
  const delta = Math.abs(event.value - event.previous)
  return `${num(delta, event.decimals === 0 ? 1 : event.decimals)} ${
    event.unit === 'm/s' ? 'm/s' : event.unit
  }`
}

function EventRow({ event }: { event: RecordEvent }) {
  const { icon: Icon, accent } = STYLE[event.kind] ?? FALLBACK
  const secondary = raw(event, event.value)

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <Icon className={`size-4 shrink-0 translate-y-0.5 ${ACCENT_TEXT[accent]}`} aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink" title={event.name}>
            {event.name}
          </p>
          <p className="text-[11px] text-ink-faint">
            {event.state}
            {event.elevation !== null && ` · ${num(event.elevation, 0)} m`}
          </p>
        </div>
      </div>

      <div className="shrink-0 sm:w-44">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          {event.label}
        </p>
        <p className={`numeric text-lg font-semibold ${ACCENT_TEXT[accent]}`}>
          {value(event, event.value)}
        </p>
        {secondary && <p className="numeric text-[11px] text-ink-faint">{secondary}</p>}
      </div>

      <div className="shrink-0 sm:w-52">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          bisher
        </p>
        <p className="numeric text-xs text-ink-muted">
          {value(event, event.previous)}
          <span className="ml-1.5 text-ink-faint">am {isoToGerman(event.previousDate)}</span>
        </p>
        <p className="text-[11px] text-ink-faint">+{margin(event)}</p>
      </div>

      {/* The series is what separates an event from a footnote: beating 1947
          is news, beating 2015 at a station opened in 2007 is not. The two
          numbers differ on purpose — Leipzig-Holzhausen starts in 1759 but has
          192 years of readings, the rest being gaps. */}
      <div className="shrink-0 sm:w-36 sm:text-right">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          Messreihe
        </p>
        <p className="numeric text-xs text-ink">seit {startYear(event.since)}</p>
        <p className="text-[11px] text-ink-faint">{num(event.years, 0)} Jahre Messwerte</p>
      </div>
    </li>
  )
}

/**
 * Rows shown before the list has to be unfolded.
 *
 * A single heat day produced 526 records; rendering them all at once makes a
 * page some thirty thousand pixels tall. Nothing is filtered out — the button
 * says how many are left and one click shows them.
 */
const PAGE = 100

export function Records() {
  const [date, setDate] = useUrlState<string>('datum', null)
  const [showAll, setShowAll] = useState(false)
  const { data, loading, error } = useApi<RecordsResponse>(
    `/api/records${date ? `?date=${date}` : ''}`,
    [date],
  )

  const days = useMemo(() => data?.days ?? [], [data])
  const day = data?.day ?? null
  const at = day ? days.findIndex((d) => d.date === day.date) : -1
  const older = at >= 0 && at < days.length - 1 ? (days[at + 1]?.date ?? null) : null
  const newer = at > 0 ? (days[at - 1]?.date ?? null) : null

  if (loading && !data) return <Loading message="Rekorde werden geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  if (!day) {
    return (
      <Card>
        <SectionHeading icon={Trophy} title="Allzeitrekorde" />
        <p className="text-sm text-ink-muted">{data.hint ?? 'Noch keine Rekorde erfasst.'}</p>
      </Card>
    )
  }

  const byKind = new Map<string, number>()
  for (const e of day.events) byKind.set(e.label, (byKind.get(e.label) ?? 0) + 1)
  const longest = day.events.reduce<RecordEvent | null>(
    (best, e) => (!best || e.years > best.years ? e : best),
    null,
  )

  return (
    <div className="space-y-6">
      <InfoPanel title="Allzeitrekorde der Stationen">
        <p>
          Jede Station wird gegen ihre eigene Messgeschichte geprüft. Bricht ein
          Tageswert den höchsten oder tiefsten je an dieser Station gemessenen,
          steht er hier — mit dem alten Rekord, dessen Datum und der Länge der
          Reihe, um die es geht.
        </p>
        <p>
          Diese drei Angaben sind der Punkt. Eine Station, die seit neunzehn
          Jahren misst, bricht ihren Rekord sehr viel leichter als eine, die seit
          1881 läuft; ohne die Reihenlänge stünde Bedeutungsloses gleichrangig
          neben Bemerkenswertem. Sortiert ist deshalb nach Länge der Reihe, die
          gewichtigsten Meldungen oben.
        </p>
        <p>
          Grundlage sind die historischen DWD-Archive der Klimastationen bis zum{' '}
          {isoToGerman(data.range.cutoff)}; jeder Tag danach stammt aus dem
          eigenen Tagesarchiv. Die Reihen sind Rohdaten und nicht homogenisiert —
          Stationsverlegungen und Gerätewechsel sind nicht herausgerechnet.
        </p>
        <p>
          Die Jahresangabe zählt Tage mit gültigem Messwert, nicht die Spanne
          zwischen erstem und letztem. Leipzig-Holzhausen misst seit 1759, hat
          aber 192 Jahre Messwerte — der Rest sind Lücken. Gezählt wird je
          Parameter: eine Station kann seit 1881 Temperatur messen und erst seit
          1990 Wind.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={Trophy}
          title={`Rekorde am ${isoToGerman(day.date)}`}
          hint={`${num(data.range.events, 0)} Rekorde an ${num(
            data.range.stations,
            0,
          )} Stationen seit ${isoToGerman(data.range.first)} · ${num(
            days.length,
            0,
          )} Tage mit mindestens einem Rekord.`}
          actions={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!older}
                onClick={() => {
                  setShowAll(false)
                  if (older) setDate(older)
                }}
                aria-label="Vorheriger Rekordtag"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <select
                value={day.date}
                onChange={(e) => {
                  setShowAll(false)
                  setDate(e.target.value)
                }}
                aria-label="Rekordtag auswählen"
                className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink"
              >
                {days.map((d) => (
                  <option key={d.date} value={d.date}>
                    {isoToGerman(d.date)} — {d.count}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!newer}
                onClick={() => {
                  setShowAll(false)
                  if (newer) setDate(newer)
                }}
                aria-label="Nächster Rekordtag"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          }
        />

        {day.events.length === 0 ? (
          <EmptyState message="An diesem Tag wurde kein Allzeitrekord gebrochen." />
        ) : (
          <>
            <StatGrid>
              <StatTile
                label="Rekorde an diesem Tag"
                value={num(day.events.length, 0)}
                caption={[...byKind.entries()].map(([k, n]) => `${n}× ${k}`).join(' · ')}
                accent="brand"
              />
              <StatTile
                label="Betroffene Stationen"
                value={num(new Set(day.events.map((e) => e.station_id)).size, 0)}
                accent="neutral"
              />
              <StatTile
                label="Längste betroffene Reihe"
                value={longest ? `${num(longest.years, 0)} Jahre` : '—'}
                caption={longest ? longest.name : undefined}
                accent="warm"
              />
              <StatTile
                label="Ältester verdrängter Rekord"
                value={
                  day.events.length > 0
                    ? isoToGerman(
                        day.events.reduce((a, b) => (a.previousDate < b.previousDate ? a : b))
                          .previousDate,
                      )
                    : '—'
                }
                accent="hot"
              />
            </StatGrid>

            <ol className="mt-5 divide-y divide-line">
              {(showAll ? day.events : day.events.slice(0, PAGE)).map((e) => (
                <EventRow key={`${e.station_id}-${e.kind}`} event={e} />
              ))}
            </ol>

            {!showAll && day.events.length > PAGE && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-4 w-full cursor-pointer rounded-md border border-line bg-raised px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                Alle {num(day.events.length, 0)} Rekorde anzeigen
                <span className="ml-1.5 text-ink-faint">
                  — {num(day.events.length - PAGE, 0)} weitere, nach Reihenlänge absteigend
                </span>
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
