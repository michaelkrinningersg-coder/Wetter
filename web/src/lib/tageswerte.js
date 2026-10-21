// Tageswerte der Vorhersage je Ortstag (0-24 Uhr deutscher Zeit): Mittel,
// Höchst- und Tiefstwert mit Uhrzeit, Niederschlagssumme mit Arten, stärkster
// Wind und stärkste Böe mit Uhrzeit. Ohne Svelte, damit die Tests es direkt prüfen.

import { ortsTag } from "./kurzfrist.js";

const ZONE = "Europe/Berlin";
const STUNDE = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: ZONE });
const ortsStunde = (ms) => Number(STUNDE.formatToParts(new Date(ms)).find((t) => t.type === "hour").value);

// Wettersymbol -> Niederschlagsart (in dieser Reihenfolge angezeigt)
const ART = { niesel: "Niesel", regen: "Regen", starkregen: "Regen", schauer: "Regen", glatteis: "gefrierender Regen", schneeregen: "Schneeregen", schnee: "Schnee", schneeschauer: "Schnee", gewitter: "Gewitter" };
const REIHE = ["Niesel", "Regen", "gefrierender Regen", "Schneeregen", "Schnee", "Gewitter"];

/** erster Höchstwert (gross) bzw. Tiefstwert einer Größe: {wert, h} oder null */
function spitze(z, i, gross) {
  let b = null;
  for (const s of z) {
    const v = s[i];
    if (v == null) continue;
    if (!b || (gross ? v > b.wert : v < b.wert)) b = { wert: v, h: ortsStunde(Date.parse(s[0])) };
  }
  return b;
}

/**
 * stunden: Zeilen [zeit, temp, wolken, regen, wind, boe, symbol, tag] eines
 * Modells. Liefert Map "2026-10-21" -> {mittel, max, min, regen, arten,
 * wind, boe, von, bis, luecken} - von/bis: erste und letzte Stunde mit Wert,
 * luecken: Schritte größer als eine Stunde (MET Norway später 6-stündig).
 */
export function tageswerte(stunden) {
  const tage = new Map();
  for (const s of stunden ?? []) {
    if (s[1] == null) continue;
    const t = ortsTag(Date.parse(s[0]));
    if (!tage.has(t)) tage.set(t, []);
    tage.get(t).push(s);
  }
  const aus = new Map();
  for (const [t, z] of tage) {
    const temps = z.map((s) => s[1]);
    const regenWerte = z.map((s) => s[3]).filter((v) => v != null);
    const arten = new Set(z.map((s) => ART[s[6]]).filter(Boolean));
    let luecken = false;
    for (let i = 1; i < z.length; i++) if (Date.parse(z[i][0]) - Date.parse(z[i - 1][0]) > 3600000) luecken = true;
    aus.set(t, {
      mittel: temps.reduce((a, b) => a + b, 0) / temps.length,
      max: spitze(z, 1, true),
      min: spitze(z, 1, false),
      regen: regenWerte.length ? regenWerte.reduce((a, b) => a + b, 0) : null,
      arten: REIHE.filter((a) => arten.has(a)),
      wind: spitze(z, 4, true),
      boe: spitze(z, 5, true),
      von: ortsStunde(Date.parse(z[0][0])),
      bis: ortsStunde(Date.parse(z.at(-1)[0])),
      luecken,
    });
  }
  return aus;
}
