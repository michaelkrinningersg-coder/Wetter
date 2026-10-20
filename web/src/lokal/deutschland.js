// Deutschland-Übersicht am Handy: wie deutschland.py - von jeder aktiven
// Station nur das recent-Archiv, bereinigt wie überall, die letzten 7 Tage.

import { produktLesen, zusammenfuehren } from "./lesen.js";
import * as R from "./rechnen.js";

export const TAGE = 7;
export const SPALTEN = ["txk", "tmk", "tnk", "tgk", "rsk", "sdk", "shk", "fx", "fm", "nm", "upm", "pm", "vpm"];

/** Text eines recent-Archivs -> {letzter (Tag seit 1970), tage: Map(Tag -> {spalte: Wert})} der letzten 14 Tage */
export function stationsTage(text) {
  const r = R.reihe(zusammenfuehren(null, produktLesen(text)));
  if (!r.n) return null;
  const rein = R.rein(r, "alle");
  const letzter = r.tag[r.n - 1];
  const tage = new Map();
  for (let i = r.n - 1; i >= 0 && r.tag[i] > letzter - 14; i--) {
    const w = {};
    for (const s of SPALTEN) w[s] = Number.isNaN(rein[s][i]) ? null : R.runden(rein[s][i], 1);
    tage.set(r.tag[i], w);
  }
  return { letzter, tage };
}

/** je Station {id, name, land, hoehe, daten: stationsTage(...)} -> Format der Übersicht */
export function zusammenstellen(stationen, ausfaelle = {}, tage = TAGE) {
  const mit = stationen.filter((s) => s.daten).sort((a, b) => a.id - b.id);
  if (!mit.length) throw new Error("keine Station geladen");
  const stand = Math.max(...mit.map((s) => s.daten.letzter));
  const ab = stand - tage + 1;
  const werte = Object.fromEntries(SPALTEN.map((sp) => [sp, mit.map((s) => Array.from({ length: tage }, (_, t) => s.daten.tage.get(ab + t)?.[sp] ?? null))]));
  return {
    stand: R.iso(stand),
    erstellt: new Date().toISOString(),
    tage: Array.from({ length: tage }, (_, t) => R.iso(ab + t)),
    stationen: mit.map((s) => [s.id, s.name, s.land, s.hoehe]),
    werte,
    ausfaelle,
  };
}
