// Auswertungen über die ganze Reihe - dieselbe Rechnung wie auswertung.py,
// Schleife für Schleife. web/test/paritaet.test.js vergleicht beide.
// Grenzen und Begriffe stehen oben in auswertung.py.

import { imNormal, iso, mitNormal, normalSpanne, quantil, rein, runden } from "./rechnen.js";

const JAHR_MIN = 330;
const PROGNOSE_JAHRE = 30;
const STURM = 75 / 3.6;
const ORKAN = 118 / 3.6;

const REKORDE = [
  ["txk", "hoch", "Höchstwert", "°C", 1], ["tnk", "tief", "Tiefstwert", "°C", 1],
  ["tmk", "hoch", "wärmstes Tagesmittel", "°C", 1], ["tmk", "tief", "kältestes Tagesmittel", "°C", 1],
  ["tnk", "hoch", "wärmste Nacht", "°C", 1], ["txk", "tief", "kältester Höchstwert", "°C", 1],
  ["rsk", "hoch", "Niederschlag", "mm", 1], ["fx", "hoch", "Böe", "km/h", 3.6],
  ["sdk", "hoch", "Sonnenschein", "h", 1], ["shk", "hoch", "Schneehöhe", "cm", 1],
  ["tgk", "tief", "Erdbodenminimum", "°C", 1],
];

const KENNTAGE = [
  ["sommer", "Sommertage", "txk", (v) => v >= 25],
  ["heiss", "heiße Tage", "txk", (v) => v >= 30],
  ["tropen", "Tropennächte", "tnk", (v) => v >= 20],
  ["frost", "Frosttage", "tnk", (v) => v < 0],
  ["eis", "Eistage", "txk", (v) => v < 0],
  ["bodenfrost", "Bodenfrost", "tgk", (v) => v < 0],
];

const fehlt = (v) => v == null || Number.isNaN(v);
const mittel = (w) => (w.length ? w.reduce((a, b) => a + b, 0) / w.length : null);
const holen = (m, k, neu) => (m.has(k) ? m.get(k) : (m.set(k, neu()), m.get(k)));
const tageZwischen = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export const platzErlaubt = (jahre) => (jahre < 10 ? 1 : jahre < 20 ? 3 : jahre < 50 ? 5 : 10);

function letzter(r, w) {
  for (let i = r.n - 1; i >= 0; i--) if (!fehlt(w[i])) return i;
  return -1;
}

/** k -> [Mittel, 10 %, 90 %] der Tageswerte 1991-2020 im Fenster +-7 (nur gemessene). */
function tagesnormal(r, w) {
  const pool = new Map();
  for (let i = 0; i < r.n; i++) {
    if (!imNormal(r.jahr[i]) || fehlt(w[i])) continue;
    for (let o = -7; o <= 7; o++) holen(pool, (r.k[i] + o + 366) % 366, () => []).push(w[i]);
  }
  const aus = new Map();
  for (const [k, werte] of pool) {
    werte.sort((a, b) => a - b);
    aus.set(k, [mittel(werte), quantil(werte, 0.1), quantil(werte, 0.9)]);
  }
  return aus;
}

// ------------------------------------------------------------------ Rekorde
export function rekorde(r, stufe) {
  const c = rein(r, stufe);
  const jahre = r.n ? (r.tag[r.n - 1] - r.tag[0] + 1) / 365.25 : 0;
  const groessen = REKORDE.map(([sp, richtung, titel, einheit, faktor]) => {
    const w = c[sp];
    const vz = richtung === "hoch" ? -1 : 1;
    const paare = [];
    for (let i = 0; i < r.n; i++) if (!fehlt(w[i])) paare.push([vz * w[i], r.tag[i], i]);
    paare.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const top = paare.slice(0, 10).map(([v, o, i]) => [vz * v, o, i]);
    const liste = top.map(([wert, , i], pos) => {
      let platz = pos + 1;
      while (platz > 1 && top[platz - 2][0] === wert) platz--;
      return [platz, runden(wert * faktor), iso(r.tag[i])];
    });
    return { spalte: sp, richtung, titel, einheit, liste, tage: paare.length };
  });
  return { jahre: runden(jahre, 1), erlaubt: platzErlaubt(jahre), groessen };
}

