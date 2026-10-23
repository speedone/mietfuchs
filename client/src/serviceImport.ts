// Eine ausgelesene Messdienstabrechnung übernehmen (Heizung PR 20, #103), ohne DOM. Die KI schlägt vor, der
// Vermieter prüft: Diese Datei ordnet Nutzerzeilen Mietverhältnissen zu (nur bei genau einem Treffer),
// prüft die gelesenen Zahlen gegeneinander und baut die Rümpfe für die bestehenden Routen. Gespeichert wird
// erst, wenn der Vermieter es auslöst (ServiceImportReview.tsx).
import { fmtEuro, parseEuro } from './api'
import { CO2_ANSWER_OPTIONS, type Co2Answer, type Co2Form } from './co2Form'
import { unconfirmedConsequence } from './heatingForm'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import { formatDayRange, spansTwoYears } from '../../shared/period.ts'
import { selfUsedWithin } from '../../shared/unitUsage.ts'
import type { DhwMethod, ServiceBlock, ServiceStatementExtraction, ServiceUserLine, Tenancy, Unit } from './types'

// `heating`: die Heizperiode der Anlage, in der die Heizposition steht; `object`: der Abrechnungszeitraum
// des Objekts für die kalten Blöcke. `existingAmountItems`: Positionen mit Einzelbeträgen, die in dieser
// Heizperiode schon an der Anlage hängen.
export type ImportContext = {
  propertyId: string
  plantId: string
  heating: { key: string; from: string; to: string }
  object: { key: string; from: string; to: string }
  tenancies: readonly Pick<Tenancy, 'id' | 'unitId' | 'tenantName' | 'start' | 'end'>[]
  units: readonly Pick<Unit, 'id' | 'name' | 'participates' | 'selfUsed' | 'usageChanges'>[]
  existingAmountItems: number
  // Kostenarten, für die im Abrechnungszeitraum des Objekts schon eine Position mit Einzelbeträgen steht
  // (Durchsicht S4): Wird dieselbe Abrechnung erneut ausgelesen, stünden kalte Blöcke sonst doppelt da, und
  // `cost.possible-duplicate` schwiege, weil beide Positionen einen Beleg tragen.
  existingAmountCategories?: readonly string[]
}

// Je Block: übernehmen, Kostenart, Betrag der Position, das Ziel je Nutzerzeile (`''` offen, `'vacancy'`,
// `'tenancy:<id>'`, `'self:<unitId>'`) und das Jahr der Zahlung, falls der Zeitraum über zwei Jahre reicht.
export type BlockDraft = { include: boolean; category: string; amount: string; targets: string[]; taxYear: string }

export const DHW_LABELS: Record<DhwMethod, string> = {
  heatMeter: 'mit einem Wärmezähler gemessen',
  volumeFormula: 'aus dem Warmwasservolumen errechnet (§ 9 Abs. 2 Satz 2 HeizkostenV)',
  areaFormula: 'aus der Wohnfläche errechnet (§ 9 Abs. 2 Satz 4 HeizkostenV)',
}

// Bei einer Formel die Voraussetzung und die Folge (Prüfung K3); bestätigt wird auf der Karte „Warmwasser“.
export function dhwNote(method: DhwMethod): string | null {
  if (method === 'heatMeter') return null
  return `Eine Formel ist nur zulässig, wenn sich die Wärmemenge für das Warmwasser nicht oder nur mit unzumutbar hohem Aufwand messen lässt. Trifft das zu, bestätigen Sie es auf der Karte „Warmwasser“. ${unconfirmedConsequence()}`
}

// Wörter eines Namens, ohne Groß- und Kleinschreibung, Akzente und Satzzeichen; erst ab drei Buchstaben, damit
// „EG“ oder „Fr.“ nicht zwei Namen verbinden.
const words = (s: string): string[] =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3)
const contains = (haystack: string, needle: string): boolean => {
  const hay = new Set(words(haystack))
  const need = words(needle)
  return need.length > 0 && need.every((w) => hay.has(w))
}
const overlaps = (a: { from: string; to: string | null }, b: { from: string; to: string }): boolean =>
  a.from <= b.to && (a.to === null || a.to >= b.from)

