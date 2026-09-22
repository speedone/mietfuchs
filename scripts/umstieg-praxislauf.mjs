// Der Umstieg, praktisch durchgespielt (#55).
//
// **Wozu, wenn es 581 Tests gibt.** Weil dieses Release die Daten jedes Nutzers in eine neue
// Ablage schiebt, und weil ein Test immer nur das prüft, woran jemand gedacht hat. Hier läuft
// ein echter Server auf einem echten Datenordner, mit Beständen in den Gestalten, die es
// draußen wirklich gibt, und gefragt wird über dieselben Antworten, die auch die Oberfläche
// liest. Kein Test-Griff, keine eingereichte Migration, keine nachgebaute Umgebung.
//
// Aufruf:
//   node scripts/umstieg-praxislauf.mjs
//   node scripts/umstieg-praxislauf.mjs --nur 6        (nur einen Fall)
//
// Jeder Fall bekommt einen frischen Wegwerf-Ordner und einen eigenen Serverstart. Der Rückgabe-
// wert ist 0, wenn alles hält, sonst 1.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from '../server/node_modules/adm-zip/adm-zip.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'server', 'src', 'index.ts')

let port = 3210
const nextPort = () => ++port

// ---------- Ausgabe ----------

let fehler = 0
const ok = (text) => console.log(`  ✓ ${text}`)
const info = (text) => console.log(`  ℹ ${text}`)
const fail = (text) => {
  fehler++
  console.log(`  ✗ ${text}`)
}
const gleich = (ist, soll, was) =>
  JSON.stringify(ist) === JSON.stringify(soll)
    ? ok(was)
    : fail(`${was}\n      erwartet: ${JSON.stringify(soll)}\n      bekommen: ${JSON.stringify(ist)}`)
const enthaelt = (text, teil, was) =>
  String(text).includes(teil) ? ok(was) : fail(`${was}\n      in: ${String(text).slice(0, 300)}`)

// ---------- Ein Server auf einem Wegwerf-Ordner ----------

