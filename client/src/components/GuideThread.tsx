import { useEffect, useRef, useState } from 'react'
import { GUIDES, type GuideId } from '../../../shared/guides.ts'
import { nextStepWithPage } from '../helpView'

// Der Faden einer Anleitung (#488, PR 2): Wer in „Hilfe & Begriffe“ auf „Zu {Seite} →“ klickt, sieht auf der Zielseite
// unten diese Leiste mit der Anleitung und dem Schritt, „Nächster Schritt“ (zur Seite des nächsten Schritts mit Seite)
// und „Zurück zur Anleitung“ (öffnet sie mit dem Fokus auf dem Schritt). Den Faden hält die App (App.tsx); ein
// gewöhnlicher Seitenwechsel beendet ihn, ebenso „Leiste schließen“. Eine Region mit Namen, damit Vorleser sie unter den
// Landmarken finden; gedruckt wird sie nie. `sticky` aus nur auf der Musterseite.
//
// Sie nennt den Schritt in einer Zeile (voll unter „Was ist zu tun?“) und sagt „Anleitung · Schritt n von m“ als Status
// an, so hört man auch einen Schritt auf derselben Seite (Durchsicht von PR 2, S2). „Nächster Schritt“ ist der
// Primärknopf, am letzten Schritt „Zurück zur Anleitung“ (K3).
//
// Angeheftet verdeckt sie, was unter ihr liegt. Damit ein fokussierter Knopf nicht unter ihr verschwindet (WCAG 2.4.11),
// meldet sie ihre Höhe als `--thread-h` an <html>; tw.css rechnet sie in `scroll-padding-bottom` ein (Durchsicht von
// PR 2, M1; Wächter S34 in uiRules.test.ts).
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
  const barRef = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const el = barRef.current
    if (!sticky || !el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const report = () => root.style.setProperty('--thread-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--thread-h')
    }
  }, [sticky])
  const text = g.steps[step]?.text ?? ''
  const goNext = async (to: number) => {
    // Beim letzten Schritt mit Seite verschwindet „Nächster Schritt“; der Fokus fiele sonst ins Leere.
    if ((await onNext(to)) && nextStepWithPage(g.steps, to) === null) backRef.current?.focus()
  }
  return (
    <section ref={barRef} aria-label="Laufende Anleitung" className={`guide-thread no-print${sticky ? ' guide-thread-sticky' : ''}`}>
      <div className="min-w-0 flex-1 basis-64">
        <p className="m-0 flex gap-1">
          <span aria-hidden="true">📖</span>
          <span role="status"><strong>{g.title}</strong> · Schritt {step + 1} von {g.steps.length}</span>
        </p>
        {/* Der Schritt in einer Zeile; aufgeklappt steht er unter „Was ist zu tun?“ ganz da (die Zeile entfällt dann). */}
        {!open && <p className="m-0 mt-1 text-s text-muted line-clamp-1" aria-hidden="true">{text}</p>}
        <details className="mt-1 text-s" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="w-fit cursor-pointer text-accent-text">Was ist zu tun?</summary>
          <p className="m-0 mt-1">{text}</p>
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {next !== null && <button type="button" className="btn small" onClick={() => void goNext(next)}>Nächster Schritt</button>}
        <button ref={backRef} type="button" className={next !== null ? 'btn secondary small' : 'btn small'} onClick={onBack}>Zurück zur Anleitung</button>
        <button type="button" className="btn ghost small" aria-label="Leiste schließen" title="Leiste schließen" onClick={onClose}>✕</button>
      </div>
    </section>
  )
}
