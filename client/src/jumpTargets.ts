// Wohin die Knöpfe in Leerzuständen, in der Checkliste des Cockpits und in Hinweisen springen (#554). Vorher führten
// sie nur auf die Zielseite, und das Formular oder die Stelle musste man dort selbst suchen. Die Regel: Gibt es genau
// einen betroffenen Eintrag, öffnet der Sprung ihn (wie „Hier beheben →“ seit #142); sonst führt er zur Karte, in der
// man das Offene erledigt; „Anlegen“ öffnet das Formular. Wo es keine eindeutige Stelle gibt (der Eingang der Belege,
// der Kostenvergleich, die Abrechnung als Ganzes), bleibt es bei der Seite. Ohne DOM prüfbar (jumpTargets.test.ts).
import type { NoticeSubject } from './types'
import type { JumpTarget } from './focus'

export const NEW_UNIT_TARGET: JumpTarget = { kind: 'new', what: 'unit' }
export const NEW_TENANCY_TARGET: JumpTarget = { kind: 'new', what: 'tenancy' }
export const NEW_COST_ITEM_TARGET: JumpTarget = { kind: 'new', what: 'costItem' }
export const TENANCIES_TARGET: JumpTarget = { kind: 'section', section: 'tenancies' }
// „Zu prüfen“ in der Abrechnung: dort stehen die Hinweise der Berechnung und die Prüfungen der Seite (Anschrift, Absender)
export const CHECKS_TARGET: JumpTarget = { kind: 'section', section: 'checks' }
// Der Versand einer abgeschlossenen Abrechnung: „Als versendet markieren“, mit gespeichertem Datum das Feld „versendet am“ (#337)
export const SENT_AT_TARGET: JumpTarget = { kind: 'section', section: 'sentAt' }
// Die Kopfangaben der Anlage V stehen am Objekt, unter „Für die Steuer (Anlage V)“
export const TAX_HEADER_TARGET: JumpTarget = { kind: 'property', part: 'tax' }
export const LANDLORD_SETTINGS_TARGET: JumpTarget = { kind: 'section', section: 'landlord' }
export const PROPERTY_LANDLORD_TARGET: JumpTarget = { kind: 'property', part: 'landlord' }
export const AI_SETTINGS_TARGET: JumpTarget = { kind: 'section', section: 'ai' }
// „So aktualisieren Sie“: die Anleitung steht in der Karte „Über Mietfuchs“
export const UPDATE_GUIDE_TARGET: JumpTarget = { kind: 'section', section: 'about' }
// „Ohne Passwort im Netz“ in der Seitenleiste (#528): die Karte „Anmeldung“ der Einstellungen
export const ACCESS_TARGET: JumpTarget = { kind: 'section', section: 'access' }

// Eine betroffene Wohnung öffnet sich selbst, mehrere führen zur Karte „Wohnungen“.
export function unitsTarget(ids: readonly string[]): JumpTarget {
  const [only] = ids
  return ids.length === 1 && only !== undefined ? { kind: 'unit', id: only } : { kind: 'section', section: 'units' }
}

// Der Eintrag, wenn es genau einen gibt; sonst bleibt es bei der Seite (Zähler, Kosten haben keine Karte dafür).
export function soleSubject(kind: NoticeSubject['kind'], ids: readonly string[]): NoticeSubject | undefined {
  const [only] = ids
  return ids.length === 1 && only !== undefined ? { kind, id: only } : undefined
}

// „Absender fehlt“ (Abrechnung): Führt das Objekt einen eigenen Vermieter, zu dessen Angaben am Objekt, sonst zur Karte
// „Vermieter & Zahlung“ der Einstellungen.
export function senderFix(own: boolean): { tab: 'stammdaten' | 'einstellungen'; label: string; focus: JumpTarget } {
  return own
    ? { tab: 'stammdaten', label: 'Hier beheben → Stammdaten', focus: PROPERTY_LANDLORD_TARGET }
    : { tab: 'einstellungen', label: 'Hier beheben → Einstellungen', focus: LANDLORD_SETTINGS_TARGET }
}
