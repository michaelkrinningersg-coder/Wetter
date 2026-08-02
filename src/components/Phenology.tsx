import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { CalendarRange, Flower2, Leaf, MapPin, Thermometer, TrendingDown } from 'lucide-react'

import { useApi } from '../lib/api'
import { num } from '../lib/format'
import { linearFit } from '../lib/stats'
import type { PhenoSeason, PhenologyResponse } from '../types'
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

/** Day-of-year to a readable date; the year is irrelevant, only the position. */
function dayLabel(day: number): string {
  const at = new Date(Date.UTC(2001, 0, Math.round(day)))
  return `${at.getUTCDate()}. ${
    ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][
      at.getUTCMonth()
    ]
  }`
}

/** Spring and summer run warm, autumn and winter cool. */
const SEASON_COLOR: Record<string, string> = {
  vorfruehling: CHART.colors.good,
  erstfruehling: CHART.colors.good,
  vollfruehling: CHART.colors.brand,
  fruehsommer: CHART.colors.dry,
  hochsommer: CHART.colors.hot,
  spaetsommer: CHART.colors.warm,
  fruehherbst: CHART.colors.accent,
  vollherbst: CHART.colors.cool,
  spaetherbst: CHART.colors.cold,
  winter: CHART.colors.neutral,
}

function seasonFit(season: PhenoSeason) {
  if (season.points.length < 10) return null
  return linearFit(season.points.map((p) => ({ x: p.year, y: p.day })))
}

/* -------------------------------------------------------------------------- */
/* One season's series                                                        */
/* -------------------------------------------------------------------------- */

