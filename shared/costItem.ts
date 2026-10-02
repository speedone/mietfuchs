// Prüfung und Rumpf einer Kostenposition (Belegbuchung, #170). Bis hierher standen beide im
// Formular (client/src/costForm.ts, `amountProblem` und `buildCostItemBody`) und galten nur im
// Browser. Seit der Server KI-Zeilen selbst als Positionen anlegt, braucht er dieselbe Prüfung,
// sonst behandelte er eine Gutschrift oder einen §35a-Lohnanteil anders als das Formular.
//
// Die Funktionen nehmen **Cent und Codes** und keine Eingabetexte: Was „54,00“ heißt, liest die
// Oberfläche (parseEuro), und was sie nicht lesen konnte, kommt als `null` herein. Die Meldungen
// sind dieselben Sätze wie bisher im Formular; client/src/costForm.test.ts hält sie fest.
import type { CostKey, ExternalBasis, ExternalMeasure, MeterType, Unit } from './types.ts'
import { PARTICIPANT_KEYS } from './allocation.ts'
import { isNotAllocable } from './categories.ts'

// Ein Betrag wie in der Oberfläche (client/src/api.ts, fmtEuro): „612,40 €“.
export const euro = (cents: number): string => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
export const pct = (n: number): string => n.toLocaleString('de-DE', { maximumFractionDigits: 2 })

// Gehört die Wohnung zur Abrechnungseinheit? Vermietet oder selbstgenutzt; dieselbe Regel wie
// `basisUnitsOf` in client/src/costForm.ts (`usageOf(u) !== 'ausgenommen'`).
export const inBasis = (u: Pick<Unit, 'participates' | 'selfUsed'>): boolean => u.participates || u.selfUsed === true

export const CREDIT_WITH_AMOUNTS = 'Bei einer Gutschrift sind Einzelbeträge nicht möglich; verteilen Sie sie bitte nach einem anderen Schlüssel.'

// Betrag und §35a-Lohnanteil einer Kostenposition (#139). `null` bei einem Betrag heißt unlesbar.
// Eine Gutschrift hat einen negativen Betrag; Berechnung und Datenbank kennen sie. Nur 0 ist
// keine Kostenposition. Die Meldung nennt den Grund, statt „gültig“ offen zu lassen.
export function amountProblem(amount: number | null, labor35a: number | null, category?: string): string | null {
  if (amount === null) return 'Bitte den Betrag als Euro-Betrag angeben, z. B. 54,00 (eine Gutschrift mit Minus: -54,00).'
  if (amount === 0) return 'Ein Betrag von 0 € ist keine Kostenposition. Bitte den Rechnungsbetrag eintragen.'
  // § 35a EStG bescheinigt gezahlte Lohnkosten. Bei einer Gutschrift bescheinigte die Berechnung
  // ohnehin nichts (calc.ts meldet den Lohnanteil als ungültig), die Steuerübersicht zählte ihn
  // aber mit.
  if (amount < 0 && labor35a !== 0) return 'Bei einer Gutschrift gibt es keinen §35a-Lohnanteil. Bitte das Feld leer lassen.'
  // Die Zuführung zur Erhaltungsrücklage ist keine bezahlte Arbeit, sondern angespartes Geld
  // (#143); einen Lohnanteil gibt es erst an der Rechnung, die die Gemeinschaft daraus bezahlt.
  if (category === 'Zuführung Erhaltungsrücklage' && labor35a !== 0) {
    return 'An der Zuführung zur Erhaltungsrücklage gibt es keinen §35a-Lohnanteil. Bitte das Feld leer lassen.'
  }
  if (labor35a === null || labor35a < 0 || (amount > 0 && labor35a > amount)) {
    return 'Der §35a-Lohnanteil muss eine gültige Zahl zwischen 0 und dem Gesamtbetrag sein.'
  }
  return null
}

