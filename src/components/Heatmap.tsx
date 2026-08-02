import { useMemo, useState } from 'react'
import { Grid3x3, Search } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { percentile } from '../lib/stats'
import { MONTHS_SHORT, monthName, temp } from '../lib/format'
import type { HeatmapRecord, HeatmapResponse } from '../types'
import {
  Card,
  ChoiceGroup,
  ErrorState,
  InfoPanel,
  Loading,
  SearchInput,
  SectionHeading,
} from './ui'

const DECADES = [
  { value: 'all', label: 'Gesamt' },
  { value: '2020', label: '2020er' },
  { value: '2010', label: '2010er' },
  { value: '2000', label: '2000er' },
  { value: '1990', label: '1990er' },
  { value: '1980', label: '1980er' },
  { value: '1970', label: '1970er' },
  { value: '1960', label: '1960er' },
  { value: 'pre-1960', label: 'Vor 1960' },
] as const

type Decade = (typeof DECADES)[number]['value']

interface Scale {
  p20: number
  p80: number
}

const COLD_HUE = 255
const WARM_HUE = 25

/**
 * Diverging cold→neutral→warm ramp, scaled to the month's own 20–80 percentile.
 *
 * Hue is pinned per half and only chroma varies, so mid-range values read as
 * genuinely neutral. The original lerped raw RGB from blue to amber, which
 * passes through muddy olive tones and made "near average" look like its own
 * category rather than the middle of a scale.
 */
function tileColor(value: number | null, scale: Scale | undefined): string {
  if (value === null || !scale) return 'oklch(22% 0.006 260)'

  const span = scale.p80 - scale.p20
  const t = span === 0 ? 0.5 : Math.max(0, Math.min(1, (value - scale.p20) / span))

  if (t < 0.5) {
    const k = t * 2 // 0 = coldest, 1 = neutral
    return `oklch(${44 + k * 8}% ${0.15 - k * 0.13} ${COLD_HUE})`
  }
  const k = (t - 0.5) * 2 // 0 = neutral, 1 = warmest
  return `oklch(${52 - k * 6}% ${0.02 + k * 0.16} ${WARM_HUE})`
}

