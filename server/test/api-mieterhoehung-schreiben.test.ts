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
import { connect } from '../src/db/client.ts'
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
  severalLandlords: false,
  allLandlordsNamed: true,
  allTenantsNamed: true,
  extraParagraph: 'Für Rückfragen bin ich gern erreichbar.',
}
const INDEX_LETTER: RentIncreaseLetterInput = { ...LETTER, justification: null, comparables: [], qualifiedSurvey: null, qualified: null }

// Ohne Namen des Vermieters, wie ein frischer Bestand: Der Entwurf entsteht trotzdem (Warnung, keine Sperre, siehe unten).
async function setup(baseRents: RentEntry[] = [{ from: '2020-01', monthlyCents: 50000 }], more: Partial<Tenancy> = {}, landlordName: string | null = null) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const s = await startServerIn(dataDir, { NKA_TEST_TODAY: TODAY })
  if (landlordName !== null) await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName }) })
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
  // Mit Namen des Vermieters: Nur dann ist die Bestätigung zum Briefkopf Pflicht (ohne Namen ließe sie sich nicht geben).
  const c = await setup(undefined, {}, 'Max Vermieter')
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
    assert.equal(sent.basis.plan.receivedOn, TODAY)
    assert.equal(sent.basis.plan.consent?.consentEnd, '2027-01-31')
    assert.equal(sent.basis.sentPlan?.receivedOn, TODAY)
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

// Den Server beenden, ohne den Ordner zu löschen (`stop` räumt ihn weg), und mit demselben Ordner und einem Tag neu starten.
async function halt(s: Server): Promise<void> {
  if (s.child.exitCode !== null) return
  const exited = new Promise((resolve) => s.child.once('exit', resolve))
  s.child.kill()
  await exited
}
async function restartOn(s: Server, day: string): Promise<Server> {
  await halt(s)
  return startServerIn(s.dataDir, { NKA_TEST_TODAY: day })
}

test('Mieterhöhung, Versand: der Nachdruck bleibt das Schreiben des Entwurfs, der tatsächliche Zugang steht getrennt (Durchsicht M1)', async () => {
  const c = await setup()
  let later: Server | null = null
  try {
    const draft = await jsonOf<RentIncreaseView>(await c.create())
    assert.equal(draft.basis.plan.receivedOn, TODAY)
    assert.equal(draft.basis.sentPlan, null)
    later = await restartOn(c.s, '2026-11-25')
    const res = await send(later, 'POST', `/api/rent-increases/${draft.id}/send`, { receivedOn: '2026-11-25', token: draft.token })
    assert.equal(res.status, 200, await res.clone().text())
    const sent = await jsonOf<RentIncreaseView>(res)
    assert.equal(sent.receivedOn, '2026-11-25')
    // Die Grundlage des gedruckten Schreibens bleibt Wort für Wort; die Rechnung zum Zugang steht daneben.
    assert.deepEqual({ ...sent.basis, sentPlan: null }, draft.basis)
    assert.equal(sent.basis.sentPlan?.receivedOn, '2026-11-25')
    assert.equal(sent.basis.sentPlan?.consent?.consentEndOnWorkday, draft.basis.plan.consent?.consentEndOnWorkday)
  } finally {
    later?.stop()
    c.s.stop()
  }
})

