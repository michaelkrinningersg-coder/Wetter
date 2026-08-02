import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Mountain, Radiation as RadiationIcon, Ruler, Timer } from 'lucide-react'

import { useApi } from '../lib/api'
import { useUrlState } from '../lib/url-state'
import { num } from '../lib/format'
import type { OdlProbe, RadiationResponse } from '../types'
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
 * Eleven curves need eleven distinguishable colours; the palette carries ten
 * plus neutral, cycled by distance so the two Göttingen probes always take the
 * first two.
 */
const LINE_COLORS = [
  CHART.colors.brand,
  CHART.colors.warm,
  CHART.colors.cool,
  CHART.colors.good,
  CHART.colors.accent,
  CHART.colors.hot,
  CHART.colors.cold,
  CHART.colors.wet,
  CHART.colors.dry,
  CHART.colors.neutral,
]

const WINDOWS = [
  { value: '7', label: '7 Tage' },
  { value: '30', label: '30 Tage' },
  { value: '90', label: '90 Tage' },
] as const

/** UTC stamps come straight from the BfS and are shown as such. */
function formatStamp(at: string): string {
  const [date, time] = at.replace('Z', '').split('T')
  const [, month, day] = (date ?? '').split('-')
  return `${day}.${month}. ${time?.slice(0, 5) ?? ''}`
}

function ProbeTile({ probe, color }: { probe: OdlProbe; color: string }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-raised p-4">
      <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: color }} aria-hidden />

      <div className="flex items-start justify-between gap-2">
        <span className="label truncate">{probe.name}</span>
        <span className="numeric shrink-0 text-[10px] text-ink-faint">{probe.distance} km</span>
      </div>

      <p className="numeric mt-2 text-2xl font-semibold tracking-tight text-ink">
        {probe.latest ? num(probe.latest.value, 3) : '—'}
        <span className="ml-1 text-xs font-normal text-ink-faint">µSv/h</span>
      </p>

      <p className="mt-1 text-[11px] text-ink-muted">
        Mittel {probe.mean !== null ? num(probe.mean, 3) : '—'} · Spanne{' '}
        {probe.min !== null && probe.max !== null
          ? `${num(probe.min, 3)}–${num(probe.max, 3)}`
          : '—'}
      </p>

      {probe.cosmic !== null && probe.terrestrial !== null && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
            <span
              className="bg-cool"
              style={{
                width: `${(probe.cosmic / (probe.cosmic + probe.terrestrial)) * 100}%`,
              }}
            />
            <span className="flex-1 bg-dry" />
          </div>
          <p className="numeric mt-1 text-[10px] text-ink-faint">
            kosmisch {num(probe.cosmic, 3)} · terrestrisch {num(probe.terrestrial, 3)}
          </p>
        </div>
      )}

      <p className="mt-2 text-[10px] text-ink-faint">
        {probe.elevation ?? '—'} m ü. NHN · {num(probe.hours, 0)} Stunden im Archiv
      </p>
    </div>
  )
}

