// Die eigene Heizkostenabrechnung auf der Seite Heizkosten und im Druck (Heizung PR 10, Entwurf 3.5,
// 8.8), ohne DOM prüfbar (heatingSelfView.test.ts). Die Zahlen rechnet der Server; hier stehen nur
// Sätze und die Ampel.
import type { CaptureMethod, HeatingDistribution, HeatingEnergy, InsulationRule, SelfBoundaryView, SelfEstimateView, SelfHeatingStatement, SelfPotView, SelfReadingView, SelfUnitView, SelfUserView } from './types'
import { fmtDate, fmtEuro } from './api'
import { CAUSE_TEXT } from './estimateForm'
import { shareBounds } from './heatingSelfForm'
import { hkvConsumptionShareForced, hkvCutNotByConsumption } from '../../shared/law/heizkostenv.ts'
import { LAW_AS_OF, valueAt } from '../../shared/law/register.ts'
import { andList } from '../../shared/wording.ts'

// ---------- Wärmeschutz und Pflichtanteil (Durchsicht von #239, C1 und M1) ----------

// § 7 Abs. 1 Satz 2 HeizkostenV gilt nur bei Öl- oder Gasheizung (Flüssiggas zählt als Gas); sonst
// fragt Mietfuchs nicht.
export const insulationAsked = (energy: HeatingEnergy): boolean => ['oil', 'gas', 'lpg'].includes(energy)
export const INSULATION_QUESTION = 'Liegt der Wärmeschutz Ihres Hauses unter dem Anforderungsniveau der Wärmeschutzverordnung vom 16. August 1994, und sind die freiliegenden Leitungen der Wärmeverteilung überwiegend gedämmt?'
export const INSULATION_OPTIONS: { value: InsulationRule; label: string }[] = [
  { value: 'applies', label: 'Ja, beides' },
  { value: 'notApplies', label: 'Nein' },
  { value: 'unknown', label: 'Weiß ich nicht' },
]
const forcedValue = (): number => valueAt(hkvConsumptionShareForced, LAW_AS_OF)
export const insulationExplained = (): string =>
  `Trifft beides zu, sind von den Heizkosten ${forcedValue()} % nach Verbrauch zu verteilen (§ 7 Abs. 1 Satz 2 HeizkostenV); mehr nur mit einer Vereinbarung (§ 10 HeizkostenV).`
// „Weiß ich nicht“ und weniger als der Pflichtanteil: der Rat aus der Durchsicht.
export function unsureShareHint(energy: HeatingEnergy, insulation: InsulationRule | '' | null, share: number | null): string | null {
  const forced = forcedValue()
  if (!insulationAsked(energy) || insulation !== 'unknown' || share === null || share >= forced) return null
  return `Mit ${forced} % liegen Sie in jedem Fall richtig; trifft § 7 Abs. 1 Satz 2 HeizkostenV zu, sind weniger nicht zulässig.`
}

// ---------- Fehlende Zwischenablesung (Durchsicht von #239, I3) ----------

// Was jede Antwort bewirkt, bevor der Vermieter sie gibt.
export function gapConsequence(status: 'impossible' | 'missed'): string {
  return status === 'impossible'
    ? 'Nicht möglich: Die Kosten der Wohnung werden nach Gradtagen und Tagen auf die Mieter geteilt (§ 9b Abs. 3 HeizkostenV). Nennen Sie den Grund; er steht in der Abrechnung.'
    : `Nicht durchgeführt: Mietfuchs teilt die Kosten der Wohnung ebenso nach § 9b Abs. 3 HeizkostenV, denn eine andere Rechnung gibt es nicht; die Zwischenablesung war Pflicht (§ 9b Abs. 1). Nach einer Auslegung (LG Hamburg, 11 S 202/87) dürfen die Mieter ihren Anteil an diesen Kosten um bis zu ${valueAt(hkvCutNotByConsumption, LAW_AS_OF)} % kürzen. Die Abrechnung nennt die Beträge.`
}

// Prozent mit höchstens zwei Nachkommastellen (M9); sonst null.
export function percentOf(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Number(t)
}

export type Light = 'green' | 'yellow' | 'red'

