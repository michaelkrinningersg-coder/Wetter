"""
Wetter - der Abruf beim DWD
===========================

Alles, was über das Netz kommt: die Stationsliste, das Verzeichnis der
historischen Archive und die beiden Archive einer Station.

Der DWD legt je Station zwei Zips ab:

    historical/tageswerte_KL_01691_18580101_20251231_hist.zip
        die geprüfte Reihe bis Ende des Vorjahres, einmal im Jahr neu
    recent/tageswerte_KL_01691_akt.zip
        die letzten rund 500 Tage, täglich neu, Prüfung nicht abgeschlossen

Der Name des historischen Archivs enthält die Daten von/bis und ändert sich
mit jeder Jahreslieferung. Er steht nur im Verzeichnis (200 kB HTML), das
deshalb einmal am Tag gelesen und gemerkt wird.

Gemessen: jede Anfrage kostet gut eine Sekunde, fast nur Wartezeit, kaum
Übertragung (1,3 MB hist in 1,25 s, 45 kB recent in 1,09 s). Darum läuft
alles, was gleichzeitig laufen kann, gleichzeitig.

Gelesen wird hier nichts - die Zips gehen als Bytes an daten.py.
"""

from __future__ import annotations

import io
import re
import ssl
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

BASIS = ("https://opendata.dwd.de/climate_environment/CDC/"
         "observations_germany/climate/daily/kl/")
STATIONSLISTE = "recent/KL_Tageswerte_Beschreibung_Stationen.txt"
WARTEZEIT = 30          # Sekunden je Anfrage
GLEICHZEITIG = 16       # gemessen: 16 parallel schafft 6,2 Archive/s


class Abruffehler(Exception):
    """Der DWD war nicht erreichbar oder lieferte etwas Unerwartetes."""


def _tls() -> ssl.SSLContext:
    """Zertifikate prüft das Betriebssystem, nicht eine eigene Liste.

    Python bringt in der exe seine eigene Zertifikatsprüfung mit. Die kennt
    weder Zwischenzertifikate, die Windows bei Bedarf nachlädt, noch die
    Zertifikate eines Firmen-Proxys, die nur im Windows-Speicher stehen -
    v1.0.3 scheiterte daran mit CERTIFICATE_VERIFY_FAILED, wo der Browser
    dieselbe Seite ohne Murren öffnet. truststore reicht die Prüfung an
    Windows weiter (wie pip es tut); geprüft wird also weiterhin, nur mit
    dem Urteil, dem auch Edge folgt.
    """
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:                                    # noqa: BLE001
        return ssl.create_default_context()


_KONTEXT = None


def holen(pfad: str) -> bytes:
    """Eine Datei vom DWD-Server, als Bytes."""
    global _KONTEXT
    if _KONTEXT is None:
        _KONTEXT = _tls()
    url = BASIS + pfad
    anfrage = urllib.request.Request(url, headers={"User-Agent": "Wetter/1.0"})
    try:
        with urllib.request.urlopen(anfrage, timeout=WARTEZEIT,
                                    context=_KONTEXT) as antwort:
            return antwort.read()
    except Exception as fehler:                          # noqa: BLE001
        raise Abruffehler(f"{url}: {fehler}") from fehler


def kennung(station) -> str:
    """01691 - so schreibt der DWD die Stationsnummer in Dateinamen."""
    return f"{int(station):05d}"


# --------------------------------------------------------------------------
# Stationsliste
# --------------------------------------------------------------------------
_DATUM = re.compile(r"^\d{8}$")


def stationen_lesen(roh: bytes) -> list[dict]:
    """Die Stationsliste: feste Spalten, Latin-1, Name und Land mit Leerzeichen.

        00001 19370101 19860630   478   47.8413  8.8493 Aach    Baden-Württemberg   Frei

    Die ersten sechs Felder sind ohne Leerzeichen. Danach stehen Name, Land
    und Abgabe, getrennt durch mindestens zwei Leerzeichen - Namen wie
    "Bad Lippspringe" haben nur eines.
    """
    stationen = []
    for zeile in roh.decode("latin-1").splitlines():
        teile = zeile.split(None, 6)
        if len(teile) < 7 or not teile[0].isdigit() \
                or not _DATUM.match(teile[1]) or not _DATUM.match(teile[2]):
            continue
        rest = [t for t in re.split(r"\s{2,}", teile[6].strip()) if t]
        # Abgabe ("Frei") am Ende ist für uns ohne Belang
        if len(rest) >= 3:
            name, land = rest[0], rest[1]
        elif len(rest) == 2:
            name, land = rest
        else:
            name, land = (rest[0] if rest else ""), ""
        try:
            stationen.append({
                "id": int(teile[0]),
                "von": teile[1], "bis": teile[2],
                "hoehe": int(float(teile[3])),
                "lat": float(teile[4]), "lon": float(teile[5]),
                "name": name, "land": land,
            })
        except ValueError:
            continue
    return stationen


def stationsliste() -> list[dict]:
    return stationen_lesen(holen(STATIONSLISTE))


# --------------------------------------------------------------------------
# Verzeichnis der historischen Archive
# --------------------------------------------------------------------------
_HIST = re.compile(r'href="(tageswerte_KL_(\d{5})_(\d{8})_(\d{8})_hist\.zip)"')


def hist_verzeichnis_lesen(html: bytes) -> dict[int, str]:
    """Stationsnummer -> Dateiname des historischen Archivs."""
    return {int(m.group(2)): m.group(1)
            for m in _HIST.finditer(html.decode("latin-1"))}


def hist_verzeichnis() -> dict[int, str]:
    return hist_verzeichnis_lesen(holen("historical/"))


# --------------------------------------------------------------------------
# Archive einer Station
# --------------------------------------------------------------------------
def produkt(zip_bytes: bytes) -> bytes:
    """Die Datei produkt_klima_tag_*.txt aus einem Archiv."""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archiv:
            for name in archiv.namelist():
                if name.startswith("produkt_klima_tag"):
                    return archiv.read(name)
    except zipfile.BadZipFile as fehler:
        raise Abruffehler(f"Archiv unlesbar: {fehler}") from fehler
    raise Abruffehler("Im Archiv fehlt die Datei produkt_klima_tag")


def recent_pfad(station) -> str:
    return f"recent/tageswerte_KL_{kennung(station)}_akt.zip"


def archive(station, hist_datei: str | None, mit_hist=True,
            mit_recent=True) -> dict:
    """Lädt hist und recent gleichzeitig. Fehlt eins beim DWD, steht None da.

    Eine Station ohne recent-Archiv ist geschlossen; eine ohne hist ist so
    jung, dass es noch keine Jahreslieferung gab. Beides ist normal - nur
    wenn keines der beiden kommt, ist es ein Fehler.
    """
    auftraege = {}
    if mit_hist and hist_datei:
        auftraege["hist"] = "historical/" + hist_datei
    if mit_recent:
        auftraege["recent"] = recent_pfad(station)
    ergebnis = {"hist": None, "recent": None}
    fehler = {}
    with ThreadPoolExecutor(max_workers=max(1, len(auftraege))) as pool:
        laeufe = {art: pool.submit(holen, pfad)
                  for art, pfad in auftraege.items()}
        for art, lauf in laeufe.items():
            try:
                ergebnis[art] = produkt(lauf.result())
            except Abruffehler as f:
                fehler[art] = str(f)
    if auftraege and not any(ergebnis.values()):
        raise Abruffehler("; ".join(fehler.values()) or "nichts geladen")
    ergebnis["fehler"] = fehler
    return ergebnis
