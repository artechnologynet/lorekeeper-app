/**
 * Configuración de la integración con Google Drive.
 *
 * El Client ID se toma de la variable de entorno VITE_GOOGLE_CLIENT_ID; si no
 * está definida, se usa el fallback acordado. El scope se limita a `drive.file`
 * (acceso exclusivo a los archivos creados por la propia app: mínimo privilegio).
 */

const FALLBACK_CLIENT_ID =
  '979552499340-rsb4c8i7ht6aioga9pitbjf8roasiuo0.apps.googleusercontent.com'

/** Client ID de OAuth de Google para GIS. */
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ?? FALLBACK_CLIENT_ID

/** Scope mínimo: solo archivos creados por LoreKeeper. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

/** Nombre de la carpeta raíz del proyecto en el Drive del usuario. */
export const DRIVE_ROOT_FOLDER = 'LoreKeeper'

/** URL del SDK de Google Identity Services. */
export const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
