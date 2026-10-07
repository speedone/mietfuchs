// Pflichtangaben und Ausnahmen der Heizkostenabrechnung (Heizung PR 14, #99, Entwurf 8.8, 8.9) als reine
// Funktionen. Keine Uhr, keine Locale, kein Rechtswert: Was das Register sagt, reicht calc.ts herein.
//
// **Angaben je Heizperiode, geerbt über die Linie.** Ausnahme nach § 11, Vereinbarung nach § 2, die
// Bestätigung zur monatlichen Verbrauchsinformation und die Antwort zum Verbrauchervertrag stehen in der Zeile
// einer Heizperiode und gelten für sie und die folgenden der Linie (nach einem Kesseltausch die der neuen
// Anlage), bis eine spätere etwas anderes sagt. In derselben Heizperiode geht die eigene Anlage vor. So ändert
// eine Antwort nie eine frühere Heizperiode, weder eine offene noch eine abgeschlossene (die Fehlerklasse der
// Durchsichten von #239, #241 und #242: ein Wert an der Anlage, der rückwirkend gilt).
//
// **§ 6a Abs. 3** (`heatingInfoOf`): was eine Abrechnung nach Verbrauch zugänglich macht, je Nummer, und was
// fehlt. Nr. 4 ist der Vergleich mit einem normierten oder durch Vergleichstests ermittelten
// Durchschnittsnutzer; die Begründung schließt den Vergleich „mit den Nutzern im selben Gebäude“ aus
// (BR-Drs. 643/21, S. 19 zu Abs. 2 Nr. 3, S. 21 zu Abs. 3 Nr. 4). Mietfuchs hat keine Vergleichsdaten: Der
// Vermieter trägt einen Wert in kWh je m² Wohnfläche mit Quelle ein, umgerechnet wird er auf Wohnfläche und
// Tage des Mieters (Festlegung). Nr. 5: Wärmeverbrauch mal Klimafaktor, das Warmwasser unbereinigt daneben
// (Satz 2, 3); die Faktoren trägt der Vermieter mit Quelle ein. Als Verfahren nach anerkannten Regeln der Technik nennt
// die Begründung „insbesondere die technische Regel VDI 3807“, die Klimafaktoren des Deutschen Wetterdienstes sind
// „auf diese Vereinfachungen zugeschnitten“ (BR-Drs. 643/21, S. 21).
import type {
  AgreedOtherwise, ExemptionScope, HeatingEnergy, HeatingExemption, HeatingInfoStatement, HeatingRules, HotWater, InfoComparison, InfoContact, InfoItem, SelfPot,
} from '../../shared/types.ts'
import { CONSUMER_CONTRACT_NONE } from '../../shared/heatingInfo.ts'
import { lineRoot } from '../../shared/heatingPeriod.ts'
import type { SelfPlan, SelfUnitPlan } from './heating.ts'

// ---------- Angaben je Heizperiode, geerbt über die Linie ----------

export type RuleRow = {
  plantId: string
  period: string
  exemption?: HeatingExemption | null
  exemptionScope?: ExemptionScope | null
  exemptionBillingAgreed?: boolean | null
  agreedOtherwise?: AgreedOtherwise | null
  monthlyInfoElsewhere?: boolean | null
  consumerContract?: string | null
}
type LinePlant = { id: string; replacesPlantId?: string | null }

