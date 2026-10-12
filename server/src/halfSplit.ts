// Hälftige Teilung nach §§ 5a, 5b, 5d CO2KostAufG (Heizung PR 18, #215; Entwurf 3.9, 3.13, 4.3, 15.1 Nr. 13,
// Nr. 20, Nr. 24, Nr. 26). Reine Funktionen. Rechtswerte reicht der Aufrufer aus dem Register herein (`law()`
// protokolliert sie); hier steht kein Datum und keine Rechtszahl (law-literals.test.ts).
import type { DayRange } from '../../shared/degreeDays.ts'
import type { HalfSplitValue } from '../../shared/law/co2kostaufg.ts'
import { dayAfter, dayBefore, eventPeriodEnd, shiftMonths } from '../../shared/law/register.ts'

export type HalfSplitFacts = {
  gmodg43InstalledOn: string | null
  emergencyInstall: boolean | null
  emergencyPriorDuty: boolean | null
  newBuildingFirstUse: string | null
  buildingApplicationBefore20260513: boolean | null
}
// Die Werte aus `co2.half-split.new-buildings` und `co2.half-split.emergency`; `null`, wenn der Aufrufer sie
// nicht braucht (kein Neubau, kein Notfalleinbau) und sie deshalb nicht abgefragt hat.
export type HalfSplitRules = {
  newBuildings: { firstUseUntil: string; applicationFrom: string } | null
  emergency: { windowMonths: number; before: string; installedFrom: string; installedTo: string; laterFrom: string } | null
}
export type HalfSplitExclusion = { from: string; to: string; rule: 'emergency1' | 'emergency2' | 'emergency3' }
// `assumed`: Eine Angabe fehlt, und Mietfuchs teilt trotzdem hälftig (Abweichungen 3, 4 des Plans): der
// Bauantrag beim Neubau, die vorherige Pflicht beim Notfalleinbau ab 2028. Der Hinweis fragt danach.
// `emergencyBoundary`: Notfalleinbau genau zwölf Monate vor dem ersten Tag der Teilung; nach dem Wortlaut nicht
// „weniger als zwölf Monate“, also keine Ruhezeit, und der Hinweis nennt das als Auslegung (Prüfung S14).
export type HalfSplitStatus =
  | { kind: 'none' }
  | { kind: 'excluded'; reason: 'applicationBefore' }
  | { kind: 'applies'; basis: 'existing' | 'newBuilding'; from: string; excluded: HalfSplitExclusion[]; assumed: ('application' | 'priorDuty')[]; emergencyBoundary?: true }

// Ob und ab wann § 5a für eine Anlage greift (§ 5a Abs. 1, 4; § 5b). Die Grenze des ersten Tags (01.01.2028)
// steht nicht hier, sondern in den Fassungen von `co2.half-split`; hier nur, was an der Anlage hängt.
export function halfSplitStatus(f: HalfSplitFacts, rules: HalfSplitRules): HalfSplitStatus {
  const installed = f.gmodg43InstalledOn
  if (installed === null) return { kind: 'none' }
  const assumed: ('application' | 'priorDuty')[] = []
  let basis: 'existing' | 'newBuilding' = 'existing'
  if (f.newBuildingFirstUse !== null) {
    basis = 'newBuilding'
    // § 5b Satz 2: kein § 5a bei Bauantrag, Antrag auf Zustimmung oder Bauanzeige vor dem Stichtag.
    if (f.buildingApplicationBefore20260513 === true) return { kind: 'excluded', reason: 'applicationBefore' }
    if (f.buildingApplicationBefore20260513 === null) assumed.push('application')
  }
  const excluded: HalfSplitExclusion[] = []
  let boundary = false
  const e = rules.emergency
  if (f.emergencyInstall === true && e !== null) {
    const twelveBefore = shiftMonths(e.before, -e.windowMonths)
    if (installed > twelveBefore && installed < e.before) {
      // Satz 1: weniger als zwölf Monate vor dem ersten Tag eingebaut.
      excluded.push({ from: installed, to: eventPeriodEnd(installed, e.windowMonths), rule: 'emergency1' })
    } else if (installed >= e.installedFrom && installed <= e.installedTo) {
      // Satz 2: Einbau im Zeitraum aus § 43 Abs. 7 Satz 1 GModG; keine Teilung während der Übergangszeit
      // dieser Vorschrift, also zwölf Monate ab dem Einbau, wenn beim Ausfall keine Pflicht bestand
      // (BT-Drs. 21/7009, S. 154; Abweichung 6 des Plans).
      if (f.emergencyPriorDuty === false) excluded.push({ from: installed, to: eventPeriodEnd(installed, e.windowMonths), rule: 'emergency2' })
      else if (f.emergencyPriorDuty === null) assumed.push('priorDuty')
    } else if (installed >= e.laterFrom) {
      // Satz 3: im Fall des § 43 Abs. 7 Satz 2 GModG zwölf Monate ab dem Einbau, unter derselben Bedingung.
      if (f.emergencyPriorDuty === false) excluded.push({ from: installed, to: eventPeriodEnd(installed, e.windowMonths), rule: 'emergency3' })
      else if (f.emergencyPriorDuty === null) assumed.push('priorDuty')
    } else if (installed === twelveBefore) {
      boundary = true
    }
  }
  return { kind: 'applies', basis, from: installed, excluded, assumed, ...(boundary ? { emergencyBoundary: true as const } : {}) }
}

