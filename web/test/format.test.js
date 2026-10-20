import assert from "node:assert/strict";
import test from "node:test";

import { abweichungsfarbe, de, mitVorzeichen, schritte, suchen, tagText, tausend } from "../src/lib/format.js";

test("Zahlen mit Komma, ohne negative Null", () => {
  assert.equal(de(8.35, 2), "8,35");
  assert.equal(de(-0.2), "−0,2");
  assert.equal(de(-0.04), "0,0");
  assert.equal(de(null), "–");
  assert.equal(tausend(59982), "59.982");
});

test("Abweichungen tragen immer ein Zeichen", () => {
  assert.equal(mitVorzeichen(1.26), "+1,3");
  assert.equal(mitVorzeichen(-1.7), "−1,7");
  assert.equal(mitVorzeichen(-0.04), "±0,0");
});

test("Kalendertag wie in daten.py: der 1. März ist immer 60", () => {
  assert.equal(tagText(0), "01.01.");
  assert.equal(tagText(59), "29.02.");
  assert.equal(tagText(60), "01.03.");
  assert.equal(tagText(292), "19.10.");
  assert.equal(tagText(365), "31.12.");
});

test("Farbe: Null ist weiß, große Abweichungen satt", () => {
  assert.equal(abweichungsfarbe(0), "rgb(247,247,247)");
  assert.equal(abweichungsfarbe(9), "rgb(103,0,13)");
  assert.equal(abweichungsfarbe(-9), "rgb(8,48,107)");
});

test("Achsenschritte sind rund", () => {
  assert.deepEqual(schritte(-13, 38), [-10, 0, 10, 20, 30]);
  assert.deepEqual(schritte(6.2, 11.1, 5), [7, 8, 9, 10, 11]);
});

test("Suche: Nummer, Wortanfang, dann Teilwort", () => {
  const liste = [
    [1691, "Göttingen", "Niedersachsen"],
    [5555, "Bad Göttingen", "Hessen"],
    [1, "Aach", "Baden-Württemberg"],
    [3, "Aachen", "Nordrhein-Westfalen"],
  ];
  assert.deepEqual(suchen(liste, "1691").map((s) => s[0]), [1691]);
  assert.deepEqual(suchen(liste, "gött").map((s) => s[0]), [1691, 5555]);
  assert.deepEqual(suchen(liste, "aach").map((s) => s[0]), [1, 3]);
  assert.deepEqual(suchen(liste, "nieder").map((s) => s[0]), [1691]);
});
