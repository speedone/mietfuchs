// scripts/package-desktop.mjs (#517): Namen der Dateien, die Nutzer herunterladen. electron-builder kennt für die
// Architektur nur arm64 und x64; am Release stehen die Namen, unter denen Mac-Nutzer ihren Rechner kennen, wie bei
// den Programmdateien (mietfuchs-macos-apple-silicon.zip, mietfuchs-macos-intel.zip).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { migrationsFromDisk } from '../src/db/client.ts'
import { ARCHIVE_FOLDER, REQUIRED_SERVER_FILES, asarFiles, bundleServer, checkServerArchive, checkServerFolder, packClient, rewriteImportMeta, userFileName } from '../../scripts/package-desktop.mjs'
import { writeAsar } from '../testing/asar.ts'

test('Programmfenster: .dmg heißen nach Apple Silicon und Intel', () => {
  assert.equal(userFileName('Mietfuchs-0.15.0-arm64.dmg'), 'Mietfuchs-0.15.0-apple-silicon.dmg')
  assert.equal(userFileName('Mietfuchs-0.15.0-x64.dmg'), 'Mietfuchs-0.15.0-intel.dmg')
  // Vorabversion: der Bindestrich der Version bleibt unberührt
  assert.equal(userFileName('Mietfuchs-0.15.0-rc.1-arm64.dmg'), 'Mietfuchs-0.15.0-rc.1-apple-silicon.dmg')
  // Die Blockmap gehört zur Datei und zieht mit
  assert.equal(userFileName('Mietfuchs-0.15.0-x64.dmg.blockmap'), 'Mietfuchs-0.15.0-intel.dmg.blockmap')
})

test('Programmfenster: der Windows-Installer und alles andere behält seinen Namen', () => {
  for (const name of ['Mietfuchs-Setup-0.15.0.exe', 'Mietfuchs-Setup-0.15.0.exe.blockmap', 'latest.yml', 'win-unpacked', 'win-arm64-unpacked', 'mac-arm64', 'builder-debug.yml']) {
    assert.equal(userFileName(name), name)
  }
})

// Der Server im Fenster (#517) liegt als drei Dateien unter mietfuchs/ in der app.asar: das Bündel, die Lizenzen der
// gebündelten Abhängigkeiten und das Frontend als eine Datei. Geänderte Erwartung: Bis zum Bündelschritt lagen dort
// der Quellcode, shared/, die Migrationen, beide package.json, node_modules und client/dist, Tausende Dateien, die der
// Echtzeitschutz unter Windows beim Installieren einzeln prüft.
test('Programmfenster: ein unvollständiger oder überzähliger Server-Ordner bricht ab und nennt, was nicht stimmt', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fenster-server-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(REQUIRED_SERVER_FILES, ['server/server.mjs', 'server/THIRD-PARTY-LICENSES.txt', 'client/dist.pack'])
  assert.throws(() => checkServerFolder(dir), /server[\\/]server\.mjs fehlt/)
  for (const file of REQUIRED_SERVER_FILES) {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), '')
  }
  assert.doesNotThrow(() => checkServerFolder(dir))
  fs.rmSync(path.join(dir, 'client', 'dist.pack'))
  assert.throws(() => checkServerFolder(dir), /dist\.pack fehlt/)
  fs.writeFileSync(path.join(dir, 'client', 'dist.pack'), '')
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'express'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'server', 'node_modules', 'express', 'package.json'), '{}')
  assert.throws(() => checkServerFolder(dir), /mehr als vorgesehen: server\/node_modules\/express\/package\.json/)
})

