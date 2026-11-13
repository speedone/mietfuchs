// Kontoauszug einlesen über die Routen (#188, PR 1): Vorschau und Übernehmen mit Marke, Konten, Import zurücknehmen,
// Verlauf, Rücksprung, Backup. Der Auszug ist erfunden (fixtures/camt/kontoauszug-juni.xml).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { Tenancy, Unit } from '../../shared/types.ts'
import { besideServer, errorFrom, restore, startServer, type Server } from '../testing/api.ts'
import { dumpStock, journalOf, newest, revert } from '../testing/revert.ts'

const OWN = 'DE89370400440532013000'
const TENANT = 'DE02120300000000202051'
const JUNE = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'camt', 'kontoauszug-juni.xml'))

type Preview = { questions: unknown[]; findings: { where: string; message: string }[]; summary: { stored: number; knownDays: number; pending: number }; sentence: string; ready: boolean; token: string }
type AccountView = { id: string; iban: string | null; kind: string; rentalConfirmedAt: string | null; coverage: unknown; imports: { id: string }[] }

const ACCEPT = [{ type: 'account', iban: OWN, accept: true }]

function form(file: Buffer, name: string, fields: Record<string, unknown> = {}): FormData {
  const fd = new FormData()
  fd.append('statement', new Blob([file]), name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v))
  return fd
}
const planRaw = (s: Server, file = JUNE, decisions: unknown = ACCEPT, name = 'juni.xml') =>
  fetch(`${s.base}/api/bank/import/plan`, { method: 'POST', body: form(file, name, { decisions }) })
async function plan(s: Server, decisions: unknown = ACCEPT): Promise<Preview> {
  const res = await planRaw(s, JUNE, decisions)
  assert.equal(res.status, 200, await res.clone().text())
  return res.json() as Promise<Preview>
}
const importRaw = (s: Server, token: string, decisions: unknown = ACCEPT) =>
  fetch(`${s.base}/api/bank/import`, { method: 'POST', body: form(JUNE, 'juni.xml', { decisions, token }) })
async function importJune(s: Server): Promise<{ ok: boolean; sentence: string }> {
  const res = await importRaw(s, (await plan(s)).token)
  assert.equal(res.status, 200, await res.clone().text())
  return res.json() as Promise<{ ok: boolean; sentence: string }>
}
const accounts = (s: Server) => s.api<AccountView[]>('/api/bank/accounts')

async function tenancy(s: Server): Promise<Tenancy> {
  const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
  return s.api<Tenancy>('/api/tenancies', {
    method: 'POST',
    body: JSON.stringify({ unitId: unit.id, tenantName: 'Erika Beispiel', persons: 1, start: '2025-01-01', end: null, iban: TENANT,
      prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 70000 }] }),
  })
}

const bankRows = (stock: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(stock).filter(([t]) => t.startsWith('bank_') || t === 'tenancy_payers'))

const listing = (dir: string): string[] => fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => !/mietfuchs\.sqlite-(wal|shm)$/.test(f)).sort()

async function withServer(work: (s: Server) => Promise<void>): Promise<void> {
  const s = await startServer()
  try {
    await work(s)
  } finally {
    s.child.kill()
    await new Promise((resolve) => s.child.once('exit', resolve))
    fs.rmSync(s.dataDir, { recursive: true, force: true })
  }
}

test('Kontoauszug: Plan schreibt nichts, auch keine Datei und keinen Eintrag im Verlauf', () => withServer(async (s) => {
  await tenancy(s)
  const before = await dumpStock(s.dataDir)
  const files = listing(s.dataDir)
  const journal = (await journalOf(s)).length
  const open = await plan(s, [])
  assert.equal(open.ready, false)
  assert.deepEqual(open.questions, [{ type: 'account', iban: OWN, otherId: null }])
  const accepted = await plan(s)
  assert.equal(accepted.ready, true)
  assert.equal(accepted.sentence, '2 Umsätze übernommen.')
  assert.deepEqual(await dumpStock(s.dataDir), before)
  assert.deepEqual(listing(s.dataDir), files)
  assert.equal((await journalOf(s)).length, journal)
}))

