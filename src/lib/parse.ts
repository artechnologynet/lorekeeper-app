/**
 * Utilidades de parseo y transformación de texto.
 *
 * Funciones puras usadas al importar/normalizar contenido para las fichas,
 * manuscritos y el glosario.
 */

/** Genera un identificador único razonablemente seguro para el cliente. */
export function createId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  // Fallback para entornos sin crypto.randomUUID.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Marca de tiempo ISO del momento actual. */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Convierte texto libre en una lista de etiquetas normalizadas y únicas. */
export function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,;\n]/)
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0),
    ),
  )
}

/**
 * Parsea una lista de pares "clave: valor" (uno por línea) en un objeto de
 * atributos. Las líneas vacías o sin ":" se ignoran.
 */
export function parseAttributes(input: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const line of input.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key.length === 0) continue

    result[key] = value
  }

  return result
}

/** Resumen de un texto largo a un máximo de caracteres, cortando en palabra. */
export function summarize(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized

  const sliced = normalized.slice(0, maxLength)
  const lastSpace = sliced.lastIndexOf(' ')
  const cut = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced
  return `${cut}…`
}

/** Cuenta palabras de un texto (útil para manuscritos). */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}
