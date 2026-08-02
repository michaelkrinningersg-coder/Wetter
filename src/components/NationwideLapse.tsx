import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChevronLeft, ChevronRight, Mountain, TrendingDown, Layers } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf, signed } from '../lib/format'
import type {
  GermanyMapResponse,
  GermanyStationRegister,
  LapseDay,
  LapseResponse,
} from '../types'
import {
  CHART,
  Card,
  ChartFrame,
  ChartTooltip,
  EmptyState,
  ErrorState,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/* -------------------------------------------------------------------------- */
/* One day                                                                    */
/* -------------------------------------------------------------------------- */

interface Point {
  id: string
  name: string
  state: string
  elevation: number
  temp: number
}

/** Ordinary least squares, for the line the scatter itself shows. */
function fitLine(points: Point[]) {
  if (points.length < 3) return null
  const n = points.length
  const mx = points.reduce((a, p) => a + p.elevation, 0) / n
  const my = points.reduce((a, p) => a + p.temp, 0) / n

  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const p of points) {
    sxy += (p.elevation - mx) * (p.temp - my)
    sxx += (p.elevation - mx) ** 2
    syy += (p.temp - my) ** 2
  }
  if (sxx === 0) return null

  const slope = sxy / sxx
  return {
    slope,
    intercept: my - slope * mx,
    r2: syy === 0 ? null : (sxy * sxy) / (sxx * syy),
  }
}

