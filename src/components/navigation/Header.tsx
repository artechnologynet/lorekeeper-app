/**
 * Header superior minimalista.
 *
 * Muestra el título de la sección activa a la izquierda y un botón de ajustes
 * (engrane) a la derecha. Fijo en la parte superior con fondo translúcido.
 */

import { FileDown, Settings } from 'lucide-react'
import type { SectionId } from '../../types'
import { getSection } from './sections'
import { useLoreKeeperContext } from '../../lib/useLoreKeeperContext'
import { useExportDocx } from '../../lib/ExportDocxContext'
import { LoreKeeperLogo } from '../LoreKeeperLogo'

interface HeaderProps {
  active: SectionId
  onOpenSettings: () => void
}

export function Header({ active, onOpenSettings }: HeaderProps) {
  const section = getSection(active)
  const { data } = useLoreKeeperContext()
  const { openExport } = useExportDocx()
  const projectTitle = data.settings.projectTitle.trim()
  const authorName = data.settings.authorName.trim()

  // Si hay título de obra, es el protagonista; si no, el nombre de sección.
  const mainTitle = projectTitle.length > 0 ? projectTitle : section.label

  return (
    <header
      className="fixed inset-x-0 top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/95 backdrop-blur-md"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Emblema + logotipo de marca */}
          <LoreKeeperLogo size={30} className="shrink-0" />
          {/* Separador sutil entre la marca y el título de la obra/sección */}
          <span
            className="h-7 w-px shrink-0 bg-zinc-800"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-base font-semibold leading-tight text-zinc-100">
              {mainTitle}
            </h1>
            {authorName.length > 0 && (
              <span className="truncate text-[11px] leading-tight text-zinc-500">
                por {authorName}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => openExport()}
            aria-label="Exportar a Word"
            title="Exportar a Word"
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
          >
            <FileDown size={20} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Ajustes"
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
          >
            <Settings size={20} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  )
}
