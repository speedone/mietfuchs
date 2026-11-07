// Werte aus Praxis oder Auslegung (Heizung PR 1, Entwurf 4.3). Sie sind keine Rechtswerte;
// Ausweis und Lexikon nennen ihre Herkunft.
import type { LawParam } from './register.ts'

// **Personen je Leerstandstag beim Personenschlüssel (#177).** Den Anteil einer leerstehenden
// Wohnung trägt der Vermieter (BGH, Urteil vom 31.05.2006, VIII ZR 159/05, entschieden am
// Flächenschlüssel). Wie die leere Wohnung beim Personenschlüssel anzusetzen ist, regelt kein
// Gesetz, und höchstrichterlich ist es nicht abschließend geklärt: Nach BGH, Beschluss vom
// 08.01.2013, VIII ZR 180/12, entscheidet der Tatrichter im Einzelfall nach Billigkeit, und es
// „kann in Betracht kommen“, für den Leerstand eine fiktive Person anzusetzen, vor allem bei
// Kosten, die nicht von der Personenzahl abhängen.
// Auslegung nach BGH VIII ZR 180/12; LG Krefeld, 17.03.2010, 2 S 56/09 (eine Person statt null);
// abweichend AG Köln WuM 2002, 28 (Durchschnittsbelegung). Mietfuchs setzt jeden Tag ohne
// Mietverhältnis mit dieser Zahl an, bei allen Positionen nach Personen (`vacancyPersons` in
// computeSettlement). Bis PR 1 stand der Wert als `VACANCY_PERSONS` in calc.ts.
export const practiceVacancyPersons: LawParam<number, 'periodStart'> = {
  id: 'practice.vacancy-persons',
  title: 'Personen je Leerstandstag beim Personenschlüssel',
  norm: 'Auslegung nach BGH, Beschluss vom 08.01.2013, VIII ZR 180/12',
  timing: 'periodStart',
  versions: [{
    value: 1,
    source: {
      rank: 'interpretation',
      cite: 'BGH, Beschluss vom 08.01.2013, VIII ZR 180/12',
      url: 'https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BGH&Datum=08.01.2013&Aktenzeichen=VIII%20ZR%20180/12',
      retrieved: '2026-10-05',
      checked: 'adopted',
    },
    enacted: 'Festlegung von Mietfuchs (#177)',
  }],
  describe: (v) => (v === 1 ? '1 Person je Leerstandstag' : `${v} Personen je Leerstandstag`),
}
// **Ablesung neben dem Stichtag oder dem Wechsel** (Heizung PR 10, Entwurf 3.5, 15.2 F2 und F3).
// Gerechnet wird mit dem abgelesenen Wert, wie er ist (OLG Schleswig, RE vom 04.10.1990, 4 RE-Miet
// 1/88: unschädlich, wenn in der Zwischenzeit wenig verbraucht wird; LG Osnabrück, NZM 2004, 95: keine
// Rückrechnung nach Gradtagen; beide sekundär über Haufe und mietrecht.org). Wie weit daneben noch
// zulässig ist, sagt weder die Verordnung noch die Rechtsprechung; AG Nordhorn, 3 C 15/03, hielt eine
// Ablesung am 20.02. für zu spät. Der Kommentar bei Haufe: „In den Wintermonaten ist eine Abweichung
// von einem Monat grundsätzlich als nicht zulässig anzusehen.“ Daraus die Warngrenze: ab einem Monat
// Abweichung, wenn ein Monat von Oktober bis April dazwischen liegt. Literatur, keine Rechtsquelle;
// ⟨Norm offen: VDI 2077⟩.
export type ReadingOffWarning = { readonly months: number; readonly winterMonths: readonly string[] }
export const practiceReadingOffWarning: LawParam<ReadingOffWarning, 'periodStart'> = {
  id: 'practice.reading-off-warning',
  title: 'Warngrenze für Ablesungen neben dem Stichtag',
  norm: 'Kommentar zum Ablesezeitpunkt (Haufe); OLG Schleswig, RE vom 04.10.1990, 4 RE-Miet 1/88',
  timing: 'periodStart',
  versions: [{
    value: { months: 1, winterMonths: ['10', '11', '12', '01', '02', '03', '04'] },
    source: {
      rank: 'interpretation',
      cite: 'Haufe, HeizKV: Ablesung und Abrechnungs- und Verbrauchsinformation, 3 Ablesezeitpunkt',
      url: 'https://www.haufe.de/id/beitrag/heizkv-ablesung-und-abrechnungs-und-verbrauchsinformat-3-ablesezeitpunkt-HI14901091.html',
      retrieved: '2026-10-05',
      checked: 'checked',
    },
    enacted: 'Festlegung von Mietfuchs (Entwurf 15.2 F2, F3); ⟨Norm offen: VDI 2077⟩',
  }],
  describe: (v) => `Warnung ab ${v.months === 1 ? 'einem Monat' : `${v.months} Monaten`} Abweichung, wenn ein Monat von Oktober bis April dazwischen liegt`,
}

