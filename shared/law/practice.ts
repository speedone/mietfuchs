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
      cite: 'Berliner Mieterverein, Info 73 (Wiedergabe der Empfehlung der ARGE); ista, Fachwissen Zwischenablesung',
      url: 'https://www.berliner-mieterverein.de/recht/infoblaetter/info-73-heizkostenabrechnung-worauf-achten-beim-mieterwechsel-zwischenablesung-und-gradtagszahlentabelle.htm',
      retrieved: '2026-10-05',
      checked: 'checked',
    },
    enacted: 'Empfehlung der ARGE Heiz- und Wasserkostenverteilung, wiedergegeben 2026',
  }],
  describe: (v) => `${v.min} bis ${v.max} ‰ der Gradtagszahlen seit der Hauptablesung`,
}
