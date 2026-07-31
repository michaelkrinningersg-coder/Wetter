import { useMemo, useState } from 'react'
import { Gauge, Search, Snowflake, Sun } from 'lucide-react'

import { useApi } from '../lib/api'
import { extremeBy } from '../lib/stats'
import { temp } from '../lib/format'
import type { YtdRecord, YtdResponse } from '../types'
import {
  Card,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SearchInput,
  SectionHeading,
  SortHeader,
  StatGrid,
  StatTile,
} from './ui'

type SortKey = 'year' | 'temp'

export function YtdTemp({ stationId }: { stationId: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('temp')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  const { data, loading, error, reload } = useApi<YtdResponse>(
    `/api/weather/ytd-temp?stationId=${encodeURIComponent(stationId)}`,
  )

  const records = useMemo(() => data?.records ?? [], [data])
  const cutOff = data?.cutOffDateStr ?? '—'

  const warmest = useMemo(() => extremeBy(records, (r) => r.avg_temp, 'max'), [records])
  const coldest = useMemo(() => extremeBy(records, (r) => r.avg_temp, 'min'), [records])

  const rows = useMemo(() => {
    const factor = direction === 'asc' ? 1 : -1
    const value = (r: YtdRecord) =>
      sortKey === 'year' ? r.year : (r.avg_temp ?? Number.NEGATIVE_INFINITY)
    return records
      .filter((r) => String(r.year).includes(search))
      .sort((a, b) => factor * (value(a) - value(b)))
  }, [records, search, sortKey, direction])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDirection('desc')
    }
  }

  if (loading) return <Loading message="Berechne YTD-Mitteltemperaturen…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (records.length === 0) return <EmptyState message="Keine YTD-Daten vorhanden." />

  return (
    <>
      <InfoPanel icon={Gauge} title={`Mitteltemperatur vom 1. Januar bis ${cutOff}`}>
        Alle Jahre werden auf denselben Stichtag beschnitten — den letzten Tag mit
        Messdaten in der Datenbank. Nur so ist der Vergleich des laufenden Jahres mit
        der Historie verzerrungsfrei (Year-to-Date).
      </InfoPanel>

      <StatGrid>
        <StatTile
          label="Wärmster Zeitraum"
          value={warmest ? String(warmest.year) : '—'}
          caption={warmest ? `${temp(warmest.avg_temp, 2)} · 01.01.–${cutOff}` : undefined}
          accent="warm"
          icon={Sun}
        />
        <StatTile
          label="Kältester Zeitraum"
          value={coldest ? String(coldest.year) : '—'}
          caption={coldest ? `${temp(coldest.avg_temp, 2)} · 01.01.–${cutOff}` : undefined}
          accent="cold"
          icon={Snowflake}
        />
      </StatGrid>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeading title={`${rows.length} Jahre im Vergleich`} />
          <SearchInput
            label="Jahr suchen"
            value={search}
            onChange={(v) => setSearch(v.replace(/\D/g, ''))}
            placeholder="Jahr suchen…"
            maxLength={4}
            icon={Search}
            className="sm:w-56"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-raised">
                <th scope="col" className="label px-3 py-2.5">Rang</th>
                <SortHeader
                  label="Jahr"
                  active={sortKey === 'year'}
                  direction={direction}
                  onClick={() => toggleSort('year')}
                />
                <SortHeader
                  label="Ø Temperatur"
                  active={sortKey === 'temp'}
                  direction={direction}
                  onClick={() => toggleSort('temp')}
                />
                <th scope="col" className="label px-3 py-2.5">Datenabdeckung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r, index) => (
                <tr key={r.year} className="group transition-colors hover:bg-raised">
                  <td className="px-3 py-2.5">
                    <span
                      className={`numeric inline-grid size-6 place-items-center rounded text-[10px] font-bold ${
                        index === 0 && sortKey === 'temp'
                          ? 'bg-brand text-canvas'
                          : 'bg-inset text-ink-faint'
                      }`}
                    >
                      {index + 1}
                    </span>
                  </td>
                  <td className="numeric px-3 py-2.5 font-semibold text-ink transition-colors group-hover:text-brand">
                    {r.year}
                  </td>
                  <td
                    className={`numeric px-3 py-2.5 font-semibold ${
                      r.year === warmest?.year
                        ? 'text-warm'
                        : r.year === coldest?.year
                          ? 'text-cold'
                          : 'text-ink'
                    }`}
                  >
                    {temp(r.avg_temp, 2)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="numeric text-[11px] text-ink-faint">
                        {r.valid_days} / {r.total_days}
                      </span>
                      <div
                        className="h-1.5 w-16 overflow-hidden rounded-full bg-inset"
                        role="img"
                        aria-label={`${Math.round((r.valid_days / (r.total_days || 1)) * 100)} % Abdeckung`}
                      >
                        <div
                          className={`h-full ${r.valid_days / (r.total_days || 1) > 0.9 ? 'bg-good' : 'bg-dry'}`}
                          style={{
                            width: `${Math.min(100, (r.valid_days / (r.total_days || 1)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-xs text-ink-muted">
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
