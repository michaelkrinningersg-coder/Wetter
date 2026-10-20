// Rechnet die Android-App dasselbe wie das Programm am PC?
//
// tests/paritaet.py hat eine künstliche Station mit daten.py (DuckDB)
// gerechnet und Rohdaten samt Ergebnissen hier abgelegt. Dieser Test liest
// dieselben Rohdaten mit dem JS-Kern und vergleicht jeden Aufruf.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { produktLesen, zusammenfuehren } from "../src/lokal/lesen.js";
import { auswertung } from "../src/lokal/auswertung.js";
import * as R from "../src/lokal/rechnen.js";

const ORDNER = new URL("./paritaet/", import.meta.url);
const lies = (name) => new TextDecoder("latin1").decode(readFileSync(new URL(name, ORDNER)));
const erwartet = JSON.parse(readFileSync(new URL("erwartet.json", ORDNER), "utf8"));
const [hj, hm, ht] = erwartet.heute.split("-").map(Number);
const heute = { j: hj, m: hm, t: ht };

const reihe = R.reihe(zusammenfuehren(produktLesen(lies("hist.txt")), produktLesen(lies("recent.txt"))));

const AUFRUFE = {
  bilanz: (s) => R.bilanz(reihe, s),
  jahre: (s) => R.jahre(reihe, s),
  jahresband: (j, s, n) => R.jahresband(reihe, j, s, heute, n),
  monat: (j, m, s, n) => R.monat(reihe, j, m, s, n),
  rangliste: (m, p, s, n) => R.rangliste(reihe, m, p, s, heute, n),
  zeitreihe: (g, a, s) => R.zeitreihe(reihe, g, a, s),
  zeitraum: () => R.zeitraum(reihe),
  auswertung: (art, s, o, n) => auswertung(reihe, art, s, o, heute, n),
};

/**
 * Gleich; meldet den Pfad. Ganze Zahlen (Tage, Plätze, Anzahlen) müssen
 * genau stimmen. Gerundete Werte dürfen in der letzten Stelle um eins
 * abweichen: liegt ein Mittel genau auf ,xx5 (424,9 / 28 = 15,175), legt
 * die Reihenfolge der Summe das Rauschen in der 15. Stelle mal darüber,
 * mal darunter - DuckDB summiert anders als eine Schleife.
 */
function vergleichen(ist, soll, pfad, fehler) {
  if (fehler.length > 12) return;
  if (typeof soll === "number" && typeof ist === "number") {
    // 0,01 lässt keine ganze Zahl durch: die weichen um mindestens 1 ab
    if (Math.abs(ist - soll) > 0.0100001) fehler.push(`${pfad}: ${ist} statt ${soll}`);
    return;
  }
  if (soll === null || typeof soll !== "object") {
    if (ist !== soll) fehler.push(`${pfad}: ${JSON.stringify(ist)} statt ${JSON.stringify(soll)}`);
    return;
  }
  if (Array.isArray(soll)) {
    if (!Array.isArray(ist)) return void fehler.push(`${pfad}: keine Liste`);
    if (ist.length !== soll.length) fehler.push(`${pfad}: Länge ${ist.length} statt ${soll.length}`);
    soll.forEach((s, i) => vergleichen(ist[i], s, `${pfad}[${i}]`, fehler));
    return;
  }
  if (ist === null || typeof ist !== "object") return void fehler.push(`${pfad}: ${JSON.stringify(ist)} statt Objekt`);
  const schluessel = new Set([...Object.keys(soll), ...Object.keys(ist)]);
  for (const k of schluessel) vergleichen(ist[k], soll[k], `${pfad}.${k}`, fehler);
}

for (const { aufruf, argumente, ergebnis } of erwartet.aufrufe) {
  test(`${aufruf}(${argumente.map((a) => JSON.stringify(a)).join(", ")})`, () => {
    const ist = JSON.parse(JSON.stringify(AUFRUFE[aufruf](...argumente)));
    const fehler = [];
    vergleichen(ist, ergebnis, aufruf, fehler);
    assert.deepEqual(fehler, []);
  });
}
