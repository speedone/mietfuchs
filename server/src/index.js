import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { getDb, save, newId, reloadDb, UPLOAD_DIR, DATA_DIR } from './store.js'
import { computeSettlement, consumptionOverview, rentLedger, taxReport } from './calc.js'
import { extractFromFile, classifyDocType, extractMeterReading, listOllamaModels } from './extract.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-äöüÄÖÜß]/g, '_')
      cb(null, `${Date.now()}_${safe}`)
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
})

// ---------- Einstellungen ----------
app.get('/api/settings', (req, res) => res.json(getDb().settings))
app.put('/api/settings', (req, res) => {
  Object.assign(getDb().settings, req.body)
  save()
  res.json(getDb().settings)
})

// ---------- Generische CRUD-Routen für Stammdaten & Kosten ----------
for (const coll of ['units', 'tenancies', 'costItems', 'meters', 'readings', 'payments']) {
  app.get(`/api/${coll}`, (req, res) => res.json(getDb()[coll]))
  app.post(`/api/${coll}`, (req, res) => {
    const item = { ...req.body, id: newId() }
    getDb()[coll].push(item)
    save()
    res.status(201).json(item)
  })
  app.put(`/api/${coll}/:id`, (req, res) => {
    const item = getDb()[coll].find((x) => x.id === req.params.id)
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' })
    Object.assign(item, req.body, { id: item.id })
    save()
    res.json(item)
  })
  app.delete(`/api/${coll}/:id`, (req, res) => {
    const db = getDb()
    const before = db[coll].length
    db[coll] = db[coll].filter((x) => x.id !== req.params.id)
    if (coll === 'units') {
      // Abhängige Daten einer gelöschten Wohnung mit entfernen
      const tenancyIds = db.tenancies.filter((t) => t.unitId === req.params.id).map((t) => t.id)
      db.tenancies = db.tenancies.filter((t) => t.unitId !== req.params.id)
      db.payments = (db.payments ?? []).filter((p) => !tenancyIds.includes(p.tenancyId))
      const meterIds = db.meters.filter((m) => m.unitId === req.params.id).map((m) => m.id)
      db.meters = db.meters.filter((m) => m.unitId !== req.params.id)
      db.readings = db.readings.filter((r) => !meterIds.includes(r.meterId))
    }
    if (coll === 'tenancies') {
      db.payments = (db.payments ?? []).filter((p) => p.tenancyId !== req.params.id)
    }
    if (coll === 'meters') {
      db.readings = db.readings.filter((r) => r.meterId !== req.params.id)
    }
    if (db[coll].length === before) return res.status(404).json({ error: 'Nicht gefunden' })
    save()
    res.json({ ok: true })
  })
}

// ---------- Abrechnung ----------
// Liefert die abgeschlossene (eingefrorene) Abrechnung, falls vorhanden — sonst live berechnet.
app.get('/api/settlement/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const closed = (getDb().closedSettlements ?? []).find((c) => c.year === year)
  if (closed) return res.json({ ...closed.settlement, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt ?? null } })
  res.json({ ...computeSettlement(getDb(), year), closed: null })
})

// Abrechnung abschließen: aktuellen Berechnungsstand einfrieren. Spätere Änderungen an
// Kosten/Stammdaten verändern eine bereits verschickte Abrechnung dann nicht mehr still.
app.post('/api/settlement/:year/close', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  const db = getDb()
  if ((db.closedSettlements ?? []).some((c) => c.year === year)) {
    return res.status(409).json({ error: `Abrechnung ${year} ist bereits abgeschlossen.` })
  }
  db.closedSettlements.push({
    id: newId(),
    year,
    closedAt: new Date().toISOString(),
    sentAt: req.body?.sentAt ?? null,
    settlement: computeSettlement(db, year),
  })
  save()
  res.status(201).json({ ok: true })
})

// Versanddatum nachtragen (für die §556-Frist)
app.put('/api/settlement/:year/close', (req, res) => {
  const year = Number(req.params.year)
  const closed = (getDb().closedSettlements ?? []).find((c) => c.year === year)
  if (!closed) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  closed.sentAt = req.body?.sentAt ?? null
  save()
  res.json({ ok: true })
})

