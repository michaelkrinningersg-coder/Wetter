import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Landmark, TrendingDown, TrendingUp } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlList, useUrlState } from '../lib/url-state'
import { num } from '../lib/format'
import { linearFit } from '../lib/stats'
import type { RegionalRegion, RegionalResponse } from '../types'
import {
  Card,
  CHART,
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

/** The DWD transliterates umlauts in its region names; German readers do not. */
const DISPLAY: Record<string, string> = {
  'Baden-Wuerttemberg': 'Baden-Württemberg',
  Thueringen: 'Thüringen',
  'Thueringen/Sachsen-Anhalt': 'Thüringen/Sachsen-Anhalt',
}

const label = (name: string) => DISPLAY[name] ?? name

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const SEASONS: Record<string, string> = {
  winter: 'Winter',
  spring: 'Frühling',
  summer: 'Sommer',
  autumn: 'Herbst',
}

/**
 * Reading order, not the alphabetical order the codes happen to have.
 *
 * Sorting the raw suffixes yields "autumn, spring, summer, winter, year",
 * which is nobody's idea of a sequence.
 */
const PERIOD_ORDER = [
  'year',
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
  'spring', 'summer', 'autumn', 'winter',
]

function sortPeriods(periods: string[]): string[] {
  return [...periods].sort((a, b) => {
    const ia = PERIOD_ORDER.indexOf(a)
    const ib = PERIOD_ORDER.indexOf(b)
    // Anything the DWD adds later sorts to the end rather than vanishing.
    return (ia < 0 ? PERIOD_ORDER.length : ia) - (ib < 0 ? PERIOD_ORDER.length : ib)
  })
}

function periodLabel(period: string): string {
  if (period === 'year') return 'Jahr'
  if (SEASONS[period]) return SEASONS[period]!
  const month = Number(period)
  return Number.isInteger(month) && month >= 1 && month <= 12 ? MONTHS[month - 1]! : period
}

/** Regions drawn by default: the country plus the two extremes of the trend. */
const CHART_COLOURS = [
  CHART.colors.brand,
  CHART.colors.warm,
  CHART.colors.cool,
  CHART.colors.good,
  CHART.colors.accent,
]

interface Ranked {
  region: RegionalRegion
  perDecade: number | null
  r2: number | null
  significant: boolean
  firstValue: number
  lastValue: number
  change: number
}

function rank(regions: RegionalRegion[]): Ranked[] {
  return regions
    .map((region) => {
      const fit = linearFit(region.points.map((p) => ({ x: p.year, y: p.value })))
      return {
        region,
        perDecade: fit ? fit.slope * 10 : null,
        r2: fit?.r2 ?? null,
        significant: fit?.isSignificant ?? false,
        firstValue: region.points[0]?.value ?? 0,
        lastValue: region.points.at(-1)?.value ?? 0,
        // Change measured on the fitted line, not between two single years —
        // one hot year at either end would otherwise decide the ranking.
        change: fit ? fit.at(region.last) - fit.at(region.first) : 0,
      }
    })
    .sort((a, b) => (b.perDecade ?? -Infinity) - (a.perDecade ?? -Infinity))
}

export function Regional() {
  const [parameter, setParameter] = useUrlState<string>('groesse', null)
  const [period, setPeriod] = useUrlState<string>('zeitraum', null)
  const [selected, setSelected] = useUrlList('gebiete', null)

  const query = [
    parameter ? `parameter=${encodeURIComponent(parameter)}` : '',
    period ? `period=${encodeURIComponent(period)}` : '',
  ]
    .filter(Boolean)
    .join('&')

  const { data, loading, error } = useApi<RegionalResponse>(
    `/api/regional${query ? `?${query}` : ''}`,
    [parameter, period],
  )

  const ranked = useMemo(() => (data?.series ? rank(data.series.regions) : []), [data])

  if (loading && !data) return <Loading message="Gebietsmittel werden geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  if (!data.series) {
    return (
      <Card>
        <SectionHeading icon={Landmark} title="Deutschland und die Bundesländer" />
        <p className="text-sm text-ink-muted">{data.hint ?? 'Noch keine Gebietsmittel.'}</p>
      </Card>
    )
  }

  const { parameter: param, period: activePeriod, regions } = data.series
  const known = data.parameters.find((p) => p.key === param.key)
  const germany = ranked.find((r) => r.region.kind === 'national')

  // Default selection: the country plus the fastest and slowest region.
  const shown =
    selected ??
    [
      'Deutschland',
      ranked.find((r) => r.region.kind === 'state')?.region.name,
      [...ranked].reverse().find((r) => r.region.kind === 'state')?.region.name,
    ].filter((x): x is string => Boolean(x))

  const years = [...new Set(regions.flatMap((r) => r.points.map((p) => p.year)))].sort()
  const byRegion = new Map(regions.map((r) => [r.name, new Map(r.points.map((p) => [p.year, p.value]))]))
  const chartData = years.map((year) => {
    const row: Record<string, number | null> = { year }
    for (const name of shown) row[name] = byRegion.get(name)?.get(year) ?? null
    return row
  })

  // `shown` already resolves "nothing chosen yet" to the default set, so the
  // toggle works off it rather than off the raw selection.
  const toggle = (name: string) =>
    setSelected(shown.includes(name) ? shown.filter((n) => n !== name) : [...shown, name])

  const warming = param.direction !== 'cold'

  return (
    <div className="space-y-6">
      <InfoPanel title="Deutschland und die Bundesländer">
        <p>
          Die amtlichen Gebietsmittel des DWD — nicht aus den Stationen dieser App
          gerechnet, sondern die Zahlen, die der Dienst selbst veröffentlicht. Sie
          entstehen aus dem vollständigen Messnetz mit einer räumlichen
          Interpolation, die sich aus offenen Tageswerten nicht nachbauen lässt.
        </p>
        <p>
          Temperatur und Niederschlag reichen bis <strong>1881</strong> zurück,
          Sonnenscheindauer und die Kenntage erst bis 1951 — die Reihe steht
          jeweils an der Achse.
        </p>
        <p>
          Der DWD führt <strong>nicht alle sechzehn Länder einzeln</strong>. Berlin,
          Hamburg und Bremen erscheinen nur in den Kombinationen
          Brandenburg/Berlin und Niedersachsen/Hamburg/Bremen;
          Thüringen/Sachsen-Anhalt überlappt zwei Länder, die auch einzeln
          geführt werden. Kombinationen sind unten gekennzeichnet — sie dürfen
          nicht zusammengezählt werden, weil sie sich Fläche teilen.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={Landmark}
          title={`${param.label} — ${periodLabel(activePeriod)}`}
          hint="Größe und Zeitraum wählen; die Rangliste darunter sortiert nach Trend je Jahrzehnt."
        />

        <div className="flex flex-col gap-3">
          <ChoiceGroup
            label="Größe"
            value={param.key}
            choices={data.parameters.map((p) => ({ value: p.key, label: p.label }))}
            onChange={(value) => {
              setParameter(value)
              // The day counts exist annually only; carrying a month over would
              // ask for a series that does not exist.
              setPeriod(null)
            }}
            size="sm"
          />
          {known && known.periods.length > 1 && (
            <ChoiceGroup
              label="Zeitraum"
              value={activePeriod}
              choices={sortPeriods(known.periods).map((p) => ({ value: p, label: periodLabel(p) }))}
              onChange={setPeriod}
              size="sm"
            />
          )}
        </div>

        {germany && (
          <div className="mt-5">
            <StatGrid>
              <StatTile
                label={`Deutschland ${germany.region.first}`}
                value={`${num(germany.firstValue, param.decimals)} ${param.unit}`}
                accent="neutral"
              />
              <StatTile
                label={`Deutschland ${germany.region.last}`}
                value={`${num(germany.lastValue, param.decimals)} ${param.unit}`}
                accent={warming ? 'warm' : 'cool'}
              />
              <StatTile
                label="Trend je Jahrzehnt"
                value={
                  germany.perDecade === null
                    ? '—'
                    : `${germany.perDecade > 0 ? '+' : ''}${num(germany.perDecade, 2)} ${param.unit}`
                }
                caption={
                  germany.r2 === null
                    ? undefined
                    : `R² ${num(germany.r2, 2)} · ${germany.significant ? 'signifikant' : 'nicht signifikant'} (95 %)`
                }
                accent={germany.perDecade && germany.perDecade > 0 ? 'hot' : 'cold'}
                icon={germany.perDecade && germany.perDecade > 0 ? TrendingUp : TrendingDown}
              />
              <StatTile
                label={`Veränderung ${germany.region.first}–${germany.region.last}`}
                value={`${germany.change > 0 ? '+' : ''}${num(germany.change, param.decimals === 0 ? 1 : param.decimals)} ${param.unit}`}
                caption="auf der Regressionsgeraden, nicht zwischen zwei Einzeljahren"
                accent="brand"
              />
            </StatGrid>
          </div>
        )}

        <div className="mt-5">
          <ChartFrame>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} />
              <YAxis
                stroke={CHART.axis}
                tick={CHART.tick}
                width={52}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => num(v, param.decimals)}
              />
              <Tooltip
                content={({ active, payload, label: year }) =>
                  active && payload?.length ? (
                    <ChartTooltip
                      title={String(year)}
                      rows={payload
                        .filter((p) => p.value !== null && p.value !== undefined)
                        .map((p) => ({
                          label: label_(String(p.dataKey)),
                          value: `${num(Number(p.value), param.decimals)} ${param.unit}`,
                          color: p.color,
                        }))}
                    />
                  ) : null
                }
              />
              <Legend
                formatter={(value: string) => (
                  <span className="text-xs text-ink-muted">{label(value)}</span>
                )}
              />
              {shown.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  name={name}
                  stroke={CHART_COLOURS[i % CHART_COLOURS.length]}
                  strokeWidth={name === 'Deutschland' ? 2.2 : 1.4}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </Card>

      <Card>
        <SectionHeading
          title={`Rangliste — ${param.label} je Jahrzehnt`}
          hint="Anklicken blendet ein Gebiet im Diagramm oben ein oder aus."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-xs">
            <thead>
              <tr className="border-b border-line text-ink-faint">
                <th className="py-2 pr-3 text-left font-medium">Gebiet</th>
                <th className="py-2 pr-3 text-right font-medium">je Jahrzehnt</th>
                <th className="py-2 pr-3 text-right font-medium">gesamt</th>
                <th className="py-2 pr-3 text-right font-medium">{regions[0]?.first ?? ''}</th>
                <th className="py-2 pr-3 text-right font-medium">{regions[0]?.last ?? ''}</th>
                <th className="py-2 pr-3 text-right font-medium">R²</th>
                <th className="py-2 text-left font-medium">Art</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => {
                const active = shown.includes(row.region.name)
                return (
                  <tr
                    key={row.region.name}
                    onClick={() => toggle(row.region.name)}
                    className={`cursor-pointer border-b border-line/60 transition-colors hover:bg-raised ${
                      active ? 'bg-raised' : ''
                    }`}
                  >
                    <td className="py-1.5 pr-3">
                      <span className={active ? 'font-semibold text-ink' : 'text-ink'}>
                        {label(row.region.name)}
                      </span>
                    </td>
                    <td className="numeric py-1.5 pr-3 text-right">
                      {row.perDecade === null
                        ? '—'
                        : `${row.perDecade > 0 ? '+' : ''}${num(row.perDecade, 2)}`}
                      {!row.significant && <span className="ml-1 text-ink-faint">n. s.</span>}
                    </td>
                    <td className="numeric py-1.5 pr-3 text-right text-ink-muted">
                      {row.change > 0 ? '+' : ''}
                      {num(row.change, param.decimals === 0 ? 1 : param.decimals)}
                    </td>
                    <td className="numeric py-1.5 pr-3 text-right text-ink-faint">
                      {num(row.firstValue, param.decimals)}
                    </td>
                    <td className="numeric py-1.5 pr-3 text-right text-ink-faint">
                      {num(row.lastValue, param.decimals)}
                    </td>
                    <td className="numeric py-1.5 pr-3 text-right text-ink-faint">
                      {row.r2 === null ? '—' : num(row.r2, 2)}
                    </td>
                    <td className="py-1.5 text-ink-faint">
                      {row.region.kind === 'national'
                        ? 'Bund'
                        : row.region.kind === 'combination'
                          ? 'Kombination'
                          : 'Land'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">
          Alle Werte in {param.unit}. „n. s." markiert einen Trend, der das
          95-%-Niveau nicht erreicht. Kombinationen teilen sich Fläche mit
          einzeln geführten Ländern und dürfen nicht addiert werden.
        </p>
      </Card>
    </div>
  )
}

/** Local alias so the tooltip can use the display name without shadowing. */
function label_(name: string): string {
  return DISPLAY[name] ?? name
}
