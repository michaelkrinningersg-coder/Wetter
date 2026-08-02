import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowDownWideNarrow, CalendarRange, Flag, Mountain } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num, percent } from '../lib/format'
import type {
  NationalFieldResponse,
  NationalOverviewResponse,
  NationalSummary,
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

/**
 * A percentile's colour.
 *
 * Diverging around 50, because the middle is the meaningful anchor here: the
 * question is not "how much" but "which side of the country". The same hues as
 * the heatmap so both read as one system.
 */
function shade(percentile: number): string {
  if (percentile >= 50) return CHART.colors.warm
  return CHART.colors.cold
}

function Ranking({
  summary,
  field,
  title,
  hint,
}: {
  summary: NationalSummary
  field: { short: string; unit: string; decimals: number; high: string; low: string }
  title: string
  hint: string
}) {
  return (
    <Card>
      <SectionHeading icon={ArrowDownWideNarrow} title={title} hint={hint} />

      <div className="mt-4">
        <StatGrid>
          <StatTile
            label="Mittleres Perzentil"
            value={percent(summary.mean, 1)}
            caption={`aus ${num(summary.days, 0)} Tagen · 50 % wäre exakt Landesmitte`}
            accent={summary.mean >= 50 ? 'warm' : 'cold'}
            icon={Flag}
          />
          <StatTile
            label={`Tage im obersten Zehntel`}
            value={num(summary.top, 0)}
            caption={`${field.high} als 90 % Deutschlands`}
            accent="hot"
          />
          <StatTile
            label="Tage im untersten Zehntel"
            value={num(summary.bottom, 0)}
            caption={`${field.low} als 90 % Deutschlands`}
            accent="cool"
          />
        </StatGrid>
      </div>

      <ul className="mt-4 space-y-1 border-t border-line pt-3 text-[11px] text-ink-muted">
        <li>
          Höchster Stand: <span className="text-ink">{isoToGerman(summary.highest.date)}</span> mit{' '}
          <span className="numeric text-ink">
            {num(summary.highest.value, field.decimals)} {field.unit}
          </span>{' '}
          — Platz {num(summary.highest.rank, 0)} von {num(summary.highest.total, 0)}.
        </li>
        <li>
          Niedrigster Stand: <span className="text-ink">{isoToGerman(summary.lowest.date)}</span> mit{' '}
          <span className="numeric text-ink">
            {num(summary.lowest.value, field.decimals)} {field.unit}
          </span>{' '}
          — Platz {num(summary.lowest.rank, 0)} von {num(summary.lowest.total, 0)}.
        </li>
      </ul>

      {summary.monthly.length > 0 && (
        <div className="mt-5">
          <p className="label mb-2">Mittleres Perzentil nach Monat</p>
          <ChartFrame height={230}>
            <ResponsiveContainer>
              <BarChart data={summary.monthly} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(l: string) => l.slice(0, 3)}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={40}
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}`}
                />
                <ReferenceLine y={50} stroke={CHART.axis} strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof summary.monthly)[number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        subtitle={`${num(row.days, 0)} Tage im Archiv`}
                        rows={[
                          { label: 'Mittleres Perzentil', value: percent(row.mean, 1) },
                          {
                            label: 'Lesart',
                            value:
                              row.mean >= 50
                                ? `${field.high} als die Landesmitte`
                                : `${field.low} als die Landesmitte`,
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Bar dataKey="mean" radius={[3, 3, 0, 0]}>
                  {summary.monthly.map((m) => (
                    <Cell key={m.month} fill={shade(m.mean)} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */

function FieldDetail({ fieldKey }: { fieldKey: string }) {
  const [scope, setScope] = useUrlState<string>('wertung', 'all', {
    allowed: ['all', 'lowland'],
  })
  const { data, loading, error } = useApi<NationalFieldResponse>(
    `/api/national/field?field=${fieldKey}`,
    [fieldKey],
  )

  if (loading && !data) return <Loading message="Bundesvergleich wird gerechnet …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const chosen = scope === 'lowland' ? data.lowland : data.all
  const { field } = data

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={CalendarRange}
            title={`Täglicher Stand — ${field.label}`}
            hint="Jeder Punkt ein Tag: 100 heißt höchster Wert Deutschlands, 0 der niedrigste."
          />
          <ChoiceGroup
            label="Wertung"
            value={scope}
            choices={[
              { value: 'all', label: 'Alle Stationen' },
              { value: 'lowland', label: `unter ${data.lowlandLimit} m` },
            ]}
            onChange={setScope}
            size="sm"
          />
        </div>

        <div className="mt-4">
          <ChartFrame height={300}>
            <ResponsiveContainer>
              <AreaChart
                data={chosen.points}
                margin={{ top: 8, right: 16, bottom: 4, left: 4 }}
              >
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  minTickGap={56}
                  tickFormatter={(d: string) => isoToGerman(d).slice(0, 6)}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={40}
                  domain={[0, 100]}
                  label={{
                    value: 'Perzentil',
                    angle: -90,
                    position: 'insideLeft',
                    fill: CHART.axis,
                    fontSize: 11,
                  }}
                />
                <ReferenceLine y={50} stroke={CHART.axis} strokeDasharray="4 4" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as (typeof chosen.points)[number]
                    return (
                      <ChartTooltip
                        title={isoToGerman(row.date)}
                        subtitle={`${num(row.total, 0)} meldende Stationen`}
                        rows={[
                          {
                            label: field.short,
                            value: `${num(row.value, field.decimals)} ${field.unit}`,
                          },
                          { label: 'Platz', value: `${num(row.rank, 0)}. von ${num(row.total, 0)}` },
                          {
                            label: 'Perzentil',
                            value: percent(row.percentile, 1),
                            className: row.percentile >= 50 ? 'text-warm' : 'text-cold',
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="percentile"
                  stroke={CHART.colors.brand}
                  strokeWidth={1}
                  fill={CHART.colors.brand}
                  fillOpacity={0.12}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </Card>

      {chosen.summary && (
        <Ranking
          summary={chosen.summary}
          field={field}
          title={
            scope === 'lowland'
              ? `Im Tiefland — ${field.label}`
              : `Gegen ganz Deutschland — ${field.label}`
          }
          hint={
            scope === 'lowland'
              ? `Nur Stationen unter ${data.lowlandLimit} m, damit der Rang nicht zur Höhenmessung wird.`
              : 'Alle meldenden Stationen beider DWD-Netze, von der Küste bis zur Zugspitze.'
          }
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function National() {
  const { data, loading, error } = useApi<NationalOverviewResponse>('/api/national')
  const [fieldKey, setFieldKey] = useUrlState<string>('groesse', 'temp_mean')

  if (loading && !data) return <Loading message="Bundesvergleich wird geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  if (data.fields.length === 0) {
    return (
      <InfoPanel title="Bundesvergleich">
        <p>
          Noch keine Deutschlandwerte im Archiv. Einmal{' '}
          <code>npm run fetch:germany -- --backfill</code> ausführen.
        </p>
      </InfoPanel>
    )
  }

  const summer = data.fields
    .find((f) => f.field.key === 'temp_mean')
    ?.all.monthly.filter((m) => m.month >= 6 && m.month <= 8)
  const winter = data.fields
    .find((f) => f.field.key === 'temp_mean')
    ?.all.monthly.filter((m) => m.month === 12 || m.month <= 2)

  const mean = (rows?: { mean: number }[]) =>
    rows && rows.length > 0 ? rows.reduce((a, b) => a + b.mean, 0) / rows.length : null

  const summerMean = mean(summer)
  const winterMean = mean(winter)

  return (
    <div className="space-y-6">
      <InfoPanel title={`${data.station.name} im Bundesvergleich`}>
        <p>
          Das Deutschlandarchiv wurde bisher nur gefragt, wer die Extreme waren.
          Dieselben Zeilen beantworten eine andere Frage: Wo stand{' '}
          {data.station.name} an jedem dieser Tage unter den rund zweitausend
          meldenden Stationen? Ein einzelner Tag ist Small Talk — {' '}
          {num(data.range.days, 0)} davon sind eine Beschreibung des Ortes.
        </p>
        {summerMean !== null && winterMean !== null && (
          <p>
            Der auffälligste Befund steckt im Jahresgang: im Winter liegt{' '}
            {data.station.name} bei{' '}
            <strong className="text-ink">{percent(winterMean, 1)}</strong>, im
            Sommer bei <strong className="text-ink">{percent(summerMean, 1)}</strong>{' '}
            — relativ zum Rest des Landes also milde Winter und kühle Sommer.
          </p>
        )}
        <p>
          Zwei Wertungen wie überall in diesem Projekt: gegen alle Stationen und
          gegen alles unter {num(data.lowlandLimit, 0)} m. {data.station.name}{' '}
          liegt auf {data.station.altitude} m, und eine Rangliste mit der
          Zugspitze darin misst zum Teil die Höhe statt das Wetter.
        </p>
      </InfoPanel>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading icon={Mountain} title="Messgröße" />
          <ChoiceGroup
            label="Messgröße"
            value={fieldKey}
            choices={data.fields.map((f) => ({
              value: f.field.key,
              label: f.field.short,
              title: f.field.label,
            }))}
            onChange={setFieldKey}
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Größe</th>
                <th className="px-2 py-2 text-right font-medium">Tage</th>
                <th className="px-2 py-2 text-right font-medium">Ø Perzentil</th>
                <th className="px-2 py-2 text-right font-medium">Ø Tiefland</th>
                <th className="px-2 py-2 text-right font-medium">oberstes Zehntel</th>
                <th className="px-2 py-2 text-right font-medium">unterstes Zehntel</th>
              </tr>
            </thead>
            <tbody>
              {data.fields.map((f) => (
                <tr
                  key={f.field.key}
                  className={`border-b border-line/60 last:border-0 ${
                    f.field.key === fieldKey ? 'bg-raised' : ''
                  }`}
                >
                  <td className="py-1.5 pr-3 text-ink">{f.field.short}</td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {num(f.all.days, 0)}
                  </td>
                  <td
                    className={`numeric px-2 py-1.5 text-right font-semibold ${
                      f.all.mean >= 50 ? 'text-warm' : 'text-cold'
                    }`}
                  >
                    {percent(f.all.mean, 1)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {percent(f.lowland.mean, 1)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {num(f.all.top, 0)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {num(f.all.bottom, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-ink-faint">
          Das Perzentil zählt Stationen unter dem Wert plus die Hälfte der
          gleichen. Diese Halbierung ist hier keine Pedanterie: der DWD gibt
          Temperaturen auf eine Nachkommastelle aus, an einem ruhigen Tag teilen
          sich hundert Stationen dieselbe Zahl, und würde man sie alle als
          „darunter" zählen, stünde {data.station.name} beim 96. Perzentil dafür,
          exakt Durchschnitt zu sein.
        </p>
      </Card>

      <FieldDetail fieldKey={fieldKey} />

      <p className="text-[11px] text-ink-faint">
        Bestand: {isoToGerman(data.range.first)} bis {isoToGerman(data.range.last)}
        , {num(data.range.days, 0)} Tage — und täglich einer mehr. Monatswerte
        erst ab {data.minDaysPerMonth} Tagen, sonst sagte die Zahl mehr darüber
        aus, welche Tage gesammelt wurden, als über den Monat.
      </p>
    </div>
  )
}
