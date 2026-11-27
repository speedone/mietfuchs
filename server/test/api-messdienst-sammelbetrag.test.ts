// Integrationstests gegen den echten Server: Sammelbetrag des Messdienstes (#704). Der Haken `includesWater` an einer
// Position „Heizung und Warmwasser“ mit Einzelbeträgen und die Antwort `serviceEnclosed` der Karte „CO₂-Kosten“:
// speichern und lesen, Geraderücken bei anderer Kostenart oder anderem Schlüssel, Backup und Wiederherstellen,
// Abschluss (eingefrorene Bezeichnung und Verweis), Export und die Kette der Migrationen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CostItem, HeatingPeriodView, HeatingPlant, Settlement, Tenancy, Unit } from '../../shared/types.ts'
import { applyMigrations, loadMigrations } from '../src/db/client.ts'
import { type Server, errorFrom, jsonOf, restore, startServer } from '../testing/api.ts'
import { migrateUpTo } from '../testing/migrateUpTo.ts'
import type { SettlementExport } from '../src/settlementExport.ts'

const jsonPost = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const jsonPut = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) })
const HEATING = 'Heizung und Warmwasser'
const LABEL = 'Heizung und Warmwasser einschließlich Kaltwasser und Abwasser (laut Abrechnung des Messdienstes)'

type Stock = { unit: Unit; mieter: Tenancy; plant: HeatingPlant; pos: CostItem; send: (url: string, init: RequestInit) => Promise<Response> }

// Ein Haus mit einer Wohnung, einer Heizanlage beim Messdienst und dem Sammelbetrag als Position mit Haken.
async function withStock(fn: (s: Server, stock: Stock) => Promise<void>): Promise<void> {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const mieter = await s.api<Tenancy>('/api/tenancies', jsonPost({
      unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 15000 }], prepaymentOverrides: {}, baseRents: [],
    }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'service' })))
    const pos = await s.api<CostItem>('/api/costItems', jsonPost({
      period: '2025-01', category: HEATING, description: 'Abrechnung des Messdienstes', amountCents: 182340, key: 'amounts', tenancyAmounts: { [mieter.id]: 182340 }, includesWater: true,
    }))
    await fn(s, { unit, mieter, plant, pos, send })
  } finally {
    s.stop()
  }
}

test('Haken: wird gespeichert und gelesen; ohne Angabe im Rumpf bleibt er, ausdrücklich false nimmt ihn weg', async () => {
  await withStock(async (s, { pos, plant }) => {
    assert.equal(pos.includesWater, true)
    const [gelesen] = await s.api<CostItem[]>('/api/costItems')
    assert.equal(gelesen?.includesWater, true)
    // Die Karte „CO₂-Kosten“ erfährt es an den Positionen der Heizperiode.
    const [view] = await s.api<HeatingPeriodView[]>(`/api/heating-plants/${plant.id}/periods?period=2025`)
    assert.deepEqual(view?.items.map((i) => [i.id, i.includesWater]), [[pos.id, true]])
    // Ein Teilrumpf ohne das Feld (älterer Tab) lässt die Angabe stehen.
    const teil = await s.api<CostItem>(`/api/costItems/${pos.id}`, jsonPut({ description: 'Messdienst 2025' }))
    assert.equal(teil.includesWater, true)
    const ohne = await s.api<CostItem>(`/api/costItems/${pos.id}`, jsonPut({ includesWater: false }))
    assert.ok(!('includesWater' in ohne), 'ohne Haken fehlt das Feld, wie bei jeder Position von vorher')
    const [danach] = await s.api<CostItem[]>('/api/costItems')
    assert.ok(danach && !('includesWater' in danach))
  })
})

test('Haken: nur bei „Heizung und Warmwasser“ mit Einzelbeträgen; sonst fällt er beim Speichern weg', async () => {
  await withStock(async (s, { pos, mieter }) => {
    // Andere Kostenart mit Einzelbeträgen.
    const wasser = await s.api<CostItem>('/api/costItems', jsonPost({
      period: '2025-01', category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 5000, key: 'amounts', tenancyAmounts: { [mieter.id]: 5000 }, includesWater: true,
    }))
    assert.ok(!('includesWater' in wasser))
    // Dieselbe Kostenart mit anderem Schlüssel.
    const flaeche = await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: HEATING, description: 'Wartung', amountCents: 5000, key: 'area', includesWater: true }))
    assert.ok(!('includesWater' in flaeche))
    // Wechselt der Schlüssel der Position mit Haken, fällt er weg und kommt mit dem Schlüssel nicht von selbst zurück.
    const umgestellt = await s.api<CostItem>(`/api/costItems/${pos.id}`, jsonPut({ key: 'area', tenancyAmounts: null }))
    assert.ok(!('includesWater' in umgestellt))
    const zurueck = await s.api<CostItem>(`/api/costItems/${pos.id}`, jsonPut({ key: 'amounts', tenancyAmounts: { [mieter.id]: 182340 } }))
    assert.ok(!('includesWater' in zurueck))
    assert.deepEqual((await s.api<CostItem[]>('/api/costItems')).filter((c) => c.includesWater === true), [])
  })
})

