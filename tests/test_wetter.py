import datetime as dt

import pytest

import daten
import dwd
import wetter
from hilfen import archiv, reihe


@pytest.fixture
def api(tmp_path):
    db = daten.Daten(str(tmp_path / "t.duckdb"))
    db.stationen_setzen([
        {"id": 1691, "von": "18580101", "bis": "20261019", "hoehe": 167,
         "lat": 51.5, "lon": 9.95, "name": "Göttingen", "land": "Niedersachsen"},
        {"id": 722, "von": "18960101", "bis": "20261019", "hoehe": 1135,
         "lat": 51.8, "lon": 10.6, "name": "Brocken", "land": "Sachsen-Anhalt"}])
    a = wetter.Api(db, netz=False)
    yield a
    db.schliessen()


def test_start_ohne_netz(api):
    r = api.start()
    assert [s[1] for s in r["stationen"]] == ["Brocken", "Göttingen"]
    assert r["einstellungen"] == {"station": 1691, "qn": "alle", "ansicht": "band",
                                  "rang_modus": "heute", "rang_prognose": True,
                                  "favoriten": []}


def test_einstellungen_bleiben(api):
    assert api.einstellung("qn", "nur10") == {"ok": True}
    assert api.einstellung("unsinn", 1)["fehler"].startswith("Unbekannte")
    assert api.start()["einstellungen"]["qn"] == "nur10"


def test_ungeladene_station_ohne_netz_ist_ein_hinweis(api):
    assert api.station(722) == {"fehler": "Die Station ist noch nicht geladen"}
    assert "nicht in der Liste" in api.station(99999)["fehler"]


def test_erster_abruf_laedt_die_ganze_reihe(api, monkeypatch):
    geholt = []

    def holen(pfad):
        geholt.append(pfad)
        if pfad == "historical/":
            return b'<a href="tageswerte_KL_00722_18960101_20251231_hist.zip">'
        if pfad.startswith("historical/"):
            return archiv(722, reihe(dt.date(2025, 12, 1), dt.date(2025, 12, 31)))
        return archiv(722, reihe(dt.date(2025, 12, 20), dt.date(2026, 1, 5)))

    monkeypatch.setattr(dwd, "holen", holen)
    api._netz = True
    r = api.station(722)
    assert r["zeitraum"] == {"von": "2025-12-01", "bis": "2026-01-05", "tage": 36}
    assert "ganze Reihe" in r["geladen"]
    assert api.status()["stand"] == 1

    # Aktualisieren: dasselbe hist-Archiv -> nur recent
    geholt.clear()
    assert "recent" in api.aktualisieren(722)["meldung"]
    assert geholt == ["historical/", "recent/tageswerte_KL_00722_akt.zip"]


def test_fehler_kommen_als_text(api):
    assert "fehler" in api.jahresband("keine Zahl")


def test_schalter_bleiben_auch_aus(api):
    api.einstellung("rang_prognose", False)
    assert api.start()["einstellungen"]["rang_prognose"] is False
    api.einstellung("rang_prognose", True)
    assert api.start()["einstellungen"]["rang_prognose"] is True


def test_favoriten_als_liste(api):
    assert api.einstellung("favoriten", [1691, 722]) == {"ok": True}
    assert api.start()["einstellungen"]["favoriten"] == [1691, 722]
    api.einstellung("favoriten", [])
    assert api.start()["einstellungen"]["favoriten"] == []
