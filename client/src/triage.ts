// Ampel-Triage für die Schnellerfassung: bewertet jede erkannte Rechnungsposition bzw.
// jeden Zählerstand deterministisch als grün (sicher), gelb (prüfen) oder rot (fehlt was).
// Bewusst reine Logik ohne React/Netzwerk — damit testbar und vom Modell unabhängig.
import type { CostItem, Meter, Reading } from './types'
import { isNotAllocable } from './types'
import { parseEuro, fmtEuro } from './api'
import { amountProblem } from './costForm'
import { sameCostCandidates } from '../../shared/duplicates.ts'

export type TrafficLight = 'gruen' | 'gelb' | 'rot'

const RANK: Record<TrafficLight, number> = { gruen: 0, gelb: 1, rot: 2 }

// kleiner Sammler: hebt das Niveau nur an, nie ab, und merkt sich die Begründungen
function scorer() {
  let level: TrafficLight = 'gruen'
  const reasons: string[] = []
  return {
    bump(l: TrafficLight, reason: string) {
      reasons.push(reason)
      if (RANK[l] > RANK[level]) level = l
    },
    result() {
      return { level, reasons }
    },
  }
}

// ---------- Rechnungsposition ----------

export type PositionCtx = {
  category: string // bereits über matchCategory zugeordnete Kategorie
  amountCents: number // geparster Betrag (0 = ungültig/fehlt, negativ = Gutschrift)
  labor35aCents: number
  matchedByDesc: boolean // Kategorie kam nur über den Beschreibungs-Fallback
  vendor: string
  detectedYear: number | null
  targetYear: number
  existingItems: CostItem[]
  priorYearDeviationPct?: number | null // Abweichung der Kategorie-Summe ggü. Vorjahr in %
  description?: string // für die Frage, ob dieselbe Rechnung schon erfasst ist
}

export function scorePosition(ctx: PositionCtx): { level: TrafficLight; reasons: string[] } {
  const s = scorer()

  if (ctx.amountCents === 0) s.bump('rot', 'Betrag fehlt oder ist 0')
  // Eine Gutschrift (#139) wird übernommen, aber nie ungesehen: Sie senkt die Kosten des Jahres.
  if (ctx.amountCents < 0) s.bump('gelb', 'Gutschrift — senkt die Kosten des Jahres')
  if (isNotAllocable(ctx.category)) s.bump('rot', 'nicht umlagefähig — trägt der Vermieter')
  if (ctx.category === 'Sonstige Betriebskosten') s.bump('rot', 'Kategorie unklar — bitte zuordnen')
  if (ctx.detectedYear == null) s.bump('rot', 'Rechnungsjahr nicht erkannt')

  const vendor = ctx.vendor.trim().toLowerCase()
  const year = ctx.detectedYear ?? ctx.targetYear
  if (vendor && ctx.amountCents !== 0) {
    const dupe = ctx.existingItems.some(
      (it) => it.year === year && it.amountCents === ctx.amountCents && (it.vendor ?? '').trim().toLowerCase() === vendor,
    )
    if (dupe) s.bump('rot', 'mögliche Dublette — gleicher Betrag, Steller und Jahr existiert bereits')
  }

  // Schon eine Position, die dieselbe Rechnung sein könnte, etwa aus dem Vorjahr übernommen
  // (shared/duplicates.ts)? Nie grün: verknüpfen oder bewusst als neue Position anhaken.
  const candidates = duplicateCandidates(ctx.existingItems, { category: ctx.category, description: ctx.description ?? '', vendor: ctx.vendor, year })
  if (candidates.length > 0) {
    s.bump('gelb', `schon erfasst: ${candidates.map(candidateText).join(', ')} — verknüpfen oder bewusst als neue Position anlegen`)
  }

  if (ctx.matchedByDesc) s.bump('gelb', 'Kategorie nur über die Beschreibung erraten')
  if (ctx.amountCents > 0 && ctx.labor35aCents > ctx.amountCents) s.bump('gelb', '§35a-Lohnanteil größer als der Betrag')
  if (ctx.detectedYear != null && ctx.detectedYear !== ctx.targetYear) {
    s.bump('gelb', `Rechnungsjahr ${ctx.detectedYear} ≠ Zieljahr ${ctx.targetYear}`)
  }
  if (ctx.priorYearDeviationPct != null && Math.abs(ctx.priorYearDeviationPct) > 25) {
    const sign = ctx.priorYearDeviationPct > 0 ? '+' : ''
    s.bump('gelb', `${sign}${Math.round(ctx.priorYearDeviationPct)} % gegenüber Vorjahr`)
  }

  return s.result()
}

// ---------- Dieselbe Rechnung schon erfasst? (Zusammenspiel #141 und #170) ----------
// Die Regel steht in shared/duplicates.ts, damit „Aus dem Vorjahr übernehmen“, Schnellerfassung,
// KI-Auswertung der Kostenseite, Posteingang und der Hinweis der Abrechnung dasselbe sagen. Das
// Jahr ist das des Belegs: Im Januar steht die Auswahl oft noch auf dem Vorjahr.
export function duplicateCandidates(items: readonly CostItem[], q: { category: string; description: string; vendor: string; year: number }): CostItem[] {
  return sameCostCandidates(items, q)
}

