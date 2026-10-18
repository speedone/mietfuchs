// Die Karte „Objekt“ (#92): Was aus dem Formular in den Rumpf von PUT /api/properties wird.
import { expect, test } from 'vitest'
import { propertyBody, propertyToForm, STATE_OPTIONS, STATE_UNKNOWN_LABEL, stateFromSelect, stateNote, type PropertyForm } from './propertyForm'

const form = (over: Partial<PropertyForm>): PropertyForm => ({
  name: 'Haus', address: 'Weg 1', kind: 'mfh', own: false, landlordName: '', iban: '', paymentDeadlineDays: '', cable: 'unbekannt', tightMarket: 'unbekannt', tightMarketFrom: '', tightMarketTo: '', state: '', ...over,
})

test('ohne Haken gilt für alle drei die Vorgabe', () => {
  expect(propertyBody(form({ landlordName: 'X', iban: 'DE9', paymentDeadlineDays: '7' })))
    .toMatchObject({ landlordName: null, iban: null, paymentDeadlineDays: null })
})

test('mit Haken gilt nur, was eingetragen ist; ein leeres Feld heißt Vorgabe', () => {
  // Wer den Haken setzt, um nur eine andere IBAN einzutragen, soll den Vermieternamen auf der
  // Abrechnung nicht verlieren.
  expect(propertyBody(form({ own: true, iban: ' DE89 3704 0044 0532 0130 00 ' })))
    .toEqual({ name: 'Haus', address: 'Weg 1', kind: 'mfh', landlordName: null, iban: 'DE89370400440532013000', paymentDeadlineDays: null, cableBuiltBeforeDec2021: null, tightMarket: null, tightMarketFrom: null, tightMarketTo: null, state: null })
})

test('eine Frist, die keine ganze Zahl ab 0 ist, wird abgelehnt', () => {
  expect(propertyBody(form({ own: true, paymentDeadlineDays: '-3' }))).toMatchObject({ error: 'Die Zahlungsfrist ist eine ganze Zahl von Tagen, 0 oder mehr.', field: 'paymentDeadlineDays', short: 'Ganze Zahl von Tagen' })
  expect(propertyBody(form({ own: true, paymentDeadlineDays: '14' }))).toMatchObject({ paymentDeadlineDays: 14 })
})

test('Kabelanlage (#121): ja, nein und unbekannt gehen als true, false und null in den Rumpf und zurück', () => {
  expect(propertyBody(form({ cable: 'vor' }))).toMatchObject({ cableBuiltBeforeDec2021: true })
  expect(propertyBody(form({ cable: 'nach' }))).toMatchObject({ cableBuiltBeforeDec2021: false })
  expect(propertyBody(form({ cable: 'unbekannt' }))).toMatchObject({ cableBuiltBeforeDec2021: null })
  const p = { id: 'o', name: 'Haus', kind: 'mfh' as const, address: '', landlordName: null, iban: null, paymentDeadlineDays: null }
  expect(propertyToForm({ ...p, cableBuiltBeforeDec2021: false }).cable).toBe('nach')
  expect(propertyToForm(p).cable).toBe('unbekannt')
})

test('angespannter Wohnungsmarkt (§ 5d CO2KostAufG): ja mit Geltung, nein und unbekannt hin und zurück', () => {
  expect(propertyBody(form({ tightMarket: 'ja', tightMarketFrom: '2025-07-01', tightMarketTo: '2029-12-31' }))).toMatchObject({ tightMarket: true, tightMarketFrom: '2025-07-01', tightMarketTo: '2029-12-31' })
  expect(propertyBody(form({ tightMarket: 'ja' }))).toMatchObject({ tightMarket: true, tightMarketFrom: null, tightMarketTo: null })
  // Die Geltung gehört nur zu „ja“.
  expect(propertyBody(form({ tightMarket: 'nein', tightMarketFrom: '2025-07-01' }))).toMatchObject({ tightMarket: false, tightMarketFrom: null, tightMarketTo: null })
  expect(propertyBody(form({ tightMarket: 'unbekannt' }))).toMatchObject({ tightMarket: null })
  expect(propertyBody(form({ tightMarket: 'ja', tightMarketFrom: '2030-01-01', tightMarketTo: '2029-12-31' }))).toMatchObject({ error: 'Der Beginn der Verordnung liegt nach dem Ende. Bitte prüfen Sie beide Tage.' })
  const p = { id: 'o', name: 'Haus', kind: 'mfh' as const, address: '', landlordName: null, iban: null, paymentDeadlineDays: null, tightMarket: true, tightMarketFrom: null, tightMarketTo: '2029-12-31' }
  expect([propertyToForm(p).tightMarket, propertyToForm(p).tightMarketFrom, propertyToForm(p).tightMarketTo]).toEqual(['ja', '', '2029-12-31'])
  expect(propertyToForm({ ...p, tightMarket: false }).tightMarket).toBe('nein')
  expect(propertyToForm({ ...p, tightMarket: null }).tightMarket).toBe('unbekannt')
})

