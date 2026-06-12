import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { getDb, save, newId, reloadDb, UPLOAD_DIR, DATA_DIR } from './store.js'
import { computeSettlement, consumptionOverview } from './calc.js'
import { extractFromFile, listOllamaModels } from './extract.js'

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
for (const coll of ['units', 'tenancies', 'costItems', 'meters', 'readings']) {
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
      db.tenancies = db.tenancies.filter((t) => t.unitId !== req.params.id)
      const meterIds = db.meters.filter((m) => m.unitId === req.params.id).map((m) => m.id)
      db.meters = db.meters.filter((m) => m.unitId !== req.params.id)
      db.readings = db.readings.filter((r) => !meterIds.includes(r.meterId))
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

// ---------- Frontend (Produktions-Build), falls vorhanden ----------
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist')
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

// Bewusst NKA_PORT statt PORT: generische PORT-Variablen (z. B. von Preview-Tools)
// sind für das Frontend gedacht und würden hier mit Vite kollidieren.
const PORT = process.env.NKA_PORT || 3001
app.listen(PORT, () => console.log(`NKA-Server läuft auf http://localhost:${PORT}`))
