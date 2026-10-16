// Integrationstests gegen den echten Server: Heizung: Anlage, CO₂, Lieferungen, Vorrat, Kesseltausch, Rechtswerte, Betriebsstrom.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { tenancyStamp } from '../../shared/tenancyStamp.ts'
import type {
  AssignableHeatingItem, Co2Statement, DegreeDayValue, FuelDelivery, FuelGapQuestion, Notice, HeatingDistribution, HeatingEstimate, HeatingPeriodView, HeatingPlant, InterimGap, LawOverrideSlot, MonthlyInfoRow, MonthlyInfoView, Co2Sheet, CostItem, Meter, Property, Settlement, StockView, Tenancy, Unit,
} from '../../shared/types.ts'
import { withoutCo2 } from '../testing/co2.ts'
import {
  type Server, errorFrom, jsonOf, removeDataDir, startServer, startServerIn, startServerRaw, until, waitForExit, wechsel, withProperties,
} from '../testing/api.ts'

// ---------- Heizanlage (Heizung PR 4) ----------

// Ein POST-Rumpf als Anfrage; `postJson` weiter oben schickt schon ab und gibt die Antwort.
const jsonPost = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

test('Heizanlage: anlegen samt Zuordnung offener Heizpositionen, und die Abrechnung bleibt gleich', async () => {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    await s.api('/api/tenancies', jsonPost({
      unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 2 }], start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 10000 }], prepaymentOverrides: {}, baseRents: [],
    }))
    const heizung = await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 120000, key: 'area' }))
    const vorher = await s.api<Settlement>('/api/settlement/2025-01')
    assert.deepEqual((await s.api<AssignableHeatingItem[]>('/api/heating-plants/assignable')).map((i) => i.id), [heizung.id])
    const res = await fetch(`${s.base}/api/heating-plants`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ energy: 'gas', method: 'service', assignItemIds: [heizung.id] }),
    })
    assert.equal(res.status, 201)
    const { plant, assigned } = await jsonOf<{ plant: HeatingPlant; assigned: number }>(res)
    assert.equal(assigned, 1)
    assert.deepEqual(await s.api<HeatingPlant[]>('/api/heating-plants'), [plant])
    const [gespeichert] = await s.api<CostItem[]>('/api/costItems')
    assert.equal(gespeichert?.heatingPlantId, plant.id)
    // Entwurf 11.2: Das Anlegen ändert keine Zahl und keinen Hinweis.
    assert.deepEqual(withoutCo2(await s.api<Settlement>('/api/settlement/2025-01')), withoutCo2(vorher))
  } finally {
    s.stop()
  }
})

test('Heizanlage: Sperren, Objektgrenze, Ändern und Entfernen über die Routen', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const selbst = await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'self' }))
    assert.equal(selbst.status, 400)
    assert.match(await errorFrom(selbst), /eigene Heizkostenabrechnung/)
    const angelegt = await send('/api/heating-plants', jsonPost({ energy: 'districtHeating', method: 'manual' }))
    assert.equal(angelegt.status, 201)
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(angelegt)
    // Heizung PR 9: Eine zweite Anlage fragt nach dem Gebäude und braucht Namen und Wohnungen, die erste ebenso.
    const zweite = await send('/api/heating-plants', jsonPost({ energy: 'gas' }))
    assert.equal(zweite.status, 400)
    assert.match(await errorFrom(zweite), /im selben Gebäude/)
    const ohneNamen = await send('/api/heating-plants', jsonPost({ energy: 'gas', buildingWith: 'own' }))
    assert.equal(ohneNamen.status, 400)
    assert.match(await errorFrom(ohneNamen), /braucht jede einen Namen/)

    const objekt2 = await s.api<Property>('/api/properties', jsonPost({ name: 'Zweites Haus', kind: 'mfh', address: '' }))
    const fremd = await send(`/api/meters?property=${objekt2.id}`, jsonPost({ name: 'Gas', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: plant.id, heatingRole: 'supply' }))
    assert.equal(fremd.status, 400)
    assert.match(await errorFrom(fremd), /Heizanlage aber zu/)

    const geaendert = await send(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ devicesRemote: 'all' }) })
    assert.equal(geaendert.status, 200)
    assert.equal((await jsonOf<HeatingPlant>(geaendert)).devicesRemote, 'all')
    assert.equal((await send('/api/heating-plants/gibt-es-nicht', { method: 'PUT', body: '{}' })).status, 404)

    const zaehler = await send(`/api/meters?property=${plant.propertyId}`, jsonPost({ name: 'Fernwärme', unitId: null, type: 'waerme', unit: 'kWh', heatingPlantId: plant.id, heatingRole: 'supply' }))
    assert.equal(zaehler.status, 201)
    const blockiert = await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })
    assert.equal(blockiert.status, 409)
    assert.match(await errorFrom(blockiert), /„Fernwärme“/)
    await send(`/api/meters/${(await jsonOf<Meter>(zaehler)).id}`, { method: 'DELETE' })
    const weg = await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })
    assert.equal(weg.status, 200)
    assert.deepEqual(await jsonOf<{ ok: boolean; released: number; notice: string | null }>(weg), { ok: true, released: 0, notice: null })
    assert.equal((await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })).status, 404)
  } finally {
    s.stop()
  }
})

test('Heizanlage: eine angeschlossene Wohnung wechselt nicht still das Objekt (Durchsicht von #230)', async () => {
  // Sonst stünde sie in der Liste einer Anlage des alten Objekts, und das eigene Backup würde beim
  // Einspielen abgelehnt.
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'G', areaM2: 50, participates: true }))
    const angelegt = await send('/api/heating-plants', jsonPost({ energy: 'gas', units: [{ unitId: unit.id, heatedAreaM2: null }] }))
    assert.equal(angelegt.status, 201)
    const objekt2 = await s.api<Property>('/api/properties', jsonPost({ name: 'Zweites Haus', kind: 'mfh', address: '' }))
    const wechsel = await send(`/api/units/${unit.id}`, { method: 'PUT', body: JSON.stringify({ propertyId: objekt2.id }) })
    assert.equal(wechsel.status, 400)
    assert.match(await errorFrom(wechsel), /Heizanlage/)
    const archiv = await fetch(`${s.base}/api/backup`)
    const fd = new FormData()
    fd.append('file', new Blob([await archiv.arrayBuffer()], { type: 'application/zip' }), 'backup.zip')
    assert.equal((await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })).status, 200, 'das eigene Backup lässt sich einspielen')
  } finally {
    s.stop()
  }
})

test('Zeitraum der Heizung (Heizung PR 5): Vorschau und Wechsel über HTTP, PUT der Anlage setzt ihn nicht', async () => {
  const s = await startServer()
  try {
    const send = (url: string, method: string, body: unknown) =>
      fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    const position = await s.api<CostItem>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2026-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 100000, key: 'amounts' }) })
    const vorschau = await jsonOf<{ moves: { to: string }[]; token: string }>(await send(`/api/heating-plants/${plant.id}/period/preview`, 'POST', { rules: { startMonth: 5, changes: [] } }))
    assert.deepEqual(vorschau.moves.map((m) => m.to), ['2025-05'])
    const per = await send(`/api/heating-plants/${plant.id}`, 'PUT', { periodStartMonth: 5 })
    assert.equal(per.status, 400)
    const ok = await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules: { startMonth: 5, changes: [] }, answers: { understood: true, token: vorschau.token } })
    assert.equal(ok.status, 200)
    assert.equal((await jsonOf<HeatingPlant>(ok)).periodStartMonth, 5)
    assert.equal((await s.api<CostItem[]>('/api/costItems')).find((c) => c.id === position.id)?.period, '2025-05')
    assert.equal((await send(`/api/heating-plants/${plant.id}/period/preview`, 'POST', { rules: { startMonth: 13, changes: [] } })).status, 400)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/period/preview', 'POST', { rules: null })).status, 404)
  } finally {
    s.stop()
  }
})

test('Getrennte Heizkostenabrechnung (Heizung PR 5): Vorschau und Einschalten über HTTP, 409 ohne Antworten', async () => {
  const s = await startServer()
  try {
    const send = (url: string, method: string, body: unknown) =>
      fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const mieter = await s.api<{ id: string }>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    const zeitraum = await jsonOf<{ token: string }>(await send(`/api/heating-plants/${plant.id}/period/preview`, 'POST', { rules: { startMonth: 5, changes: [] } }))
    await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules: { startMonth: 5, changes: [] }, answers: { understood: true, token: zeitraum.token } })
    const vorschau = await jsonOf<{ way: string; token: string; steps: { rows: { from: string }[] }[] }>(await send(`/api/heating-plants/${plant.id}/separate/preview`, 'POST', { separate: true, month: '2025-05' }))
    assert.deepEqual([vorschau.way, vorschau.steps[0]?.rows.map((r) => r.from)], ['separate', ['2025-05']])
    assert.equal((await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-05' })).status, 409)
    const ok = await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-05', answers: { understood: true, steps: { [mieter.id]: { '2025-05': 12300 } }, token: vorschau.token } })
    assert.equal(ok.status, 200)
    assert.deepEqual((await jsonOf<HeatingPlant>(ok)).separateSpans, [{ from: '2025-05', until: null }])
    assert.equal((await send(`/api/heating-plants/${plant.id}/separate/preview`, 'POST', { separate: 'ja' })).status, 400)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/separate/preview', 'POST', { separate: true })).status, 404)
  } finally {
    s.stop()
  }
})

