/**
 * Formulario para crear / editar un GlossaryTerm.
 */

import { useEffect, useState } from 'react'
import type { GlossaryTerm } from '../../../types'
import { GLOSSARY_CATEGORIES, GLOSSARY_CLARITY_LEVELS } from '../../../types'
import type { GlossaryInput } from '../../../lib/useLoreKeeper'
import { Modal } from '../../ui/Modal'
import {
  FormActions,
  SelectField,
  TextAreaField,
  TextField,
} from '../../ui/fields'

interface GlossaryFormProps {
  open: boolean
  initial: GlossaryTerm | null
  /** Valores a precargar al crear (ignorado si hay `initial`). */
  prefill?: Partial<GlossaryInput> | null
  onClose: () => void
  onSubmit: (input: GlossaryInput) => void
}

const emptyForm: GlossaryInput = {
  term: '',
  category: 'Magia/Sobrenatural',
  definition: '',
  contextInStory: '',
  clarityLevel: 'Claro',
  notes: '',
  occurrencesOrChapters: '',
}

export function GlossaryForm({
  open,
  initial,
  prefill,
  onClose,
  onSubmit,
}: GlossaryFormProps) {
  const [form, setForm] = useState<GlossaryInput>(emptyForm)

  useEffect(() => {
    if (!open) return
    setForm(
      initial
        ? {
            term: initial.term,
            category: initial.category,
            definition: initial.definition,
            contextInStory: initial.contextInStory,
            clarityLevel: initial.clarityLevel,
            notes: initial.notes,
            occurrencesOrChapters: initial.occurrencesOrChapters,
          }
        : { ...emptyForm, ...(prefill ?? {}) },
    )
  }, [open, initial, prefill])

  const set = <K extends keyof GlossaryInput>(
    key: K,
    value: GlossaryInput[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const canSubmit = form.term.trim().length > 0

  return (
    <Modal
      open={open}
      title={initial ? 'Editar término' : 'Nuevo término'}
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
            onClick={() => onSubmit(form)}
            disabled={!canSubmit}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {initial ? 'Guardar cambios' : 'Crear término'}
          </button>
        </FormActions>
      }
    >
      <TextField
        label="Término"
        value={form.term}
        onChange={(v) => set('term', v)}
        placeholder="Nombre del término"
        required
      />
      <SelectField
        label="Categoría"
        value={form.category}
        options={GLOSSARY_CATEGORIES}
        onChange={(v) => set('category', v)}
      />
      <TextAreaField
        label="Definición"
        value={form.definition}
        onChange={(v) => set('definition', v)}
        rows={4}
      />
      <TextAreaField
        label="Contexto en la historia"
        value={form.contextInStory}
        onChange={(v) => set('contextInStory', v)}
      />
      <SelectField
        label="Nivel de claridad"
        value={form.clarityLevel}
        options={GLOSSARY_CLARITY_LEVELS}
        onChange={(v) => set('clarityLevel', v)}
      />
      <TextField
        label="Apariciones o capítulos"
        value={form.occurrencesOrChapters}
        onChange={(v) => set('occurrencesOrChapters', v)}
        placeholder="Cap. 3, 7, 12..."
      />
      <TextAreaField
        label="Notas"
        value={form.notes}
        onChange={(v) => set('notes', v)}
      />
    </Modal>
  )
}
