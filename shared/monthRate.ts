// Die Staffel einer Kaltmiete oder Vorauszahlung: ab dem Monat `from` ('JJJJ-MM') gilt `monthlyCents`.
export type MonthlySchedule = { from: string, monthlyCents: number }

const MS_DAY = 86400000
const toUTC = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

// Überlappung zweier Zeiträume in Tagen (alle Grenzen inklusiv, ISO-Daten, end=null = offen), wie
// `rangeOverlapDays` in server/src/calc.ts.
function overlapDays(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): number {
  const s = Math.max(toUTC(aStart), toUTC(bStart))
  const e = Math.min(aEnd ? toUTC(aEnd) : Infinity, bEnd ? toUTC(bEnd) : Infinity)
  if (e < s) return 0
  return Math.round((e - s) / MS_DAY) + 1
}

// **Die Monatsregel (#311), eine Stelle für Abrechnung, Mietkonto und das Formular des
// Mietverhältnisses** (server/src/calc.ts rechnet damit, client/src/tenancyModel.ts zeigt den Anteil
// im Ein- und Auszugsmonat am Feld). Ein Monat zählt, wenn das
// Mietverhältnis an mindestens einem seiner Tage besteht (`days > 0`, inklusive Grenzen wie überall,
// §§ 187 Abs. 2, 188 BGB: Mietbeginn am 15. zählt den 15. mit, Mietende am 15. heißt Ablauf dieses
// Tages). Im angebrochenen Ein- und Auszugsmonat gilt die Staffelrate nach Kalendertagen:
// round(Rate × Tage im Mietverhältnis / Tage des Kalendermonats), je Monat in Cent; ein voller Monat
// ergibt die Rate ohne Rundung. Vorher zählte ein Monat nur, wenn das Mietverhältnis am Monatsersten
// bestand: Im Einzugsmonat fehlte die ganze Rate, im Auszugsmonat stand sie voll da.
//
// **Das ist eine Auslegung von Mietfuchs** (wie `VACANCY_PERSONS`, #177). Ein Gesetz oder eine
// BGH-Entscheidung zur Teilmonatsmiete gibt es nicht. Getragen ist sie davon, dass die Miete Entgelt
// für die Gebrauchsüberlassung ist (§ 535 BGB) und außerhalb der Mietzeit keine geschuldet ist, mangels
// Abrede also anteilig (so für ein nach Monaten bemessenes Entgelt AG Hamburg, 29.04.2022, 48 C 305/21,
// eine Kleingartenpacht, nur als Beispiel aus der Instanz). Der Teiler sind die Kalendertage, weil die
// Kostenseite derselben Abrechnung tagesgenau nach Kalendertagen verteilt; 1/30 je Tag nach der Wertung
// des § 191 BGB (BAG 5 AZR 251/11 im Arbeitsrecht) ist ebenso vertretbar und weicht um Euro-Beträge ab
// (bei 150 € und Einzug am 15. sind es 2,74 € im März 2025 und 5,00 € im Februar 2025). Maßgeblich bleibt, was der Mieter für den Zeitraum
// tatsächlich geleistet hat (BGH VIII ZR 240/10 vom 18.05.2011, Rn. 16); dafür ist die Jahreskorrektur
// da, und `prepayment.partial-month` weist darauf hin.
export function monthShare(t: { start: string, end: string | null }, month: string): { days: number, of: number } {
  const of = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  return { days: overlapDays(t.start, t.end, `${month}-01`, `${month}-${String(of).padStart(2, '0')}`), of }
}

// Staffelbetrag, der am Monatsersten gilt (für Kaltmiete oder Vorauszahlung).
// `schedule`: Array aus { from: 'YYYY-MM', monthlyCents }. firstMonth: 'YYYY-MM'.
export function rateAtMonth(schedule: readonly MonthlySchedule[], firstMonth: string): number {
  let rate = 0
  for (const e of schedule.slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) {
    if (e.from <= firstMonth) rate = e.monthlyCents
  }
  return rate
}

// Die Staffelrate eines Monats nach der Monatsregel: 0 ohne Tag im Mietverhältnis, die Rate im vollen
// Monat, sonst tagesanteilig auf Cent gerundet. Wer zählt, ob ein Monat dazugehört, fragt
// `monthShare(…).days > 0`; wer rechnet, nimmt diese Funktion. Gerundet wird je Monat und
// Mietverhältnis (R-1). Beim Mieterwechsel im Monat ergeben die beiden Anteile deshalb nicht immer
// genau eine Rate: Meist passt es (100 € und 10/31 + 21/31 sind 32,26 € + 67,74 €), aber fallen beide
// Anteile genau auf einen halben Cent, runden beide auf, bei 150,01 € und 15/30 + 15/30 also je
// 75,01 €, zusammen 1 Cent mehr als die Rate. Mit gleicher Rate bei beiden Mietern kann so höchstens
// 1 Cent zu viel entstehen, bei verschiedenen Raten ist die Summe ohnehin keine Rate. Das ist gewollt
// und kein Fehler: Jeder Mieter schuldet seinen eigenen Anteil, einen gemeinsamen Restcent wie bei
// `distributeCents` gibt es zwischen zwei Mietverhältnissen nicht.
export function rateInMonth(schedule: readonly MonthlySchedule[], t: { start: string, end: string | null }, month: string): number {
  const { days, of } = monthShare(t, month)
  if (days === 0) return 0
  const rate = rateAtMonth(schedule, month)
  if (days >= of) return rate
  return Math.sign(rate) * Math.round(Math.abs(rate) * days / of)
}
