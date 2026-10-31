// Integrationstests gegen den echten Server: KI liest Messdienstabrechnung und Lieferantenrechnung
// (Heizung PR 20, #103).
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner; Ollama
// ersetzt der nachgebaute Dienst aus testing/api.ts, der die beiden Belegarten an ihrem Schema erkennt.
// Geprüft wird der Weg über die Routen: Was ankommt, ist eingeengt, und gespeichert wird nichts außer dem
// Beleg. Was die Seite daraus macht, prüfen client/src/serviceImport.test.ts und fuelImport.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem, FuelExtractResult, HeatingPlant, ServiceExtractResult, UploadInfo } from '../../shared/types.ts'
import { LONG_TEXT, PDF, type Server, chatRequests, errorFrom, firstMessage, jsonOf, startServer, until, withOllama } from '../testing/api.ts'

const send = (s: Server, p: string, init: RequestInit) => fetch(`${s.base}${p}`, { headers: { 'content-type': 'application/json' }, ...init })
const newPlant = async (s: Server, body: Record<string, unknown>): Promise<HeatingPlant> =>
  (await jsonOf<{ plant: HeatingPlant }>(await send(s, '/api/heating-plants', { method: 'POST', body: JSON.stringify(body) }))).plant
const upload = (s: Server, route: string, fields: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'beleg.pdf')
  fd.append('pdfText', LONG_TEXT)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fetch(`${s.base}${route}`, { method: 'POST', body: fd })
}

test('KI: Messdienstabrechnung an der Anlage mit Messdienst; Antwort eingeengt; nichts gespeichert außer dem Beleg', async () => {
  await withOllama(async (s, ollama) => {
    const plant = await newPlant(s, { energy: 'gas', method: 'service' })
    const res = await upload(s, `/api/heating-plants/${plant.id}/service-statement`, { propertyId: plant.propertyId, year: '2025' })
    assert.equal(res.status, 200)
    const body = await jsonOf<ServiceExtractResult>(res)
    assert.equal(body.extraction.deductionEur, 87.5, 'die Abzugszeile mit Minus und als Text kommt als Betrag an')
    assert.equal(body.extraction.dhwMethod, 'volumeFormula')
    assert.deepEqual(body.extraction.blocks[0]?.lines.map((l) => l.label), ['Mustermann, Erika'])
    assert.ok(!('geheim' in body.extraction), 'erfundene Felder erreichen den Browser nicht')
    assert.match(firstMessage(ollama).content, /ABRECHNUNGSTEXT/)
    assert.deepEqual(await s.api<CostItem[]>('/api/costItems'), [], 'die Auswertung legt keine Position an')
    // Der Beleg liegt im Posteingang des Objekts und Jahres, bis er an eine Position kommt (Prüfung S4).
    const beleg = (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === body.file)
    assert.deepEqual([beleg?.propertyId, beleg?.year], [plant.propertyId, 2025])
  })
})

test('KI: Lieferantenrechnung; Messdienstabrechnung bei freien Schlüsseln 400; unbekannte Anlage 404, ohne liegengebliebenen Beleg', async () => {
  await withOllama(async (s) => {
    const plant = await newPlant(s, { energy: 'gas', method: 'manual' })
    const gas = await upload(s, `/api/heating-plants/${plant.id}/fuel-invoice`)
    assert.equal(gas.status, 200)
    const fuel = await jsonOf<FuelExtractResult>(gas)
    assert.deepEqual([fuel.extraction.quantityUnit, fuel.extraction.totalGrossEur, fuel.extraction.bioCostEur], ['m3', 4067.8, null])
    const vorher = (await s.api<UploadInfo[]>('/api/uploads')).length
    const falsch = await upload(s, `/api/heating-plants/${plant.id}/service-statement`)
    assert.equal(falsch.status, 400)
    assert.match(await errorFrom(falsch), /nur bei einer Heizanlage, die ein Messdienst oder die Gemeinschaft abrechnet/)
    assert.equal((await upload(s, '/api/heating-plants/gibt-es-nicht/fuel-invoice')).status, 404)
    assert.equal((await upload(s, '/api/heating-plants/gibt-es-nicht/service-statement')).status, 404)
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, vorher, 'der Beleg einer abgelehnten Anfrage bleibt nicht liegen')
  })
})

