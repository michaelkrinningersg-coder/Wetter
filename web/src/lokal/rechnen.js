// Der Rechenkern der Android-App - dieselben Abfragen wie daten.py, nur
// ohne DuckDB: eine Station liegt als Spalten im Speicher (60.000 Tage
// sind wenige Megabyte), und jede Ansicht ist eine Schleife darüber.
//
// Maßstab ist daten.py. web/test/paritaet.test.js rechnet dieselben
// Aufrufe hier und dort (tests/paritaet.py) und vergleicht. Wer hier oder
// dort etwas ändert, ändert beides.

import { QN_STUFEN, bereinigen } from "./plausibel.js";

export const JAHR_MIN_TAGE = 330;
export const NORMAL_VON = 1991;
// wählbare Vergleichszeiträume: immer 30 Jahre, je 10 Jahre früher
export const NORMALE = [1991, 1981, 1971, 1961];

/** Gewählter Vergleichszeitraum (Startjahr); Unbekanntes -> 1991, wie daten.normal_zeitraum. */
export function normalVon(v) {
  const n = Number(v);
  return NORMALE.includes(n) ? n : NORMAL_VON;
}

// Der Zeitraum gilt für einen ganzen Aufruf; die Rechnungen sind synchron.
let nv = NORMAL_VON;
export function mitNormal(normal, arbeit) {
  const alt = nv;
  nv = normalVon(normal);
  try {
    return arbeit();
  } finally {
    nv = alt;
  }
}
export const imNormal = (j) => j >= nv && j <= nv + 29;
export const normalSpanne = () => [nv, nv + 29];
export const GLAETTUNG = 15;
export const PROGNOSE_JAHRE = 30;
export const MONAT_SPALTEN = ["tmk", "txk", "tnk", "tgk", "fm", "fx", "rsk", "rskf", "sdk", "shk", "nm", "upm", "vpm", "pm"];
export const SUMMEN = ["rsk", "sdk"];
const WIND = new Set(["fm", "fx"]);
const SPALTEN = { m: "tmk", x: "txk", n: "tnk" };
const SPRUNG = 15;
const TAG = 86400;

// ------------------------------------------------------------- Kleinkram

/**
 * Runden wie Python: nach dem exakten Binärwert, bei einem echten Gleichstand
 * (nur möglich, wenn x genau ,x5 ist, etwa 2,25) zur geraden Ziffer.
 * Nicht über x * 10: 20,95 ist binär 20,94999…, aber 20,95 * 10 ergibt
 * gerundet genau 209,5 - und schon stünde 21,0 statt 20,9 da.
 */
export function runden(x, stellen = 1) {
  if (x == null || Number.isNaN(x)) return null;
  // toFixed rechnet mit dem exakten Wert; 20 Stellen mehr zeigen, ob es ein Gleichstand ist
  const lang = Math.abs(x).toFixed(stellen + 20);
  const rest = lang.slice(lang.length - 20);
  if (rest === "5" + "0".repeat(19)) {
    const kopf = lang.slice(0, lang.length - 20);
    const letzte = Number(kopf[kopf.length - 1] === "." ? kopf[kopf.length - 2] : kopf[kopf.length - 1]);
    const ab = Number(kopf.endsWith(".") ? kopf.slice(0, -1) : kopf);
    const r = letzte % 2 === 0 ? ab : ab + 10 ** -stellen;
    return Number((Math.sign(x) * r).toFixed(stellen));
  }
  return Number(x.toFixed(stellen));
}

const fehlt = (v) => v == null || Number.isNaN(v);

/** Tage seit 1970 -> Datum (UTC) */
export function datumVon(tag) {
  const d = new Date(tag * TAG * 1000);
  return { j: d.getUTCFullYear(), m: d.getUTCMonth() + 1, t: d.getUTCDate() };
}
export const tagVon = (j, m, t) => Math.round(Date.UTC(j, m - 1, t) / (TAG * 1000));
export function iso(tag) {
  const { j, m, t } = datumVon(tag);
  return `${String(j).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(t).padStart(2, "0")}`;
}
const tageImMonat = (j, m) => new Date(Date.UTC(j, m, 0)).getUTCDate();
const schaltjahr = (j) => (j % 4 === 0 && j % 100 !== 0) || j % 400 === 0;
// Kalendertag 0..365 wie daten._tag_index: im Schaltjahr gezählt
const MONATSANFANG = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

