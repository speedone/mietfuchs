// Ampel-Triage für die Schnellerfassung. Die Ampel einer Rechnungsposition steht seit der
// Belegbuchung (#170) in shared/assessment.ts, weil der Server sie mitliefert; hier bleiben die
// Zählerstände und, bis Task 6 sie ablöst, die Gruppen zum Verknüpfen.
import type { CostItem, Meter, Reading, TrafficLight } from './types'
import { parseEuro, fmtEuro } from './api'
import { amountProblem } from './costForm'
import { sameCostCandidates } from '../../shared/duplicates.ts'
import { createScorer } from '../../shared/assessment.ts'
export { aiRowPreselected, candidateText, categoryDeviationPct, invoiceSumCheck, scorePosition, type PositionCtx } from '../../shared/assessment.ts'
export type { TrafficLight } from './types'

// Die Regel steht in shared/duplicates.ts. Das Jahr ist das des Belegs: Im Januar steht die
// Auswahl oft noch auf dem Vorjahr.
export function duplicateCandidates(items: readonly CostItem[], q: { category: string; description: string; vendor: string; year: number }): CostItem[] {
  return sameCostCandidates(items, q)
}

// ---------- Verknüpfen statt neu anlegen ----------
// Eine KI-Zeile, für die dieselbe Rechnung schon erfasst sein könnte, wird nicht still angelegt,
// sondern mit der bestehenden Position verknüpft: Betrag und Beleg kommen vom Beleg, Schlüssel und
// alles Übrige der Position bleiben. Zeilen desselben Belegs mit derselben Kostenart und denselben
// Kandidaten bilden eine Gruppe (Frischwasser und Schmutzwasser gegen „Wasser/Abwasser“): Sie
// werden gemeinsam verknüpft, mit der Summe, sonst bekäme die Position den Betrag der ersten Zeile
// und die zweite ginge verloren (zweite Durchsicht).

// `linked`: mit einer bestehenden Position verknüpft (deren Beschreibung); `created`: als neue
// Position angelegt. Beides heißt erledigt, und erledigte Zeilen fragen nicht mehr nach Doppelungen
// (dritte Durchsicht: Sonst bot eine eben angelegte Zeile „um ihren eigenen Betrag erhöhen“ an).
export type AiRow = { category: string; description: string; amount: string; labor35a: string; linked?: string; created?: boolean }

export type LinkOffer = {
  target: CostItem
  // Die Position hängt schon an diesem Beleg: Der Betrag wird erhöht statt ersetzt.
  sameReceipt: boolean
  label: string
  // Was der Knopf zusätzlich tut und gesagt werden muss, etwa das Entfernen eines Lohnanteils
  note: string | null
  built: { error: string } | { body: Record<string, unknown> }
}

export type DuplicateGroup = {
  rows: number[]
  candidates: CostItem[]
  offers: LinkOffer[]
  // Kandidaten, deren Betrag an weiteren Angaben hängt (Einzelbeträge je Mieter, eigener Anteil
  // laut Gemeinschaftsabrechnung): Sie werden im Formular gepflegt, nicht mit einem Klick.
  formOnly: CostItem[]
  // Positionen, die schon diesen Beleg tragen, aus einem anderen Eintrag der Warteschlange
  // (derselbe Beleg zweimal ausgewertet): kein zweites „erhöhen“, nur der Hinweis.
  takenByReceipt: CostItem[]
  // Die Summe der Zeilen ist negativ (Gutschrift): wird angelegt, nicht verrechnet (L3).
  credit: boolean
}

const FORM_ONLY_KEYS: readonly CostItem['key'][] = ['amounts', 'external']

