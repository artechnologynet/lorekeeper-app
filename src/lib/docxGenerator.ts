/**
 * Motor de exportación a Microsoft Word (.docx).
 *
 * Genera en el cliente (sin backend) un documento editorial sobrio con:
 *   1. Portada: título de la obra, autor y fecha, seguida de salto de página.
 *   2. Entidades: expediente formal por personaje con viñetas.
 *   3. Glosario: tabla de 4 columnas ordenada alfabéticamente.
 *   4. Compendio: texto continuo con un Heading 2 por anexo.
 *
 * Este módulo importa `docx` y `file-saver` de forma estática; los llamadores
 * lo cargan con `import()` dinámico para no inflar el bundle inicial.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { IBorderOptions, ParagraphChild } from 'docx'
import { saveAs } from 'file-saver'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type {
  CompendiumAnnex,
  EntitySheet,
  GlossaryTerm,
  LoreKeeperData,
} from '../types'
import { sanitizeFilename } from './loreBible'

/* -------------------------------------------------------------------------- */
/* API pública                                                                */
/* -------------------------------------------------------------------------- */

/** Secciones que se pueden incluir en el documento. */
export interface DocxSelection {
  entities: boolean
  glossary: boolean
  compendium: boolean
}

/** MIME oficial de un archivo .docx. */
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Nombre de archivo: `[TituloDeObra_o_LoreKeeper]_Biblia_de_Lore.docx`. */
export function buildDocxFilename(data: LoreKeeperData): string {
  const title = data.settings.projectTitle.trim()
  const base = title.length > 0 ? sanitizeFilename(title) : 'LoreKeeper'
  return `${base}_Biblia_de_Lore.docx`
}

/** Resultado de la entrega local del archivo. */
export type LocalSaveOutcome =
  /** Web: descarga disparada con file-saver. */
  | 'downloaded'
  /** Nativo: archivo escrito y hoja de compartir mostrada/completada. */
  | 'shared'
  /** Nativo: el usuario cerró la hoja de compartir sin elegir destino. */
  | 'cancelled'

/** Convierte un Blob a base64 puro (sin el prefijo `data:...;base64,`). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

/** ¿El error de Share corresponde a que el usuario cerró la hoja? */
function isShareCancelled(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /cancel/i.test(message)
}

/**
 * Entrega el archivo al usuario.
 *  - Web: descarga directa con file-saver.
 *  - Android/nativo: el WebView no escribe descargas por blob, así que se
 *    guarda en el directorio de caché de la app (accesible vía FileProvider) y
 *    se abre la hoja de compartir de Android, desde la que el usuario puede
 *    guardarlo en Descargas, enviarlo o abrirlo en Word / Docs.
 *
 * Lanza un error si la escritura del archivo falla; la cancelación de la hoja
 * de compartir NO es un error y se informa con `'cancelled'`.
 */
export async function saveDocxLocally(
  blob: Blob,
  filename: string,
): Promise<LocalSaveOutcome> {
  if (!Capacitor.isNativePlatform()) {
    saveAs(blob, filename)
    return 'downloaded'
  }

  const data = await blobToBase64(blob)
  const written = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Cache,
  })

  try {
    await Share.share({
      title: filename,
      dialogTitle: 'Guardar o abrir documento',
      url: written.uri,
    })
    return 'shared'
  } catch (err) {
    if (isShareCancelled(err)) return 'cancelled'
    throw err
  }
}

/** Construye el .docx con las secciones elegidas y lo devuelve como Blob. */
export async function generateLoreDocx(
  data: LoreKeeperData,
  selection: DocxSelection,
  now: Date = new Date(),
): Promise<Blob> {
  const children: Array<Paragraph | Table> = [...buildCover(data, now)]

  if (selection.entities) children.push(...buildEntitiesSection(data.entities))
  if (selection.glossary) children.push(...buildGlossarySection(data.glossary))
  if (selection.compendium) {
    children.push(...buildCompendiumSection(data.compendium))
  }

  const doc = new Document({
    creator: data.settings.authorName.trim() || 'LoreKeeper',
    title: data.settings.projectTitle.trim() || 'LoreKeeper',
    description: 'Biblia de Lore exportada desde LoreKeeper',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
      // Estilos de encabezado sobrios (texto oscuro, sin el azul por defecto).
      paragraphStyles: [
        headingStyle('Heading1', 'Heading 1', 34, 360, 160),
        headingStyle('Heading2', 'Heading 2', 28, 280, 100),
        headingStyle('Heading3', 'Heading 3', 24, 200, 80),
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBlob(doc)
}

/* -------------------------------------------------------------------------- */
/* Utilidades de estilo                                                       */
/* -------------------------------------------------------------------------- */

const COLOR_TEXT = '1F1F1F'
const COLOR_MUTED = '666666'
const COLOR_BORDER = 'BFBFBF'
const COLOR_HEADER_FILL = 'F2F2F2'

/** Interlineado cómodo para lectura continua (1.5). */
const READING_LINE = 360

function headingStyle(
  id: string,
  name: string,
  size: number,
  before: number,
  after: number,
) {
  return {
    id,
    name,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { font: 'Calibri', size, bold: true, color: COLOR_TEXT },
    paragraph: { spacing: { before, after }, keepNext: true },
  }
}

/** Párrafo de texto simple con estilo básico. */
function plain(
  text: string,
  options: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {},
): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, ...options })],
  })
}

