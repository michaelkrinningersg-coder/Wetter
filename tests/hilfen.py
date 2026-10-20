"""Künstliche DWD-Dateien für die Tests - im Format, wie der DWD sie liefert."""

import datetime as dt
import io
import zipfile

KOPF = ("STATIONS_ID;MESS_DATUM;QN_3;  FX;  FM;QN_4; RSK;RSKF; SDK;SHK_TAG;"
        "  NM; VPM;  PM; TMK; UPM; TXK; TNK; TGK;eor")


def zeile(sid, datum: dt.date, tmk, txk, tnk, qn=10):
    def f(v):
        return "-999" if v is None else f"{v:6.1f}"
    return (f"{sid:11d};{datum:%Y%m%d};   10;   7.9;   2.9;{qn:5d};   0.4;   6;"
            f"    0.000;   0;   7.6;   9.7;  992.20;{f(tmk)};   92.00;{f(txk)};"
            f"{f(tnk)};   6.7;eor")


def produkt(sid, tage) -> bytes:
    """tage: [(datum, tmk, txk, tnk[, qn]), ...] -> produkt_klima_tag-Text"""
    zeilen = [KOPF] + [zeile(sid, *t) for t in tage]
    return ("\r\n".join(zeilen) + "\r\n").encode("latin-1")


def archiv(sid, tage) -> bytes:
    puffer = io.BytesIO()
    with zipfile.ZipFile(puffer, "w") as z:
        z.writestr(f"Metadaten_Geographie_{sid:05d}.txt", "egal")
        z.writestr(f"produkt_klima_tag_19500101_20251231_{sid:05d}.txt",
                   produkt(sid, tage))
    return puffer.getvalue()


def reihe(von: dt.date, bis: dt.date, wert=lambda d: (10.0, 15.0, 5.0)):
    tage = []
    d = von
    while d <= bis:
        tage.append((d, *wert(d)))
        d += dt.timedelta(days=1)
    return tage
