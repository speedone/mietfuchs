// Verbilligte Wohnungsüberlassung nach § 21 Abs. 2 EStG (#257). Gebraucht für die Steuerübersicht
// (server/src/cheapRent.ts), nie für eine Abrechnung an die Mieter.
//
// Gelesen am 23.10.2026 auf gesetze-im-internet.de, § 21 Abs. 2 EStG heute:
//   Satz 1: „Beträgt das Entgelt für die Überlassung einer Wohnung zu Wohnzwecken weniger als
//   50 Prozent der ortsüblichen Marktmiete, so ist die Nutzungsüberlassung in einen entgeltlichen
//   und einen unentgeltlichen Teil aufzuteilen.“
//   Satz 2: „Beträgt das Entgelt bei auf Dauer angelegter Wohnungsvermietung mindestens 66 Prozent der
//   ortsüblichen Miete, gilt die Wohnungsvermietung als entgeltlich.“
// Eingeführt durch Art. 2 Jahressteuergesetz 2020 vom 21.12.2020 (BGBl. I S. 3096), anzuwenden ab dem
// Veranlagungszeitraum 2021 (Fassungsverlauf auf buzer.de; OFD Frankfurt am Main, Rundverfügung vom
// 17.06.2025, S 2253 A - 00115 - 0357 - St 24, Tz. 1.2).
//
// **Die Fassung davor** (VZ 2012 bis 2020) teilte unter 66 Prozent auf und kannte keinen Satz 2. Ihren
// Wortlaut führt gesetze-im-internet.de nicht mehr; übernommen ist sie aus der Rundverfügung der OFD
// Frankfurt (Tz. 1.2: „seit dem Veranlagungszeitraum (VZ) 2012 … weniger als 66 % der ortsüblichen
// Vergleichsmiete“) und BFH, Urteil vom 22.02.2021, IX R 7/20, Rz. 11 (zu 2016). Deshalb `adopted`.
// Vor 2012 (56 Prozent, davor 50 Prozent) führt das Register keine Fassung; Mietfuchs prüft dann nicht.
//
// **Zwischen den beiden Grenzen** (ab 2021: 50 bis unter 66 Prozent) sagt das Gesetz nichts; nach
// Verwaltungsauffassung entscheidet eine Totalüberschussprognose (OFD Frankfurt, Tz. 1.2; Verfahren nach
// BMF-Schreiben vom 08.10.2004, IV C 3 - S 2253 - 91/04, BStBl I S. 933, Rz. 13, dort noch mit den Grenzen
// der damaligen Fassung, weiter anzuwenden laut Positivliste zum BMF-Schreiben vom 15.03.2024, BStBl I S. 450). Das steht
// nicht im Register, weil es keine Zahl ist; Mietfuchs rechnet die Prognose nicht.
//
// Zeitregel `periodStart`: Maßgeblich ist der Veranlagungszeitraum, also das Kalenderjahr (§ 25 Abs. 1
// EStG); gefragt wird mit seinem 1. Januar.
import type { LawParam } from './register.ts'

export type CheapRentThresholds = {
  // Unter dieser Quote wird aufgeteilt (Satz 1).
  readonly split: number
  // Ab dieser Quote gilt die Vermietung als entgeltlich (Satz 2). In der Fassung bis 2020 gleich `split`.
  readonly paid: number
}

export const estgCheapRent: LawParam<CheapRentThresholds, 'periodStart'> = {
  id: 'estg.cheap-rent',
  title: 'Verbilligte Vermietung einer Wohnung',
  norm: '§ 21 Abs. 2 EStG',
  timing: 'periodStart',
  versions: [
    {
      validFrom: '2012-01-01',
      validTo: '2020-12-31',
      value: { split: 66, paid: 66 },
      source: {
        rank: 'law',
        cite: '§ 21 Abs. 2 EStG a. F. laut OFD Frankfurt am Main, Rundverfügung vom 17.06.2025, S 2253 A - 00115 - 0357 - St 24, Tz. 1.2, und BFH, Urteil vom 22.02.2021, IX R 7/20, Rz. 11; Wortlaut der alten Fassung nicht amtlich gelesen',
        url: 'https://www.iww.de/quellenmaterial/id/222179',
        retrieved: '2026-10-23',
        checked: 'adopted',
      },
      enacted: '§ 21 Abs. 2 EStG in der Fassung für die Veranlagungszeiträume 2012 bis 2020',
    },
    {
      validFrom: '2021-01-01',
      value: { split: 50, paid: 66 },
      source: { rank: 'law', cite: '§ 21 Abs. 2 Satz 1 und 2 EStG', url: 'https://www.gesetze-im-internet.de/estg/__21.html', retrieved: '2026-10-23', checked: 'checked' },
      enacted: '§ 21 Abs. 2 EStG, Fassung Art. 2 Jahressteuergesetz 2020 vom 21.12.2020 (BGBl. I S. 3096)',
    },
  ],
  describe: (v) => (v.split === v.paid
    ? `Aufteilung unter ${v.split} % der ortsüblichen Miete`
    : `Aufteilung unter ${v.split} %, entgeltlich ab ${v.paid} % der ortsüblichen Miete`),
}
