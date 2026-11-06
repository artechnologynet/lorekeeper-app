/**
 * Campos de formulario reutilizables con estilo oscuro y táctil.
 *
 * Exporta TextField, TextAreaField y SelectField. Cada uno envuelve una
 * etiqueta accesible asociada al control.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'

const baseControl =
  'w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40'

const labelClass = 'mb-1.5 block text-xs font-medium text-zinc-400'

interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: TextFieldProps) {
  const id = useId()
  return (
    <div className="mb-4">
      <label htmlFor={id} className={labelClass}>
        {label}
        {required && <span className="ml-0.5 text-amber-500">*</span>}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={baseControl}
      />
    </div>
  )
}

interface TextAreaFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: TextAreaFieldProps) {
  const id = useId()
  return (
    <div className="mb-4">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`${baseControl} resize-y leading-relaxed`}
      />
    </div>
  )
}

interface SelectFieldProps<T extends string> {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: SelectFieldProps<T>) {
  const id = useId()
  return (
    <div className="mb-4">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={baseControl}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Contenedor de acciones del pie del formulario (Cancelar / Guardar). */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex gap-2">{children}</div>
}
