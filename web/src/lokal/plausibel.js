// Was als plausibel gilt - dieselben Regeln wie plausibel.py, auf Spalten
// statt in SQL. Die Rohwerte bleiben, bereinigt wird beim Lesen.
//
//   Temperatur: -45 bis +50 °C je Wert; Max unter Min nimmt den Tag;
//   Mittel außerhalb Min..Max nimmt das Mittel. Sprünge > 15 K nur markiert.
//   Übrige Größen: physikalische Grenzen, nur der eine Wert fällt weg;
//   Wind-Mittel über der Spitze fällt weg; Niederschlagsform nur DWD-Codes.
//   QN: Wind folgt QN_3, alles andere QN_4.

export const TIEFST = -45;
export const HOECHST = 50;
export const WIND_MAX = 250 / 3.6;
export const GRENZEN = {
  fx: [0, WIND_MAX], fm: [0, WIND_MAX], rsk: [0, 300], sdk: [0, 16.5], shk: [0, 800],
  nm: [0, 8], upm: [0, 100], pm: [500, 1100], vpm: [0, 125], tgk: [-50, 50],
};
export const NS_FORMEN = new Set([0, 1, 4, 6, 7, 8, 9]);
export const QN_STUFEN = { alle: 0, ab5: 5, nur10: 10 };
export const SPALTEN = ["tmk", "txk", "tnk", "fx", "fm", "rsk", "rskf", "sdk", "shk", "nm", "vpm", "pm", "upm", "tgk"];

const imBereich = (v, lo, hi) => (v >= lo && v <= hi ? v : NaN);

/**
 * Die bereinigten Spalten einer Station für das kleinste zugelassene QN.
 * Mit `zwischen` auch die Temperaturen nach der Grenze, vor den
 * Querregeln (m0, x0, n0) - die braucht die Bilanz.
 */
export function bereinigen(r, q, zwischen = false) {
  const n = r.n;
  const aus = Object.fromEntries(SPALTEN.map((s) => [s, new Float64Array(n)]));
  const m0a = zwischen ? new Float64Array(n) : null;
  const x0a = zwischen ? new Float64Array(n) : null;
  const n0a = zwischen ? new Float64Array(n) : null;
  const { roh } = r;
  for (let i = 0; i < n; i++) {
    const ok4 = (r.qn[i] === 255 ? 0 : r.qn[i]) >= q;
    const ok3 = (r.qn3[i] === 255 ? 0 : r.qn3[i]) >= q;
    const m0 = ok4 ? imBereich(roh.tmk[i], TIEFST, HOECHST) : NaN;
    const x0 = ok4 ? imBereich(roh.txk[i], TIEFST, HOECHST) : NaN;
    const n0 = ok4 ? imBereich(roh.tnk[i], TIEFST, HOECHST) : NaN;
    if (zwischen) ((m0a[i] = m0), (x0a[i] = x0), (n0a[i] = n0));
    const tagWeg = x0 < n0;
    aus.tmk[i] = tagWeg || m0 < n0 || m0 > x0 ? NaN : m0;
    aus.txk[i] = tagWeg ? NaN : x0;
    aus.tnk[i] = tagWeg ? NaN : n0;
    const fx = ok3 ? imBereich(roh.fx[i], ...GRENZEN.fx) : NaN;
    const fm = ok3 ? imBereich(roh.fm[i], ...GRENZEN.fm) : NaN;
    aus.fx[i] = fx;
    aus.fm[i] = fm > fx ? NaN : fm;
    for (const s of ["rsk", "sdk", "shk", "nm", "vpm", "pm", "upm", "tgk"]) aus[s][i] = ok4 ? imBereich(roh[s][i], ...GRENZEN[s]) : NaN;
    aus.rskf[i] = ok4 && NS_FORMEN.has(roh.rskf[i]) ? roh.rskf[i] : NaN;
  }
  return zwischen ? { ...aus, m0: m0a, x0: x0a, n0: n0a } : aus;
}