// --------------------------------------------------- Heute in der Geschichte
export function geschichte(r, stufe, datum = null) {
  const c = rein(r, stufe);
  const li = letzter(r, c.tmk);
  if (li < 0) return { leer: true };
  const [ty, tm, td] = (datum ?? iso(r.tag[li])).split("-").map(Number);
  const k = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335][tm - 1] + td - 1;
  const jahre = new Map();
  const groessen = [["tmk", "Mittel"], ["txk", "Höchstwert"], ["tnk", "Tiefstwert"]].map(([sp, titel]) => {
    const w = c[sp];
    const normal = tagesnormal(r, w);
    const paare = [];
    for (let i = 0; i < r.n; i++) if (r.monat[i] === tm && r.tagImMonat[i] === td && !fehlt(w[i])) paare.push([w[i], r.jahr[i]]);
    for (const [v, j] of paare) holen(jahre, j, () => ({}))[sp] = runden(v);
    const e = paare.find(([, j]) => j === ty);
    const eigen = e ? e[0] : null;
    const warm = [...paare].sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const kalt = [...paare].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return {
      spalte: sp, titel, wert: runden(eigen),
      platz_warm: eigen == null ? null : 1 + paare.filter(([v]) => v > eigen).length,
      platz_kalt: eigen == null ? null : 1 + paare.filter(([v]) => v < eigen).length,
      von: paare.length,
      warm: warm.slice(0, 3).map(([v, j]) => [runden(v), j]),
      kalt: kalt.slice(0, 3).map(([v, j]) => [runden(v), j]),
      normal: normal.has(k) ? runden(normal.get(k)[0]) : null,
    };
  });
  return {
    datum: `${String(ty).padStart(4, "0")}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`,
    groessen,
    jahre: [...jahre.entries()].sort((a, b) => b[0] - a[0]).map(([j, v]) => [j, v.tmk ?? null, v.txk ?? null, v.tnk ?? null]),
  };
}

// ------------------------------------------------------------------ Kenntage
export function kenntage(r, stufe) {
  const c = rein(r, stufe);
  const proj = new Map();
  for (let i = 0; i < r.n; i++) {
    const e = holen(proj, r.jahr[i], () => ({ t: 0, n: 0, g: 0, ...Object.fromEntries(KENNTAGE.map(([k]) => [k, 0])) }));
    if (!fehlt(c.txk[i])) e.t++;
    if (!fehlt(c.tnk[i])) e.n++;
    if (!fehlt(c.tgk[i])) e.g++;
    for (const [key, , sp, bed] of KENNTAGE) if (!fehlt(c[sp][i]) && bed(c[sp][i])) e[key]++;
  }
  const zeilen = [...proj.keys()].sort((a, b) => a - b).map((j) => {
    const e = proj.get(j);
    return { jahr: j, ...Object.fromEntries(KENNTAGE.map(([k]) => [k, e[k]])), tage_x: e.t, tage_n: e.n, tage_g: e.g };
  });
  const normal = {};
  for (const [key, , sp] of KENNTAGE) {
    const feld = { txk: "tage_x", tnk: "tage_n", tgk: "tage_g" }[sp];
    normal[key] = runden(mittel(zeilen.filter((z) => imNormal(z.jahr) && z[feld] >= JAHR_MIN).map((z) => z[key])));
  }
  return { arten: KENNTAGE.map(([k, t]) => [k, t]), jahre: zeilen, normal, min_tage: JAHR_MIN };
}

