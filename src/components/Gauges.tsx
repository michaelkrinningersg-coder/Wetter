import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Droplet,
  RefreshCw,
  Waves,
} from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num } from '../lib/format'
import type { GaugeSeriesResponse, GaugeSummary, GaugesResponse } from '../types'
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

/**
 * From a year on, the server answers with one row per day rather than every
 * reading — the chart then draws the day's range as a band and its mean as the
 * line. `alle` is the whole archive, which grows for as long as the app runs.
 */
const RANGES = [
  { value: '1', label: '24 Stunden' },
  { value: '7', label: '7 Tage' },
  { value: '30', label: '30 Tage' },
  { value: '365', label: 'Jahr' },
  { value: 'alle', label: 'Alles' },
] as const

type Range = (typeof RANGES)[number]['value']

/** Reference lines drawn into the chart, in drawing order. */
const MARKS = [
  { key: 'meanLow', label: 'MNW', color: CHART.colors.dry, dash: '4 4' },
  { key: 'mean', label: 'MW', color: CHART.colors.neutral, dash: '6 3' },
  { key: 'meanHigh', label: 'MHW', color: CHART.colors.wet, dash: '4 4' },
] as const

function cm(value: number | null | undefined, digits = 0) {
  return num(value, digits, 'cm')
}

/** "2026-07-31T22:00:00+02:00" -> "31.07. 22:00" */
function shortTime(iso: string) {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  return m ? `${m[3]}.${m[2]}. ${m[4]}:${m[5]}` : iso
}

function TrendIcon({ trend }: { trend?: string | null }) {
  if (!trend) return null
  if (/steigend/i.test(trend)) return <ArrowUpRight className="size-4 text-warm" aria-hidden />
  if (/fallend|sinkend/i.test(trend)) return <ArrowDownRight className="size-4 text-cool" aria-hidden />
  return <ArrowRight className="size-4 text-ink-faint" aria-hidden />
}

