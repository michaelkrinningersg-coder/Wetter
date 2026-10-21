import assert from "node:assert/strict";
import test from "node:test";
import { tageswerte } from "../src/lib/tageswerte.js";

// 21.10.2026: Sommerzeit, 0 Uhr Ortszeit = 22 Uhr UTC am Vortag
const reihe = (n, f) => Array.from({ length: n }, (_, i) => f(i, new Date(Date.parse("2026-10-20T22:00:00Z") + i * 3600000).toISOString().replace(".000Z", "Z")));

test("Tageswerte: ganzer Ortstag, Spitzen mit Uhrzeit, Arten", () => {
  const z = reihe(26, (i, t) => [t, i === 15 ? 14 : i === 5 ? 2 : 8, 100, i === 3 ? 1.2 : i === 20 ? 0.5 : 0, i === 10 ? 30 : 10, i === 11 ? 55 : null, i === 3 ? "schnee" : i === 20 ? "regen" : "bedeckt", null]);
  const w = tageswerte(z);
  assert.deepEqual([...w.keys()], ["2026-10-21", "2026-10-22"]);
  const t = w.get("2026-10-21");
  assert.equal(t.von, 0);
  assert.equal(t.bis, 23);
  assert.equal(t.luecken, false);
  assert.deepEqual(t.max, { wert: 14, h: 15 });
  assert.deepEqual(t.min, { wert: 2, h: 5 });
  assert.ok(Math.abs(t.mittel - (8 * 22 + 14 + 2) / 24) < 1e-9);
  assert.ok(Math.abs(t.regen - 1.7) < 1e-9);
  assert.deepEqual(t.arten, ["Regen", "Schnee"]);
  assert.deepEqual(t.wind, { wert: 30, h: 10 });
  assert.deepEqual(t.boe, { wert: 55, h: 11 });
  // angebrochener Folgetag: nur 0 und 1 Uhr
  const f = w.get("2026-10-22");
  assert.equal(f.von, 0);
  assert.equal(f.bis, 1);
  assert.equal(f.boe, null);
});

test("Tageswerte: gleicher Höchstwert zählt die erste Stunde, Lücken erkannt", () => {
  const z = [
    ["2026-10-21T04:00:00Z", 5, 0, 0, 5, 9, "klar", true],
    ["2026-10-21T05:00:00Z", 9, 0, 0, 5, 9, "klar", true],
    ["2026-10-21T12:00:00Z", 9, 0, null, 5, 9, "wolkig", true],
    ["2026-10-21T13:00:00Z", null, 0, 3, 5, 9, "regen", true],
  ];
  const t = tageswerte(z).get("2026-10-21");
  assert.deepEqual(t.max, { wert: 9, h: 7 });
  assert.deepEqual(t.boe, { wert: 9, h: 6 });
  assert.equal(t.luecken, true);
  assert.equal(t.regen, 0);
  assert.deepEqual(t.arten, []);
  assert.equal(t.von, 6);
  assert.equal(t.bis, 14);
});
