// Druckblock „Heizkostenverteiler“ bzw. „Werte des Ablesedienstes“ (Heizung PR 12, Entwurf 8.8): Bei der
// Einheitsskala muss der Faktor in der Abrechnung stehen ([M] Berliner Mieterverein, übernommen). Ohne DOM
// prüfbar (hcaView.test.ts).
import type { SelfHeatingStatement } from './types'
import { fmtDate } from './api'

// Bis zu drei Nachkommastellen bei Einheiten; Faktoren mit allen Stellen, wie gespeichert.
const units = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 })
const factor = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 10 })

// Liest den Ausweis der eigenen Abrechnung. Mit `unitId` nur die Geräte bzw. Zeilen dieser Wohnung: Jeder
// Mieter bekommt seine eigenen Werte.
export function hcaLines(self: Pick<SelfHeatingStatement, 'devices' | 'serviceValues'> | undefined, unitName: (id: string) => string, unitId?: string): string[] {
  const mine = <T extends { unitId: string }>(xs: readonly T[] | undefined): T[] => (xs ?? []).filter((x) => unitId === undefined || x.unitId === unitId)
  const devices = mine(self?.devices).map((d) =>
    d.scale === 'unit'
      ? `${unitName(d.unitId)}, „${d.name}“: ${units(d.raw)} Einheiten × Bewertungsfaktor ${factor(d.factor)} = ${units(d.rated)} Einheiten (Einheitsskala)`
      : `${unitName(d.unitId)}, „${d.name}“: ${units(d.raw)} Einheiten (Produktskala, Faktor im Wert enthalten)`)
  const service = mine(self?.serviceValues).map((v) =>
    `${unitName(v.unitId)}, ${fmtDate(v.from)} bis ${fmtDate(v.to)}: Heizung ${units(v.heatValue)} Einheiten${v.waterValue !== null ? `, Warmwasser ${units(v.waterValue)}` : ''} (laut Ablesedienst)`)
  return [...devices, ...service]
}

export const hcaTitle = (self: Pick<SelfHeatingStatement, 'devices'>): string => ((self.devices ?? []).length > 0 ? 'Heizkostenverteiler' : 'Werte des Ablesedienstes')
