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
import { AlertTriangle, CalendarRange, Snowflake, Sprout } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, shareOf, signed } from '../lib/format'
import { linearFit } from '../lib/stats'
import type { FrostRiskResponse, FrostVariant } from '../types'
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

const MONTHS = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** Day of year to a readable date; the year is irrelevant, only the position. */
function dayLabel(day: number): string {
  const at = new Date(Date.UTC(2001, 0, Math.round(day)))
  return `${at.getUTCDate()}. ${MONTHS[at.getUTCMonth()]}`
}

function trendOf(variant: FrostVariant, pick: (p: FrostVariant['points'][number]) => number) {
  return linearFit(variant.points.map((p) => ({ x: p.year, y: pick(p) })))
}

/* -------------------------------------------------------------------------- */

export function FrostRisk({
  stationId,
  stationName,
}: {
  stationId: string
  stationName: string
}) {
  const [variantKey, setVariantKey] = useUrlState<string>('auswahl', 'jan15')
  const { data, loading, error } = useApi<FrostRiskResponse>(
    `/api/weather/frost-risk?stationId=${stationId}`,
    [stationId],
  )

  if (loading && !data) return <Loading message="Spätfrostrisiko wird gerechnet …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const variant = data.variants.find((v) => v.key === variantKey) ?? data.variants[0]
  if (!variant) return null

  const { summary } = variant
  const startTrend = trendOf(variant, (p) => p.start)
  const frostTrend = trendOf(variant, (p) => p.frost)
  const windowTrend = trendOf(variant, (p) => p.window)

  const rows = variant.points.map((p) => ({
    ...p,
    // The band between the two dates is what the chart is about; recharts draws
    // it as an area stacked on the start line.
    base: p.start,
    span: Math.max(0, p.window),
  }))

  return (
    <div className="space-y-6">
      <InfoPanel title={`Spätfrostrisiko in ${stationName}`}>
        <p>
          Zwei Termine bewegen sich unabhängig voneinander. Der Vegetationsbeginn
          rückt vor — das misst dieses Projekt zweimal, einmal aus der
          Temperaturreihe und einmal völlig getrennt davon aus den Meldungen
          Freiwilliger, wann eine Hasel blühte. Der letzte Frühjahrsfrost bewegt
          sich <strong className="text-ink">nicht</strong>. Dazwischen liegt die
          Strecke, in der schon getrieben wird und es noch frieren kann.
        </p>
        <p>
          Beide Termine stammen aus der Reihe derselben Station. Der Beginn nach
          der Regel dieses Projekts: {data.runLength} aufeinanderfolgende Tage
          mit einem Tagesmittel ab {data.base} °C. Der letzte Frost: der späteste
          Tag mit einem Minimum unter 0 °C zwischen Februar und Juni.
        </p>
      </InfoPanel>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={AlertTriangle}
            title="Wie belastbar ist der Befund?"
            hint="Eine methodische Entscheidung verändert die Größe des Ergebnisses spürbar — deshalb stehen alle drei Varianten nebeneinander."
          />
          <ChoiceGroup
            label="Auswahl"
            value={variant.key}
            choices={data.variants.map((v) => ({ value: v.key, label: v.label }))}
            onChange={setVariantKey}
            size="sm"
          />
        </div>

        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
          Die Sechs-Tage-Regel wird ab dem 1. Januar geprüft. Ein milder
          Jahresanfang setzt den „Vegetationsbeginn" damit in die erste
          Januarwoche — dreizehnmal in {data.variants[0]?.range.years} Jahren,
          verteilt über die ganze Reihe. Diese Jahre sind keine Fehler, die warme
          Phase hat es gegeben; aber „das Wachstum begann am 1. Januar" ist keine
          Aussage, die man treffen will. Ohne sie schrumpft der Befund, ohne sich
          umzukehren.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Auswahl</th>
                <th className="px-2 py-2 text-right font-medium">Jahre</th>
                <th className="px-2 py-2 text-right font-medium">Fenster früher</th>
                <th className="px-2 py-2 text-right font-medium">Fenster heute</th>
                <th className="px-2 py-2 text-right font-medium">Zuwachs</th>
                <th className="px-2 py-2 text-right font-medium">je Jahrzehnt</th>
              </tr>
            </thead>
            <tbody>
              {data.variants.map((v) => {
                const fit = trendOf(v, (p) => p.window)
                const active = v.key === variant.key
                return (
                  <tr
                    key={v.key}
                    className={`border-b border-line/60 last:border-0 ${active ? 'bg-raised' : ''}`}
                  >
                    <td className="py-1.5 pr-3">
                      <span className={active ? 'text-ink' : 'text-ink-muted'}>{v.label}</span>
                      <span className="block text-[10px] text-ink-faint">{v.note}</span>
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                      {num(v.range.years, 0)}
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                      {num(v.summary.earlyWindow, 1)} d
                    </td>
                    <td className="numeric px-2 py-1.5 text-right font-semibold text-ink">
                      {num(v.summary.lateWindow, 1)} d
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-hot">
                      {shareOf(v.summary.lateWindow / v.summary.earlyWindow - 1)}
                    </td>
                    <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                      {fit ? `${signed(fit.slope * 10, 1)} d` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <StatGrid>
        <StatTile
          label="Vegetationsbeginn"
          value={dayLabel(summary.lateStart)}
          caption={`${summary.lateYears[0]}–${summary.lateYears[1]} · früher ${dayLabel(summary.earlyStart)}`}
          accent="good"
          icon={Sprout}
        />
        <StatTile
          label="Letzter Frost"
          value={dayLabel(summary.lateFrost)}
          caption={`${summary.lateYears[0]}–${summary.lateYears[1]} · früher ${dayLabel(summary.earlyFrost)}`}
          accent="cold"
          icon={Snowflake}
        />
        <StatTile
          label="Risikofenster heute"
          value={`${num(summary.lateWindow, 0)} Tage`}
          caption={`früher ${num(summary.earlyWindow, 0)} Tage — ${shareOf(summary.lateWindow / summary.earlyWindow - 1)} mehr`}
          accent="hot"
          icon={AlertTriangle}
        />
        <StatTile
          label="Betroffene Jahre"
          value={shareOf(summary.exposedShare)}
          caption={`${num(summary.exposedYears, 0)} von ${num(variant.range.years, 0)} Jahren mit Frost nach dem Beginn`}
          accent="warm"
          icon={CalendarRange}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={CalendarRange}
          title="Die beiden Termine über die Jahre"
          hint="Die untere Linie ist der Vegetationsbeginn, die obere der letzte Frost. Die Fläche dazwischen ist das Risiko."
        />

        <div className="mt-4">
          <ChartFrame height={360}>
            <ResponsiveContainer>
              <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} minTickGap={40} />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={64}
                  tickFormatter={dayLabel}
                  domain={['dataMin - 5', 'dataMax + 5']}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof rows)[number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        rows={[
                          { label: 'Vegetationsbeginn', value: isoToGerman(row.startDate) },
                          {
                            label: 'Letzter Frost',
                            value: row.frostDate
                              ? `${isoToGerman(row.frostDate)} · ${num(row.frostTemp ?? 0, 1)} °C`
                              : '—',
                          },
                          {
                            label: 'Risikofenster',
                            value: `${num(row.window, 0)} Tage`,
                            className: row.window > 60 ? 'text-hot' : 'text-ink',
                          },
                          {
                            label: 'Frosttage Feb–Juni',
                            value: num(row.frostDays, 0),
                          },
                        ]}
                      />
                    )
                  }}
                />
                {/* Invisible base plus a visible span: the stack is what makes
                    the band sit between the two dates instead of on the axis. */}
                <Area
                  type="monotone"
                  dataKey="base"
                  stackId="risk"
                  stroke="none"
                  fill="none"
                />
                <Area
                  type="monotone"
                  dataKey="span"
                  stackId="risk"
                  stroke="none"
                  fill={CHART.colors.hot}
                  fillOpacity={0.14}
                />
                <Line
                  type="monotone"
                  dataKey="start"
                  stroke={CHART.colors.good}
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="frost"
                  stroke={CHART.colors.cold}
                  strokeWidth={1.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <ul className="mt-4 space-y-1 border-t border-line pt-3 text-[11px] text-ink-muted">
          <li>
            <span className="text-good">Vegetationsbeginn</span>:{' '}
            {startTrend ? (
              <>
                <span className="numeric">{signed(startTrend.slope * 10, 1)} Tage</span> je
                Jahrzehnt, R² {num(startTrend.r2, 2)}
                {startTrend.isSignificant ? '' : ' — nicht signifikant'}
              </>
            ) : (
              '—'
            )}
          </li>
          <li>
            <span className="text-cold">Letzter Frost</span>:{' '}
            {frostTrend ? (
              <>
                <span className="numeric">{signed(frostTrend.slope * 10, 1)} Tage</span> je
                Jahrzehnt, R² {num(frostTrend.r2, 2)}
                {frostTrend.isSignificant ? '' : ' — nicht signifikant'}
              </>
            ) : (
              '—'
            )}
          </li>
          <li>
            <span className="text-hot">Risikofenster</span>:{' '}
            {windowTrend ? (
              <>
                <span className="numeric">{signed(windowTrend.slope * 10, 1)} Tage</span> je
                Jahrzehnt, R² {num(windowTrend.r2, 2)}
                {windowTrend.isSignificant ? '' : ' — nicht signifikant'}
              </>
            ) : (
              '—'
            )}
          </li>
        </ul>

        <p className="mt-3 text-[11px] text-ink-faint">
          Das Fenster wächst nicht, weil der Frost später käme — er kommt
          praktisch unverändert. Es wächst, weil das Wachstum früher beginnt. Ein
          negatives Fenster bedeutet, dass der letzte Frost vor dem Beginn lag;
          solche Jahre bleiben in der Rechnung, denn sie wegzulassen würde den
          Mittelwert nach oben verzerren.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading icon={AlertTriangle} title="Das größte Fenster der Reihe" />
        <p className="mt-3 text-xs text-ink-muted">
          <span className="numeric text-2xl font-semibold text-ink">
            {num(summary.widest.window, 0)} Tage
          </span>{' '}
          im Jahr {summary.widest.year}: Wachstumsbeginn am{' '}
          {isoToGerman(summary.widest.startDate)}, letzter Frost am{' '}
          {summary.widest.frostDate ? isoToGerman(summary.widest.frostDate) : '—'} mit{' '}
          {num(summary.widest.frostTemp ?? 0, 1)} °C.
        </p>
      </Card>
    </div>
  )
}
