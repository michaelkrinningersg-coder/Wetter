import datetime as dt

import pytest

import dwd
from hilfen import archiv

LISTE = (
    "Stations_id von_datum bis_datum Stationshoehe geoBreite geoLaenge "
    "Stationsname Bundesland Abgabe\r\n"
    "----------- --------- --------- ------------- --------- --------- "
    "----------------------------------------- ---------- ------\r\n"
    "00001 19370101 19860630            478     47.8413    8.8493 Aach"
    "                                     Baden-Württemberg"
    "                        Frei      \r\n"
    "01691 18580101 20261019            167     51.5002    9.9507 Göttingen"
    "                                Niedersachsen                            Frei\r\n"
    "00544 19470101 20261019            157     51.7181    8.7466 Bad Lippspringe"
    "                          Nordrhein-Westfalen                      Frei\r\n"
).encode("latin-1")


def test_stationsliste_latin1_und_namen_mit_leerzeichen():
    s = {x["id"]: x for x in dwd.stationen_lesen(LISTE)}
    assert set(s) == {1, 1691, 544}
    assert s[1]["land"] == "Baden-Württemberg"
    assert s[1691] == {"id": 1691, "von": "18580101", "bis": "20261019",
                       "hoehe": 167, "lat": 51.5002, "lon": 9.9507,
                       "name": "Göttingen", "land": "Niedersachsen"}
    # ein einzelnes Leerzeichen gehört zum Namen
    assert s[544]["name"] == "Bad Lippspringe"


def test_hist_verzeichnis():
    html = (b'<a href="tageswerte_KL_01691_18580101_20251231_hist.zip">x</a>'
            b'<a href="tageswerte_KL_00003_18910101_20110331_hist.zip">y</a>'
            b'<a href="KL_Tageswerte_Beschreibung_Stationen.txt">z</a>')
    assert dwd.hist_verzeichnis_lesen(html) == {
        1691: "tageswerte_KL_01691_18580101_20251231_hist.zip",
        3: "tageswerte_KL_00003_18910101_20110331_hist.zip"}


def test_produkt_aus_dem_archiv():
    roh = dwd.produkt(archiv(1691, [(dt.date(2020, 1, 1), 1.0, 2.0, 0.0)]))
    assert roh.startswith(b"STATIONS_ID;MESS_DATUM")
    with pytest.raises(dwd.Abruffehler):
        dwd.produkt(b"kein zip")


def test_recent_pfad():
    assert dwd.recent_pfad(1691) == "recent/tageswerte_KL_01691_akt.zip"


def test_ein_fehlendes_archiv_ist_kein_fehler(monkeypatch):
    """Geschlossene Station: kein recent. Junge Station: kein hist."""
    def holen(pfad):
        if pfad.startswith("recent/"):
            raise dwd.Abruffehler("404")
        return archiv(1, [(dt.date(2000, 1, 1), 1.0, 2.0, 0.0)])
    monkeypatch.setattr(dwd, "holen", holen)
    geholt = dwd.archive(1, "x_hist.zip")
    assert geholt["hist"] and geholt["recent"] is None
    assert "recent" in geholt["fehler"]

    monkeypatch.setattr(dwd, "holen", lambda p: (_ for _ in ()).throw(
        dwd.Abruffehler("404")))
    with pytest.raises(dwd.Abruffehler):
        dwd.archive(1, "x_hist.zip")
