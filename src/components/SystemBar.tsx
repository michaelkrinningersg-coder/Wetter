import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react'

import { useApi } from '../lib/api'
import { isoToGerman } from '../lib/format'
import type { JobStatus, SystemResponse } from '../types'

/**
 * What the four GitHub workflows used to say in their run history.
 *
 * A hosted build was as fresh as its last deploy and said so in one line. A
 * local app is as fresh as the last time it was open, which is a different
 * claim and a variable one: a machine that was off for a week shows a week-old
 * newsroom, and nothing else in the interface would give that away. So each
 * source states how far it reaches and when it last succeeded.
 *
 * It used to state all five permanently, as a full-width strip under the
 * header. That is a lot of room for a sentence that reads "everything is fine"
 * on most days, so the strip is now one word in the header — "aktuell", or how
 * many sources are behind — and the five lines are one click away.
 *
 * The poll behind it is the reason `covered()` in `server/jobs.js` has to stay
 * a single `MAX`: once a minute, forever, is a bad place for an analysis. Two
 * of them used to build a whole overview to read one date, and this bar was
 * costing three quarters of a second of server time every sixty seconds.
 */

/** Poll while a run is going; otherwise the bar only needs a value per minute. */
const IDLE_MS = 60_000
const BUSY_MS = 2_000

/**
 * "Current" is not the same distance for every source.
 *
 * The DWD checks its station readings before publishing them, so an archive
 * that ends the day before yesterday is working as designed; the nationwide
 * collector, which reads the unchecked feed, is late at the same distance.
 * The server states each source's tolerance rather than the bar guessing one.
 */
const behind = (job: JobStatus) =>
  job.gapDays === null ? null : Math.max(0, job.gapDays - job.graceDays)

function toneOf(job: JobStatus): { dot: string; text: string } {
  if (job.running) return { dot: 'bg-brand animate-pulse', text: 'text-ink' }
  if (job.lastError) return { dot: 'bg-bad', text: 'text-bad' }
  const late = behind(job)
  if (late === null) return { dot: 'bg-line-strong', text: 'text-ink-faint' }
  if (late === 0) return { dot: 'bg-good', text: 'text-ink-muted' }
  if (late <= 7) return { dot: 'bg-warm', text: 'text-ink-muted' }
  return { dot: 'bg-bad', text: 'text-ink-muted' }
}

function coverText(job: JobStatus): string {
  if (job.covered === null) return 'noch nichts'
  const late = behind(job)
  if (late === null || late === 0) return 'aktuell'
  return late === 1 ? 'ein Tag fehlt' : `${late} Tage fehlen`
}

export function SystemBar() {
  const { data, reload } = useApi<SystemResponse>('/api/system')
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  /*
   * A panel that floats over the page has to be dismissible without hitting
   * the one button that opened it — it covers a third of the dashboard, and
   * the reflex for that is a click anywhere else, or Escape.
   */
  useEffect(() => {
    if (!open) return

    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const anyRunning = data?.jobs.some((job) => job.running) ?? false

  useEffect(() => {
    const id = setInterval(reload, anyRunning || busy ? BUSY_MS : IDLE_MS)
    return () => clearInterval(id)
  }, [reload, anyRunning, busy])

  const run = useCallback(
    async (key: string) => {
      setBusy(key)
      try {
        await fetch(`/api/system/run?job=${encodeURIComponent(key)}`, { method: 'POST' })
      } finally {
        setBusy(null)
        reload()
      }
    },
    [reload],
  )

  if (!data) return null

  const stale = data.jobs.filter((job) => (behind(job) ?? 1) > 0 || job.lastError)
  const running = data.jobs.filter((job) => job.running)

  const summary =
    running.length > 0
      ? `${running.length === 1 ? running[0]!.label : `${running.length} Quellen`} läuft …`
      : stale.length === 0
        ? 'aktuell'
        : `${stale.length} von ${data.jobs.length} veraltet`

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Datenstand der fünf Quellen"
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-ink-muted transition-colors hover:bg-raised hover:text-ink"
      >
        {running.length > 0 ? (
          <Loader2 className="size-3 animate-spin text-brand" aria-hidden />
        ) : stale.length === 0 ? (
          <Check className="size-3 text-good" aria-hidden />
        ) : (
          <AlertTriangle className="size-3 text-warm" aria-hidden />
        )}
        <span className="hidden sm:inline">{summary}</span>
      </button>

      {open && (
        /* Anchored to the button rather than pushing the page down: the panel
           is 300 pixels tall and the interface underneath it should not jump
           every time somebody checks whether the collectors ran. */
        <div className="absolute right-0 top-9 z-20 w-[min(30rem,calc(100vw-2rem))] rounded-card border border-line bg-surface px-4 py-3 shadow-2xl shadow-black/40">
          <ul className="space-y-2">
            {data.jobs.map((job) => (
              <li key={job.key} className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${toneOf(job).dot}`}
                      aria-hidden
                    />
                    {job.label}
                    <span className={`numeric text-[11px] font-normal ${toneOf(job).text}`}>
                      {job.running ? 'läuft …' : coverText(job)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {job.covered === null
                      ? 'Das Archiv ist leer.'
                      : `Reicht bis ${isoToGerman(job.covered)}.`}{' '}
                    {job.lastSuccess
                      ? `Zuletzt erfolgreich am ${isoToGerman(job.lastSuccess.slice(0, 10))}.`
                      : 'In dieser Installation noch nicht gelaufen.'}{' '}
                    {job.everyMinutes >= 1440
                      ? 'Läuft täglich.'
                      : `Läuft alle ${job.everyMinutes} Minuten, solange das Fenster offen ist.`}
                  </p>
                  {job.lastError && (
                    <p className="mt-0.5 text-[11px] text-bad">{job.lastError}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => run(job.key)}
                  disabled={job.running || busy !== null}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-brand hover:text-brand disabled:cursor-wait disabled:opacity-50"
                >
                  {job.running || busy === job.key ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="size-3" aria-hidden />
                  )}
                  Jetzt holen
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-3 border-t border-line pt-2.5 text-[10px] text-ink-faint">
            Gesammelt wird nur, solange das Programm läuft. Die Stationsarchive,
            die Deutschlandwerte und die Luftqualität lassen sich nachholen —
            Ortsdosisleistung und Pollenflug nicht: beide Quellen halten nur ein
            kurzes Fenster vor, und was dort fehlt, bleibt eine Lücke.
          </p>
          <p className="mt-1 text-[10px] text-ink-faint">
            Ablage: <span className="numeric">{data.dataRoot}</span>
          </p>
        </div>
      )}
    </div>
  )
}
