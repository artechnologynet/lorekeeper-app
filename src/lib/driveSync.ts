/**
 * Sincronización con Google Drive.
 *
 * - Autorización por plataforma:
 *   · Web: Google Identity Services (GIS), popup con scope `drive.file`.
 *   · Android nativo (Capacitor): plugin @capgo/capacitor-social-login, que
 *     abre la hoja nativa de Google y devuelve un access_token válido para la
 *     API REST de Drive (evita el redirect a localhost en Chrome Custom Tabs).
 * - El access_token se mantiene SOLO en memoria; en LocalStorage se persiste
 *   únicamente el estado conectado (email) y la fecha de última sincronización.
 * - El resto del flujo (subir/restaurar) es idéntico: usa el token inyectado
 *   contra la API REST de Drive v3.
 */

import { Capacitor } from '@capacitor/core'
import { SocialLogin } from '@capgo/capacitor-social-login'
import type { LoreKeeperData } from '../types'
import { serializeBackup } from './storage'
import {
  annexToMarkdown,
  buildReadmeMarkdown,
  entityToMarkdown,
  glossaryToMarkdown,
  sanitizeFilename,
} from './loreBible'
import {
  DRIVE_ROOT_FOLDER,
  DRIVE_SCOPE,
  GIS_SCRIPT_SRC,
  GOOGLE_CLIENT_ID,
} from '../config/drive'
import type { GisTokenClient, GisTokenResponse } from '../types/google-gis'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

const STATE_KEY = 'lorekeeper:drive-state:v1'

/**
 * Serializa un error desconocido en un texto legible para diagnóstico. Expone
 * message, code y el JSON completo para ver códigos nativos de Android
 * (p. ej. 10 = DEVELOPER_ERROR/SHA-1, 12500 = SIGN_IN_FAILED, 12501 = cancelado).
 */
function describeError(err: unknown): string {
  const parts: string[] = []
  if (err && typeof err === 'object') {
    const anyErr = err as { message?: unknown; code?: unknown; errorMessage?: unknown }
    if (anyErr.message) parts.push(`message: ${String(anyErr.message)}`)
    if (anyErr.errorMessage) parts.push(`errorMessage: ${String(anyErr.errorMessage)}`)
    if (anyErr.code !== undefined) parts.push(`code: ${String(anyErr.code)}`)
    try {
      const json = JSON.stringify(err, Object.getOwnPropertyNames(err as object))
      if (json && json !== '{}') parts.push(`raw: ${json}`)
    } catch {
      // Ignora si no es serializable.
    }
  } else if (err !== undefined && err !== null) {
    parts.push(String(err))
  }
  return parts.length > 0 ? parts.join(' | ') : 'Error desconocido (sin detalle).'
}

/* -------------------------------------------------------------------------- */
/* Estado persistido (sin token: el token vive en memoria)                    */
/* -------------------------------------------------------------------------- */

export interface DriveState {
  email: string
  lastSync: string | null // ISO 8601 o null
}

export function loadDriveState(): DriveState | null {
  try {
    const raw = window.localStorage.getItem(STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DriveState
    if (typeof parsed.email !== 'string') return null
    return { email: parsed.email, lastSync: parsed.lastSync ?? null }
  } catch {
    return null
  }
}

function saveDriveState(state: DriveState): void {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    // Ignora fallos de almacenamiento.
  }
}

function clearDriveState(): void {
  try {
    window.localStorage.removeItem(STATE_KEY)
  } catch {
    // Ignora.
  }
}

/* -------------------------------------------------------------------------- */
/* Token en memoria + carga del SDK GIS                                       */
/* -------------------------------------------------------------------------- */

let accessToken: string | null = null
let tokenClient: GisTokenClient | null = null
let gisLoading: Promise<void> | null = null

/** Carga el script de GIS una sola vez. */
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoading) return gisLoading

  gisLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_SRC}"]`,
    )
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('GIS load error')))
      // Si ya estaba cargado.
      if (window.google?.accounts?.oauth2) resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services.'))
    document.head.appendChild(script)
  })
  return gisLoading
}

export type DriveResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/* -------------------------------------------------------------------------- */
/* Conexión / desconexión                                                     */
/* -------------------------------------------------------------------------- */