test('Mieterhöhung, Versand: ändert sich zwischen Entwurf und Versand die Staffel, wird nicht gespeichert (Durchsicht M1)', async () => {
  const c = await setup()
  try {
    await c.create()
    const changed = await send(c.s, 'PUT', `/api/tenancies/${c.t.id}?property=${c.p.id}`, { baseRents: [{ from: '2020-01', monthlyCents: 52000 }] })
    assert.equal(changed.status, 200, await changed.clone().text())
    const res = await c.sent(await c.one())
    assert.equal(res.status, 409, await res.clone().text())
    const text = await errorFrom(res)
    assert.match(text, /bisherige Miete 520,00 € statt 500,00 €/)
    assert.match(text, /Bitte legen Sie das Schreiben neu an und drucken Sie es neu\.$/)
    assert.equal((await c.one()).status, 'draft')
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung: eine Grundlage aus einer anderen Fassung lässt die Liste stehen und den Versand mit Satz ablehnen (Durchsicht K1)', async () => {
  const c = await setup()
  let later: Server | null = null
  try {
    const draft = await jsonOf<RentIncreaseView>(await c.create())
    await halt(c.s)
    const db = await connect(path.join(c.dataDir, 'mietfuchs.sqlite'))
    db.exec(`UPDATE rent_increases SET basis = '{"version":2,"anders":true}'`)
    db.close()
    later = await startServerIn(c.dataDir, { NKA_TEST_TODAY: TODAY })
    const list = await later.api<RentIncreaseView[]>(`/api/tenancies/${c.t.id}/rent-increases`)
    assert.equal(list.length, 1)
    const res = await send(later, 'POST', `/api/rent-increases/${draft.id}/send`, { receivedOn: TODAY, token: list[0]?.token })
    assert.equal(res.status, 409, await res.clone().text())
    assert.match(await errorFrom(res), /^Dieses Schreiben stammt aus einer anderen Fassung/)
  } finally {
    later?.stop()
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

test('Mieterhöhung, Rücknahme: eine spätere Stufe baut auf der Erhöhung auf, 409 und Staffel unverändert (Integrationsdurchsicht S-Geld)', async () => {
  const c = await setup()
  let s2: Server | null = null
  try {
    await c.sent(await jsonOf<RentIncreaseView>(await c.create()))
    assert.equal((await c.status(await c.one(), { status: 'partial', agreedCents: 55000 })).status, 200)
    // Anderthalb Jahre später: zweite Erhöhung auf der ersten.
    const later = '2028-06-20'
    const s = await restartOn(c.s, later)
    s2 = s
    const plan = await post<RentIncreasePlanView>(s, `/api/tenancies/${c.t.id}/rent-increase/plan`, COMPARISON)
    assert.equal(plan.state, 'possible', plan.reasons.join(' '))
    const created = await send(s, 'POST', `/api/tenancies/${c.t.id}/rent-increases`, { request: COMPARISON, letter: LETTER, token: plan.token })
    assert.equal(created.status, 201, await created.clone().text())
    const second = await jsonOf<RentIncreaseView>(created)
    assert.equal(second.fromCents, 55000)
    const sentRes = await send(s, 'POST', `/api/rent-increases/${second.id}/send`, { receivedOn: later, token: second.token })
    assert.equal(sentRes.status, 200, await sentRes.clone().text())
    const agreed = await send(s, 'POST', `/api/rent-increases/${second.id}/status`, { status: 'agreed', decidedOn: later, token: (await jsonOf<RentIncreaseView>(sentRes)).token })
    assert.equal(agreed.status, 200, await agreed.clone().text())
    const rentsOf = async () => (await s.api<Tenancy[]>(`/api/tenancies?property=${c.p.id}`)).find((x) => x.id === c.t.id)?.baseRents ?? assert.fail('Mietverhältnis fehlt')
    const before = await rentsOf()
    assert.deepEqual(before, [{ from: '2020-01', monthlyCents: 50000 }, { from: '2027-02', monthlyCents: 55000, reason: 'comparison' }, { from: '2028-09', monthlyCents: 60000, reason: 'comparison' }])
    const all = await s.api<RentIncreaseView[]>(`/api/tenancies/${c.t.id}/rent-increases`)
    const first = all.find((x) => x.id !== second.id) ?? assert.fail('erstes Verlangen fehlt')
    const back = await send(s, 'POST', `/api/rent-increases/${first.id}/status`, { status: 'withdrawn', decidedOn: later, token: first.token })
    assert.equal(back.status, 409)
    assert.match(await errorFrom(back), /Stufe ab September 2028, die auf dieser Erhöhung aufbaut.*\.$/)
    assert.deepEqual(await rentsOf(), before, 'Staffel unverändert')
    assert.equal((await s.api<RentIncreaseView[]>(`/api/tenancies/${c.t.id}/rent-increases`)).find((x) => x.id === first.id)?.status, 'partial')
  } finally {
    s2?.stop()
    c.s.stop()
  }
})

test('Mieterhöhung, Antwort: Zustimmung, wenn das Mietverhältnis vor dem Wirksamwerden endet, 400 mit Satz (Integrationsdurchsicht K-Geld-1)', async () => {
  const c = await setup()
  try {
    await c.sent(await jsonOf<RentIncreaseView>(await c.create()))
    const ended = await send(c.s, 'PUT', `/api/tenancies/${c.t.id}?property=${c.p.id}`, { end: '2027-01-31' })
    assert.equal(ended.status, 200, await ended.clone().text())
    for (const body of [{ status: 'agreed' }, { status: 'partial', agreedCents: 55000 }]) {
      const res = await c.status(await c.one(), body)
      assert.equal(res.status, 400, JSON.stringify(body))
      assert.match(await errorFrom(res), /endet am 31\.01\.2027, vor dem Wirksamwerden am 01\.02\.2027.*\.$/)
    }
    assert.deepEqual(await c.rents(), [{ from: '2020-01', monthlyCents: 50000 }])
    assert.equal((await c.status(await c.one(), { status: 'refused' })).status, 200, 'Ablehnung bleibt möglich')
  } finally {
    c.s.stop()
  }
})

test('Mieterhöhung: eine Wohnung mit offenem Verlangen wechselt nicht das Objekt, 400 mit Satz (Integrationsdurchsicht K-Daten-1)', async () => {
  const c = await setup()
  try {
    const other = await post<Property>(c.s, '/api/properties', { name: 'Gartenweg', kind: 'mfh', address: 'Gartenweg 3, 12345 Musterstadt', rentCapReduced: false, state: 'BY' })
    const move = () => send(c.s, 'PUT', `/api/units/${c.u.id}?property=${c.p.id}`, { propertyId: other.id })
    const refused = async () => {
      const res = await move()
      assert.equal(res.status, 400, await res.clone().text())
      assert.match(await errorFrom(res), /offenes Verlangen einer Mieterhöhung.*Tragen Sie zuerst die Antwort des Mieters ein oder nehmen Sie das Verlangen zurück.*\.$/)
    }
    await c.create()
    await refused()
    await c.sent(await c.one())
    await refused()
    assert.equal((await c.status(await c.one(), { status: 'refused' })).status, 200)
    const res = await move()
    assert.equal(res.status, 200, await res.clone().text())
  } finally {
    c.s.stop()
  }
})

// § 558a Abs. 1 und § 557b Abs. 3 BGB verlangen Textform, § 126b BGB dafür, dass die Person des Erklärenden genannt ist.
// Ohne Namen des Vermieters steht im Briefkopf nur das Objekt und unter dem Gruß nichts; setzt der Vermieter Namen und
// Unterschrift von Hand darunter, ist er genannt. Deshalb wie bei „Absender fehlt“ der Abrechnung eine Warnung der
// Oberfläche und keine Sperre des Servers. Die Bestätigung „Im Briefkopf sind alle Vermieter genannt“ lässt sich ohne
// Namen nicht geben und ist dann nicht verlangt; mit Namen oder mit Briefpapier (das den Absender trägt) bleibt sie Pflicht.
test('Mieterhöhung, Schreiben: ohne Namen des Vermieters entsteht der Entwurf; die Bestätigung zum Briefkopf ist nur mit Namen oder Briefpapier Pflicht', async () => {
  const c = await setup()
  try {
    const drop = async (res: Response) => {
      assert.equal(res.status, 201, await res.clone().text())
      const draft = await jsonOf<RentIncreaseView>(res)
      assert.equal((await send(c.s, 'DELETE', `/api/rent-increases/${draft.id}`, { token: draft.token })).status, 200)
      return draft
    }
    const confirmed = await drop(await c.create())
    assert.equal(confirmed.basis.sender.name, '')
    const open = await drop(await c.create(COMPARISON, { ...LETTER, allLandlordsNamed: false }))
    assert.equal(open.basis.letter.allLandlordsNamed, false)
    // Die Bestätigung zu den Mietern bleibt Pflicht.
    assert.equal((await c.create(COMPARISON, { ...LETTER, allLandlordsNamed: false, allTenantsNamed: false })).status, 400)
    // Briefpapier der Installation: Das Papier trägt den Absender, die Bestätigung gilt ihm.
    const design = async (paper: 'new' | 'remove') => {
      const fd = new FormData()
      fd.append('design', JSON.stringify({ logo: 'keep', paper, paperNextFile: 'keep', paperNext: 'same', margins: { top: 45, right: 20, bottom: 30, left: 25 } }))
      if (paper === 'new') fd.append('paper', new Blob([Buffer.from('%PDF-1.4\n%Briefpapier\n')]), 'Briefbogen.pdf')
      assert.equal((await fetch(`${c.s.base}/api/letter-design`, { method: 'PUT', body: fd })).status, 200)
    }
    await design('new')
    const onPaper = await c.create(COMPARISON, { ...LETTER, allLandlordsNamed: false })
    assert.equal(onPaper.status, 400)
    assert.match(await errorFrom(onPaper), /alle Vermieter/)
    await drop(await c.create())
    await design('remove')
    // Mit Namen am Objekt: Pflicht, und der Name steht im Schreiben.
    await c.s.api(`/api/properties/${c.p.id}`, { method: 'PUT', body: JSON.stringify({ landlordName: 'Erika Eigentümerin' }) })
    const named = await c.create(COMPARISON, { ...LETTER, allLandlordsNamed: false })
    assert.equal(named.status, 400)
    assert.match(await errorFrom(named), /alle Vermieter/)
    assert.equal((await drop(await c.create())).basis.sender.name, 'Erika Eigentümerin')
  } finally {
    c.s.stop()
  }
})
