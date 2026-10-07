// Druckblock der eigenen Heizkostenabrechnung (Heizung PR 12, Entwurf 8.8): je Heizkostenverteiler
// Einheiten, Skala und Faktor bzw. die Werte des Ablesedienstes. Mit `unitId` nur die der eigenen Wohnung.
import { hcaLines, hcaTitle } from '../hcaView'
import type { SelfHeatingStatement } from '../types'

export default function HcaBlock({ self, unitName, unitId }: { self: Pick<SelfHeatingStatement, 'devices' | 'serviceValues'>; unitName: (id: string) => string; unitId?: string }) {
  const lines = hcaLines(self, unitName, unitId)
  if (lines.length === 0) return null
  return (
    <div className="stack tight">
      <strong>{hcaTitle(self)}</strong>
      {lines.map((l) => <div key={l}>{l}</div>)}
    </div>
  )
}
