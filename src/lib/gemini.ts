/**
 * Cliente mínimo para la API de Google Gemini (Generative Language API).
 *
 * Solo implementa lo necesario para el flujo BYOK (Bring Your Own Key):
 * un "ping" ligero que verifica si una API key es válida y si el modelo
 * seleccionado está disponible para esa clave.
 *
 * La clave se envía como parámetro de consulta `key`, tal como espera la
 * Generative Language API pública. No se registra ni se transmite a ningún
 * otro destino.
 */

import type { GeminiModel } from '../types'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Modo del asistente: define temperatura y comportamiento. */
export type AssistantMode = 'strict' | 'creative'

/** Temperatura adaptativa según el modo. */
export const MODE_TEMPERATURE: Record<AssistantMode, number> = {
  strict: 0.1,
  creative: 0.65,
}

/** Resultado de la verificación de la API key. */
export type ApiKeyCheckResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/** Turno de conversación en el formato que consume la API. */
export interface ChatTurn {
  role: 'user' | 'model'
  text: string
}

/** Resultado de una generación de contenido. */
export type GenerateResult =
  | { ok: true; text: string }
  | { ok: false; error: string; errorKind?: GeminiErrorKind }

/** Forma mínima del cuerpo de respuesta de generateContent. */
interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string; status?: string }
}

/* -------------------------------------------------------------------------- */
/* Clasificación de errores de la API de Gemini                               */
/* -------------------------------------------------------------------------- */

/** Tipos de error reconocidos para dar un trato diferenciado. */
export type GeminiErrorKind =
  | 'HIGH_DEMAND' // 503 UNAVAILABLE o 429 por RPM/concurrencia breve → reintentar
  | 'DAILY_QUOTA_EXCEEDED' // 429 cuota diaria Free Tier → NO reintentar
  | 'AUTH_ERROR' // 400/401/403 clave inválida o sin permisos
  | 'GENERIC' // cualquier otro

/** Mensajes al usuario por tipo de error. */
export const ERROR_MESSAGES: Record<GeminiErrorKind, string> = {
  HIGH_DEMAND:
    'El modelo seleccionado presenta alta demanda temporal en los servidores de Google. Intenta de nuevo en unos momentos o selecciona un modelo alternativo en Ajustes.',
  DAILY_QUOTA_EXCEEDED:
    'Has agotado el límite de peticiones diarias gratuitas para este modelo. Por favor cambia a otro modelo en Ajustes (como las versiones Lite) o utiliza una API key con facturación.',
  AUTH_ERROR: 'API key inválida o sin permisos para este modelo. Revisa tu clave en Ajustes.',
  GENERIC: 'Ocurrió un error al comunicarse con Gemini. Inténtalo de nuevo.',
}

/** Compatibilidad: alias del mensaje de alta demanda (usado en otros módulos). */
export const HIGH_DEMAND_MESSAGE = ERROR_MESSAGES.HIGH_DEMAND

/** Forma parcial del cuerpo de error de la Generative Language API. */
interface GeminiErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: Array<{
      '@type'?: string
      retryDelay?: string
      violations?: Array<{ quotaId?: string; quotaMetric?: string }>
    }>
  }
}

/** Extrae el retryDelay en segundos de los details (si existe). */
function extractRetryDelaySeconds(body: GeminiErrorBody | null): number | null {
  const details = body?.error?.details
  if (!Array.isArray(details)) return null
  for (const d of details) {
    if (typeof d.retryDelay === 'string') {
      // Formato típico "54s" o "3600s".
      const m = /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay.trim())
      if (m) return parseFloat(m[1])
    }
  }
  return null
}

/** Serializa todos los quotaId/metric/@type de los details para inspección. */
function detailsText(body: GeminiErrorBody | null): string {
  const details = body?.error?.details
  if (!Array.isArray(details)) return ''
  const parts: string[] = []
  for (const d of details) {
    if (d['@type']) parts.push(d['@type'])
    if (Array.isArray(d.violations)) {
      for (const v of d.violations) {
        if (v.quotaId) parts.push(v.quotaId)
        if (v.quotaMetric) parts.push(v.quotaMetric)
      }
    }
  }
  return parts.join(' ').toLowerCase()
}

/**
 * Clasifica un error de la API de Gemini a partir del status HTTP y el cuerpo
 * JSON de error. Distingue alta demanda temporal (reintentar) de cuota diaria
 * del Free Tier agotada (no reintentar).
 */
export function parseGeminiError(
  httpStatus: number,
  body: GeminiErrorBody | null,
): GeminiErrorKind {
  // Errores de autenticación/permisos.
  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403) {
    return 'AUTH_ERROR'
  }

  // 503: alta demanda / servicio no disponible.
  if (httpStatus === 503) return 'HIGH_DEMAND'

  if (httpStatus === 429) {
    const msg = (body?.error?.message ?? '').toLowerCase()
    const details = detailsText(body)
    const retrySeconds = extractRetryDelaySeconds(body)

    // Señales INEQUÍVOCAS de cuota diaria del Free Tier agotada.
    const dailyQuotaSignals =
      msg.includes('per day') ||
      msg.includes('perday') ||
      msg.includes('limit exceeded on free tier') ||
      msg.includes('quota exceeded for metric') ||
      details.includes('perday') ||
      details.includes('freetier') ||
      details.includes('quotafailure')

    // retryDelay de varias horas (>60s) también indica límite diario.
    const longRetry = retrySeconds !== null && retrySeconds > 60

    if (dailyQuotaSignals || longRetry) return 'DAILY_QUOTA_EXCEEDED'

    // 429 por RPM / concurrencia breve → alta demanda (reintentar).
    return 'HIGH_DEMAND'
  }

  return 'GENERIC'
}

