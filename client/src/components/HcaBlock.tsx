// Druckblock der eigenen Heizkostenabrechnung (Heizung PR 12, Entwurf 8.8): je Heizkostenverteiler
// Ablesewert, Skala und Faktor bzw. die Werte des Ablesedienstes. Mit `viewer` nur die des Nutzers in seinem
// Zeitraum (Durchsicht von #241, Recht-I1).
import { hcaLines, hcaTitle, type HcaViewer } from '../hcaView'
import type { SelfHeatingStatement } from '../types'

export default function HcaBlock({ self, unitName, viewer, unitId }: { self: Pick<SelfHeatingStatement, 'devices' | 'serviceValues'>; unitName: (id: string) => string; viewer?: HcaViewer; unitId?: string }) {
  const lines = hcaLines(self, unitName, viewer, unitId)
  if (lines.length === 0) return null
  return (
    <div className="stack tight">
      <strong>{hcaTitle(self)}</strong>
      {lines.map((l) => <div key={l}>{l}</div>)}
    </div>
  )
}
