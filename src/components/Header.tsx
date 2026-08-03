import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudSun,
  Database,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react'

import type { ImportResult, ImportStatus, Station } from '../types'
import { isoToGerman } from '../lib/format'
import { useTheme } from '../lib/theme'

/**
 * Light or dark, by hand.
 *
 * Dark is the default and stays it — this app was designed dark. The switch
 * exists for the visitor who opens the link outdoors, and the choice is
 * remembered. Rendered as a two-state button rather than a checkbox so the
 * icon can say what pressing it will do.
 */
function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={next === 'light' ? 'Helle Darstellung' : 'Dunkle Darstellung'}
      aria-label={next === 'light' ? 'Zu heller Darstellung wechseln' : 'Zu dunkler Darstellung wechseln'}
      className="flex size-9 cursor-pointer items-center justify-center rounded-md border border-line bg-raised text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      {theme === 'dark' ? (
        <Sun className="size-4" aria-hidden />
      ) : (
        <Moon className="size-4" aria-hidden />
      )}
    </button>
  )
}

export function Header({
  status,
  stations,
  stationId,
  onStationChange,
  onImported,
}: {
  status: ImportStatus | null
  stations: Station[]
  stationId: string
  onStationChange: (id: string) => void
  onImported: () => void | Promise<unknown>
}) {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const station = stations.find((s) => s.id === stationId)
  const busy = syncing || status?.importInProgress === true

  async function sync() {
    setSyncing(true)
    setResult(null)
    try {
      const res = await fetch(
        `/api/import?stationId=${encodeURIComponent(stationId)}`,
        { method: 'POST' },
      )
      const body = (await res.json().catch(() => ({}))) as ImportResult & {
        error?: string
      }
      if (res.ok) {
        setResult(body)
      } else {
        // The original stored the server's error text in `previousMaxDate`
        // and rendered it under the label "Grund:", which meant a real error
        // message was shown in a field meant for a date.
        setResult({ success: false, error: body.error ?? `HTTP ${res.status}` })
      }
      await onImported()
    } catch (err) {
      setResult({
        success: false,
        error:
          err instanceof Error ? err.message : 'Verbindung zum Server fehlgeschlagen.',
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <header className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="h-0.5 bg-gradient-to-r from-brand via-hot to-brand" aria-hidden />

      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <CloudSun className="size-5 shrink-0 text-brand" aria-hidden />
            <h1 className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">
              Wetterstation {station?.name ?? '…'}
            </h1>
            <span className="numeric rounded border border-line bg-raised px-1.5 py-0.5 text-[10px] text-ink-faint">
              #{stationId}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            DWD-Klimadatenanalyse · {station?.altitude ?? '—'} m ü. NHN
          </p>

          <label className="mt-3 inline-flex items-center gap-2 rounded-md border border-line bg-raised px-2.5 py-1.5">
            <span className="label">Station</span>
            <select
              value={stationId}
              onChange={(e) => onStationChange(e.target.value)}
              className="cursor-pointer bg-transparent text-xs font-medium text-brand focus:outline-none"
            >
              {stations.map((s) => (
                <option key={s.id} value={s.id} className="bg-canvas text-ink">
                  {s.name} ({s.altitude} m)
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-raised p-3">
          <div className="flex items-center gap-2.5">
            <Database className="size-4 text-brand" aria-hidden />
            <div>
              <p className="label">Datensätze</p>
              <p className="numeric text-xs font-semibold text-ink">
                {status ? status.rowCount.toLocaleString('de-DE') : '…'}
              </p>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-line sm:block" aria-hidden />

          <div>
            <p className="label">Zeitraum</p>
            <p className="numeric text-xs text-ink">
              {status ? isoToGerman(status.minDate) : '…'} –{' '}
              {status ? isoToGerman(status.maxDate) : '…'}
            </p>
          </div>

          <div className="hidden h-8 w-px bg-line sm:block" aria-hidden />

          <ThemeToggle />

          <button
            type="button"
            onClick={sync}
            disabled={busy}
            className="flex cursor-pointer items-center gap-2 rounded-md bg-brand px-3.5 py-2 text-xs font-semibold text-canvas transition-colors hover:bg-brand-dim disabled:cursor-wait disabled:bg-brand/40 disabled:text-ink-muted"
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {busy ? 'Synchronisiert…' : 'Synchronisieren'}
          </button>
        </div>
      </div>

      {/* Status messages, announced to assistive tech as they appear. */}
      <div aria-live="polite" className="empty:hidden">
        {result && (
          <div className="border-t border-line px-5 py-3.5 sm:px-6">
            {result.success ? (
              <div className="flex gap-2.5 text-xs">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
                <div>
                  <p className="font-semibold text-good">
                    Synchronisierung abgeschlossen
                  </p>
                  <p className="mt-0.5 text-ink-muted">
                    {result.newRecordsCount && result.newRecordsCount > 0 ? (
                      <>
                        {result.newRecordsCount.toLocaleString('de-DE')} neue Messtage
                        importiert. Datenbestand jetzt bis{' '}
                        <span className="numeric text-ink">
                          {isoToGerman(result.newMaxDate)}
                        </span>
                        .
                      </>
                    ) : (
                      'Der Datenbestand war bereits aktuell — keine neuen Messtage beim DWD verfügbar.'
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex gap-2.5 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
                <div>
                  <p className="font-semibold text-bad">Synchronisierung fehlgeschlagen</p>
                  <p className="mt-0.5 text-ink-muted">
                    {result.error ?? 'Der DWD-Server war nicht erreichbar.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {status?.lastError && (
          <div className="flex gap-2.5 border-t border-line bg-bad/[0.06] px-5 py-3 text-xs sm:px-6">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
            <p className="text-ink-muted">
              <span className="font-semibold text-bad">Letzter Systemfehler:</span>{' '}
              {status.lastError}
            </p>
          </div>
        )}

        {status?.importInProgress && (
          <div className="flex items-center gap-2.5 border-t border-line bg-brand/[0.06] px-5 py-3 text-xs text-ink-muted sm:px-6">
            <span className="size-1.5 animate-ping rounded-full bg-brand" aria-hidden />
            DWD-Klimadaten werden geladen und in die lokale Datenbank importiert…
          </div>
        )}
      </div>
    </header>
  )
}
