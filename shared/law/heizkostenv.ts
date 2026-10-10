// Parameter der Heizkostenverordnung (Heizung PR 1, Entwurf 4.3). Wortlaut geprüft am 05.10.2026
// auf gesetze-im-internet.de, Fassung Art. 3 G v. 16.10.2023 (BGBl. I Nr. 280); das Gesetz vom
// 23.07.2026 ändert die Verordnung nicht (Entwurf Abschnitt 2).
import type { LawParam, Source } from './register.ts'
import { germanDate } from './register.ts'
import type { HeatingValueTable } from '../types.ts'

const ENACTED = 'HeizkostenV, Fassung Art. 3 G v. 16.10.2023 (BGBl. I Nr. 280)'
const checked = (cite: string, url: string): Source => ({ rank: 'law', cite, url, retrieved: '2026-10-05', checked: 'checked' })

// Mindestens 50 und höchstens 70 % der Kosten nach erfasstem Verbrauch, für Heizung (§ 7 Abs. 1
// Satz 1) wie für Warmwasser (§ 8 Abs. 1). Gilt die Fassung am Beginn des Zeitraums.
export const hkvConsumptionShare: LawParam<{ readonly min: number; readonly max: number }, 'periodStart'> = {
  id: 'hkv.consumption-share',
  title: 'Anteil der Kosten nach Verbrauch',
  norm: '§ 7 Abs. 1 Satz 1, § 8 Abs. 1 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: { min: 50, max: 70 },
    source: checked('§ 7 Abs. 1 Satz 1, § 8 Abs. 1 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__7.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v.min} bis ${v.max} %`,
}

// Kürzung um 15 %, wenn nicht verbrauchsabhängig abgerechnet wird (§ 12 Abs. 1 Satz 1).
export const hkvCutNotByConsumption: LawParam<number, 'periodStart'> = {
  id: 'hkv.cut.not-by-consumption',
  title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung',
  norm: '§ 12 Abs. 1 Satz 1 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: 15,
    source: checked('§ 12 Abs. 1 Satz 1 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__12.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v} %`,
}

// Kürzung um 3 %, wenn Geräte entgegen § 5 Abs. 2 oder 3 nicht fernablesbar sind (§ 12 Abs. 1
// Satz 2). Ob ein Gerät betroffen ist, sagen die beiden Parameter zur Fernablesbarkeit; dieser
// nennt nur die Höhe (N6 der dritten Fassung: eine Zeitregel je Parameter).
export const hkvCutRemoteReading: LawParam<number, 'periodStart'> = {
  id: 'hkv.cut.remote-reading',
  title: 'Kürzung bei nicht fernablesbaren Geräten',
  norm: '§ 12 Abs. 1 Satz 2 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: 3,
    source: checked('§ 12 Abs. 1 Satz 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__12.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v} %`,
}

// Altgeräte, also bis zum 01.12.2021 eingebaut, müssen ab dem 01.01.2027 fernablesbar sein (§ 5
// Abs. 3), ausgenommen technische Unmöglichkeit und unbillige Härte (Satz 2). `overlap`: Ein
// Zeitraum, der 2027 berührt, ist betroffen. Ersetzt den Zeitpunkt der Bestandsregel
// `heating-remote-reading` (rules.ts liest ihn von hier). Geräte, die später eingebaut wurden
// (§ 5 Abs. 2), kommen mit PR 4 als `hkv.remote-reading.new-devices`.
export const hkvRemoteReadingRetrofit: LawParam<{ readonly installedUpTo: string }, 'overlap'> = {
  id: 'hkv.remote-reading.retrofit',
  title: 'Fernablesbarkeit älterer Geräte',
  norm: '§ 5 Abs. 3 HeizkostenV',
  timing: 'overlap',
  versions: [{
    validFrom: '2027-01-01',
    value: { installedUpTo: '2021-12-01' },
    source: checked('§ 5 Abs. 3 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__5.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `Geräte mit Einbau bis ${germanDate(v.installedUpTo)} fernablesbar`,
}

// Gradtagszahlen: welcher Teil eines Jahres an Heizwärme auf einen Monat entfällt, in Promille;
// Juni bis August zusammen (Entwurf 3.5). Verankert in § 9b Abs. 2 HeizkostenV, der für die
// übrigen Wärmekosten beim Nutzerwechsel die „aus anerkannten Regeln der Technik ergebenden
// Gradtagszahlen“ nennt. Werte nach ista (Fachwissen „Gradtagszahlentabelle“) und Berliner
// Mieterverein, Info 73, beide gelesen am 05.10.2026; Herkunft VDI 2067 Blatt 1 (12/1983),
// Tabelle 22, heute in DIN 94680 angewandt (Minol). ⟨Norm offen: DIN 94680⟩ (Entwurf 15.3).
// Mit PR 3 rechnet nur der Vorschlag nach § 560 BGB im Rumpfzeitraum damit; die Abgrenzung von
// Lieferungen (PR 7) und der Nutzerwechsel (PR 10) folgen.
export type DegreeDayTable = {
  readonly months: { readonly [month: string]: number }
  readonly summer: number
  readonly summerMonths: readonly string[]
}

export const hkvDegreeDays: LawParam<DegreeDayTable, 'periodStart'> = {
  id: 'hkv.degree-days',
  title: 'Gradtagszahlen',
  norm: '§ 9b Abs. 2 HeizkostenV (anerkannte Regeln der Technik)',
  timing: 'periodStart',
  versions: [{
    value: {
      months: { '01': 170, '02': 150, '03': 130, '04': 80, '05': 40, '09': 30, '10': 80, '11': 120, '12': 160 },
      summer: 40,
      summerMonths: ['06', '07', '08'],
    },
    source: {
      rank: 'practice',
      cite: 'ista, Gradtagszahlentabelle; Berliner Mieterverein, Info 73; Herkunft VDI 2067 Blatt 1 (12/1983), Tabelle 22',
      url: 'https://www.ista.com/de/kontakt-service/fachwissen/gradtagszahlentabelle/',
      retrieved: '2026-10-05',
      checked: 'checked',
    },
    enacted: 'Gradtagszahlentabelle nach VDI 2067 Blatt 1 (12/1983), heute DIN 94680',
  }],
  describe: (v) =>
    `${Object.entries(v.months).map(([m, n]) => `${m}: ${n}`).join(', ')}, ${v.summerMonths.join('/')} zusammen ${v.summer} (Promille je Monat)`,
}

// Geräte, die nach dem 01.12.2021 eingebaut werden, müssen fernablesbar sein, und zwar ab ihrem
// Einbau (§ 5 Abs. 2 Satz 1 HeizkostenV); ausgenommen ist der Ersatz oder die Ergänzung einzelner
// Geräte in einem nicht fernablesbaren Gesamtsystem (Satz 4). Zeitregel `eventDate`: Gefragt wird
// mit dem Einbaudatum (Heizung PR 4, N6 der dritten Fassung: eine Zeitregel je Parameter; die
// Altgeräte regelt `hkv.remote-reading.retrofit`). Zwei Fassungen, damit jedes Datum eine Antwort
// hat; der Stichtag steht zusätzlich im Wert, weil die Hinweise ihn nennen.
export const hkvRemoteReadingNewDevices: LawParam<{ readonly required: boolean; readonly installedAfter: string }, 'eventDate'> = {
  id: 'hkv.remote-reading.new-devices',
  title: 'Fernablesbarkeit neu eingebauter Geräte',
  norm: '§ 5 Abs. 2 HeizkostenV',
  timing: 'eventDate',
  versions: [
    {
      validTo: '2021-12-01',
      value: { required: false, installedAfter: '2021-12-01' },
      source: checked('§ 5 Abs. 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__5.html'),
      enacted: ENACTED,
    },
    {
      validFrom: '2021-12-02',
      value: { required: true, installedAfter: '2021-12-01' },
      source: checked('§ 5 Abs. 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__5.html'),
      enacted: ENACTED,
    },
  ],
  describe: (v) =>
    v.required
      ? `Einbau nach dem ${germanDate(v.installedAfter)}: fernablesbar ab Einbau`
      : `Einbau bis ${germanDate(v.installedAfter)}: keine Pflicht ab Einbau`,
}
// § 7 Abs. 1 Satz 2 HeizkostenV (Heizung PR 10): In Gebäuden, die das Anforderungsniveau der
// Wärmeschutzverordnung vom 16.08.1994 nicht erfüllen, die mit einer Öl- oder Gasheizung versorgt
// werden und deren freiliegende Leitungen der Wärmeverteilung überwiegend gedämmt sind, sind 70 % der
// Kosten des Betriebs der zentralen Heizungsanlage nach Verbrauch zu verteilen. Bei Wärmelieferung
// nicht: § 7 Abs. 3 verweist nur auf Abs. 1 Satz 1 und 3 bis 5 (R-A2). Welche Energieträger eine
// Öl- oder Gasheizung sind, entscheidet server/src/heating.ts (`OIL_OR_GAS`).
export const hkvConsumptionShareForced: LawParam<number, 'periodStart'> = {
  id: 'hkv.consumption-share-forced',
  title: 'Pflichtanteil nach Verbrauch bei gedämmten Leitungen',
  norm: '§ 7 Abs. 1 Satz 2 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: 70,
    source: checked('§ 7 Abs. 1 Satz 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__7.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `${v} %`,
}

// § 6a Abs. 3 HeizkostenV (Durchsicht von #239, N2): Die Informationen zur Abrechnung schuldet der
// Gebäudeeigentümer „für Abrechnungszeiträume, die ab dem 1. Dezember 2021 beginnen“. Zeitregel nach dem
// Beginn des Abrechnungszeitraums.
export const hkvSettlementInfo: LawParam<boolean, 'periodStart'> = {
  id: 'hkv.settlement-info',
  title: 'Abrechnungsinformationen nach § 6a Abs. 3',
  norm: '§ 6a Abs. 3 HeizkostenV',
  timing: 'periodStart',
  versions: [
    {
      validTo: '2021-11-30',
      value: false,
      source: checked('§ 6a Abs. 3 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__6a.html'),
      enacted: ENACTED,
    },
    {
      validFrom: '2021-12-01',
      value: true,
      source: checked('§ 6a Abs. 3 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__6a.html'),
      enacted: ENACTED,
    },
  ],
  describe: (v) => (v ? 'mit der Abrechnung mitzuteilen' : 'noch nicht vorgeschrieben'),
}

// § 12 Abs. 3 HeizkostenV (Heizung PR 10): Wird der Verbrauch der von Wärmepumpen versorgten Nutzer am
// 01.10.2024 noch nicht erfasst, ist bis zum Ablauf des 30.09.2025 eine Ausstattung zur
// Verbrauchserfassung zu installieren; die Verordnung gilt dann ab dem Abrechnungszeitraum, der nach
// der Installation beginnt (Satz 2; BT-Drs. 20/7619: Installation der Ausstattung). Zeitregel nach
// dem Ereignis (Entwurf 3.13). Ohne Erfassung nach dem 30.09.2025 rechnet Mietfuchs mit 15 % nach
// § 12 Abs. 1 Satz 1, als Auslegung (Entwurf 15.1 Nr. 22, `heatPumpVerdict` in heating.ts).
export type HeatPumpCapture = { readonly capturedBy: string; readonly installBy: string }
export const hkvHeatPumpCapture: LawParam<HeatPumpCapture, 'eventDate'> = {
  id: 'hkv.heat-pump.capture',
  title: 'Verbrauchserfassung bei Wärmepumpen',
  norm: '§ 12 Abs. 3 HeizkostenV',
  timing: 'eventDate',
  versions: [{
    value: { capturedBy: '2024-10-01', installBy: '2025-09-30' },
    source: checked('§ 12 Abs. 3 HeizkostenV; BT-Drs. 20/7619', 'https://www.gesetze-im-internet.de/heizkostenv/__12.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `Verbrauch am ${germanDate(v.capturedBy)} erfasst, sonst Erfassung bis ${germanDate(v.installBy)}; die Verordnung gilt ab dem Zeitraum nach dem Einbau`,
}

// ---------- Warmwasser ohne Wärmezähler (Heizung PR 11, Entwurf 4.3, 8.3) ----------

const URL_9 = 'https://www.gesetze-im-internet.de/heizkostenv/__9.html'
const URL_11 = 'https://www.gesetze-im-internet.de/heizkostenv/__11.html'
// Die amtlichen Fassungen im Bundesgesetzblatt. Der Wortlaut der früheren Fassungen wurde am 05.10.2026
// über buzer.de gelesen und am 06.10.2026 an den amtlichen PDF bestätigt (BGBl. 2009 I S. 3253 f., 2021 I
// S. 4966, 2023 I Nr. 280 S. 24 und 26); `retrieved` nennt den ersten Abruf, denn `LAW_AS_OF` ist der
// Rechtsstand jeder Abrechnung und ändert sich mit keiner Bestätigung.
const BGBL_2009 = 'https://www.bgbl.de/xaver/bgbl/start.xav?startbk=Bundesanzeiger_BGBl&jumpTo=bgbl109s3250.pdf'
const BGBL_2021 = 'https://www.bgbl.de/xaver/bgbl/start.xav?startbk=Bundesanzeiger_BGBl&jumpTo=bgbl121s4964.pdf'
const official = (cite: string, url: string): Source => ({ rank: 'law', cite, url, retrieved: '2026-10-05', checked: 'checked' })
const ENACTED_2021 = 'HeizkostenV i. d. F. der Bekanntmachung vom 05.10.2009 (BGBl. I S. 3250), geändert durch VO v. 24.11.2021 (BGBl. I S. 4964)'
// Zahlen deutsch geschrieben, mit so vielen Nachkommastellen, wie das Gesetz sie nennt.
const de = (n: number, digits = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 1) })

// § 9 Abs. 2 Satz 2 und 3: Kann die Wärme für das Warmwasser nur mit unzumutbar hohem Aufwand gemessen
// werden, Q = 2,5 · V · (t_w − 10) in kWh je Jahr, V gemessen in m³, t_w gemessen oder geschätzt in °C.
// Seit der Bekanntmachung vom 05.10.2009 in der Sache unverändert (2021 neu gefasst, BGBl. I S. 4965).
export const hkvDhwVolumeFormula: LawParam<{ readonly effort: number; readonly coldWaterC: number }, 'periodStart'> = {
  id: 'hkv.dhw.volume-formula',
  title: 'Wärme für Warmwasser aus dem gemessenen Volumen',
  norm: '§ 9 Abs. 2 Satz 2 und 3 HeizkostenV',
  timing: 'periodStart',
  versions: [{ value: { effort: 2.5, coldWaterC: 10 }, source: checked('§ 9 Abs. 2 Satz 2 und 3 HeizkostenV', URL_9), enacted: ENACTED }],
  describe: (v) => `Q = ${de(v.effort)} · V · (t_w − ${de(v.coldWaterC)})`,
}

// § 9 Abs. 2 Satz 4 und 5: Können weder die Wärme noch das Volumen gemessen werden, Q = 32 · A in kWh je
// Jahr, A die mit Warmwasser versorgte Wohn- oder Nutzfläche in m².
export const hkvDhwAreaFormula: LawParam<{ readonly kwhPerM2: number }, 'periodStart'> = {
  id: 'hkv.dhw.area-formula',
  title: 'Wärme für Warmwasser aus der Wohnfläche',
  norm: '§ 9 Abs. 2 Satz 4 und 5 HeizkostenV',
  timing: 'periodStart',
  versions: [{ value: { kwhPerM2: 32 }, source: checked('§ 9 Abs. 2 Satz 4 und 5 HeizkostenV', URL_9), enacted: ENACTED }],
  describe: (v) => `Q = ${de(v.kwhPerM2)} · A`,
}

// § 9 Abs. 2 Satz 6: nur für die nach den Zahlenwertgleichungen bestimmte Wärme, nie für gemessene
// (Entwurf 8.3, G-B1). Nr. 3 (monovalente Wärmepumpe, 0,30) kam mit Art. 3 Nr. 2 Buchst. b Doppelbuchst. cc
// G v. 16.10.2023 und gilt seit 01.10.2024 (Art. 6 Abs. 2, BGBl. 2023 I Nr. 280); davor `null`
// (Abweichung 1 des Plans PR 11). Die Zahl 0,30 rechnet auf den Strom um: Die Begründung nennt sie „für die
// Abrechnung von Strom für Wärmepumpen“, aus der Jahresarbeitszahl 2,7 und dem Nutzungsgrad 0,8 im Wert 2,5
// (BT-Drs. 20/7619 S. 99; Entwurf 8.3, F1).
export const hkvDhwFactors: LawParam<{ readonly gasCalorific: number; readonly heatSupplyDivisor: number; readonly heatPump: number | null }, 'periodStart'> = {
  id: 'hkv.dhw.factors',
  title: 'Umrechnung der Formelwerte für Warmwasser',
  norm: '§ 9 Abs. 2 Satz 6 HeizkostenV',
  timing: 'periodStart',
  versions: [
    {
      validTo: '2024-09-30',
      value: { gasCalorific: 1.11, heatSupplyDivisor: 1.15, heatPump: null },
      source: official('§ 9 Abs. 2 Satz 6 HeizkostenV in der Fassung bis 30.09.2024 (BGBl. 2009 I S. 3253)', BGBL_2009),
      enacted: ENACTED_2021,
    },
    {
      validFrom: '2024-10-01',
      value: { gasCalorific: 1.11, heatSupplyDivisor: 1.15, heatPump: 0.3 },
      source: checked('§ 9 Abs. 2 Satz 6 Nr. 1 bis 3 HeizkostenV', URL_9),
      enacted: ENACTED,
    },
  ],
  describe: (v) =>
    `Erdgas nach Brennwert · ${de(v.gasCalorific, 2)}; Wärmelieferung ÷ ${de(v.heatSupplyDivisor, 2)}` +
    (v.heatPump !== null ? `; monovalente Wärmepumpe · ${de(v.heatPump, 2)}` : ''),
}

// § 9 Abs. 3: Heizwerte, „hilfsweise“, wenn die Rechnung keinen nennt, und nur „bei Anlagen mit
// Heizkesseln“ (Entwurf R-A13). Die Fassung ab 01.12.2021 (VO v. 24.11.2021, Art. 1 Nr. 5 Buchst. c,
// BGBl. 2021 I S. 4966, ausgegeben am 30.11.2021, in Kraft am Tag danach) hat Satz 1 und Satz 2 Nr. 2
// neu gefasst: B in Litern, Kubikmetern oder Kilogramm, Hackschnitzel 4 kWh/kg. Die alte Tabelle
// (650 kWh/SRm, BGBl. 2009 I S. 3253 f.) stand in der alten Nummer 2 und ist mit ihr entfallen, auch wenn
// gesetze-im-internet.de sie weiter abdruckt (Abweichung 2 des Plans PR 11).
const OLD_TABLE: HeatingValueTable = {
  units: ['l', 'm3', 'kg', 'srm'],
  values: {
    heatingOilEL: { kwh: 10, per: 'l' },
    heavyFuelOil: { kwh: 10.9, per: 'l' },
    naturalGasH: { kwh: 10, per: 'm3' },
    naturalGasL: { kwh: 9, per: 'm3' },
    lpg: { kwh: 13, per: 'kg' },
    coke: { kwh: 8, per: 'kg' },
    lignite: { kwh: 5.5, per: 'kg' },
    hardCoal: { kwh: 8, per: 'kg' },
    firewood: { kwh: 4.1, per: 'kg' },
    woodPellets: { kwh: 5, per: 'kg' },
    woodChips: { kwh: 650, per: 'srm' },
  },
}
const TABLE_2021: HeatingValueTable = {
  units: ['l', 'm3', 'kg'],
  values: { ...OLD_TABLE.values, woodChips: { kwh: 4, per: 'kg' } },
}
const UNIT_PLURAL: Record<string, string> = { l: 'Litern', m3: 'Kubikmetern', kg: 'Kilogramm', srm: 'Schüttraummetern' }
export const hkvHeatingValues: LawParam<HeatingValueTable, 'periodStart'> = {
  id: 'hkv.heating-values',
  title: 'Heizwerte, wenn die Rechnung keinen nennt',
  norm: '§ 9 Abs. 3 HeizkostenV',
  timing: 'periodStart',
  versions: [
    {
      validTo: '2021-11-30',
      value: OLD_TABLE,
      source: official('§ 9 Abs. 3 Satz 1 und 2 HeizkostenV in der Fassung bis 30.11.2021 (BGBl. 2009 I S. 3253 f.)', BGBL_2009),
      enacted: 'HeizkostenV i. d. F. der Bekanntmachung vom 05.10.2009 (BGBl. I S. 3250)',
    },
    {
      validFrom: '2021-12-01',
      value: TABLE_2021,
      source: official('§ 9 Abs. 3 Satz 1 bis 5 HeizkostenV; Änderungsbefehl Art. 1 Nr. 5 Buchst. c VO v. 24.11.2021 (BGBl. 2021 I S. 4966)', BGBL_2021),
      enacted: ENACTED,
    },
  ],
  describe: (v) => `Heizwerte für ${Object.keys(v.values).length} Brennstoffe; Brennstoffverbrauch in ${v.units.map((u) => UNIT_PLURAL[u] ?? u).join(', ')}`,
}

// § 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV (Heizung PR 11, Abweichung 9; Prüfbericht vom 05.10.2026, A3):
// Ausgenommen sind Räume in Gebäuden, die überwiegend mit Wärme aus Anlagen zur Rückgewinnung von Wärme
// oder aus Solaranlagen versorgt werden. Bis 30.09.2024 stand dort „aus Wärmepumpen- oder Solaranlagen“
// (BGBl. 2009 I S. 3254); Art. 3 Nr. 3 G v. 16.10.2023 hat „Wärmepumpen- oder“ gestrichen und § 12 Abs. 3
// angefügt (BGBl. 2023 I Nr. 280, in Kraft am 01.10.2024). PR 11 fragt den Parameter bei Wärmepumpen,
// PR 14 für die Ausnahme `renewable`.
export const hkvRenewableExemption: LawParam<{ readonly heatPump: boolean }, 'periodStart'> = {
  id: 'hkv.exemption.renewable',
  title: 'Ausnahme für Gebäude mit Wärme aus Rückgewinnung, Solaranlagen oder Wärmepumpen',
  norm: '§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV',
  timing: 'periodStart',
  versions: [
    {
      validTo: '2024-09-30',
      value: { heatPump: true },
      source: official('§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der Fassung bis 30.09.2024 (BGBl. 2009 I S. 3254)', BGBL_2009),
      enacted: ENACTED_2021,
    },
    {
      validFrom: '2024-10-01',
      value: { heatPump: false },
      source: checked('§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV', URL_11),
      enacted: ENACTED,
    },
  ],
  describe: (v) => (v.heatPump
    ? `Wärmerückgewinnung, Wärmepumpen oder Solaranlagen (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV in der Fassung bis ${germanDate('2024-09-30')})`
    : 'Wärmerückgewinnung oder Solaranlagen (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV)'),
}

// § 9a Abs. 2 HeizkostenV (Heizung PR 13): Überschreitet die von der Schätzung betroffene Wohn- oder
// Nutzfläche 25 vom Hundert der für die Kostenverteilung maßgeblichen gesamten Fläche, sind die
// Kosten ausschließlich nach der Fläche zu verteilen. „Überschreitet“: genau 25 % ist keine
// Überschreitung (R-A22). Geprüft wird je Topf (Entwurf 15.1 Nr. 6).
export const hkvEstimateThreshold: LawParam<number, 'periodStart'> = {
  id: 'hkv.estimate-threshold',
  title: 'Grenze der geschätzten Fläche',
  norm: '§ 9a Abs. 2 HeizkostenV',
  timing: 'periodStart',
  versions: [{
    value: 25,
    source: checked('§ 9a Abs. 2 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__9a.html'),
    enacted: ENACTED,
  }],
  describe: (v) => `überschreitet ${v} %`,
}

// ---------- Pflichtangaben und Ausnahmen (Heizung PR 14, #99) ----------
// Wortlaut gelesen am 07.10.2026 auf gesetze-im-internet.de (§§ 6a, 11, 12 HeizkostenV).
const read14 = (cite: string, url: string): Source => ({ rank: 'law', cite, url, retrieved: '2026-10-07', checked: 'checked' })
const URL_6A = 'https://www.gesetze-im-internet.de/heizkostenv/__6a.html'

// § 12 Abs. 1 Satz 3 HeizkostenV: „Dasselbe ist anzuwenden, wenn der Gebäudeeigentümer die Informationen nach
// § 6a nicht oder nicht vollständig mitteilt.“ Dasselbe heißt das Recht des Satzes 2, den auf den Nutzer
// entfallenden Anteil um 3 vom Hundert zu kürzen; ein Recht, nicht eines je fehlender Angabe. Eine eigene
// Fassung neben `hkv.cut.remote-reading`, denn beide Sätze können sich getrennt ändern.
export const hkvCutInformation: LawParam<number, 'periodStart'> = {
  id: 'hkv.cut.information',
  title: 'Kürzung bei fehlenden Informationen nach § 6a',
  norm: '§ 12 Abs. 1 Satz 3 HeizkostenV',
  timing: 'periodStart',
  versions: [{ value: 3, source: read14('§ 12 Abs. 1 Satz 2 und 3 HeizkostenV', 'https://www.gesetze-im-internet.de/heizkostenv/__12.html'), enacted: ENACTED }],
  describe: (v) => `${v} %`,
}

// § 6a Abs. 3 Satz 1 Nr. 1 Buchst. a: Treibhausgasemissionen und Primärenergiefaktor des Fernwärmenetzes,
// „bei Fernwärmesystemen mit einer thermischen Gesamtleistung unter 20 Megawatt jedoch erst ab dem
// 1. Januar 2022“. Ob der Beginn des Abrechnungszeitraums gemeint ist, sagt der Wortlaut nicht; Mietfuchs
// liest es so (Auslegung) und nennt fehlende Werte für einen Zeitraum davor nur als „bis zu“, denn die
// Leistung des Netzes kennt es nicht.
export type DistrictEmissions = { readonly scope: 'largeOnly' | 'all'; readonly thresholdMw: number }
const districtSource = (): Source => ({ rank: 'interpretation', cite: '§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a HeizkostenV', url: URL_6A, retrieved: '2026-10-07', checked: 'checked' })
export const hkvInfoDistrict: LawParam<DistrictEmissions, 'periodStart'> = {
  id: 'hkv.info.district-emissions',
  title: 'Treibhausgasemissionen und Primärenergiefaktor der Fernwärme',
  norm: '§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a HeizkostenV',
  timing: 'periodStart',
  versions: [
    { validTo: '2021-12-31', value: { scope: 'largeOnly', thresholdMw: 20 }, source: districtSource(), enacted: `${ENACTED}; Zeitregel nach dem Beginn des Zeitraums als Auslegung von Mietfuchs` },
    { validFrom: '2022-01-01', value: { scope: 'all', thresholdMw: 20 }, source: districtSource(), enacted: `${ENACTED}; Zeitregel nach dem Beginn des Zeitraums als Auslegung von Mietfuchs` },
  ],
  describe: (v) => (v.scope === 'all' ? 'für jedes Fernwärmesystem' : `nur für Fernwärmesysteme ab ${v.thresholdMw} MW`),
}

// § 6a Abs. 1 Satz 1 Nr. 2, Abs. 2: Bei fernablesbaren Geräten monatliche Abrechnungs- oder
// Verbrauchsinformationen ab dem 01.01.2022. `overlap`: Ein Zeitraum, der diese Zeit berührt, ist
// betroffen. Die Information selbst erzeugt Mietfuchs noch nicht (Heizung PR 22).
export const hkvMonthlyInfo: LawParam<{ readonly interval: string }, 'overlap'> = {
  id: 'hkv.monthly-info',
  title: 'Monatliche Verbrauchsinformation',
  norm: '§ 6a Abs. 1 Satz 1 Nr. 2, Abs. 2 HeizkostenV',
  timing: 'overlap',
  versions: [{ validFrom: '2022-01-01', value: { interval: 'monthly' }, source: read14('§ 6a Abs. 1 und 2 HeizkostenV', URL_6A), enacted: ENACTED }],
  describe: () => 'monatlich bei fernablesbaren Geräten',
}

// § 11 Abs. 1 Nr. 1 HeizkostenV: die Zahlen der Ausnahmen, für die Auswahl in der Oberfläche, das Lexikon
// und die Hinweise. Mietfuchs prüft keine dieser Voraussetzungen; der Vermieter wählt und bewahrt den
// Nachweis auf.
export type Exemptions = { readonly lowDemandKwhPerM2Year: number; readonly readyBefore: string; readonly paybackYears: number }
export const hkvExemptions: LawParam<Exemptions, 'periodStart'> = {
  id: 'hkv.exemptions',
  title: 'Ausnahmen von der Heizkostenverordnung',
  norm: '§ 11 Abs. 1 HeizkostenV',
  timing: 'periodStart',
  versions: [{ value: { lowDemandKwhPerM2Year: 15, readyBefore: '1981-07-01', paybackYears: 10 }, source: read14('§ 11 HeizkostenV', URL_11), enacted: ENACTED }],
  describe: (v) => `Heizwärmebedarf unter ${v.lowDemandKwhPerM2Year} kWh je m² und Jahr; bezugsfertig vor ${germanDate(v.readyBefore)}; Einsparung in ${v.paybackYears} Jahren`,
}
