import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Search, Table2 } from 'lucide-react'

import { useApi } from '../lib/api'
import { count, mm, temp } from '../lib/format'
import type { AnnualOverviewRecord } from '../types'
import {
  Card,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SearchInput,
  SortHeader,
  Toggle,
} from './ui'

/**
 * Column definitions replace the original's 28-branch `switch` inside the sort
 * comparator, which duplicated the observed/forecast field pairing for every
 * single column and was the most error-prone block in the app.
 */
interface Column {
  key: string
  label: string
  title?: string
  observed: keyof AnnualOverviewRecord
  forecast?: keyof AnnualOverviewRecord
  render: (value: number | null) => ReactNode
  className?: string
  emphasis?: boolean
}

const COLUMNS: Column[] = [
  {
    key: 'min_temp',
    label: 'Min. Temp.',
    observed: 'min_temp',
    forecast: 'forecast_min_temp',
    render: (v) => temp(v),
    className: 'text-cool',
  },
  {
    key: 'max_temp',
    label: 'Max. Temp.',
    observed: 'max_temp',
    forecast: 'forecast_max_temp',
    render: (v) => temp(v),
    className: 'text-warm',
  },
  {
    key: 'coldest_day_mean',
    label: 'Kältester Tag (Ø)',
    observed: 'coldest_day_mean',
    forecast: 'forecast_coldest_day_mean',
    render: (v) => temp(v),
    className: 'text-cold',
  },
  {
    key: 'warmest_day_mean',
    label: 'Wärmster Tag (Ø)',
    observed: 'warmest_day_mean',
    forecast: 'forecast_warmest_day_mean',
    render: (v) => temp(v),
    className: 'text-hot',
  },
  {
    key: 'avg_temp',
    label: 'Ø Temperatur',
    observed: 'avg_temp',
    forecast: 'forecast_avg_temp',
    render: (v) => temp(v, 2),
    className: 'text-ink font-semibold',
    emphasis: true,
  },
  {
    key: 'precip_sum',
    label: 'Niederschlag',
    observed: 'precip_sum',
    forecast: 'forecast_precip_sum',
    render: (v) => mm(v),
    className: 'text-wet font-semibold',
    emphasis: true,
  },
  {
    key: 'days_max_above_30',
    label: 'Max > 30 °C',
    title: 'Heiße Tage — Tagesmaximum über 30 °C',
    observed: 'days_max_above_30',
    forecast: 'forecast_days_max_above_30',
    render: count,
    className: 'text-warm',
  },
  {
    key: 'days_max_above_25',
    label: 'Max > 25 °C',
    title: 'Sommertage — Tagesmaximum über 25 °C',
    observed: 'days_max_above_25',
    forecast: 'forecast_days_max_above_25',
    render: count,
    className: 'text-hot',
  },
  {
    key: 'days_max_above_20',
    label: 'Max > 20 °C',
    observed: 'days_max_above_20',
    forecast: 'forecast_days_max_above_20',
    render: count,
  },
  {
    key: 'days_max_above_15',
    label: 'Max > 15 °C',
    observed: 'days_max_above_15',
    forecast: 'forecast_days_max_above_15',
    render: count,
  },
  {
    key: 'days_min_below_0',
    label: 'Min < 0 °C',
    title: 'Frosttage — Tagesminimum unter 0 °C',
    observed: 'days_min_below_0',
    forecast: 'forecast_days_min_below_0',
    render: count,
    className: 'text-cool',
  },
  {
    key: 'days_mean_below_0',
    label: 'Mittel < 0 °C',
    observed: 'days_mean_below_0',
    forecast: 'forecast_days_mean_below_0',
    render: count,
    className: 'text-cold',
  },
  {
    key: 'days_mean_above_20',
    label: 'Mittel > 20 °C',
    observed: 'days_mean_above_20',
    forecast: 'forecast_days_mean_above_20',
    render: count,
    className: 'text-warm',
  },
]

