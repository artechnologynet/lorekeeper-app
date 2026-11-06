/**
 * Utilidades para documentos / manuscritos.
 *
 * - Métricas de texto (palabras, caracteres, páginas estimadas).
 * - Importación/parseo en cliente de archivos .txt, .md y .docx.
 *
 * El parseo de .docx usa `mammoth`, que extrae el texto plano en el navegador
 * a partir de un ArrayBuffer, sin requerir backend. Vite resuelve la build de
 * navegador de mammoth automáticamente (campo "browser" de su package.json).
 */

import { countWords } from './parse'

/** Palabras por página estimadas (promedio manuscrito estándar). */
const WORDS_PER_PAGE = 275

/** Métricas de un texto. */
export interface TextMetrics {
  words: number
  characters: number
  charactersNoSpaces: number
  pages: number
}

/** Calcula métricas en tiempo real de un texto. */
export function computeMetrics(text: string): TextMetrics {
  const words = countWords(text)
  return {
    words,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    pages: Math.max(1, Math.ceil(words / WORDS_PER_PAGE)),
  }
}

/** Extensiones de archivo soportadas para importación. */
export type SupportedExtension = 'txt' | 'md' | 'docx'

/** Resultado de una importación de archivo. */
export type FileImportResult =
  | { ok: true; title: string; content: string }
  | { ok: false; error: string }

/** Deriva la extensión (en minúsculas) de un nombre de archivo. */
function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

/** Quita la extensión de un nombre de archivo para usarlo como título. */
function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot === -1 ? filename : filename.slice(0, dot)
  return base.trim() || 'Documento sin título'
}

/**
 * Lee y parsea un archivo local en texto plano.
 *
 * - .txt / .md → lectura directa como texto.
 * - .docx → extracción de texto plano con mammoth.
 *
 * Devuelve el título (nombre sin extensión) y el contenido, o un error legible.
 */
export async function importFile(file: File): Promise<FileImportResult> {
  const extension = getExtension(file.name)
  const title = stripExtension(file.name)

  try {
    if (extension === 'txt' || extension === 'md') {
      const content = await file.text()
      return { ok: true, title, content }
    }

    if (extension === 'docx') {
      // Import dinámico: mammoth (pesado) solo se carga al importar un .docx,
      // manteniendo ligero el bundle principal (code-splitting).
      const mammoth = (await import('mammoth')).default
      const arrayBuffer = await file.arrayBuffer()
      const result = await mammoth.extractRawText({ arrayBuffer })
      return { ok: true, title, content: result.value }
    }

    return {
      ok: false,
      error: `Formato .${extension || 'desconocido'} no soportado. Usa .txt, .md o .docx.`,
    }
  } catch {
    return {
      ok: false,
      error: `No se pudo leer "${file.name}". El archivo puede estar dañado.`,
    }
  }
}

/** Nombre de archivo .txt seguro a partir de un título. */
export function toTextFilename(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'documento'}.txt`
}
