// Integrationstests gegen den echten Server: Backup, Wiederherstellung und die Routen auf der Datenbank.
//
// Jeder Test startet den Server als eigenen Prozess mit NKA_DATA_DIR auf einem Wegwerf-Ordner;
// die gemeinsamen Helfer stehen in testing/api.ts. Bis #263 stand dieser Teil mit allen anderen
// in api.test.ts und lief mit ihnen nacheinander.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { connect } from '../src/db/client.ts'
import type { CostItem, Meter, Unit, UploadInfo } from '../../shared/types.ts'
import {
  type ClientSettings, type HealthReport, type Server, type UploadBody, archive, errorFrom, errorOf, fileOf, jsonOf, listening, portOf, readStartUrl, removeDataDir, restore, serverRoot, startServer, startServerIn, startServerRaw, storedSettings, unitRowsInDatabase, waitForExit,
} from '../testing/api.ts'

// ---------- Backup und Wiederherstellung (#23) ----------

async function withData(fn: (s: Server, data: { unit: Unit, file: string }) => Promise<void>) {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('%PDF-Beleg')], { type: 'application/pdf' }), 'Gebührenbescheid Müll.pdf')
    const file = fileOf(await jsonOf<UploadBody>(await fetch(`${s.base}/api/upload`, { method: 'POST', body: fd })))
    await fn(s, { unit, file })
  } finally {
    s.stop()
  }
}

test('Backup: herunterladen und zurückspielen bringt Daten und Belege zurück', async () => {
  await withData(async (s, { unit, file }) => {
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    assert.equal(backup.subarray(0, 2).toString(), 'PK')
    await fetch(`${s.base}/api/units/${unit.id}`, { method: 'DELETE' })
    fs.rmSync(path.join(s.dataDir, 'uploads', file))
    const r = await restore(s, backup)
    assert.equal(r.status, 200)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file]) // Umlaute überleben das ZIP
  })
})

test('Backup: die Datei heißt nach dem Programm, nicht nach seinem alten Namen (#142)', async () => {
  await withData(async (s) => {
    const res = await fetch(`${s.base}/api/backup`)
    await res.arrayBuffer()
    assert.match(res.headers.get('content-disposition') ?? '', /filename="mietfuchs-backup-\d{4}-\d{2}-\d{2}\.zip"/)
  })
})

test('Backup: Belege behalten beim Wiederherstellen ihr Datum (#142)', async () => {
  // Vorher trug jeder Beleg danach das Datum der Wiederherstellung, und im Belegarchiv sah eine
  // Rechnung von 2023 aus wie gestern hochgeladen.
  await withData(async (s, { file }) => {
    const before = new Date('2023-03-14T10:20:30Z')
    fs.utimesSync(path.join(s.dataDir, 'uploads', file), before, before)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    fs.rmSync(path.join(s.dataDir, 'uploads', file))
    assert.equal((await restore(s, backup)).status, 200)
    const listed = (await s.api<UploadInfo[]>('/api/uploads')).find((u) => u.file === file)
    if (!listed) return assert.fail('Beleg fehlt nach dem Wiederherstellen')
    // Ein ZIP speichert die Zeit auf zwei Sekunden genau.
    assert.ok(Math.abs(new Date(listed.mtime).getTime() - before.getTime()) <= 2000, `Datum ${listed.mtime}`)
  })
})

test('Backup: ein Archiv ohne db.json oder mit kaputter db.json ändert nichts', async () => {
  await withData(async (s, { unit }) => {
    for (const zip of [archive({ 'uploads/a.pdf': 'x' }, null), archive({}, '{ kaputt')]) {
      const r = await restore(s, zip)
      assert.equal(r.status, 400)
      assert.match(r.contentType, /json/)
    }
    const r = await restore(s, Buffer.from('kein ZIP'))
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /kein gültiges ZIP/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
  })
})

test('Backup: ein Archiv mit beschädigten Daten wird abgelehnt, ohne etwas zu ersetzen (#59)', async () => {
  // Bisher genügte es, dass die db.json gültiges JSON ist. `{"units": null}` kam damit durch,
  // und danach beantwortete der Server keine einzige Anfrage mehr: Beim Einlesen verdrängt das
  // `null` den Vorgabewert, die Liste ist keine mehr, und jeder weitere Aufruf scheitert erneut.
  await withData(async (s, { unit, file }) => {
    const kaputt = { settings: {}, units: null, tenancies: [], costItems: [], meters: [], readings: [], payments: [] }
    const r = await restore(s, archive({ 'uploads/fremd.pdf': 'x' }, kaputt))
    assert.equal(r.status, 400)
    // Die Meldung nennt, was nicht stimmt, und sagt, dass nichts verändert wurde.
    assert.match(errorOf(r.body), /Wohnungen/)
    assert.match(errorOf(r.body), /unverändert/)
    // Und wirklich nichts ersetzt: weder die Daten noch die Belege. Die fehlenden
    // Sicherheitskopien sind dabei die schärfste Zusicherung: Hier **gäbe** es einen Stand zu
    // sichern, die Datenbank steht ja da. Dass sie trotzdem nicht entstanden sind, heißt, dass
    // die Route gar nicht erst bis zum Ersetzen gekommen ist.
    assert.equal(fs.existsSync(path.join(s.dataDir, 'db.json.vor-restore')), false)
    assert.equal(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')), false)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), [unit.id], 'die Datenbank ist angefasst worden')
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), [file])
  })
})

