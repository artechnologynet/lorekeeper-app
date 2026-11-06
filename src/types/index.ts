/**
 * Definiciones de tipos de datos del dominio de LoreKeeper.
 *
 * LoreKeeper organiza el "lore" de un universo narrativo en cinco grandes
 * secciones: manuscritos/archivos, entidades/fichas, glosario, compendio/anexos
 * y un asistente. Aquí se declaran las interfaces compartidas por toda la app.
 */

/** Identificador de cada sección de la navegación inferior. */
export type SectionId =
  | 'manuscript'
  | 'entities'
  | 'glossary'
  | 'compendium'
  | 'assistant'

/** Metadatos comunes a todo elemento persistido. */
export interface BaseRecord {
  id: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
}

/** Estado de análisis de un documento. */
export type ManuscriptStatus = 'draft' | 'pending' | 'analyzed'

/** Manuscrito / Archivo: documento de texto largo. */
export interface Manuscript extends BaseRecord {
  title: string
  content: string
  tags: string[]
  /**
   * Estado del documento respecto al análisis por IA:
   *  - 'draft'    Borrador (nuevo o editado tras analizar).
   *  - 'pending'  Pendiente (importado, aún sin analizar).
   *  - 'analyzed' Analizado y sincronizado con fichas/glosario.
   */
  status: ManuscriptStatus
}

/* -------------------------------------------------------------------------- */
/* Entidades / Fichas                                                         */
/* -------------------------------------------------------------------------- */

/** Relación de una entidad con otra (personaje, facción, lugar, etc.). */
export interface EntityRelationship {
  target: string
  relation: string
}

/**
 * Rol canónico/estructural de una entidad (enum cerrado, usado por los filtros).
 */
export const ENTITY_ROLES = [
  'Protagonista',
  'Antagonista',
  'Deuteragonista',
  'Mentor',
  'Secundario',
  'Aliado',
  'Otro',
] as const

export type EntityRole = (typeof ENTITY_ROLES)[number]

/** Rol por defecto cuando no se puede determinar uno válido. */
export const DEFAULT_ENTITY_ROLE: EntityRole = 'Otro'

/** Normaliza un valor arbitrario al enum EntityRole (fallback 'Otro'). */
export function coerceEntityRole(value: unknown): EntityRole {
  return (ENTITY_ROLES as readonly string[]).includes(value as string)
    ? (value as EntityRole)
    : DEFAULT_ENTITY_ROLE
}

/**
 * Ficha completa de una entidad (personaje, criatura u otro ser relevante).
 * Extiende BaseRecord para incluir metadatos de creación/actualización.
 */
export interface EntitySheet extends BaseRecord {
  name: string
  aliases: string[]
  /** Rol canónico/estructural (enum). Usado por los filtros. */
  role: EntityRole
  /**
   * Rol narrativo / parentesco en texto libre (ej. "Hijo de la Casa Hawke",
   * "Madre de Aldric", "Cuerpo huésped"). Descriptivo, no estructural.
   */
  narrativeRole: string
  physicalDescription: string
  psychology: string
  motivation: string
  internalConflict: string
  powersOrAbilities: string
  relationships: EntityRelationship[]
  keyQuotes: string[]
  statusInStory: string
  notes: string
  firstAppearance: string
}

/* -------------------------------------------------------------------------- */
/* Glosario                                                                   */
/* -------------------------------------------------------------------------- */

/** Categorías permitidas para un término del glosario. */
export type GlossaryCategory =
  | 'Magia/Sobrenatural'
  | 'Lugares/Geografía'
  | 'Órdenes/Facciones'
  | 'Reliquias/Artefactos'
  | 'Historia/Eras'
  | 'Criaturas/Razas'
  | 'Costumbres/Leyes'

/** Nivel de claridad narrativa de un término. */
export type GlossaryClarityLevel = 'Claro' | 'Críptico' | 'Ambiguo'

/** Lista de categorías disponibles (para selects de UI). */
export const GLOSSARY_CATEGORIES: GlossaryCategory[] = [
  'Magia/Sobrenatural',
  'Lugares/Geografía',
  'Órdenes/Facciones',
  'Reliquias/Artefactos',
  'Historia/Eras',
  'Criaturas/Razas',
  'Costumbres/Leyes',
]