test('KI: scheitert das Auslesen, nennt die Antwort den Grund, und der Beleg bleibt im Belegordner (Fehler mit Ausweg)', async () => {
  await withOllama(async (s) => {
    const plant = await newPlant(s, { energy: 'gas', method: 'service' })
    const fuel = await upload(s, `/api/heating-plants/${plant.id}/fuel-invoice`)
    assert.equal(fuel.status, 502)
    const body = await jsonOf<{ file?: string, reason?: string, kept?: boolean }>(fuel)
    assert.deepEqual([body.reason, body.kept], ['model', true])
    const service = await jsonOf<{ file?: string, reason?: string, kept?: boolean }>(await upload(s, `/api/heating-plants/${plant.id}/service-statement`))
    assert.deepEqual([service.reason, service.kept], ['model', true])
    const files = (await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file).sort()
    assert.deepEqual(files, [body.file, service.file].sort())
  }, { model: 'fehlt:4b' })
})

// Fehler mit Ausweg (#487, Durchsicht): Ein neuer Versuch nennt den Beleg nur (`existingFile`) und legt keine Kopie
// an; ein Abbruch dieses Versuchs lässt den Beleg liegen, denn er gehörte schon vorher dem Vermieter.
const retryForm = (file: string, extra: Record<string, string> = {}) => {
  const fd = new FormData()
  fd.append('existingFile', file)
  fd.append('pdfText', LONG_TEXT)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return fd
}

test('KI: ein neuer Versuch an Lieferanten- und Messdienstrechnung legt keine Kopie an', async () => {
  await withOllama(async (s) => {
    const plant = await newPlant(s, { energy: 'gas', method: 'service' })
    const failed = await jsonOf<{ file?: string, kept?: boolean }>(await upload(s, `/api/heating-plants/${plant.id}/fuel-invoice`))
    const file = failed.file ?? assert.fail('kein Beleg')
    for (const route of ['fuel-invoice', 'service-statement']) {
      const res = await fetch(`${s.base}/api/heating-plants/${plant.id}/${route}`, { method: 'POST', body: retryForm(file) })
      const body = await jsonOf<{ file?: string, kept?: boolean, reason?: string }>(res)
      assert.deepEqual([res.status, body.file, body.kept, body.reason], [502, file, true, 'model'], route)
    }
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file], 'keine Kopie im Ordner')
  }, { model: 'fehlt:4b' })
})

test('KI: ein abgebrochener neuer Versuch lässt den Beleg im Belegordner', async () => {
  await withOllama(async (s, ollama) => {
    const plant = await newPlant(s, { energy: 'gas', method: 'service' })
    const plain = new FormData()
    plain.append('file', new Blob([PDF], { type: 'application/pdf' }), 'gas.pdf')
    const file = (await jsonOf<{ file: string }>(await fetch(`${s.base}/api/upload`, { method: 'POST', body: plain }))).file
    for (const route of ['fuel-invoice', 'service-statement']) {
      const requestId = route === 'fuel-invoice' ? 'abcdef0123456789abcdef0123456789' : 'fedcba9876543210fedcba9876543210'
      const before = chatRequests(ollama).length
      const pending = fetch(`${s.base}/api/heating-plants/${plant.id}/${route}`, { method: 'POST', body: retryForm(file, { requestId }) }).then((r) => r.text()).catch(() => '')
      assert.ok(await until(() => chatRequests(ollama).length > before, 10_000), 'die Anfrage kam bei Ollama nicht an')
      assert.equal((await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })).status, 200, route)
      await pending
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file], 'der Beleg ist weg')
  }, { chat: 'hang' })
})

