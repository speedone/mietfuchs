// Parameter aus BGB und Betriebskostenverordnung (Heizung PR 1, Entwurf 4.3). Frist und Höchstdauer
// des Abrechnungszeitraums (§ 556 Abs. 3 BGB, #208).
import type { LawParam, Source } from './register.ts'
import { germanDate } from './register.ts'

// Kabelfernsehen: Die Gebühren für das TV-Signal durften bis zum 30.06.2024 umgelegt werden, und
// nur bei Anlagen, die vor dem 01.12.2021 errichtet wurden (§ 2 Satz 1 Nr. 15 Buchst. a und b,
// Satz 2 BetrKV). `overlap`: Ein Abrechnungsjahr, das die Übergangszeit nur berührt, ist das
// Übergangsjahr („teilweise“). Wortlaut geprüft am 05.10.2026; die BetrKV ist unverändert seit
// Art. 4 G v. 16.10.2023 (Durchsicht vom 02.10.2026).
export const betrkvTvSignal: LawParam<{ readonly newSystemsFrom: string }, 'overlap'> = {
  id: 'betrkv.tv-signal',
  title: 'Kabelfernsehen über die Nebenkosten',
  norm: '§ 2 Satz 1 Nr. 15 Buchst. a und b, Satz 2 BetrKV',
  timing: 'overlap',
  versions: [{
    validTo: '2024-06-30',
    value: { newSystemsFrom: '2021-12-01' },
    source: { rank: 'law', cite: '§ 2 Satz 1 Nr. 15 Buchst. a und b, Satz 2 BetrKV', url: 'https://www.gesetze-im-internet.de/betrkv/__2.html', retrieved: '2026-10-05', checked: 'checked' },
    enacted: 'BetrKV, Fassung Art. 4 G v. 16.10.2023 (BGBl. 2023 I Nr. 280)',
  }],
  describe: (v) => `umlagefähig nur bei Anlagen, die vor dem ${germanDate(v.newSystemsFrom)} errichtet wurden`,
}

// Strom zur Wärmeerzeugung (Folge-PR zu #252, #253): Seit dem 01.01.2024 nennt § 2 Satz 1 Nr. 4 Buchst. a BetrKV
// „die Kosten des zur Wärmeerzeugung verbrauchten Stroms“ bei den Kosten des Betriebs der zentralen Heizungsanlage
// (eingefügt durch Art. 4, in Kraft nach Art. 6 Abs. 1 des Gesetzes vom 16.10.2023, BGBl. 2023 I Nr. 280; am
// amtlichen Text gelesen am 11.10.2026). `overlap`: Der Hinweis `heating.generation-power-missing` kommt nur in
// einem Zeitraum, der diese Fassung berührt; für Zeiträume ganz davor schweigt er (Entscheidung F4).
export const betrkvGenerationPower: LawParam<{ readonly since: string }, 'overlap'> = {
  id: 'betrkv.generation-power',
  title: 'Strom zur Wärmeerzeugung bei den Heizkosten (Betriebskostenverordnung)',
  norm: '§ 2 Satz 1 Nr. 4 Buchst. a BetrKV',
  timing: 'overlap',
  versions: [{
    validFrom: '2024-01-01',
    value: { since: '2024-01-01' },
    source: { rank: 'law', cite: '§ 2 Satz 1 Nr. 4 Buchst. a BetrKV, eingefügt durch Art. 4, in Kraft nach Art. 6 Abs. 1 G v. 16.10.2023 (BGBl. 2023 I Nr. 280)', url: 'https://www.recht.bund.de/eli/bund/bgbl-1/2023/280', retrieved: '2026-10-11', checked: 'checked' },
    enacted: 'BetrKV, Fassung Art. 4 G v. 16.10.2023 (BGBl. 2023 I Nr. 280)',
  }],
  describe: (v) => `der zur Wärmeerzeugung verbrauchte Strom zählt seit dem ${germanDate(v.since)} zu den Kosten des Betriebs der zentralen Heizungsanlage`,
}

const bgb556 = (cite: string): Source => ({ rank: 'law', cite, url: 'https://www.gesetze-im-internet.de/bgb/__556.html', retrieved: '2026-10-05', checked: 'checked' })

