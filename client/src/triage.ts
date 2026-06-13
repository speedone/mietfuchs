// Ampel-Triage für den Schuhkarton-Eingang: bewertet jede erkannte Rechnungsposition bzw.
// jeden Zählerstand deterministisch als grün (sicher), gelb (prüfen) oder rot (fehlt was).
// Bewusst reine Logik ohne React/Netzwerk — damit testbar und vom Modell unabhängig.
import type { CostItem, Meter, Reading } from './types'

export type Ampel = 'gruen' | 'gelb' | 'rot'

const RANK: Record<Ampel, number> = { gruen: 0, gelb: 1, rot: 2 }

// kleiner Sammler: hebt das Niveau nur an, nie ab, und merkt sich die Begründungen
function scorer() {
  let level: Ampel = 'gruen'
  const reasons: string[] = []
  return {
    bump(l: Ampel, reason: string) {
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
  amountCents: number // geparster Betrag (<= 0 = ungültig/fehlt)
  labor35aCents: number
  matchedByDesc: boolean // Kategorie kam nur über den Beschreibungs-Fallback
  vendor: string
  detectedYear: number | null
  targetYear: number
  existingItems: CostItem[]
  priorYearDeviationPct?: number | null // Abweichung der Kategorie-Summe ggü. Vorjahr in %
}

export function scorePosition(ctx: PositionCtx): { level: Ampel; reasons: string[] } {
  const s = scorer()

  if (ctx.amountCents <= 0) s.bump('rot', 'Betrag fehlt oder ist 0')
  if (ctx.category === 'Nicht umlagefähig') s.bump('rot', 'nicht umlagefähig — trägt der Vermieter')
  if (ctx.category === 'Sonstige Betriebskosten') s.bump('rot', 'Kategorie unklar — bitte zuordnen')
  if (ctx.detectedYear == null) s.bump('rot', 'Rechnungsjahr nicht erkannt')

  const vendor = ctx.vendor.trim().toLowerCase()
  const year = ctx.detectedYear ?? ctx.targetYear
  if (vendor && ctx.amountCents > 0) {
    const dupe = ctx.existingItems.some(
      (it) => it.year === year && it.amountCents === ctx.amountCents && (it.vendor ?? '').trim().toLowerCase() === vendor,
    )
    if (dupe) s.bump('rot', 'mögliche Dublette — gleicher Betrag, Steller und Jahr existiert bereits')
  }

  if (ctx.matchedByDesc) s.bump('gelb', 'Kategorie nur über die Beschreibung erraten')
  if (ctx.labor35aCents > ctx.amountCents) s.bump('gelb', '§35a-Lohnanteil größer als der Betrag')
  if (ctx.detectedYear != null && ctx.detectedYear !== ctx.targetYear) {
    s.bump('gelb', `Rechnungsjahr ${ctx.detectedYear} ≠ Zieljahr ${ctx.targetYear}`)
  }
  if (ctx.priorYearDeviationPct != null && Math.abs(ctx.priorYearDeviationPct) > 25) {
    const sign = ctx.priorYearDeviationPct > 0 ? '+' : ''
    s.bump('gelb', `${sign}${Math.round(ctx.priorYearDeviationPct)} % gegenüber Vorjahr`)
  }

  return s.result()
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
  level: Ampel
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
export function belegSummeCheck(positionsSumCents: number, totalGrossCents: number | null): string | null {
  if (totalGrossCents == null || totalGrossCents <= 0) return null
  const diff = Math.abs(positionsSumCents - totalGrossCents)
  if (diff > Math.max(50, totalGrossCents * 0.02)) {
    const eur = (diff / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })
    return `Positionssumme weicht von der Rechnungssumme ab (Δ ${eur} €)`
  }
  return null
}