// Rot ist, was die Abrechnung nach § 9b Abs. 3 rechnen lässt und eine Kürzung erlaubt; gelb, was
// zulässig ist, aber hingesehen werden sollte (daneben abgelesen, Zwischenablesung nicht möglich).
export function boundaryLight(b: SelfBoundaryView): Light {
  // Systemprüfung: Ohne angelegtes Gerät gibt es nichts abzulesen; das ist nicht „abgelesen“.
  if ((b.noDevicePots ?? []).length > 0) return 'red'
  if (b.status === 'read') return 'green'
  // Ab der Warngrenze neben dem Wechsel wählt der Vermieter; bis dahin wird nicht verteilt (Abweichung 22).
  if (b.status === 'off') return b.far && b.kind === 'change' && b.gap !== 'useReading' && b.gap !== 'imprecise' ? 'red' : 'yellow'
  return b.gap === 'impossible' ? 'yellow' : 'red'
}

const KIND_TEXT: Record<SelfBoundaryView['kind'], string> = { start: 'Beginn der Heizperiode am', end: 'Ende der Heizperiode am', change: 'Mieterwechsel zum' }
export function boundaryText(b: SelfBoundaryView, unitName: string, capture?: CaptureMethod): string {
  const head = `${unitName}, ${KIND_TEXT[b.kind]} ${fmtDate(b.date)}`
  const lacking = b.noDevicePots ?? []
  if (lacking.length === 0) return `${head}: ${statusText(b)}`
  // Systemprüfung: je Topf ohne Gerät der fehlende Schritt; fehlt daneben ein Stand des anderen Topfs, steht beides da.
  const pots = lacking.map((p) => (p === 'heating' ? 'die Heizung' : 'das Warmwasser')).join(' und ')
  const none = `für ${pots} ${capture === 'serviceValues' ? 'kein Wert des Ablesedienstes eingetragen' : 'kein Gerät angelegt'}`
  return `${head}: ${none}${b.status === 'read' ? '' : `; ${statusText(b)}`}`
}
function statusText(b: SelfBoundaryView): string {
  if (b.status === 'read') return 'abgelesen'
  if (b.status === 'off') {
    const choice = b.far && b.kind === 'change'
      ? (b.gap === 'imprecise' ? ' (geteilt nach § 9b Abs. 3)' : b.gap === 'useReading' ? ' (Ablesung verwendet)' : '; bitte wählen')
      : ''
    return `abgelesen ${b.offDays} ${b.offDays === 1 ? 'Tag' : 'Tage'} daneben${b.far ? ', über einen Wintermonat' : ''}${choice}`
  }
  const answer = b.gap === 'impossible' ? ` (nicht möglich${b.gapReason ? `: ${b.gapReason}` : ''})` : b.gap === 'missed' ? ' (nicht durchgeführt)' : ''
  return `keine Ablesung${missingMetersText(b.missingMeters ?? [])}${answer}`
}

// Systemprüfung: Je Topf, für den an keiner Wohnung ein Gerät angelegt ist, der fehlende Schritt. Die Seite meldete
// sonst jede Wohnung als abgelesen, während ganz nach Fläche verteilt wird. Der Seitenname steht wie in der Navigation.
// #690: ebenso je Topf, dem nur an einzelnen Wohnungen das Gerät fehlt (`unequippedUnits`); vorher sperrte das die Anlage.
export function missingDevicesLines(self: Pick<SelfHeatingStatement, 'capture' | 'pots'>): string[] {
  return self.pots.filter((p) => p.noDevices || (p.unequippedUnits ?? []).length > 0).map((p) => {
    const name = p.pot === 'heating' ? 'Heizung' : 'Warmwasser'
    const by = p.basisUnit === 'm³' ? 'umbautem Raum' : 'Fläche'
    const only = `verteilt wird deshalb nur nach ${by}.`
    const device = p.pot === 'water' ? 'Warmwasserzähler' : self.capture === 'hca' ? 'Heizkostenverteiler' : 'Wärmezähler'
    const lacking = p.unequippedUnits ?? []
    if (!p.noDevices && lacking.length > 0) {
      const how = p.byAreaOnly || p.overThreshold ? `verteilt wird deshalb nur nach ${by}` : 'angesetzt wird für sie der Durchschnitt der abgelesenen Wohnungen'
      return `${name}: ${andList(lacking)} ${lacking.length === 1 ? 'hat' : 'haben'} keinen ${device}, die übrigen Wohnungen schon; ${how}, und die Mieter dürfen ihren Anteil kürzen (§ 12 Abs. 1 Satz 1 HeizkostenV). ` +
        `Legen Sie ${lacking.length === 1 ? 'das Gerät' : 'die Geräte'} auf der Seite „Zähler & Stände“ an; war eines eingebaut und ist ausgefallen, legen Sie es dort an und schätzen Sie den Verbrauch unter „Schätzung (§ 9a)“.`
    }
    if (self.capture === 'serviceValues') return `${name}: Es sind keine Werte des Ablesedienstes eingetragen; ${only} Tragen Sie die Werte auf dieser Seite unter „Werte des Ablesedienstes“ ein.`
    return `${name}: An keiner Wohnung ist ein ${device} angelegt; ${only} Legen Sie die Geräte auf der Seite „Zähler & Stände“ an und tragen Sie dort die Ablesungen zu Beginn und Ende der Heizperiode ein.`
  })
}
// Die Karte „Schätzung (§ 9a)“ sagte daneben „Für keine Wohnung fehlt ein Wert“. Ohne Gerät nimmt Mietfuchs keine
// Schätzung an (beim Ablesedienst schon), deshalb dort dieser Satz.
export const ESTIMATE_NEEDS_DEVICES = 'Solange kein Gerät angelegt ist, nimmt Mietfuchs keine Schätzung an.'
export const estimateIdleText = (self: Pick<SelfHeatingStatement, 'capture' | 'pots'>): string =>
  (self.capture !== 'serviceValues' && self.pots.some((p) => p.noDevices || (p.unequippedUnits ?? []).length > 0) ? ESTIMATE_NEEDS_DEVICES : 'Für keine Wohnung fehlt ein Wert.')

