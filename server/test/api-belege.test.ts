// Integrationstests gegen den echten Server: Belegordner und die Routen der Belegbuchung.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { assessments as assessmentsTable, uploads as uploadsTable } from '../src/db/schema.ts'
import type {
  AssessmentView, BookingPreview, CostItem, Property, TaxReport, Unit, UploadInfo,
} from '../../shared/types.ts'
import {
  LONG_TEXT, PDF, RECHNUNGEN, type Server, type UploadBody, type Vorschau, archive, assessmentOf, chatRequests, evaluate, fileOf, firstMessage, grundsteuer, inDatabase, jsonOf, postJson, putJson, restore, startServer, until, uploadBelegFile, withOllama, withProperties,
} from '../testing/api.ts'

// ---------- Belegordner (#170) ----------

test('Belegordner (#170): die Liste nennt Prüfsumme, Originalname und Hochladezeit; gleicher Inhalt ist erkennbar', async () => {
  const s = await startServer()
  try {
    const vorher = Date.now()
    const a = await uploadBelegFile(s, '%PDF-Grundsteuer', 'Grundsteuer 2025.pdf')
    const b = await uploadBelegFile(s, '%PDF-Grundsteuer', 'Kopie.pdf')
    const c = await uploadBelegFile(s, '%PDF-anders', 'Wasser.pdf')
    const list = await s.api<UploadInfo[]>('/api/uploads')
    const of = (file: string) => list.find((u) => u.file === file) ?? assert.fail(`${file} fehlt`)
    assert.equal(of(a).sha256, of(b).sha256, 'gleicher Inhalt, gleiche Prüfsumme')
    assert.notEqual(of(a).sha256, of(c).sha256)
    assert.match(of(a).sha256, /^[0-9a-f]{64}$/)
    assert.match(of(a).originalName, /^Grundsteuer.2025\.pdf$/)
    assert.equal(of(a).mimeType, 'application/pdf')
    const zeit = new Date(of(a).uploadedAt).getTime()
    assert.ok(zeit >= vorher - 1000 && zeit <= Date.now() + 1000, `Hochladezeit ${of(a).uploadedAt}`)
  } finally {
    s.stop()
  }
})

// Die Angaben zu einem Beleg, an den Routen vorbei: so, wie die Liste ihn beschreibt.
async function listedUpload(s: Server, file: string): Promise<UploadInfo> {
  return (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === file) ?? assert.fail(`${file} fehlt in der Liste`)
}

const putUpload = (s: Server, file: string, body: unknown) =>
  fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('Posteingang (#170): ein Beleg kommt mit Objekt, Jahr und seinem echten Namen in die Tabelle', async () => {
  await withProperties(async (s, b) => {
    const file = await uploadBelegFile(s, '%PDF-Posteingang', 'Grundsteuer (Bescheid) 2025.pdf', { propertyId: b.id, year: '2025' })
    const u = await listedUpload(s, file)
    assert.equal(u.propertyId, b.id)
    assert.equal(u.year, 2025)
    // Der Name auf der Platte ist gefiltert, der Originalname nicht.
    assert.equal(u.originalName, 'Grundsteuer (Bescheid) 2025.pdf')
    assert.equal(u.invoiceDate, null)
    // Ohne Angaben landet er im Posteingang ohne Objekt und Jahr.
    const lose = await uploadBelegFile(s, '%PDF-lose', 'lose.pdf')
    assert.equal((await listedUpload(s, lose)).propertyId, null)
  })
})

test('Posteingang (#170): ein unbekanntes Objekt oder Jahr wird abgelehnt, ohne Rest im Ordner', async () => {
  const s = await startServer()
  try {
    for (const fields of [{ propertyId: 'gibt-es-nicht' }, { year: 'zwanzig' }, { year: '0' }]) {
      const fd = new FormData()
      fd.append('file', new Blob([Buffer.from('%PDF')], { type: 'application/pdf' }), 'x.pdf')
      for (const [k, v] of Object.entries(fields)) fd.append(k, v)
      const res = await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })
      assert.ok(res.status === 400 || res.status === 404, `${JSON.stringify(fields)} → ${res.status}`)
    }
    assert.deepEqual(await s.api<UploadInfo[]>('/api/uploads'), [])
  } finally {
    s.stop()
  }
})