export const candidateText = (i: CostItem): string => `„${i.description}“ (${fmtEuro(i.amountCents)}${i.invoiceFile ? '' : ', ohne Beleg'})`

// Vorab angehakt ist eine KI-Zeile nur, wenn nichts dagegen spricht: umlagefähig, mit Schlüssel für
// alle (aiPositionPreselect), übernehmbar, nicht rot und ohne eine Position, die dieselbe Rechnung
// sein könnte. Sonst legte „Diese übernehmen“ sie ungesehen an.
export function aiRowPreselected(r: { category: string; preselect: boolean; problem: string | null; level: TrafficLight; candidates: readonly CostItem[] }): boolean {
  return !isNotAllocable(r.category) && r.preselect && r.problem === null && r.level !== 'rot' && r.candidates.length === 0
}

// Weicht die Summe der Kostenart im Jahr des Belegs, mit diesem Betrag, um wie viel Prozent vom
// Jahr davor ab? `null` ohne Vorjahr.
export function categoryDeviationPct(items: readonly CostItem[], category: string, year: number, amountCents: number): number | null {
  const sum = (y: number) => items.filter((i) => i.year === y && i.category === category).reduce((a, i) => a + i.amountCents, 0)
  const prior = sum(year - 1)
  return prior > 0 ? ((sum(year) + amountCents - prior) / prior) * 100 : null
}

// ---------- Verknüpfen statt neu anlegen ----------
// Eine KI-Zeile, für die dieselbe Rechnung schon erfasst sein könnte, wird nicht still angelegt,
// sondern mit der bestehenden Position verknüpft: Betrag und Beleg kommen vom Beleg, Schlüssel und
// alles Übrige der Position bleiben. Zeilen desselben Belegs mit derselben Kostenart und denselben
// Kandidaten bilden eine Gruppe (Frischwasser und Schmutzwasser gegen „Wasser/Abwasser“): Sie
// werden gemeinsam verknüpft, mit der Summe, sonst bekäme die Position den Betrag der ersten Zeile
// und die zweite ginge verloren (zweite Durchsicht).

export type AiRow = { category: string; description: string; amount: string; labor35a: string; linked?: string }

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
}

const FORM_ONLY_KEYS: readonly CostItem['key'][] = ['amounts', 'external']

function linkOffer(rows: readonly AiRow[], target: CostItem, invoiceFile: string | undefined): LinkOffer {
  const sameReceipt = !!invoiceFile && target.invoiceFile === invoiceFile
  const amounts = rows.map((r) => parseEuro(r.amount))
  const laborGiven = rows.some((r) => r.labor35a.trim() !== '')
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
      note = `Der bisherige §35a-Lohnanteil (${fmtEuro(before)}) wird entfernt; tragen Sie ihn aus der Rechnung ein.`
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

export function duplicateGroups(rows: readonly AiRow[], ctx: { items: readonly CostItem[]; vendor: string; year: number; invoiceFile?: string }): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>()
  rows.forEach((r, i) => {
    if (r.linked) return
    const candidates = duplicateCandidates(ctx.items, { category: r.category, description: r.description, vendor: ctx.vendor, year: ctx.year })
    if (candidates.length === 0) return
    const key = `${r.category}|${candidates.map((c) => c.id).join(',')}`
    const g = groups.get(key) ?? { rows: [], candidates, offers: [], formOnly: [] }
    g.rows.push(i)
    groups.set(key, g)
  })
  for (const g of groups.values()) {
    // Ziel ist eine Position ohne Beleg oder eine, die schon an diesem Beleg hängt; sonst ersetzte
    // der Beleg einen anderen.
    const open = g.candidates.filter((c) => !c.invoiceFile || (!!ctx.invoiceFile && c.invoiceFile === ctx.invoiceFile))
    g.formOnly = open.filter((c) => FORM_ONLY_KEYS.includes(c.key))
    const members = g.rows.map((i) => rows[i]).filter((r): r is AiRow => !!r)
    g.offers = open.filter((c) => !FORM_ONLY_KEYS.includes(c.key)).map((c) => linkOffer(members, c, ctx.invoiceFile))
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
  const s = scorer()
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

// ---------- Beleg-Summenprüfung ----------

// Weicht die Summe der erkannten Positionen von der Rechnungs-Gesamtsumme ab, ist meist eine
// Position übersehen oder doppelt. Toleranz: 2 % bzw. 50 ct (Rundung). Gibt einen Hinweistext
// oder null zurück.
export function invoiceSumCheck(positionsSumCents: number, totalGrossCents: number | null): string | null {
  if (totalGrossCents == null || totalGrossCents <= 0) return null
  const diff = Math.abs(positionsSumCents - totalGrossCents)
  if (diff > Math.max(50, totalGrossCents * 0.02)) {
    const eur = (diff / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })
    return `Positionssumme weicht von der Rechnungssumme ab (Δ ${eur} €)`
  }
  return null
}