export function intersect(a: DayRange, b: DayRange): DayRange | null {
  const from = a.from > b.from ? a.from : b.from
  const to = a.to < b.to ? a.to : b.to
  return from <= to ? { from, to } : null
}

// Die Tage eines Bereichs, an denen die Anlage für § 5a in Frage kommt: ab dem Einbau, ohne die Zeiten nach
// § 5a Abs. 4. Ob eine Fassung von `co2.half-split` dort teilt, entscheiden die Teile (`Piece`).
export function applicableRanges(s: HalfSplitStatus, span: DayRange): DayRange[] {
  if (s.kind !== 'applies') return []
  const start = intersect(span, { from: s.from, to: span.to })
  if (!start) return []
  let out: DayRange[] = [start]
  for (const x of [...s.excluded].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) {
    out = out.flatMap((r) => {
      const cut = intersect(r, x)
      if (!cut) return [r]
      const parts: DayRange[] = []
      if (r.from < cut.from) parts.push({ from: r.from, to: dayBefore(cut.from) })
      if (cut.to < r.to) parts.push({ from: dayAfter(cut.to), to: r.to })
      return parts
    })
  }
  return out
}

// Ob das Gebäude in der Heizperiode in einem Gebiet liegt, das eine Verordnung nach § 556d Abs. 2 Satz 1,
// § 558 Abs. 3 Satz 3 oder § 577a Abs. 2 Satz 2 BGB bestimmt (Abweichung 4): bei „ja“, wenn die Verordnung an
// einem Tag von H gilt (Festlegung zulasten des Vermieters); `null` heißt unbekannt.
export function tightMarketIn(p: { tightMarket?: boolean | null; tightMarketFrom?: string | null; tightMarketTo?: string | null } | null | undefined, h: DayRange): boolean | null {
  const answer = p?.tightMarket ?? null
  if (answer !== true) return answer
  return (p?.tightMarketFrom ?? h.from) <= h.to && (p?.tightMarketTo ?? h.to) >= h.from
}

// Ein Mietverhältnis für § 5d Abs. 4: `contractFrom` ist der Tag des Vertrags (sonst der Mietbeginn),
// `noticeOn` der Tag der Mitteilung in Textform.
export type NoticeFacts = { tenantName: string; contractFrom: string; noticeOn: string | null }

// Ob eine Mitteilung für die Heizperiode ab `hFrom` zählt (Abweichung 3). Vor Beginn des Zeitraums immer
// (Satz 4; dass eine nach Vertragsschluss, aber vor Beginn der Heizperiode zugegangene Mitteilung zählt, ist
// eine Auslegung, Prüfung S12). Traten die Voraussetzungen erst nach Vertragsschluss ein (`contractFrom <
// conditionsFrom`), ist die Information „bei der ersten Geltendmachung“ geschuldet (Satz 2), und diese
// erfolgt „regelmäßig im Rahmen der Betriebskostenabrechnung“ (BT-Drs. 21/7009, S. 156): dann bis zum Ende
// der Abrechnungsfrist.
export function noticeCounts(n: NoticeFacts, conditionsFrom: string, hFrom: string, deadline: string): 'before' | 'withSettlement' | null {
  if (n.noticeOn === null) return null
  if (n.noticeOn < hFrom) return 'before'
  if (n.contractFrom < conditionsFrom && n.noticeOn <= deadline) return 'withSettlement'
  return null
}

