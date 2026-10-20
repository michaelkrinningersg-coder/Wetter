// Die Dateien des DWD lesen: produkt_klima_tag-Text, Stationsliste,
// Verzeichnis der hist-Archive. Wie dwd.py und daten._csv - ohne Netz,
// damit es im Test ohne Handy läuft.

import { unzipSync } from "fflate";
import { SPALTEN } from "./plausibel.js";
import { tagVon } from "./rechnen.js";

// DWD-Spalte -> Spalte in der App (wie daten.WEITERE)
const NAMEN = {
  TMK: "tmk", TXK: "txk", TNK: "tnk", FX: "fx", FM: "fm", RSK: "rsk", RSKF: "rskf",
  SDK: "sdk", SHK_TAG: "shk", NM: "nm", VPM: "vpm", PM: "pm", UPM: "upm", TGK: "tgk",
};

/** produkt_klima_tag-Text -> Zeilen (Datum als Tage seit 1970). -999 = fehlt. */
export function produktLesen(text) {
  const zeilen = text.split(/\r?\n/);
  const kopf = zeilen[0].split(";").map((k) => k.trim());
  const stelle = (name) => kopf.indexOf(name);
  const iDatum = stelle("MESS_DATUM");
  if (iDatum < 0 || stelle("TMK") < 0) throw new Error("Unerwarteter Kopf: " + zeilen[0]);
  const spalten = Object.entries(NAMEN).map(([dwd, app]) => [app, stelle(dwd)]);
  const iQn = stelle("QN_4");
  const iQn3 = stelle("QN_3");
  const aus = [];
  for (let z = 1; z < zeilen.length; z++) {
    const f = zeilen[z].split(";");
    if (f.length < 5 || !f[iDatum].trim()) continue;
    const d = f[iDatum].trim();
    const wert = (i) => {
      if (i < 0) return NaN;
      const v = parseFloat(f[i]);
      return v === -999 || Number.isNaN(v) ? NaN : v;
    };
    const zeile = { tag: tagVon(+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8)), qn: wert(iQn), qn3: wert(iQn3) };
    for (const [app, i] of spalten) zeile[app] = wert(i);
    aus.push(zeile);
  }
  return aus;
}

/**
 * hist und recent zu einer Reihe: historisch gewinnt, recent zählt nur
 * nach dem letzten hist-Tag. Ergebnis nach Datum sortiert, als Spalten.
 */
export function zusammenfuehren(hist, recent) {
  const h = (hist ?? []).map((z) => ({ ...z, quelle: 0 }));
  const ende = h.length ? Math.max(...h.map((z) => z.tag)) : -Infinity;
  const r = (recent ?? []).filter((z) => z.tag > ende).map((z) => ({ ...z, quelle: 1 }));
  const alle = h.concat(r).sort((a, b) => a.tag - b.tag);
  const n = alle.length;
  const roh = Object.fromEntries(SPALTEN.map((s) => [s, new Float64Array(n)]));
  const tag = new Int32Array(n), qn = new Uint8Array(n), qn3 = new Uint8Array(n), quelle = new Uint8Array(n);
  alle.forEach((z, i) => {
    tag[i] = z.tag;
    qn[i] = Number.isNaN(z.qn) ? 255 : z.qn;
    qn3[i] = Number.isNaN(z.qn3) ? 255 : z.qn3;
    quelle[i] = z.quelle;
    for (const s of SPALTEN) roh[s][i] = z[s];
  });
  return { tag, qn, qn3, quelle, roh };
}

/** Aus einem Archiv die Datei produkt_klima_tag*.txt als Text (Latin-1). */
export function produktAusZip(bytes) {
  const dateien = unzipSync(bytes, { filter: (d) => d.name.startsWith("produkt_klima_tag") });
  const name = Object.keys(dateien)[0];
  if (!name) throw new Error("Im Archiv fehlt die Datei produkt_klima_tag");
  return new TextDecoder("latin1").decode(dateien[name]);
}

/** Stationsliste wie dwd.stationen_lesen. */
export function stationenLesen(text) {
  const aus = [];
  for (const zeile of text.split(/\r?\n/)) {
    const teile = zeile.trim().split(/\s+/);
    if (teile.length < 7 || !/^\d+$/.test(teile[0]) || !/^\d{8}$/.test(teile[1]) || !/^\d{8}$/.test(teile[2])) continue;
    // ab dem 7. Feld: Name, Land, Abgabe - getrennt durch mindestens zwei Leerzeichen
    const rest = zeile.trim().replace(/^(\S+\s+){6}/, "").split(/\s{2,}/).filter(Boolean);
    const [name, land] = rest.length >= 2 ? rest : [rest[0] ?? "", ""];
    aus.push({
      id: +teile[0], von: teile[1], bis: teile[2], hoehe: Math.trunc(+teile[3]),
      lat: +teile[4], lon: +teile[5], name, land,
    });
  }
  return aus;
}

/** Verzeichnis historical/ -> { Stationsnummer: Dateiname } */
export function verzeichnisLesen(html) {
  const aus = {};
  for (const m of html.matchAll(/href="(tageswerte_KL_(\d{5})_(\d{8})_(\d{8})_hist\.zip)"/g)) aus[+m[2]] = m[1];
  return aus;
}
