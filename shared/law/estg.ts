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

// ---------- Anschaffungsnahe Herstellungskosten, § 6 Abs. 1 Nr. 1a EStG (#96 PR 2, mit #262) ----------
//
// Gelesen am 31.10.2026 auf gesetze-im-internet.de, § 6 Abs. 1 Nr. 1a Satz 1 EStG heute:
//   „Zu den Herstellungskosten eines Gebäudes gehören auch Aufwendungen für Instandsetzungs- und
//   Modernisierungsmaßnahmen, die innerhalb von drei Jahren nach der Anschaffung des Gebäudes durchgeführt
//   werden, wenn die Aufwendungen ohne die Umsatzsteuer 15 Prozent der Anschaffungskosten des Gebäudes
//   übersteigen (anschaffungsnahe Herstellungskosten).“
// Verwaltungsauffassung: BMF-Schreiben vom 26.01.2026, IV C 1 - S 2253/00082/001/064, Rn. 54 bis 68 (ersetzt die
// BMF-Schreiben vom 18.07.2003 und 20.10.2017, in allen offenen Fällen anzuwenden; BStBl-Fundstelle nicht gefunden,
// gelesen in einer Kopie des Schreibens). Rn. 62: Der Dreijahreszeitraum läuft taggenau ab dem Übergang von Besitz,
// Gefahr, Nutzungen und Lasten; Rn. 63: Die Maßnahmen müssen zum Fristende weder abgeschlossen noch abgerechnet noch
// bezahlt sein.
//
// Eingefügt durch Art. 1 Steueränderungsgesetz 2003 vom 15.12.2003 (BGBl. I S. 2645). Anzuwenden nach § 52 Abs. 16
// Satz 7 bis 9 EStG a. F. „erstmals für Baumaßnahmen anzuwenden, mit denen nach dem 31. Dezember 2003 begonnen wird“;
// Beginn ist der Bauantrag oder, wo keiner nötig ist, das Einreichen der Bauunterlagen. Diesen Wortlaut gibt nur
// buzer.de wieder (https://www.buzer.de/gesetz/4499/al15019-0.htm, Fassung bis 29.12.2007), bestätigt durch SenFin
// Berlin, 20.11.2012, III B - S 2211 - 2/2005 (https://www.iww.de/ssp/quellenmaterial/id/90944); das BGBl. ist nicht
// amtlich gelesen. Der **Beginn der Fassung ist deshalb übernommen** (adopted), der Wert selbst am Gesetz von heute
// geprüft (checked); `enacted` hält beides fest.
//
// Zeitregel `eventDate`: Die Geltung hängt am Beginn der Baumaßnahme, nicht an der Anschaffung und nicht am
// Veranlagungszeitraum (§ 52 Abs. 16 Satz 7 EStG a. F.). Mietfuchs kennt den Beginn einer Maßnahme nicht und nennt die
// Werte nur in Texten (Hinweis `acquisitionRelated` der Steuerübersicht, Lexikon), also mit `valueAt(…, LAW_AS_OF)`.
// Für die Steuerjahre, die Mietfuchs rechnet, ist der Beginn 2004 ohne Bedeutung; die Fassung davor (§ 6 EStG ohne
// Nr. 1a, Verwaltungsauffassung nach dem BMF-Schreiben vom 18.07.2003) führt das Register nicht.
export type AcquisitionRelatedLimits = {
  // Die Grenze in Prozent der Anschaffungskosten des Gebäudes, ohne Umsatzsteuer.
  readonly percent: number
  // Der Zeitraum nach der Anschaffung in Jahren.
  readonly years: number
}

const YEARS_WORD: Readonly<Record<number, string>> = { 2: 'zwei', 3: 'drei', 4: 'vier', 5: 'fünf' }