/** Obtiene un access_token vía GIS (flujo Web, popup). */
async function requestTokenWeb(): Promise<DriveResult<string>> {
  try {
    await loadGis()
  } catch {
    return { ok: false, error: 'No se pudo cargar el SDK de Google. Revisa tu conexión.' }
  }

  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) {
    return { ok: false, error: 'Google Identity Services no está disponible.' }
  }

  const token = await new Promise<string | null>((resolve) => {
    tokenClient = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (response: GisTokenResponse) => resolve(response.access_token ?? null),
      error_callback: () => resolve(null),
    })
    tokenClient.requestAccessToken({ prompt: '' })
  })

  if (!token) return { ok: false, error: 'No se autorizó el acceso a Google Drive.' }
  return { ok: true, data: token }
}

// Evita reinicializar el plugin nativo más de una vez por sesión.
let nativeInitialized = false

/**
 * Obtiene un access_token mediante el login NATIVO de Google (Android), usando
 * @capgo/capacitor-social-login. El scope `drive.file` se solicita en el login,
 * y el webClientId (serverClientId) se toma de capacitor.config.ts.
 */
async function requestTokenNative(): Promise<DriveResult<string>> {
  // 1. Validación del webClientId en runtime (detecta undefined/vacío en build
  //    de producción por VITE_GOOGLE_CLIENT_ID no inyectada).
  const clientId = (GOOGLE_CLIENT_ID ?? '').trim()
  if (clientId.length === 0) {
    return {
      ok: false,
      error:
        'webClientId vacío o undefined en tiempo de ejecución. Revisa VITE_GOOGLE_CLIENT_ID / config/drive.ts.',
    }
  }

  // 2. Inicialización del plugin (error separado para distinguir del login).
  if (!nativeInitialized) {
    try {
      await SocialLogin.initialize({
        google: { webClientId: clientId, mode: 'online' },
      })
      nativeInitialized = true
    } catch (err) {
      return {
        ok: false,
        error: `Fallo al inicializar Google (initialize). ${describeError(err)}`,
      }
    }
  }

  // 3. Login nativo.
  try {
    const { result } = await SocialLogin.login({
      provider: 'google',
      options: { scopes: [DRIVE_SCOPE] },
    })

    if (result.responseType !== 'online') {
      return { ok: false, error: 'La sesión de Google no devolvió un token de acceso (modo no online).' }
    }
    const token = result.accessToken?.token
    if (!token) {
      return {
        ok: false,
        error: 'Google no devolvió access_token. Revisa el scope drive.file y la credencial Android (SHA-1).',
      }
    }
    return { ok: true, data: token }
  } catch (err) {
    // Propaga el detalle NATIVO completo para diagnóstico (code, message, raw).
    return {
      ok: false,
      error: `Login Google falló. ${describeError(err)}`,
    }
  }
}

/**
 * Inicia sesión con Google Drive. Bifurca por plataforma:
 *   - Web/navegador: GIS (popup).
 *   - Android nativo (Capacitor): plugin de login nativo.
 * Inyecta el access_token en memoria y resuelve el email del usuario.
 */
export async function connectGoogleDrive(): Promise<DriveResult<DriveState>> {
  const tokenResult = Capacitor.isNativePlatform()
    ? await requestTokenNative()
    : await requestTokenWeb()

  if (!tokenResult.ok) return tokenResult

  // Inyecta el token en el servicio (memoria) para todas las llamadas REST.
  accessToken = tokenResult.data

  // Obtiene el email del usuario (mismo endpoint en ambas plataformas).
  let email = 'Cuenta de Google'
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.ok) {
      const info = (await res.json()) as { email?: string }
      if (info.email) email = info.email
    }
  } catch {
    // Mantiene el email por defecto si falla userinfo.
  }

  const existing = loadDriveState()
  const state: DriveState = { email, lastSync: existing?.lastSync ?? null }
  saveDriveState(state)
  return { ok: true, data: state }
}

/** Revoca/cierra la sesión (según plataforma) y limpia el estado persistido. */
export function disconnectGoogleDrive(): void {
  if (Capacitor.isNativePlatform()) {
    // Cierre de sesión nativo (best-effort, no bloqueante).
    void SocialLogin.logout({ provider: 'google' }).catch(() => undefined)
  } else if (accessToken && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(accessToken)
    } catch {
      // Ignora errores de revocación.
    }
  }
  accessToken = null
  tokenClient = null
  clearDriveState()
}

/** ¿Hay un token de acceso en memoria para esta sesión? */
export function hasActiveToken(): boolean {
  return accessToken !== null
}

