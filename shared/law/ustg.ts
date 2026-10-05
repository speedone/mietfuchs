// Regelsatz der Umsatzsteuer (Heizung PR 1, Entwurf 4.3, G-C8). Gebraucht wird er nicht für eine
// Abrechnungszahl, sondern für die Plausibilität einer KI-Auswertung (`vatExplainsGap` in
// server/src/invoiceAmounts.ts): Lässt sich der Abstand zwischen Positionen und Rechnungsbetrag
// durch Umsatzsteuer erklären?
//
// Geprüft am 05.10.2026 an der Quelle:
// - § 12 Abs. 1 UStG, heute: „Die Steuer beträgt für jeden steuerpflichtigen Umsatz 19 Prozent der
//   Bemessungsgrundlage“ (gesetze-im-internet.de). 19 statt vorher 16 Prozent seit dem 01.01.2007,
//   Art. 4 Haushaltsbegleitgesetz 2006 v. 29.06.2006 (BGBl. I S. 1402), Fassungsvergleich auf
//   buzer.de.
// - § 28 Abs. 1 UStG in der Fassung von Art. 3 Zweites Corona-Steuerhilfegesetz v. 29.06.2020
//   (BGBl. I S. 1512): „§ 12 Absatz 1 ist vom 1. Juli 2020 bis 31. Dezember 2020 mit der Maßgabe
//   anzuwenden, dass die Steuer für jeden steuerpflichtigen Umsatz 16 Prozent der
//   Bemessungsgrundlage beträgt.“ (Wortlaut auf buzer.de). Den ermäßigten Satz (7, in derselben
//   Zeit 5 Prozent, § 28 Abs. 2 a. F.) braucht Mietfuchs nicht; er steht nicht im Register.
//
// Welcher Satz gilt, hängt nach § 27 Abs. 1 Satz 1 UStG am Tag, an dem die Leistung ausgeführt
// wird, nicht am Rechnungsdatum. Mietfuchs fragt mit dem Rechnungsdatum, weil es auf dem Beleg steht
// und der Tag der Leistung oft nicht; für die Plausibilitätsprüfung der KI-Auswertung ist das eine
// Näherung, an der keine Abrechnungszahl hängt. Eine Rechnung über eine Leistung vom Juni 2020,
// gestellt im Juli, wird so mit 16 statt 19 % geprüft und im Zweifel nicht hochgerechnet.
//
// Die erste Fassung beginnt am 01.01.2007. Für die Zeit davor führt das Register keinen Wert (bis
// 2006 galten 16 Prozent, davor andere Sätze); wer einen Tag davor abfragt, bekommt den Fehler des
// Registers. invoiceAmounts.ts nimmt dann den Satz von heute, wie ohne lesbares Rechnungsdatum.
import type { LawParam, Source } from './register.ts'

const checked = (cite: string, url: string): Source => ({ rank: 'law', cite, url, retrieved: '2026-10-05', checked: 'checked' })
const RATE = checked('§ 12 Abs. 1 UStG', 'https://www.gesetze-im-internet.de/ustg_1980/__12.html')
const ENACTED = '§ 12 Abs. 1 UStG, Fassung Art. 4 HBeglG 2006 v. 29.06.2006 (BGBl. I S. 1402)'

export const ustgStandardRate: LawParam<number, 'eventDate'> = {
  id: 'ustg.standard-rate',
  title: 'Regelsatz der Umsatzsteuer',
  norm: '§ 12 Abs. 1 UStG',
  timing: 'eventDate',
  versions: [
    { validFrom: '2007-01-01', validTo: '2020-06-30', value: 19, source: RATE, enacted: ENACTED },
    {
      validFrom: '2020-07-01',
      validTo: '2020-12-31',
      value: 16,
      source: checked('§ 28 Abs. 1 UStG', 'https://www.gesetze-im-internet.de/ustg_1980/__28.html'),
      enacted: '§ 28 Abs. 1 UStG, Fassung Art. 3 Zweites Corona-Steuerhilfegesetz v. 29.06.2020 (BGBl. I S. 1512)',
    },
    { validFrom: '2021-01-01', value: 19, source: RATE, enacted: ENACTED },
  ],
  describe: (v) => `${v} %`,
}
