/**
 * Construcción del contexto del proyecto para el Asistente del Autor.
 *
 * Serializa manuscritos, entidades y glosario en un bloque de texto compacto
 * que se inyecta en la instrucción de sistema, de modo que el modelo razone
 * SOLO sobre los datos reales del usuario. También define las instrucciones de
 * sistema para los modos Estricto y Creativo.
 */

import type { LoreKeeperData } from '../types'
import type { AssistantMode } from './gemini'

/** Límite de caracteres por manuscrito al construir el contexto (evita exceso). */
const MANUSCRIPT_CHAR_LIMIT = 6000

/** Resumen numérico del contexto disponible (para el badge de la UI). */
export interface ContextSummary {
  manuscripts: number
  entities: number
  glossaryTerms: number
}

/** Calcula el resumen del contexto a partir del estado. */
export function summarizeContext(data: LoreKeeperData): ContextSummary {
  return {
    manuscripts: data.manuscripts.length,
    entities: data.entities.length,
    glossaryTerms: data.glossary.length,
  }
}

/** Serializa las entidades en texto legible para el modelo. */
function serializeEntities(data: LoreKeeperData): string {
  if (data.entities.length === 0) return 'No hay fichas de entidades registradas.'

  return data.entities
    .map((e) => {
      const lines = [`- ${e.name} (rol: ${e.role || 'sin especificar'})`]
      if (e.aliases.length > 0) lines.push(`  Alias: ${e.aliases.join(', ')}`)
      if (e.motivation) lines.push(`  Motivación: ${e.motivation}`)
      if (e.internalConflict) lines.push(`  Conflicto interno: ${e.internalConflict}`)
      if (e.powersOrAbilities) lines.push(`  Poderes/habilidades: ${e.powersOrAbilities}`)
      if (e.statusInStory) lines.push(`  Estado en la historia: ${e.statusInStory}`)
      if (e.relationships.length > 0) {
        const rels = e.relationships
          .map((r) => `${r.target} (${r.relation})`)
          .join('; ')
        lines.push(`  Relaciones: ${rels}`)
      }
      if (e.notes) lines.push(`  Notas: ${e.notes}`)
      return lines.join('\n')
    })
    .join('\n')
}

/** Serializa el glosario en texto legible para el modelo. */
function serializeGlossary(data: LoreKeeperData): string {
  if (data.glossary.length === 0) return 'No hay términos en el glosario.'

  return data.glossary
    .map((t) => {
      const parts = [`- ${t.term} [${t.category}] (${t.clarityLevel})`]
      if (t.definition) parts.push(`  Definición: ${t.definition}`)
      if (t.contextInStory) parts.push(`  Contexto: ${t.contextInStory}`)
      return parts.join('\n')
    })
    .join('\n')
}

/** Serializa los manuscritos (recortando textos largos) para el modelo. */
function serializeManuscripts(data: LoreKeeperData): string {
  if (data.manuscripts.length === 0) return 'No hay manuscritos ni documentos.'

  return data.manuscripts
    .map((m) => {
      const body =
        m.content.length > MANUSCRIPT_CHAR_LIMIT
          ? `${m.content.slice(0, MANUSCRIPT_CHAR_LIMIT)}\n[...texto truncado...]`
          : m.content
      return `### ${m.title}\n${body || '(documento vacío)'}`
    })
    .join('\n\n')
}

/** Construye el bloque de contexto completo del proyecto. */
export function buildContextBlock(data: LoreKeeperData): string {
  return [
    '====== DATOS DEL PROYECTO (ÚNICA FUENTE DE VERDAD) ======',
    '',
    '--- ENTIDADES / FICHAS ---',
    serializeEntities(data),
    '',
    '--- GLOSARIO ---',
    serializeGlossary(data),
    '',
    '--- MANUSCRITOS / DOCUMENTOS ---',
    serializeManuscripts(data),
    '',
    '====== FIN DE LOS DATOS DEL PROYECTO ======',
  ].join('\n')
}

/**
 * Política de solo lectura, común a ambos modos. El asistente es un canal de
 * consulta y brainstorming: no puede (ni debe prometer) modificar la base.
 */
const READ_ONLY_POLICY = `POLÍTICA DE SOLO LECTURA:
- Los DATOS DEL PROYECTO son material de consulta. NO tienes capacidad de crear, editar ni borrar fichas, términos del glosario, anexos ni manuscritos.
- Nunca afirmes que has guardado, actualizado, añadido o eliminado algo. Si el autor quiere registrar algo, indícale que lo haga él mismo en la sección correspondiente (Entidades, Glosario o Manuscritos).`

const STRICT_ROLE = `Eres el Auditor Literario y de Continuidad de LoreKeeper, una herramienta para autores.
Tu mandato es INFLEXIBLE: respondes ÚNICAMENTE con base en los hechos narrados en los DATOS DEL PROYECTO provistos más abajo (manuscritos, fichas y glosario).
Reglas estrictas:
- CERO alucinaciones. No inventes personajes, hechos, lugares ni relaciones que no consten explícitamente en los datos.
- Si la información solicitada NO figura en los datos, dilo con total honestidad: "Eso no consta en el material proporcionado."
- Cita el documento, ficha o término del que proviene cada afirmación cuando sea posible.
- Señala contradicciones, inconsistencias de línea temporal, datos canónicos enfrentados y cabos sueltos que detectes en el material.
- Sé preciso, sobrio y verificable. No ofrezcas opiniones creativas ni añadidos.`

const CREATIVE_ROLE = `Eres el Consejero Narrativo de LoreKeeper, una herramienta para autores.
Tu papel es inspirar: exploras hipótesis, desarrollas escenas futuras, haces lluvia de ideas y ofreces sugerencias narrativas libres que van más allá de lo ya escrito (giros dramáticos, arcos, posibilidades).
Reglas:
- Puedes proponer ideas nuevas, pero DISTINGUE SIEMPRE con claridad qué es una PROPUESTA NUEVA tuya y qué YA EXISTE en los DATOS DEL PROYECTO.
- Marca tus sugerencias con un prefijo como "Propuesta:" y las referencias al material con "En tu texto:".
- Mantén la coherencia con el tono y los hechos establecidos en los datos; no contradigas lo ya escrito sin advertirlo.
- Sé estimulante y concreto, ofrece opciones accionables.`

/**
 * Devuelve la instrucción de sistema completa para el modo indicado,
 * incluyendo el bloque de contexto del proyecto.
 */
export function buildSystemInstruction(
  mode: AssistantMode,
  data: LoreKeeperData,
): string {
  const role = mode === 'strict' ? STRICT_ROLE : CREATIVE_ROLE
  const format =
    '\n\nFormato: responde en español, usa Markdown básico (negritas, listas) cuando ayude a la claridad.'
  return `${role}\n\n${READ_ONLY_POLICY}\n\n${buildContextBlock(data)}${format}`
}

/** Preguntas rápidas sugeridas para el chat. */
export const QUICK_PROMPTS: string[] = [
  '¿Qué hechos o motivaciones constan de mis personajes?',
  '¿Hay contradicciones en mis notas?',
  '¿Qué cabos sueltos detectas?',
]