test('Posteingang (#170): Objekt, Jahr und Rechnungsdatum lassen sich ändern, auch bei einem Beleg ohne Zeile', async () => {
  await withProperties(async (s, b) => {
    const file = await uploadBelegFile(s, '%PDF-a', 'a.pdf')
    const ok = await putUpload(s, file, { propertyId: b.id, year: 2024, invoiceDate: '2025-02-15' })
    assert.equal(ok.status, 200)
    const u = await listedUpload(s, file)
    assert.deepEqual([u.propertyId, u.year, u.invoiceDate], [b.id, 2024, '2025-02-15'])
    // Teilweise: nur das Jahr leeren
    assert.equal((await putUpload(s, file, { year: null })).status, 200)
    assert.deepEqual([(await listedUpload(s, file)).propertyId, (await listedUpload(s, file)).year], [b.id, null])

    // Ein Beleg, zu dem die Datenbank nichts weiß (vor der Tabelle hochgeladen, aus einem alten Backup)
    const alt = '1700000000000_alt.pdf'
    fs.writeFileSync(path.join(s.dataDir, 'uploads', alt), '%PDF-alt')
    assert.equal((await listedUpload(s, alt)).propertyId, null)
    assert.equal((await putUpload(s, alt, { propertyId: 'objekt-1' })).status, 200)
    const altInfo = await listedUpload(s, alt)
    assert.equal(altInfo.propertyId, 'objekt-1')
    assert.equal(altInfo.uploadedAt, new Date(1700000000000).toISOString())

    // Abgelehnt: unbekanntes Objekt, ein Jahr, das keines ist, ein Datum, das es nicht gibt, eine fehlende Datei
    assert.equal((await putUpload(s, file, { propertyId: 'gibt-es-nicht' })).status, 404)
    assert.equal((await putUpload(s, file, { year: 2024.5 })).status, 400)
    assert.equal((await putUpload(s, file, { invoiceDate: '2025-02-31' })).status, 400)
    assert.equal((await putUpload(s, 'fehlt.pdf', { year: 2024 })).status, 404)
    assert.deepEqual([(await listedUpload(s, file)).propertyId, (await listedUpload(s, file)).invoiceDate], [b.id, '2025-02-15'])
  })
})

test('Posteingang (#170): Löschen nimmt die Angaben mit; gelöscht wird nur, was an keiner Position irgendeines Objekts hängt', async () => {
  await withProperties(async (s, b) => {
    const file = await uploadBelegFile(s, '%PDF-b', 'b.pdf', { propertyId: 'objekt-1', year: '2025' })
    // Verknüpft im **anderen** Objekt
    const item = await s.api<CostItem>(`/api/costItems?property=${b.id}`, {
      method: 'POST',
      body: JSON.stringify({ year: 2025, category: 'Grundsteuer', description: 'GS', amountCents: 100, key: 'area', invoiceFile: file }),
    })
    const verweigert = await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })
    assert.equal(verweigert.status, 409)
    await s.api(`/api/costItems/${item.id}`, { method: 'DELETE' })
    assert.equal((await fetch(`${s.base}/api/uploads/${encodeURIComponent(file)}`, { method: 'DELETE' })).status, 200)
    // Entsteht später eine Datei gleichen Namens, erbt sie nichts.
    fs.writeFileSync(path.join(s.dataDir, 'uploads', file), '%PDF-neu')
    assert.equal((await listedUpload(s, file)).propertyId, null)
  })
})

test('Backup (#170): die Angaben zu Belegen kommen mit, auf die Millisekunde', async () => {
  await withProperties(async (s, b) => {
    const file = await uploadBelegFile(s, '%PDF-c', 'Wasser Stadtwerke.pdf', { propertyId: b.id, year: '2025' })
    assert.equal((await putUpload(s, file, { invoiceDate: '2026-02-15' })).status, 200)
    const vorher = await listedUpload(s, file)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    // Danach ändern und löschen, damit das Wiederherstellen wirklich etwas zurückbringt
    assert.equal((await putUpload(s, file, { year: 2020 })).status, 200)
    assert.equal((await restore(s, backup)).status, 200)
    const nachher = await listedUpload(s, file)
    assert.deepEqual(
      [nachher.propertyId, nachher.year, nachher.invoiceDate, nachher.originalName, nachher.uploadedAt, nachher.sha256],
      [b.id, 2025, '2026-02-15', 'Wasser Stadtwerke.pdf', vorher.uploadedAt, vorher.sha256],
    )
  })
})

