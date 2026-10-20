"""
Wetter - wo die Dateien liegen
==============================

Wie beim Serientrenner: alles *neben* dem Programm, portabel und ohne
Installation. Neben der exe entsteht der Ordner "daten" mit der Datenbank;
dort landen auch die Protokolle. Lässt sich neben dem Programm nicht
schreiben (schreibgeschütztes Netzlaufwerk, "Programme"), weicht alles in
den Benutzerordner aus (%LOCALAPPDATA%\\Wetter).

Einstellungen (Station, QN-Stufe, Ansicht) stehen in der Datenbank selbst,
in der Tabelle meta - eine Datei weniger, die verloren gehen kann.
"""

import os
import sys

DATENORDNER = "daten"
APP_ORDNER = "Wetter"


def get_runtime_dir():
    """Ordner der Anwendung: bei .exe der Ordner der exe, sonst der
    Ordner dieses Skripts."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def ausweichordner():
    """Ort für den Fall, dass neben dem Programm nicht geschrieben werden darf."""
    basis = (os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
             or os.path.expanduser("~"))
    return os.path.join(basis, APP_ORDNER)


def _beschreibbar(ordner: str) -> bool:
    try:
        os.makedirs(ordner, exist_ok=True)
        probe = os.path.join(ordner, ".probe")
        with open(probe, "w", encoding="ascii") as datei:
            datei.write("1")
        os.remove(probe)
        return True
    except OSError:
        return False


def datenordner() -> str:
    """Der Ordner mit Datenbank und Protokollen."""
    for ordner in (os.path.join(get_runtime_dir(), DATENORDNER),
                   os.path.join(ausweichordner(), DATENORDNER)):
        if _beschreibbar(ordner):
            return ordner
    raise OSError("Kein beschreibbarer Ordner für die Daten gefunden")


def protokollordner() -> str:
    """Für Protokolle neben der exe - auch wenn die Daten ausweichen
    mussten, versucht es zuerst dort (der Starttest liest dort)."""
    ordner = get_runtime_dir()
    return ordner if _beschreibbar(ordner) else datenordner()
