import { useMemo, useState } from 'react'
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
import { CalendarDays, Grid3x3 } from 'lucide-react'

import { useApi } from '../lib/api'
import { useTheme } from '../lib/theme'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf, year } from '../lib/format'
import { RAMPS, ramp } from '../lib/ramps'
import type { RecordCalendarField, RecordCalendarResponse } from '../types'
import {
  CHART,
  Card,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** The most recent thirty years, the span this project uses for every comparison. */
const RECENT = 30

function value(field: RecordCalendarField, v: number): string {
  if (field.unit === 'm/s') return `${num(v * 3.6, 0)} km/h`
  return `${num(v, field.decimals)} ${field.unit}`
}

interface Tile {
  key: string
  month: number
  day: number
  value: number
  year: number
  observations: number
}

export function RecordCalendar({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [theme] = useTheme()
  const [fieldKey, setFieldKey] = useUrlState<string>('groesse', 'temp_max_high')
  const [hover, setHover] = useState<Tile | null>(null)
  const { data, loading, error } = useApi<RecordCalendarResponse>(
    `/api/weather/record-calendar?stationId=${stationId}`,
    [stationId],
  )

  const field = data?.fields.find((f) => f.key === fieldKey) ?? data?.fields[0] ?? null

  const tiles = useMemo(() => {
    if (!data || !field) return []
    const out: Tile[] = []
    for (let i = 0; i < data.days.length; i++) {
      const entry = field.entries[i]
      if (!entry) continue
      const key = data.days[i]!
      out.push({
        key,
        month: Number(key.slice(0, 2)),
        day: Number(key.slice(3)),
        value: entry[0],
        year: entry[1],
        observations: entry[2],
      })
    }
    return out
  }, [data, field])

  // A lookup rather than a scan: the grid asks 372 times and a `find` over 366
  // tiles each time is 136,000 comparisons for a table nobody notices.
  const byKey = useMemo(() => new Map(tiles.map((t) => [t.key, t])), [tiles])

  const decades = useMemo(() => {
    const counts = new Map<number, number>()
    for (const tile of tiles) {
      const decade = Math.floor(tile.year / 10) * 10
      counts.set(decade, (counts.get(decade) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([decade, days]) => ({ decade, days, share: days / Math.max(1, tiles.length) }))
  }, [tiles])

  if (loading && !data) return <Loading message="Rekordkalender wird gerechnet …" />
  if (error) return <ErrorState message={error} />
  if (!data || !field) return null

  const lastYear = Number(data.last.slice(0, 4))
  const from = field.minYear ?? lastYear
  const to = field.maxYear ?? lastYear
  const colours = RAMPS[theme].time
  const colourFor = (year: number) => ramp(colours, to > from ? (year - from) / (to - from) : 1)

  const recent = tiles.filter((t) => t.year > lastYear - RECENT).length
  const first30 = tiles.filter((t) => t.year <= from + RECENT).length
  const legendStops = Array.from({ length: 6 }, (_, i) => from + ((to - from) * i) / 5)

  return (
    <div className="space-y-6">
      <InfoPanel title={`Der Rekordkalender von ${stationName}`}>
        <p>
          Für jeden der 366 Kalendertage steht hier, aus welchem Jahr sein
          Rekord stammt — eine Kachel je Tag, eingefärbt nach dem Jahr. Ein
          einzelner Allzeitrekord ist ein Zufall, 366 Tagesrekorde sind eine
          Verteilung, und diese Verteilung ist bei warmen und kalten Größen
          sichtbar verschieden.
        </p>
        <p>
          Der 29. Februar steht mit in der Liste. Er hat ein Viertel der
          Messungen der übrigen Tage, sein Rekord ist damit leichter zu halten
          und schwerer zu brechen; die Zahl der Messungen steht in jedem
          Kachel-Hinweis, statt ihn stillschweigend gleichrangig zu zeigen.
        </p>
      </InfoPanel>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Grid3x3}
            title="366 Kacheln"
            hint="Zeile für Zeile ein Monat, Spalte für Spalte ein Tag. Die Farbe ist das Jahr des Rekords."
          />
          <ChoiceGroup
            label="Größe"
            value={field.key}
            choices={data.fields.map((f) => ({ value: f.key, label: f.short, title: f.label }))}
            onChange={setFieldKey}
            size="sm"
          />
        </div>

        {field.note && <p className="mt-3 text-[11px] text-ink-faint">{field.note}</p>}

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[660px]">
            <div className="flex gap-[3px] pl-8">
              {Array.from({ length: 31 }, (_, i) => (
                <span
                  key={i}
                  className="w-[18px] text-center text-[9px] text-ink-faint"
                  aria-hidden
                >
                  {(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}
                </span>
              ))}
            </div>

            {MONTHS.map((label, monthIndex) => (
              <div key={label} className="mt-[3px] flex items-center gap-[3px]">
                <span className="w-8 shrink-0 text-[10px] text-ink-muted">{label}</span>
                {Array.from({ length: 31 }, (_, dayIndex) => {
                  const tile = byKey.get(
                    `${String(monthIndex + 1).padStart(2, '0')}-${String(dayIndex + 1).padStart(2, '0')}`,
                  )
                  if (!tile) {
                    return (
                      <span
                        key={dayIndex}
                        className="h-[18px] w-[18px] rounded-[3px]"
                        style={{ background: 'var(--color-tile-empty)' }}
                        aria-hidden
                      />
                    )
                  }
                  return (
                    <span
                      key={dayIndex}
                      className="h-[18px] w-[18px] cursor-default rounded-[3px] transition-transform hover:scale-125"
                      style={{ background: colourFor(tile.year) }}
                      onMouseEnter={() => setHover(tile)}
                      onMouseLeave={() => setHover(null)}
                      title={`${tile.day}. ${label} ${tile.year}: ${value(field, tile.value)}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-[240px]">
            <p className="label mb-2">Jahr des Rekords</p>
            <div className="flex h-4 w-full max-w-[300px] overflow-hidden rounded">
              {colours.map((c) => (
                <span key={c} className="flex-1" style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="mt-1 flex w-full max-w-[300px] justify-between text-[10px] text-ink-faint">
              {legendStops.map((stop) => (
                <span key={stop} className="numeric">
                  {year(stop)}
                </span>
              ))}
            </div>
          </div>

          <div className="min-h-[52px] min-w-[260px] rounded-card border border-line bg-raised px-3 py-2">
            {hover ? (
              <>
                <p className="text-xs font-semibold text-brand">
                  {hover.day}. {MONTHS[hover.month - 1]} — Rekord von {hover.year}
                </p>
                <p className="numeric mt-0.5 text-sm text-ink">{value(field, hover.value)}</p>
                <p className="text-[10px] text-ink-faint">
                  aufgestellt am{' '}
                  {isoToGerman(`${hover.year}-${hover.key}`)} · dieser Kalendertag wurde{' '}
                  {num(hover.observations, 0)}-mal gemessen
                </p>
              </>
            ) : (
              <p className="text-[11px] text-ink-faint">
                Zeiger über eine Kachel halten zeigt Wert, Datum und wie oft dieser
                Kalendertag überhaupt gemessen wurde.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <StatGrid>
        <StatTile
          label="Rekorde der letzten 30 Jahre"
          value={shareOf(recent / Math.max(1, tiles.length))}
          caption={`${num(recent, 0)} von ${num(tiles.length, 0)} Kalendertagen — ab ${year(lastYear - RECENT + 1)}`}
          accent={field.warm === false ? 'cold' : 'hot'}
          icon={CalendarDays}
        />
        <StatTile
          label="Rekorde der ersten 30 Jahre"
          value={shareOf(first30 / Math.max(1, tiles.length))}
          caption={`${num(first30, 0)} Kalendertage — bis ${year(from + RECENT)}`}
          accent="neutral"
        />
        <StatTile
          label="Ältester Tagesrekord"
          value={year(field.minYear)}
          caption={`jüngster ${year(field.maxYear)}`}
          accent="neutral"
        />
        <StatTile
          label="Belegte Kalendertage"
          value={`${num(field.covered, 0)} von 366`}
          caption={`Messreihe seit ${field.first.slice(0, 4)}`}
          accent="brand"
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={CalendarDays}
          title="Aus welchen Jahrzehnten die Rekorde stammen"
          hint="Dieselben 366 Kacheln, nach Jahrzehnt gezählt."
        />

        <div className="mt-4">
          <ChartFrame height={260}>
            <ResponsiveContainer>
              <BarChart data={decades} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="decade"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => `${v}er`}
                  minTickGap={16}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={44}
                  tickFormatter={(v: number) => num(v, 0)}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof decades)[number]
                    return (
                      <ChartTooltip
                        title={`${row.decade}er Jahre`}
                        rows={[
                          { label: 'Tagesrekorde', value: num(row.days, 0) },
                          { label: 'Anteil', value: shareOf(row.share, 1) },
                        ]}
                        footer="Ein Jahrzehnt hat 3.652 Tage und 366 Kalendertage zu vergeben."
                      />
                    )
                  }}
                />
                <Bar dataKey="days" radius={[3, 3, 0, 0]}>
                  {decades.map((row) => (
                    <Cell key={row.decade} fill={colourFor(row.decade + 5)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
          Wären die Rekorde gleichmäßig über die Reihe verteilt, stünden auf
          jedem Jahrzehnt rund{' '}
          <span className="numeric">
            {num(tiles.length / Math.max(1, decades.length), 0)}
          </span>{' '}
          Kalendertage. Das ist die Nulllinie im Kopf — nicht als Strich
          gezeichnet, weil die Erwartung in Wahrheit fällt: je später ein
          Jahrzehnt, desto mehr frühere Werte muss es schlagen. Ein spätes
          Jahrzehnt über dem Durchschnitt wiegt also mehr als ein frühes.
        </p>
      </Card>
    </div>
  )
}