test('Backup (#170): ein Archiv ohne die Tabelle (nur db.json) bringt seine Belege ohne Angaben in den Posteingang', async () => {
  const s = await startServer()
  try {
    const r = await restore(s, archive({ 'uploads/1700000000000_alt.pdf': '%PDF-alt' }))
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const u = await listedUpload(s, '1700000000000_alt.pdf')
    assert.deepEqual([u.propertyId, u.year, u.originalName, u.uploadedAt], [null, null, 'alt.pdf', new Date(1700000000000).toISOString()])
    // Und die Tabelle ist da: Zuordnen geht.
    assert.equal((await putUpload(s, u.file, { year: 2023 })).status, 200)
  } finally {
    s.stop()
  }
})

test('KI-Auswertung (#170): ein Beleg aus dem Posteingang wird ausgewertet, ohne ein zweites Mal hochgeladen zu werden', async () => {
  await withOllama(async (s, ollama) => {
    const file = await uploadBelegFile(s, PDF, 'posteingang.pdf')
    const fd = new FormData()
    fd.append('existingFile', file)
    fd.append('pdfText', LONG_TEXT)
    const res = await fetch(`${s.base}/api/intake`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    const body = await jsonOf<UploadBody>(res)
    assert.equal(body.file, file)
    assert.ok(firstMessage(ollama).content.includes(LONG_TEXT))
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file], 'keine Kopie im Ordner')

    // Ein Name außerhalb des Ordners oder eine fehlende Datei wird abgelehnt.
    for (const name of ['../db.json', 'fehlt.pdf']) {
      const bad = new FormData()
      bad.append('existingFile', name)
      assert.equal((await fetch(`${s.base}/api/extract`, { method: 'POST', body: bad })).status, 400, name)
    }
  })
})

test('Belege für die Steuer (#170): ein ZIP je Objekt und Jahr nach Gruppen der Anlage V, nur dieses Objekt', async () => {
  await withProperties(async (s, b) => {
    const gs = await uploadBelegFile(s, '%PDF-gs', 'Grundsteuer.pdf')
    const verw = await uploadBelegFile(s, '%PDF-verw', 'Verwaltung.pdf')
    const fremd = await uploadBelegFile(s, '%PDF-fremd', 'Fremd.pdf')
    const post = (property: string, body: Record<string, unknown>) =>
      s.api<CostItem>(`/api/costItems?property=${property}`, { method: 'POST', body: JSON.stringify({ year: 2025, key: 'area', amountCents: 10000, ...body }) })
    await post('objekt-1', { category: 'Grundsteuer', description: 'GS', invoiceFile: gs })
    await post('objekt-1', { category: 'Nicht umlagefähig', description: 'Verwaltung', invoiceFile: verw })
    await post('objekt-1', { category: 'Grundsteuer', description: 'Vorjahr', year: 2024, invoiceFile: verw })
    await post(b.id, { category: 'Grundsteuer', description: 'GS B', invoiceFile: fremd })

    const res = await fetch(`${s.base}/api/receipts/tax/2025?property=objekt-1`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/zip')
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="belege-steuer-2025-.*\.zip"/)
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()))
    const namen = zip.getEntries().map((e) => e.entryName).sort()
    assert.deepEqual(namen, [
      '1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Grundsteuer.pdf',
      '4 Verwaltung & Instandhaltung/Nicht umlagefähig - Verwaltung.pdf',
      'Übersicht.csv',
    ])
    assert.equal(zip.readAsText('1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Grundsteuer.pdf'), '%PDF-gs')
    assert.equal((await fetch(`${s.base}/api/receipts/tax/kein-jahr?property=objekt-1`)).status, 400)
    // Ohne Objekt bei mehreren Objekten: abgelehnt statt still beide
    assert.equal((await fetch(`${s.base}/api/receipts/tax/2025`)).status, 400)
  })
})

// Vor dem Wechsel von adm-zip zu yazl auf demselben Bestand abgelesen: die Übersicht wortgleich,
// samt Byte-Order-Mark. Ein Steuerberater öffnet sie in Excel, und ohne BOM stünden dort statt
// der Umlaute Zeichensalat.
const TAX_OVERVIEW_BEFORE_YAZL = '\uFEFFGruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg\r\n'
  + 'Grundsteuer & öffentliche Abgaben;Grundsteuer;Grundsteuer B;;612,40;0,00;612,40;;1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Grundsteuerbescheid_Müll.pdf\r\n'
  + 'Verwaltung & Instandhaltung;Nicht umlagefähig;Dachrinne;;450,00;0,00;450,00;200,00;4 Verwaltung & Instandhaltung/Nicht umlagefähig - Dachrinne_Übertrag.pdf\r\n'
  + 'Sonstige Werbungskosten;Versicherung;Ohne Beleg;;300,00;0,00;300,00;;kein Beleg\r\n'

