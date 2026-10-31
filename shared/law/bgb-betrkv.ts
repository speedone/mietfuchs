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
// vertragliche Abweichung kennt Mietfuchs nicht (bewusste Grenze).
// `eventDate`: gefragt wird mit dem Tag, ab dem das Mietverhältnis besteht (Vertrag, sonst Beginn).
export const bgbRentDueAtStart: LawParam<boolean, 'eventDate'> = {
  id: 'bgb.rent-due-at-start',
  title: 'Miete zu Beginn des Monats fällig',
  norm: '§ 556b Abs. 1 BGB; Art. 229 § 3 Abs. 1 Nr. 7 EGBGB',
  timing: 'eventDate',
  versions: [
    {
      validTo: '2001-08-31',
      value: false,
      source: { rank: 'law', cite: 'Art. 229 § 3 Abs. 1 Nr. 7 EGBGB mit § 551 BGB a. F.', url: 'https://www.gesetze-im-internet.de/bgbeg/art_229__3.html', retrieved: '2026-10-31', checked: 'checked' },
      enacted: '§ 551 BGB in der bis zum 01.09.2001 geltenden Fassung, fortgeltend nach Art. 229 § 3 Abs. 1 Nr. 7 EGBGB (Wortlaut von § 551 a. F. nicht amtlich gelesen)',
    },
    {
      validFrom: '2001-09-01',
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