function SeasonChart({ season }: { season: PhenoSeason }) {
  const fit = seasonFit(season)
  const color = SEASON_COLOR[season.key] ?? CHART.colors.brand

  const rows = season.points.map((p) => ({
    ...p,
    trend: fit ? fit.intercept + fit.slope * p.year : null,
  }))

  return (
    <ChartFrame height={220}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="year" stroke={CHART.axis} tick={CHART.tick} />
          <YAxis
            stroke={CHART.axis}
            tick={CHART.tick}
            width={62}
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
                    { label: 'Eintritt', value: dayLabel(row.day) },
                    { label: 'Tag im Jahr', value: num(row.day, 0) },
                    {
                      label: 'Melder',
                      value: `${num(row.stations, 0)} Station${row.stations === 1 ? '' : 'en'}`,
                      className: row.stations === 1 ? 'text-ink-faint' : 'text-ink',
                    },
                  ]}
                />
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="day"
            stroke={color}
            strokeWidth={1.5}
            dot={{ r: 1.5 }}
            connectNulls
          />
          {fit && (
            <Line
              type="linear"
              dataKey="trend"
              stroke={color}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

function SeasonCard({ season }: { season: PhenoSeason }) {
  const fit = seasonFit(season)
  const color = SEASON_COLOR[season.key] ?? CHART.colors.brand

  const first = season.points.slice(0, 10)
  const last = season.points.slice(-10)
  const shift =
    first.length >= 5 && last.length >= 5
      ? last.reduce((a, b) => a + b.day, 0) / last.length -
        first.reduce((a, b) => a + b.day, 0) / first.length
      : null

  return (
    <Card className="relative overflow-hidden" padded={false}>
      <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: color }} aria-hidden />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{season.label}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {season.plants.map((p) => p.name).join(' / ')} · {season.phase.name}
            </p>
          </div>
          {shift !== null && (
            <span
              className={`numeric shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${
                shift < 0 ? 'bg-good/15 text-good' : 'bg-hot/15 text-hot'
              }`}
              title="Verschiebung zwischen den ersten und den letzten zehn Jahren der Reihe"
            >
              {shift > 0 ? '+' : '−'}
              {num(Math.abs(shift), 0)} d
            </span>
          )}
        </div>

        <div className="mt-3">
          <SeasonChart season={season} />
        </div>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-2 text-[10px] text-ink-faint">
          <span>
            {season.first}–{season.last} · {season.years} Jahre
          </span>
          {fit && (
            <span className="numeric">
              {num(fit.slope * 10, 1)} d je Jahrzehnt · R² {num(fit.r2, 2)}
              {fit.isSignificant ? '' : ' · nicht signifikant'}
            </span>
          )}
        </div>

        {season.note && <p className="mt-1.5 text-[10px] text-ink-faint">{season.note}</p>}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Onset against temperature                                                  */
/* -------------------------------------------------------------------------- */

function AgainstTemperature({ data }: { data: PhenologyResponse }) {
  const temp = data.temperature
  if (!temp) return null

  const fit = linearFit(temp.points.map((p) => ({ x: p.temp, y: p.day })))
  const xs = temp.points.map((p) => p.temp)
  const line =
    fit &&
    [Math.min(...xs), Math.max(...xs)].map((x) => ({
      temp: x,
      day: fit.intercept + fit.slope * x,
    }))

  return (
    <Card>
      <SectionHeading
        icon={Thermometer}
        title={`${temp.season.label} und die Temperatur davor`}
        hint={`Eintrittstag gegen die Mitteltemperatur ${temp.monthsLabel} an der DWD-Station ${temp.dwdStation}.`}
      />

      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
        Eine Pflanze liest keinen Kalender, sie reagiert auf angesammelte Wärme.
        Das ist die zweite Stelle, an der die beiden Archive dieses Projekts
        zusammenkommen — die Haselblüte wurde von Freiwilligen notiert, die
        Temperatur 3 km entfernt vom Wetterdienst gemessen, und beide wissen
        nichts voneinander.
        {fit && (
          <>
            {' '}
            Über {temp.points.length} Jahre verschiebt jedes Grad den Eintritt um{' '}
            <strong className="text-ink">
              {num(Math.abs(fit.slope), 1)} Tage nach {fit.slope < 0 ? 'vorn' : 'hinten'}
            </strong>
            ; das Bestimmtheitsmaß liegt bei {num(fit.r2, 2)}.
          </>
        )}
      </p>

      <div className="mt-4">
        <ChartFrame height={320}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 12, left: 4 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="temp"
                stroke={CHART.axis}
                tick={CHART.tick}
                domain={['dataMin - 0.5', 'dataMax + 0.5']}
                tickFormatter={(v: number) => `${num(v, 1)}`}
                label={{
                  value: `Mitteltemperatur ${temp.monthsLabel} (°C)`,
                  position: 'insideBottom',
                  offset: -8,
                  fill: CHART.axis,
                  fontSize: 11,
                }}
              />
              <YAxis
                type="number"
                dataKey="day"
                stroke={CHART.axis}
                tick={CHART.tick}
                width={62}
                tickFormatter={dayLabel}
                domain={['dataMin - 4', 'dataMax + 4']}
              />
              <ZAxis range={[28, 28]} />
              <Tooltip
                cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0]!.payload as (typeof temp.points)[number]
                  if (row.year === undefined) return null
                  return (
                    <ChartTooltip
                      title={String(row.year)}
                      rows={[
                        { label: 'Eintritt', value: dayLabel(row.day) },
                        { label: 'Temperatur', value: `${num(row.temp, 1)} °C` },
                        { label: 'Melder', value: num(row.stations, 0) },
                      ]}
                    />
                  )
                }}
              />
              <Scatter data={temp.points} fill={CHART.colors.good} fillOpacity={0.75} />
              {line && (
                <Scatter data={line} line={{ stroke: CHART.colors.brand, strokeWidth: 2 }} shape={() => <g />} />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                   */
/* -------------------------------------------------------------------------- */

function Calendar({ data }: { data: PhenologyResponse }) {
  const [limit, setLimit] = useState<string>('40')
  const shown = limit === 'all' ? data.calendar : data.calendar.slice(0, Number(limit))

  const min = Math.min(...data.calendar.map((c) => c.day))
  const max = Math.max(...data.calendar.map((c) => c.day))

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading
          icon={CalendarRange}
          title="Der phänologische Kalender"
          hint={`Jede Kombination aus Pflanze und Phase mit mindestens ${data.minYears} Jahren, nach mittlerem Eintrittstag.`}
        />
        <ChoiceGroup
          label="Umfang"
          value={limit}
          choices={[
            { value: '40', label: 'Erste 40' },
            { value: 'all', label: `Alle ${data.calendar.length}` },
          ]}
          onChange={setLimit}
          size="sm"
        />
      </div>

      <div className="mt-4 space-y-0.5">
        {shown.map((entry) => {
          const left = ((entry.day - min) / (max - min)) * 100
          return (
            <div
              key={`${entry.plant}-${entry.phase}`}
              className="flex items-center gap-3 rounded px-1 py-0.5 hover:bg-raised"
            >
              <span className="w-40 shrink-0 truncate text-[11px] text-ink" title={entry.plantName}>
                {entry.plantName}
              </span>
              <span
                className="w-36 shrink-0 truncate text-[11px] text-ink-muted"
                title={entry.phaseName}
              >
                {entry.phaseName}
              </span>
              <div className="relative h-3 flex-1">
                <span
                  className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand"
                  style={{ left: `${left}%` }}
                  aria-hidden
                />
              </div>
              <span className="numeric w-16 shrink-0 text-right text-[10px] text-ink-muted">
                {dayLabel(entry.day)}
              </span>
              <span className="numeric w-10 shrink-0 text-right text-[10px] text-ink-faint">
                {entry.years} J.
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function Phenology() {
  const { data, loading, error } = useApi<PhenologyResponse>('/api/phenology')

  const summary = useMemo(() => {
    if (!data) return null
    const withFit = data.seasons
      .map((s) => ({ season: s, fit: seasonFit(s) }))
      .filter((x) => x.fit !== null)
    const spring = withFit.filter((x) => x.season.order <= 6)
    const autumn = withFit.filter((x) => x.season.order > 6)
    return {
      spring:
        spring.length > 0
          ? spring.reduce((a, x) => a + x.fit!.slope * 10, 0) / spring.length
          : null,
      autumn:
        autumn.length > 0
          ? autumn.reduce((a, x) => a + x.fit!.slope * 10, 0) / autumn.length
          : null,
    }
  }, [data])

  if (loading && !data) return <Loading message="Phänologische Beobachtungen werden geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  if (data.hint) {
    return (
      <InfoPanel title="Phänologie">
        <p>{data.hint}</p>
      </InfoPanel>
    )
  }

  const reporting = data.stations.filter((s) => s.reports > 0)

  return (
    <div className="space-y-6">
      <InfoPanel title="Phänologie im Umkreis von Göttingen">
        <p>
          Alles andere in dieser App misst das Wetter. Das hier misst, was das
          Wetter bewirkt hat: den Tag, an dem eine Hasel zum ersten Mal blühte,
          ein Apfel pflückreif war, eine Eiche ihr Laub abwarf. Aufgezeichnet
          von Freiwilligen, über {data.range.reports.toLocaleString('de-DE')}{' '}
          Beobachtungen an {data.range.plants} Pflanzenarten.
        </p>
        <p>
          <strong className="text-ink">{data.endedNote}</strong> Von{' '}
          {data.stations.length} Meldestationen im {data.radiusKm}-km-Umkreis
          haben {reporting.length} je gemeldet — die letzte Beobachtung stammt
          aus {data.range.last}.
        </p>
        <p>
          Ein Jahreswert ist das Mittel über die Stationen, die ihn gemeldet
          haben. Auf 25 km und unter 200 Höhenmetern ist das vertretbar; die Zahl
          der Melder steht in jedem Tooltip, damit ein Jahr auf einem einzigen
          Beobachter als solches erkennbar bleibt.
        </p>
      </InfoPanel>

      <StatGrid>
        <StatTile
          label="Zeitraum"
          value={`${data.range.first}–${data.range.last}`}
          caption={`${num(data.range.reports, 0)} Beobachtungen`}
          accent="brand"
          icon={Leaf}
        />
        <StatTile
          label="Meldende Stationen"
          value={`${reporting.length} von ${data.stations.length}`}
          caption={reporting[0] ? `am meisten: ${reporting[0].name}` : undefined}
          accent="neutral"
          icon={MapPin}
        />
        <StatTile
          label="Frühjahr bis Spätsommer"
          value={summary?.spring !== null && summary ? `${num(summary.spring, 1)} d` : '—'}
          caption="mittlere Verschiebung je Jahrzehnt"
          accent="good"
          icon={TrendingDown}
        />
        <StatTile
          label="Herbst und Winter"
          value={summary?.autumn !== null && summary ? `+${num(summary.autumn, 1)} d` : '—'}
          caption="mittlere Verschiebung je Jahrzehnt"
          accent="warm"
          icon={Flower2}
        />
      </StatGrid>

      <div>
        <SectionHeading
          icon={Flower2}
          title="Die zehn phänologischen Jahreszeiten"
          hint="Jede beginnt, wenn eine bestimmte Pflanze eine bestimmte Phase erreicht — die Definition steht unter jedem Titel, damit sie nachprüfbar ist."
        />
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[...data.seasons]
            .sort((a, b) => a.order - b.order)
            .map((season) => (
              <SeasonCard key={season.key} season={season} />
            ))}
        </div>
      </div>

      <AgainstTemperature data={data} />

      <Calendar data={data} />

      <Card>
        <SectionHeading
          icon={MapPin}
          title="Die Melder"
          hint="Wer im Umkreis beobachtet hat, wie lange und wie viel."
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium">Station</th>
                <th className="px-2 py-2 text-right font-medium">km</th>
                <th className="px-2 py-2 text-right font-medium">Höhe</th>
                <th className="px-2 py-2 text-right font-medium">Beobachtungen</th>
                <th className="px-2 py-2 text-right font-medium">Arten</th>
                <th className="px-2 py-2 text-right font-medium">Zeitraum</th>
              </tr>
            </thead>
            <tbody>
              {data.stations.map((station) => (
                <tr
                  key={station.id}
                  className={`border-b border-line/60 last:border-0 ${
                    station.reports === 0 ? 'text-ink-faint' : ''
                  }`}
                >
                  <td className="py-1.5 pr-3">
                    <span className={station.reports > 0 ? 'text-ink' : ''}>{station.name}</span>
                  </td>
                  <td className="numeric px-2 py-1.5 text-right">{num(station.distance, 1)}</td>
                  <td className="numeric px-2 py-1.5 text-right">{station.elevation ?? '—'}</td>
                  <td className="numeric px-2 py-1.5 text-right">
                    {station.reports > 0 ? num(station.reports, 0) : '—'}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right">
                    {station.plants > 0 ? station.plants : '—'}
                  </td>
                  <td className="numeric px-2 py-1.5 text-right">
                    {station.first ? `${station.first}–${station.last}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">
          Die grau gesetzten Stationen liegen im Umkreis, haben aber nie
          gemeldet. Der Abstand zwischen {data.stations.length} Stationen auf der
          Karte und {reporting.length} in den Daten ist das Wichtigste, was man
          über dieses Archiv wissen muss.
        </p>
      </Card>
    </div>
  )
}
