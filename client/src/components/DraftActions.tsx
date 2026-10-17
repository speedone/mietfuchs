// „Speichern“ und „Verwerfen“ zu einem Entwurf aus `useDraft` (#309). Sie erscheinen nur, wenn
// etwas geändert ist, stehen überall gleich beschriftet direkt hinter dem Feld und sind während
// des Speicherns gesperrt. Scheitert das Speichern, steht der Grund daneben, und der Entwurf bleibt.
import type { Draft } from '../useDraft'

export default function DraftActions<T>({ draft, onSave, what }: {
  draft: Draft<T>
  // Schickt den Wert an den Server; lädt den Stand am besten gleich neu.
  onSave: (value: T) => Promise<unknown>
  // Wofür die Schaltflächen gelten, für Vorleser, wenn mehrere Entwürfe auf einer Seite stehen
  // („Versanddatum“ ergibt „Versanddatum speichern“).
  what?: string
}) {
  if (!draft.dirty && !draft.error) return null
  return (
    <span className="draft-actions">
      {draft.dirty && (
        <>
          <button type="button" className="btn small" disabled={draft.saving} aria-label={what ? `${what} speichern` : undefined}
            onClick={() => void draft.save(onSave)}>
            {draft.saving ? 'Speichert …' : 'Speichern'}
          </button>
          <button type="button" className="btn small secondary" disabled={draft.saving} aria-label={what ? `${what} verwerfen` : undefined}
            onClick={draft.discard}>
            Verwerfen
          </button>
        </>
      )}
      {draft.error && <span className="error" role="alert">Nicht gespeichert: {draft.error}</span>}
    </span>
  )
}
