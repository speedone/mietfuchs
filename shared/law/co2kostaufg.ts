// Parameter des CO2KostAufG (Heizung PR 6, Entwurf 4.3). Wortlaut geprüft am 05.10.2026 auf
// gesetze-im-internet.de: Gesetz vom 05.12.2022 (BGBl. I S. 2154), geändert durch Art. 5 G v.
// 23.07.2026 (BGBl. 2026 I Nr. 226). Die übrigen Parameter des Gesetzes kommen mit der PR, die sie
// nutzt (G-C7): § 8 und § 9 mit PR 7, Preise mit PR 17 (unten), §§ 5a, 5b, 5d mit PR 18, § 6 mit PR 19.
import { germanDate, type LawParam, type Source, type Version } from './register.ts'

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

// ---------- Preise und Standardwerte (Heizung PR 17, #97) ----------
// Gebraucht nur für die Plausibilität (Entwurf 4.5): Keine Abrechnungszahl hängt an ihnen. Ins
// Register kommt nur amtlich Veröffentlichtes: was im BGBl. steht oder was das Umweltbundesamt nach
// § 4 Abs. 2 und 3 CO2KostAufG bekanntmacht (die DEHSt gehört zum UBA); keine Drucksachen.

const euro2 = (v: number): string => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const yearVersion = <T extends number | null>(year: number, value: T, source: Source, enacted: string): Version<T> =>
  ({ validFrom: `${year}-01-01`, validTo: `${year}-12-31`, value, source, enacted })
const BEHG = 'Brennstoffemissionshandelsgesetz vom 12. Dezember 2019 (BGBl. I S. 2728; 2022 I S. 2098), das zuletzt durch Artikel 2 des Gesetzes vom 27. Februar 2025 (BGBl. 2025 I Nr. 70) geändert worden ist; § 10 Abs. 2'
const behg = (cite: string): Source => ({ rank: 'law', cite, url: 'https://www.gesetze-im-internet.de/behg/__10.html', retrieved: '2026-10-05', checked: 'checked' })