test('Backup: ein krummer, aber gültiger Bestand wird übernommen', async () => {
  // Der Unterschied zwischen kaputt und krumm entscheidet, wer sein Backup zurückspielen kann.
  // Beides hier entsteht durch gewöhnliche Bedienung: Das Löschen einer Wohnung lässt die
  // Direktzuordnung stehen, und die Vorauszahlungs-Staffel prüft nicht auf doppelte Monate.
  await withData(async (s) => {
    const krumm = {
      settings: {},
      units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
      tenancies: [{
        id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2, start: '2024-01-01', end: null,
        personHistory: [{ from: '2024-01-01', persons: 2 }],
        prepayments: [{ from: '2024-01', monthlyCents: 15000 }, { from: '2024-01', monthlyCents: 18000 }],
        prepaymentOverrides: {}, baseRents: [],
      }],
      costItems: [{ id: 'c1', year: 2024, category: 'Sonstiges', description: 'Rohrbruch', amountCents: 30000, key: 'direct', directUnitId: 'gibt-es-nicht' }],
      meters: [], readings: [], payments: [],
    }
    const r = await restore(s, archive({}, krumm))
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual((await s.api<CostItem[]>('/api/costItems')).map((c) => c.id), ['c1'])
  })
})

test('Backup: Wiederherstellen gelingt auch ohne vorhandene db.json (frischer Rechner)', async () => {
  // Das ist der häufigste Fall überhaupt: Ein Backup macht man, um auf einen neuen Rechner zu
  // ziehen oder nach einem Schaden neu anzufangen. Dann liegt keine db.json da, die sich
  // beiseitelegen ließe, denn sie entsteht erst beim ersten Speichern. Vorher brach das
  // Wiederherstellen genau dort mit einem Serverfehler ab (ENOENT beim Kopieren der
  // Sicherheitskopie), also ausgerechnet da, wo es helfen sollte.
  const s = await startServer()
  try {
    assert.equal(fs.existsSync(path.join(s.dataDir, 'db.json')), false, 'ein frischer Datenordner hat noch keine db.json')
    const daten = {
      settings: {}, units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
      tenancies: [], costItems: [], meters: [], readings: [], payments: [],
    }
    const r = await restore(s, archive({ 'uploads/beleg.pdf': '%PDF-Beleg' }, daten))
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.name), ['EG'])
    assert.deepEqual((await s.api<UploadInfo[]>('/api/uploads')).map((u) => u.file), ['beleg.pdf'])
    // Gab es vorher nichts, gibt es auch nichts zu sichern: keine leere oder erfundene
    // Sicherheitskopie, die später jemanden glauben ließe, dort stünde ein früherer Stand.
    assert.equal(fs.existsSync(path.join(s.dataDir, 'db.json.vor-restore')), false)
  } finally {
    s.stop()
  }
})

// Setzt einen Eintragsnamen roh ins Archiv, wie ein präpariertes ZIP ihn enthielte. adm-zip
// bereinigt Namen schon beim Erzeugen, deshalb erst mit gleich langem Platzhalter bauen und die
// Bytes danach ersetzen (der Name steckt in lokalem Kopf und zentralem Verzeichnis).
function archiveWithRawName(name: string): Buffer {
  const placeholder = `uploads/${'X'.repeat(name.length - 'uploads/'.length)}`
  const raw = archive({ [placeholder]: 'boese' }).toString('latin1')
  assert.equal(raw.split(placeholder).length - 1, 2, 'Platzhalter steht zweimal im Archiv')
  return Buffer.from(raw.replaceAll(placeholder, name), 'latin1')
}