// Befund M7 aus #341: welchem Zähler der Stand fehlt, mit Zählernummer. Ältere Abrechnungen führen die
// Angabe nicht; dann bleibt der Satz, wie er war.
function missingMetersText(meters: readonly { name: string; number?: string }[]): string {
  if (meters.length === 0) return ''
  const names = meters.map((m) => `„${m.name}“${m.number ? ` (Nr. ${m.number})` : ''}`)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
  return meters.length === 1 ? ` am Zähler ${list}` : ` an den Zählern ${list}`
}

// § 6 Abs. 4: nach Beginn der Heizperiode gilt der Anteil; vorher und beim ersten Mal ist er frei.
export const shareEditable = (d: HeatingDistribution): boolean => d.first || !d.begun

export function distributionLines(d: HeatingDistribution): string[] {
  if (!d.effective) return ['Noch kein Anteil nach Verbrauch festgelegt.']
  const water = d.effective.water === null ? '' : `, Warmwasser ${d.effective.water} %`
  const lines = [`Heizung ${d.effective.heating} %${water} nach Verbrauch${d.inherited ? ', übernommen aus der vorigen Heizperiode' : ''}`]
  if (d.forcedPercent !== null) lines.push(`Vorgeschrieben: ${d.forcedPercent} % bei den Heizkosten (§ 7 Abs. 1 Satz 2 HeizkostenV).`)
  // Heizung PR 14: mehr als 70 % mit Vereinbarung (§ 10 HeizkostenV).
  if (d.effective.above70Agreed) lines.push(`Mehr als ${shareBounds().max} % nach Verbrauch sind mit den Mietern vereinbart (§ 10 HeizkostenV).`)
  if (!shareEditable(d)) lines.push('Die Heizperiode hat begonnen; einen anderen Anteil tragen Sie für die nächste ein (§ 6 Abs. 4 HeizkostenV).')
  return lines
}

const POT_LABEL = { heating: 'Heizung', water: 'Warmwasser' } as const
const permille = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })
const percent = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