// Preis je Tonne CO₂ zum Zeitpunkt der Lieferung (§ 3 Abs. 3, § 4 Abs. 1): bis 2025 der Festpreis nach
// § 10 Abs. 2 Satz 2 BEHG (2021: 25 €, 2022: 30 €, 2023: 30 €, 2024: 45 €, 2025: 55 €), 2026 der Mittelwert
// des Preiskorridors nach § 10 Abs. 2 Satz 4 BEHG (55 bis 65 €, also 60 €; kein Festpreis, D-H4; die
// DEHSt nennt 60 €), ab 2027 der Durchschnittspreis der Versteigerungen vom 01.07. bis 30.11. des
// Vorjahres, den das UBA spätestens zehn Werktage vor Jahresbeginn veröffentlicht (§ 4 Abs. 1 Nr. 3,
// Abs. 2). Bis dahin `null` und überschreibbar (4.5). 2022 steht dabei, obwohl CO₂-Kosten aus Rechnungen
// vor dem 01.01.2023 unberücksichtigt bleiben (§ 11 Abs. 2 Satz 2): Die Vorschrift knüpft an die Rechnung
// an, und eine Lieferung von 2022 mit Rechnung von 2023 zählt mit dem Preis zum Zeitpunkt der Lieferung
// (§ 3 Abs. 3). 2021 aus demselben Grund für eine sehr späte Rechnung und damit die Fassungen mit dem
// ersten Festpreis beginnen; praktisch kommt sie kaum vor (Durchsicht von #246, R-K9).
export const co2Price: LawParam<number | null, 'deliveryYear'> = {
  id: 'co2.price',
  checkOnly: true,
  title: 'CO₂-Preis je Tonne (Plausibilität)',
  norm: '§ 3 Abs. 3, § 4 Abs. 1 CO2KostAufG',
  timing: 'deliveryYear',
  versions: [
    yearVersion(2021, 25, behg('§ 4 Abs. 1 Nr. 1 CO2KostAufG; § 10 Abs. 2 Satz 2 Nr. 1 BEHG'), BEHG),
    yearVersion(2022, 30, behg('§ 4 Abs. 1 Nr. 1 CO2KostAufG; § 10 Abs. 2 Satz 2 Nr. 2 BEHG'), BEHG),
    yearVersion(2023, 30, behg('§ 4 Abs. 1 Nr. 1 CO2KostAufG; § 10 Abs. 2 Satz 2 Nr. 3 BEHG'), BEHG),
    yearVersion(2024, 45, behg('§ 4 Abs. 1 Nr. 1 CO2KostAufG; § 10 Abs. 2 Satz 2 Nr. 4 BEHG'), BEHG),
    yearVersion(2025, 55, behg('§ 4 Abs. 1 Nr. 1 CO2KostAufG; § 10 Abs. 2 Satz 2 Nr. 5 BEHG'), BEHG),
    yearVersion(2026, 60, checked('§ 4 Abs. 1 Nr. 2 CO2KostAufG; § 10 Abs. 2 Satz 4 BEHG (Mittelwert des Korridors 55 bis 65 €)', '__4.html'), ENACTED),
    { validFrom: '2027-01-01', value: null, source: checked('§ 4 Abs. 1 Nr. 3, Abs. 2 CO2KostAufG (Veröffentlichung des UBA steht aus)', '__4.html'), enacted: ENACTED },
  ],
  describe: (v) => (v === null ? 'noch nicht veröffentlicht' : `${euro2(v)} €/t`),
  overridable: { reason: 'Das Umweltbundesamt veröffentlicht den Preis spätestens zehn Werktage vor Beginn des Jahres (§ 4 Abs. 2 CO2KostAufG).', max: 1000, unit: '€/t' },
}

// Durchschnittspreis der Versteigerungen im EU-Emissionshandel für den Anteil einer Wärmelieferung aus
// Anlagen des Emissionshandels (§ 3 Abs. 4 Nr. 4 b): der des Kalenderjahres vor der Rechnungsstellung,
// veröffentlicht vom UBA bis 31.03. des Folgejahres (§ 4 Abs. 3). Die Fassungen tragen das Rechnungsjahr,
// wie die DEHSt sie nennt (Abweichung 4 des Plans): Rechnungsjahr 2023 ↔ Berichtsjahr 2022.
const DEHST: Source = {
  rank: 'law',
  cite: '§ 3 Abs. 4 Nr. 4 b, § 4 Abs. 3 CO2KostAufG; Veröffentlichung der DEHSt (Stand 16.12.2025)',
  url: 'https://www.dehst.de/DE/Themen/nEHS/Verkauf-Versteigerung/Kohlendioxidkostenaufteilungsgesetz/kohlendioxidkostenaufteilungsgesetz_node.html',
  retrieved: '2026-10-05',
  checked: 'checked',
}
export const co2PriceEts: LawParam<number | null, 'eventDate'> = {
  id: 'co2.price-ets',
  checkOnly: true,
  title: 'Durchschnittspreis des EU-Emissionshandels (Plausibilität)',
  norm: '§ 3 Abs. 4 Nr. 4 b, § 4 Abs. 3 CO2KostAufG',
  timing: 'eventDate',
  versions: [
    yearVersion(2023, 80.4, DEHST, ENACTED),
    yearVersion(2024, 83.68, DEHST, ENACTED),
    yearVersion(2025, 65.01, DEHST, ENACTED),
    yearVersion(2026, 73.86, DEHST, ENACTED),
    { validFrom: '2027-01-01', value: null, source: DEHST, enacted: ENACTED },
  ],
  describe: (v) => (v === null ? 'noch nicht veröffentlicht' : `${euro2(v)} €/t (Durchschnitt des Vorjahres der Rechnung)`),
  overridable: {
    reason: 'Das Umweltbundesamt veröffentlicht den Durchschnittspreis eines Jahres spätestens bis zum 31. März des Folgejahres (§ 4 Abs. 3 CO2KostAufG); er gilt für Rechnungen aus dem Folgejahr.',
    max: 1000,
    unit: '€/t',
    yearLabel: (year) => `für Rechnungen aus ${year} (Durchschnitt der Versteigerungen ${year - 1})`,
  },
}