// Die Angaben, die in der Heizperiode `key` der Anlage `plantId` gelten.
export function heatingRulesOf(rows: readonly RuleRow[], plants: readonly LinePlant[], plantId: string, key: string): HeatingRules {
  const plant = plants.find((p) => p.id === plantId)
  const root = plant ? lineRoot(plant, plants) : plantId
  const inLine = new Set([plantId, ...plants.filter((p) => lineRoot(p, plants) === root).map((p) => p.id)])
  // Jüngste Heizperiode zuerst, in derselben die eigene Anlage zuerst.
  const ordered = rows
    .filter((r) => inLine.has(r.plantId) && r.period <= key)
    .slice()
    .sort((a, b) => (a.period !== b.period ? (a.period < b.period ? 1 : -1) : (a.plantId === plantId ? -1 : b.plantId === plantId ? 1 : 0)))
  const first = <K extends keyof RuleRow>(k: K): RuleRow | undefined => ordered.find((r) => r[k] !== null && r[k] !== undefined)
  const ex = first('exemption')
  const exemption = ex?.exemption ?? 'none'
  const ag = first('agreedOtherwise')
  const mo = first('monthlyInfoElsewhere')
  const cc = first('consumerContract')
  return {
    exemption,
    // Ohne Antwort zum Umfang gilt nur die Wärme als ausgenommen; das Warmwasser hat nach § 11 Abs. 2 eine
    // eigene Prüfung („entsprechend“).
    exemptionScope: exemption === 'none' ? null : (ex?.exemptionScope ?? 'heat'),
    exemptionBillingAgreed: exemption !== 'none' && ex?.exemptionBillingAgreed === true,
    agreedOtherwise: ag?.agreedOtherwise ?? 'none',
    monthlyInfoElsewhere: mo?.monthlyInfoElsewhere === true,
    consumerContract: cc?.consumerContract ?? null,
    fromPeriod: { exemption: ex?.period ?? null, agreedOtherwise: ag?.period ?? null, monthlyInfoElsewhere: mo?.period ?? null, consumerContract: cc?.period ?? null },
  }
}

// Bereitet die Anlage kein Warmwasser, betrifft eine Ausnahme der Wärme die ganze Anlage (wie calc.ts).
export function effectiveRules(r: HeatingRules, hotWater: HotWater): HeatingRules {
  return r.exemptionScope === 'heat' && hotWater === 'none' ? { ...r, exemptionScope: 'both' } : r
}

// ---------- § 6a Abs. 3 und 5 ----------

export type InfoRow = {
  infoTaxesText: string | null
  infoDistrictGhg: number | null
  infoDistrictPef: number | null
  climateFactor: number | null
  climateFactorPrev: number | null
  climateFactorSource: string | null
  infoReferenceKwhPerM2: number | null
  infoReferenceSource: string | null
  // Der Vergleich des Ablesedienstes liegt bei (Durchsicht von #243, R-W1); fehlt in älteren Aufrufen.
  infoComparisonSource?: string | null
}
// Ein Mietverhältnis mit seinen Tagen; für die Frage, ob es im vorhergehenden Zeitraum schon bestand.
export type InfoTenancy = { id: string; start: string; end: string | null }
export type InfoInput = {
  // § 6a Abs. 3 (beruht auf dem Verbrauch) oder Abs. 5.
  byConsumption: boolean
  // Die Energieträger der Anlage (bei einem Kesseltausch der Linie) mit den kWh der Heizperiode, soweit bekannt.
  carriers: readonly { energy: HeatingEnergy; kwh: number | null }[]
  // Die Anlage erzeugt die Wärme mit einem weiteren Erzeuger (`heatGeneration = 'mixed'`); dessen Anteil kennt
  // Mietfuchs nicht.
  mixedGeneration: boolean
  // Fernwärme: `maybe` bei einem Zeitraum vor dem 01.01.2022 (`hkv.info.district-emissions`, Auslegung);
  // `null`, wenn die Anlage keine Fernwärme ist.
  district: { required: 'yes' | 'maybe'; deliveredKwh: number | null } | null
  row: InfoRow | null
  // Der Klimafaktor aus der Zeile der vorigen Heizperiode, falls in dieser kein Vorjahresfaktor steht.
  prevClimateFactor: { factor: number; source: string | null } | null
  consumerContract: string | null
  // Nr. 1 c für das ganze Gebäude; `null`, wenn keine Position den Teil „Erfassung“ trägt (R-W6).
  meteringCents: number | null
  contacts: readonly InfoContact[]
  contactsChecked: string
  // Der Plan der eigenen Abrechnung und der der Vorperiode (null, wenn sie anders erfasst ist); ohne eigene
  // Abrechnung beide null.
  plan: SelfPlan | null
  prev: SelfPlan | null
  prevPeriod: { from: string; to: string } | null
  tenancies: readonly InfoTenancy[]
  units: { heating: string; water: string }
  periodDays: number
  // Die Töpfe unter der Verordnung: ohne `heating`, wenn § 11 nur die Wärme ausnimmt.
  pots: readonly SelfPot[]
  // Je Mietverhältnis sein Anteil an den Kosten der Fernwärme (0 bis 1), für seinen Teil der Emissionen.
  costShares?: ReadonlyMap<string, number>
}

