/**
 * Divisor Inteligente de Capítulos.
 *
 * Función pura que, dado el texto completo de un archivo (.docx/.txt/.md ya
 * extraído a texto plano), detecta encabezados de capítulo comunes en español
 * e inglés y divide el documento en secciones independientes.
 *
 * Reglas:
 *  - Si detecta 2 o más encabezados, devuelve una lista de capítulos con título
 *    y contenido. El texto previo al primer encabezado (si es relevante) se
 *    agrupa como "Prólogo".
 *  - Si detecta 0 o 1 encabezado, se considera documento único (detected=false).
 */

import { countWords } from './parse'

/** Un capítulo detectado dentro de un documento. */
export interface ChapterSection {
  title: string
  content: string
  words: number
}

/** Resultado de la detección/división. */
export interface SplitResult {
  /** true si se detectaron múltiples capítulos (>= 2). */
  detected: boolean
  chapters: ChapterSection[]
}

/**
 * Expresión regular (global, multilínea) que detecta encabezados de capítulo,
 * refinada para evitar falsos positivos:
 *
 *  - Rama A (Capítulo/Chapter/Epílogo/Prólogo): admite número romano/arábigo o
 *    una palabra como designador (p. ej. "Capítulo Primero"), PERO excluye que
 *    esa palabra sea un adverbio/preposición ("seguido", "de", "del", "por")
 *    para no confundir frases como "Capítulo de la historia". El designador
 *    numérico (romano largo como "XLII" incluido) puede ir tras un salto de
 *    línea, cubriendo encabezados maquetados en dos renglones.
 *
 *  - Rama B (Anexo/Anexos) y Rama C (Glosario): secciones complementarias que
 *    se separan como documentos propios. "Anexo I.- …" / "Anexo 2: …" cuentan
 *    por numeración; "Anexo", "Anexos" y "Glosario" cuentan como sección
 *    general solo si están al inicio de línea seguidos de fin de línea o un
 *    separador, para no dispararse ante prosa.
 *
 *  - Rama D (Parte/Acto): más ambiguas en prosa ("Acto seguido", "Parte de"),
 *    por lo que SOLO cuentan si van seguidas de:
 *      · un número arábigo o romano ("Acto I", "Acto 1"),
 *      · un ordinal ("Parte Primera", "Acto Final"),
 *      · o un separador ":" / "-" / "—" ("Parte: El Asedio").
 *
 * Todas las ramas permiten prefijo Markdown (#) y un subtítulo opcional tras un
 * separador (. : - —).
 */

// Palabras que, tras la keyword, indican prosa y NO un encabezado real.
const EXCLUDED_NEXT_WORDS = 'seguido|seguida|de|del|por|para|como|que|en|a|y'

// Ordinales admitidos para Parte/Acto (femenino/masculino, con/sin acento).
const ORDINALS =
  'Primero|Primera|Segundo|Segunda|Tercero|Tercera|Cuarto|Cuarta|Quinto|Quinta|Sexto|Sexta|S[eé]ptimo|S[eé]ptima|Octavo|Octava|Noveno|Novena|D[eé]cimo|D[eé]cima|Final|[UÚ]ltimo|[UÚ]ltima'

/**
 * Designador numérico de un capítulo: número arábigo (1+ dígitos) o número
 * romano (hasta "MMMM" y más). Se usa la forma insensible a mayúsculas
 * `[IVXLCDM]+` (con el flag `i` cubre minúsculas) para no cortar romanos largos
 * como "XLII", "XLVIII" o "LXXXVIII".
 */
const NUMBERING = '[0-9]+|[IVXLCDM]+'

/**
 * Espacio horizontal "flexible": espacio, tab y los espacios Unicode que la
 * normalización ya convierte a espacio normal, pero se incluyen aquí como
 * defensa en profundidad por si algún carácter raro no fue normalizado.
 */
const HSPACE = '[ \\t\\u00A0\\u202F]'

/**
 * Separador posterior al designador (ultra-permisivo): cualquier combinación de
 * espacios flexibles, puntos, dos puntos y guiones de todo tipo —medio (-),
 * raya (— \\u2014) y semirraya (– \\u2013)—, incluyendo "punto pegado a guion"
 * como en "Capítulo XLII.-".
 */
const SUBTITLE_SEP = `(?:${HSPACE}|[.:\\-—–])`