// Standardwerte der EBeV 2030, Anlage 2 Teil 4 (BGBl. I 2022, 2881; Vollzitat
// „Emissionsberichterstattungsverordnung 2030 vom 21. Dezember 2022 (BGBl. I S. 2868)“, ohne spätere
// Änderung): Nr. 6 Erdgas 0,0558 t CO₂/GJ, Umrechnungsfaktor 3,2508 GJ/MWh (Brennwert in Heizwert);
// Nr. 3b Heizöl EL 0,074 t CO₂/GJ, Dichte 0,845 t/1000 l, Heizwert 42,8 GJ/t; Nr. 5b Flüssiggas zu
// Heizzwecken 0,0655 t CO₂/GJ, Heizwert 46,0 GJ/t. Für das Lieferjahr maßgeblich (§ 3 Abs. 2 Satz 1
// CO2KostAufG); die EBeV 2030 gilt für 2023 bis 2030 (§ 1). Kohle fehlt bewusst (Abweichung 6 des Plans):
// Anlage 2 Teil 4 Nr. 9 hat viele Sorten mit eigenen Werten.
export type EbevFactors = {
  readonly gas: { readonly tPerGj: number; readonly hsGjPerMwh: number }
  readonly oil: { readonly tPerGj: number; readonly tPerM3: number; readonly gjPerT: number }
  readonly lpg: { readonly tPerGj: number; readonly gjPerT: number }
}
export const co2EbevFactors: LawParam<EbevFactors, 'deliveryYear'> = {
  id: 'co2.ebev-factors',
  checkOnly: true,
  title: 'Standardwerte der Brennstoffemissionen (Plausibilität)',
  norm: '§ 3 Abs. 2 CO2KostAufG; Anlage 2 Teil 4 EBeV 2030',
  timing: 'deliveryYear',
  versions: [{
    validFrom: '2023-01-01',
    validTo: '2030-12-31',
    value: { gas: { tPerGj: 0.0558, hsGjPerMwh: 3.2508 }, oil: { tPerGj: 0.074, tPerM3: 0.845, gjPerT: 42.8 }, lpg: { tPerGj: 0.0655, gjPerT: 46.0 } },
    source: { rank: 'law', cite: 'Anlage 2 Teil 4 Nr. 3b, 5b, 6 EBeV 2030', url: 'https://www.gesetze-im-internet.de/ebev_2030/anlage_2.html', retrieved: '2026-10-05', checked: 'checked' },
    enacted: 'Emissionsberichterstattungsverordnung 2030 vom 21. Dezember 2022 (BGBl. I S. 2868)',
  }],
  // Mit allen Stellen der Verordnung (Durchsicht von #246, R-W3): gerundet stünde bei Erdgas 0,056, der Wert
  // der EBeV 2022, und der Rechtsstand nennte die falsche Verordnung.
  describe: (v) => {
    const n = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 6 })
    return `Erdgas ${n(v.gas.tPerGj)} t CO₂/GJ, ${n(v.gas.hsGjPerMwh)} GJ/MWh nach Brennwert; Heizöl EL ${n(v.oil.tPerGj)} t CO₂/GJ, ${n(v.oil.tPerM3)} t/1000 l, ${n(v.oil.gjPerT)} GJ/t; Flüssiggas ${n(v.lpg.tPerGj)} t CO₂/GJ, ${n(v.lpg.gjPerT)} GJ/t`
  },
}
