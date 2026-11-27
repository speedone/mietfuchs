// Der Druckblock „CO₂-Kostenaufteilung“ (Heizung PR 6, Entwurf 9.5). Er ist nicht `no-print`,
// denn er erfüllt § 7 Abs. 3 CO2KostAufG: den Anteil des Mieters, die Einstufung und die
// Berechnungsgrundlagen. Beim Messdienst stehen die Werte laut dessen Abrechnung; die Stufe ordnet
// Mietfuchs nach (Entwurf 9.2).
import { fmtDate, fmtEuro } from './api'
import { energyLabelOf } from './heatingForm'
import { halfSplitFirstDay } from '../../shared/law/co2kostaufg.ts'
import type { Co2Adjustment, HeatingStatement } from './types'

// `reference` (#704): Der Messdienst hat aufgeteilt und weist es in seiner Abrechnung aus; statt Zeilen und Stufentabelle
// steht dann nur dieser Satz, der auf die beiliegende Heizkostenabrechnung verweist.
export type Co2BlockView = { title: string; lines: { label: string; value: string }[]; table: { range: string; percent: string; marked: boolean }[]; notes: string[]; reference?: string }

// Der Verweis in der Abrechnung des Mieters, wenn der Messdienst (bei einer Eigentumswohnung die Gemeinschaft) die
// CO₂-Kosten aufgeteilt hat und der Vermieter dessen Abrechnung beilegt. Die Pflichtangaben nennt § 7 Abs. 3 CO2KostAufG.
export const co2EnclosedReference = (homeowners: boolean): string =>
  `Die CO₂-Kosten hat ${homeowners ? 'die Abrechnung der Gemeinschaft' : 'der Messdienst'} zwischen Vermieter und Mieter aufgeteilt. Ihren Anteil an den CO₂-Kosten, die Einstufung des Gebäudes und die Berechnungsgrundlagen weist die beiliegende ${homeowners ? 'Einzelabrechnung der Heizkosten' : 'Heizkostenabrechnung des Messdienstes'} aus (§ 7 Abs. 3 CO2KostAufG).`

const num = (n: number, digits = 1): string => n.toLocaleString('de-DE', { maximumFractionDigits: digits })