// **Der Mieter rechnet aus dem Gedruckten nach**: Menge mal Preis je Einheit ergibt den gedruckten Betrag bis auf Rundung
// von höchstens einem Cent (genauer geht es nicht: Bei verbundenem Warmwasser ist der Topfbetrag ungerundet, gedruckt
// wird der gerundete, und Menge wie Preis sind selbst gerundet); je Nutzer bei den Grundkosten bis zur Zahl der
// verteilten Kostenpositionen des Topfs plus einen Cent (`basisOf`). Der Server liefert die
// Mengen ungerundet (Differenzen der Stände, bei Heizkostenverteilern mal Faktor, nach § 9b Abs. 3 und § 9a geteilte
// Anteile, Flächen wie eingetragen), auch mit Gleitkommarest; gerundet wird dort erst der Betrag. Deshalb:
// - Eine Menge, die mit höchstens drei Nachkommastellen aufgeht (so genau stehen Stände und Flächen da), steht genau
//   so da, eine ganze Zahl ohne Nachkommastellen, ein Gleitkommarest fällt weg.
// - Ein gerechneter Anteil, der nicht aufgeht, bekommt die wenigsten Stellen (höchstens sechs), bei denen seine
//   Rundung den Betrag um nicht mehr als einen Viertelcent verschiebt; ohne Preis daneben drei.
// - Der Preis bekommt so viele Stellen (höchstens acht), dass seine Rundung mal Menge unter einem Viertelcent bleibt,
//   mindestens die bisherigen (vier je m² bzw. m³, sechs je Verbrauchseinheit); mehr nur, wo sie nicht null sind.
// Nur Darstellung: Keine Zahl eines eingefrorenen Stands ändert sich. Eine negative Null (−0, −5,5e-17) steht als 0 da.
const QUARTER_CENT = 0.25
const exactAt = (n: number, digits: number): boolean => {
  const f = 10 ** digits
  return Math.abs(Math.round(n * f) / f - n) <= 1e-9 * Math.max(1, Math.abs(n))
}
function quantity(n: number, centsPerUnit: number | null = null): string {
  let digits = [0, 1, 2, 3].find((d) => exactAt(n, d))
  if (digits === undefined) {
    const price = Math.abs(centsPerUnit ?? 0)
    digits = price > 0 ? ([0, 1, 2, 3, 4, 5].find((d) => price * 0.5 * 10 ** -d <= QUARTER_CENT) ?? 6) : 3
  }
  return (Number(n.toFixed(digits)) || 0).toLocaleString('de-DE', { maximumFractionDigits: digits })
}
// Ein Betrag in Cent ohne negative Null.
const eur = (cents: number): string => fmtEuro(cents || 0)
function perUnit(cents: number, forQuantity: number, minDigits: number): string {
  // Der Preis steht in Euro: halbe letzte Stelle mal Menge höchstens ein Viertelcent.
  const needed = forQuantity > 0 ? Math.ceil(Math.log10((forQuantity * 0.5) / (QUARTER_CENT / 100))) : 0
  const digits = Math.min(8, Math.max(minDigits, needed))
  return `${(Number((cents / 100).toFixed(digits)) || 0).toLocaleString('de-DE', { minimumFractionDigits: minDigits, maximumFractionDigits: digits })}\u00a0€`
}

export function potLines(p: SelfPotView): string[] {
  const base = p.costCents * (1 - p.consumptionPct / 100)
  const lines = [`${POT_LABEL[p.pot]}: ${eur(p.costCents)}`]
  // #322: Steht der Topf nach umbautem Raum, sind es Kubikmeter.
  const unit = p.basisUnit ?? 'm²'
  lines.push(`Grundkosten ${percent(100 - p.consumptionPct)} %: ${eur(Math.round(base))} für ${quantity(p.areaM2, p.baseCentsPerM2)} ${unit}, ${perUnit(p.baseCentsPerM2, p.areaM2, 4)} je ${unit}`)
  const lacking = p.unequippedUnits ?? []
  // #690: Einer Wohnung fehlt das Gerät, und der Topf geht nur nach Fläche (über der Grenze oder ohne abgelesene Wohnung).
  if (lacking.length > 0 && (p.overThreshold || p.byAreaOnly)) lines.push(`Ohne Gerät bei ${andList(lacking)} ist der Verbrauch nicht für alle Wohnungen erfasst: nur nach ${unit === 'm³' ? 'umbautem Raum' : 'Fläche'} verteilt.`)
  // § 9a Abs. 2 (Heizung PR 13): über der Grenze nur nach Fläche.
  else if (p.overThreshold) lines.push(`Geschätzt ist der Verbrauch für ${quantity(p.estimatedAreaM2 ?? 0)} von ${quantity(p.areaM2)} ${unit}; das überschreitet die Grenze des § 9a Abs. 2 HeizkostenV, deshalb nur nach ${unit === 'm³' ? 'umbautem Raum' : 'Fläche'} verteilt.`)
  else if (p.byAreaOnly) lines.push(`Kein Verbrauch erfasst: nur nach ${unit === 'm³' ? 'umbautem Raum' : 'Fläche'} verteilt.`)
  else if (p.consumptionCentsPerUnit !== null) {
    // „je Einheit“, nicht „je Einheiten“ (Durchsicht von #241, Minor 2).
    // Durchsicht von #242, R-M9: der geschätzte Teil, ohne eine Wohnung zu nennen.
    const estimated = (p.estimatedConsumption ?? 0) > 0 ? ` (davon geschätzt nach § 9a HeizkostenV: ${quantity(p.estimatedConsumption ?? 0, p.consumptionCentsPerUnit)} ${p.consumptionUnit})` : ''
    // #690: der Teil der Wohnungen ohne Gerät, mit Namen (der Mieter dieser Wohnung sieht, wofür er zahlt).
    const substituted = lacking.length > 0 ? ` (davon für ${andList(lacking)} ohne Gerät als Durchschnitt der abgelesenen Wohnungen: ${quantity(p.substitutedConsumption ?? 0, p.consumptionCentsPerUnit)} ${p.consumptionUnit})` : ''
    lines.push(`Verbrauchskosten ${percent(p.consumptionPct)} %: ${eur(Math.round(p.costCents - base))} für ${quantity(p.consumption, p.consumptionCentsPerUnit)} ${p.consumptionUnit}${estimated}${substituted}, ${perUnit(p.consumptionCentsPerUnit, p.consumption, 6)} je ${p.consumptionUnit === 'Einheiten' ? 'Einheit' : p.consumptionUnit}`)
  }
  return lines
}