const CHAPTER_HEADING_REGEX = new RegExp(
  '(?:^|\\n)[ \\t]*(?:#+\\s*)?(?:' +
    // Rama A: keywords claras + designador, excluyendo palabras de prosa.
    '(?:Cap[íi]tulo|Chapter|Ep[íi]logo|Pr[óo]logo)' +
    '(?:' +
    // ...designador NUMÉRICO (arábigo/romano): admite espacios flexibles
    //    (incl. NBSP) o salto de línea, cubriendo "Capítulo\u00A0XLII" y
    //    "Capítulo\nXLII". El lookahead evita capturar la inicial de la palabra
    //    siguiente (p. ej. la "I" de "Intro" como romano tras "Prólogo\n").
    `(?:${HSPACE}|\\n)+(?:${NUMBERING})(?![A-Za-zÁ-Úá-ú])` +
    '|' +
    // ...designador ALFABÉTICO/ordinal ("Capítulo Primero"): misma línea y sin
    //    ser una palabra de prosa, para no absorber el inicio del párrafo.
    `${HSPACE}+(?!(?:${EXCLUDED_NEXT_WORDS})\\b)[A-Za-zÁ-Úá-ú]+` +
    ')' +
    '|' +
    // Rama B: Anexo/Anexos como sección complementaria.
    //  · "Anexo I.- …", "Anexo 2: …" (con numeración), o
    //  · "Anexo" / "Anexos" como sección general (sin numeración), exigiendo
    //    en ese caso que la línea termine ahí o continúe con un separador, para
    //    no disparar ante prosa que empiece por "Anexo …".
    `(?:Anexo${HSPACE}+(?:${NUMBERING})|Anexos?(?=${HSPACE}*(?:[.:\\-—–]|\\n|$)))` +
    '|' +
    // Rama C: Glosario como sección independiente (solo/encabezado, no prosa).
    `Glosario(?=${HSPACE}*(?:[.:\\-—–]|\\n|$))` +
    '|' +
    // Rama D: Parte/Acto exigen número, ordinal O separador inmediato.
    '(?:Parte|Acto)' +
    '(?:' +
    // ...seguido de espacio + número/romano/ordinal
    `${HSPACE}+(?:${NUMBERING}|(?:${ORDINALS})\\b)` +
    '|' +
    // ...o directamente un separador con subtítulo ("Parte: El Asedio").
    `${HSPACE}*[:\\-—–]${HSPACE}*[^\\n]+` +
    ')' +
    ')' +
    // Subtítulo opcional tras separador ultra-permisivo para todas las ramas.
    `(?:${SUBTITLE_SEP}+[^\\n]*)?`,
  'gi',
)

/** Umbral de palabras para considerar el preámbulo como "Prólogo" propio. */
const PREAMBLE_MIN_WORDS = 20

/**
 * Normaliza los espacios "invisibles" que suelen romper la detección de
 * encabezados en documentos .docx/.pdf exportados a texto:
 *  - NBSP (\u00A0) y NARROW NBSP (\u202F) → espacio normal.
 *  - FIGURE/THIN/HAIR y otros espacios Unicode → espacio normal.
 *  - ZERO WIDTH SPACE/JOINER (\u200B-\u200D) y BOM (\uFEFF) → se eliminan.
 *
 * Así "Capítulo\u00A0XLII" pasa a "Capítulo XLII" y el parser lo reconoce.
 */
function normalizeInvisibleSpaces(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u202F\u2007\u2009\u200A\u2060]/g, ' ')
}

/** Limpia un título: colapsa espacios, quita # de Markdown y recorta. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Diagnóstico: devuelve, para cada aparición de un término (p. ej. "XLII") en
 * el texto, los caracteres que lo rodean con sus códigos Unicode. Útil para
 * detectar separadores/espacios invisibles que impiden el match del encabezado.
 *
 * No se usa en producción; es una herramienta de depuración invocable desde
 * tests o la consola. No imprime por sí sola para no ensuciar la salida.
 */
export function inspectAround(
  fullText: string,
  needle: string,
  radius = 8,
): Array<{ at: number; context: string; codes: string }> {
  const results: Array<{ at: number; context: string; codes: string }> = []
  let from = 0
  let at = fullText.indexOf(needle, from)
  while (at !== -1) {
    const start = Math.max(0, at - radius)
    const end = Math.min(fullText.length, at + needle.length + radius)
    const context = fullText.slice(start, end)
    const codes = Array.from(context)
      .map((ch) => {
        const code = ch.codePointAt(0) ?? 0
        return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
      })
      .join(' ')
    results.push({ at, context, codes })
    from = at + needle.length
    at = fullText.indexOf(needle, from)
  }
  return results
}

/**
 * Detecta encabezados de capítulo y divide el texto en secciones.
 *
 * @param fullText Texto completo del documento.
 * @returns SplitResult con los capítulos detectados (o detected=false).
 */
export function splitIntoChapters(fullText: string): SplitResult {
  // Normaliza saltos de línea y espacios invisibles (NBSP, zero-width, etc.)
  // ANTES de detectar encabezados, para que "Capítulo\u00A0XLII" sea reconocido.
  const text = normalizeInvisibleSpaces(fullText.replace(/\r\n/g, '\n'))

  // Recolecta todas las posiciones/encabezados.
  const matches: { index: number; title: string; headingEnd: number }[] = []
  const regex = new RegExp(CHAPTER_HEADING_REGEX)
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    // El match puede empezar con '\n'; la posición real del encabezado es el
    // primer carácter no-salto dentro del match.
    const leadingNewline = m[0].startsWith('\n') ? 1 : 0
    const start = m.index + leadingNewline
    matches.push({
      index: start,
      title: cleanTitle(m[0]),
      headingEnd: m.index + m[0].length,
    })
    // Evita bucle infinito ante coincidencias de longitud cero.
    if (regex.lastIndex === m.index) regex.lastIndex += 1
  }

  // Menos de 2 encabezados → documento único.
  if (matches.length < 2) {
    return { detected: false, chapters: [] }
  }

  const chapters: ChapterSection[] = []

  // Preámbulo: texto antes del primer encabezado.
  const preamble = text.slice(0, matches[0].index).trim()
  if (countWords(preamble) >= PREAMBLE_MIN_WORDS) {
    chapters.push({
      title: 'Prólogo',
      content: preamble,
      words: countWords(preamble),
    })
  }

  // Cada capítulo va desde su encabezado hasta el inicio del siguiente.
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]
    const nextIndex =
      i + 1 < matches.length ? matches[i + 1].index : text.length

    // Contenido = encabezado + cuerpo hasta el siguiente encabezado.
    const body = text.slice(current.headingEnd, nextIndex).trim()
    const content = body.length > 0 ? `${current.title}\n\n${body}` : current.title

    chapters.push({
      title: current.title || `Capítulo ${i + 1}`,
      content,
      words: countWords(content),
    })
  }

  return { detected: true, chapters }
}