// Seit dem Fund auf einem Rechner mit HP Wolf Security (das offene Bündel als Schadcode blockiert) liegt der Server in
// der app.asar des Fensters, unter mietfuchs/. Geprüft wird nach dem Bau das Archiv selbst: genau die drei Dateien,
// keine davon entpackt daneben (das wäre wieder eine offene Datei), jede mit Prüfsummen für die Integrität.
test('Programmfenster: der Server in der app.asar, vollständig, gepackt und mit Prüfsummen', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-asar-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const asar = (name: string, extra: Record<string, { content?: string, unpacked?: boolean, integrity?: boolean }> = {}, without?: string) => {
    const file = path.join(dir, `${name}.asar`)
    const entries: Record<string, { content?: string, unpacked?: boolean, integrity?: boolean }> = { 'package.json': { content: '{}' }, 'src/main.js': { content: '' } }
    for (const rel of REQUIRED_SERVER_FILES) if (rel !== without) entries[`${ARCHIVE_FOLDER}/${rel}`] = { content: rel }
    writeAsar(file, { ...entries, ...extra })
    return file
  }
  assert.equal(ARCHIVE_FOLDER, 'mietfuchs')
  const good = asar('gut')
  assert.deepEqual(asarFiles(good).map((f) => f.path).sort(), ['mietfuchs/client/dist.pack', 'mietfuchs/server/THIRD-PARTY-LICENSES.txt', 'mietfuchs/server/server.mjs', 'package.json', 'src/main.js'])
  assert.doesNotThrow(() => checkServerArchive(good))
  assert.throws(() => checkServerArchive(asar('ohne', {}, 'client/dist.pack')), /mietfuchs\/client\/dist\.pack fehlt in .*ohne\.asar/)
  assert.throws(() => checkServerArchive(asar('mehr', { 'mietfuchs/server/node_modules/x.js': {} })), /mehr als vorgesehen: mietfuchs\/server\/node_modules\/x\.js/)
  assert.throws(() => checkServerArchive(asar('entpackt', { 'mietfuchs/server/server.mjs': { unpacked: true } })), /mietfuchs\/server\/server\.mjs liegt entpackt neben/)
  assert.throws(() => checkServerArchive(asar('ohne-pruefsumme', { 'mietfuchs/client/dist.pack': { integrity: false } })), /mietfuchs\/client\/dist\.pack ohne Prüfsummen/)
  fs.writeFileSync(path.join(dir, 'kaputt.asar'), 'kein Archiv')
  assert.throws(() => checkServerArchive(path.join(dir, 'kaputt.asar')), /kein asar-Archiv/)
  assert.throws(() => checkServerArchive(path.join(dir, 'fehlt.asar')), /fehlt\.asar fehlt/)
})

// Im Bündel zeigt `import.meta.url` auf die eine Datei. Der Server rechnet von dort aus zu client/dist, server/drizzle
// und (beim Entwickeln) server/data, und zwar je Modul aus einer anderen Tiefe (index.ts aus server/src, client.ts aus
// server/src/db). Deshalb steht in jedem Modul die Adresse, die es im Repo hätte, relativ zum Bündel.
test('Programmfenster: import.meta.url im Bündel zeigt auf den Ort des Moduls im Repo', () => {
  const root = path.resolve('/repo')
  const out = path.join(root, 'dist-desktop-server', 'server', 'server.mjs')
  const code = 'const here = path.dirname(fileURLToPath(import.meta.url))'
  assert.equal(
    rewriteImportMeta(code, path.join(root, 'server', 'src', 'db', 'client.ts'), { root, bundleFile: out }),
    'const here = path.dirname(fileURLToPath(new URL("./src/db/client.ts", import.meta.url).href))',
  )
  assert.equal(
    rewriteImportMeta(code, path.join(root, 'shared', 'x.ts'), { root, bundleFile: out }),
    'const here = path.dirname(fileURLToPath(new URL("./../shared/x.ts", import.meta.url).href))',
  )
  // Ohne import.meta bleibt das Modul unberührt, ebenso Hilfsmodule des Bündlers
  assert.equal(rewriteImportMeta('export const a = 1', path.join(root, 'server', 'src', 'a.ts'), { root, bundleFile: out }), null)
  assert.equal(rewriteImportMeta(code, '\0rolldown/runtime.js', { root, bundleFile: out }), null)
  // Was sonst an import.meta hängt, kennt der Schritt nicht und bricht ab, statt still falsch zu rechnen
  assert.throws(() => rewriteImportMeta('const d = import.meta.dirname', path.join(root, 'server', 'src', 'a.ts'), { root, bundleFile: out }), /import\.meta\.dirname/)
  assert.throws(() => rewriteImportMeta(code, path.join(root, 'server', 'node_modules', 'x', 'index.js'), { root, bundleFile: out }), /node_modules/)
})

