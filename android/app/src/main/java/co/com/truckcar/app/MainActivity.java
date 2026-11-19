package co.com.truckcar.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin propio (no viene de npm): escucha de la frase de activación del Copiloto con Vosk.
        registerPlugin(WakeWord.class);
        super.onCreate(savedInstanceState);
    }
}
