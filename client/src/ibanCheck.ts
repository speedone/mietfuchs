import type { NoticeSubject, Property, Settings, Tenancy } from './types'
import { checkIban } from '../../shared/iban.ts'

// Der Hinweis im Cockpit auf vermutlich falsch eingetragene IBANs (#279). Seit der Prüfung beim
// Speichern kommt keine neue ungültige mehr hinzu; die alten bleiben aber stehen, denn sie werden
// nie still geändert, und ein Backup oder der Umstieg übernimmt sie ungeprüft. Gefragt wird nach
// dem Bestand, den das Cockpit ohnehin hat: Einstellungen, gewähltes Objekt und seine
// Mietverhältnisse.
//
// **Dezent und ohne Ampel**: Eine falsche IBAN ändert keine Zahl der Abrechnung. Sie zählt nicht
// zur Fertigstellung und färbt nichts rot; sie steht als ruhiger Hinweis da, mit dem Sprung zur
// Stelle, an der sie steht.

export type IbanFinding = {
  // Wo sie steht, für den Satz im Cockpit
  where: string
  // Was nicht stimmt, aus shared/iban.ts
  problem: string
  tab: 'einstellungen' | 'stammdaten'
  // Das Mietverhältnis, das die Stammdaten öffnen sollen
  focus: NoticeSubject | null
  label: string
}

const problemOf = (iban: string | null | undefined): string | null => {
  if (!iban) return null
  const check = checkIban(iban)
  return check.ok ? null : check.problem
}

export function invalidIbans(
  settings: Pick<Settings, 'iban'> | null,
  property: Pick<Property, 'name' | 'iban'> | null,
  tenancies: readonly Pick<Tenancy, 'id' | 'tenantName' | 'iban'>[],
): IbanFinding[] {
  const befunde: IbanFinding[] = []
  const vermieter = problemOf(settings?.iban)
  if (vermieter) {
    befunde.push({ where: 'Einstellungen, Bankverbindung des Vermieters', problem: vermieter, tab: 'einstellungen', focus: null, label: 'Hier beheben → Einstellungen' })
  }
  const objekt = problemOf(property?.iban)
  if (objekt) {
    const name = property?.name ? `„${property.name}“` : 'ohne Namen'
    befunde.push({ where: `Objekt ${name}, abweichende Bankverbindung`, problem: objekt, tab: 'stammdaten', focus: null, label: 'Hier beheben → Stammdaten' })
  }
  for (const t of tenancies) {
    const mieter = problemOf(t.iban)
    if (mieter) {
      befunde.push({ where: `Mietverhältnis „${t.tenantName}“`, problem: mieter, tab: 'stammdaten', focus: { kind: 'tenancy', id: t.id }, label: 'Hier beheben → Mietverhältnis' })
    }
  }
  return befunde
}

export const ibanHintTitle = (count: number): string =>
  count === 1 ? 'Eine IBAN ist vermutlich falsch eingetragen' : `${count} IBANs sind vermutlich falsch eingetragen`
