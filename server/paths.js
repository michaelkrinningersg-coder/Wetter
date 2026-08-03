import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the archives and the database live.
 *
 * There used to be nine independent environment variables — one per source —
 * because each collector was written for its own GitHub workflow and none of
 * them ever ran in the same process. Locally that is the wrong shape: the app
 * has exactly one place for its data, and the installer has to be able to put
 * it somewhere writable (a program directory under Windows is not).
 *
 * So there is one root now. The nine old variables still win when they are
 * set, because the test files each point their own source at a temporary
 * directory and must keep being able to.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** The default: `data/` beside the sources, i.e. what a git clone gets. */
const DEFAULT_ROOT = join(here, '..', 'data')

export const DATA_ROOT = process.env.WETTER_DATA_ROOT ?? DEFAULT_ROOT

/**
 * Resolve one source's directory.
 *
 * @param name  subdirectory under the root, or null for the root itself
 * @param override  the source's own environment variable, if it is set
 */
export function dataDir(name, override) {
  const dir = override ?? (name === null ? DATA_ROOT : join(DATA_ROOT, name))
  mkdirSync(dir, { recursive: true })
  return dir
}