// Verdunster (Heizung PR 12, Entwurf 3.5, 4.3, 8.1): Eine Zwischenablesung empfiehlt die
// Arbeitsgemeinschaft Heiz- und Wasserkostenverteilung nur, wenn seit der Hauptablesung 400 bis 800 ‰
// der Gradtagszahlen vergangen sind; sonst wird nach Gradtagen geteilt. Kein Rechtswert und keine
// Rechnung in Mietfuchs: Verdunster wertet der Ablesedienst aus, und Mietfuchs nennt die Regel nur im
// Lexikon.
export const practiceEvaporatorWindow: LawParam<{ readonly min: number; readonly max: number }, 'periodStart'> = {
  id: 'practice.evaporator-window',
  title: 'Zwischenablesung bei Verdunstern',
  norm: 'Empfehlung der Arbeitsgemeinschaft Heiz- und Wasserkostenverteilung (keine Rechtsnorm)',
  timing: 'periodStart',
  versions: [{
    value: { min: 400, max: 800 },
    source: {
      rank: 'practice',
      cite: 'Berliner Mieterverein, Info 73: Empfehlung der Arbeitsgemeinschaft Wärmemessdienste, eine Zwischenablesung bei Verdunstern sei sinnvoll zwischen 400 und 800 ‰ der Gradtagszahlen',
      url: 'https://www.berliner-mieterverein.de/recht/infoblaetter/info-73-heizkostenabrechnung-worauf-achten-beim-mieterwechsel-zwischenablesung-und-gradtagszahlentabelle.htm',
      retrieved: '2026-10-05',
      checked: 'checked',
    },
    enacted: 'Empfehlung der ARGE Heiz- und Wasserkostenverteilung, wiedergegeben 2026',
  }],
  describe: (v) => `${v.min} bis ${v.max} ‰ der Gradtagszahlen seit der Hauptablesung`,
}

// **Allgemeinverbrauch über dem Bezugszähler (#98, Entwurf 2026-11-04-virtuelle-zaehler-design.md, „Recht und
// Hinweise“).** Messen alle Einheiten der Gruppe, ist der Rest des Bezugszählers eine Messdifferenz. Eine gesetzliche
// Grenze gibt es nicht; nach dem Orientierungssatz von LG Braunschweig, Urteil vom 22.12.1998, 6 S 163/98 (WuM 1999,
// 294), darf der Vermieter eine Differenz bis 20 % umlegen, eine darüber schließt jede Umlage der Unterschiedsmenge aus
// (gelesen bei Haufe am 05.11.2026). Ebenso, nur aus zweiter Hand, AG Mitte, 20 C 394/06. Mietfuchs rechnet mit dem Rest
// trotzdem und warnt darüber (`meter.rest-high`); ein Prüfwert, kein Rechenwert. Bei einer Gruppe ohne Zähler ist der
// Rest kein Messfehler, dort wird nicht gefragt.
export const practiceMeterRestHigh: LawParam<number, 'periodStart'> = {
  id: 'practice.meter-rest-high',
  checkOnly: true,
  title: 'Warngrenze für den Allgemeinverbrauch bei ganz gemessener Gruppe',
  norm: 'Instanzrechtsprechung, LG Braunschweig, Urteil vom 22.12.1998, 6 S 163/98',
  timing: 'periodStart',
  versions: [{
    value: 20,
    source: {
      rank: 'court',
      cite: 'LG Braunschweig, Urteil vom 22.12.1998, 6 S 163/98, Orientierungssatz',
      url: 'https://www.haufe.de/id/entscheidung/lg-braunschweig-urteil-vom-22121998-6-s-16398-HI538299.html',
      retrieved: '2026-11-05',
      checked: 'checked',
    },
    enacted: 'Festlegung von Mietfuchs (#98) nach LG Braunschweig, 6 S 163/98',
  }],
  describe: (v) => `Warnung ab mehr als ${v} % Allgemeinverbrauch`,
}