export const estgAcquisitionRelated: LawParam<AcquisitionRelatedLimits, 'eventDate'> = {
  id: 'estg.acquisition-related',
  title: 'Anschaffungsnahe Herstellungskosten',
  norm: '§ 6 Abs. 1 Nr. 1a EStG',
  timing: 'eventDate',
  versions: [
    {
      validFrom: '2004-01-01',
      value: { percent: 15, years: 3 },
      source: { rank: 'law', cite: '§ 6 Abs. 1 Nr. 1a Satz 1 EStG', url: 'https://www.gesetze-im-internet.de/estg/__6.html', retrieved: '2026-10-31', checked: 'checked' },
      enacted: '§ 6 Abs. 1 Nr. 1a EStG, eingefügt durch Art. 1 Steueränderungsgesetz 2003 vom 15.12.2003 (BGBl. I S. 2645); Beginn nach § 52 Abs. 16 Satz 7 bis 9 EStG a. F. (Baumaßnahmen, begonnen nach dem 31.12.2003) übernommen aus buzer.de und SenFin Berlin, 20.11.2012, III B - S 2211 - 2/2005, BGBl. nicht amtlich gelesen',
    },
  ],
  describe: (v) => `Herstellungskosten, wenn Instandsetzung und Modernisierung in ${yearsWord(v.years)} Jahren nach der Anschaffung ohne Umsatzsteuer ${v.percent} % der Anschaffungskosten des Gebäudes übersteigen`,
}

// „drei“ statt „3“ im Fließtext; eine Zahl ohne Wort bleibt Ziffer.
export function yearsWord(years: number): string {
  return YEARS_WORD[years] ?? String(years)
}

// ---------- Kurze Zeit um den Jahreswechsel, § 11 Abs. 1 Satz 2 EStG (#312 PR 2, Zehn-Tage-Regel) ----------
//
// Gelesen am 31.10.2026 auf gesetze-im-internet.de, § 11 Abs. 1 Satz 2 EStG heute:
//   „Regelmäßig wiederkehrende Einnahmen, die dem Steuerpflichtigen kurze Zeit vor Beginn oder kurze Zeit nach
//   Beendigung des Kalenderjahres, zu dem sie wirtschaftlich gehören, zugeflossen sind, gelten als in diesem
//   Kalenderjahr bezogen.“
// Das Gesetz nennt keine Zahl. „Kurze Zeit“ sind nach ständiger Rechtsprechung bis zu zehn Tage (BFH, Urteil vom
// 24.07.1986, IV R 309/84, BStBl II 1987, 16; wiedergegeben in H 11 EStH). Zahlung **und** Fälligkeit müssen in diesem
// Zeitraum liegen (BFH, Urteil vom 27.06.2018, X R 44/16; Urteil vom 16.02.2022, X R 2/21). Der Wortlaut von H 11 EStH
// ist nicht selbst gelesen (das Amtliche Handbuch war am 31.10.2026 nicht erreichbar), deshalb `adopted` aus dem Entwurf
// docs/superpowers/specs/2026-10-30-steuer-zufluss-design.md (Rechtslage, E8); Rang `court`, denn die Zahl stammt aus der
// Rechtsprechung, wie `bgb.rent-due-saturday`.
//
// Mietfuchs **verschiebt nichts** (Entwurf E8): Die Steuerübersicht nennt nur die Beträge, für die die Regel nach den
// Daten greift (`received.turnOfYear`), und das Formular der Kostenposition weist auf sie hin.
//
// Zeitregel `periodStart`: Gefragt wird für ein Kalenderjahr (Veranlagungszeitraum), mit seinem 1. Januar. Eine
// Fassung ohne Beginn, denn die Rechtsprechung legt das Gesetz aus und ändert es nicht.
export const estgShortPeriodDays: LawParam<number, 'periodStart'> = {
  id: 'estg.short-period-days',
  title: 'Kurze Zeit um den Jahreswechsel',
  norm: '§ 11 Abs. 1 Satz 2 EStG',
  timing: 'periodStart',
  versions: [
    {
      value: 10,
      source: {
        rank: 'court',
        cite: '§ 11 Abs. 1 Satz 2 EStG; BFH, Urteil vom 24.07.1986, IV R 309/84, BStBl II 1987, 16; H 11 EStH; Wortlaut von H 11 EStH nicht selbst gelesen',
        url: 'https://www.gesetze-im-internet.de/estg/__11.html',
        retrieved: '2026-10-31',
        checked: 'adopted',
      },
      enacted: 'Rechtsprechung des BFH seit 24.07.1986 (IV R 309/84) zu § 11 Abs. 1 Satz 2 EStG',
    },
  ],
  describe: (v) => `kurze Zeit vor Beginn oder nach Ende des Kalenderjahres: bis zu ${v} Tage`,
}
