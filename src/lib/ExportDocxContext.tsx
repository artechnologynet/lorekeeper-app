/**
 * Contexto para abrir el modal de exportación a Word desde cualquier vista.
 *
 * `openExport()` abre el modal con todas las secciones marcadas (uso desde el
 * Header). `openExport('glossary')` lo abre con esa sección preseleccionada
 * (uso desde las vistas de Entidades, Glosario y Compendio).
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ExportDocxModal } from '../components/ExportDocxModal'
import type { ExportSectionId } from '../components/ExportDocxModal'

interface ExportDocxState {
  openExport: (section?: ExportSectionId) => void
}

const ExportDocxContext = createContext<ExportDocxState | null>(null)

export function ExportDocxProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<ExportSectionId | null>(null)

  const openExport = useCallback((next?: ExportSectionId) => {
    setSection(next ?? null)
    setOpen(true)
  }, [])

  const value = useMemo(() => ({ openExport }), [openExport])

  return (
    <ExportDocxContext.Provider value={value}>
      {children}
      <ExportDocxModal
        open={open}
        initialSection={section}
        onClose={() => setOpen(false)}
      />
    </ExportDocxContext.Provider>
  )
}

export function useExportDocx(): ExportDocxState {
  const ctx = useContext(ExportDocxContext)
  if (!ctx) {
    throw new Error('useExportDocx debe usarse dentro de <ExportDocxProvider>.')
  }
  return ctx
}
