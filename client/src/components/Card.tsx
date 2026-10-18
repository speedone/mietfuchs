// Karte mit einheitlichem Kopf (#346 Schritt 7, UI-Durchsicht N8): Titel (mit Begriff), daneben rechts höchstens eine
// Aktion, darunter der Inhalt. Vorher setzte jede Karte ihren Kopf selbst, mal als `h2`, mal als `h3` mit „· 2025“
// dahinter. Die Ebene folgt der Seite: Karten unter einem Abschnittstitel (`h2`, etwa „Heizanlage, Heizperiode 2025“)
// sind `h3`, alle anderen `h2`. Gespeichert wird, wenn die Karte ein Formular trägt, mit **einem** „Speichern“ am Fuß
// (`DraftActions layout="card"`, Wächter S19).
import type { ReactNode } from 'react'

type Level = 2 | 3

export function CardHeader({ title, level = 2, aside }: { title: ReactNode; level?: Level; aside?: ReactNode }) {
  const Heading = level === 3 ? 'h3' : 'h2'
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      {/* Eine Karte unter einem Abschnittstitel ist `h3`, sieht aber aus wie jede andere Karte (sonst klein und grau). */}
      <Heading className={level === 3 ? 'm-0 text-l text-text' : 'm-0'}>{title}</Heading>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  )
}

export default function Card({ title, level, aside, className, children }: {
  title?: ReactNode
  level?: Level
  /** Höchstens eine Aktion im Kopf, rechts. */
  aside?: ReactNode
  /** Weitere Klassen der Karte, etwa `no-print`. */
  className?: string
  children: ReactNode
}) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      {title !== undefined && <CardHeader title={title} level={level} aside={aside} />}
      {children}
    </section>
  )
}