/* -------------------------------------------------------------------------- */
/* Tolerancia a fallos: reintentos con backoff exponencial                    */
/* -------------------------------------------------------------------------- */

/** Retrasos (ms) entre reintentos: 2 s, luego 4 s (backoff exponencial). */
const RETRY_DELAYS_MS = [2000, 4000]

/** Espera `ms` milisegundos, cancelable mediante AbortSignal. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Resultado de una petición con reintentos. */
interface FetchOutcome {
  response: Response
  /** Cuerpo JSON parseado (sea éxito o error); null si no era JSON. */
  json: unknown
  /** Tipo de error clasificado (solo relevante si !response.ok). */
  errorKind: GeminiErrorKind | null
}

/**
 * Ejecuta un POST a la API de Gemini con reintentos SOLO ante alta demanda
 * (HIGH_DEMAND: 503 o 429 por RPM/concurrencia), con backoff exponencial (2 s,
 * 4 s). NUNCA reintenta ante cuota diaria agotada (DAILY_QUOTA_EXCEEDED) ni ante
 * errores de autenticación.
 *
 * Lee y devuelve el cuerpo JSON ya parseado para que el llamador no lo re-lea.
 * Propaga AbortError (cancelación) y errores de red.
 */
async function fetchWithRetry(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<FetchOutcome> {
  let last: FetchOutcome | null = null

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })

    // Lee el cuerpo una sola vez (JSON tolerante).
    let json: unknown = null
    try {
      json = await response.json()
    } catch {
      json = null
    }

    if (response.ok) {
      return { response, json, errorKind: null }
    }

    const errorKind = parseGeminiError(response.status, json as GeminiErrorBody)
    last = { response, json, errorKind }

    // Reintenta ÚNICAMENTE si es alta demanda temporal y quedan intentos.
    if (errorKind === 'HIGH_DEMAND' && attempt < RETRY_DELAYS_MS.length) {
      await delay(RETRY_DELAYS_MS[attempt], signal)
      continue
    }

    // Cuota diaria, auth, genérico, o sin reintentos restantes: devuelve ya.
    return last
  }

  return last as FetchOutcome
}

/**
 * Verifica la validez de la API key haciendo una petición ligera al endpoint
 * de metadatos del modelo (GET models/{model}). No consume cuota de generación.
 *
 * @param apiKey Clave de Gemini a validar.
 * @param model  Modelo cuya disponibilidad se comprueba.
 * @param signal AbortSignal opcional para cancelar la petición.
 */
export async function verifyApiKey(
  apiKey: string,
  model: GeminiModel,
  signal?: AbortSignal,
): Promise<ApiKeyCheckResult> {
  const trimmed = apiKey.trim()
  if (trimmed.length === 0) {
    return { ok: false, message: 'Ingresa una API key antes de verificar.' }
  }

  const url = `${API_BASE}/models/${encodeURIComponent(model)}?key=${encodeURIComponent(trimmed)}`

  try {
    const response = await fetch(url, { method: 'GET', signal })

    if (response.ok) {
      return { ok: true, message: `Clave válida. El modelo ${model} está disponible.` }
    }

    // Intenta extraer el mensaje de error de la API.
    let detail = ''
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      detail = body?.error?.message ?? ''
    } catch {
      detail = ''
    }

    if (response.status === 400 || response.status === 403) {
      return {
        ok: false,
        message: detail || 'La API key es inválida o no tiene permisos.',
      }
    }
    if (response.status === 404) {
      return {
        ok: false,
        message: detail || `El modelo ${model} no está disponible para esta clave.`,
      }
    }

    return {
      ok: false,
      message: detail || `Error ${response.status} al verificar la clave.`,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, message: 'Verificación cancelada.' }
    }
    return {
      ok: false,
      message: 'No se pudo conectar con Gemini. Revisa tu conexión e inténtalo de nuevo.',
    }
  }
}

/** Parámetros para una generación de contenido. */
export interface GenerateContentParams {
  apiKey: string
  model: GeminiModel
  /** Instrucción de sistema que fija el rol/comportamiento del asistente. */
  systemInstruction: string
  /** Historial de turnos previos (sin incluir el mensaje actual). */
  history: ChatTurn[]
  /** Mensaje actual del usuario. */
  prompt: string
  /** Temperatura del muestreo (0.1 estricto, 0.65 creativo). */
  temperature: number
  signal?: AbortSignal
}

