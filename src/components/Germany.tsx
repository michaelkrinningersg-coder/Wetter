import { useMemo, useState } from 'react'
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Flame,
  Map,
  Mountain,
  Snowflake,
  Thermometer,
  ThermometerSnowflake,
  ThermometerSun,
  Wind,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { useApi } from '../lib/api'
import { isoToGerman, num } from '../lib/format'
import type { GermanyCategory, GermanyRank, GermanyResponse } from '../types'
import {
  type Accent,
  Card,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/** Icon and accent per category, keyed by the identifiers the API sends. */
const STYLE: Record<string, { icon: ComponentType<LucideProps>; accent: Accent }> = {
  warmest_mean: { icon: ThermometerSun, accent: 'warm' },
  warmest_max: { icon: Flame, accent: 'hot' },
  coldest_mean: { icon: ThermometerSnowflake, accent: 'cool' },
  coldest_min: { icon: Snowflake, accent: 'cold' },
  windiest_gust: { icon: Wind, accent: 'brand' },
  windiest_mean: { icon: Wind, accent: 'neutral' },
  wettest: { icon: CloudRain, accent: 'wet' },
  widest_range: { icon: ArrowUpDown, accent: 'dry' },
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

function place(rank: GermanyRank): string {
  const parts = [rank.state]
  if (rank.elevation !== null) parts.push(`${num(rank.elevation, 0)} m`)
  return parts.join(' · ')
}

/* -------------------------------------------------------------------------- */
/* Category card                                                              */
/* -------------------------------------------------------------------------- */

function CategoryCard({
  category,
  lowlandLimit,
}: {
  category: GermanyCategory
  lowlandLimit: number
}) {
  const { icon: Icon, accent } = STYLE[category.key] ?? FALLBACK
  const winner = category.all.top[0]
  const lowland = category.lowland.top[0]
  const chasers = category.all.top.slice(1, 4)

  if (!winner) {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-ink-faint" aria-hidden />
          <span className="label">{category.label}</span>
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          Für diesen Tag hat keine Station diesen Wert gemeldet.
        </p>
      </Card>
    )
  }

  const value = `${num(winner.value, category.decimals)} ${category.unit}`

  return (
    <Card className="relative overflow-hidden" padded={false}>
      <span className={`absolute inset-y-0 left-0 w-0.5 ${ACCENT_BAR[accent]}`} aria-hidden />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="label">{category.label}</span>
          <Icon className={`size-4 shrink-0 ${ACCENT_TEXT[accent]}`} aria-hidden />
        </div>

        <p className={`numeric mt-2 text-3xl font-semibold tracking-tight ${ACCENT_TEXT[accent]}`}>
          {value}
        </p>
        <p className="mt-1 truncate text-sm font-medium text-ink" title={winner.name}>
          {winner.name}
        </p>
        <p className="text-[11px] text-ink-faint">{place(winner)}</p>

        {/* Only shown when the mountains would otherwise hide the answer most
            people are after. */}
        {category.lowlandDiffers && lowland && (
          <div className="mt-3 rounded-md border border-line bg-raised px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Mountain className="size-3 shrink-0 text-ink-faint" aria-hidden />
              <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                unter {num(lowlandLimit, 0)} m
              </span>
            </div>
            <p className="numeric mt-1 text-sm font-semibold text-ink">
              {num(lowland.value, category.decimals)} {category.unit}
              <span className="ml-2 font-normal text-ink-muted">{lowland.name}</span>
            </p>
            <p className="text-[11px] text-ink-faint">{place(lowland)}</p>
          </div>
        )}

        {chasers.length > 0 && (
          <ol className="mt-3 space-y-1 border-t border-line pt-3">
            {chasers.map((rank, i) => (
              <li key={rank.station_id} className="flex items-baseline gap-2 text-[11px]">
                <span className="w-3 shrink-0 text-ink-faint">{i + 2}.</span>
                <span className="numeric w-16 shrink-0 text-ink-muted">
                  {num(rank.value, category.decimals)} {category.unit}
                </span>
                <span className="truncate text-ink-faint" title={rank.name}>
                  {rank.name}
                </span>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-3 text-[10px] text-ink-faint">
          aus {num(category.all.count, 0)} Stationen
        </p>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export function Germany() {
  const [date, setDate] = useState<string | null>(null)
  const { data, loading, error } = useApi<GermanyResponse>(
    `/api/germany${date ? `?date=${date}` : ''}`,
    [date],
  )

  // The date list only changes when the archive grows, but the response is
  // replaced on every navigation — keeping the last known list stops the
  // selector from flickering empty between days.
  const dates = useMemo(() => data?.dates ?? [], [data])
  const day = data?.day ?? null
  const current = day?.date ?? null
  const at = current ? dates.indexOf(current) : -1
  // The list runs newest first, so "older" means a higher index.
  const older = at >= 0 && at < dates.length - 1 ? dates[at + 1] : null
  const newer = at > 0 ? dates[at - 1] : null

  if (loading && !data) return <Loading message="Deutschlandwerte werden geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  if (!day) {
    return (
      <Card>
        <SectionHeading icon={Map} title="Deutschland gestern" />
        <p className="text-sm text-ink-muted">
          {data.hint ?? 'Noch keine Deutschlandwerte im Archiv.'}
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <InfoPanel title="Deutschland gestern">
        <p>
          Die Spitzenreiter aller DWD-Stationen für einen einzelnen Tag. Der DWD
          veröffentlicht seine Tageswerte ausschließlich als ein Archiv je
          Station; dieses Projekt holt sie täglich zusammen und legt sie ab, weil
          die Quellen selbst nur rund 500 Tage vorhalten.
        </p>
        <p>
          Zwei Wertungen stehen nebeneinander: ganz Deutschland und alles
          unterhalb von {num(day.lowlandLimit, 0)} m. Ohne die zweite hieße die
          Antwort auf „wo war es am kältesten" praktisch jeden Tag Zugspitze und
          auf „wo war es am windigsten" Brocken.
        </p>
        <p>
          Temperatur und Wind stammen aus dem Klimanetz, Niederschlag zusätzlich
          aus dem dichteren reinen Niederschlagsnetz — Starkregen ist
          kleinräumig, und mit den Klimastationen allein wird der Tageshöchstwert
          regelmäßig verfehlt. Die Sonnenscheindauer bleibt unbewertet: der DWD
          misst sie nur an rund 70 Stationen.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={Map}
          title={`Spitzenreiter am ${isoToGerman(day.date)}`}
          hint={`Archiv: ${num(data.range.days, 0)} Tage, ${isoToGerman(
            data.range.first,
          )} bis ${isoToGerman(data.range.last)}.`}
          actions={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!older}
                onClick={() => older && setDate(older)}
                aria-label="Vorheriger Tag"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <select
                value={current ?? ''}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Tag auswählen"
                className="cursor-pointer rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-ink"
              >
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {isoToGerman(d)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!newer}
                onClick={() => newer && setDate(newer)}
                aria-label="Nächster Tag"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          }
        />

        <StatGrid>
          <StatTile
            label="Stationen an diesem Tag"
            value={num(day.stations.total, 0)}
            caption="mit mindestens einem gültigen Messwert"
            accent="brand"
          />
          <StatTile
            label="Klimastationen"
            value={num(day.stations.byNetwork.kl, 0)}
            caption="Temperatur, Wind, Niederschlag"
            accent="warm"
          />
          <StatTile
            label="Niederschlagsstationen"
            value={num(day.stations.byNetwork.rr, 0)}
            caption="nur Niederschlag und Schnee"
            accent="wet"
          />
          <StatTile
            label={`unter ${num(day.lowlandLimit, 0)} m`}
            value={num(day.stations.lowland, 0)}
            caption={
              day.highestStation
                ? `höchste Station: ${day.highestStation.name}, ${num(
                    day.highestStation.elevation,
                    0,
                  )} m`
                : undefined
            }
            accent="neutral"
          />
        </StatGrid>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {day.categories.map((category) => (
          <CategoryCard
            key={category.key}
            category={category}
            lowlandLimit={day.lowlandLimit}
          />
        ))}
      </div>
    </div>
  )
}