/* -------------------------------------------------------------------------- */
/* Llamadas a la API de Drive v3                                              */
/* -------------------------------------------------------------------------- */

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${accessToken ?? ''}` }
}

/** Busca una carpeta por nombre (opcionalmente dentro de un padre). */
async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const clauses = [
    `name='${name.replace(/'/g, "\\'")}'`,
    `mimeType='${FOLDER_MIME}'`,
    'trashed=false',
  ]
  if (parentId) clauses.push(`'${parentId}' in parents`)
  const q = encodeURIComponent(clauses.join(' and '))
  const url = `${DRIVE_API}/files?q=${q}&fields=files(id,name)&spaces=drive`

  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`Drive query failed (${res.status})`)
  const body = (await res.json()) as { files?: { id: string }[] }
  return body.files && body.files.length > 0 ? body.files[0].id : null
}

/** Crea una carpeta (opcionalmente dentro de un padre) y devuelve su id. */
async function createFolder(name: string, parentId?: string): Promise<string> {
  const metadata: Record<string, unknown> = { name, mimeType: FOLDER_MIME }
  if (parentId) metadata.parents = [parentId]

  const res = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  if (!res.ok) throw new Error(`Drive folder create failed (${res.status})`)
  const body = (await res.json()) as { id: string }
  return body.id
}

/** Obtiene (o crea si no existe) una carpeta por nombre. */
async function ensureFolder(name: string, parentId?: string): Promise<string> {
  const existing = await findFolder(name, parentId)
  return existing ?? (await createFolder(name, parentId))
}

/** Busca un archivo por nombre dentro de una carpeta. Devuelve su id o null. */
async function findFile(name: string, parentId: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`,
  )
  const url = `${DRIVE_API}/files?q=${q}&fields=files(id,name)&spaces=drive`
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`Drive file query failed (${res.status})`)
  const body = (await res.json()) as { files?: { id: string }[] }
  return body.files && body.files.length > 0 ? body.files[0].id : null
}

/**
 * Sube (crea o actualiza) un archivo de texto dentro de una carpeta, mediante
 * upload multipart. Hace upsert buscando por nombre dentro de la carpeta.
 */
async function upsertTextFile(
  name: string,
  content: string,
  parentId: string,
  mimeType: string,
): Promise<void> {
  const existingId = await findFile(name, parentId)
  const boundary = `lk_${Math.random().toString(36).slice(2)}`

  const metadata: Record<string, unknown> = { name, mimeType }
  if (!existingId) metadata.parents = [parentId]

  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`

  const method = existingId ? 'PATCH' : 'POST'
  const url = existingId
    ? `${DRIVE_UPLOAD}/files/${existingId}?uploadType=multipart&fields=id`
    : `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`

  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders(),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) throw new Error(`Drive upload failed (${res.status})`)
}

/* -------------------------------------------------------------------------- */
/* Subir copia a Google Drive                                                 */
/* -------------------------------------------------------------------------- */