// -------------------------------------------------------------------- Wellen
export function wellen(r, stufe, art = "normal", heiss = 30, kalt = 0, minTage = 3) {
  const c = rein(r, stufe);
  let werte, istHeiss, istKalt;
  if (art === "normal") {
    const tn = tagesnormal(r, c.tmk);
    werte = c.tmk;
    minTage = 5;
    istHeiss = (i) => tn.has(r.k[i]) && werte[i] > tn.get(r.k[i])[2];
    istKalt = (i) => tn.has(r.k[i]) && werte[i] < tn.get(r.k[i])[1];
  } else {
    if (art === "fest") ((heiss = 30), (kalt = 0), (minTage = 3));
    werte = c.txk;
    heiss = Number(heiss);
    kalt = Number(kalt);
    minTage = Math.max(1, Math.trunc(Number(minTage)));
    istHeiss = (i) => werte[i] >= heiss;
    istKalt = (i) => werte[i] < kalt;
  }
  const gefunden = [];
  for (const [typ, bed] of [["hitze", istHeiss], ["kaelte", istKalt]]) {
    let lauf = [];
    for (let i = 0; i <= r.n; i++) {
      const passt = i < r.n && !fehlt(werte[i]) && bed(i);
      if (passt && (!lauf.length || r.tag[i] === r.tag[lauf[lauf.length - 1]] + 1)) {
        lauf.push(i);
        continue;
      }
      if (lauf.length >= minTage) {
        const w = lauf.map((j) => werte[j]);
        gefunden.push({
          typ, von: iso(r.tag[lauf[0]]), bis: iso(r.tag[lauf[lauf.length - 1]]), tage: lauf.length,
          extrem: runden(typ === "hitze" ? Math.max(...w) : Math.min(...w)),
          mittel: runden(w.reduce((a, b) => a + b, 0) / w.length),
        });
      }
      lauf = passt ? [i] : [];
    }
  }
  const proj = new Map();
  for (const w of gefunden) {
    const j = Number(w.von.slice(0, 4));
    const e = holen(proj, j, () => ({ jahr: j, hitze: 0, hitze_tage: 0, hitze_laengste: 0, kaelte: 0, kaelte_tage: 0, kaelte_laengste: 0 }));
    e[w.typ]++;
    e[w.typ + "_tage"] += w.tage;
    e[w.typ + "_laengste"] = Math.max(e[w.typ + "_laengste"], w.tage);
  }
  const laengste = (typ) =>
    gefunden.filter((w) => w.typ === typ).sort((a, b) => b.tage - a.tage || (a.von < b.von ? -1 : a.von > b.von ? 1 : 0)).slice(0, 10);
  return {
    art, heiss: art !== "normal" ? heiss : null, kalt: art !== "normal" ? kalt : null, min_tage: minTage,
    jahre: [...proj.keys()].sort((a, b) => a - b).map((j) => proj.get(j)),
    hitze: laengste("hitze"), kaelte: laengste("kaelte"),
  };
}

// ------------------------------------------------------------ Klimastreifen
export function klimastreifen(r, stufe) {
  const c = rein(r, stufe);
  const proj = new Map();
  for (let i = 0; i < r.n; i++) if (!fehlt(c.tmk[i])) holen(proj, r.jahr[i], () => []).push(c.tmk[i]);
  const jahre = [...proj.entries()].sort((a, b) => a[0] - b[0]).filter(([, w]) => w.length >= JAHR_MIN).map(([j, w]) => [j, mittel(w)]);
  const ref = jahre.filter(([j]) => imNormal(j)).map(([, m]) => m);
  const bezug = mittel(ref);
  return {
    bezug: runden(bezug, 2), bezug_jahre: ref.length,
    jahre: jahre.map(([j, m]) => [j, runden(m, 2), bezug != null ? runden(m - bezug, 2) : null]),
  };
}

