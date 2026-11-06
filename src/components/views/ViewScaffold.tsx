/**
 * Andamiaje visual reutilizable para las vistas de cada sección.
 *
 * Presenta un encabezado con icono, título y descripción, más un espacio para
 * el contenido. Mantiene consistente el estilo oscuro con acentos ámbar.
 */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface ViewScaffoldProps {
  icon: LucideIcon
  title: string
  description: string
  count?: number
  children?: ReactNode
}

export function ViewScaffold({
  icon: Icon,
  title,
  description,
  count,
  children,
}: ViewScaffoldProps) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
          <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
            {typeof count === 'number' && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
                {count}
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">{description}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6">
        {children ?? (
          <p className="text-center text-sm text-zinc-500">
            Aún no hay contenido en esta sección.
          </p>
        )}
      </div>
    </section>
  )
}