const VACANCY = /\b(leerstand|leer|unvermietet)\b/
const OWNER = /\b(eigentumer|eigentumerin|eigennutzung|vermieter|vermieterin|selbstnutzung)\b/

// Das Ziel einer Nutzerzeile, nur bei genau einem Treffer (Review Focus 3): Leerstand und Eigentümer an ihren
// Wörtern, ein Mieter an seinem Namen unter den Mietverhältnissen, die den Nutzungszeitraum der Zeile (sonst
// die Heizperiode) berühren; bei mehreren entscheidet die Lage. Sonst bleibt die Zeile offen.
export function matchLine(line: ServiceUserLine, ctx: ImportContext): string {
  const plain = words(line.label).join(' ')
  if (line.vacancy || VACANCY.test(plain)) return 'vacancy'
  if (OWNER.test(plain)) {
    // In der Heizperiode selbstgenutzt (#259), nicht nach der Angabe von Anfang an.
    const own = ctx.units.filter((u) => selfUsedWithin(u, ctx.heating.from, ctx.heating.to))
    const byLabel = line.unitLabel ? own.filter((u) => contains(line.unitLabel ?? '', u.name)) : []
    const pick = byLabel.length === 1 ? byLabel : own
    return pick.length === 1 && pick[0] ? `self:${pick[0].id}` : ''
  }
  const span = { from: line.from ?? ctx.heating.from, to: line.to ?? ctx.heating.to }
  const live = ctx.tenancies.filter((t) => overlaps({ from: t.start, to: t.end }, span))
  let hits = live.filter((t) => contains(line.label, t.tenantName))
  if (hits.length > 1 && line.unitLabel) {
    const unitIds = new Set(ctx.units.filter((u) => contains(line.unitLabel ?? '', u.name)).map((u) => u.id))
    hits = hits.filter((t) => unitIds.has(t.unitId))
  }
  return hits.length === 1 && hits[0] ? `tenancy:${hits[0].id}` : ''
}

export function targetOptions(ctx: ImportContext): { value: string; label: string }[] {
  const unitName = (id: string) => ctx.units.find((u) => u.id === id)?.name ?? id
  return [
    { value: '', label: 'Bitte zuordnen …' },
    { value: 'vacancy', label: 'Leerstand oder nicht vermietet (bleibt beim Vermieter)' },
    ...ctx.tenancies
      .filter((t) => overlaps({ from: t.start, to: t.end }, ctx.heating))
      .map((t) => ({ value: `tenancy:${t.id}`, label: `${t.tenantName} (${unitName(t.unitId)})` })),
    ...ctx.units.filter((u) => selfUsedWithin(u, ctx.heating.from, ctx.heating.to)).map((u) => ({ value: `self:${u.id}`, label: `Eigene Wohnung ${u.name}` })),
  ]
}

const isHeating = (category: string): boolean => category === HEATING_CATEGORY
const cents = (eur: number): number => Math.round(eur * 100)
const linesCents = (b: ServiceBlock): number => b.lines.reduce((a, l) => a + cents(l.amountEur ?? 0), 0)
const blockCents = (b: ServiceBlock): number => (b.totalEur !== undefined ? cents(b.totalEur) : linesCents(b))
const euroText = (c: number): string => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const decimalText = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 4, useGrouping: false })
const blockName = (b: ServiceBlock): string => b.title || b.category || 'Kostenblock'

