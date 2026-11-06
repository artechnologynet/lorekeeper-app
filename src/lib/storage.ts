/**
 * Utilidades de almacenamiento local (localStorage) con serialización segura.
 *
 * Centraliza la lectura/escritura del estado de la app para que los componentes
 * no interactúen con localStorage directamente. Incluye:
 *   - Carga y guardado del proyecto completo (entidades, glosario, anexos,
 *     manuscritos, conversación y ajustes).
 *   - Exportación del estado como archivo descargable "lorekeeper_backup.json".
 *   - Importación/validación de un backup, con modos reemplazar o fusionar.
 *   - Guardado/lectura segura de la API Key de Gemini.
 */

import type {
  AppSettings,
  EntitySheet,
  LoreKeeperData,
  Manuscript,
} from '../types'
import { coerceEntityRole, defaultSettings } from '../types'

/** Garantiza que cada manuscrito tenga un status válido (compat. versiones). */
function normalizeManuscripts(list: unknown): Manuscript[] {
  if (!Array.isArray(list)) return []
  return list.map((m) => {
    const doc = m as Manuscript
    const status =
      doc.status === 'pending' || doc.status === 'analyzed' ? doc.status : 'draft'
    return { ...doc, status }
  })
}

/**
 * Normaliza entidades de versiones previas: asegura `role` como enum válido y
 * `narrativeRole` presente. Si el `role` antiguo era texto libre no canónico,
 * lo preserva como `narrativeRole` y asigna el rol estructural por defecto.
 */
function normalizeEntities(list: unknown): EntitySheet[] {
  if (!Array.isArray(list)) return []
  return list.map((e) => {
    const ent = e as EntitySheet & { role?: unknown; narrativeRole?: unknown }
    const rawRole = ent.role
    const canonicalRole = coerceEntityRole(rawRole)
    // Si el role previo no era canónico y no hay narrativeRole, consérvalo ahí.
    const narrativeRole =
      typeof ent.narrativeRole === 'string' && ent.narrativeRole.length > 0
        ? ent.narrativeRole
        : typeof rawRole === 'string' && canonicalRole === 'Otro' && rawRole !== 'Otro'
          ? rawRole
          : ''
    return { ...ent, role: canonicalRole, narrativeRole }
  })
}

const STORAGE_KEY = 'lorekeeper:data:v1'
const API_KEY_STORAGE_KEY = 'lorekeeper:gemini-api-key:v1'
const BACKUP_FILENAME = 'lorekeeper_backup.json'

/** Estado inicial vacío de la aplicación. */
export const emptyData: LoreKeeperData = {
  manuscripts: [],
  entities: [],
  glossary: [],
  compendium: [],
  conversation: [],
  settings: { ...defaultSettings },
}

/** Indica si el entorno dispone de localStorage (SSR / tests). */
function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window
  } catch {
    return false
  }
}

/** Devuelve una copia profunda y segura del estado vacío. */
function freshEmptyData(): LoreKeeperData {
  return {
    manuscripts: [],
    entities: [],
    glossary: [],
    compendium: [],
    conversation: [],
    settings: { ...defaultSettings },
  }
}

/**
 * Normaliza datos parciales (p. ej. de versiones previas o de un backup) contra
 * el estado vacío, garantizando que todos los arreglos y los ajustes existan.
 */