/** Lista de niveles de claridad disponibles (para selects de UI). */
export const GLOSSARY_CLARITY_LEVELS: GlossaryClarityLevel[] = [
  'Claro',
  'Críptico',
  'Ambiguo',
]

/** Término del glosario del universo narrativo. */
export interface GlossaryTerm extends BaseRecord {
  term: string
  category: GlossaryCategory
  definition: string
  contextInStory: string
  clarityLevel: GlossaryClarityLevel
  notes: string
  occurrencesOrChapters: string
}

/* -------------------------------------------------------------------------- */
/* Compendio / Anexos                                                         */
/* -------------------------------------------------------------------------- */

/** Anexo del compendio: cronología, mapa, nota complementaria, etc. */
export interface CompendiumAnnex extends BaseRecord {
  title: string
  subtitle: string
  type: string
  contentMarkdown: string
}

/* -------------------------------------------------------------------------- */
/* Asistente                                                                  */
/* -------------------------------------------------------------------------- */

/** Mensaje dentro de una conversación con el asistente. */
export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string // ISO 8601
  /** Tipo de mensaje: 'scan' marca respuestas de escaneo con hallazgos accionables. */
  kind?: 'chat' | 'scan'
}

/* -------------------------------------------------------------------------- */
/* Ajustes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Nombre de modelo de Gemini. Es un `string` libre para permitir que el usuario
 * escriba un modelo personalizado (p. ej. versiones nuevas) además de los
 * sugeridos. La validación real la hace la API al llamar.
 */
export type GeminiModel = string

/** Grupo de modelos para el selector agrupado de Ajustes. */
export interface GeminiModelGroup {
  label: string
  models: GeminiModel[]
}

/**
 * Modelos agrupados por disponibilidad observada (para el <select> de Ajustes).
 *
 * Nota: solo `gemini-2.0-flash`, `gemini-1.5-flash` y `gemini-1.5-pro` son
 * identificadores reales y estables de la API pública de Gemini a la fecha. El
 * resto se incluye por decisión de producto; si Google aún no los publica,
 * devolverán error 404 al usarse (el campo "Personalizado" cubre modelos nuevos).
 */
export const GEMINI_MODEL_GROUPS: GeminiModelGroup[] = [
  {
    label: 'Recomendados (Mayor disponibilidad / Rápido)',
    models: [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
    ],
  },
  {
    label: 'Alta demanda (Saturación frecuente)',
    models: [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-1.5-pro',
    ],
  },
]

/** Lista plana de modelos sugeridos (todos los de los grupos). */
export const GEMINI_MODELS: GeminiModel[] = GEMINI_MODEL_GROUPS.flatMap(
  (group) => group.models,
)

/**
 * Modelo predeterminado: real y de alta disponibilidad para que el asistente
 * funcione desde el primer uso sin errores 404.
 */
export const DEFAULT_GEMINI_MODEL: GeminiModel = 'gemini-2.0-flash'

/** Ajustes de la aplicación (incluye configuración BYOK de Gemini). */
export interface AppSettings {
  geminiApiKey: string
  activeModel: GeminiModel
  temperature: number
  /** Título de la obra / saga. Vacío hasta que se detecte o se defina a mano. */
  projectTitle: string
  /** Nombre o seudónimo del autor. Vacío hasta detección o edición manual. */
  authorName: string
}

/** Ajustes por defecto. */
export const defaultSettings: AppSettings = {
  geminiApiKey: '',
  activeModel: DEFAULT_GEMINI_MODEL,
  temperature: 0.7,
  projectTitle: '',
  authorName: '',
}

/* -------------------------------------------------------------------------- */
/* Estado global                                                              */
/* -------------------------------------------------------------------------- */

/** Forma completa del estado persistido de la aplicación. */
export interface LoreKeeperData {
  manuscripts: Manuscript[]
  entities: EntitySheet[]
  glossary: GlossaryTerm[]
  compendium: CompendiumAnnex[]
  conversation: AssistantMessage[]
  settings: AppSettings
}
