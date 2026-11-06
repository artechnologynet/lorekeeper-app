/**
 * Exportador de la "Biblia de Lore" en ZIP y restauración desde .json / .zip.
 *
 * Construye en memoria (sin backend) un archivo ZIP con la estructura completa
 * del proyecto, usando jszip (cargado dinámicamente solo al exportar). También
 * permite restaurar el estado desde un backup .json o desde un .zip exportado
 * previamente (extrayendo /backup_maestro/lorekeeper_backup.json).
 */

import type {
  CompendiumAnnex,
  EntitySheet,
  GlossaryCategory,
  GlossaryTerm,
  LoreKeeperData,
} from '../types'
import { GLOSSARY_CATEGORIES } from '../types'
import { serializeBackup } from './storage'

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Saneado de nombres de archivo: sin acentos, espacios → _, solo seguros. */
export function sanitizeFilename(name: string): string {
  const base = name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base.length > 0 ? base : 'sin_titulo'
}

/** Garantiza nombres de archivo únicos dentro de una carpeta. */
function uniqueName(used: Set<string>, base: string, ext: string): string {
  let candidate = `${base}.${ext}`
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}_${n}.${ext}`
    n += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/** Fecha corta local (DD/MM/YYYY). */
function formatDate(d: Date): string {
  return d.toLocaleDateString('es', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/** Fecha para el nombre del archivo (YYYY-MM-DD). */
function fileDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/* -------------------------------------------------------------------------- */
/* Formateadores Markdown                                                     */
/* -------------------------------------------------------------------------- */

/** Ficha de entidad → Markdown limpio. */
export function entityToMarkdown(e: EntitySheet): string {
  const lines: string[] = [`# ${e.name}`, '']

  // Badges de rol (estructural) y rol narrativo.
  const badges: string[] = [`**Rol:** ${e.role}`]
  if (e.narrativeRole) badges.push(`**Rol narrativo:** ${e.narrativeRole}`)
  lines.push(badges.join(' · '), '')

  if (e.aliases.length > 0) {
    lines.push(`**Alias:** ${e.aliases.join(', ')}`, '')
  }
  if (e.statusInStory) lines.push(`**Estado en la historia:** ${e.statusInStory}`, '')
  if (e.firstAppearance) lines.push(`**Primera aparición:** ${e.firstAppearance}`, '')

  const section = (title: string, body: string) => {
    if (body && body.trim().length > 0) {
      lines.push(`## ${title}`, '', body.trim(), '')
    }
  }

  section('Descripción física', e.physicalDescription)
  section('Psicología', e.psychology)
  section('Motivación', e.motivation)
  section('Conflicto interno', e.internalConflict)
  section('Poderes o habilidades', e.powersOrAbilities)

  if (e.relationships.length > 0) {
    lines.push('## Relaciones', '')
    for (const r of e.relationships) {
      lines.push(`- **${r.target}** — ${r.relation}`)
    }
    lines.push('')
  }

  if (e.keyQuotes.length > 0) {
    lines.push('## Citas clave', '')
    for (const q of e.keyQuotes) lines.push(`> ${q}`, '')
  }

  section('Notas', e.notes)

  return lines.join('\n').trimEnd() + '\n'
}

/** Glosario completo → Markdown organizado por categorías. */
export function glossaryToMarkdown(terms: GlossaryTerm[]): string {
  const lines: string[] = ['# Glosario', '']

  // Agrupa por categoría respetando el orden canónico.
  const byCategory = new Map<GlossaryCategory, GlossaryTerm[]>()
  for (const t of terms) {
    const list = byCategory.get(t.category) ?? []
    list.push(t)
    byCategory.set(t.category, list)
  }

  for (const category of GLOSSARY_CATEGORIES) {
    const list = byCategory.get(category)
    if (!list || list.length === 0) continue

    lines.push(`## ${category}`, '')
    // Ordena alfabéticamente dentro de la categoría.
    for (const term of [...list].sort((a, b) => a.term.localeCompare(b.term, 'es'))) {
      lines.push(`### ${term.term}`)
      lines.push(`_${term.clarityLevel}_`, '')
      if (term.definition) lines.push(term.definition.trim(), '')
      if (term.contextInStory) lines.push(`**Contexto:** ${term.contextInStory.trim()}`, '')
      if (term.occurrencesOrChapters)
        lines.push(`**Apariciones:** ${term.occurrencesOrChapters.trim()}`, '')
      if (term.notes) lines.push(`**Notas:** ${term.notes.trim()}`, '')
    }
  }

  return lines.join('\n').trimEnd() + '\n'
}

/** Anexo de compendio → Markdown. */
export function annexToMarkdown(a: CompendiumAnnex): string {
  const lines: string[] = [`# ${a.title}`]
  if (a.subtitle) lines.push(`_${a.subtitle}_`)
  if (a.type) lines.push('', `**Tipo:** ${a.type}`)
  lines.push('', a.contentMarkdown.trim())
  return lines.join('\n').trimEnd() + '\n'
}

