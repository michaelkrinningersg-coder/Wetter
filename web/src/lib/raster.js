// Das Raster des DWD-Radars (RV-Komposit DE1200 wie bei Bright Sky): 1100
// Spalten, 1200 Zeilen, 1 km, polarstereografisch. Gleiche Rechnung wie
// werkzeuge/karte_bauen.py - die Karte liegt schon in diesem Raster.
// Ohne Svelte, damit die Tests es direkt prüfen können.

export const SPALTEN = 1100;
export const ZEILEN = 1200;

const A = 6378137.0;
const B = 6356752.3142451802;
const E = Math.sqrt(1 - (B * B) / (A * A));
const X0 = 543196.83521776402;
const Y0 = 3622588.8619310018;
const RAD = Math.PI / 180;
const t = (phi) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);
const PC = 60 * RAD;
const MC = Math.cos(PC) / Math.sqrt(1 - E * E * Math.sin(PC) ** 2);
const TC = t(PC);

/** Länge/Breite -> [Spalte, Zeile] im Radarraster (km, mit Nachkommastellen). */
export function raster(lon, lat) {
  const rho = (A * MC * t(lat * RAD)) / TC;
  const lam = (lon - 10) * RAD;
  return [(X0 + rho * Math.sin(lam)) / 1000, -(Y0 - rho * Math.cos(lam)) / 1000];
}

/** Umkehrung von raster: [Spalte, Zeile] -> [Länge, Breite] (iterativ, auf < 1 m). */
export function lage(gx, gy) {
  const rs = gx * 1000 - X0; // rho * sin(lam)
  const rc = Y0 + gy * 1000; // rho * cos(lam)
  const rho = Math.hypot(rs, rc);
  const tt = (rho * TC) / (A * MC);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2));
  return [Math.atan2(rs, rc) / RAD + 10, phi / RAD];
}

/**
 * Ausschnitt [oben, links, unten, rechts] (ganze Zeilen/Spalten) um einen
 * Mittelpunkt mit `km` Kantenlänge, ins Raster geschoben; null = ganz.
 */
export function ausschnitt(mitte, km) {
  if (!km) return [0, 0, ZEILEN - 1, SPALTEN - 1];
  const h = Math.round(km / 2);
  const x = Math.min(SPALTEN - 1 - h, Math.max(h, Math.round(mitte[0])));
  const y = Math.min(ZEILEN - 1 - h, Math.max(h, Math.round(mitte[1])));
  return [y - h, x - h, y + h, x + h];
}

// Farben je Niederschlag in mm/h (Untergrenzen), angelehnt an die DWD-Skala
export const STUFEN = [
  [0.1, [180, 215, 255]],
  [0.5, [110, 170, 245]],
  [1, [45, 115, 225]],
  [2, [30, 175, 85]],
  [5, [245, 215, 40]],
  [10, [250, 140, 20]],
  [20, [225, 35, 30]],
  [50, [175, 30, 170]],
];

/** Wert aus Bright Sky (0,01 mm je 5 Minuten) -> mm/h */
export const mmProStunde = (v) => (v * 12) / 100;

/** Farbe [r, g, b] oder null (kein Niederschlag) für mm/h */
export function farbe(mmh) {
  let f = null;
  for (const [ab, rgb] of STUFEN) if (mmh >= ab) f = rgb;
  return f;
}

// Filmlänge: Stunden zurück (Bright Sky hält rund 6 Stunden), dazu immer
// 2 Stunden Vorhersage. Ab 3 h nur alle 10, ab 6 h alle 15 Minuten ein
// gemessenes Bild - einzeln geholt, so bleibt der Film klein.
export const RADAR_ZURUECK = [1, 2, 3, 6];
export const radarSchritt = (zurueck) => (zurueck >= 6 ? 15 : zurueck >= 3 ? 10 : 5);

/** {einzeln: [iso...], von, bis} wie vorhersage.radar_zeiten */
export function radarZeiten(jetztMs, zurueck) {
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 16) + "Z";
  const MIN = 60000;
  const jetzt = Math.floor(jetztMs / (5 * MIN)) * 5 * MIN;
  const bis = fmt(jetzt + 2 * 60 * MIN);
  const schritt = radarSchritt(zurueck);
  if (schritt === 5) return { einzeln: [], von: fmt(jetzt - zurueck * 60 * MIN), bis };
  const erster = Math.floor((jetzt - zurueck * 60 * MIN) / (schritt * MIN)) * schritt * MIN;
  const einzeln = [];
  for (let t = erster; t < jetzt; t += schritt * MIN) einzeln.push(fmt(t));
  return { einzeln, von: fmt(jetzt), bis };
}

// Freie Kartenansicht (Finger, Mausrad): Mitte x/y im Raster und `km` über
// die kürzere Seite der Zeichenfläche.
export const ZOOM_MIN = 15;
export const ZOOM_MAX = 1500;
const klemme = (v, a, b) => Math.min(b, Math.max(a, v));

export const ansichtKlemmen = (a) => ({ x: klemme(a.x, 0, SPALTEN), y: klemme(a.y, 0, ZEILEN), km: klemme(a.km, ZOOM_MIN, ZOOM_MAX) });

/** Bildpunkte je km */
export const massstab = (a, w, h) => Math.min(w, h) / a.km;

/** ganz Deutschland (das ganze Raster) passend in w x h */
export const ganzDeutschland = (w, h) => ({ x: SPALTEN / 2, y: ZEILEN / 2, km: Math.min(w, h) / Math.min(w / SPALTEN, h / ZEILEN) });

/** Rasterpunkt unter dem Bildpunkt px, py */
export function unterPunkt(a, px, py, w, h) {
  const s = massstab(a, w, h);
  return [a.x + (px - w / 2) / s, a.y + (py - h / 2) / s];
}

/** Zoom um `faktor` (> 1 hinein); der Rasterpunkt unter px, py bleibt stehen */
export function zoomUm(a, faktor, px, py, w, h) {
  const [gx, gy] = unterPunkt(a, px, py, w, h);
  const km = klemme(a.km / faktor, ZOOM_MIN, ZOOM_MAX);
  const s = Math.min(w, h) / km;
  return ansichtKlemmen({ x: gx - (px - w / 2) / s, y: gy - (py - h / 2) / s, km });
}
