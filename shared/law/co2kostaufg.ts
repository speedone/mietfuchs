// Parameter des CO2KostAufG (Heizung PR 6, Entwurf 4.3). Wortlaut geprüft am 05.10.2026 auf
// gesetze-im-internet.de: Gesetz vom 05.12.2022 (BGBl. I S. 2154), geändert durch Art. 5 G v.
// 23.07.2026 (BGBl. 2026 I Nr. 226). Die übrigen Parameter des Gesetzes kommen mit der PR, die sie
// nutzt (G-C7): § 8 und § 9 mit PR 7, Preise mit PR 17, §§ 5a, 5b, 5d mit PR 18, § 6 mit PR 19.
import { germanDate, type LawParam, type Source } from './register.ts'

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

// ---------- Heizung PR 7 ----------

// Nichtwohngebäude (§ 8 Abs. 1 CO2KostAufG): Vereinbarungen, nach denen der Mieter mehr als 50 Prozent
// der CO₂-Kosten trägt, sind unwirksam; ein Nichtwohngebäude dient nach seiner Zweckbestimmung nicht
// überwiegend dem Wohnen (Satz 2). Der Wert ist der Anteil des Vermieters in Promille, wie
// `service_landlord_permille`.
export const co2NonResidential: LawParam<number, 'periodStart'> = {
  id: 'co2.non-residential',
  title: 'Anteil des Vermieters im Nichtwohngebäude',
  norm: '§ 8 Abs. 1 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: 500, source: checked('§ 8 Abs. 1 CO2KostAufG', '__8.html'), enacted: ENACTED }],
  describe: (v) => `Vermieter mindestens ${v} ‰ (Mieter höchstens die Hälfte)`,
}

// Beschränkungen bei energetischen Verbesserungen (§ 9 CO2KostAufG): Stehen öffentlich-rechtliche
// Vorgaben einer wesentlichen energetischen Verbesserung des Gebäudes oder einer wesentlichen
// Verbesserung der Wärme- und Warmwasserversorgung entgegen, ist der prozentuale Anteil des Vermieters
// nach § 5, 6, 7 oder 8 um die Hälfte zu kürzen (Abs. 1); stehen sie beidem entgegen, erfolgt keine
// Aufteilung (Abs. 2). Berufen darf sich der Vermieter darauf nur mit Nachweis (Abs. 3); das sagt der
// Hinweis, gerechnet wird mit der Angabe an der Anlage.
export const co2Restriction: LawParam<{ readonly factor: number; readonly bothSplit: boolean }, 'periodStart'> = {
  id: 'co2.restriction',
  title: 'Beschränkung bei energetischen Verbesserungen',
  norm: '§ 9 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: { factor: 0.5, bothSplit: false }, source: checked('§ 9 CO2KostAufG', '__9.html'), enacted: ENACTED }],
  describe: (v) => `Anteil des Vermieters × ${String(v.factor).replace('.', ',')}; bei beiden Vorgaben ${v.bothSplit ? 'Aufteilung' : 'keine Aufteilung'}`,
}

// Wärme aus Anlagen im Europäischen Emissionshandel (§ 2 Abs. 4 CO2KostAufG): Das Gesetz gilt auch für
// sie (Satz 1), aber nicht für Gebäude, die erstmals nach dem 1. Januar 2023 einen Wärmeanschluss
// erhalten haben (Satz 2). Der Stichtag steht hier, weil die Frage an der Anlage ihn nennt.
export const co2DistrictEtsNew: LawParam<{ readonly connectedAfter: string }, 'periodStart'> = {
  id: 'co2.district-ets-new',
  title: 'Wärme aus dem Emissionshandel bei neuem Anschluss',
  norm: '§ 2 Abs. 4 Satz 2 CO2KostAufG',
  timing: 'periodStart',
  versions: [{ value: { connectedAfter: '2023-01-01' }, source: checked('§ 2 Abs. 4 Satz 2 CO2KostAufG', '__2.html'), enacted: ENACTED }],
  describe: (v) => `nicht anzuwenden bei erstem Wärmeanschluss nach dem ${germanDate(v.connectedAfter)}`,
}

// CO₂-Kosten aus Brennstoff, der vor dem 01.01.2023 in Rechnung gestellt wurde, bleiben
// unberücksichtigt (§ 11 Abs. 2 Satz 2: „Kohlendioxidkosten, die aufgrund des Verbrauchs von
// Brennstoffmengen anfallen, die vor dem 1. Januar 2023 in Rechnung gestellt worden sind, bleiben
// unberücksichtigt.“). Seine kg zählen für die Einstufung (Entwurf 3.9). Zeitregel `eventDate`: Es
// zählt das Datum der Rechnung. `true` heißt „unberücksichtigt“. Heizung PR 8, für den Vorrat.
export const co2CostsBefore: LawParam<boolean, 'eventDate'> = {
  id: 'co2.costs-before',
  title: 'CO₂-Kosten aus Rechnungen vor 2023',
  norm: '§ 11 Abs. 2 Satz 2 CO2KostAufG',
  timing: 'eventDate',
  versions: [
    { validTo: '2022-12-31', value: true, source: checked('§ 11 Abs. 2 Satz 2 CO2KostAufG', '__11.html'), enacted: ENACTED },
    { validFrom: '2023-01-01', value: false, source: checked('§ 11 Abs. 2 Satz 2 CO2KostAufG', '__11.html'), enacted: ENACTED },
  ],
  describe: (v) => (v ? 'unberücksichtigt (in Rechnung gestellt vor dem 01.01.2023)' : 'berücksichtigt'),
}

// Die beiden Grenztage aus den Fassungen, für einen Altbestand, dessen Rechnung Mietfuchs nur als
// „vor dem 01.01.2023“ kennt, und für Texte. Gerechnet wird mit `law(co2CostsBefore, …)`.
export function co2CostsExcludedUntil(): string {
  const last = co2CostsBefore.versions.find((v) => v.value)?.validTo
  if (!last) throw new Error('Rechtsregister: Ende des § 11 Abs. 2 Satz 2 fehlt')
  return last
}
export function co2CostsCountedFrom(): string {
  const first = co2CostsBefore.versions.find((v) => !v.value)?.validFrom
  if (!first) throw new Error('Rechtsregister: Beginn der berücksichtigten CO₂-Kosten fehlt')
  return first
}
