"""
Wetter - Temperaturreihen des DWD
=================================

Derselbe Aufbau wie der Serientrenner: ein Fenster mit Edge WebView2,
darin eine Svelte-Seite, dazwischen die Python-JS-Brücke von pywebview.
Dazu eine DuckDB-Datei mit den Tageswerten (daten.py), gefüllt direkt
aus den Archiven des DWD (dwd.py), bereinigt beim Lesen (plausibel.py).

Beim Start
----------
    1. Die Seite fragt `start()` - Stationsliste, Einstellungen und die
       zuletzt gewählte Station aus der Datenbank. Kein Netz.
    2. Im Hintergrund: recent der aktuellen Station neu, wenn älter als
       drei Stunden; einmal am Tag das Verzeichnis der hist-Archive (neue
       Jahreslieferung -> Station neu) und die Stationsliste.
    3. Die Seite fragt `status()`, solange etwas läuft, und lädt die
       Ansicht neu, sobald sich die Daten geändert haben.

Beim ersten Start wird die mitgelieferte Datenbank (Göttingen, alle
Stationen in der Liste) in den Datenordner kopiert.

Startpunkte
-----------
    python wetter.py               das Fenster (Windows: WebView2)
    python wetter.py --selbsttest  Bestandteile prüfen, ohne Fenster
    python wetter.py --netztest    ein Abruf beim DWD (Zertifikate)
    python wetter.py --dienst 8766 dieselbe Seite im Browser - für die
                                   Entwicklung
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import struct
import sys
import tempfile
import threading
import time
import traceback

import config
import daten
import dwd
import plausibel

APP_TITEL = "Wetter"
APP_VERSION = "v1.0"

WEBORDNER = "webdist"
STARTDATEN = os.path.join("startdaten", "wetter.duckdb")
DATENBANK = "wetter.duckdb"
GOETTINGEN = 1691

SEITE_VERBUNDEN = "Seite mit Python verbunden"
PROTOKOLL = "wetter.log"

RECENT_ALTER = 3 * 3600       # recent neu, wenn älter (DWD: täglich neu)
VERZEICHNIS_ALTER = 20 * 3600  # hist-Verzeichnis und Stationsliste

BITNESS = 8 * struct.calcsize("P")
log = logging.getLogger("wetter")


def ressource(*teile) -> str:
    """Ein Pfad im Programm - im Quelltext wie in der ausgepackten exe."""
    basis = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(basis, *teile)


def programmversion() -> str:
    try:
        with open(ressource("version.txt"), encoding="utf-8") as datei:
            return datei.read().strip() or APP_VERSION
    except OSError:
        return APP_VERSION


def datenbank_oeffnen(ordner: str | None = None) -> daten.Daten:
    """Die Datenbank im Datenordner - beim ersten Mal aus der Vorlage."""
    ordner = ordner or config.datenordner()
    pfad = os.path.join(ordner, DATENBANK)
    vorlage = ressource(STARTDATEN)
    if not os.path.exists(pfad) and os.path.isfile(vorlage):
        shutil.copyfile(vorlage, pfad + ".neu")
        os.replace(pfad + ".neu", pfad)
    try:
        return daten.Daten(pfad)
    except daten.duckdb.IOException as fehler:
        # DuckDB sperrt die Datei für einen Prozess
        raise Hinweis("Die Datenbank ist schon offen - läuft Wetter bereits "
                      f"in einem anderen Fenster? ({fehler})") from fehler


class Hinweis(Exception):
    """Was der Anwender wissen muss - kein Fehler im Programm."""


class Api:
    """Die Brücke - was die Svelte-Seite aufrufen darf.

    Jede Methode fängt ihre Fehler selbst und gibt sie als {"fehler": Text}
    zurück. Der Zustand liegt in Attributen mit Unterstrich: pywebview
    reicht alles andere an die Seite weiter.
    """

    def __init__(self, db: daten.Daten | None = None, netz=True):
        self._db = db
        self._netz = netz
        self._abruf = threading.Lock()      # eine Station nach der anderen
        self._status_sperre = threading.Lock()
        self._laeuft = ""
        self._meldung = ""
        self._stand = 0                     # zählt Datenänderungen
        self._hintergrund: threading.Thread | None = None

    # ------------------------------------------------------------ Hilfen
    def _sicher(self, arbeit):
        try:
            return arbeit()
        except (Hinweis, dwd.Abruffehler) as hinweis:
            return {"fehler": str(hinweis)}
        except Exception as fehler:                      # noqa: BLE001
            traceback.print_exc()
            log.exception("Fehler")
            return {"fehler": f"{type(fehler).__name__}: {fehler}"}

    def _daten(self) -> daten.Daten:
        if self._db is None:
            self._db = datenbank_oeffnen()
        return self._db

    def _status(self, laeuft=None, meldung=None, geaendert=False):
        with self._status_sperre:
            if laeuft is not None:
                self._laeuft = laeuft
            if meldung is not None:
                self._meldung = meldung
            if geaendert:
                self._stand += 1

    def _einstellungen(self) -> dict:
        db = self._daten()
        return {"station": int(db.meta("station", GOETTINGEN)),
                "qn": db.meta("qn", plausibel.QN_VORGABE),
                "ansicht": db.meta("ansicht", "band"),
                "rang_modus": db.meta("rang_modus", "heute"),
                "rang_prognose": db.meta("rang_prognose", "1") != "0"}

    def _verzeichnis(self, neu=False) -> dict[int, str]:
        """Stationsnummer -> hist-Archiv; gemerkt, einmal am Tag neu."""
        db = self._daten()
        gemerkt = db.meta("verzeichnis")
        alter = time.time() - float(db.meta("verzeichnis_am", 0))
        if gemerkt and not neu and alter < VERZEICHNIS_ALTER:
            return {int(k): v for k, v in json.loads(gemerkt).items()}
        if not self._netz:
            return {int(k): v for k, v in json.loads(gemerkt or "{}").items()}
        verzeichnis = dwd.hist_verzeichnis()
        if verzeichnis:
            db.meta_setzen("verzeichnis", json.dumps(verzeichnis))
            db.meta_setzen("verzeichnis_am", time.time())
        return verzeichnis

    def _laden(self, sid: int, ganz=False) -> str:
        """Holt eine Station vom DWD. Ganz neu, wenn noch nicht da oder das
        hist-Archiv eine neue Jahreslieferung ist, sonst nur recent."""
        db = self._daten()
        name = (db.station(sid) or {}).get("name", sid)
        with self._abruf:
            vorher = db.abruf(sid)
            hist_datei = self._verzeichnis().get(sid)
            nur_recent = (not ganz and vorher is not None
                          and (vorher["hist_datei"] or None) == hist_datei)
            self._status(laeuft=f"{name}: Abruf beim DWD …")
            t = time.perf_counter()
            geholt = dwd.archive(sid, hist_datei, mit_hist=not nur_recent)
            db.einlesen(sid, geholt["hist"], geholt["recent"], hist_datei,
                        nur_recent=nur_recent)
            dauer = time.perf_counter() - t
        text = (f"{name}: {'recent' if nur_recent else 'ganze Reihe'} "
                f"in {dauer:.1f} s geladen")
        log.info(text)
        self._status(meldung=text, geaendert=True)
        return text

    def _im_hintergrund(self, sid: int):
        """Nach dem Start: erst die gezeigte Station, dann die Listen."""
        db = self._daten()
        try:
            abruf = db.abruf(sid)
            if abruf and time.time() - (abruf["recent_am"] or 0) > RECENT_ALTER:
                self._laden(sid)
            alter = time.time() - float(db.meta("verzeichnis_am", 0))
            if alter > VERZEICHNIS_ALTER:
                self._status(laeuft="Verzeichnis des DWD …")
                self._verzeichnis(neu=True)
                abruf = db.abruf(sid)
                if abruf and (abruf["hist_datei"] or None) != \
                        self._verzeichnis().get(sid):
                    self._laden(sid)        # neue Jahreslieferung
            alter = time.time() - float(db.meta("stationen_am", 0))
            if alter > VERZEICHNIS_ALTER:
                self._status(laeuft="Stationsliste des DWD …")
                db.stationen_setzen(dwd.stationsliste())
                db.meta_setzen("stationen_am", time.time())
                self._status(geaendert=True)
        except dwd.Abruffehler as fehler:
            log.warning("Hintergrund: %s", fehler)
            self._status(meldung=f"DWD nicht erreichbar - gezeigt wird der "
                                 f"gespeicherte Stand ({fehler})")
        except Exception as fehler:                      # noqa: BLE001
            log.exception("Hintergrund")
            self._status(meldung=f"Fehler im Hintergrund: {fehler}")
        finally:
            self._status(laeuft="")

    def _hintergrund_starten(self, sid: int):
        if not self._netz or (self._hintergrund and self._hintergrund.is_alive()):
            return
        self._hintergrund = threading.Thread(
            target=self._im_hintergrund, args=(sid,), daemon=True)
        self._hintergrund.start()

    # ------------------------------------------------------------- Start
    def start(self) -> dict:
        log.info(SEITE_VERBUNDEN)

        def arbeit():
            db = self._daten()
            einst = self._einstellungen()
            self._hintergrund_starten(einst["station"])
            return {"titel": APP_TITEL, "version": programmversion(),
                    "stationen": db.stationen(),
                    "einstellungen": einst,
                    "datenordner": os.path.dirname(db.pfad)}
        return self._sicher(arbeit)

    def status(self) -> dict:
        with self._status_sperre:
            return {"laeuft": self._laeuft, "meldung": self._meldung,
                    "stand": self._stand}

    def einstellung(self, name: str, wert) -> dict:
        def arbeit():
            if name not in ("station", "qn", "ansicht", "rang_modus",
                            "rang_prognose"):
                raise Hinweis(f"Unbekannte Einstellung: {name}")
            text = ("1" if wert else "0") if isinstance(wert, bool) else wert
            self._daten().meta_setzen(name, text)
            return {"ok": True}
        return self._sicher(arbeit)

    def stationen(self) -> dict:
        return self._sicher(lambda: {"stationen": self._daten().stationen()})

    # ----------------------------------------------------------- Station
    def station(self, sid) -> dict:
        """Kopfdaten einer Station - lädt sie beim ersten Mal vom DWD."""
        def arbeit():
            sid_ = int(sid)
            db = self._daten()
            if db.station(sid_) is None:
                raise Hinweis(f"Station {sid_} steht nicht in der Liste")
            geladen = None
            if db.abruf(sid_) is None:
                if not self._netz:
                    raise Hinweis("Die Station ist noch nicht geladen")
                geladen = self._laden(sid_, ganz=True)
            return {"station": db.station(sid_), "zeitraum": db.zeitraum(sid_),
                    "abruf": db.abruf(sid_), "geladen": geladen}
        return self._sicher(arbeit)

    def aktualisieren(self, sid) -> dict:
        """Auf Knopfdruck: Verzeichnis und Station neu vom DWD."""
        def arbeit():
            sid_ = int(sid)
            self._verzeichnis(neu=True)
            text = self._laden(sid_)
            return {"meldung": text, "zeitraum": self._daten().zeitraum(sid_)}
        try:
            return self._sicher(arbeit)
        finally:
            self._status(laeuft="")

    # --------------------------------------------------------- Ansichten
    def jahresband(self, sid, jahr=None, qn=plausibel.QN_VORGABE) -> dict:
        def arbeit():
            db = self._daten()
            band = db.jahresband(int(sid), jahr, qn)
            band["jahre"] = db.jahre(int(sid), qn)
            band["bilanz"] = db.bilanz(int(sid), qn)
            return band
        return self._sicher(arbeit)

    def monat(self, sid, jahr=None, monat=None,
              qn=plausibel.QN_VORGABE) -> dict:
        return self._sicher(lambda: self._daten().monat(
            int(sid), jahr, monat, qn))

    def rangliste(self, sid, modus="heute", prognose=True,
                  qn=plausibel.QN_VORGABE) -> dict:
        return self._sicher(lambda: self._daten().rangliste(
            int(sid), modus, bool(prognose), qn))

    def zeitreihe(self, sid, groesse="m", aufloesung="jahr",
                  qn=plausibel.QN_VORGABE) -> dict:
        return self._sicher(lambda: self._daten().zeitreihe(
            int(sid), groesse, aufloesung, qn))


# --------------------------------------------------------------------------
# Der Dienst für die Entwicklung: dieselbe Seite im Browser
# --------------------------------------------------------------------------
def dienst(api: Api, port: int = 8766):
    """Liefert webdist/ aus und nimmt POST /api/<Methode> entgegen."""
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    wurzel = ressource(WEBORDNER)

    class Bearbeiter(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=wurzel, **kwargs)

        def log_message(self, *args):
            pass

        def _json(self, inhalt):
            antwort = json.dumps(inhalt).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(antwort)))
            self.end_headers()
            self.wfile.write(antwort)

        def do_GET(self):
            if self.path.split("?")[0] == "/api/bereit":
                self._json({"dienst": True})
                return
            super().do_GET()

        def do_POST(self):
            if not self.path.startswith("/api/"):
                self.send_error(404)
                return
            name = self.path[len("/api/"):]
            laenge = int(self.headers.get("Content-Length") or 0)
            argumente = json.loads(self.rfile.read(laenge) or b"[]")
            methode = getattr(api, name, None)
            if name.startswith("_") or not callable(methode):
                self.send_error(404)
                return
            self._json(methode(*argumente))

    server = ThreadingHTTPServer(("127.0.0.1", port), Bearbeiter)
    print(f"Wetter: http://127.0.0.1:{port}/", flush=True)
    server.serve_forever()


# --------------------------------------------------------------------------
# Start
# --------------------------------------------------------------------------
def selbsttest() -> int:
    """Prüft ohne Fenster und ohne Netz, ob alles mitgeliefert wurde und
    die Startdatenbank die Göttinger Reihe liefert."""
    code = 0
    zeilen = [f"{APP_TITEL} Selbsttest ({BITNESS}-bit)",
              f"  Version {programmversion()}"]

    def fehler(text):
        nonlocal code
        zeilen.append(f"  FEHLER: {text}")
        code = 1

    try:
        import webview                                   # noqa: F401
        zeilen.append("  webview vorhanden")
    except Exception as f:                               # noqa: BLE001
        fehler(f"webview fehlt ({f})")
    import duckdb
    zeilen.append(f"  duckdb {duckdb.__version__}")
    seite = ressource(WEBORDNER, "index.html")
    if os.path.isfile(seite):
        zeilen.append(f"  Oberfläche gefunden ({os.path.getsize(seite) // 1024} kB)")
    else:
        fehler(f"{seite} fehlt")
    vorlage = ressource(STARTDATEN)
    if not os.path.isfile(vorlage):
        fehler(f"{vorlage} fehlt")
    else:
        with tempfile.TemporaryDirectory(prefix="wetter-test-") as ordner:
            try:
                t = time.perf_counter()
                db = datenbank_oeffnen(ordner)
                api = Api(db, netz=False)
                start = api.start()
                band = api.jahresband(GOETTINGEN)
                reihe = api.zeitreihe(GOETTINGEN)
                dauer = (time.perf_counter() - t) * 1000
                for teil in (start, band, reihe):
                    if "fehler" in teil:
                        raise RuntimeError(teil["fehler"])
                zeilen.append(f"  Stationen in der Liste: {len(start['stationen'])}")
                zeilen.append(
                    f"  Göttingen {band['jahr']}: {band['bisher']['m']} °C, "
                    f"Platz {band['bisher']['platz']} von {band['bisher']['von']}, "
                    f"letzter Tag {band['letzter']}")
                zeilen.append(f"  Jahresmittel: {len(reihe['v'])} Jahre")
                zeilen.append(f"  Öffnen bis erste Zahl: {dauer:.0f} ms")
                db.schliessen()
            except Exception as f:                       # noqa: BLE001
                fehler(f"Startdatenbank: {f}")
    ausgabe = "\n".join(zeilen)
    try:
        print(ausgabe, flush=True)
    except Exception:                                    # noqa: BLE001
        pass            # bei --windowed gibt es kein stdout
    try:
        with open(os.path.join(config.protokollordner(), "selbsttest.log"),
                  "w", encoding="utf-8") as datei:
            datei.write(ausgabe + "\n")
    except OSError:
        pass
    return code


def _protokoll_einrichten():
    try:
        ziel = os.path.join(config.protokollordner(), PROTOKOLL)
        handler = logging.FileHandler(ziel, mode="w", encoding="utf-8")
    except OSError:
        return
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s: %(message)s"))
    for name in ("pywebview", "wetter"):
        logger = logging.getLogger(name)
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG if name == "pywebview" else logging.INFO)


def _net_fehler_merken():
    """Eine unbehandelte .NET-Ausnahme beendet das Programm ohne Python -
    vorher kommt sie noch in startfehler.txt."""
    if sys.platform != "win32":
        return
    try:
        __import__("clr")
        from System import AppDomain, UnhandledExceptionEventHandler

        def merken(_sender, args):
            try:
                ziel = os.path.join(config.protokollordner(), "startfehler.txt")
                with open(ziel, "w", encoding="utf-8") as datei:
                    datei.write(str(args.ExceptionObject))
            except OSError:
                pass

        AppDomain.CurrentDomain.UnhandledException += \
            UnhandledExceptionEventHandler(merken)
    except Exception:                                    # noqa: BLE001
        traceback.print_exc()


# Die Ordner mit .NET-Bibliotheken: pythonnet, die WebView2-Anbindung
NET_ORDNER = ("pythonnet", "clr_loader", "webview")


def _freigeben() -> int:
    """Hebt die Windows-Sperre "aus dem Internet" von den .NET-Bibliotheken.

    Wer die zip aus dem Browser lädt und mit dem Explorer entpackt, erbt
    an jeder Datei die Markierung Zone.Identifier (Mark of the Web). .NET
    lädt solche Bibliotheken nicht - pythonnet scheitert dann mit "Failed
    to resolve Python.Runtime.Loader.Initialize", bevor ein Fenster
    aufgeht. Der Serientrenner kennt das nicht: eine onefile-exe packt
    sich selbst aus, und was sie auspackt, trägt keine Markierung.

    Entfernt wird nur dieser eine Datenstrom an DLLs im Programmordner -
    dasselbe wie "Zulassen" in den Dateieigenschaften.
    """
    if sys.platform != "win32":
        return 0
    basis = ressource()
    frei = 0
    for ordner in NET_ORDNER:
        for wurzel, _, dateien in os.walk(os.path.join(basis, ordner)):
            for name in dateien:
                if not name.lower().endswith((".dll", ".exe")):
                    continue
                try:
                    os.remove(os.path.join(wurzel, name) + ":Zone.Identifier")
                    frei += 1
                except OSError:
                    pass        # keine Markierung oder kein Schreibrecht
    return frei


def fenster_starten(api: Api):
    frei = _freigeben()
    import webview

    _protokoll_einrichten()
    log.info("%s %s gestartet (%s-bit)", APP_TITEL, programmversion(), BITNESS)
    if frei:
        log.info("Sperre aus dem Internet von %d Bibliotheken entfernt", frei)
    _net_fehler_merken()

    seite = ressource(WEBORDNER, "index.html")
    webview.create_window(
        APP_TITEL, url=seite, js_api=api, width=1440, height=900,
        min_size=(1000, 640), background_color="#f4f6fa",
        text_select=True, maximized=True)
    windows = sys.platform == "win32"
    webview.start(gui="edgechromium" if windows else None,
                  debug=bool(os.environ.get("WETTER_DEBUG")))


def netztest() -> int:
    """Ein echter Abruf beim DWD aus der fertigen exe - prüft vor allem die
    Zertifikate, die im Quelltext anders geprüft werden als in der exe."""
    try:
        t = time.perf_counter()
        verzeichnis = dwd.hist_verzeichnis()
        text = (f"Netztest: {len(verzeichnis)} hist-Archive beim DWD "
                f"in {time.perf_counter() - t:.1f} s")
        code = 0 if verzeichnis else 1
    except Exception as fehler:                          # noqa: BLE001
        text, code = f"Netztest FEHLER: {fehler}", 1
    try:
        print(text, flush=True)
    except Exception:                                    # noqa: BLE001
        pass
    try:
        with open(os.path.join(config.protokollordner(), "netztest.log"),
                  "w", encoding="utf-8") as datei:
            datei.write(text + "\n")
    except OSError:
        pass
    return code


def main(argumente=None) -> int:
    argumente = list(sys.argv[1:] if argumente is None else argumente)
    if "--selbsttest" in argumente:
        return selbsttest()
    if "--netztest" in argumente:
        return netztest()
    api = Api()
    if "--dienst" in argumente:
        logging.basicConfig(level=logging.INFO)
        stelle = argumente.index("--dienst")
        port = int(argumente[stelle + 1]) if len(argumente) > stelle + 1 \
            and argumente[stelle + 1].isdigit() else 8766
        dienst(api, port)
        return 0
    try:
        fenster_starten(api)
    except Exception as fehler:                          # noqa: BLE001
        try:
            ziel = os.path.join(config.protokollordner(), "startfehler.txt")
            with open(ziel, "w", encoding="utf-8") as datei:
                datei.write(f"{fehler}\n\n{traceback.format_exc()}")
        except OSError:
            pass
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
