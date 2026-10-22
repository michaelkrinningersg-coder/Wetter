// Ortsliste: Suche, Name zu einem Punkt, passende Station mit Höhe
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ortSuchen, ortsname, vorbereiten } from "../src/lib/orte.js";
import { passendeStationen } from "../src/lib/standort.js";

const orte = vorbereiten(JSON.parse(readFileSync(new URL("../src/lib/orte.json", import.meta.url), "utf8")));

test("Ortsliste: Größe, Quelle, Gipfel", () => {
  assert.ok(orte.n.length > 80000);
  assert.match(orte.quelle, /GeoNames/);
  const brocken = ortSuchen(orte, "brocken").find((o) => o.gipfel);
  assert.equal(brocken.land, "Sachsen-Anhalt");
  assert.ok(brocken.hoehe > 1100);
});

test("Suche: genauer Name zuerst, größere Orte zuerst, mehrere Wörter", () => {
  const g = ortSuchen(orte, "Göttingen");
  assert.equal(g[0].name, "Göttingen");
  assert.equal(g[0].land, "Niedersachsen");
  assert.ok(g[0].einwohner > 100000);
  const t = ortSuchen(orte, "torfhaus");
  assert.ok(t.some((o) => o.land === "Niedersachsen" && o.hoehe > 700));
  assert.ok(ortSuchen(orte, "bad harz").every((o) => /bad/i.test(o.name) && /harz/i.test(o.name)));
  assert.deepEqual(ortSuchen(orte, "  "), []);
});

test("Ortsname: nächster Ort, sonst 'bei', Gipfel geht vor", () => {
  assert.equal(ortsname(orte, 51.534, 9.932).name, "Göttingen");
  assert.equal(ortsname(orte, 51.7991, 10.6157).name, "Brocken");
  const weit = ortsname(orte, 51.70, 10.40);
  assert.ok(weit.name.startsWith("bei ") || weit.km <= 2);
});

test("Passende Station: Höhe zählt, nur aktiv und 30 Jahre", () => {
  // [id, name, land, hoehe, von, bis, tage, lat, lon]
  const st = [
    [1, "Tal", "X", 230, 1950, "2026-10-20", 0, 51.80, 10.70], // 6 km, 900 m tiefer
    [2, "Berg", "X", 1134, 1947, "2026-10-20", 0, 51.80, 10.62], // 0,4 km
    [3, "Neu", "X", 1100, 2010, "2026-10-20", 0, 51.799, 10.616], // zu kurz
    [4, "Alt", "X", 1100, 1900, "1990-12-31", 0, 51.799, 10.616], // nicht mehr aktiv
    [5, "Mitte", "X", 700, 1960, "2026-10-20", 0, 51.85, 10.62], // 5,6 km, 430 m tiefer
  ];
  const r = passendeStationen(st, 51.7991, 10.6157, 1130, 3, 2026);
  assert.deepEqual(r.map((x) => x.zeile[0]), [2, 5, 1]);
  assert.equal(r[0].dh, 4);
  // ohne Höhe nur Entfernung
  assert.deepEqual(passendeStationen(st, 51.80, 10.70, null, 1, 2026).map((x) => x.zeile[0]), [1]);
});