test('Heizkostenabrechnung (Heizung PR 5): rechnen, eigene Frist, abschließen; der Abschluss von P friert sie nicht ein', async () => {
  const s = await startServer()
  try {
    const send = (url: string, method: string, body?: unknown) =>
      fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const mieter = await s.api<{ id: string }>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    const marke = async (url: string, body: unknown) => (await jsonOf<{ token: string }>(await send(url, 'POST', body))).token
    const regeln = { startMonth: 5, changes: [] }
    await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules: regeln, answers: { understood: true, token: await marke(`/api/heating-plants/${plant.id}/period/preview`, { rules: regeln }) } })
    const getrennt = { separate: true, month: '2025-05' }
    const ein = await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { ...getrennt, answers: { understood: true, steps: { [mieter.id]: { '2025-05': 12300 } }, token: await marke(`/api/heating-plants/${plant.id}/separate/preview`, getrennt) } })
    assert.equal(ein.status, 200)
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-05', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 150000, key: 'area', heatingPlantId: plant.id, taxYear: 2026 }) })
    const url = `/api/heating-settlement/${plant.id}/2025-05`
    const h = await s.api<Settlement>(url)
    assert.deepEqual([h.deadline, h.scope?.kind, h.statements[0]?.scope, h.statements[0]?.prepaymentCents, h.closed], ['2027-04-30', 'heating', 'heating', 147600, null])
    const liste = await s.api<{ period: { key: string }; deadline: string; closed: unknown }[]>('/api/heating-settlements')
    // Die Liste reicht bis zur Heizperiode, die heute läuft; geprüft werden die ersten beiden.
    assert.deepEqual(liste.slice(0, 2).map((x) => [x.period.key, x.deadline, x.closed]), [['2025-05', '2027-04-30', null], ['2026-05', '2028-04-30', null]])
    const nichtGetrennt = await send(`/api/heating-settlement/${plant.id}/2024-05`, 'GET')
    assert.equal(nichtGetrennt.status, 404)
    assert.match(await errorFrom(nichtGetrennt), /stehen in der Betriebskostenabrechnung 2025/)
    // B3: Der Abschluss von P 2026 friert die Heizkostenabrechnung nicht ein.
    assert.equal((await send('/api/settlement/2026/close', 'POST', {})).status, 201)
    assert.equal((await s.api<Settlement>(url)).closed, null)
    assert.equal((await send(`${url}/close`, 'POST', {})).status, 201)
    assert.equal((await send(`${url}/close`, 'POST', {})).status, 409)
    assert.equal((await send(`${url}/close`, 'PUT', { sentAt: '2027-03-01' })).status, 200)
    assert.deepEqual((await s.api<Settlement>(url)).closed?.sentAt, '2027-03-01')
    assert.equal((await send(`/api/heating-plants/${plant.id}`, 'DELETE')).status, 409)
    assert.equal((await send(`${url}/close`, 'DELETE')).status, 200)
    assert.equal((await s.api<unknown[]>(`${url}/history`)).length, 1)
  } finally {
    s.stop()
  }
})

// ---------- CO₂-Angaben (Heizung PR 6) ----------

test('CO₂-Angaben über die Routen: speichern, lesen, entfernen, Sperren und 404', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const mieter = await s.api<Tenancy>('/api/tenancies', jsonPost({
      unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
      prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'service' })))
    await s.api<CostItem>('/api/costItems', jsonPost({
      period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { [mieter.id]: 100000 },
    }))
    const base = `/api/heating-plants/${plant.id}/periods`
    const gespeichert = await send(`${base}/2025-01/co2`, { method: 'PUT', body: JSON.stringify({ method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 1 }) })
    assert.equal(gespeichert.status, 200)
    assert.equal((await jsonOf<Co2Statement>(gespeichert)).serviceLandlordCents, 500)
    const [view] = await s.api<HeatingPeriodView[]>(`${base}?period=2025`)
    assert.deepEqual([view?.period, view?.co2?.method, view?.items.length], ['2025-01', 'serviceDeducted', 1])
    const selbst = await send(`${base}/2025-01/co2`, { method: 'PUT', body: JSON.stringify({ method: 'self' }) })
    assert.equal(selbst.status, 400)
    assert.match(await errorFrom(selbst), /Frage nach der Abzugszeile/)
    const wasser = await send(`${base}/2025-01/hot-water`, { method: 'PUT', body: JSON.stringify({ dhwMethod: 'areaFormula' }) })
    assert.deepEqual(await jsonOf<unknown>(wasser), { dhwMethod: 'areaFormula', dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null })
    const blockiert = await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })
    assert.equal(blockiert.status, 409)
    assert.match(await errorFrom(blockiert), /CO₂-Angaben erfasst/)
    assert.deepEqual(await jsonOf<unknown>(await send(`${base}/2025-01/co2`, { method: 'DELETE' })), { ok: true, removed: true })
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods?period=2025', { method: 'GET' })).status, 404)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods/2025-01/co2', { method: 'PUT', body: '{}' })).status, 404)
  } finally {
    s.stop()
  }
})

test('Warmwasser (Heizung PR 11): PUT nimmt bei eigener Abrechnung Volumen und Temperatur, GET der Heizperioden zeigt sie', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    const setup = await send(`/api/heating-plants/${plant.id}/self`, { method: 'PUT', body: JSON.stringify({
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: false, totalHeatMeter: false,
    }) })
    assert.equal(setup.status, 200, await setup.clone().text())
    const base = `/api/heating-plants/${plant.id}/periods`
    const put = await send(`${base}/2025-01/hot-water`, { method: 'PUT', body: JSON.stringify({ dhwMethod: 'volumeFormula', dhwVolumeM3: 120, dhwTempC: 60 }) })
    assert.equal(put.status, 200)
    const saved = await jsonOf<HeatingPeriodView['hotWater']>(put)
    assert.deepEqual([saved.dhwMethod, saved.dhwVolumeM3, saved.dhwTempC], ['volumeFormula', 120, 60])
    const [view] = await s.api<HeatingPeriodView[]>(`${base}?period=2025`)
    assert.deepEqual([view?.hotWater.dhwTempC, view?.hotWaterBasis.suppliedAreaM2], [60, 80])
    const falsch = await send(`${base}/2025-01/hot-water`, { method: 'PUT', body: JSON.stringify({ dhwMethod: 'volumeFormula', dhwTempC: 150 }) })
    assert.equal(falsch.status, 400)
    // Die Antwort zum Erzeuger gehört zur Anlage.
    const erzeuger = await send(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ heatGeneration: 'single' }) })
    assert.equal(erzeuger.status, 200)
    assert.equal((await jsonOf<HeatingPlant>(erzeuger)).heatGeneration, 'single')
  } finally {
    s.stop()
  }
})

test('Abrechnung mit CO₂ über die Routen: ohne Angaben co2.missing, mit Vorwegabzug co2Share (Heizung PR 6)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const mieter = await s.api<Tenancy>('/api/tenancies', jsonPost({
      unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null,
      prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'service' })))
    const pos = await s.api<CostItem>('/api/costItems', jsonPost({
      period: '2025-01', category: 'Heizung und Warmwasser', description: 'Messdienst', amountCents: 100500, key: 'amounts', tenancyAmounts: { [mieter.id]: 100000 },
    }))
    const ohne = await s.api<Settlement>('/api/settlement/2025-01')
    assert.equal(ohne.notices?.find((n) => n.code === 'co2.missing')?.subject?.id, plant.id)
    await send(`/api/heating-plants/${plant.id}/periods/2025-01/co2`, { method: 'PUT', body: JSON.stringify({ method: 'serviceDeducted', serviceUsersTotalCents: 100000, serviceLandlordCents: 500, serviceUnitsCount: 1 }) })
    const mit = await s.api<Settlement>('/api/settlement/2025-01')
    assert.ok(!mit.notices?.some((n) => n.code === 'co2.missing'))
    assert.deepEqual(mit.landlord.rows.find((r) => r.costItemId === pos.id)?.landlordParts, [{ reason: 'co2Share', cents: 500 }])
    assert.equal(mit.heating?.[0]?.co2?.booked, true)
  } finally {
    s.stop()
  }
})

