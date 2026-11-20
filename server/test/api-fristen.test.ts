// „Demnächst fällig“ über die Route (#190): GET /api/upcoming je Objekt, mit dem Tag des Servers (NKA_TEST_TODAY).
// Die Regeln im Einzelnen prüft fristen-cockpit.test.ts an der reinen Funktion.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DepositEntry, Meter, Property, Tenancy, Unit, UpcomingDeadlines } from '../../shared/types.ts'
import { withEnv, type Server } from '../testing/api.ts'

const post = <T>(s: Server, url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })
const send = (s: Server, method: string, url: string, body?: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

test('Demnächst fällig: Abrechnungsfrist, nach dem Versand die Einwendungsfrist, Eichfrist und Kaution je Objekt', async () => {
  await withEnv({ NKA_TEST_TODAY: '2026-11-20' }, async (s) => {
    const unit = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 80, participates: true })
    const tenancy = await post<Tenancy>(s, '/api/tenancies', {
      unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
    })
    await post(s, '/api/costItems', { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer 2025', amountCents: 60000, key: 'area' })
    const meter = await post<Meter>(s, '/api/meters', { name: 'Kaltwasser EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³', calibratedUntil: 2026 })

    const first = await s.api<UpcomingDeadlines>('/api/upcoming')
    assert.equal(first.today, '2026-11-20')
    assert.equal(first.until, '2027-02-18')
    assert.deepEqual(first.items, [
      { kind: 'calibration', id: `calibration:${meter.id}`, date: '2026-12-31', meterId: meter.id, meterName: 'Kaltwasser EG' },
      { kind: 'settlement', id: 'settlement:2025-01', date: '2026-12-31', period: '2025-01', label: '2025', closed: false },
    ])

    // Abgeschlossen ohne Versanddatum: die Abrechnungsfrist bleibt, als abgeschlossen gekennzeichnet.
    assert.equal((await send(s, 'POST', '/api/settlement/2025-01/close', {})).status, 201)
    const closed = await s.api<UpcomingDeadlines>('/api/upcoming')
    assert.deepEqual(closed.items.filter((i) => i.kind === 'settlement').map((i) => i.kind === 'settlement' && i.closed), [true])

    // Versendet: statt der Abrechnungsfrist die Einwendungsfrist, gerechnet ab dem Versanddatum.
    assert.equal((await send(s, 'PUT', '/api/settlement/2025-01/close', { sentAt: '2026-01-20' })).status, 200)
    const sent = await s.api<UpcomingDeadlines>('/api/upcoming')
    assert.deepEqual(sent.items.map((i) => i.id), [`calibration:${meter.id}`, 'objection:2025-01'])
    assert.deepEqual(sent.items[1], { kind: 'objection', id: 'objection:2025-01', date: '2027-01-31', period: '2025-01', label: '2025', sentAt: '2026-01-20' })

    // Ausgezogen, Kaution liegt noch beim Vermieter.
    await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ end: '2026-08-31' }) })
    await post<DepositEntry>(s, '/api/deposit-entries', { tenancyId: tenancy.id, date: '2025-01-05', kind: 'received', amountCents: 160000 })
    const moved = await s.api<UpcomingDeadlines>('/api/upcoming')
    assert.deepEqual(moved.items[0], { kind: 'deposit', id: `deposit:${tenancy.id}`, date: '2026-08-31', tenancyId: tenancy.id, tenantName: 'Erika Mustermann', balanceCents: 160000 })

    // Ein zweites Objekt: ohne Angabe 400, mit Angabe nur seine Liste.
    const [own] = await s.api<Property[]>('/api/properties')
    const other = await post<Property>(s, '/api/properties', { name: 'Gartenweg 3' })
    assert.equal((await send(s, 'GET', '/api/upcoming')).status, 400)
    assert.deepEqual((await s.api<UpcomingDeadlines>(`/api/upcoming?property=${other.id}`)).items, [])
    assert.equal((await s.api<UpcomingDeadlines>(`/api/upcoming?property=${own?.id ?? assert.fail('Objekt fehlt')}`)).items.length, 3)
  })
})

