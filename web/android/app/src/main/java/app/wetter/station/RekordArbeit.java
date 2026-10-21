package app.wetter.station;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Einmal am Tag gegen 13 Uhr: die Rekorddatei der GitHub-Aktion
 * (rekorde_de.py) lesen und neue Rekorde der Favoriten melden - Platz 1 und
 * Top 3 aus "eintraege", dazu die Kalendertags-Rekorde. Eine Sammelmeldung.
 */
public class RekordArbeit extends Worker {

    static final String ADRESSE =
        "https://github.com/michaelkrinningersg-coder/Wetter/releases/download/rekorde-de/rekorde_de.json";

    public RekordArbeit(@NonNull Context c, @NonNull WorkerParameters p) {
        super(c, p);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        SharedPreferences p = Einstellungen.prefs(c);
        if (!p.getBoolean("rekorde", true)) return Result.success();
        Set<Integer> fav = Einstellungen.favoriten(c);
        try {
            JSONObject d = new JSONObject(Vorhersage.holen(ADRESSE));
            String stand = d.getString("stand");
            // beim ersten Mal nur die letzten 3 Tage, sonst käme ein ganzes Jahr
            String bis = p.getString("rekorde_bis", tageVor(stand, 3));
            List<String> zeilen = new ArrayList<>();
            JSONArray e = d.optJSONArray("eintraege");
            for (int i = 0; e != null && i < e.length(); i++) {
                JSONObject r = e.getJSONObject(i);
                if (!fav.contains(r.getInt("id")) || r.getString("datum").compareTo(bis) <= 0 || r.getInt("platz") > 3) continue;
                zeilen.add(String.format(Locale.GERMANY, "%s %s: %s %s %s – %s (seit %d)",
                    kurz(r.getString("datum")), r.getString("name"), r.getString("kategorie"),
                    zahl(r.getDouble("wert")), r.getString("einheit"),
                    r.getInt("platz") == 1 ? "neuer Rekord" : "Platz " + r.getInt("platz"), r.getInt("seit")));
            }
            JSONArray k = d.optJSONArray("kalendertag");
            for (int i = 0; k != null && i < k.length(); i++) {
                JSONObject r = k.getJSONObject(i);
                if (!fav.contains(r.getInt("id")) || r.getString("datum").compareTo(bis) <= 0) continue;
                zeilen.add(String.format(Locale.GERMANY, "%s %s: %s %s %s – Rekord für diesen Kalendertag (%d Jahre)",
                    kurz(r.getString("datum")), r.getString("name"), r.getString("kategorie"),
                    zahl(r.getDouble("wert")), r.getString("einheit"), r.getInt("jahre")));
            }
            if (!zeilen.isEmpty()) {
                String titel = zeilen.size() == 1 ? "Neuer Rekord an einem Favoriten" : zeilen.size() + " neue Rekorde an deinen Favoriten";
                Meldung.senden(c, Meldung.KANAL_REKORDE, 201, titel, zeilen.get(0), zeilen);
            }
            p.edit().putString("rekorde_bis", stand).apply();
            return Result.success();
        } catch (Exception ex) {
            return Result.retry();
        }
    }

    private static String kurz(String iso) {
        return iso.substring(8, 10) + "." + iso.substring(5, 7) + ".";
    }

    private static String zahl(double v) {
        return String.format(Locale.GERMANY, "%.1f", v);
    }

    /** iso-Datum minus n Tage */
    private static String tageVor(String iso, int n) {
        java.util.Calendar c = java.util.Calendar.getInstance(Vorhersage.UTC, Locale.ROOT);
        c.clear();
        c.set(Integer.parseInt(iso.substring(0, 4)), Integer.parseInt(iso.substring(5, 7)) - 1, Integer.parseInt(iso.substring(8, 10)));
        c.add(java.util.Calendar.DAY_OF_MONTH, -n);
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(java.util.Calendar.YEAR),
            c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH));
    }
}