// `null`: kein Block, weil nichts gebucht ist (Probe gescheitert, nicht aufgeteilt) oder der Mieter
// in dieser Heizperiode keine Heizkosten hat. Bei der eigenen Aufteilung (Heizung PR 7, `basis:
// 'deliveries'`) stehen die Werte, wie Mietfuchs sie aus den Rechnungen gerechnet hat.
export function co2Block(h: HeatingStatement, tenancyId: string): Co2BlockView | null {
  const c = h.co2
  // #704: Verweis statt Block, für jeden Mieter mit einer Zeile aus den Messdienstpositionen dieser Heizperiode.
  if (c?.method === 'serviceEnclosed') {
    return (c.enclosedFor ?? []).includes(tenancyId)
      ? { title: 'CO₂-Kostenaufteilung', lines: [], table: [], notes: [], reference: co2EnclosedReference(c.enclosedBy === 'homeowners') }
      : null
  }
  if (!c || !c.booked) return null
  const tenant = c.tenants.find((t) => t.tenancyId === tenancyId)
  if (!tenant) return null
  // Eigene Aufteilung aus den Lieferungen (Heizung PR 7) oder aus dem Vorrat (Heizung PR 8).
  const own = c.basis === 'deliveries' || c.basis === 'stock'
  const fromStock = c.basis === 'stock'
  const lines: { label: string; value: string }[] = [
    // Heizung PR 16: bei Contracting die Wärmelieferung mit dem Brennstoff des Lieferanten.
    { label: 'Energieträger', value: energyLabelOf(h) },
    { label: 'Heizperiode', value: `${fmtDate(h.from)} – ${fmtDate(h.to)}` },
  ]
  if (c.emissionsKg !== null) {
    lines.push(fromStock
      ? { label: 'CO₂-Ausstoß des verbrauchten Brennstoffs', value: `${num(c.emissionsKg)} kg (Anfangsbestand + Lieferungen − Endbestand)` }
      : own
      ? { label: 'CO₂-Ausstoß, umgerechnet auf die Heizperiode', value: `${num(c.emissionsKg)} kg${c.coveragePermille != null && c.coveragePermille < 1000 ? ` (die Rechnungen decken ${num(c.coveragePermille)} ‰ der Gradtage ab)` : ''}` }
      : { label: 'CO₂-Ausstoß', value: `${num(c.emissionsKg)} kg` })
  }
  if (c.areaM2 !== null) {
    const source = own ? (c.areaSource === 'entered' ? ' (eingetragen)' : ' (versorgte Wohnungen)') : ''
    lines.push({ label: 'Wohnfläche der Einstufung', value: `${num(c.areaM2, 2)} m²${source}` })
  }
  if (c.kgPerM2 !== null) lines.push({ label: 'CO₂-Ausstoß je m² und Jahr', value: `${num(c.kgPerM2)} kg` })
  if (c.landlordPermille !== null) lines.push({ label: own ? 'Anteil des Vermieters' : 'Anteil des Vermieters laut Abrechnung', value: `${num(c.landlordPermille / 10)} %` })
  if (c.totalCents !== null) lines.push({ label: 'CO₂-Kosten insgesamt', value: fmtEuro(c.totalCents) })
  if (c.landlordCents !== null) lines.push({ label: 'davon trägt der Vermieter', value: fmtEuro(c.landlordCents) })
  // § 5a anteilig im Ausweis (Heizung PR 18, Entwurf 9.5).
  const hs = c.halfSplit
  if (hs) {
    if (hs.co2SharePermille > 0) lines.push({ label: 'Hälftige Teilung nach § 5a CO2KostAufG', value: `${num(hs.co2SharePermille / 10)} % der CO₂-Kosten nach Anfall` })
    if (hs.landlordGridFeeCents !== null && hs.landlordGridFeeCents > 0) lines.push({ label: 'Netzentgelte: Anteil des Vermieters', value: fmtEuro(hs.landlordGridFeeCents) })
    if (hs.landlordBioCents !== null && hs.landlordBioCents > 0) lines.push({ label: 'Biobrennstoff: Anteil des Vermieters', value: fmtEuro(hs.landlordBioCents) })
  }
  // Laienprobe B23: Beim Messdienst eine Näherung, die der Mieter neben dessen Einzelabrechnung liest.
  const approx = own
    ? ' (nach Ihrem Anteil an den Heizkosten)'
    : ' (näherungsweise nach Ihrem Anteil an den Heizkosten; maßgeblich ist der Betrag in der Einzelabrechnung des Messdienstes)'
  // Eigene Aufteilung: Der Abzug folgt dem Anteil am Brennstoff (Entwurf 9.4), sonst den Heizkosten.
  const basis = own && !tenant.approximated ? ' (nach Ihrem Anteil an den Brennstoffkosten)' : approx
  // Aus dem gerundeten Betrag laut Abrechnung berechnet ist der Anteil nicht centgenau (bei 10 % bis
  // ±4,5 ct); er steht deshalb als berechnet da (Nachprüfung 3), sonst als Näherung.
  if (tenant.tenantCents !== null) {
    lines.push({
      label: 'Ihr Anteil an den CO₂-Kosten',
      value: own
        ? `${fmtEuro(tenant.tenantCents)}${basis}`
        : tenant.tenantApproximated === false ? `≈ ${fmtEuro(tenant.tenantCents)} (aus dem Betrag laut Abrechnung berechnet)` : `${fmtEuro(tenant.tenantCents)}${approx}`,
    })
  }
  lines.push({
    label: c.deducted ? 'vom Vermieter übernommen (bereits abgezogen)' : 'vom Vermieter übernommen (eigene Zeile)',
    value: `${fmtEuro(tenant.landlordCents)}${own ? basis : tenant.approximated ? approx : ''}`,
  })
  const table = c.table.map((s) => ({
    range: s.to === null ? `ab ${num(s.from)} kg` : `${num(s.from)} bis unter ${num(s.to)} kg`,
    percent: `${s.landlordPercent} %`,
    marked: c.stage !== null && s.from === c.stage.from,
  }))
  const notes = [fromStock
    ? 'Berechnet von Mietfuchs aus den Lieferungen und dem Vorrat (§ 7 Abs. 3 CO2KostAufG): Aufgeteilt werden Ausstoß und CO₂-Kosten des im Abrechnungszeitraum verbrauchten Brennstoffs.'
    : own
    ? 'Berechnet von Mietfuchs aus den Rechnungen des Versorgers (§ 7 Abs. 3 CO2KostAufG); der Ausstoß ist auf die Heizperiode umgerechnet (§ 5 Abs. 1 Satz 5 CO2KostAufG).'
    : 'Angaben laut Abrechnung des Messdienstes oder der Gemeinschaft (§ 7 Abs. 3 CO2KostAufG).']
  // Durchsicht I2: Die markierte Stufe ist die nach dem Wert; weicht der Anteil laut Abrechnung davon
  // ab, sagt der Druck es, statt einen Widerspruch unerklärt stehen zu lassen.
  if (!own && c.stageMatches === false && c.landlordPermille !== null && c.stage !== null) {
    notes.push(`Der Anteil des Vermieters laut Abrechnung (${num(c.landlordPermille / 10)} %) weicht von der markierten Stufe ab (${c.stage.landlordPercent} %). Den Grund nennt die Abrechnung des Messdienstes, etwa eine Kürzung nach § 9 CO2KostAufG.`)
  }
  if (c.shortened) notes.push('Die Heizperiode ist kürzer als ein Jahr; die Grenzen der Stufentabelle sind anteilig gekürzt (§ 5 Abs. 1 Satz 4 CO2KostAufG).')
  // Jede Angabe mit ihrem eigenen Satz: Seit Heizung PR 18 gibt es § 5a und § 5d Abs. 3, und ein Rückfall auf § 9
  // Abs. 2 nennte dann eine Beschränkung, die es nicht gibt.
  const ADJUSTMENT_NOTES: Record<Co2Adjustment, string> = {
    nonResidential: 'Das Gebäude dient überwiegend nicht dem Wohnen; der Anteil des Vermieters richtet sich nach § 8 Abs. 1 CO2KostAufG statt nach der Stufe.',
    restrictionHalf: 'Der Anteil des Vermieters ist wegen öffentlich-rechtlicher Vorgaben um die Hälfte gekürzt (§ 9 Abs. 1 CO2KostAufG).',
    restrictionNone: 'Wegen öffentlich-rechtlicher Vorgaben werden die CO₂-Kosten nicht aufgeteilt (§ 9 Abs. 2 CO2KostAufG).',
    halfSplit: `Bei einer Heizung nach § 43 Abs. 1 GModG tragen Vermieter und Mieter die CO₂-Kosten ab ${halfSplitFirstDay().slice(0, 4)} je zur Hälfte (§ 5a Abs. 3 CO2KostAufG); der Anteil des Vermieters mischt die Stufe und die Hälfte nach dem Anfall in der Heizperiode.`,
    twoFamily: 'Zweifamilienhaus mit Eigennutzung: keine hälftige Teilung (§ 5d Abs. 3 CO2KostAufG).',
  }
  for (const a of c.adjustments ?? []) {
    // Unbekannte Angaben (aus einer späteren Fassung) bleiben ohne Satz, statt einen falschen zu drucken.
    if (Object.hasOwn(ADJUSTMENT_NOTES, a)) notes.push(ADJUSTMENT_NOTES[a])
  }
  if (hs?.basis === 'newBuilding') notes.push('Neubau: hälftige Teilung nach § 5b CO2KostAufG.')
  return { title: 'CO₂-Kostenaufteilung', lines, table, notes }
}
