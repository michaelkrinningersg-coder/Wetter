// Ortsliste (GeoNames, werkzeuge/orte_bauen.py): Suche nach Namen und der
// Ortsname zu einem angetippten Punkt. Die Liste ist knapp 3 MB groß und
// wird erst beim ersten Öffnen der Ortswahl geladen. Ohne Svelte, für die Tests.

import { entfernung } from "./standort.js";

/** Spaltenweise Daten -> Liste mit kleingeschriebenen Namen für die Suche */
export function vorbereiten(d) {
  return {
    laender: d.laender,
    quelle: d.quelle,
    n: d.n,
    klein: d.n.map((x) => x.toLowerCase()),
    b: d.b,
    l: d.l,
    h: d.h,
    e: d.e,
    a: d.a,
    g: d.g,
  };
}

let geladen = null;
export function ladeOrte() {
  geladen ??= import("./orte.json").then((m) => vorbereiten(m.default));
  return geladen;
}

/** Eintrag i als Objekt */
export const ort = (o, i) => ({
  name: o.n[i],
  lat: o.b[i] / 1000,
  lon: o.l[i] / 1000,
  hoehe: o.h[i],
  land: o.laender[o.a[i]],
  einwohner: o.e[i],
  gipfel: o.g[i] === 1,
});

/**
 * Suche: jedes Wort muss im Namen vorkommen. Zuerst genau so, dann Name
 * beginnt so, dann ein Namensteil beginnt so, dann mitten im Wort - je
 * Gruppe die größeren Orte zuerst (die Liste ist nach Einwohnern sortiert).
 */
export function ortSuchen(o, text, grenze = 60) {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const woerter = q.split(/[\s,]+/).filter(Boolean);
  const gruppen = [[], [], [], []];
  for (let i = 0; i < o.klein.length; i++) {
    const n = o.klein[i];
    if (!woerter.every((w) => n.includes(w))) continue;
    const g = n === q ? 0 : n.startsWith(q) ? 1 : woerter.every((w) => n.startsWith(w) || n.includes(" " + w) || n.includes("-" + w)) ? 2 : 3;
    if (gruppen[0].length + gruppen[1].length + gruppen[2].length >= grenze && g === 3) continue;
    gruppen[g].push(i);
  }
  return gruppen.flat().slice(0, grenze).map((i) => ort(o, i));
}

/**
 * Name für einen Punkt: der nächste Ort (kein Gipfel) - liegt er weiter als
 * 2 km weg, "bei <Ort>". Ein Gipfel innerhalb von 500 m geht vor.
 */
export function ortsname(o, lat, lon) {
  let best = -1;
  let bestKm = Infinity;
  let gipfel = -1;
  let gipfelKm = 0.5;
  // grob vorfiltern: 0,1° ~ 7-11 km
  const B = Math.round(lat * 1000);
  const L = Math.round(lon * 1000);
  for (let i = 0; i < o.n.length; i++) {
    if (Math.abs(o.b[i] - B) > 150 || Math.abs(o.l[i] - L) > 250) continue;
    const km = entfernung(lat, lon, o.b[i] / 1000, o.l[i] / 1000);
    if (o.g[i]) {
      if (km < gipfelKm) ((gipfel = i), (gipfelKm = km));
    } else if (km < bestKm) ((best = i), (bestKm = km));
  }
  if (gipfel >= 0) return { ...ort(o, gipfel), km: gipfelKm, name: o.n[gipfel] };
  if (best < 0) return null;
  return { ...ort(o, best), km: bestKm, name: bestKm > 2 ? `bei ${o.n[best]}` : o.n[best] };
}
