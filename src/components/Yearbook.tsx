import {
  CalendarHeart,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Flame,
  Gauge,
  Moon,
  Ruler,
  Snowflake,
  Sparkles,
  Sun,
  ThermometerSnowflake,
  ThermometerSun,
  Wind,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, year as yearOf } from '../lib/format'
import type { YearbookCategory, YearbookDay, YearbookResponse } from '../types'
import {
  Card,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

const ICONS: Record<string, ComponentType<LucideProps>> = {
  hottest: Flame,
  coldest: Snowflake,
  warmest_mean: ThermometerSun,
  coldest_mean: ThermometerSnowflake,
  wettest: CloudRain,
  windiest: Wind,
  snowiest: Snowflake,
  sunniest: Sun,
  lowest_pressure: Gauge,
  widest_range: Ruler,
  biggest_jump: Moon,
}

const ACCENT_TEXT: Record<string, string> = {
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

const ACCENT_BORDER: Record<string, string> = {
  brand: 'border-l-brand',
  warm: 'border-l-warm',
  hot: 'border-l-hot',
  cool: 'border-l-cool',
  cold: 'border-l-cold',
  wet: 'border-l-wet',
  dry: 'border-l-dry',
  good: 'border-l-good',
  neutral: 'border-l-line-strong',
}

function fieldValue(category: YearbookCategory, value: number): string {
  if (category.unit === 'm/s') return `${num(value * 3.6, 0)} km/h`
  return `${num(value, category.decimals)} ${category.unit}`
}

/** "Der wärmste 12. August seit 1858" — a sentence, not a rank. */
function sentence(category: YearbookCategory, day: YearbookDay, reason: YearbookDay['reasons'][number], first: string): string {
  const superlative = category.direction === 'max' ? 'höchster' : 'tiefster'
  if (reason.rank === 1 && reason.ties === 0) {
    return `${category.label} — und der ${superlative} Wert, den ein ${day.label} seit ${first.slice(0, 4)} je hatte`
  }
  if (reason.rank === 1) {
    return `${category.label} — Bestwert für einen ${day.label}, geteilt mit ${num(reason.ties, 0)} weiteren ${reason.ties === 1 ? 'Jahr' : 'Jahren'}`
  }
  return `${category.label} — Platz ${num(reason.rank, 0)} von ${num(reason.of, 0)} für einen ${day.label}`
}

function DayCard({
  day,
  categories,
  first,
}: {
  day: YearbookDay
  categories: YearbookCategory[]
  first: string
}) {
  const lead = day.headlines[0]
  const category = categories.find((c) => c.key === lead?.category)
  if (!lead || !category) return null

  const Icon = ICONS[category.key] ?? Sparkles
  const accent = category.accent

  return (
    <li
      className={`rounded-card border border-line border-l-2 bg-raised p-4 ${ACCENT_BORDER[accent] ?? 'border-l-line-strong'}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`size-4 shrink-0 translate-y-0.5 ${ACCENT_TEXT[accent] ?? 'text-ink'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="numeric text-sm font-semibold text-ink">{isoToGerman(day.date)}</p>
            <p className={`numeric text-lg font-semibold ${ACCENT_TEXT[accent] ?? 'text-ink'}`}>
              {fieldValue(category, lead.value)}
            </p>
          </div>

          <p className="mt-1 text-xs text-ink-muted">{sentence(category, day, lead, first)}</p>

          {day.headlines.length > 1 && (
            <ul className="mt-2 space-y-0.5">
              {day.headlines.slice(1).map((extra) => {
                const other = categories.find((c) => c.key === extra.category)
                if (!other) return null
                return (
                  <li key={extra.category} className="text-[11px] text-ink-faint">
                    zugleich {other.label.toLowerCase()}:{' '}
                    <span className="numeric">{fieldValue(other, extra.value)}</span> — Platz{' '}
                    {num(extra.rank, 0)} von {num(extra.of, 0)}
                  </li>
                )
              })}
            </ul>
          )}

          {day.filler && (
            <p className="mt-2 text-[10px] text-ink-faint">
              Kein eigener Kategoriesieger — dieser Platz war frei, weil in diesem Jahr
              nicht alle Größen gemessen wurden.
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

export function Yearbook({ stationId, stationName }: { stationId: string; stationName: string }) {
  // 'jahr' is one of the parameters that survive a tab change, so picking 1947
  // here and switching to the monthly table lands in 1947 as well.
  const [yearParam, setYearParam] = useUrlState<string>('jahr', null)
  const year = yearParam ? Number(yearParam) : null
  const setYear = (next: number) => setYearParam(String(next))
  const { data, loading, error } = useApi<YearbookResponse>(
    `/api/weather/yearbook?stationId=${stationId}${year ? `&jahr=${year}` : ''}`,
    [stationId, year],
  )

  if (loading && !data) return <Loading message="Jahresrückblick wird zusammengestellt …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const categories = data.categories ?? []
  const at = data.years.indexOf(data.year)
  const previous = at > 0 ? (data.years[at - 1] ?? null) : null
  const next = at >= 0 && at < data.years.length - 1 ? (data.years[at + 1] ?? null) : null
  const { summary } = data

  return (
    <div className="space-y-6">
      <InfoPanel title={`Der Jahresrückblick von ${stationName}`}>
        <p>
          Zehn Tage, die ein Jahr beschreiben — für jedes der{' '}
          {num(data.years.length, 0)} Jahre im Archiv, ohne dass jemand auswählt.
          Ein Tag gilt als markant, wenn er für <em>seinen Kalendertag</em>{' '}
          ungewöhnlich war, nicht für das Jahr: 14 °C am 3. Januar sind
          bemerkenswert, 14 °C am 3. Juli ebenfalls, nur andersherum.
        </p>
        <p>
          Jeder Tag wird gegen alle anderen Ausgaben desselben Kalendertages
          gestellt — jeder 3. Januar seit {data.range.first.slice(0, 4)} gegen
          jeden anderen. Daraus entsteht ein Satz, den man nachprüfen kann:
          „der wärmste 12. August seit 1858". Gewählt wird zuerst der beste Tag
          jeder Kategorie, dann werden freie Plätze aufgefüllt; nach Punktzahl
          allein bekäme man dieselbe Hitzewelle fünfmal.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={CalendarHeart}
          title={`${yearOf(data.year)} in zehn Tagen`}
          hint={
            summary
              ? `${num(summary.measured, 0)} Tage mit Messwert · ${num(data.days.length, 0)} ausgewählte Tage aus ${num(categories.length, 0)} Kategorien`
              : undefined
          }
          actions={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={previous === null}
                onClick={() => previous !== null && setYear(previous)}
                aria-label="Vorheriges Jahr"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <select
                value={data.year}
                onChange={(e) => setYear(Number(e.target.value))}
                aria-label="Jahr auswählen"
                className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink"
              >
                {[...data.years].reverse().map((y) => (
                  <option key={y} value={y}>
                    {yearOf(y)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={next === null}
                onClick={() => next !== null && setYear(next)}
                aria-label="Nächstes Jahr"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          }
        />

        {data.hint && <EmptyState message={data.hint} />}
      </Card>

      {summary && (
        <StatGrid>
          <StatTile
            label="Jahresmittel"
            value={summary.tempMean !== null ? `${num(summary.tempMean, 1)} °C` : '—'}
            caption={
              summary.warmthPlace
                ? `Platz ${num(summary.warmthPlace.place, 0)} von ${num(summary.warmthPlace.of, 0)} — von warm nach kalt`
                : `weniger als ${num(summary.minDays, 0)} Messtage — nicht eingeordnet`
            }
            accent="hot"
            icon={ThermometerSun}
          />
          <StatTile
            label="Niederschlag"
            value={summary.precipitation !== null ? `${num(summary.precipitation, 0)} mm` : '—'}
            caption={
              summary.wetPlace
                ? `Platz ${num(summary.wetPlace.place, 0)} von ${num(summary.wetPlace.of, 0)} — von nass nach trocken`
                : undefined
            }
            accent="wet"
            icon={CloudRain}
          />
          <StatTile
            label="Sonnenschein"
            value={summary.sunshine ? `${num(summary.sunshine, 0)} h` : '—'}
            caption={summary.sunshine ? 'Summe über das Jahr' : 'in diesem Jahr nicht gemessen'}
            accent="warm"
            icon={Sun}
          />
          <StatTile
            label="Messtage"
            value={num(summary.measured, 0)}
            caption={`von ${num(summary.days, 0)} Tagen mit einem Eintrag im Archiv`}
            accent="neutral"
          />
        </StatGrid>
      )}

      {/* ---------------------------------------------------------------- */}

      {data.days.length > 0 && (
        <Card>
          <SectionHeading
            icon={Sparkles}
            title="Die zehn Tage"
            hint="In der Reihenfolge des Jahres, nicht nach Auffälligkeit — so liest sich das Jahr wie ein Jahr."
          />
          <ul className="mt-4 space-y-2.5">
            {data.days.map((day) => (
              <DayCard
                key={day.date}
                day={day}
                categories={categories}
                first={data.range.first}
              />
            ))}
          </ul>
        </Card>
      )}

      {data.runnersUp && data.runnersUp.length > 0 && (
        <Card>
          <SectionHeading
            icon={Sparkles}
            title="Knapp nicht dabei"
            hint={`${num(categories.length, 0)} Kategorien bewerben sich um ${num(data.highlights ?? 10, 0)} Plätze. Diese Kategoriesieger haben es nicht in die Liste geschafft.`}
          />
          <ul className="mt-4 space-y-1.5">
            {data.runnersUp.map((day) => {
              const lead = day.headlines[0]
              const category = categories.find((c) => c.key === lead?.category)
              if (!lead || !category) return null
              return (
                <li key={day.date} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-ink-muted">
                    <span className="numeric text-ink">{isoToGerman(day.date)}</span> —{' '}
                    {category.label}
                  </span>
                  <span className={`numeric shrink-0 ${ACCENT_TEXT[category.accent] ?? 'text-ink'}`}>
                    {fieldValue(category, lead.value)}
                    <span className="ml-1.5 text-[10px] text-ink-faint">
                      Platz {num(lead.rank, 0)}/{num(lead.of, 0)}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