// Was eine Kostenposition werden soll, in Zahlen. `null` heißt jeweils „nicht lesbar“: Die
// Oberfläche reicht, was sie nicht lesen konnte, so herein, und die Prüfung sagt es in Worten.
export type CostItemDraft = {
  category: string
  description: string
  vendor: string
  invoiceFile: string | null
  amountCents: number | null
  // 0 heißt kein Lohnanteil, `null` unlesbar
  labor35aCents: number | null
  key: CostKey
  directUnitId: string | null
  meterType: MeterType | null
  // Prozent je Wohnung, nur eingetragene; `null` unlesbar. Ein negativer Wert bleibt negativ und
  // wird abgelehnt.
  customShares: Record<string, number | null>
  // `null` heißt alle Wohnungen, auch künftig angelegte
  participants: string[] | null
  external: { measure: ExternalMeasure; total: number | null; totalCents: number | null }
  // Nur die Beträge, deren Feld die Oberfläche zeigt; `null` unlesbar
  tenancyAmounts: Record<string, number | null>
  selfAmounts: Record<string, number | null>
}

// Der Rumpf, der an die Datenbank geht. Felder, die zum Schlüssel nicht gehören, stehen
// ausdrücklich auf `null`: Die generische PUT-Route übernimmt nur vorhandene Felder, sonst blieben
// alte Zuordnungen stehen.
export type CostItemBody = {
  year: number
  category: string
  description: string
  vendor: string | undefined
  amountCents: number
  labor35aCents: number | undefined
  key: CostKey
  directUnitId: string | null
  meterType: MeterType | null
  customShares: Record<string, number> | null
  participantUnitIds: string[] | null
  externalBasis: ExternalBasis | null
  tenancyAmounts: Record<string, number> | null
  selfAmounts: Record<string, number> | null
  invoiceFile: string | null
}

// **Nicht umlagefähig, aber einer Einheit zuzuordnen** (#163): Für die Abrechnung bleibt es dabei,
// die Position trägt der Vermieter. Für die Steuer zählt, wen sie betrifft: Eine Badrenovierung in
// der vermieteten Wohnung ist ganz abziehbar, eine in der eigenen gar nicht, und eine Reparatur am
// Dach wird nach Fläche aufgeteilt. Gespeichert wird das als Direktzuordnung, die Berechnung der
// Abrechnung liest den Schlüssel weiterhin nicht. Nur „Nicht umlagefähig“: Die Zuführung zur
// Erhaltungsrücklage ist keine Werbungskosten des Jahres (#143), dort gibt es nichts zuzuordnen.
// Die Regel steht hier und nicht im Formular, weil auch „Aus dem Vorjahr übernehmen“ und die
// Belegbuchung auf dem Server Positionen durch `costItemBody` anlegen.
export const showsTaxUnitField = (category: string): boolean => category === 'Nicht umlagefähig'
export const taxUnitOf = (item: { category: string; key: CostKey; directUnitId?: string | null }): string | null =>
  showsTaxUnitField(item.category) && item.key === 'direct' && item.directUnitId ? item.directUnitId : null
// Oder mehrere bestimmte Einheiten (etwa das Dach des Hinterhauses; Durchsicht), gespeichert als
// Teilnehmer bei der Vorgabe „Wohnfläche“. Anders als bei umlagefähigen Kosten bleibt die Liste
// auch dann stehen, wenn sie alle Einheiten nennt: Gewählt ist dann ausdrücklich „bestimmte“.
export const taxPartsOf = (item: { category: string; key: CostKey; participants: string[] | null }): string[] | null =>
  showsTaxUnitField(item.category) && item.key === 'area' && item.participants !== null ? item.participants : null

export type BuildResult = { error: string } | { body: CostItemBody }

// Liest eine Liste von Beträgen; `null`, wenn einer unlesbar oder negativ ist.
function amountsOf(m: Record<string, number | null>): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const [id, cents] of Object.entries(m)) {
    if (cents === null || cents < 0) return null
    out[id] = cents
  }
  return out
}