async function withServer(dataDir, work) {
  const p = nextPort()
  const log = []
  const kind = spawn(process.execPath, [SERVER], {
    env: { ...process.env, NKA_DATA_DIR: dataDir, NKA_PORT: String(p), CI: 'true', NKA_UPDATE_URL: 'http://127.0.0.1:9/nichts' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  kind.stdout.on('data', (d) => log.push(String(d)))
  kind.stderr.on('data', (d) => log.push(String(d)))
  const base = `http://127.0.0.1:${p}`
  try {
    // Warten, bis er antwortet. /healthz meldet bei einem gescheiterten Umstieg 503, das ist
    // eine Antwort und kein Fehlschlag.
    for (let i = 0; i < 150; i++) {
      try {
        await fetch(`${base}/healthz`)
        break
      } catch {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    return await work({ base, dataDir, log: () => log.join('') })
  } finally {
    kind.kill()
    await new Promise((r) => setTimeout(r, 400))
  }
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-praxis-'))
const jsonOf = async (res) => {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { _keinJson: text.slice(0, 200) }
  }
}
const holen = async (base, pfad) => jsonOf(await fetch(`${base}${pfad}`))

// ---------- Die Bestände, wie es sie draußen gibt ----------

// Gemeinsamer fachlicher Kern: zwei Wohnungen, zwei Mietverhältnisse, eine Kostenposition nach
// Fläche, ein Zähler mit zwei Ablesungen, eine Zahlung. Damit haben alle vier Rechnungen etwas
// zu tun.
const kern = () => ({
  units: [
    { id: 'u1', name: 'EG', areaM2: 80, participates: true },
    { id: 'u2', name: 'OG', areaM2: 40, participates: true },
  ],
  tenancies: [
    {
      id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2,
      personHistory: [{ from: '2024-01-01', persons: 2 }],
      start: '2024-01-01', end: null,
      prepayments: [{ from: '2024-01', monthlyCents: 15000 }],
      prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 60000 }],
    },
    {
      id: 't2', unitId: 'u2', tenantName: 'Schmidt', persons: 1,
      personHistory: [{ from: '2024-01-01', persons: 1 }],
      start: '2024-01-01', end: null,
      prepayments: [{ from: '2024-01', monthlyCents: 10000 }],
      prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 40000 }],
    },
  ],
  costItems: [
    { id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Abfallgebühren', amountCents: 120000, key: 'area' },
  ],
  meters: [{ id: 'm1', name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }],
  readings: [
    { id: 'r1', meterId: 'm1', date: '2023-12-31', value: 100 },
    { id: 'r2', meterId: 'm1', date: '2024-12-31', value: 160 },
  ],
  payments: [{ id: 'p1', tenancyId: 't1', date: '2024-01-05', amountCents: 75000 }],
  closedSettlements: [],
})

// 0.2: Es gab noch keine KI, also auch keine Felder dafür.
const bestand02 = () => ({
  settings: { houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V. Vermieter', iban: 'DE02 1234', paymentDeadlineDays: 30 },
  ...kern(),
})

// Vor #18: ollamaUrl und ollamaModel, aber kein `ai`.
const bestandVor18 = () => ({
  settings: {
    houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V. Vermieter', iban: 'DE02 1234',
    paymentDeadlineDays: 30, ollamaUrl: 'http://nas:11434', ollamaModel: 'gemma4:12b',
  },
  ...kern(),
})

// Heutiges Format mit beiden Plätzen und einer Bestätigung.
const bestandHeute = () => ({
  settings: {
    houseName: 'Haus am Weg', address: 'Weg 1', landlordName: 'V. Vermieter', iban: 'DE02 1234',
    paymentDeadlineDays: 21, ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3.5:4b',
    updateCheck: 'on', printAttachments: true,
    ai: {
      text: { provider: 'ollama', preset: 'ollama-local', url: 'http://localhost:11434', model: 'qwen3.5:4b', vision: null },
      images: { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5-mini', vision: true },
      timeoutSeconds: 300, numCtx: 16384, maxOutputTokens: null, pageImageEdge: 1200,
      jsonMode: 'auto', reasoningEffort: null, extraInstructions: '',
      consent: { images: { url: 'https://api.openai.com/v1', model: 'gpt-5-mini', date: '2026-01-02' } },
    },
  },
  ...kern(),
})

// Alles, was der Validator ausdrücklich hinnimmt: fester Monatsbetrag neben leerer Staffel,
// zwei Staffeleinträge zum selben Stichtag, fehlende Wohnfläche, Direktzuordnung ins Leere,
// Zähler ohne Wohnung, fehlende Beteiligung.
const bestandKrumm = () => {
  const b = bestand02()
  b.units.push({ id: 'u3', name: 'Keller' })
  b.tenancies[0].prepayments = []
  b.tenancies[0].prepaymentMonthlyCents = 15000
  b.tenancies[1].baseRents = [{ from: '2024-01', monthlyCents: 40000 }, { from: '2024-01', monthlyCents: 45000 }]
  b.costItems.push({ id: 'c2', year: 2024, category: 'Sonstiges', description: 'Direkt', amountCents: 5000, key: 'direct', directUnitId: 'gibt-es-nicht' })
  b.meters.push({ id: 'm2', name: 'Hauptzähler', unitId: '', type: 'kaltwasser', unit: 'm³' })
  return b
}

// Ein Bestand, den der Validator ablehnt: ein negativer Zählerstand.
const bestandKaputt = () => {
  const b = bestand02()
  b.readings.push({ id: 'r3', meterId: 'm1', date: '2024-06-30', value: -5 })
  return b
}

// ---------- Was die Oberfläche liest ----------

// Die Zahlen, an denen der Vermieter merkt, ob sein Bestand angekommen ist. Genau diese Wege
// ruft die Oberfläche auf.
async function fachlichePruefung(base, name) {
  const units = await holen(base, '/api/units')
  gleich(units.map((u) => u.name).sort(), ['EG', 'OG'], `${name}: die Wohnungen sind da`)

  // Die Zahl, an der ein Vermieter sofort sieht, ob sein Bestand angekommen ist. Geprüft wird
  // sie **auf den Cent**: 1200 Euro Müllabfuhr, nach Fläche auf 80 und 40 Quadratmeter.
  const abrechnung = await holen(base, '/api/settlement/2024')
  gleich(abrechnung.totalCostsCents, 120000, `${name}: die Abrechnung 2024 rechnet auf den Cent`)
  const anteile = (abrechnung.statements ?? []).map((st) => st.totalShareCents).sort((a, b) => b - a)
  gleich(anteile, [80000, 40000], `${name}: die Anteile stimmen (800 € und 400 €)`)

  const mietkonto = await holen(base, '/api/rentledger/2024')
  Array.isArray(mietkonto) || typeof mietkonto === 'object'
    ? ok(`${name}: das Mietkonto antwortet`)
    : fail(`${name}: das Mietkonto antwortet nicht`)

  const steuer = await holen(base, '/api/taxreport/2024')
  steuer && !steuer.error
    ? ok(`${name}: die Steuerübersicht antwortet`)
    : fail(`${name}: die Steuerübersicht antwortet nicht`)

  const verbrauch = await holen(base, '/api/consumption/2024')
  verbrauch && !verbrauch.error
    ? ok(`${name}: die Verbrauchsübersicht antwortet`)
    : fail(`${name}: die Verbrauchsübersicht antwortet nicht`)

  return { abrechnung }
}

// Die Meldung, die `client/src/components/Database.tsx` aus /healthz liest.
async function umstiegGelungen(base, name) {
  const bericht = await holen(base, '/healthz')
  gleich(bericht.database?.changeover?.state, 'done', `${name}: der Umstieg meldet sich als gelungen`)
  gleich(bericht.status, 'ok', `${name}: der Zustandsbericht ist in Ordnung`)
  enthaelt(bericht.database?.changeover?.message, 'Datenbank', `${name}: die Oberfläche bekommt einen Satz dazu`)
  return bericht
}

function dateienImOrdner(dataDir, name, erwartet) {
  const liegt = fs.readdirSync(dataDir).sort()
  for (const [datei, sollDa] of Object.entries(erwartet)) {
    liegt.includes(datei) === sollDa
      ? ok(`${name}: ${datei} ${sollDa ? 'liegt da' : 'liegt nicht da'}`)
      : fail(`${name}: ${datei} ${sollDa ? 'fehlt' : 'liegt doch da'} (${liegt.join(', ')})`)
  }
}

// ---------- Die Fälle ----------

const faelle = []
const fall = (nr, titel, work) => faelle.push({ nr, titel, work })

fall(1, 'Frischer Rechner, keine db.json', async () => {
  const dataDir = tempDir()
  await withServer(dataDir, async ({ base }) => {
    const bericht = await holen(base, '/healthz')
    gleich(bericht.status, 'ok', 'der Server ist gesund')
    gleich(bericht.database?.changeover?.state, 'none', 'es gibt nichts zu übernehmen')
    gleich(await holen(base, '/api/units'), [], 'die Wohnungsliste ist leer')
    const angelegt = await (await fetch(`${base}/api/units`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Neu', areaM2: 50, participates: true }),
    })).json()
    gleich(angelegt.name, 'Neu', 'eine neue Wohnung lässt sich anlegen')
    dateienImOrdner(dataDir, 'frisch', { 'mietfuchs.sqlite': true, 'db.json': false })
  })
})

fall(2, 'db.json aus 0.2, ganz ohne KI-Felder', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestand02()))
  await withServer(dataDir, async ({ base }) => {
    await umstiegGelungen(base, '0.2')
    await fachlichePruefung(base, '0.2')
    const s = await holen(base, '/api/settings')
    gleich(s.houseName, 'Haus am Weg', '0.2: der Hausname ist übernommen')
    gleich(s.iban, 'DE02 1234', '0.2: die IBAN ist übernommen')
    gleich(s.paymentDeadlineDays, 30, '0.2: die Zahlungsfrist ist übernommen')
    gleich(s.ai?.text?.provider, 'ollama', '0.2: ein KI-Platz ist entstanden')
    gleich(s.ai?.images, null, '0.2: kein Bilder-Platz erfunden')
    dateienImOrdner(dataDir, '0.2', { 'db.json': false, 'db.json.abgeloest': true, 'umstieg-protokoll.txt': true })
  })
})

