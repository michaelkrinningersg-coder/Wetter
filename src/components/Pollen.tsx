import { Flower2, CalendarRange, Target } from 'lucide-react'

import { useApi } from '../lib/api'
import { isoToGerman, num, shareOf } from '../lib/format'
import type { PollenLevel, PollenResponse } from '../types'
import {
  Card,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/**
 * Seven steps, seven shades.
 *
 * A sequential ramp rather than a diverging one: the scale runs from "none" to
 * "high" with no meaningful middle to diverge around. Level 0 is deliberately
 * near-invisible so a season reads as the coloured part of an empty row.
 */
const LEVEL_STYLE = [
  'bg-raised text-ink-faint',
  'bg-good/20 text-ink-muted',
  'bg-good/40 text-ink',
  'bg-dry/40 text-ink',
  'bg-dry/70 text-canvas',
  'bg-warm/70 text-canvas',
  'bg-hot/85 text-canvas',
]

const styleFor = (level: number | null) => LEVEL_STYLE[level ?? 0] ?? LEVEL_STYLE[0]!

function Legend({ levels }: { levels: PollenLevel[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {levels.map((level) => (
        <span key={level.value} className="flex items-center gap-1.5 text-[10px]">
          <span
            className={`numeric inline-flex h-4 min-w-6 items-center justify-center rounded px-1 font-semibold ${styleFor(level.level)}`}
          >
            {level.value}
          </span>
          <span className="text-ink-faint">{level.label}</span>
        </span>
      ))}
    </div>
  )
}

export function Pollen() {
  const { data, loading, error } = useApi<PollenResponse>('/api/pollen')

  if (loading && !data) return <Loading message="Pollenvorhersage wird geladen …" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  if (data.hint || !data.latest) {
    return (
      <InfoPanel title="Pollenflug">
        <p>{data.hint ?? 'Noch keine Ausgabe im Archiv.'}</p>
      </InfoPanel>
    )
  }

  const home = data.latest.regions.find((r) => r.home) ?? data.latest.regions[0]!
  const others = data.latest.regions.filter((r) => r !== home)
  const active = data.calendar.filter((c) => c.activeDays > 0)

  return (
    <div className="space-y-6">
      <InfoPanel title="Pollenflug im Raum Göttingen">
        <p>
          Der DWD veröffentlicht jeden Vormittag eine Vorhersage für acht
          Pollenarten in 27 Regionen — heute und die beiden Folgetage.{' '}
          <strong className="text-ink">{data.windowNote}</strong>
        </p>
        <p>{data.regionNote}</p>
        <p>
          Das Archiv umfasst {num(data.range.issues, 0)}{' '}
          {data.range.issues === 1 ? 'Ausgabe' : 'Ausgaben'}
          {data.range.first && data.range.first !== data.range.last
            ? ` von ${isoToGerman(data.range.first)} bis ${isoToGerman(data.range.last)}`
            : ` vom ${isoToGerman(data.range.last)}`}
          . Der Jahreskalender und die Treffsicherheit der Vorhersage entstehen
          erst mit der Zeit — beides braucht Ausgaben, die sich überlappen.
        </p>
      </InfoPanel>

      <StatGrid>
        <StatTile
          label="Ausgaben im Archiv"
          value={num(data.range.issues, 0)}
          caption={`seit ${isoToGerman(data.range.first)}`}
          accent="brand"
          icon={CalendarRange}
        />
        <StatTile
          label="Aktuell belastend"
          value={`${active.length} von ${data.kinds.length}`}
          caption={
            active.length > 0
              ? active.map((c) => c.label).join(', ')
              : 'derzeit keine Art über Stufe 0'
          }
          accent={active.length > 0 ? 'warm' : 'good'}
          icon={Flower2}
        />
        <StatTile
          label="Treffsicherheit"
          value={
            data.accuracy.ready
              ? shareOf(data.accuracy.horizons.find((h) => h.offset === 2)?.exact ?? 0)
              : '—'
          }
          caption={
            data.accuracy.ready
              ? 'zwei Tage im Voraus exakt getroffen'
              : `ab ${data.accuracy.needed} Ausgaben — noch ${data.accuracy.needed - data.accuracy.issues} fehlend`
          }
          accent="cool"
          icon={Target}
        />
      </StatGrid>

      <Card>
        <SectionHeading
          icon={Flower2}
          title={`Vorhersage vom ${isoToGerman(data.latest.issued)}`}
          hint="Belastungsstufen für heute und die beiden Folgetage, wie der DWD sie angibt."
        />

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 pr-3 text-left font-medium text-ink-muted">Pollenart</th>
                {home.kinds[0]?.horizons.map((h) => (
                  <th key={h.key} className="px-2 py-2 text-center font-medium text-ink-muted">
                    {h.label}
                    <span className="numeric block text-[10px] font-normal text-ink-faint">
                      {isoToGerman(h.date)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {home.kinds.map((kind) => (
                <tr key={kind.pollen} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-3 text-ink">{kind.label}</td>
                  {kind.horizons.map((h) => (
                    <td key={h.key} className="px-2 py-2 text-center">
                      <span
                        className={`numeric inline-flex h-6 min-w-10 items-center justify-center rounded-md px-2 font-semibold ${styleFor(h.level)}`}
                        title={data.levels.find((l) => l.value === h.value)?.label}
                      >
                        {h.value || '—'}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <Legend levels={data.levels} />
        </div>

        {others.length > 0 && (
          <p className="mt-3 text-[11px] text-ink-faint">
            Mitgeschrieben wird auch die andere Teilregion (
            {others.map((r) => r.partregion).join(', ')}); gezeigt wird die, in
            der Göttingen liegt.
          </p>
        )}
      </Card>

      {data.range.issues > 1 && (
        <Card>
          <SectionHeading
            icon={CalendarRange}
            title="Verlauf"
            hint="Was an jedem Tag für diesen Tag selbst vorhergesagt war — die Saison, wie sie sich aufbaut."
          />

          <div className="mt-4 space-y-1.5">
            {data.calendar.map((entry) => (
              <div key={entry.pollen} className="flex items-center gap-3">
                <span className="w-20 shrink-0 truncate text-[11px] text-ink-muted">
                  {entry.label}
                </span>
                <div className="flex flex-1 gap-px overflow-hidden">
                  {entry.points.map((point) => (
                    <span
                      key={point.date}
                      className={`h-4 min-w-1 flex-1 ${styleFor(point.level)}`}
                      title={`${isoToGerman(point.date)}: ${point.value}`}
                    />
                  ))}
                </div>
                <span className="numeric w-12 shrink-0 text-right text-[10px] text-ink-faint">
                  {entry.activeDays} d
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[10px] text-ink-faint">
            Rechts die Zahl der Tage mit einer Belastung über Stufe 0. Die
            Stufen sind Ränge, keine Messwerte — sie werden hier gezählt, nicht
            gemittelt.
          </p>
        </Card>
      )}

      {data.accuracy.ready && (
        <Card>
          <SectionHeading
            icon={Target}
            title="Wie gut hielt die Vorhersage?"
            hint="Was im Voraus gesagt wurde, gegen das, was am Tag selbst galt."
          />
          <ul className="mt-4 space-y-2">
            {data.accuracy.horizons.map((h) => (
              <li key={h.offset} className="text-xs text-ink-muted">
                <span className="text-ink">{h.label}</span>: {shareOf(h.exact ?? 0)} exakt
                getroffen, {shareOf(h.within ?? 0)} um höchstens eine Stufe daneben — aus{' '}
                {num(h.compared, 0)} Vergleichen.
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
