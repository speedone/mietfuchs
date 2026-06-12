import express from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getDb, save, newId, UPLOAD_DIR } from './store.js'
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
app.get('/api/settlement/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Ungültiges Jahr' })
  res.json(computeSettlement(getDb(), year))
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