test('Belege für die Steuer: Inhalt, Namen und Übersicht sind mit yazl dieselben wie vorher mit adm-zip', async () => {
  await withProperties(async (s) => {
    const dir = path.join(s.dataDir, 'uploads')
    const files = { gs: '1700000000000_Grundsteuerbescheid_Müll.pdf', dach: '1700000000001_Dachrinne_Übertrag.pdf' }
    fs.writeFileSync(path.join(dir, files.gs), '%PDF-Grundsteuer äöü')
    fs.writeFileSync(path.join(dir, files.dach), Buffer.from(Array.from({ length: 70000 }, (_, i) => (i * 31) % 251)))
    const post = (body: Record<string, unknown>) =>
      s.api<CostItem>('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({ year: 2025, key: 'area', amountCents: 10000, ...body }) })
    await post({ category: 'Grundsteuer', description: 'Grundsteuer B', amountCents: 61240, invoiceFile: files.gs })
    await post({ category: 'Nicht umlagefähig', description: 'Dachrinne', amountCents: 45000, invoiceFile: files.dach, labor35aCents: 20000 })
    await post({ category: 'Versicherung', description: 'Ohne Beleg', amountCents: 30000 })
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/receipts/tax/2025?property=objekt-1`)).arrayBuffer()))
    const entries = zip.getEntries()
    for (const e of entries) assert.ok(e.header.flags & 0x800, `${e.entryName}: Name nicht als UTF-8 gekennzeichnet`)
    // Ein Steuerberater öffnet das Archiv mit beliebigen Werkzeugen, auch solchen, die es als Strom
    // lesen. Manche (busybox unzip) kennen gar keinen Datendeskriptor (Bit 3), andere (funzip, Java
    // ZipInputStream) finden das Ende eines gespeicherten Eintrags damit nicht. Deshalb keiner.
    for (const e of entries) assert.equal(e.header.flags & 0x8, 0, `${e.entryName}: mit Datendeskriptor`)
    assert.deepEqual(entries.map((e) => e.entryName), [
      '1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Grundsteuerbescheid_Müll.pdf',
      '4 Verwaltung & Instandhaltung/Nicht umlagefähig - Dachrinne_Übertrag.pdf',
      'Übersicht.csv',
    ])
    assert.ok(entries[0].getData().equals(fs.readFileSync(path.join(dir, files.gs))))
    assert.ok(entries[1].getData().equals(fs.readFileSync(path.join(dir, files.dach))))
    const csv = entries[2].getData()
    assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Byte-Order-Mark')
    assert.equal(csv.toString('utf8'), TAX_OVERVIEW_BEFORE_YAZL)
  })
})

test('Belege für die Steuer: die Übersicht teilt jede Position in privat und abziehbar wie die Steuerübersicht (#163)', async () => {
  // Integrationsdurchsicht: Die CSV im ZIP nannte nur den Bruttobetrag. Bei teilweiser
  // Eigennutzung weist die Steuerübersicht privat und abziehbar getrennt aus, und gerade diese
  // Aufteilung braucht der Steuerberater neben den Belegen.
  await withProperties(async (s) => {
    const unit = (body: Record<string, unknown>) => s.api<Unit>('/api/units?property=objekt-1', { method: 'POST', body: JSON.stringify(body) })
    const eigen = await unit({ name: 'Eigen', areaM2: 60, participates: false, selfUsed: true })
    await unit({ name: 'Vermietet', areaM2: 40, participates: true })
    const post = (body: Record<string, unknown>) =>
      s.api<CostItem>('/api/costItems?property=objekt-1', { method: 'POST', body: JSON.stringify({ year: 2025, key: 'area', amountCents: 10000, ...body }) })
    await post({ category: 'Grundsteuer', description: 'GS', amountCents: 50000 })
    await post({ category: 'Nicht umlagefähig', description: 'Dach', amountCents: 200000 })
    await post({ category: 'Nicht umlagefähig', description: 'Bad Eigen', amountCents: 80000, key: 'direct', directUnitId: eigen.id })

    const tax = await s.api<TaxReport>('/api/taxreport/2025?property=objekt-1')
    assert.ok(tax.expenses.privateCents > 0, 'Vorbedingung: es gibt einen privaten Teil')
    const res = await fetch(`${s.base}/api/receipts/tax/2025?property=objekt-1`)
    assert.equal(res.status, 200)
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()))
    const [head, ...rows] = zip.readAsText('Übersicht.csv').replace(/^\uFEFF/, '').trim().split('\r\n').map((z) => z.split(';'))
    if (!head) return assert.fail('Übersicht ohne Kopfzeile')
    const col = (name: string) => {
      const i = head.indexOf(name)
      if (i < 0) assert.fail(`Spalte „${name}“ fehlt: ${head.join(';')}`)
      return i
    }
    const cents = (v: string | undefined) => Math.round(Number((v ?? '').replace(',', '.')) * 100)
    const [desc, priv, abz] = [col('Beschreibung'), col('privat (EUR)'), col('abziehbar (EUR)')]
    for (const item of tax.expenses.items) {
      const row = rows.find((r) => r[desc] === item.description)
      if (!row) return assert.fail(`Position ${item.description} fehlt in der Übersicht`)
      assert.deepEqual([cents(row[priv]), cents(row[abz])], [item.privateCents, item.deductibleCents], item.description)
    }
    const sum = (i: number) => rows.reduce((a, r) => a + cents(r[i]), 0)
    assert.deepEqual([sum(priv), sum(abz)], [tax.expenses.privateCents, tax.expenses.deductibleCents])
  })
})

test('Posteingang (#170): PUT nimmt nur einen Beleg im Ordner, keinen Verzeichnisnamen', async () => {
  // Durchsicht: „..“ besteht `basename` und `existsSync` und legte eine Zeile an.
  const s = await startServer()
  try {
    // Kodiert, sonst kürzt schon fetch den Pfad weg
    for (const name of ['%2E%2E', '%2E']) {
      const res = await fetch(`${s.base}/api/uploads/${name}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: 2024 }) })
      assert.equal(res.status, 404, name)
    }
  } finally {
    s.stop()
  }
})

