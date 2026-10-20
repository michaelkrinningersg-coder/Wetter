// Die Brücke der Android-App: dieselben Aufrufe wie wetter.Api in Python,
// nur hier im Handy gerechnet. Die Seite merkt keinen Unterschied - rufe()
// in lib/api.js landet hier statt bei pywebview.
//
// Speicher: IndexedDB im WebView (bleibt über Neustarts). Je Station die
// Rohspalten, dazu Einstellungen, Stationsliste und hist-Verzeichnis.
// Netz: CapacitorHttp - der DWD erlaubt keine Abrufe aus Webseiten (kein
// CORS), die native HTTP-Schicht der App ist davon nicht betroffen.
//
// Beim ersten Start liegen Stationsliste, Verzeichnis und Göttingen in der
// App (public-android/start/), so ist sofort etwas zu sehen.

import { produktAusZip, produktLesen, stationenLesen, verzeichnisLesen, zusammenfuehren } from "./lesen.js";
import * as R from "./rechnen.js";

const BASIS = "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/";
const GOETTINGEN = 1691;
const RECENT_ALTER = 3 * 3600 * 1000;
const VERZEICHNIS_ALTER = 20 * 3600 * 1000;
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "v1.0";

// --------------------------------------------------------------- Speicher
let dbVersprechen = null;
function db() {
  if (!dbVersprechen) {
    dbVersprechen = new Promise((ok, fehler) => {
      const anfrage = indexedDB.open("wetter", 1);
      anfrage.onupgradeneeded = () => {
        anfrage.result.createObjectStore("meta");
        anfrage.result.createObjectStore("station");
      };
      anfrage.onsuccess = () => ok(anfrage.result);
      anfrage.onerror = () => fehler(anfrage.error);
    });
  }
  return dbVersprechen;
}
async function lesen(store, key) {
  const d = await db();
  return new Promise((ok, fehler) => {
    const a = d.transaction(store).objectStore(store).get(key);
    a.onsuccess = () => ok(a.result);
    a.onerror = () => fehler(a.error);
  });
}
async function schreiben(store, key, wert) {
  const d = await db();
  return new Promise((ok, fehler) => {
    const t = d.transaction(store, "readwrite");
    t.objectStore(store).put(wert, key);
    t.oncomplete = () => ok();
    t.onerror = () => fehler(t.error);
  });
}

