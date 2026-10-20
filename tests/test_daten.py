import datetime as dt

import pytest

import daten
from hilfen import produkt, reihe

D = dt.date


@pytest.fixture
def db(tmp_path):
    d = daten.Daten(str(tmp_path / "t.duckdb"))
    d.stationen_setzen([{"id": 1, "von": "19500101", "bis": "20261019",
                         "hoehe": 100, "lat": 51.0, "lon": 10.0,
                         "name": "Prüfstadt", "land": "Testland"}])
    yield d
    d.schliessen()


def roh(db, sid=1):
    return db._c().execute(
        "SELECT datum, tmk, txk, tnk, qn, quelle FROM tag WHERE station = ? "
        "ORDER BY datum", [sid]).fetchall()


def rein(db, stufe="alle"):
    import plausibel
    return db._c().execute(
        f"SELECT datum, tmk, txk, tnk FROM {plausibel.rein(stufe, 'station = 1')} "
        "ORDER BY datum").fetchall()


# ------------------------------------------------------------- Einlesen
def test_einlesen_feste_typen_und_fehlwerte(db):
    """-999 heißt fehlt; gepolsterte Spaltennamen; CRLF."""
    db.einlesen(1, produkt(1, [(D(1950, 1, 1), None, None, None, 1),
                               (D(1950, 1, 2), 7.8, 8.9, 6.9, 5)]), None, "h.zip")
    assert roh(db) == [(D(1950, 1, 1), None, None, None, 1, 0),
                       (D(1950, 1, 2), 7.8, 8.9, 6.9, 5, 0)]


def test_historisch_gewinnt_recent_nur_dahinter(db):
    hist = produkt(1, [(D(2025, 12, 30), 1.0, 2.0, 0.0),
                       (D(2025, 12, 31), 1.0, 2.0, 0.0)])
    recent = produkt(1, [(D(2025, 12, 31), 9.0, 9.5, 8.5, 3),
                         (D(2026, 1, 1), 3.0, 4.0, 2.0, 3)])
    db.einlesen(1, hist, recent, "h.zip")
    assert [(d, m, q) for d, m, _, _, _, q in roh(db)] == [
        (D(2025, 12, 30), 1.0, 0), (D(2025, 12, 31), 1.0, 0),
        (D(2026, 1, 1), 3.0, 1)]
    assert db.abruf(1)["hist_datei"] == "h.zip"


def test_nur_recent_ersetzt_nur_recent(db):
    hist = produkt(1, [(D(2025, 12, 31), 1.0, 2.0, 0.0)])
    db.einlesen(1, hist, produkt(1, [(D(2026, 1, 1), 3.0, 4.0, 2.0)]), "h.zip")
    db.einlesen(1, None, produkt(1, [(D(2026, 1, 1), 3.5, 4.0, 2.0),
                                     (D(2026, 1, 2), 5.0, 6.0, 4.0)]),
                None, nur_recent=True)
    assert [(d, m) for d, m, *_ in roh(db)] == [
        (D(2025, 12, 31), 1.0), (D(2026, 1, 1), 3.5), (D(2026, 1, 2), 5.0)]
    assert db.abruf(1)["hist_datei"] == "h.zip", "bleibt gemerkt"


def test_station_ohne_hist(db):
    db.einlesen(1, None, produkt(1, [(D(2026, 1, 1), 3.0, 4.0, 2.0)]), None)
    assert len(roh(db)) == 1


def test_unerwarteter_kopf_wird_abgelehnt(db):
    with pytest.raises(ValueError):
        db.einlesen(1, b"A;B;C\r\n1;2;3\r\n", None, "h.zip")
    assert roh(db) == [], "nichts halb geschrieben"


# ---------------------------------------------------------- Plausibilität
def test_grenzen_je_wert(db):
    db.einlesen(1, produkt(1, [(D(2000, 1, 1), 10.0, 55.0, 5.0),
                               (D(2000, 1, 2), -50.0, 2.0, -3.0),
                               (D(2000, 1, 3), 10.0, 15.0, 5.0)]), None, "h")
    assert rein(db) == [(D(2000, 1, 1), 10.0, None, 5.0),
                        (D(2000, 1, 2), None, 2.0, -3.0),
                        (D(2000, 1, 3), 10.0, 15.0, 5.0)]


def test_max_unter_min_nimmt_den_ganzen_tag(db):
    db.einlesen(1, produkt(1, [(D(2000, 1, 1), 5.0, 3.0, 4.0)]), None, "h")
    assert rein(db) == [(D(2000, 1, 1), None, None, None)]


def test_mittel_ausserhalb_nimmt_nur_das_mittel(db):
    db.einlesen(1, produkt(1, [(D(2000, 1, 1), 9.0, 8.0, 2.0),
                               (D(2000, 1, 2), 1.0, 8.0, 2.0),
                               (D(2000, 1, 3), 1.0, None, 2.0)]), None, "h")
    assert rein(db) == [(D(2000, 1, 1), None, 8.0, 2.0),
                        (D(2000, 1, 2), None, 8.0, 2.0),
                        (D(2000, 1, 3), None, None, 2.0)]