test('IBAN (#279): eine neue ungültige wird abgelehnt, eine gültige normiert, eine gespeicherte ungültige geht unverändert mit', () => {
  expect(propertyBody(form({ own: true, iban: 'DE00 3704 0044 0532 0130 00' })))
    .toMatchObject({ error: expect.stringMatching(/^Die abweichende IBAN des Objekts ist nicht gültig\. Die Prüfziffer stimmt nicht.* Bitte prüfen Sie die Angabe\.$/) })
  expect(propertyBody(form({ own: true, iban: 'de02120300000000202051' }))).toMatchObject({ iban: 'DE02120300000000202051' })
  // Gespeichert ungültig, unverändert (auch anders geschrieben): kein Fehler, nicht umgeschrieben
  expect(propertyBody(form({ own: true, iban: 'DE00 3333', address: 'Weg 9' }), 'de003333')).toMatchObject({ iban: 'de003333', address: 'Weg 9' })
  // Ohne Haken prüft nichts, denn es gilt die Vorgabe
  expect(propertyBody(form({ own: false, iban: 'DE00' }))).toMatchObject({ iban: null })
  // Beim Öffnen: gültig in Vierergruppen, ungültig, wie sie ist
  const p = { id: 'o', name: 'Haus', kind: 'mfh' as const, address: '', landlordName: null, paymentDeadlineDays: null }
  expect(propertyToForm({ ...p, iban: 'DE89370400440532013000' }).iban).toBe('DE89 3704 0044 0532 0130 00')
  expect(propertyToForm({ ...p, iban: 'de003333' }).iban).toBe('de003333')
})

test('Bundesland: leer heißt unbekannt (null), ein Kürzel geht unverändert hin und zurück', () => {
  expect(propertyBody(form({ state: '' }))).toMatchObject({ state: null })
  expect(propertyBody(form({ state: 'BY' }))).toMatchObject({ state: 'BY' })
  const p = { id: 'o', name: 'Haus', kind: 'mfh' as const, address: '', landlordName: null, iban: null, paymentDeadlineDays: null }
  expect(propertyToForm(p).state).toBe('')
  expect(propertyToForm({ ...p, state: null }).state).toBe('')
  expect(propertyToForm({ ...p, state: 'SN' }).state).toBe('SN')
})

test('Bundesland: die Auswahl hat leer und die 16 Länder, und jeder gespeicherte Wert steht darin', () => {
  expect(STATE_OPTIONS).toHaveLength(17)
  expect(STATE_OPTIONS[0]).toEqual({ value: '', label: 'unbekannt' })
  expect(STATE_UNKNOWN_LABEL).toBe(STATE_OPTIONS[0]?.label)
  expect(STATE_OPTIONS.find((o) => o.value === 'TH')?.label).toBe('Thüringen')
  expect(stateFromSelect('HB')).toBe('HB')
  expect(stateFromSelect('')).toBe('')
  expect(stateFromSelect('XX')).toBe('')
})

test('Bundesland: Feiertage einzelner Gemeinden werden genannt und nicht mitgezählt', () => {
  expect(stateNote('', 2026)).toBeNull()
  expect(stateNote('NW', 2026)).toBeNull()
  expect(stateNote('BY', 2026)).toMatch(/^In Bayern gelten einige Feiertage nur in einzelnen Gemeinden: Augsburger Friedensfest \(nur im Stadtgebiet Augsburg\); Mariä Himmelfahrt .*Mietfuchs zählt sie bei Fristen nicht mit\.$/)
  expect(stateNote('SN', 2026)).toMatch(/Fronleichnam/)
  expect(stateNote('TH', 2026)).toMatch(/Fronleichnam \(nur in Gemeinden, in denen er 1994 gesetzlicher Feiertag war/)
})

// UI-Durchsicht M12 (#341): Eine leere Bezeichnung wurde gespeichert, die Seitenleiste zeigte „Ohne Namen“.
test('die Bezeichnung ist Pflicht und wird ohne Leerzeichen am Rand gespeichert', () => {
  expect(propertyBody(form({ name: '  ' }))).toMatchObject({ field: 'name', short: 'Bezeichnung fehlt' })
  expect(propertyBody(form({ name: ' Haus ' }))).toMatchObject({ name: 'Haus' })
})

// Durchsicht zu #346, Schritt 3: alle Angaben auf einmal, und ein Objekt ohne Namen (frische Installation)
// steht mit Vorbelegung in der Karte, damit das erste Speichern nicht an der Pflicht scheitert.
test('alle Angaben auf einmal; ohne Namen ist „Mein Objekt“ vorbelegt', () => {
  const r = propertyBody(form({ name: '', own: true, paymentDeadlineDays: 'x', iban: 'DE00 3704 0044 0532 0130 00' }))
  expect('problems' in r && r.problems.map((p) => p.field)).toEqual(['name', 'iban', 'paymentDeadlineDays'])
  const leer = { id: 'p', name: '', kind: 'mfh', address: 'Weg 1', landlordName: null, iban: null, paymentDeadlineDays: null } as const
  expect(propertyToForm(leer).name).toBe('Mein Objekt')
  expect(propertyBody(propertyToForm(leer))).toMatchObject({ name: 'Mein Objekt' })
  expect(propertyToForm({ ...leer, name: 'Haus A' }).name).toBe('Haus A')
})
