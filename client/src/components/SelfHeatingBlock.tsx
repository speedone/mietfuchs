import type { SelfHeatingStatement } from '../types'
import { potLines, userLine } from '../heatingSelfView'
import { showsDhwBlock } from '../dhwView'
import DhwBlock from './DhwBlock'
import HcaBlock from './HcaBlock'

// Druckblock „Heizkostenabrechnung“ je Anlage und Heizperiode (Heizung PR 10, Entwurf 8.8 ohne § 6a, der
// mit PR 14 kommt): Töpfe mit Preisen je Einheit, der Warmwasseranteil mit Methode und die Zeilen des
// Mieters. Der CO₂-Block (PR 6) steht darunter wie bisher.
export default function SelfHeatingBlock({ self, tenancyId, plantName }: { self: SelfHeatingStatement; tenancyId: string; plantName: string }) {
  const mine = self.units.flatMap((u) => u.users).filter((u) => u.tenancyId === tenancyId)
  if (!self.ok || mine.length === 0) return null
  return (
    <div className="co2-block">
      <h3>Heizkostenabrechnung{plantName ? ` · ${plantName}` : ''}</h3>
      {showsDhwBlock(self.dhw) && <DhwBlock dhw={self.dhw} />}
      {self.alpha && !showsDhwBlock(self.dhw) && (
        <p>
          Warmwasseranteil {self.alpha.percent.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %: gemessen {self.alpha.dhwHeatKwh.toLocaleString('de-DE')} kWh
          von {self.alpha.referenceKwh.toLocaleString('de-DE')} kWh{self.alpha.reference === 'fuel' ? ' laut Brennstoffrechnung' : ' laut Gesamtwärmezähler'} (§ 9 Abs. 2 HeizkostenV)
          {self.alpha.estimated ? '; die Energie beruht teils auf einer Schätzung' : ''}.
        </p>
      )}
      {self.pots.flatMap(potLines).map((l) => <p key={l}>{l}</p>)}
      {mine.map((u) => <p key={u.key}><strong>{userLine(u, self)}</strong></p>)}
      {/* Heizung PR 12: die Geräte bzw. Werte des Ablesedienstes der eigenen Wohnung, mit Skala und Faktor. */}
      {[...new Set(mine.map((u) => self.units.find((x) => x.users.includes(u))?.unitId ?? ''))].map((unitId) => (
        <HcaBlock key={`hca:${unitId}`} self={self} unitId={unitId} unitName={(id) => self.units.find((x) => x.unitId === id)?.unitName ?? id} />
      ))}
    </div>
  )
}
