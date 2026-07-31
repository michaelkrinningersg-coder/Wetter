import { useState } from 'react'
import {
  ChevronRight,
  Flame,
  Gauge,
  type LucideProps,
  Snowflake,
  CloudRain,
  Wind,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { useApi } from '../lib/api'
import { monthName, num, temp, wind } from '../lib/format'
import type { ExtremeDay } from '../types'
import {
  Card,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
} from './ui'

interface Category {
  id: string
  label: string
  short: string
  icon: ComponentType<LucideProps>
  format: (value: number) => string
}

const CATEGORIES: Category[] = [
  { id: 'temp_mean_max', label: 'Höchste Tagesmitteltemperatur', short: 'Wärmster Tag (Ø)', icon: Flame, format: (v) => temp(v) },
  { id: 'temp_max_max', label: 'Höchste Maximaltemperatur', short: 'Spitzenhitze', icon: Flame, format: (v) => temp(v) },
  { id: 'temp_min_min', label: 'Niedrigste Minimaltemperatur', short: 'Spitzenkälte', icon: Snowflake, format: (v) => temp(v) },
  { id: 'temp_min_max', label: 'Wärmste Nächte (höchstes Minimum)', short: 'Tropennächte', icon: Flame, format: (v) => temp(v) },
  { id: 'temp_max_min', label: 'Kälteste Tage (niedrigstes Maximum)', short: 'Eistage', icon: Snowflake, format: (v) => temp(v) },
  { id: 'precipitation_max', label: 'Höchster Tagesniederschlag', short: 'Starkregen', icon: CloudRain, format: (v) => num(v, 1, 'mm') },
  { id: 'wind_max_max', label: 'Stärkste Windspitzen', short: 'Orkanböen', icon: Wind, format: wind },
  { id: 'wind_mean_max', label: 'Stärkster Tagesmittelwind', short: 'Mittelwind', icon: Wind, format: wind },
  { id: 'pressure_max', label: 'Höchster Luftdruck', short: 'Luftdruck max.', icon: Gauge, format: (v) => num(v, 1, 'hPa') },
  { id: 'pressure_min', label: 'Niedrigster Luftdruck', short: 'Luftdruck min.', icon: Gauge, format: (v) => num(v, 1, 'hPa') },
]

export function Extremes({
  stationId,
  stationName,
  onNavigateToMonth,
}: {
  stationId: string
  stationName: string
  onNavigateToMonth: (year: number, month: number) => void
}) {
  const [categoryId, setCategoryId] = useState(CATEGORIES[0]!.id)
  const category = CATEGORIES.find((c) => c.id === categoryId) ?? CATEGORIES[0]!

  const { data, loading, error, reload } = useApi<ExtremeDay[]>(
    `/api/weather/extremes?category=${encodeURIComponent(categoryId)}&stationId=${encodeURIComponent(stationId)}`,
  )

  return (
    <>
      <InfoPanel icon={Flame} title={`Extremwerte einzelner Tage — ${stationName}`}>
        Die 50 extremsten Messtage der gesamten Reihe je Kategorie. Ein Klick auf einen
        Eintrag öffnet den zugehörigen Monat in der Monatsübersicht.
      </InfoPanel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {CATEGORIES.map((c) => {
          const active = c.id === categoryId
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => setCategoryId(c.id)}
              title={c.label}
              className={`flex h-20 cursor-pointer flex-col justify-between rounded-card border p-3 text-left transition-colors ${
                active
                  ? 'border-brand bg-brand/15'
                  : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <c.icon
                className={`size-4 ${active ? 'text-brand' : 'text-ink-faint'}`}
                aria-hidden
              />
              <span
                className={`text-[11px] font-medium leading-tight ${active ? 'text-brand' : 'text-ink-muted'}`}
              >
                {c.short}
              </span>
            </button>
          )
        })}
      </div>

      <Card>
        <SectionHeading
          icon={category.icon}
          title={`Top 50 — ${category.label}`}
          hint="Sortiert vom extremsten Wert abwärts."
        />

        {loading ? (
          <Loading message="Lade Rekordtage…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <EmptyState message="Für diese Kategorie liegen keine Messwerte vor." />
        ) : (
          <ol className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {data.map((day, index) => (
              <li key={day.date}>
                <button
                  type="button"
                  onClick={() => onNavigateToMonth(day.year, day.month)}
                  className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-card border border-line bg-raised p-3 text-left transition-colors hover:border-brand/40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="numeric grid size-7 shrink-0 place-items-center rounded bg-inset text-[11px] font-bold text-ink-muted transition-colors group-hover:bg-brand group-hover:text-canvas">
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="numeric block truncate text-xs font-semibold text-ink transition-colors group-hover:text-brand">
                        {day.day}. {monthName(day.month)} {day.year}
                      </span>
                      <span className="block text-[10px] text-ink-faint">
                        Monatsübersicht öffnen
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="numeric text-xs font-semibold text-ink">
                      {category.format(day.value)}
                    </span>
                    <ChevronRight
                      className="size-3.5 text-ink-faint transition-colors group-hover:text-brand"
                      aria-hidden
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  )
}