// Heizkostenverteiler und Ablesedienst zählen Einheiten, keine Kilowattstunden (Heizung PR 12, Abweichung 9).
// Steht der Topf einheitlich in MWh, ist es MWh (#342, Durchsicht E2).
export const heatUnitOf = (self: Pick<SelfHeatingStatement, 'pots'>): string =>
  self.pots.find((p) => p.pot === 'heating')?.consumptionUnit ?? 'kWh'
// Die Einheit des Topfs Warmwasser: m³, bei einheitlich Litern l.
const waterUnitOf = (self: Pick<SelfHeatingStatement, 'pots'>): string =>
  self.pots.find((p) => p.pot === 'water')?.consumptionUnit ?? 'm³'

// Grund- und Verbrauchskosten je Nutzer (Systemprüfung): Der Server liefert je Nutzer und Topf nur die Summe. Sein
// Anteil nach Verbrauch ist aber genau Verbrauch mal Preis je Einheit des Topfs (das Gewicht ist
// (1 − p) · Grundanteil + p · Verbrauch / Gesamtverbrauch, `weightsOf` in server/src/heating.ts), die Grundkosten sind
// der Rest zum Betrag der Zeile. Das gilt auch für eingefrorene Stände, ohne neue Felder. Keine Aufteilung, wo es
// keinen Anteil nach Verbrauch gibt (nur nach Fläche, über der Grenze des § 9a Abs. 2, 0 oder 100 %), ohne Betrag
// (nicht verteilbar) und wenn der Rest negativ würde.
function costSplit(cents: number, consumption: number | null, pot: SelfPotView | undefined, basis: (baseCents: number) => string | null): string {
  if (!pot || pot.consumptionCentsPerUnit === null || consumption === null || cents <= 0) return ''
  if (pot.byAreaOnly || pot.overThreshold || pot.consumptionPct <= 0 || pot.consumptionPct >= 100) return ''
  const use = Math.round(consumption * pot.consumptionCentsPerUnit)
  if (use < 0 || use > cents) return ''
  const text = basis(cents - use)
  return ` (Grundkosten ${eur(cents - use)}${text ? ` für ${text}` : ''}, Verbrauchskosten ${eur(use)})`
}