// Abgerechnet wird jährlich (§ 556 Abs. 3 Satz 1 BGB); ein Abrechnungszeitraum ist deshalb nach
// herrschender Meinung höchstens zwölf Monate lang. Shared/period.ts bildet daraus die Zeiträume,
// vor jedem Wechsel einen Rumpf. Wortlaut geprüft am 05.10.2026 (Entwurf 2, 4.3).
export const bgbMaxPeriodMonths: LawParam<number, 'periodStart'> = {
  id: 'bgb.max-period-months',
  title: 'Höchstdauer des Abrechnungszeitraums',
  norm: '§ 556 Abs. 3 Satz 1 BGB',
  timing: 'periodStart',
  versions: [{ value: 12, source: bgb556('§ 556 Abs. 3 Satz 1 BGB (herrschende Meinung)'), enacted: '§ 556 Abs. 3 BGB' }],
  describe: (v) => `höchstens ${v} Monate`,
}

// Die Abrechnung muss dem Mieter spätestens bis zum Ablauf des zwölften Monats nach Ende des
// Abrechnungszeitraums mitgeteilt werden (§ 556 Abs. 3 Satz 2 BGB); danach ist eine Nachforderung
// ausgeschlossen, es sei denn, der Vermieter hat die Verspätung nicht zu vertreten (Satz 3).
export const bgbDeadlineMonths: LawParam<number, 'periodStart'> = {
  id: 'bgb.deadline-months',
  title: 'Abrechnungsfrist',
  norm: '§ 556 Abs. 3 Satz 2 BGB',
  timing: 'periodStart',
  versions: [{ value: 12, source: bgb556('§ 556 Abs. 3 Satz 2 BGB'), enacted: '§ 556 Abs. 3 BGB' }],
  describe: (v) => `Zugang bis zum Ablauf des ${v}. Monats nach Ende des Zeitraums`,
}

// Einwendungen gegen die Abrechnung hat der Mieter dem Vermieter spätestens bis zum Ablauf des zwölften Monats nach
// Zugang der Abrechnung mitzuteilen; danach kann er sie nicht mehr geltend machen, es sei denn, er hat die Verspätung
// nicht zu vertreten (§ 556 Abs. 3 Satz 5 und 6 BGB, Wortlaut am 20.11.2026 gelesen; #190). `eventDate`: der Tag des
// Zugangs. Wie das Ende zu rechnen ist, steht in `practice.objection-end-of-month` (shared/period.ts, `objectionDeadline`).
export const bgbObjectionMonths: LawParam<number, 'eventDate'> = {
  id: 'bgb.objection-months',
  title: 'Einwendungsfrist des Mieters',
  norm: '§ 556 Abs. 3 Satz 5 BGB',
  timing: 'eventDate',
  versions: [{
    value: 12,
    source: { rank: 'law', cite: '§ 556 Abs. 3 Satz 5 und 6 BGB', url: 'https://www.gesetze-im-internet.de/bgb/__556.html', retrieved: '2026-11-20', checked: 'checked' },
    enacted: '§ 556 Abs. 3 BGB',
  }],
  describe: (v) => `Einwendungen bis zum Ablauf des ${v}. Monats nach Zugang der Abrechnung`,
}

