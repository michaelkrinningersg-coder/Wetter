package app.wetter.station;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // eigene Brücke für Widget und Meldungen (WetterNativ.java)
        registerPlugin(WetterNativ.class);
        super.onCreate(savedInstanceState);
    }
}