test('Neue Antwort: speichern ohne weitere Angaben, lesen, vorhandene Werte bleiben, nur beim Messdienst', async () => {
  await withStock(async (s, { plant, send }) => {
    const url = `/api/heating-plants/${plant.id}/periods/2025-01/co2`
    // Erst eine der bisherigen Antworten mit Werten, dann die neue: Die Werte bleiben gespeichert.
    assert.equal((await send(url, jsonPut({ method: 'serviceDeducted', serviceUsersTotalCents: 150000, serviceLandlordCents: 500, serviceUnitsCount: 1 }))).status, 200)
    const gewechselt = await send(url, jsonPut({ method: 'serviceEnclosed' }))
    assert.equal(gewechselt.status, 200)
    const [view] = await s.api<HeatingPeriodView[]>(`/api/heating-plants/${plant.id}/periods?period=2025`)
    assert.deepEqual([view?.co2?.method, view?.co2?.serviceUsersTotalCents, view?.co2?.serviceLandlordCents, view?.co2?.serviceUnitsCount], ['serviceEnclosed', 150000, 500, 1])
    // Ohne jede Zahl: Entfernen und neu anlegen nur mit der Antwort.
    assert.equal((await send(url, { method: 'DELETE' })).status, 200)
    const neu = await send(url, jsonPut({ method: 'serviceEnclosed' }))
    assert.equal(neu.status, 200, await neu.clone().text())
    const r = await s.api<Settlement>('/api/settlement/2025-01')
    assert.deepEqual((r.notices ?? []).filter((n) => n.code.startsWith('co2.')).map((n) => [n.code, n.level]), [['co2.service-enclosed', 'hint']])
    assert.deepEqual([r.heating?.[0]?.co2?.method, r.heating?.[0]?.co2?.booked], ['serviceEnclosed', false])
  })
  // Bei freien Schlüsseln gibt es die Antwort nicht.
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    const res = await send(`/api/heating-plants/${plant.id}/periods/2025-01/co2`, jsonPut({ method: 'serviceEnclosed' }))
    assert.equal(res.status, 400)
    assert.ok((await errorFrom(res)).length > 0)
  } finally {
    s.stop()
  }
})

test('Backup und Wiederherstellen: Haken und neue Antwort kommen zurück', async () => {
  await withStock(async (s, { plant, pos, send }) => {
    const url = `/api/heating-plants/${plant.id}/periods/2025-01/co2`
    assert.equal((await send(url, jsonPut({ method: 'serviceEnclosed' }))).status, 200)
    const vorher = await s.api<Settlement>('/api/settlement/2025-01')
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    await s.api(`/api/costItems/${pos.id}`, jsonPut({ includesWater: false }))
    assert.equal((await send(url, { method: 'DELETE' })).status, 200)
    assert.equal((await restore(s, backup)).status, 200)
    const [item] = await s.api<CostItem[]>('/api/costItems')
    assert.equal(item?.includesWater, true)
    const [view] = await s.api<HeatingPeriodView[]>(`/api/heating-plants/${plant.id}/periods?period=2025`)
    assert.equal(view?.co2?.method, 'serviceEnclosed')
    assert.deepEqual(await s.api<Settlement>('/api/settlement/2025-01'), vorher)
  })
})