/** Divide un texto libre en líneas útiles (sin vacías), quitando viñetas previas. */
function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim())
    .filter((l) => l.length > 0)
}

/** Etiqueta en negrita seguida de viñetas con las líneas del texto. */
function labeledBullets(label: string, lines: string[]): Paragraph[] {
  if (lines.length === 0) return []
  return [
    new Paragraph({
      spacing: { before: 120, after: 40 },
      keepNext: true,
      children: [new TextRun({ text: label, bold: true })],
    }),
    ...lines.map(
      (line) =>
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40 },
          children: [new TextRun({ text: line })],
        }),
    ),
  ]
}

/* -------------------------------------------------------------------------- */
/* 1. Portada                                                                 */
/* -------------------------------------------------------------------------- */

function formatLongDate(d: Date): string {
  return d.toLocaleDateString('es', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function buildCover(data: LoreKeeperData, now: Date): Paragraph[] {
  const title = data.settings.projectTitle.trim() || 'LoreKeeper'
  const author = data.settings.authorName.trim()

  const cover: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 3600, after: 240 },
      children: [
        new TextRun({ text: title, bold: true, size: 64, color: COLOR_TEXT }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({ text: 'Biblia de Lore', size: 32, color: COLOR_MUTED }),
      ],
    }),
  ]

  if (author.length > 0) {
    cover.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: `Autor: ${author}`, size: 28 })],
      }),
    )
  }

  cover.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240 },
      children: [
        new TextRun({
          text: `Generado el ${formatLongDate(now)}`,
          size: 22,
          color: COLOR_MUTED,
        }),
      ],
    }),
  )

  return cover
}

/** Heading 1 que inicia en página nueva (separa portada y secciones). */
function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    children: [new TextRun({ text })],
  })
}

function emptySectionNote(text: string): Paragraph {
  return plain(text, { italics: true, color: COLOR_MUTED })
}

/* -------------------------------------------------------------------------- */
/* 2. Entidades                                                               */
/* -------------------------------------------------------------------------- */

function buildEntitiesSection(entities: EntitySheet[]): Paragraph[] {
  const out: Paragraph[] = [sectionTitle('Entidades / Personajes')]

  if (entities.length === 0) {
    out.push(emptySectionNote('No hay entidades registradas.'))
    return out
  }

  const sorted = [...entities].sort((a, b) => a.name.localeCompare(b.name, 'es'))

  for (const e of sorted) {
    const role = e.role || 'Sin especificar'
    const status = e.statusInStory.trim() || 'Sin especificar'

    out.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: e.name })],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `Rol: ${role} | Estado: ${status}`, bold: true }),
        ],
      }),
    )

    if (e.aliases.length > 0) {
      out.push(
        plain(`Alias: ${e.aliases.join(', ')}`, { italics: true, color: COLOR_MUTED }),
      )
    }

    out.push(
      ...labeledBullets('Motivación', toLines(e.motivation)),
      ...labeledBullets('Conflicto interno', toLines(e.internalConflict)),
      ...labeledBullets('Poderes / Habilidades', toLines(e.powersOrAbilities)),
      ...labeledBullets(
        'Relaciones',
        e.relationships
          .filter((r) => r.target.trim() || r.relation.trim())
          .map((r) =>
            r.target.trim() && r.relation.trim()
              ? `${r.target.trim()}: ${r.relation.trim()}`
              : r.target.trim() || r.relation.trim(),
          ),
      ),
    )
  }

  return out
}

/* -------------------------------------------------------------------------- */
/* 3. Glosario                                                                */
/* -------------------------------------------------------------------------- */

const SUBTLE_BORDER: IBorderOptions = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: COLOR_BORDER,
}

const CELL_BORDERS = {
  top: SUBTLE_BORDER,
  bottom: SUBTLE_BORDER,
  left: SUBTLE_BORDER,
  right: SUBTLE_BORDER,
}

/** Anchos de columna (DXA) que suman 9360 (6.5" de ancho útil). */
const GLOSSARY_COLUMNS = [1800, 1600, 4160, 1800]

/**
 * Compacta las apariciones: si las entradas son capítulos numerados
 * ("Capítulo 3", "Capítulo XII.- Título") produce "Cap. 3, XII"; el resto de
 * entradas se conserva tal cual.
 */
