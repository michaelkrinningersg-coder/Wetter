import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, shell } from 'electron'

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
 *  2. Copy the shipped archives there on first start.
 *  3. Show a window immediately. Reading 1.3 million rows out of the CSV
 *     archives takes long enough that a silent taskbar icon reads as a crash.
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

  // The CSV archives ride along as a resource. They are copied rather than
  // read in place because the collectors append to them daily, and a resource
  // directory beside the executable may well be read-only.
  const seed = join(process.resourcesPath, 'daten-vorlage')
  if (existsSync(seed) && readdirSync(root).length === 0) {
    cpSync(seed, root, { recursive: true })
  }

  return root
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

/** Write one line into the loading page. Silently ignored once it is gone. */
function stage(text) {
  if (!win || win.isDestroyed()) return
  const literal = JSON.stringify(String(text))
  win.webContents
    .executeJavaScript(`{const e=document.getElementById('stage');if(e)e.textContent=${literal}}`)
    .catch(() => {})
}

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

app.whenReady().then(async () => {
  prepareDataRoot()
  createWindow()

  try {
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