export type TwoFamilyFacts = {
  dwellings: number
  selfUsed: boolean
  central: boolean
  servesAll: boolean
  tightMarket: boolean | null
  // Die Mietverhältnisse mit Tagen in der Heizperiode.
  tenancies: readonly NoticeFacts[]
  // Ab wann die Voraussetzungen der Ausnahme vorlagen; das Ende der Abrechnungsfrist der Heizperiode.
  conditionsFrom: string
  deadline: string
}
export type TwoFamily =
  | { kind: 'notApplicable' }
  | { kind: 'excepted'; notices: { tenantName: string; noticeOn: string; withSettlement: boolean }[] }
  | { kind: 'split'; reason: 'tightMarket' | 'tightMarketUnknown' | 'notice'; missing: string[]; late: { tenantName: string; noticeOn: string }[] }

// § 5d Abs. 3, 4 (Abweichungen 3, 4, 15): Ausnahme nur bei höchstens zwei Wohnungen, einer davon selbst
// bewohnt, beide an einer zentralen Anlage („gemeinsame Wärmeversorgung“, Begründung: „durch dieselbe
// Heizungsanlage“, BT-Drs. 21/7009, S. 156); nicht im angespannten Markt; nur mit einer zählenden Mitteilung
// an jeden Mieter der Heizperiode. Fehlt eine Voraussetzung oder ist sie unbekannt, wird hälftig geteilt, und
// der Grund steht da.
export function twoFamilyOf(f: TwoFamilyFacts, maxDwellings: number, hFrom: string): TwoFamily {
  if (f.dwellings > maxDwellings || !f.selfUsed || !f.central || !f.servesAll) return { kind: 'notApplicable' }
  if (f.tightMarket === true) return { kind: 'split', reason: 'tightMarket', missing: [], late: [] }
  if (f.tightMarket === null) return { kind: 'split', reason: 'tightMarketUnknown', missing: [], late: [] }
  const notices: { tenantName: string; noticeOn: string; withSettlement: boolean }[] = []
  const missing: string[] = []
  const late: { tenantName: string; noticeOn: string }[] = []
  for (const n of f.tenancies) {
    const counted = noticeCounts(n, f.conditionsFrom, hFrom, f.deadline)
    if (n.noticeOn === null) missing.push(n.tenantName)
    else if (counted === null) late.push({ tenantName: n.tenantName, noticeOn: n.noticeOn })
    else notices.push({ tenantName: n.tenantName, noticeOn: n.noticeOn, withSettlement: counted === 'withSettlement' })
  }
  if (missing.length > 0 || late.length > 0) return { kind: 'split', reason: 'notice', missing, late }
  return { kind: 'excepted', notices }
}

export type Piece = { from: string; to: string; value: HalfSplitValue }
// Ein Anteil des Zeitraums, in dem der Vermieter `permille` trägt, mit seinem Gewicht am Ganzen.
export type HalfSplitTerm = { permille: number; weight: number }

// Die Teile, in denen eine Kostenart hälftig geteilt wird, gewichtet nach `weigh` (Gradtage der Heizperiode):
// für die CO₂-Kosten ohne Lieferungen (Messdienst, Vorrat; Abweichung 2).
export function termsFromPieces(pieces: readonly Piece[], applicable: readonly DayRange[], weigh: (r: DayRange) => number, pick: (v: HalfSplitValue) => number | null): HalfSplitTerm[] {
  const first = pieces[0]
  const last = pieces.at(-1)
  if (!first || !last) return []
  const total = weigh({ from: first.from, to: last.to })
  if (total <= 0) return []
  const terms: HalfSplitTerm[] = []
  for (const p of pieces) {
    const permille = pick(p.value)
    if (permille === null) continue
    for (const a of applicable) {
      const r = intersect(p, a)
      const w = r ? weigh(r) / total : 0
      if (w > 0) terms.push({ permille, weight: w })
    }
  }
  return terms
}

export type HalfDelivery = { id: string; label: string; base: DayRange | null; portion: number; co2Cents: number | null; gridFeeCents: number | null; bioCostCents: number | null }

