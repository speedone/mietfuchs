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
// `Extraction` in shared/types.ts; dorthin führt `toExtraction` in extract.ts, und nur dort.
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
  // Gerechnet wird damit nicht mehr (siehe unten), abgetrennt schon: Ein Tab von vor dem Update
  // schickt das Feld noch, und in der Oberfläche hat es nichts verloren.
  vatRatePercent?: unknown
  labor35aTotalEur?: unknown
  totalGrossEur?: unknown
  // Auch das, obwohl es hier als Liste gebraucht wird: Ein Modell kann etwas anderes schicken,
  // und wer die Positionen liest, prüft das selbst (`Array.isArray`). Ein enger Typ ließe diese
  // Prüfungen wie toten Code aussehen und wäre doch nur eine Behauptung.
  positions?: unknown
  amountsAdjusted?: Extraction['amountsAdjusted']
  laborFromTotal?: Extraction['laborFromTotal']
  [key: string]: unknown
}

const toCents = (eur: unknown): number | null => (typeof eur === 'number' && Number.isFinite(eur) ? Math.round(eur * 100) : null)
const toEur = (cents: number): number => Math.round(cents) / 100
// Wie in der Schnellerfassung: kleine Abweichungen sind Rundung, keine fehlende Umsatzsteuer
const tolerance = (totalCents: number): number => Math.max(50, Math.round(totalCents * 0.02))

// Der Regelsatz der Umsatzsteuer, dazu eine halbe Prozentstelle für Rundung. Mehr als den
// Regelsatz gibt es in Deutschland nicht; nach unten ist alles bis 0 möglich, weil eine Rechnung
// ermäßigte (7 Prozent) und steuerfreie Anteile mischen kann.
const VAT_PERCENT = 19
const VAT_ROUNDING_PERCENT = 0.5

// Lässt sich der Abstand zwischen Positionssumme und Rechnungsbetrag durch Umsatzsteuer
// erklären? An dieser Frage hängt in diesem Modul alles, denn ein größerer Abstand heißt: Die
// Positionen beschreiben nicht die ganze Rechnung, es fehlt eine.
//
// Geprüft wird gegen das, was der Abstand sein soll, und nicht gegen eine großzügige Obergrenze.
// Eine Schranke von 30 Prozent etwa ließe bei 19 Prozent Steuer eine fehlende Position von 9
// Prozent durch und bei 7 Prozent eine von 21; jede Position wäre dann um genau diesen Anteil zu
// hoch, und beim Prüfen fiele nichts auf. Gegen den Regelsatz gemessen fällt bei 19 Prozent schon
// ein fehlendes halbes Prozent auf.
//
// Ein Rechnungsbetrag unter der Positionssumme ist dagegen kein Zeichen für eine fehlende
// Position, sondern für eine Abschlagszahlung, und ein gar nicht bekannter Rechnungsbetrag ist
// überhaupt kein Zeichen. Beides blockt deshalb nicht.
const vatExplainsGap = (positionCents: number, totalCents: number): boolean =>
  positionCents > 0 && totalCents <= positionCents * (1 + (VAT_PERCENT + VAT_ROUNDING_PERCENT) / 100)