test('Belegarchiv (#180): DELETE auf einen Verzeichnisnamen antwortet 404 statt 500 und löscht nichts', async () => {
  // „..“ besteht `basename` und `existsSync`; danach zielte `unlinkSync` auf den Datenordner und
  // scheiterte mit 500. Ebenso ein Unterordner im Belegordner. Gelöscht wurde dabei nichts.
  const s = await startServer()
  try {
    const file = await uploadBelegFile(s, '%PDF-x', 'x.pdf')
    fs.mkdirSync(path.join(s.dataDir, 'uploads', 'unterordner'))
    for (const name of ['%2E%2E', '%2E', 'unterordner']) {
      const res = await fetch(`${s.base}/api/uploads/${name}`, { method: 'DELETE' })
      assert.equal(res.status, 404, name)
    }
    assert.ok(fs.statSync(path.join(s.dataDir, 'uploads', 'unterordner')).isDirectory())
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file])
  } finally {
    s.stop()
  }
})

test('Belegordner (Durchsicht): ein Unterordner oder Fremdes im Belegordner bricht die Liste nicht ab', async () => {
  const s = await startServer()
  try {
    const file = await uploadBelegFile(s, '%PDF-x', 'x.pdf')
    fs.mkdirSync(path.join(s.dataDir, 'uploads', 'unterordner'))
    const res = await fetch(`${s.base}/api/uploads`)
    assert.equal(res.status, 200)
    assert.deepEqual((await jsonOf<UploadInfo[]>(res)).map((u) => u.file), [file])
  } finally {
    s.stop()
  }
})

