import assert from "node:assert/strict";
import test from "node:test";
import { abschnitt, tageszeiten } from "../src/lib/tageszeiten.js";

const st = (h, symbol, regen = 0, wkt = null, temp = 10) => ({ h, symbol, regen, wkt, temp, wind: 10, boe: 20 + h });

test("Tageszeiten: Grenzen, angebrochener Tag", () => {
  const tag = Array.from({ length: 24 }, (_, h) => st(h, "bedeckt"));
  assert.deepEqual(tageszeiten(tag).map((t) => [t.k, t.stunden.length]), [["nacht", 6], ["morgen", 3], ["vormittag", 3], ["mittag", 3], ["nachmittag", 3], ["abend", 3], ["spaet", 3]]);
  const rest = tageszeiten(tag.slice(10));
  assert.deepEqual(rest.map((t) => !!t.leer), [true, true, false, false, false, false, false]);
  assert.equal(rest[2].ab, 10);
});

test("trocken: häufigstes Symbol, bei Gleichstand das trübere", () => {
  assert.equal(abschnitt([st(9, "klar"), st(10, "klar"), st(11, "wolkig")]).symbol, "klar");
  const a = abschnitt([st(14, "heiter"), st(15, "bedeckt"), st(16, "heiter"), st(17, "bedeckt")]);
  assert.equal(a.symbol, "bedeckt");
  assert.equal(a.art, "trocken");
});

test("Regen kommt immer ins Symbol: anhaltend, zeitweise, möglich", () => {
  const anh = abschnitt([st(6, "regen", 0.8, 90), st(7, "niesel", 0.2, 70), st(8, "bedeckt", 0, 40)]);
  assert.equal(anh.symbol, "regen");
  assert.equal(anh.art, "anhaltend");
  assert.ok(Math.abs(anh.regen - 1.0) < 1e-9);
  assert.equal(anh.wkt, 90);
  const zeit = abschnitt([st(14, "wolkig"), st(15, "schauer", 0.3), st(16, "heiter"), st(17, "wolkig")]);
  assert.equal(zeit.symbol, "schauer");
  assert.equal(zeit.art, "zeitweise");
  const moegl = abschnitt([st(9, "bedeckt", 0, 20), st(10, "bedeckt", 0, 55)]);
  assert.equal(moegl.symbol, "schauer");
  assert.equal(moegl.art, "möglich");
  // Regenmenge ohne Regensymbol zählt auch
  assert.equal(abschnitt([st(12, "bedeckt", 0.4), st(13, "bedeckt", 0.2)]).symbol, "regen");
});

test("Gewitter, Schnee und Niesel", () => {
  assert.equal(abschnitt([st(18, "regen", 2), st(19, "gewitter", 5), st(20, "wolkig")]).symbol, "gewitter");
  assert.equal(abschnitt([st(0, "schnee", 0.5), st(1, "schnee", 0.4), st(2, "bedeckt")]).symbol, "schnee");
  assert.equal(abschnitt([st(0, "schneeschauer", 0.5), st(1, "bedeckt"), st(2, "bedeckt")]).symbol, "schneeschauer");
  assert.equal(abschnitt([st(0, "niesel", 0.1), st(1, "niesel", 0.1)]).symbol, "niesel");
  const a = abschnitt([st(0, "klar"), st(1, "klar")]);
  assert.equal(a.wkt, null);
  assert.equal(a.boe, 21);
});