// Wonach die Grundkosten eines Nutzers gerechnet sind (Durchsicht): Fläche bzw. Raum der Wohnung mal Preis mal Anteil
// an der Heizperiode. Der Server rechnet den Anteil als Gradtage bzw. Tage des Nutzers durch die der Heizperiode
// (`splitOf`/`splitTotal` in server/src/heating.ts: die Heizung nach Gradtagen oder, bei zeitanteiliger Teilung, nach
// Tagen; das Warmwasser immer nach Tagen). Der Stand trägt je Nutzer nur Tage und Gradtage, nicht die der Heizperiode;
// deren Summe über die Nutzer der Wohnung ist der Nenner, wenn die Nutzer die Heizperiode ganz abdecken. **Geraten wird
// nicht**: Genannt wird die Rechnung nur, wenn sie mit den gedruckten Zahlen die gedruckten Grundkosten bis auf die
// Rundung ergibt (sie sind der Rest zum Betrag der Zeile); sonst steht nur der Betrag da. Ebenso ohne Fläche im Stand
// und, bei mehreren Nutzern, ohne Angabe zur Teilung beim Wechsel. **Die Rundung**: Der Betrag des Nutzers ist die Summe
// seiner je Position gerundeten Zeilen (`heatingRows`, `waterRows` des Stands), also je verteilter Zeile ein Cent und
// einer dazu; ein Stand ohne die Angabe (vorher eingefroren: Topf mal Gewicht, einmal gerundet) bleibt bei einem Cent.
const BASIS_RELATIVE_SLACK = 0.02
function basisOf(
  u: SelfUserView, unit: SelfUnitView | undefined, pot: SelfPotView | undefined, changeSplit: SelfHeatingStatement['changeSplit'] | undefined, baseCents: number,
): string | null {
  if (!unit || !pot) return null
  const area: unknown = pot.pot === 'heating' ? unit.heatAreaM2 : unit.areaM2
  if (typeof area !== 'number' || !Number.isFinite(area) || area <= 0) return null
  const others = unit.users.filter((x) => x.key !== u.key)
  const byDays = pot.pot === 'water' || changeSplit === 'time'
  if (!byDays && changeSplit !== 'degreeDays' && others.length > 0) return null
  // Gerechnet wird mit den Zahlen, wie sie gedruckt werden (Gradtage auf eine Nachkommastelle).
  const measure = (x: SelfUserView): number => (byDays ? x.days : Math.round(x.degreeDayPermille * 10) / 10)
  const own = measure(u)
  const whole = others.reduce((a, x) => a + measure(x), own)
  if (!Number.isFinite(own) || !Number.isFinite(whole) || own <= 0 || whole <= 0) return null
  const rows = pot.pot === 'heating' ? u.heatingRows : u.waterRows
  // Die Zeilenzahl ist eine absolute Toleranz; bei Grundkosten von wenigen Cent erklärte sie auch eine falsche Teilung.
  // Deshalb gilt sie nur bis 2 % der Grundkosten (ab 2 € bei drei Zeilen wie zuvor), der eine Cent der Rundung immer.
  const byRows = typeof rows === 'number' && Number.isFinite(rows) && rows > 0 ? rows + 1 : 1
  const slack = Math.max(1, Math.min(byRows, Math.floor(Math.abs(baseCents) * BASIS_RELATIVE_SLACK)))
  if (Math.abs(Math.round(area * pot.baseCentsPerM2 * (own / whole)) - baseCents) > slack) return null
  const share = own >= whole ? '' : byDays ? `, davon ${own} von ${whole} Tagen` : `, davon ${permille(own)} von ${permille(whole)} ‰ der Gradtage`
  return `${quantity(area, pot.baseCentsPerM2)} ${pot.pot === 'heating' ? (pot.basisUnit ?? 'm²') : 'm²'}${share}`
}

// #690 (Nachprüfung S1): Hat keine versorgte Wohnung einen Anschluss an das Warmwasser, steht dessen Teil beim Vermieter;
// eine eigene Zeile, damit alle Zeilen des Blocks zusammen die Positionen ergeben. Ältere Stände kennen die Angabe nicht.
export function unconnectedWaterLine(self: Pick<SelfHeatingStatement, 'unconnectedWaterCents'>): string | null {
  const c = self.unconnectedWaterCents ?? 0
  return c === 0 ? null : `Vermieter, Warmwasser ohne angeschlossene Wohnung: ${eur(c)} (kein Mieter hat einen Anschluss an das Warmwasser)`
}

