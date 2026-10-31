// Gesamtsicht über alle Objekte über die echte Route (#96 PR 3, Entwurf 2026-10-30-steuer-objekt-ruecklage-design.md,
// Teil C): `GET /api/tax/overview?year=`, installationsweit wie Belege und Backup. Drei Objekte: ein Haus mit
// Mietverhältnis an Angehörige, Zehn-Tage-Regel und verteilter Reparatur (#262), eine leere Eigentumswohnung mit
// Werbungskosten (Leerstand: Nummer) und ein Objekt ganz ohne (keine Nummer). Jede Zahl ist die der Steuerseite des
// Objekts (`/api/taxreport`), die Summe die Summe der Objekte. Die Invariante über Zufallsbestände steht in
// invariant-steuer-gesamt.test.ts, dort auch das Objekt mit Fehler.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jsonOf, startServer } from '../testing/api.ts'
import type { Property, TaxOverview, TaxReport, Tenancy, Unit } from '../../shared/types.ts'

test('Gesamtsicht: je Objekt die Zahlen der Steuerseite (Zeile 32, Raten), Summe, Nummer nur mit Vermietung, 400 ohne Jahr', async () => {
  const s = await startServer()
  try {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const [haus] = await s.api<Property[]>('/api/properties')
    if (!haus) assert.fail('kein Objekt')
    // In der Reihenfolge der Anlage: Haus, Garagen (leer), Wohnung (Leerstand).
    const garagen = await post<Property>('/api/properties', { name: 'Garagenhof', kind: 'sonstiges', address: '' })
    const wohnung = await post<Property>('/api/properties', { name: 'Wohnung Lindenstraße', kind: 'etw', address: '' })

    const eg = await post<Unit>('/api/units', { propertyId: haus.id, name: 'EG', areaM2: 80, participates: true })
    const tochter = await post<Tenancy>(`/api/tenancies?property=${haus.id}`, {
      unitId: eg.id, tenantName: 'Tochter', persons: 1, start: '2024-01-01', end: null, personHistory: [], relative: true,
      prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 50000 }],
    })
    for (let m = 1; m <= 12; m++) await post(`/api/payments?property=${haus.id}`, { tenancyId: tochter.id, date: `2024-${String(m).padStart(2, '0')}-03`, amountCents: 50000 })
    // Die Januarmiete am 28.12.2024 gezahlt: zählt nach der Zehn-Tage-Regel 2025 (Zeile 32), nach Datum 2024.
    await post(`/api/payments?property=${haus.id}`, { tenancyId: tochter.id, date: '2024-12-28', amountCents: 50000 })
    for (let m = 2; m <= 12; m++) await post(`/api/payments?property=${haus.id}`, { tenancyId: tochter.id, date: `2025-${String(m).padStart(2, '0')}-03`, amountCents: 50000 })
    await post(`/api/costItems?property=${haus.id}`, { period: '2025-01', category: 'Nicht umlagefähig', description: 'Dachsanierung', amountCents: 900_000, key: 'area', spreadYears: 3 })
    await post(`/api/costItems?property=${haus.id}`, { period: '2025-01', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 40_000, key: 'area' })

    await post<Unit>('/api/units', { propertyId: wohnung.id, name: 'ETW', areaM2: 70, participates: true })
    await post(`/api/costItems?property=${wohnung.id}`, { period: '2025-01', category: 'Nicht umlagefähig', description: 'Malerarbeiten', amountCents: 120_000, key: 'area' })

    for (const year of [2025, 2026]) {
      // Ohne `?property=`, obwohl es drei Objekte gibt.
      const overview = await s.api<TaxOverview>(`/api/tax/overview?year=${year}`)
      assert.equal(overview.year, year)
      assert.deepEqual(overview.rows.map((r) => r.propertyId), [haus.id, garagen.id, wohnung.id])
      assert.deepEqual(overview.rows.map((r) => r.name), [haus.name, 'Garagenhof', 'Wohnung Lindenstraße'])
      const pages = await Promise.all(overview.rows.map((r) => s.api<TaxReport>(`/api/taxreport/${year}?property=${r.propertyId}`)))
      let income = 0
      let deductible = 0
      let surplus = 0
      overview.rows.forEach((row, k) => {
        const page = pages[k] ?? assert.fail('Seite fehlt')
        if (!row.ok) assert.fail(row.error)
        assert.equal(row.sums.incomeCents, page.income.received?.totalCents, `${year} ${row.name}: Zeile 32`)
        assert.equal(row.sums.deductibleCents, page.expenses.deductibleCents, `${year} ${row.name}: abziehbar`)
        assert.equal(row.sums.deferredCents, page.expenses.deferredCents ?? 0, `${year} ${row.name}: verteilt`)
        assert.equal(row.sums.privateCents, page.expenses.privateCents, `${year} ${row.name}: privat`)
        assert.equal(row.sums.surplusCents, page.surplusReceivedCents, `${year} ${row.name}: Überschuss`)
        income += row.sums.incomeCents
        deductible += row.sums.deductibleCents
        surplus += row.sums.surplusCents
      })
      assert.deepEqual([overview.totals.incomeCents, overview.totals.deductibleCents, overview.totals.surplusCents], [income, deductible, surplus], `${year}: Summe`)
      const [h, g, w] = overview.rows
      if (!h?.ok || !g?.ok || !w?.ok) assert.fail('Zeile mit Fehler')
      assert.deepEqual([h.number, g.number, w.number], year === 2025 ? [1, null, 2] : [1, null, null], `${year}: Nummern`)
      assert.equal(g.hasRental, false)
      if (year === 2025) {
        // Zeile 32 mit der Januarmiete aus dem Dezember, nach Datum ohne; Angehörige in Zeile 19.
        assert.equal(h.sums.incomeCents, 600_000)
        assert.equal(pages[0]?.income.paidCents, 550_000, 'nach Datum: elf Monate')
        assert.equal(h.sums.incomeLines.relatives, 600_000)
        // Dach: Rate 1 von 3 (3.000 €) und Grundsteuer; 6.000 € in Folgejahre.
        assert.equal(h.sums.deductibleCents, 340_000)
        assert.equal(h.sums.deferredCents, 600_000)
        // Leerstand mit Werbungskosten: Nummer 2.
        assert.equal(w.hasRental, true)
        assert.equal(w.sums.deductibleCents, 120_000)
      } else {
        assert.equal(h.sums.deferredCents, -300_000, '2026: Rate 2 aus 2025')
      }
    }

    for (const bad of ['', '?year=', '?year=abc', '?year=2025.5']) {
      const res = await fetch(`${s.base}/api/tax/overview${bad}`)
      assert.equal(res.status, 400, bad)
      assert.match((await jsonOf<{ error: string }>(res)).error, /Jahr/)
    }
  } finally {
    s.stop()
  }
})

