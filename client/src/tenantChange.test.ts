import { describe, expect, test } from 'vitest'
import { buildTenantChange, defaultStart, EMPTY_NEW_TENANT, endProblem, gapProblem, INTERIM_FEE_HINT, meterProblem, parseMeterValue, successorHeatingNote, tenantChangeProblems, contactForm, type NewTenantForm } from './tenantChange'

const meters = [{ id: 'm1', name: 'KW EG' }, { id: 'm2', name: 'Haupt' }]
const input = (patch: Partial<Parameters<typeof buildTenantChange>[0]> = {}, tenant: Partial<NewTenantForm> = {}) => ({
  tenancy: { start: '2024-01-01' },
  endDate: '2025-06-30',
  meters,
  meterValues: { m1: '123,5', m2: '' },
  vacancy: false,
  newTenant: { ...EMPTY_NEW_TENANT, name: ' Neu ', start: '2025-07-01', persons: '3', baseRent: '800,00', prepayment: '150' },
  ...patch,
  ...(Object.keys(tenant).length ? { newTenant: { ...EMPTY_NEW_TENANT, name: 'Neu', start: '2025-07-01', persons: '3', ...tenant } } : {}),
})

describe('Mieterwechsel (#150)', () => {
  test('der ganze Wechsel wird ein Rumpf für eine einzige Anfrage', () => {
    expect(buildTenantChange(input())).toEqual({
      body: {
        end: '2025-06-30',
        readings: [{ meterId: 'm1', value: 123.5 }],
        newTenancy: {
          tenantName: 'Neu', persons: 3, personHistory: [{ from: '2025-07-01', persons: 3 }], start: '2025-07-01',
          baseRents: [{ from: '2025-07', monthlyCents: 80000 }], prepayments: [{ from: '2025-07', monthlyCents: 15000 }],
          prepaymentOverrides: {},
        },
      },
    })
  })

  test('Leerstand: kein neues Mietverhältnis, und die Angaben zum Nachmieter zählen nicht', () => {
    expect(buildTenantChange(input({ vacancy: true }, { name: '', persons: 'x' }))).toEqual({
      body: { end: '2025-06-30', readings: [{ meterId: 'm1', value: 123.5 }], newTenancy: null },
    })
  })

  test('was der Server ablehnen würde, wird vorher gemeldet', () => {
    expect(buildTenantChange(input({ endDate: '2023-12-31' }))).toHaveProperty('error')
    expect(buildTenantChange(input({ meterValues: { m1: 'viel' } }))).toEqual({ error: 'Zählerstand für „KW EG“ ist keine gültige Zahl.' })
    expect(buildTenantChange(input({}, { start: '2025-06-30' }))).toEqual({ error: 'Der Einzug des neuen Mieters muss nach dem Auszug liegen.' })
    expect(buildTenantChange(input({}, { name: '' }))).toHaveProperty('error')
    expect(buildTenantChange(input({}, { prepayment: 'abc' }))).toEqual({ error: 'Die Vorauszahlung bitte als Betrag angeben, z. B. 150,00.' })
    expect(buildTenantChange(input({}, { baseRent: 'viel' }))).toEqual({ error: 'Die Kaltmiete bitte als Betrag angeben, z. B. 800,00.' })
    for (const persons of ['', 'zwei', '-1', '1,5']) {
      expect(buildTenantChange(input({}, { persons })), persons).toEqual({ error: expect.stringMatching(/Personenzahl/) })
    }
    expect(buildTenantChange(input({ meterValues: { m1: '-3' } }))).toEqual({ error: 'Zählerstand für „KW EG“ ist keine gültige Zahl.' })
  })

  test('leere Beträge heißen keine Staffel', () => {
    const r = buildTenantChange(input({}, { baseRent: '', prepayment: '' }))
    if ('error' in r) throw new Error(r.error)
    expect(r.body.newTenancy?.baseRents).toEqual([])
    expect(r.body.newTenancy?.prepayments).toEqual([])
  })

  test('Zählerstände werden gelesen wie auf der Zähler-Seite (#149)', () => {
    expect(parseMeterValue('')).toBeNull()
    expect(parseMeterValue('1.234')).toBe(1234)
    expect(parseMeterValue('1.234,5')).toBe(1234.5)
    expect(parseMeterValue('-3')).toBeNull()
    expect(meterProblem(meters, { m1: '', m2: '  ' })).toBeNull()
  })

  test('Einzug standardmäßig am Tag nach dem Auszug, auch über den Jahreswechsel', () => {
    expect(defaultStart('2025-12-31')).toBe('2026-01-01')
    expect(endProblem('2025-06-30', { start: '2024-01-01' })).toBeNull()
    expect(endProblem('', { start: '2024-01-01' })).not.toBeNull()
  })
})