function linkOffer(rows: readonly AiRow[], target: CostItem, invoiceFile: string | undefined): LinkOffer {
  const sameReceipt = !!invoiceFile && target.invoiceFile === invoiceFile
  const amounts = rows.map((r) => parseEuro(r.amount))
  const laborGiven = rows.some((r) => r.labor35a.trim() !== '')
  const laborZero = laborGiven && rows.every((r) => r.labor35a.trim() === '' || parseEuro(r.labor35a) === 0)
  const labors = rows.map((r) => (r.labor35a.trim() ? parseEuro(r.labor35a) : 0))
  const sum = amounts.every((a) => a !== null) ? amounts.reduce<number>((x, a) => x + (a ?? 0), 0) : null
  const laborSum = labors.every((l) => l !== null) ? labors.reduce<number>((x, l) => x + (l ?? 0), 0) : null
  const before = target.labor35aCents ?? 0
  const many = rows.length > 1 ? ` (${rows.length} Positionen)` : ''
  let amount: number | null
  let labor: number | null
  let laborField: number | undefined
  let note: string | null = null
  if (sameReceipt) {
    amount = sum === null ? null : target.amountCents + sum
    labor = laborSum === null ? null : before + laborSum
    if (laborGiven) laborField = labor ?? undefined
  } else {
    amount = sum
    if (laborGiven && laborSum !== null && laborSum > 0) {
      labor = laborSum
      laborField = laborSum
    } else if (laborSum === null) {
      labor = null
    } else if (before > 0) {
      // Den geschätzten Lohnanteil stehen zu lassen hieße, ihn den Mietern und in der Anlage V
      // zu bescheinigen, ohne dass die Rechnung ihn trägt.
      labor = 0
      laborField = 0
      // Ausdrücklich 0 eingetragen ist eine Angabe aus der Rechnung, keine Lücke (L1).
      note = laborZero
        ? 'Der §35a-Lohnanteil wird auf 0 gesetzt.'
        : `Der bisherige §35a-Lohnanteil (${fmtEuro(before)}) wird entfernt; tragen Sie ihn aus der Rechnung ein.`
    } else {
      labor = 0
    }
  }
  const problem = amountProblem(amount, labor, target.category)
  const built = problem !== null || amount === null
    ? { error: problem ?? 'Bitte einen Betrag angeben.' }
    : { body: { amountCents: amount, ...(sameReceipt ? {} : { invoiceFile }), ...(laborField !== undefined ? { labor35aCents: laborField } : {}) } }
  const shown = (n: number | null) => (n === null ? '?' : fmtEuro(n))
  const label = sameReceipt
    ? `„${target.description}“ (${fmtEuro(target.amountCents)}) um ${shown(sum)} auf ${shown(amount)} erhöhen${many}`
    : `Mit „${target.description}“ (${fmtEuro(target.amountCents)}) verknüpfen und Betrag auf ${shown(amount)} setzen${many}`
  return { target, sameReceipt, label, note, built }
}

// `ownIds`: Positionen, die aus diesem Eintrag angelegt wurden. Sie sind Zeilen derselben Rechnung
// und keine Doppelung; eine Gutschrift neben der eben angelegten Position wird deshalb selbst
// angelegt und nicht mit ihr verrechnet, so bleibt sie auf der Abrechnung sichtbar.
// `receiptTaken`: Positionen, die ein anderer Eintrag mit demselben Beleg schon gefüllt hat.
export function duplicateGroups(rows: readonly AiRow[], ctx: { items: readonly CostItem[]; vendor: string; year: number; invoiceFile?: string; ownIds?: readonly string[]; receiptTaken?: readonly string[] }): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>()
  const items = ctx.ownIds?.length ? ctx.items.filter((i) => !ctx.ownIds?.includes(i.id)) : ctx.items
  rows.forEach((r, i) => {
    if (r.linked || r.created) return
    const candidates = duplicateCandidates(items, { category: r.category, description: r.description, vendor: ctx.vendor, year: ctx.year })
    if (candidates.length === 0) return
    const key = `${r.category}|${candidates.map((c) => c.id).join(',')}`
    const g = groups.get(key) ?? { rows: [], candidates, offers: [], formOnly: [], takenByReceipt: [], credit: false }
    g.rows.push(i)
    groups.set(key, g)
  })
  for (const g of groups.values()) {
    // Ziel ist eine Position ohne Beleg oder eine, die schon an diesem Beleg hängt; sonst ersetzte
    // der Beleg einen anderen.
    const sameFile = (c: CostItem) => !!ctx.invoiceFile && c.invoiceFile === ctx.invoiceFile
    g.takenByReceipt = g.candidates.filter((c) => sameFile(c) && (ctx.receiptTaken ?? []).includes(c.id))
    const open = g.candidates.filter((c) => (!c.invoiceFile || sameFile(c)) && !g.takenByReceipt.includes(c))
    g.formOnly = open.filter((c) => FORM_ONLY_KEYS.includes(c.key))
    const members = g.rows.map((i) => rows[i]).filter((r): r is AiRow => !!r)
    // Eine negative Summe (Gutschrift) wird nicht mit einer Position verrechnet, sondern angelegt (L3).
    const sum = members.reduce((x, r) => x + (parseEuro(r.amount) ?? 0), 0)
    g.credit = sum < 0
    g.offers = g.credit ? [] : open.filter((c) => !FORM_ONLY_KEYS.includes(c.key)).map((c) => linkOffer(members, c, ctx.invoiceFile))
  }
  return [...groups.values()]
}