test('Abschluss und Export: der Stand friert Kennzeichen und Verweis ein; der Export nennt die Zeile mit Zusatz', async () => {
  await withStock(async (s, { plant, pos, mieter, send }) => {
    assert.equal((await send(`/api/heating-plants/${plant.id}/periods/2025-01/co2`, jsonPut({ method: 'serviceEnclosed' }))).status, 200)
    const offen = await s.api<Settlement>('/api/settlement/2025-01')
    const zeile = offen.statements[0]?.rows.find((r) => r.costItemId === pos.id) ?? assert.fail('keine Zeile')
    assert.deepEqual([zeile.category, zeile.includesWater], [HEATING, true])
    assert.deepEqual(offen.heating?.[0]?.co2?.enclosedFor, [mieter.id])
    // Export der offenen Abrechnung: die Kostenart bleibt der Datenwert, das Kennzeichen steht daneben; die CSV nennt den Zusatz.
    const json = await jsonOf<SettlementExport>(await fetch(`${s.base}/api/settlement/2025-01/export?format=json`))
    const exportRow = json.statements[0]?.rows.find((r) => r.costItemId === pos.id) ?? assert.fail('keine Zeile im Export')
    assert.deepEqual([exportRow.category, exportRow.includesWater], [HEATING, true])
    assert.equal(json.heating[0]?.co2?.method, 'serviceEnclosed')
    const csv = await (await fetch(`${s.base}/api/settlement/2025-01/export?format=csv`)).text()
    assert.ok(csv.includes(LABEL), csv)
    // Abschließen; der Zeitraum 2025 ist zu Ende, sobald der Test läuft.
    const closed = await send('/api/settlement/2025-01/close', jsonPost({}))
    assert.equal(closed.status, 201, await closed.clone().text())
    const eingefroren = await s.api<Settlement>('/api/settlement/2025-01')
    assert.ok(eingefroren.closed)
    assert.equal(eingefroren.statements[0]?.rows.find((r) => r.costItemId === pos.id)?.includesWater, true)
    assert.equal(eingefroren.heating?.[0]?.co2?.method, 'serviceEnclosed')
    assert.deepEqual(eingefroren.heating?.[0]?.co2?.enclosedFor, [mieter.id])
    const csvClosed = await (await fetch(`${s.base}/api/settlement/2025-01/export?format=csv`)).text()
    assert.ok(csvClosed.includes(LABEL))
  })
})

test('Doppelerfassung über die Routen: Warnung an der Wasserposition, nicht mehr als „Nicht umlagefähig“', async () => {
  await withStock(async (s) => {
    const wasser = await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Wasser/Abwasser', description: 'Stadtwerke', amountCents: 64000, key: 'persons' }))
    const r = await s.api<Settlement>('/api/settlement/2025-01')
    assert.deepEqual((r.notices ?? []).filter((n) => n.code === 'amounts.water-twice').map((n) => [n.level, n.subject?.id]), [['warning', wasser.id]])
    await s.api(`/api/costItems/${wasser.id}`, jsonPut({ category: 'Nicht umlagefähig' }))
    const danach = await s.api<Settlement>('/api/settlement/2025-01')
    assert.ok(!(danach.notices ?? []).some((n) => n.code === 'amounts.water-twice'))
  })
})

test('Migration 0108: ein Bestand von vorher behält CO₂-Angaben samt Beträgen je Mieter; die neue Antwort und die Spalte gibt es danach', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-sammelbetrag-'))
  try {
    const connection = await migrateUpTo(dir, '0108_messdienst_sammelbetrag')
    try {
      const row = (sql: string): unknown[] => connection.rows(sql)[0] ?? assert.fail(`keine Zeile: ${sql}`)
      const propertyId = String(row('SELECT id FROM properties')[0])
      connection.exec(`INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u', '${propertyId}', 'EG', 80, 1)`)
      connection.exec(`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t', 'u', 'Mieter', 1, '2020-01-01')`)
      connection.exec(`INSERT INTO heating_plants (id, property_id, energy, method, source) VALUES ('hp', '${propertyId}', 'gas', 'service', 'building')`)
      connection.exec(`INSERT INTO heating_periods (id, plant_id, period) VALUES ('h', 'hp', '2025-01')`)
      connection.exec(`INSERT INTO co2_statements (heating_period_id, method, service_users_total_cents, service_landlord_cents, service_units_count) VALUES ('h', 'serviceShown', 100000, 500, 1)`)
      connection.exec(`INSERT INTO co2_tenant_reliefs (statement_id, tenancy_id, cents) VALUES ('h', 't', 480)`)
      assert.throws(() => connection.exec(`UPDATE co2_statements SET method = 'serviceEnclosed' WHERE heating_period_id = 'h'`), /CHECK/, 'vor dem Schritt kennt die Bedingung die Antwort nicht')
      applyMigrations(connection, await loadMigrations())
      assert.deepEqual(row('SELECT method, service_users_total_cents, service_landlord_cents, service_units_count FROM co2_statements'), ['serviceShown', 100000, 500, 1])
      assert.deepEqual(row('SELECT statement_id, tenancy_id, cents FROM co2_tenant_reliefs'), ['h', 't', 480])
      connection.exec(`UPDATE co2_statements SET method = 'serviceEnclosed' WHERE heating_period_id = 'h'`)
      assert.throws(() => connection.exec(`UPDATE co2_statements SET method = 'irgendwas' WHERE heating_period_id = 'h'`), /CHECK/)
      // Der Fremdschlüssel der Beträge je Mieter zeigt weiter auf die neu gebaute Tabelle.
      connection.exec(`DELETE FROM co2_statements WHERE heating_period_id = 'h'`)
      assert.deepEqual(row('SELECT count(*) FROM co2_tenant_reliefs'), [0])
      assert.deepEqual(row(`SELECT count(*) FROM pragma_table_info('cost_items') WHERE name = 'includes_water'`), [1])
    } finally {
      connection.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
