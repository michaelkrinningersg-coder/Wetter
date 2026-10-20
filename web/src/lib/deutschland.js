// Deutschland-Übersicht: Top 50 aller aktiven Stationen für einen Tag, eine
// Größe und eine Richtung, wahlweise nur Stationen unter/ab einer Höhe.
// Daten (von deutschland.py bzw. lokal/deutschland.js):
//   { stand, tage: [iso, ...], stationen: [[id, name, land, hoehe], ...],
//     werte: { spalte: [[Wert je Tag], ...je Station] } }
// Ohne Svelte, damit die Tests es direkt prüfen können.

// Spalte, Name, Einheit, Faktor (DWD -> Anzeige), Stellen
export const GROESSEN = [
  ["txk", "Höchstwert", "°C", 1, 1],
  ["tmk", "Tagesmittel", "°C", 1, 1],
  ["tnk", "Tiefstwert", "°C", 1, 1],
  ["tgk", "Erdboden 5 cm", "°C", 1, 1],
  ["rsk", "Niederschlag", "mm", 1, 1],
  ["sdk", "Sonnenschein", "h", 1, 1],
  ["shk", "Schneehöhe", "cm", 1, 0],
  ["fx", "Böe", "km/h", 3.6, 0],
  ["fm", "Wind (Mittel)", "km/h", 3.6, 0],
  ["nm", "Bedeckung", "Achtel", 1, 1],
  ["upm", "Feuchte", "%", 1, 0],
  ["pm", "Luftdruck", "hPa", 1, 1],
  ["vpm", "Dampfdruck", "hPa", 1, 1],
];

// Höhenfilter: Schlüssel, Text, Prüfung
export const HOEHEN = [
  ["alle", "alle Höhen", () => true],
  ...[500, 1000, 1500, 2000].flatMap((m) => [
    [`u${m}`, `unter ${m.toLocaleString("de-DE")} m`, (h) => h < m],
    [`a${m}`, `ab ${m.toLocaleString("de-DE")} m`, (h) => h >= m],
  ]),
];

/**
 * Top n für tag (iso), spalte, richtung ("hoch" | "tief"), hoehe (Schlüssel
 * aus HOEHEN). Gleicher Wert, gleicher Platz; dann nach Name.
 * Liefert [{platz, id, name, land, hoehe, wert (Anzeigeeinheit)}].
 */
export function top(daten, tag, spalte, richtung = "hoch", hoehe = "alle", n = 50) {
  const t = daten?.tage?.indexOf(tag) ?? -1;
  const g = GROESSEN.find((x) => x[0] === spalte);
  const passt = (HOEHEN.find((x) => x[0] === hoehe) ?? HOEHEN[0])[2];
  if (t < 0 || !g || !daten.werte?.[spalte]) return [];
  const zeilen = [];
  daten.stationen.forEach(([id, name, land, h], i) => {
    const v = daten.werte[spalte][i]?.[t];
    if (v == null || !passt(h)) return;
    zeilen.push({ id, name, land, hoehe: h, wert: Math.round(v * g[3] * 10 ** g[4]) / 10 ** g[4] });
  });
  const vz = richtung === "tief" ? 1 : -1;
  zeilen.sort((a, b) => vz * (a.wert - b.wert) || a.name.localeCompare(b.name, "de"));
  const aus = zeilen.slice(0, n);
  aus.forEach((z, i) => (z.platz = i > 0 && z.wert === aus[i - 1].wert ? aus[i - 1].platz : i + 1));
  return aus;
}

/** Wie viele Stationen am Tag für die Größe einen Wert haben (mit Höhenfilter). */
export function anzahl(daten, tag, spalte, hoehe = "alle") {
  const t = daten?.tage?.indexOf(tag) ?? -1;
  const passt = (HOEHEN.find((x) => x[0] === hoehe) ?? HOEHEN[0])[2];
  if (t < 0 || !daten.werte?.[spalte]) return 0;
  return daten.stationen.filter((s, i) => daten.werte[spalte][i]?.[t] != null && passt(s[3])).length;
}
