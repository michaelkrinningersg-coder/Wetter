import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Snowflake, TrendingDown, TrendingUp } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { num } from '../lib/format'
import { centeredMovingAverage, extremeBy, linearFit, mean } from '../lib/stats'
import type { ExtraIndicesResponse } from '../types'
import {
  Card,
  CHART,
  ChartFrame,
  ChartTooltip,
  ChoiceGroup,
  EmptyState,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/** Centred window for the smoothing line, in years. */
const SMOOTHING = 11

export function Indices({ stationId }: { stationId: string }) {
  const [selected, setSelected] = useUrlState<string>('kenngroesse', null)

  const { data, loading, error, reload } = useApi<ExtraIndicesResponse>(
    `/api/weather/indices?stationId=${encodeURIComponent(stationId)}`,
    [stationId],
  )

  const active = useMemo(() => {
    if (!data || data.indices.length === 0) return null
    return data.indices.find((i) => i.key === selected) ?? data.indices[0]!
  }, [data, selected])

  const points = useMemo(() => {
    if (!data || !active) return []
    return data.series[active.key] ?? []
  }, [data, active])

  const smoothed = useMemo(
    () =>
      centeredMovingAverage(
        points.map((p) => ({ x: p.year, y: p.value })),
        SMOOTHING,
      ),
    [points],
  )

  const fit = useMemo(
    () => linearFit(points.map((p) => ({ x: p.year, y: p.value }))),
    [points],
  )

  if (loading) return <Loading message="Kenngrößen werden berechnet…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data || !active) {
    return (
      <Card>
        <SectionHeading icon={Snowflake} title="Weitere Kenngrößen" />
        <EmptyState message="Für diese Station liegen keine dieser Messgrößen vor." />
      </Card>
    )
  }

  const chartData = points.map((p) => ({
    year: p.year,
    value: p.value,
    // centeredMovingAverage already returns a Map keyed by year.
    smooth: smoothed.get(p.year) ?? null,
    trend: fit ? fit.at(p.year) : null,
  }))

  const perDecade = fit ? fit.slope * 10 : null
  const highest = extremeBy(points, (p) => p.value, 'max')
  const lowest = extremeBy(points, (p) => p.value, 'min')
  const average = mean(points.map((p) => p.value))

  // Which way is "more"? Snow days falling and sultry days rising are the same
  // story; colouring both by sign alone would tell it twice in opposite ways.
  const risingIsWarm = active.key !== 'snow_days' && active.key !== 'snow_max'
  const trendAccent =
    perDecade === null || Math.abs(perDecade) < 1e-9
      ? 'neutral'
      : (perDecade > 0) === risingIsWarm
        ? 'hot'
        : 'cold'

  return (
    <>
      <InfoPanel icon={Snowflake} title="Weitere Kenngrößen">
        <p>
          Schneehöhe, Bewölkung, Luftfeuchte, Dampfdruck, Sonnenscheindauer und
          das Erdbodenminimum stehen seit jeher in den DWD-Tagesarchiven, wurden
          von dieser App aber lange überlesen. Für Göttingen sind sie kein
          Nebenwert: die Bewölkung reicht bis <strong>1860</strong> zurück, die
          Feuchte und die Schneehöhe bis <strong>1858</strong>.
        </p>
        <p>
          Die Schwellen stehen unter jeder Größe, damit sie nachprüfbar sind —
          zwei davon sind Konventionen und keine Physik. Es gilt weiter die
          90-%-Regel, und zwar je Spalte: Göttingen misst die Bewölkung seit
          1860, die Sonnenscheindauer erst seit 1927, und ein Jahr mit zweihundert
          Bewölkungswerten ergäbe viel zu wenige heitere Tage.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          title="Größe"
          hint={`${active.note} · ${active.first}–${active.last}, ${num(active.years, 0)} auswertbare Jahre.`}
        />
        <ChoiceGroup
          label="Kenngröße"
          value={active.key}
          choices={data.indices.map((i) => ({ value: i.key, label: i.label }))}
          onChange={setSelected}
          size="sm"
        />
      </Card>

      <Card>
        <SectionHeading
          title={`${active.label} je Jahr`}
          hint={`Punkte sind Jahreswerte, die dicke Linie das zentrierte ${SMOOTHING}-Jahres-Mittel, die Gerade der lineare Trend.`}
        />

        <StatGrid>
          <StatTile
            label="Mittel der Reihe"
            value={average === null ? '—' : `${num(average, active.decimals)} ${active.unit}`}
            caption={`${active.first}–${active.last}`}
            accent="neutral"
          />
          <StatTile
            label="Höchster Wert"
            value={highest ? `${num(highest.value, active.decimals)} ${active.unit}` : '—'}
            caption={highest ? String(highest.year) : undefined}
            accent="hot"
          />
          <StatTile
            label="Niedrigster Wert"
            value={lowest ? `${num(lowest.value, active.decimals)} ${active.unit}` : '—'}
            caption={lowest ? String(lowest.year) : undefined}
            accent="cold"
          />
          <StatTile
            label="Trend je Jahrzehnt"
            value={
              perDecade === null
                ? '—'
                : `${perDecade > 0 ? '+' : ''}${num(perDecade, active.decimals === 0 ? 2 : active.decimals + 1)} ${active.unit}`
            }
            caption={
              fit
                ? `R² ${num(fit.r2, 2)} · ${fit.isSignificant ? 'signifikant' : 'nicht signifikant'} (95 %)`
                : undefined
            }
            accent={trendAccent}
            icon={perDecade !== null && perDecade > 0 ? TrendingUp : TrendingDown}
          />
        </StatGrid>

        <div className="mt-5">
          <ChartFrame>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={52}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => num(v, active.decimals)}
                />
                <Tooltip
                  content={({ active: on, payload, label }) =>
                    on && payload?.length ? (
                      <ChartTooltip
                        title={String(label)}
                        rows={payload
                          .filter((p) => p.value !== null && p.value !== undefined)
                          .map((p) => ({
                            label:
                              p.dataKey === 'value'
                                ? active.label
                                : p.dataKey === 'smooth'
                                  ? `${SMOOTHING}-Jahres-Mittel`
                                  : 'Trend',
                            value: `${num(Number(p.value), active.decimals)} ${active.unit}`,
                            color: p.color,
                          }))}
                      />
                    ) : null
                  }
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={CHART.colors.brand}
                  strokeWidth={1}
                  fill={CHART.colors.brand}
                  fillOpacity={0.12}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="smooth"
                  stroke={CHART.colors.warm}
                  strokeWidth={2.4}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="trend"
                  stroke={CHART.colors.neutral}
                  strokeWidth={1.4}
                  strokeDasharray="6 4"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <p className="mt-3 text-[11px] text-ink-faint">
          {active.note}. Das gleitende Mittel ist zentriert und endet daher{' '}
          {Math.floor(SMOOTHING / 2)} Jahre vor dem Reihenende.
        </p>
      </Card>
    </>
  )
}
