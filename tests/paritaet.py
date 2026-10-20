"""
Erwartungswerte für den Rechenkern der Android-App
==================================================

    python tests/paritaet.py

Die Android-App rechnet in JavaScript (web/src/lokal/), das Programm am PC
in DuckDB (daten.py). Beide sollen dieselben Zahlen liefern. Dieses Skript
baut eine künstliche Station - mit Lücken, Ausreißern, Max unter Min,
Sprüngen, gemischtem QN und allen DWD-Spalten -, lässt daten.py rechnen
und schreibt Rohdaten und Ergebnisse nach web/test/paritaet/. Der
Node-Test (web/test/paritaet.test.js) rechnet dieselben Aufrufe in JS
und vergleicht.

Läuft auch als pytest: dann prüft es nur, dass die abgelegten Dateien zu
daten.py passen, und meldet, wenn sie neu erzeugt werden müssen.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import random
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HIER))

import daten                                              # noqa: E402

ZIEL = os.path.join(os.path.dirname(HIER), "web", "test", "paritaet")
HEUTE = dt.date(2026, 10, 20)
SID = 4711

KOPF = ("STATIONS_ID;MESS_DATUM;QN_3;  FX;  FM;QN_4; RSK;RSKF; SDK;SHK_TAG;"
        "  NM; VPM;  PM; TMK; UPM; TXK; TNK; TGK;eor")


def _f(v, breite=7, stellen=1):
    return "-999".rjust(breite) if v is None else f"{v:{breite}.{stellen}f}"


def reihe():
    """Göttingen-ähnlich: Jahresgang, Trend, Wetter; dazu jede Art Fehler."""
    zufall = random.Random(1691)
    zeilen_hist, zeilen_recent = [], []
    d = dt.date(1985, 3, 1)
    ende = dt.date(2026, 10, 19)
    vortag = 8.0
    while d <= ende:
        # ganze Lücken: ein Sommer und einzelne Tage
        if dt.date(1997, 6, 3) <= d <= dt.date(1997, 8, 20) or zufall.random() < 0.01:
            d += dt.timedelta(days=1)
            continue
        k = d.timetuple().tm_yday
        jahresgang = 9 + 0.03 * (d.year - 1985) - 9 * math.cos(2 * math.pi * (k - 15) / 365.25)
        tmk = round(0.7 * vortag + 0.3 * jahresgang + zufall.gauss(0, 2.2), 1)
        vortag = tmk
        txk = round(tmk + 3 + abs(zufall.gauss(0, 2)), 1)
        tnk = round(tmk - 3 - abs(zufall.gauss(0, 2)), 1)
        werte = {
            "fx": round(abs(zufall.gauss(9, 4)), 1), "fm": round(abs(zufall.gauss(3, 1.5)), 1),
            "rsk": round(max(0.0, zufall.gauss(0, 4)), 1), "rskf": zufall.choice([0, 0, 6, 6, 7, 8, 4]),
            "sdk": round(min(16.0, abs(zufall.gauss(4, 3))), 1), "shk": float(zufall.choice([0, 0, 0, 2, 5])),
            "nm": round(zufall.uniform(0, 8), 1), "vpm": round(abs(zufall.gauss(10, 3)), 1),
            "pm": round(zufall.gauss(1000, 8), 1), "upm": round(zufall.uniform(40, 100), 1),
            "tgk": round(tnk - abs(zufall.gauss(1, 1)), 1),
        }
        qn = 5 if d.year < 2000 else (10 if d.year < 2016 else 9)
        qn3 = qn
        # Fehler aller Art
        r = zufall.random()
        if r < 0.004:
            txk, tnk = tnk, txk                       # Max unter Min
        elif r < 0.008:
            tmk = round(txk + 1.5, 1)                 # Mittel über Max
        elif r < 0.010:
            txk = 61.0                                # außerhalb der Grenze
        elif r < 0.012:
            werte["fx"] = 80.0                        # Böe 288 km/h
        elif r < 0.014:
            werte["fm"] = werte["fx"] + 2             # Mittel über Spitze
        elif r < 0.016:
            werte["upm"] = 104.0
        elif r < 0.018:
            werte["rskf"] = 5                         # kein DWD-Code
        elif r < 0.020:
            tmk = round(tmk - 18, 1); txk = round(txk - 18, 1); tnk = round(tnk - 18, 1)
        if zufall.random() < 0.02:
            tmk = None
        if zufall.random() < 0.02:
            werte["sdk"] = None
        if zufall.random() < 0.05:
            qn = 1
        if zufall.random() < 0.05:
            qn3 = 3
        zeile = (f"{SID:11d};{d:%Y%m%d};{qn3:5d};{_f(werte['fx'], 6)};{_f(werte['fm'], 6)};{qn:5d};"
                 f"{_f(werte['rsk'], 6)};{werte['rskf']:4d};{_f(werte['sdk'], 9, 3)};"
                 f"{_f(werte['shk'], 4, 0)};{_f(werte['nm'], 6)};{_f(werte['vpm'], 6)};"
                 f"{_f(werte['pm'], 8, 2)};{_f(tmk)};{_f(werte['upm'], 8, 2)};"
                 f"{_f(txk)};{_f(tnk)};{_f(werte['tgk'])};eor")
        if d <= dt.date(2025, 12, 31):
            zeilen_hist.append(zeile)
        if d >= dt.date(2025, 4, 18):
            zeilen_recent.append(zeile)
        d += dt.timedelta(days=1)

    def text(z):
        return ("\r\n".join([KOPF] + z) + "\r\n").encode("latin-1")
    return text(zeilen_hist), text(zeilen_recent)


AUFRUFE = (
    [("bilanz", [s]) for s in ("alle", "ab5", "nur10")]
    + [("jahre", ["alle"])]
    + [("jahresband", [j, s]) for j in (None, 2025, 1997, 1990) for s in ("alle", "nur10")]
    + [("monat", [j, m, s]) for j, m in ((None, None), (2026, 2), (1997, 7), (2000, 2), (2024, 12))
       for s in ("alle", "ab5")]
    + [("rangliste", [m, p, s]) for m in ("heute", "jahr") for p in (True, False)
       for s in ("alle", "nur10")]
    + [("zeitreihe", [g, a, "alle"]) for g in ("m", "x", "n") for a in ("jahr", "monat", "tag")]
    + [("zeitreihe", ["m", "jahr", "nur10"])]
    + [("zeitraum", [])]
)


def rechnen(hist: bytes, recent: bytes) -> list:
    alt = daten.heute
    daten.heute = lambda: HEUTE
    try:
        with tempfile.TemporaryDirectory() as ordner:
            db = daten.Daten(os.path.join(ordner, "p.duckdb"))
            db.einlesen(SID, hist, recent, "hist.zip")
            ergebnis = []
            for name, argumente in AUFRUFE:
                wert = getattr(db, name)(SID, *argumente)
                ergebnis.append({"aufruf": name, "argumente": argumente,
                                 "ergebnis": json.loads(json.dumps(wert, default=str))})
            db.schliessen()
            return ergebnis
    finally:
        daten.heute = alt


def schreiben():
    hist, recent = reihe()
    os.makedirs(ZIEL, exist_ok=True)
    with open(os.path.join(ZIEL, "hist.txt"), "wb") as datei:
        datei.write(hist)
    with open(os.path.join(ZIEL, "recent.txt"), "wb") as datei:
        datei.write(recent)
    with open(os.path.join(ZIEL, "erwartet.json"), "w", encoding="utf-8") as datei:
        json.dump({"heute": HEUTE.isoformat(), "station": SID,
                   "aufrufe": rechnen(hist, recent)}, datei, ensure_ascii=False)
    print(f"{len(AUFRUFE)} Aufrufe nach {ZIEL}")


def test_erwartungswerte_aktuell():
    """Rechnet daten.py heute noch, was die JS-Seite als Erwartung liest?"""
    with open(os.path.join(ZIEL, "hist.txt"), "rb") as datei:
        hist = datei.read()
    with open(os.path.join(ZIEL, "recent.txt"), "rb") as datei:
        recent = datei.read()
    with open(os.path.join(ZIEL, "erwartet.json"), encoding="utf-8") as datei:
        erwartet = json.load(datei)["aufrufe"]
    assert rechnen(hist, recent) == erwartet, \
        "daten.py rechnet anders - python tests/paritaet.py neu laufen lassen"


if __name__ == "__main__":
    schreiben()