function mittel(summe, n) {
  return n ? summe / n : null;
}

/** quantile_cont wie DuckDB: linear zwischen den Nachbarn bei (n-1)*p. */
export function quantil(sortiert, p) {
  if (!sortiert.length) return null;
  const pos = (sortiert.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortiert[lo] + (sortiert[hi] - sortiert[lo]) * (pos - lo);
}

// ----------------------------------------------------------------- Reihe

/**
 * Aus den Zeilen einer Station (nach Datum sortiert) die Spalten und die
 * Datumsteile, die jede Abfrage braucht. Gerechnet einmal je Station.
 */
export function reihe(zeilen) {
  const n = zeilen.tag.length;
  const jahr = new Int16Array(n);
  const monat = new Int8Array(n);
  const tagImMonat = new Int8Array(n);
  const k = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const d = datumVon(zeilen.tag[i]);
    jahr[i] = d.j;
    monat[i] = d.m;
    tagImMonat[i] = d.t;
    k[i] = MONATSANFANG[d.m - 1] + d.t - 1;
  }
  return { ...zeilen, n, jahr, monat, tagImMonat, k, _rein: new Map() };
}

/** Die bereinigten Spalten für eine QN-Stufe (gemerkt). */
export function rein(r, stufe) {
  const q = QN_STUFEN[stufe] ?? 0;
  if (!r._rein.has(q)) r._rein.set(q, bereinigen(r, q));
  return r._rein.get(q);
}

// ------------------------------------------------------------- Abfragen

export function zeitraum(r) {
  if (!r.n) return { von: null, bis: null, tage: 0 };
  return { von: iso(r.tag[0]), bis: iso(r.tag[r.n - 1]), tage: r.n };
}

export function bilanz(r, stufe) {
  const q = QN_STUFEN[stufe] ?? 0;
  const { roh } = r;
  const g = bereinigen(r, q, true);
  let qnWeg = 0, grenze = 0, maxUnterMin = 0, mittelAus = 0, spruenge = 0;
  let vorTag = null, vorM = null;
  for (let i = 0; i < r.n; i++) {
    if ((r.qn[i] === 255 ? 0 : r.qn[i]) < q) {
      qnWeg++;
      continue;
    }
    const m0 = g.m0[i], x0 = g.x0[i], n0 = g.n0[i];
    if (!fehlt(roh.tmk[i]) && fehlt(m0)) grenze++;
    if (!fehlt(roh.txk[i]) && fehlt(x0)) grenze++;
    if (!fehlt(roh.tnk[i]) && fehlt(n0)) grenze++;
    if (x0 < n0) maxUnterMin++;
    else if (m0 < n0 || m0 > x0) mittelAus++;
    const m = g.tmk[i];
    if (vorTag === r.tag[i] - 1 && !fehlt(m) && !fehlt(vorM) && Math.abs(m - vorM) > SPRUNG) spruenge++;
    vorTag = r.tag[i];
    vorM = m;
  }
  return { tage: r.n, qn_weg: qnWeg, grenze_weg: grenze, max_unter_min: maxUnterMin, mittel_ausserhalb: mittelAus, spruenge };
}

export function jahre(r, stufe) {
  const c = rein(r, stufe);
  const s = new Set();
  for (let i = 0; i < r.n; i++) if (!fehlt(c.tmk[i]) || !fehlt(c.txk[i]) || !fehlt(c.tnk[i])) s.add(r.jahr[i]);
  return [...s].sort((a, b) => b - a);
}

function letzterTag(r, c, spalten = ["tmk"]) {
  for (let i = r.n - 1; i >= 0; i--) if (spalten.some((s) => !fehlt(c[s][i]))) return i;
  return -1;
}


/** Tagesnormal: je Kalendertag alle Tage 1991-2020 im Fenster +-7 Tage. */
function tagesnormal(r, c, nurMittel = false) {
  const anzahl = new Map();
  const add = (ziel, k, i) => {
    let e = ziel.get(k);
    if (!e) ziel.set(k, (e = { sm: 0, nm: 0, sx: 0, nx: 0, sn: 0, nn: 0, werte: [] }));
    const m = c.tmk[i];
    if (!fehlt(m)) {
      e.sm += m;
      e.nm++;
      if (!nurMittel) e.werte.push(m);
    }
    if (nurMittel) return;
    if (!fehlt(c.txk[i])) ((e.sx += c.txk[i]), e.nx++);
    if (!fehlt(c.tnk[i])) ((e.sn += c.tnk[i]), e.nn++);
  };
  for (let i = 0; i < r.n; i++) {
    if (!imNormal(r.jahr[i])) continue;
    for (let o = -7; o <= 7; o++) add(anzahl, (r.k[i] + o + 366) % 366, i);
  }
  return anzahl;
}