const filled = (t: string | null | undefined): t is string => typeof t === 'string' && t.trim() !== ''

// Beruht die eigene Abrechnung auf dem Verbrauch? Ja, sobald ein Topf nach Verbrauch verteilt wird; ein Topf
// nur nach Fläche (nichts erfasst, oder § 9a Abs. 2) zählt nicht.
export function planByConsumption(plan: SelfPlan | null, pots: readonly SelfPot[] = ['heating', 'water']): boolean {
  return plan !== null && plan.pots.some((p) => pots.includes(p) && plan.totals[p].measured && !plan.totals[p].overThreshold)
}

// Was ein Mietverhältnis in einem Topf verbraucht hat, über alle seine Zeiten in der Heizperiode.
function sumFor(plan: SelfPlan | null, tenancyId: string, p: SelfPot): { value: number | null; days: number; estimated: boolean } {
  if (!plan || !plan.pots.includes(p)) return { value: null, days: 0, estimated: false }
  let value: number | null = null
  let days = 0
  let estimated = false
  let unknown = false
  for (const u of plan.units) {
    for (const x of u.users) {
      if (x.tenancyId !== tenancyId) continue
      days += x.days
      const v = x.pots[p].value
      if (v === null) unknown = true
      else value = (value ?? 0) + v
      if (x.pots[p].estimated === true) estimated = true
    }
  }
  return { value: unknown ? null : value, days, estimated }
}

const unitOf = (plan: SelfPlan, tenancyId: string): SelfUnitPlan | undefined => plan.units.find((u) => u.users.some((x) => x.tenancyId === tenancyId))

