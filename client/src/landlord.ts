
// Vermieter, IBAN und Zahlungsfrist am Objekt oder aus den Einstellungen (#92); die Regel steht in
// shared/landlord.ts, weil auch der Server das Anschreiben damit füllt (#415).
export { effectiveLandlord } from '../../shared/landlord.ts'

// Kopfzeile (Rücksendeangabe) und Anschrift des Mieters stehen in shared/landlord.ts, weil der Server sie ins
// Anschreiben einsetzt und mit ihm einfriert (#415).
export { footerLine, letterhead, recipientLines, returnLine } from '../../shared/landlord.ts'
import { recipientLines } from '../../shared/landlord.ts'
import { andList } from '../../shared/wording.ts'
import type { Property } from './types'

// Die Anschrift im Fensterfeld vor dem Versand (#229). `former`: Der Mieter ist ausgezogen, und gedruckt würde die
// Anschrift der Wohnung, weil keine für den Schriftverkehr eingetragen ist (Durchsicht S3). `outdated`: Abgeschlossen ist
// die Anschrift eingefroren (`printed`, aus dem Anschreiben), und heute steht eine andere am Mietverhältnis; gedruckt
// wird die eingefrorene. Nach dem Versand ist nichts mehr zu tun.
export type AddressCheck = 'former' | 'outdated' | null
type RecipientTenancy = { end?: string | null, correspondenceAddress?: string }
const sameLines = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((l, i) => l === b[i])
export function addressCheck(
  st: { tenantName: string, unitName: string },
  tenancy: RecipientTenancy | null | undefined,
  printed: readonly string[] | null | undefined,
  property: Pick<Property, 'address'> | null | undefined,
  today: string,
  sentAt: string | null | undefined,
): AddressCheck {
  if (sentAt || !tenancy) return null
  const current = recipientLines(st.tenantName, st.unitName, tenancy, property)
  const shown = printed ?? current
  if (!sameLines(shown, current)) return 'outdated'
  const movedOut = !!tenancy.end && tenancy.end < today
  return movedOut && sameLines(shown, recipientLines(st.tenantName, st.unitName, null, property)) ? 'former' : null
}

// Der Hinweis dazu, auf der Seite Abrechnung je Mieter (vor dem Druck, nicht gedruckt).
export function addressNotice(check: Exclude<AddressCheck, null>, tenantName: string, unitName: string): { title: string, text: string } {
  return check === 'former'
    ? {
        title: 'Anschrift nach dem Auszug fehlt',
        text: `${tenantName} ist ausgezogen; gedruckt würde die Anschrift der Wohnung ${unitName}. Tragen Sie beim Mietverhältnis eine Anschrift für den Schriftverkehr ein: Die Frist nach § 556 Abs. 3 BGB läuft auch gegenüber dem bisherigen Mieter.`,
      }
    : {
        title: 'Anschrift nach dem Abschluss geändert',
        text: `Die Anschrift von ${tenantName} lautet heute anders als beim Abschluss. Gedruckt wird die eingefrorene Anschrift. Soll die neue im Anschriftfeld stehen, öffnen Sie die Abrechnung wieder und schließen sie erneut ab.`,
      }
}

// Alle Mieter einer Abrechnung, deren Anschrift vor dem Versand zu prüfen ist (Cockpit). Eine vor #415 abgeschlossene
// Abrechnung ohne Anschreiben druckt die Anschrift von heute.
export function addressFindings(
  s: { statements: readonly { tenancyId: string, tenantName: string, unitName: string }[], letters?: Record<string, { recipient?: string[] }>, closed?: { sentAt?: string | null } | null },
  tenancies: readonly ({ id: string } & RecipientTenancy)[],
  property: Pick<Property, 'address'> | null | undefined,
  today: string,
): { tenancyId: string, tenantName: string, check: Exclude<AddressCheck, null> }[] {
  const out: { tenancyId: string, tenantName: string, check: Exclude<AddressCheck, null> }[] = []
  for (const st of s.statements) {
    const check = addressCheck(st, tenancies.find((t) => t.id === st.tenancyId), s.letters?.[st.tenancyId]?.recipient, property, today, s.closed?.sentAt)
    if (check) out.push({ tenancyId: st.tenancyId, tenantName: st.tenantName, check })
  }
  return out
}

// Die Zeile im Cockpit vor dem Versand: alle betroffenen Mieter beim Namen, in einem Satz je Lage.
export function addressCheckDetail(found: readonly { check: Exclude<AddressCheck, null>, tenantName: string }[]): string {
  const names = (check: Exclude<AddressCheck, null>) => found.filter((f) => f.check === check).map((f) => f.tenantName)
  const former = names('former')
  const outdated = names('outdated')
  return [
    former.length > 0 ? `${andList(former)} ${former.length === 1 ? 'ist' : 'sind'} ausgezogen, ohne dass eine neue Anschrift eingetragen ist; die Abrechnung ginge an die Wohnung. Die Frist nach § 556 Abs. 3 BGB läuft auch gegenüber dem bisherigen Mieter.` : '',
    outdated.length > 0 ? `Die Anschrift von ${andList(outdated)} lautet heute anders als beim Abschluss; gedruckt wird die eingefrorene, bis Sie die Abrechnung wieder öffnen und erneut abschließen.` : '',
  ].filter((s) => s !== '').join(' ')
}