export function Gauges() {
  const [range, setRange] = useUrlState<Range>('zeitraum', '30', {
    allowed: RANGES.map((r) => r.value),
  })
  const [selected, setSelected] = useUrlState<string>('pegel', null)
  const [refreshing, setRefreshing] = useState(false)

  // The cards summarise the same window the chart draws — otherwise "Alles"
  // would show an all-time curve above a thirty-day minimum.
  const { data, loading, error, reload } = useApi<GaugesResponse>(
    `/api/gauges?days=${range}`,
    [range],
  )

  const gauges = useMemo(() => data?.gauges ?? [], [data])
  const active = useMemo(
    () => gauges.find((g) => g.id === selected) ?? gauges[0] ?? null,
    [gauges, selected],
  )

  useEffect(() => {
    if (!selected && gauges.length > 0) setSelected(gauges[0]!.id)
  }, [gauges, selected, setSelected])

  const series = useApi<GaugeSeriesResponse>(
    active ? `/api/gauges/${active.id}/series?days=${range}` : null,
    [active?.id, range],
  )

  const daily = series.data?.mode === 'daily'
  const rangeLabel = { '1': '24 Std.', '7': '7 T.', '30': '30 T.', '365': 'Jahr', alle: 'gesamt' }[
    range
  ]

  /**
   * One shape for both answers.
   *
   * A raw reading has a single value; a day has a lowest, a mean and a highest.
   * Giving both the same `value` — the reading itself, or the day's mean — lets
   * the reference-level arithmetic and the tooltip stay as they were, while
   * `low` and `high` exist only in the daily case and carry the band.
   */
  const points = useMemo(() => {
    if (!series.data) return []
    if (series.data.mode === 'daily') {
      return series.data.daily.map((d) => ({
        ts: d.date,
        label: isoToGerman(d.date),
        value: d.mean,
        low: d.min,
        high: d.max,
        // Recharts stacks an Area on top of its base, so the band is drawn as
        // "lowest" plus "how far up the highest reaches".
        span: d.max - d.min,
        count: d.count,
      }))
    }
    return series.data.readings.map((r) => ({
      ts: r.ts,
      label: shortTime(r.ts),
      value: r.value,
      low: undefined as number | undefined,
      high: undefined as number | undefined,
      span: undefined as number | undefined,
      count: 1,
    }))
  }, [series.data])

  /**
   * The band's own extent, as an explicit axis domain.
   *
   * `['dataMin', 'dataMax']` cannot be used once the band is drawn: a stacked
   * area has zero as its base, so recharts pulls the axis down to 0 cm and a
   * river that moved between 88 and 163 cm is squashed into the top sixth of
   * the chart.
   */
  const bounds = useMemo(() => {
    if (points.length === 0) return null
    const values = points.flatMap((p) => [p.low ?? p.value, p.high ?? p.value])
    return [Math.min(...values), Math.max(...values)] as const
  }, [points])

  /**
   * Which reference levels actually fall inside the plotted range.
   *
   * The chart is scaled to the measurements, because a few centimetres of
   * day-to-day movement is the interesting part. Stretching the axis up to
   * Meldestufe 1 — 324 cm above the current level at Wahmbeck — would flatten
   * the curve into a straight line. Levels outside the range are therefore not
   * drawn but listed underneath with their distance.
   */
  const levels = useMemo(() => {
    if (!active || points.length === 0) return { inside: [], outside: [] }

    const [min, max] = bounds ?? [0, 0]

    const candidates: { label: string; cm: number; color: string; dash: string }[] = []
    for (const mark of MARKS) {
      const level = active.characteristic?.[mark.key]
      if (level) {
        candidates.push({ label: mark.label, cm: level.cm, color: mark.color, dash: mark.dash })
      }
    }
    for (const t of active.thresholds ?? []) {
      candidates.push({
        label: `Meldestufe ${t.level}`,
        cm: t.cm,
        color: CHART.colors.warm,
        dash: '2 4',
      })
    }

    return {
      inside: candidates.filter((c) => c.cm >= min && c.cm <= max),
      outside: candidates
        .filter((c) => c.cm < min || c.cm > max)
        .sort((a, b) => a.cm - b.cm),
    }
  }, [active, points, bounds])

  async function refreshNow() {
    setRefreshing(true)
    try {
      await fetch('/api/gauges/refresh', { method: 'POST' })
      reload()
      series.reload()
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) return <Loading message="Rufe Pegelstände ab…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  return (
    <>
      <InfoPanel icon={Waves} title="Flusspegel im Einzugsgebiet">
        Drei Pegel rund um Göttingen. Sie stammen aus{' '}
        <strong>zwei verschiedenen Quellen</strong>, weil sie an unterschiedlichen
        Gewässern liegen: Die Weser ist Bundeswasserstraße, deshalb liefert{' '}
        <strong>PEGELONLINE der WSV</strong> für Wahmbeck eine offene Schnittstelle mit
        rollierenden 30 Tagen im 15-Minuten-Takt. Leine und Rhume sind Landesgewässer;
        das <strong>NLWKN-Portal</strong> veröffentlicht dort nur den aktuellen Wert,
        keine Zeitreihe. Für diese beiden baut die App ihre Reihe daher selbst auf:
        Sie holt die aktuellen Werte stündlich, solange sie läuft, und schreibt sie als
        CSV mit. Daraus folgt eine Eigenheit dieser beiden Kurven, die die Weser nicht
        hat: Was gemessen wurde, während das Programm geschlossen war, existiert nicht
        und lässt sich auch nicht nachholen — die Weser dagegen liefert ihre letzten 30
        Tage bei jedem Abruf mit. Alle Angaben in Zentimeter über Pegelnullpunkt.
      </InfoPanel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {gauges.map((g) => (
          <GaugeCard
            key={g.id}
            gauge={g}
            active={g.id === active?.id}
            onSelect={() => setSelected(g.id)}
          />
        ))}
      </div>

      {active && (
        <Card>
          <SectionHeading
            title={`Verlauf — ${active.water} bei ${active.name}`}
            hint={
              (active.source === 'pegelonline'
                ? 'Gemessen im 15-Minuten-Takt, rollierend über 30 Tage. '
                : 'Diese Reihe wächst mit jedem Abruf, da die Quelle keine Historie herausgibt. ') +
              'Die Achse ist auf die Messwerte skaliert; Kennwerte und Meldestufen erscheinen als waagerechte Linien, sofern sie in diesen Bereich fallen.'
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <ChoiceGroup
                  label="Zeitraum"
                  value={range}
                  choices={RANGES}
                  onChange={setRange}
                  size="sm"
                />
                <button
                  type="button"
                  onClick={refreshNow}
                  disabled={refreshing}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-brand hover:text-brand disabled:cursor-wait"
                >
                  <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
                  Aktualisieren
                </button>
              </div>
            }
          />

          {points.length < 2 ? (
            <div className="rounded-card border border-line bg-raised px-5 py-10 text-center">
              <Droplet className="mx-auto size-8 text-ink-faint" aria-hidden />
              <p className="mt-3 text-xs text-ink-muted">
                Für diesen Pegel liegen bisher {points.length}{' '}
                {points.length === 1 ? 'Messwert' : 'Messwerte'} vor.
              </p>
              <p className="mx-auto mt-1 max-w-md text-[11px] text-ink-faint">
                Das NLWKN-Portal gibt keine Zeitreihe heraus. Die Kurve entsteht ab dem
                ersten Abruf und füllt sich mit jedem weiteren.
              </p>
            </div>
          ) : (
            <ChartFrame height={380}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, left: -14, bottom: 4 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    stroke={CHART.axis}
                    tick={{ ...CHART.tick, fontSize: 10 }}
                    tickLine={false}
                    minTickGap={48}
                  />
                  <YAxis
                    stroke={CHART.axis}
                    tick={CHART.tick}
                    tickLine={false}
                    unit=" cm"
                    width={62}
                    domain={bounds ? [bounds[0], bounds[1]] : ['dataMin', 'dataMax']}
                    allowDataOverflow
                  />
                  <Tooltip content={<GaugeTooltip gauge={active} />} />
                  <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 11 }} />

                  {levels.inside.map((level) => (
                    <ReferenceLine
                      key={level.label}
                      y={level.cm}
                      stroke={level.color}
                      strokeDasharray={level.dash}
                      label={{
                        value: `${level.label} ${level.cm}`,
                        position: 'insideRight',
                        fill: level.color,
                        fontSize: 10,
                      }}
                    />
                  ))}

                  {/* The band is two stacked areas: an invisible one up to the
                      day's lowest reading, and a visible one as tall as the
                      day's swing. Recharts has no ranged area, and this is the
                      standard way to get one. */}
                  {daily && (
                    <>
                      <Area
                        stackId="band"
                        dataKey="low"
                        stroke="none"
                        fill="none"
                        legendType="none"
                        tooltipType="none"
                        isAnimationActive={false}
                      />
                      <Area
                        name="Tagesspanne"
                        stackId="band"
                        dataKey="span"
                        stroke="none"
                        fill={CHART.colors.cool}
                        fillOpacity={0.18}
                        tooltipType="none"
                        isAnimationActive={false}
                      />
                    </>
                  )}

                  <Line
                    name={daily ? 'Tagesmittel' : 'Wasserstand'}
                    type="monotone"
                    dataKey="value"
                    stroke={CHART.colors.cool}
                    strokeWidth={2}
                    dot={points.length < 60 ? { r: 2 } : false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}

          {levels.outside.length > 0 && active.latest && (
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Außerhalb des dargestellten Bereichs:{' '}
              {levels.outside.map((level, i) => (
                <span key={level.label}>
                  {i > 0 && ' · '}
                  <span className="text-ink-muted">{level.label}</span>{' '}
                  <span className="numeric">{level.cm} cm</span>{' '}
                  <span className="numeric">
                    ({level.cm > active.latest!.value ? '+' : '−'}
                    {Math.abs(level.cm - active.latest!.value)} cm)
                  </span>
                </span>
              ))}
            </p>
          )}

          {active.window.count > 1 && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="label">Niedrigster Wert ({rangeLabel})</dt>
                <dd className="numeric mt-0.5 font-semibold text-cool">
                  {cm(active.window.min)}
                </dd>
              </div>
              <div>
                <dt className="label">Höchster Wert ({rangeLabel})</dt>
                <dd className="numeric mt-0.5 font-semibold text-wet">
                  {cm(active.window.max)}
                </dd>
              </div>
              <div>
                <dt className="label">Mittel ({rangeLabel})</dt>
                <dd className="numeric mt-0.5 font-semibold text-ink">
                  {cm(active.window.mean, 1)}
                </dd>
              </div>
              <div>
                <dt className="label">Messwerte im Archiv</dt>
                <dd className="numeric mt-0.5 font-semibold text-ink-muted">
                  {(active.archive?.count ?? active.window.count).toLocaleString('de-DE')}
                </dd>
              </div>
            </dl>
          )}
        </Card>
      )}

      {active && <Thresholds gauge={active} />}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function GaugeCard({
  gauge,
  active,
  onSelect,
}: {
  gauge: GaugeSummary
  active: boolean
  onSelect: () => void
}) {
  const value = gauge.latest?.value ?? gauge.current?.cm ?? null
  const alarm = gauge.currentLevel ?? 0

  // Where the current level sits between the mean low water and the first
  // flood warning threshold — the range that actually matters day to day.
  const low = gauge.characteristic?.meanLow?.cm ?? 0
  const high = gauge.thresholds?.[0]?.cm ?? gauge.characteristic?.meanHigh?.cm ?? 100
  const fill =
    value === null ? 0 : Math.max(2, Math.min(100, ((value - low) / (high - low)) * 100))

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`rounded-card border p-4 text-left transition-colors ${
        active ? 'border-brand bg-brand/[0.07]' : 'border-line bg-surface hover:border-line-strong'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label">{gauge.water}</p>
          <h3 className="text-sm font-semibold text-ink">{gauge.name}</h3>
        </div>
        {alarm > 0 ? (
          <span className="flex items-center gap-1 rounded bg-warm/15 px-1.5 py-0.5 text-[10px] font-semibold text-warm">
            <AlertTriangle className="size-3" aria-hidden />
            Meldestufe {alarm}
          </span>
        ) : (
          <span className="rounded bg-good/10 px-1.5 py-0.5 text-[10px] font-medium text-good">
            unterhalb Meldestufe 1
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="numeric text-3xl font-semibold tracking-tight text-ink">
          {cm(value)}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-ink-muted">
          <TrendIcon trend={gauge.trend} />
          {gauge.trend ?? '—'}
          {gauge.change !== null && gauge.change !== undefined && gauge.change !== 0 && (
            <span className="numeric">
              ({gauge.change > 0 ? '+' : '−'}
              {Math.abs(gauge.change)} cm)
            </span>
          )}
        </span>
      </div>

      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
          <div
            className={`h-full ${alarm > 0 ? 'bg-warm' : 'bg-cool'}`}
            style={{ width: `${fill}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
          <span className="numeric">MNW {low}</span>
          <span className="numeric">Meldestufe 1 {high}</span>
        </div>
      </div>

      <p className="numeric mt-3 border-t border-line pt-2 text-[10px] text-ink-faint">
        {gauge.latest ? shortTime(gauge.latest.ts) : '—'} · Einzugsgebiet{' '}
        {gauge.catchment.toLocaleString('de-DE')} km²
      </p>
    </button>
  )
}

