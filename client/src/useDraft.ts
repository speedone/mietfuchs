// `useDraft` (#309): ein Wert, der erst mit „Speichern“ an den Server geht. Die Regeln dazu und die
// Logik ohne React stehen in draft.ts; die Schaltflächen sind `<DraftActions>`.
//
//   const sentAt = useDraft(data.closed?.sentAt ?? '', { scope: paths.close })
//   <input value={sentAt.value} onChange={(e) => sentAt.set(e.target.value)} />
//   <DraftActions draft={sentAt} onSave={(v) => api(…, { method: 'PUT', … })} />
//
// Solange ein Entwurf offen ist, meldet er sich bei `useOpenForm` an: Ein Wechsel von Objekt oder
// Zeitraum fragt dann nach, statt die Eingabe still zu verlieren.
import { useCallback, useRef, useState } from 'react'
import { errorText } from './api'
import { afterSave, discarded, initialDraft, isDirty, shownValue, withEdit, withSaved, type DraftState } from './draft'
import { useOpenForm } from './property'
import { useConfirm } from './components/feedback'

export type Draft<T> = {
  // Was das Feld zeigt: der Entwurf, sonst der gespeicherte Wert.
  value: T
  set: (value: T) => void
  dirty: boolean
  saving: boolean
  // Warum das letzte Speichern scheiterte, sonst leer. Der Entwurf bleibt dann stehen.
  error: string
  discard: () => void
  // Speichert den Entwurf mit `fn` und ergibt, ob es gelang. Ohne Entwurf und während eines
  // laufenden Speicherns geschieht nichts (Doppelklick). `fn` lädt den Stand am besten gleich neu.
  save: (fn: (value: T) => Promise<unknown>) => Promise<boolean>
}

export type DraftOptions = {
  // Wozu der Wert gehört (etwa die Adresse der Abrechnung). Ändert er sich, ist ein offener
  // Entwurf erledigt, denn er gehörte zu etwas anderem. Wer den scope selbst wechselt, fragt vorher
  // mit `useConfirmDiscard` (unten); Objekt und Zeitraum fragen über `useOpenForm` von selbst.
  // Eine Zeichenkette, denn verglichen wird mit `Object.is`: Ein Objekt oder eine Liste wäre bei
  // jedem Zeichnen neu und verwürfe den Entwurf.
  scope?: string
}

export function useDraft<T>(saved: T, options: DraftOptions = {}): Draft<T> {
  const [stored, setStored] = useState<DraftState<T>>(() => initialDraft(saved, options.scope))
  // Ein neuer gespeicherter Wert von außen wird noch in diesem Durchlauf übernommen, nicht erst in
  // einem Effekt danach: Sonst zeigte das Feld einmal den alten Wert neben dem neuen Stand der Seite.
  const state = withSaved(stored, saved, options.scope)
  if (state !== stored) setStored(state)
  const [saving, setSaving] = useState(false)
  // Der Grund gehört zum scope, in dem das Speichern scheiterte: Nach einem Wechsel stünde er
  // sonst neben dem Wert einer anderen Abrechnung.
  const [failure, setFailure] = useState<{ scope: unknown, text: string } | null>(null)
  const error = failure && Object.is(failure.scope, state.scope) ? failure.text : ''
  const setError = (text: string, scope?: unknown) => setFailure(text ? { scope, text } : null)
  // Die Sperre gegen Doppelklick als Referenz: Zwei Klicks im selben Augenblick sähen beide noch
  // `saving === false`.
  const busy = useRef(false)
  // Der jüngste Stand für `save`, das sonst den Wert vom Zeitpunkt des Zeichnens speicherte.
  const latest = useRef(state)
  latest.current = state

  const dirty = isDirty(state)
  useOpenForm(dirty)

  const set = useCallback((value: T) => {
    setError('')
    setStored((s) => withEdit(s, value))
  }, [])
  const discard = useCallback(() => {
    setError('')
    setStored((s) => discarded(s))
  }, [])
  const save = useCallback(async (fn: (value: T) => Promise<unknown>) => {
    const start = latest.current
    if (busy.current || !isDirty(start)) return false
    const value = shownValue(start)
    busy.current = true
    setSaving(true)
    setError('')
    try {
      await fn(value)
      setStored((s) => (Object.is(s.scope, start.scope) ? afterSave(s, value, start.prop) : s))
      return true
    } catch (e) {
      setError(errorText(e), start.scope)
      return false
    } finally {
      busy.current = false
      setSaving(false)
    }
  }, [])

  return { value: shownValue(state), set, dirty, saving, error, discard, save }
}

// Die Rückfrage für einen Wechsel, den die Seite selbst auslöst und der den `scope` eines Entwurfs
// ändert (etwa der Reiter zwischen Betriebs- und Heizkostenabrechnung; Durchsicht zu #333). Objekt
// und Zeitraum fragen schon über `useOpenForm`; ein Wechsel innerhalb der Seite ging daran vorbei und
// verwarf den Entwurf still. Ergibt, ob gewechselt werden darf: ohne offenen Entwurf sofort, sonst
// nach „Verwerfen“. Wer abbricht, behält den Entwurf und bleibt, wo er ist.
export function useConfirmDiscard(): (drafts: readonly { dirty: boolean }[]) => Promise<boolean> {
  const confirm = useConfirm()
  return useCallback(async (drafts) => {
    if (!drafts.some((d) => d.dirty)) return true
    return confirm({
      title: 'Ungespeicherte Änderung verwerfen?',
      message: 'Sie haben hier etwas geändert und noch nicht gespeichert. Beim Wechsel geht die Änderung verloren.',
      confirmLabel: 'Verwerfen',
      cancelLabel: 'Abbrechen',
      danger: true,
    })
  }, [confirm])
}