// Wieder öffnen (Snapshot verwerfen, es gilt wieder die Live-Berechnung)
app.delete('/api/settlement/:year/close', (req, res) => {
  const year = Number(req.params.year)
  const db = getDb()
  const before = (db.closedSettlements ?? []).length
  db.closedSettlements = (db.closedSettlements ?? []).filter((c) => c.year !== year)
  if (db.closedSettlements.length === before) return res.status(404).json({ error: 'Abrechnung ist nicht abgeschlossen.' })
  save()
  res.json({ ok: true })
})

app.get('/api/consumption/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(consumptionOverview(getDb(), year))
})

// Mietkonto: Soll/Ist je Monat und Mietverhältnis für das Jahr
app.get('/api/rentledger/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(rentLedger(getDb(), year))
})

// Steuer-Übersicht (Hilfe für die Anlage V): Einnahmen, Werbungskosten, Überschuss
app.get('/api/taxreport/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(taxReport(getDb(), year))
})

// ---------- Belege & KI-Auswertung ----------
app.use('/uploads', express.static(UPLOAD_DIR))

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  res.json({ file: req.file.filename })
})

app.post('/api/extract', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  try {
    const result = await extractFromFile(req.file.path, req.file.mimetype, getDb().settings)
    res.json({ file: req.file.filename, extraction: result })
  } catch (err) {
    res.status(502).json({ file: req.file.filename, error: String(err.message || err) })
  }
})

// Universeller Eingang (Schuhkarton): erkennt automatisch, ob die Datei eine Rechnung oder
// ein Zählerfoto ist, und liefert die passende KI-Auswertung. Antwort ist eine diskriminierte
// Union über `kind`. `/api/extract` bleibt für die (rein rechnungsbezogene) Kosten-Seite.
app.post('/api/intake', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  try {
    const settings = getDb().settings
    const docType = await classifyDocType(req.file.path, req.file.mimetype, settings)
    if (docType === 'zaehlerstand') {
      const reading = await extractMeterReading(req.file.path, req.file.mimetype, settings)
      res.json({ file: req.file.filename, kind: 'zaehler', reading })
    } else {
      const extraction = await extractFromFile(req.file.path, req.file.mimetype, settings)
      res.json({ file: req.file.filename, kind: 'rechnung', extraction })
    }
  } catch (err) {
    res.status(502).json({ file: req.file.filename, error: String(err.message || err) })
  }
})

// Belegarchiv: alle hochgeladenen Dateien mit Größe und Datum
app.get('/api/uploads', (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR).map((name) => {
    const st = fs.statSync(path.join(UPLOAD_DIR, name))
    return { file: name, size: st.size, mtime: st.mtime.toISOString() }
  })
  res.json(files)
})

// Beleg löschen — nur wenn keine Kostenposition mehr darauf verweist
app.delete('/api/uploads/:file', (req, res) => {
  const name = path.basename(req.params.file) // verhindert Pfad-Ausbrüche
  const full = path.join(UPLOAD_DIR, name)
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Datei nicht gefunden' })
  if (getDb().costItems.some((c) => c.invoiceFile === name)) {
    return res.status(409).json({ error: 'Beleg ist noch mit Kostenpositionen verknüpft.' })
  }
  fs.unlinkSync(full)
  res.json({ ok: true })
})

// ---------- Backup & Wiederherstellen ----------
app.get('/api/backup', (req, res) => {
  save() // sicherstellen, dass der letzte Stand auf der Platte liegt
  const zip = new AdmZip()
  zip.addLocalFile(path.join(DATA_DIR, 'db.json'))
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    zip.addLocalFile(path.join(UPLOAD_DIR, name), 'uploads')
  }
  const stamp = new Date().toISOString().slice(0, 10)
  res.set('Content-Type', 'application/zip')
  res.set('Content-Disposition', `attachment; filename="nebenkosten-backup-${stamp}.zip"`)
  res.send(zip.toBuffer())
})

