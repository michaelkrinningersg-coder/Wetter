import { useMemo } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Droplets, Layers, Sprout, Thermometer } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num } from '../lib/format'
import type { SoilResponse } from '../types'
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
} from './ui'

const WINDOWS = [
  { value: '90', label: '90 Tage' },
  { value: '365', label: 'Jahr' },
  { value: '1825', label: '5 Jahre' },
] as const

type Window = (typeof WINDOWS)[number]['value']

/** Colour by depth: the shallow layers warm, the deep ones cool. */
const DEPTH_COLORS = [
  CHART.colors.hot,
  CHART.colors.warm,
  CHART.colors.brand,
  CHART.colors.good,
  CHART.colors.cool,
  CHART.colors.cold,
]

const MONTHS = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
]

/** "08-09" -> "9. August" */
function calendarLabel(md: string | null) {
  if (!md) return '—'
  const [m, d] = md.split('-')
  const names = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  ]
  return `${Number(d)}. ${names[Number(m) - 1]}`
}

/** Days between two `MM-DD`, forward around the year. */
function daysBetween(from: string | null, to: string | null) {
  if (!from || !to) return null
  const at = (md: string) =>
    Math.round((Date.UTC(2024, Number(md.slice(0, 2)) - 1, Number(md.slice(3))) - Date.UTC(2024, 0, 1)) / 86_400_000)
  const diff = at(to) - at(from)
  return diff < -183 ? diff + 366 : diff > 183 ? diff - 366 : diff
}

/**
 * How dry is dry.
 *
 * A percentile beats a threshold here, because the threshold would have to be
 * different in every month: 43 % of usable field capacity is alarming in April
 * and ordinary in August. Only the same time of year in the other 34 years can
 * say which.
 */
function verdict(percentile: number | null) {
  if (percentile === null) return { text: 'nicht einzuordnen', tone: 'text-ink-faint' }
  if (percentile < 10) return { text: 'außergewöhnlich trocken', tone: 'text-bad' }
  if (percentile < 25) return { text: 'trockener als üblich', tone: 'text-dry' }
  if (percentile < 75) return { text: 'im üblichen Bereich', tone: 'text-ink' }
  if (percentile < 90) return { text: 'feuchter als üblich', tone: 'text-wet' }
  return { text: 'außergewöhnlich feucht', tone: 'text-wet' }
}