// Umstellung auf Wärmelieferung im laufenden Mietverhältnis (Heizung PR 16, #213). Wortlaut am 11.10.2026
// gelesen: § 556c BGB (Abs. 1 Satz 2: „Beträgt der Jahresnutzungsgrad der bestehenden Anlage vor der
// Umstellung mindestens 80 Prozent, kann sich der Wärmelieferant … auf die Verbesserung der Betriebsführung
// der Anlage beschränken“; Abs. 2: „Der Vermieter hat die Umstellung spätestens drei Monate zuvor in Textform
// anzukündigen“) und § 11 Abs. 1 WärmeLV (https://www.gesetze-im-internet.de/w_rmelv/__11.html). `eventDate`:
// der Tag der Umstellung. Die erste Fassung beginnt mit dem Inkrafttreten der WärmeLV am 01.07.2013 (§ 13
// WärmeLV, primär); dass § 556c Abs. 1 und 2 am selben Tag in Kraft traten, steht nur sekundär fest. Für eine
// Umstellung davor gibt es keine Fassung; der Hinweis hat dann einen eigenen Text (server/src/heatDelivery.ts).
export const bgbHeatDeliverySwitch: LawParam<{ readonly noticeMonths: number; readonly efficiencyPercent: number }, 'eventDate'> = {
  id: 'bgb.heat-delivery-switch',
  title: 'Umstellung auf Wärmelieferung im laufenden Mietverhältnis',
  norm: '§ 556c BGB; § 11 WärmeLV',
  timing: 'eventDate',
  versions: [{
    validFrom: '2013-07-01',
    value: { noticeMonths: 3, efficiencyPercent: 80 },
    source: { rank: 'law', cite: '§ 556c Abs. 1 Satz 2, Abs. 2 BGB; § 11 Abs. 1, § 13 WärmeLV', url: 'https://www.gesetze-im-internet.de/bgb/__556c.html', retrieved: '2026-10-11', checked: 'checked' },
    enacted: '§ 556c BGB eingefügt durch Art. 1 G v. 11.03.2013 (BGBl. I S. 434); Wärmelieferverordnung vom 7. Juni 2013 (BGBl. I S. 1509)',
  }],
  describe: (v) => `Ankündigung spätestens ${v.noticeMonths} Monate vor der Umstellung; ab ${v.efficiencyPercent} % Jahresnutzungsgrad genügt eine verbesserte Betriebsführung`,
}

// ---------- Fristen nach Werktagen (shared/deadlines.ts) ----------
// `eventDate`: gefragt wird am ersten Tag des Monats, dessen Miete fällig wird, bzw. am letzten Tag der Frist.

// § 556b Abs. 1 BGB, am 15.10.2026 im Wortlaut gelesen: „Die Miete ist zu Beginn, spätestens bis zum dritten
// Werktag der einzelnen Zeitabschnitte zu entrichten, nach denen sie bemessen ist.“
export const bgbRentDueWorkday: LawParam<number, 'eventDate'> = {
  id: 'bgb.rent-due-workday',
  title: 'Fälligkeit der Miete',
  norm: '§ 556b Abs. 1 BGB',
  timing: 'eventDate',
  versions: [{
    value: 3,
    source: { rank: 'law', cite: '§ 556b Abs. 1 BGB', url: 'https://www.gesetze-im-internet.de/bgb/__556b.html', retrieved: '2026-10-15', checked: 'checked' },
    enacted: '§ 556b Abs. 1 BGB, geltende Fassung',
  }],
  describe: (v) => `spätestens bis zum ${v}. Werktag des Monats`,
}

