
// Vermieter, IBAN und Zahlungsfrist am Objekt oder aus den Einstellungen (#92); die Regel steht in
// shared/landlord.ts, weil auch der Server das Anschreiben damit füllt (#415).
export { effectiveLandlord } from '../../shared/landlord.ts'

// Kopfzeile (Rücksendeangabe) und Anschrift des Mieters stehen in shared/landlord.ts, weil der Server sie ins
// Anschreiben einsetzt und mit ihm einfriert (#415).
export { footerLine, formerRecipientLines, letterhead, recipientLines, returnLine } from '../../shared/landlord.ts'
import { formerRecipientLines, recipientLines } from '../../shared/landlord.ts'
import { andList } from '../../shared/wording.ts'
import type { Property } from './types'

// Die Anschrift im Fensterfeld vor dem Versand (#229). `former`: Der Mieter ist ausgezogen, und gedruckt würde die
// Anschrift der Wohnung, weil keine für den Schriftverkehr eingetragen ist (Durchsicht S3). `outdated`: Abgeschlossen ist
// die Anschrift eingefroren (`printed`, aus dem Anschreiben), und heute steht eine andere am Mietverhältnis; gedruckt
// wird die eingefrorene. Nach dem Versand ist nichts mehr zu tun.
export type AddressCheck = 'former' | 'outdated' | null
type RecipientTenancy = { end?: string | null, correspondenceAddress?: string }
// Verglichen wird der Inhalt, nicht die Zeilen (Durchsicht M2): Vor #229 trennte Mietfuchs die eigene Anschrift nur vor
// der Postleitzahl, und ein so eingefrorener Stand ist keine andere Anschrift; ebenso wenig doppelter Leerraum.
const addressParts = (lines: readonly string[]) =>
  lines.join(', ').split(/\s*[\n,]\s*/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '')
const sameLines = (a: readonly string[], b: readonly string[]) => {
  const x = addressParts(a)
  const y = addressParts(b)
  return x.length === y.length && x.every((l, i) => l === y[i])
}

// Warum die Frist auch gegenüber dem bisherigen Mieter zählt (K1); bewusst vorsichtig formuliert.
export const DEADLINE_SENTENCE = 'Die Frist nach § 556 Abs. 3 BGB läuft auch gegenüber dem bisherigen Mieter; gewahrt ist sie nur, wenn ihm die Abrechnung rechtzeitig zugeht, und an die geräumte Wohnung geschickt erreicht sie ihn in der Regel nicht.'

// Das Anschriftfeld im Druck (letter.css: 10 pt, 80 mm breit, 27,3 mm hoch, was darüber hinausgeht, ist abgeschnitten)
// fasst sechs Zeilen; eine Zeile hat Platz für rund 45 Zeichen, nachgemessen im Druckbild mit üblichen Anschriften
// (Durchsicht S1). Eine längere bricht um und belegt zwei Zeilen. Eine Schätzung wie `RETURN_LINE_MAX`.
export const ADDRESS_MAX_LINES = 6
export const ADDRESS_LINE_MAX = 45
export function addressFieldWarning(lines: readonly string[]): string | null {
  const used = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.trim().length / ADDRESS_LINE_MAX)), 0)
  if (used <= ADDRESS_MAX_LINES) return null
  const long = lines.find((l) => l.trim().length > ADDRESS_LINE_MAX)
  const cut = 'was darüber hinausgeht, wird im Druck abgeschnitten. Kürzen Sie die Anschrift.'
  return long && lines.length <= ADDRESS_MAX_LINES
    ? `Die Zeile „${long.trim()}“ ist länger als rund ${ADDRESS_LINE_MAX} Zeichen und bricht um; im Anschriftfeld passen ${ADDRESS_MAX_LINES} Zeilen, ${cut}`
    : `Die Anschrift hat ${used} Zeilen; im Anschriftfeld passen ${ADDRESS_MAX_LINES}, ${cut}`
}
export function addressCheck(
  st: { tenantName: string, unitName: string },
  tenancy: RecipientTenancy | null | undefined,
  printed: readonly string[] | null | undefined,
  property: Pick<Property, 'address'> | null | undefined,
  today: string,
  sentAt: string | null | undefined,
): AddressCheck {
  if (sentAt || !tenancy) return null
  // Bis zum Druck nach #415 stand die Wohnung als eigene Zeile in der Anschrift; so eingefroren ist es dieselbe Anschrift.
  const same = (a: readonly string[], t: RecipientTenancy | null) =>
    sameLines(a, recipientLines(st.tenantName, t, property)) || sameLines(a, formerRecipientLines(st.tenantName, st.unitName, t, property))
  const shown = printed ?? recipientLines(st.tenantName, tenancy, property)
  if (!same(shown, tenancy)) return 'outdated'
  const movedOut = !!tenancy.end && tenancy.end < today
  return movedOut && same(shown, null) ? 'former' : null
}

// Dieselbe Prüfung am Feld einer eigenen Anschrift (Mieterwechsel, Stammdaten), bevor etwas gedruckt wird.
export function ownAddressWarning(tenantName: string, correspondenceAddress: string): string | null {
  if (correspondenceAddress.trim() === '') return null
  return addressFieldWarning(recipientLines(tenantName.trim() || 'Name', { correspondenceAddress }, null))
}

// Der Hinweis dazu, auf der Seite Abrechnung je Mieter (vor dem Druck, nicht gedruckt).
export function addressNotice(check: Exclude<AddressCheck, null>, tenantName: string, unitName: string): { title: string, text: string } {
  return check === 'former'
    ? {
        title: 'Anschrift nach dem Auszug fehlt',
        text: `${tenantName} ist ausgezogen; gedruckt würde die Anschrift der Wohnung ${unitName}. Tragen Sie beim Mietverhältnis eine Anschrift für den Schriftverkehr ein. ${DEADLINE_SENTENCE}`,
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
    former.length > 0 ? `${andList(former)} ${former.length === 1 ? 'ist' : 'sind'} ausgezogen, ohne dass eine neue Anschrift eingetragen ist; die Abrechnung ginge an die Wohnung. ${DEADLINE_SENTENCE}` : '',
    outdated.length > 0 ? `Die Anschrift von ${andList(outdated)} lautet heute anders als beim Abschluss; gedruckt wird die eingefrorene, bis Sie die Abrechnung wieder öffnen und erneut abschließen.` : '',
  ].filter((s) => s !== '').join(' ')
}

