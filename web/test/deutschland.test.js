// Deutschland-Übersicht: Top-Liste, Gleichstand, Höhenfilter, Einheiten.
import assert from "node:assert/strict";
import test from "node:test";

import { anzahl, top } from "../src/lib/deutschland.js";

const DATEN = {
  stand: "2026-10-19",
  tage: ["2026-10-18", "2026-10-19"],
  stationen: [
    [1, "Aachen", "NRW", 202],
    [2, "Zugspitze", "Bayern", 2964],
    [3, "Brocken", "Sachsen-Anhalt", 1134],
    [4, "Berlin", "Berlin", 48],
  ],
  werte: {
    txk: [[14.0, 15.2], [-1.0, -2.5], [6.0, 8.1], [13.0, 15.2]],
    fx: [[10, 12.5], [30, 40], [20, 25], [8, null]],
  },
};

test("höchste und tiefste, gleicher Wert gleicher Platz", () => {
  const h = top(DATEN, "2026-10-19", "txk", "hoch");
  assert.deepEqual(h.map((z) => [z.platz, z.name, z.wert]), [[1, "Aachen", 15.2], [1, "Berlin", 15.2], [3, "Brocken", 8.1], [4, "Zugspitze", -2.5]]);
  assert.equal(top(DATEN, "2026-10-19", "txk", "tief")[0].name, "Zugspitze");
  assert.equal(top(DATEN, "2026-10-19", "txk", "hoch", "alle", 2).length, 2);
});

test("Höhenfilter unter/ab", () => {
  assert.deepEqual(top(DATEN, "2026-10-19", "txk", "hoch", "a1000").map((z) => z.name), ["Brocken", "Zugspitze"]);
  assert.deepEqual(top(DATEN, "2026-10-19", "txk", "hoch", "u500").map((z) => z.name), ["Aachen", "Berlin"]);
  assert.deepEqual(top(DATEN, "2026-10-19", "txk", "hoch", "a2000").map((z) => z.name), ["Zugspitze"]);
  assert.equal(anzahl(DATEN, "2026-10-19", "fx", "u1500"), 2);
});

test("Wind in km/h, fehlende Werte fallen weg, unbekannter Tag leer", () => {
  assert.deepEqual(top(DATEN, "2026-10-19", "fx").map((z) => [z.name, z.wert]), [["Zugspitze", 144], ["Brocken", 90], ["Aachen", 45]]);
  assert.deepEqual(top(DATEN, "2026-01-01", "txk"), []);
});
