import type { SelfHeatingStatement } from '../types'
import { potLines, userLine } from '../heatingSelfView'

// Druckblock „Heizkostenabrechnung“ je Anlage und Heizperiode (Heizung PR 10, Entwurf 8.8 ohne § 6a, der
// mit PR 14 kommt): Töpfe mit Preisen je Einheit, der Warmwasseranteil mit Methode und die Zeilen des
// Mieters. Der CO₂-Block (PR 6) steht darunter wie bisher.
export default function SelfHeatingBlock({ self, tenancyId, plantName }: { self: SelfHeatingStatement; tenancyId: string; plantName: string }) {
  const mine = self.units.flatMap((u) => u.users).filter((u) => u.tenancyId === tenancyId)
  if (!self.ok || mine.length === 0) return null
  return (
    <div className="co2-block">
      <h3>Heizkostenabrechnung{plantName ? ` · ${plantName}` : ''}</h3>
      {self.alpha && (
        <p>
          Warmwasseranteil {self.alpha.percent.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %: gemessen {self.alpha.dhwHeatKwh.toLocaleString('de-DE')} kWh
          von {self.alpha.referenceKwh.toLocaleString('de-DE')} kWh{self.alpha.reference === 'fuel' ? ' laut Brennstoffrechnung' : ' laut Gesamtwärmezähler'} (§ 9 Abs. 2 HeizkostenV)
          {self.alpha.estimated ? '; die Energie beruht teils auf einer Schätzung' : ''}.
        </p>
      )}
      {self.pots.flatMap(potLines).map((l) => <p key={l}>{l}</p>)}
      {mine.map((u) => <p key={u.key}><strong>{userLine(u, self)}</strong></p>)}
    </div>
  )
}