// --------------------------------------------- Summen: Niederschlag, Sonne
export function summen(r, stufe, spalte, jahrWahl = null) {
  const c = rein(r, stufe);
  const werte = c[spalte];
  const li = letzter(r, werte);
  if (li < 0) return { leer: true };
  const jahr = jahrWahl ? Number(jahrWahl) : r.jahr[li];
  const regen = spalte === "rsk";

  const proj = new Map();
  let trockenLauf = 0, trockenStart = null, vor = null;
  for (let i = 0; i < r.n; i++) {
    const j = r.jahr[i];
    const e = holen(proj, j, () => ({ jahr: j, summe: 0, tage: 0, nass: 0, max: null, max_datum: null, trocken: 0, trocken_von: null }));
    const v = werte[i];
    if (fehlt(v)) {
      trockenLauf = 0;
      vor = null;
      continue;
    }
    e.summe += v;
    e.tage++;
    if (e.max === null || v > e.max) ((e.max = v), (e.max_datum = iso(r.tag[i])));
    if (regen) {
      if (v >= 0.1) {
        e.nass++;
        trockenLauf = 0;
      } else {
        if (trockenLauf && vor === r.tag[i] - 1) trockenLauf++;
        else ((trockenLauf = 1), (trockenStart = i));
        if (trockenLauf > e.trocken) ((e.trocken = trockenLauf), (e.trocken_von = iso(r.tag[trockenStart])));
      }
      vor = r.tag[i];
    }
  }
  const jahre = [...proj.keys()].sort((a, b) => a - b).map((j) => {
    const e = proj.get(j);
    return {
      jahr: j, summe: runden(e.summe), tage: e.tage, nass: regen ? e.nass : null, max: runden(e.max), max_datum: e.max_datum,
      trocken: regen ? e.trocken : null, trocken_von: regen ? e.trocken_von : null,
    };
  });
  const voll = jahre.filter((z) => z.tage >= JAHR_MIN);
  [...voll].sort((a, b) => b.summe - a.summe).forEach((z, p) => (z.platz = p + 1));
  const normalJahre = voll.filter((z) => imNormal(z.jahr));

  const tageJ = new Map();
  const monatJ = new Map();
  for (let i = 0; i < r.n; i++) {
    const v = werte[i];
    if (fehlt(v)) continue;
    const t = holen(tageJ, r.jahr[i], () => new Array(366).fill(null));
    t[r.k[i]] = (t[r.k[i]] ?? 0) + v;
    const m = holen(monatJ, r.jahr[i] * 100 + r.monat[i], () => [0, 0]);
    m[0] += v;
    m[1]++;
  }
  const kumuliert = (j) => {
    let s = 0;
    return (tageJ.get(j) ?? new Array(366).fill(null)).map((v) => (s += v ?? 0));
  };
  const eigen = kumuliert(jahr);
  const tj = tageJ.get(jahr) ?? [];
  let letztK = -1;
  tj.forEach((v, k) => v !== null && (letztK = k));
  const kurven = normalJahre.map((z) => kumuliert(z.jahr));
  const band = [];
  for (let k = 0; k < 366; k++) {
    const w = kurven.map((cv) => cv[k]).sort((a, b) => a - b);
    band.push(w.length ? [k, runden(quantil(w, 0.1)), runden(quantil(w, 0.5)), runden(quantil(w, 0.9))] : [k, null, null, null]);
  }
  const monate = [];
  for (let mo = 1; mo <= 12; mo++) {
    if (!monatJ.has(jahr * 100 + mo)) continue;
    const nm = [];
    const [nv, nb] = normalSpanne();
    for (let j = nv; j <= nb; j++) {
      const [sm, n] = monatJ.get(j * 100 + mo) ?? [0, 0];
      const tageM = new Date(Date.UTC(j, mo, 0)).getUTCDate();
      if (n && n >= 0.9 * tageM) nm.push(sm);
    }
    const [sm, n] = monatJ.get(jahr * 100 + mo);
    monate.push({ mo, summe: runden(sm), tage: n, normal: runden(mittel(nm)) });
  }
  return {
    spalte, jahr, letzter: iso(r.tag[li]),
    kumuliert: eigen.slice(0, letztK + 1).map((v, k) => [k, runden(v)]),
    band, monate, jahre, normal_jahre: normalJahre.length,
    normal: runden(mittel(normalJahre.map((z) => z.summe))),
  };
}

