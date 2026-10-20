// Deutschland-Übersicht: rechnet die App wie deutschland.py? (Erwartung aus tests/paritaet.py)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { stationsTage, zusammenstellen } from "../src/lokal/deutschland.js";

const ORDNER = new URL("./paritaet/", import.meta.url);

test("recent.txt einer Station wie in Python", () => {
  const text = readFileSync(new URL("recent.txt", ORDNER), "latin1");
  const ist = zusammenstellen([{ id: 4711, name: "Prüfstadt", land: "Testland", hoehe: 100, daten: stationsTage(text) }]);
  delete ist.erstellt;
  const soll = JSON.parse(readFileSync(new URL("deutschland.json", ORDNER), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(ist)), soll);
});
