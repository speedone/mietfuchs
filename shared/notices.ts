// Hinweise der Berechnung, die Server und Oberfläche gleich lesen (#112, #319).
//
// INFORMATIONAL: reine Auskünfte ohne Handlungsbedarf. Sie färben die Ampel nicht (die Begründung je
// Code steht hier, in client/src/notices.ts und an der Stelle in calc.ts, die sie erzeugt) und sichern
// das Abschließen nicht ab.

import type { Notice } from './types.ts'

export const INFORMATIONAL: ReadonlySet<string> = new Set(['basis.unit-zero', 'basis.tenancy-zero', 'basis.vacancy-persons', 'basis.vacancy-no-area', 'heating.remote-reading', 'period.short', 'period.heating-differs',
  // Heizung PR 10: Hinweise der eigenen Heizkostenabrechnung ohne Handlungsbedarf.
  'heating.interim-reading-off', 'heating.reading-dates-differ', 'heating.change-split-time', 'heating.heat-pump-capture',
  // #314: die Gegenrichtung, nach Gradtagen bei Leerstand, Eigennutzung oder Wechsel ohne Zwischenablesung; beides ist
  // nach § 9b Abs. 2 HeizkostenV zulässig, nichts zu beheben.
  'heating.change-split-degree-days',
  // Heizung PR 13 (Entwurf 10.1: „hint (färbt nicht)“): eine bestätigte Schätzung nach § 9a, auch neben
  // vollständiger Ablesung, die der Vermieter damit als unbrauchbar markiert (Durchsicht von #242, R-I7).
  'heating.estimated', 'heating.estimate-complete',
  // Folge-PR zu #252 (#224, Entscheidung F6): Der Hinweis trifft auch den rechtmäßigen Fall „eigener Zähler,
  // Vermieter trägt den Strom selbst“ und lässt sich ohne Buchung nicht beheben; er färbt deshalb nicht.
  'heating.operating-power-missing',
  // #266: Fehlt nur die Rechnung des eigenen Stromvertrags, trägt der Vermieter eigenes Geld; den Mietern schadet das
  // nicht. „Abzug des Betriebsstroms fehlt“ steht bewusst nicht hier: Er ist der Fall des BGH mit ausdrücklicher Angabe.
  'heating.operating-power-bill-missing',
  // #270: Der Vermieter trägt den Betriebsstrom nach eigener Angabe selbst, weil er dem Messdienst nicht gemeldet ist;
  // rechtmäßig und den Mietern unschädlich.
  'heating.operating-power-not-reported',
  // Heizung PR 16 (Prüfung C-S8): Die Umstellung auf Wärmelieferung nennt jedes Jahr die Rechtslage für die Mieter von
  // vor der Umstellung; beheben lässt sie sich nicht, und sie färbt deshalb nicht.
  'heating.contracting',
  // Heizung PR 19 (Durchsicht S-5): Auskunft, nichts zu beheben. Sie steht bei jeder richtig eingerichteten Heizung,
  // deren Brennstoff der Mieter bezieht; die Hinweise zur CO₂-Erstattung (`co2.refund-*`) färben weiter.
  'co2.self-supply-items',
  // Durchsicht S-2: Ohne Angabe, wie der Betriebsstrom erfasst ist, ist der Hinweis Auskunft wie `heating.operating-power-missing`
  // (#265); ein eigener Stromvertrag der Heizung führt so nicht zu einer dauerhaft gelben Ampel.
  'heating.self-supply-operating-power',
  // #219: Auskunft zur Rohrwärme bei Heizkostenverteilern; ob sie zutrifft, kennt Mietfuchs nicht.
  'heating.pipe-heat',
  // #218: Auskunft, dass eine Vorerfassung nach § 5 Abs. 7 Satz 2 möglich ist; sie ist dort keine Pflicht.
  'heating.pre-capture',
  // #311: Auskunft, wie Mietfuchs den angebrochenen Monat ansetzt; nichts ist falsch erfasst.
  'prepayment.partial-month',
  // #258: Auskunft, dass eine Position laut Mietvertrag nicht umgelegt wird und ihr Anteil beim Vermieter bleibt; richtig
  // erfasst, nichts zu beheben. `allocation.other-unanswered` steht bewusst nicht hier: Es fragt nach einer Angabe.
  'allocation.not-agreed'])

// Die Hinweise, die das Abschließen einer Abrechnung absichern (#319): Stufe `error`, also Angaben,
// die sich widersprechen (eine Position wird nicht verteilt, Mietverhältnisse überschneiden sich).
// Abgeschlossen wird dann nur nach Bestätigung, verweigert wird es nicht. Warnungen und Hinweise
// fragen nicht nach, und eine Auskunft aus INFORMATIONAL nie, auch wenn sie einmal die Stufe wechselte.
export function blockingErrors(notices: readonly Notice[]): Notice[] {
  return notices.filter((n) => n.level === 'error' && !INFORMATIONAL.has(n.code))
}