export function jahresband(r, jahrWahl, stufe, heute, normal) {
  return mitNormal(normal, () => jahresbandRechnen(r, jahrWahl, stufe, heute));
}

function jahresbandRechnen(r, jahrWahl, stufe, heute) {
  const c = rein(r, stufe);
  const li = letzterTag(r, c);
  if (li < 0) return { leer: true };
  const letzter = r.tag[li];
  const lj = r.jahr[li];
  const jahr = jahrWahl == null ? lj : Number(jahrWahl);

  const tage = [];
  for (let i = 0; i < r.n; i++) if (r.jahr[i] === jahr) tage.push([r.k[i], runden(c.tmk[i]), runden(c.txk[i]), runden(c.tnk[i])]);

  const normalJahre = new Set();
  for (let i = 0; i < r.n; i++) if (imNormal(r.jahr[i]) && !fehlt(c.tmk[i])) normalJahre.add(r.jahr[i]);
  let normal = [];
  if (normalJahre.size) {
    const tn = tagesnormal(r, c);
    normal = [...tn.keys()]
      .sort((a, b) => a - b)
      .map((k) => {
        const e = tn.get(k);
        const w = e.werte.sort((a, b) => a - b);
        return [k, runden(mittel(e.sm, e.nm), 2), runden(mittel(e.sx, e.nx), 2), runden(mittel(e.sn, e.nn), 2), runden(quantil(w, 0.1), 2), runden(quantil(w, 0.9), 2)];
      });
  }

  // Monate des Jahres gegen den Monat im Normal
  const mj = new Map();
  const mn = new Map();
  for (let i = 0; i < r.n; i++) {
    const m = c.tmk[i];
    if (r.jahr[i] === jahr) {
      let e = mj.get(r.monat[i]);
      if (!e) mj.set(r.monat[i], (e = [0, 0]));
      if (!fehlt(m)) ((e[0] += m), e[1]++);
    }
    if (imNormal(r.jahr[i])) {
      let e = mn.get(r.monat[i]);
      if (!e) mn.set(r.monat[i], (e = [0, 0]));
      if (!fehlt(m)) ((e[0] += m), e[1]++);
    }
  }
  const monate = [...mj.keys()]
    .sort((a, b) => a - b)
    .map((mo) => {
      const [s, n] = mj.get(mo);
      const nm = mn.get(mo);
      return { mo, m: runden(mittel(s, n)), tage: n, norm: nm ? runden(mittel(nm[0], nm[1])) : null };
    });

  // Bis heute: dasselbe Stück jedes anderen Jahres, gereiht
  const ende = jahr === lj ? letzter : tagVon(jahr, 12, 31);
  const de = datumVon(ende);
  const bisMd = de.m * 100 + de.t;
  const spanne = ende - tagVon(jahr, 1, 1) + 1;
  const proJahr = new Map();
  for (let i = 0; i < r.n; i++) {
    if (r.monat[i] * 100 + r.tagImMonat[i] > bisMd || fehlt(c.tmk[i])) continue;
    let e = proJahr.get(r.jahr[i]);
    if (!e) proJahr.set(r.jahr[i], (e = [0, 0]));
    e[0] += c.tmk[i];
    e[1]++;
  }
  const reihenfolge = [...proJahr.entries()]
    .filter(([, [, n]]) => n >= 0.9 * spanne)
    .map(([y, [s, n]]) => [y, s / n])
    .sort((a, b) => b[1] - a[1]);
  const platzIdx = reihenfolge.findIndex(([y]) => y === jahr);
  let es = 0, en = 0;
  for (let i = 0; i < r.n; i++) if (r.jahr[i] === jahr && r.tag[i] <= ende && !fehlt(c.tmk[i])) ((es += c.tmk[i]), en++);

  return {
    jahr,
    letzter: iso(letzter),
    laufend: jahr === lj,
    ende: iso(ende),
    tage,
    normal,
    normal_jahre: normalJahre.size,
    monate,
    bisher: { m: runden(mittel(es, en), 2), tage: en, platz: platzIdx < 0 ? null : platzIdx + 1, von: reihenfolge.length },
    prognose: jahr === lj ? prognose(r, c, li, heute) : null,
  };
}

