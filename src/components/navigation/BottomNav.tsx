/**
 * Barra de navegación inferior fija, estilo aplicación móvil Android.
 *
 * Muestra las 5 secciones. La sección activa se resalta con el color de acento
 * ámbar. Respeta el área segura inferior (safe-area) de dispositivos móviles.
 */

import type { SectionId } from '../../types'
import { SECTIONS } from './sections'

interface BottomNavProps {
  active: SectionId
  onChange: (section: SectionId) => void
}

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around">
        {SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = section.id === active

          return (
            <li key={section.id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(section.id)}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'group flex w-full flex-col items-center gap-1 px-1 py-2.5 transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60',
                  isActive ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-9 w-9 items-center justify-center rounded-2xl transition-colors',
                    isActive
                      ? 'bg-amber-500/15 ring-1 ring-amber-500/30'
                      : 'bg-transparent',
                  ].join(' ')}
                >
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.4 : 1.9}
                    aria-hidden="true"
                  />
                </span>
                <span className="text-[11px] font-medium leading-none tracking-wide">
                  {section.label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
