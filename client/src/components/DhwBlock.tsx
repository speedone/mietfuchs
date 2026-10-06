// Druckblock „Warmwasseranteil“ der eigenen Heizkostenabrechnung (Heizung PR 11, Entwurf 8.8): Anteil,
// Verfahren, Rechenweg und die Herkunft jedes Heizwerts.
import { dhwBlock } from '../dhwView'
import type { DhwStatement } from '../types'

export default function DhwBlock({ dhw }: { dhw: DhwStatement }) {
  const b = dhwBlock(dhw)
  if (!b) return null
  return (
    <div>
      <p><strong>{b.title}</strong>, {b.method}.</p>
      <ul>
        {[...b.steps, ...b.values].map((s) => <li key={s}>{s}</li>)}
      </ul>
    </div>
  )
}