// Durchsicht S2: Eine Januarmiete, die am 28.12. vor dem Mietbeginn am 01.01. eingeht, gehört nach § 11 Abs. 1 Satz 2
// EStG ins neue Jahr. Im alten Jahr hat das Objekt dann keine Vermietung und keine Nummer, auch wenn der Kontoauszug die
// Zahlung dort zeigt.
test('Gesamtsicht: Januarmiete Ende Dezember vor Mietbeginn ergibt im alten Jahr keine Vermietung', async () => {
  const s = await startServer()
  try {
    const post = <T>(route: string, body: unknown) => s.api<T>(route, { method: 'POST', body: JSON.stringify(body) })
    const [haus] = await s.api<Property[]>('/api/properties')
    if (!haus) assert.fail('kein Objekt')
    const neu = await post<Property>('/api/properties', { name: 'Neubau', kind: 'efh', address: '' })
    const eg = await post<Unit>('/api/units', { propertyId: neu.id, name: 'Haus', areaM2: 120, participates: true })
    const t = await post<Tenancy>(`/api/tenancies?property=${neu.id}`, {
      unitId: eg.id, tenantName: 'Neumann', persons: 2, start: '2026-01-01', end: null, personHistory: [],
      prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2026-01', monthlyCents: 100000 }],
    })
    await post(`/api/payments?property=${neu.id}`, { tenancyId: t.id, date: '2025-12-28', amountCents: 100000 })
    const page2025 = await s.api<TaxReport>(`/api/taxreport/2025?property=${neu.id}`)
    assert.equal(page2025.income.paidCents, 100000, 'nach Datum 2025')
    assert.equal(page2025.income.received?.totalCents, 0, 'Zeile 32 2025')
    const o2025 = await s.api<TaxOverview>('/api/tax/overview?year=2025')
    const row = o2025.rows.find((r) => r.propertyId === neu.id) ?? assert.fail('Zeile fehlt')
    if (!row.ok) assert.fail(row.error)
    assert.equal(row.hasRental, false)
    assert.equal(row.number, null)
    const o2026 = await s.api<TaxOverview>('/api/tax/overview?year=2026')
    const row26 = o2026.rows.find((r) => r.propertyId === neu.id) ?? assert.fail('Zeile fehlt')
    if (!row26.ok) assert.fail(row26.error)
    assert.equal(row26.sums.incomeCents, 100000)
    assert.equal(row26.number, 1, 'das erste Objekt ist leer, das Neubau-Objekt bekommt 2026 die 1')
  } finally {
    s.stop()
  }
})