fall(3, 'db.json von vor #18, mit ollamaUrl und ollamaModel', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestandVor18()))
  await withServer(dataDir, async ({ base }) => {
    await umstiegGelungen(base, 'vor #18')
    await fachlichePruefung(base, 'vor #18')
    const s = await holen(base, '/api/settings')
    gleich(s.ai?.text?.url, 'http://nas:11434', 'vor #18: die Adresse ist im Platz angekommen')
    gleich(s.ai?.text?.model, 'gemma4:12b', 'vor #18: das Modell ist im Platz angekommen')
    gleich(s.ai?.text?.preset, 'ollama-remote', 'vor #18: nas ist nicht dieser Rechner, also die entfernte Vorlage')
    gleich(s.ollamaUrl, 'http://nas:11434', 'vor #18: das alte Feld bleibt für ein Downgrade stehen')
  })
})

fall(4, 'db.json im heutigen Format mit beiden KI-Plätzen', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestandHeute()))
  await withServer(dataDir, async ({ base }) => {
    await umstiegGelungen(base, 'heute')
    await fachlichePruefung(base, 'heute')
    const s = await holen(base, '/api/settings')
    gleich(s.paymentDeadlineDays, 21, 'heute: die eigene Zahlungsfrist bleibt')
    gleich(s.updateCheck, 'on', 'heute: die Zustimmung zur Update-Prüfung bleibt')
    gleich(s.printAttachments, true, 'heute: die Druckeinstellung bleibt')
    gleich(s.ai?.images?.model, 'gpt-5-mini', 'heute: der Bilder-Platz ist übernommen')
    gleich(s.ai?.pageImageEdge, 1200, 'heute: die Bildkante ist übernommen')
    gleich(s.ai?.consent?.images?.date, '2026-01-02', 'heute: die Bestätigung ist übernommen')
  })
})

