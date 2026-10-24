// Vermieter, Bankverbindung und Zahlungsfrist auf dem Ausdruck (#92): Das Objekt geht vor, und
// `null` heißt „die Vorgabe aus den Einstellungen gilt“. Eine leere Angabe am Objekt ist dagegen
// eine Angabe, etwa für ein Haus, dessen Miete bar gezahlt wird.
import { expect, test } from 'vitest'
import { effectiveLandlord, letterhead, addressCheck, addressCheckDetail, addressFieldWarning, addressFindings, ADDRESS_LINE_MAX, formerRecipientLines, recipientLines } from './landlord'
import type { Property } from './types'

const vorgabe = { landlordName: 'Erika Muster', iban: 'DE01', paymentDeadlineDays: 30 }
const objekt = (abweichend: Partial<Property>): Property => ({
  id: 'o', name: 'X', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...abweichend,
})

test('ohne Abweichung gilt die Vorgabe', () => {
  // Anschrift und Kontakt (#415, Teil 2) fehlen in der Vorgabe und sind dann leer.
  expect(effectiveLandlord(objekt({}), vorgabe)).toEqual({ ...vorgabe, landlordAddress: '', landlordContact: '' })
  expect(effectiveLandlord(null, vorgabe)).toEqual({ ...vorgabe, landlordAddress: '', landlordContact: '' })
})

test('was am Objekt steht, geht vor, auch eine leere Angabe', () => {
  expect(effectiveLandlord(objekt({ landlordName: 'Erbengemeinschaft Muster', iban: '', paymentDeadlineDays: 14 }), vorgabe))
    .toEqual({ landlordName: 'Erbengemeinschaft Muster', iban: '', paymentDeadlineDays: 14, landlordAddress: '', landlordContact: '' })
  expect(effectiveLandlord(objekt({ landlordAddress: 'Am Hang 3, 01067 Dresden' }), { ...vorgabe, landlordAddress: 'Hauptstr. 1', landlordContact: 'Tel. 1' }))
    .toMatchObject({ landlordAddress: 'Am Hang 3, 01067 Dresden', landlordContact: 'Tel. 1' })
})

test('Kopfzeile (#142): Trenner nur zwischen vorhandenen Angaben', () => {
  expect(letterhead('', { name: 'Haus Birke', address: '' })).toBe('Haus Birke')
  expect(letterhead('Erika Muster', { name: 'Haus Birke', address: '  ' })).toBe('Erika Muster · Haus Birke')
  expect(letterhead('Erika Muster', { name: 'Haus Birke', address: 'Birkenweg 1, 12345 Ort' })).toBe('Erika Muster · Haus Birke · Birkenweg 1, 12345 Ort')
  expect(letterhead(null, null)).toBe('')
})

test('Kopfzeile (N5, #341): ein Objektname, der schon in der Adresse steht, steht nicht doppelt da', () => {
  expect(letterhead('Erika Muster', { name: 'Lindenweg 12', address: 'Lindenweg 12, 12345 Musterstadt' })).toBe('Erika Muster · Lindenweg 12, 12345 Musterstadt')
  expect(letterhead('', { name: 'lindenweg 12', address: 'Lindenweg 12, 12345 Musterstadt' })).toBe('Lindenweg 12, 12345 Musterstadt')
  // Nur der Anfang zählt: ein anderer Name bleibt stehen.
  expect(letterhead('', { name: 'Musterstadt', address: 'Lindenweg 12, 12345 Musterstadt' })).toBe('Musterstadt · Lindenweg 12, 12345 Musterstadt')
})