// Ob die Miete zu Beginn des Monats fällig ist (#312 PR 2, Zehn-Tage-Regel der Steuer). Art. 229 § 3 Abs. 1 EGBGB, am
// 31.10.2026 auf gesetze-im-internet.de im Wortlaut gelesen: „Auf ein am 1. September 2001 bestehendes Mietverhältnis oder
// Pachtverhältnis sind … 7. hinsichtlich der Fälligkeit § 551 des Bürgerlichen Gesetzbuchs in der bis zum 1. September
// 2001 geltenden Fassung anzuwenden.“ Nach § 551 BGB a. F. ist die nach Zeitabschnitten bemessene Miete nach Ablauf des
// einzelnen Abschnitts zu entrichten, also am Monatsende (Wortlaut der alten Fassung nicht amtlich gelesen); für alle
// späteren Mietverhältnisse gilt § 556b Abs. 1 BGB (zu Beginn, spätestens am dritten Werktag). Beides ist abdingbar; eine
// vertragliche Abweichung steht am Mietverhältnis (`Tenancy.rentDue`, #334), dieser Wert gilt, wenn dort nichts steht.
// Dass § 551 a. F. die Miete nachträglich fällig stellte, steht mittelbar in BGH VIII ZR 291/09 Rn. 17 (eine
// Vorauszahlungsklausel verlegt die Fälligkeit „abweichend von … § 551 Abs. 1 BGB aF … auf den Beginn des Monats“) und
// VIII ZR 107/12 Rn. 14, beide am 07.11.2026 im Volltext gelesen.
// `eventDate`: gefragt wird mit dem Tag, ab dem das Mietverhältnis besteht (Vertrag, sonst Beginn).
// **Grenzfall 01.09.2001 (Auslegung)**: Ein Mietverhältnis, das an diesem Tag beginnt oder geschlossen wird, „besteht“ am
// 01.09.2001; die alte Fassung gilt deshalb einschließlich dieses Tages, § 556b erst ab dem 02.09.2001.
// Fassung 1 ist `adopted`: Art. 229 § 3 ist gelesen, der Wortlaut von § 551 a. F. (Fälligkeit nach Ablauf des
// Zeitabschnitts) nicht amtlich.
export const bgbRentDueAtStart: LawParam<boolean, 'eventDate'> = {
  id: 'bgb.rent-due-at-start',
  title: 'Miete zu Beginn des Monats fällig',
  norm: '§ 556b Abs. 1 BGB; Art. 229 § 3 Abs. 1 Nr. 7 EGBGB',
  timing: 'eventDate',
  versions: [
    {
      validTo: '2001-09-01',
      value: false,
      source: { rank: 'law', cite: 'Art. 229 § 3 Abs. 1 Nr. 7 EGBGB mit § 551 BGB a. F.; Wortlaut von § 551 a. F. nicht amtlich gelesen, mittelbar BGH VIII ZR 291/09 vom 13.07.2010, Rn. 17, und VIII ZR 107/12 vom 10.10.2012, Rn. 14', url: 'https://www.gesetze-im-internet.de/bgbeg/art_229__3.html', retrieved: '2026-11-07', checked: 'adopted' },
      enacted: '§ 551 BGB in der bis zum 01.09.2001 geltenden Fassung, fortgeltend nach Art. 229 § 3 Abs. 1 Nr. 7 EGBGB (Wortlaut von § 551 a. F. nicht amtlich gelesen)',
    },
    {
      validFrom: '2001-09-02',
      value: true,
      source: { rank: 'law', cite: '§ 556b Abs. 1 BGB', url: 'https://www.gesetze-im-internet.de/bgb/__556b.html', retrieved: '2026-10-31', checked: 'checked' },
      enacted: '§ 556b Abs. 1 BGB, eingefügt durch das Mietrechtsreformgesetz vom 19.06.2001, in Kraft am 01.09.2001',
    },
  ],
  describe: (v) => (v ? 'die Miete ist zu Beginn des Monats fällig' : 'die Miete ist am Ende des Monats fällig'),
}

// Ob der Samstag bei dieser Frist als Werktag zählt: nein (BGH, Urteil vom 13.07.2010, VIII ZR 129/09, ebenso
// VIII ZR 291/09). Die drei Tage sollen dem Mieter ungeschmälert zur Verfügung stehen, und Bankgeschäftstage
// sind Montag bis Freitag; das gilt für Verträge vor und nach dem 01.09.2001. Gelesen in der Pressemitteilung
// des BGH Nr. 144/2010 am 15.10.2026. Nicht dafür einschlägig ist VIII ZR 222/15 (05.10.2016): Es entscheidet,
// dass die Überweisung bis zum dritten Werktag beauftragt sein muss, nicht eingegangen (Leitsatz gelesen).
export const bgbRentDueSaturday: LawParam<boolean, 'eventDate'> = {
  id: 'bgb.rent-due-saturday',
  title: 'Samstag bei der Fälligkeit der Miete',
  norm: 'BGH, Urteil vom 13.07.2010, VIII ZR 129/09',
  timing: 'eventDate',
  versions: [{
    value: false,
    source: { rank: 'court', cite: 'BGH, Urteil vom 13.07.2010, VIII ZR 129/09 (Pressemitteilung Nr. 144/2010)', url: 'https://www.bundesgerichtshof.de/SharedDocs/Pressemitteilungen/DE/2010/2010144.html', retrieved: '2026-10-15', checked: 'checked' },
    enacted: 'Rechtsprechung des VIII. Zivilsenats seit 13.07.2010',
  }],
  describe: (v) => (v ? 'der Samstag zählt als Werktag' : 'der Samstag zählt nicht als Werktag'),
}

