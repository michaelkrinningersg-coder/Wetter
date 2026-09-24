const { readdirSync, rmSync, statSync } = require('node:fs')
const { join } = require('node:path')

/**
 * Throw away what Chromium ships and this program cannot use.
 *
 * Electron carries a translation of its own interface into 55 languages. The
 * folder is 40 MB, the largest single item in the package after the browser
 * binary itself, and every string in this app is German. Two files are kept:
 * German, and the en-US fallback Chromium falls back to internally whatever is
 * configured.
 *
 * This is a hook and not `electronLanguages` in the configuration because that
 * option has never applied to Windows builds, which is the platform this
 * program is actually installed on.
 *
 * Anything unexpected here is reported and left alone rather than deleted: a
 * package that is 40 MB too large still runs, and one with the wrong files
 * removed does not.
 */

const KEEP = new Set(['de.pak', 'en-US.pak'])

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`

exports.default = async function afterPack(context) {
  const locales = join(context.appOutDir, 'locales')

  let entries
  try {
    entries = readdirSync(locales)
  } catch {
    // macOS keeps them inside the bundle under a different path, and a build
    // without any locales is not an error worth failing a release over.
    console.log('  • keine locales gefunden, nichts zu entfernen')
    return
  }

  let freed = 0
  let removed = 0

  for (const name of entries) {
    if (!name.endsWith('.pak') || KEEP.has(name)) continue
    const full = join(locales, name)
    freed += statSync(full).size
    rmSync(full)
    removed++
  }

  console.log(`  • ${removed} Sprachdateien entfernt, ${mb(freed)} gespart`)
}
