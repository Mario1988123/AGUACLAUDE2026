package es.hidromanager.crm;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        crearCanalDeAvisos();
    }

    /**
     * Canal de notificaciones "Avisos" (Android 8+). Se crea aqui, y no solo
     * desde la web, para que exista aunque la primera notificacion llegue antes
     * de que cargue la pagina. Crear un canal que ya existe no hace nada, y el
     * usuario conserva los ajustes que le haya puesto.
     */
    private void crearCanalDeAvisos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager gestor = getSystemService(NotificationManager.class);
        if (gestor == null) return;
        NotificationChannel canal = new NotificationChannel(
            getString(R.string.canal_avisos_id),
            getString(R.string.canal_avisos_nombre),
            NotificationManager.IMPORTANCE_HIGH
        );
        canal.setDescription(getString(R.string.canal_avisos_descripcion));
        canal.enableVibration(true);
        gestor.createNotificationChannel(canal);
    }
}
