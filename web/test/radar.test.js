// Radarraster: dieselbe Lage wie bei Bright Sky, Ausschnitte im Raster.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ausschnitt, farbe, mmProStunde, raster } from "../src/lib/raster.js";
import { entpacken } from "../src/lib/radardaten.js";

test("Göttingen liegt, wo Bright Sky es sagt", () => {
  // Bright Sky: bbox [492, 490, 592, 590], latlon_position x 49,563 / y 49,829
  const [x, y] = raster(9.95, 51.5);
  assert.ok(Math.abs(x - 539.563) < 0.002, String(x));
  assert.ok(Math.abs(y - 541.829) < 0.002, String(y));
});

test("Ausschnitte bleiben im Raster", () => {
  assert.deepEqual(ausschnitt([539.6, 541.8], 100), [492, 490, 592, 590]);
  assert.deepEqual(ausschnitt([10, 1190], 250), [949, 0, 1199, 250]);
  assert.deepEqual(ausschnitt([500, 500], null), [0, 0, 1199, 1099]);
});

test("Farben: unter 0,1 mm/h nichts, Starkregen rot", () => {
  assert.equal(farbe(mmProStunde(0)), null);
  assert.equal(farbe(0.05), null);
  assert.deepEqual(farbe(25), [225, 35, 30]);
  assert.equal(mmProStunde(10), 1.2);
});

test("Komprimierte Bilder von Bright Sky lesen", () => {
  const antwort = JSON.parse(readFileSync(new URL("./radar/goettingen.json", import.meta.url), "utf8"));
  const r = entpacken(antwort, [492, 490, 592, 590]);
  assert.equal(r.bilder.length, antwort.radar.length);
  assert.equal(r.zeilen, 101);
  assert.equal(r.spalten, 101);
  assert.equal(r.bilder[0].werte.length, 101 * 101);
  assert.deepEqual(r.bbox, [492, 490, 592, 590]);
  assert.ok(r.bilder.every((b) => b.werte.every((v) => v >= 0 && v < 20000)));
});
