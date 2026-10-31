import { useRef } from 'react'
import { GUIDES, type GuideId } from '../../../shared/guides.ts'
import { nextStepWithPage } from '../helpView'

// Der Faden einer Anleitung (#488, PR 2): Wer in „Hilfe & Begriffe“ auf „Zu {Seite} →“ klickt, sieht auf der Zielseite
// unten diese Leiste mit der Anleitung und dem Schritt, „Nächster Schritt“ (zur Seite des nächsten Schritts mit Seite)
// und „Zurück zur Anleitung“ (öffnet sie mit dem Fokus auf dem Schritt). Den Faden hält die App (App.tsx); ein
// gewöhnlicher Seitenwechsel beendet ihn, ebenso „Leiste schließen“. Eine Region mit Namen, damit Vorleser sie unter den
// Landmarken finden; gedruckt wird sie nie. `sticky` aus nur auf der Musterseite.
export default function GuideThread({ guide, step, onNext, onBack, onClose, sticky = true }: {
  guide: GuideId
  step: number
  // Ergibt, ob gewechselt wurde (bei offenem Formular fragt die App erst).
  onNext: (step: number) => Promise<boolean>
  onBack: () => void
  onClose: () => void
  sticky?: boolean
}) {
  const g = GUIDES[guide]
  const next = nextStepWithPage(g.steps, step)
  const backRef = useRef<HTMLButtonElement>(null)
  const goNext = async (to: number) => {
    // Beim letzten Schritt mit Seite verschwindet „Nächster Schritt“; der Fokus fiele sonst ins Leere.
    if ((await onNext(to)) && nextStepWithPage(g.steps, to) === null) backRef.current?.focus()
  }
  return (
    <section aria-label="Laufende Anleitung" className={`guide-thread no-print${sticky ? ' guide-thread-sticky' : ''}`}>
      <p className="m-0 min-w-0">
        <span aria-hidden="true">📖 </span><strong>{g.title}</strong> · Schritt {step + 1} von {g.steps.length}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {next !== null && <button type="button" className="btn secondary small" onClick={() => void goNext(next)}>Nächster Schritt</button>}
        <button ref={backRef} type="button" className="btn small" onClick={onBack}>Zurück zur Anleitung</button>
        <button type="button" className="btn ghost small" aria-label="Leiste schließen" title="Leiste schließen" onClick={onClose}>✕</button>
      </div>
    </section>
  )
}