// Kalte Blöcke gehören in den Abrechnungszeitraum des Objekts. Weicht die Heizperiode davon ab, übernimmt die
// Karte sie nicht (Plan PR 20, Abweichung 3): Mietfuchs ordnet kalte Kosten dem Zeitraum zu, in dem sie
// entstanden sind (Festlegung, Entwurf 3.4), und Einzelbeträge je Mieter lassen sich nicht nach Tagen teilen.
export function blockBlocked(block: ServiceBlock, ctx: ImportContext): string | null {
  if (isHeating(block.category)) return null
  if (block.category === '') return 'Bitte wählen Sie die Kostenart des Blocks.'
  if (ctx.heating.from === ctx.object.from && ctx.heating.to === ctx.object.to) return null
  return `Der Block gilt für ${formatDayRange(ctx.heating.from, ctx.heating.to)}, Ihr Abrechnungszeitraum für ${formatDayRange(ctx.object.from, ctx.object.to)}. ` +
    'Mietfuchs ordnet kalte Kosten dem Zeitraum zu, in dem sie entstanden sind, und kann Einzelbeträge je Mieter nicht auf zwei Abrechnungszeiträume aufteilen. Erfassen Sie den Block bitte auf der Seite Kosten.'
}

const coldTaken = (category: string, ctx: ImportContext): boolean =>
  !isHeating(category) && (ctx.existingAmountCategories ?? []).includes(category)

// Die gewählten Blöcke, die es in der Abrechnung schon gibt; vor dem Anlegen fragt die Prüfansicht nach.
export function duplicateBlocks(x: ServiceStatementExtraction, drafts: readonly BlockDraft[], ctx: ImportContext): string[] {
  return x.blocks.flatMap((b, i) => {
    const d = drafts[i]
    if (!d?.include) return []
    const taken = isHeating(d.category) ? ctx.existingAmountItems > 0 : coldTaken(d.category, ctx)
    return taken ? [blockName(b)] : []
  })
}

export function draftsOf(x: ServiceStatementExtraction, ctx: ImportContext): BlockDraft[] {
  return x.blocks.map((b) => {
    const heating = isHeating(b.category)
    // Betrag der Heizposition = Gesamtkosten vor dem Abzug (Entwurf 7.1): S + Abzugszeile.
    const total = blockCents(b) + (heating && x.deductionEur !== null ? cents(x.deductionEur) : 0)
    return {
      // Review Focus 4: Stehen schon Einzelbeträge in der Heizperiode, ist der Heizblock nicht vorgehakt.
      include: heating ? ctx.existingAmountItems === 0 : blockBlocked(b, ctx) === null && !coldTaken(b.category, ctx),
      category: b.category,
      amount: euroText(total),
      targets: b.lines.map((l) => matchLine(l, ctx)),
      taxYear: '',
    }
  })
}

export function serviceChecks(x: ServiceStatementExtraction, ctx: ImportContext): string[] {
  const out: string[] = []
  if (x.periodStart && x.periodEnd && (x.periodStart !== ctx.heating.from || x.periodEnd !== ctx.heating.to)) {
    out.push(`Die Abrechnung gilt für ${formatDayRange(x.periodStart, x.periodEnd)}, die Heizperiode in Mietfuchs für ${formatDayRange(ctx.heating.from, ctx.heating.to)}. Prüfen Sie den Zeitraum der Heizanlage unter Stammdaten.`)
  }
  for (const b of x.blocks) {
    if (b.totalEur === undefined) continue
    // Jede Nutzerzeile ist gerundet, bei Messdiensten aus bis zu zwei Teilen (Heizung, Warmwasser): 2 ct je Zeile.
    if (Math.abs(linesCents(b) - cents(b.totalEur)) > b.lines.length * 2) {
      out.push(`Block „${blockName(b)}“: Die Nutzerzeilen ergeben ${fmtEuro(linesCents(b))}, die Summe laut Abrechnung ist ${fmtEuro(cents(b.totalEur))}.`)
    }
  }
  const heating = x.blocks.find((b) => isHeating(b.category))
  if (heating && x.usersTotalEur !== null && heating.totalEur !== undefined && cents(x.usersTotalEur) !== cents(heating.totalEur)) {
    out.push(`Die Summe der Nutzerkosten Heizung und Warmwasser (S) ist ${fmtEuro(cents(x.usersTotalEur))}, der Block nennt ${fmtEuro(cents(heating.totalEur))}.`)
  }
  if (heating && x.unitsCount !== null && x.unitsCount !== heating.lines.length) {
    out.push(`Die Abrechnung nennt ${x.unitsCount} Nutzeinheiten, im Block stehen ${heating.lines.length} Nutzerzeilen.`)
  }
  if (x.co2?.landlordEur != null && x.deductionEur !== null && cents(x.co2.landlordEur) !== cents(x.deductionEur)) {
    out.push(`Der CO₂-Anteil des Vermieters ist ${fmtEuro(cents(x.co2.landlordEur))}, die Abzugszeile ${fmtEuro(cents(x.deductionEur))}.`)
  }
  for (const b of x.blocks) {
    if (coldTaken(b.category, ctx) && blockBlocked(b, ctx) === null) {
      out.push(`Im Abrechnungszeitraum gibt es schon Einzelbeträge der Kostenart „${b.category}“. Übernehmen Sie den Block „${blockName(b)}“ nur, wenn er noch fehlt; sonst stünden die Kosten doppelt in der Abrechnung.`)
    }
  }
  if (ctx.existingAmountItems > 0) {
    out.push('In dieser Heizperiode gibt es schon Einzelbeträge eines Messdienstes. Übernehmen Sie nur, was noch fehlt; sonst stünden die Heizkosten doppelt in der Abrechnung.')
  }
  return out
}

