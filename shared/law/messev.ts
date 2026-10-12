// Eichfristen nach der Mess- und Eichverordnung (Heizung PR 21, #98, Entwurf 3.12, 4.3). Wortlaut am
// 12.10.2026 gelesen: Anlage 7 und § 34 MessEV auf gesetze-im-internet.de, die Dritte Verordnung zur
// Änderung der MessEV über den Text der Drucksache (BR-Drs. 599/21) und den Fassungsvergleich bei buzer.de.
//
// § 34 Abs. 1 Nr. 1 MessEV verweist auf Anlage 7; dort stehen Kaltwasserzähler (Nr. 5.5.1),
// Warmwasserzähler (Nr. 5.5.2) und Wärmezähler (Nr. 7.1) heute mit je sechs Jahren. Für Warmwasser- und
// Wärmezähler gilt das seit dem 03.11.2021: Die Dritte Verordnung zur Änderung der Mess- und
// Eichverordnung vom 26.10.2021 (BGBl. I S. 4742, verkündet am 02.11.2021) ersetzte in Nr. 5.5.2, 7.1 und
// 7.2 „5“ durch „6“ (Art. 1 Nr. 11 Buchst. a) und trat „am Tag nach der Verkündung“ in Kraft (Art. 2; ebenso
// § 58 Abs. 7 MessEV: „vor dem 3. November 2021“). Die Fassung davor (MessEV vom 11.12.2014, BGBl. I
// S. 2010, ab 01.01.2015) hatte 6, 5 und 5 Jahre; amtlich belegt durch die Begründung der Änderung
// („Warmwasser- und Wärmezähler haben derzeit eine Eichfrist von fünf Jahren, Kaltwasserzähler von sechs
// Jahren“, BR-Drs. 599/21 zu Art. 1 Nr. 11 Buchst. a). Die Änderungen von 2017 und 2019 berühren diese
// Nummern nicht, die Vierte Änderungsverordnung (mWv 31.01.2024) ebenfalls nicht. Vor 2015 galt die
// Eichordnung; dafür führt das Register keine Fassung.
//
// **Übergang** (Art. 2 regelt nur das Inkrafttreten, § 58 Abs. 7 betrifft § 25): Die Änderungsverordnung vom
// 26.10.2021 enthält keine Übergangsregel. Mietfuchs wendet die Frist von 6 Jahren auch auf Fristen an, die am
// 03.11.2021 noch liefen; eine schon abgelaufene Frist lebt nicht wieder auf. Das ist eine Auslegung. Gerechnet
// wird das in shared/calibration.ts (`calibrationEnd`), nicht hier.
//
// Zeitregel `eventDate`: Maßgeblich ist der Tag, an dem die Frist beginnt, also der Tag der Eichung oder
// des Inverkehrbringens (§ 34 Abs. 1 Satz 2 MessEV, § 37 Abs. 1 Satz 2 MessEG).
import type { LawParam } from './register.ts'

const RETRIEVED = '2026-10-12'

export type CalibrationYears = { readonly kaltwasser: number; readonly warmwasser: number; readonly waerme: number }

// Die Sparten, für die das Register eine Eichfrist führt und das Formular ein Jahr vorschlägt. Gas- und
// Stromzähler sind ebenfalls eichpflichtig (Anlage 7 Nr. 5.6 und Nr. 6), ihre Frist hängt aber von der Bauart ab.
export const CALIBRATED_METER_TYPES = ['kaltwasser', 'warmwasser', 'waerme'] as const

// Der Tag der Verordnung, mit der eine Fassung eingeführt wurde, nach ihrem Beginn (für den Satz zum Übergang).
export const CALIBRATION_AMENDED_ON: Readonly<Record<string, string>> = { '2021-11-03': '2021-10-26' }

export const messevCalibrationYears: LawParam<CalibrationYears, 'eventDate'> = {
  id: 'messev.calibration-years',
  title: 'Eichfrist von Wasser- und Wärmezählern',
  norm: '§ 34 Abs. 1 Nr. 1 und Anlage 7 Nr. 5.5.1, 5.5.2, 7.1 MessEV',
  timing: 'eventDate',
  versions: [
    {
      validFrom: '2015-01-01',
      validTo: '2021-11-02',
      value: { kaltwasser: 6, warmwasser: 5, waerme: 5 },
      source: {
        rank: 'law',
        cite: 'Anlage 7 Nr. 5.5.1, 5.5.2, 7.1 MessEV a. F.; Stand vor dem 03.11.2021 laut BR-Drs. 599/21, Begründung zu Art. 1 Nr. 11 Buchst. a; die Änderungen 2017 und 2019 berühren diese Nummern nicht',
        url: 'https://dserver.bundestag.de/brd/2021/0599-21.pdf',
        retrieved: RETRIEVED,
        checked: 'checked',
      },
      enacted: 'MessEV vom 11.12.2014 (BGBl. I S. 2010, 2064), Anlage 7 in den Fassungen ab 01.01.2015, ab 16.08.2017 (BGBl. I S. 3098) und ab 08.05.2019 (BGBl. I S. 579)',
    },
    {
      validFrom: '2021-11-03',
      value: { kaltwasser: 6, warmwasser: 6, waerme: 6 },
      source: { rank: 'law', cite: 'Anlage 7 Nr. 5.5.1, 5.5.2, 7.1 MessEV', url: 'https://www.gesetze-im-internet.de/messev/anlage_7.html', retrieved: RETRIEVED, checked: 'checked' },
      enacted: 'MessEV, Anlage 7 in der Fassung der Dritten Änderungsverordnung vom 26.10.2021 (BGBl. I S. 4742)',
    },
  ],
  describe: (v) =>
    v.kaltwasser === v.warmwasser && v.warmwasser === v.waerme
      ? `Kaltwasser-, Warmwasser- und Wärmezähler je ${v.kaltwasser} Jahre`
      : `Kaltwasserzähler ${v.kaltwasser}, Warmwasserzähler ${v.warmwasser}, Wärmezähler ${v.waerme} Jahre`,
}