export function userLine(u: SelfUserView, self: Pick<SelfHeatingStatement, 'pots'> & Partial<Pick<SelfHeatingStatement, 'units' | 'changeSplit'>>): string {
  const heatUnit = heatUnitOf(self)
  const time = `${fmtDate(u.from)} bis ${fmtDate(u.to)} (${u.days} Tage, ${permille(u.degreeDayPermille)} ‰ der Gradtage)`
  const potOf = (pot: 'heating' | 'water') => self.pots.find((p) => p.pot === pot)
  // Die Wohnung des Nutzers nennt die Fläche bzw. den Raum, nach dem seine Grundkosten gerechnet sind.
  const unit = self.units?.find((x) => x.users.some((y) => y.key === u.key))
  // Der Topfbetrag je Mieter, mit Abzug auch nach CO₂-Abzug: die Grundlage einer Kürzung (Abweichung 15).
  const net = (cents: number, co2: number, split: string) => `${eur(cents)}${split}${co2 > 0 ? `, nach CO₂-Abzug ${eur(cents - co2)}` : ''}`
  // Heizung PR 13: eine Schätzung nach § 9a und die Gruppe nach § 9b Abs. 3 in einer Klammer.
  // Durchsicht von #242, R-M8: Über der Grenze des § 9a Abs. 2 zählt der Verbrauch für die Kosten nicht.
  const over = (pot: 'heating' | 'water') => potOf(pot)?.overThreshold === true
  const note = (estimated: boolean | undefined, group: boolean, notUsed: boolean) => {
    const parts = [...(estimated ? [`geschätzt nach § 9a${group ? ', gemeinsam nach § 9b Abs. 3' : ''}`] : group ? ['gemeinsam nach § 9b Abs. 3'] : []), ...(notUsed ? ['für die Verteilung nicht maßgeblich, § 9a Abs. 2'] : [])]
    return parts.length > 0 ? ` (${parts.join('; ')})` : ''
  }
  const heat = potOf('heating')
  const basis = (pot: SelfPotView | undefined) => (baseCents: number) => basisOf(u, unit, pot, self.changeSplit, baseCents)
  const parts = [`Heizung ${u.heatingConsumption === null ? 'nicht erfasst' : `${quantity(u.heatingConsumption, heat?.consumptionCentsPerUnit)} ${heatUnit}${note(u.heatingEstimated, u.heatingGroup, over('heating'))}`}, ${net(u.heatingCents, u.heatingCo2Cents, costSplit(u.heatingCents, u.heatingConsumption, heat, basis(heat)))}`]
  const water = potOf('water')
  if (water) {
    // Das Warmwasser bleibt bei der Wohnfläche (§ 8 Abs. 1 HeizkostenV) und teilt immer nach Tagen.
    parts.push(`Warmwasser ${u.waterConsumption === null ? 'nicht erfasst' : `${quantity(u.waterConsumption, water.consumptionCentsPerUnit)} ${waterUnitOf(self)}${note(u.waterEstimated, u.waterGroup, over('water'))}`}, ${net(u.waterCents, u.waterCo2Cents, costSplit(u.waterCents, u.waterConsumption, water, basis(water)))}`)
  }
  return `${u.label}, ${time}: ${parts.join('; ')}`
}

// Die Schätzung nach § 9a im Druck (Heizung PR 13, Entwurf 8.8 „Schätzungen mit Methode“): nur die der Wohnung
// des Mieters, und nur, wenn sein Verbrauch daraus kommt; wie bei den Geräten sieht ein Mieter nichts aus
// anderen Wohnungen (Durchsicht von #241, Recht-I1). Die geschätzte Fläche des Hauses nennt `potLines`.
const METHOD_TEXT: Record<SelfEstimateView['method'], string> = {
  previousPeriod: 'dem Verbrauch der Wohnung in einem vergleichbaren Zeitraum',
  comparableUnit: 'dem Verbrauch einer vergleichbaren Wohnung in diesem Zeitraum',
  buildingAverage: 'dem Durchschnitt des Gebäudes je m²',
}
// Durchsicht von #242: R-I1 (Wortlaut des § 9a Abs. 1 Satz 1, Grund aus der Auswahl), R-M5 (Begründung in
// Anführungszeichen), R-I2 (der Anteil des Nachmieters nachrechenbar, ohne Daten des Vormieters), G-M6 (die ganze
// Heizperiode), R-M8 (über der Grenze für die Verteilung nicht maßgeblich).
export function estimateLines(
  self: Pick<SelfHeatingStatement, 'estimates' | 'pots'> & Partial<Pick<SelfHeatingStatement, 'changeSplit'>>,
  unitId: string | undefined,
  u: Pick<SelfUserView, 'heatingEstimated' | 'waterEstimated'> & Partial<Pick<SelfUserView, 'heatingConsumption' | 'waterConsumption'>>,
): string[] {
  return (self.estimates ?? []).filter((e) => !e.stale && e.unitId === unitId && (e.part === 'heat' ? u.heatingEstimated : u.waterEstimated)).map((e) => {
    const unit = e.part === 'heat' ? heatUnitOf(self) : waterUnitOf(self)
    const pot = self.pots.find((p) => p.pot === (e.part === 'heat' ? 'heating' : 'water'))
    const mine = e.part === 'heat' ? u.heatingConsumption : u.waterConsumption
    const what = `${CAUSE_TEXT[e.cause] ?? 'nicht ordnungsgemäß erfasst'}; Begründung: „${e.reason}“`
    const timeWord = e.part === 'heat' && self.changeSplit !== 'time' ? 'der Gradtage' : 'der Tage'
    const share = mine !== null && mine !== undefined && e.value > 0 ? (mine * 1000) / e.value : null
    const shareText = share !== null ? ` Auf Ihren Zeitraum entfallen ${permille(share)} ‰ ${timeWord}, also ${permille(share)} ‰ von ${quantity(e.value)} ${unit} = ${quantity(mine ?? 0, pot?.consumptionCentsPerUnit)} ${unit}.` : ''
    const split = e.kept > 0
      ? ` Für die Zeit vor Ihrem Einzug liegt eine gültige Ablesung vor; sie gilt dort weiter.${shareText}`
      : e.users > 1
        ? ` Er ist auf die Nutzer der Wohnung geteilt wie nach § 9b Abs. 3 HeizkostenV.${shareText}`
        : e.replacesMeasured ? ' Sie gilt auch für Zeiten, für die Ablesungen vorliegen.' : ''
    // #322 (Durchsicht S2): beim Topf Heizung nach umbautem Raum je m³.
    const raum = pot?.basisUnit === 'm³'
    const notUsed = pot?.overThreshold
      ? ` Für die Verteilung ist der Verbrauch nicht maßgeblich: ${raum ? 'Der geschätzte umbaute Raum' : 'Die geschätzte Fläche'} des Hauses überschreitet die Grenze des § 9a Abs. 2 HeizkostenV, verteilt wird nur nach ${raum ? 'umbautem Raum' : 'Fläche'}.`
      : ''
    const method = raum ? METHOD_TEXT[e.method].replace('je m²', 'je m³') : METHOD_TEXT[e.method]
    return `${e.part === 'heat' ? 'Heizung' : 'Warmwasser'}: Der Verbrauch Ihrer Wohnung konnte nicht ordnungsgemäß erfasst werden (${what}) und ist nach § 9a HeizkostenV ermittelt, nach ${method}: ${quantity(e.value)} ${unit} für die ganze Heizperiode der Wohnung.${split}${notUsed}`
  })
}

