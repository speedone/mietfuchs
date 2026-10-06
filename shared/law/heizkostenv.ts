// Parameter der Heizkostenverordnung (Heizung PR 1, Entwurf 4.3). Wortlaut geprüft am 05.10.2026
// auf gesetze-im-internet.de, Fassung Art. 3 G v. 16.10.2023 (BGBl. I Nr. 280); das Gesetz vom
// 23.07.2026 ändert die Verordnung nicht (Entwurf Abschnitt 2).
import type { LawParam, Source } from './register.ts'
import { germanDate } from './register.ts'

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