fall(5, 'Alle krummen Fälle, die der Validator hinnimmt', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestandKrumm()))
  await withServer(dataDir, async ({ base }) => {
    await umstiegGelungen(base, 'krumm')
    const units = await holen(base, '/api/units')
    gleich(units.length, 3, 'krumm: auch die Wohnung ohne Fläche ist da')
    const ohneFlaeche = units.find((u) => u.name === 'Keller')
    gleich(ohneFlaeche?.areaM2, 0, 'krumm: die fehlende Fläche ist 0 m²')
    const kosten = await holen(base, '/api/costItems')
    gleich(kosten.length, 2, 'krumm: die Kostenposition mit Verweis ins Leere ist erhalten')
    gleich(kosten.find((c) => c.id !== 'c1')?.directUnitId ?? null, null, 'krumm: der Verweis ins Leere ist null')
    const mieter = await holen(base, '/api/tenancies')
    const t1 = mieter.find((t) => t.tenantName === 'Müller')
    gleich(t1?.prepayments, [{ from: '2024-01', monthlyCents: 15000 }], 'krumm: aus dem festen Monatsbetrag ist eine Staffel geworden')
    const t2 = mieter.find((t) => t.tenantName === 'Schmidt')
    gleich(t2?.baseRents, [{ from: '2024-01', monthlyCents: 45000 }], 'krumm: beim doppelten Stichtag gilt der letzte')
    const protokoll = fs.readFileSync(path.join(dataDir, 'umstieg-protokoll.txt'), 'utf8')
    enthaelt(protokoll, 'geradegerückt', 'krumm: das Protokoll nennt, was geradegerückt wurde')
    const bericht = await holen(base, '/healthz')
    Array.isArray(bericht.database?.changeover?.notes) && bericht.database.changeover.notes.length > 0
      ? ok('krumm: die Oberfläche bekommt den Hinweis zum Mietkonto')
      : fail(`krumm: kein Hinweis, notes: ${JSON.stringify(bericht.database?.changeover?.notes)}`)
  })
})

fall(6, 'Ein Bestand, den der Validator ablehnt', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestandKaputt()))
  await withServer(dataDir, async ({ base }) => {
    const bericht = await holen(base, '/healthz')
    gleich(bericht.database?.changeover?.state, 'failed', 'abgelehnt: der Umstieg meldet sich als gescheitert')
    gleich(bericht.status, 'error', 'abgelehnt: ein Container sieht den Fehler')
    enthaelt(bericht.database?.changeover?.message, 'Küche', 'abgelehnt: die Meldung nennt den Zähler')
    enthaelt(bericht.database?.changeover?.message, 'nichts verloren', 'abgelehnt: die Meldung beruhigt zu Recht')
    const units = await fetch(`${base}/api/units`)
    gleich(units.status, 503, 'abgelehnt: die Datenrouten sperren, statt ein leeres Haus zu zeigen')
    dateienImOrdner(dataDir, 'abgelehnt', { 'db.json': true, 'db.json.abgeloest': false })
  })
})