// Das Jahr der Zahlung eines Blocks (Prüfung M2): Reicht sein Zeitraum über zwei Kalenderjahre, verlangt der
// Server es (repository.ts, `requireTaxYear`), zwischen dem ersten Jahr und dem Jahr nach dem Ende; sonst
// ergibt es sich aus dem Zeitraum, und es geht nichts mit.
function taxYearOf(span: { from: string; to: string }, text: string, name: string): { taxYear?: number } | { error: string } {
  if (!spansTwoYears(span)) return {}
  if (text.trim() === '') return { error: `Block „${name}“: Der Zeitraum reicht über zwei Kalenderjahre. Bitte geben Sie das Jahr der Zahlung an (für die Steuer, § 11 Abs. 2 EStG).` }
  const first = Number(span.from.slice(0, 4))
  const last = Number(span.to.slice(0, 4)) + 1
  const year = Number(text.trim())
  if (!Number.isInteger(year) || year < first || year > last) return { error: `Block „${name}“: Das Jahr der Zahlung muss zwischen ${first} und ${last} liegen.` }
  return { taxYear: year }
}

// `blocks`: zu jedem Rumpf der Index seines Blocks, damit die Prüfansicht nach jedem Erfolg genau dessen Haken
// entfernen kann (Durchsicht S3).
export function itemBodies(x: ServiceStatementExtraction, drafts: readonly BlockDraft[], ctx: ImportContext, file: string): { bodies: Record<string, unknown>[]; blocks: number[] } | { error: string } {
  const bodies: Record<string, unknown>[] = []
  const blocks: number[] = []
  for (const [i, b] of x.blocks.entries()) {
    const d = drafts[i]
    if (!d || !d.include) continue
    const block = { ...b, category: d.category }
    const name = blockName(b)
    const blocked = blockBlocked(block, ctx)
    if (blocked) return { error: `Block „${name}“: ${blocked}` }
    const amount = parseEuro(d.amount)
    if (amount === null) return { error: `Block „${name}“: Bitte tragen Sie den Betrag ein.` }
    const tenancyAmounts: Record<string, number> = {}
    const selfAmounts: Record<string, number> = {}
    for (const [k, line] of b.lines.entries()) {
      const target = d.targets[k] ?? ''
      if (target === '') return { error: `Bitte ordnen Sie „${line.label}“ (${name}) einem Mieter, Ihrer eigenen Wohnung oder dem Leerstand zu.` }
      if (target === 'vacancy') continue
      if (line.amountEur === undefined) return { error: `„${line.label}“ (${name}) hat keinen Betrag. Bitte tragen Sie ihn nach der Übernahme auf der Seite Kosten ein oder ordnen Sie die Zeile dem Leerstand zu.` }
      const [kind, id = ''] = target.split(':')
      const into = kind === 'self' ? selfAmounts : tenancyAmounts
      into[id] = (into[id] ?? 0) + cents(line.amountEur)
    }
    const heating = isHeating(block.category)
    const span = heating ? ctx.heating : ctx.object
    const tax = taxYearOf(span, d.taxYear, name)
    if ('error' in tax) return tax
    bodies.push({
      propertyId: ctx.propertyId,
      period: span.key,
      category: block.category,
      description: `${b.title || block.category} (${x.vendor ?? 'Messdienst'})`,
      ...(x.vendor ? { vendor: x.vendor } : {}),
      amountCents: amount,
      key: 'amounts',
      tenancyAmounts,
      selfAmounts,
      invoiceFile: file,
      ...(heating ? { heatingPlantId: ctx.plantId } : {}),
      ...tax,
    })
    blocks.push(i)
  }
  return { bodies, blocks }
}

