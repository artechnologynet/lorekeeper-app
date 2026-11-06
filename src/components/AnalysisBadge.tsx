/**
 * Badge flotante colapsable de análisis en segundo plano.
 *
 * Aparece en la esquina inferior derecha cuando hay uno o más análisis en
 * curso. Comportamiento:
 *   - Al aparecer se muestra expandido; tras 3 s sin interacción, colapsa
 *     suavemente a un botón circular con el spinner ámbar.
 *   - Al pasar el cursor (hover) o tocar, se expande mostrando el título del
 *     documento en análisis.
 *   - Al hacer clic, abre un pequeño popover con detalles y opción de cancelar.
 *
 * Consume useAnalysis (contexto global), por lo que persiste al navegar.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useAnalysis } from '../lib/AnalysisContext'

const COLLAPSE_DELAY_MS = 3000

export function AnalysisBadge() {
  // isBusy cubre cualquier tarea de IA (análisis de manuscrito o fusión).
  const { isBusy, currentTitle, runningCount, cancelAll } = useAnalysis()

  const [expanded, setExpanded] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Programa el auto-colapso tras COLLAPSE_DELAY_MS.
  const scheduleCollapse = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = setTimeout(() => setExpanded(false), COLLAPSE_DELAY_MS)
  }

  // Al iniciar/cambiar una tarea de IA, muestra expandido y programa el colapso.
  useEffect(() => {
    if (isBusy) {
      setExpanded(true)
      scheduleCollapse()
    } else {
      setExpanded(false)
      setShowDetails(false)
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
    // Reacciona al cambio de título/estado de la tarea de IA.
  }, [isBusy, currentTitle])

  if (!isBusy) return null

  // currentTitle ya es autodescriptivo ("Analizando: X" o "Fusionando entidades: X").
  const label = currentTitle ?? 'Procesando en segundo plano…'

  const handleEnter = () => {
    setExpanded(true)
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
  }

  const handleLeave = () => {
    if (!showDetails) scheduleCollapse()
  }

  const handleClick = () => {
    setExpanded(true)
    setShowDetails((v) => !v)
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
  }

  return (
    <div
      className="fixed right-6 z-50 flex flex-col items-end gap-2"
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
      role="status"
      aria-live="polite"
    >
      {/* Popover de detalles / cancelar */}
      {showDetails && (
        <div className="animate-chip-in w-64 rounded-2xl border border-amber-500/40 bg-neutral-900/95 p-3 shadow-xl shadow-black/50 backdrop-blur">
          <p className="mb-0.5 text-xs font-semibold text-amber-300">
            Tarea de IA en curso
          </p>
          <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-zinc-400">
            {currentTitle ?? 'Procesando en segundo plano…'}
            {runningCount > 1 && (
              <span className="mt-1 block text-zinc-500">
                {runningCount} análisis en cola.
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              cancelAll()
              setShowDetails(false)
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
          >
            <X size={14} aria-hidden="true" />
            Cancelar análisis
          </button>
        </div>
      )}

      {/* Chip colapsable */}
      <button
        type="button"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        aria-label={label}
        className={[
          'flex items-center overflow-hidden rounded-full border border-amber-500/40 bg-neutral-900/90 text-amber-300 shadow-lg shadow-black/40 backdrop-blur transition-all duration-300',
          expanded ? 'max-w-[18rem] px-4 py-2' : 'max-w-[2.75rem] px-2.5 py-2.5',
        ].join(' ')}
      >
        <Loader2 size={16} className="shrink-0 animate-spin text-amber-400" aria-hidden="true" />
        <span
          className={[
            'whitespace-nowrap text-xs font-medium transition-all duration-300',
            expanded ? 'ml-2 max-w-[14rem] opacity-100' : 'ml-0 max-w-0 opacity-0',
          ].join(' ')}
        >
          <span className="block truncate">{label}</span>
        </span>
      </button>
    </div>
  )
}
