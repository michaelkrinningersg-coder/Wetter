import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { db } from './db.js'
import { STATIONS } from './stations.js'
import { importStation } from './dwd.js'
import { archiveRange, importArchive as importGermany } from './germany.js'
import { buildEvents } from './records.js'
import { importRegional } from './regional.js'
import { loadNationwide } from './nationwide.js'
import { airOverview, importAir } from './air.js'
import { importOdl } from './odl.js'
import { importPollen } from './pollen.js'
import { refreshAll } from './gauges.js'

/**
 * The collectors, run by the app itself.
 *
 * They used to be four GitHub workflows on a cron. Locally there is no cron and
 * no runner, so the app has to be its own scheduler — and unlike a runner it
 * cannot assume it was awake yesterday. Everything here is therefore built
 * around catching up rather than around a clock: what has to run is derived
 * from how far the archive reaches, not from when a timer last fired. A laptop
 * that was shut for three weeks and one that was never opened take the same
 * path through this file.
 *
 * Two kinds of work live side by side:
 *
 *  - The collectors that only need the Node standard library run as their own
 *    process, exactly as they did in the workflows. That is not nostalgia: it
 *    keeps them unable to touch SQLite, so a half-finished download can damage
 *    a CSV file at worst, never the database. Their output is folded back in
 *    afterwards by the `after` step.
 *  - Station import and gauges run in-process, because both write to SQLite
 *    anyway and a second writer would buy nothing.
 */

const here = dirname(fileURLToPath(import.meta.url))
const scriptsDir = join(here, '..', 'scripts')

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS job_runs (
    job           TEXT PRIMARY KEY,
    last_started  TEXT,
    last_finished TEXT,
    last_success  TEXT,
    last_error    TEXT,
    last_ms       INTEGER
  );
`)

const readRun = db.prepare('SELECT * FROM job_runs WHERE job = ?')
const writeRun = db.prepare(`
  INSERT INTO job_runs (job, last_started, last_finished, last_success, last_error, last_ms)
  VALUES (@job, @last_started, @last_finished, @last_success, @last_error, @last_ms)
  ON CONFLICT (job) DO UPDATE SET
    last_started  = excluded.last_started,
    last_finished = excluded.last_finished,
    last_success  = excluded.last_success,
    last_error    = excluded.last_error,
    last_ms       = excluded.last_ms
`)

const markStarted = db.prepare(`
  INSERT INTO job_runs (job, last_started) VALUES (?, ?)
  ON CONFLICT (job) DO UPDATE SET last_started = excluded.last_started