/** Siehe daten._prognose: bisher plus Rest des Jahres aus den letzten 30 Jahren. */
function prognose(r, c, li, heute) {
  const letzter = r.tag[li];
  const jahr = r.jahr[li];
  if (jahr !== heute.j) return null;
  const jahresende = tagVon(jahr, 12, 31);
  const rest = jahresende - letzter;
  const tageImJahr = schaltjahr(jahr) ? 366 : 365;
  const bisherTage = tageImJahr - rest;
  let es = 0, en = 0;
  for (let i = 0; i < r.n; i++) if (r.jahr[i] === jahr && r.tag[i] <= letzter && !fehlt(c.tmk[i])) ((es += c.tmk[i]), en++);
  if (!en || en < 0.9 * bisherTage) return null;
  const bisherM = es / en;
  let q, vergleich;
  if (rest === 0) {
    q = [bisherM, bisherM, bisherM];
    vergleich = 0;
  } else {
    const dl = datumVon(letzter);
    const md = dl.m * 100 + dl.t;
    const proJahr = new Map();
    for (let i = 0; i < r.n; i++) {
      const y = r.jahr[i];
      if (y < jahr - PROGNOSE_JAHRE || y > jahr - 1 || r.monat[i] * 100 + r.tagImMonat[i] <= md) continue;
      let e = proJahr.get(y);
      if (!e) proJahr.set(y, (e = [0, 0]));
      if (!fehlt(c.tmk[i])) ((e[0] += c.tmk[i]), e[1]++);
    }
    const reste = [...proJahr.values()]
      .filter(([, n]) => n >= 0.9 * rest)
      .map(([s, n]) => (n ? s / n : null))
      .filter((v) => v != null)
      .sort((a, b) => a - b);
    const gezaehlt = [...proJahr.values()].filter(([, n]) => n >= 0.9 * rest).length;
    if (!gezaehlt) return null;
    vergleich = gezaehlt;
    q = [0.1, 0.5, 0.9].map((p) => (bisherM * bisherTage + quantil(reste, p) * rest) / tageImJahr);
  }
  const volle = vollJahre(r, c, jahr);
  const platz = (w) => 1 + volle.filter((v) => v > w).length;
  return {
    tief: runden(q[0], 2),
    mitte: runden(q[1], 2),
    hoch: runden(q[2], 2),
    platz: platz(q[1]),
    platz_hoch: platz(q[2]),
    platz_tief: platz(q[0]),
    von: volle.length + 1,
    vergleichsjahre: vergleich,
    jahre: [jahr - PROGNOSE_JAHRE, jahr - 1],
    rest_tage: rest,
  };
}

/** Mittel aller Jahre mit mindestens 330 Tagesmitteln, außer `ohne`. */
function vollJahre(r, c, ohne, mitJahr = false) {
  const proJahr = new Map();
  for (let i = 0; i < r.n; i++) {
    if (r.jahr[i] === ohne) continue;
    let e = proJahr.get(r.jahr[i]);
    if (!e) proJahr.set(r.jahr[i], (e = [0, 0]));
    if (!fehlt(c.tmk[i])) ((e[0] += c.tmk[i]), e[1]++);
  }
  const aus = [...proJahr.entries()].filter(([, [, n]]) => n >= JAHR_MIN_TAGE);
  return mitJahr ? aus.map(([y, [s, n]]) => [y, s / n, n]) : aus.map(([, [s, n]]) => s / n);
}

export function rangliste(r, modus, mitPrognose, stufe, heute, normal) {
  return mitNormal(normal, () => ranglisteRechnen(r, modus, mitPrognose, stufe, heute));
}