// Druck (#415): Die Lage der Wohnung („EG links“) gehört nicht in die postalische Anschrift, sondern in Betreff und Kopf der
// Abrechnung. Der bisherige Aufbau bleibt für den Druck einer vor #415 abgeschlossenen Abrechnung (`formerRecipientLines`).
test('Anschrift des Mieters (N5): abweichende Anschrift vor der Adresse des Objekts, ohne Lage der Wohnung', () => {
  expect(recipientLines('Anna Beispiel', {}, { address: 'Lindenweg 12, 12345 Musterstadt' }))
    .toEqual(['Anna Beispiel', 'Lindenweg 12', '12345 Musterstadt'])
  expect(recipientLines('Anna Beispiel', { correspondenceAddress: 'Birkenweg 3, 54321 Anderswo' }, { address: 'Lindenweg 12, 12345 Musterstadt' }))
    .toEqual(['Anna Beispiel', 'Birkenweg 3', '54321 Anderswo'])
  expect(recipientLines('Anna Beispiel', null, { address: '' })).toEqual(['Anna Beispiel'])
  expect(formerRecipientLines('Anna Beispiel', 'EG links', {}, { address: 'Lindenweg 12, 12345 Musterstadt' }))
    .toEqual(['Anna Beispiel', 'EG links', 'Lindenweg 12', '12345 Musterstadt'])
  expect(formerRecipientLines('Anna Beispiel', 'EG links', { correspondenceAddress: 'Birkenweg 3, 54321 Anderswo' }, null))
    .toEqual(['Anna Beispiel', 'Birkenweg 3', '54321 Anderswo'])
})

// #229: Jedes Komma der eigenen Anschrift ist eine Zeile im Anschriftfeld (DIN 5008), etwa „c/o“ oder ein Zusatz.
test('Anschrift für den Schriftverkehr: jede Angabe eine Zeile', () => {
  expect(recipientLines('Anna Beispiel', { correspondenceAddress: 'c/o Weber, Birkenweg 3,  Hinterhaus , 54321 Anderswo' }, { address: 'Lindenweg 12, 12345 Musterstadt' }))
    .toEqual(['Anna Beispiel', 'c/o Weber', 'Birkenweg 3', 'Hinterhaus', '54321 Anderswo'])
})

// #229, Durchsicht S3: Nach dem Auszug ohne eigene Anschrift ginge die Abrechnung an die alte Wohnung.
const st = { tenantName: 'Anna', unitName: 'EG' }
const haus = { address: 'Lindenweg 12, 12345 Musterstadt' }
const neu = 'Birkenweg 3, 54321 Anderswo'
test('ausgezogen ohne Anschrift für den Schriftverkehr: Mietfuchs weist darauf hin', () => {
  const check = (tenancy: { end: string | null, correspondenceAddress?: string }, printed?: string[] | null, sentAt: string | null = null) =>
    addressCheck(st, tenancy, printed, haus, '2026-03-01', sentAt)
  expect(check({ end: '2025-06-30' })).toBe('former')
  expect(check({ end: '2025-06-30', correspondenceAddress: neu })).toBeNull()
  expect(check({ end: null })).toBeNull()
  expect(check({ end: '2026-12-31' })).toBeNull()
  // Abgeschlossen: Gedruckt wird die eingefrorene Anschrift. Fehlte sie damals, hilft eine heute eingetragene nur nach
  // dem Wiederöffnen; das sagt der Hinweis.
  const frozenOld = recipientLines('Anna', null, haus)
  expect(check({ end: '2025-06-30' }, frozenOld)).toBe('former')
  expect(check({ end: '2025-06-30', correspondenceAddress: neu }, frozenOld)).toBe('outdated')
  expect(check({ end: '2025-06-30', correspondenceAddress: neu }, recipientLines('Anna', { correspondenceAddress: neu }, haus))).toBeNull()
  // Versendet: nichts mehr zu tun.
  expect(check({ end: '2025-06-30' }, frozenOld, '2026-02-01')).toBeNull()
})

// Durchsicht M2: Verglichen wird der Inhalt, nicht die Zeilen. Vor #229 trennte Mietfuchs die eigene Anschrift nur vor
// der Postleitzahl; ein so eingefrorener Stand ist keine geänderte Anschrift, ebenso wenig doppelter Leerraum.
test('eingefroren mit der früheren Trennung oder anderem Leerraum ist nicht „geändert“', () => {
  const address = 'Birkenweg 3, Hinterhaus, 54321 Anderswo'
  const frozenBefore229 = ['Anna', 'Birkenweg 3, Hinterhaus', '54321 Anderswo']
  expect(addressCheck(st, { end: '2025-06-30', correspondenceAddress: address }, frozenBefore229, haus, '2026-03-01', null)).toBeNull()
  expect(addressCheck(st, { end: '2025-06-30', correspondenceAddress: 'Birkenweg  3,  54321 Anderswo' }, ['Anna', 'Birkenweg 3', '54321 Anderswo'], haus, '2026-03-01', null)).toBeNull()
  // Der eingefrorene Stand ohne eigene Anschrift ist weiter „former“, wenn die heutige auch keine hat.
  expect(addressCheck(st, { end: '2025-06-30' }, ['Anna', 'EG', 'Lindenweg 12', '12345 Musterstadt'], haus, '2026-03-01', null)).toBe('former')
})

