// Integrationstests: Schreiben und Übernahme einer Mieterhöhung (#191, PR 3). Entwurf anlegen (Marke, ein offenes Verlangen,
// Eingaben des Schreibens), als versendet speichern (neu gerechnet, gesperrt, wenn zu früh), Antwort des Mieters mit Stufe
// in der Kaltmiete-Staffel, Rücknahme nur bei unveränderter Stufe, Löschen eines Entwurfs, Verlauf mit Rücksprung,
// Backup. Jeder Test startet den Server mit NKA_DATA_DIR auf einem Wegwerf-Ordner (startServerIn setzt auch CI,
// NKA_UPDATE_URL und NKA_HOST) und einem festen Tag.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Property, RentEntry, RentIncreaseLetterInput, RentIncreasePlanView, RentIncreaseRequest, RentIncreaseView, Tenancy, Unit } from '../../shared/types.ts'
import { errorFrom, jsonOf, restore, startServerIn, type Server } from '../testing/api.ts'
import { journalOf, revert } from '../testing/revert.ts'

const TODAY = '2026-11-20'
const send = (s: Server, method: string, url: string, body: unknown) =>
  fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const post = <T>(s: Server, url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })
const BASE = { personHistory: [], end: null, prepayments: [{ from: '2020-01', monthlyCents: 15000 }], prepaymentOverrides: {} }

const COMPARISON: RentIncreaseRequest = { kind: 'comparison', allStepsEntered: true, residential: true, noThirdPartyFunds: true, comparisonCentsPerM2: 1000 }
const LETTER: RentIncreaseLetterInput = {
  justification: 'comparables',
  survey: null, expert: null, database: null,
  comparables: [
    { address: 'Ahornweg 3, 12345 Musterstadt', location: '1. OG links', areaM2: 58, centsPerM2: 1020 },
    { address: 'Ahornweg 5, 12345 Musterstadt', location: 'EG rechts', areaM2: 62, centsPerM2: 1010 },
    { address: 'Birkenstraße 8, 12345 Musterstadt', location: '2. OG Mitte', areaM2: 60, centsPerM2: 1050 },
  ],
  qualifiedSurvey: 'yes',
  qualified: { name: 'Qualifizierter Mietspiegel Musterstadt 2025', asOf: '2025-04', field: 'Baujahr 1950 bis 1964, mittlere Lage', rangeLowCentsPerM2: 850, rangeHighCentsPerM2: 1100, availableAt: 'www.musterstadt.de/mietspiegel' },
  recipientName: 'Anna und Ben Becker',
  allLandlordsNamed: true,
  allTenantsNamed: true,
  extraParagraph: 'Für Rückfragen bin ich gern erreichbar.',
}
const INDEX_LETTER: RentIncreaseLetterInput = { ...LETTER, justification: null, comparables: [], qualifiedSurvey: null, qualified: null }

async function setup(baseRents: RentEntry[] = [{ from: '2020-01', monthlyCents: 50000 }], more: Partial<Tenancy> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const s = await startServerIn(dataDir, { NKA_TEST_TODAY: TODAY })
  const p = await post<Property>(s, '/api/properties', { name: 'Haus', kind: 'mfh', address: 'Lindenweg 12, 12345 Musterstadt', rentCapReduced: false, state: 'BY' })
  const u = await post<Unit>(s, `/api/units?property=${p.id}`, { name: 'EG', areaM2: 60, participates: true })
  const t = await post<Tenancy>(s, `/api/tenancies?property=${p.id}`, { ...BASE, unitId: u.id, tenantName: 'Becker', persons: 2, start: '2020-01-01', rentKind: 'free', rentIncreaseExcluded: false, baseRents, ...more })
  const plan = (request: RentIncreaseRequest = COMPARISON) => post<RentIncreasePlanView>(s, `/api/tenancies/${t.id}/rent-increase/plan`, request)
  const create = async (request: RentIncreaseRequest = COMPARISON, letter: RentIncreaseLetterInput = LETTER) =>
    send(s, 'POST', `/api/tenancies/${t.id}/rent-increases`, { request, letter, token: (await plan(request)).token })
  const list = () => s.api<RentIncreaseView[]>(`/api/tenancies/${t.id}/rent-increases`)
  const rents = async () => (await s.api<Tenancy[]>(`/api/tenancies?property=${p.id}`)).find((x) => x.id === t.id)?.baseRents ?? assert.fail('Mietverhältnis fehlt')
  const status = (x: RentIncreaseView, body: Record<string, unknown>) => send(s, 'POST', `/api/rent-increases/${x.id}/status`, { decidedOn: TODAY, token: x.token, ...body })
  const sent = (x: RentIncreaseView, receivedOn = TODAY) => send(s, 'POST', `/api/rent-increases/${x.id}/send`, { receivedOn, token: x.token })
  const one = async (): Promise<RentIncreaseView> => (await list()).at(-1) ?? assert.fail('kein Verlangen')
  return { s, dataDir, p, u, t, plan, create, list, rents, status, sent, one }
}