// Laienprobe B1 über die Route: Die Marke eines älteren Stands ergibt 409 mit Satz, nicht 500, und
// gespeichert wird nichts.
test('Laienprobe B1: PUT mit veralteter Marke antwortet 409 und ändert nichts', async () => {
  await withProperties(async (s) => {
    const u = await s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    const t = await s.api<Tenancy>('/api/tenancies?property=objekt-1', { method: 'POST', body: JSON.stringify({
      unitId: u.id, tenantName: 'Beispiel', persons: 1, personHistory: [], start: '2025-01-01', end: null,
      prepayments: [{ from: '2025-01', monthlyCents: 25000 }], prepaymentOverrides: {}, baseRents: [],
    }) })
    const alt = tenancyStamp(t)
    await s.api(`/api/tenancies/${t.id}`, { method: 'PUT', body: JSON.stringify({ prepayments: [{ from: '2025-01', monthlyCents: 3500 }], heatingPrepayments: [{ from: '2025-01', monthlyCents: 21500 }] }) })
    const r = await fetch(`${s.base}/api/tenancies/${t.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prepayments: [{ from: '2025-01', monthlyCents: 25000 }], heatingPrepayments: [], ifUnchanged: alt }),
    })
    assert.equal(r.status, 409)
    assert.match((await jsonOf<{ error: string }>(r)).error, /inzwischen an anderer Stelle geändert/)
    const jetzt = (await s.api<Tenancy[]>('/api/tenancies?property=objekt-1')).find((x) => x.id === t.id) ?? assert.fail('weg')
    assert.deepEqual(jetzt.heatingPrepayments, [{ from: '2025-01', monthlyCents: 21500 }])
  })
})

// Review der Laienprobe, Runde 2: Die Prüfbestände mit festen Jahren kippen nicht, wenn die Frist der
// Abrechnung 2025 abgelaufen ist (ab 01.01.2027). Mit `understood` geht das Einschalten ab 05/2025 auch
// dann durch; ohne sagt der Server, welche Frist abgelaufen ist.
test('Review Runde 2: Weg d ab 05/2025 am 02.01.2027: ohne Bestätigung 409 mit Frist, mit Bestätigung 200', async () => {
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), { NKA_TEST_TODAY: '2027-01-02' })
  try {
    const send = (url: string, method: string, body: unknown) =>
      fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const mieter = await s.api<{ id: string }>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'A', persons: 1, start: '2024-01-01', prepayments: [{ from: '2024-01', monthlyCents: 30000 }] }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', 'POST', { energy: 'gas', method: 'service' }))
    const zeitraum = await jsonOf<{ token: string }>(await send(`/api/heating-plants/${plant.id}/period/preview`, 'POST', { rules: { startMonth: 5, changes: [] } }))
    assert.equal((await send(`/api/heating-plants/${plant.id}/period`, 'PUT', { rules: { startMonth: 5, changes: [] }, answers: { understood: true, token: zeitraum.token } })).status, 200)
    const vorschau = await jsonOf<{ token: string }>(await send(`/api/heating-plants/${plant.id}/separate/preview`, 'POST', { separate: true, month: '2025-05' }))
    const answers = { steps: { [mieter.id]: { '2025-05': 12300 } }, token: vorschau.token }
    const ohne = await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-05', answers })
    assert.equal(ohne.status, 409)
    // Gerechnet mit den Antworten: Die Abrechnung 2025 verliert den Heizanteil Mai bis Dezember.
    const antwort = await jsonOf<{ error: string; preview: { effects: { label: string; passed: boolean }[] } }>(ohne)
    assert.match(antwort.error, /Abrechnungsfrist für 2025 ist schon abgelaufen/)
    assert.ok(antwort.preview.effects.some((e) => e.label === '2025' && e.passed))
    assert.equal((await send(`/api/heating-plants/${plant.id}/separate`, 'PUT', { separate: true, month: '2025-05', answers: { ...answers, understood: true } })).status, 200)
  } finally {
    s.stop()
  }
})

// ---------- Lieferungen (Heizung PR 7) ----------

test('Lieferungen über die Routen: anlegen, lesen, ändern, Sperre, entfernen; Ortswerte', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    const angelegt = await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({ label: 'Gas', invoiceFrom: '2025-03-15', invoiceTo: '2026-03-14', emissionsKg: 5406.17 }))
    assert.equal(angelegt.status, 201)
    const d = await jsonOf<FuelDelivery>(angelegt)
    assert.deepEqual((await s.api<FuelDelivery[]>(`/api/heating-plants/${plant.id}/deliveries`)).map((x) => x.id), [d.id])
    const geaendert = await send(`/api/fuel-deliveries/${d.id}`, { method: 'PUT', body: JSON.stringify({ fixedCents: 12000 }) })
    assert.equal((await jsonOf<FuelDelivery>(geaendert)).fixedCents, 12000)
    const etage = await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({ label: 'x', unitId: 'egal', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31' }))
    assert.equal(etage.status, 400)
    // Heizung PR 9: Eine zentrale Anlage nimmt keine Rechnung mit Wohnung.
    assert.match(await errorFrom(etage), /zentralen Heizanlage gehört zu keiner einzelnen Wohnung/)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/deliveries', { method: 'GET' })).status, 404)
    assert.equal((await send('/api/fuel-deliveries/gibt-es-nicht', { method: 'PUT', body: '{}' })).status, 404)
    const blockiert = await send(`/api/heating-plants/${plant.id}`, { method: 'DELETE' })
    assert.equal(blockiert.status, 409)
    assert.match(await errorFrom(blockiert), /Lieferung/)
    assert.deepEqual(await jsonOf<unknown>(await send(`/api/fuel-deliveries/${d.id}`, { method: 'DELETE' })), { ok: true })
    assert.equal((await send(`/api/fuel-deliveries/${d.id}`, { method: 'DELETE' })).status, 404)
    const ortswerte = await send(`/api/properties/${plant.propertyId}/degree-days`, { method: 'PUT', body: JSON.stringify({ values: [{ month: '2025-01', value: 412.5 }] }) })
    assert.deepEqual(await jsonOf<DegreeDayValue[]>(ortswerte), [{ month: '2025-01', value: 412.5 }])
    assert.deepEqual(await s.api<DegreeDayValue[]>(`/api/properties/${plant.propertyId}/degree-days`), [{ month: '2025-01', value: 412.5 }])
    assert.equal((await send('/api/properties/gibt-es-nicht/degree-days', { method: 'GET' })).status, 404)
  } finally {
    s.stop()
  }
})

test('#251 5d: Gutschrift ohne Rechnung über die Route zuordnen und als eigenständig bestätigen', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    const d0 = await jsonOf<FuelDelivery>(await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({ label: 'Gas 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31' })))
    const d1 = await jsonOf<FuelDelivery>(await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({ label: 'Gutschrift', invoiceFrom: '2025-06-01', invoiceTo: '2026-03-31' })))
    const position = (period: string, fuelDeliveryId: string, amountCents: number) =>
      s.api<CostItem>('/api/costItems', jsonPost({ period, category: 'Heizung und Warmwasser', description: 'Gas', amountCents, key: 'area', heatingPlantId: plant.id, fuelDeliveryId }))
    await position('2025-01', d0.id, 617603)
    const gut = await position('2026-01', d1.id, -30451)
    const bestaetigt = await send(`/api/fuel-deliveries/${d1.id}`, { method: 'PUT', body: JSON.stringify({ creditNoteKind: 'standalone' }) })
    assert.equal((await jsonOf<FuelDelivery>(bestaetigt)).creditNoteKind, 'standalone')
    const ohneZiel = await send(`/api/fuel-deliveries/${d1.id}/reassign-credit`, jsonPost({}))
    assert.equal(ohneZiel.status, 400)
    assert.match(await errorFrom(ohneZiel), /Bitte wählen Sie die Lieferung, die die Gutschrift „Gutschrift“ berichtigt/)
    assert.equal((await send('/api/fuel-deliveries/gibt-es-nicht/reassign-credit', jsonPost({ targetId: d0.id }))).status, 404)
    const r = await send(`/api/fuel-deliveries/${d1.id}/reassign-credit`, jsonPost({ targetId: d0.id }))
    assert.equal(r.status, 200)
    const body = await jsonOf<{ target: FuelDelivery; sourceEmpty: boolean; moved: string[] }>(r)
    assert.deepEqual([body.target.id, body.sourceEmpty, body.moved], [d0.id, true, [gut.id]])
    const items = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(items.filter((c) => c.id === gut.id).map((c) => [c.fuelDeliveryId, c.period]), [[d0.id, '2025-01']])
  } finally {
    s.stop()
  }
})

// Review Runde 3 (N1): Der Testgriff NKA_TEST_TODAY nur mit einem echten Kalenderdatum; sonst bricht
// der Start ab. Ist er gesetzt, sagt es die Konsole.
test('Start: NKA_TEST_TODAY mit ungültigem Datum bricht ab; ein gültiges nennt die Konsole', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heute-'))
  const { child, out } = startServerRaw(dataDir, { NKA_TEST_TODAY: '2027-02-30' })
  try {
    assert.equal(await waitForExit(child), 1, out())
    assert.match(out(), /NKA_TEST_TODAY „2027-02-30“ ist kein Kalenderdatum/)
    assert.doesNotMatch(out(), /läuft auf/)
  } finally {
    child.kill()
    removeDataDir(dataDir)
  }
  const okDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-heute-'))
  const ok = startServerRaw(okDir, { NKA_TEST_TODAY: '2027-01-02' })
  try {
    for (let i = 0; i < 100 && !/Testgriff NKA_TEST_TODAY aktiv/.test(ok.out()); i++) await new Promise((r) => setTimeout(r, 100))
    assert.match(ok.out(), /Testgriff NKA_TEST_TODAY aktiv: Der Server rechnet mit dem 2027-01-02 als heute\./)
  } finally {
    ok.child.kill()
    removeDataDir(okDir)
  }
})

test('Abschluss mit Lücke: Rückfrage (409), Schätzung, Sperre der eingefrorenen Lieferung, Wiederöffnen gibt frei', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    // Die erste Rechnung des Jahres reicht bis Ende Juni; für das zweite Halbjahr fehlt sie.
    const d = await jsonOf<FuelDelivery>(await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({ label: 'Gas 1. Halbjahr', invoiceFrom: '2025-01-01', invoiceTo: '2025-06-30' })))
    await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 300000, key: 'area', heatingPlantId: plant.id, fuelDeliveryId: d.id }))
    const gefragt = await send('/api/settlement/2025/close', jsonPost({}))
    assert.equal(gefragt.status, 409)
    const body = await jsonOf<{ error: string; fuelGaps: FuelGapQuestion[] }>(gefragt)
    assert.match(body.error, /fehlt eine Rechnung/)
    assert.equal(body.fuelGaps[0]?.deadline, '2026-12-31', 'die Frist der Abrechnung, für die Wahl „Abwarten“')
    assert.deepEqual(body.fuelGaps.map((g) => [g.plantId, g.period, g.from, g.to]), [[plant.id, '2025-01', '2025-07-01', '2025-12-31']])
    assert.ok((body.fuelGaps[0]?.amountCents ?? 0) > 0)
    assert.equal((await send('/api/settlement/2025/close', jsonPost({ fuelEstimates: 'vielleicht' }))).status, 400)
    assert.equal((await send('/api/settlement/2025/close', jsonPost({ fuelEstimates: 'estimate' }))).status, 201)
    const liste = await s.api<FuelDelivery[]>(`/api/heating-plants/${plant.id}/deliveries`)
    const schaetzung = liste.find((x) => x.estimated) ?? assert.fail('keine Schätzung angelegt')
    assert.match(schaetzung.label, /^Schätzung 01\.07\.–31\.12\.2025: [\d,]+ ‰ der Rechnung „Gas 1\. Halbjahr“ nach Gradtagen$/)
    assert.equal(schaetzung.amountCents, body.fuelGaps[0]?.amountCents)
    // Die Schätzung erscheint in der eingefrorenen Abrechnung mit ihrem Vorbehalt.
    const zu = await s.api<{ notices: Notice[] }>('/api/settlement/2025')
    assert.ok(zu.notices.some((n) => n.code === 'fuel.estimated'))
    const gesperrt = await send(`/api/fuel-deliveries/${d.id}`, { method: 'PUT', body: JSON.stringify({ fixedCents: 100 }) })
    assert.equal(gesperrt.status, 409)
    assert.match(await errorFrom(gesperrt), /eingefroren/)
    await s.api('/api/settlement/2025/close', { method: 'DELETE' })
    assert.equal((await send(`/api/fuel-deliveries/${d.id}`, { method: 'PUT', body: JSON.stringify({ fixedCents: 100 }) })).status, 200)
    // Erneut abschließen fragt nicht mehr: Die Schätzung deckt die Lücke.
    assert.equal((await send('/api/settlement/2025/close', jsonPost({}))).status, 201)
  } finally {
    s.stop()
  }
})

// ---------- Vorrat (Heizung PR 8) ----------

test('Vorrat über die Routen: speichern, entfernen, 404 ohne Anlage; Öllieferung mit Lieferdatum und Menge', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'oil', method: 'manual' })))
    const base = `/api/heating-plants/${plant.id}/periods/2025-01/stock`
    const gespeichert = await send(base, { method: 'PUT', body: JSON.stringify({ stockUnit: 'l', openingQuantity: 1000, openingCostCents: 95000, openingEmissionsKg: 2676.3, openingCo2Cents: 0, openingInvoicedBefore2023: true, closingQuantity: 400 }) })
    assert.equal(gespeichert.status, 200)
    assert.equal((await jsonOf<StockView>(gespeichert)).statement?.consumed.costCents, 57000)
    const [ansicht] = await s.api<HeatingPeriodView[]>(`/api/heating-plants/${plant.id}/periods?period=2025`)
    assert.equal(ansicht?.stock?.statement?.consumed.quantity, 600)
    assert.deepEqual(await jsonOf<unknown>(await send(base, { method: 'DELETE' })), { ok: true, removed: true })
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods/2025-01/stock', { method: 'PUT', body: '{}' })).status, 404)
    const ohneDatum = await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({ quantity: 1000, quantityUnit: 'l', emissionsKg: 2676.3, co2CostCents: 17500 }))
    assert.equal(ohneDatum.status, 400)
    assert.match(await errorFrom(ohneDatum), /Lieferdatum/)
    const mitDatum = await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({ deliveredAt: '2025-03-15', quantity: 1000, quantityUnit: 'l', emissionsKg: 2676.3, co2CostCents: 17500 }))
    assert.equal(mitDatum.status, 201)
  } finally {
    s.stop()
  }
})

// ---------- Etagenheizung (Heizung PR 9) ----------

test('Etagenheizung über die Routen: Lieferung nur mit Wohnung der Anlage, zentrale nur ohne; Position und Rechnung derselben Wohnung (Review Focus 5)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const eg = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 60, participates: true }))
    const og = await s.api<Unit>('/api/units', jsonPost({ name: 'OG', areaM2: 40, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ name: 'Gasthermen', energy: 'gas', supply: 'perUnit', method: 'manual' })))
    const lieferung = (body: Record<string, unknown>) => send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({
      label: 'Gas', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', invoiceDate: '2026-01-15', energyKwh: 15000, emissionsKg: 3013, co2CostCents: 16500, ...body,
    }))
    const ohne = await lieferung({})
    assert.equal(ohne.status, 400)
    assert.match(await errorFrom(ohne), /gehört jede Rechnung zu einer Wohnung/)
    const mitEg = await lieferung({ unitId: eg.id })
    assert.equal(mitEg.status, 201)
    const rechnung = await jsonOf<{ id: string }>(mitEg)
    // Die Position der Wohnung OG mit der Rechnung der Wohnung EG: abgelehnt.
    const falsch = await send('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas OG', amountCents: 150000, key: 'direct', directUnitId: og.id, heatingPlantId: plant.id, fuelDeliveryId: rechnung.id }))
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /gehört zu einer anderen Wohnung/)
    // Nicht direkt einer Wohnung zugeordnet: abgelehnt.
    const flaeche = await send('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 150000, key: 'area', heatingPlantId: plant.id }))
    assert.equal(flaeche.status, 400)
    assert.match(await errorFrom(flaeche), /genau einer Wohnung/)
    const richtig = await send('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas EG', amountCents: 150000, key: 'direct', directUnitId: eg.id, heatingPlantId: plant.id, fuelDeliveryId: rechnung.id }))
    assert.equal(richtig.status, 201)
    // Die Wohnung der Rechnung wechselt nicht, solange eine Position der anderen Wohnung an ihr hängt.
    const umhaengen = await send(`/api/fuel-deliveries/${rechnung.id}`, { method: 'PUT', body: JSON.stringify({ unitId: og.id }) })
    assert.equal(umhaengen.status, 400)
    assert.match(await errorFrom(umhaengen), /Positionen einer anderen Wohnung/)
    // Eine zentrale Anlage im zweiten Objekt nimmt keine Lieferung mit Wohnung.
    const objekt2 = await s.api<Property>('/api/properties', jsonPost({ name: 'Zweites Haus', kind: 'mfh', address: '' }))
    const fremdeWohnung = await s.api<Unit>(`/api/units?property=${objekt2.id}`, jsonPost({ name: 'X', areaM2: 50, participates: true }))
    const zentral = await jsonOf<{ plant: HeatingPlant }>(await send(`/api/heating-plants?property=${objekt2.id}`, jsonPost({ energy: 'gas', method: 'manual' })))
    const mitWohnung = await send(`/api/heating-plants/${zentral.plant.id}/deliveries`, jsonPost({ invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', emissionsKg: 1, co2CostCents: 1, unitId: fremdeWohnung.id }))
    assert.equal(mitWohnung.status, 400)
    assert.match(await errorFrom(mitWohnung), /zentralen Heizanlage gehört zu keiner einzelnen Wohnung/)
  } finally {
    s.stop()
  }
})

test('Etagenheizung: Eine Wohnung mit Rechnungen lässt sich nicht löschen, die Löschfrage nennt sie, und die Rechnung bleibt (Integrationsdurchsicht S1)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const eg = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 60, participates: true }))
    const og = await s.api<Unit>('/api/units', jsonPost({ name: 'OG', areaM2: 40, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ name: 'Gasthermen', energy: 'gas', supply: 'perUnit', method: 'manual' })))
    const rechnung = async (unitId: string, label: string) => jsonOf<{ id: string }>(await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({
      label, invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', invoiceDate: '2026-01-15', energyKwh: 15000, emissionsKg: 3013, co2CostCents: 16500, unitId,
    })))
    const egRechnung = await rechnung(eg.id, 'Gas EG 2025')
    await s.api('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas EG', amountCents: 150000, key: 'direct', directUnitId: eg.id, heatingPlantId: plant.id, fuelDeliveryId: egRechnung.id }))
    const ogRechnung = await rechnung(og.id, 'Gas OG 2025')

    // Mit verknüpfter Position: ein Satz statt der Meldung des Fremdschlüssels.
    assert.equal((await s.api<{ fuelDeliveries: number }>(`/api/units/${eg.id}/dependents`)).fuelDeliveries, 1)
    const mitPosition = await send(`/api/units/${eg.id}`, { method: 'DELETE' })
    assert.equal(mitPosition.status, 409)
    const satz = await errorFrom(mitPosition)
    assert.match(satz, /„Gas EG 2025“/)
    assert.doesNotMatch(satz, /FOREIGN KEY|gehört zu etwas/)
    // Ohne Position: Die Rechnung samt CO₂-Angaben verschwände still; deshalb ebenso gesperrt.
    const ohnePosition = await send(`/api/units/${og.id}`, { method: 'DELETE' })
    assert.equal(ohnePosition.status, 409)
    assert.match(await errorFrom(ohnePosition), /„Gas OG 2025“/)
    const noch = await s.api<FuelDelivery[]>(`/api/heating-plants/${plant.id}/deliveries`)
    assert.deepEqual(noch.map((d) => d.id).sort(), [egRechnung.id, ogRechnung.id].sort())
    assert.equal((await s.api<Unit[]>('/api/units')).length, 2)
    // Ist die Rechnung gelöscht, geht auch die Wohnung.
    assert.equal((await send(`/api/fuel-deliveries/${ogRechnung.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await s.api<{ fuelDeliveries: number }>(`/api/units/${og.id}/dependents`)).fuelDeliveries, 0)
    assert.equal((await send(`/api/units/${og.id}`, { method: 'DELETE' })).status, 200)
  } finally {
    s.stop()
  }
})

// ---------- Kesseltausch (Heizung PR 9) ----------

test('Kesseltausch über die Route: Öl endet, Gas beginnt; der Restbestand steht in der Abrechnung beim Vermieter', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const eg = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    await s.api('/api/tenancies', jsonPost({
      unitId: eg.id, tenantName: 'Mieter', personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    }))
    const { plant: oel } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'oil', method: 'manual' })))
    const lieferung = await jsonOf<{ id: string }>(await send(`/api/heating-plants/${oel.id}/deliveries`, jsonPost({ label: 'Heizöl', deliveredAt: '2025-03-15', quantity: 3000, quantityUnit: 'l', emissionsKg: 8028.9, co2CostCents: 52549 })))
    await s.api('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Heizöl', amountCents: 315000, key: 'area', heatingPlantId: oel.id, heatingPart: 'fuel', fuelDeliveryId: lieferung.id }))
    const vorrat = await send(`/api/heating-plants/${oel.id}/periods/2025-01/stock`, { method: 'PUT', body: JSON.stringify({ stockUnit: 'l', openingQuantity: 0, openingCostCents: 0, openingEmissionsKg: 0, openingCo2Cents: 0, openingInvoicedBefore2023: false, closingQuantity: 1000, closingMeasuredOn: '2025-06-30' }) })
    assert.equal(vorrat.status, 200, await vorrat.clone().text())
    // Der Energieträger lässt sich nicht umstellen; der Satz führt zum Kesseltausch.
    const umstellen = await send(`/api/heating-plants/${oel.id}`, { method: 'PUT', body: JSON.stringify({ energy: 'gas' }) })
    assert.equal(umstellen.status, 409)
    assert.match(await errorFrom(umstellen), /„Heizung erneuert \(Kessel getauscht\)“/)
    const tausch = await send(`/api/heating-plants/${oel.id}/replace`, jsonPost({ date: '2025-07-01', energy: 'gas', method: 'manual', name: 'Gastherme', previousName: 'Ölkessel' }))
    assert.equal(tausch.status, 201)
    const { plant, previous } = await jsonOf<{ plant: HeatingPlant; previous: HeatingPlant }>(tausch)
    assert.deepEqual([previous.endsOn, plant.replacesPlantId, plant.units?.map((u) => u.unitId)], ['2025-06-30', oel.id, [eg.id]])
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/replace', jsonPost({ date: '2025-07-01', energy: 'gas' }))).status, 404)
    const abrechnung = await s.api<Settlement>('/api/settlement/2025-01')
    const rest = abrechnung.landlord.rows.find((r) => r.costItemId.endsWith(':remaining')) ?? assert.fail('kein Restbestand beim Vermieter')
    assert.deepEqual(rest.landlordParts, [{ reason: 'stockRemaining', cents: 105000 }])
    assert.ok(abrechnung.notices?.some((n) => n.code === 'fuel.stock-remaining'))
  } finally {
    s.stop()
  }
})