export function heatingInfoOf(i: InfoInput): HeatingInfoStatement {
  const missing: InfoItem[] = []
  const uncertain: InfoItem[] = []
  const row = i.row
  const contract = i.consumerContract
  const dispute: HeatingInfoStatement['dispute'] = contract === null || !filled(contract)
    ? { kind: 'unknown' }
    : contract === CONSUMER_CONTRACT_NONE ? { kind: 'none' } : { kind: 'text', text: contract.trim() }
  if (dispute.kind === 'unknown') uncertain.push('3')
  const comparisonSource = row && filled(row.infoComparisonSource) ? row.infoComparisonSource.trim() : null
  const heatExempt = !i.pots.includes('heating')
  const base = {
    contacts: [...i.contacts],
    contactsChecked: i.contactsChecked,
    dispute,
    units: i.units,
    heatExempt,
  }
  if (!i.byConsumption) {
    return {
      ...base, scope: 'minimal', carriers: [], district: null, taxesText: null, meteringCents: null, comparisonSource: null, reference: null, referenceComparable: false,
      climate: { factor: null, factorPrev: null, source: null }, users: [], missing, missingCommon: [], uncertain, comparisons: false, mixedGeneration: false,
    }
  }
  // Nr. 1 a: der Anteil der eingesetzten Energieträger. Ein Energieträger: 100 %. Mehrere (Kesseltausch): nach
  // den kWh, wenn alle bekannt sind. Mit einem weiteren Erzeuger ist der Anteil unbekannt.
  const energies = [...new Set(i.carriers.map((c) => c.energy))]
  const kwhOf = (e: HeatingEnergy): number | null => {
    const own = i.carriers.filter((c) => c.energy === e)
    return own.every((c) => c.kwh !== null) ? own.reduce((a, c) => a + (c.kwh ?? 0), 0) : null
  }
  const total = energies.reduce<number | null>((a, e) => (a === null || kwhOf(e) === null ? null : a + (kwhOf(e) ?? 0)), 0)
  const carriers = energies.map((energy) => ({
    energy,
    percent: i.mixedGeneration ? null : energies.length === 1 ? 100 : total !== null && total > 0 ? ((kwhOf(energy) ?? 0) * 100) / total : null,
  }))
  if (carriers.length === 0 || carriers.some((c) => c.percent === null)) missing.push('1a')
  // Bei Fernwärme die „jährlichen Treibhausgasemissionen“ als Menge: Faktor laut Versorger (g CO₂-Äquivalent je
  // kWh) mal gelieferte kWh; dazu der Primärenergiefaktor.
  const ghg = row?.infoDistrictGhg ?? null
  const annualKg = i.district && ghg !== null && i.district.deliveredKwh !== null ? (ghg * i.district.deliveredKwh) / 1000 : null
  const district = i.district ? { ghg, pef: row?.infoDistrictPef ?? null, annualKg } : null
  if (i.district && district && (district.ghg === null || district.pef === null || district.annualKg === null) && !missing.includes('1a')) {
    (i.district.required === 'yes' ? missing : uncertain).push('1a')
  }
  // Nr. 1 b: Steuern, Abgaben und Zölle laut Rechnung.
  const taxesText = row && filled(row.infoTaxesText) ? row.infoTaxesText.trim() : null
  if (taxesText === null) missing.push('1b')
  // Nr. 1 c: Trägt keine Position den Teil „Erfassung“, kennt Mietfuchs die Entgelte nicht; ob welche anfielen,
  // weiß nur der Vermieter (Durchsicht von #243, R-W6). Gedruckt wird dann keine Zahl.
  if (i.meteringCents === null) uncertain.push('1c')
  // Nr. 4: nur mit Quelle ist ein Wert ein Vergleichswert.
  const refValue = row?.infoReferenceKwhPerM2 ?? null
  const reference = refValue !== null && refValue > 0 && row && filled(row.infoReferenceSource) ? { kwhPerM2: refValue, source: row.infoReferenceSource.trim() } : null
  const factor = row?.climateFactor ?? null
  const ownPrev = row?.climateFactorPrev ?? null
  const factorPrev = ownPrev ?? i.prevClimateFactor?.factor ?? null
  const source = filled(row?.climateFactorSource) ? (row?.climateFactorSource ?? '').trim() : (ownPrev === null ? i.prevClimateFactor?.source ?? null : null)
  const climate = { factor, factorPrev, source }
  // Nr. 4 und 5 rechnet Mietfuchs nur aus dem Plan der eigenen Abrechnung. Ohne ihn (freie Schlüssel) kann es nicht
  // wissen, ob der Vergleich des Ablesedienstes beiliegt: Mit Bestätigung samt Quelle gilt er als zugänglich
  // gemacht, ohne ist er offen (Durchsicht von #243, R-W1; § 6a Abs. 3 verlangt nur, die Informationen mit der
  // Abrechnung zugänglich zu machen).
  const plan = i.plan
  const common = [...missing]
  const out = { ...base, scope: 'full' as const, carriers, district, taxesText, meteringCents: i.meteringCents, comparisonSource, reference, climate, mixedGeneration: i.mixedGeneration }
  if (!plan) {
    if (comparisonSource === null) uncertain.push('4', '5')
    return { ...out, referenceComparable: false, users: [], missing, missingCommon: common, uncertain, comparisons: false }
  }
  const inPots = (p: SelfPot): boolean => i.pots.includes(p) && plan.pots.includes(p)
  // Verglichen wird der Wärmeverbrauch in kWh (Festlegung). Misst der Topf in Einheiten (Heizkostenverteiler)
  // oder ist die Wärme nach § 11 ausgenommen, kann Mietfuchs nicht vergleichen.
  const referenceComparable = inPots('heating') && i.units.heating === 'kWh'
  // Nr. 4 für alle: ohne Vergleichswert mit Quelle, und wo Mietfuchs nicht vergleichen kann, ohne beigelegten
  // Vergleich (dann offen, R-W1). Ein selbst errechneter Hausdurchschnitt ersetzt ihn nicht.
  const ref4: 'ok' | 'missing' | 'open' = comparisonSource !== null ? 'ok' : !referenceComparable ? 'open' : reference === null ? 'missing' : 'ok'
  // Nr. 5 für alle mit Vorjahr: ohne Klimafaktoren (bereinigt wird nur die Wärme, Satz 3). Den rechnet Mietfuchs
  // aus dem Plan; die Bestätigung des beigelegten Vergleichs gilt hier nur für Nr. 4.
  const noFactors = inPots('heating') && (factor === null || factorPrev === null)
  const tenancyIds = [...new Set(plan.units.flatMap((u) => u.users.flatMap((x) => (x.role === 'tenancy' && x.tenancyId ? [x.tenancyId] : []))))]
  const users: InfoComparison[] = tenancyIds.map((id) => {
    const unit = unitOf(plan, id)
    const label = unit?.users.find((x) => x.tenancyId === id)?.label ?? id
    const now = { heating: sumFor(plan, id, 'heating'), water: sumFor(plan, id, 'water') }
    const before = { heating: sumFor(i.prev, id, 'heating'), water: sumFor(i.prev, id, 'water') }
    // Wohnte der Mieter im vorhergehenden Zeitraum schon dort? Sonst ist es sein erstes Jahr; wohnte er dort,
    // fehlt aber ein vergleichbarer Wert, kennt Mietfuchs den Verbrauch nur nicht.
    const t = i.tenancies.find((x) => x.id === id)
    const resident = i.prevPeriod !== null && t !== undefined && t.start <= i.prevPeriod.to && (t.end === null || t.end >= i.prevPeriod.from)
    const lead: SelfPot = inPots('heating') ? 'heating' : 'water'
    const firstPeriod = !resident
    const prevUnknown = resident && (['heating', 'water'] as const).some((p) => inPots(p) && before[p].value === null)
    const adjusted = factor !== null && factorPrev !== null && !firstPeriod && !prevUnknown
    const dwelling = unit ? unit.unit.areaM2 || 0 : 0
    const referenceKwh = referenceComparable && reference && dwelling > 0 && i.periodDays > 0
      ? (reference.kwhPerM2 * dwelling * now.heating.days) / i.periodDays
      : null
    const share = i.costShares?.get(id)
    const prevDays = firstPeriod || prevUnknown ? null : before[lead].days
    // § 9a: Ist sein Verbrauch in einem Topf unter der Verordnung geschätzt, gehören die Vergleiche nach Abs. 3
    // nicht dazu (BR-Drs. 643/21, S. 19 und 22; je Mieter ist Auslegung von Mietfuchs).
    const estimated = (['heating', 'water'] as const).some((p) => inPots(p) && now[p].estimated)
    const own: InfoItem[] = [...common]
    if (!estimated) {
      if (ref4 === 'missing' || (ref4 === 'ok' && comparisonSource === null && referenceKwh === null)) own.push('4')
      if (!firstPeriod && (prevUnknown || noFactors)) own.push('5')
    }
    return {
      tenancyId: id,
      label,
      days: now[lead].days,
      prevDays,
      heating: !inPots('heating') ? null : {
        now: now.heating.value,
        estimated: now.heating.estimated,
        referenceKwh,
        prev: firstPeriod || prevUnknown ? null : before.heating.value,
        nowAdjusted: adjusted && now.heating.value !== null ? now.heating.value * factor : null,
        prevAdjusted: adjusted && before.heating.value !== null ? before.heating.value * factorPrev : null,
      },
      water: !inPots('water') ? null : { now: now.water.value, prev: firstPeriod || prevUnknown ? null : before.water.value },
      firstPeriod,
      prevUnknown,
      estimated,
      missing: own,
      ghgKg: annualKg !== null && share !== undefined ? annualKg * share : null,
    }
  })
  for (const u of users) for (const x of u.missing) if (!missing.includes(x)) missing.push(x)
  const asked = users.filter((u) => !u.estimated)
  if (ref4 === 'open' && asked.length > 0) uncertain.push('4')
  // Für einen Mieter im ersten Jahr nennt der Hinweis „bis zu“ (Auslegung, Entwurf 15.1 Nr. 14).
  if (asked.some((u) => u.firstPeriod)) uncertain.push('5')
  return { ...out, referenceComparable, users, missing, missingCommon: common, uncertain, comparisons: true }
}
