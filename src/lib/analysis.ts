/**
 * Análisis automático de manuscritos con IA + upsert/merge determinista.
 *
 * Dado el texto de un manuscrito y el estado actual del proyecto, pide a Gemini
 * una extracción JSON estructurada de entidades, términos de glosario y anexos
 * de compendio, y fusiona el resultado en el estado SIN confirmación manual:
 *   - Si no existe (por nombre/alias o término, ignorando mayúsculas): se crea.
 *   - Si ya existe: se enriquece (alias nuevos sin repetir, notas y citas
 *     concatenadas, contexto/definición actualizados sin perder lo previo).
 *
 * El merge es una función PURA sobre LoreKeeperData, apta para usarse con el
 * `setData` del hook en una sola actualización atómica.
 */

import type {
  EntityRelationship,
  EntityRole,
  EntitySheet,
  GlossaryCategory,
  GlossaryClarityLevel,
  GlossaryTerm,
  LoreKeeperData,
} from '../types'
import {
  coerceEntityRole,
  GLOSSARY_CATEGORIES,
  GLOSSARY_CLARITY_LEVELS,
} from '../types'
import { createId, nowIso } from './parse'

/* -------------------------------------------------------------------------- */
/* Forma del JSON que se pide a Gemini                                        */
/* -------------------------------------------------------------------------- */

/** Relación entre personajes tal como la devuelve la IA en el análisis. */
export interface AiRelationship {
  targetEntityName?: string
  relationType?: string
}

export interface AiEntity {
  name?: string
  role?: string
  narrativeRole?: string
  aliases?: string[]
  physicalDescription?: string
  psychology?: string
  motivation?: string
  internalConflict?: string
  powers?: string
  relationships?: AiRelationship[]
  status?: string
  firstAppearance?: string
  notes?: string
  quotes?: string[]
}

export interface AiGlossaryTerm {
  term?: string
  category?: string
  definition?: string
  contextInStory?: string
  clarityLevel?: string
  /** Contexto adicional: reglas, límites, rumores, etimología. */
  notes?: string
}

export interface AiCompendiumAnnex {
  title?: string
  subtitle?: string
  type?: string
  contentMarkdown?: string
}

export interface AiExtraction {
  entities?: AiEntity[]
  glossary?: AiGlossaryTerm[]
  compendium?: AiCompendiumAnnex[]
  /** Título de la obra/saga si aparece explícitamente en el texto. */
  detectedWorkTitle?: string | null
  /** Nombre o seudónimo del autor si se menciona en el texto. */
  detectedAuthorName?: string | null
}

/** Resumen del resultado del merge (para el toast). */
export interface MergeSummary {
  entitiesCreated: number
  entitiesUpdated: number
  termsCreated: number
  termsUpdated: number
  annexesCreated: number
  annexesUpdated: number
}

export const emptySummary: MergeSummary = {
  entitiesCreated: 0,
  entitiesUpdated: 0,
  termsCreated: 0,
  termsUpdated: 0,
  annexesCreated: 0,
  annexesUpdated: 0,
}

/* -------------------------------------------------------------------------- */
/* Prompt e instrucción de sistema                                           */
/* -------------------------------------------------------------------------- */