describe('Nachmieter unter getrennter Heizkostenabrechnung (Durchsicht von #231, Important 2)', () => {
  test('Die Heizvorauszahlung wird mit abgefragt und als eigene Staffel geschickt', () => {
    const r = buildTenantChange({ ...input({}, { prepayment: '177,00', heatingPrepayment: '123,00' }), askHeating: true })
    if ('error' in r) throw new Error(r.error)
    expect([r.body.newTenancy?.prepayments, r.body.newTenancy?.heatingPrepayments]).toEqual([[{ from: '2025-07', monthlyCents: 17700 }], [{ from: '2025-07', monthlyCents: 12300 }]])
    expect(buildTenantChange({ ...input({}, { prepayment: '177,00', heatingPrepayment: '' }), askHeating: true })).toEqual({ error: 'Bitte die Heizvorauszahlung des neuen Mieters angeben (0,00, wenn er keine zahlt).' })
  })
  test('Ohne getrennte Abrechnung bleibt der Rumpf wie bisher', () => {
    const r = buildTenantChange(input({}, { prepayment: '300,00' }))
    if ('error' in r) throw new Error(r.error)
    expect(Object.hasOwn(r.body.newTenancy ?? {}, 'heatingPrepayments')).toBe(false)
  })
})

describe('Mieterwechsel bei eigener Heizkostenabrechnung (Heizung PR 10)', () => {
  const heat = { heatMeterIds: ['m1'], meterDates: {}, interimGap: null }
  test('Ablesedatum je Zähler geht mit, leer heißt Auszugstag', () => {
    const r = buildTenantChange({ ...input(), ...heat, meterDates: { m1: '2025-07-03' } })
    expect('body' in r && r.body.readings).toEqual([{ meterId: 'm1', value: 123.5, date: '2025-07-03' }])
  })
  test('fehlt ein Stand eines Wärme- oder Warmwasserzählers, braucht es den Grund', () => {
    const ohne = { ...input({ meterValues: { m1: '', m2: '' } }), ...heat }
    expect(buildTenantChange(ohne)).toEqual({ error: expect.stringMatching(/nicht möglich.*nicht durchgeführt/) })
    const mit = buildTenantChange({ ...ohne, interimGap: { status: 'impossible', reason: 'Mieter nicht erreichbar' } })
    expect('body' in mit && mit.body.interimGap).toEqual({ status: 'impossible', reason: 'Mieter nicht erreichbar' })
  })
  test('ohne eigene Heizkostenabrechnung bleibt alles wie bisher', () => {
    const r = buildTenantChange(input({ meterValues: { m1: '', m2: '' } }))
    expect('body' in r && r.body).not.toHaveProperty('interimGap')
  })
  test('der Hinweis zu den Kosten der Zwischenablesung nennt das Urteil', () => {
    expect(INTERIM_FEE_HINT).toMatch(/VIII ZR 19\/07/)
  })
})

describe('Durchsicht von #239, I3', () => {
  test('„nicht möglich“ nur mit Grund, geprüft vor „Weiter“', () => {
    expect(gapProblem(['w'], {}, { status: 'impossible', reason: ' ' })).toBe('Bitte nennen Sie den Grund für die Teilung nach § 9b Abs. 3 HeizkostenV, also warum die Zwischenablesung nicht möglich war; er steht in der Abrechnung.')
    expect(gapProblem(['w'], {}, { status: 'impossible', reason: 'nicht zugänglich' })).toBeNull()
    expect(gapProblem(['w'], { w: '12' }, null)).toBeNull()
    expect(gapProblem(['w'], {}, { status: '', reason: '' })).toMatch(/fehlt ein Zählerstand/)
  })
})

// Heizung PR 19 (Durchsicht S-3): „Mieter heizt selbst“ ist meist eine Eigenschaft der Wohnung; der Nachmieter übernimmt
// es samt der Art, sonst bekäme er wieder den Hinweis auf eine CO₂-Kürzung, die ihm nicht zusteht.
test('Mieterwechsel: der Nachmieter heizt ebenfalls selbst, mit derselben Art; sonst bleibt es bei der Abrechnung', () => {
  const selbst = buildTenantChange(input({ tenancy: { start: '2024-01-01', heatingModel: 'selfSupply', selfSupplyKind: 'central' } }))
  if (!('body' in selbst)) throw new Error(JSON.stringify(selbst))
  expect(selbst.body.newTenancy).toMatchObject({ heatingModel: 'selfSupply', selfSupplyKind: 'central' })
  const ohneArt = buildTenantChange(input({ tenancy: { start: '2024-01-01', heatingModel: 'selfSupply' } }))
  if (!('body' in ohneArt)) throw new Error(JSON.stringify(ohneArt))
  expect(ohneArt.body.newTenancy).toMatchObject({ heatingModel: 'selfSupply' })
  expect(ohneArt.body.newTenancy).not.toHaveProperty('selfSupplyKind')
  const normal = buildTenantChange(input({ tenancy: { start: '2024-01-01', heatingModel: 'flatRate' } }))
  if (!('body' in normal)) throw new Error(JSON.stringify(normal))
  expect(normal.body.newTenancy).not.toHaveProperty('heatingModel')
})

