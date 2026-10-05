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