test('Belegordner (Durchsicht): die Prüfsumme eines Belegs ohne Zeile wird einmal gerechnet und festgeschrieben', async () => {
  // Vorher rechnete jeder Start sie neu, synchron und im Speicher, und eine große Altablage hielt
  // dabei den ganzen Server an.
  const s = await startServer()
  try {
    const alt = '1700000000000_alt.pdf'
    const voll = path.join(s.dataDir, 'uploads', alt)
    fs.writeFileSync(voll, '%PDF-alt')
    const erwartet = createHash('sha256').update('%PDF-alt').digest('hex')
    let info: UploadInfo | undefined
    for (let i = 0; i < 50; i++) {
      info = (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === alt)
      if (info?.sha256) break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.equal(info?.sha256, erwartet, 'im Hintergrund nachgetragen')
    // Festgeschrieben: Auch wenn sich die Datei danach ändert, gilt die Zeile, ohne neu zu lesen.
    fs.writeFileSync(voll, '%PDF-anders')
    assert.equal((await listedUpload(s, alt)).sha256, erwartet)
  } finally {
    s.stop()
  }
})

test('Abbrechen per Kennung (#170): ein Beleg aus dem Posteingang bleibt samt Angaben liegen', async () => {
  await withOllama(async (s, ollama) => {
    const file = await uploadBelegFile(s, PDF, 'posteingang.pdf', { year: '2025' })
    const requestId = 'fedcba9876543210fedcba9876543210'
    const fd = new FormData()
    fd.append('existingFile', file)
    fd.append('pdfText', LONG_TEXT)
    fd.append('requestId', requestId)
    const pending = fetch(`${s.base}/api/extract`, { method: 'POST', body: fd, headers: { accept: 'application/x-ndjson' } }).then((r) => r.text())
    assert.ok(await until(() => chatRequests(ollama).length > 0), 'Ollama wurde nicht gefragt')
    assert.equal((await fetch(`${s.base}/api/ai/cancel/${requestId}`, { method: 'POST' })).status, 200)
    assert.ok(await until(() => ollama.closedEarly > 0), 'die Anfrage an Ollama lief weiter')
    await pending
    const u = await listedUpload(s, file)
    assert.equal(u.year, 2025, 'die Zeile ist noch da')
    assert.ok(fs.existsSync(path.join(s.dataDir, 'uploads', file)), 'die Datei ist noch da')
  }, { chat: 'hang' })
})

test('Schuhkarton (#170): ein Zählerfoto ist kein Beleg und steht nicht im Posteingang des Objekts', async () => {
  await withOllama(async (s) => {
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('JPEG-Zaehler')], { type: 'image/jpeg' }), 'zaehler.jpg')
    fd.append('propertyId', 'objekt-1')
    const res = await fetch(`${s.base}/api/intake`, { method: 'POST', body: fd })
    assert.equal(res.status, 200)
    const body = await jsonOf<UploadBody & { kind?: string }>(res)
    assert.equal(body.kind, 'zaehler')
    const u = await listedUpload(s, fileOf(body))
    assert.equal(u.kind, 'meterPhoto')
    assert.equal(u.propertyId, null, 'ohne Objekt, damit es in keinem Posteingang als Beleg steht')
    // Ein gewöhnlicher Beleg bleibt ein Beleg
    const beleg = await uploadBelegFile(s, '%PDF-b', 'b.pdf')
    assert.equal((await listedUpload(s, beleg)).kind, 'receipt')
  }, { chat: 'meter' })
})

// ---------- Belegbuchung (#170): die Routen ----------

test('Belegbuchung: Auswerten speichert die Auswertung mit Vorschlag; nach dem Neuladen ist sie offen abrufbar', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'WASSER', { year: '2024' }))
    assert.equal(a.year, 2026, 'das Jahr aus dem Beleg geht vor dem gewählten')
    assert.equal(a.propertyId, 'objekt-1', 'mit einem Objekt gilt dieses')
    // Aus einem anderen Jahr als dem gewählten: gelb und nicht vorab angehakt (Schlussdurchsicht, I1).
    assert.deepEqual(a.lines.map((l) => [l.description, l.amountCents, l.state, l.suggestion?.level, l.suggestion?.preselected]), [
      ['Frischwasser', 70000, 'open', 'gelb', false], ['Abwasser', 80000, 'open', 'gelb', false],
    ])
    const offen = await s.api<AssessmentView[]>('/api/assessments?open=1')
    assert.deepEqual(offen.map((x) => x.id), [a.id])
    assert.equal((await s.api<AssessmentView>(`/api/assessments/${a.id}`)).file, a.file)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: eine gescheiterte Auswertung speichert nichts', async () => {
  await withOllama(async (s) => {
    const fd = new FormData()
    fd.append('file', new Blob([PDF], { type: 'application/pdf' }), 'fehler.pdf')
    fd.append('pdfText', 'Rechnung WASSER')
    const res = await fetch(`${s.base}/api/extract`, { method: 'POST', body: fd })
    assert.equal(res.status, 502)
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments'), [])
  }, { invoices: RECHNUNGEN, chat: 'error' })
})

