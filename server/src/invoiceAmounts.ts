// Beträge einer ausgewerteten Rechnung geradeziehen (#34). Zwei Fälle kommen oft vor, und kein
// Modell rechnet sie zuverlässig selbst. Deshalb liefert das Modell nur, was auf der Rechnung
// steht, und gerechnet wird hier, deterministisch und in Cent:
//
// 1. **Positionen netto.** Handwerker und Schornsteinfeger weisen die Positionen oft ohne
//    Umsatzsteuer aus und nennen sie erst in der Summe. Umgelegt wird aber, was der Vermieter
//    gezahlt hat. Die Positionen werden deshalb hochgerechnet, sodass sie zusammen genau den
//    Rechnungsbetrag ergeben: mit dem ausgewiesenen Steuersatz, sonst anteilig.
// 2. **Lohnanteil nach §35a als ein Betrag.** Steht er nur unter der Rechnung („Im
//    Rechnungsbetrag sind Arbeitskosten von 90,56 € enthalten“), wird er nach Beträgen auf die
//    Positionen verteilt, damit die Bescheinigung ihn ausweisen kann.
//
// Beides ist ein Vorschlag wie alles aus der KI: Die Oberfläche zeigt es an, übernommen wird
// erst nach Prüfung. `amountsAdjusted` und `laborFromTotal` sagen ihr, was gerechnet wurde.
import type { Extraction } from '../../shared/types.ts'
import { largestRemainder } from './calc.ts'

// Eine Rechnungsposition, wie das Modell sie geliefert hat. Weitere Felder (Beschreibung,
// Kategorie, …) fasst diese Funktion nicht an, deshalb bleiben sie über den Index-Zugriff nur
// durchgereicht. Exportiert, weil extract.ts dieselbe rohe Gestalt braucht.
// Beide Betragsfelder stehen ungeprüft so da, wie das Modell sie geliefert hat: `unknown`, aus
// demselben Grund wie die Hinweisfelder unten. Gelesen werden sie nur über `toCents`, das jeden
// Wert selbst prüft, geschrieben nur über `toEur`. Was der Browser am Ende bekommt, beschreibt
// `Extraction` in shared/types.ts — dorthin führt `toExtraction` in extract.ts, und nur dort.
export type RawPosition = {
  amountEur?: unknown
  // Die KI meldet „kein Lohnanteil“ auch als null, nicht nur durch Weglassen; so steht es schon
  // im Schema und in shared/types.ts.
  labor35aEur?: unknown
  [key: string]: unknown
}

// Die Rohausgabe der KI-Auswertung, so weit diese Funktion sie liest oder ergänzt. Auch hier
// bleiben unbekannte Felder über den Index-Zugriff erhalten.
//
// Alles, was aus dem Modell kommt, ist hier `unknown`: Es kann statt einer Zahl auch „neunzehn“
// oder null schicken. Die Funktion prüft jeden dieser Werte selbst (`=== true`, `typeof`,
// `toCents`), und die drei Hinweisfelder trennt sie beim Zerlegen ab, sodass sie die Auswertung
// nie verlassen. Ein engerer Typ wäre eine Behauptung, die niemand einlöst, und würde nur die
// Prüfungen unten wie toten Code aussehen lassen.
//
// Die beiden letzten Felder schreibt dagegen Mietfuchs selbst, für die Oberfläche. Sie nehmen
// ihren Typ deshalb von dort, statt ihn zu wiederholen: So kann das Paar nicht auseinanderlaufen,
// ohne dass der Übersetzer es meldet. Dass das Modell sie nicht selbst behauptet, stellt
// extract.ts sicher, bevor die Antwort hierher kommt.
export type RawExtraction = {
  positionsAreNet?: unknown
  vatRatePercent?: unknown
  labor35aTotalEur?: unknown
  totalGrossEur?: unknown
  positions?: RawPosition[]
  amountsAdjusted?: Extraction['amountsAdjusted']
  laborFromTotal?: Extraction['laborFromTotal']
  [key: string]: unknown
}

const toCents = (eur: unknown): number | null => (typeof eur === 'number' && Number.isFinite(eur) ? Math.round(eur * 100) : null)
const toEur = (cents: number): number => Math.round(cents) / 100
// Wie in der Schnellerfassung: kleine Abweichungen sind Rundung, keine fehlende Umsatzsteuer
const tolerance = (totalCents: number): number => Math.max(50, Math.round(totalCents * 0.02))
// Was noch als Umsatzsteuersatz durchgeht. Deutschland kennt 19 und 7 Prozent, das Ausland auch
// höhere; alles darüber ist keine Steuer mehr, sondern ein Zeichen, dass etwas fehlt. Dieselbe
// Schranke gilt für einen ausdrücklich genannten Satz und für den, der sich aus der Rechnung
// ergibt, damit im Modul nicht zwei Vorstellungen von „plausibel“ stehen.
const MAX_VAT_PERCENT = 30

