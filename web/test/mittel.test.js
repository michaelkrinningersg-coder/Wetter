import assert from "node:assert/strict";
import test from "node:test";
import { mehrheit, mittel } from "../src/lib/mittel.js";

const z = (zeit, temp, regen, symbol, wkt = null, boe = 20) => [zeit, temp, 50, regen, 10, boe, symbol, true, wkt];

test("Mittel: feine Modelle doppelt, Spannweite, fehlende Werte", () => {
  const m = mittel([
    { id: "icon_d2", name: "ICON-D2", stunden: [z("2026-10-22T10:00:00Z", 10, 1, "regen", 80), z("2026-10-22T11:00:00Z", 12, 0, "wolkig", 20)] },
    { id: "gfs", name: "GFS", stunden: [z("2026-10-22T10:00:00Z", 7, 0, "bedeckt", null, null), z("2026-10-22T12:00:00Z", 9, 0.4, "regen")] },
    { id: "swiss1", name: "Swiss HD 1 km", fehler: "außerhalb" },
  ]);
  assert.equal(m.id, "mittel");
  assert.equal(m.anzahl, 2);
  const [a, b, c] = m.stunden;
  assert.equal(a[0], "2026-10-22T10:00:00Z");
  assert.equal(a[1], 9); // (10*2 + 7) / 3
  assert.equal(a[3], 0.7); // (1*2 + 0) / 3 = 0,67
  assert.equal(a[5], 20); // GFS ohne Böe: nur ICON-D2
  assert.equal(a[8], 80);
  assert.equal(a[6], "regen"); // 2 von 3 Gewichten nass
  assert.deepEqual(a[9], { n: 2, tmin: 7, tmax: 10, rmin: 0, rmax: 1 });
  assert.equal(b[1], 12);
  assert.equal(b[9].n, 1);
  assert.equal(c[6], "regen");
});

test("Mehrheit: Niederschlag ab der Hälfte, sonst das häufigste trockene", () => {
  assert.equal(mehrheit({ regen: 1, bedeckt: 1 }), "regen");
  assert.equal(mehrheit({ regen: 1, bedeckt: 2 }), "bedeckt");
  assert.equal(mehrheit({ regen: 1, gewitter: 1, wolkig: 2 }), "gewitter");
  assert.equal(mehrheit({ heiter: 1, wolkig: 1 }), "wolkig");
  assert.equal(mehrheit({}), null);
});

test("MET Norway im 6-Stunden-Takt fällt weg", () => {
  const m = mittel([{ id: "metno", name: "MET Norway", stunden: [z("2026-10-22T10:00:00Z", 5, 0, "klar"), z("2026-10-22T11:00:00Z", 6, 0, "klar"), z("2026-10-22T12:00:00Z", 7, 3, "regen"), z("2026-10-22T18:00:00Z", 8, 2, "regen")] }]);
  assert.deepEqual(m.stunden.map((s) => s[0]), ["2026-10-22T10:00:00Z", "2026-10-22T11:00:00Z"]);
});