// **Buchung nach dem Eingang (#334, Entwurf E3).** Der Zahlungsdienstleister des Empfängers hat den Betrag „unverzüglich
// verfügbar zu machen, nachdem“ er eingegangen ist; nur die Wertstellung muss spätestens an dem Geschäftstag liegen, an
// dem er eingegangen ist (§ 675t Abs. 1 Sätze 1 und 2 BGB, gelesen am 07.11.2026). Mietfuchs kennt nur das Buchungsdatum,
// nicht die Wertstellung, und ein Buchungstag nach dem Eingang ist nicht ausgeschlossen. Auslegung von Mietfuchs: ein
// Geschäftstag für die Buchung. `eventDate`: gefragt am Fälligkeitstag.
export const practiceCreditBookingDays: LawParam<number, 'eventDate'> = {
  id: 'practice.credit-booking-days',
  title: 'Buchung einer eingegangenen Überweisung',
  norm: 'Auslegung zu § 675t Abs. 1 BGB',
  timing: 'eventDate',
  versions: [{
    value: 1,
    source: {
      rank: 'interpretation',
      cite: 'Auslegung zu § 675t Abs. 1 Sätze 1 und 2 BGB (unverzüglich verfügbar, Wertstellung spätestens am Geschäftstag des Eingangs)',
      url: 'https://www.gesetze-im-internet.de/bgb/__675t.html',
      retrieved: '2026-11-07',
      checked: 'adopted',
    },
    enacted: 'Festlegung von Mietfuchs (#334, Entwurf E3)',
  }],
  describe: (v) => (v === 1 ? 'ein Geschäftstag für die Buchung nach dem Eingang' : `${v} Geschäftstage für die Buchung nach dem Eingang`),
}

// **Tage ohne Geschäftsbetrieb der Banken (#334, Entwurf E3).** Geschäftstag ist ein Tag, an dem der beteiligte
// Zahlungsdienstleister den Geschäftsbetrieb unterhält (§ 675n Abs. 1 Satz 4 BGB). Der 24. und der 31. Dezember sind keine
// gesetzlichen Feiertage; dass viele Banken dort keinen Geschäftsbetrieb unterhalten, ist eine Annahme aus der Praxis.
// Mietfuchs zählt sie deshalb nicht als Bankgeschäftstag, das verschiebt den erwarteten Eingang nur nach hinten.
// `eventDate`: gefragt an dem Tag, der Bankgeschäftstag sein soll. Tage als 'MM-TT'.
export const practiceBankClosedDays: LawParam<readonly string[], 'eventDate'> = {
  id: 'practice.bank-closed-days',
  title: 'Tage ohne Geschäftsbetrieb der Banken',
  norm: 'Annahme aus der Praxis zu § 675n Abs. 1 Satz 4 BGB',
  timing: 'eventDate',
  versions: [{
    value: ['12-24', '12-31'],
    source: {
      rank: 'practice',
      cite: 'Annahme aus der Praxis: kein Geschäftsbetrieb vieler Banken am 24. und 31. Dezember (keine gesetzlichen Feiertage)',
      url: 'https://www.gesetze-im-internet.de/bgb/__675n.html',
      retrieved: '2026-11-07',
      checked: 'adopted',
    },
    enacted: 'Festlegung von Mietfuchs (#334, Entwurf E3)',
  }],
  describe: (v) => `kein Bankgeschäftstag: ${v.map((d) => `${d.slice(3, 5)}.${d.slice(0, 2)}.`).join(' und ')}`,
}