function ranglisteRechnen(r, modus, mitPrognose, stufe, heute) {
  const c = rein(r, stufe);
  const li = letzterTag(r, c);
  if (li < 0) return { zeilen: [] };
  const letzter = r.tag[li];
  const lj = r.jahr[li];
  let liste;
  if (modus === "heute") {
    const dl = datumVon(letzter);
    const bisMd = dl.m * 100 + dl.t;
    const spanne = letzter - tagVon(lj, 1, 1) + 1;
    const proJahr = new Map();
    for (let i = 0; i < r.n; i++) {
      if (r.monat[i] * 100 + r.tagImMonat[i] > bisMd) continue;
      let e = proJahr.get(r.jahr[i]);
      if (!e) proJahr.set(r.jahr[i], (e = [0, 0]));
      if (!fehlt(c.tmk[i])) ((e[0] += c.tmk[i]), e[1]++);
    }
    liste = [...proJahr.entries()].filter(([, [, n]]) => n >= 0.9 * spanne).map(([jahr, [s, n]]) => ({ jahr, m: s / n, tage: n }));
  } else {
    modus = "jahr";
    liste = vollJahre(r, c, lj, true).map(([jahr, m, tage]) => ({ jahr, m, tage }));
  }
  let p = null;
  if (modus === "jahr" && mitPrognose) {
    p = prognose(r, c, li, heute);
    if (p) liste.push({ jahr: lj, m: p.mitte, tage: null, prognose: true, tief: p.tief, hoch: p.hoch });
  }
  const normale = liste.filter((z) => imNormal(z.jahr)).map((z) => z.m);
  const normal = normale.length ? normale.reduce((a, b) => a + b, 0) / normale.length : null;
  liste.sort((a, b) => b.m - a.m);
  liste.forEach((z, i) => {
    z.platz = i + 1;
    z.abw = normal != null ? runden(z.m - normal, 2) : null;
    z.m = runden(z.m, 2);
  });
  return { zeilen: liste, modus, letzter: iso(letzter), jahr: lj, normal: runden(normal, 2), normal_jahre: normale.length, prognose: p };
}

export function monat(r, jahrWahl, monatWahl, stufe, normal) {
  return mitNormal(normal, () => monatRechnen(r, jahrWahl, monatWahl, stufe));
}

function monatRechnen(r, jahrWahl, monatWahl, stufe) {
  const c = rein(r, stufe);
  let erster = -1;
  for (let i = 0; i < r.n; i++) if (!fehlt(c.tmk[i]) || !fehlt(c.rsk[i])) { erster = i; break; }
  const li = letzterTag(r, c, ["tmk", "rsk"]);
  if (li < 0) return { leer: true };
  let jahr = Number(jahrWahl), mo = Number(monatWahl);
  if (!jahrWahl || !monatWahl) ((jahr = r.jahr[li]), (mo = r.monat[li]));
  const idx = [];
  for (let i = 0; i < r.n; i++) if (r.jahr[i] === jahr && r.monat[i] === mo) idx.push(i);
  const bisTag = idx.length ? Math.max(...idx.map((i) => r.tagImMonat[i])) : 31;
  const keys = new Set(idx.map((i) => r.k[i]));
  const tn = tagesnormal(r, c, true);
  const werteSpalten = MONAT_SPALTEN.filter((s) => s !== "rskf");

  const summe = {}, anzahl = {};
  for (const s of werteSpalten) {
    let sum = 0, n = 0;
    for (const i of idx) if (!fehlt(c[s][i])) ((sum += c[s][i]), n++);
    summe[s] = n ? (SUMMEN.includes(s) ? sum : sum / n) : null;
    anzahl[s] = n;
  }

  // Normal: dieselben Tage des Monats 1991-2020
  const b = [];
  for (let i = 0; i < r.n; i++) if (imNormal(r.jahr[i]) && r.monat[i] === mo && r.tagImMonat[i] <= bisTag) b.push(i);
  const normal = {};
  for (const s of werteSpalten) {
    if (SUMMEN.includes(s)) {
      const proJahr = new Map();
      for (const i of b) {
        let e = proJahr.get(r.jahr[i]);
        if (!e) proJahr.set(r.jahr[i], (e = [0, 0]));
        if (!fehlt(c[s][i])) ((e[0] += c[s][i]), e[1]++);
      }
      const summen = [...proJahr.values()].filter(([, n]) => n >= 0.9 * bisTag).map(([sm, n]) => (n ? sm : null)).filter((v) => v != null);
      normal[s] = summen.length ? summen.reduce((a, v) => a + v, 0) / summen.length : null;
    } else {
      let sum = 0, n = 0;
      for (const i of b) if (!fehlt(c[s][i])) ((sum += c[s][i]), n++);
      normal[s] = n ? sum / n : null;
    }
  }
  const normalJahre = new Set(b.filter((i) => !fehlt(c.tmk[i])).map((i) => r.jahr[i])).size;

  const ausgabe = (s, w) => {
    if (fehlt(w)) return null;
    if (WIND.has(s)) return runden(w * 3.6);
    if (s === "rskf") return Math.trunc(w);
    return runden(w);
  };
  const zeilen = idx.map((i) => {
    const e = tn.get(r.k[i]);
    const nm = e && e.nm ? e.sm / e.nm : null;
    const werte = {};
    for (const s of MONAT_SPALTEN) werte[s] = ausgabe(s, c[s][i]);
    return { tag: r.tagImMonat[i], werte, abw: nm != null && !fehlt(c.tmk[i]) ? runden(c.tmk[i] - nm) : null };
  });
  void keys;
  return {
    jahr, monat: mo, bis_tag: bisTag,
    erster: iso(r.tag[erster]), letzter: iso(r.tag[li]),
    spalten: MONAT_SPALTEN, summen: [...SUMMEN].sort(),
    zeilen,
    summe: Object.fromEntries(werteSpalten.map((s) => [s, ausgabe(s, summe[s])])),
    anzahl,
    normal: Object.fromEntries(werteSpalten.map((s) => [s, ausgabe(s, normal[s])])),
    normal_jahre: normalJahre,
  };
}

