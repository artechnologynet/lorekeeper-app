/**
 * Logo de marca de LoreKeeper.
 *
 * Renderiza el emblema oficial (isotipo "LK") a partir del SVG vectorial y,
 * de forma opcional, el logotipo de texto "LOREKEEPER" a su lado.
 *
 * Props:
 *  - collapsed: si es `true`, oculta el texto y deja solo el isotipo centrado;
 *    si es `false` o se omite, muestra el emblema junto al texto.
 *  - size: lado del isotipo en píxeles (por defecto 28).
 *  - className: clases extra para el contenedor.
 */

import logoUrl from '../assets/lorekeeper-logo.svg'

interface LoreKeeperLogoProps {
  /** Oculta el texto y conserva solo el isotipo "LK" centrado. */
  collapsed?: boolean
  /** Lado del emblema en píxeles. */
  size?: number
  /** Clases adicionales para el contenedor. */
  className?: string
}

export function LoreKeeperLogo({
  collapsed = false,
  size = 28,
  className = '',
}: LoreKeeperLogoProps) {
  return (
    <div
      className={[
        'flex items-center',
        collapsed ? 'justify-center gap-0' : 'gap-2.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Isotipo: emblema "LK" en recuadro redondeado */}
      <img
        src={logoUrl}
        width={size}
        height={size}
        alt="LoreKeeper"
        className="shrink-0 rounded-lg ring-1 ring-amber-500/20"
        style={{ width: size, height: size }}
        draggable={false}
      />

      {/* Logotipo de texto: oculto en modo colapsado */}
      {!collapsed && (
        <span className="select-none text-[13px] font-semibold uppercase tracking-[0.18em] text-amber-500/90">
          LoreKeeper
        </span>
      )}
    </div>
  )
}