// § 193 BGB, am 15.10.2026 im Wortlaut gelesen: „Ist an einem bestimmten Tage oder innerhalb einer Frist eine
// Willenserklärung abzugeben oder eine Leistung zu bewirken und fällt der bestimmte Tag oder der letzte Tag
// der Frist auf einen Sonntag, einen am Erklärungs- oder Leistungsort staatlich anerkannten allgemeinen
// Feiertag oder einen Sonnabend, so tritt an die Stelle eines solchen Tages der nächste Werktag.“
export type DeadlineShift = { readonly saturday: boolean; readonly sunday: boolean; readonly holiday: boolean }
export const bgbDeadlineOnWorkday: LawParam<DeadlineShift, 'eventDate'> = {
  id: 'bgb.deadline-on-workday',
  title: 'Fristende am Wochenende oder Feiertag',
  norm: '§ 193 BGB',
  timing: 'eventDate',
  versions: [{
    value: { saturday: true, sunday: true, holiday: true },
    source: { rank: 'law', cite: '§ 193 BGB', url: 'https://www.gesetze-im-internet.de/bgb/__193.html', retrieved: '2026-10-15', checked: 'checked' },
    enacted: '§ 193 BGB, geltende Fassung',
  }],
  describe: (v) => {
    const days = [v.saturday && 'Sonnabend', v.sunday && 'Sonntag', v.holiday && 'Feiertag am Erklärungs- oder Leistungsort'].filter((d): d is string => typeof d === 'string')
    return `fällt das Fristende auf ${days.join(', ')}, tritt der nächste Werktag an seine Stelle`
  },
}

// ---------- Laufzeit einer Überweisung (#334, shared/rentDue.ts) ----------

// Wie viele Geschäftstage eine Überweisung nach dem Auftrag höchstens braucht, bis der Betrag bei der Bank des Empfängers
// eingeht, aufgeteilt nach Grund. Am 07.11.2026 im Wortlaut gelesen: Der Auftrag wird mit Zugang wirksam; fällt der Zugang
// nicht auf einen Geschäftstag, gilt er am folgenden als zugegangen, ebenso nach einem Annahmeschluss „nahe am Ende eines
// Geschäftstags“ (§ 675n Abs. 1 Sätze 1 bis 3 BGB, `afterCutoff`). Der Betrag muss „spätestens am Ende des auf den
// Zugangszeitpunkt des Zahlungsauftrags folgenden Geschäftstags“ beim Zahlungsdienstleister des Empfängers eingehen
// (§ 675s Abs. 1 Satz 1 BGB, `execution`), bei einem in Papierform ausgelösten Vorgang kann die Frist „um einen weiteren
// Geschäftstag verlängert werden“ (Satz 3, `paper`). `eventDate`: gefragt am Fälligkeitstag. Die Buchung auf dem Konto
// des Vermieters ist eine Auslegung und steht getrennt (`practice.credit-booking-days`).
export type TransferDays = { readonly afterCutoff: number; readonly execution: number; readonly paper: number }
export const bgbTransferExecutionDays: LawParam<TransferDays, 'eventDate'> = {
  id: 'bgb.transfer-execution-days',
  title: 'Laufzeit einer Überweisung bis zur Bank des Empfängers',
  norm: '§ 675n Abs. 1, § 675s Abs. 1 BGB',
  timing: 'eventDate',
  versions: [{
    value: { afterCutoff: 1, execution: 1, paper: 1 },
    source: { rank: 'law', cite: '§ 675n Abs. 1 Sätze 1 bis 4, § 675s Abs. 1 Sätze 1 und 3 BGB', url: 'https://www.gesetze-im-internet.de/bgb/__675s.html', retrieved: '2026-11-07', checked: 'checked' },
    enacted: '§§ 675n, 675s BGB, geltende Fassung',
  }],
  describe: (v) => `höchstens ${v.afterCutoff + v.execution + v.paper} Geschäftstage bis zum Eingang bei der Bank des Empfängers (${v.afterCutoff} für einen Auftrag nach Annahmeschluss, ${v.execution} für die Ausführung, ${v.paper} bei Papierform)`,
}