test('Kontoauszug: Übernehmen schreibt Konto, Import, Tage und Umsätze der Vermietung in einem Zug', () => withServer(async (s) => {
  await tenancy(s)
  const journal = (await journalOf(s)).length
  assert.deepEqual(await importJune(s), { ok: true, sentence: '2 Umsätze übernommen.' })
  const [account, ...more] = await accounts(s)
  assert.equal(more.length, 0)
  assert.equal(account?.iban, OWN)
  assert.equal(account?.kind, 'mixed')
  assert.equal(account?.imports.length, 1)
  assert.deepEqual(account?.coverage, { from: '2025-06-01', to: '2025-06-30' })
  const rows = bankRows(await dumpStock(s.dataDir))
  assert.equal(rows.bank_days?.length, 2)
  assert.equal(rows.bank_transactions?.length, 2)
  assert.ok(!JSON.stringify(rows).includes('Buchladen'), 'der private Umsatz steht nirgends einzeln')
  assert.ok(!JSON.stringify(rows).includes('DE75512108001245126199'))
  const groups = await journalOf(s)
  assert.equal(groups.length, journal + 1)
  assert.equal((await newest(s)).description, 'Kontoauszug eingelesen')
}))

test('Kontoauszug: zweimal dieselbe Datei ändert nichts', () => withServer(async (s) => {
  await tenancy(s)
  await importJune(s)
  const before = await dumpStock(s.dataDir)
  const again = await plan(s)
  assert.match(again.sentence, /^Dieser Auszug wurde am \d\d\.\d\d\.\d{4} schon eingelesen\.$/)
  const res = await importRaw(s, again.token)
  assert.equal(res.status, 200)
  assert.deepEqual(bankRows(await dumpStock(s.dataDir)), bankRows(before))
}))

test('Kontoauszug: veraltete Marke (Mieter-IBAN zwischen Vorschau und Übernehmen geändert) ergibt 409 und schreibt nichts', () => withServer(async (s) => {
  const t = await tenancy(s)
  const preview = await plan(s)
  await s.api<Tenancy>(`/api/tenancies/${t.id}`, { method: 'PUT', body: JSON.stringify({ ...t, iban: 'DE44500105175407324931' }) })
  const before = await dumpStock(s.dataDir)
  const res = await importRaw(s, preview.token)
  assert.equal(res.status, 409)
  const body = await res.json() as { error: string; preview: Preview }
  assert.equal(body.error, 'Der Stand hat sich geändert. Bitte prüfen Sie die Vorschau noch einmal.')
  assert.notEqual(body.preview.token, preview.token)
  assert.deepEqual(bankRows(await dumpStock(s.dataDir)), bankRows(before))
}))

test('Kontoauszug: offene Rückfragen, fehlende Marke, zu große Datei und keine Bankdatei werden abgelehnt', () => withServer(async (s) => {
  const open = await plan(s, [])
  const unanswered = await importRaw(s, open.token, [])
  assert.equal(unanswered.status, 400)
  assert.equal(await errorFrom(unanswered), 'Bitte beantworten Sie zuerst die Rückfragen.')
  const noToken = await fetch(`${s.base}/api/bank/import`, { method: 'POST', body: form(JUNE, 'juni.xml', { decisions: ACCEPT }) })
  assert.equal(noToken.status, 400)
  const big = await planRaw(s, Buffer.alloc(21 * 1024 * 1024, 32))
  assert.equal(big.status, 413)
  assert.match(await errorFrom(big), /zu groß für Kontoauszüge; höchstens 20 MB/)
  const pdf = await planRaw(s, Buffer.from('%PDF-1.7\n%%EOF\n'), [], 'beleg.pdf')
  assert.equal(pdf.status, 400)
  assert.match(await errorFrom(pdf), /kein Kontoauszug im Format camt oder MT940/)
  const garbled = await planRaw(s, JUNE, '{kaputt')
  assert.equal(garbled.status, 400)
}))

