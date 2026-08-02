import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react'

import { useApi } from '../lib/api'
import { useTheme } from '../lib/theme'
import { useUrlState } from '../lib/url-state'
import { isoToGerman, num } from '../lib/format'
import { percentile } from '../lib/stats'
import type { GermanyMapResponse, GermanyStationRegister } from '../types'
import {
  Card,
  ErrorState,
  InfoPanel,
  Loading,
  SectionHeading,
  StatGrid,
  StatTile,
} from './ui'

/* -------------------------------------------------------------------------- */
/* Projection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Equirectangular, with the longitude axis shrunk by cos(latitude).
 *
 * At Germany's mean latitude of 51° a degree of longitude covers 0.63 of the
 * ground a degree of latitude does. Plotting the raw numbers would stretch the
 * country half again as wide as it is. This is not an equal-area projection —
 * for a strip eight degrees tall the difference is not visible, and anything
 * more elaborate would need a projection library.
 */
function makeProjection(bounds: GermanyStationRegister['bounds'], width: number, height: number) {
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180)
  const stretch = Math.cos(midLat)

  const spanX = (bounds.maxLon - bounds.minLon) * stretch
  const spanY = bounds.maxLat - bounds.minLat
  // One scale for both axes, so the shape stays true rather than filling the box.
  const scale = Math.min(width / spanX, height / spanY)

  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2

  return (lat: number, lon: number) => ({
    x: offsetX + (lon - bounds.minLon) * stretch * scale,
    y: offsetY + (bounds.maxLat - lat) * scale,
  })
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/*
 * The map ramps are the one set of colours that could not become CSS
 * variables: they are picked by index from an array, and thirteen variables to
 * express two gradients would be worse than two arrays.
 *
 * The light versions are not the dark ones adjusted. The dark diverging ramp
 * passes through 86 % lightness in its middle, which is a legible "near
 * average" on near black and an invisible dot on near white — so the light
 * ramp runs darker throughout and puts its neutral at 78 %, still clearly
 * lighter than either extreme without vanishing into the page.
 */

/** Cold to warm, through a desaturated middle so the extremes carry the eye. */
const DIVERGING_DARK = [
  'oklch(55% 0.16 255)',
  'oklch(70% 0.12 235)',
  'oklch(82% 0.05 220)',
  'oklch(86% 0.04 90)',
  'oklch(80% 0.13 60)',
  'oklch(70% 0.18 35)',
  'oklch(56% 0.20 25)',
]

const DIVERGING_LIGHT = [
  'oklch(42% 0.17 255)',
  'oklch(58% 0.14 235)',
  'oklch(72% 0.07 220)',
  'oklch(78% 0.05 90)',
  'oklch(68% 0.15 60)',
  'oklch(56% 0.19 35)',
  'oklch(44% 0.20 25)',
]

/** Dry to wet. */
const SEQUENTIAL_DARK = [
  'oklch(72% 0.03 230)',
  'oklch(74% 0.08 225)',
  'oklch(70% 0.12 220)',
  'oklch(62% 0.15 235)',
  'oklch(52% 0.17 250)',
  'oklch(42% 0.17 265)',
]

const SEQUENTIAL_LIGHT = [
  'oklch(84% 0.03 230)',
  'oklch(76% 0.08 225)',
  'oklch(66% 0.13 220)',
  'oklch(56% 0.16 235)',
  'oklch(46% 0.17 250)',
  'oklch(36% 0.16 265)',
]

const RAMPS = {
  dark: { diverging: DIVERGING_DARK, sequential: SEQUENTIAL_DARK },
  light: { diverging: DIVERGING_LIGHT, sequential: SEQUENTIAL_LIGHT },
}

function ramp(colours: string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const index = Math.min(colours.length - 1, Math.floor(clamped * colours.length))
  return colours[index]!
}

interface Scale {
  low: number
  high: number
  colours: string[]
  /** Precipitation is mostly zero; that deserves its own mark, not the palest blue. */
  zeroIsAbsence: boolean
}