export function formatAppearances(raw: string): string {
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''

  const numbers: string[] = []
  const others: string[] = []
  for (const part of parts) {
    const m = /^cap(?:[ií]tulo|\.)?\s+([0-9]+|[IVXLCDM]+)\b/i.exec(part)
    if (m) numbers.push(m[1].toUpperCase())
    else others.push(part)
  }

  const out: string[] = []
  if (numbers.length > 0) out.push(`Cap. ${numbers.join(', ')}`)
  out.push(...others)
  return out.join('; ')
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    shading: { type: ShadingType.CLEAR, fill: COLOR_HEADER_FILL, color: 'auto' },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({ children: [new TextRun({ text, bold: true })] }),
    ],
  })
}

function bodyCell(width: number, paragraphs: Paragraph[]): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: paragraphs.length > 0 ? paragraphs : [new Paragraph({})],
  })
}

function buildGlossarySection(terms: GlossaryTerm[]): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [sectionTitle('Glosario de Términos')]

  if (terms.length === 0) {
    out.push(emptySectionNote('No hay términos registrados.'))
    return out
  }

  const sorted = [...terms].sort((a, b) => a.term.localeCompare(b.term, 'es'))

  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      headerCell('Término', GLOSSARY_COLUMNS[0]),
      headerCell('Categoría', GLOSSARY_COLUMNS[1]),
      headerCell('Definición y notas', GLOSSARY_COLUMNS[2]),
      headerCell('Capítulos', GLOSSARY_COLUMNS[3]),
    ],
  })

  const rows = sorted.map((t) => {
    const detail: Paragraph[] = []
    if (t.definition.trim()) {
      detail.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: t.definition.trim() })],
        }),
      )
    }
    if (t.notes.trim()) {
      detail.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: 'Notas: ', italics: true, color: COLOR_MUTED }),
            new TextRun({ text: t.notes.trim(), italics: true, color: COLOR_MUTED }),
          ],
        }),
      )
    }

    const appearances = formatAppearances(t.occurrencesOrChapters)

    return new TableRow({
      cantSplit: true,
      children: [
        bodyCell(GLOSSARY_COLUMNS[0], [
          new Paragraph({ children: [new TextRun({ text: t.term, bold: true })] }),
        ]),
        bodyCell(GLOSSARY_COLUMNS[1], [
          new Paragraph({ children: [new TextRun({ text: t.category })] }),
        ]),
        bodyCell(GLOSSARY_COLUMNS[2], detail),
        bodyCell(GLOSSARY_COLUMNS[3], [
          new Paragraph({ children: [new TextRun({ text: appearances || '—' })] }),
        ]),
      ],
    })
  })

  out.push(
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: GLOSSARY_COLUMNS,
      rows: [header, ...rows],
    }),
  )

  return out
}

/* -------------------------------------------------------------------------- */
/* 4. Compendio                                                               */
/* -------------------------------------------------------------------------- */

/** Convierte **negrita** y *cursiva* de una línea Markdown en TextRuns. */
function inlineRuns(text: string): ParagraphChild[] {
  const runs: ParagraphChild[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index) }))
    const token = m[0]
    if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }))
    } else {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }))
    }
    last = m.index + token.length
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last) }))
  return runs.length > 0 ? runs : [new TextRun({ text })]
}

/** Párrafo de lectura continua con interlineado cómodo. */
function readingParagraph(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: READING_LINE, after: 160 },
    children: inlineRuns(text),
  })
}

/** Convierte Markdown básico (títulos, viñetas, párrafos) en párrafos Word. */
function markdownToParagraphs(markdown: string): Paragraph[] {
  const out: Paragraph[] = []
  let buffer: string[] = []

  const flush = () => {
    if (buffer.length > 0) {
      out.push(readingParagraph(buffer.join(' ')))
      buffer = []
    }
  }

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()

    if (line.length === 0) {
      flush()
      continue
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: heading[1].trim() })],
        }),
      )
      continue
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { line: READING_LINE, after: 60 },
          children: inlineRuns(bullet[1]),
        }),
      )
      continue
    }

    buffer.push(line)
  }
  flush()
  return out
}

function buildCompendiumSection(annexes: CompendiumAnnex[]): Paragraph[] {
  const out: Paragraph[] = [sectionTitle('Compendio / Anexos')]

  if (annexes.length === 0) {
    out.push(emptySectionNote('No hay anexos registrados.'))
    return out
  }

  for (const a of annexes) {
    out.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: a.title })],
      }),
    )

    const sub = [a.subtitle.trim(), a.type.trim()].filter(Boolean).join(' · ')
    if (sub.length > 0) {
      out.push(plain(sub, { italics: true, color: COLOR_MUTED }))
    }

    if (a.contentMarkdown.trim().length > 0) {
      out.push(...markdownToParagraphs(a.contentMarkdown))
    }
  }

  return out
}