export const ANALYSIS_SYSTEM_INSTRUCTION = `Eres un extractor de datos narrativos para LoreKeeper.
A partir del MANUSCRITO analizado, identificas personajes/entidades, términos del mundo y posibles anexos de compendio.
Devuelves EXCLUSIVAMENTE un objeto JSON (sin texto adicional) con esta forma exacta:
{
  "entities": [{ "name": string, "role": string, "narrativeRole": string, "aliases": string[], "physicalDescription": string, "psychology": string, "motivation": string, "internalConflict": string, "powers": string, "relationships": [{ "targetEntityName": string, "relationType": string }], "status": string, "firstAppearance": string, "notes": string, "quotes": string[] }],
  "glossary": [{ "term": string, "category": string, "definition": string, "contextInStory": string, "clarityLevel": string, "notes": string }],
  "compendium": [{ "title": string, "subtitle": string, "type": string, "contentMarkdown": string }],
  "detectedWorkTitle": string | null,
  "detectedAuthorName": string | null
}
Reglas:
- detectedWorkTitle: título de la obra o saga SOLO si aparece explícitamente en encabezados, portadas, páginas de título o notas iniciales. Si no aparece con claridad, usa null. NO inventes un título a partir del contenido.
- detectedAuthorName: nombre o seudónimo del autor SOLO si se menciona explícitamente (ej. "por …", "autor:", "escrito por …"). Si no aparece, usa null. NO inventes un autor.
- role (rol estructural) debe ser uno de: Protagonista, Antagonista, Deuteragonista, Mentor, Secundario, Aliado, Otro. Si no está claro, usa "Otro".
- narrativeRole es texto libre para el parentesco o rol dramático (ej. "Hijo de la Casa Hawke", "Madre de Aldric", "Cuerpo huésped"). Puede quedar vacío.
- category debe ser una de: Magia/Sobrenatural, Lugares/Geografía, Órdenes/Facciones, Reliquias/Artefactos, Historia/Eras, Criaturas/Razas, Costumbres/Leyes. Clasifica según el tipo real del término: lugares → Lugares/Geografía; artefactos/objetos/reliquias → Reliquias/Artefactos; magia/habilidades/poderes → Magia/Sobrenatural; facciones/órdenes/gremios → Órdenes/Facciones; criaturas/razas → Criaturas/Razas; conceptos, leyes o costumbres → Costumbres/Leyes.
- clarityLevel debe ser uno de: Claro, Críptico, Ambiguo.
- Para cada término del glosario:
  · term: nombre exacto del concepto, objeto, lugar o término.
  · definition: definición concisa y precisa basada SOLO en los hechos del texto.
  · notes: contexto adicional relevante (reglas de uso, limitaciones, advertencias, rumores o etimología mencionados en la escena). Si no hay detalles complementarios aparte de la definición directa, usa cadena vacía "". NO inventes datos.
- Básate SOLO en el manuscrito. No inventes datos que no se deduzcan del texto. Si un campo no aplica, usa string vacío o arreglo vacío.
- Responde en español.

FICHA DE PERSONAJE (COMPLETA RIGUROSAMENTE):
Por cada personaje relevante que interactúe o se mencione en el capítulo, completa su ficha con estos criterios:
- motivation: Si el personaje expresa un deseo, juramento, objetivo inmediato o propósito en la escena, regístralo textualmente o en una frase concisa. Si no hay indicios, déjalo vacío "". NO inventes motivos genéricos.
- internalConflict: Si experimenta culpa, miedo, dudas sobre sus órdenes o lealtad dividida, descríbelo. Si es un personaje secundario plano o de paso, déjalo vacío "".
- powers: Si utiliza magia, técnicas marciales, transformaciones, armas legendarias o destrezas particulares, enuméralas de forma concreta. Si no demuestra ninguna, déjalo vacío "".
- relationships: Extrae el tipo de relación directa mostrada en el texto hacia otros personajes del capítulo (ej. "hermano de", "subordinado de", "asesino de", "aliado / mejor amigo"). Cada elemento es { "targetEntityName": nombre del otro personaje, "relationType": tipo de vínculo }. Si no hay vínculos explícitos, usa arreglo vacío [].
- status: Determina si al cierre del capítulo el personaje se encuentra vivo, herido, cautivo, desaparecido o fallecido según los acontecimientos relatados (ej. "Vivo", "Herido", "Cautivo", "Desaparecido", "Caído/Fallecido"). Si no se puede inferir, déjalo vacío "".
- firstAppearance: Deja este campo vacío ""; la aplicación asignará automáticamente el capítulo donde aparece por primera vez.

CONTROL DE DUPLICADOS DE ENTIDADES (CRÍTICO):
- Se te proporciona el catálogo actual de entidades del lore (campo "CATÁLOGO DE ENTIDADES").
- Si un personaje/facción/lugar/elemento corresponde a una entidad existente (por nombre, apellido, cargo o alias), REUTILIZA su nombre principal exacto tal como aparece en el catálogo (campo "name"). No crees una variante del mismo nombre.
- Si el texto usa un epíteto, apodo, título o nombre alternativo de una entidad ya existente, NO crees una entidad nueva: agrega ese alias al arreglo "aliases" de esa entidad (usando su "name" exacto del catálogo) y aporta la información nueva en los demás campos.
- Crea una entidad nueva ÚNICAMENTE si es inédita, es decir, si no corresponde por nombre, apellido, cargo ni alias a ninguna entidad del catálogo.`

