// Heute und morgen: feinstes Modell zuerst, Lücken aus dem nächsten.
import assert from "node:assert/strict";
import test from "node:test";

import { heuteMorgen, ortsTag } from "../src/lib/kurzfrist.js";

// Stundenzeile wie aus vorhersage.py: [iso, temp, wolken, regen, wind, böe, symbol, tag]
const reihe = (ab, n, temp) => Array.from({ length: n }, (_, i) => [new Date(Date.parse(ab) + i * 3600e3).toISOString().replace(".000Z", "Z"), temp + i * 0.1, 50, 0.2, 10, 20, "wolkig", null]);

test("ICON-D2 vor ICON-EU, Rest aus ICON-EU, Tage in deutscher Zeit", () => {
  const jetzt = Date.parse("2026-10-20T18:30:00Z"); // 20:30 in Berlin
  const modelle = [
    { id: "icon_eu", name: "ICON-EU", stunden: reihe("2026-10-20T00:00:00Z", 72, 5) },
    { id: "icon_d2", name: "ICON-D2", stunden: reihe("2026-10-20T00:00:00Z", 40, 8) }, // bis 21.10. 15 Uhr UTC
    { id: "swiss1", name: "Swiss HD 1 km", fehler: "Ort liegt außerhalb des Modellgebiets" },
  ];
  const r = heuteMorgen(modelle, jetzt);
  assert.equal(r.modell, "ICON-D2");
  const [h, m] = r.tage;
  assert.equal(h.titel, "Heute");
  assert.equal(h.tag, "2026-10-20");
  // ab der laufenden Stunde (20 Uhr) bis 23 Uhr Ortszeit
  assert.deepEqual(h.stunden.map((s) => s.h), [20, 21, 22, 23]);
  assert.equal(m.tag, "2026-10-21");
  assert.equal(m.stunden.length, 24);
  assert.equal(m.stunden[0].h, 0);
  // ICON-D2 reicht bis 21.10. 15 UTC = 17 Uhr Ortszeit, danach ICON-EU
  assert.equal(m.stunden.find((s) => s.h === 17).ersatz, null);
  assert.equal(m.stunden.find((s) => s.h === 18).ersatz, "ICON-EU");
  assert.equal(m.min, Math.min(...m.stunden.map((s) => s.temp)));
});

test("Swiss HD 1 km geht vor, wenn der Ort im Gebiet liegt", () => {
  const jetzt = Date.parse("2026-10-20T08:00:00Z");
  const r = heuteMorgen([
    { id: "icon_d2", name: "ICON-D2", stunden: reihe("2026-10-20T00:00:00Z", 48, 8) },
    { id: "swiss1", name: "Swiss HD 1 km", stunden: reihe("2026-10-20T00:00:00Z", 33, 3) },
  ], jetzt);
  assert.equal(r.modell, "Swiss HD 1 km");
  assert.equal(r.tage[0].stunden[0].temp, 3 + 7 * 0.1);
});

test("Kein Modell, kein Ergebnis; Mitternacht und Sommerzeit", () => {
  assert.equal(heuteMorgen([{ id: "icon_d2", fehler: "x" }]), null);
  assert.equal(ortsTag(Date.parse("2026-10-20T22:30:00Z")), "2026-10-21");
  assert.equal(ortsTag(Date.parse("2026-01-20T22:30:00Z")), "2026-01-20");
});
