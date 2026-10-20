// Nächste Station und Entfernung
import assert from "node:assert/strict";
import test from "node:test";

import { entfernung, naechsteStation } from "../src/lib/standort.js";

const STATIONEN = [
  [1691, "Göttingen", "Niedersachsen", 167, 1857, "2026-10-19", 0, 51.5002, 9.9507],
  [2014, "Hannover", "Niedersachsen", 55, 1936, "2026-10-19", 0, 52.4644, 9.6779],
  [9999, "Alt bei Göttingen", "Niedersachsen", 150, 1900, "1990-12-31", 0, 51.53, 9.93],
  [8888, "ohne Lage", "x", 0, 1900, "2026-10-19", 0, null, null],
];

test("Entfernung Göttingen-Hannover rund 109 km", () => {
  const km = entfernung(51.5002, 9.9507, 52.4644, 9.6779);
  assert.ok(Math.abs(km - 108.8) < 1, String(km));
});

test("nächste aktive Station, geschlossene nur auf Wunsch", () => {
  const [z, km] = naechsteStation(STATIONEN, 51.533, 9.935, true, 2026);
  assert.equal(z[0], 1691);
  assert.ok(km < 5);
  assert.equal(naechsteStation(STATIONEN, 51.533, 9.935, false, 2026)[0][0], 9999);
  assert.equal(naechsteStation([], 51, 9), null);
});