test('Mieterhöhung, Schreiben: Entwurf anlegen mit Marke, eingefrorener Grundlage und höchstens einem offenen Verlangen', async () => {
  const c = await setup()
  try {
    const plan = await c.plan()
    assert.equal(plan.state, 'possible', plan.reasons.join(' '))
    assert.match(plan.token, /^[0-9a-f]{32}$/)
    const res = await c.create()
    assert.equal(res.status, 201, await res.clone().text())
    const draft = await jsonOf<RentIncreaseView>(res)
    assert.equal(draft.status, 'draft')
    assert.equal(draft.kind, 'comparison')
    assert.equal(draft.createdOn, TODAY)
    assert.equal(draft.receivedOn, null)
    assert.equal(draft.effectiveFrom, '2027-02')
    assert.equal(draft.fromCents, 50000)
    assert.equal(draft.toCents, 60000)
    const b = draft.basis
    assert.deepEqual(b.letter, LETTER)
    assert.equal(b.plan.newCents, 60000)
    assert.ok(b.plan.legalValues.length > 0, 'Registerstand eingefroren')
    assert.deepEqual(b.rentCap, { answer: 'no', answeredOn: TODAY }, 'Angabe zur Kappungsgrenze mit Datum (S2)')
    assert.deepEqual(b.recipient, ['Anna und Ben Becker', 'Lindenweg 12', '12345 Musterstadt'])
    assert.equal(b.salutation, 'Guten Tag Anna und Ben Becker,')
    assert.deepEqual(b.prepayments, { operatingCents: 15000, heatingCents: 0, flatRateCents: 0 })
    assert.equal(b.premises.areaM2, 60)
    const [top] = await journalOf(c.s, '?limit=1')
    assert.equal(top?.title.startsWith('Mieterhöhung als Entwurf angelegt'), true, top?.title)
    // Derselbe Klick noch einmal: Die Marke gilt nicht mehr (Doppelklick), 409 mit neuem Plan.
    const again = await send(c.s, 'POST', `/api/tenancies/${c.t.id}/rent-increases`, { request: COMPARISON, letter: LETTER, token: plan.token })
    assert.equal(again.status, 409)
    const body = await jsonOf<{ error: string; plan?: RentIncreasePlanView }>(again)
    assert.ok(body.plan?.token && body.plan.token !== plan.token)
    // Mit frischer Marke: schon ein offenes Verlangen.
    const second = await c.create()
    assert.equal(second.status, 409)
    assert.match(await errorFrom(second), /schon ein offenes Verlangen/)
    assert.equal((await c.list()).length, 1)
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung, Schreiben: Eingaben des Schreibens werden geprüft, 400 mit ganzem Satz', async () => {
  const c = await setup()
  try {
    const cases: [Partial<RentIncreaseLetterInput>, RegExp][] = [
      [{ qualifiedSurvey: 'unknown' }, /qualifizierten Mietspiegel/],
      [{ qualifiedSurvey: 'yes', qualified: null }, /Mietspiegel/],
      [{ comparables: LETTER.comparables.slice(0, 2) }, /genau 3 Vergleichswohnungen/],
      [{ comparables: [{ ...LETTER.comparables[0], location: '' }, ...LETTER.comparables.slice(1)] as RentIncreaseLetterInput['comparables'] }, /Geschoss und Lage/],
      [{ allTenantsNamed: false }, /alle Mieter/],
      [{ allLandlordsNamed: false }, /alle Vermieter/],
      [{ justification: 'survey', survey: null }, /Namen/],
    ]
    for (const [change, pattern] of cases) {
      const res = await c.create(COMPARISON, { ...LETTER, ...change })
      assert.equal(res.status, 400, JSON.stringify(change))
      const text = await errorFrom(res)
      assert.match(text, pattern)
      assert.match(text, /\.$/)
    }
    // Die Miete am Stichtag nur mit ihrem Tag (eingefroren wird beides).
    const noDay = await c.create({ ...COMPARISON, rentAtCapDateCents: 48000 })
    assert.equal(noDay.status, 400)
    assert.match(await errorFrom(noDay), /Tag, zu dem sie gehört/)
    // Gesperrte Rechnung: kein Schreiben.
    const blocked = await c.create({ ...COMPARISON, residential: false })
    assert.equal(blocked.status, 400)
    assert.match(await errorFrom(blocked), /kein Schreiben/)
    assert.equal((await c.list()).length, 0)
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung, Versand: neu gerechnet und eingefroren; zu früh gesperrt; Zukunft abgelehnt', async () => {
  const c = await setup()
  try {
    const draft = await jsonOf<RentIncreaseView>(await c.create())
    const future = await c.sent(draft, '2026-11-21')
    assert.equal(future.status, 400)
    assert.match(await errorFrom(future), /in der Zukunft/)
    const res = await c.sent(draft)
    assert.equal(res.status, 200, await res.clone().text())
    const sent = await jsonOf<RentIncreaseView>(res)
    assert.equal(sent.status, 'sent')
    assert.equal(sent.receivedOn, TODAY)
    assert.equal(sent.basis.request.receivedOn, TODAY)
    assert.equal(sent.basis.plan.receivedOn, TODAY)
    assert.equal(sent.basis.plan.consent?.consentEnd, '2027-01-31')
    assert.deepEqual(await c.rents(), [{ from: '2020-01', monthlyCents: 50000 }], 'Vergleichsmiete: erst die Zustimmung schreibt')
    const [top] = await journalOf(c.s, '?limit=1')
    assert.equal(top?.title.startsWith('Mieterhöhung als versendet gespeichert'), true, top?.title)
    // Schweigen ist keine Zustimmung: Es bleibt versandt.
    assert.equal((await c.one()).status, 'sent')
    // Ein zweites Mal: nicht mehr Entwurf.
    const twice = await c.sent(sent)
    assert.equal(twice.status, 400)
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung, Versand: vor dem frühesten Zugang gesperrt, mit dem Satz der Rechnung', async () => {
  // Letzte Erhöhung ab 12.2025: Zugang frühestens am 02.12.2026, heute ist der 20.11.2026.
  const c = await setup([{ from: '2020-01', monthlyCents: 45000 }, { from: '2025-12', monthlyCents: 50000, reason: 'agreement' }])
  try {
    const plan = await c.plan({ ...COMPARISON, receivedOn: '2026-12-02' })
    assert.equal(plan.state, 'possible', plan.reasons.join(' '))
    const res = await c.create({ ...COMPARISON, receivedOn: '2026-12-02' })
    assert.equal(res.status, 201, await res.clone().text())
    const draft = await jsonOf<RentIncreaseView>(res)
    const early = await c.sent(draft, TODAY)
    assert.equal(early.status, 400)
    assert.match(await errorFrom(early), /nicht möglich.*frühestens am 02\.12\.2026/)
    assert.equal((await c.one()).status, 'draft')
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung, Antwort: teilweise Zustimmung schreibt die Stufe, Rücknahme nimmt sie heraus, Grenzen mit Satz', async () => {
  const c = await setup()
  try {
    await c.sent(await jsonOf<RentIncreaseView>(await c.create()))
    let x = await c.one()
    for (const [body, pattern] of [
      [{ status: 'partial', agreedCents: 50000 }, /über der bisherigen/],
      [{ status: 'partial', agreedCents: 60001 }, /höchstens der verlangten/],
      [{ status: 'partial' }, /Miete an/],
      [{ status: 'zugestimmt' }, /unbekannt/],
      [{ status: 'agreed', decidedOn: '2026-11-19' }, /vor dem Zugang/],
    ] as const) {
      const res = await c.status(x, body)
      assert.equal(res.status, 400, JSON.stringify(body))
      assert.match(await errorFrom(res), pattern)
    }
    const partial = await c.status(x, { status: 'partial', agreedCents: 55000 })
    assert.equal(partial.status, 200, await partial.clone().text())
    x = await jsonOf<RentIncreaseView>(partial)
    assert.equal(x.status, 'partial')
    assert.equal(x.agreedCents, 55000)
    assert.equal(x.decidedOn, TODAY)
    assert.deepEqual(await c.rents(), [{ from: '2020-01', monthlyCents: 50000 }, { from: '2027-02', monthlyCents: 55000, reason: 'comparison' }])
    const [top] = await journalOf(c.s, '?limit=1')
    assert.equal(top?.title.startsWith('Teilweise Zustimmung zur Mieterhöhung eingetragen'), true, top?.title)
    // Veraltete Marke: 409 mit dem neuen Stand.
    const stale = await c.status({ ...x, token: 'alt' }, { status: 'withdrawn' })
    assert.equal(stale.status, 409)
    assert.equal((await jsonOf<{ increase?: RentIncreaseView }>(stale)).increase?.status, 'partial')
    const back = await c.status(x, { status: 'withdrawn' })
    assert.equal(back.status, 200, await back.clone().text())
    assert.deepEqual(await c.rents(), [{ from: '2020-01', monthlyCents: 50000 }])
    assert.equal((await c.one()).status, 'withdrawn')
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung, Antwort: Zustimmung, geänderte Stufe sperrt die Rücknahme; Ablehnung schreibt nichts', async () => {
  const c = await setup()
  try {
    await c.sent(await jsonOf<RentIncreaseView>(await c.create()))
    const refused = await c.status(await c.one(), { status: 'refused' })
    assert.equal(refused.status, 200)
    assert.deepEqual(await c.rents(), [{ from: '2020-01', monthlyCents: 50000 }])
    // Nach einer Ablehnung kann der Mieter noch zustimmen (etwa im Rechtsstreit).
    const agreed = await c.status(await c.one(), { status: 'agreed' })
    assert.equal(agreed.status, 200, await agreed.clone().text())
    assert.deepEqual(await c.rents(), [{ from: '2020-01', monthlyCents: 50000 }, { from: '2027-02', monthlyCents: 60000, reason: 'comparison' }])
    const changed = await send(c.s, 'PUT', `/api/tenancies/${c.t.id}?property=${c.p.id}`, { baseRents: [{ from: '2020-01', monthlyCents: 50000 }, { from: '2027-02', monthlyCents: 59000, reason: 'comparison' }] })
    assert.equal(changed.status, 200)
    const refusedWithdraw = await c.status(await c.one(), { status: 'withdrawn' })
    assert.equal(refusedWithdraw.status, 409)
    assert.match(await errorFrom(refusedWithdraw), /Die Stufe ab Februar 2027 wurde nach der Übernahme geändert \(590,00 € statt 600,00 €\)/)
    assert.equal((await c.one()).status, 'agreed')
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung, Indexmiete: der Versand schreibt die Stufe mit Art und Indexwert, keine Zustimmung, Rücknahme', async () => {
  const INDEXED: RentEntry[] = [
    { from: '2024-01', monthlyCents: 68500, reason: 'agreement', index: { month: '2023-10', value: 94.2, base: 2020 } },
    { from: '2025-03', monthlyCents: 77153, reason: 'index', index: { month: '2024-12', value: 106.1, base: 2020 } },
  ]
  const c = await setup(INDEXED, { rentKind: 'index', start: '2024-01-01' })
  try {
    const request: RentIncreaseRequest = { kind: 'index', allStepsEntered: true, residential: true, toIndex: { month: '2026-10', value: 110, base: 2020 } }
    const res = await c.create(request, INDEX_LETTER)
    assert.equal(res.status, 201, await res.clone().text())
    const draft = await jsonOf<RentIncreaseView>(res)
    assert.equal(draft.effectiveFrom, '2027-01')
    assert.equal(draft.toCents, 79988, '77.153 € × 110,0 / 106,1, abgerundet (79.988,97)')
    assert.deepEqual(draft.basis.letter, INDEX_LETTER)
    assert.equal(draft.basis.rentCap, null)
    const sent = await c.sent(draft)
    assert.equal(sent.status, 200, await sent.clone().text())
    assert.deepEqual((await c.rents()).at(-1), { from: '2027-01', monthlyCents: 79988, reason: 'index', index: { month: '2026-10', value: 110, base: 2020 } })
    const agreed = await c.status(await c.one(), { status: 'agreed' })
    assert.equal(agreed.status, 400)
    assert.match(await errorFrom(agreed), /braucht keine Zustimmung/)
    // Nach dem Versand ist die Erklärung nicht mehr offen: ein neuer Entwurf ginge (hier zu früh, aber nicht wegen „offen“).
    const back = await c.status(await c.one(), { status: 'withdrawn' })
    assert.equal(back.status, 200, await back.clone().text())
    assert.deepEqual(await c.rents(), INDEXED)
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung, Entwurf löschen: nur ein Entwurf, nur mit gültiger Marke', async () => {
  const c = await setup()
  try {
    const draft = await jsonOf<RentIncreaseView>(await c.create())
    const stale = await send(c.s, 'DELETE', `/api/rent-increases/${draft.id}`, { token: 'alt' })
    assert.equal(stale.status, 409)
    const del = await send(c.s, 'DELETE', `/api/rent-increases/${draft.id}`, { token: draft.token })
    assert.equal(del.status, 200)
    assert.equal((await c.list()).length, 0)
    const [top] = await journalOf(c.s, '?limit=1')
    assert.equal(top?.title.startsWith('Entwurf einer Mieterhöhung gelöscht'), true, top?.title)
    const again = await jsonOf<RentIncreaseView>(await c.create())
    await c.sent(again)
    const sentOne = await c.one()
    const notDraft = await send(c.s, 'DELETE', `/api/rent-increases/${sentOne.id}`, { token: sentOne.token })
    assert.equal(notDraft.status, 409)
    assert.match(await errorFrom(notDraft), /Nur ein Entwurf/)
    const missing = await send(c.s, 'DELETE', '/api/rent-increases/gibtsnicht', { token: 'x' })
    assert.equal(missing.status, 404)
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung, Verlauf und Backup: Rücksprung nimmt Zustimmung und Stufe zurück, Backup bringt die Verlangen mit', async () => {
  const c = await setup()
  try {
    await c.sent(await jsonOf<RentIncreaseView>(await c.create()))
    const backup = Buffer.from(await (await fetch(`${c.s.base}/api/backup`)).arrayBuffer())
    assert.equal((await c.status(await c.one(), { status: 'agreed' })).status, 200)
    assert.equal((await c.rents()).length, 2)
    const [top] = await journalOf(c.s, '?limit=1')
    if (!top) return assert.fail('kein Eintrag im Verlauf')
    await revert(c.s, top.id)
    assert.equal((await c.one()).status, 'sent')
    assert.deepEqual(await c.rents(), [{ from: '2020-01', monthlyCents: 50000 }])
    // Wieder zustimmen, dann das Backup von vorher einspielen: versandt, ohne Stufe.
    assert.equal((await c.status(await c.one(), { status: 'agreed' })).status, 200)
    const back = await restore(c.s, backup)
    assert.equal(back.status, 200, JSON.stringify(back.body))
    const after = await c.list()
    assert.equal(after.length, 1)
    assert.equal(after[0]?.status, 'sent')
    assert.equal(after[0]?.basis.letter.recipientName, 'Anna und Ben Becker')
    assert.deepEqual(await c.rents(), [{ from: '2020-01', monthlyCents: 50000 }])
  } finally {
    c.s.stop()
  }
})