export function normalizeAmounts(extraction: RawExtraction | null | undefined) {
  // Die drei Hilfsfelder des Modells verlassen die Auswertung nicht. Mit `vatRatePercent`
  // gerechnet wird nicht mehr (siehe unten), abgetrennt wird es trotzdem: In der Oberfläche hat
  // es nichts verloren.
  const { positionsAreNet, vatRatePercent: _rate, labor35aTotalEur, ...result } = extraction ?? {}
  const positions: RawPosition[] = Array.isArray(result.positions) ? result.positions.map((p) => ({ ...p })) : []
  result.positions = positions
  const keys = positions.map((_, i) => String(i))
  const totalCents = toCents(result.totalGrossEur) ?? 0
  // `null` heißt „nicht gelesen“ und ist etwas anderes als 0: Eine Position kann laut Rechnung
  // nichts kosten (mitversicherte Leistung, Gutschriftszeile), und dann stimmt alles.
  const netCents = positions.map((p) => toCents(p.amountEur))
  const readNet = netCents.filter((c) => c !== null)
  const allNetRead = readNet.length === netCents.length
  const netSum = readNet.reduce((a, b) => a + b, 0)

  // 1. Netto auf brutto. Vier Bedingungen, und jede verhindert einen eigenen Schaden:
  // `positionsAreNet` ist der Anlass, ohne den nichts zu rechnen ist; der Abstand muss größer
  // sein als die Rundung, sonst gibt es nichts zu tun; jeder Betrag muss gelesen sein, sonst
  // rechnet die Verteilung an einer Position vorbei und schreibt ihr ein NaN; und der Abstand
  // muss durch Umsatzsteuer erklärbar sein, sonst fehlt eine Position.
  //
  // Die letzte Bedingung fängt die beiden Wege, auf denen ein Betrag fehlt, ohne zu fehlen: Das
  // Schema verlangt eine Pflichtzahl, also schreibt ein Modell eher 0, oder es lässt die Position
  // ganz weg. Ohne sie verteilt die Hochrechnung den ganzen Rechnungsbetrag auf die Positionen,
  // die übrig sind, und das Ergebnis ist das gefährlichste, das hier entstehen kann: Die Summe
  // passt zum Beleg, jede einzelne Position ist aber zu hoch, und beim Prüfen fällt nichts auf.
  //
  // Wird nicht gerechnet, bleiben die Positionen so stehen, wie sie auf der Rechnung stehen. Das
  // ist die Sicherung: Was der Nutzer sieht, steht genauso auf dem Beleg vor ihm. In der
  // Schnellerfassung kommt der Vergleich mit der Rechnungssumme dazu (invoiceSumCheck); auf der
  // Kostenseite gibt es ihn nicht, dort bleibt es beim Blick auf den Beleg.
  if (
    positionsAreNet === true && allNetRead
    && netSum < totalCents - tolerance(totalCents) && vatExplainsGap(netSum, totalCents)
  ) {
    // Immer anteilig, nie mit einem genannten Steuersatz. Das Restverfahren normiert ohnehin auf
    // den Rechnungsbetrag, bei richtigem Satz kommt deshalb in jeder Position dasselbe heraus.
    // Bei falschem Satz dagegen verteilt es die Differenz reihum: Aus 9,90 und 0,10 wurden bei
    // genanntem Satz 30 und Rechnungsbetrag 11,00 die Beträge 11,87 und -0,87. Der
    // Rechnungsbetrag ist die härtere Angabe als ein Satz, den das Modell gelesen haben will.
    const gross = largestRemainder(totalCents, readNet.map((c) => (c * totalCents) / netSum), keys)
    positions.forEach((p, i) => { p.amountEur = toEur(gross[i]) })
    result.amountsAdjusted = 'netto'
  }

  // 2. Lohnanteil aus dem Gesamtbetrag, nach derselben Linie und mit derselben Prüfung. Der
  // Betrag gehört zur ganzen Rechnung; fehlt eine Position, bekämen die übrigen deren Anteil mit
  // dazu. Übernommen wird eine Position ohne Betrag nicht (sie ist in der Oberfläche nicht einmal
  // vorgehakt), am Ende stünde also zu viel §35a in der Steuererklärung, und das ist bares Geld.
  //
  // Zu streng darf die Prüfung deshalb auch nicht sein, denn ein ausbleibender Lohnanteil kostet
  // denselben Nutzer dieselbe Steuer. Eine Nettorechnung ohne gesetztes Kennzeichen und eine
  // Abschlagszahlung sind vollständig, obwohl ihre Positionssumme nicht dem Rechnungsbetrag
  // entspricht; beide gehen durch, weil `vatExplainsGap` genau das beschreibt.
  const laborTotal = toCents(labor35aTotalEur) ?? 0
  const hasOwnLabor = positions.some((p) => (toCents(p.labor35aEur) ?? 0) > 0)
  const grossCents = positions.map((p) => toCents(p.amountEur))
  const readGross = grossCents.filter((c) => c !== null)
  const allGrossRead = readGross.length === grossCents.length
  const grossSum = readGross.reduce((a, b) => a + b, 0)
  if (
    laborTotal > 0 && !hasOwnLabor && allGrossRead
    && vatExplainsGap(grossSum, totalCents) && laborTotal <= grossSum
  ) {
    const parts = largestRemainder(laborTotal, readGross.map((c) => (c * laborTotal) / grossSum), keys)
    positions.forEach((p, i) => { p.labor35aEur = toEur(parts[i]) })
    result.laborFromTotal = true
  }
  return result
}