test('Eigene Heizkostenabrechnung über die Routen: Einrichtung mit Liste, Anteil, Zwischenablesung (Heizung PR 10)', async () => {
  const s = await startServer()
  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('POST', '/api/heating-plants', { energy: 'gas', method: 'manual' }))
    const item = await s.api<{ id: string }>('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 600000, key: 'area' }) })
    // Über die allgemeine Route geht es nicht.
    const allgemein = await send('PUT', `/api/heating-plants/${plant.id}`, { method: 'self', capture: 'heatMeter' })
    assert.equal(allgemein.status, 400)
    assert.match(await errorFrom(allgemein), /Einrichtung/)
    const setup = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }
    const liste = await send('PUT', `/api/heating-plants/${plant.id}/self`, setup)
    assert.equal(liste.status, 409)
    const body409 = await jsonOf<{ error: string; items: { id: string }[] }>(liste)
    assert.deepEqual(body409.items.map((i) => i.id), [item.id])
    const ok = await send('PUT', `/api/heating-plants/${plant.id}/self`, { ...setup, items: [{ id: item.id, heatingPart: 'fuel', heatingTarget: 'both' }] })
    assert.equal(ok.status, 200)
    const result = await jsonOf<{ plant: HeatingPlant; created: Meter[]; converted: number }>(ok)
    assert.deepEqual([result.plant.method, result.converted, result.created.length], ['self', 1, 3])
    // Der Anteil: 2025 hat begonnen, ein anderer Wert ist gesperrt; derselbe geht.
    const anders = await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/distribution`, { heatConsumptionPct: 60, waterConsumptionPct: 60, insulationRule: 'notApplies' })
    assert.equal(anders.status, 400)
    assert.match(await errorFrom(anders), /§ 6 Abs\. 4/)
    const gleich = await jsonOf<HeatingDistribution>(await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/distribution`, { heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies' }))
    assert.equal(gleich.effective?.heating, 70)
    const [view] = await s.api<HeatingPeriodView[]>(`/api/heating-plants/${plant.id}/periods?period=2025`)
    assert.deepEqual([view?.distribution?.effective?.heating, view?.distribution?.begun], [70, true])
    // Zwischenablesung
    const gap = await jsonOf<InterimGap>(await send('PUT', `/api/units/${unit.id}/interim-gaps/2025-09-30`, { status: 'missed', reason: '' }))
    assert.equal(gap.status, 'missed')
    assert.equal((await send('PUT', `/api/units/${unit.id}/interim-gaps/2025-09-30`, { status: 'egal' })).status, 400)
    assert.equal((await send('PUT', '/api/units/gibt-es-nicht/interim-gaps/2025-09-30', { status: 'missed' })).status, 404)
    assert.deepEqual(await jsonOf<{ ok: boolean; removed: boolean }>(await send('DELETE', `/api/units/${unit.id}/interim-gaps/2025-09-30`)), { ok: true, removed: true })
    // Zurück auf freie Schlüssel: erst die Liste, dann mit Bestätigung.
    const zurueck = await send('PUT', `/api/heating-plants/${plant.id}`, { method: 'manual' })
    assert.equal(zurueck.status, 409)
    assert.equal((await jsonOf<{ items: unknown[] }>(zurueck)).items.length, 1)
    assert.equal((await send('PUT', `/api/heating-plants/${plant.id}`, { method: 'manual', convertItems: 'area' })).status, 200)
    assert.equal((await send('PUT', '/api/heating-plants/gibt-es-nicht/self', setup)).status, 404)
  } finally {
    s.stop()
  }
})