export function normalizeAmounts(extraction: RawExtraction | null | undefined) {
  const { positionsAreNet, vatRatePercent, labor35aTotalEur, ...result } = extraction ?? {}
  const positions = Array.isArray(result.positions) ? result.positions.map((p) => ({ ...p })) : []
  result.positions = positions
  const keys = positions.map((_, i) => String(i))
  const totalCents = toCents(result.totalGrossEur) ?? 0
  // `null` heißt „nicht gelesen“ und ist etwas anderes als 0: Eine Position kann laut Rechnung
  // nichts kosten (mitversicherte Leistung, Gutschriftszeile), und dann stimmt alles.
  const netCents = positions.map((p) => toCents(p.amountEur))
  const readNet = netCents.filter((c) => c !== null)
  const allNetRead = readNet.length === netCents.length
  const netSum = readNet.reduce((a, b) => a + b, 0)
  // Was der Abstand zwischen Positionssumme und Rechnungsbetrag als Umsatzsteuersatz bedeutete.
  // Bei der Schornsteinfeger-Rechnung sind 85,60 zu 101,86 genau die 19 Prozent; fehlt eine
  // Position, sind es 63,00 zu 101,86 und damit 62 Prozent, und die gibt es nicht.
  const impliedVatPercent = netSum > 0 ? ((totalCents - netSum) / netSum) * 100 : 0

  // 1. Netto → brutto. Zwei Bedingungen sichern, dass die Positionen wirklich die ganze Rechnung
  // beschreiben. Erstens muss jeder Betrag gelesen sein. Zweitens muss der Abstand zum
  // Rechnungsbetrag wie eine Umsatzsteuer aussehen: Fehlt ein Betrag, ist er viel größer, als
  // eine Steuer erklären kann. Der zweite Teil fängt die beiden Wege, auf denen das Modell einen
  // Betrag nicht als Lücke schreibt — das Schema verlangt eine Pflichtzahl, also schreibt es eher
  // 0, oder es lässt die Position ganz weg.
  //
  // Ohne diese Sicherung verteilt die Hochrechnung den ganzen Rechnungsbetrag auf die Positionen,
  // die übrig sind, und das Ergebnis ist das gefährlichste, das hier entstehen kann: Die Summe
  // passt zum Beleg, jede einzelne Position ist aber zu hoch, und beim Prüfen fällt nichts auf.
  // Wird nicht gerechnet, bleiben die Positionen so stehen, wie sie auf der Rechnung stehen, und
  // stimmen damit mit dem Beleg überein, den der Nutzer vor sich hat; in der Schnellerfassung
  // meldet zusätzlich invoiceSumCheck, dass die Positionssumme nicht zur Rechnungssumme passt.
  if (
    positionsAreNet === true && allNetRead && positions.length > 0 && netSum > 0 && totalCents > 0
    && netSum < totalCents - tolerance(totalCents) && impliedVatPercent <= MAX_VAT_PERCENT
  ) {
    const rate = typeof vatRatePercent === 'number' && Number.isFinite(vatRatePercent) && vatRatePercent > 0 && vatRatePercent <= MAX_VAT_PERCENT
      ? vatRatePercent
      : null
    const raws = rate ? readNet.map((c) => c * (1 + rate / 100)) : readNet.map((c) => (c * totalCents) / netSum)
    const gross = largestRemainder(totalCents, raws, keys)
    positions.forEach((p, i) => { p.amountEur = toEur(gross[i]) })
    result.amountsAdjusted = 'netto'
  }

  // 2. Lohnanteil aus dem Gesamtbetrag, nach derselben Linie. Der Betrag gehört zur ganzen
  // Rechnung; fehlt eine Position, bekämen die übrigen deren Anteil mit dazu. Übernommen wird
  // eine Position ohne Betrag nicht (sie ist in der Oberfläche nicht einmal vorgehakt), am Ende
  // stünde also zu viel §35a in der Steuererklärung, und das ist bares Geld. Deshalb wird auch
  // hier nur verteilt, wenn jeder Betrag gelesen ist und die Positionen den Rechnungsbetrag
  // abdecken. Ohne bekannten Rechnungsbetrag lässt sich das nicht prüfen; dann bleibt es beim
  // Verteilen, denn die Summe ist die einzige Angabe, gegen die man prüfen könnte.
  const laborTotal = toCents(labor35aTotalEur) ?? 0
  const hasOwnLabor = positions.some((p) => (toCents(p.labor35aEur) ?? 0) > 0)
  const grossCents = positions.map((p) => toCents(p.amountEur))
  const readGross = grossCents.filter((c) => c !== null)
  const grossSum = readGross.reduce((a, b) => a + b, 0)
  const positionsCoverInvoice = totalCents <= 0 || Math.abs(grossSum - totalCents) <= tolerance(totalCents)
  if (
    laborTotal > 0 && !hasOwnLabor && readGross.length === grossCents.length && positionsCoverInvoice
    && grossSum > 0 && laborTotal <= grossSum
  ) {
    const parts = largestRemainder(laborTotal, readGross.map((c) => (c * laborTotal) / grossSum), keys)
    positions.forEach((p, i) => { p.labor35aEur = toEur(parts[i]) })
    result.laborFromTotal = true
  }
  return result
}