// Ein Backup herunterladen und wieder einspielen, beides über die echten Routen.
async function backupHolen(base) {
  return Buffer.from(await (await fetch(`${base}/api/backup`)).arrayBuffer())
}
async function backupEinspielen(base, zip) {
  const form = new FormData()
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'backup.zip')
  const res = await fetch(`${base}/api/restore`, { method: 'POST', body: form })
  return { status: res.status, body: await jsonOf(res) }
}

fall(7, 'Backup von vor der Datenbank: nur db.json und Belege im Archiv', async () => {
  // **Das ist das Archiv, das bei den heutigen Nutzern liegt**, und in einem Jahr ist es bei
  // manchem das Einzige, was noch da ist. Es führt keine `mietfuchs.sqlite`, denn die gab es
  // damals nicht. Fall 8 hat eine veraltete Datenbank dabei, Fall 9 nur die Datenbank; dieser
  // hier ist der Fall davor, und er war bis zuletzt ungeprüft — ausgerechnet der, der am
  // längsten vorkommen wird. MIGRATION.md verweist Nutzer ausdrücklich auf diesen Weg.
  const archiv = new AdmZip()
  archiv.addFile('db.json', Buffer.from(JSON.stringify(bestandHeute())))
  archiv.addFile('uploads/beleg.pdf', Buffer.from('%PDF-1.4 ein Beleg'))
  const altesZip = archiv.toBuffer()

  // Ein Rechner, auf dem schon gearbeitet wurde: Es gibt eine Datenbank, und der Stand des
  // Archivs soll sie ersetzen.
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestand02()))
  await withServer(dataDir, async ({ base }) => {
    await umstiegGelungen(base, 'Vorbereitung')

    const antwort = await backupEinspielen(base, altesZip)
    gleich(antwort.status, 200, 'ein Archiv ganz ohne Datenbank wird angenommen')
    const units = await holen(base, '/api/units')
    gleich(units.map((u) => u.name).sort(), ['EG', 'OG'], 'der Stand des Archivs gilt')
    gleich((await holen(base, '/api/settings')).paymentDeadlineDays, 21, 'die Einstellungen kommen mit')

    // Die Datenbank ist aus der wiederhergestellten db.json **neu aufgebaut**, nicht bloß
    // beiseitegelegt — und zwar mit derselben centgenauen Regression wie beim Umstieg.
    const bericht = await holen(base, '/healthz')
    gleich(bericht.database.open, true, 'die Datenbank ist nach dem Wiederherstellen offen')
    const beleg = await fetch(`${base}/uploads/beleg.pdf`)
    gleich(beleg.status, 200, 'der Beleg aus dem Archiv ist abrufbar')
    dateienImOrdner(dataDir, 'Wiederherstellen', { 'mietfuchs.sqlite.vor-restore': true })
    await fachlichePruefung(base, 'nach dem Wiederherstellen')
  })
})

fall(8, 'Backup vom heutigen main-Stand: db.json und veraltete Datenbank', async () => {
  // **Der Aktualisierungsweg, und ohne die Regel verliert er Daten.** Wer heute den Stand von
  // `main` fährt, hat eine lebende db.json und eine Datenbank, die auf dem Stand des Umstiegstags
  // stehengeblieben ist. Sein Archiv führt beides. Gilt beim Einspielen die Datenbank, verliert
  // er alles seit dem Umstieg.
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestand02()))
  await withServer(dataDir, async ({ base }) => {
    await umstiegGelungen(base, 'Archiv bauen')
    const zip = await backupHolen(base)
    const archiv = new AdmZip(zip)
    const namen = archiv.getEntries().map((e) => e.entryName)
    gleich(namen.includes('mietfuchs.sqlite'), true, 'Archiv bauen: die Datenbank ist drin')
    gleich(namen.includes('db.json'), false, 'Archiv bauen: die abgelöste db.json ist nicht drin')

    // Jetzt ein Archiv, wie es der heutige main-Stand erzeugt: dieselbe Datenbank, dazu eine
    // db.json mit dem neueren Stand.
    const neuer = bestand02()
    neuer.units.push({ id: 'u9', name: 'Dachgeschoss', areaM2: 30, participates: true })
    neuer.settings.houseName = 'Haus aus der Datei'
    archiv.addFile('db.json', Buffer.from(JSON.stringify(neuer), 'utf8'))

    const antwort = await backupEinspielen(base, archiv.toBuffer())
    gleich(antwort.status, 200, 'Wiederherstellen: die Route nimmt das Archiv an')
    const units = await holen(base, '/api/units')
    gleich(units.map((u) => u.name).sort(), ['Dachgeschoss', 'EG', 'OG'], 'Wiederherstellen: die db.json hat gewonnen')
    const s2 = await holen(base, '/api/settings')
    gleich(s2.houseName, 'Haus aus der Datei', 'Wiederherstellen: die Einstellungen gelten sofort')
  })
})