test('Belegbuchung: Doppelklick und zwei Tabs zugleich ergeben eine Position', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    assert.deepEqual(preview.errors, [])
    const [x, y] = await Promise.all([
      postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token }),
      postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token }),
    ])
    assert.deepEqual([x.status, y.status], [200, 200])
    const changed = [(await jsonOf<{ changed: boolean }>(x)).changed, (await jsonOf<{ changed: boolean }>(y)).changed].sort()
    assert.deepEqual(changed, [false, true])
    const again = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })
    assert.equal((await jsonOf<{ changed: boolean }>(again)).changed, false, 'eine Wiederholung nach einem Netzfehler bucht nicht noch einmal')
    const items = await s.api<CostItem[]>('/api/costItems')
    assert.deepEqual(items.map((i) => [i.amountCents, i.invoiceFile]), [[61240, a.file]])
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments?open=1'), [], 'gebucht ist nicht mehr offen')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: ohne Vorschau keine Buchung; anders gebucht ergibt 409 mit dem Stand; Unlesbares 400', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions })).status, 400)
    assert.equal((await postJson(s, `/api/assessments/${a.id}/plan`, { decisions: [{ idx: 0, action: 'zaubern' }] })).status, 400)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
    const anders = await postJson(s, `/api/assessments/${a.id}/book`, { decisions: [{ idx: 0, action: 'dismiss' }], token: 'egal' })
    assert.equal(anders.status, 409)
    const body = await jsonOf<{ error: string, assessment: AssessmentView }>(anders)
    assert.match(body.error, /schon gebucht/)
    assert.equal(body.assessment.lines[0]?.state, 'created')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: gebucht wird im Objekt der Auswertung, nicht im gewählten; ihr Objekt ist danach fest', async () => {
  await withOllama(async (s) => {
    const zweites = await jsonOf<Property>(await postJson(s, '/api/properties', { name: 'Zweites Haus' }))
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { propertyId: 'objekt-1' }))
    assert.equal(a.propertyId, 'objekt-1')
    const decisions = grundsteuer(a)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan?property=${zweites.id}`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book?property=${zweites.id}`, { decisions, token: preview.token })).status, 200)
    assert.equal((await s.api<CostItem[]>('/api/costItems?property=objekt-1')).length, 1)
    assert.equal((await s.api<CostItem[]>(`/api/costItems?property=${zweites.id}`)).length, 0)
    const put = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ propertyId: zweites.id }) })
    assert.equal(put.status, 409)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: ist die Datei weg, fehlt die Auswertung in der Liste, und Vorschau wie Buchung antworten 404', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    fs.rmSync(path.join(s.dataDir, 'uploads', a.file))
    assert.deepEqual(await s.api<AssessmentView[]>('/api/assessments?open=1'), [])
    const plan = await postJson(s, `/api/assessments/${a.id}/plan`, { decisions: grundsteuer(a) })
    assert.equal(plan.status, 404)
    assert.match((await jsonOf<{ error: string }>(plan)).error, /gibt es im Belegordner nicht mehr/)
    const book = await postJson(s, `/api/assessments/${a.id}/book`, { decisions: grundsteuer(a), token: 'egal' })
    assert.equal(book.status, 404)
    assert.match((await jsonOf<{ error: string }>(book)).error, /gibt es im Belegordner nicht mehr/)
    assert.equal((await fetch(`${s.base}/api/assessments/${a.id}`)).status, 404)
    assert.deepEqual(await s.api<CostItem[]>('/api/costItems'), [], 'gebucht wurde nichts')
  }, { invoices: RECHNUNGEN })
})

// Entscheidungen des Steuerers zu Task 4