// Das Ableseergebnis geht an jeden Mieter für seine Wohnung (Durchsicht von #239, I2); gedruckt wird eine
// Wohnung. Einer gesonderten Mitteilung des Warmwasserverbrauchs bedarf es nicht, wenn in der Wohnung ein
// Warmwasserzähler eingebaut ist (§ 6 Abs. 1 Satz 4 HeizkostenV).
export const READING_RESULT_HINT = 'Bei Zählern, die nicht aus der Ferne ablesbar sind, teilen Sie jedem Mieter das Ergebnis der Ablesung seiner Wohnung in der Regel innerhalb eines Monats mit (§ 6 Abs. 1 Satz 2 HeizkostenV). Wählen Sie die Wohnung und drucken Sie ihr Ergebnis. Nicht nötig ist das, wenn das Ergebnis über einen längeren Zeitraum im Gerät in der Wohnung gespeichert ist und der Mieter es selbst abrufen kann, etwa am Stichtagsspeicher eines elektronischen Heizkostenverteilers (§ 6 Abs. 1 Satz 3). Den Warmwasserverbrauch müssen Sie nicht gesondert mitteilen, wenn in der Wohnung ein Warmwasserzähler eingebaut ist (§ 6 Abs. 1 Satz 4).'

// Das Ableseergebnis einer Wohnung zu einer Grenze (§ 6 Abs. 1 Satz 2 HeizkostenV). Einheit und Stand stehen
// wie am Zähler (UI-Durchsicht H5): ein Wärmezähler in MWh mit 88,4 nicht als „88 kWh“. Ohne Einheit am
// Zähler (eingefrorene Stände von vorher) gilt die des Topfes.
const reading = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 })
export function readingResult(unit: SelfUnitView, boundary: string, heatUnit: string = 'kWh'): string[] {
  const unitOf = (r: SelfReadingView) => r.meterUnit?.trim() || (r.pot === 'heating' ? heatUnit : 'm³')
  return unit.readings.filter((r) => r.boundary === boundary).map((r) => (r.date === null || r.value === null
    ? `${r.meterName}: nicht abgelesen`
    : r.oldEndValue !== undefined
      // Durchsicht von #241, Recht-I2: Am Stichtag zeigt das Gerät danach 0; mitgeteilt wird der Stichtagswert.
      ? (r.pot === 'heating' && heatUnit === 'Einheiten' && r.value === 0
        ? `${r.meterName}: Stichtagswert ${reading(r.oldEndValue)} ${unitOf(r)} am ${fmtDate(r.date)} (Gerät danach auf 0)`
        : `${r.meterName}: ${reading(r.oldEndValue)} ${unitOf(r)} am ${fmtDate(r.date)} (Endstand des alten Zählers; der neue beginnt mit ${reading(r.value)})`)
      : `${r.meterName}: ${reading(r.value)} ${unitOf(r)} am ${fmtDate(r.date)}`))
}