// -------------------------------------------------------------------- Schnee
export function schnee(r, stufe) {
  const c = rein(r, stufe);
  const proj = new Map();
  for (let i = 0; i < r.n; i++) {
    const mo = r.monat[i];
    if (mo >= 5 && mo <= 9) continue;
    const w = r.jahr[i] + (mo >= 10 ? 1 : 0);
    const e = holen(proj, w, () => ({ winter: w, tage: 0, schneetage: 0, max: null, max_datum: null, erster: null, letzter: null }));
    const v = c.shk[i];
    if (fehlt(v)) continue;
    e.tage++;
    if (v >= 1) {
      e.schneetage++;
      e.erster = e.erster ?? iso(r.tag[i]);
      e.letzter = iso(r.tag[i]);
    }
    if (e.max === null || v > e.max) ((e.max = v), (e.max_datum = iso(r.tag[i])));
  }
  const winter = [...proj.keys()].sort((a, b) => a - b).map((w) => ({ ...proj.get(w), max: runden(proj.get(w).max, 0) }));
  const normal = winter.filter((w) => w.tage >= 0.9 * 212 && imNormal(w.winter)).map((w) => w.schneetage);
  return { winter, normal: runden(mittel(normal)), min_tage: 0.9 * 212 };
}

// ---------------------------------------------------------------------- Wind
export function wind(r, stufe) {
  const c = rein(r, stufe);
  const proj = new Map();
  for (let i = 0; i < r.n; i++) {
    const e = holen(proj, r.jahr[i], () => ({ jahr: r.jahr[i], tage: 0, sturm: 0, orkan: 0, max: null, max_datum: null }));
    const v = c.fx[i];
    if (fehlt(v)) continue;
    e.tage++;
    if (v >= STURM) e.sturm++;
    if (v >= ORKAN) e.orkan++;
    if (e.max === null || v > e.max) ((e.max = v), (e.max_datum = iso(r.tag[i])));
  }
  const jahre = [...proj.keys()].sort((a, b) => a - b).map((j) => {
    const e = proj.get(j);
    return { ...e, max: e.max !== null ? runden(e.max * 3.6) : null };
  });
  const normal = jahre.filter((j) => imNormal(j.jahr) && j.tage >= JAHR_MIN).map((j) => j.sturm);
  return { jahre, normal: runden(mittel(normal)) };
}

// --------------------------------------------------------------------- Frost
export function frost(r, stufe) {
  const c = rein(r, stufe);
  const proj = new Map();
  for (let i = 0; i < r.n; i++) {
    const e = holen(proj, r.jahr[i], () => ({}));
    for (const [art, sp] of [["luft", "tnk"], ["boden", "tgk"]]) {
      const v = c[sp][i];
      if (fehlt(v)) continue;
      e[art + "_tage"] = (e[art + "_tage"] ?? 0) + 1;
      if (v < 0) {
        if (r.monat[i] <= 6) e[art + "_letzter"] = iso(r.tag[i]);
        else if (!(art + "_erster" in e)) e[art + "_erster"] = iso(r.tag[i]);
      }
    }
  }
  const jahre = [...proj.keys()].sort((a, b) => a - b).map((j) => {
    const e = proj.get(j);
    const z = { jahr: j };
    for (const art of ["luft", "boden"]) {
      const l = e[art + "_letzter"] ?? null, f = e[art + "_erster"] ?? null;
      z[art + "_letzter"] = l;
      z[art + "_erster"] = f;
      z[art + "_tage"] = e[art + "_tage"] ?? 0;
      z[art + "_frei"] = l && f ? tageZwischen(l, f) - 1 : null;
    }
    return z;
  });
  const normal = (feld) => runden(mittel(jahre.filter((z) => imNormal(z.jahr) && z[feld] !== null && z[feld.split("_")[0] + "_tage"] >= JAHR_MIN).map((z) => z[feld])));
  return { jahre, normal: { luft_frei: normal("luft_frei"), boden_frei: normal("boden_frei") } };
}

