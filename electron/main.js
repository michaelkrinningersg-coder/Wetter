import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { app, BrowserWindow, shell } from 'electron'

import { extract } from '../server/tar.js'

/**
 * The shell around the app.
 *
 * Everything of substance is the same Express server that `npm start` runs;
 * this file only decides where the data lives, when the window may appear, and
 * that there is exactly one of it.
 *
 * The order matters and is the reason this is not four lines:
 *
 *  1. Point the data root at a writable directory *before* anything from
 *     `server/` is imported — those modules open the database and read their
 *     archives at import time, and a program directory under Windows is not
 *     writable.
 *  2. Unpack the shipped archives there on first start.
 *  3. Show a window immediately. Even with the database shipped ready-made,
 *     the first start has a couple of seconds of unpacking to do, and a silent
 *     taskbar icon reads as a crash.
 *  4. Only then import the server, start it on a free port, and point the
 *     window at it.
 */

const here = dirname(fileURLToPath(import.meta.url))

/* -------------------------------------------------------------------------- */
/* One window, one process                                                    */
/* -------------------------------------------------------------------------- */

/*
 * A second copy would open the same SQLite file and run the same collectors
 * against the same CSV files. The lock hands the argument to the running
 * instance instead, which raises its window.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win = null

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

/* -------------------------------------------------------------------------- */
/* Where the data lives                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Move the archives out of the program directory and seed them once.
 *
 * Only in a packaged app: a checkout keeps using its own `data/`, so running
 * `npm run app` in the repository sees exactly what `npm start` sees.
 */
function prepareDataRoot() {
  if (!app.isPackaged) return null

  const root = join(app.getPath('userData'), 'daten')
  mkdirSync(root, { recursive: true })
  process.env.WETTER_DATA_ROOT = root
  return root
}

/**
 * Unpack what the installer carried, once.
 *
 * Both archives are unpacked rather than read in place: the collectors append
 * to the CSVs daily and the database is written continuously, while a resource
 * directory beside the executable may well be read-only.
 *
 * They ride along packed because of what the numbers were. The CSV archive is
 * 4,669 files, which cost 65 MB in the package against 12 MB as one stream;
 * and the database was not shipped at all, so every first start rebuilt it out
 * of those CSVs — 59.6 seconds and 938 MB of memory, measured. Unpacking both
 * takes 5.3 seconds. It does hold the 157 MB database in memory while it
 * writes it, which is a lot for one buffer and still a fifth of what the
 * rebuild it replaces needed.
 *
 * Nothing happens on a directory that already has files in it. An interrupted
 * first start leaves some behind, and unpacking over them would undo whatever
 * the collectors had already managed.
 *
 * Asynchronous only so the two messages below reach the window: the work
 * itself is synchronous, and without a pause the renderer would paint both
 * of them after the unpacking had already finished.
 *
 * @param {(text: string) => void} report Progress, for the loading window.
 */
async function unpackSeed(root, report) {
  if (!root || readdirSync(root).length > 0) return

  const paint = () => new Promise((resolve) => setTimeout(resolve, 60))

  const seed = join(process.resourcesPath, 'daten-vorlage.tar.gz')
  if (existsSync(seed)) {
    report('Archiv wird entpackt …')
    await paint()
    const files = extract(gunzipSync(readFileSync(seed)), root)
    console.log(`Archivvorlage entpackt: ${files} Dateien`)
  }

  const seedDb = join(process.resourcesPath, 'weather.sqlite.gz')
  if (existsSync(seedDb)) {
    report('Datenbank wird entpackt …')
    await paint()
    writeFileSync(join(root, 'weather.sqlite'), gunzipSync(readFileSync(seedDb)))
    console.log('Datenbank entpackt')
  }
}

/* -------------------------------------------------------------------------- */
/* Window                                                                     */
/* -------------------------------------------------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: true,
    backgroundColor: '#0b0f14',
    title: 'Wetterstation',
    autoHideMenuBar: true,
    webPreferences: {
      // Nothing in the interface talks to Node — it speaks to the API over
      // HTTP like any browser would. So the renderer gets no Node access,
      // and there is no preload bridge to keep secure.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.loadFile(join(here, 'loading.html'))

  // The page is not ready the moment `loadFile` returns, and the messages
  // worth reading are exactly the ones that arrive first — a failing import
  // throws within a second. Without this the error would be written into a
  // document that does not exist yet, be dropped, and leave a blank window
  // that says nothing about what went wrong.
  win.webContents.once('did-finish-load', () => {
    ready = true
    if (pendingStage !== null) stage(pendingStage)
  })

  // Links to the DWD, the UBA and the gauge portals belong in the user's
  // browser, not in a window that has no address bar and no back button.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    win = null
  })
}

let ready = false
let pendingStage = null

/** Write one line into the loading page, or hold it until the page exists. */
function stage(text) {
  if (!win || win.isDestroyed()) return
  if (!ready) {
    pendingStage = text
    return
  }
  pendingStage = null
  const literal = JSON.stringify(String(text))
  win.webContents
    .executeJavaScript(`{const e=document.getElementById('stage');if(e)e.textContent=${literal}}`)
    .catch(() => {})
}

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

app.whenReady().then(async () => {
  // The root has to be named before anything under `server/` is imported; the
  // unpacking that fills it can wait until there is a window to report into.
  const root = prepareDataRoot()
  createWindow()

  try {
    await unpackSeed(root, stage)

    stage('Archive werden gelesen …')
    // Dynamic, not top-level: the import itself is the slow step, and the
    // window has to exist before it starts.
    const { startServer } = await import('../server/index.js')

    // Port 0: whatever is free. A fixed port would collide with a running
    // development server and with anything else that claimed it.
    // `WETTER_NO_SCHEDULE` exists for working on the interface: without it
    // every `npm run app` would start a round of downloads.
    const { url } = await startServer({
      port: 0,
      schedule: process.env.WETTER_NO_SCHEDULE !== '1',
    })

    /*
     * The window opens as soon as the server answers, not when the collectors
     * are done. On a first start the station archives are still downloading
     * at this point and several views will be empty for a few minutes — but
     * the status bar says so, and an interface that reports what it is
     * waiting for beats a splash screen that only says "please wait".
     */
    if (win && !win.isDestroyed()) win.loadURL(url)
  } catch (error) {
    stage(`Start fehlgeschlagen: ${error instanceof Error ? error.message : error}`)
    console.error(error)
  }
})

// Windows and Linux: closing the only window ends the program, and with it the
// scheduler. That is the deal a local app makes — it collects while it runs.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
