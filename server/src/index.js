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
import { healthReport } from './health.js'
import { createUpdateChecker, UPDATE_URL } from './update.js'
import { APP_VERSION, RUNTIME } from './version.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

// Belege landen im Belegarchiv auf der Platte. Seitenbilder, die der Browser aus einem
// gescannten PDF rendert (Feld `pages`), braucht nur die KI-Auswertung: Sie bleiben im
// Arbeitsspeicher und tauchen nie im Belegarchiv auf.
const aufPlatte = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    // NFC: macOS liefert „ü“ gern zerlegt als „u“ plus Trema, das der Filter sonst zerschnitte
    const safe = file.originalname.normalize('NFC').replace(/[^\w.\-äöüÄÖÜß]/g, '_')
    cb(null, `${Date.now()}_${safe}`)
  },
})
const imSpeicher = multer.memoryStorage()
const speicherFuer = (file) => (file.fieldname === 'pages' ? imSpeicher : aufPlatte)
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024
const upload = multer({
  storage: {
    _handleFile: (req, file, cb) => speicherFuer(file)._handleFile(req, file, cb),
    _removeFile: (req, file, cb) => speicherFuer(file)._removeFile(req, file, cb),
  },
  limits: { fileSize: UPLOAD_MAX_BYTES },
  // Browser schicken Dateinamen als UTF-8. Mit dem Standard latin1 zerfiel „Müll.pdf“ zu
  // „M__ll.pdf“, weil jedes Byte des Umlauts einzeln ersetzt wurde.
  defParamCharset: 'utf8',
})