// Nachprüfung N-3 zu PR 19: Die Wechselmaske sagt, dass der Nachmieter „Mieter heizt selbst“ übernimmt, statt es still
// zu tun (buildTenantChange gibt es mit, Durchsicht S-3).
describe('Nachmieter heizt ebenfalls selbst', () => {
  test('nennt die Übernahme samt Art; ohne selfSupply nichts', () => {
    expect(successorHeatingNote({ heatingModel: 'selfSupply', selfSupplyKind: 'central' })).toBe('Der neue Mieter heizt ebenfalls selbst („Mieter heizt selbst“: Eine zentrale Heizung im Haus, deren Brennstoff der Mieter bezieht). Ändern lässt sich das danach in den Stammdaten.')
    expect(successorHeatingNote({ heatingModel: 'selfSupply' })).toBe('Der neue Mieter heizt ebenfalls selbst („Mieter heizt selbst“). Ändern lässt sich das danach in den Stammdaten.')
    expect(successorHeatingNote({ heatingModel: 'settlement' })).toBeNull()
    expect(successorHeatingNote({})).toBeNull()
  })
})

// #346 Schritt 7: Der Mieterwechsel steht im Seitenfenster; alles, was fehlt oder nicht passt, steht auf einmal am Feld
// und in der Sammelmeldung. Was durchgeht, ergibt mit buildTenantChange denselben Rumpf wie vorher.
describe('Mieterwechsel im Seitenfenster: Angaben je Feld', () => {
  const tenancy = { start: '2020-01-01' }
  const meters = [{ id: 'm1', name: 'Wasser EG' }, { id: 'w1', name: 'Wärme EG' }]
  const base = { tenancy, endDate: '2025-06-30', meters, meterValues: {}, vacancy: false, newTenant: { ...EMPTY_NEW_TENANT, name: 'Schmidt', start: '2025-07-01' } }
  const fields = (input: Parameters<typeof tenantChangeProblems>[0]) => tenantChangeProblems(input).map((p) => [p.field, p.short])

  test('vollständig: keine Angabe, und buildTenantChange baut den Rumpf', () => {
    expect(tenantChangeProblems(base)).toEqual([])
    expect('body' in buildTenantChange(base)).toBe(true)
  })
  test('alles fehlt: Auszug, Name, Einzug und Personen, je mit „… fehlt“', () => {
    expect(fields({ ...base, endDate: '', newTenant: { ...EMPTY_NEW_TENANT, persons: '' } })).toEqual([
      ['end', 'Auszugsdatum fehlt'], ['name', 'Name fehlt'], ['start', 'Einzug fehlt'], ['persons', 'Personenzahl fehlt'],
    ])
  })
  test('Leerstand: ohne neuen Mieter nur der Auszug', () => {
    expect(fields({ ...base, endDate: '', vacancy: true, newTenant: EMPTY_NEW_TENANT })).toEqual([['end', 'Auszugsdatum fehlt']])
  })
  test('Unlesbares steht an seinem Feld: Zählerstand, Ablesedatum, Beträge, Einzug vor dem Auszug', () => {
    expect(fields({
      ...base, endDate: '2019-12-31', meterValues: { m1: 'viel' }, meterDates: { w1: '30.6.' },
      newTenant: { ...base.newTenant, start: '2019-12-31', baseRent: 'acht', prepayment: 'x' },
    })).toEqual([
      ['end', 'Vor dem Einzug'], ['meter:m1', 'Keine Zahl'], ['meterDate:w1', 'Kein Datum'], ['baseRent', 'Kein Betrag'], ['prepayment', 'Kein Betrag'],
    ])
    expect(fields({ ...base, newTenant: { ...base.newTenant, start: '2025-06-30' } })).toEqual([['start', 'Nicht nach dem Auszug']])
  })
  test('getrennte Heizkostenabrechnung: die Heizvorauszahlung ist Pflicht', () => {
    expect(fields({ ...base, askHeating: true })).toEqual([['heatingPrepayment', 'Heizvorauszahlung fehlt']])
    expect(fields({ ...base, askHeating: true, newTenant: { ...base.newTenant, heatingPrepayment: '0' } })).toEqual([])
  })
  test('eigene Heizkostenabrechnung: ohne Stand die Antwort, bei „nicht möglich“ der Grund', () => {
    const heat = { ...base, heatMeterIds: ['w1'] }
    expect(fields({ ...heat, interimGap: { status: '', reason: '' } })).toEqual([['gapStatus', 'Antwort fehlt']])
    expect(fields({ ...heat, interimGap: { status: 'impossible', reason: ' ' } })).toEqual([['gapReason', 'Grund fehlt']])
    expect(fields({ ...heat, interimGap: { status: 'missed', reason: '' } })).toEqual([])
    expect(fields({ ...heat, meterValues: { w1: '12' } })).toEqual([])
  })
})

