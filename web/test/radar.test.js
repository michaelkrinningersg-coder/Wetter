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

test("Filmlänge: Zeitpunkte wie vorhersage.radar_zeiten", async () => {
  const { radarZeiten } = await import("../src/lib/raster.js");
  const jetzt = Date.parse("2026-10-21T03:47:00Z");
  const z6 = radarZeiten(jetzt, 6);
  assert.equal(z6.einzeln.length, 24);
  assert.deepEqual([z6.einzeln[0], z6.einzeln[1], z6.einzeln.at(-1), z6.von, z6.bis], ["2026-10-20T21:45Z", "2026-10-20T22:00Z", "2026-10-21T03:30Z", "2026-10-21T03:45Z", "2026-10-21T05:45Z"]);
  const z1 = radarZeiten(jetzt, 1);
  assert.deepEqual(z1, { einzeln: [], von: "2026-10-21T02:45Z", bis: "2026-10-21T05:45Z" });
  assert.equal(radarZeiten(jetzt, 3).einzeln[0], "2026-10-21T00:40Z");
});

test("Kartenansicht: Zoom um einen Punkt hält ihn fest, Grenzen", async () => {
  const { zoomUm, unterPunkt, ganzDeutschland, ansichtKlemmen, ZOOM_MIN } = await import("../src/lib/raster.js");
  const a = { x: 500, y: 600, km: 100 };
  const vor = unterPunkt(a, 120, 80, 400, 300);
  const b = zoomUm(a, 2.5, 120, 80, 400, 300);
  assert.equal(b.km, 40);
  const nach = unterPunkt(b, 120, 80, 400, 300);
  assert.ok(Math.abs(vor[0] - nach[0]) < 1e-9 && Math.abs(vor[1] - nach[1]) < 1e-9);
  assert.equal(zoomUm(a, 1000, 0, 0, 400, 300).km, ZOOM_MIN);
  const d = ganzDeutschland(360, 500);
  assert.ok(Math.abs(d.km - 1100) < 1e-9);
  assert.deepEqual(ansichtKlemmen({ x: -5, y: 5000, km: 50 }), { x: 0, y: 1200, km: 50 });
});
