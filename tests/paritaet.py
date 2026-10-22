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
    + [("auswertung", [a, st, o]) for a, o in (
        ("rekorde", {}), ("geschichte", {}), ("geschichte", {"datum": "2003-08-08"}),
        ("geschichte", {"datum": "2024-02-29"}), ("kenntage", {}),
        ("wellen", {}), ("wellen", {"art": "fest"}),
        ("wellen", {"art": "eigen", "heiss": 25, "kalt": -2, "min_tage": 2}),
        ("streifen", {}), ("niederschlag", {}), ("niederschlag", {"jahr": 2010}),
        ("sonne", {}), ("sonne", {"jahr": 1997}), ("schnee", {}), ("wind", {}),
        ("frost", {}), ("prognose_verlauf", {}))
       for st in ("alle", "nur10")]
    # anderer Vergleichszeitraum (Reihe beginnt 1985: 1981 fast, 1961 kaum gedeckt)
    + [("jahresband", [j, "alle", n]) for j in (None, 1990) for n in (1981, 1961)]
    + [("monat", [j, m, "alle", n]) for j, m in ((None, None), (1997, 7)) for n in (1981, 1971)]
    + [("rangliste", [m, True, "alle", n]) for m in ("heute", "jahr") for n in (1981, 1961)]
    + [("auswertung", [a, "alle", o, n]) for a, o in (
        ("geschichte", {}), ("kenntage", {}), ("wellen", {}), ("streifen", {}),
        ("niederschlag", {}), ("sonne", {"jahr": 1997}), ("schnee", {}), ("wind", {}),
        ("frost", {})) for n in (1981, 1961)]
    + [("auswertung", ["streifen", "alle", {}, 1955])]  # ungültig -> 1991
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
    with open(os.path.join(ZIEL, "deutschland.json"), "w", encoding="utf-8") as datei:
        json.dump(deutschland_rechnen(recent), datei, ensure_ascii=False)


def test_erwartungswerte_aktuell():
    """Rechnet daten.py heute noch, was die JS-Seite als Erwartung liest?"""
    with open(os.path.join(ZIEL, "hist.txt"), "rb") as datei:
        hist = datei.read()
    with open(os.path.join(ZIEL, "recent.txt"), "rb") as datei:
        recent = datei.read()
    with open(os.path.join(ZIEL, "erwartet.json"), encoding="utf-8") as datei:
        erwartet = json.load(datei)["aufrufe"]
    fehler = []
    _gleich(rechnen(hist, recent), erwartet, "", fehler)
    assert not fehler, \
        "daten.py rechnet anders - python tests/paritaet.py neu laufen lassen:\n" + "\n".join(fehler[:10])


def _gleich(ist, soll, pfad, fehler):
    """Gleich bis auf eine Einheit der letzten Stelle bei gerundeten Werten:
    DuckDB summiert parallel, ein Mittel genau auf ,x5 kippt dann mal so,
    mal so - dieselbe Toleranz wie web/test/paritaet.test.js."""
    if isinstance(soll, float) or isinstance(ist, float):
        if not (isinstance(ist, (int, float)) and isinstance(soll, (int, float))
                and abs(ist - soll) <= 0.0100001):
            fehler.append(f"{pfad}: {ist!r} statt {soll!r}")
    elif isinstance(soll, dict) and isinstance(ist, dict):
        if ist.keys() != soll.keys():
            fehler.append(f"{pfad}: Schlüssel {sorted(ist)} statt {sorted(soll)}")
        for k in soll:
            if k in ist:
                _gleich(ist[k], soll[k], f"{pfad}.{k}", fehler)
    elif isinstance(soll, list) and isinstance(ist, list):
        if len(ist) != len(soll):
            fehler.append(f"{pfad}: Länge {len(ist)} statt {len(soll)}")
        for i, (a, b) in enumerate(zip(ist, soll)):
            _gleich(a, b, f"{pfad}[{i}]", fehler)
    elif ist != soll:
        fehler.append(f"{pfad}: {ist!r} statt {soll!r}")




# --------------------------------------------- Deutschland-Übersicht
def deutschland_rechnen(recent: bytes) -> dict:
    """recent.txt als eine Station 4711 durch deutschland.aus_texten."""
    import deutschland
    d = deutschland.aus_texten({SID: recent}, {SID: {"name": "Prüfstadt", "land": "Testland", "hoehe": 100}})
    d.pop("erstellt")
    return d


def test_deutschland_erwartung_aktuell():
    with open(os.path.join(ZIEL, "recent.txt"), "rb") as datei:
        recent = datei.read()
    with open(os.path.join(ZIEL, "deutschland.json"), encoding="utf-8") as datei:
        assert deutschland_rechnen(recent) == json.load(datei), \
            "deutschland.py rechnet anders - python tests/paritaet.py neu laufen lassen"


# ------------------------------------------------- Vorhersage-Antworten
VORHERSAGE = os.path.join(os.path.dirname(HIER), "web", "test", "vorhersage")


def vorhersage_rechnen() -> dict:
    """Abgelegte Antworten der Dienste -> gemeinsames Format (vorhersage.py)."""
    import vorhersage
    aus = {}
    for name in sorted(os.listdir(VORHERSAGE)):
        if not name.endswith(".json") or name == "erwartet.json":
            continue
        with open(os.path.join(VORHERSAGE, name), encoding="utf-8") as datei:
            antwort = json.load(datei)
        if name.startswith("om_"):
            aus[name] = vorhersage.open_meteo(antwort)
        elif name.startswith("mehr_"):
            aus[name] = {m[4]: vorhersage.open_meteo(vorhersage.aufteilen(antwort, m[4]))
                         for m in vorhersage.MODELLE if m[3] == "open-meteo"}
        elif name.startswith("metno"):
            aus[name] = vorhersage.met_norway(antwort)
        else:
            aus[name] = vorhersage.bright_sky(antwort)
    # jeder Code einmal durch die Symbol-Tabellen
    aus["symbole_wmo"] = {c: vorhersage.symbol_wmo(c) for c in
                          (0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73,
                           75, 77, 80, 81, 82, 85, 86, 95, 96, 99, 4)}
    aus["symbole_metno"] = {c: list(vorhersage.symbol_metno(c)) for c in (
        "clearsky_day", "clearsky_night", "fair_polartwilight", "partlycloudy_night", "cloudy", "fog",
        "lightrain", "rain", "heavyrain", "lightrainshowers_day", "heavyrainshowersandthunder_night",
        "sleet", "lightsleetshowers_day", "snow", "heavysnowshowers_night", "lightssnowshowersandthunder_day")}
    aus["symbole_brightsky"] = {c: list(vorhersage.symbol_brightsky(c)) for c in (
        "clear-day", "clear-night", "partly-cloudy-day", "partly-cloudy-night", "cloudy", "fog",
        "wind", "rain", "sleet", "snow", "hail", "thunderstorm")}
    return aus


def vorhersage_schreiben():
    with open(os.path.join(VORHERSAGE, "erwartet.json"), "w", encoding="utf-8") as datei:
        json.dump(vorhersage_rechnen(), datei, ensure_ascii=False)


def test_vorhersage_erwartung_aktuell():
    with open(os.path.join(VORHERSAGE, "erwartet.json"), encoding="utf-8") as datei:
        assert json.loads(json.dumps(vorhersage_rechnen())) == json.load(datei), \
            "vorhersage.py rechnet anders - python tests/paritaet.py neu laufen lassen"


if __name__ == "__main__":
    schreiben()
    vorhersage_schreiben()
