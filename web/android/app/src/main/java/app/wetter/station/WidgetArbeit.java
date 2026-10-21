package app.wetter.station;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.text.SimpleDateFormat;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Alle 3 Stunden: Vorhersage für den Ort des Widgets holen, das Raster
 * (3 Tage x 8 Zeitpunkte) ablegen, das Widget zeichnen und nach Unwetter in
 * den nächsten 24 Stunden sehen.
 */
public class WidgetArbeit extends Worker {

    static final int[] UHREN = {0, 3, 6, 9, 12, 15, 18, 21};
    static final double STURM = 75;       // km/h Böe (DWD: Sturmböen)
    static final double STARKREGEN = 15;  // mm in einer Stunde (DWD)

    public WidgetArbeit(@NonNull Context c, @NonNull WorkerParameters p) {
        super(c, p);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        if (!Einstellungen.hatOrt(c)) return Result.success();
        SharedPreferences p = Einstellungen.prefs(c);
        double lat = Einstellungen.lat(c);
        double lon = Einstellungen.lon(c);
        String modell = p.getString("modell", "icon_d2");
        try {
            List<Vorhersage.Stunde> haupt = Vorhersage.abrufen(lat, lon, modell);
            List<Vorhersage.Stunde> ersatz = null;
            long jetzt = System.currentTimeMillis();
            // fehlen Zeitpunkte (ICON-D2 reicht rund 48 Stunden), füllt ICON-EU auf
            if (!"icon_eu".equals(modell) && fehlt(haupt, jetzt)) {
                try {
                    ersatz = Vorhersage.openMeteo(lat, lon, "icon_eu");
                } catch (Exception ignoriert) {
                    ersatz = null;
                }
            }
            p.edit().putString("raster", raster(haupt, ersatz, jetzt, lat, lon).toString()).apply();
            WetterWidget.zeichnen(c);
            if (p.getBoolean("unwetter", true)) Meldung.unwetter(c, haupt, jetzt);
            return Result.success();
        } catch (Exception e) {
            p.edit().putString("fehler", e.getMessage() == null ? e.toString() : e.getMessage()).apply();
            WetterWidget.zeichnen(c);
            return Result.retry();
        }
    }

    private static boolean fehlt(List<Vorhersage.Stunde> haupt, long jetzt) {
        for (int t = 0; t < 3; t++) {
            for (int h : UHREN) {
                long ms = Vorhersage.zeitpunkt(jetzt, t, h);
                if (ms + 3 * 3600000L > jetzt && Vorhersage.finden(haupt, null, ms) == null) return true;
            }
        }
        return false;
    }

    /** {abgerufen, tage: [[Name, Min, Max]], zellen: [[art, tag, temp, ersatz] | null] x 24} */
    static JSONObject raster(List<Vorhersage.Stunde> haupt, List<Vorhersage.Stunde> ersatz, long jetzt,
                             double lat, double lon) throws Exception {
        JSONObject r = new JSONObject();
        r.put("abgerufen", jetzt);
        JSONArray tage = new JSONArray();
        JSONArray zellen = new JSONArray();
        SimpleDateFormat wochentag = new SimpleDateFormat("EE d.", Locale.GERMANY);
        wochentag.setTimeZone(Vorhersage.BERLIN);
        for (int t = 0; t < 3; t++) {
            double min = Double.NaN, max = Double.NaN;
            for (int h = 0; h < 24; h++) {
                Vorhersage.Stunde s = Vorhersage.finden(haupt, ersatz, Vorhersage.zeitpunkt(jetzt, t, h));
                if (s == null) continue;
                if (Double.isNaN(min) || s.temp < min) min = s.temp;
                if (Double.isNaN(max) || s.temp > max) max = s.temp;
            }
            String name = t == 0 ? "Heute" : t == 1 ? "Morgen" : wochentag.format(Vorhersage.zeitpunkt(jetzt, t, 12));
            JSONArray tag = new JSONArray();
            tag.put(name);
            tag.put(Double.isNaN(min) ? JSONObject.NULL : min);
            tag.put(Double.isNaN(max) ? JSONObject.NULL : max);
            tage.put(tag);
            for (int h : UHREN) {
                long ms = Vorhersage.zeitpunkt(jetzt, t, h);
                Vorhersage.Stunde s = ms + 3 * 3600000L <= jetzt ? null : Vorhersage.finden(haupt, ersatz, ms);
                if (s == null) {
                    zellen.put(JSONObject.NULL);
                    continue;
                }
                JSONArray z = new JSONArray();
                z.put(s.art == null ? "" : s.art);
                z.put(Vorhersage.istTag(s, lat, lon));
                z.put(s.temp);
                z.put(s.ersatz);
                zellen.put(z);
            }
        }
        r.put("tage", tage);
        r.put("zellen", zellen);
        return r;
    }

    /** Schon gemeldete Ereignisse - je Art und Tag nur einmal; die letzten 40 bleiben. */
    static boolean neuGemeldet(Context c, String schluessel) {
        SharedPreferences p = Einstellungen.prefs(c);
        Set<String> alt = p.getStringSet("gemeldet", new HashSet<>());
        if (alt.contains(schluessel)) return false;
        Set<String> neu = new HashSet<>(alt);
        if (neu.size() > 40) neu.clear();
        neu.add(schluessel);
        p.edit().putStringSet("gemeldet", neu).apply();
        return true;
    }
}
