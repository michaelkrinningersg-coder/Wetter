import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Building2, Car, Clock, Factory, Sun, TrendingDown, Wind } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { MONTHS_SHORT, isoToGerman, num, percent } from '../lib/format'
import { linearFit } from '../lib/stats'
import type {
  AirComponent,
  AirOverviewResponse,
  AirProfilesResponse,
  AirStationProfile,
} from '../types'
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

/** Background and roadside get one colour each, kept the same in every chart. */
const STATION_COLOR: Record<string, string> = {
  background: CHART.colors.cool,
  traffic: CHART.colors.warm,
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function value(v: number | null | undefined, component: AirComponent): string {
  if (v === null || v === undefined) return '—'
  return `${num(v, component.decimals)} ${component.unit}`
}

/* -------------------------------------------------------------------------- */
/* Diurnal profile                                                            */
/* -------------------------------------------------------------------------- */

function DiurnalChart({
  series,
  component,
  season,
}: {
  series: AirStationProfile[]
  component: AirComponent
  season: string
}) {
  const rows = useMemo(() => {
    const byHour = new Map<number, Record<string, number>>()
    for (let hour = 0; hour < 24; hour++) byHour.set(hour, { hour })

    for (const station of series) {
      const points =
        season === 'all'
          ? station.diurnal
          : (station.bySeason.find((s) => s.key === season)?.points ?? [])
      for (const point of points) {
        const row = byHour.get(point.hour)
        if (row) row[station.station] = point.mean
      }
    }
    return [...byHour.values()]
  }, [series, season])

  return (
    <ChartFrame height={340}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="hour"
            stroke={CHART.axis}
            tick={CHART.tick}
            tickFormatter={(h: number) => `${String(h).padStart(2, '0')}`}
            interval={1}
          />
          <YAxis
            stroke={CHART.axis}
            tick={CHART.tick}
            width={48}
            label={{
              value: component.unit,
              angle: -90,
              position: 'insideLeft',
              fill: CHART.axis,
              fontSize: 11,
            }}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltip
                  title={`${String(label).padStart(2, '0')}:00 Uhr`}
                  rows={payload.map((p) => ({
                    label: series.find((s) => s.station === p.dataKey)?.name ?? String(p.dataKey),
                    value: value(p.value as number, component),
                    className: 'text-ink',
                  }))}
                />
              ) : null
            }
          />
          {series.map((station) => (
            <Line
              key={station.station}
              type="monotone"
              dataKey={station.station}
              stroke={STATION_COLOR[station.kind] ?? CHART.colors.neutral}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------------------- */
/* Profiles panel                                                             */
/* -------------------------------------------------------------------------- */

const SEASON_CHOICES = [
  { value: 'all', label: 'Ganzes Jahr' },
  { value: 'winter', label: 'Winter' },
  { value: 'spring', label: 'Frühling' },
  { value: 'summer', label: 'Sommer' },
  { value: 'autumn', label: 'Herbst' },
] as const

function Profiles({ componentKey }: { componentKey: string }) {
  const [season, setSeason] = useUrlState<string>('saison', 'all', {
    allowed: SEASON_CHOICES.map((c) => c.value),
  })
  const { data, loading, error } = useApi<AirProfilesResponse>(
    `/api/air/profiles?component=${componentKey}`,
    [componentKey],
  )

  if (loading && !data) return <Loading message="Tagesgang wird berechnet …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { component, series } = data

  const weekdayRows = WEEKDAYS.map((label, index) => {
    const row: Record<string, string | number> = { label }
    for (const station of series) {
      const point = station.weekday.find((w) => w.weekday === index)
      if (point) row[station.station] = point.mean
    }
    return row
  })

  const monthRows = MONTHS_SHORT.map((label, index) => {
    const row: Record<string, string | number> = { label }
    for (const station of series) {
      const point = station.monthly.find((m) => m.month === index + 1)
      if (point) row[station.station] = point.mean
    }
    return row
  })

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Clock}
            title={`Tagesgang — ${component.label}`}
            hint="Mittel über alle Stunden des Archivs, je Uhrzeit. Zeitangaben wie vom UBA veröffentlicht."
          />
          <ChoiceGroup
            label="Jahreszeit"
            value={season}
            choices={SEASON_CHOICES}
            onChange={setSeason}
            size="sm"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-4">
          {series.map((station) => (
            <span key={station.station} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="size-2.5 rounded-full"
                style={{ background: STATION_COLOR[station.kind] }}
                aria-hidden
              />
              <span className="text-ink">{station.name}</span>
              <span className="text-ink-faint">{station.kindLabel}</span>
            </span>
          ))}
        </div>

        <div className="mt-4">
          <DiurnalChart series={series} component={component} season={season} />
        </div>

        <ul className="mt-4 space-y-1 border-t border-line pt-3">
          {series.map((station) => {
            const points =
              season === 'all'
                ? station.diurnal
                : (station.bySeason.find((s) => s.key === season)?.points ?? [])
            if (points.length === 0) return null
            const high = points.reduce((a, b) => (b.mean > a.mean ? b : a))
            const low = points.reduce((a, b) => (b.mean < a.mean ? b : a))
            return (
              <li key={station.station} className="text-[11px] text-ink-muted">
                <span className="text-ink">{station.name}</span>: Höchstwert um{' '}
                <span className="numeric text-ink">
                  {String(high.hour).padStart(2, '0')}:00
                </span>{' '}
                mit {value(high.mean, component)}, Tiefstwert um{' '}
                <span className="numeric text-ink">{String(low.hour).padStart(2, '0')}:00</span>{' '}
                mit {value(low.mean, component)} — eine Spanne von{' '}
                {value(high.mean - low.mean, component)}.
              </li>
            )
          })}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeading
            icon={Car}
            title="Wochentage"
            hint="Tagesmittel nach Wochentag. Was am Wochenende abfällt, stammt aus dem Werktagsbetrieb."
          />
          <div className="mt-4">
            <ChartFrame height={260}>
              <ResponsiveContainer>
                <BarChart data={weekdayRows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={CHART.axis} tick={CHART.tick} />
                  <YAxis stroke={CHART.axis} tick={CHART.tick} width={44} />
                  <Tooltip
                    cursor={{ fill: 'oklch(28% 0.008 260 / 0.4)' }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <ChartTooltip
                          title={String(label)}
                          rows={payload.map((p) => ({
                            label:
                              series.find((s) => s.station === p.dataKey)?.name ??
                              String(p.dataKey),
                            value: value(p.value as number, component),
                          }))}
                        />
                      ) : null
                    }
                  />
                  {series.map((station) => (
                    <Bar
                      key={station.station}
                      dataKey={station.station}
                      fill={STATION_COLOR[station.kind] ?? CHART.colors.neutral}
                      radius={[3, 3, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </div>
        </Card>

        <Card>
          <SectionHeading
            icon={Sun}
            title="Jahresverlauf"
            hint="Tagesmittel nach Monat, über den ganzen Bestand gemittelt."
          />
          <div className="mt-4">
            <ChartFrame height={260}>
              <ResponsiveContainer>
                <AreaChart data={monthRows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={CHART.axis} tick={CHART.tick} />
                  <YAxis stroke={CHART.axis} tick={CHART.tick} width={44} />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <ChartTooltip
                          title={String(label)}
                          rows={payload.map((p) => ({
                            label:
                              series.find((s) => s.station === p.dataKey)?.name ??
                              String(p.dataKey),
                            value: value(p.value as number, component),
                          }))}
                        />
                      ) : null
                    }
                  />
                  {series.map((station) => (
                    <Area
                      key={station.station}
                      type="monotone"
                      dataKey={station.station}
                      stroke={STATION_COLOR[station.kind] ?? CHART.colors.neutral}
                      fill={STATION_COLOR[station.kind] ?? CHART.colors.neutral}
                      fillOpacity={0.12}
                      strokeWidth={2}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </ChartFrame>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Annual trend                                                               */
/* -------------------------------------------------------------------------- */

function AnnualTrend({
  data,
  componentKey,
}: {
  data: AirOverviewResponse
  componentKey: string
}) {
  const component = data.components.find((c) => c.key === componentKey)
  const series = data.annual.filter((a) => a.component === componentKey)
  if (!component || series.length === 0) return null

  const yearLimit = component.limits.find((l) => l.stat === 'year_mean')

  const years = new Set<number>()
  for (const s of series) for (const p of s.points) years.add(p.year)

  const rows = [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const row: Record<string, number | null> = { year }
      for (const s of series) {
        row[s.station] = s.points.find((p) => p.year === year)?.mean ?? null
      }
      return row
    })

  return (
    <Card>
      <SectionHeading
        icon={TrendingDown}
        title={`Jahresmittel — ${component.label}`}
        hint={`Nur Jahre mit mindestens ${data.minDaysForYear} gültigen Tagen; das laufende Jahr fehlt deshalb noch.`}
      />

      <div className="mt-4">
        <ChartFrame height={300}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} />
              <YAxis
                stroke={CHART.axis}
                tick={CHART.tick}
                width={48}
                domain={[0, 'auto']}
                label={{
                  value: component.unit,
                  angle: -90,
                  position: 'insideLeft',
                  fill: CHART.axis,
                  fontSize: 11,
                }}
              />
              {yearLimit && (
                <ReferenceLine
                  y={yearLimit.value}
                  stroke={CHART.colors.hot}
                  strokeDasharray="5 4"
                  label={{
                    value: `Grenzwert ${yearLimit.value}`,
                    fill: CHART.colors.hot,
                    fontSize: 10,
                    position: 'insideTopRight',
                  }}
                />
              )}
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <ChartTooltip
                      title={String(label)}
                      rows={payload.map((p) => ({
                        label:
                          data.stations.find((s) => s.id === p.dataKey)?.name ?? String(p.dataKey),
                        value: value(p.value as number, component),
                      }))}
                    />
                  ) : null
                }
              />
              {series.map((s) => {
                const station = data.stations.find((x) => x.id === s.station)
                return (
                  <Line
                    key={s.station}
                    type="monotone"
                    dataKey={s.station}
                    stroke={STATION_COLOR[station?.kind ?? ''] ?? CHART.colors.neutral}
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    connectNulls
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <ul className="mt-4 space-y-1 border-t border-line pt-3">
        {series.map((s) => {
          const station = data.stations.find((x) => x.id === s.station)
          const complete = s.points.filter((p) => p.complete && p.mean !== null)
          if (complete.length < 3) return null

          const fit = linearFit(complete.map((p) => ({ x: p.year, y: p.mean as number })))
          const first = complete[0]!
          const last = complete.at(-1)!
          const change = (last.mean as number) - (first.mean as number)

          return (
            <li key={s.station} className="text-[11px] text-ink-muted">
              <span className="text-ink">{station?.name}</span>: {first.year}{' '}
              {value(first.mean, component)} → {last.year} {value(last.mean, component)} (
              <span className={change < 0 ? 'text-good' : 'text-hot'}>
                {change < 0 ? '−' : '+'}
                {num(Math.abs(change), component.decimals)} {component.unit},{' '}
                {percent(Math.abs(change) / (first.mean as number))}
              </span>
              )
              {fit && (
                <>
                  {' '}
                  · Trend {num(fit.slope * 10, component.decimals + 1)} {component.unit} je
                  Jahrzehnt, R² {num(fit.r2, 2)}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Exceedances                                                                */
/* -------------------------------------------------------------------------- */

function Exceedances({ data, componentKey }: { data: AirOverviewResponse; componentKey: string }) {
  const component = data.components.find((c) => c.key === componentKey)
  const series = data.annual.filter((a) => a.component === componentKey)
  if (!component) return null

  const counted = component.limits.filter((l) => l.stat !== 'year_mean')
  if (counted.length === 0) return null

  return (
    <Card>
      <SectionHeading
        icon={Factory}
        title="Überschreitungen"
        hint="Wie oft die Schwellen der 39. BImSchV im Jahr überschritten wurden."
      />

      <div className="mt-4 space-y-6">
        {counted.map((limit) => {
          const key = `${limit.stat}_${limit.value}`
          const rows = new Map<number, { year: number } & Record<string, number>>()
          for (const s of series) {
            for (const point of s.points) {
              if (!rows.has(point.year)) rows.set(point.year, { year: point.year })
              const n = point.exceedances[key]
              if (typeof n === 'number') rows.get(point.year)![s.station] = n
            }
          }
          const chartRows = [...rows.values()].sort((a, b) => a.year - b.year)
          const anyValue = chartRows.some((r) =>
            series.some((s) => (r[s.station] ?? 0) > 0),
          )

          return (
            <div key={key}>
              <p className="text-xs font-medium text-ink">
                {limit.label} über {limit.value} {component.unit}
                {limit.allowance > 0 && (
                  <span className="text-ink-faint">
                    {' '}
                    — zulässig sind {limit.allowance} je Jahr
                  </span>
                )}
              </p>

              {anyValue ? (
                <div className="mt-2">
                  <ChartFrame height={200}>
                    <ResponsiveContainer>
                      <BarChart
                        data={chartRows}
                        margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
                      >
                        <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} />
                        <YAxis
                          stroke={CHART.axis}
                          tick={CHART.tick}
                          width={40}
                          allowDecimals={false}
                        />
                        {limit.allowance > 0 && (
                          <ReferenceLine
                            y={limit.allowance}
                            stroke={CHART.colors.hot}
                            strokeDasharray="5 4"
                          />
                        )}
                        <Tooltip
                          cursor={{ fill: 'oklch(28% 0.008 260 / 0.4)' }}
                          content={({ active, payload, label }) =>
                            active && payload?.length ? (
                              <ChartTooltip
                                title={String(label)}
                                rows={payload.map((p) => ({
                                  label:
                                    data.stations.find((s) => s.id === p.dataKey)?.name ??
                                    String(p.dataKey),
                                  value: `${num(p.value as number, 0)} ×`,
                                }))}
                              />
                            ) : null
                          }
                        />
                        {series.map((s) => {
                          const station = data.stations.find((x) => x.id === s.station)
                          return (
                            <Bar
                              key={s.station}
                              dataKey={s.station}
                              fill={STATION_COLOR[station?.kind ?? ''] ?? CHART.colors.neutral}
                              radius={[3, 3, 0, 0]}
                            />
                          )
                        })}
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartFrame>
                </div>
              ) : (
                <p className="mt-1.5 rounded-md border border-line bg-raised px-3 py-2 text-[11px] text-ink-muted">
                  In keinem Jahr des Bestands überschritten — an keiner der beiden Stationen.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Ozone against temperature                                                  */
/* -------------------------------------------------------------------------- */

function OzoneHeat({ data }: { data: AirOverviewResponse }) {
  const heat = data.ozoneHeat
  if (!heat || heat.binned.length === 0) return null

  const rows = heat.binned.map((bin) => {
    const band = heat.exceedanceByBand.find((b) => b.from === bin.from)
    return {
      label: `${bin.from}–${bin.to}`,
      mean: bin.mean,
      days: bin.days,
      share: band ? band.share * 100 : 0,
      over: band?.over ?? 0,
    }
  })

  const first = rows[0]!
  const last = rows.at(-1)!

  return (
    <Card>
      <SectionHeading
        icon={Sun}
        title="Ozon und Hitze"
        hint={`Höchstes 8-Stunden-Mittel gegen die Tageshöchsttemperatur der DWD-Station ${heat.dwdStation}, ${heat.months}.`}
      />

      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
        Ozon wird nicht ausgestoßen, es entsteht unter Sonneneinstrahlung aus
        anderen Schadstoffen. Deshalb ist es die einzige Größe hier, die sich
        direkt an den Wetterdaten dieses Projekts festmachen lässt — und der
        Zusammenhang ist deutlich: Unterhalb von 18 °C wurde der Zielwert von{' '}
        {heat.target} µg/m³ an {num(first.days, 0)} Tagen kein einziges Mal
        erreicht, im Band {last.label} °C an {percent(last.share / 100)} der
        Tage.
      </p>

      <div className="mt-4">
        <ChartFrame height={300}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke={CHART.axis}
                tick={CHART.tick}
                label={{
                  value: 'Tageshöchsttemperatur (°C)',
                  position: 'insideBottom',
                  offset: -2,
                  fill: CHART.axis,
                  fontSize: 11,
                }}
              />
              <YAxis
                stroke={CHART.axis}
                tick={CHART.tick}
                width={48}
                label={{
                  value: 'µg/m³',
                  angle: -90,
                  position: 'insideLeft',
                  fill: CHART.axis,
                  fontSize: 11,
                }}
              />
              {heat.target && (
                <ReferenceLine
                  y={heat.target}
                  stroke={CHART.colors.hot}
                  strokeDasharray="5 4"
                  label={{
                    value: `Zielwert ${heat.target}`,
                    fill: CHART.colors.hot,
                    fontSize: 10,
                    position: 'insideTopLeft',
                  }}
                />
              )}
              <Tooltip
                cursor={{ fill: 'oklch(28% 0.008 260 / 0.4)' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0]!.payload as (typeof rows)[number]
                  return (
                    <ChartTooltip
                      title={`${label} °C`}
                      subtitle={`${num(row.days, 0)} Tage im Bestand`}
                      rows={[
                        { label: 'Ozon im Mittel', value: `${num(row.mean, 0)} µg/m³` },
                        {
                          label: 'über Zielwert',
                          value: `${num(row.over, 0)} Tage (${percent(row.share / 100)})`,
                          className: row.share > 0 ? 'text-hot' : 'text-ink',
                        },
                      ]}
                    />
                  )
                }}
              />
              <Bar dataKey="mean" radius={[3, 3, 0, 0]}>
                {rows.map((row) => (
                  <Cell
                    key={row.label}
                    fill={row.share > 0 ? CHART.colors.hot : CHART.colors.cool}
                    fillOpacity={0.35 + Math.min(row.share, 100) / 155}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <p className="mt-3 text-[10px] text-ink-faint">
        {num(heat.days, 0)} Tage, an denen beide Messungen vorliegen. Bänder mit
        weniger als zehn Tagen sind weggelassen — sie sagen mehr über den Zufall
        als über das Ozon.
      </p>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function Air() {
  const { data, loading, error } = useApi<AirOverviewResponse>('/api/air')
  const [componentKey, setComponentKey] = useUrlState<string>('groesse', 'no2')

  if (loading && !data) return <Loading message="Luftmesswerte werden geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  if (data.hint) {
    return <InfoPanel title="Luftqualität">{<p>{data.hint}</p>}</InfoPanel>
  }

  const component = data.components.find((c) => c.key === componentKey)
  const choices = data.components
    .filter((c) => data.coverage.some((cov) => cov.component === c.key && cov.hours > 0))
    .map((c) => ({ value: c.key, label: c.short, title: c.label }))

  const coverage = data.coverage.filter((c) => c.component === componentKey)

  return (
    <div className="space-y-6">
      <InfoPanel title="Luftqualität in Göttingen">
        <p>
          Zwei Messstationen des Umweltbundesamts stehen in der Stadt, und genau
          darin liegt der Wert: {data.stations[0]?.name} misst im{' '}
          {data.stations[0]?.kindLabel.toLowerCase()}, {data.stations[1]?.name}{' '}
          steht {data.stations[1]?.kindLabel.toLowerCase()} in der{' '}
          {data.stations[1]?.address.split(',')[0]}. Dieselbe Größe, 2,7 km
          auseinander, unter ganz verschiedener Belastung — eine einzelne Station
          könnte nur sagen „so ist die Luft", ohne etwas, woran sich das messen
          ließe.
        </p>
        <p>
          Der Bestand umfasst {num(data.range.days, 0)} Tage in Stundenauflösung,
          von {isoToGerman(data.range.first)} bis {isoToGerman(data.range.last)}.
          Weiter zurück reicht die Schnittstelle des UBA nicht, unabhängig davon,
          seit wann die Stationen stehen. Ein Tagesmittel entsteht erst ab{' '}
          {data.minHoursForDayMean} gültigen Stunden.
        </p>
      </InfoPanel>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading icon={Wind} title="Messgröße" />
          <ChoiceGroup
            label="Messgröße"
            value={componentKey}
            choices={choices}
            onChange={setComponentKey}
          />
        </div>

        {component && (
          <>
            <p className="mt-3 text-xs text-ink-muted">
              {component.label}
              {component.limits.length > 0 && (
                <>
                  {' '}
                  · Schwellen:{' '}
                  {component.limits
                    .map(
                      (l) =>
                        `${l.label} ${l.value} ${component.unit}` +
                        (l.allowance > 0 ? ` (${l.allowance}×/Jahr zulässig)` : ''),
                    )
                    .join(', ')}
                </>
              )}
            </p>

            <div className="mt-4">
              <StatGrid>
                {coverage.map((cov) => {
                  const station = data.stations.find((s) => s.id === cov.station)
                  return (
                    <StatTile
                      key={cov.station}
                      label={station?.name ?? cov.station}
                      value={`${num(cov.hours, 0)} h`}
                      caption={`${percent(cov.share)} der Stunden gemessen · ${isoToGerman(cov.first)} bis ${isoToGerman(cov.last)}`}
                      accent={station?.kind === 'traffic' ? 'warm' : 'cool'}
                      icon={station?.kind === 'traffic' ? Car : Building2}
                    />
                  )
                })}
              </StatGrid>
            </div>

            {coverage.some((c) => c.share < 0.75) && (
              <p className="mt-3 rounded-md border border-line bg-raised px-3 py-2 text-[11px] text-ink-muted">
                Diese Größe liegt nur für einen Teil der Stunden vor. Die
                Auswertungen unten sind darum aus weniger Material gerechnet als
                die übrigen — nicht falsch, aber dünner belegt.
              </p>
            )}
          </>
        )}
      </Card>

      <Profiles componentKey={componentKey} />

      <AnnualTrend data={data} componentKey={componentKey} />

      <Exceedances data={data} componentKey={componentKey} />

      <OzoneHeat data={data} />
    </div>
  )
}
