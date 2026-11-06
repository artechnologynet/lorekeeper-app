/**
 * Formulario táctil para crear / editar una EntitySheet.
 *
 * Maneja todos los campos definidos, incluyendo listas (aliases, keyQuotes) y
 * relaciones ({ target, relation }). Las listas de texto se editan como texto
 * multilínea (una entrada por línea) para simplicidad móvil.
 */

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { EntitySheet } from '../../../types'
import { ENTITY_ROLES } from '../../../types'
import type { EntityInput } from '../../../lib/useLoreKeeper'
import { Modal } from '../../ui/Modal'
import {
  FormActions,
  SelectField,
  TextAreaField,
  TextField,
} from '../../ui/fields'

interface EntityFormProps {
  open: boolean
  initial: EntitySheet | null
  /** Valores a precargar al crear (ignorado si hay `initial`). */
  prefill?: Partial<EntityInput> | null
  onClose: () => void
  onSubmit: (input: EntityInput) => void
}

/** Convierte un arreglo de strings en texto (una línea por elemento). */
function listToText(list: string[]): string {
  return list.join('\n')
}

/** Convierte texto multilínea en un arreglo de strings sin vacíos. */
function textToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const emptyForm: EntityInput = {
  name: '',
  aliases: [],
  role: 'Protagonista',
  narrativeRole: '',
  physicalDescription: '',
  psychology: '',
  motivation: '',
  internalConflict: '',
  powersOrAbilities: '',
  relationships: [],
  keyQuotes: [],
  statusInStory: '',
  notes: '',
  firstAppearance: '',
}

export function EntityForm({
  open,
  initial,
  prefill,
  onClose,
  onSubmit,
}: EntityFormProps) {
  const [form, setForm] = useState<EntityInput>(emptyForm)
  const [aliasesText, setAliasesText] = useState('')
  const [quotesText, setQuotesText] = useState('')
  const [relationships, setRelationships] = useState<EntitySheet['relationships']>([])

  // Rehidrata el formulario cada vez que se abre o cambia la entidad base.
  useEffect(() => {
    if (!open) return
    const source: EntityInput = initial
      ? {
          name: initial.name,
          aliases: initial.aliases,
          role: initial.role,
          narrativeRole: initial.narrativeRole,
          physicalDescription: initial.physicalDescription,
          psychology: initial.psychology,
          motivation: initial.motivation,
          internalConflict: initial.internalConflict,
          powersOrAbilities: initial.powersOrAbilities,
          relationships: initial.relationships,
          keyQuotes: initial.keyQuotes,
          statusInStory: initial.statusInStory,
          notes: initial.notes,
          firstAppearance: initial.firstAppearance,
        }
      : { ...emptyForm, ...(prefill ?? {}) }

    setForm(source)
    setAliasesText(listToText(source.aliases))
    setQuotesText(listToText(source.keyQuotes))
    setRelationships(source.relationships)
  }, [open, initial, prefill])

  const set = <K extends keyof EntityInput>(key: K, value: EntityInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const addRelationship = () => {
    setRelationships((prev) => [...prev, { target: '', relation: '' }])
  }

  const updateRelationship = (index: number, field: 'target' | 'relation', value: string) => {
    setRelationships((prev) =>
      prev.map((rel, i) => (i === index ? { ...rel, [field]: value } : rel)),
    )
  }

  const removeRelationship = (index: number) => {
    setRelationships((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = () => {
    const payload: EntityInput = {
      ...form,
      aliases: textToList(aliasesText),
      keyQuotes: textToList(quotesText),
      relationships: relationships.filter(
        (rel) => rel.target.trim().length > 0 || rel.relation.trim().length > 0,
      ),
    }
    onSubmit(payload)
  }

  const canSubmit = form.name.trim().length > 0

  return (
    <Modal
      open={open}
      title={initial ? 'Editar entidad' : 'Nueva entidad'}
      onClose={onClose}
      footer={
        <FormActions>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {initial ? 'Guardar cambios' : 'Crear entidad'}
          </button>
        </FormActions>
      }
    >
      <TextField
        label="Nombre"
        value={form.name}
        onChange={(v) => set('name', v)}
        placeholder="Nombre de la entidad"
        required
      />
      <TextAreaField
        label="Alias (uno por línea)"
        value={aliasesText}
        onChange={setAliasesText}
        placeholder={'El Errante\nSombra del Norte'}
        rows={2}
      />
      <SelectField
        label="Rol (estructural)"
        value={form.role}
        options={ENTITY_ROLES}
        onChange={(v) => set('role', v)}
      />
      <TextField
        label="Rol narrativo / parentesco"
        value={form.narrativeRole}
        onChange={(v) => set('narrativeRole', v)}
        placeholder="Hijo de la Casa Hawke, Madre de Aldric…"
      />
      <TextAreaField
        label="Descripción física"
        value={form.physicalDescription}
        onChange={(v) => set('physicalDescription', v)}
      />
      <TextAreaField
        label="Psicología"
        value={form.psychology}
        onChange={(v) => set('psychology', v)}
      />
      <TextAreaField
        label="Motivación"
        value={form.motivation}
        onChange={(v) => set('motivation', v)}
      />
      <TextAreaField
        label="Conflicto interno"
        value={form.internalConflict}
        onChange={(v) => set('internalConflict', v)}
      />
      <TextAreaField
        label="Poderes o habilidades"
        value={form.powersOrAbilities}
        onChange={(v) => set('powersOrAbilities', v)}
      />

      {/* Relaciones */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Relaciones</span>
          <button
            type="button"
            onClick={addRelationship}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/10"
          >
            <Plus size={14} aria-hidden="true" />
            Añadir
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {relationships.length === 0 && (
            <p className="text-xs text-zinc-600">Sin relaciones registradas.</p>
          )}
          {relationships.map((rel, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={rel.target}
                onChange={(e) => updateRelationship(index, 'target', e.target.value)}
                placeholder="Quién"
                className="w-1/2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/60"
              />
              <input
                type="text"
                value={rel.relation}
                onChange={(e) => updateRelationship(index, 'relation', e.target.value)}
                placeholder="Relación"
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500/60"
              />
              <button
                type="button"
                onClick={() => removeRelationship(index)}
                aria-label="Eliminar relación"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <TextAreaField
        label="Citas clave (una por línea)"
        value={quotesText}
        onChange={setQuotesText}
        placeholder={'«No todos los que vagan están perdidos.»'}
        rows={2}
      />
      <TextField
        label="Estado en la historia"
        value={form.statusInStory}
        onChange={(v) => set('statusInStory', v)}
        placeholder="Vivo, desaparecido, caído..."
      />
      <TextField
        label="Primera aparición"
        value={form.firstAppearance}
        onChange={(v) => set('firstAppearance', v)}
        placeholder="Capítulo 1, Prólogo..."
      />
      <TextAreaField
        label="Notas"
        value={form.notes}
        onChange={(v) => set('notes', v)}
      />
    </Modal>
  )
}