test('Schätzung nach § 9a über die Routen (Heizung PR 13): speichern, in der Abrechnung, Satz bei Fehler, entfernen', async () => {
  const s = await startServer()
  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('POST', '/api/heating-plants', { energy: 'gas', method: 'manual' }))
    const setup = { period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'combined', capture: 'heatMeter', dhwHeatMeter: true, totalHeatMeter: false }
    assert.equal((await send('PUT', `/api/heating-plants/${plant.id}/self`, setup)).status, 200)
    // Der Ausweis entsteht mit einer Position der Anlage.
    await s.api('/api/costItems', { method: 'POST', body: JSON.stringify({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Wartung', amountCents: 30000, key: 'heatingSystem', heatingPlantId: plant.id, heatingPart: 'operating', heatingTarget: 'both' }) })
    const url = `/api/heating-plants/${plant.id}/periods/2025-01/estimates/${unit.id}/heat`
    const ok = await send('PUT', url, { value: 9000, method: 'buildingAverage', reason: 'Zähler defekt', confirmed: true, cause: 'deviceFailure' })
    assert.equal(ok.status, 200)
    assert.deepEqual(await jsonOf<HeatingEstimate>(ok), { plantId: plant.id, period: '2025-01', unitId: unit.id, part: 'heat', value: 9000, method: 'buildingAverage', reason: 'Zähler defekt', confirmed: true, cause: 'deviceFailure', capture: 'heatMeter', valueUnit: 'kWh' })
    const abrechnung = await s.api<{ heating?: { plantId: string; self?: { estimates?: { unitId: string; value: number }[] } }[] }>('/api/settlement/2025')
    assert.deepEqual(abrechnung.heating?.find((h) => h.plantId === plant.id)?.self?.estimates?.map((e) => [e.unitId, e.value]), [[unit.id, 9000]])
    const leer = await send('PUT', url, { value: 9000, method: 'buildingAverage', reason: '', confirmed: true, cause: 'deviceFailure' })
    assert.equal(leer.status, 400)
    assert.match(await errorFrom(leer), /Begründung/)
    assert.equal((await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/estimates/${unit.id}/gas`, { value: 1, method: 'buildingAverage', reason: 'x', confirmed: true, cause: 'deviceFailure' })).status, 400)
    assert.deepEqual(await jsonOf<{ ok: boolean; removed: boolean }>(await send('DELETE', url)), { ok: true, removed: true })
    assert.deepEqual(await jsonOf<{ ok: boolean; removed: boolean }>(await send('DELETE', url)), { ok: true, removed: false })
    assert.equal((await send('PUT', `/api/heating-plants/gibt-es-nicht/periods/2025-01/estimates/${unit.id}/heat`, { value: 1, method: 'buildingAverage', reason: 'x', confirmed: true, cause: 'deviceFailure' })).status, 404)
    assert.equal((await send('DELETE', `/api/heating-plants/gibt-es-nicht/periods/2025-01/estimates/${unit.id}/heat`)).status, 404)
  } finally {
    s.stop()
  }
})

test('Ablesedienst (Heizung PR 12): PUT speichert die Werte, eine Überschneidung ergibt 400 mit Satz, die Abrechnung zählt Einheiten', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const zwei = await s.api<Unit>('/api/units', jsonPost({ name: 'OG', areaM2: 80, participates: true }))
    for (const [u, n] of [[unit, 'A'], [zwei, 'B']] as const) await s.api('/api/tenancies', jsonPost({ unitId: u.id, tenantName: n, persons: 1, start: '2020-01-01' }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    const setup = await send(`/api/heating-plants/${plant.id}/self`, { method: 'PUT', body: JSON.stringify({
      period: '2025-01', heatConsumptionPct: 70, waterConsumptionPct: 70, insulationRule: 'notApplies', hotWater: 'none', capture: 'serviceValues', dhwHeatMeter: false, totalHeatMeter: false,
    }) })
    assert.equal(setup.status, 200, await setup.clone().text())
    await s.api('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 100000, key: 'heatingSystem', heatingPlantId: plant.id, heatingPart: 'fuel', heatingTarget: 'heating' }))
    const url = `/api/heating-plants/${plant.id}/periods/2025-01/service-values`
    const ok = await send(url, { method: 'PUT', body: JSON.stringify({ values: [
      { unitId: unit.id, from: '2025-01-01', to: '2025-12-31', heatValue: 300, waterValue: null },
      { unitId: zwei.id, from: '2025-01-01', to: '2025-12-31', heatValue: 700, waterValue: null },
    ] }) })
    assert.equal(ok.status, 200, await ok.clone().text())
    assert.equal((await jsonOf<unknown[]>(ok)).length, 2)
    const doppelt = await send(url, { method: 'PUT', body: JSON.stringify({ values: [
      { unitId: unit.id, from: '2025-01-01', to: '2025-06-30', heatValue: 1, waterValue: null },
      { unitId: unit.id, from: '2025-06-01', to: '2025-12-31', heatValue: 1, waterValue: null },
    ] }) })
    assert.equal(doppelt.status, 400)
    assert.match(await errorFrom(doppelt), /überschneiden sich/)
    assert.equal((await send(`/api/heating-plants/gibt-es-nicht/periods/2025-01/service-values`, { method: 'PUT', body: '{"values":[]}' })).status, 404)
    // 300 von 1.000 Einheiten: 70 % von 1.000 € nach Verbrauch, 30 % nach Fläche (gleich groß).
    const abrechnung = await s.api<Settlement>('/api/settlement/2025')
    const self = abrechnung.heating?.find((h) => h.plantId === plant.id)?.self
    assert.equal(self?.pots.find((p) => p.pot === 'heating')?.consumptionUnit, 'Einheiten')
    assert.equal(self?.serviceValues?.length, 2)
    const a = abrechnung.statements.find((st) => st.tenantName === 'A')
    assert.equal(a?.totalShareCents, 70000 * 0.3 + 15000)
  } finally {
    s.stop()
  }
})

test('Pflichtangaben nach § 6a und Ausnahmen über die Routen (Heizung PR 14): speichern, Satz bei Fehler, 404', async () => {
  const s = await startServer()
  const send = (method: string, url: string, body?: unknown) =>
    fetch(`${s.base}${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    await s.api('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 60, participates: true }) })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('POST', '/api/heating-plants', { energy: 'gas', method: 'manual' }))
    const ok = await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/info`, { climateFactor: 1.08, climateFactorSource: 'DWD' })
    assert.equal(ok.status, 200)
    assert.equal((await jsonOf<{ climateFactor: number }>(ok)).climateFactor, 1.08)
    const falsch = await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/info`, { climateFactor: -2 })
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /Klimafaktor/)
    const rules = await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/rules`, { exemption: 'lowDemand', consumerContract: 'none' })
    assert.deepEqual(await jsonOf<Record<string, unknown>>(rules), { exemption: 'lowDemand', exemptionScope: null, exemptionBillingAgreed: null, agreedOtherwise: null, monthlyInfoElsewhere: null, consumerContract: 'none', later: { closed: [] } })
    assert.equal((await send('PUT', `/api/heating-plants/${plant.id}/periods/2025-01/rules`, { agreedOtherwise: 'area' })).status, 400)
    assert.equal((await send('PUT', '/api/heating-plants/gibt-es-nicht/periods/2025-01/info', {})).status, 404)
    assert.equal((await send('PUT', '/api/heating-plants/gibt-es-nicht/periods/2025-01/rules', {})).status, 404)
  } finally {
    s.stop()
  }
})

// ---------- Rechtswerte des Vermieters (Heizung PR 17) ----------

test('Rechtswerte über die Routen: Liste, eintragen, ablehnen, entfernen (Heizung PR 17)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const liste = await s.api<LawOverrideSlot[]>('/api/law-overrides')
    assert.ok(liste.some((x) => x.paramId === 'co2.price' && x.status === 'open'))
    const gesetzt = await send('/api/law-overrides/co2.price/2027', { method: 'PUT', body: JSON.stringify({ value: 64.2, source: 'UBA' }) })
    assert.equal(gesetzt.status, 200, await gesetzt.clone().text())
    assert.equal((await jsonOf<LawOverrideSlot>(gesetzt)).status, 'entered')
    const falsch = await send('/api/law-overrides/co2.price/2026', { method: 'PUT', body: JSON.stringify({ value: 61, source: 'x' }) })
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /amtliche Wert/)
    assert.ok((await s.api<LawOverrideSlot[]>('/api/law-overrides')).some((x) => x.paramId === 'co2.price' && x.year === 2027 && x.status === 'entered'))
    const weg = await send('/api/law-overrides/co2.price/2027', { method: 'DELETE' })
    assert.equal(weg.status, 200)
    assert.deepEqual(await jsonOf<unknown>(weg), { ok: true, removed: true })
  } finally {
    s.stop()
  }
})

test('Blatt für den Messdienst über die Route: 200 mit Rechnungen, 404 ohne Anlage (Heizung PR 17, #210)', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'service' })))
    const angelegt = await send(`/api/heating-plants/${plant.id}/deliveries`, jsonPost({ label: 'Gas 2025', invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31', invoiceDate: '2026-01-20', amountCents: 300000, energyKwh: 100000, gasBasis: 'hs', emissionsKg: 18139, co2CostCents: 117000 }))
    assert.equal(angelegt.status, 201, await angelegt.clone().text())
    const blatt = await send(`/api/heating-plants/${plant.id}/periods/2025-01/co2-sheet`, { method: 'GET' })
    assert.equal(blatt.status, 200, await blatt.clone().text())
    const sheet = await jsonOf<Co2Sheet>(blatt)
    assert.deepEqual(sheet.deliveries.map((d) => d.label), ['Gas 2025'])
    assert.deepEqual([sheet.areaM2, sheet.areaSource], [80, 'served'])
    // 18,139 t × 55 €/t × 1,19 = 1.187,20 €, eingetragen 1.170,00 €: innerhalb der Grenze.
    assert.deepEqual(sheet.deliveries[0]?.findings, [])
    assert.equal((await send('/api/heating-plants/fehlt/periods/2025-01/co2-sheet', { method: 'GET' })).status, 404)
  } finally {
    s.stop()
  }
})

// ---------- Betriebsstrom (Heizung PR 15) ----------

test('Betriebsstrom über die Route: 201 mit beiden Positionen, 404 ohne Anlage, 400 mit Satz', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'service' })))
    const strom = await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }))
    const body = { period: '2025-01', generalItemId: strom.id, billKwh: 3000, devices: [{ label: 'Pumpe', watts: 45, hoursPerDay: 24 }], heatingDays: 220 }
    const angelegt = await send(`/api/heating-plants/${plant.id}/operating-power`, jsonPost(body))
    assert.equal(angelegt.status, 201)
    const b = await jsonOf<{ share: { cents: number }; deduction: CostItem; heatingItem: CostItem | null }>(angelegt)
    // 45 W × 24 h × 220 Tage = 237,6 kWh; 237,6 / 3.000 × 1.050,00 € = 83,16 €
    assert.deepEqual([b.share.cents, b.deduction.amountCents, b.heatingItem], [8316, -8316, null])
    // P-W1: Die Grundlage kommt über die Route mit und bleibt in der Liste der Positionen.
    assert.match(b.deduction.operatingPowerBasis ?? '', /Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh/)
    const liste = await s.api<CostItem[]>('/api/costItems')
    assert.equal(liste.find((c) => c.id === b.deduction.id)?.operatingPowerBasis, b.deduction.operatingPowerBasis)
    assert.equal((await send('/api/heating-plants/fehlt/operating-power', jsonPost(body))).status, 404)
    const falsch = await send(`/api/heating-plants/${plant.id}/operating-power`, jsonPost({ ...body, billKwh: 0 }))
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /kWh der Stromrechnung/)
  } finally {
    s.stop()
  }
})

// Der Schnappschuss der Route führt die Abzüge (snapshotFor): Mit Abzug kein Hinweis, ohne ihn der Betrag.
test('Betriebsstrom in der Abrechnung über die Route: mit Abzug still, nach dem Löschen des Abzugs die Warnung', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    await s.api('/api/tenancies', jsonPost({ unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 300000, key: 'area', heatingPart: 'fuel', heatingPlantId: plant.id }))
    const strom = await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }))
    // Folge-PR zu #252 (#224): Vor der Buchung fehlt der Betriebsstrom; der Hinweis kommt über die Route genau einmal
    // (snapshotFor führt Anlage, Heizpositionen und Abzüge) und entfällt mit der Buchung.
    const fehlt = (st: Settlement) => (st.notices ?? []).filter((n) => n.code === 'heating.operating-power-missing')
    assert.equal(fehlt(await s.api<Settlement>('/api/settlement/2025-01')).length, 1)
    const b = await jsonOf<{ deduction: CostItem; heatingItem: CostItem | null }>(await send(`/api/heating-plants/${plant.id}/operating-power`,
      jsonPost({ period: '2025-01', generalItemId: strom.id, billKwh: 3000, devices: [{ label: 'Pumpe', watts: 45, hoursPerDay: 24 }], heatingDays: 220 })))
    const doppelt = (st: Settlement) => (st.notices ?? []).filter((n) => n.code === 'heating.operating-power-double')
    assert.equal(doppelt(await s.api<Settlement>('/api/settlement/2025-01')).length, 0)
    assert.equal(fehlt(await s.api<Settlement>('/api/settlement/2025-01')).length, 0)
    assert.equal((await send(`/api/costItems/${b.deduction.id}`, { method: 'DELETE' })).status, 200)
    const [n] = doppelt(await s.api<Settlement>('/api/settlement/2025-01'))
    assert.match(n?.text ?? '', /abgezogen sind dort 0,00 € statt 83,16 €/)
  } finally {
    s.stop()
  }
})

// Nachprüfung von #252, G2-H1: Die Rückfrage wegen vorhandener Buchung trägt ihr eigenes Kennzeichen; die
// Oberfläche bietet „Trotzdem anlegen“ nur dann an.
test('Betriebsstrom über die Route: zweite Buchung 409 mit question „despiteExisting“', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'service' })))
    const strom = await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }))
    const body = { period: '2025-01', generalItemId: strom.id, ownCents: 10000, basis: 'x' }
    assert.equal((await send(`/api/heating-plants/${plant.id}/operating-power`, jsonPost(body))).status, 201)
    const zweite = await send(`/api/heating-plants/${plant.id}/operating-power`, jsonPost(body))
    assert.equal(zweite.status, 409)
    const json = await jsonOf<{ error?: string; question?: string }>(zweite)
    assert.equal(json.question, 'despiteExisting')
    assert.match(json.error ?? '', /schon gebucht/)
  } finally {
    s.stop()
  }
})

// #266: Die Angabe, wie der Betriebsstrom erfasst ist, über die Route der Anlage; sie übersteht Backup und
// Wiederherstellen.
test('Angabe zum Betriebsstrom über die Route: speichern, leeren, 400 mit Satz, Merge nach Anwesenheit, Backup', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    assert.equal(plant.operatingPowerHandling, null)
    const put = (body: unknown) => send(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify(body) })
    const gelesen = async () => (await s.api<HeatingPlant[]>('/api/heating-plants')).find((p) => p.id === plant.id)?.operatingPowerHandling
    for (const v of ['ownMeter', 'landlordPays', 'deducted'] as const) {
      const res = await put({ operatingPowerHandling: v })
      assert.equal(res.status, 200, v)
      assert.equal(await gelesen(), v)
    }
    assert.equal((await put({ name: 'Kessel' })).status, 200)
    assert.equal(await gelesen(), 'deducted', 'ein PUT ohne den Schlüssel lässt die Angabe stehen')
    const falsch = await put({ operatingPowerHandling: 'foo' })
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /^Wie der Betriebsstrom dieser Heizung erfasst ist, kennt Mietfuchs so nicht\. Bitte wählen Sie aus der Liste\./)
    assert.equal(await gelesen(), 'deducted', 'nach dem Fehler unverändert')
    const archiv = await fetch(`${s.base}/api/backup`)
    const fd = new FormData()
    fd.append('file', new Blob([await archiv.arrayBuffer()], { type: 'application/zip' }), 'backup.zip')
    assert.equal((await put({ operatingPowerHandling: '' })).status, 200)
    assert.equal(await gelesen(), null)
    assert.equal((await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })).status, 200)
    assert.equal(await gelesen(), 'deducted', 'das Backup bringt die Angabe zurück')
    assert.equal((await put({ operatingPowerHandling: null })).status, 200)
    assert.equal(await gelesen(), null)
  } finally {
    s.stop()
  }
})

// #266: Über die Route kommt die Angabe in der Abrechnung an (snapshotFor reicht sie durch).
test('Angabe zum Betriebsstrom in der Abrechnung über die Route: Wartung erfasst, mit „abgezogen“ der Hinweis, mit „Vermieter trägt“ still', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    await s.api('/api/tenancies', jsonPost({ unitId: unit.id, tenantName: 'Mieter', personHistory: [{ from: '2025-01-01', persons: 1 }], start: '2025-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 300000, key: 'area', heatingPart: 'fuel', heatingPlantId: plant.id }))
    await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Wartung', amountCents: 30000, key: 'area', heatingPart: 'operating', heatingPlantId: plant.id }))
    await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 105000, key: 'area' }))
    const codes = async () => ((await s.api<Settlement>('/api/settlement/2025-01')).notices ?? []).map((n) => n.code).filter((c) => c.startsWith('heating.operating-power'))
    assert.deepEqual(await codes(), [], 'ohne Angabe schweigt der Hinweis bei erfasster Wartung')
    const vorher = await s.api<Settlement>('/api/settlement/2025-01')
    const put = (v: string | null) => send(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ operatingPowerHandling: v }) })
    assert.equal((await put('deducted')).status, 200)
    assert.deepEqual(await codes(), ['heating.operating-power-deduction-missing'])
    // Keine Zahl ändert sich.
    assert.deepEqual((await s.api<Settlement>('/api/settlement/2025-01')).statements, vorher.statements)
    assert.equal((await put('landlordPays')).status, 200)
    assert.deepEqual(await codes(), [])
  } finally {
    s.stop()
  }
})

// Heizung PR 16 (#213): Contracting und die Angaben zur Umstellung über die Routen der Anlage und des Kesseltauschs; sie
// überstehen Backup und Wiederherstellen, und die Abrechnung nennt die Umstellung.
test('Wärmelieferung über die Routen: anlegen, Umschalten mit Lieferung gesperrt, Kesseltausch, Abrechnung, Backup', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    await s.api('/api/tenancies', jsonPost({ unitId: unit.id, tenantName: 'Meier', personHistory: [{ from: '2010-01-01', persons: 1 }], start: '2010-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }))
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    assert.equal(plant.contracting, false)
    await s.api('/api/heating-plants/' + plant.id + '/deliveries', jsonPost({ label: 'Gas', invoiceFrom: '2025-01-01', invoiceTo: '2025-09-30' }))
    const umschalten = await send(`/api/heating-plants/${plant.id}`, { method: 'PUT', body: JSON.stringify({ contracting: true }) })
    assert.equal(umschalten.status, 409)
    assert.match(await errorFrom(umschalten), /„Heizung erneuert \(Kessel getauscht\)“/)
    const tausch = await send(`/api/heating-plants/${plant.id}/replace`, { method: 'POST', body: JSON.stringify({ date: '2025-10-01', energy: 'gas', contracting: true, heatDeliverySince: '2025-10-01', previousSupply: 'landlord' }) })
    assert.equal(tausch.status, 201)
    const neu = (await jsonOf<{ plant: HeatingPlant }>(tausch)).plant
    assert.deepEqual([neu.contracting, neu.heatDeliverySince, neu.previousSupply], [true, '2025-10-01', 'landlord'])
    await s.api<CostItem>('/api/costItems', jsonPost({ period: '2025-01', category: 'Heizung und Warmwasser', description: 'Wärme Oktober bis Dezember', amountCents: 90000, key: 'area', heatingPlantId: neu.id }))
    const notices = async () => ((await s.api<Settlement>('/api/settlement/2025-01')).notices ?? []).filter((n) => n.code === 'heating.contracting')
    const [n] = await notices()
    assert.match(n?.text ?? '', /Für Meier lief der Mietvertrag schon vor der Umstellung auf Wärmelieferung am 01\.10\.2025/)
    const archiv = await fetch(`${s.base}/api/backup`)
    const fd = new FormData()
    fd.append('file', new Blob([await archiv.arrayBuffer()], { type: 'application/zip' }), 'backup.zip')
    assert.equal((await send(`/api/heating-plants/${neu.id}`, { method: 'PUT', body: JSON.stringify({ heatDeliverySince: null, previousSupply: null }) })).status, 200)
    assert.equal((await notices()).length, 0)
    assert.equal((await fetch(`${s.base}/api/restore`, { method: 'POST', body: fd })).status, 200)
    const zurueck = (await s.api<HeatingPlant[]>('/api/heating-plants')).find((p) => p.id === neu.id)
    assert.deepEqual([zurueck?.contracting, zurueck?.heatDeliverySince, zurueck?.previousSupply], [true, '2025-10-01', 'landlord'])
    assert.equal((await notices()).length, 1)
  } finally {
    s.stop()
  }
})

// ---------- Monatliche Verbrauchsinformation (Heizung PR 22) ----------

test('Monatliche Verbrauchsinformation: Monate einer Heizperiode lesen, Vergleichswert und Mitteilung speichern', async () => {
  const s = await startServer()
  try {
    const send = (url: string, init: RequestInit) => fetch(`${s.base}${url}`, { ...init, headers: { 'content-type': 'application/json' } })
    const { plant } = await jsonOf<{ plant: HeatingPlant }>(await send('/api/heating-plants', jsonPost({ energy: 'gas', method: 'manual' })))
    const view = await s.api<MonthlyInfoView>(`/api/heating-plants/${plant.id}/periods/2025-01/monthly-info`)
    assert.deepEqual([view.plantId, view.period, view.managed, view.elsewhere, view.months, view.periodReference], [plant.id, '2025-01', false, false, [], null])
    const row = await s.api<MonthlyInfoRow>(`/api/heating-plants/${plant.id}/monthly-info/2025-11`, { method: 'PUT', body: JSON.stringify({ referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' }) })
    assert.deepEqual(row, { plantId: plant.id, month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst', sentOn: '2025-12-05' })
    const frueh = await send(`/api/heating-plants/${plant.id}/monthly-info/2025-11`, { method: 'PUT', body: JSON.stringify({ sentOn: '2025-11-02' }) })
    assert.equal(frueh.status, 400)
    assert.match(await errorFrom(frueh), /frühestens am 01\.12\.2025/)
    assert.equal((await send(`/api/heating-plants/${plant.id}/monthly-info/2025-13`, { method: 'PUT', body: '{}' })).status, 400)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/monthly-info/2025-11', { method: 'PUT', body: '{}' })).status, 404)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods/2025-01/monthly-info', { method: 'GET' })).status, 404)
    assert.equal((await send(`/api/heating-plants/${plant.id}/periods/2025-13/monthly-info`, { method: 'GET' })).status, 400)
    // Die Warmwassertemperatur hier nur bei eigener Abrechnung mit getrenntem Warmwasser.
    const temp = await send(`/api/heating-plants/${plant.id}/periods/2025-01/dhw-temperature`, { method: 'PUT', body: JSON.stringify({ dhwTempC: 55 }) })
    assert.equal(temp.status, 400)
    assert.match(await errorFrom(temp), /Karte „Warmwasser“/)
    assert.equal((await send('/api/heating-plants/gibt-es-nicht/periods/2025-01/dhw-temperature', { method: 'PUT', body: '{}' })).status, 404)
  } finally {
    s.stop()
  }
})

// ---------- Eichfrist (Heizung PR 21, #98) ----------

test('Eichfrist über die Routen: gespeichert, Hinweis auf der Zähler-Seite, nicht in der Abrechnung; HKV mit Jahr 400', async () => {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', jsonPost({ name: 'EG', areaM2: 80, participates: true }))
    const meter = await s.api<Meter>('/api/meters', jsonPost({ name: 'Kaltwasser EG', unitId: unit.id, type: 'kaltwasser', unit: 'm³', calibratedUntil: 2024 }))
    assert.equal(meter.calibratedUntil, 2024)
    await s.api('/api/readings', jsonPost({ meterId: meter.id, date: '2024-12-31', value: 100 }))
    await s.api('/api/readings', jsonPost({ meterId: meter.id, date: '2025-12-31', value: 180 }))
    const zeilen = await s.api<{ meterId: string; consumption: number; notices: Notice[]; warnings: string[] }[]>('/api/consumption/2025')
    const zeile = zeilen.find((z) => z.meterId === meter.id) ?? assert.fail('Zähler fehlt')
    assert.deepEqual(zeile.notices.map((n) => [n.code, n.level]), [['meter.calibration-overdue', 'warning']])
    assert.equal(zeile.consumption, 80)
    const abrechnung = await s.api<Settlement>('/api/settlement/2025')
    assert.ok(!abrechnung.notices?.some((n) => n.code === 'meter.calibration-overdue'))
    assert.ok(!abrechnung.legalBasis?.rules.some((r) => r.code === 'meter-calibration'))
    const hkv = await fetch(`${s.base}/api/meters`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'HKV', unitId: unit.id, type: 'hkv', unit: 'Einheiten', calibratedUntil: 2030 }),
    })
    assert.equal(hkv.status, 400)
    assert.match(await errorFrom(hkv), /Heizkostenverteiler sind keine eichpflichtigen Messgeräte/)
  } finally {
    s.stop()
  }
})