// Der Teil einer Lieferung, der im Bereich `base` auf Tage mit hälftiger Teilung fällt, je Fassung (§ 5a
// Abs. 1 „angefallen“, umgerechnet wie Facette 2; Abweichung 2). `share(id, r)` ist der Anteil des
// verbrauchsabhängigen Teils der Lieferung an `r` nach den Stufen 1–5.
function halfFractions(d: HalfDelivery, piecesOf: (r: DayRange) => readonly Piece[], applicable: readonly DayRange[], share: (id: string, r: DayRange) => number, pick: (v: HalfSplitValue) => number | null): HalfSplitTerm[] {
  if (!d.base) return []
  const whole = share(d.id, d.base)
  if (whole <= 0) return []
  const out: HalfSplitTerm[] = []
  for (const p of piecesOf(d.base)) {
    const permille = pick(p.value)
    if (permille === null) continue
    for (const a of applicable) {
      const r = intersect(p, a)
      const w = r ? share(d.id, r) / whole : 0
      if (w > 0) out.push({ permille, weight: w })
    }
  }
  return out
}

// CO₂ nach Lieferungen: jede Lieferung mit ihren CO₂-Kosten im Zeitraum (C · Anteil) gewogen.
export function termsFromDeliveries(list: readonly HalfDelivery[], piecesOf: (r: DayRange) => readonly Piece[], applicable: readonly DayRange[], share: (id: string, r: DayRange) => number, pick: (v: HalfSplitValue) => number | null): HalfSplitTerm[] {
  const total = list.reduce((a, d) => a + (d.co2Cents ?? 0) * d.portion, 0)
  if (total <= 0) return []
  return list.flatMap((d) => halfFractions(d, piecesOf, applicable, share, pick).map((t) => ({ permille: t.permille, weight: (t.weight * (d.co2Cents ?? 0) * d.portion) / total })))
}

export const termsWeight = (terms: readonly HalfSplitTerm[]): number => terms.reduce((a, t) => a + t.weight, 0)

// Der Anteil des Vermieters an den CO₂-Kosten: außerhalb der Teile `base` (Stufe, § 8, § 9), in den Teilen
// ihr Anteil (§ 5a Abs. 3 Nr. 2). `base === null` heißt nur „Einstufung fehlt“ (etwa ohne Fläche); dann gibt
// es einen Anteil nur, wenn der ganze Zeitraum geteilt wird. § 9 Abs. 2 („keine Aufteilung“) reicht der
// Aufrufer als 0 herein, nicht als null, sonst entfiele auch der Teil nach § 5a (Abweichung 5).
export function blendedPermille(base: number | null, terms: readonly HalfSplitTerm[]): number | null {
  const w = termsWeight(terms)
  const half = terms.reduce((a, t) => a + t.weight * t.permille, 0)
  if (base === null) return w >= 1 - 1e-9 ? half : null
  return base * (1 - w) + half
}

export type HalfAmounts = { gridFeeRaw: number; bioRaw: number; missingGrid: string[]; missingBio: string[] }

// Netzentgelte und Biobrennstoff des Vermieters (§ 5a Abs. 1, 3, § 7 Abs. 5), exakt, gerundet wird bei der
// Verteilung. `portion`: der Teil der Lieferung, der in diese Heizperiode gehört (bei freien Schlüsseln der
// abgegrenzte Anteil, beim Messdienst die ganze angesetzte Rechnung). Fehlt ein Betrag an einer Lieferung mit
// Tagen in der Teilung, steht ihr Name in `missing…` (Abweichung 9).
export function halfAmounts(list: readonly HalfDelivery[], piecesOf: (r: DayRange) => readonly Piece[], applicable: readonly DayRange[], share: (id: string, r: DayRange) => number, gas: boolean): HalfAmounts {
  const out: HalfAmounts = { gridFeeRaw: 0, bioRaw: 0, missingGrid: [], missingBio: [] }
  for (const d of list) {
    if (gas) {
      const t = halfFractions(d, piecesOf, applicable, share, (v) => v.gridFeePermille)
      if (t.length > 0) {
        if (d.gridFeeCents === null) out.missingGrid.push(d.label)
        else out.gridFeeRaw += t.reduce((a, x) => a + (d.gridFeeCents ?? 0) * d.portion * x.weight * (x.permille / 1000), 0)
      }
    }
    const b = halfFractions(d, piecesOf, applicable, share, (v) => v.bioPermille)
    if (b.length > 0) {
      if (d.bioCostCents === null) out.missingBio.push(d.label)
      else out.bioRaw += b.reduce((a, x) => a + (d.bioCostCents ?? 0) * d.portion * x.weight * (x.permille / 1000), 0)
    }
  }
  return out
}