/** Recorta un texto a un máximo de caracteres para el catálogo liviano. */
function shortText(text: string, max = 140): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1).trimEnd()}…`
}

/**
 * Catálogo liviano de entidades existentes para el prompt de análisis.
 * Solo nombre, alias, categoría (rol) y una descripción breve, para que el
 * modelo reutilice entidades en lugar de duplicarlas.
 */
function buildEntityCatalog(data: LoreKeeperData): Array<{
  name: string
  aliases: string[]
  category: string
  shortDesc: string
}> {
  return data.entities.map((e) => ({
    name: e.name,
    aliases: e.aliases,
    category: e.role,
    shortDesc: shortText(
      e.physicalDescription.trim().length > 0
        ? e.physicalDescription
        : e.notes.trim().length > 0
          ? e.notes
          : e.narrativeRole,
    ),
  }))
}

/** Construye el prompt con el manuscrito y un resumen de lo ya registrado. */
export function buildAnalysisPrompt(
  manuscriptTitle: string,
  manuscriptContent: string,
  data: LoreKeeperData,
): string {
  const catalog = buildEntityCatalog(data)
  const knownEntities =
    catalog.length > 0 ? JSON.stringify(catalog, null, 0) : '[]'
  const knownTerms = data.glossary.map((t) => t.term).join('; ') || '(ninguno)'
  const knownAnnexes = data.compendium.map((a) => a.title).join('; ') || '(ninguno)'

  return [
    '===== CATÁLOGO DE ENTIDADES (reutiliza "name" exacto; NO dupliques) =====',
    knownEntities,
    '',
    '===== OTROS DATOS ACTUALES (para no duplicar) =====',
    `Términos: ${knownTerms}`,
    `Anexos: ${knownAnnexes}`,
    '',
    `===== MANUSCRITO: ${manuscriptTitle} =====`,
    manuscriptContent,
  ].join('\n')
}

/* -------------------------------------------------------------------------- */
/* Utilidades de normalización/merge                                          */
/* -------------------------------------------------------------------------- */

/** Normaliza un texto para comparaciones (minúsculas, sin acentos, trim). */
function norm(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Une dos listas de strings sin duplicados (ignorando mayúsculas/acentos). */
function mergeStringLists(current: string[], incoming: string[]): string[] {
  const result = [...current]
  const seen = new Set(current.map(norm))
  for (const item of incoming) {
    const clean = item.trim()
    if (clean.length === 0) continue
    if (!seen.has(norm(clean))) {
      seen.add(norm(clean))
      result.push(clean)
    }
  }
  return result
}

/** Concatena texto nuevo a uno existente evitando repetir contenido idéntico. */
function appendText(current: string, incoming: string): string {
  const inc = incoming.trim()
  if (inc.length === 0) return current
  if (current.trim().length === 0) return inc
  if (norm(current).includes(norm(inc))) return current
  return `${current.trim()}\n${inc}`
}

/** Rellena un campo solo si estaba vacío; si no, lo conserva. */
function fillIfEmpty(current: string, incoming: string): string {
  if (current.trim().length > 0) return current
  return incoming.trim()
}

/**
 * Enriquece una definición existente con una nueva aparición:
 *  - Si la previa está vacía, usa la nueva.
 *  - Si la nueva está vacía o ya está contenida en la previa, conserva la previa.
 *  - Si la nueva aporta contenido inédito, la concatena preservando lo anterior
 *    (así una faceta desconocida se suma sin borrar la definición global).
 */
function enrichDefinition(current: string, incoming: string): string {
  const cur = current.trim()
  const inc = incoming.trim()
  if (cur.length === 0) return inc
  if (inc.length === 0) return cur
  if (norm(cur).includes(norm(inc))) return cur
  return `${cur}\n${inc}`
}

/**
 * Alias de categorías: mapea etiquetas simplificadas (singular, español común)
 * que la IA puede devolver hacia el enum canónico del glosario.
 */
const CATEGORY_ALIASES: Record<string, GlossaryCategory> = {
  lugar: 'Lugares/Geografía',
  lugares: 'Lugares/Geografía',
  geografia: 'Lugares/Geografía',
  artefacto: 'Reliquias/Artefactos',
  artefactos: 'Reliquias/Artefactos',
  objeto: 'Reliquias/Artefactos',
  reliquia: 'Reliquias/Artefactos',
  reliquias: 'Reliquias/Artefactos',
  magia: 'Magia/Sobrenatural',
  habilidad: 'Magia/Sobrenatural',
  'magia / habilidad': 'Magia/Sobrenatural',
  'magia/habilidad': 'Magia/Sobrenatural',
  poder: 'Magia/Sobrenatural',
  sobrenatural: 'Magia/Sobrenatural',
  faccion: 'Órdenes/Facciones',
  facciones: 'Órdenes/Facciones',
  orden: 'Órdenes/Facciones',
  ordenes: 'Órdenes/Facciones',
  'faccion / orden': 'Órdenes/Facciones',
  'faccion/orden': 'Órdenes/Facciones',
  criatura: 'Criaturas/Razas',
  criaturas: 'Criaturas/Razas',
  raza: 'Criaturas/Razas',
  concepto: 'Costumbres/Leyes',
  conceptos: 'Costumbres/Leyes',
  ley: 'Costumbres/Leyes',
  leyes: 'Costumbres/Leyes',
  costumbre: 'Costumbres/Leyes',
  historia: 'Historia/Eras',
  era: 'Historia/Eras',
}

/** Valida/normaliza la categoría contra las permitidas (con alias). */
function coerceCategory(value: string | undefined): GlossaryCategory {
  const key = norm(value ?? '')
  // Coincidencia exacta con el enum canónico.
  const match = GLOSSARY_CATEGORIES.find((c) => norm(c) === key)
  if (match) return match
  // Alias simplificado (singular/español común).
  if (key in CATEGORY_ALIASES) return CATEGORY_ALIASES[key]
  return 'Costumbres/Leyes'
}

/**
 * Combina una lista de apariciones/capítulos (texto separado por comas) con uno
 * o más capítulos nuevos, sin duplicar entradas ya registradas (insensible a
 * mayúsculas/acentos). Devuelve la lista resultante como texto "A, B, C".
 */
function mergeChapterList(current: string, ...incoming: string[]): string {
  const parts = current
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const seen = new Set(parts.map(norm))
  for (const raw of incoming) {
    const clean = raw.trim()
    if (clean.length === 0) continue
    if (seen.has(norm(clean))) continue
    seen.add(norm(clean))
    parts.push(clean)
  }
  return parts.join(', ')
}

/** Valida/normaliza el nivel de claridad contra los permitidos. */
function coerceClarity(value: string | undefined): GlossaryClarityLevel {
  const match = GLOSSARY_CLARITY_LEVELS.find((c) => norm(c) === norm(value ?? ''))
  return match ?? 'Ambiguo'
}

/** Divide un nombre propio en tokens normalizados significativos (>2 chars). */
function nameTokens(name: string): string[] {
  return norm(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
}

/**
 * ¿La entidad existente corresponde al nombre entrante?
 *
 * Coincide si:
 *  1. El nombre coincide exacto (sin mayúsculas/acentos), o
 *  2. Cualquier alias coincide exacto, o
 *  3. Hay contención de nombres propios (un token del nombre entrante está
 *     contenido en el existente o viceversa, p. ej. "Sora" ⊂ "Sora Inoki"),
 *     exigiendo la MISMA categoría (role) cuando esta se proporciona, para
 *     evitar fusionar homónimos de distinto tipo.
 */
function entityMatches(
  existing: EntitySheet,
  incomingName: string,
  incomingRole?: EntityRole,
): boolean {
  const target = norm(incomingName)
  if (target.length === 0) return false

  // 1 y 2: coincidencia exacta por nombre o alias.
  if (norm(existing.name) === target) return true
  if (existing.aliases.some((a) => norm(a) === target)) return true

  // 3: contención por tokens de nombre propio, bajo la misma categoría.
  const sameCategory =
    incomingRole === undefined ||
    incomingRole === 'Otro' ||
    existing.role === 'Otro' ||
    existing.role === incomingRole
  if (!sameCategory) return false

  const incomingTokens = nameTokens(incomingName)
  if (incomingTokens.length === 0) return false

  // Tokens de todos los nombres propios conocidos de la entidad existente.
  const existingNames = [existing.name, ...existing.aliases]
  const existingTokens = new Set(existingNames.flatMap(nameTokens))
  if (existingTokens.size === 0) return false

  // Comparte al menos un token de nombre propio (p. ej. "Sora").
  return incomingTokens.some((t) => existingTokens.has(t))
}

/** Convierte las relaciones de la IA al formato interno {target, relation}. */
function mapAiRelationships(
  rels: AiRelationship[] | undefined,
): EntityRelationship[] {
  if (!rels) return []
  const result: EntityRelationship[] = []
  const seen = new Set<string>()
  for (const r of rels) {
    const target = (r.targetEntityName ?? '').trim()
    const relation = (r.relationType ?? '').trim()
    if (target.length === 0 && relation.length === 0) continue
    const key = `${norm(target)}|${norm(relation)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ target, relation })
  }
  return result
}

