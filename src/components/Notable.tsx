import { useState } from 'react'
import {
  CloudRain,
  Flame,
  Ruler,
  Snowflake,
  Sparkles,
  Thermometer,
  ThermometerSnowflake,
  ThermometerSun,
  Trophy,
  Wind,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { useApi } from '../lib/api'
import { isoToGerman, num } from '../lib/format'
import type { NotableCategory, NotableResponse } from '../types'
import {
  type Accent,
  Card,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
} from './ui'

const STYLE: Record<string, { icon: ComponentType<LucideProps>; accent: Accent }> = {
  hottest: { icon: Flame, accent: 'hot' },
  coldest: { icon: Snowflake, accent: 'cold' },
  warmest_mean: { icon: ThermometerSun, accent: 'warm' },
  coldest_mean: { icon: ThermometerSnowflake, accent: 'cool' },
  wettest: { icon: CloudRain, accent: 'wet' },
  wettest_station: { icon: CloudRain, accent: 'brand' },
  windiest: { icon: Wind, accent: 'brand' },
  widest_spread: { icon: Ruler, accent: 'dry' },
  snowiest: { icon: Snowflake, accent: 'cool' },
  record_rich: { icon: Trophy, accent: 'hot' },
}

const FALLBACK = { icon: Thermometer, accent: 'neutral' as Accent }

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

const ACCENT_BAR: Record<Accent, string> = {
  brand: 'bg-brand',
  warm: 'bg-warm',
  hot: 'bg-hot',
  cool: 'bg-cool',
  cold: 'bg-cold',
  wet: 'bg-wet',
  dry: 'bg-dry',
  good: 'bg-good',
  neutral: 'bg-line-strong',
}

/** Wind is published in metres per second and read in kilometres per hour. */
function format(value: number, unit: string, decimals: number): string {
  if (unit === 'm/s') return `${num(value * 3.6, 1)} km/h`
  return `${num(value, decimals)}${unit ? ` ${unit}` : ''}`
}

function secondary(value: number, unit: string): string | null {
  return unit === 'm/s' ? `${num(value, 1)} m/s` : null
}

const SHOWN = 5

function CategoryCard({ category }: { category: NotableCategory }) {
  const [expanded, setExpanded] = useState(false)
  const { kind, days } = category
  const { icon: Icon, accent } = STYLE[kind.key] ?? FALLBACK

  const top = days[0]
  if (!top) return null

  const rest = expanded ? days.slice(1) : days.slice(1, SHOWN)

  return (
    <Card className="relative overflow-hidden" padded={false}>
      <span className={`absolute inset-y-0 left-0 w-0.5 ${ACCENT_BAR[accent]}`} aria-hidden />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="label">{kind.label}</span>
          <Icon className={`size-4 shrink-0 ${ACCENT_TEXT[accent]}`} aria-hidden />
        </div>

        <p className={`numeric mt-2 text-3xl font-semibold tracking-tight ${ACCENT_TEXT[accent]}`}>
          {format(top.value, kind.unit, kind.decimals)}
        </p>
        {secondary(top.value, kind.unit) && (
          <p className="numeric text-xs text-ink-faint">{secondary(top.value, kind.unit)}</p>
        )}
        <p className="mt-1 text-sm font-medium text-ink">{isoToGerman(top.date)}</p>
        <p className="text-[11px] text-ink-faint">
          aus {num(top.stations, 0)} Stationen
        </p>

        <ol className="mt-3 space-y-1 border-t border-line pt-3">
          {rest.map((day, i) => (
            <li key={day.date} className="flex items-baseline gap-2 text-[11px]">
              <span className="w-3 shrink-0 text-ink-faint">{i + 2}.</span>
              <span className="numeric w-24 shrink-0 text-ink-muted">
                {format(day.value, kind.unit, kind.decimals)}
              </span>
              <span className="truncate text-ink-faint">{isoToGerman(day.date)}</span>
            </li>
          ))}
        </ol>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[10px] text-ink-faint">{kind.note}</p>
          {days.length > SHOWN && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              className="shrink-0 cursor-pointer rounded-md border border-line bg-raised px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {expanded ? 'Weniger' : `Top ${days.length}`}
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

export function Notable() {
  const { data, loading, error } = useApi<NotableResponse>('/api/germany/notable')

  if (loading && !data) return <Loading message="Markante Tage werden gesucht …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const all = [data.records, ...data.categories]

  return (
    <div className="space-y-6">
      <InfoPanel title="Markante Tage des Archivs">
        <p>
          Welche Tage im gesammelten Bestand herausstechen — und zwar auf
          verschiedene Weisen. Der heißeste Tag entscheidet sich an einer
          einzelnen Station, der nasseste am Landesmittel, der Tag mit der
          größten Spanne am Abstand zwischen wärmster und kältester Station.
          Sortierte man alles nach demselben Maß, käme neunmal dieselbe
          Hitzewelle heraus.
        </p>
        <p>
          Ein Tag zählt erst ab {num(data.minStations, 0)} meldenden Stationen
          für die jeweilige Größe. An den Rändern des Archivs gibt es Tage, an
          denen nur wenige Dutzend Stationen gesendet haben, und ein Landesmittel
          aus vierzig Stationen wäre keins.
        </p>
        <p>
          Der Bestand umfasst {num(data.range.days, 0)} Tage von{' '}
          {isoToGerman(data.range.first)} bis {isoToGerman(data.range.last)}. Er
          wächst täglich, die Bestenlisten also auch.
        </p>
      </InfoPanel>

      {/* The heading belongs to the grid, not in a card of its own — an empty
          box around three lines of text reads as a missing chart. */}
      <SectionHeading
        icon={Sparkles}
        title="Die auffälligsten Tage"
        hint="Jede Kachel zeigt den Spitzenreiter und die nächsten Plätze; aufklappen zeigt die volle Liste."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {all.map((category) => (
          <CategoryCard key={category.kind.key} category={category} />
        ))}
      </div>
    </div>
  )
}