// ------------------------------------------------------------------- Netz
async function holen(pfad, binaer = true) {
  const url = BASIS + pfad;
  const cap = globalThis.Capacitor;
  try {
    if (cap?.isNativePlatform?.()) {
      const { CapacitorHttp } = await import("@capacitor/core");
      const antwort = await CapacitorHttp.get({ url, responseType: binaer ? "arraybuffer" : "text", connectTimeout: 30000, readTimeout: 60000 });
      if (antwort.status >= 400) throw new Error(`HTTP ${antwort.status}`);
      if (!binaer) return antwort.data;
      // binär kommt als Base64 über die Brücke
      return typeof antwort.data === "string" ? Uint8Array.from(atob(antwort.data), (c) => c.charCodeAt(0)) : new Uint8Array(antwort.data);
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return binaer ? new Uint8Array(await r.arrayBuffer()) : new TextDecoder("latin1").decode(await r.arrayBuffer());
  } catch (e) {
    throw new Error(`${url}: ${e?.message ?? e}`);
  }
}
async function mitgeliefert(name) {
  const r = await fetch(`start/${name}`);
  if (!r.ok) throw new Error(`start/${name} fehlt`);
  return name.endsWith(".json") ? r.json() : new Uint8Array(await r.arrayBuffer());
}

// ---------------------------------------------------------------- Zustand
const reihen = new Map(); // id -> R.reihe(...)
const zustand = { laeuft: "", meldung: "", stand: 0 };
let stationsliste = null;
let laufend = Promise.resolve();

/** Eins nach dem anderen - zwei Abrufe derselben Station gleichzeitig verwirren nur. */
function nacheinander(arbeit) {
  const lauf = laufend.then(arbeit, arbeit);
  laufend = lauf.catch(() => {});
  return lauf;
}

async function meta(k, vorgabe = null) {
  const v = await lesen("meta", k);
  return v === undefined ? vorgabe : v;
}

const heute = () => {
  const d = new Date();
  return { j: d.getFullYear(), m: d.getMonth() + 1, t: d.getDate() };
};

async function liste() {
  if (stationsliste) return stationsliste;
  stationsliste = (await meta("stationen")) ?? (await mitgeliefert("stationen.json"));
  return stationsliste;
}

async function verzeichnis(neu = false) {
  const gemerkt = await meta("verzeichnis");
  const am = await meta("verzeichnis_am", 0);
  if (gemerkt && !neu && Date.now() - am < VERZEICHNIS_ALTER) return gemerkt;
  try {
    const v = verzeichnisLesen(await holen("historical/", false));
    if (Object.keys(v).length) {
      await schreiben("meta", "verzeichnis", v);
      await schreiben("meta", "verzeichnis_am", Date.now());
      return v;
    }
  } catch (e) {
    if (neu) throw e;
  }
  return gemerkt ?? (await mitgeliefert("verzeichnis.json"));
}

async function geladen() {
  return (await meta("geladen")) ?? {};
}

async function ablegen(id, zeilen, histDatei, recentAm) {
  await schreiben("station", id, { zeilen, hist_datei: histDatei, recent_am: recentAm });
  const g = await geladen();
  g[id] = zeilen.tag.length;
  await schreiben("meta", "geladen", g);
  reihen.set(id, R.reihe(zeilen));
}

async function reiheVon(id) {
  if (reihen.has(id)) return reihen.get(id);
  const gespeichert = await lesen("station", id);
  if (!gespeichert) return null;
  const r = R.reihe(gespeichert.zeilen);
  reihen.set(id, r);
  return r;
}

const kennung = (id) => String(id).padStart(5, "0");
const name = (id) => stationsliste?.find((s) => s.id === id)?.name ?? id;

/** Holt eine Station: ganz (neu oder neue Jahreslieferung) oder nur recent. */
async function laden(id, ganz = false) {
  return nacheinander(async () => {
    const t = performance.now();
    const vorher = await lesen("station", id);
    const histDatei = (await verzeichnis())[id] ?? null;
    const nurRecent = !ganz && vorher && (vorher.hist_datei ?? null) === histDatei;
    zustand.laeuft = `${name(id)}: Abruf beim DWD …`;
    try {
      const [hist, recent] = await Promise.all([
        !nurRecent && histDatei ? holen("historical/" + histDatei).then(produktAusZip) : null,
        holen(`recent/tageswerte_KL_${kennung(id)}_akt.zip`).then(produktAusZip).catch(() => null),
      ]);
      if (!hist && !recent && !nurRecent) throw new Error("Weder hist noch recent beim DWD");
      let zeilen;
      if (nurRecent) {
        // hist aus dem Speicher behalten, recent dahinter neu
        const alt = vorher.zeilen;
        const histZeilen = [];
        for (let i = 0; i < alt.tag.length; i++) if (alt.quelle[i] === 0) histZeilen.push(zeileAus(alt, i));
        zeilen = zusammenfuehren(histZeilen, recent ? produktLesen(recent) : []);
      } else {
        zeilen = zusammenfuehren(hist ? produktLesen(hist) : [], recent ? produktLesen(recent) : []);
      }
      await ablegen(id, zeilen, histDatei, recent ? Date.now() : vorher?.recent_am ?? null);
      const text = `${name(id)}: ${nurRecent ? "recent" : "ganze Reihe"} in ${((performance.now() - t) / 1000).toFixed(1)} s geladen`;
      zustand.meldung = text;
      zustand.stand++;
      return text;
    } finally {
      zustand.laeuft = "";
    }
  });
}

function zeileAus(z, i) {
  const aus = { tag: z.tag[i], qn: z.qn[i] === 255 ? NaN : z.qn[i], qn3: z.qn3[i] === 255 ? NaN : z.qn3[i] };
  for (const [s, spalte] of Object.entries(z.roh)) aus[s] = spalte[i];
  return aus;
}

/** Erster Start: Göttingen aus der App statt vom DWD. */
async function startdaten() {
  if (await lesen("station", GOETTINGEN)) return;
  const v = await mitgeliefert("verzeichnis.json");
  const [hist, recent] = await Promise.all([mitgeliefert("01691_hist.zip"), mitgeliefert("01691_akt.zip")]);
  const zeilen = zusammenfuehren(produktLesen(produktAusZip(hist)), produktLesen(produktAusZip(recent)));
  const gebaut = await mitgeliefert("stand.json");
  await ablegen(GOETTINGEN, zeilen, v[GOETTINGEN] ?? null, gebaut.recent_am);
}

async function hintergrund(id) {
  try {
    const s = await lesen("station", id);
    if (s && Date.now() - (s.recent_am ?? 0) > RECENT_ALTER) await laden(id);
    if (Date.now() - (await meta("verzeichnis_am", 0)) > VERZEICHNIS_ALTER) {
      zustand.laeuft = "Verzeichnis des DWD …";
      const v = await verzeichnis(true);
      const s2 = await lesen("station", id);
      if (s2 && (s2.hist_datei ?? null) !== (v[id] ?? null)) await laden(id);
    }
    if (Date.now() - (await meta("stationen_am", 0)) > VERZEICHNIS_ALTER) {
      zustand.laeuft = "Stationsliste des DWD …";
      const neu = stationenLesen(await holen("recent/KL_Tageswerte_Beschreibung_Stationen.txt", false));
      if (neu.length > 100) {
        stationsliste = neu;
        await schreiben("meta", "stationen", neu);
        await schreiben("meta", "stationen_am", Date.now());
        zustand.stand++;
      }
    }
  } catch (e) {
    zustand.meldung = `DWD nicht erreichbar - gezeigt wird der gespeicherte Stand (${e?.message ?? e})`;
  } finally {
    zustand.laeuft = "";
  }
}

// ------------------------------------------------------------- Aufrufe
function sicher(arbeit) {
  return arbeit().catch((e) => ({ fehler: String(e?.message ?? e) }));
}

async function stationsZeilen() {
  const g = await geladen();
  return (await liste())
    .map((s) => [s.id, s.name, s.land, s.hoehe, +String(s.von).slice(0, 4), s.bis ? `${s.bis.slice(0, 4)}-${s.bis.slice(4, 6)}-${s.bis.slice(6, 8)}` : null, g[s.id] ?? 0])
    .sort((a, b) => a[1].localeCompare(b[1], "de"));
}

function stationKopf(s) {
  const d = (x) => (x ? `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}` : null);
  return { id: s.id, name: s.name, land: s.land, hoehe: s.hoehe, lat: s.lat, lon: s.lon, von: d(s.von), bis: d(s.bis) };
}

async function mitReihe(id, arbeit) {
  const r = await reiheVon(Number(id));
  if (!r) throw new Error("Die Station ist noch nicht geladen");
  return arbeit(r);
}

export const lokal = {
  start: () =>
    sicher(async () => {
      await liste();
      await startdaten();
      const einstellungen = {
        station: await meta("station", GOETTINGEN),
        qn: await meta("qn", "alle"),
        ansicht: await meta("ansicht", "band"),
        rang_modus: await meta("rang_modus", "heute"),
        rang_prognose: (await meta("rang_prognose", true)) !== false,
      };
      hintergrund(einstellungen.station);
      return { titel: "Wetter", version: VERSION, stationen: await stationsZeilen(), einstellungen, datenordner: "" };
    }),
  status: async () => ({ ...zustand }),
  einstellung: (name, wert) =>
    sicher(async () => {
      await schreiben("meta", name, wert);
      return { ok: true };
    }),
  stationen: () => sicher(async () => ({ stationen: await stationsZeilen() })),
  station: (id) =>
    sicher(async () => {
      id = Number(id);
      const s = (await liste()).find((x) => x.id === id);
      if (!s) throw new Error(`Station ${id} steht nicht in der Liste`);
      let geladenText = null;
      if (!(await lesen("station", id))) geladenText = await laden(id, true);
      const gespeichert = await lesen("station", id);
      const r = await reiheVon(id);
      return {
        station: stationKopf(s),
        zeitraum: R.zeitraum(r),
        abruf: { hist_datei: gespeichert.hist_datei, recent_am: (gespeichert.recent_am ?? 0) / 1000 },
        geladen: geladenText,
      };
    }),
  aktualisieren: (id) =>
    sicher(async () => {
      await verzeichnis(true);
      const text = await laden(Number(id));
      return { meldung: text, zeitraum: R.zeitraum(await reiheVon(Number(id))) };
    }),
  jahresband: (id, jahr = null, qn = "alle") =>
    sicher(() =>
      mitReihe(id, (r) => {
        const band = R.jahresband(r, jahr, qn, heute());
        if (!band.leer) {
          band.jahre = R.jahre(r, qn);
          band.bilanz = R.bilanz(r, qn);
        }
        return band;
      }),
    ),
  monat: (id, jahr = null, monat = null, qn = "alle") => sicher(() => mitReihe(id, (r) => R.monat(r, jahr, monat, qn))),
  rangliste: (id, modus = "heute", prognose = true, qn = "alle") => sicher(() => mitReihe(id, (r) => R.rangliste(r, modus, !!prognose, qn, heute()))),
  zeitreihe: (id, groesse = "m", aufloesung = "jahr", qn = "alle") => sicher(() => mitReihe(id, (r) => R.zeitreihe(r, groesse, aufloesung, qn))),
};
