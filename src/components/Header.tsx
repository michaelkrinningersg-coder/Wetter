import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudSun,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react'

import type { ImportResult, ImportStatus, Station } from '../types'
import { isoToGerman } from '../lib/format'
import { useTheme } from '../lib/theme'
import { SystemBar } from './SystemBar'

/**
 * One line, because everything below it is the point.
 *
 * This header used to be a card 170 pixels tall, with the station name at
 * 20 px, a second line repeating the altitude, a boxed station picker, and a
 * panel of three statistics. Under it sat a data-freshness strip, an
 * introductory paragraph and a teaser card. Together they filled 500 of the
 * 1000 pixels a laptop shows before a single measurement appeared: the first
 * row of figures started at y≈570 and the second was cut off.
 *
 * Nothing here was wrong, only expensive. The name, the station, the extent of
 * the archive and the two buttons all still exist — on one 48-pixel row, in
 * the order one reads them.
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
      className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-line bg-raised text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      {theme === 'dark' ? (
        <Sun className="size-3.5" aria-hidden />
      ) : (
        <Moon className="size-3.5" aria-hidden />
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
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-12 max-w-[1560px] items-center gap-3 px-4 sm:px-6">
        <CloudSun className="size-[18px] shrink-0 text-brand" aria-hidden />
        <h1 className="shrink-0 text-sm font-semibold tracking-tight text-ink">
          Wetterstation
        </h1>

        {/* The picker is the station name: a separate heading repeating it was
            one line of the old header that said nothing the select did not. */}
        <label className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1">
          <span className="sr-only">Station</span>
          <select
            value={stationId}
            onChange={(e) => onStationChange(e.target.value)}
            className="cursor-pointer bg-transparent text-xs font-medium text-ink focus:outline-none"
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id} className="bg-canvas text-ink">
                {s.name}
              </option>
            ))}
          </select>
          <span className="numeric text-[10px] text-ink-faint">
            {station?.altitude ?? '—'} m
          </span>
        </label>

        <div className="flex-1" />

        <p className="numeric hidden text-[11px] text-ink-faint xl:block">
          {status ? status.rowCount.toLocaleString('de-DE') : '…'} Messtage ·{' '}
          {status ? isoToGerman(status.minDate) : '…'} –{' '}
          {status ? isoToGerman(status.maxDate) : '…'}
        </p>

        <SystemBar />
        <ThemeToggle />

        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[11px] font-semibold text-canvas transition-colors hover:bg-brand-dim disabled:cursor-wait disabled:bg-brand/40 disabled:text-ink-muted"
        >
          <RefreshCw className={`size-3 ${busy ? 'animate-spin' : ''}`} aria-hidden />
          {busy ? 'Synchronisiert…' : 'Synchronisieren'}
        </button>
      </div>

      {/* Status messages, announced to assistive tech as they appear. */}
      <div aria-live="polite" className="empty:hidden">
        {result && (
          <div className="border-t border-line px-4 py-2.5 sm:px-6">
            {result.success ? (
              <div className="mx-auto flex max-w-[1560px] gap-2 text-xs">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-good" aria-hidden />
                <p className="text-ink-muted">
                  <span className="font-semibold text-good">
                    Synchronisierung abgeschlossen —{' '}
                  </span>
                  {result.newRecordsCount && result.newRecordsCount > 0 ? (
                    <>
                      {result.newRecordsCount.toLocaleString('de-DE')} neue Messtage,
                      jetzt bis{' '}
                      <span className="numeric text-ink">
                        {isoToGerman(result.newMaxDate)}
                      </span>
                      .
                    </>
                  ) : (
                    'der Datenbestand war bereits aktuell.'
                  )}
                </p>
              </div>
            ) : (
              <div className="mx-auto flex max-w-[1560px] gap-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-bad" aria-hidden />
                <p className="text-ink-muted">
                  <span className="font-semibold text-bad">
                    Synchronisierung fehlgeschlagen —{' '}
                  </span>
                  {result.error ?? 'Der DWD-Server war nicht erreichbar.'}
                </p>
              </div>
            )}
          </div>
        )}

        {status?.lastError && (
          <div className="border-t border-line bg-bad/[0.06] px-4 py-2 text-xs sm:px-6">
            <p className="mx-auto flex max-w-[1560px] gap-2 text-ink-muted">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-bad" aria-hidden />
              <span>
                <span className="font-semibold text-bad">Letzter Systemfehler:</span>{' '}
                {status.lastError}
              </span>
            </p>
          </div>
        )}

        {status?.importInProgress && (
          <div className="border-t border-line bg-brand/[0.06] px-4 py-2 text-xs text-ink-muted sm:px-6">
            <p className="mx-auto flex max-w-[1560px] items-center gap-2">
              <span className="size-1.5 animate-ping rounded-full bg-brand" aria-hidden />
              DWD-Klimadaten werden geladen und in die lokale Datenbank importiert…
            </p>
          </div>
        )}
      </div>
    </header>
  )
}