// #229: neue Anschrift, E-Mail und Telefon des ausziehenden Mieters, alles freiwillig. Gesendet wird nur, was sich
// gegenüber dem Mietverhältnis geändert hat; ein geleertes Feld entfernt die Angabe.
describe('Mieterwechsel: Erreichbarkeit des bisherigen Mieters (#229)', () => {
  const tenancy = { start: '2024-01-01', email: 'alt@example.org', phone: '0301234' }
  test('vorbelegt mit dem Mietverhältnis; unverändert kommt nichts in den Rumpf', () => {
    expect(contactForm(tenancy)).toEqual({ correspondenceAddress: '', email: 'alt@example.org', phone: '0301234' })
    const r = buildTenantChange(input({ tenancy, vacancy: true, contact: contactForm(tenancy) }))
    expect(r).toEqual({ body: { end: '2025-06-30', readings: [{ meterId: 'm1', value: 123.5 }], newTenancy: null } })
  })
  test('nur die geänderten Felder, getrimmt; leer heißt entfernen', () => {
    const contact = { correspondenceAddress: ' Birkenweg 3, 54321 Anderswo ', email: 'alt@example.org', phone: '' }
    expect(buildTenantChange(input({ tenancy, vacancy: true, contact }))).toEqual({
      body: { end: '2025-06-30', readings: [{ meterId: 'm1', value: 123.5 }], newTenancy: null, contact: { correspondenceAddress: 'Birkenweg 3, 54321 Anderswo', phone: null } },
    })
    const withSuccessor = buildTenantChange(input({ tenancy, contact }))
    if (!('body' in withSuccessor)) throw new Error(withSuccessor.error)
    expect(withSuccessor.body.contact).toEqual({ correspondenceAddress: 'Birkenweg 3, 54321 Anderswo', phone: null })
  })
  test('eine E-Mail ohne @ und eine zu lange Anschrift sind Meldungen am Feld', () => {
    const contact = { correspondenceAddress: 'x'.repeat(201), email: 'alt-at-example.org', phone: '' }
    expect(tenantChangeProblems(input({ tenancy, contact })).map((p) => [p.field, p.short])).toEqual([
      ['correspondenceAddress', 'Höchstens 200 Zeichen'], ['email', 'Keine E-Mail-Adresse'],
    ])
    expect(buildTenantChange(input({ tenancy, contact }))).toEqual({ error: expect.stringMatching(/Anschrift/) })
  })
  // Durchsicht M1: Geprüft wird nur, was geändert ist (wie bei der IBAN). Eine gespeicherte Angabe, die die Prüfung
  // nicht besteht, sperrt den Wechsel nicht, und sie kommt nicht in den Rumpf.
  test('eine gespeicherte, unveränderte Angabe sperrt den Wechsel nicht', () => {
    const stored = { start: '2024-01-01', email: 'mieter@intranet', correspondenceAddress: 'y'.repeat(201) }
    const contact = contactForm(stored)
    expect(tenantChangeProblems(input({ tenancy: stored, contact }))).toEqual([])
    const r = buildTenantChange(input({ tenancy: stored, vacancy: true, contact }))
    expect(r).toEqual({ body: { end: '2025-06-30', readings: [{ meterId: 'm1', value: 123.5 }], newTenancy: null } })
    // Geändert wird wieder geprüft.
    expect(tenantChangeProblems(input({ tenancy: stored, contact: { ...contact, email: 'neu@intranet' } })).map((p) => p.field)).toEqual(['email'])
  })
  // Durchsicht S2: E-Mail und Telefon haben dieselbe Grenze wie beim Server.
  test('E-Mail und Telefon über 200 Zeichen sind Meldungen am Feld', () => {
    const contact = { correspondenceAddress: '', email: `${'a'.repeat(195)}@example.org`, phone: '1'.repeat(201) }
    expect(tenantChangeProblems(input({ tenancy, contact })).map((p) => [p.field, p.short])).toEqual([
      ['email', 'Höchstens 200 Zeichen'], ['phone', 'Höchstens 200 Zeichen'],
    ])
  })
})
