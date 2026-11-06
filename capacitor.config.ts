import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Configuración de Capacitor para empaquetar LoreKeeper como app Android.
 *
 * - webDir: carpeta de artefactos web generados por `npm run build` (Vite).
 * - StatusBar: fondo oscuro acorde al tema zinc-950, texto claro, superpuesta
 *   para una vista inmersiva a pantalla completa.
 * - Keyboard: reajusta el contenido (resize nativo) y usa estilo oscuro.
 * - SocialLogin: login nativo de Google (Drive) en Android. `webClientId`
 *   actúa como serverClientId; DEBE coincidir con GOOGLE_CLIENT_ID de
 *   `src/config/drive.ts`.
 */

// Client ID web de Google (serverClientId). Debe coincidir con src/config/drive.ts
const GOOGLE_WEB_CLIENT_ID =
  '979552499340-rsb4c8i7ht6aioga9pitbjf8roasiuo0.apps.googleusercontent.com'

const config: CapacitorConfig = {
  appId: 'com.lorekeeper.app',
  appName: 'LoreKeeper',
  webDir: 'dist',
  backgroundColor: '#09090b',
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#09090b',
    },
    Keyboard: {
      resize: 'native',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
    SocialLogin: {
      google: {
        webClientId: GOOGLE_WEB_CLIENT_ID,
      },
    },
  },
}

export default config
