// Der Verlauf mit 1000 Einträgen (#318, Schritt 4): Eine Seite und jeder Filter antworten schnell, und der Verlauf lädt
// in Stücken. Die Einträge entstehen über die Routen (echte Gruppen); gemessen wird die Antwortzeit des Servers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Tenancy, Unit } from '../../shared/types.ts'
import type { JournalGroupView } from '../src/db/journal.ts'
import { jsonOf, startServerIn } from '../testing/api.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
// Großzügig gegen eine langsame CI-Maschine; gemessen wird der Median mehrerer Abrufe.
const LIMIT_MS = 200

test('Verlauf mit 1000 Einträgen: jede Seite und jeder Filter unter 200 ms, geblättert in Stücken zu 50', { timeout: 300_000 }, async () => {
  const s = await startServerIn(tmp())
  try {
    const post = <T>(url: string, body: unknown) => s.api<T>(url, { method: 'POST', body: JSON.stringify(body) })
    const second = await post<{ id: string }>('/api/properties', { name: 'Zweites Haus' })
    const unit = await post<Unit>('/api/units', { name: 'EG', areaM2: 60, participates: true, selfUsed: false, propertyId: 'objekt-1' })
    const tenancy = await post<Tenancy>('/api/tenancies', { unitId: unit.id, tenantName: 'Müller', persons: 2, start: '2024-01-01' })
    const other = await post<Unit>('/api/units', { name: 'Hinterhaus', areaM2: 40, participates: true, selfUsed: false, propertyId: second.id })
    for (let i = 0; i < 1000; i++) {
      if (i % 10 === 0) await post('/api/payments', { tenancyId: tenancy.id, date: '2024-02-01', amountCents: 100 + i })
      else if (i % 2 === 0) await s.api(`/api/units/${other.id}`, { method: 'PUT', body: JSON.stringify({ notes: `Notiz ${i}` }) })
      else await s.api(`/api/tenancies/${tenancy.id}`, { method: 'PUT', body: JSON.stringify({ phone: `0${i}` }) })
    }
    const timed = async (query: string): Promise<{ ms: number, page: JournalGroupView[] }> => {
      const times: number[] = []
      let page: JournalGroupView[] = []
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now()
        const res = await fetch(`${s.base}/api/journal${query}`)
        page = await jsonOf<JournalGroupView[]>(res)
        times.push(performance.now() - t0)
        assert.equal(res.status, 200)
      }
      return { ms: times.sort((a, b) => a - b)[1], page }
    }
    const checks: [string, (page: JournalGroupView[]) => void][] = [
      ['?limit=50', (p) => assert.equal(p.length, 50)],
      ['?property=objekt-1&limit=50', (p) => assert.equal(p.length, 50)],
      [`?property=${second.id}&limit=50`, (p) => assert.equal(p.length, 50)],
      ['?kind=payments&limit=50', (p) => assert.ok(p.length === 50 && p.every((g) => g.description === 'Zahlung angelegt'))],
      ['?q=Notiz%20999&limit=50', (p) => assert.equal(p.length, 0)],
      ['?q=Notiz%20998&limit=50', (p) => assert.equal(p.length, 1)],
      ['?to=2000-01-01&limit=50', (p) => assert.equal(p.length, 0)],
      ['?property=objekt-1&kind=units&q=Notiz&limit=50', (p) => assert.equal(p.length, 0)],
    ]
    for (const [query, check] of checks) {
      const { ms, page } = await timed(query)
      check(page)
      assert.ok(ms < LIMIT_MS, `${query}: ${ms.toFixed(0)} ms`)
    }
    // In Stücken: 50 je Seite, über `before`, bis zum Ende, ohne Doppel.
    const seen = new Set<number>()
    let before: number | null = null
    let pages = 0
    for (;;) {
      const query: string = `?limit=50${before === null ? '' : `&before=${before}`}`
      const { ms, page } = await timed(query)
      assert.ok(ms < LIMIT_MS, `${query}: ${ms.toFixed(0)} ms`)
      for (const g of page) {
        assert.ok(!seen.has(g.id))
        seen.add(g.id)
      }
      pages++
      if (page.length < 50) break
      before = page[page.length - 1].id
    }
    assert.equal(seen.size, 1004)
    assert.equal(pages, 21)
  } finally {
    s.stop()
  }
})
