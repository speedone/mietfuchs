// Druckblock „Heizkostenverteiler“ bzw. „Werte des Ablesedienstes“ (Heizung PR 12, Entwurf 8.8): je Gerät
// Ablesewert, Skala und Faktor. Dass der Faktor in der Abrechnung steht, ist Praxis der Messdienste
// (Berliner Mieterverein, übernommen; Durchsicht von #241, Recht-I3): Der Mieter kann so nachprüfen. Ohne DOM
// prüfbar (hcaView.test.ts).
import type { HcaDeviceLine, HeatingServiceValue, SelfHeatingStatement } from './types'
import { fmtDate } from './api'

// Bis zu drei Nachkommastellen bei Einheiten; Faktoren mit allen Stellen, wie gespeichert.
const units = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 })
const factor = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 10 })

// Wessen Zeilen (Durchsicht von #241, Recht-I1): eines Nutzers (Mieter, Leerstand) mit seinem Zeitraum, oder
// ohne Angabe alle (Seite Heizkosten).
export type HcaViewer = { userKey: string; from: string; to: string }

const deviceLine = (d: HcaDeviceLine, unitName: (id: string) => string, viewer: HcaViewer | undefined): string => {
  const head = `${unitName(d.unitId)}, „${d.name}“${viewer ? '' : `, ${fmtDate(d.from)} bis ${fmtDate(d.to)}`}`
  const shared = d.userKeys.length > 1 ? ' (ohne Zwischenablesung, gemeinsam für mehrere Nutzer nach § 9b Abs. 3 HeizkostenV)' : ''
  return d.scale === 'unit'
    ? `${head}: Ablesewert ${units(d.raw)} × Bewertungsfaktor ${factor(d.factor)} = ${units(d.rated)} Einheiten (Einheitsskala)${shared}`
    : `${head}: ${units(d.raw)} Einheiten (Produktskala, Faktor im Ablesewert enthalten)${shared}`
}
const serviceLine = (v: HeatingServiceValue, unitName: (id: string) => string): string =>
  `${unitName(v.unitId)}, ${fmtDate(v.from)} bis ${fmtDate(v.to)}: Heizung ${units(v.heatValue)} ${v.heatUnit === 'kWh' ? 'kWh' : 'Einheiten'}${v.waterValue !== null ? `, Warmwasser ${units(v.waterValue)} m³` : ''} (laut Ablesedienst)`

// Liest den Ausweis der eigenen Abrechnung. Mit `viewer` nur, was diesen Nutzer betrifft: seine Geräte in
// seinem Zeitraum und die Zeilen des Ablesedienstes, die in seinen Zeitraum fallen; ein Nachmieter sieht so
// nicht den Verbrauch seines Vormieters.
export function hcaLines(self: Pick<SelfHeatingStatement, 'devices' | 'serviceValues'> | undefined, unitName: (id: string) => string, viewer?: HcaViewer, unitId?: string): string[] {
  const devices = (self?.devices ?? []).filter((d) => (viewer ? d.userKeys.includes(viewer.userKey) : true) && (unitId === undefined || d.unitId === unitId))
  const service = (self?.serviceValues ?? []).filter((v) => (unitId === undefined || v.unitId === unitId) && (!viewer || (v.from <= viewer.to && v.to >= viewer.from)))
  return [...devices.map((d) => deviceLine(d, unitName, viewer)), ...service.map((v) => serviceLine(v, unitName))]
}

export const hcaTitle = (self: Pick<SelfHeatingStatement, 'devices'>): string => ((self.devices ?? []).length > 0 ? 'Heizkostenverteiler' : 'Werte des Ablesedienstes')