export function Soil() {
  const [window, setWindow] = useUrlState<Window>('fenster', '365', {
    allowed: WINDOWS.map((w) => w.value),
  })

  const { data, loading, error, reload } = useApi<SoilResponse>(`/api/soil?tage=${window}`, [window])

  const moistureData = useMemo(() => {
    if (!data?.moisture) return []
    const byDay = new Map(data.moisture.climatology.map((c) => [c.md, c]))
    return data.moisture.series.map((row) => {
      const norm = byDay.get(String(row.date).slice(5))
      return {
        date: String(row.date),
        label: isoToGerman(String(row.date)),
        total: row.bf_total,
        p10: norm?.p10 ?? null,
        // Stacked areas again: the usual range is drawn as "p10 plus how far
        // p90 reaches above it".
        band: norm?.p10 !== null && norm?.p10 !== undefined && norm?.p90 !== null && norm?.p90 !== undefined
          ? norm.p90 - norm.p10
          : null,
        p50: norm?.p50 ?? null,
      }
    })
  }, [data])

  const cycleData = useMemo(() => {
    if (!data?.temperature) return []
    const depths = data.temperature.cycles.filter((c) => c.samples >= 300)
    if (depths.length === 0) return []
    return depths[0]!.cycle.map((_, i) => {
      const row: Record<string, number | string | null> = { md: depths[0]!.cycle[i]!.md }
      row.label = calendarLabel(depths[0]!.cycle[i]!.md)
      for (const depth of depths) row[depth.key] = depth.cycle[i]?.value ?? null
      return row
    })
  }, [data])

  if (loading && !data) return <Loading message="Der Boden wird gelesen …" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const { moisture, temperature, evaporation } = data
  const today = moisture?.today ?? null
  const state = verdict(today?.percentile ?? null)
  const deepCycles = temperature?.cycles.filter((c) => c.samples >= 300) ?? []
  const shallow = deepCycles[0]
  const deepest = deepCycles.at(-1)
  const lag = daysBetween(shallow?.peak ?? null, deepest?.peak ?? null)

  return (
    <div className="space-y-6">
      <InfoPanel icon={Layers} title="Boden und Bodenfeuchte">
        <p>
          Was unter der Wetterhütte passiert, steht in keiner Tagesmeldung. Der
          DWD rechnet es: Die agrarmeteorologischen Modelle{' '}
          <strong className="text-ink">AMBAV und AMBETI</strong> nehmen
          Temperatur, Taupunkt, Wind, Niederschlag und Strahlung und simulieren
          daraus, was das Wasser im Boden tut. Angegeben wird es als{' '}
          <strong className="text-ink">Prozent der nutzbaren Feldkapazität</strong>{' '}
          — 100 % ist ein Boden, der so viel Wasser hält, wie er gegen die
          Schwerkraft halten kann, 0 % der Welkepunkt, an dem die Pflanze nicht
          mehr herankommt.
        </p>
        <p>
          <strong className="text-ink">Die Feuchte ist gerechnet, nicht
          gemessen</strong>, und das ist keine Schwäche dieser Ansicht, sondern
          die Natur der Größe: Der DWD schreibt selbst, dass sie
          „normalerweise messtechnisch nicht erfasst" wird. Die Bodentemperatur
          dagegen ist gemessen — ein Thermometer im Boden, seit 1981. Wo beides
          vorlag, steht hier die Messung.
        </p>
        <p>
          <strong className="text-ink">Nur Göttingen.</strong> Weder der Brocken
          noch die Zugspitze stehen in einem der beiden Datensätze; die
          abgeleitete Reihe umfasst 494 Stationen und diese zwei sind nicht
          darunter. Das ist keine Auswahl dieses Projekts, sondern die
          Datenlage.
        </p>
      </InfoPanel>

      {data.hint && (
        <Card>
          <p className="text-sm text-ink-muted">{data.hint}</p>
        </Card>
      )}

      {today && (
        <Card>
          <SectionHeading
            icon={Droplets}
            title={`Der Boden am ${isoToGerman(today.date)}`}
            hint={`Verglichen mit ${num(today.samples, 0)} Tagen derselben Jahreszeit seit ${data.range.moisture.first?.slice(0, 4)}`}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <div>
              <p className="label">Wurzelraum 0–60 cm</p>
              <p className="numeric mt-1 text-4xl font-semibold text-ink">
                {today.total === null ? '—' : `${num(today.total, 0)} %`}
              </p>
              <p className={`mt-1 text-sm font-medium ${state.tone}`}>{state.text}</p>
              {today.percentile !== null && (
                <p className="mt-2 text-xs text-ink-muted">
                  Nur{' '}
                  <span className="numeric text-ink">{num(today.percentile, 0)} %</span>{' '}
                  der vergleichbaren Tage seit{' '}
                  {data.range.moisture.first?.slice(0, 4)} waren trockener.
                </p>
              )}
              <p className="mt-2 text-[11px] text-ink-faint">
                Vergleichbar heißt: derselbe Kalendertag ±
                {num(data.method?.calendarWindow ?? 7, 0)} Tage, über alle Jahre
                des Archivs.
              </p>
            </div>

            <div>
              <p className="label mb-2">Nach Tiefe</p>
              <ChartFrame height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={(moisture?.layers ?? []).map((l, i) => ({
                      label: `${l.from}–${l.to} cm`,
                      value: today.layers[l.key] ?? null,
                      fill: DEPTH_COLORS[i % DEPTH_COLORS.length],
                    }))}
                    margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
                  >
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 'dataMax']}
                      tick={CHART.tick}
                      stroke={CHART.axis}
                      unit=" %"
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={CHART.tick}
                      stroke={CHART.axis}
                      width={70}
                    />
                    <Tooltip
                      cursor={{ fill: CHART.cursor }}
                      content={({ active, payload }) => {
                        const first = payload?.[0]
                        if (!active || !first) return null
                        const row = first.payload as { label: string; value: number | null }
                        return (
                          <ChartTooltip
                            title={row.label}
                            rows={[
                              {
                                label: 'nutzbare Feldkapazität',
                                value: row.value === null ? '—' : `${num(row.value, 0)} %`,
                              },
                            ]}
                          />
                        )
                      }}
                    />
                    <Bar dataKey="value" isAnimationActive={false} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>
            </div>
          </div>
        </Card>
      )}

      {moistureData.length > 0 && (
        <Card>
          <SectionHeading
            icon={Sprout}
            title="Bodenfeuchte im Verlauf"
            hint="Die graue Fläche ist der übliche Bereich derselben Jahreszeit — zwischen dem 10. und dem 90. Perzentil aller Jahre."
            actions={
              <ChoiceGroup
                label="Zeitraum"
                value={window}
                choices={WINDOWS}
                onChange={setWindow}
                size="sm"
              />
            }
          />
          <ChartFrame height={340}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={moistureData} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tick={{ ...CHART.tick, fontSize: 10 }}
                  stroke={CHART.axis}
                  minTickGap={56}
                />
                <YAxis tick={CHART.tick} stroke={CHART.axis} unit=" %" width={62} />
                <Tooltip
                  content={({ active, payload }) => {
                    const first = payload?.[0]
                    if (!active || !first) return null
                    const row = first.payload as (typeof moistureData)[number]
                    return (
                      <ChartTooltip
                        title={row.label}
                        rows={[
                          {
                            label: 'Wurzelraum 0–60 cm',
                            value: row.total === null ? '—' : `${num(row.total, 0)} %`,
                            className: 'text-brand',
                          },
                          {
                            label: 'üblich (Median)',
                            value: row.p50 === null ? '—' : `${num(row.p50, 0)} %`,
                          },
                          {
                            label: 'üblicher Bereich',
                            value:
                              row.p10 === null || row.band === null
                                ? '—'
                                : `${num(row.p10, 0)} – ${num(row.p10 + row.band, 0)} %`,
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
                <Area
                  stackId="norm"
                  dataKey="p10"
                  stroke="none"
                  fill="none"
                  legendType="none"
                  tooltipType="none"
                  isAnimationActive={false}
                />
                <Area
                  name="üblicher Bereich"
                  stackId="norm"
                  dataKey="band"
                  stroke="none"
                  fill={CHART.axis}
                  fillOpacity={0.22}
                  tooltipType="none"
                  isAnimationActive={false}
                />
                <Line
                  name="Median"
                  type="monotone"
                  dataKey="p50"
                  stroke={CHART.axis}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  name="gemessener Zeitraum"
                  type="monotone"
                  dataKey="total"
                  stroke={CHART.colors.brand}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>
      )}

      {cycleData.length > 0 && (
        <Card>
          <SectionHeading
            icon={Thermometer}
            title="Was die Tiefe mit dem Jahr macht"
            hint={`Gemessene Bodentemperatur, über alle Jahre seit ${data.range.temperature.first?.slice(0, 4)} gemittelt.`}
          />
          {/* Written out rather than left to recharts, which orders its legend
              by whichever child registers first — shallow to deep is the only
              order that means anything here. */}
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
            {deepCycles.map((depth, i) => (
              <li key={depth.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 rounded-full"
                  style={{ background: DEPTH_COLORS[i % DEPTH_COLORS.length] }}
                  aria-hidden
                />
                {depth.depth} cm
              </li>
            ))}
          </ul>
          <ChartFrame height={320}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycleData} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tick={{ ...CHART.tick, fontSize: 10 }}
                  stroke={CHART.axis}
                  minTickGap={64}
                />
                <YAxis tick={CHART.tick} stroke={CHART.axis} unit=" °C" width={62} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <ChartTooltip
                        title={String(label)}
                        rows={payload.map((entry) => ({
                          label: entry.name as string,
                          value:
                            typeof entry.value === 'number' ? `${num(entry.value, 1)} °C` : '—',
                        }))}
                      />
                    )
                  }}
                />
                {deepCycles.map((depth, i) => (
                  <Line
                    key={depth.key}
                    name={`${depth.depth} cm`}
                    type="monotone"
                    dataKey={depth.key}
                    stroke={DEPTH_COLORS[i % DEPTH_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>

          <table className="mt-4 w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                <th className="pb-2 font-medium">Tiefe</th>
                <th className="pb-2 text-right font-medium">Jahresamplitude</th>
                <th className="pb-2 text-right font-medium">wärmster Tag</th>
                <th className="pb-2 text-right font-medium">kältester Tag</th>
                <th className="pb-2 text-right font-medium">Messtage</th>
              </tr>
            </thead>
            <tbody>
              {deepCycles.map((depth) => (
                <tr key={depth.key} className="border-b border-line/60">
                  <td className="py-1.5 text-ink">{depth.depth} cm</td>
                  <td className="numeric py-1.5 text-right text-ink">
                    {depth.amplitude === null ? '—' : `${num(depth.amplitude, 1)} K`}
                  </td>
                  <td className="numeric py-1.5 text-right text-ink-muted">
                    {calendarLabel(depth.peak)}
                  </td>
                  <td className="numeric py-1.5 text-right text-ink-muted">
                    {calendarLabel(depth.trough)}
                  </td>
                  <td className="numeric py-1.5 text-right text-ink-faint">
                    {num(depth.samples, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {shallow && deepest && lag !== null && (
            <p className="mt-3 text-[11px] text-ink-faint">
              Von {shallow.depth} auf {deepest.depth} cm verliert der Jahresgang{' '}
              <span className="numeric text-ink-muted">
                {num((shallow.amplitude ?? 0) - (deepest.amplitude ?? 0), 1)} K
              </span>{' '}
              an Amplitude und kommt{' '}
              <span className="numeric text-ink-muted">{num(Math.abs(lag), 0)} Tage</span>{' '}
              {lag >= 0 ? 'später' : 'früher'} an. Die Erde dämpft das Jahr und
              schiebt es nach hinten — je tiefer, desto träger.
            </p>
          )}
        </Card>
      )}

      {evaporation && evaporation.monthly.length > 0 && (
        <Card>
          <SectionHeading
            icon={Droplets}
            title="Was verdunsten könnte und was verdunstet"
            hint="Tagesmittel je Kalendermonat über das ganze Archiv. Die Lücke zwischen beiden ist Trockenstress: Solange der Boden liefert, sind sie gleich."
          />
          <ChartFrame height={300}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={evaporation.monthly.map((m) => ({
                  ...m,
                  label: MONTHS[m.month - 1],
                }))}
                margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
              >
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={CHART.tick} stroke={CHART.axis} />
                {/* Wider than the other charts and without the negative left
                    margin: "3,6 mm" needs more room than "140 %", and the
                    margin cut the leading digit off. */}
                <YAxis tick={CHART.tick} stroke={CHART.axis} unit=" mm" width={78} />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    const first = payload?.[0]
                    if (!active || !first) return null
                    const row = first.payload as (typeof evaporation.monthly)[number] & {
                      label: string
                    }
                    return (
                      <ChartTooltip
                        title={row.label}
                        rows={[
                          { label: 'möglich (FAO)', value: `${num(row.potential, 2)} mm/Tag` },
                          { label: 'tatsächlich', value: `${num(row.real, 2)} mm/Tag` },
                          {
                            label: 'Lücke',
                            value: `${num(row.deficit, 2)} mm/Tag`,
                            className: 'text-dry',
                          },
                          { label: 'Messtage', value: num(row.days, 0) },
                        ]}
                      />
                    )
                  }}
                />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  name="möglich"
                  dataKey="potential"
                  fill={CHART.colors.dry}
                  fillOpacity={0.55}
                  isAnimationActive={false}
                />
                <Bar
                  name="tatsächlich"
                  dataKey="real"
                  fill={CHART.colors.wet}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>
      )}
    </div>
  )
}