// Mieterhöhung (#191, PR 4): Staffelstufe, frühester Zugang und Zustimmungsfrist über die Route, mit den Verlangen aus
// rent_increases und dem Land des Objekts für die Feiertage.
test('Demnächst fällig: Staffelstufe, Mieterhöhung möglich, nach dem Versand die Zustimmungsfrist', async () => {
  await withEnv({ NKA_TEST_TODAY: '2026-11-20' }, async (s) => {
    const [own] = await s.api<Property[]>('/api/properties')
    const property = own ?? assert.fail('Objekt fehlt')
    await s.api(`/api/properties/${property.id}`, { method: 'PUT', body: JSON.stringify({ state: 'BY', rentCapReduced: false }) })
    const eg = await post<Unit>(s, '/api/units', { name: 'EG', areaM2: 60, participates: true })
    const og = await post<Unit>(s, '/api/units', { name: 'OG', areaM2: 70, participates: true })
    const base = { persons: 1, end: null, prepayments: [], prepaymentOverrides: {}, costModel: 'flatRate', heatingModel: 'flatRate', rentIncreaseExcluded: false }
    const free = await post<Tenancy>(s, '/api/tenancies', { ...base, unitId: eg.id, tenantName: 'Erika Mustermann', start: '2020-01-01', rentKind: 'free', baseRents: [{ from: '2020-01', monthlyCents: 50000 }] })
    const staggered = await post<Tenancy>(s, '/api/tenancies', {
      ...base, unitId: og.id, tenantName: 'Max Muster', start: '2024-01-01', rentKind: 'staggered',
      baseRents: [{ from: '2024-01', monthlyCents: 50000, reason: 'agreement' }, { from: '2025-01', monthlyCents: 52000, reason: 'staggered' }, { from: '2027-01', monthlyCents: 54000, reason: 'staggered' }],
    })
    const rentOnly = async () => (await s.api<UpcomingDeadlines>('/api/upcoming')).items.filter((i) => i.kind.startsWith('rent'))
    assert.deepEqual(await rentOnly(), [
      { kind: 'rentIncrease', id: `rentIncrease:${free.id}`, date: '2021-01-02', tenancyId: free.id, unitName: 'EG', tenantName: 'Erika Mustermann', increaseKind: 'comparison', effectiveFrom: '2027-02', exclusionOpen: false, staggered: false },
      { kind: 'rentStep', id: `rentStep:${staggered.id}:2027-01`, date: '2027-01-01', tenancyId: staggered.id, unitName: 'OG', tenantName: 'Max Muster', fromCents: 52000, cents: 54000, last: true, comparisonFrom: '2028-01-02' },
    ])

    // Ein Entwurf unterdrückt „möglich“; versandt steht die Zustimmungsfrist da (31.01.2027, Klage bis 30.04.2027).
    const request = { kind: 'comparison', allStepsEntered: true, residential: true, noThirdPartyFunds: true, comparisonCentsPerM2: 1000 }
    // Ohne Namen des Vermieters legt der Server kein Schreiben an (§ 126b BGB).
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Max Vermieter' }) })
    const plan = await post<{ token: string }>(s, `/api/tenancies/${free.id}/rent-increase/plan`, request)
    const letter = {
      justification: 'comparables', survey: null, expert: null, database: null,
      comparables: [
        { address: 'Ahornweg 3, 12345 Musterstadt', location: '1. OG links', areaM2: 58, centsPerM2: 1020 },
        { address: 'Ahornweg 5, 12345 Musterstadt', location: 'EG rechts', areaM2: 62, centsPerM2: 1010 },
        { address: 'Birkenstraße 8, 12345 Musterstadt', location: '2. OG Mitte', areaM2: 60, centsPerM2: 1050 },
      ],
      qualifiedSurvey: 'no', qualified: null, recipientName: 'Erika Mustermann', allLandlordsNamed: true, allTenantsNamed: true, extraParagraph: '',
    }
    const created = await send(s, 'POST', `/api/tenancies/${free.id}/rent-increases`, { request, letter, token: plan.token })
    assert.equal(created.status, 201, await created.clone().text())
    const draft = (await created.json()) as { id: string; token: string }
    assert.deepEqual((await rentOnly()).map((i) => i.kind), ['rentStep'])
    const sent = await send(s, 'POST', `/api/rent-increases/${draft.id}/send`, { receivedOn: '2026-11-20', token: draft.token })
    assert.equal(sent.status, 200, await sent.clone().text())
    assert.deepEqual((await rentOnly()).find((i) => i.kind === 'rentConsent'), {
      kind: 'rentConsent', id: `rentConsent:${draft.id}`, date: '2027-02-01', tenancyId: free.id, unitName: 'EG', tenantName: 'Erika Mustermann',
      increaseId: draft.id, stage: 'running', receivedOn: '2026-11-20', consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitEnd: '2027-04-30',
    })

    // Ein anderes Objekt sieht nichts davon.
    const other = await post<Property>(s, '/api/properties', { name: 'Gartenweg 3' })
    assert.deepEqual((await s.api<UpcomingDeadlines>(`/api/upcoming?property=${other.id}`)).items, [])
  })
})
