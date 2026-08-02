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
import { Clock, Flame, Hourglass, Snowflake } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num } from '../lib/format'
import type { RecordAgeField, RecordAgesResponse } from '../types'
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

/** Warm records red, cold records blue, the rest neutral. */
function toneOf(warm: boolean | null): string {
  if (warm === true) return CHART.colors.hot
  if (warm === false) return CHART.colors.cold
  return CHART.colors.brand
}

function textToneOf(warm: boolean | null): string {
  if (warm === true) return 'text-hot'
  if (warm === false) return 'text-cold'
  return 'text-brand'
}

function value(field: RecordAgeField, v: number): string {
  if (field.unit === 'm/s') return `${num(v * 3.6, 0)} km/h`
  return `${num(v, field.decimals)} ${field.unit}`
}

export function RecordAges({ stationId, stationName }: { stationId: string; stationName: string }) {
  const [fieldKey, setFieldKey] = useUrlState<string>('groesse', 'temp_max_high')
  const { data, loading, error } = useApi<RecordAgesResponse>(
    `/api/weather/record-ages?stationId=${stationId}`,
    [stationId],
  )

  if (loading && !data) return <Loading message="Rekordalter wird gerechnet …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const field = data.fields.find((f) => f.key === fieldKey) ?? data.fields[0]
  if (!field) return null

  const { summary } = data
  const oldest = [...data.fields].sort((a, b) => b.allTime.years - a.allTime.years)[0]
  const youngest = [...data.fields].sort((a, b) => a.allTime.years - b.allTime.years)[0]

  return (
    <div className="space-y-6">
      <InfoPanel title={`Wie alt die Rekorde von ${stationName} sind`}>
        <p>
          Ein Rekord hat ein Datum, und dieses Datum ist eine Aussage. Steht der
          Kälterekord seit Jahrzehnten und der Wärmerekord seit wenigen Jahren,
          dann hat sich etwas verschoben — und man braucht dafür keine
          Trendgerade, keine Referenzperiode und keine Glättung. Es genügt zu
          zählen, wie lange her es ist.
        </p>
        <p>
          Neben dem Allzeitrekord jeder Größe stehen die zwölf Monatsrekorde. Ein
          einzelner Allzeitrekord ist ein Zufall; zwölf Monatsrekorde sind ein
          Muster. Gerechnet wird gegen den letzten Tag der Reihe —{' '}
          {isoToGerman(data.last)} —, nicht gegen die Uhr des Betrachters, damit
          die Seite morgen dasselbe sagt wie heute.
        </p>
      </InfoPanel>

      <StatGrid>
        <StatTile
          label="Warme Rekorde"
          value={summary.warmAge !== null ? `${num(summary.warmAge, 0)} Jahre` : '—'}
          caption={`mittleres Alter der Monatsrekorde in ${num(summary.warmFields, 0)} Kategorien`}
          accent="hot"
          icon={Flame}
        />
        <StatTile
          label="Kalte Rekorde"
          value={summary.coldAge !== null ? `${num(summary.coldAge, 0)} Jahre` : '—'}
          caption={
            summary.warmAge !== null && summary.coldAge !== null
              ? `${num(summary.coldAge / summary.warmAge, 1)}-mal so alt wie die warmen`
              : undefined
          }
          accent="cold"
          icon={Snowflake}
        />
        <StatTile
          label="Ältester Allzeitrekord"
          value={oldest ? `${num(oldest.allTime.years, 0)} Jahre` : '—'}
          caption={
            oldest
              ? `${oldest.label}: ${value(oldest, oldest.allTime.value)} am ${isoToGerman(oldest.allTime.date)}`
              : undefined
          }
          accent="neutral"
          icon={Hourglass}
        />
        <StatTile
          label="Jüngster Allzeitrekord"
          value={youngest ? `${num(youngest.allTime.years, 0)} Jahre` : '—'}
          caption={
            youngest
              ? `${youngest.label}: ${value(youngest, youngest.allTime.value)} am ${isoToGerman(youngest.allTime.date)}`
              : undefined
          }
          accent="warm"
          icon={Clock}
        />
      </StatGrid>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <SectionHeading
          icon={Hourglass}
          title="Der Allzeitrekord jeder Größe"
          hint="Balkenlänge ist das Alter in Jahren. Rot sind warme Rekorde, blau kalte."
        />

        <div className="mt-4">
          <ChartFrame height={Math.max(240, data.fields.length * 30 + 40)}>
            <ResponsiveContainer>
              <BarChart
                data={data.fields}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
              >
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  dataKey="allTime.years"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: number) => `${num(v, 0)} J`}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke={CHART.axis}
                  tick={{ ...CHART.tick, fontSize: 10 }}
                  width={150}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as RecordAgeField
                    return (
                      <ChartTooltip
                        title={row.label}
                        rows={[
                          { label: 'Rekord', value: value(row, row.allTime.value) },
                          { label: 'aufgestellt', value: isoToGerman(row.allTime.date) },
                          { label: 'Alter', value: `${num(row.allTime.years, 0)} Jahre` },
                          {
                            label: 'Zweitbester',
                            value: row.allTime.runnerUp
                              ? `${value(row, row.allTime.runnerUp.value)} (${isoToGerman(
                                  row.allTime.runnerUp.date,
                                )})`
                              : '—',
                          },
                          { label: 'Messtage', value: num(row.days, 0) },
                        ]}
                        footer={row.note ?? undefined}
                      />
                    )
                  }}
                />
                <Bar dataKey="allTime.years" radius={[0, 3, 3, 0]}>
                  {data.fields.map((f) => (
                    <Cell key={f.key} fill={toneOf(f.warm)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <div className="mt-4 overflow-x-auto border-t border-line pt-3">
          <table className="w-full min-w-[600px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Größe</th>
                <th className="px-2 py-2 text-right font-medium">Rekord</th>
                <th className="px-2 py-2 text-right font-medium">aufgestellt</th>
                <th className="px-2 py-2 text-right font-medium">Alter</th>
                <th className="px-2 py-2 text-right font-medium">Abstand zum Zweiten</th>
                <th className="px-2 py-2 text-right font-medium">Reihe seit</th>
              </tr>
            </thead>
            <tbody>
              {data.fields.map((f) => (
                <tr key={f.key} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-3">
                    <span className={textToneOf(f.warm)}>{f.label}</span>
                    {f.note && <span className="block text-[10px] text-ink-faint">{f.note}</span>}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right font-semibold text-ink">
                    {value(f, f.allTime.value)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {isoToGerman(f.allTime.date)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink">
                    {num(f.allTime.years, 0)} J
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                    {f.allTime.runnerUp
                      ? `${num(f.allTime.runnerUp.margin, f.decimals)} ${f.unit}`
                      : '—'}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                    {f.first.slice(0, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={Clock}
            title="Die zwölf Monatsrekorde"
            hint="Ein Allzeitrekord ist ein Zufall, zwölf Monatsrekorde sind ein Muster."
          />
          <ChoiceGroup
            label="Größe"
            value={field.key}
            choices={data.fields.map((f) => ({ value: f.key, label: f.short, title: f.label }))}
            onChange={setFieldKey}
            size="sm"
          />
        </div>

        <div className="mt-4">
          <ChartFrame height={280}>
            <ResponsiveContainer>
              <BarChart data={field.monthly} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={(v: string) => v.slice(0, 3)}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={52}
                  tickFormatter={(v: number) => `${num(v, 0)} J`}
                />
                <Tooltip
                  cursor={{ fill: CHART.cursor }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]!.payload as RecordAgeField['monthly'][number]
                    return (
                      <ChartTooltip
                        title={String(label)}
                        rows={[
                          { label: 'Rekord', value: value(field, row.value) },
                          { label: 'aufgestellt', value: isoToGerman(row.date) },
                          { label: 'Alter', value: `${num(row.years, 0)} Jahre` },
                          {
                            label: 'Zweitbester',
                            value: row.runnerUp
                              ? `${value(field, row.runnerUp.value)} (${isoToGerman(row.runnerUp.date)})`
                              : '—',
                          },
                        ]}
                      />
                    )
                  }}
                />
                <Bar dataKey="years" radius={[3, 3, 0, 0]} fill={toneOf(field.warm)} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>

        <div className="mt-4 overflow-x-auto border-t border-line pt-3">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Monat</th>
                <th className="px-2 py-2 text-right font-medium">Rekord</th>
                <th className="px-2 py-2 text-right font-medium">aufgestellt</th>
                <th className="px-2 py-2 text-right font-medium">Alter</th>
                <th className="px-2 py-2 text-right font-medium">Kalendertage gemessen</th>
              </tr>
            </thead>
            <tbody>
              {field.monthly.map((m) => (
                <tr key={m.month} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-3 text-ink">{m.label}</td>
                  <td className="numeric px-2 py-1.5 text-right font-semibold text-ink">
                    {value(field, m.value)}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-muted">
                    {isoToGerman(m.date)}
                  </td>
                  <td className={`numeric px-2 py-1.5 text-right ${textToneOf(field.warm)}`}>
                    {num(m.years, 0)} J
                  </td>
                  <td className="numeric px-2 py-1.5 text-right text-ink-faint">
                    {num(m.observations, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Der Monatsrekord ist der beste Wert aller Kalendertage dieses Monats,
          und das Datum daneben sagt, an welchem Tag er fiel. Die letzte Spalte
          zählt, wie oft dieser eine Kalendertag überhaupt gemessen wurde — bei
          einer Reihe seit {field.first.slice(0, 4)} sind das die Jahre, in denen
          der Rekord hätte fallen können.
        </p>
      </Card>
    </div>
  )
}