// Die Mietsicherheit darf höchstens das Dreifache der auf einen Monat entfallenden Miete ohne die als Pauschale oder
// als Vorauszahlung ausgewiesenen Betriebskosten betragen (§ 551 Abs. 1 BGB, gelesen am 12.11.2026; #228). Mit dem
// Wert wird nur geprüft: Liegt die vereinbarte Kaution darüber, steht ein Hinweis am Feld (shared/deposit.ts).
export const bgbDepositMaxMonths: LawParam<number, 'eventDate'> = {
  id: 'bgb.deposit-max-months',
  title: 'Höchstbetrag der Mietkaution in Monatsmieten',
  norm: '§ 551 Abs. 1 BGB',
  timing: 'eventDate',
  versions: [{
    value: 3,
    source: { rank: 'law', cite: '§ 551 Abs. 1 BGB', url: 'https://www.gesetze-im-internet.de/bgb/__551.html', retrieved: '2026-11-12', checked: 'checked' },
    enacted: '§ 551 BGB',
  }],
  describe: (v) => `höchstens ${v} Monatsmieten ohne Betriebskosten`,
  checkOnly: true,
}

// ---------- Mieterhöhung (#191, Entwurf docs/superpowers/specs/2026-11-20-mieterhoehung-design.md) ----------
// Wortlaut der §§ 557a, 557b, 558, 558b BGB am 20.11.2026 auf gesetze-im-internet.de gelesen. Gerechnet wird mit diesen
// Werten ab PR 2 (server/src/rentIncrease.ts); `eventDate` heißt je nach Wert der Tag des Wirksamwerdens oder des Zugangs.
const bgbRentIncreaseSource = (cite: string, section: string): Source =>
  ({ rank: 'law', cite, url: `https://www.gesetze-im-internet.de/bgb/__${section}.html`, retrieved: '2026-11-20', checked: 'checked' })

// Wartefrist: Die Miete muss am Tag, zu dem die Erhöhung eintreten soll, seit 15 Monaten unverändert sein; Erhöhungen
// nach §§ 559 bis 560 werden nicht berücksichtigt (§ 558 Abs. 1 Satz 1 und 3). `eventDate`: der Tag des Wirksamwerdens.
export const bgbRentIncreaseWaitMonths: LawParam<number, 'eventDate'> = {
  id: 'bgb.rent-increase-wait-months',
  title: 'Wartefrist vor einer Erhöhung bis zur Vergleichsmiete',
  norm: '§ 558 Abs. 1 Satz 1 und 3 BGB',
  timing: 'eventDate',
  versions: [{ value: 15, source: bgbRentIncreaseSource('§ 558 Abs. 1 Satz 1 und 3 BGB', '558'), enacted: '§ 558 BGB' }],
  describe: (v) => `Miete beim Wirksamwerden seit ${v} Monaten unverändert`,
}

// Jahressperrfrist: Das Verlangen kann frühestens ein Jahr nach der letzten Mieterhöhung geltend gemacht werden; §§ 559
// bis 560 zählen nicht (§ 558 Abs. 1 Satz 2 und 3), auch einvernehmliche Modernisierungserhöhungen nicht (BGH, Urteil vom
// 18.07.2007, VIII ZR 285/06). Dass die Frist ab dem Wirksamwerden der letzten Erhöhung läuft, ist herrschende Meinung
// (Recherche O11, nur sekundär belegt). `eventDate`: der Tag des Zugangs.
export const bgbRentIncreaseLockMonths: LawParam<number, 'eventDate'> = {
  id: 'bgb.rent-increase-lock-months',
  title: 'Sperrfrist nach der letzten Mieterhöhung',
  norm: '§ 558 Abs. 1 Satz 2 und 3 BGB',
  timing: 'eventDate',
  versions: [{ value: 12, source: bgbRentIncreaseSource('§ 558 Abs. 1 Satz 2 und 3 BGB', '558'), enacted: '§ 558 BGB' }],
  describe: (v) => `Zugang frühestens ${v} Monate nach der letzten Erhöhung`,
}

// Kappungsgrenze: innerhalb von drei Jahren höchstens 20 vom Hundert, von Erhöhungen nach §§ 559 bis 560 abgesehen; 15 vom
// Hundert in Gebieten, die eine Landesverordnung bestimmt (§ 558 Abs. 3). Ausgangsmiete ist die drei Jahre vor dem
// Wirksamwerden geltende vereinbarte Miete (BGH VIII ZR 177/03, VIII ZR 266/14 Rn. 20, VIII ZR 33/18). Die 15 % gibt es
// seit dem Mietrechtsänderungsgesetz 2013; der Tag des Inkrafttretens ist nicht im BGBl. gelesen, deshalb keine
// Grenze der Fassung (offener Punkt im Entwurf). `eventDate`: der Tag des Wirksamwerdens.
export const bgbRentCap: LawParam<{ readonly years: number; readonly percent: number; readonly reducedPercent: number }, 'eventDate'> = {
  id: 'bgb.rent-cap',
  title: 'Kappungsgrenze',
  norm: '§ 558 Abs. 3 BGB',
  timing: 'eventDate',
  versions: [{ value: { years: 3, percent: 20, reducedPercent: 15 }, source: bgbRentIncreaseSource('§ 558 Abs. 3 Satz 1 und 2 BGB', '558'), enacted: '§ 558 BGB' }],
  describe: (v) => `innerhalb von ${v.years} Jahren höchstens ${v.percent} % mehr, in Gebieten mit Verordnung ${v.reducedPercent} %`,
}

