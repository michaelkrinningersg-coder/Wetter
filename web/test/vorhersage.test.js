// Liest die App die Antworten der Wetterdienste so wie vorhersage.py?
// tests/paritaet.py hat die abgelegten Antworten in Python umgewandelt.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { MODELLE, aufteilen, brightSky, metNorway, openMeteo, symbolBrightsky, symbolMetno, symbolWmo } from "../src/lokal/vorhersage.js";

const ORDNER = new URL("./vorhersage/", import.meta.url);
const erwartet = JSON.parse(readFileSync(new URL("erwartet.json", ORDNER), "utf8"));
const glatt = (x) => JSON.parse(JSON.stringify(x));

for (const name of readdirSync(ORDNER).filter((n) => n.endsWith(".json") && n !== "erwartet.json")) {
  test(name, () => {
    const antwort = JSON.parse(readFileSync(new URL(name, ORDNER), "utf8"));
    const mehr = () => Object.fromEntries(MODELLE.filter((m) => m[3] === "open-meteo").map((m) => [m[4], openMeteo(aufteilen(antwort, m[4]))]));
    const ist = name.startsWith("om_") ? openMeteo(antwort) : name.startsWith("mehr_") ? mehr() : name.startsWith("metno") ? metNorway(antwort) : brightSky(antwort);
    assert.deepEqual(glatt(ist), erwartet[name]);
  });
}

test("Symbole: WMO, MET Norway, Bright Sky", () => {
  for (const [c, s] of Object.entries(erwartet.symbole_wmo)) assert.equal(symbolWmo(Number(c)), s, `WMO ${c}`);
  for (const [c, s] of Object.entries(erwartet.symbole_metno)) assert.deepEqual(symbolMetno(c), s, c);
  for (const [c, s] of Object.entries(erwartet.symbole_brightsky)) assert.deepEqual(symbolBrightsky(c), s, c);
});