/** Une relaciones existentes con nuevas sin duplicar (por target+relation). */
function mergeRelationships(
  current: EntityRelationship[],
  incoming: EntityRelationship[],
): EntityRelationship[] {
  const result = [...current]
  const seen = new Set(current.map((r) => `${norm(r.target)}|${norm(r.relation)}`))
  for (const r of incoming) {
    const key = `${norm(r.target)}|${norm(r.relation)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(r)
  }
  return result
}

/**
 * Actualiza el estado en la historia. El estado puede evolucionar entre
 * capítulos (vivo → herido → muerto), así que un valor entrante no vacío
 * reemplaza al previo. Si la IA no aporta estado, se conserva el anterior.
 */
function updateStatus(current: string, incoming: string): string {
  const inc = incoming.trim()
  return inc.length > 0 ? inc : current
}

/* -------------------------------------------------------------------------- */
/* Merge principal                                                            */
/* -------------------------------------------------------------------------- */

export interface MergeOutcome {
  next: LoreKeeperData
  summary: MergeSummary
}

/**
 * Fusiona la extracción de la IA sobre el estado actual. Función pura: devuelve
 * un nuevo LoreKeeperData y un resumen de cuántos registros se crearon/actualizaron.
 */
export function mergeExtraction(
  data: LoreKeeperData,
  extraction: AiExtraction,
  chapterTitle = '',
): MergeOutcome {
  const summary: MergeSummary = { ...emptySummary }
  const timestamp = nowIso()
  const chapter = chapterTitle.trim()

  /* --- Entidades --- */
  const entities = [...data.entities]
  for (const ai of extraction.entities ?? []) {
    const name = (ai.name ?? '').trim()
    if (name.length === 0) continue

    const incomingRole = coerceEntityRole((ai.role ?? '').trim())
    const incomingRels = mapAiRelationships(ai.relationships)
    const index = entities.findIndex((e) =>
      entityMatches(e, name, incomingRole),
    )
    if (index === -1) {
      entities.unshift({
        id: createId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        name,
        aliases: (ai.aliases ?? []).map((a) => a.trim()).filter(Boolean),
        role: incomingRole,
        narrativeRole: (ai.narrativeRole ?? '').trim(),
        physicalDescription: (ai.physicalDescription ?? '').trim(),
        psychology: (ai.psychology ?? '').trim(),
        motivation: (ai.motivation ?? '').trim(),
        internalConflict: (ai.internalConflict ?? '').trim(),
        powersOrAbilities: (ai.powers ?? '').trim(),
        relationships: incomingRels,
        keyQuotes: (ai.quotes ?? []).map((q) => q.trim()).filter(Boolean),
        statusInStory: (ai.status ?? '').trim(),
        notes: (ai.notes ?? '').trim(),
        // Si la IA no da primera aparición, se asigna el capítulo actual.
        firstAppearance: (ai.firstAppearance ?? '').trim() || chapter,
      })
      summary.entitiesCreated += 1
    } else {
      const prev = entities[index]
      // Adopta un rol canónico sugerido solo si el previo era 'Otro'.
      const nextRole =
        prev.role === 'Otro' && incomingRole !== 'Otro' ? incomingRole : prev.role
      // Si el nombre entrante no es el principal, se preserva como alias.
      const incomingAliases =
        norm(name) === norm(prev.name)
          ? (ai.aliases ?? [])
          : [name, ...(ai.aliases ?? [])]
      entities[index] = {
        ...prev,
        aliases: mergeStringLists(prev.aliases, incomingAliases),
        role: nextRole,
        narrativeRole: fillIfEmpty(prev.narrativeRole, ai.narrativeRole ?? ''),
        physicalDescription: fillIfEmpty(
          prev.physicalDescription,
          ai.physicalDescription ?? '',
        ),
        psychology: fillIfEmpty(prev.psychology, ai.psychology ?? ''),
        // Campos de ficha: rellenar si estaban vacíos; el estado puede cambiar
        // entre capítulos (p. ej. herido → muerto), así que se actualiza si la
        // IA aporta un valor nuevo, sin perder el previo si la IA no dice nada.
        motivation: fillIfEmpty(prev.motivation, ai.motivation ?? ''),
        internalConflict: fillIfEmpty(
          prev.internalConflict,
          ai.internalConflict ?? '',
        ),
        powersOrAbilities: appendText(prev.powersOrAbilities, ai.powers ?? ''),
        relationships: mergeRelationships(prev.relationships, incomingRels),
        statusInStory: updateStatus(prev.statusInStory, ai.status ?? ''),
        keyQuotes: mergeStringLists(prev.keyQuotes, ai.quotes ?? []),
        notes: appendText(prev.notes, ai.notes ?? ''),
        // Conserva la primera aparición previa; si faltaba, usa el capítulo.
        firstAppearance: fillIfEmpty(prev.firstAppearance, chapter),
        updatedAt: timestamp,
      }
      summary.entitiesUpdated += 1
    }
  }

  /* --- Glosario --- */
  const glossary = [...data.glossary]
  for (const ai of extraction.glossary ?? []) {
    const term = (ai.term ?? '').trim()
    if (term.length === 0) continue

    const index = glossary.findIndex((t) => norm(t.term) === norm(term))
    if (index === -1) {
      glossary.unshift({
        id: createId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        term,
        category: coerceCategory(ai.category),
        definition: (ai.definition ?? '').trim(),
        contextInStory: (ai.contextInStory ?? '').trim(),
        clarityLevel: coerceClarity(ai.clarityLevel),
        notes: (ai.notes ?? '').trim(),
        // Registra el capítulo actual como primera aparición del término.
        occurrencesOrChapters: chapter,
      })
      summary.termsCreated += 1
    } else {
      const prev = glossary[index]
      glossary[index] = {
        ...prev,
        // La definición se rellena si faltaba; si una nueva aparición aporta
        // más detalle y la previa era breve, se enriquece sin perder lo previo.
        definition: enrichDefinition(prev.definition, ai.definition ?? ''),
        contextInStory: appendText(prev.contextInStory, ai.contextInStory ?? ''),
        // Notas acumulativas: concatena contexto nuevo respetando lo anterior.
        notes: appendText(prev.notes, ai.notes ?? ''),
        // Registra el capítulo actual en la lista de apariciones (sin duplicar).
        occurrencesOrChapters: mergeChapterList(prev.occurrencesOrChapters, chapter),
        updatedAt: timestamp,
      }
      summary.termsUpdated += 1
    }
  }

  /* --- Compendio --- */
  const compendium = [...data.compendium]
  for (const ai of extraction.compendium ?? []) {
    const title = (ai.title ?? '').trim()
    if (title.length === 0) continue

    const index = compendium.findIndex((a) => norm(a.title) === norm(title))
    if (index === -1) {
      compendium.unshift({
        id: createId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        title,
        subtitle: (ai.subtitle ?? '').trim(),
        type: (ai.type ?? '').trim(),
        contentMarkdown: (ai.contentMarkdown ?? '').trim(),
      })
      summary.annexesCreated += 1
    } else {
      const prev = compendium[index]
      compendium[index] = {
        ...prev,
        subtitle: fillIfEmpty(prev.subtitle, ai.subtitle ?? ''),
        type: fillIfEmpty(prev.type, ai.type ?? ''),
        contentMarkdown: appendText(prev.contentMarkdown, ai.contentMarkdown ?? ''),
        updatedAt: timestamp,
      }
      summary.annexesUpdated += 1
    }
  }

  /* --- Identidad del proyecto (auto-rellenado protector) --- */
  // Solo se completa si el campo está VACÍO y la IA aporta un valor válido.
  // Nunca sobrescribe lo que el autor ya definió o lo detectado previamente.
  const settings = { ...data.settings }
  const detectedTitle = cleanDetected(extraction.detectedWorkTitle)
  const detectedAuthor = cleanDetected(extraction.detectedAuthorName)
  if (settings.projectTitle.trim().length === 0 && detectedTitle) {
    settings.projectTitle = detectedTitle
  }
  if (settings.authorName.trim().length === 0 && detectedAuthor) {
    settings.authorName = detectedAuthor
  }

  return {
    next: { ...data, entities, glossary, compendium, settings },
    summary,
  }
}

/**
 * Normaliza un valor detectado por la IA (title/author). Devuelve el texto
 * recortado si es válido, o null si viene nulo/vacío o es un marcador inútil.
 */
function cleanDetected(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  if (clean.length === 0) return null
  // Descarta marcadores comunes que no son un dato real.
  if (['null', 'n/a', 'na', 'desconocido', 'sin titulo', 'sin título'].includes(
    clean.toLowerCase(),
  )) {
    return null
  }
  return clean
}

/** Total de elementos afectados (para decidir si mostrar toast). */
export function totalAffected(s: MergeSummary): number {
  return (
    s.entitiesCreated +
    s.entitiesUpdated +
    s.termsCreated +
    s.termsUpdated +
    s.annexesCreated +
    s.annexesUpdated
  )
}

/** Mensaje resumido para el toast. */
export function summaryMessage(s: MergeSummary): string {
  const entities = s.entitiesCreated + s.entitiesUpdated
  const terms = s.termsCreated + s.termsUpdated
  return `Sincronización completada: ${entities} entidades y ${terms} términos actualizados/creados`
}

/**
 * Tipo del objeto que Gemini debe devolver, re-exportado para el consumidor.
 * (Alias semántico de AiExtraction.)
 */
export type AnalysisResult = AiExtraction

/* -------------------------------------------------------------------------- */
/* Fusión inteligente de entidades (Smart Merge con IA)                       */
/* -------------------------------------------------------------------------- */

/** Instrucción de sistema para la síntesis de dos fichas en una canónica. */
export const ENTITY_MERGE_SYSTEM_INSTRUCTION = `Actúa como un editor literario. Combina estas dos fichas del mismo personaje en una sola ficha canónica.
Unifica los alias sin repetir, sintetiza la descripción física y la psicología en textos fluidos y coherentes sin contradicciones, consolida las notas y citas, y selecciona el rol más adecuado.
Devuelve EXCLUSIVAMENTE un objeto JSON con esta forma:
{
  "name": string,
  "role": string,
  "narrativeRole": string,
  "aliases": string[],
  "physicalDescription": string,
  "psychology": string,
  "motivation": string,
  "internalConflict": string,
  "powersOrAbilities": string,
  "keyQuotes": string[],
  "statusInStory": string,
  "notes": string,
  "firstAppearance": string
}
Reglas:
- role debe ser uno de: Protagonista, Antagonista, Deuteragonista, Mentor, Secundario, Aliado, Otro.
- narrativeRole es texto libre (parentesco o rol dramático).
- No inventes datos que no estén en ninguna de las dos fichas. Responde en español.`

/** Forma JSON que devuelve Gemini al sintetizar una entidad. */
export interface AiMergedEntity {
  name?: string
  role?: string
  narrativeRole?: string
  aliases?: string[]
  physicalDescription?: string
  psychology?: string
  motivation?: string
  internalConflict?: string
  powersOrAbilities?: string
  keyQuotes?: string[]
  statusInStory?: string
  notes?: string
  firstAppearance?: string
}

/** Serializa una entidad a JSON compacto para enviarla al modelo. */
function entityToJson(e: EntitySheet): Record<string, unknown> {
  return {
    name: e.name,
    role: e.role,
    narrativeRole: e.narrativeRole,
    aliases: e.aliases,
    physicalDescription: e.physicalDescription,
    psychology: e.psychology,
    motivation: e.motivation,
    internalConflict: e.internalConflict,
    powersOrAbilities: e.powersOrAbilities,
    relationships: e.relationships,
    keyQuotes: e.keyQuotes,
    statusInStory: e.statusInStory,
    notes: e.notes,
    firstAppearance: e.firstAppearance,
  }
}

/** Construye el prompt de fusión con las dos fichas completas. */
export function buildEntityMergePrompt(
  primary: EntitySheet,
  secondary: EntitySheet,
): string {
  return [
    'FICHA A:',
    JSON.stringify(entityToJson(primary), null, 2),
    '',
    'FICHA B:',
    JSON.stringify(entityToJson(secondary), null, 2),
  ].join('\n')
}

/**
 * Construye la entidad canónica final a partir de la síntesis de la IA,
 * conservando el id/fechas de la entidad primaria y fusionando de forma segura
 * las relaciones de ambas (la IA no las maneja). Campos vacíos de la IA se
 * rellenan con el valor de la primaria como respaldo.
 */
export function applyEntityMerge(
  primary: EntitySheet,
  secondary: EntitySheet,
  ai: AiMergedEntity,
): EntitySheet {
  const pick = (aiValue: string | undefined, fallback: string): string => {
    const v = (aiValue ?? '').trim()
    return v.length > 0 ? v : fallback
  }

  const aliases = mergeStringLists(
    mergeStringLists(primary.aliases, secondary.aliases),
    (ai.aliases ?? []).map((a) => a.trim()).filter(Boolean),
  )
  const keyQuotes =
    ai.keyQuotes && ai.keyQuotes.length > 0
      ? mergeStringLists([], ai.keyQuotes)
      : mergeStringLists(primary.keyQuotes, secondary.keyQuotes)

  // Relaciones: unión por "target|relation" (la IA no las sintetiza).
  const relMap = new Map<string, { target: string; relation: string }>()
  for (const r of [...primary.relationships, ...secondary.relationships]) {
    relMap.set(`${r.target}|${r.relation}`.toLowerCase(), r)
  }

  const role: EntityRole = (
    ['Protagonista', 'Antagonista', 'Deuteragonista', 'Mentor', 'Secundario', 'Aliado', 'Otro'] as const
  ).includes(ai.role as EntityRole)
    ? (ai.role as EntityRole)
    : primary.role

  return {
    ...primary,
    name: pick(ai.name, primary.name),
    role,
    narrativeRole: pick(ai.narrativeRole, primary.narrativeRole),
    aliases,
    physicalDescription: pick(ai.physicalDescription, primary.physicalDescription),
    psychology: pick(ai.psychology, primary.psychology),
    motivation: pick(ai.motivation, primary.motivation),
    internalConflict: pick(ai.internalConflict, primary.internalConflict),
    powersOrAbilities: pick(ai.powersOrAbilities, primary.powersOrAbilities),
    relationships: Array.from(relMap.values()),
    keyQuotes,
    statusInStory: pick(ai.statusInStory, primary.statusInStory),
    notes: pick(ai.notes, primary.notes),
    firstAppearance: pick(ai.firstAppearance, primary.firstAppearance),
    updatedAt: nowIso(),
  }
}

/* -------------------------------------------------------------------------- */
/* Detección y fusión determinista de duplicados (sin IA)                     */
/* -------------------------------------------------------------------------- */

/** Un par de entidades sospechosas de ser la misma, con el motivo detectado. */
export interface DuplicatePair {
  /** Clave estable del par (ids ordenados) para descartes/seguimiento. */
  key: string
  a: EntitySheet
  b: EntitySheet
  /** Puntuación 0..1: mayor = más probable que sean la misma entidad. */
  score: number
  /** Motivo legible de la sospecha. */
  reason: string
}

/** Todos los nombres propios de una entidad (principal + alias), normalizados. */
function allNameTokens(e: EntitySheet): Set<string> {
  return new Set([e.name, ...e.aliases].flatMap(nameTokens))
}

/** Intersección de dos conjuntos de strings. */
function intersectCount(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const x of a) if (b.has(x)) n += 1
  return n
}

/** Similitud de Jaccard entre dos conjuntos de tokens (0..1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const inter = intersectCount(a, b)
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/** Tokens de contenido (descripción/psicología/rol) para similitud textual. */
function contentTokens(e: EntitySheet): Set<string> {
  const text = [e.narrativeRole, e.physicalDescription, e.psychology, e.notes]
    .join(' ')
  return new Set(
    norm(text)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4),
  )
}

/**
 * Detecta pares de entidades sospechosas de estar duplicadas.
 *
 * Señales (combinadas en una puntuación):
 *  - Comparten uno o más tokens de nombre propio (p. ej. "Sora" en
 *    "Sora Inoki" y "Sora"): señal fuerte.
 *  - El nombre/alias de una está contenido en el de la otra: señal fuerte.
 *  - Alta similitud de contenido (descripción/rol/psicología) bajo la misma
 *    categoría: señal de apoyo.
 *
 * Devuelve los pares con score >= umbral, ordenados de mayor a menor score.
 */
export function findDuplicatePairs(
  entities: EntitySheet[],
  minScore = 0.34,
): DuplicatePair[] {
  const pairs: DuplicatePair[] = []

  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i]
      const b = entities[j]

      const aNames = allNameTokens(a)
      const bNames = allNameTokens(b)
      const sharedNameTokens = intersectCount(aNames, bNames)

      // Contención exacta de algún nombre/alias dentro del otro.
      const aLabels = [a.name, ...a.aliases].map(norm).filter(Boolean)
      const bLabels = [b.name, ...b.aliases].map(norm).filter(Boolean)
      const containment = aLabels.some((al) =>
        bLabels.some((bl) => {
          if (al === bl) return true
          const [short, long] = al.length <= bl.length ? [al, bl] : [bl, al]
          if (short.length < 3) return false
          // Coincidencia por palabra completa, no por subcadena arbitraria.
          return new RegExp(`(^|\\s)${escapeRegex(short)}(\\s|$)`).test(long)
        }),
      )

      const sameCategory =
        a.role === 'Otro' || b.role === 'Otro' || a.role === b.role
      const contentSim = jaccard(contentTokens(a), contentTokens(b))

      let score = 0
      const reasons: string[] = []

      if (sharedNameTokens > 0) {
        score += 0.6
        reasons.push('comparten parte del nombre')
      }
      if (containment) {
        score += 0.25
        reasons.push('un nombre contiene al otro')
      }
      if (sameCategory && contentSim >= 0.3) {
        score += 0.3 * contentSim + 0.1
        reasons.push('descripción/rol similares')
      } else if (contentSim >= 0.5) {
        score += 0.2 * contentSim
        reasons.push('contenido parecido')
      }

      if (score >= minScore) {
        pairs.push({
          key: [a.id, b.id].sort().join('|'),
          a,
          b,
          score: Math.min(1, score),
          reason: reasons.join(' · ') || 'posible coincidencia',
        })
      }
    }
  }

  return pairs.sort((x, y) => y.score - x.score)
}

/** Escapa una cadena para usarla dentro de una expresión regular. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Fusiona dos entidades de forma DETERMINISTA (sin IA). La entidad `primary`
 * conserva su id y su nombre principal; el nombre de `secondary` se preserva
 * como alias. Se unen aliases, citas y relaciones sin repetir, y se concatenan
 * las notas; los campos de texto vacíos en la primaria se rellenan con los de
 * la secundaria.
 */
export function mergeEntitiesDeterministic(
  primary: EntitySheet,
  secondary: EntitySheet,
): EntitySheet {
  // El nombre secundario (y sus alias) pasan a ser alias de la fusionada.
  const aliases = mergeStringLists(
    mergeStringLists(primary.aliases, [secondary.name]),
    secondary.aliases,
  )

  const relMap = new Map<string, { target: string; relation: string }>()
  for (const r of [...primary.relationships, ...secondary.relationships]) {
    relMap.set(`${norm(r.target)}|${norm(r.relation)}`, r)
  }

  return {
    ...primary,
    aliases,
    role: primary.role !== 'Otro' ? primary.role : secondary.role,
    narrativeRole: fillIfEmpty(primary.narrativeRole, secondary.narrativeRole),
    physicalDescription: appendText(
      primary.physicalDescription,
      secondary.physicalDescription,
    ),
    psychology: appendText(primary.psychology, secondary.psychology),
    motivation: appendText(primary.motivation, secondary.motivation),
    internalConflict: appendText(
      primary.internalConflict,
      secondary.internalConflict,
    ),
    powersOrAbilities: appendText(
      primary.powersOrAbilities,
      secondary.powersOrAbilities,
    ),
    relationships: Array.from(relMap.values()),
    keyQuotes: mergeStringLists(primary.keyQuotes, secondary.keyQuotes),
    statusInStory: fillIfEmpty(primary.statusInStory, secondary.statusInStory),
    notes: appendText(primary.notes, secondary.notes),
    firstAppearance: fillIfEmpty(
      primary.firstAppearance,
      secondary.firstAppearance,
    ),
    updatedAt: nowIso(),
  }
}

/* -------------------------------------------------------------------------- */
/* Fusión inteligente de términos del glosario (Smart Merge con IA)           */
/* -------------------------------------------------------------------------- */

/** Instrucción de sistema para unificar dos términos del glosario en uno. */
export const GLOSSARY_MERGE_SYSTEM_INSTRUCTION = `Actúa como un lexicógrafo del mundo narrativo. Combina estas dos entradas del glosario que describen el MISMO concepto, objeto, lugar o término, en una sola entrada canónica.
Determina el nombre (término) canónico más correcto, consolida las definiciones en un texto único sin redundancias ni contradicciones, combina las notas de contexto respetando toda la información y selecciona la categoría y el nivel de claridad más adecuados.
Devuelve EXCLUSIVAMENTE un objeto JSON con esta forma:
{
  "term": string,
  "category": string,
  "definition": string,
  "contextInStory": string,
  "clarityLevel": string,
  "notes": string
}
Reglas:
- category debe ser una de: Magia/Sobrenatural, Lugares/Geografía, Órdenes/Facciones, Reliquias/Artefactos, Historia/Eras, Criaturas/Razas, Costumbres/Leyes.
- clarityLevel debe ser uno de: Claro, Críptico, Ambiguo.
- No inventes datos que no estén en ninguna de las dos entradas. Responde en español.`

/** Forma JSON que devuelve Gemini al sintetizar un término del glosario. */
export interface AiMergedGlossaryTerm {
  term?: string
  category?: string
  definition?: string
  contextInStory?: string
  clarityLevel?: string
  notes?: string
}

/** Serializa un término del glosario a JSON compacto para el modelo. */
function glossaryToJson(t: GlossaryTerm): Record<string, unknown> {
  return {
    term: t.term,
    category: t.category,
    definition: t.definition,
    contextInStory: t.contextInStory,
    clarityLevel: t.clarityLevel,
    notes: t.notes,
    occurrencesOrChapters: t.occurrencesOrChapters,
  }
}

/** Construye el prompt de fusión con las dos entradas completas. */
export function buildGlossaryMergePrompt(
  primary: GlossaryTerm,
  secondary: GlossaryTerm,
): string {
  return [
    'ENTRADA A:',
    JSON.stringify(glossaryToJson(primary), null, 2),
    '',
    'ENTRADA B:',
    JSON.stringify(glossaryToJson(secondary), null, 2),
  ].join('\n')
}

/**
 * Construye el término canónico final a partir de la síntesis de la IA,
 * conservando el id/fechas del término primario. El array de apariciones
 * (occurrencesOrChapters) se UNIFICA de forma determinista a partir de ambas
 * entradas (la IA no lo maneja). Campos vacíos de la IA caen al valor primario.
 */
export function applyGlossaryMerge(
  primary: GlossaryTerm,
  secondary: GlossaryTerm,
  ai: AiMergedGlossaryTerm,
): GlossaryTerm {
  const pick = (aiValue: string | undefined, fallback: string): string => {
    const v = (aiValue ?? '').trim()
    return v.length > 0 ? v : fallback
  }

  // Unifica apariciones de ambas entradas sin duplicar capítulos.
  const occurrences = mergeChapterList(
    primary.occurrencesOrChapters,
    ...secondary.occurrencesOrChapters
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  )

  return {
    ...primary,
    term: pick(ai.term, primary.term),
    // Si la IA no da una categoría válida, conserva la del término primario.
    category:
      (ai.category ?? '').trim().length > 0
        ? coerceCategory(ai.category)
        : primary.category,
    definition: pick(ai.definition, primary.definition),
    contextInStory: pick(ai.contextInStory, primary.contextInStory),
    clarityLevel: coerceClarity(ai.clarityLevel),
    notes: pick(ai.notes, primary.notes),
    occurrencesOrChapters: occurrences,
    updatedAt: nowIso(),
  }
}

/**
 * Fusiona dos términos del glosario de forma DETERMINISTA (sin IA). El `primary`
 * conserva su id y su término; se concatenan definiciones y notas sin perder lo
 * previo, y se unifican las apariciones sin duplicar.
 */
export function mergeGlossaryDeterministic(
  primary: GlossaryTerm,
  secondary: GlossaryTerm,
): GlossaryTerm {
  const occurrences = mergeChapterList(
    primary.occurrencesOrChapters,
    ...secondary.occurrencesOrChapters
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  )

  return {
    ...primary,
    definition: enrichDefinition(primary.definition, secondary.definition),
    contextInStory: appendText(primary.contextInStory, secondary.contextInStory),
    notes: appendText(primary.notes, secondary.notes),
    occurrencesOrChapters: occurrences,
    updatedAt: nowIso(),
  }
}
