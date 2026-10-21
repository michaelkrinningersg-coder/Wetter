// Antworten von CapacitorHttp: schon gelesenes JSON, Base64, Fehlertext.
import assert from "node:assert/strict";
import test from "node:test";

import { bytesAus, jsonAus } from "../src/lokal/antwort.js";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

test("application/json kommt als Objekt und bleibt eins", () => {
  const o = { hourly: { time: ["2026-10-21T00:00"] } };
  assert.equal(jsonAus(o), o);
  assert.deepEqual(jsonAus([1, 2]), [1, 2]);
});

test("andere Content-Types kommen als Base64", () => {
  assert.deepEqual(jsonAus(b64('{"stand":"2026-10-20","name":"Göttingen"}')), { stand: "2026-10-20", name: "Göttingen" });
  assert.deepEqual([...bytesAus(b64("PK\u0003\u0004"))], [80, 75, 3, 4]);
});

test("Fehlertext als JSON, leere Antwort mit klarer Meldung", () => {
  assert.deepEqual(jsonAus('{"error":true,"reason":"x"}'), { error: true, reason: "x" });
  assert.throws(() => jsonAus(null), /leere Antwort/);
});