// Zustimmung und Klage: Zustimmung bis zum Ablauf des zweiten Kalendermonats nach Zugang, die erhöhte Miete ab Beginn des
// dritten, Klage innerhalb von drei weiteren Monaten (§ 558b Abs. 1 und 2). `eventDate`: der Tag des Zugangs.
export const bgbRentIncreaseConsent: LawParam<{ readonly consentMonths: number; readonly effectiveMonth: number; readonly suitMonths: number }, 'eventDate'> = {
  id: 'bgb.rent-increase-consent',
  title: 'Zustimmungs- und Klagefrist beim Mieterhöhungsverlangen',
  norm: '§ 558b Abs. 1 und 2 BGB',
  timing: 'eventDate',
  versions: [{ value: { consentMonths: 2, effectiveMonth: 3, suitMonths: 3 }, source: bgbRentIncreaseSource('§ 558b Abs. 1 und 2 BGB', '558b'), enacted: '§ 558b BGB' }],
  describe: (v) => `Zustimmung bis zum Ablauf des ${v.consentMonths}. Kalendermonats nach Zugang, erhöhte Miete ab Beginn des ${v.effectiveMonth}., Klage binnen ${v.suitMonths} weiterer Monate`,
}

// Indexmiete: Die Miete muss jeweils mindestens ein Jahr unverändert bleiben, §§ 559 bis 560 ausgenommen (§ 557b Abs. 2
// Satz 1); die geänderte Miete ist mit Beginn des übernächsten Monats nach Zugang der Erklärung zu entrichten (Abs. 3
// Satz 3). Mietfuchs lässt die Erklärung erst ein Jahr nach dem Wirksamwerden der letzten Änderung zugehen (Entwurf R9,
// Gegenprüfung M4). `eventDate`: der Tag des Zugangs.
export const bgbIndexRent: LawParam<{ readonly minMonths: number; readonly effectiveMonthOffset: number }, 'eventDate'> = {
  id: 'bgb.index-rent',
  title: 'Indexmiete: Mindestdauer und Wirksamwerden',
  norm: '§ 557b Abs. 2 und 3 BGB',
  timing: 'eventDate',
  versions: [{ value: { minMonths: 12, effectiveMonthOffset: 2 }, source: bgbRentIncreaseSource('§ 557b Abs. 2 Satz 1, Abs. 3 Satz 3 BGB', '557b'), enacted: '§ 557b BGB' }],
  describe: (v) => `Miete mindestens ${v.minMonths} Monate unverändert, geänderte Miete ab Beginn des ${v.effectiveMonthOffset}. Monats nach Zugang`,
}

// Staffelmiete: Die Miete muss jeweils mindestens ein Jahr unverändert bleiben (§ 557a Abs. 2 Satz 1). Mietfuchs warnt
// bei kürzerem Abstand und rechnet die Staffel, wie sie vereinbart ist (Recherche O5). `eventDate`: der Monat der Stufe.
export const bgbStaggeredRent: LawParam<{ readonly minMonths: number }, 'eventDate'> = {
  id: 'bgb.staggered-rent',
  title: 'Staffelmiete: Mindestabstand der Stufen',
  norm: '§ 557a Abs. 2 Satz 1 BGB',
  timing: 'eventDate',
  versions: [{ value: { minMonths: 12 }, source: bgbRentIncreaseSource('§ 557a Abs. 2 Satz 1 BGB', '557a'), enacted: '§ 557a BGB' }],
  describe: (v) => `jede Stufe mindestens ${v.minMonths} Monate unverändert`,
}