export function Heatmap({ stationId }: { stationId: string }) {
  const [decade, setDecade] = useUrlState<Decade>('jahrzehnt', 'all')
  const [search, setSearch] = useState('')

  const { data, loading, error, reload } = useApi<HeatmapResponse>(
    `/api/weather/heatmap?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data?.records ?? [], [data])
  const minMonthDays = data?.minMonthDays ?? 25

  /** Per-month 20/80 percentiles, so January is coloured against Januarys. */
  const scales = useMemo(() => {
    const result: Record<number, Scale> = {}
    for (let month = 1; month <= 12; month++) {
      const values = records
        .filter((r) => r.month === month && r.rated && r.avg_temp !== null)
        .map((r) => r.avg_temp as number)
        .sort((a, b) => a - b)
      const p20 = percentile(values, 0.2)
      const p80 = percentile(values, 0.8)
      if (p20 !== null && p80 !== null) result[month] = { p20, p80 }
    }
    return result
  }, [records])

  const byYear = useMemo(() => {
    const map = new Map<number, Map<number, HeatmapRecord>>()
    for (const r of records) {
      let row = map.get(r.year)
      if (!row) {
        row = new Map()
        map.set(r.year, row)
      }
      row.set(r.month, r)
    }
    return map
  }, [records])

  const visibleYears = useMemo(() => {
    const years = [...byYear.keys()].sort((a, b) => b - a)
    return years.filter((year) => {
      if (search && !String(year).includes(search)) return false
      if (decade === 'all') return true
      if (decade === 'pre-1960') return year < 1960
      const start = Number(decade)
      return year >= start && year <= start + 9
    })
  }, [byYear, decade, search])

  if (loading) return <Loading message="Berechne Monats-Heatmap…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <InfoPanel icon={Grid3x3} title="Klimatologische Monats-Heatmap">
        Jeder Monat wird gegen dieselben Monate aller anderen Jahre eingefärbt — Januar
        also gegen Januar. Die Farbskala läuft je Monat vom{' '}
        <strong>20. bis zum 80. Perzentil</strong>, damit einzelne Ausreißer die
        Skalierung nicht dominieren. <strong>R</strong> ist der Wärmerang des Monats in
        der gesamten Messreihe (R 1 = wärmster je gemessener Monat dieses Namens).{' '}
        <strong>Schraffierte Felder</strong> sind Monate, die zwar gemessen wurden,
        aber weniger als {minMonthDays} gültige Tage haben — ihr Mittel steht da,
        ein Rang wäre nicht vergleichbar. Sie zählen auch nicht in die Skala.
      </InfoPanel>

      <Card>
        <SectionHeading
          title="Filter"
          actions={
            <SearchInput
              label="Jahr suchen"
              value={search}
              onChange={(v) => {
                setSearch(v.replace(/\D/g, ''))
                setDecade('all')
              }}
              placeholder="z. B. 2003"
              maxLength={4}
              icon={Search}
              className="w-40"
            />
          }
        />
        <ChoiceGroup
          label="Jahrzehnt"
          value={decade}
          choices={DECADES}
          onChange={(v) => {
            setDecade(v)
            setSearch('')
          }}
          size="sm"
        />
      </Card>

      <Card padded={false}>
        <div className="overflow-x-auto p-4 sm:p-5">
          <div className="min-w-[900px]">
            <div className="mb-2 grid grid-cols-[64px_repeat(12,1fr)] gap-1.5">
              <span className="label self-end">Jahr</span>
              {MONTHS_SHORT.map((m) => (
                <span key={m} className="label border-b border-line pb-1 text-center">
                  {m}
                </span>
              ))}
            </div>

            <div className="max-h-[620px] space-y-1.5 overflow-y-auto pr-1">
              {visibleYears.length === 0 ? (
                <p className="py-12 text-center text-xs text-ink-muted">
                  Keine Jahre für diese Filter gefunden.
                </p>
              ) : (
                visibleYears.map((year) => {
                  const row = byYear.get(year)
                  return (
                    <div
                      key={year}
                      className="group grid grid-cols-[64px_repeat(12,1fr)] items-center gap-1.5"
                    >
                      <span className="numeric text-xs font-semibold text-ink-muted transition-colors group-hover:text-brand">
                        {year}
                      </span>
                      {Array.from({ length: 12 }, (_, i) => {
                        const month = i + 1
                        const cell = row?.get(month)
                        const value = cell?.avg_temp ?? null
                        // A month that was measured but is too sparse to place
                        // gets its own look: hatched, value shown, no rank. The
                        // previous version left it blank, which read as "never
                        // measured" when the truth is "measured, with gaps".
                        const sparse = Boolean(cell) && !cell!.rated

                        return (
                          <div
                            key={month}
                            style={
                              sparse
                                ? {
                                    backgroundImage:
                                      'repeating-linear-gradient(135deg, oklch(38% 0.01 260) 0 4px, oklch(28% 0.008 260) 4px 8px)',
                                  }
                                : { backgroundColor: tileColor(value, scales[month]) }
                            }
                            className="grid h-12 place-content-center rounded border border-canvas/40 text-center"
                            title={
                              cell && sparse
                                ? `${monthName(month)} ${year}: ${temp(value, 2)} aus ${cell.validDays} von ${cell.days} Tagen — für eine Einordnung sind ${minMonthDays} nötig, deshalb ohne Rang`
                                : value !== null && cell
                                  ? `${monthName(month)} ${year}: ${temp(value, 2)} — Rang ${cell.rank} von ${cell.total_years_for_month}`
                                  : `${monthName(month)} ${year}: keine Daten`
                            }
                          >
                            {value !== null && cell ? (
                              <>
                                <span
                                  className={`numeric text-[11px] font-bold drop-shadow ${
                                    sparse ? 'text-ink-muted' : 'text-white'
                                  }`}
                                >
                                  {value.toFixed(1)}°
                                </span>
                                <span
                                  className={`numeric text-[9px] font-semibold ${
                                    sparse ? 'text-ink-faint' : 'text-white/85'
                                  }`}
                                >
                                  {sparse ? `${cell.validDays}/${cell.days} d` : `R ${cell.rank}`}
                                </span>
                              </>
                            ) : (
                              <span className="text-[10px] text-ink-faint">—</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>

            {/* The original had no legend at all, so the colour ramp was
                uninterpretable without reading the intro paragraph. */}
            <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
              <span className="label">kälter</span>
              <div
                className="h-2 flex-1 rounded"
                style={{
                  backgroundImage: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
                    .map((t) => tileColor(t, { p20: 0, p80: 1 }))
                    .join(', ')})`,
                }}
                aria-hidden
              />
              <span className="label">wärmer</span>
              <span className="label ml-2">je Monat, 20.–80. Perzentil</span>
            </div>
          </div>
        </div>
      </Card>
    </>
  )
}