function buildScale(
  values: number[],
  kind: string,
  ramps: (typeof RAMPS)['dark'],
): Scale | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)

  if (kind === 'sequential') {
    // Anchored at zero and cut at the 98th percentile: a single cloudburst
    // would otherwise push every other station into the first colour step.
    const high = percentile(sorted, 0.98) ?? sorted.at(-1)!
    return { low: 0, high: high > 0 ? high : 1, colours: ramps.sequential, zeroIsAbsence: true }
  }

  const low = percentile(sorted, 0.02) ?? sorted[0]!
  const high = percentile(sorted, 0.98) ?? sorted.at(-1)!
  return {
    low,
    high: high > low ? high : low + 1,
    colours: ramps.diverging,
    zeroIsAbsence: false,
  }
}

const colourFor = (scale: Scale, value: number) =>
  ramp(scale.colours, (value - scale.low) / (scale.high - scale.low))

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

const WIDTH = 640
const HEIGHT = 820

export function GermanyMap() {
  const [theme] = useTheme()
  const [date, setDate] = useUrlState<string>('datum', null)
  const [field, setField] = useUrlState<string>('groesse', null)

  // The register never changes with the date, so it is its own request and the
  // browser caches it across every day the user steps through.
  const register = useApi<GermanyStationRegister>('/api/germany/stations')
  const map = useApi<GermanyMapResponse>(
    `/api/germany/map${date ? `?date=${date}` : ''}`,
    [date],
  )

  const stations = useMemo(() => {
    const result = new Map<
      string,
      { name: string; state: string; lat: number; lon: number; elevation: number }
    >()
    for (const [id, name, state, lat, lon, elevation] of register.data?.stations ?? []) {
      result.set(id, { name, state, lat, lon, elevation })
    }
    return result
  }, [register.data])

  if ((register.loading && !register.data) || (map.loading && !map.data)) {
    return <Loading message="Karte wird geladen …" />
  }
  if (register.error) return <ErrorState message={register.error} />
  if (map.error) return <ErrorState message={map.error} />
  if (!register.data || !map.data?.day) return null

  const fields = register.data.fields
  const active = fields.find((f) => f.key === field) ?? fields[0]!
  const day = map.data.day
  const dates = map.data.dates

  const at = dates.indexOf(day.date)
  const older = at >= 0 && at < dates.length - 1 ? dates[at + 1]! : null
  const newer = at > 0 ? dates[at - 1]! : null

  const pairs = day.values[active.key] ?? []
  const scale = buildScale(
    pairs.map(([, v]) => v),
    active.scale,
    RAMPS[theme],
  )

  const project = makeProjection(register.data.bounds, WIDTH, HEIGHT)

  const points = pairs
    .map(([id, value]) => {
      const station = stations.get(id)
      if (!station) return null
      const { x, y } = project(station.lat, station.lon)
      return { id, value, x, y, station }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    // Draw the extremes last so they are not buried under the bulk.
    .sort((a, b) => Math.abs(a.value) - Math.abs(b.value))

  const values = pairs.map(([, v]) => v).sort((a, b) => a - b)
  const highest = points.reduce<(typeof points)[number] | null>(
    (best, p) => (!best || p.value > best.value ? p : best),
    null,
  )
  const lowest = points.reduce<(typeof points)[number] | null>(
    (best, p) => (!best || p.value < best.value ? p : best),
    null,
  )

  const legendStops = scale
    ? Array.from({ length: 6 }, (_, i) => {
        const t = i / 5
        return { t, value: scale.low + (scale.high - scale.low) * t }
      })
    : []

  return (
    <div className="space-y-6">
      <InfoPanel title="Deutschlandkarte">
        <p>
          Jeder Punkt ist eine DWD-Station an ihrem tatsächlichen Standort. Bei
          rund {num(register.data.count, 0)} Stationen zeichnet die Punktwolke
          den Umriss des Landes selbst — eine Hintergrundkarte ist nicht nötig
          und wäre eine weitere Quelle, die niemand geprüft hat.
        </p>
        <p>
          Die Farbskala läuft vom 2. bis zum 98. Perzentil des gewählten Tages,
          damit ein einzelner Ausreißer nicht alle übrigen Stationen in denselben
          Farbton drückt. Beim Niederschlag beginnt sie bei null, und trockene
          Stationen bekommen einen eigenen, offenen Punkt — sonst sähe „kein
          Regen" aus wie „ganz wenig Regen".
        </p>
        <p>
          Wie viele Punkte erscheinen, hängt von der Größe ab: Niederschlag
          messen fast 2000 Stationen, Wind nur rund 270. Die Zahl steht neben der
          Auswahl.
        </p>
      </InfoPanel>

      <Card>
        <SectionHeading
          icon={MapPin}
          title={`${active.label} am ${isoToGerman(day.date)}`}
          hint={`${num(points.length, 0)} Stationen mit einem Messwert für diese Größe · Archiv ${isoToGerman(
            map.data.range.first,
          )} bis ${isoToGerman(map.data.range.last)}.`}
          actions={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!older}
                onClick={() => older && setDate(older)}
                aria-label="Vorheriger Tag"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <select
                value={day.date}
                onChange={(e) => setDate(e.target.value)}
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
                onClick={() => newer && setDate(newer)}
                aria-label="Nächster Tag"
                className="cursor-pointer rounded-md border border-line bg-raised p-1.5 text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          }
        />

        <div role="radiogroup" aria-label="Größe" className="mb-5 flex flex-wrap gap-1.5">
          {fields.map((f) => {
            const isActive = f.key === active.key
            const count = (day.values[f.key] ?? []).length
            return (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setField(f.key)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-brand text-canvas'
                    : 'border border-line bg-raised text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {f.label}
                <span className={`ml-1.5 ${isActive ? 'text-canvas/70' : 'text-ink-faint'}`}>
                  {num(count, 0)}
                </span>
              </button>
            )
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="rounded-card border border-line bg-raised p-3">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="mx-auto block h-auto w-full max-w-[34rem]"
              role="img"
              aria-label={`${active.label} an ${points.length} Stationen am ${isoToGerman(day.date)}`}
            >
              {points.map((p) => {
                const dry = scale?.zeroIsAbsence && p.value === 0
                return (
                  <circle
                    key={p.id}
                    cx={p.x}
                    cy={p.y}
                    r={dry ? 2 : 3.1}
                    fill={dry ? 'none' : scale ? colourFor(scale, p.value) : 'currentColor'}
                    stroke={dry ? 'oklch(46% 0.01 260)' : 'oklch(18% 0.01 260)'}
                    strokeWidth={dry ? 0.8 : 0.4}
                  >
                    <title>
                      {`${p.station.name} (${p.station.state}, ${num(p.station.elevation, 0)} m): ${num(
                        p.value,
                        active.decimals,
                      )} ${active.unit}`}
                    </title>
                  </circle>
                )
              })}
            </svg>
          </div>

          <div className="space-y-4">
            {scale && (
              <div>
                <p className="label mb-2">Skala</p>
                <div className="flex h-4 overflow-hidden rounded">
                  {scale.colours.map((c) => (
                    <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
                  {legendStops.map((s) => (
                    <span key={s.t} className="numeric">
                      {num(s.value, active.decimals)}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-ink-faint">
                  in {active.unit}
                  {scale.zeroIsAbsence && ' · offener Punkt = 0'}
                </p>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-ink-faint">
              Zeiger über einen Punkt halten zeigt Station, Bundesland, Höhe und
              Messwert.
            </p>
          </div>
        </div>

        {/* Below the map rather than beside it: in a sidebar these four tiles
            wrap their own numbers onto three lines. */}
        <div className="mt-6">
          <StatGrid>
            <StatTile
              label="Höchster Wert"
              value={highest ? `${num(highest.value, active.decimals)} ${active.unit}` : '—'}
              caption={highest?.station.name}
              accent="hot"
            />
            <StatTile
              label="Niedrigster Wert"
              value={lowest ? `${num(lowest.value, active.decimals)} ${active.unit}` : '—'}
              caption={lowest?.station.name}
              accent="cold"
            />
            <StatTile
              label="Median"
              value={
                values.length > 0
                  ? `${num(percentile(values, 0.5) ?? 0, active.decimals)} ${active.unit}`
                  : '—'
              }
              accent="neutral"
            />
            <StatTile
              label="Stationen am Tag"
              value={num(day.stations, 0)}
              caption="mit mindestens einem Messwert"
              accent="brand"
            />
          </StatGrid>
        </div>
      </Card>
    </div>
  )
}
