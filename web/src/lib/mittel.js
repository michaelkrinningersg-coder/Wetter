// Mittel aller verfügbaren Modelle je Stunde - so entschieden: feine
// Modelle (ICON-D2, Harmonie, AROME, Swiss HD) zählen doppelt, das Symbol
// ist das der Mehrheit, Niederschlag gewinnt ab der Hälfte der Modelle;
// dazu die Spannweite (tiefster und höchster Wert) von Temperatur und Regen.
// Dieselbe Rechnung steht für Widget und Meldungen in
// web/android/.../Vorhersage.java (mittel). Ohne Svelte, für die Tests.

export const FEIN = ["icon_d2", "knmi", "dmi", "arome", "swiss1", "swiss2"];
export const MITTEL = "mittel";
export const NASS = ["gewitter", "glatteis", "schnee", "schneeschauer", "schneeregen", "starkregen", "regen", "schauer", "niesel"];
// trockene Symbole von hell nach trüb - bei Gleichstand gewinnt das trübere
const TROCKEN = ["klar", "heiter", "wolkig", "bedeckt", "nebel", "wind"];

const r = (v, s = 1) => (v == null ? null : Math.round(v * 10 ** s) / 10 ** s);

/** Symbol der Mehrheit aus {symbol: gewicht} */
export function mehrheit(gewichte) {
  let nass = 0;
  let alle = 0;
  for (const [s, g] of Object.entries(gewichte)) {
    alle += g;
    if (NASS.includes(s)) nass += g;
  }
  if (!alle) return null;
  const kandidaten = Object.entries(gewichte).filter(([s]) => (nass * 2 >= alle && nass > 0 ? NASS.includes(s) : !NASS.includes(s)));
  // höchstes Gewicht; bei Gleichstand das stärkere (NASS-Reihenfolge) bzw. trübere
  const rang = (s) => (NASS.includes(s) ? -NASS.indexOf(s) : TROCKEN.indexOf(s));
  kandidaten.sort((a, b) => b[1] - a[1] || rang(b[0]) - rang(a[0]));
  return kandidaten[0]?.[0] ?? null;
}

/**
 * modelle: Liste aus der Vorhersage ({id, name, stunden}). Liefert ein Modell
 * {id: "mittel", name, text, stunden, anzahl} oder null. Zeilen wie sonst
 * [zeit, temp, wolken, regen, wind, böe, symbol, tag, wkt] und dazu an
 * Stelle 9 {n, tmin, tmax, rmin, rmax} (n = Zahl der Modelle).
 * MET-Norway-Zeilen im 6-Stunden-Takt fallen weg (ihr Regen gilt für 6 h).
 */
export function mittel(modelle) {
  const mit = (modelle ?? []).filter((m) => m.id !== MITTEL && m.stunden?.length);
  if (!mit.length) return null;
  const stunden = new Map();
  for (const m of mit) {
    const g = FEIN.includes(m.id) ? 2 : 1;
    m.stunden.forEach((z, i) => {
      if (z[1] == null) return;
      const ms = Date.parse(z[0]);
      if (m.id === "metno") {
        const naechste = m.stunden[i + 1];
        if (naechste && Date.parse(naechste[0]) - ms > 3600000) return;
        if (!naechste && i > 0 && ms - Date.parse(m.stunden[i - 1][0]) > 3600000) return;
      }
      if (!stunden.has(ms)) stunden.set(ms, { zeit: z[0], summe: [0, 0, 0, 0, 0, 0], gewicht: [0, 0, 0, 0, 0, 0], symbole: {}, tag: null, n: 0, t: [], r: [] });
      const s = stunden.get(ms);
      s.n += 1;
      // Spalten 1..5 und 8 (wkt) gewichtet mitteln
      [1, 2, 3, 4, 5, 8].forEach((k, j) => {
        if (z[k] == null) return;
        s.summe[j] += z[k] * g;
        s.gewicht[j] += g;
      });
      if (z[6]) s.symbole[z[6]] = (s.symbole[z[6]] ?? 0) + g;
      if (s.tag == null && z[7] != null) s.tag = z[7];
      s.t.push(z[1]);
      if (z[3] != null) s.r.push(z[3]);
    });
  }
  const zeilen = [...stunden.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => {
      const m = (j, st) => (s.gewicht[j] ? r(s.summe[j] / s.gewicht[j], st) : null);
      return [
        s.zeit, m(0, 1), m(1, 0), m(2, 1), m(3, 0), m(4, 0), mehrheit(s.symbole), s.tag, m(5, 0),
        { n: s.n, tmin: Math.min(...s.t), tmax: Math.max(...s.t), rmin: s.r.length ? Math.min(...s.r) : null, rmax: s.r.length ? Math.max(...s.r) : null },
      ];
    });
  return {
    id: MITTEL,
    name: "Mittel",
    text: `Mittel aus ${mit.length} Modellen (${mit.map((m) => m.name).join(", ")}) · feine Modelle doppelt`,
    stunden: zeilen,
    anzahl: mit.length,
  };
}