def test_qn_stufen(db):
    db.einlesen(1, produkt(1, [(D(2000, 1, 1), 1.0, 2.0, 0.0, 1),
                               (D(2000, 1, 2), 1.0, 2.0, 0.0, 5),
                               (D(2000, 1, 3), 1.0, 2.0, 0.0, 10)]), None, "h")
    assert len(rein(db, "alle")) == 3
    assert len(rein(db, "ab5")) == 2
    assert len(rein(db, "nur10")) == 1
    assert len(rein(db, "unsinn")) == 3, "Unbekanntes ist die Vorgabe"


def test_bilanz_zaehlt_jede_regel(db):
    db.einlesen(1, produkt(1, [
        (D(2000, 1, 1), 10.0, 55.0, 5.0, 10),     # Grenze
        (D(2000, 1, 2), 5.0, 3.0, 4.0, 10),       # Max < Min
        (D(2000, 1, 3), 9.0, 8.0, 2.0, 10),       # Mittel außerhalb
        (D(2000, 1, 4), -10.0, -8.0, -12.0, 10),  # Sprung -19 K zum Vortag? Vortag ohne Mittel
        (D(2000, 1, 5), 8.0, 10.0, 6.0, 10),      # Sprung +18 K
        (D(2000, 1, 6), 8.0, 10.0, 6.0, 1),       # QN 1
    ]), None, "h")
    assert db.bilanz(1, "alle") == {
        "tage": 6, "qn_weg": 0, "grenze_weg": 1, "max_unter_min": 1,
        "mittel_ausserhalb": 1, "spruenge": 1}
    assert db.bilanz(1, "nur10")["qn_weg"] == 1


def test_sprung_wird_markiert_nicht_entfernt(db):
    db.einlesen(1, produkt(1, [(D(1893, 1, 14), -2.0, 0.0, -4.0),
                               (D(1893, 1, 15), -19.0, -15.0, -22.0),
                               (D(1893, 1, 17), 0.0, 1.0, -1.0)]), None, "h")
    r = db.zeitreihe(1, "m", "tag", "alle")
    assert r["spruenge"] == [[r["t"][1], -19.0, -2.0]]
    # der 16. fehlt: ein Punkt ohne Wert unterbricht die Linie, und der
    # 17. zählt nicht als Sprung - es gibt keinen Vortag
    assert r["v"] == [-2.0, -19.0, None, 0.0]


# -------------------------------------------------------------- Ansichten
def test_jahresmittel_nur_volle_jahre_und_glaettung(db):
    def wert(d):
        return (float(d.year - 2000), d.year - 2000 + 5.0, d.year - 2000 - 5.0)
    tage = reihe(D(2000, 1, 1), D(2003, 12, 31), wert)
    tage = [t for t in tage if not (t[0].year == 2002 and t[0].month > 1)]
    db.einlesen(1, produkt(1, tage), None, "h")
    r = db.zeitreihe(1, "m", "jahr", "alle")
    assert r["j"] == [2000, 2001, 2003], "2002 hat nur 31 Tage"
    assert r["v"] == [0.0, 1.0, 3.0]
    assert r["glatt"] == [pytest.approx(4 / 3, abs=0.01)] * 3


def test_monate_brauchen_neunzig_prozent(db):
    tage = reihe(D(2000, 1, 1), D(2000, 2, 29))
    tage = [t for t in tage if t[0].day > 5 or t[0].month == 1]
    db.einlesen(1, produkt(1, tage), None, "h")
    r = db.zeitreihe(1, "m", "monat", "alle")
    assert r["v"] == [10.0], "Februar mit 24 von 29 Tagen fällt weg"


def test_jahresband_platz_und_normal(db):
    # 1991-2020 überall 10 °C, 2021 wärmer, 2022 kälter, 2023 bis 10. März
    def wert(d):
        m = {2021: 12.0, 2022: 8.0}.get(d.year, 10.0)
        return (m, m + 5, m - 5)
    db.einlesen(1, produkt(1, reihe(D(1991, 1, 1), D(2023, 3, 10), wert)),
                None, "h")
    band = db.jahresband(1, None, "alle")
    assert band["jahr"] == 2023 and band["laufend"]
    assert band["letzter"] == "2023-03-10"
    assert band["normal_jahre"] == 30
    assert band["normal"][60][1:4] == [10.0, 15.0, 5.0]
    assert band["tage"][-1] == [69, 10.0, 15.0, 5.0], "10. März = Tag 69"
    # bis 10. März: 2021 am wärmsten, 2022 am kältesten, 2023 teilt mit 30
    assert band["bisher"]["von"] == 33
    assert band["bisher"]["platz"] in range(2, 33)
    alt = db.jahresband(1, 2021, "alle")
    assert alt["bisher"] == {"m": 12.0, "tage": 365, "platz": 1, "von": 32}
    assert alt["monate"][0] == {"mo": 1, "m": 12.0, "tage": 31, "norm": 10.0}


def test_stationsliste_zaehlt_geladene_tage(db):
    db.einlesen(1, produkt(1, reihe(D(2000, 1, 1), D(2000, 1, 10))), None, "h")
    assert db.stationen() == [[1, "Prüfstadt", "Testland", 100, 1950,
                               "2026-10-19", 10]]