// ---------- Zählerstand ----------

// Findet den Zähler, dessen (auf Ziffern normalisierte) Nummer der gelesenen entspricht.
const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
export function autoMatchMeter(meterNumber: string | null, meters: Meter[]): string | null {
  const target = onlyDigits(meterNumber)
  if (!target) return null
  return meters.find((m) => onlyDigits(m.meterNumber) === target)?.id ?? null
}

export type ReadingCtx = {
  meterNumber: string | null
  value: number | null
  hasDate: boolean // verlässliches Datum aus EXIF/Bild vorhanden
  matchedMeterId: string | null // bereits zugeordneter Zähler (Auto-Match, vom Nutzer überschreibbar)
  readings: Reading[]
}

export type ScoredReading = {
  level: TrafficLight
  reasons: string[]
  replacementGuess: boolean
  suggestedOldEndValue: number | null
}

export function scoreReading(ctx: ReadingCtx): ScoredReading {
  const s = createScorer()
  const { matchedMeterId } = ctx

  if (ctx.value == null) s.bump('rot', 'Zählerstand nicht erkannt')
  if (!matchedMeterId) {
    s.bump('rot', ctx.meterNumber ? `Zählernummer ${ctx.meterNumber} keinem Zähler zugeordnet` : 'kein Zähler erkannt — bitte zuordnen')
  }

  let replacementGuess = false
  let suggestedOldEndValue: number | null = null
  if (matchedMeterId && ctx.value != null) {
    const own = ctx.readings.filter((r) => r.meterId === matchedMeterId).sort((a, b) => a.date.localeCompare(b.date))
    const prior = own[own.length - 1]
    if (prior) {
      if (ctx.value < prior.value) {
        s.bump('rot', `Stand ${ctx.value} < letzter Stand ${prior.value} — Zählerwechsel?`)
        replacementGuess = true
        suggestedOldEndValue = prior.value
      } else if (own.length >= 2) {
        // grobe Plausibilität: aktuellen Zuwachs mit dem letzten Segment vergleichen
        const lastDiff = own[own.length - 1].value - own[own.length - 2].value
        const diff = ctx.value - prior.value
        if (lastDiff > 0 && diff > lastDiff * 3) s.bump('gelb', 'Verbrauch deutlich höher als in der Vorperiode')
        if (lastDiff > 0 && diff < lastDiff * 0.3) s.bump('gelb', 'Verbrauch deutlich niedriger als in der Vorperiode')
      }
    }
  }

  if (!ctx.hasDate) s.bump('gelb', 'Ablesedatum unsicher — bitte prüfen')

  const { level, reasons } = s.result()
  return { level, reasons, replacementGuess, suggestedOldEndValue }
}
