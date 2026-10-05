#!/usr/bin/env node
/**
 * Throw away old workflow runs.
 *
 *   node scripts/cleanup-runs.js [--keep 5] [--days 14] [--dry-run]
 *
 * The run history of this repository is mostly archaeology. Of 163 runs, 134
 * belonged to four workflows that no longer exist — the GitHub Pages build and
 * the three collectors, all removed when the app became a local program. They
 * cost nothing but they bury the two workflows that still matter.
 *
 * Two rules, and a run survives if either holds:
 *
 *  - It is one of the newest `keep` runs of its own workflow. Per workflow,
 *    not in total: a repository with a nightly job and a release job would
 *    otherwise lose every release the moment the nightly ran five times.
 *  - It is younger than `days` days. A build whose artifact is still
 *    downloadable should still have a page to download it from.
 *
 * Written as a script rather than a third-party action because it needs
 * `actions: write` on this repository, and twenty lines of our own are easier
 * to be sure about than a dependency with that permission. It depends on
 * nothing outside the Node standard library.
 */

import { fileURLToPath, pathToFileURL } from 'node:url'

const DAY = 86_400_000

/**
 * Which runs to delete.
 *
 * Pure, so the rule can be tested without a repository. `runs` is the API's
 * own shape: `{ id, name, workflow_id, created_at, status }`.
 */
export function expired(runs, { keep = 5, days = 14, now = Date.now() } = {}) {
  const cutoff = now - days * DAY

  const byWorkflow = new Map()
  for (const run of runs) {
    // Never a run that has not finished — including, when this runs on a
    // runner, the cleanup's own.
    if (run.status !== 'completed') continue
    const list = byWorkflow.get(run.workflow_id)
    if (list) list.push(run)
    else byWorkflow.set(run.workflow_id, [run])
  }

  const doomed = []
  for (const list of byWorkflow.values()) {
    // Newest first, so "the newest `keep`" is the front of the list. The id is
    // the tiebreak: two runs can share a timestamp to the second, and a sort
    // that leaves their order to chance would delete a different one each time
    // it ran.
    list.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)

    for (const run of list.slice(keep)) {
      if (Date.parse(run.created_at) < cutoff) doomed.push(run)
    }
  }

  return doomed
}

/* -------------------------------------------------------------------------- */
/* The run                                                                    */
/* -------------------------------------------------------------------------- */

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1) return fallback
  const value = Number(process.argv[at + 1])
  return Number.isFinite(value) ? value : fallback
}

async function api(path, { token, method = 'GET' } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'wetterstation-cleanup',
    },
  })
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
  }
  return response.status === 204 ? null : response.json()
}

/** Every run in the repository, a hundred at a time. */
async function allRuns(repo, token) {
  const out = []
  for (let page = 1; ; page++) {
    const body = await api(`/repos/${repo}/actions/runs?per_page=100&page=${page}`, { token })
    const runs = body.workflow_runs ?? []
    out.push(...runs)
    if (runs.length < 100) return out
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (!repo || !token) {
    console.error('GITHUB_REPOSITORY und GITHUB_TOKEN müssen gesetzt sein.')
    process.exit(1)
  }

  const keep = arg('keep', 5)
  const days = arg('days', 14)
  const dryRun = process.argv.includes('--dry-run')

  const runs = await allRuns(repo, token)
  const doomed = expired(runs, { keep, days })

  console.log(
    `${runs.length} Läufe, davon ${doomed.length} zu alt` +
      ` (behalten: die neuesten ${keep} je Workflow und alles aus ${days} Tagen).`,
  )

  const byName = new Map()
  for (const run of doomed) byName.set(run.name, (byName.get(run.name) ?? 0) + 1)
  for (const [name, count] of [...byName].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${name}`)
  }

  if (dryRun) {
    console.log('\nProbelauf — nichts gelöscht.')
    return
  }

  let gone = 0
  const failed = []
  for (const run of doomed) {
    try {
      await api(`/repos/${repo}/actions/runs/${run.id}`, { token, method: 'DELETE' })
      gone++
    } catch (error) {
      // One run that refuses to go is not a reason to leave the other
      // hundred — a run can disappear between the listing and the delete, and
      // a retention policy on the repository can forbid it outright.
      failed.push({ id: run.id, error: error instanceof Error ? error.message : String(error) })
    }
    if (gone % 25 === 0 && gone > 0) process.stdout.write(`\r${gone} gelöscht …`)
  }
  if (gone >= 25) process.stdout.write('\r'.padEnd(32) + '\r')

  console.log(`\n${gone} Läufe gelöscht, ${runs.length - gone} bleiben.`)
  if (failed.length > 0) {
    console.log(`${failed.length} nicht löschbar:`)
    for (const f of failed.slice(0, 5)) console.log(`  ${f.id}: ${f.error}`)
  }

  // The step summary, when there is one to write to.
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const { appendFileSync } = await import('node:fs')
    const lines = [
      '### Läufe aufgeräumt',
      '',
      `- ${gone} gelöscht, ${runs.length - gone} bleiben`,
      `- Regel: die neuesten ${keep} je Workflow, dazu alles aus ${days} Tagen`,
      ...[...byName].sort((a, b) => b[1] - a[1]).map(([name, count]) => `- ${count}× ${name}`),
    ]
    appendFileSync(summary, lines.join('\n') + '\n')
  }
}

// Imported by the test rather than run: only the rule above is exercised there.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

export const SCRIPT = fileURLToPath(import.meta.url)