/** README.md con metadatos del proyecto (reutilizable por ZIP y Drive). */
export function buildReadmeMarkdown(data: LoreKeeperData, now: Date = new Date()): string {
  const projectTitle = data.settings.projectTitle.trim()
  const authorName = data.settings.authorName.trim()

  // Encabezado/portada: usa el título de la obra si existe.
  const heading = projectTitle.length > 0 ? projectTitle : 'Proyecto LoreKeeper'

  return [
    `# ${heading} — Biblia de Lore`,
    '',
    ...(projectTitle.length > 0 ? [`**Obra:** ${projectTitle}`, ''] : []),
    ...(authorName.length > 0 ? [`**Autor:** ${authorName}`, ''] : []),
    `**Fecha de exportación:** ${formatDate(now)}`,
    '',
    '## Contenido',
    '',
    `- Capítulos / documentos: **${data.manuscripts.length}**`,
    `- Fichas de entidades: **${data.entities.length}**`,
    `- Términos del glosario: **${data.glossary.length}**`,
    `- Crónicas / anexos: **${data.compendium.length}**`,
    '',
    '## Estructura del paquete',
    '',
    '- `/backup_maestro/lorekeeper_backup.json` — Volcado íntegro para restauración automática.',
    '- `/Manuscritos/` — Un `.txt` por documento.',
    '- `/Fichas_Entidades/` — Un `.md` por personaje.',
    '- `/Glosario/glosario_completo.md` — Glosario por categorías.',
    '- `/Compendio/` — Un `.md` por crónica o anexo.',
    '',
    '> Para restaurar, usa "Restaurar proyecto" en Ajustes y selecciona este .zip',
    '> o el archivo `lorekeeper_backup.json`.',
    '',
  ].join('\n')
}

/* -------------------------------------------------------------------------- */
/* Exportación                                                                */
/* -------------------------------------------------------------------------- */

/** Dispara la descarga de un Blob en web y móvil. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Resultado de una exportación. */
export type ExportResult =
  | { ok: true; filename: string }
  | { ok: false; error: string }

/**
 * Construye la "Biblia de Lore" en ZIP y dispara su descarga. jszip se carga
 * dinámicamente (code-splitting). No bloquea: es async.
 */
export async function exportLoreBible(data: LoreKeeperData): Promise<ExportResult> {
  try {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    const now = new Date()

    // 1. Backup maestro (reutiliza el formato versionado de storage).
    zip.folder('backup_maestro')?.file('lorekeeper_backup.json', serializeBackup(data))

    // 2. Manuscritos: un .txt por documento.
    const manuscritos = zip.folder('Manuscritos')
    const manuscritoNames = new Set<string>()
    for (const doc of data.manuscripts) {
      const name = uniqueName(manuscritoNames, sanitizeFilename(doc.title), 'txt')
      manuscritos?.file(name, doc.content ?? '')
    }

    // 3. Fichas de entidades: un .md por personaje.
    const fichas = zip.folder('Fichas_Entidades')
    const fichaNames = new Set<string>()
    for (const entity of data.entities) {
      const name = uniqueName(fichaNames, sanitizeFilename(entity.name), 'md')
      fichas?.file(name, entityToMarkdown(entity))
    }

    // 4. Glosario: un único .md organizado por categorías.
    if (data.glossary.length > 0) {
      zip
        .folder('Glosario')
        ?.file('glosario_completo.md', glossaryToMarkdown(data.glossary))
    }

    // 5. Compendio: un .md por crónica/anexo.
    const compendio = zip.folder('Compendio')
    const compendioNames = new Set<string>()
    for (const annex of data.compendium) {
      const name = uniqueName(compendioNames, sanitizeFilename(annex.title), 'md')
      compendio?.file(name, annexToMarkdown(annex))
    }

    // 6. README en la raíz.
    zip.file('README.md', buildReadmeMarkdown(data, now))

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    const filename = `Biblia_de_Lore_${fileDate(now)}.zip`
    triggerDownload(blob, filename)
    return { ok: true, filename }
  } catch {
    return { ok: false, error: 'No se pudo generar el archivo ZIP de exportación.' }
  }
}

/* -------------------------------------------------------------------------- */
/* Restauración                                                               */
/* -------------------------------------------------------------------------- */

/** Resultado de la lectura de un backup desde archivo. */
export type RestoreReadResult =
  | { ok: true; json: string }
  | { ok: false; error: string }

/**
 * Lee el texto del backup desde un archivo .json o .zip. Para .zip, extrae
 * /backup_maestro/lorekeeper_backup.json. Devuelve el JSON como texto para que
 * el llamador lo pase a importBackup (que valida y rehidrata).
 */
export async function readBackupFromFile(file: File): Promise<RestoreReadResult> {
  const lower = file.name.toLowerCase()

  try {
    if (lower.endsWith('.json')) {
      return { ok: true, json: await file.text() }
    }

    if (lower.endsWith('.zip')) {
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(await file.arrayBuffer())
      const entry =
        zip.file('backup_maestro/lorekeeper_backup.json') ??
        // Respaldo: busca cualquier lorekeeper_backup.json en el ZIP.
        zip.file(/lorekeeper_backup\.json$/i)[0]

      if (!entry) {
        return {
          ok: false,
          error: 'El .zip no contiene un backup_maestro/lorekeeper_backup.json válido.',
        }
      }
      return { ok: true, json: await entry.async('string') }
    }

    return {
      ok: false,
      error: 'Formato no soportado. Selecciona un archivo .json o .zip.',
    }
  } catch {
    return { ok: false, error: `No se pudo leer "${file.name}".` }
  }
}