function normalizeData(partial: Partial<LoreKeeperData> | null | undefined): LoreKeeperData {
  const base = freshEmptyData()
  if (!partial || typeof partial !== 'object') return base

  return {
    manuscripts: normalizeManuscripts(partial.manuscripts),
    entities: normalizeEntities(partial.entities),
    glossary: Array.isArray(partial.glossary) ? partial.glossary : base.glossary,
    compendium: Array.isArray(partial.compendium) ? partial.compendium : base.compendium,
    conversation: Array.isArray(partial.conversation) ? partial.conversation : base.conversation,
    settings: {
      ...base.settings,
      ...(partial.settings && typeof partial.settings === 'object' ? partial.settings : {}),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Carga / guardado del estado completo                                       */
/* -------------------------------------------------------------------------- */

/**
 * Lee el estado persistido. Si no existe o está corrupto, devuelve el estado
 * vacío sin lanzar excepciones. La API key se rehidrata desde su clave propia.
 */
export function loadData(): LoreKeeperData {
  if (!hasStorage()) return freshEmptyData()

  let data: LoreKeeperData
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    data = raw ? normalizeData(JSON.parse(raw) as Partial<LoreKeeperData>) : freshEmptyData()
  } catch {
    data = freshEmptyData()
  }

  // La API key se guarda en una entrada separada; tiene prioridad sobre la del blob.
  const storedKey = loadApiKey()
  if (storedKey) {
    data.settings.geminiApiKey = storedKey
  }

  return data
}

/**
 * Persiste el estado completo. La API key se guarda tanto dentro del blob como
 * en su entrada dedicada para lectura rápida/aislada. Devuelve true si tuvo éxito.
 */
export function saveData(data: LoreKeeperData): boolean {
  if (!hasStorage()) return false

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    saveApiKey(data.settings.geminiApiKey)
    return true
  } catch {
    return false
  }
}

/** Elimina todo el estado persistido (incluida la API key). */
export function clearData(): boolean {
  if (!hasStorage()) return false

  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(API_KEY_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* API Key (lectura/guardado aislado)                                         */
/* -------------------------------------------------------------------------- */

/** Guarda la API key de Gemini de forma aislada. Cadena vacía la elimina. */
export function saveApiKey(apiKey: string): boolean {
  if (!hasStorage()) return false

  try {
    if (apiKey && apiKey.trim().length > 0) {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim())
    } else {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY)
    }
    return true
  } catch {
    return false
  }
}

/** Lee la API key de Gemini almacenada de forma aislada. */
export function loadApiKey(): string {
  if (!hasStorage()) return ''

  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/* -------------------------------------------------------------------------- */
/* Exportación de respaldo                                                    */
/* -------------------------------------------------------------------------- */

/** Estructura del archivo de respaldo descargable. */
export interface BackupFile {
  app: 'lorekeeper'
  version: 1
  exportedAt: string
  /** Identidad de la obra, replicada en la raíz para lectura rápida. */
  projectTitle: string
  authorName: string
  data: LoreKeeperData
}

/**
 * Serializa el estado como respaldo JSON. Por seguridad, la API key NO se
 * incluye en el archivo descargable (se vacía en la copia exportada).
 */
export function serializeBackup(data: LoreKeeperData): string {
  const sanitizedSettings: AppSettings = { ...data.settings, geminiApiKey: '' }
  const backup: BackupFile = {
    app: 'lorekeeper',
    version: 1,
    exportedAt: new Date().toISOString(),
    projectTitle: data.settings.projectTitle,
    authorName: data.settings.authorName,
    data: { ...data, settings: sanitizedSettings },
  }
  return JSON.stringify(backup, null, 2)
}

/**
 * Exporta todo el estado actual como archivo descargable
 * "lorekeeper_backup.json". Devuelve true si se disparó la descarga.
 */
export function exportBackup(data: LoreKeeperData): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false

  try {
    const json = serializeBackup(data)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = BACKUP_FILENAME
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)

    // Libera el objeto URL tras un breve margen para asegurar la descarga.
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* Importación de respaldo                                                    */
/* -------------------------------------------------------------------------- */

/** Resultado de una importación de respaldo. */
export type ImportResult =
  | { ok: true; data: LoreKeeperData }
  | { ok: false; error: string }

/** Modo de importación: reemplazar todo o fusionar con lo existente. */
export type ImportMode = 'replace' | 'merge'

/** Comprueba que un objeto tenga la forma mínima de un backup válido. */
function looksLikeBackup(value: unknown): value is BackupFile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.app === 'lorekeeper' && typeof candidate.data === 'object' && candidate.data !== null
}

/** Fusiona dos conjuntos de registros por id (el entrante gana en conflicto). */
function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of current) map.set(item.id, item)
  for (const item of incoming) map.set(item.id, item)
  return Array.from(map.values())
}

/**
 * Parsea y valida el contenido de un backup JSON. En modo 'merge' combina con
 * el estado actual (por id); en modo 'replace' sustituye por completo.
 *
 * La API key existente nunca se sobrescribe por la importación (el backup no la
 * contiene), de modo que el usuario conserva su BYOK local.
 */
export function importBackup(
  jsonText: string,
  current: LoreKeeperData,
  mode: ImportMode = 'replace',
): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' }
  }

  // Acepta tanto el envoltorio BackupFile como un LoreKeeperData directo.
  let incomingData: Partial<LoreKeeperData> | null = null
  if (looksLikeBackup(parsed)) {
    incomingData = parsed.data as Partial<LoreKeeperData>
  } else if (parsed && typeof parsed === 'object') {
    incomingData = parsed as Partial<LoreKeeperData>
  }

  if (!incomingData) {
    return { ok: false, error: 'El archivo no tiene el formato de un respaldo de LoreKeeper.' }
  }

  const incoming = normalizeData(incomingData)

  // Preserva la API key local actual (el backup no la trae).
  incoming.settings.geminiApiKey = current.settings.geminiApiKey

  if (mode === 'replace') {
    return { ok: true, data: incoming }
  }

  // mode === 'merge'
  const merged: LoreKeeperData = {
    manuscripts: mergeById(current.manuscripts, incoming.manuscripts),
    entities: mergeById(current.entities, incoming.entities),
    glossary: mergeById(current.glossary, incoming.glossary),
    compendium: mergeById(current.compendium, incoming.compendium),
    conversation: mergeById(current.conversation, incoming.conversation),
    // Para ajustes, los entrantes ganan salvo la API key, ya preservada arriba.
    settings: { ...incoming.settings },
  }

  return { ok: true, data: merged }
}