test('Kontoauszug: ein Konto nur für die Vermietung braucht die Bestätigung', () => withServer(async (s) => {
  await tenancy(s)
  await importJune(s)
  const [account] = await accounts(s)
  assert.ok(account)
  const refused = await fetch(`${s.base}/api/bank/accounts/${account.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'rental' }) })
  assert.equal(refused.status, 400)
  assert.match(await errorFrom(refused), /^Ab jetzt wird jeder Umsatz dieses Kontos einzeln gespeichert, auch ein privater\./)
  const confirmed = await s.api<AccountView>(`/api/bank/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ kind: 'rental', confirm: true, label: 'Mietkonto' }) })
  assert.equal(confirmed.kind, 'rental')
  assert.ok(confirmed.rentalConfirmedAt)
  assert.equal((await newest(s)).description, 'Konto geändert')
  const missing = await fetch(`${s.base}/api/bank/accounts/gibt-es-nicht`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'x' }) })
  assert.equal(missing.status, 404)
}))

test('Kontoauszug: Import zurücknehmen löscht Tage und Umsätze, danach lässt er sich neu einlesen; nicht mit Zuordnung', () => withServer(async (s) => {
  const t = await tenancy(s)
  await importJune(s)
  const [account] = await accounts(s)
  const importId = account?.imports[0]?.id ?? assert.fail('kein Import')
  const res = await fetch(`${s.base}/api/bank/imports/${importId}`, { method: 'DELETE' })
  assert.equal(res.status, 200)
  assert.equal((await newest(s)).description, 'Import zurückgenommen')
  const rows = bankRows(await dumpStock(s.dataDir))
  assert.equal(rows.bank_days?.length, 0)
  assert.equal(rows.bank_transactions?.length, 0)
  assert.equal(rows.bank_accounts?.length, 1)
  assert.equal((await plan(s)).sentence, '2 Umsätze übernommen.')
  await importJune(s)
  const [again] = await accounts(s)
  const secondId = again?.imports[0]?.id ?? assert.fail('kein Import')
  const c = await besideServer(s.dataDir)
  try {
    c.exec(`INSERT INTO payments (id, tenancy_id, date, amount_cents) VALUES ('p-bank', '${t.id}', '2025-06-02', 85000)`)
    const tx = String(c.rows(`SELECT id FROM bank_transactions ORDER BY rowid LIMIT 1`)[0]?.[0])
    c.exec(`INSERT INTO bank_transaction_links (id, transaction_id, payment_id, created) VALUES ('l-bank', '${tx}', 'p-bank', 1)`)
  } finally {
    c.close()
  }
  const refused = await fetch(`${s.base}/api/bank/imports/${secondId}`, { method: 'DELETE' })
  assert.equal(refused.status, 409)
  assert.equal(await errorFrom(refused), 'Zu diesem Auszug sind schon Zahlungen gebucht. Lösen Sie zuerst die Zuordnungen.')
  assert.equal((await fetch(`${s.base}/api/bank/imports/gibt-es-nicht`, { method: 'DELETE' })).status, 404)
}))

test('Kontoauszug: Rücksprung über den Import stellt den Bestand von vorher her', () => withServer(async (s) => {
  await tenancy(s)
  const before = await dumpStock(s.dataDir)
  await importJune(s)
  await revert(s, (await newest(s)).id)
  assert.deepEqual(bankRows(await dumpStock(s.dataDir)), bankRows(before))
}))

test('Kontoauszug: Backup und Wiederherstellen tragen die Tabellen', () => withServer(async (s) => {
  await tenancy(s)
  await importJune(s)
  const [account] = await accounts(s)
  await s.api(`/api/bank/accounts/${account?.id}`, { method: 'PUT', body: JSON.stringify({ label: 'Girokonto' }) })
  const withImport = bankRows(await dumpStock(s.dataDir))
  const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
  await fetch(`${s.base}/api/bank/imports/${account?.imports[0]?.id}`, { method: 'DELETE' })
  assert.equal((await restore(s, backup)).status, 200)
  assert.deepEqual(bankRows(await dumpStock(s.dataDir)), withImport)
}))