test('Backup: ein Eintrag, der aus dem Belegordner ausbrechen will, wird abgelehnt, ohne halb zu ersetzen', async () => {
  await withData(async (s, { unit }) => {
    for (const name of ['uploads/..', 'uploads/../../boese.txt', 'uploads/.', 'uploads/unter/ordner.pdf']) {
      const r = await restore(s, archiveWithRawName(name))
      assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.body)}`)
      assert.match(r.contentType, /json/)
      // Nichts ersetzt: die Wohnung ist noch da, obwohl die db.json im Archiv leer ist
      assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    }
    assert.equal(fs.existsSync(path.join(s.dataDir, 'boese.txt')), false)
    assert.equal(fs.existsSync(path.join(s.dataDir, '..', 'boese.txt')), false)
  })
})

test('Backup: ein Archiv, das ausgepackt zu groß wird, wird abgelehnt, bevor etwas ersetzt wird', async () => {
  // Gegen „ZIP-Bomben“: wenige Kilobyte, die ausgepackt riesig werden. Die Grenze ist hier für
  // den Test auf 100 kB gesetzt, im Betrieb liegt sie bei 1 GB.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-restore-'))
  const s = await startServerIn(dataDir, { NKA_RESTORE_MAX_BYTES: String(100 * 1024) })
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    const bomb = archive({ 'uploads/gross.pdf': Buffer.alloc(200 * 1024) })
    assert.ok(bomb.length < 10 * 1024, 'das Archiv selbst ist klein')
    const r = await restore(s, bomb)
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /zu groß/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.equal((await s.api<UploadInfo[]>('/api/uploads')).length, 0)
  } finally {
    s.stop()
  }
})

// Mit NKA_PORT=0 vergibt das System einen freien Port. Die Tests starten den Server so und
// lesen den Port aus der Startmeldung (siehe startServerIn).
test('Start: mit NKA_PORT=0 nennt die Startmeldung den tatsächlich vergebenen Port', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: serverRoot,
    env: { ...process.env, NKA_PORT: '0', NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/', CI: '1' },
  })
  try {
    const url = await readStartUrl(child)
    assert.notEqual(new URL(url).port, '0', url)
    assert.equal((await fetch(`${url}/healthz`)).status, 200)
  } finally {
    child.kill()
    removeDataDir(dataDir)
  }
})

test('Start: ein NKA_PORT, der keine Portnummer ist, bricht den Start mit klarer Meldung ab', async () => {
  // node:net nimmt eine Zeichenkette, die keine Zahl ist, als Pfad eines Unix-Sockets (unter
  // Windows einer Named Pipe). Mietfuchs lief damit scheinbar, war aber über HTTP unter keiner
  // Adresse erreichbar: `address()` liefert dann den Pfad statt eines Objekts mit Port, und die
  // Startmeldung nannte „http://127.0.0.1:undefined“.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  const { child, out } = startServerRaw(dataDir, { NKA_PORT: 'kein-port' })
  try {
    assert.equal(await waitForExit(child), 1, out())
    assert.match(out(), /NKA_PORT/)
    assert.doesNotMatch(out(), /läuft auf/)
  } finally {
    child.kill()
    removeDataDir(dataDir)
  }
})

test('Start: ist der Port belegt, meldet der Server das und behauptet nicht, zu laufen', async () => {
  // Express 5 ruft den listen-Callback auch bei einem Fehler auf. Ohne Prüfung meldete Mietfuchs
  // dann „läuft auf …“ und öffnete in der Programmdatei sogar den Browser.
  const net = await import('node:net')
  const blocker = net.createServer()
  // Ohne Host wie Mietfuchs selbst, sonst lauschten beide auf verschiedenen Adressfamilien
  await listening(blocker)
  const port = portOf(blocker)
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-port-'))
  try {
    const child = spawn(process.execPath, ['src/index.ts'], {
      cwd: serverRoot,
      env: { ...process.env, NKA_PORT: String(port), NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9/', CI: 'true' },
    })
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    const code = await Promise.race<number | null | string>([
      new Promise((r) => child.on('exit', r)),
      new Promise((r) => setTimeout(() => { child.kill(); r('läuft nach 15 s noch') }, 15000)),
    ])
    assert.notEqual(code, 'läuft nach 15 s noch', output)
    assert.notEqual(code, 0)
    assert.match(output, /bereits belegt/)
    assert.doesNotMatch(output, /läuft auf/)
  } finally {
    blocker.close()
    removeDataDir(dataDir)
  }
})

// ---------- Backup, Wiederherstellung und die Datenbank (#55, Aufgabe 7a) ----------
//
// Der Grund für diese Gruppe ist ein Ausgang, den es zu vermeiden gilt: Sobald die Routen aus
// der Datenbank lesen, spielt jemand ein Backup ein, sieht eine Bestätigung und arbeitet danach
// mit den alten Daten weiter. Deshalb enthält das Archiv die Datenbank, und deshalb wird sie
// geprüft, bevor irgendetwas ersetzt ist.

// Den Serverprozess beenden, ohne den Datenordner mitzunehmen, und warten, bis er wirklich weg
// ist: Unter Windows hält er sonst noch die Sperre auf der Datenbankdatei.
async function stopKeepingData(s: Awaited<ReturnType<typeof startServerIn>>): Promise<void> {
  const ende = new Promise((r) => s.child.on('exit', r))
  s.child.kill()
  await ende
}

// Ein Server mit gefüllter Datenbank. Seit die Routen die Datenbank schreiben, genügt dafür ein
// Aufruf: Was angelegt wird, steht sofort dort. (Vorher musste der Server dafür zweimal starten,
// damit der Umstieg die db.json übernimmt.)
async function withFilledDatabase(fn: (s: Awaited<ReturnType<typeof startServerIn>>, unit: Unit) => Promise<void>) {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), [unit.id], 'die Wohnung steht nicht in der Datenbank')
    await fn(s, unit)
  } finally {
    s.stop()
  }
}

// Ein Eintrag aus dem Archiv. Geprüft statt behauptet: Fehlt er, ist genau das der Befund, den
// der Test zutage fördern soll, und ein `!` verdeckte ihn.
function entryData(zip: AdmZip, name: string): Buffer {
  const entry = zip.getEntry(name)
  if (!entry) return assert.fail(`im Archiv fehlt der Eintrag ${name}`)
  return entry.getData()
}

// Die Wohnungen, wie sie in der Datenbank stehen — unabhängig von den Routen gelesen, die
// heute noch aus der db.json antworten.
async function unitsInDatabase(dataDir: string): Promise<string[]> {
  const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
  try {
    return connection.rows('SELECT id FROM units ORDER BY rowid').map((row) => String(row[0]))
  } finally {
    connection.close()
  }
}

// Ein Bestand im Dateiformat, wie ihn eine Version vor dem Umstellen der Routen geschrieben hat.
const jsonStand = (namen: string[]): string => JSON.stringify({
  settings: { houseName: 'Aus der Datei', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30 },
  units: namen.map((name, i) => ({ id: `u${i + 1}`, name, areaM2: 50 + i, participates: true })),
  tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
})

test('Backup: gibt es gerade gar keinen Bestand, entsteht kein Archiv, das sich nicht einspielen lässt', async () => {
  // **Ein Backup, das sich nicht wiederherstellen lässt, ist schlimmer als keines**, denn der
  // Vermieter hält sich danach für gesichert. Genau das konnte entstehen: Ist der Umstieg
  // gelaufen (die db.json heißt dann db.json.abgeloest) und geht danach die Datenbank kaputt,
  // enthielte das Archiv nur noch die Belege. `readBackup` lehnt so eines beim Einspielen ab,
  // und zwar zu Recht. Also entsteht es gar nicht erst.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite'), 'Das ist ein Brief und keine Datenbank.', 'utf8')
  const s = await startServerIn(dataDir)
  try {
    const res = await fetch(`${s.base}/api/backup`)
    assert.equal(res.status, 503, `erwartet 503, bekommen ${res.status}`)
    const fehler = await errorFrom(res)
    assert.match(fehler, /Datenordner/, 'die Meldung nennt den Weg nicht')
    assert.match(fehler, /Datenbank/, fehler)
  } finally {
    s.stop()
  }
})

test('Backup: ist der Umstieg gescheitert, kommt die db.json ins Archiv und nicht die leere Datenbank', async () => {
  // **Die andere Hälfte derselben Behebung.** Packte das Backup die Datenbank ein, obwohl sie
  // den Bestand gar nicht trägt, entstünde genau das mehrdeutige Archiv, das beim
  // Wiederherstellen Daten kostet: eine leere Datenbank neben einer vollen db.json. Damit führte
  // das Backup an der Sperre vorbei, die für diesen Zustand gerade erfunden wurde.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  // Ein negativer Zählerstand: Der Validator lehnt ihn ab, der Umstieg scheitert, und die
  // Datenbank bleibt offen und leer. Über die Oberfläche erzeugbar, also ein echter Fall.
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    settings: { houseName: 'Haus', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30 },
    units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
    tenancies: [], costItems: [],
    meters: [{ id: 'm1', name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }],
    readings: [{ id: 'r1', meterId: 'm1', date: '2024-12-31', value: -5 }],
    payments: [], closedSettlements: [],
  }))
  const s = await startServerIn(dataDir)
  try {
    const bericht = await jsonOf<HealthReport>(await fetch(`${s.base}/healthz`))
    assert.equal(bericht.database?.changeover.state, 'failed', 'der Umstieg ist wider Erwarten gelungen')

    const namen = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
      .getEntries().map((e) => e.entryName)
    assert.ok(namen.includes('db.json'), `die db.json fehlt im Archiv: ${namen.join(', ')}`)
    assert.equal(namen.includes('mietfuchs.sqlite'), false, `die leere Datenbank ist im Archiv: ${namen.join(', ')}`)
  } finally {
    s.stop()
  }
})

test('Wiederherstellen: führt das Archiv eine db.json, gilt sie und nicht die mitgebrachte Datenbank', async () => {
  // **Das ist der Aktualisierungsweg, und ohne diese Regel verliert er Daten.** Wer den Stand
  // von `main` fährt, hat eine lebende db.json und eine Datenbank, die auf dem Stand des
  // Umstiegstags stehengeblieben ist; sein Archiv führt beides. Ebenso, wer ein Backup zieht,
  // während der Umstieg gescheitert ist: Dann ist die Datenbank im Archiv leer und die db.json
  // trägt alles. Würde die mitgebrachte Datenbank einfach aktiviert, sähe der Vermieter nach der
  // Bestätigung „ok" ein leeres oder veraltetes Haus, schriebe hinein, und ab dem Augenblick
  // findet der Umstieg eine gefüllte Datenbank vor und läuft nie wieder. Die db.json wäre
  // dauerhaft abgehängt.
  //
  // Jede bisher veröffentlichte Version hat die db.json als lebenden Bestand geschrieben. Ein
  // Archiv, das eine führt, stammt also von dort, und sie ist das Neuere. Umgekehrt legt diese
  // Version keine db.json mehr ins Archiv, sobald die Datenbank den Bestand trägt; ein
  // mehrdeutiges Archiv kann ab jetzt gar nicht mehr entstehen.
  await withFilledDatabase(async (s, unit) => {
    const archiv = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    assert.ok(archiv.getEntry('mietfuchs.sqlite'), 'das Archiv führt keine Datenbank')
    // Ein Archiv aus der Zeit davor: dieselbe Datenbank, dazu eine db.json mit dem neueren Stand.
    archiv.addFile('db.json', Buffer.from(jsonStand(['Aus der Datei EG', 'Aus der Datei OG']), 'utf8'))

    assert.equal((await restore(s, archiv.toBuffer())).status, 200)
    const namen = (await s.api<Unit[]>('/api/units')).map((u) => u.name)
    assert.deepEqual(namen, ['Aus der Datei EG', 'Aus der Datei OG'], 'die veraltete Datenbank hat gewonnen')
    assert.equal(namen.includes(unit.name), false)
    // Und der Bestand ist wirklich übernommen, nicht nur angezeigt.
    assert.equal((await unitRowsInDatabase(s.dataDir)).length, 2, 'die Datenbank trägt den Stand nicht')
  })
})

test('Wiederherstellen: die Einstellungen aus dem Archiv gelten sofort und überleben das nächste Speichern', async () => {
  // **Zwei Schäden hängen daran, und der zweite ist der teure.** Die Einstellungen liegen als
  // Kopie im Arbeitsspeicher (siehe die Begründung am Zwischenspeicher in index.ts). Frischt das
  // Wiederherstellen sie nicht auf, zeigt die Oberfläche bis zum nächsten Neustart den Stand von
  // vorher, und die gedruckte Abrechnung liest von dort **Vermietername und IBAN**. Schlimmer:
  // `PUT /api/settings` geht vom Zwischenspeicher aus, also schreibt die nächste ganz gewöhnliche
  // Änderung den veralteten Stand vollständig über den wiederhergestellten zurück.
  await withFilledDatabase(async (s) => {
    await s.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ landlordName: 'Vermieter im Backup', iban: 'DE89370400440532013000' }),
    })
    const zip = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    await s.api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ landlordName: 'Vermieter danach', iban: 'DE02120300000000202051' }),
    })

    assert.equal((await restore(s, zip)).status, 200)
    const sofort = await s.api<ClientSettings>('/api/settings')
    assert.equal(sofort.landlordName, 'Vermieter im Backup', 'ohne Neustart gilt noch der alte Stand')
    assert.equal(sofort.iban, 'DE89370400440532013000', 'die IBAN steht im Kopf der gedruckten Abrechnung')

    // Eine beliebige andere Einstellung ändern, wie es ein Nutzer täte.
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ paymentDeadlineDays: 45 }) })
    const danach = await s.api<ClientSettings>('/api/settings')
    assert.equal(danach.paymentDeadlineDays, 45)
    assert.equal(danach.landlordName, 'Vermieter im Backup', 'der Stand von vor dem Wiederherstellen ist zurückgekehrt')
    assert.equal(danach.iban, 'DE89370400440532013000', 'die alte IBAN ist zurückgekehrt')
  })
})

test('Backup: das Archiv enthält die Datenbank und sagt, woher es stammt', async () => {
  await withFilledDatabase(async (s) => {
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    const namen = zip.getEntries().map((e) => e.entryName)
    assert.ok(namen.includes('mietfuchs.sqlite'), namen.join(', '))
    assert.ok(namen.includes('mietfuchs-backup.json'), namen.join(', '))
    // Die db.json steht nur im Archiv, wenn es sie gibt. Auf einem Rechner, der nie eine hatte,
    // entsteht sie seit dem Umstieg der Routen gar nicht mehr.
    assert.equal(namen.includes('db.json'), fs.existsSync(path.join(s.dataDir, 'db.json')), namen.join(', '))

    const info: unknown = JSON.parse(zip.readAsText('mietfuchs-backup.json'))
    assert.ok(info !== null && typeof info === 'object')
    assert.equal(Reflect.get(info, 'app'), 'mietfuchs')
    assert.equal(typeof Reflect.get(info, 'version'), 'string')

    // Der Schnappschuss steht für sich: keine Beidatei, die im Archiv fehlen würde.
    for (const suffix of ['-wal', '-shm', '-journal']) {
      assert.ok(!namen.includes(`mietfuchs.sqlite${suffix}`), `${suffix} liegt im Archiv`)
    }
  })
})

test('Backup: zwei gleichzeitige Anfragen liefern beide ein vollständiges Archiv', async () => {
  // Der Schnappschuss entsteht in einer Zwischendatei im Datenordner. Trügen zwei Anfragen
  // denselben Namen dafür, löschte die zweite, was die erste gerade packen will, und der Nutzer
  // bekäme ein Archiv ohne Datenbank oder einen Serverfehler. Zwei Klicks auf denselben Knopf
  // sind nichts Ausgefallenes.
  //
  // **Ehrlich dazu:** Dieser Test war auch mit dem früheren festen Namen grün, gemessen in drei
  // Läufen. Er stellt den Fehler also nicht nach, sondern hält die Eigenschaft fest. Verhindert
  // wurde er bis dahin allein davon, in welcher Reihenfolge Node die Fortsetzungen abarbeitet,
  // und das sagt weder die Schreibschlange zu noch der Treiber darunter. Der eigene Name je
  // Anfrage nimmt der Frage die Grundlage, statt sich auf diese Reihenfolge zu verlassen.
  await withFilledDatabase(async (s) => {
    const hole = async () => {
      const res = await fetch(`${s.base}/api/backup`)
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()) }
    }
    const antworten = await Promise.all([hole(), hole(), hole()])
    antworten.forEach((antwort, i) => {
      assert.equal(antwort.status, 200, `Anfrage ${i + 1} scheiterte`)
      const namen = new AdmZip(antwort.body).getEntries().map((e) => e.entryName)
      assert.ok(namen.includes('mietfuchs.sqlite'), `Anfrage ${i + 1} ohne Datenbank: ${namen.join(', ')}`)
    })
  })
})

test('Backup: die Rundreise bringt auch die Datenbank zurück', async () => {
  await withFilledDatabase(async (s, unit) => {
    const zip = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    assert.deepEqual(await unitsInDatabase(s.dataDir), [unit.id])

    // Die Datenbank verfälschen, wie es ein Schaden täte. Die Routen lesen heute noch aus der
    // db.json, es fällt also nur auf, wenn wirklich in die Datenbank gesehen wird.
    const fremd = await connect(path.join(s.dataDir, 'mietfuchs.sqlite'))
    fremd.exec("DELETE FROM units")
    fremd.close()
    assert.deepEqual(await unitsInDatabase(s.dataDir), [])

    assert.equal((await restore(s, zip)).status, 200)
    assert.deepEqual(await unitsInDatabase(s.dataDir), [unit.id], 'die Datenbank ist wieder da')
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    // Die bisherige Datenbank liegt daneben, wie die db.json auch.
    assert.ok(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')), 'die Sicherheitskopie fehlt')
  })
})

test('Backup: ein Archiv aus einer neueren Version wird abgelehnt, bevor etwas ersetzt ist', async () => {
  await withFilledDatabase(async (s, unit) => {
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))

    // Die Datenbank im Archiv bekommt eine Änderung am Aufbau, die diese Version nicht kennt.
    const abgelegt = path.join(s.dataDir, 'fremde.sqlite')
    fs.writeFileSync(abgelegt, entryData(zip, 'mietfuchs.sqlite'))
    const fremd = await connect(abgelegt)
    fremd.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('aus-der-zukunft', 1893456000000)")
    fremd.close()
    zip.updateFile('mietfuchs.sqlite', fs.readFileSync(abgelegt))
    fs.rmSync(abgelegt)

    // Dazu eine veränderte db.json, damit sich beweisen lässt, dass nichts davon übernommen wurde.
    zip.updateFile('db.json', Buffer.from(JSON.stringify({ units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], settings: {} })))

    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /neueren Mietfuchs-Version/)
    assert.match(errorOf(r.body), /Das Archiv stammt aus: Mietfuchs/, errorOf(r.body))
    // Nichts ist ersetzt: weder die Wohnungen noch die Datenbank, und keine Sicherheitskopie.
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual(await unitsInDatabase(s.dataDir), [unit.id])
    assert.equal(fs.existsSync(path.join(s.dataDir, 'db.json.vor-restore')), false)
    assert.equal(fs.existsSync(path.join(s.dataDir, 'mietfuchs.sqlite.vor-restore')), false)
  })
})

test('Backup: ein Archiv mit beschädigter Datenbank wird abgelehnt', async () => {
  await withFilledDatabase(async (s, unit) => {
    const zip = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer()))
    const kaputt = entryData(zip, 'mietfuchs.sqlite')
    kaputt.fill(0x5a, 4096, 8192)
    zip.updateFile('mietfuchs.sqlite', kaputt)

    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 400)
    assert.match(errorOf(r.body), /beschädigt/)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])
    assert.deepEqual(await unitsInDatabase(s.dataDir), [unit.id])
  })
})

test('Backup: ein Archiv ohne Datenbank baut sie aus der db.json neu auf', async () => {
  // Jedes Archiv, das vor dieser Version entstanden ist, sieht so aus. Die db.json zu ersetzen
  // und die alte Datenbank stehen zu lassen wäre der schlimmste Ausgang: Nach Aufgabe 6 sähe
  // der Nutzer eine Bestätigung und arbeitete mit den Daten von vorher weiter.
  await withFilledDatabase(async (s, unit) => {
    // Ein Archiv, wie es eine ältere Version gepackt hat: nur die db.json, keine Datenbank und
    // keine Herkunftsangabe. Es wird hier von Hand gebaut, denn ein heutiges Backup führt genau
    // das nicht mehr — und dieser Test steht gerade für die Archive, die bei den Nutzern schon
    // liegen.
    const alt = archive({}, {
      settings: {},
      units: [{ id: 'aus-dem-archiv', name: 'Aus dem Archiv', areaM2: 55, participates: true }],
      tenancies: [], costItems: [], meters: [], readings: [], payments: [],
    })

    // Der Stand vorher ist ein anderer, sonst bewiese der Test nichts.
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), [unit.id], 'der Ausgangsstand stimmt nicht')

    assert.equal((await restore(s, alt)).status, 200)
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), ['aus-dem-archiv'])
    // Und die Datenbank ist aus der db.json neu entstanden, mit demselben Stand.
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), ['aus-dem-archiv'], 'die Datenbank trägt den alten Stand')
  })
})

// ---------- Die Routen lesen und schreiben die Datenbank (#55, Aufgabe 6) ----------

test('Speichern landet in der Datenbank und nicht in der db.json', async () => {
  const s = await startServer()
  try {
    const unit = await s.api<Unit>('/api/units', { method: 'POST', body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true }) })
    assert.deepEqual(await unitRowsInDatabase(s.dataDir), [unit.id], 'die Wohnung steht nicht in der Datenbank')
    assert.deepEqual((await s.api<Unit[]>('/api/units')).map((u) => u.id), [unit.id])

    // Und die db.json wird nicht mehr fortgeschrieben. Sie bleibt, was sie nach dem Umstieg ist:
    // der Stand von damals, kein mitlaufendes Abbild.
    const jsonFile = path.join(s.dataDir, 'db.json')
    if (fs.existsSync(jsonFile)) {
      assert.ok(!fs.readFileSync(jsonFile, 'utf8').includes(unit.id), 'die Wohnung steht in der db.json')
    }
  } finally {
    s.stop()
  }
})

test('Ein unbekanntes Feld wird nicht mitgespeichert', async () => {
  // #60: `PUT /api/settings` und die CRUD-Routen übernahmen jeden Schlüssel des Rumpfes, auch
  // einen erfundenen, und er blieb dauerhaft im Datenbestand stehen. Mit Spalten gibt es für ihn
  // keinen Ort mehr.
  const s = await startServer()
  try {
    const angelegt = await s.api<Unit>('/api/units', {
      method: 'POST',
      body: JSON.stringify({ name: 'EG', areaM2: 80, participates: true, fremdesFeld: 'bleibt haengen' }),
    })
    assert.ok(!JSON.stringify(angelegt).includes('bleibt haengen'), JSON.stringify(angelegt))
    const gelesen = await s.api<Unit[]>('/api/units')
    assert.ok(!JSON.stringify(gelesen).includes('bleibt haengen'), JSON.stringify(gelesen))

    // **Und bei den Einstellungen ebenso**, obwohl der Kommentar darüber sie seit jeher nennt:
    // Geprüft wurde bisher nur eine Wohnung. `PUT /api/settings` reicht unbekannte Schlüssel
    // durch bis zum Schreiben, und erst `settingsRow` lässt sie fallen. Dass sie dort und nicht
    // erst in der Antwort verschwinden, hält diese Zusicherung fest: Gelesen wird nach dem
    // Speichern aus der Datenbank.
    await s.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Erika', lieblingsfarbe: 'blau' }) })
    const einstellungen = await s.api<ClientSettings>('/api/settings')
    assert.equal(einstellungen.landlordName, 'Erika', 'das gültige Feld ist nicht angekommen')
    assert.ok(!JSON.stringify(einstellungen).includes('lieblingsfarbe'), JSON.stringify(einstellungen))
    const inDerDatenbank = await storedSettings(s)
    assert.ok(!JSON.stringify(inDerDatenbank).includes('lieblingsfarbe'), JSON.stringify(inDerDatenbank))
  } finally {
    s.stop()
  }
})

test('Aufzählungen: ein Wert, den Mietfuchs nicht kennt, ersetzt den gespeicherten nicht', async () => {
  // Eine neue Entscheidung aus dem Umstieg, die bisher keine Zeile festhielt. Über die db.json
  // wurde ein erfundener Umlageschlüssel übernommen und stand danach im Bestand; die Spalte
  // ließe ihn nicht zu. Statt die Eingabe mit einem technischen Befund abzulehnen, bleibt der
  // bisherige Wert stehen. Das ist die mildere Antwort, aber sie geschieht stillschweigend, und
  // genau deshalb gehört sie festgehalten: Wer sie später anders entscheidet, sieht es hier.
  const s = await startServer()
  try {
    const item = await s.api<CostItem>('/api/costItems', {
      method: 'POST',
      body: JSON.stringify({ year: 2024, category: 'Müllabfuhr', description: 'Abfall', amountCents: 12000, key: 'area' }),
    })
    const geaendert = await s.api<CostItem>(`/api/costItems/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({ key: 'nach-mondphase', meterType: 'plutonium' }),
    })
    assert.equal(geaendert.key, 'area', 'der erfundene Umlageschlüssel ist angekommen')
    assert.equal(geaendert.meterType, null, 'der erfundene Zählertyp ist angekommen')

    const meter = await s.api<Meter>('/api/meters', {
      method: 'POST',
      body: JSON.stringify({ name: 'Küche', unitId: null, type: 'kaltwasser', unit: 'm³' }),
    })
    const meterGeaendert = await s.api<Meter>(`/api/meters/${meter.id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'plutonium' }),
    })
    assert.equal(meterGeaendert.type, 'kaltwasser', 'der erfundene Zählertyp ist angekommen')
  } finally {
    s.stop()
  }
})

test('Einstellungen landen in der Datenbank und überleben einen Neustart', async () => {
  // Sie werden im Arbeitsspeicher gehalten, weil sie auf fast jedem Weg gelesen und selten
  // geschrieben werden. Genau deshalb braucht es diesen Test: Ein Zwischenspeicher, der beim
  // Schreiben nicht bis zur Platte durchschlägt, sieht im laufenden Betrieb völlig richtig aus
  // und ist beim nächsten Start weg.
  const erster = await startServer()
  let dataDir: string
  try {
    dataDir = erster.dataDir
    await erster.api('/api/settings', { method: 'PUT', body: JSON.stringify({ landlordName: 'Erika am Park', paymentDeadlineDays: 45 }) })
    assert.equal((await erster.api<ClientSettings>('/api/settings')).landlordName, 'Erika am Park')

    const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
    try {
      const zeilen = connection.rows('SELECT landlord_name, payment_deadline_days FROM settings')
      assert.deepEqual(zeilen, [['Erika am Park', 45]], 'die Einstellungen stehen nicht in der Datenbank')
    } finally {
      connection.close()
    }
    await stopKeepingData(erster)
  } catch (err) {
    erster.stop()
    throw err
  }
  const zweiter = await startServerIn(dataDir)
  try {
    const nachNeustart = await zweiter.api<ClientSettings>('/api/settings')
    assert.equal(nachNeustart.landlordName, 'Erika am Park', 'nach dem Neustart ist der Vermietername weg')
    assert.equal(nachNeustart.paymentDeadlineDays, 45)
  } finally {
    zweiter.stop()
  }
})

test('Ohne Datenbank antwortet die Route, statt Daten vorzutäuschen', async () => {
  // Die Umkehrung des bisherigen Zustands: Bis zum Umstieg war eine nicht geöffnete Datenbank
  // harmlos, weil Mietfuchs mit der db.json weiterarbeitete. Jetzt liegen die Daten dort, und
  // ein Start ohne sie ist ein Start ohne Daten. Eine leere Liste wäre die schlimmste Antwort:
  // Sie sähe aus wie „Sie haben noch nichts erfasst".
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-ohne-db-'))
  // Eine Datei, die keine Datenbank ist. Der Server startet trotzdem, damit die Oberfläche die
  // Meldung zeigen kann; die Datenrouten antworten aber nicht mit Daten.
  fs.writeFileSync(path.join(dataDir, 'mietfuchs.sqlite'), 'Das ist ein Brief und keine Datenbank.', 'utf8')
  const s = await startServerIn(dataDir)
  try {
    const res = await fetch(`${s.base}/api/units`)
    assert.equal(res.status, 503, `erwartet 503, bekommen ${res.status}`)
    assert.match(errorOf(await jsonOf<{ error?: string }>(res)), /Datenbank/)

    // **Und auf jeder anderen Datenroute ebenso, nicht nur beim Lesen.** Geprüft war bisher nur
    // dieses eine GET, dabei ist das Schreiben der Ausgang, dessentwegen es die Sperre gibt:
    // Was der Vermieter in eine leere Datenbank hineinschriebe, stünde danach als zweiter
    // Bestand da. Eine neue Route, die `database.db` unmittelbar benutzte, ginge an der
    // Nahtstelle vorbei, ohne dass irgendetwas rot würde.
    const gesperrt: [string, string, string | undefined][] = [
      ['POST', '/api/units', JSON.stringify({ name: 'EG', areaM2: 80, participates: true })],
      ['PUT', '/api/units/egal', JSON.stringify({ name: 'EG' })],
      ['DELETE', '/api/units/egal', undefined],
      ['GET', '/api/units/egal/dependents', undefined],
      ['GET', '/api/settlement/2024', undefined],
      ['GET', '/api/consumption/2024', undefined],
      ['GET', '/api/rentledger/2024', undefined],
      ['GET', '/api/taxreport/2024', undefined],
      ['POST', '/api/settlement/2024/close', JSON.stringify({})],
      ['DELETE', '/api/settlement/2024/close', undefined],
    ]
    for (const [method, pfad, body] of gesperrt) {
      const antwort = await fetch(`${s.base}${pfad}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body }),
      })
      assert.equal(antwort.status, 503, `${method} ${pfad} antwortet ${antwort.status} statt 503`)
    }
    // Die Wohnung ist auch wirklich nirgends gelandet.
    assert.equal(fs.existsSync(path.join(dataDir, 'db.json')), false, 'es ist doch eine db.json entstanden')

    // Nicht über `s.api`: Der Helfer wirft bei allem außer 200, und genau das tut /healthz hier
    // zu Recht. Ein Container, der den Zustand abfragt, soll einen Fehler sehen und keine 200
    // mit „error" im Rumpf.
    const health = await fetch(`${s.base}/healthz`)
    assert.equal(health.status, 503, 'der Zustandsbericht meldet sich als gesund')
    const bericht = await jsonOf<HealthReport>(health)
    if (!bericht.database) assert.fail('der Zustandsbericht nennt die Datenbank nicht')
    assert.equal(bericht.database.open, false)
    // Ab jetzt ist das ein Fehler und kein Hinweis: Ein Container soll ihn sehen.
    assert.equal(bericht.status, 'error', `der Bericht meldet „${bericht.status}"`)
  } finally {
    s.stop()
  }
})
