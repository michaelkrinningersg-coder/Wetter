"""Rekorde Deutschland: Regel für Plätze, Gleichstand, Fenster."""

import datetime as dt

import auswertung
import rekorde_de

NAMEN = ["tmk", "txk", "tnk", "fx", "fm", "rsk", "rskf", "sdk", "shk", "nm", "vpm", "pm", "upm", "tgk"]
NULL = dt.date(1970, 1, 1)


def spalten(von: dt.date, txk: list) -> auswertung.Spalten:
    """Tage ab `von` mit nur txk gefüllt."""
    zeilen = []
    for i, w in enumerate(txk):
        d = von + dt.timedelta(days=i)
        werte = {n: None for n in NAMEN}
        werte["txk"] = w
        zeilen.append(((d - NULL).days, d.year, d.month, d.day, *[werte[n] for n in NAMEN]))
    return auswertung.Spalten(zeilen, NAMEN)


def ord_(d):
    return (d - NULL).days


def hoechst(e):
    return [x for x in e if x["kategorie"] == "Höchstwert"]


def test_erlaubte_plaetze():
    assert rekorde_de.erlaubt(2.99) == 0
    assert rekorde_de.erlaubt(3) == 1
    assert rekorde_de.erlaubt(19.9) == 1
    assert rekorde_de.erlaubt(20) == 3
    assert rekorde_de.erlaubt(30) == 5
    assert rekorde_de.erlaubt(49.9) == 5
    assert rekorde_de.erlaubt(50) == 10


def test_kurze_reihe_zaehlt_nicht_und_ab_drei_jahren_nur_platz_eins():
    von = dt.date(2020, 1, 1)
    werte = [10.0] * (365 * 4)
    werte[365 * 2] = 30.0       # nach 2 Jahren: Reihe zu kurz
    werte[365 * 3 + 10] = 25.0  # nach gut 3 Jahren: nur Platz 2 -> nicht dabei
    werte[365 * 3 + 20] = 31.0  # neuer Rekord -> dabei
    s = spalten(von, werte)
    e = hoechst(rekorde_de.neue_rekorde(s, 0, 10**6))
    assert [(x["datum"], x["platz"], x["von"]) for x in e] == [
        ((von + dt.timedelta(days=365 * 3 + 20)).isoformat(), 1, 1)]
    assert e[0]["bisher"] == [30.0, (von + dt.timedelta(days=365 * 2)).isoformat()]
    assert e[0]["seit"] == 2020


def test_lange_reihe_top_zehn_und_gleichstand_dahinter():
    von = dt.date(1960, 1, 1)
    n = 365 * 60
    werte = [10.0] * n
    for k in range(10):          # zehn frühe Spitzen 30..39
        werte[1000 + k * 400] = 30.0 + k
    werte[n - 30] = 35.0         # gleich wie eine frühere: dahinter -> Platz 6
    werte[n - 20] = 39.5         # Platz 1
    werte[n - 10] = 29.0         # schlechter als alle zehn: nicht dabei
    s = spalten(von, werte)
    e = hoechst(rekorde_de.neue_rekorde(s, ord_(von) + n - 365, ord_(von) + n))
    assert [(x["wert"], x["platz"], x["von"]) for x in e] == [(35.0, 6, 10), (39.5, 1, 10)]


def test_nur_das_fenster():
    von = dt.date(1990, 1, 1)
    werte = [10.0] * (365 * 25)
    werte[365 * 22] = 40.0
    werte[365 * 24] = 41.0
    s = spalten(von, werte)
    ab = ord_(von) + 365 * 23
    e = hoechst(rekorde_de.neue_rekorde(s, ab, ab + 3650))
    assert [(x["wert"], x["platz"], x["von"]) for x in e] == [(41.0, 1, 3)]


def test_kalendertag_erst_ab_zwanzig_jahren_und_echt_besser():
    von = dt.date(2000, 1, 1)
    n = (dt.date(2026, 1, 10) - von).days + 1
    werte = [5.0] * n
    tag = lambda d: (d - von).days  # noqa: E731
    for j in range(2000, 2026):            # jeder 5. Januar: 10,0 °C, 2010: 12,0
        werte[tag(dt.date(j, 1, 5))] = 12.0 if j == 2010 else 10.0
    werte[tag(dt.date(2015, 1, 6))] = 20.0   # 6. Januar: erst 15 Jahre - zählt nicht
    werte[tag(dt.date(2026, 1, 5))] = 12.0   # gleich wie 2010 - zählt nicht
    werte[tag(dt.date(2026, 1, 7))] = 15.0   # 7. Januar, 26 Jahre: neuer Rekord
    s = spalten(von, werte)
    e = [x for x in rekorde_de.kalendertag_rekorde(s, 0, 10**6) if x["kategorie"] == "Höchstwert"]
    assert [(x["datum"], x["wert"], x["jahre"], x["bisher"][0]) for x in e] == [("2026-01-07", 15.0, 26, 5.0)]