function DayScatter({ date, onDate }: { date: string | null; onDate: (d: string) => void }) {
  const register = useApi<GermanyStationRegister>('/api/germany/stations')
  const map = useApi<GermanyMapResponse>(
    `/api/germany/map${date ? `?date=${date}` : ''}`,
    [date],
  )

  const elevations = useMemo(() => {
    const out = new Map<string, { name: string; state: string; elevation: number }>()
    for (const [id, name, state, , , elevation] of register.data?.stations ?? []) {
      out.set(id, { name, state, elevation })
    }
    return out
  }, [register.data])

  if ((register.loading && !register.data) || (map.loading && !map.data)) {
    return <Loading message="Tageswerte werden geladen …" />
  }
  if (register.error) return <ErrorState message={register.error} />
  if (map.error) return <ErrorState message={map.error} />
  if (!map.data?.day) return null

  const day = map.data.day
  const dates = map.data.dates
  const shape = map.data.shape ?? null

  const at = dates.indexOf(day.date)
  const older = at >= 0 && at < dates.length - 1 ? dates[at + 1]! : null
  const newer = at > 0 ? dates[at - 1]! : null

  const points: Point[] = (day.values.temp_mean ?? [])
    .map(([id, temp]) => {
      const station = elevations.get(id)
      if (!station || station.elevation === null) return null
      return { id, temp, ...station }
    })
    .filter((p): p is Point => p !== null)

  const fit = fitLine(points)
  const minElevation = points.reduce((a, p) => Math.min(a, p.elevation), Infinity)
  const maxElevation = points.reduce((a, p) => Math.max(a, p.elevation), -Infinity)

  const line =
    fit && Number.isFinite(minElevation)
      ? [
          { elevation: minElevation, temp: fit.intercept + fit.slope * minElevation },
          { elevation: maxElevation, temp: fit.intercept + fit.slope * maxElevation },
        ]
      : []

  // Two slopes that can disagree, and the disagreement is the interesting case:
  // the raw scatter can still fall while the fit that holds position constant
  // already rises, because the warm lowlands of the north-west pull the raw
  // line down. Naming which of the three cases a day is in beats printing two
  // numbers that seem to contradict each other.
  const scatterRises = fit !== null && fit.slope > 0
  const correctedRises = shape?.gradH !== null && shape !== null && shape.gradH > 0

  return (
    <Card>
      <SectionHeading
        icon={Mountain}
        title={`Temperatur gegen Höhe am ${isoToGerman(day.date)}`}
        hint={`${num(points.length, 0)} Stationen mit Tagesmittel und bekannter Höhe.`}
        actions={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!older}
              onClick={() => older && onDate(older)}
              aria-label="Vorheriger Tag"
              className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <select
              value={day.date}
              onChange={(e) => onDate(e.target.value)}
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
              onClick={() => newer && onDate(newer)}
              aria-label="Nächster Tag"
              className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        }
      />

      {points.length === 0 ? (
        <EmptyState message="Für diesen Tag liegen keine Tagesmittel mit Höhenangabe vor." />
      ) : (
        <>
          <div className="mt-4">
            <ChartFrame height={360}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="elevation"
                    name="Höhe"
                    unit=" m"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(v: number) => num(v, 0)}
                    label={{
                      value: 'Stationshöhe in Metern',
                      position: 'insideBottom',
                      offset: -8,
                      fill: 'var(--color-chart-tick)',
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="temp"
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    width={52}
                    tickFormatter={(v: number) => `${num(v, 0)} °C`}
                  />
                  <ReferenceLine y={0} stroke={CHART.axis} strokeDasharray="4 3" />
                  <Tooltip
                    cursor={{ stroke: CHART.cursorSoft }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0]!.payload as Point
                      if (!p.name) return null
                      return (
                        <ChartTooltip
                          title={p.name}
                          subtitle={p.state}
                          rows={[
                            { label: 'Höhe', value: `${num(p.elevation, 0)} m` },
                            { label: 'Tagesmittel', value: `${num(p.temp, 1)} °C` },
                          ]}
                        />
                      )
                    }}
                  />
                  <Scatter
                    data={points}
                    fill={CHART.colors.brand}
                    fillOpacity={0.5}
                    shape="circle"
                    isAnimationActive={false}
                  />
                  {/* The regression the scatter itself shows — drawn as a two-point
                      series so the line follows the same axes as the dots. */}
                  <Scatter
                    data={line}
                    line={{
                      stroke: scatterRises ? CHART.colors.hot : CHART.colors.cold,
                      strokeWidth: 2,
                    }}
                    shape={() => <g />}
                    isAnimationActive={false}
                    legendType="none"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartFrame>
          </div>

          <div className="mt-5">
            <StatGrid>
              <StatTile
                label="Gefälle im Streubild"
                value={fit ? `${signed(fit.slope * 100, 2)} K` : '—'}
                caption={`je 100 m · R² ${fit?.r2 !== null && fit ? num(fit.r2, 2) : '—'}`}
                accent={scatterRises ? 'hot' : 'cool'}
                icon={TrendingDown}
              />
              <StatTile
                label="Ohne Lage gerechnet"
                value={shape?.gradH !== null && shape ? `${signed(shape.gradH, 2)} K` : '—'}
                caption={`je 100 m, Nord und Ost festgehalten · R² ${
                  shape?.gradR2 !== null && shape ? num(shape.gradR2, 2) : '—'
                }`}
                accent={correctedRises ? 'hot' : 'brand'}
                icon={Layers}
              />
              <StatTile
                label="Wärmster Ort"
                value={shape?.absHi !== null && shape ? `${num(shape.absHi, 1)} °C` : '—'}
                caption={shape?.absHiStation.name}
                accent="hot"
              />
              <StatTile
                label="Kältester Ort"
                value={shape?.absLo !== null && shape ? `${num(shape.absLo, 1)} °C` : '—'}
                caption={shape?.absLoStation.name}
                accent="cold"
              />
            </StatGrid>
          </div>

          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
            {scatterRises && correctedRises ? (
              <>
                Beide Geraden <strong className="text-hot">steigen</strong>: an
                diesem Tag war es oben wärmer als unten, und das so deutlich, dass
                man es schon im rohen Streubild sieht. Kalte Luft sammelt sich in
                den Tälern, während die Berge in der Sonne liegen.
              </>
            ) : correctedRises ? (
              <>
                Hier widersprechen sich die beiden Zahlen — und der Widerspruch
                ist die Auskunft. Das Streubild fällt noch, die lagebereinigte
                Rechnung steigt bereits. Beides stimmt: die wärmsten Orte des
                Tages liegen im tiefen Nordwesten, das zieht die rohe Gerade nach
                unten. Hält man Nord und Ost fest, bleibt übrig, dass die höheren
                Stationen bei gleicher Lage <strong className="text-hot">wärmer</strong>{' '}
                waren. Eine Inversion, die das Streubild allein verdeckt.
              </>
            ) : scatterRises ? (
              <>
                Das Streubild steigt, die lagebereinigte Rechnung nicht. Der
                Anstieg im Rohbild kommt dann aus der Lage, nicht aus der Höhe —
                etwa wenn der milde Südwesten zugleich der höhere Landesteil ist.
              </>
            ) : (
              <>
                Die Gerade fällt, wie an neunzehn von zwanzig Tagen. Der Wert im
                Streubild ist aber systematisch zu flach, und der Grund steht in
                der zweiten Kachel: Deutschlands Höhen liegen im Süden, und der
                Süden ist auch weiter vom Meer entfernt. Die einfache Regression
                schreibt der Höhe zu, was in Wahrheit Lage ist. Rechnet man Höhe
                zusammen mit Nord und Ost, wird das Gefälle steiler und die
                Anpassung deutlich besser.
              </>
            )}
          </p>
        </>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* The long series                                                            */
/* -------------------------------------------------------------------------- */

/** Spelled out: Tailwind cannot see a class name built from a template literal. */
const TONE = { hot: 'text-hot', cold: 'text-cold' } as const

function DayList({ days, tone }: { days: LapseDay[]; tone: 'hot' | 'cold' }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-line text-ink-muted">
            <th className="py-2 pr-3 text-left font-medium">Tag</th>
            <th className="px-2 py-2 text-right font-medium">je 100 m</th>
            <th className="px-2 py-2 text-right font-medium">im Streubild</th>
            <th className="px-2 py-2 text-right font-medium">R²</th>
            <th className="px-2 py-2 text-left font-medium">wärmster / kältester Ort</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date} className="border-b border-line/60 last:border-0">
              <td className="numeric py-1.5 pr-3 text-ink">{isoToGerman(day.date)}</td>
              <td
                className={`numeric px-2 py-1.5 text-right text-base font-semibold ${TONE[tone]}`}
              >
                {signed(day.gradH, 2)} K
              </td>
              <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                {signed(day.lapse, 2)} K
              </td>
              <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                {num(day.gradR2, 2)}
              </td>
              <td className="px-2 py-1.5 text-ink-muted">
                <span className="text-hot">{num(day.absHi, 1)} °C</span> {day.absHiStation.name}
                <span className="block text-[10px] text-ink-faint">
                  <span className="text-cold">{num(day.absLo, 1)} °C</span>{' '}
                  {day.absLoStation.name}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function NationwideLapse() {
  const [date, setDate] = useUrlState<string>('datum', null)
  const { data, loading, error } = useApi<LapseResponse>('/api/nationwide/lapse')

  if (loading && !data) return <Loading message="Höhengefälle wird geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { overall } = data
  const winter = data.monthly.find((m) => m.month === 1)
  const summer = data.monthly.find((m) => m.month === 6)

  return (
    <div className="space-y-6">
      <DayScatter date={date} onDate={setDate} />

      {/* ---------------------------------------------------------------- */}

      <StatGrid>
        <StatTile
          label="Gefälle im Mittel"
          value={`${signed(overall.gradH, 2)} K`}
          caption={`je 100 m über ${num(overall.days, 0)} Tage · R² ${num(overall.gradR2, 2)}`}
          accent="brand"
          icon={TrendingDown}
        />
        <StatTile
          label="Naiv gerechnet"
          value={`${signed(overall.lapse, 2)} K`}
          caption={`nur gegen die Höhe · R² ${num(
            overall.lapseR2,
            2,
          )} — zu flach, weil Lage mitspielt`}
          accent="neutral"
          icon={Layers}
        />
        <StatTile
          label="Im Januar"
          value={winter ? `${signed(winter.gradH, 2)} K` : '—'}
          caption={winter ? `gegen ${signed(summer?.gradH ?? 0, 2)} K im Juni` : undefined}
          accent="cold"
        />
        <StatTile
          label="Inversionstage"
          value={num(overall.inversionDays, 0)}
          caption={`${shareOf(overall.inversionDays / overall.days, 1)} aller Tage — im Januar ${
            winter ? shareOf(winter.inversionShare, 1) : '—'
          }`}
          accent="hot"
          icon={Mountain}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Layers}
          title="Im Jahresgang"
          hint="Das Gefälle ist im Sommer am steilsten und im Winter am flachsten — dort, wo die Inversionen sitzen."
        />

        <div className="mt-4">
          <ChartFrame height={280}>
            <ResponsiveContainer>
              <ComposedChart data={data.monthly} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: string) => v.slice(0, 3)}
                />
                <YAxis
                  yAxisId="k"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={56}
                  tickFormatter={(v: number) => `${num(v, 2)}`}
                />
                <YAxis
                  yAxisId="p"
                  orientation="right"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={44}
                  tickFormatter={(v: number) => `${num(v * 100, 0)} %`}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as LapseResponse['monthly'][number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        rows={[
                          {
                            label: 'Gefälle je 100 m',
                            value: `${signed(row.gradH, 2)} K`,
                            className: 'text-brand',
                          },
                          { label: 'naiv gerechnet', value: `${signed(row.lapse, 2)} K` },
                          { label: 'R²', value: num(row.gradR2, 2) },
                          {
                            label: 'Inversionstage',
                            value: shareOf(row.inversionShare, 1),
                            className: 'text-hot',
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: 'var(--color-chart-tick)' }}
                  iconType="plainline"
                />
                <Bar
                  yAxisId="p"
                  dataKey="inversionShare"
                  name="Anteil Inversionstage"
                  fill={CHART.colors.hot}
                  fillOpacity={0.45}
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="k"
                  type="monotone"
                  dataKey="gradH"
                  name="Gefälle je 100 m"
                  stroke={CHART.colors.brand}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="k"
                  type="monotone"
                  dataKey="lapse"
                  name="naiv gerechnet"
                  stroke={CHART.colors.neutral}
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-muted">
          Der Abstand zwischen durchgezogener und gestrichelter Linie ist der
          Fehler, den man macht, wenn man Temperatur nur gegen die Höhe rechnet.
          Er ist im Sommer am größten: dann ist das Nord-Süd-Gefälle am
          stärksten, und weil Deutschlands Höhen im Süden liegen, wird der Höhe
          umso mehr angelastet, was in Wahrheit die Lage ist.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={TrendingDown}
          title="Wie sich das Gefälle über die Tage verteilt"
          hint={`Ein Balken je ${num(data.binWidth, 2)} K. Alles rechts der Null ist ein Inversionstag.`}
        />

        <div className="mt-4">
          <ChartFrame height={260}>
            <ResponsiveContainer>
              <BarChart data={data.histogram} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="from"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => num(v, 1)}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={52}
                  tickFormatter={(v: number) => num(v, 0)}
                />
                <ReferenceLine x={0} stroke={CHART.colors.hot} strokeDasharray="4 3" />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as LapseResponse['histogram'][number]
                    return (
                      <ChartTooltip
                        title={`${signed(row.from, 2)} bis ${signed(row.to, 2)} K je 100 m`}
                        rows={[
                          { label: 'Tage', value: num(row.days, 0) },
                          { label: 'Anteil', value: shareOf(row.share, 2) },
                        ]}
                      />
                    )
                  }}
                />
                <Bar dataKey="days" radius={[2, 2, 0, 0]}>
                  {data.histogram.map((row) => (
                    <Cell
                      key={row.from}
                      fill={row.from >= 0 ? CHART.colors.hot : CHART.colors.brand}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Mountain}
          title={`Die ${data.top} stärksten Inversionslagen`}
          hint="Tage, an denen es über dem ganzen Land oben wärmer war als unten."
        />
        <div className="mt-4">
          <DayList days={data.inversions} tone="hot" />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Gerechnet wird eine einzige Gerade durch alle Stationen des Landes. Sie
          erkennt damit nur die großflächige Lage; eine Inversion, die nur bis
          800 m reicht, während es darüber normal abnimmt, bleibt in der Summe
          negativ. Ein niedriges R² an einem solchen Tag ist selbst die Auskunft,
          dass eine Gerade den Tag schlecht beschreibt.
        </p>
      </Card>

      <Card>
        <SectionHeading
          icon={TrendingDown}
          title={`Die ${data.top} Tage mit dem steilsten Gefälle`}
          hint="Klare, sonnige Frühjahrstage: unten heizt sich die Luft auf, oben liegt noch Schnee."
        />
        <div className="mt-4">
          <DayList days={data.steepest} tone="cold" />
        </div>
      </Card>
    </div>
  )
}
