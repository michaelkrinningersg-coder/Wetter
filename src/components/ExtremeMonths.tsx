import type { ComponentType } from 'react'
import {
  ChevronRight,
  CloudRain,
  Flame,
  ListOrdered,
  type LucideProps,
  Snowflake,
  Sun,
  Wind,
} from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { monthName, num, temp, wind } from '../lib/format'
import type { ExtremeMonth } from '../types'
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
  icon: ComponentType<LucideProps>
  format: (value: number) => string
}

const CATEGORIES: Category[] = [
  { id: 'temp_mean_max', label: 'Wärmste Monate', icon: Flame, format: (v) => temp(v, 2) },
  { id: 'temp_mean_min', label: 'Kälteste Monate', icon: Snowflake, format: (v) => temp(v, 2) },
  { id: 'precipitation_max', label: 'Niederschlagsreichste Monate', icon: CloudRain, format: (v) => num(v, 1, 'mm') },
  { id: 'precipitation_min', label: 'Trockenste Monate', icon: Sun, format: (v) => num(v, 1, 'mm') },
  { id: 'wind_mean_max', label: 'Windigste Monate', icon: Wind, format: wind },
  { id: 'wind_mean_min', label: 'Windärmste Monate', icon: Wind, format: wind },
]

export function ExtremeMonths({
  stationId,
  stationName,
  onNavigateToMonth,
}: {
  stationId: string
  stationName: string
  onNavigateToMonth: (year: number, month: number) => void
}) {
  const [categoryId, setCategoryId] = useUrlState<string>('kategorie', CATEGORIES[0]!.id, {
    allowed: CATEGORIES.map((c) => c.id),
  })
  const category = CATEGORIES.find((c) => c.id === categoryId) ?? CATEGORIES[0]!

  const { data, loading, error, reload } = useApi<ExtremeMonth[]>(
    `/api/weather/extreme-months?category=${encodeURIComponent(categoryId)}&stationId=${encodeURIComponent(stationId)}`,
  )

  return (
    <>
      <InfoPanel icon={ListOrdered} title={`Extremmonate — ${stationName}`}>
        Die 50 extremsten Kalendermonate der Messreihe. Berücksichtigt werden nur
        Monate mit <strong>mindestens 25 gültigen Messtagen</strong>, damit lückenhafte
        Monate keine Scheinrekorde erzeugen.
      </InfoPanel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CATEGORIES.map((c) => {
          const active = c.id === categoryId
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => setCategoryId(c.id)}
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
                {c.label}
              </span>
            </button>
          )
        })}
      </div>

      <Card>
        <SectionHeading icon={category.icon} title={`Top 50 — ${category.label}`} />

        {loading ? (
          <Loading message="Lade Spitzenmonate…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <EmptyState message="Für diese Kategorie liegen keine Messwerte vor." />
        ) : (
          <ol className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {data.map((entry, index) => (
              <li key={`${entry.year}-${entry.month}`}>
                <button
                  type="button"
                  onClick={() => onNavigateToMonth(entry.year, entry.month)}
                  className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-card border border-line bg-raised p-3 text-left transition-colors hover:border-brand/40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="numeric grid size-7 shrink-0 place-items-center rounded bg-inset text-[11px] font-bold text-ink-muted transition-colors group-hover:bg-brand group-hover:text-canvas">
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-ink transition-colors group-hover:text-brand">
                        {monthName(entry.month)} {entry.year}
                      </span>
                      <span className="numeric block text-[10px] text-ink-faint">
                        {entry.validDays} gültige Messtage
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="numeric text-xs font-semibold text-ink">
                      {category.format(entry.value)}
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
