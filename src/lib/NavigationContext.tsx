/**
 * Contexto de navegación y "prefill" entre vistas.
 *
 * Permite que una vista (p. ej. el Asistente) solicite:
 *   - Cambiar la sección activa.
 *   - Precargar el formulario de Entidad o de Glosario con datos sugeridos,
 *     de modo que al abrir la vista destino se despliegue el modal ya relleno.
 *
 * El "prefill" es de un solo uso: la vista destino lo consume (lo lee y lo
 * limpia) al montarse.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { EntityInput, GlossaryInput } from './useLoreKeeper'
import type { SectionId } from '../types'

interface NavigationState {
  section: SectionId
  goTo: (section: SectionId) => void
  /** Prefill pendiente para el formulario de entidad (o null). */
  entityPrefill: Partial<EntityInput> | null
  /** Prefill pendiente para el formulario de glosario (o null). */
  glossaryPrefill: Partial<GlossaryInput> | null
  /** Navega a Entidades y precarga el formulario. */
  prefillEntity: (data: Partial<EntityInput>) => void
  /** Navega al Glosario y precarga el formulario. */
  prefillGlossary: (data: Partial<GlossaryInput>) => void
  /** Consume (lee y limpia) el prefill de entidad. */
  consumeEntityPrefill: () => Partial<EntityInput> | null
  /** Consume (lee y limpia) el prefill de glosario. */
  consumeGlossaryPrefill: () => Partial<GlossaryInput> | null
}

const NavigationContext = createContext<NavigationState | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<SectionId>('manuscript')
  const [entityPrefill, setEntityPrefill] = useState<Partial<EntityInput> | null>(null)
  const [glossaryPrefill, setGlossaryPrefill] = useState<Partial<GlossaryInput> | null>(null)

  const goTo = useCallback((next: SectionId) => setSection(next), [])

  const prefillEntity = useCallback((data: Partial<EntityInput>) => {
    setEntityPrefill(data)
    setSection('entities')
  }, [])

  const prefillGlossary = useCallback((data: Partial<GlossaryInput>) => {
    setGlossaryPrefill(data)
    setSection('glossary')
  }, [])

  const consumeEntityPrefill = useCallback(() => {
    let value: Partial<EntityInput> | null = null
    setEntityPrefill((prev) => {
      value = prev
      return null
    })
    return value
  }, [])

  const consumeGlossaryPrefill = useCallback(() => {
    let value: Partial<GlossaryInput> | null = null
    setGlossaryPrefill((prev) => {
      value = prev
      return null
    })
    return value
  }, [])

  const state = useMemo<NavigationState>(
    () => ({
      section,
      goTo,
      entityPrefill,
      glossaryPrefill,
      prefillEntity,
      prefillGlossary,
      consumeEntityPrefill,
      consumeGlossaryPrefill,
    }),
    [
      section,
      goTo,
      entityPrefill,
      glossaryPrefill,
      prefillEntity,
      prefillGlossary,
      consumeEntityPrefill,
      consumeGlossaryPrefill,
    ],
  )

  return (
    <NavigationContext.Provider value={state}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation(): NavigationState {
  const ctx = useContext(NavigationContext)
  if (!ctx) {
    throw new Error('useNavigation debe usarse dentro de <NavigationProvider>.')
  }
  return ctx
}
