import { useState } from 'react'
import { Info } from 'lucide-react'

import { useApi } from '../lib/api'
import { percent } from '../lib/format'
import type { CoverageResponse } from '../types'
import { Card } from './ui'

/**
 * Homogeneity caveat for the long series.
 *
 * A record running from 1858 to today looks like one continuous measurement,
 * but stations get relocated, instruments and reading times change, and the
 * surroundings urbanise. Rather than a generic disclaimer, this pulls the
 * actual coverage out of the database: which variables start when, and how
 * complete each decade is. That turns "be careful with old data" into
 * something the reader can check.
 */
export function DataQuality({ stationId }: { stationId: string }) {
  const [open, setOpen] = useState(false)
  const { data } = useApi<CoverageResponse>(
    open ? `/api/weather/coverage?stationId=${encodeURIComponent(stationId)}` : null,
    [stationId],
  )

  const sparse = data?.byDecade.filter((d) => d.tempShare < 0.9) ?? []

  return (
    <Card className="border-line/70 bg-surface/60" padded={false}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-5 py-3 text-left"
      >
        <Info className="size-4 shrink-0 text-ink-faint" aria-hidden />
        <span className="flex-1 text-xs font-medium text-ink-muted">
          Zur Belastbarkeit langer Messreihen
        </span>
        <span className="text-[10px] text-ink-faint">
          {open ? 'Schließen' : 'Anzeigen'}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-5 py-4 text-xs leading-relaxed text-ink-muted">
          <p>
            Diese Reihe wird als durchgehende Messung dargestellt, ist aber keine.
            Über mehr als 150 Jahre werden Stationen verlegt, Messgeräte und
            Ablesezeiten geändert und die Umgebung bebaut. Solche Brüche
            verschieben Messwerte um Zehntelgrade — in der Größenordnung des
            Trends, den sie belegen sollen. Der DWD veröffentlicht diese Reihen
            als Rohdaten, <strong className="text-ink">nicht homogenisiert</strong>;
            hier wird nichts korrigiert.
          </p>
          <p>
            Für Aussagen über einzelne frühe Jahre ist das relevant. Für den
            langfristigen Trend über viele Jahrzehnte fällt es weniger ins
            Gewicht — Brüche wirken in beide Richtungen, der Erwärmungstrend
            dagegen nur in eine.
          </p>

          {data && (
            <>
              <div>
                <p className="label mb-2">Ab wann welche Größe gemessen wurde</p>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                  {data.variables.map((v) => (
                    <li key={v.column} className="flex justify-between gap-3">
                      <span>{v.label}</span>
                      <span className="numeric text-ink-faint">
                        ab {v.firstYear ?? '—'} · {percent(v.share * 100, 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {sparse.length > 0 && (
                <div>
                  <p className="label mb-2">
                    Jahrzehnte unter 90 % Temperaturabdeckung
                  </p>
                  <p className="numeric text-ink-faint">
                    {sparse
                      .map((d) => `${d.decade}er (${percent(d.tempShare * 100, 0)})`)
                      .join(' · ')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}
