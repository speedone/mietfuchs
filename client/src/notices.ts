// Hinweise der Abrechnung (#112): was die Seite aus den Hinweisen der Berechnung macht, ohne DOM
// prüfbar. Die Stufen sind in shared/types.ts fachlich bestimmt.

import { fmtDate } from './api'
import type { LegalBasis, Notice, NoticeLevel, NoticeSubject, Settlement } from './types'

export const NOTICE_LEVEL_LABELS: Record<NoticeLevel, string> = {
  error: 'Fehler',
  warning: 'Warnung',
  hint: 'Hinweis',
  info: 'Info',
}

const SEVERITY: Record<NoticeLevel, number> = { error: 0, warning: 1, hint: 2, info: 3 }

// Die Hinweise zum Anzeigen: das Schwerste zuerst, sonst in der Reihenfolge der Berechnung
// (`sort` ist stabil). Eine Abrechnung, die vor #112 abgeschlossen wurde, kennt nur ihre
// Textliste; die erscheint wie bisher, als Warnungen ohne Titel.
export function noticesOf(settlement: Pick<Settlement, 'notices' | 'warnings'>): Notice[] {
  if (!settlement.notices) {
    return settlement.warnings.map((text) => ({ code: 'legacy', level: 'warning', title: '', text }))
  }
  return settlement.notices.slice().sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level])
}

// Färbt die Hinweise das Cockpit gelb? Jeder Hinweis zählt als offener Punkt, auch einer der
// Stufe `hint`: Die Abnahme hat gerade solche als nützlich bestätigt (etwa eine Summe der
// Hausgeldabrechnung, die nicht zum Anteil passt). Ausgenommen sind nur die beiden Hinweise auf
// eine bewusst eingetragene 0 (#135): Die 0 m² oder 0 Personen einer Einheit ohne Fläche und
// Bewohner (Garage, Stellplatz) sind eine Angabe des Nutzers und kein Versäumnis, und die Ampel
// „Mietverhältnisse & Flächen“ nennt sie schon. Eine vergessene Fläche oder Personenzahl
// (`basis.unit-no-area`, `basis.tenancy-no-persons`) zählt dagegen. Eine vor #112 abgeschlossene Abrechnung kennt nur Texte; die
// zählen wie bisher.
// Ebenso reine Auskünfte zum Leerstand beim Personenschlüssel (#177): `basis.vacancy-persons`
// erklärt, warum ein Anteil beim Vermieter bleibt, und erschiene sonst in jedem Jahr mit Leerstand;
// `basis.vacancy-no-area` ist die leere Garage, also wieder eine bewusst eingetragene 0.
// Und die Erinnerung an fernablesbare Geräte ab 2027 (#110): Welche Geräte eingebaut sind, erfasst
// Mietfuchs nicht, im Programm lässt sich also nichts beheben; sonst stünde die Ampel in jedem Haus
// mit Heizabrechnung dauerhaft auf Gelb.
// Ebenso die eigene Heizperiode (Heizung PR 5): zulässig und nur eine Auskunft.
const INFORMATIONAL = new Set(['basis.unit-zero', 'basis.tenancy-zero', 'basis.vacancy-persons', 'basis.vacancy-no-area', 'heating.remote-reading', 'period.short', 'period.heating-differs'])
export function noticesNeedAttention(settlement: Pick<Settlement, 'notices' | 'warnings'>): boolean {
  return noticesOf(settlement).some((n) => !INFORMATIONAL.has(n.code))
}

// Die Farbe der Cockpit-Zeile (#204): rot, sobald ein Hinweis der Stufe `error` dabei ist, denn
// dann widersprechen sich die Angaben (Position nicht verteilt, Mietverhältnisse überschneiden
// sich); gelb bei allem anderen, was etwas verlangt; sonst grün.
export function attentionLevel(settlement: Pick<Settlement, 'notices' | 'warnings'>): 'rot' | 'gelb' | 'gruen' {
  const open = noticesOf(settlement).filter((n) => !INFORMATIONAL.has(n.code))
  if (open.some((n) => n.level === 'error')) return 'rot'
  return open.length > 0 ? 'gelb' : 'gruen'
}

// Der Text der Cockpit-Zeile: nur, was etwas verlangt. Eine reine Auskunft steht vollständig auf
// der Seite Abrechnung; im Cockpit wäre der Hinweis zur Fernablesbarkeit sonst ein Block von gut
// 900 Zeichen in einer grünen Zeile.
export function attentionDetail(settlement: Pick<Settlement, 'notices' | 'warnings'>): string {
  const texts = noticesOf(settlement).filter((n) => !INFORMATIONAL.has(n.code)).map((n) => n.text)
  return texts.length > 0 ? texts.join(' · ') : 'Nur Auskünfte, nichts zu beheben. Sie stehen auf der Seite Abrechnung.'
}