function mitLuecken(paare, schritt, stellen = 1) {
  const t = [], v = [];
  for (const [zeit, wert] of paare) {
    if (t.length && zeit - t[t.length - 1] > schritt) {
      t.push(t[t.length - 1] + schritt);
      v.push(null);
    }
    t.push(zeit);
    v.push(runden(wert, stellen));
  }
  return [t, v];
}

export function zeitreihe(r, groesse, aufloesung, stufe) {
  const sp = SPALTEN[groesse] ?? "tmk";
  const c = rein(r, stufe);
  const w = c[sp];
  if (aufloesung === "tag") {
    const paare = [], spruenge = [];
    let vor = -1;
    for (let i = 0; i < r.n; i++) {
      if (fehlt(w[i])) continue;
      const zeit = r.tag[i] * TAG + 43200;
      paare.push([zeit, w[i]]);
      if (vor >= 0 && r.tag[vor] === r.tag[i] - 1 && Math.abs(w[i] - w[vor]) > SPRUNG) spruenge.push([zeit, runden(w[i]), runden(w[vor])]);
      vor = i;
    }
    const [t, v] = mitLuecken(paare, TAG);
    return { t, v, glatt: null, spruenge };
  }
  if (aufloesung === "monat") {
    const proMonat = new Map();
    for (let i = 0; i < r.n; i++) {
      if (fehlt(w[i])) continue;
      const key = r.jahr[i] * 12 + r.monat[i] - 1;
      let e = proMonat.get(key);
      if (!e) proMonat.set(key, (e = [0, 0]));
      e[0] += w[i];
      e[1]++;
    }
    const paare = [...proMonat.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([key, [, n]]) => n >= 0.9 * tageImMonat(Math.floor(key / 12), (key % 12) + 1))
      .map(([key, [s, n]]) => [(tagVon(Math.floor(key / 12), (key % 12) + 1, 1) + 14) * TAG, s / n]);
    const [t, v] = mitLuecken(paare, 31 * TAG, 2);
    return { t, v, glatt: null, spruenge: [] };
  }
  const proJahr = new Map();
  for (let i = 0; i < r.n; i++) {
    if (fehlt(w[i])) continue;
    let e = proJahr.get(r.jahr[i]);
    if (!e) proJahr.set(r.jahr[i], (e = [0, 0]));
    e[0] += w[i];
    e[1]++;
  }
  const js = [...proJahr.entries()].filter(([, [, n]]) => n >= JAHR_MIN_TAGE).map(([y, [s, n]]) => [y, s / n]).sort((a, b) => a[0] - b[0]);
  const glatt = js.map(([y]) => {
    const fenster = js.filter(([z]) => z >= y - GLAETTUNG && z <= y + GLAETTUNG);
    return fenster.reduce((a, [, m]) => a + m, 0) / fenster.length;
  });
  return {
    t: js.map(([y]) => Date.UTC(y, 6, 2) / 1000),
    j: js.map(([y]) => y),
    v: js.map(([, m]) => runden(m, 2)),
    glatt: glatt.map((g) => runden(g, 2)),
    spruenge: [],
  };
}