test('Belegbuchung: eine veraltete Vorschau ergibt 409 mit der neuen Vorschau, gebucht wird nichts', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    const fresh = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    const res = await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: 'eine-alte-marke' })
    assert.equal(res.status, 409)
    const body = await jsonOf<{ error: string, preview?: BookingPreview }>(res)
    assert.match(body.error, /neue Vorschau/)
    const preview = body.preview ?? assert.fail('die neue Vorschau fehlt in der Antwort')
    assert.equal(preview.token, fresh.token, 'mit der mitgeschickten Marke lässt sich ohne zweite Anfrage buchen')
    assert.deepEqual(await s.api<CostItem[]>('/api/costItems'), [])
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: nach einer Buchung lassen sich weder Objekt noch Jahr der Auswertung ändern, und die Meldung sagt beides', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const decisions = grundsteuer(a)
    const preview = await jsonOf<BookingPreview>(await postJson(s, `/api/assessments/${a.id}/plan`, { decisions }))
    assert.equal((await postJson(s, `/api/assessments/${a.id}/book`, { decisions, token: preview.token })).status, 200)
    const put = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: a.year + 1 }) })
    assert.equal(put.status, 409)
    const { error } = await jsonOf<{ error: string }>(put)
    assert.match(error, /Objekt/)
    assert.match(error, /Jahr/)
    assert.match(error, /Lösen Sie/, 'sagt, was zu tun ist')
    assert.equal((await s.api<AssessmentView>(`/api/assessments/${a.id}`)).year, a.year)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: ohne Buchung ändert PUT Jahr und Objekt der Auswertung', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER'))
    const put = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: 2024 }) })
    assert.equal(put.status, 200)
    assert.equal((await jsonOf<AssessmentView>(put)).year, 2024)
    const falsch = await fetch(`${s.base}/api/assessments/${a.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: 'zwanzig' }) })
    assert.equal(falsch.status, 400)
    const fehlt = await fetch(`${s.base}/api/assessments/gibt-es-nicht`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ year: 2024 }) })
    assert.equal(fehlt.status, 404)
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: das Jahr der Auswertung wird zum Jahr des Belegs im Posteingang, solange nichts gebucht ist', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'WASSER', { year: '2024' }))
    assert.equal(a.year, 2026)
    const beleg = (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === a.file) ?? assert.fail('der Beleg fehlt im Ordner')
    assert.equal(beleg.year, 2026, 'der Posteingang zeigt den Beleg im Jahr, das er selbst nennt')
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: eine Rechnung vom Februar ohne Leistungszeitraum, ausgewertet aus dem Vorjahr, ist gelb und nicht vorab angehakt', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'VORJAHR', { year: '2024' }))
    assert.deepEqual([a.detectedYear, a.year, a.requestedPeriod], [2025, 2025, '2024-01'], 'gebucht wird im Jahr des Belegs, das gewählte ist gespeichert')
    const s0 = a.lines[0]?.suggestion ?? assert.fail('kein Vorschlag')
    assert.deepEqual([s0.level, s0.preselected], ['gelb', false])
    assert.ok(s0.reasons.some((r) => /2025/.test(r) && /2024/.test(r)), s0.reasons.join('\n'))
    // Nach dem Neuladen derselbe Befund: Er hängt am gespeicherten Jahr, nicht am Tab.
    const again = await s.api<AssessmentView>(`/api/assessments/${a.id}`)
    assert.deepEqual([again.lines[0]?.suggestion?.level, again.lines[0]?.suggestion?.preselected], ['gelb', false])
    // Wer das Jahr ausdrücklich wählt, hat entschieden: Danach weicht nichts mehr ab.
    const put = await putJson(s, `/api/assessments/${a.id}`, { year: 2025 })
    assert.equal(put.status, 200)
    const chosen = await jsonOf<AssessmentView>(put)
    assert.deepEqual([chosen.requestedPeriod, chosen.lines[0]?.suggestion?.level, chosen.lines[0]?.suggestion?.preselected], ['2025-01', 'gruen', true])
  }, { invoices: RECHNUNGEN })
})

test('Belegbuchung: PUT auf die Auswertung eines gelöschten Belegs antwortet 404 und schreibt nichts', async () => {
  await withOllama(async (s) => {
    const a = assessmentOf(await evaluate(s, 'GRUNDSTEUER', { year: '2025' }))
    fs.rmSync(path.join(s.dataDir, 'uploads', a.file))
    const res = await putJson(s, `/api/assessments/${a.id}`, { year: 2023 })
    assert.equal(res.status, 404)
    assert.match((await jsonOf<{ error: string }>(res)).error, /gibt es im Belegordner nicht mehr/)
    const stored = await inDatabase(s, async (db) => db.select({ id: assessmentsTable.id, year: assessmentsTable.year }).from(assessmentsTable))
    assert.deepEqual(stored.filter((r) => r.id === a.id).map((r) => r.year), [2025], 'das Jahr der Auswertung ist unverändert')
    const row = await inDatabase(s, async (db) => db.select({ file: uploadsTable.file, year: uploadsTable.year }).from(uploadsTable))
    assert.deepEqual(row.filter((r) => r.file === a.file).map((r) => r.year), [2025], 'die Zeile des Belegs ist nicht verschoben')
  }, { invoices: RECHNUNGEN })
})
