// Zahlen, Daten und Farben - ohne Svelte, damit die Tests sie direkt laden.

export const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// Erster Kalendertag jedes Monats als 0..365 - im Schaltjahr gezählt, wie
// daten.py den Kalendertag bildet (1. März ist immer 60).
export const MONATSANFANG = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

/** 8.35 -> "8,4" (deutsches Komma, "–" für fehlt) */
export function de(wert, stellen = 1) {
  if (wert == null || Number.isNaN(wert)) return "–";
  const text = Number(wert).toFixed(stellen).replace(".", ",");
  // -0,0 ist keine Zahl, die jemand lesen will
  return /^-0,?0*$/.test(text) ? text.slice(1) : text.replace("-", "−");
}

/** Abweichung mit Vorzeichen: +1,3 / −0,2 / ±0,0 */
export function mitVorzeichen(wert, stellen = 1) {
  if (wert == null) return "–";
  const r = Math.round(wert * 10 ** stellen) / 10 ** stellen;
  const zeichen = r > 0 ? "+" : r < 0 ? "−" : "±";
  return zeichen + Math.abs(r).toFixed(stellen).replace(".", ",");
}

/** "2026-10-19" -> "19.10.2026" */
export function datum(iso) {
  if (!iso) return "–";
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
}

/** Tausenderpunkt: 1386 -> "1.386" */
export function tausend(n) {
  return n == null ? "–" : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Kalendertag 0..365 -> "19.10." */
export function tagText(index) {
  let m = 11;
  while (m > 0 && MONATSANFANG[m] > index) m--;
  const t = index - MONATSANFANG[m] + 1;
  return `${String(t).padStart(2, "0")}.${String(m + 1).padStart(2, "0")}.`;
}

/**
 * Blau - Weiß - Rot für eine Abweichung, wie Klimastreifen.
 * `spanne` ist die Abweichung, die schon volle Farbe bekommt.
 */
export function abweichungsfarbe(a, spanne = 5) {
  const t = Math.max(-1, Math.min(1, a / spanne));
  const [r0, g0, b0] = t < 0 ? [8, 48, 107] : [103, 0, 13];
  const s = 1 - Math.abs(t);
  const misch = (p) => Math.round(p + (247 - p) * s);
  return `rgb(${misch(r0)},${misch(g0)},${misch(b0)})`;
}

/**
 * Wie abweichungsfarbe, aber mit den Farben des Themas (--abw-kalt,
 * --abw-mitte, --abw-warm): im hellen Thema dieselben Töne, im dunklen
 * ein grauer Mittelpunkt statt Weiß. Für Tagesbalken und Monatstabelle.
 */
export function abweichungsfarbeThema(a, spanne = 5) {
  const t = Math.max(-1, Math.min(1, a / spanne));
  const anteil = Math.round(Math.abs(t) * 1000) / 10;
  return `color-mix(in srgb, var(${t < 0 ? "--abw-kalt" : "--abw-warm"}) ${anteil}%, var(--abw-mitte))`;
}

/** Hübsche Achsenschritte zwischen min und max */
export function schritte(min, max, ziel = 6) {
  const roh = (max - min) / ziel;
  const p = 10 ** Math.floor(Math.log10(roh));
  const s = [1, 2, 2.5, 5, 10].map((f) => f * p).find((x) => x >= roh) ?? 10 * p;
  const aus = [];
  for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) aus.push(Math.round(v * 1e6) / 1e6);
  return aus;
}

/** Stationssuche: Name, Nummer oder Land; Treffer am Wortanfang zuerst. */
export function suchen(stationen, text, grenze = 60) {
  const q = text.trim().toLowerCase();
  if (!q) return stationen.slice(0, grenze);
  const nummer = /^\d+$/.test(q) ? Number(q) : null;
  const treffer = [];
  for (const s of stationen) {
    const [id, name, land] = s;
    const n = name.toLowerCase();
    let rang = -1;
    if (nummer !== null && id === nummer) rang = 0;
    else if (n.startsWith(q)) rang = 1;
    else if (n.includes(" " + q) || n.includes("-" + q) || n.includes("(" + q)) rang = 2;
    else if (n.includes(q)) rang = 3;
    else if (land.toLowerCase().startsWith(q)) rang = 4;
    else if (nummer !== null && String(id).padStart(5, "0").includes(q)) rang = 5;
    if (rang >= 0) treffer.push([rang, s]);
  }
  treffer.sort((a, b) => a[0] - b[0] || a[1][1].localeCompare(b[1][1], "de"));
  return treffer.slice(0, grenze).map((t) => t[1]);
}

// Wettersymbole der Vorhersage (gemeinsame Namen aus vorhersage.py)
const SYMBOLE = {
  klar: ["☀️", "🌙"], heiter: ["🌤️", "🌙"], wolkig: ["⛅", "☁️"], bedeckt: ["☁️", "☁️"],
  nebel: ["🌫️", "🌫️"], niesel: ["🌦️", "🌧️"], regen: ["🌧️", "🌧️"], starkregen: ["🌧️", "🌧️"],
  schauer: ["🌦️", "🌧️"], schneeregen: ["🌨️", "🌨️"], schnee: ["❄️", "❄️"], schneeschauer: ["🌨️", "🌨️"],
  gewitter: ["⛈️", "⛈️"], glatteis: ["🧊", "🧊"], wind: ["💨", "💨"],
};
export const SYMBOL_TEXT = {
  klar: "klar", heiter: "heiter", wolkig: "wolkig", bedeckt: "bedeckt", nebel: "Nebel", niesel: "Niesel",
  regen: "Regen", starkregen: "Starkregen", schauer: "Schauer", schneeregen: "Schneeregen", schnee: "Schnee",
  schneeschauer: "Schneeschauer", gewitter: "Gewitter", glatteis: "Glatteis", wind: "windig",
};

/**
 * Sonnenhöhe in Grad zu einer Zeit an einem Ort (Näherung des US Naval
 * Observatory, auf gut 0,1° genau - reicht für Tag oder Nacht).
 */
export function sonnenhoehe(ms, lat, lon) {
  const rad = Math.PI / 180;
  const d = ms / 86400000 - 10957.5; // Tage seit 1.1.2000 12 Uhr UTC
  const g = (357.529 + 0.98560028 * d) * rad;
  const l = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const dek = Math.asin(Math.sin(e) * Math.sin(l));
  const h = (280.46061837 + 360.98564736629 * d + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dek) + Math.cos(lat * rad) * Math.cos(dek) * Math.cos(h)) / rad;
}

/**
 * Ist es in der Stunde ab `iso` Tag? Liefert der Dienst selbst Tag/Nacht,
 * gilt das; sonst entscheidet die Sonnenhöhe zur Mitte der Stunde
 * (über -0,833°, also Sonnenrand über dem Horizont), ohne Ort 7-19 Uhr.
 */
export function istTag(tag, iso, ort) {
  if (tag != null) return tag;
  const ms = Date.parse(iso);
  if (ort?.lat != null && ort?.lon != null && !Number.isNaN(ms)) return sonnenhoehe(ms + 1800000, ort.lat, ort.lon) > -0.833;
  const h = new Date(ms).getHours();
  return h >= 7 && h < 19;
}

/** Symbol für eine Stunde (Tag/Nacht siehe istTag). */
export function wetterSymbol(symbol, tag, iso, ort) {
  const s = SYMBOLE[symbol];
  if (!s) return "·";
  return istTag(tag, iso, ort) ? s[0] : s[1];
}