// Druck (#415): Bis zu dieser Änderung stand die Lage der Wohnung als eigene Zeile in der Anschrift, und so ist sie in
// abgeschlossenen Abrechnungen eingefroren. Das ist keine geänderte Anschrift.
test('eingefroren mit der Lage der Wohnung in der Anschrift ist nicht „geändert“', () => {
  const frozen = ['Anna', 'EG', 'Lindenweg 12', '12345 Musterstadt']
  expect(addressCheck(st, { end: null }, frozen, haus, '2026-03-01', null)).toBeNull()
  expect(addressCheck(st, { end: '2025-06-30' }, frozen, haus, '2026-03-01', null)).toBe('former')
  // Eine heute eingetragene Anschrift für den Schriftverkehr ist dagegen eine andere.
  expect(addressCheck(st, { end: '2025-06-30', correspondenceAddress: neu }, frozen, haus, '2026-03-01', null)).toBe('outdated')
})

// Durchsicht S1: Das Anschriftfeld fasst sechs Zeilen; eine längere Zeile bricht um und wird abgeschnitten.
test('Anschriftfeld: zu viele oder zu lange Zeilen werden vor dem Druck genannt', () => {
  expect(addressFieldWarning(['Anna', 'Birkenweg 3', '54321 Anderswo'])).toBeNull()
  expect(addressFieldWarning(['Anna', 'a', 'b', 'c', 'd', 'e', 'f'])).toMatch(/7 Zeilen.*6/)
  expect(addressFieldWarning(['Anna', `Birkenweg ${'3'.repeat(ADDRESS_LINE_MAX)}`])).toBeNull()
  expect(addressFieldWarning(['Anna', 'a', 'b', 'c', 'd', `Birkenweg ${'3'.repeat(ADDRESS_LINE_MAX)}`])).toMatch(/Zeile „Birkenweg/)
})

test('Cockpit: alle betroffenen Mieter einer Abrechnung, beim Namen', () => {
  const statements = [
    { tenancyId: 'a', tenantName: 'Anna', unitName: 'EG' }, { tenancyId: 'b', tenantName: 'Bernd', unitName: 'OG' },
    { tenancyId: 'c', tenantName: 'Carla', unitName: 'DG' }, { tenancyId: 'd', tenantName: 'Dora', unitName: 'DG' },
  ]
  const tenancies = [
    { id: 'a', end: '2025-06-30' }, { id: 'b', end: '2025-03-31' }, { id: 'c', end: null }, { id: 'd', end: '2025-12-31', correspondenceAddress: neu },
  ]
  const found = addressFindings({ statements }, tenancies, haus, '2026-03-01')
  expect(found).toEqual([{ tenancyId: 'a', tenantName: 'Anna', check: 'former' }, { tenancyId: 'b', tenantName: 'Bernd', check: 'former' }])
  expect(addressCheckDetail(found)).toMatch(/^Anna und Bernd sind ausgezogen, ohne dass eine neue Anschrift eingetragen ist; .*§ 556 Abs\. 3 BGB/)
  // Abgeschlossen mit der Wohnung im Anschriftfeld, danach für Dora eine andere eingetragen; versendet schweigt alles.
  const letters = { d: { recipient: recipientLines('Dora', null, haus) } }
  const closed = addressFindings({ statements, letters, closed: { sentAt: null } }, tenancies, haus, '2026-03-01')
  expect(closed.find((f) => f.tenancyId === 'd')?.check).toBe('outdated')
  expect(addressCheckDetail(closed)).toContain('Die Anschrift von Dora lautet heute anders als beim Abschluss')
  expect(addressFindings({ statements, letters, closed: { sentAt: '2026-02-01' } }, tenancies, haus, '2026-03-01')).toEqual([])
})
