import { useMemo } from 'react'

import { signed, temp } from '../lib/format'
import type { AnnualMeanRecord } from '../types'

/**
 * Warming stripes after Ed Hawkins: one bar per year, coloured by its anomaly,
 * no axes and no gridlines. The point is the overall shift from blue to red,
 * not any single year — so the chart deliberately carries no scale furniture.
 *
 * The colour ramp is capped at ±`limit` so a handful of outliers cannot flatten
 * everything else into the same shade.
 */
export function WarmingStripes({
  records,
  limit = 1.5,
}: {
  records: AnnualMeanRecord[]
  limit?: number
}) {
  const stripes = useMemo(
    () =>
      records.map((r) => {
        const t = Math.max(-1, Math.min(1, r.anomaly / limit))
        // Fixed hue per half, chroma carries the magnitude — the same rule the
        // heatmap uses, so both read as one visual system.
        const color =
          t < 0
            ? `oklch(${52 + -t * 14}% ${0.02 + -t * 0.13} 255)`
            : `oklch(${66 - t * 14}% ${0.02 + t * 0.16} 25)`
        return { year: r.year, anomaly: r.anomaly, color }
      }),
    [records, limit],
  )

  if (stripes.length === 0) return null

  const first = stripes[0]!
  const last = stripes[stripes.length - 1]!

  return (
    <figure className="m-0">
      <div
        className="flex h-28 w-full overflow-hidden rounded-card"
        role="img"
        aria-label={`Temperaturanomalien ${first.year} bis ${last.year}: jeder Streifen ein Jahr, blau kühler und rot wärmer als das Gesamtmittel.`}
      >
        {stripes.map((s) => (
          <div
            key={s.year}
            className="h-full flex-1 transition-transform hover:scale-y-105"
            style={{ backgroundColor: s.color }}
            title={`${s.year}: ${signed(s.anomaly, 2, '°C')}`}
          />
        ))}
      </div>
      <figcaption className="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
        <span className="numeric">{first.year}</span>
        <span>
          Ein Streifen je Jahr · blau kühler, rot wärmer als das Gesamtmittel ·
          Skala ±{temp(limit, 1)}
        </span>
        <span className="numeric">{last.year}</span>
      </figcaption>
    </figure>
  )
}
