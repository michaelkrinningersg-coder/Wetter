import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import Database from 'better-sqlite3'

import { listFiles, pack } from '../server/tar.js'

/**
 * Pack what the installer carries: the CSV archive and the finished database.
 *
 * Both used to be handled by not handling them. The CSVs were copied into the
 * package as 4,669 loose files — 65 MB — and the database was not shipped at
 * all, so the first start of every installation rebuilt it from those files.
 * That rebuild was measured at 59.6 seconds and 938 MB of memory, on a machine
 * considerably faster than the average laptop.
 *
 * Packed, the pair costs about 45 MB in the installer and a little over a
 * second on first start. The database is the derived artefact and the CSVs
 * remain the archive of record: both ship, because a database that cannot be
 * rebuilt from something is a database one bad sector away from being gone.
 *
 * Run by `npm run vorlage`, which `npm run pack` and the release workflow call
 * before electron-builder. It needs better-sqlite3 built against Node, so the
 * script runs before the rebuild for Electron, not after.
 */

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '..', 'data')
const OUT = join(here, '..', 'vorlage')

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`

if (!existsSync(DATA)) {
  console.error(`Kein Datenverzeichnis unter ${DATA}.`)
  process.exit(1)
}

const database = join(DATA, 'weather.sqlite')
if (!existsSync(database)) {
  console.error(
    'Keine weather.sqlite gefunden. Das Paket würde die Datenbank beim ersten\n' +
      'Start neu aufbauen — eine Minute, die niemand warten muss. Erst den\n' +
      'Server einmal laufen lassen, dann packen.',
  )
  process.exit(1)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

/* -------------------------------------------------------------------------- */

// The database is left out of the tar — it ships separately — and so are the
// journal files beside it, which belong to a database that may be open.
const files = listFiles(DATA).filter((name) => !name.startsWith('weather.sqlite'))

console.log(`CSV-Archiv: ${files.length.toLocaleString('de-DE')} Dateien`)
const tar = pack(DATA, files)
writeFileSync(join(OUT, 'daten-vorlage.tar.gz'), gzipSync(tar, { level: 9 }))
console.log(`  ${mb(tar.length)} roh -> ${mb(statSync(join(OUT, 'daten-vorlage.tar.gz')).size)}`)

/* -------------------------------------------------------------------------- */

/*
 * Copied through SQLite's own backup rather than by reading the file: with a
 * `-wal` beside it, `weather.sqlite` on its own is not a complete database,
 * and the build may well run moments after a collector wrote to it.
 */
const consistent = join(OUT, 'weather.sqlite')
const source = new Database(database, { readonly: true })
await source.backup(consistent)
source.close()

console.log(`Datenbank: ${mb(statSync(consistent).size)}`)
writeFileSync(join(OUT, 'weather.sqlite.gz'), gzipSync(readFileSync(consistent), { level: 6 }))
rmSync(consistent)
console.log(`  -> ${mb(statSync(join(OUT, 'weather.sqlite.gz')).size)}`)

console.log(`\nFertig in ${OUT}`)