export function costItemBody(d: CostItemDraft, units: readonly Unit[], year: number): BuildResult {
  if (!d.description.trim()) return { error: 'Bitte eine Beschreibung angeben.' }
  const amount = d.amountCents
  const labor = d.labor35aCents
  const problem = amountProblem(amount, labor, d.category)
  if (problem !== null || amount === null) return { error: problem ?? 'Bitte einen Betrag angeben.' }
  const common = {
    year,
    category: d.category,
    description: d.description.trim(),
    vendor: d.vendor.trim() || undefined,
    amountCents: amount,
    labor35aCents: labor || undefined,
    invoiceFile: d.invoiceFile,
  }
  // Nicht umlagefähig (#142): Gespeichert wird die neutrale Vorgabe ohne jede Zuordnung. Die
  // Spalte verlangt einen Schlüssel, die Berechnung liest ihn hier aber nicht. Eine Zuordnung, die
  // aus einer früheren Kostenart stehengeblieben ist, bliebe sonst als tote Angabe in der Datenbank.
  if (isNotAllocable(d.category)) {
    // Die eine Ausnahme ist die Einheit für die Steuer (#163, `taxUnitOf`).
    const taxUnit = taxUnitOf(d)
    const taxParts = taxPartsOf(d)
    if (taxParts !== null && taxParts.length === 0) return { error: 'Bitte mindestens eine Einheit wählen, die diese Position betrifft.' }
    return {
      body: {
        ...common, key: taxUnit ? 'direct' : 'area', directUnitId: taxUnit, meterType: null, customShares: null, participantUnitIds: taxParts,
        externalBasis: null, tenancyAmounts: null, selfAmounts: null,
      },
    }
  }
  if (amount < 0 && d.key === 'amounts') return { error: CREDIT_WITH_AMOUNTS }
  if (d.key === 'direct' && !d.directUnitId) return { error: 'Bei Direktzuordnung bitte eine Wohnung wählen.' }
  if (d.key === 'meter' && !d.meterType) return { error: 'Bei Verbrauchsumlage bitte einen Zählertyp wählen.' }

  const basis = units.filter(inBasis)
  let customShares: Record<string, number> | null = null
  if (d.key === 'custom') {
    customShares = {}
    for (const u of basis) {
      if (!Object.hasOwn(d.customShares, u.id)) continue
      const percent = d.customShares[u.id] ?? null
      if (percent === null || percent < 0) return { error: `Anteil für „${u.name}" bitte als Prozentzahl angeben (z. B. 33,33).` }
      if (percent > 0) customShares[u.id] = percent
    }
    const sum = Object.values(customShares).reduce((a, p) => a + p, 0)
    if (sum <= 0) return { error: 'Bitte mindestens einen Anteil größer 0 % angeben.' }
    if (sum > 100.0001) return { error: `Die Anteile ergeben ${pct(sum)} % — mehr als 100 % sind nicht möglich.` }
  }

  // Teilnehmer: alle angehakt heißt null, damit auch künftig angelegte Wohnungen dazugehören.
  let participantUnitIds: string[] | null = null
  if (PARTICIPANT_KEYS.includes(d.key) && d.participants !== null) {
    if (d.participants.length === 0) return { error: 'Bitte mindestens eine teilnehmende Wohnung wählen.' }
    const alle = basis.map((u) => u.id)
    participantUnitIds = alle.every((id) => d.participants?.includes(id)) ? null : d.participants
  }

  let externalBasis: ExternalBasis | null = null
  if (d.key === 'external') {
    const { measure, total, totalCents } = d.external
    if (total === null || !(total > 0) || totalCents === null) {
      return { error: 'Bitte aus der Gemeinschaftsabrechnung die Summe der Anteile in der Anlage und die Kosten der Gemeinschaft eintragen.' }
    }
    externalBasis = { measure, total, totalCents }
  }

  let tenancyAmounts: Record<string, number> | null = null
  let selfAmounts: Record<string, number> | null = null
  if (d.key === 'amounts') {
    tenancyAmounts = amountsOf(d.tenancyAmounts)
    selfAmounts = amountsOf(d.selfAmounts)
    if (!tenancyAmounts || !selfAmounts) return { error: 'Einzelbeträge bitte als Euro-Beträge angeben (z. B. 312,40).' }
    const sum = [...Object.values(tenancyAmounts), ...Object.values(selfAmounts)].reduce((a, c) => a + c, 0)
    if (sum > amount) return { error: 'Die Einzelbeträge ergeben zusammen mehr als der Rechnungsbetrag.' }
  }

  return {
    body: {
      ...common,
      key: d.key,
      directUnitId: d.key === 'direct' ? d.directUnitId : null,
      meterType: d.key === 'meter' ? d.meterType : null,
      customShares,
      participantUnitIds,
      externalBasis,
      tenancyAmounts,
      selfAmounts,
    },
  }
}