`)

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

/** Today in Berlin — the DWD labels its climatological day in local time. */
export function berlinDate(offsetDays = 0) {
  const at = new Date(Date.now() - offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

/** Whole days between two ISO dates, or null when either is missing. */
function gapDays(from, to) {
  if (!from || !to) return null
  return dayNumber(to) - dayNumber(from)
}

/** Every date from `from` to `to`, both ends included. */
function dateRange(from, to) {
  const out = []
  for (let n = dayNumber(from); n <= dayNumber(to); n++) {
    out.push(new Date(n * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Running a collector                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Run one collector as a child process.
 *
 * `process.execPath` is Node when the server is started with `npm start` and
 * the Electron binary inside the packaged app; `ELECTRON_RUN_AS_NODE` makes
 * the latter behave as the former. Nothing else works in both places — the
 * packaged app has no `node` on the machine to call.
 */
function runScript(file, args = [], onLine = null) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(scriptsDir, file), ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let tail = ''
    const keep = (chunk) => {
      const text = String(chunk)
      // Only the last few lines are kept: a backfill prints hundreds and the
      // point of storing any of them is the error message at the end.
      tail = (tail + text).split('\n').slice(-12).join('\n')
      if (onLine) for (const line of text.split('\n')) if (line.trim()) onLine(line.trim())
    }

    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', (error) => resolve({ ok: false, tail: String(error.message) }))
    child.on('close', (code) => resolve({ ok: code === 0, code, tail: tail.trim() }))
  })
}

/* -------------------------------------------------------------------------- */
/* The jobs                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `covered` answers "how far does this source reach", `plan` turns the gap
 * between that and yesterday into the argument list of an actual run, and
 * `after` folds new files back into the running database so the views change
 * without a restart.
 */
export const JOBS = [
  {
    key: 'station',
    label: 'Stationsarchiv',
    note: 'Göttingen, Brocken, Zugspitze — die drei Messreihen dieser App.',
    everyMinutes: 24 * 60,
    // The DWD's quality control runs before publication, so the station
    // archive routinely trails by a day or two even when everything works.
    graceDays: 3,
    covered: () =>
      db.prepare('SELECT MAX(date) AS last FROM daily').get().last ?? null,
    // Nothing to plan: `importStation` reads the DWD's rolling archive, which
    // covers roughly the last 500 days regardless of when it last ran.
    run: async (report) => {
      for (const station of STATIONS) {
        report(`${station.name} …`)
        const result = await importStation(station.id)
        report(`${station.name}: ${result.newRecordsCount} neu, bis ${result.newMaxDate}`)
      }
    },
  },
  {
    key: 'deutschland',
    label: 'Deutschlandwerte',
    note: 'Rund 2400 Stationen, dazu die amtlichen Gebietsmittel.',
    everyMinutes: 24 * 60,
    graceDays: 1,
    covered: () => archiveRange().last ?? null,
    /*
     * A single day is fetched by date. Beyond three, one pass over the whole
     * rolling archive is cheaper than one full download per missing day — and
     * it is the only thing that helps at all when the gap is longer than a
     * few days but shorter than the archive.
     */
    plan: (gap) => {
      const steps = []
      if (gap === null || gap > 3) {
        steps.push({ file: 'fetch-germany.js', args: ['--backfill'] })
      } else {
        for (const date of dateRange(berlinDate(gap), berlinDate(1))) {
          steps.push({ file: 'fetch-germany.js', args: [date] })
        }
      }
      // The areal means change a few times a year and cost seconds, but the
      // DWD also revises past years — so "already present" is not a reason to
      // skip them.
      steps.push({ file: 'fetch-regional.js', args: [] })
      return steps
    },
    after: () => {
      importGermany()
      importRegional({ force: true })
      loadNationwide()
      buildEvents()
    },
  },
  {
    key: 'umwelt',
    label: 'Umweltdaten',
    note: 'Luftqualität, Ortsdosisleistung, Pollenflug.',
    everyMinutes: 24 * 60,
    // The UBA publishes the hours of a day over the course of the next one.
    graceDays: 2,
    covered: () => airOverview().range.last ?? null,
    plan: (gap) => [
      // The UBA revises recent hours, so the routine run always re-reads a
      // seven-day window; only a longer absence needs an explicit range.
      {
        file: 'fetch-air.js',
        args: gap === null ? ['--backfill'] : gap > 7 ? [berlinDate(gap), berlinDate(1)] : [],
      },
      // Both of these hold a short window and nothing behind it, so a gap is
      // permanent and there is nothing to plan. A failure must not take the
      // air quality down with it.
      { file: 'fetch-odl.js', args: [], optional: true },
      { file: 'fetch-pollen.js', args: [], optional: true },
    ],
    after: () => {
      importAir()
      importOdl()
      importPollen()
    },
  },
  {
    key: 'pegel',
    label: 'Pegelstände',
    note: 'Drei Pegel, stündlich, solange das Fenster offen ist.',
    everyMinutes: 60,
    graceDays: 1,
    covered: () =>
      db.prepare('SELECT MAX(ts) AS last FROM gauge_readings').get().last?.slice(0, 10) ?? null,
    /*
     * The only source with a retroactive window: PEGELONLINE hands out the
     * last 30 days on every call, so an hour of downtime costs nothing and a
     * month of it costs everything. The two state gauges publish the current
     * value alone — those readings exist only because something asked.
     */
    run: async (report) => {
      const results = await refreshAll({ force: true })
      for (const result of results) {
        report(
          result.error
            ? `${result.gauge}: ${result.error}`
            : `${result.gauge}: ${result.storedReadings ?? 0} Werte`,
        )
      }
      if (results.every((r) => r.error)) throw new Error('Kein Pegel erreichbar.')
    },
  },
]

export const JOB_BY_KEY = new Map(JOBS.map((job) => [job.key, job]))

/* -------------------------------------------------------------------------- */
/* Execution                                                                  */
/* -------------------------------------------------------------------------- */

/** One at a time: two collectors writing the same archive would race. */
let queue = Promise.resolve()
const running = new Set()

/*
 * Progress goes to the console and nowhere else. The interface does not read
 * along line by line — it polls `/api/system`, which says what is running, how
 * far each source reaches and what failed. That is the state worth showing;
 * a scrolling log of download lines is only worth having when something has
 * gone wrong, and then the terminal is where one looks.
 */
const announce = (job, line) => console.log(`[${job.key}] ${line}`)

async function execute(job) {
  const started = Date.now()
  running.add(job.key)
  markStarted.run(job.key, new Date().toISOString())

  const report = (line) => announce(job, line)
  let error = null

  try {
    if (job.run) {
      await job.run(report)
    } else {
      const gap = gapDays(job.covered(), berlinDate(1))
      const steps = job.plan(gap)
      for (const step of steps) {
        report(`${step.file}${step.args.length ? ` ${step.args.join(' ')}` : ''} …`)
        const result = await runScript(step.file, step.args, report)
        if (!result.ok && !step.optional) {
          throw new Error(`${step.file}: ${result.tail || `Abbruch mit Code ${result.code}`}`)
        }
      }
      if (job.after) job.after()
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
    report(`Fehlgeschlagen: ${error}`)
  } finally {
    running.delete(job.key)
  }

  const now = new Date().toISOString()
  const previous = readRun.get(job.key)
  writeRun.run({
    job: job.key,
    last_started: previous?.last_started ?? now,
    last_finished: now,
    last_success: error === null ? now : (previous?.last_success ?? null),
    last_error: error,
    last_ms: Date.now() - started,
  })

  return { job: job.key, ok: error === null, error }
}

/** Jobs that are queued or running, so the same one is never scheduled twice. */
const pending = new Map()

/**
 * Queue a job, or hand back the run that is already under way.
 *
 * Both callers can ask twice: the scheduler ticks every five minutes while a
 * backfill may take longer than that, and the button in the status bar can be
 * pressed again while the first press is still downloading.
 */
export function runJob(key) {
  const job = JOB_BY_KEY.get(key)
  if (!job) {
    return Promise.resolve({ job: key, ok: false, error: `Unbekannter Lauf "${key}".` })
  }

  const already = pending.get(key)
  if (already) return already

  const promise = queue.then(() => execute(job))
  queue = promise
  pending.set(key, promise)
  promise.finally(() => {
    if (pending.get(key) === promise) pending.delete(key)
  })
  return promise
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

/** When this job is next allowed to run — null while it has never run. */
function dueAt(job) {
  const run = readRun.get(job.key)
  if (!run?.last_finished) return null
  return new Date(Date.parse(run.last_finished) + job.everyMinutes * 60_000).toISOString()
}

export function jobStatus() {
  return JOBS.map((job) => {
    const run = readRun.get(job.key) ?? {}
    const covered = job.covered()
    return {
      key: job.key,
      label: job.label,
      note: job.note,
      everyMinutes: job.everyMinutes,
      graceDays: job.graceDays,
      covered,
      gapDays: gapDays(covered, berlinDate(1)),
      running: running.has(job.key),
      lastSuccess: run.last_success ?? null,
      lastFinished: run.last_finished ?? null,
      lastError: run.last_error ?? null,
      lastMs: run.last_ms ?? null,
      dueAt: dueAt(job),
    }
  })
}

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/** How often the scheduler looks at its list. */
const TICK_MINUTES = 5

/**
 * True when the job should run now.
 *
 * A job that has never finished always runs — that is the first start, and it
 * is also what happens after the database was deleted. Otherwise the interval
 * decides. Note that a laptop woken from sleep gets the same answer as one
 * that ran the whole time: the comparison is against wall-clock time, not
 * against a timer that was suspended with the machine.
 */
function isDue(job) {
  if (pending.has(job.key)) return false
  const at = dueAt(job)
  return at === null || Date.parse(at) <= Date.now()
}

let timer = null

export function startScheduler() {
  if (timer) return
  const tick = () => {
    for (const job of JOBS) if (isDue(job)) runJob(job.key)
  }
  tick()
  timer = setInterval(tick, TICK_MINUTES * 60_000)
  // The scheduler must not be the reason the process stays alive; the HTTP
  // server already is, and under Electron the window is.
  timer.unref?.()
  return () => stopScheduler()
}

export function stopScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}