const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } })
app.post('/api/restore', restoreUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' })
  let zip
  try {
    zip = new AdmZip(req.file.buffer)
  } catch {
    return res.status(400).json({ error: 'Datei ist kein gültiges ZIP-Archiv.' })
  }
  const dbEntry = zip.getEntry('db.json')
  if (!dbEntry) return res.status(400).json({ error: 'Im Archiv fehlt die db.json — ist das wirklich ein Backup dieses Tools?' })
  try {
    JSON.parse(zip.readAsText(dbEntry))
  } catch {
    return res.status(400).json({ error: 'Die db.json im Archiv ist beschädigt (kein gültiges JSON).' })
  }
  // Sicherheitskopie des aktuellen Stands, dann ersetzen
  fs.copyFileSync(path.join(DATA_DIR, 'db.json'), path.join(DATA_DIR, 'db.json.vor-restore'))
  fs.writeFileSync(path.join(DATA_DIR, 'db.json'), zip.readAsText(dbEntry), 'utf8')
  for (const entry of zip.getEntries()) {
    // Nur Dateien unterhalb von uploads/ übernehmen, Pfad-Ausbrüche abwehren
    if (entry.isDirectory || !entry.entryName.startsWith('uploads/')) continue
    const name = path.basename(entry.entryName)
    if (!name) continue
    fs.writeFileSync(path.join(UPLOAD_DIR, name), entry.getData())
  }
  reloadDb()
  res.json({ ok: true })
})

app.get('/api/ollama/status', async (req, res) => {
  try {
    const models = await listOllamaModels(getDb().settings)
    res.json({ ok: true, models })
  } catch (err) {
    res.json({ ok: false, error: String(err.message || err) })
  }
})

// ---------- Frontend (Produktions-Build) ----------
// Gepackte Binary (Bun --compile): das Frontend ist ins Binary eingebettet und wird
// aus dem generierten Modul embedded-client.js ausgeliefert (siehe scripts/embed-client.mjs).
// Im npm-/Dev-Betrieb kommt es wie gehabt von der Platte aus client/dist.
const PACKAGED = !!globalThis.Bun
if (PACKAGED) {
  const { embeddedFiles, mimeFor } = await import('./embedded-client.js')
  const sendEmbedded = (res, urlPath) => {
    const embedded = embeddedFiles[urlPath]
    if (!embedded) return false
    res.type(mimeFor(urlPath)).send(fs.readFileSync(embedded))
    return true
  }
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    // exakter Treffer, sonst SPA-Fallback auf index.html
    if (sendEmbedded(res, req.path === '/' ? '/index.html' : req.path)) return
    sendEmbedded(res, '/index.html') || res.status(404).send('Nicht gefunden')
  })
} else {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist')
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist))
    app.get(/^(?!\/api|\/uploads).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')))
  }
}

// Standard-Browser mit der App öffnen (nur in der gepackten Binary — im Dev stört das).
function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref()
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* egal — Nutzer kann die URL notfalls von Hand öffnen */
  }
}

// Bewusst NKA_PORT statt PORT: generische PORT-Variablen (z. B. von Preview-Tools)
// sind für das Frontend gedacht und würden hier mit Vite kollidieren.
const PORT = process.env.NKA_PORT || 3001
const server = app.listen(PORT, () => {
  // Bewusst 127.0.0.1 statt localhost: Unter Windows löst "localhost" zuerst auf IPv6
  // (::1) auf. Der Server lauscht auf IPv4 (0.0.0.0), und auf ::1 kann ein anderer
  // Dienst sitzen (z. B. WSLs wslrelay), der dann 404 liefert. 127.0.0.1 erzwingt IPv4.
  const url = `http://127.0.0.1:${PORT}`
  console.log(`Mietfuchs-Server läuft auf ${url}`)
  if (PACKAGED) {
    console.log('Fenster offen lassen, solange Mietfuchs läuft. Zum Beenden dieses Fenster schließen.')
    openBrowser(url)
  }
})
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist bereits belegt. Läuft Mietfuchs vielleicht schon? Sonst mit NKA_PORT einen anderen Port setzen.`)
  } else {
    console.error(err)
  }
  if (PACKAGED) setTimeout(() => process.exit(1), 10000) // Fenster kurz offen lassen, damit man die Meldung liest
  else process.exit(1)
})