test('Warmwasser: „Ermittlung übernehmen“ ({ dhwMethod } allein) lässt eine bestätigte Unmessbarkeit derselben Formel stehen (Durchsicht S2)', async () => {
  const s = await startServer()
  try {
    const plant = await newPlant(s, { energy: 'gas', method: 'service' })
    const url = `/api/heating-plants/${plant.id}/periods/2025-01/hot-water`
    const put = async (body: unknown) => jsonOf<{ dhwMethod: string | null; dhwUnmeasurable: boolean | null }>(await send(s, url, { method: 'PUT', body: JSON.stringify(body) }))
    assert.equal((await put({ dhwMethod: 'volumeFormula', dhwUnmeasurable: true })).dhwUnmeasurable, true)
    // Dieselbe Formel ohne das Feld: Die Bestätigung bleibt, sonst nennte die Abrechnung wieder die Kürzung.
    assert.deepEqual(await put({ dhwMethod: 'volumeFormula' }), { ...(await put({ dhwMethod: 'volumeFormula' })), dhwMethod: 'volumeFormula', dhwUnmeasurable: true })
    // Eine andere Formel braucht ihre eigene Bestätigung; ausdrücklich gesendet gilt der gesendete Wert.
    assert.equal((await put({ dhwMethod: 'areaFormula' })).dhwUnmeasurable, null)
    assert.equal((await put({ dhwMethod: 'areaFormula', dhwUnmeasurable: true })).dhwUnmeasurable, true)
    assert.equal((await put({ dhwMethod: 'areaFormula', dhwUnmeasurable: false })).dhwUnmeasurable, false)
    assert.equal((await put({ dhwMethod: 'heatMeter' })).dhwUnmeasurable, null)
  } finally {
    s.stop()
  }
})

test('KI: eine Heizposition aus der Messdienstabrechnung über zwei Kalenderjahre braucht das Jahr der Zahlung (Prüfung M2)', async () => {
  // Der Rumpf hat die Gestalt aus client/src/serviceImport.ts (`itemBodies`); hier wird er wirklich
  // gespeichert, nicht wie im Komponententest an einem nachgebauten fetch vorbei.
  const s = await startServer()
  try {
    const unit = await s.api<{ id: string }>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG links', areaM2: 60, participates: true }) })
    const mieter = await s.api<{ id: string }>('/api/tenancies', { method: 'POST', body: JSON.stringify({ unitId: unit.id, tenantName: 'Erika Mustermann', persons: 1, start: '2024-01-01', prepayments: [] }) })
    const plant = await newPlant(s, { energy: 'gas', method: 'service' })
    const marke = async (url: string, body: unknown) => (await jsonOf<{ token: string }>(await send(s, url, { method: 'POST', body: JSON.stringify(body) }))).token
    const regeln = { startMonth: 5, changes: [] }
    const zeitraum = await send(s, `/api/heating-plants/${plant.id}/period`, { method: 'PUT', body: JSON.stringify({ rules: regeln, answers: { understood: true, token: await marke(`/api/heating-plants/${plant.id}/period/preview`, { rules: regeln }) } }) })
    assert.equal(zeitraum.status, 200)
    const rumpf = {
      propertyId: plant.propertyId, period: '2025-05', category: 'Heizung und Warmwasser', description: 'Heizung und Warmwasser (Wärmedienst Beispiel GmbH)', vendor: 'Wärmedienst Beispiel GmbH',
      amountCents: 127775, key: 'amounts', tenancyAmounts: { [mieter.id]: 118025 }, selfAmounts: {}, heatingPlantId: plant.id,
    }
    const ohne = await send(s, '/api/costItems', { method: 'POST', body: JSON.stringify(rumpf) })
    assert.equal(ohne.status, 400)
    assert.match(await errorFrom(ohne), /Jahr der Zahlung/)
    const mit = await send(s, '/api/costItems', { method: 'POST', body: JSON.stringify({ ...rumpf, taxYear: 2026 }) })
    assert.equal(mit.status, 201)
    const gespeichert = await jsonOf<CostItem>(mit)
    assert.deepEqual([gespeichert.taxYear, gespeichert.amountCents, gespeichert.heatingPlantId], [2026, 127775, plant.id])
  } finally {
    s.stop()
  }
})