/* -------------------------------------------------------------------------- */

function Thresholds({ gauge }: { gauge: GaugeSummary }) {
  const c = gauge.characteristic
  const rows: { label: string; value: number | null; note?: string; className?: string }[] = [
    {
      label: 'Niedrigster Wasserstand',
      value: c?.lowest?.cm ?? null,
      note: c?.lowest?.date ? isoToGerman(c.lowest.date.slice(0, 10)) : undefined,
      className: 'text-cool',
    },
    { label: 'Mittlerer Niedrigwasserstand (MNW)', value: c?.meanLow?.cm ?? null },
    { label: 'Mittlerer Wasserstand (MW)', value: c?.mean?.cm ?? null, className: 'text-ink' },
    { label: 'Mittlerer Hochwasserstand (MHW)', value: c?.meanHigh?.cm ?? null, className: 'text-wet' },
    {
      label: 'Höchster Wasserstand',
      value: c?.highest?.cm ?? null,
      note: c?.highest?.date ? isoToGerman(c.highest.date.slice(0, 10)) : undefined,
      className: 'text-warm',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <SectionHeading
          title="Kennwerte und Meldestufen"
          hint={
            c?.period
              ? `Hauptwerte für den Zeitraum ${c.period}.`
              : 'Langjährige Kennwerte der Messstelle.'
          }
        />
        <table className="w-full text-left text-xs">
          <tbody className="divide-y divide-line/60">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-2 pr-3 text-ink-muted">{r.label}</td>
                <td className={`numeric py-2 text-right font-semibold ${r.className ?? 'text-ink-muted'}`}>
                  {cm(r.value)}
                </td>
                <td className="numeric py-2 pl-3 text-right text-[11px] text-ink-faint">
                  {r.note ?? ''}
                </td>
              </tr>
            ))}
            {gauge.thresholds?.map((t) => (
              <tr key={`ms${t.level}`} className="bg-warm/[0.04]">
                <td className="py-2 pr-3 text-warm">Meldestufe {t.level}</td>
                <td className="numeric py-2 text-right font-semibold text-warm">
                  {cm(t.cm)}
                </td>
                <td className="numeric py-2 pl-3 text-right text-[11px] text-ink-faint">
                  {t.mNN !== null ? `NN + ${num(t.mNN, 2)} m` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <SectionHeading
          title="Höchste je gemessene Wasserstände"
          hint={
            gauge.extremes?.period
              ? `Extremwerte für den Zeitraum ${gauge.extremes.period}.`
              : undefined
          }
        />
        <table className="w-full text-left text-xs">
          <tbody className="divide-y divide-line/60">
            {(gauge.extremes?.records ?? []).map((r, i) => (
              <tr key={r.date ?? i}>
                <td className="py-2 pr-3">
                  <span
                    className={`numeric inline-grid size-6 place-items-center rounded text-[10px] font-bold ${
                      i === 0 ? 'bg-brand text-canvas' : 'bg-inset text-ink-faint'
                    }`}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="numeric py-2 text-ink-muted">
                  {r.date ? isoToGerman(r.date.slice(0, 10)) : '—'}
                </td>
                <td className="numeric py-2 text-right font-semibold text-warm">
                  {cm(r.cm)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(gauge.floodScenarios?.length ?? 0) > 0 && (
          <>
            <p className="label mt-5 mb-2">Berechnete Überflutungsszenarien</p>
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-line/60">
                {gauge.floodScenarios!.map((f) => (
                  <tr key={f.label}>
                    <td className="py-2 pr-3 text-ink-muted">{f.label}</td>
                    <td className="numeric py-2 text-right font-semibold text-cold">
                      {cm(f.cm)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          Quelle:{' '}
          <a
            href={gauge.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-line-strong underline-offset-2 hover:text-brand"
          >
            {gauge.operator ?? 'NLWKN'}
          </a>
          {gauge.source === 'pegelonline' && ' · Messwerte über PEGELONLINE der WSV'}
          . Alle Angaben ohne Gewähr.
        </p>
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function GaugeTooltip({
  active,
  payload,
  gauge,
}: {
  active?: boolean
  payload?: {
    payload: {
      ts: string
      value: number
      low?: number
      high?: number
      count: number
    }
  }[]
  gauge: GaugeSummary
}) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null

  const datum = gauge.gaugeDatum
  const reached = (gauge.thresholds ?? []).filter((t) => p.value >= t.cm).pop()
  const isDay = p.low !== undefined && p.high !== undefined

  return (
    <ChartTooltip
      title={isDay ? isoToGerman(p.ts) : shortTime(p.ts)}
      rows={[
        {
          label: isDay ? 'Tagesmittel' : 'Wasserstand',
          value: cm(p.value, isDay ? 1 : 0),
          className: 'text-cool',
        },
        // A day whose lowest and highest coincide had one reading, and saying
        // "35 bis 35 cm" would dress that up as a measured range.
        ...(isDay && p.high! > p.low!
          ? [{ label: 'Tiefst- bis Höchstwert', value: `${cm(p.low)} – ${cm(p.high)}` }]
          : []),
        ...(isDay
          ? [{ label: 'Messwerte', value: num(p.count, 0) }]
          : []),
        ...(datum
          ? [{ label: 'Absolut', value: `NN + ${num(datum + p.value / 100, 2)} m` }]
          : []),
        ...(gauge.characteristic?.mean
          ? [
              {
                label: 'Abw. zum Mittelwasser',
                value: `${p.value >= gauge.characteristic.mean.cm ? '+' : '−'}${Math.abs(
                  p.value - gauge.characteristic.mean.cm,
                )} cm`,
                className:
                  p.value >= gauge.characteristic.mean.cm ? 'text-wet' : 'text-dry',
              },
            ]
          : []),
      ]}
      footer={reached ? `Meldestufe ${reached.level} erreicht` : 'unterhalb Meldestufe 1'}
    />
  )
}