fall(9, 'Backup nur mit Datenbank, wie es diese Version erzeugt', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestandHeute()))
  await withServer(dataDir, async ({ base }) => {
    await umstiegGelungen(base, 'Archiv bauen')
    const zip = await backupHolen(base)

    // Etwas ändern, damit das Zurückspielen sichtbar wird.
    await fetch(`${base}/api/units`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nach dem Backup', areaM2: 10, participates: true }),
    })
    gleich((await holen(base, '/api/units')).length, 3, 'Wiederherstellen: vorher sind es drei Wohnungen')

    const antwort = await backupEinspielen(base, zip)
    gleich(antwort.status, 200, 'Wiederherstellen: die Route nimmt das Archiv an')
    const units = await holen(base, '/api/units')
    gleich(units.map((u) => u.name).sort(), ['EG', 'OG'], 'Wiederherstellen: der Stand des Archivs gilt')
    const s2 = await holen(base, '/api/settings')
    gleich(s2.paymentDeadlineDays, 21, 'Wiederherstellen: die Einstellungen kommen mit zurück')
    gleich(s2.ai?.images?.model, 'gpt-5-mini', 'Wiederherstellen: auch der Bilder-Platz')
    dateienImOrdner(dataDir, 'Wiederherstellen', { 'mietfuchs.sqlite.vor-restore': true })
  })
})

fall(10, 'Zweiter Start, der Umstieg ist schon gelaufen', async () => {
  const dataDir = tempDir()
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(bestand02()))
  await withServer(dataDir, async ({ base }) => {
    await umstiegGelungen(base, 'erster Start')
  })
  await withServer(dataDir, async ({ base }) => {
    const bericht = await holen(base, '/healthz')
    gleich(bericht.database?.changeover?.state, 'none', 'zweiter Start: es gibt nichts mehr zu übernehmen')
    gleich(bericht.status, 'ok', 'zweiter Start: der Server ist gesund')
    await fachlichePruefung(base, 'zweiter Start')
  })
})

// ---------- Lauf ----------

const nur = process.argv.includes('--nur') ? Number(process.argv[process.argv.indexOf('--nur') + 1]) : null

// **Eine leere Auswahl ist ein Abbruch und kein stiller Erfolg.** Ohne diese Zeilen meldete
// `--nur 7` „Alle Prüfungen bestanden." und einen Rückgabewert von 0, obwohl es den Fall 7 gar
// nicht gibt und nichts gelaufen war. Das ist dieselbe Gestalt wie eine Matrix ohne Einträge, vor
// der CLAUDE.md beim Prüfumfang warnt: keine Arbeit, kein Fehler, nur ein Überspringen. Wer eine
// Nummer eintippt, die es nicht gibt, will nicht bestätigt bekommen, dass alles in Ordnung ist.
const gewaehlt = faelle.filter(({ nr }) => nur === null || nr === nur)
if (gewaehlt.length === 0) {
  console.error(`Es gibt keinen Fall ${nur}. Vorhanden sind: ${faelle.map((f) => f.nr).join(', ')}.`)
  process.exit(1)
}

console.log('Der Umstieg, praktisch durchgespielt\n')
for (const { nr, titel, work } of gewaehlt) {
  console.log(`Fall ${nr}: ${titel}`)
  try {
    await work()
  } catch (err) {
    fail(`der Fall ist abgestürzt: ${err instanceof Error ? err.stack : String(err)}`)
  }
  console.log('')
}

console.log(fehler === 0 ? 'Alle Prüfungen bestanden.' : `${fehler} Prüfungen fehlgeschlagen.`)
process.exit(fehler === 0 ? 0 : 1)
