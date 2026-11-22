// Eigene Kostenarten des gewählten Zeitraums (gewerbliche Abrechnung, server/src/db/costTypes.ts): Name für Abrechnung
// und Export, Grundart für die Rechnung. Anlegen und Bearbeiten im Seitenfenster, Entfernen mit Rückfrage, „Aus dem
// Vorjahr übernehmen“ legt die Liste des Vorzeitraums an. Die Logik steht in costTypeForm.ts.
import { useState } from 'react'
import type { CostType } from '../types'
import { CATEGORIES } from '../types'
import { errorText } from '../api'
import Card from './Card'
import Drawer from './Drawer'
import Field from './Field'
import Table from './Table'
import { useFormError } from './ErrorSummary'
import { useConfirm, useToast } from './feedback'
import { useSaving } from '../useSaving'
import { costTypeDraftOf, costTypeProblems, EMPTY_COST_TYPE_DRAFT, type CostTypeDraft } from '../costTypeForm'

type Props = {
  label: string
  previousLabel: string
  types: readonly CostType[]
  previousCount: number
  closed: boolean
  onSave: (id: string | null, body: { name: string; baseCategory: string }) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onCarry: () => Promise<void>
}

export default function CostTypesCard({ label, previousLabel, types, previousCount, closed, onSave, onRemove, onCarry }: Props) {
  const [edit, setEdit] = useState<{ id: string | null; draft: CostTypeDraft } | null>(null)
  const errors = useFormError<'name' | 'baseCategory'>()
  const saving = useSaving()
  const confirm = useConfirm()
  const toast = useToast()

  async function save() {
    if (!edit) return
    const problems = costTypeProblems(edit.draft, types, edit.id)
    if (problems.length > 0) return errors.report(problems)
    errors.set('')
    try {
      await onSave(edit.id, { name: edit.draft.name.trim(), baseCategory: edit.draft.baseCategory })
      setEdit(null)
    } catch (e) {
      errors.show(errorText(e))
    }
  }

  async function remove(t: CostType) {
    const ok = await confirm({
      title: `„${t.name}“ entfernen?`, message: `Die Kostenart verschwindet aus der Liste für ${label}. Positionen hängen keine daran.`,
      confirmLabel: 'Entfernen', cancelLabel: 'Abbrechen', danger: true,
    })
    if (!ok) return
    try {
      await onRemove(t.id)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  return (
    <Card title={<>Kostenarten {label}</>} data-jump="kostenarten"
      aside={!closed && <button className="btn secondary" onClick={() => { errors.set(''); setEdit({ id: null, draft: EMPTY_COST_TYPE_DRAFT }) }}>+ Kostenart anlegen</button>}>
      <p className="muted">
        Eigene Kostenarten, etwa „Sicherheitsdienst“ oder „Wartung Brandschutz“, gelten je Abrechnungszeitraum. Auf Abrechnung und
        Export steht ihr Name; gerechnet wird nach der Grundart. Ohne eigene Kostenarten bleibt alles, wie es ist.
      </p>
      {types.length > 0 && (
        <Table className="stacked" aria-label={`Kostenarten ${label}`}>
          <thead><tr><th>Kostenart</th><th>Rechnet als</th><th className="num">Positionen</th><th><span className="sr-only">Aktionen</span></th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td data-label="Kostenart">{t.name}</td>
                <td data-label="Rechnet als">{t.baseCategory}</td>
                <td data-label="Positionen" className="num">{t.itemCount}</td>
                <td data-label="Aktionen">
                  {!closed && (
                    <>
                      <button className="btn small ghost" onClick={() => { errors.set(''); setEdit({ id: t.id, draft: costTypeDraftOf(t) }) }}>Bearbeiten<span className="sr-only"> („{t.name}“)</span></button>
                      {t.itemCount === 0 && <button className="btn small ghost danger-ghost ml-auto" onClick={() => void remove(t)}>Entfernen …<span className="sr-only">{` „${t.name}“`}</span></button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {!closed && previousCount > 0 && (
        <button className="btn secondary" onClick={() => void saving.run(async () => { try { await onCarry() } catch (e) { toast(errorText(e), 'error') } })}>
          Kostenarten aus {previousLabel} übernehmen
        </button>
      )}
      {edit && (
        <Drawer open title={edit.id ? 'Kostenart bearbeiten' : 'Kostenart anlegen'} subtitle={label} onClose={() => setEdit(null)} value={edit.draft} busy={saving.busy} errors={errors}
          onSubmit={() => void saving.run(save)}
          actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(save)}>{edit.id ? 'Speichern' : 'Anlegen'}</button>}>
          <Field label="Name" required width="l" {...errors.field('name')}>
            <input value={edit.draft.name} maxLength={80} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, name: e.target.value } })} placeholder="z. B. Sicherheitsdienst" />
          </Field>
          <Field label="Rechnet als (Grundart)" required hint="Nach der Grundart richten sich Umlageschlüssel-Vorschlag, Regeln zu Heizung, Strom und Wasser und die Steuer. Für die meisten gewerblichen Kostenarten passt „Sonstige Betriebskosten“; „Nicht umlagefähig“ trägt der Vermieter." {...errors.field('baseCategory')}>
            <select value={edit.draft.baseCategory} disabled={edit.id !== null && (types.find((t) => t.id === edit.id)?.itemCount ?? 0) > 0}
              onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, baseCategory: e.target.value } })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {edit.id !== null && (types.find((t) => t.id === edit.id)?.itemCount ?? 0) > 0 && (
            <p className="muted">An dieser Kostenart hängen Positionen; die Grundart lässt sich deshalb nicht ändern. Der neue Name gilt auch für sie.</p>
          )}
        </Drawer>
      )}
    </Card>
  )
}