export function AnnualOverview({ stationId }: { stationId: string }) {
  const [sortKey, setSortKey] = useState('year')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [useForecast, setUseForecast] = useState(false)

  const { data, loading, error, reload } = useApi<AnnualOverviewRecord[]>(
    `/api/weather/annual-overview?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data ?? [], [data])

  /** Resolve a column for one row, honouring the forecast toggle. */
  function cellValue(row: AnnualOverviewRecord, column: Column): number | null {
    const useProjection = row.is_running_year && useForecast && column.forecast
    const raw = useProjection
      ? row[column.forecast as keyof AnnualOverviewRecord]
      : row[column.observed]
    return typeof raw === 'number' ? raw : null
  }

  const rows = useMemo(() => {
    const factor = direction === 'asc' ? 1 : -1
    const column = COLUMNS.find((c) => c.key === sortKey)

    return records
      .filter((r) => String(r.year).includes(search))
      .sort((a, b) => {
        if (!column) return factor * (a.year - b.year)
        // Missing values sort last in both directions instead of being
        // coerced to ±999, which in the original made "N/A" rank as the
        // coldest year on record.
        const av = cellValue(a, column)
        const bv = cellValue(b, column)
        if (av === null && bv === null) return b.year - a.year
        if (av === null) return 1
        if (bv === null) return -1
        return factor * (av - bv)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, search, sortKey, direction, useForecast])

  function toggleSort(key: string) {
    if (key === sortKey) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDirection('desc')
    }
  }

  if (loading) return <Loading message="Berechne Jahres-Klimakenndaten…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (records.length === 0) return <EmptyState message="Keine Jahresdaten vorhanden." />

  return (
    <>
      <InfoPanel icon={Table2} title="Klimatologische Jahresübersicht">
        Kenndaten für jedes Kalenderjahr im Datenbestand: Extremtemperaturen,
        Jahresmittel, Niederschlagssumme sowie die Anzahl der Schwellenwerttage
        (heiße Tage, Sommertage, Frosttage). Spaltenköpfe sind sortierbar.
      </InfoPanel>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            label="Jahr filtern"
            value={search}
            onChange={(v) => setSearch(v.replace(/\D/g, ''))}
            placeholder="Jahr filtern…"
            maxLength={4}
            icon={Search}
            className="lg:w-56"
          />
          <Toggle
            checked={useForecast}
            onChange={setUseForecast}
            label="Prognose für das laufende Jahr einrechnen"
            hint="Ersetzt die YTD-Werte des laufenden Jahres durch die Klimaprognose"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-raised">
                <SortHeader
                  label="Jahr"
                  active={sortKey === 'year'}
                  direction={direction}
                  onClick={() => toggleSort('year')}
                  className="sticky left-0 z-20 border-r border-line bg-raised"
                />
                {COLUMNS.map((c) => (
                  <SortHeader
                    key={c.key}
                    label={
                      <>
                        {c.label}
                        {useForecast && c.emphasis && (
                          <span className="ml-1 text-[9px] text-brand">PROG</span>
                        )}
                      </>
                    }
                    title={c.title}
                    active={sortKey === c.key}
                    direction={direction}
                    onClick={() => toggleSort(c.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((row) => {
                const projected = row.is_running_year && useForecast
                return (
                  <tr
                    key={row.year}
                    className={`group transition-colors hover:bg-raised ${row.is_running_year ? 'bg-brand/[0.04]' : ''}`}
                  >
                    <td className="numeric sticky left-0 z-10 border-r border-line bg-surface px-3 py-2.5 font-semibold text-ink group-hover:bg-raised">
                      <span className="flex items-center gap-1.5">
                        {row.year}
                        {row.is_running_year && (
                          <span
                            className={`rounded px-1 py-0.5 text-[9px] font-bold ${
                              projected
                                ? 'bg-hot/20 text-hot'
                                : 'bg-brand/20 text-brand'
                            }`}
                            title={
                              projected
                                ? 'Blended Climate Forecast'
                                : 'Year to Date — nur gemessene Tage'
                            }
                          >
                            {projected ? 'PROG' : 'YTD'}
                          </span>
                        )}
                      </span>
                    </td>
                    {COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={`numeric px-3 py-2.5 ${c.className ?? 'text-ink-muted'} ${c.emphasis ? 'bg-brand/[0.03]' : ''}`}
                      >
                        {c.render(cellValue(row, c))}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={COLUMNS.length + 1}
                    className="py-10 text-center text-xs text-ink-muted"
                  >
                    Keine Jahre gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