// -------------------------------------------------------- Prognose im Verlauf
export function prognoseVerlauf(r, stufe, heute) {
  const c = rein(r, stufe);
  const li = letzter(r, c.tmk);
  if (li < 0 || r.jahr[li] !== heute.j) return { leer: true };
  const jahr = r.jahr[li];
  const ende = Date.UTC(jahr, 11, 31) / 86400000;
  const tageImJahr = (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0 ? 366 : 365;
  const vergleich = [];
  for (let j = jahr - PROGNOSE_JAHRE; j < jahr; j++) vergleich.push(j);
  const ab = new Map(vergleich.map((j) => [j, [new Float64Array(367), new Int32Array(367)]]));
  for (let i = 0; i < r.n; i++) {
    const e = ab.get(r.jahr[i]);
    if (e && !fehlt(c.tmk[i])) ((e[0][r.k[i]] += c.tmk[i]), e[1][r.k[i]]++);
  }
  for (const [s, n] of ab.values()) {
    for (let k = 365; k >= 0; k--) {
      s[k] += s[k + 1];
      n[k] += n[k + 1];
    }
  }
  const verlauf = [];
  let summe = 0, anzahl = 0;
  for (let i = 0; i < r.n; i++) {
    if (r.jahr[i] !== jahr || fehlt(c.tmk[i])) continue;
    summe += c.tmk[i];
    anzahl++;
    const rest = ende - r.tag[i];
    const bisherTage = tageImJahr - rest;
    if (anzahl < 0.9 * bisherTage || rest === 0) continue;
    const k = r.k[i];
    const reste = vergleich
      .filter((j) => ab.get(j)[1][k + 1] && ab.get(j)[1][k + 1] >= 0.9 * rest)
      .map((j) => ab.get(j)[0][k + 1] / ab.get(j)[1][k + 1])
      .sort((a, b) => a - b);
    if (!reste.length) continue;
    const m = summe / anzahl;
    const q = [0.1, 0.5, 0.9].map((p) => (m * bisherTage + quantil(reste, p) * rest) / tageImJahr);
    verlauf.push([iso(r.tag[i]), runden(q[0], 2), runden(q[1], 2), runden(q[2], 2), runden(m, 2)]);
  }
  return { jahr, verlauf, jahre: [jahr - PROGNOSE_JAHRE, jahr - 1] };
}

/** Wie Daten.auswertung in Python: eine Auswertung nach Namen. */
export function auswertung(r, art, stufe, optionen = {}, heute, normal) {
  return mitNormal(normal, () => auswertungRechnen(r, art, stufe, optionen, heute));
}

function auswertungRechnen(r, art, stufe, optionen, heute) {
  if (!r.n) return { leer: true };
  const o = optionen ?? {};
  switch (art) {
    case "rekorde": return rekorde(r, stufe);
    case "geschichte": return geschichte(r, stufe, o.datum ?? null);
    case "kenntage": return kenntage(r, stufe);
    case "wellen": return wellen(r, stufe, o.art ?? "normal", o.heiss ?? 30, o.kalt ?? 0, o.min_tage ?? 3);
    case "streifen": return klimastreifen(r, stufe);
    case "niederschlag": return summen(r, stufe, "rsk", o.jahr ?? null);
    case "sonne": return summen(r, stufe, "sdk", o.jahr ?? null);
    case "schnee": return schnee(r, stufe);
    case "wind": return wind(r, stufe);
    case "frost": return frost(r, stufe);
    case "prognose_verlauf": return prognoseVerlauf(r, stufe, heute);
    default: throw new Error(`Unbekannte Auswertung: ${art}`);
  }
}
