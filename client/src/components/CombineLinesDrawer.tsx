// „Alle Zeilen als eine Position anlegen“ (Belegbuchung, Durchsicht der Systemprüfung): Eine Rechnung mit vielen Zeilen
// einer Kostenart wird eine Kostenposition. Das Fenster fragt Kostenart, Beschreibung und, wenn eine Zeile einen nennt,
// den §35a-Lohnanteil, sagt vorher, was entsteht und was offen bleibt, und bucht über den Planer des Servers (Logik und
// Ablauf in client/src/assessment.ts, `bookAsOne`).
import { useState } from 'react'
import type { AssessmentView, Unit } from '../types'
import { errorText, fmtEuro } from '../api'
import { bookAsOne, categoryOptions, combineLabor, combineStart, combineSummary, noteGroups, PREPAID_ADVICE, type CombineDraft, type CombineResult } from '../assessment'
import { aiPositionDefaults, type KeyContext } from '../costForm'
import Drawer from './Drawer'
import Field from './Field'
import { NoticeBox } from './Notice'
import { useFormError } from './ErrorSummary'
import { useConfirm } from './feedback'
import { useSaving } from '../useSaving'

type Props = {
  assessment: AssessmentView
  units: Unit[]
  keyContext?: KeyContext
  onClose: () => void
  // Gebucht (ganz oder nur die erste Zeile): Die Karte übernimmt den neuen Stand und zeigt Erfolg oder Meldung.
  onBooked: (result: Extract<CombineResult, { kind: 'done' | 'partial' }>) => void
}

export default function CombineLinesDrawer({ assessment: a, units, keyContext, onClose, onBooked }: Props) {
  const [draft, setDraft] = useState<CombineDraft>(() => combineStart(a))
  const errors = useFormError<'category' | 'description'>()
  const saving = useSaving()
  const confirm = useConfirm()
  const labor = combineLabor(a)
  const prepaid = noteGroups(a).info
  const [summary, ...more] = combineSummary(a, draft)
  const total = more.filter((t) => t.startsWith('Rechnungsbetrag'))
  const open = more.filter((t) => !total.includes(t))

  async function create() {
    const problems = [
      ...(draft.category === '' ? [{ field: 'category' as const, short: 'Bitte wählen Sie die Kostenart.', text: 'Kostenart: Bitte wählen Sie die Kostenart der neuen Position.' }] : []),
      ...(draft.description.trim() === '' ? [{ field: 'description' as const, short: 'Bitte tragen Sie eine Beschreibung ein.', text: 'Beschreibung: Bitte tragen Sie eine Beschreibung der neuen Position ein.' }] : []),
    ]
    if (problems.length > 0) return errors.report(problems)
    errors.set('')
    try {
      const { key, allocation } = aiPositionDefaults(draft.category, units, [], keyContext, draft.description)
      const result = await bookAsOne(a, draft, { key, allocation }, (messages) => confirm({
        title: 'Schon erfasst?', message: messages.join(' '), confirmLabel: 'Trotzdem anlegen', cancelLabel: 'Abbrechen',
      }))
      if (result.kind === 'refused') errors.show(result.message)
      else if (result.kind !== 'cancelled') onBooked(result)
    } catch (e) {
      errors.show(errorText(e))
    }
  }

  return (
    <Drawer open title="Eine Position aus allen Zeilen anlegen" subtitle={a.originalName} onClose={onClose} value={draft} busy={saving.busy} errors={errors}
      onSubmit={() => void saving.run(create)}
      actions={<button className="btn" disabled={saving.busy} onClick={() => void saving.run(create)}>Anlegen</button>}>
      <p>Für eine Rechnung, deren Zeilen zusammen eine Kostenposition sind, etwa die Jahresrechnung für Strom, Gas oder Wasser. Gehören die Zeilen zu verschiedenen Kostenarten, schließen Sie das Fenster und wählen Sie je Zeile, was geschieht.</p>
      {/* Die Zeilen einer solchen Rechnung sind nie vorab angehakt; der Grund steht deshalb auch hier, nicht nur auf der Karte. */}
      {prepaid.length > 0 && (
        <NoticeBox level="hint" action={<>{prepaid.map((n) => <span key={n} className="block">{n}</span>)}<span className="block">{PREPAID_ADVICE}</span></>} />
      )}
      <Field label="Kostenart" required {...errors.field('category')}>
        <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
          {draft.category === '' && <option value="">Bitte wählen</option>}
          {categoryOptions(draft.category || 'Sonstige Betriebskosten').map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Beschreibung" required width="full" {...errors.field('description')}>
        <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </Field>
      {labor && (
        <div>
          <label className="checkline">
            <input type="checkbox" checked={draft.labor} onChange={(e) => setDraft({ ...draft, labor: e.target.checked })} /> §35a-Lohnanteil von {fmtEuro(labor.cents)} übernehmen
          </label>
          {labor.guessed && <p className="muted">Der Lohnanteil ist nur aus der Art der Position vorgeschlagen und steht nicht als Betrag auf der Rechnung. Prüfen Sie, ob der Stundensatz Material enthält, bevor Sie ihn übernehmen.</p>}
        </div>
      )}
      <p>{summary}</p>
      {/* Was offen bleibt, ist eine Warnung; der Rechnungsbetrag steht zum Vergleich daneben, ohne Warnung */}
      {open.length > 0 && <NoticeBox level="warning" action={<>{open.map((t) => <span key={t} className="block">{t}</span>)}</>} />}
      {total.map((t) => <p key={t}>{t}</p>)}
      <p className="muted">Den Umlageschlüssel schlägt Mietfuchs wie bei jeder neuen Position vor; Sie ändern ihn danach an der Position auf der Seite Kosten.</p>
    </Drawer>
  )
}