export function Radiation() {
  const [days, setDays] = useUrlState<string>('tage', '30', {
    allowed: WINDOWS.map((w) => w.value),
  })
  const { data, loading, error } = useApi<RadiationResponse>(`/api/radiation?days=${days}`, [days])

  const rows = useMemo(() => {
    if (!data) return []
    const byStamp = new Map<string, Record<string, string | number>>()
    for (const series of data.series) {
      for (const point of series.points) {
        if (!byStamp.has(point.at)) byStamp.set(point.at, { at: point.at })
        byStamp.get(point.at)![series.probe] = point.value
      }
    }
    return [...byStamp.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)))
  }, [data])

  if (loading && !data) return <Loading message="Strahlungsmesswerte werden geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  if (data.hint) {
    return (
      <InfoPanel title="Ortsdosisleistung">
        <p>{data.hint}</p>
      </InfoPanel>
    )
  }

  const colorOf = (probeId: string) => {
    const index = data.probes.findIndex((p) => p.id === probeId)
    return LINE_COLORS[(index < 0 ? 0 : index) % LINE_COLORS.length]!
  }

  const withValues = data.probes.filter((p) => p.mean !== null)
  const lowest = withValues.reduce((a, b) => ((b.mean ?? 0) < (a.mean ?? 0) ? b : a), withValues[0]!)
  const highest = withValues.reduce((a, b) => ((b.mean ?? 0) > (a.mean ?? 0) ? b : a), withValues[0]!)
  const spread =
    highest?.mean && lowest?.mean ? (highest.mean / lowest.mean - 1) * 100 : null

  return (
    <div className="space-y-6">
      <InfoPanel title="Ortsdosisleistung im Umkreis von Göttingen">
        <p>
          Das Bundesamt für Strahlenschutz betreibt bundesweit rund 1700 Sonden
          und veröffentlicht sie offen. {data.probes.length} davon stehen im{' '}
          {data.radiusKm}-km-Umkreis der DWD-Station {data.origin.station} — eine
          direkt an der Wetterstation selbst, 100 m entfernt, eine zweite 1,8 km
          weiter in der Stadt.
        </p>
        <p>
          <strong className="text-ink">{data.windowNote}</strong> Der Bestand
          umfasst derzeit {num(data.range.days, 0)} Tage und wächst täglich; die
          Ansicht wird also mit der Zeit aussagekräftiger, nicht sofort.
        </p>
        <p>
          {data.quantity.note} Zeitangaben in UTC, wie das BfS sie
          veröffentlicht — Tagesgrenzen dieses Archivs sind daher UTC-Tage.
        </p>
      </InfoPanel>

      <StatGrid>
        <StatTile
          label="Archiv"
          value={`${num(data.range.days, 0)} Tage`}
          caption={`ab ${data.range.first ?? '—'}`}
          accent="brand"
          icon={Timer}
        />
        <StatTile
          label="Niedrigste Sonde"
          value={`${num(lowest?.mean ?? 0, 3)} µSv/h`}
          caption={lowest?.name}
          accent="cool"
          icon={RadiationIcon}
        />
        <StatTile
          label="Höchste Sonde"
          value={`${num(highest?.mean ?? 0, 3)} µSv/h`}
          caption={highest?.name}
          accent="warm"
          icon={RadiationIcon}
        />
        <StatTile
          label="Unterschied"
          value={spread !== null ? `+${num(spread, 0)} %` : '—'}
          caption="zwischen höchster und niedrigster Sonde"
          accent="dry"
          icon={Ruler}
        />
      </StatGrid>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            icon={RadiationIcon}
            title="Verlauf aller Sonden"
            hint="Stundenwerte. Was alle Kurven gleichzeitig anhebt, ist meist Regen — Niederschlag wäscht Radonfolgeprodukte aus der Luft."
          />
          <ChoiceGroup
            label="Zeitraum"
            value={days}
            choices={WINDOWS}
            onChange={setDays}
            size="sm"
          />
        </div>

        <div className="mt-4">
          <ChartFrame height={380}>
            <ResponsiveContainer>
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="at"
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  tickFormatter={formatStamp}
                  minTickGap={48}
                />
                <YAxis
                  stroke={CHART.axis}
                  tick={CHART.tick}
                  width={54}
                  domain={['dataMin - 0.005', 'dataMax + 0.005']}
                  tickFormatter={(v: number) => num(v, 3)}
                  label={{
                    value: 'µSv/h',
                    angle: -90,
                    position: 'insideLeft',
                    fill: CHART.axis,
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const sorted = [...payload].sort(
                      (a, b) => (b.value as number) - (a.value as number),
                    )
                    return (
                      <ChartTooltip
                        title={`${formatStamp(String(label))} UTC`}
                        rows={sorted.map((p) => ({
                          label:
                            data.probes.find((x) => x.id === p.dataKey)?.name ?? String(p.dataKey),
                          value: `${num(p.value as number, 3)} µSv/h`,
                        }))}
                      />
                    )
                  }}
                />
                {data.series.map((series) => (
                  <Line
                    key={series.probe}
                    type="monotone"
                    dataKey={series.probe}
                    stroke={colorOf(series.probe)}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </div>
      </Card>

      <div>
        <SectionHeading
          icon={Mountain}
          title="Die Sonden"
          hint="Nach Entfernung zur Wetterstation. Der Balken zeigt den kosmischen Anteil (blau) gegen den terrestrischen (gelb)."
        />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.probes.map((probe) => (
            <ProbeTile key={probe.id} probe={probe} color={colorOf(probe.id)} />
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">
          Der Unterschied zwischen den Sonden ist fast ausschließlich
          terrestrisch: der kosmische Anteil liegt bei allen elf zwischen 0,044
          und 0,046 µSv/h, der terrestrische zwischen 0,072 und 0,110. Über 175
          Höhenmeter ist der Höheneffekt bei drei Nachkommastellen nicht zu
          sehen — was die Sonden unterscheidet, ist der Boden, auf dem sie
          stehen.
        </p>
      </div>
    </div>
  )
}