// Beleg plus Material für die KI-Auswertung: höchstens vier Seitenbilder (so viele rendert
// der Browser) und die Textebene im Feld `pdfText`.
const MAX_SEITEN = 4
// Echte Seitenbilder sind deutlich unter 1 MB. Die Grenze hält den Arbeitsspeicher klein, denn
// Seitenbilder werden dort gehalten und für Ollama noch einmal als Base64 kopiert.
const SEITE_MAX_BYTES = 5 * 1024 * 1024
const seitenPruefen = (req, res, next) => {
  if (!(req.files?.pages ?? []).some((p) => p.size > SEITE_MAX_BYTES)) return next()
  // Der Beleg liegt da schon auf der Platte: wieder entfernen, sonst bliebe ein Rest im Archiv
  const beleg = req.files?.file?.[0]
  if (beleg) fs.rmSync(beleg.path, { force: true })
  res.status(400).json({ error: 'Ein Seitenbild ist größer als 5 MB.' })
}
const belegMitSeiten = [upload.fields([{ name: 'file', maxCount: 1 }, { name: 'pages', maxCount: MAX_SEITEN }]), seitenPruefen]
const belegAus = (req) => req.files?.file?.[0] ?? null
const auswertungAus = (req) => ({
  pdfText: typeof req.body?.pdfText === 'string' ? req.body.pdfText : '',
  pages: (req.files?.pages ?? [])
    .filter((p) => p.mimetype.startsWith('image/'))
    .map((p) => p.buffer.toString('base64')),
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
      // Vereinbarte Prozentanteile auf die gelöschte Wohnung entfernen, damit keine
      // verwaisten Verweise in den Kostenpositionen zurückbleiben.
      for (const c of db.costItems) {
        if (c.customShares && req.params.id in c.customShares) delete c.customShares[req.params.id]
      }
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
  // Vor dieser Version eingefrorene Snapshots kennen selfUsedShareCents noch nicht — mit 0
  // vorbelegen, damit die Antwort immer der Form in types.ts entspricht.
  if (closed) return res.json({ selfUsedShareCents: 0, ...closed.settlement, closed: { closedAt: closed.closedAt, sentAt: closed.sentAt ?? null } })
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

// PDFs liest der Browser vor dem Hochladen (client/src/pdfIntake.ts): Er schickt die Textebene
// mit und bei Scans die gerenderten Seiten. Der Server öffnet selbst keine PDFs.
app.post('/api/extract', belegMitSeiten, async (req, res) => {
  const beleg = belegAus(req)
  if (!beleg) return res.status(400).json({ error: 'Keine Datei' })
  try {
    const result = await extractFromFile(beleg.path, beleg.mimetype, getDb().settings, auswertungAus(req))
    res.json({ file: beleg.filename, extraction: result })
  } catch (err) {
    res.status(502).json({ file: beleg.filename, error: String(err.message || err) })
  }
})

// Universeller Eingang (Schuhkarton): erkennt automatisch, ob die Datei eine Rechnung oder
// ein Zählerfoto ist, und liefert die passende KI-Auswertung. Antwort ist eine diskriminierte
// Union über `kind`. `/api/extract` bleibt für die (rein rechnungsbezogene) Kosten-Seite.
app.post('/api/intake', belegMitSeiten, async (req, res) => {
  const beleg = belegAus(req)
  if (!beleg) return res.status(400).json({ error: 'Keine Datei' })
  try {
    const settings = getDb().settings
    const auswertung = auswertungAus(req)
    const docType = await classifyDocType(beleg.path, beleg.mimetype, settings)
    if (docType === 'zaehlerstand') {
      const reading = await extractMeterReading(beleg.path, beleg.mimetype, settings, auswertung)
      res.json({ file: beleg.filename, kind: 'zaehler', reading })
    } else {
      const extraction = await extractFromFile(beleg.path, beleg.mimetype, settings, auswertung)
      res.json({ file: beleg.filename, kind: 'rechnung', extraction })
    }
  } catch (err) {
    res.status(502).json({ file: beleg.filename, error: String(err.message || err) })
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

const RESTORE_MAX_BYTES = 500 * 1024 * 1024
const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: RESTORE_MAX_BYTES } })
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

// ---------- Update-Hinweis ----------
// Fragt GitHub nur, wenn der Nutzer zugestimmt hat (settings.updateCheck === 'on'), und
// höchstens einmal am Tag; „Jetzt prüfen" fragt sofort, außer GitHub hat um eine Pause
// gebeten (Rate-Limit). NKA_UPDATE_URL ersetzt die Adresse, damit Tests gegen einen
// nachgebauten Server laufen statt gegen das echte GitHub.
const updateChecker = createUpdateChecker({
  url: process.env.NKA_UPDATE_URL || UPDATE_URL,
  currentVersion: APP_VERSION,
  mode: RUNTIME,
})

app.get('/api/update', async (req, res) => {
  res.json(await updateChecker.check({ consent: getDb().settings.updateCheck }))
})

app.post('/api/update/check', async (req, res) => {
  res.json(await updateChecker.check({ consent: getDb().settings.updateCheck, force: true }))
})

// ---------- Betriebszustand ----------
// Für Healthchecks von Docker & Co.: 200 nur, wenn der Datenbestand lesbar und der
// Belegordner beschreibbar ist, sonst 503. Muss VOR dem Frontend-Catch-All stehen, der jeden
// Pfad außer /api und /uploads mit der index.html beantwortet — sonst meldete auch ein
// kaputter Container HTTP 200. Bewusst nicht unter /api: Das ist eine Schnittstelle für den
// Betrieb, nicht für die Oberfläche.
app.get('/healthz', (req, res) => {
  const bericht = healthReport({ dataDir: DATA_DIR, version: APP_VERSION })
  res.status(bericht.status === 'ok' ? 200 : 503).json(bericht)
})

// Fehler an der API immer als lesbare JSON-Meldung, nie als HTML-Fehlerseite von Express
app.use('/api', (err, req, res, next) => {
  if (res.headersSent) return next(err)
  if (err instanceof multer.MulterError) {
    const grenze = req.path === '/restore' ? RESTORE_MAX_BYTES : UPLOAD_MAX_BYTES
    const meldung =
      err.code === 'LIMIT_FILE_SIZE' ? `Die Datei ist größer als ${grenze / 1024 / 1024} MB.`
        : err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'pages' ? `Höchstens ${MAX_SEITEN} Seitenbilder je Beleg.`
          : err.code === 'LIMIT_FIELD_VALUE' ? 'Ein Textfeld ist zu lang.'
            : `Hochladen fehlgeschlagen: ${err.message}`
    return res.status(400).json({ error: meldung })
  }
  // Zum Beispiel ein abgebrochener Upload („Unexpected end of form“), den busboy selbst meldet
  const status = Number(err.status ?? err.statusCode) || 500
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: `Die Anfrage ist fehlgeschlagen: ${err.message}` })
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
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    // Fehlt das Programm, wirft spawn nicht, sondern meldet 'error' asynchron auf dem
    // Kindprozess — der try/catch greift dann nicht mehr. Ohne Zuhörer wird daraus ein
    // unbehandelter Fehler, der den Server beendet, obwohl er schon lauscht. Auf einem
    // Linux-Server ohne xdg-open (headless, Container, SSH) war die Binary damit nicht
    // startbar.
    child.on('error', () => {
      console.log(`Kein Browser gestartet (${cmd} nicht verfügbar) — bitte ${url} von Hand öffnen.`)
    })
    child.unref()
  } catch {
    /* egal — die URL steht in der Meldung darüber */
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
    // In der CI (GitHub setzt CI=true) prüft ein Skript die Programmdatei; ein Browserfenster
    // auf dem Runner nützt dort niemandem.
    if (!process.env.CI) openBrowser(url)
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
