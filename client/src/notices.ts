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

// Färbt die Hinweise das Cockpit gelb? Nur ein Fehler oder eine Warnung; ein Hinweis verlangt
// nichts (#135: 0 m² bei einer Garage ist eine Angabe). Eine vor #112 abgeschlossene Abrechnung
// kennt nur Texte, die gelten wie bisher als Warnungen.
export function noticesNeedAttention(settlement: Pick<Settlement, 'notices' | 'warnings'>): boolean {
  return noticesOf(settlement).some((n) => n.level === 'error' || n.level === 'warning')
}

// Die CSS-Klasse je Stufe. Hinweis und Info teilen sich eine ruhige Farbe: Beides verlangt
// nichts, und eine eigene Farbe für „reine Auskunft“ wäre eine mehr, die man lernen muss.
export function noticeClass(level: NoticeLevel): 'error' | 'notice' | 'hint' {
  return level === 'error' ? 'error' : level === 'warning' ? 'notice' : 'hint'
}

export type NoticeTab = 'kosten' | 'stammdaten' | 'zaehler'
const TARGETS: Record<NoticeSubject['kind'], { tab: NoticeTab, page: string }> = {
  costItem: { tab: 'kosten', page: 'Kosten' },
  unit: { tab: 'stammdaten', page: 'Stammdaten' },
  tenancy: { tab: 'stammdaten', page: 'Stammdaten' },
  meter: { tab: 'zaehler', page: 'Zähler' },
}

// Wohin „Hier beheben →“ führt: zur Seite, nicht zum einzelnen Eintrag.
export function noticeTarget(subject: NoticeSubject | undefined): { tab: NoticeTab, label: string } | null {
  if (!subject) return null
  const target = TARGETS[subject.kind]
  return { tab: target.tab, label: `Hier beheben → ${target.page}` }
}

// Der Rechtsstand als Kopfzeile und eine Zeile je Regel. Fehlt er, wurde die Abrechnung
// abgeschlossen, bevor Mietfuchs ihn festhielt; das steht dann ausdrücklich da, statt dass
// die Zeile verschwindet.
export function legalBasisLines(legalBasis: LegalBasis | undefined): { head: string, rules: string[] } {
  if (!legalBasis) return { head: 'Rechtsstand nicht erfasst: Diese Abrechnung wurde abgeschlossen, bevor Mietfuchs ihn festhielt.', rules: [] }
  return {
    head: `Rechtsstand ${fmtDate(legalBasis.asOf)}`,
    rules: legalBasis.rules.map((r) => {
      const range = [r.validFrom && `ab ${fmtDate(r.validFrom)}`, r.validTo && `bis ${fmtDate(r.validTo)}`].filter(Boolean).join(' ')
      return `${r.title} (${r.norm})${range ? `, gilt ${range}` : ''}`
    }),
  }
}