// Der wirkliche Weg: bündeln, Migrationen und ein Frontend daneben, mit Node starten. Der Server muss die Datenbank
// anlegen (Migrationen von der Platte) und die Oberfläche aus client/dist ausliefern, beides relativ zum Bündel.
test('Programmfenster: das Bündel startet ohne Quellen und Migrationen daneben, migriert und liefert die Oberfläche aus', { timeout: 60_000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-buendel-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const stage = path.join(tmp, 'mietfuchs')
  const { file, licenses } = await bundleServer(stage)
  assert.equal(file, path.join(stage, 'server', 'server.mjs'))
  // Die Lizenzen der gebündelten Abhängigkeiten liegen bei, sie fehlen sonst mit node_modules
  const licenseText = fs.readFileSync(licenses, 'utf8')
  assert.match(licenseText, /^express@\S+ \(MIT\)$/m)
  // Die Lizenz auch aus der alten Schreibweise `licenses: [{ type }]`, und jedes Paket nur einmal
  assert.match(licenseText, /^busboy@\S+ \(MIT\)$/m)
  const headers = licenseText.match(/^\S+@\d\S* \(.+\)$/gm) ?? []
  assert.equal(new Set(headers).size, headers.length, 'ein Paket steht doppelt')
  // Ein Frontend mit Unterordnern und Binärdateien wie die Zeichentabellen von pdf.js
  const dist = path.join(tmp, 'dist')
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(dist, 'pdfjs', 'cmaps'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Bündelprobe</title>')
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)')
  fs.writeFileSync(path.join(dist, 'pdfjs', 'cmaps', 'Adobe-Japan1-0.bcmap'), Buffer.from([0, 1, 2, 255]))
  assert.equal(packClient(dist, stage), 3)
  // Drei Dateien, mehr nicht: weder Quellcode noch Migrationen noch node_modules
  assert.doesNotThrow(() => checkServerFolder(stage))

  const dataDir = path.join(tmp, 'daten')
  const child = spawn(process.execPath, [file], {
    // Wie im Fenster: Der Arbeitsordner ist nicht der des Bündels (dort resources, außerhalb der app.asar)
    cwd: tmp,
    env: { ...process.env, NKA_RUNTIME: '', NKA_PORT: '0', NKA_DATA_DIR: dataDir, NKA_UPDATE_URL: 'http://127.0.0.1:9', CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  let output = ''
  const url = await new Promise<string>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk
      const found = output.match(/läuft auf (http:\/\/\S+)/)
      if (found?.[1]) resolve(found[1])
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => reject(new Error(`Bündel beendet (Code ${code}):\n${output}`)))
  })
  const health = await fetch(`${url}/healthz`)
  assert.equal(health.status, 200, await health.clone().text())
  // Die Migrationen kamen aus dem Bündel: Die Datenbank trägt jeden Schritt des Journals
  const journal = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'drizzle', 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }
  const db = new DatabaseSync(path.join(dataDir, 'mietfuchs.sqlite'), { readOnly: true })
  t.after(() => db.close())
  const applied = db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()
  assert.equal(applied?.n, journal.entries.length)
  // Und zwar dieselben wie unter Node von der Platte, Marke für Marke
  const hashes = db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at').all().map((row) => row.hash)
  assert.deepEqual(hashes, migrationsFromDisk().map((m) => m.hash))
  // Das Frontend kommt aus dist.pack: Seiten der Oberfläche als index.html, Dateien mit dem Typ nach der Endung
  const page = await fetch(`${url}/irgendeine/seite`)
  assert.match(page.headers.get('content-type') ?? '', /^text\/html/)
  assert.match(await page.text(), /Bündelprobe/)
  const script = await fetch(`${url}/assets/index-abc.js`)
  assert.match(script.headers.get('content-type') ?? '', /^text\/javascript/)
  assert.equal(await script.text(), 'console.log(1)')
  const cmap = await fetch(`${url}/pdfjs/cmaps/Adobe-Japan1-0.bcmap`)
  assert.deepEqual(Buffer.from(await cmap.arrayBuffer()), Buffer.from([0, 1, 2, 255]))
  // Die API bleibt die API, auch wenn es die Adresse nicht gibt
  const api = await fetch(`${url}/api/gibt-es-nicht`)
  assert.doesNotMatch(await api.text(), /Bündelprobe/)
})

// Durchsicht: Der macOS-Job prüfte das installierte Fenster mit `test -f …/Resources/mietfuchs/<Datei>`. Geänderte
// Erwartung: Der Server liegt in der app.asar; geprüft wird sie auf beiden Systemen mit `checkServerArchive`, dazu, dass
// kein offener Server-Ordner mehr daliegt. Eine Prüfung einzelner Dateien unter Resources/mietfuchs scheiterte jetzt.
test('Programmfenster: release.yml prüft im installierten Fenster die app.asar und keinen offenen Server-Ordner', () => {
  const workflow = fs.readFileSync(path.join(import.meta.dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8')
  const archiveChecks = [...workflow.matchAll(/m\.checkServerArchive\(process\.argv\[1\]\)\)" (.+)$/gm)].map((m) => m[1])
  assert.equal(archiveChecks.length, 2, 'release.yml prüft die app.asar nicht unter Windows und macOS')
  assert.ok(archiveChecks.some((arg) => arg.includes("Join-Path $resources 'app.asar'")), 'Windows')
  assert.ok(archiveChecks.some((arg) => arg.includes('"$app/Contents/Resources/app.asar"')), 'macOS')
  assert.match(workflow, /test ! -e "\$app\/Contents\/Resources\/mietfuchs"/)
  assert.match(workflow, /if \(Test-Path \(Join-Path \$resources 'mietfuchs'\)\) \{ throw/)
  assert.doesNotMatch(workflow, /test -f "\$app\/Contents\/Resources\/mietfuchs\//)
})