/** Nombres de archivo únicos dentro de una carpeta. */
function makeUniqueNamer() {
  const used = new Set<string>()
  return (base: string, ext: string): string => {
    let candidate = `${base}.${ext}`
    let n = 2
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base}_${n}.${ext}`
      n += 1
    }
    used.add(candidate.toLowerCase())
    return candidate
  }
}

/**
 * Sube/actualiza todo el proyecto a la carpeta "LoreKeeper" del Drive del
 * usuario: backup maestro + archivos legibles por categoría. Actualiza la
 * fecha de última sincronización.
 */
export async function uploadToDrive(
  data: LoreKeeperData,
): Promise<DriveResult<DriveState>> {
  if (!accessToken) {
    return { ok: false, error: 'No hay sesión de Google Drive. Conéctate primero.' }
  }

  try {
    const rootId = await ensureFolder(DRIVE_ROOT_FOLDER)

    // 1. Backup maestro.
    await upsertTextFile(
      'lorekeeper_backup.json',
      serializeBackup(data),
      rootId,
      'application/json',
    )

    // 2. README en la raíz.
    await upsertTextFile('README.md', buildReadmeMarkdown(data), rootId, 'text/markdown')

    // 3. Manuscritos (.txt).
    if (data.manuscripts.length > 0) {
      const folder = await ensureFolder('Manuscritos', rootId)
      const namer = makeUniqueNamer()
      for (const doc of data.manuscripts) {
        const name = namer(sanitizeFilename(doc.title), 'txt')
        await upsertTextFile(name, doc.content ?? '', folder, 'text/plain')
      }
    }

    // 4. Fichas de entidades (.md).
    if (data.entities.length > 0) {
      const folder = await ensureFolder('Fichas_Entidades', rootId)
      const namer = makeUniqueNamer()
      for (const entity of data.entities) {
        const name = namer(sanitizeFilename(entity.name), 'md')
        await upsertTextFile(name, entityToMarkdown(entity), folder, 'text/markdown')
      }
    }

    // 5. Glosario (.md único).
    if (data.glossary.length > 0) {
      const folder = await ensureFolder('Glosario', rootId)
      await upsertTextFile(
        'glosario_completo.md',
        glossaryToMarkdown(data.glossary),
        folder,
        'text/markdown',
      )
    }

    // 6. Compendio (.md).
    if (data.compendium.length > 0) {
      const folder = await ensureFolder('Compendio', rootId)
      const namer = makeUniqueNamer()
      for (const annex of data.compendium) {
        const name = namer(sanitizeFilename(annex.title), 'md')
        await upsertTextFile(name, annexToMarkdown(annex), folder, 'text/markdown')
      }
    }

    const state: DriveState = {
      email: loadDriveState()?.email ?? 'Cuenta de Google',
      lastSync: new Date().toISOString(),
    }
    saveDriveState(state)
    return { ok: true, data: state }
  } catch {
    return {
      ok: false,
      error: 'Error al sincronizar con Google Drive. Inténtalo de nuevo.',
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Subida de archivos binarios (p. ej. .docx)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Garantiza una sesión de Drive utilizable. El token solo vive en memoria, así
 * que si la app recuerda la cuenta pero se perdió el token (p. ej. tras
 * reiniciar), vuelve a autorizar. Debe invocarse directamente desde un gesto
 * del usuario (clic) para que los popups web no sean bloqueados.
 */
export async function ensureDriveSession(): Promise<DriveResult> {
  if (accessToken) return { ok: true, data: undefined }
  const connected = await connectGoogleDrive()
  if (!connected.ok) return connected
  return { ok: true, data: undefined }
}

/**
 * Sube (crea o reemplaza por nombre) un archivo binario en la carpeta raíz
 * "LoreKeeper" de Drive mediante upload multipart. Devuelve el nombre subido.
 */
export async function uploadBinaryToDrive(
  filename: string,
  blob: Blob,
  mimeType: string,
): Promise<DriveResult<string>> {
  if (!accessToken) {
    return { ok: false, error: 'No hay sesión de Google Drive. Conéctate primero.' }
  }

  try {
    const rootId = await ensureFolder(DRIVE_ROOT_FOLDER)
    const existingId = await findFile(filename, rootId)
    const boundary = `lk_${Math.random().toString(36).slice(2)}`

    const metadata: Record<string, unknown> = { name: filename, mimeType }
    if (!existingId) metadata.parents = [rootId]

    // Cuerpo multipart armado como Blob para conservar los bytes del archivo.
    const body = new Blob([
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      `${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ])

    const url = existingId
      ? `${DRIVE_UPLOAD}/files/${existingId}?uploadType=multipart&fields=id`
      : `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`

    const res = await fetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })
    if (!res.ok) throw new Error(`Drive upload failed (${res.status})`)
    return { ok: true, data: filename }
  } catch {
    return {
      ok: false,
      error: 'No se pudo guardar el documento en Google Drive. Inténtalo de nuevo.',
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Restaurar desde Google Drive                                               */
/* -------------------------------------------------------------------------- */

/**
 * Descarga el contenido de lorekeeper_backup.json de la carpeta "LoreKeeper".
 * Devuelve el JSON como texto (el llamador lo valida/importa y confirma antes).
 */
export async function downloadBackupFromDrive(): Promise<DriveResult<string>> {
  if (!accessToken) {
    return { ok: false, error: 'No hay sesión de Google Drive. Conéctate primero.' }
  }

  try {
    const rootId = await findFolder(DRIVE_ROOT_FOLDER)
    if (!rootId) {
      return { ok: false, error: 'No se encontró la carpeta "LoreKeeper" en tu Drive.' }
    }

    const fileId = await findFile('lorekeeper_backup.json', rootId)
    if (!fileId) {
      return {
        ok: false,
        error: 'No se encontró un respaldo (lorekeeper_backup.json) en Drive.',
      }
    }

    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error(`Drive download failed (${res.status})`)

    const text = await res.text()
    // Validación mínima: debe parsear como JSON.
    try {
      JSON.parse(text)
    } catch {
      return { ok: false, error: 'El respaldo de Drive está dañado o no es válido.' }
    }
    return { ok: true, data: text }
  } catch {
    return {
      ok: false,
      error: 'Error al descargar el respaldo desde Google Drive.',
    }
  }
}

/** Actualiza en memoria y persiste la última fecha de sync (helper público). */
export function touchLastSync(): DriveState | null {
  const current = loadDriveState()
  if (!current) return null
  const updated: DriveState = { ...current, lastSync: new Date().toISOString() }
  saveDriveState(updated)
  return updated
}