/**
 * Genera contenido con Gemini a partir de una instrucción de sistema, el
 * historial de conversación y el mensaje actual del usuario.
 *
 * Maneja de forma robusta los errores de red, cuota (429) y clave inválida
 * (400/401/403), devolviendo mensajes legibles en lugar de lanzar excepciones.
 */
export async function generateContent(
  params: GenerateContentParams,
): Promise<GenerateResult> {
  const { apiKey, model, systemInstruction, history, prompt, temperature, signal } =
    params

  const trimmedKey = apiKey.trim()
  if (trimmedKey.length === 0) {
    return {
      ok: false,
      error: 'No hay API key configurada. Añádela en Ajustes para usar el asistente.',
    }
  }
  if (prompt.trim().length === 0) {
    return { ok: false, error: 'El mensaje está vacío.' }
  }

  const contents = [
    ...history.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    { role: 'user' as const, parts: [{ text: prompt }] },
  ]

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 2048,
    },
  }

  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(trimmedKey)}`

  let outcome: FetchOutcome
  try {
    // Reintentos automáticos (solo alta demanda) con backoff.
    outcome = await fetchWithRetry(url, body, signal)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: 'Generación cancelada.' }
    }
    return {
      ok: false,
      error: 'No se pudo conectar con Gemini. Revisa tu conexión e inténtalo de nuevo.',
    }
  }

  const payload = (outcome.json ?? {}) as GenerateContentResponse

  if (!outcome.response.ok) {
    const kind = outcome.errorKind ?? 'GENERIC'
    return { ok: false, error: ERROR_MESSAGES[kind], errorKind: kind }
  }

  // La API puede bloquear el prompt por filtros de seguridad.
  if (payload.promptFeedback?.blockReason) {
    return {
      ok: false,
      error: `La solicitud fue bloqueada por filtros de seguridad (${payload.promptFeedback.blockReason}).`,
    }
  }

  const candidate = payload.candidates?.[0]
  const text = candidate?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim()

  if (!text) {
    const reason = candidate?.finishReason
    if (reason === 'SAFETY') {
      return {
        ok: false,
        error: 'La respuesta fue bloqueada por filtros de seguridad de Gemini.',
      }
    }
    return {
      ok: false,
      error: 'Gemini no devolvió ninguna respuesta. Inténtalo de nuevo.',
    }
  }

  return { ok: true, text }
}

/** Parámetros para una generación con salida JSON estructurada. */
export interface GenerateJsonParams {
  apiKey: string
  model: GeminiModel
  systemInstruction: string
  prompt: string
  temperature?: number
  signal?: AbortSignal
}

/** Resultado de una generación JSON (ya parseada). */
export type GenerateJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; errorKind?: GeminiErrorKind }

/** Extrae el primer objeto JSON de un texto (tolera fences ```json o prefijos). */
function extractJsonObject(text: string): string | null {
  const trimmed = text.trim()

  // Quita vallas de código Markdown si las hubiera.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const candidate = fenced ? fenced[1].trim() : trimmed

  // Recorta al primer '{' y al último '}' por si hay texto alrededor.
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  return candidate.slice(start, end + 1)
}

/**
 * Genera contenido pidiendo a Gemini una respuesta en JSON y lo parsea.
 *
 * Usa `responseMimeType: application/json` para forzar salida JSON, con un
 * respaldo de extracción por si el modelo envuelve el objeto en texto/fences.
 * Comparte el manejo robusto de errores (red, cuota, clave) con generateContent.
 */
export async function generateJson<T>(
  params: GenerateJsonParams,
): Promise<GenerateJsonResult<T>> {
  const { apiKey, model, systemInstruction, prompt, temperature = 0.2, signal } =
    params

  const trimmedKey = apiKey.trim()
  if (trimmedKey.length === 0) {
    return {
      ok: false,
      error: 'No hay API key configurada. Añádela en Ajustes para usar el análisis.',
    }
  }

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user' as const, parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  }

  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(trimmedKey)}`

  let outcome: FetchOutcome
  try {
    // Reintentos automáticos (solo alta demanda) con backoff.
    outcome = await fetchWithRetry(url, body, signal)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: 'Análisis cancelado.' }
    }
    return {
      ok: false,
      error: 'No se pudo conectar con Gemini. Revisa tu conexión e inténtalo de nuevo.',
    }
  }

  const payload = (outcome.json ?? {}) as GenerateContentResponse

  if (!outcome.response.ok) {
    const kind = outcome.errorKind ?? 'GENERIC'
    return { ok: false, error: ERROR_MESSAGES[kind], errorKind: kind }
  }

  if (payload.promptFeedback?.blockReason) {
    return {
      ok: false,
      error: `La solicitud fue bloqueada por filtros de seguridad (${payload.promptFeedback.blockReason}).`,
    }
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim()

  if (!text) {
    return { ok: false, error: 'Gemini no devolvió ninguna respuesta.' }
  }

  const jsonText = extractJsonObject(text)
  if (!jsonText) {
    return { ok: false, error: 'La respuesta de Gemini no contenía un JSON válido.' }
  }

  try {
    return { ok: true, data: JSON.parse(jsonText) as T }
  } catch {
    return { ok: false, error: 'No se pudo interpretar el JSON devuelto por Gemini.' }
  }
}
