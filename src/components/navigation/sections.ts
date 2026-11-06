/**
 * Configuración central de las secciones de navegación.
 *
 * Define las 5 secciones de la barra inferior con su etiqueta e icono de
 * lucide-react. Se consume tanto en la BottomNav como en el Header y las vistas.
 */

import { BookOpen, FolderOpen, Scroll, Sparkles, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SectionId } from '../../types'

export interface SectionConfig {
  id: SectionId
  label: string
  icon: LucideIcon
}

export const SECTIONS: SectionConfig[] = [
  { id: 'manuscript', label: 'Manuscrito', icon: FolderOpen },
  { id: 'entities', label: 'Entidades', icon: Users },
  { id: 'glossary', label: 'Glosario', icon: BookOpen },
  { id: 'compendium', label: 'Compendio', icon: Scroll },
  { id: 'assistant', label: 'Asistente', icon: Sparkles },
]

/** Devuelve la configuración de una sección por su id. */
export function getSection(id: SectionId): SectionConfig {
  const section = SECTIONS.find((s) => s.id === id)
  // SECTIONS cubre todos los SectionId, por lo que siempre existe.
  return section ?? SECTIONS[0]
}