// Die CSS-Klasse je Stufe. Hinweis und Info teilen sich eine ruhige Farbe: Beides verlangt
// nichts, und eine eigene Farbe für „reine Auskunft“ wäre eine mehr, die man lernen muss.
export function noticeClass(level: NoticeLevel): 'error' | 'notice' | 'hint' {
  return level === 'error' ? 'error' : level === 'warning' ? 'notice' : 'hint'
}

export type NoticeTab = 'kosten' | 'stammdaten' | 'zaehler' | 'mietkonto'
const TARGETS: Record<NoticeSubject['kind'], { tab: NoticeTab, page: string }> = {
  costItem: { tab: 'kosten', page: 'Kosten' },
  unit: { tab: 'stammdaten', page: 'Stammdaten' },
  tenancy: { tab: 'stammdaten', page: 'Stammdaten' },
  meter: { tab: 'zaehler', page: 'Zähler' },
  rentLedger: { tab: 'mietkonto', page: 'Mietkonto' },
  heatingPlant: { tab: 'stammdaten', page: 'Stammdaten' },
  // Heizung PR 6: die CO₂-Angaben; vorerst die Karte „Heizung“ in den Stammdaten, mit Task 11 die
  // Seite Heizkosten.
  heatingCosts: { tab: 'stammdaten', page: 'Stammdaten' },
}

// Wohin „Hier beheben →“ führt: zur Seite und dort zum Eintrag (#142). `focus` reicht die App an
// die Zielseite weiter; die öffnet den Eintrag, sobald er geladen ist (useFocusTarget in focus.ts).
export function noticeTarget(subject: NoticeSubject | undefined): { tab: NoticeTab, label: string, focus: NoticeSubject } | null {
  if (!subject) return null
  // Noch keine Heizanlage (Heizung PR 6, Entwurf 11.1): Der Knopf führt zur Einrichtung in den
  // Stammdaten und heißt so.
  if (subject.kind === 'heatingPlant' && subject.id === '') {
    return { tab: 'stammdaten', label: 'Heizung einrichten →', focus: { kind: subject.kind, id: subject.id } }
  }
  // Eine Art, die diese Fassung nicht kennt (eingefrorene oder neuere Abrechnung), ergibt keinen
  // Knopf statt eines Absturzes.
  const target: { tab: NoticeTab, page: string } | undefined = Object.hasOwn(TARGETS, subject.kind) ? TARGETS[subject.kind] : undefined
  if (!target) return null
  return { tab: target.tab, label: `Hier beheben → ${target.page}`, focus: { kind: subject.kind, id: subject.id } }
}

// Der Rechtsstand als Kopfzeile, eine Zeile je Regel und eine je Rechtswert, mit dem gerechnet
// wurde (Heizung PR 1). Fehlt der Rechtsstand, wurde die Abrechnung abgeschlossen, bevor Mietfuchs
// ihn festhielt; fehlen nur die Werte, vor 0.11.0. Beides steht dann ausdrücklich da, statt dass
// die Zeile verschwindet.
export function legalBasisLines(legalBasis: LegalBasis | undefined): { head: string, rules: string[], values: string[], valuesNote: string | null } {
  if (!legalBasis) return { head: 'Rechtsstand nicht erfasst: Diese Abrechnung wurde abgeschlossen, bevor Mietfuchs ihn festhielt.', rules: [], values: [], valuesNote: null }
  return {
    head: `Rechtsstand ${fmtDate(legalBasis.asOf)}`,
    rules: legalBasis.rules.map((r) => {
      const range = [r.validFrom && `ab ${fmtDate(r.validFrom)}`, r.validTo && `bis ${fmtDate(r.validTo)}`].filter(Boolean).join(' ')
      return `${r.title} (${r.norm})${range ? `, gilt ${range}` : ''}`
    }),
    // Mit Gültigkeit, wo es eine gibt: Ein Wert, der im Jahr nur zum Teil oder nicht mehr gilt (die
    // Kabelregel 2025), läse sich sonst wie geltendes Recht des Jahres (Durchsicht von #221, I1).
    values: (legalBasis.values ?? []).map((v) => {
      const range = [v.validFrom && `ab ${fmtDate(v.validFrom)}`, v.validTo && `bis ${fmtDate(v.validTo)}`].filter(Boolean).join(' ')
      return `${v.title}: ${v.text} (${v.cite})${range ? `, gilt ${range}` : ''}`
    }),
    valuesNote: legalBasis.values ? null : 'Rechtswerte nicht gespeichert (vor 0.11.0)',
  }
}
