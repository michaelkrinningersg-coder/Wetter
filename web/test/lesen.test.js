import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { zipSync } from "fflate";

import { produktAusZip, produktLesen, stationenLesen, verzeichnisLesen, zusammenfuehren } from "../src/lokal/lesen.js";

test("Stationsliste: Latin-1, Namen mit einem Leerzeichen, Land mit Bindestrich", () => {
  const text =
    "Stations_id von_datum bis_datum Stationshoehe geoBreite geoLaenge Stationsname Bundesland Abgabe\r\n" +
    "----------- --------- --------- ------------- --------- --------- ------\r\n" +
    "01691 18580101 20261019            167     51.5002    9.9507 Göttingen                                Niedersachsen                            Frei\r\n" +
    "00544 19470101 20261019            157     51.7181    8.7466 Bad Lippspringe                          Nordrhein-Westfalen                      Frei\r\n";
  const s = stationenLesen(text);
  assert.deepEqual(s.map((x) => [x.id, x.name, x.land, x.hoehe]), [
    [1691, "Göttingen", "Niedersachsen", 167],
    [544, "Bad Lippspringe", "Nordrhein-Westfalen", 157],
  ]);
});

test("Verzeichnis der hist-Archive", () => {
  assert.deepEqual(verzeichnisLesen('<a href="tageswerte_KL_01691_18580101_20251231_hist.zip">'), {
    1691: "tageswerte_KL_01691_18580101_20251231_hist.zip",
  });
});

test("produkt aus dem Zip, -999 fehlt, historisch gewinnt", () => {
  const kopf = "STATIONS_ID;MESS_DATUM;QN_3;  FX;  FM;QN_4; RSK;RSKF; SDK;SHK_TAG;  NM; VPM;  PM; TMK; UPM; TXK; TNK; TGK;eor";
  const z = (d, tmk) => `1;${d};10;5.0;2.0;10;0.0;0;-999;0;4.0;9.0;1000.0;${tmk};80.0;9.0;1.0;0.5;eor`;
  const hist = kopf + "\r\n" + [z("20251230", "1.0"), z("20251231", "-999")].join("\r\n") + "\r\n";
  const recent = kopf + "\r\n" + [z("20251231", "7.0"), z("20260101", "3.0")].join("\r\n");
  const zip = zipSync({ "Metadaten.txt": new Uint8Array([1]), "produkt_klima_tag_x.txt": new TextEncoder().encode(hist) });
  const r = zusammenfuehren(produktLesen(produktAusZip(zip)), produktLesen(recent));
  assert.equal(r.tag.length, 3);
  assert.ok(Number.isNaN(r.roh.tmk[1]), "-999 fehlt, und recent ersetzt hist nicht");
  assert.equal(r.roh.tmk[2], 3);
  assert.deepEqual([...r.quelle], [0, 0, 1]);
  assert.ok(Number.isNaN(r.roh.sdk[0]));
});