// Das CO₂-Formular (PR 6, seit PR 17 mit Ausstoß, Fläche, G und V) aus der Auswertung vorbelegt. Was die
// Auswertung nicht gelesen hat, bleibt, wie der Vermieter es eingetragen hat (Prüfung M3). Die Antwort auf die
// Frage nach der Abzugszeile bleibt ebenfalls (Entwurf 7.2: ohne Vorgabe). `costItemId`: die eben angelegte
// Heizposition, wenn noch keine verknüpft ist (Prüfung S5).
export function co2FormFromExtraction(x: ServiceStatementExtraction, base: Co2Form, costItemId?: string): Co2Form {
  const landlord = x.co2?.landlordEur ?? x.deductionEur
  return {
    ...base,
    usersTotal: x.usersTotalEur !== null ? euroText(cents(x.usersTotalEur)) : base.usersTotal,
    unitsCount: x.unitsCount !== null ? String(x.unitsCount) : base.unitsCount,
    kgPerM2: x.co2?.kgPerM2 != null ? decimalText(x.co2.kgPerM2) : base.kgPerM2,
    emissionsKg: x.co2?.emissionsKg != null ? decimalText(x.co2.emissionsKg) : base.emissionsKg,
    serviceArea: x.co2?.areaM2 != null ? decimalText(x.co2.areaM2) : base.serviceArea,
    landlordPercent: x.co2?.landlordPercent != null ? decimalText(x.co2.landlordPercent) : base.landlordPercent,
    totalCo2: x.co2?.totalEur != null ? euroText(cents(x.co2.totalEur)) : base.totalCo2,
    landlordCo2: landlord != null ? euroText(cents(landlord)) : base.landlordCo2,
    fuelGross: x.fuelGrossEur !== null ? euroText(cents(x.fuelGrossEur)) : base.fuelGross,
    fuelNet: x.fuelNetEur !== null ? euroText(cents(x.fuelNetEur)) : base.fuelNet,
    costItemId: base.costItemId === '' && costItemId ? costItemId : base.costItemId,
  }
}

export function deductionHint(x: ServiceStatementExtraction): string | null {
  return x.deductionEur === null ? null : `In Ihrer Abrechnung steht die Zeile „Abzüglich CO₂-Kosten Vermieter“ mit ${fmtEuro(cents(x.deductionEur))}.`
}

const answerLabel = (a: Co2Answer): string => CO2_ANSWER_OPTIONS.find((o) => o.value === a)?.label ?? ''

// Die Antwort widerspricht der gelesenen Abzugszeile (Entwurf 7.4, Prüfung S5).
export function answerConflict(x: ServiceStatementExtraction, answer: Co2Answer): string | null {
  if (x.deductionEur === null) return null
  const yes = answerLabel('deducted')
  if (answer === 'shown') return `Die Auswertung hat eine Abzugszeile gefunden. Steht sie in Ihrer Abrechnung, wählen Sie „${yes}“. Mit „${answerLabel(answer)}“ schlägt die Probe fehl, weil der Betrag der Position die Abzugszeile enthält.`
  if (answer === 'unsplit') return `Die Auswertung hat eine Abzugszeile gefunden, der Messdienst hat die CO₂-Kosten also aufgeteilt. Steht sie in Ihrer Abrechnung, wählen Sie „${yes}“. Mit „${answerLabel(answer)}“ teilte Mietfuchs sie ein zweites Mal auf.`
  return null
}
