// Parameter des CO2KostAufG (Heizung PR 6, Entwurf 4.3). Wortlaut geprüft am 05.10.2026 auf
// gesetze-im-internet.de: Gesetz vom 05.12.2022 (BGBl. I S. 2154), geändert durch Art. 5 G v.
// 23.07.2026 (BGBl. 2026 I Nr. 226). Die übrigen Parameter des Gesetzes kommen mit der PR, die sie
// nutzt (G-C7): § 8 und § 9 mit PR 7, Preise mit PR 17, §§ 5a, 5b, 5d mit PR 18, § 6 mit PR 19.
import type { LawParam, Source } from './register.ts'

const ENACTED = 'CO2KostAufG vom 05.12.2022 (BGBl. I S. 2154), geändert durch Art. 5 G v. 23.07.2026 (BGBl. 2026 I Nr. 226)'
const BASE = 'https://www.gesetze-im-internet.de/co2kostaufg/'
const checked = (cite: string, page: string): Source => ({ rank: 'law', cite, url: `${BASE}${page}`, retrieved: '2026-10-05', checked: 'checked' })

// Die Aufteilung gilt für Abrechnungszeiträume der Wärme- und Warmwasserkosten, die am oder nach
// dem 01.01.2023 beginnen (§ 11 Abs. 2 Satz 1). `periodStart`: Es zählt der Beginn der
// Heizperiode. Die Fassung davor sagt „nicht anwendbar“, damit die Fassungen lückenlos sind und ein
// Zeitraum von 2022 eine Antwort bekommt statt eines Programmfehlers.
export const co2ApplicableFrom: LawParam<boolean, 'periodStart'> = {
  id: 'co2.applicable-from',
  title: 'Aufteilung der CO₂-Kosten anwendbar',
  norm: '§ 11 Abs. 2 Satz 1 CO2KostAufG',
  timing: 'periodStart',
  versions: [
    { validTo: '2022-12-31', value: false, source: checked('§ 11 Abs. 2 Satz 1 CO2KostAufG', '__11.html'), enacted: ENACTED },
    { validFrom: '2023-01-01', value: true, source: checked('§ 11 Abs. 2 Satz 1 CO2KostAufG', '__11.html'), enacted: ENACTED },
  ],
  describe: (v) => (v ? 'anwendbar (Zeitraum beginnt am oder nach dem 01.01.2023)' : 'nicht anwendbar (Zeitraum beginnt vor dem 01.01.2023)'),
}

// Der erste Tag, an dem ein Zeitraum beginnen kann, für den die Aufteilung gilt. Für Texte und für
// den Hinweis zum ersten Jahr; gerechnet wird mit `law(co2ApplicableFrom, …)`.
export function co2FirstPeriodStart(): string {
  const first = co2ApplicableFrom.versions.find((v) => v.value)?.validFrom
  if (!first) throw new Error('Rechtsregister: Beginn der CO₂-Aufteilung fehlt')
  return first
}

// Eine Stufe der Einstufungstabelle: ab `from` kg CO₂ je m² Wohnfläche und Jahr (einschließlich)
// bis zur nächsten Stufe (ausschließlich), mit dem Anteil des Vermieters in Prozent; der Anteil des
// Mieters ist der Rest auf 100.
export type Co2Stage = { readonly from: number; readonly landlordPercent: number }

// Anlage zu §§ 5 bis 7 (BGBl. I 2022, 2159): „< 12“ 100/0, „12 bis < 17“ 90/10 … „> = 52“ 5/95.
export const co2StageTable: LawParam<readonly Co2Stage[], 'periodStart'> = {
  id: 'co2.stage-table',
  title: 'Stufentabelle der CO₂-Kosten',
  norm: 'Anlage zu §§ 5 bis 7 CO2KostAufG',
  timing: 'periodStart',
  versions: [{
    value: [
      { from: 0, landlordPercent: 0 },
      { from: 12, landlordPercent: 10 },
      { from: 17, landlordPercent: 20 },
      { from: 22, landlordPercent: 30 },
      { from: 27, landlordPercent: 40 },
      { from: 32, landlordPercent: 50 },
      { from: 37, landlordPercent: 60 },
      { from: 42, landlordPercent: 70 },
      { from: 47, landlordPercent: 80 },
      { from: 52, landlordPercent: 95 },
    ],
    source: checked('Anlage CO2KostAufG (BGBl. I 2022, 2159)', 'anlage.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v.length} Stufen, Vermieteranteil ${v[0]?.landlordPercent ?? 0} bis ${v.at(-1)?.landlordPercent ?? 0} %`,
}

// Der spezifische Ausstoß ist auf die erste Nachkommastelle zu runden (§ 5 Abs. 1 Satz 3).
export const co2RoundingDecimals: LawParam<number, 'periodStart'> = {
  id: 'co2.rounding-decimals',
  title: 'Rundung des CO₂-Ausstoßes je m²',
  norm: '§ 5 Abs. 1 Satz 3 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: 1, source: checked('§ 5 Abs. 1 Satz 3 CO2KostAufG', '__5.html'), enacted: ENACTED }],
  describe: (v) => `auf ${v} Nachkommastelle${v === 1 ? '' : 'n'}`,
}

// Bestimmt der Vermieter den Anteil des Mieters nicht oder weist er die Angaben nach Abs. 3 nicht
// aus, darf der Mieter seinen Anteil an den Heizkosten um 3 % kürzen (§ 7 Abs. 4).
export const co2CutMissing: LawParam<number, 'periodStart'> = {
  id: 'co2.cut.missing',
  title: 'Kürzung bei fehlender CO₂-Aufteilung',
  norm: '§ 7 Abs. 4 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: 3, source: checked('§ 7 Abs. 4 CO2KostAufG', '__7.html'), enacted: ENACTED }],
  describe: (v) => `${v} %`,
}
