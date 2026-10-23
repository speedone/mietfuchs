// Die ortsübliche Warmmiete einer Wohnung über die Routen (#257): gespeichert und geliefert, nach Monat sortiert, ein
// Teilrumpf lässt sie stehen, `null` entfernt sie, ein unvollständiger Eintrag ist eine 400, und die Steuerübersicht
// kürzt die Werbungskosten der verbilligt vermieteten Wohnung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TaxReport, Tenancy, Unit } from '../../shared/types.ts'
import { jsonOf, startServer } from '../testing/api.ts'

test('Ortsübliche Miete: gespeichert, sortiert, Teilrumpf lässt sie stehen, null entfernt, Unvollständiges 400', async () => {
  const s = await startServer()
  try {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const put = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'PUT', body: JSON.stringify(body) })
    const a = await post<Unit>('/api/units', { name: 'DG', areaM2: 60, participates: true })
    await post<Unit>('/api/units', { name: 'EG', areaM2: 40, participates: true })
    const neu = { from: '2025-01', monthlyCents: 90000, source: '  Mietspiegel Musterstadt 2025  ', sourceDate: '2024-04-01' }
    const alt = { from: '2023-01', monthlyCents: 80000, source: 'Mietspiegel Musterstadt 2023', sourceDate: '2022-04-01' }
    const u1 = await put<Unit>(`/api/units/${a.id}`, { localRents: [neu, alt] })
    assert.deepEqual(u1.localRents, [alt, { ...neu, source: 'Mietspiegel Musterstadt 2025' }])
    const u2 = await put<Unit>(`/api/units/${a.id}`, { name: 'DG links' })
    assert.equal(u2.localRents?.length, 2, 'ein Teilrumpf lässt die Angabe stehen')
    const liste = await s.api<Unit[]>('/api/units')
    assert.equal(liste.find((u) => u.id === a.id)?.localRents?.length, 2)

    for (const bad of [{ ...neu, source: ' ' }, { ...neu, monthlyCents: 0 }, { ...neu, from: '2025-13' }, { ...neu, sourceDate: '2024-02-30' }]) {
      const res = await fetch(`${s.base}/api/units/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ localRents: [bad] }) })
      assert.equal(res.status, 400, JSON.stringify(bad))
      assert.match((await jsonOf<{ error: string }>(res)).error, /^Ortsübliche Miete: /)
    }
    assert.equal((await s.api<Unit[]>('/api/units')).find((u) => u.id === a.id)?.localRents?.length, 2, 'nach der Ablehnung unverändert')

    // Die Steuerübersicht: 200 € kalt gegen 900 € warm, Dach 1.000 € nach Fläche.
    const tochter = await post<Tenancy>('/api/tenancies', {
      unitId: a.id, tenantName: 'Tochter', persons: 1, start: '2025-01-01', end: null,
      prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 20000 }],
    })
    await post('/api/costItems', { year: 2025, category: 'Nicht umlagefähig', description: 'Dach', amountCents: 100000, key: 'area' })
    const r = await s.api<TaxReport>('/api/taxreport/2025')
    assert.equal(r.cheapRent?.units[0]?.tenancies[0]?.verdict, 'split')
    assert.equal(r.expenses.gratuitousCents, 46667)
    assert.equal(r.expenses.deductibleCents, 53333)

    // Direkt an Dritte gezahlte Kosten am Mietverhältnis: 150 € Gas im Monat zählen zum Entgelt.
    const t1 = await put<Tenancy>(`/api/tenancies/${tochter.id}`, { directCharges: [{ from: '2025-01', monthlyCents: 15000 }] })
    assert.deepEqual(t1.directCharges, [{ from: '2025-01', monthlyCents: 15000 }])
    const t2 = await put<Tenancy>(`/api/tenancies/${tochter.id}`, { tenantName: 'Tochter A.' })
    assert.equal(t2.directCharges?.length, 1, 'ein Teilrumpf lässt die Angabe stehen')
    const bad = await fetch(`${s.base}/api/tenancies/${tochter.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ directCharges: [{ from: '2025-13', monthlyCents: 1 }] }) })
    assert.equal(bad.status, 400)
    assert.match((await jsonOf<{ error: string }>(bad)).error, /^Direkt gezahlte Kosten: /)
    const mitGas = await s.api<TaxReport>('/api/taxreport/2025')
    assert.equal(mitGas.cheapRent?.units[0]?.tenancies[0]?.entgeltCents, 420000)
    assert.equal(mitGas.expenses.gratuitousCents, 36667)
    // Nie in den Werbungskosten oder im Mietkonto
    assert.equal(mitGas.expenses.totalCents, 100000)
    assert.equal(mitGas.income.sollCents, r.income.sollCents)
    const t3 = await put<Tenancy>(`/api/tenancies/${tochter.id}`, { directCharges: null })
    assert.equal(t3.directCharges, undefined)

    const u3 = await put<Unit>(`/api/units/${a.id}`, { localRents: null })
    assert.equal(u3.localRents, undefined)
    const ohne = await s.api<TaxReport>('/api/taxreport/2025')
    assert.equal(ohne.cheapRent, undefined)
    assert.equal(ohne.expenses.deductibleCents, 100000)
  } finally {
    s.stop()
  }
})
