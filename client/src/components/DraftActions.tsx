// „Speichern“ und „Verwerfen“ zu einem Entwurf aus `useDraft` (#309). Sie erscheinen nur, wenn
// etwas geändert ist, stehen überall gleich beschriftet direkt hinter dem Feld und sind während
// des Speicherns gesperrt. Scheitert das Speichern, steht der Grund daneben, und der Entwurf bleibt.
import type { Draft } from '../useDraft'

export default function DraftActions<T>({ draft, onSave, what, layout = 'field' }: {
  draft: Draft<T>
  // Schickt den Wert an den Server; lädt den Stand am besten gleich neu.
  onSave: (value: T) => Promise<unknown>
  // Wofür die Schaltflächen gelten, für Vorleser, wenn mehrere Entwürfe auf einer Seite stehen
  // („Versanddatum“ ergibt „Speichern (Versanddatum)“). Es steht unsichtbar hinter dem sichtbaren
  // Text und nicht als `aria-label`: Der Name beginnt so mit dem, was auf dem Knopf steht (WCAG 2.5.3,
  // Label in Name), und „Speichert …“ während des Speicherns hört ein Vorleser auch.
  what?: string
  // `field` (Vorgabe): Entwurf am Feld, kleine Knöpfe direkt hinter dem Feld. `card`: Karte mit einem
  // Speichern (Spezifikation #346, Abschnitt 3), am Fuß der Karte, „Speichern“ primär in normaler
  // Größe und daneben „Ungespeicherte Änderungen“.
  layout?: 'field' | 'card'
}) {
  if (!draft.dirty && !draft.error) return null
  // Das Leerzeichen steht vor dem unsichtbaren Teil, nicht darin: Die Berechnung des Namens schneidet
  // es dort ab.
  const context = what ? <>{' '}<span className="sr-only">({what})</span></> : null
  const card = layout === 'card'
  const size = card ? '' : ' small'
  const Box = card ? 'div' : 'span'
  return (
    <Box className={card ? 'draft-actions flex mt-4 pt-3 border-t border-line' : 'draft-actions'}>
      {draft.dirty && (
        <>
          <button type="button" className={`btn${size}`} disabled={draft.saving}
            onClick={() => void draft.save(onSave)}>
            {draft.saving ? 'Speichert …' : 'Speichern'}{context}
          </button>
          <button type="button" className={`btn${size} secondary`} disabled={draft.saving}
            onClick={draft.discard}>
            Verwerfen{context}
          </button>
          {card && <span className="muted">Ungespeicherte Änderungen</span>}
        </>
      )}
      {draft.error && <span className="error" role="alert">Nicht gespeichert: {draft.error}</span>}
    </Box>
  )
}
