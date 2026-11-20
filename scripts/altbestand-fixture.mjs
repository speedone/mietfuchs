// Einen Bestand einer veröffentlichten Version als Fixture festhalten (#447, Kompatibilitätszusage): Die alte Version
// schreibt ihn selbst, und was sie dazu ausrechnet, liegt daneben. server/test/api-altbestand.test.ts spielt das Backup in
// den Server von heute ein und vergleicht centgenau.
//
// **Wozu, wenn es migrateUpTo und den Praxislauf gibt.** `migrateUpTo` bringt eine Datenbank auf den Stand eines
// Schrittes, aber gefüllt wird sie dann mit rohen Zeilen von heute; was die alte Version wirklich schrieb, weiß nur ihr
// eigener Code. Der Praxislauf (fenster-umzug-praxislauf.mjs) lässt die alten Programmdateien laufen, braucht dafür
// aber das Netz und läuft nur im vollen Prüfumfang. Hier läuft die alte Version **aus ihrem Tag im Repo**, ohne Netz
// und ohne Programmdatei, einmal beim Erzeugen; der Test danach braucht nur die eingecheckten Dateien.
//
// Ablauf:
//   1. `git archive <Tag>` legt Server, shared/ und die Skripte der Version in einen Wegwerf-Ordner; die `node_modules`
//      von heute werden verknüpft (geprüft mit v0.13.1; weicht eine Abhängigkeit zu weit ab, startet die Version nicht,
//      und das Skript sagt es).
//   2. Der Server der Version startet mit Wegwerf-Datenordner, `CI=1`, Update-Adresse ins Leere, 127.0.0.1, festen
//      Kennungen (`NKA_TEST_IDS=seq`) und festem Tag (`NKA_TEST_TODAY`). Keine `NKA_`-Angabe aus der Shell des
//      Entwicklers geht mit (Anmeldung, Passwort, KI-Dienst). Das nachgebaute Ollama lauscht auf dem Port nach dem des
//      Servers, damit die Adresse in den Einstellungen des Bestands nicht vom Zufall abhängt.
//   3. Der Beispielbestand der Version selbst (`seed` aus ihrem scripts/demo-stock.mjs: Mehrfamilienhaus und
//      Eigentumswohnung, Mieterwechsel, Zähler, Zahlungen, Belege, eine KI-Auswertung über ihr nachgebautes Ollama)
//      entsteht über ihre API. Danach schließt das Skript die Abrechnung des Hauses ab, damit ein eingefrorener Stand
//      im Bestand liegt.
//   4. Abrechnung, Verbrauch, Mietkonto und Steuer je Objekt über die API der Version nach `expected.json` (dazu
//      Einstellungen, Objekt, Wohnungen und Mietverhältnisse, die der Nachdruck im Client-Test braucht), das Backup
//      nach `backup.zip`, beides unter server/test/fixtures/releases/<Version>/.
//
// **Eine Fixture einer veröffentlichten Version wird einmal erzeugt und nie erneuert**: Sie ist der Bestand, den es
// draußen gibt. Das Skript weigert sich deshalb, eine vorhandene zu überschreiben. Für eine neue Version kommt ein
// neuer Ordner daneben. Alle Daten sind die erfundenen des Beispielbestands.
//
// **Was vom Lauf abhängt und bleibt**: Der Zeitpunkt des Abschlusses (`closedAt`) und die Zeitstempel in den Namen der
// Belege kommen aus der Uhr der alten Version, die sich von außen nicht stellen lässt. Sie stehen im Backup wie in
// expected.json, der Vergleich bleibt also wortgleich. In den beiden ersten Fixtures (0.13.1, 0.18.1) steht in
// `settings.ollamaUrl` noch ein Zufallsport; `settings` vergleicht kein Test, der Nachdruck liest daraus nur die
// Angaben des Vermieters.
//
// Aufruf (vom Repo-Root, der Port muss frei sein):
//   node scripts/altbestand-fixture.mjs --tag v0.13.1 --port 3999      (das nachgebaute Ollama nimmt den Port danach,
//                                                                       sonst --ollama-port)
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (/** @type {string} */ name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const tag = option('--tag')
const port = Number(option('--port'))
// Das nachgebaute Ollama: ohne Angabe der Port nach dem des Servers
const ollamaPort = Number(option('--ollama-port') ?? port + 1)
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag) || !Number.isInteger(port) || port < 1024 || !Number.isInteger(ollamaPort) || ollamaPort < 1024 || ollamaPort > 65535 || ollamaPort === port) {
  console.error('Aufruf: node scripts/altbestand-fixture.mjs --tag v0.13.1 --port <freier Port> [--ollama-port <freier Port>]')
  process.exit(2)
}
const version = tag.slice(1)
const target = path.resolve(option('--out') ?? path.join(ROOT, 'server', 'test', 'fixtures', 'releases'), version)
if (fs.existsSync(path.join(target, 'backup.zip'))) {
  console.error(`${path.relative(ROOT, target)} gibt es schon. Die Fixture einer veröffentlichten Version wird nicht erneuert.`)
  process.exit(2)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-altbestand-'))
const source = path.join(work, 'quellen')
const dataDir = path.join(work, 'daten')
fs.mkdirSync(source)
fs.mkdirSync(dataDir)

/** @type {import('node:child_process').ChildProcess | null} */
let server = null
/** @type {{ stop: () => void } | null} */
let ollama = null
const cleanUp = () => {
  server?.kill()
  ollama?.stop()
  fs.rmSync(work, { recursive: true, force: true })
}

try {
  // 1. Die Quellen der Version
  const tar = path.join(work, 'quellen.tar')
  execFileSync('git', ['archive', '--format=tar', '-o', tar, tag, 'server', 'shared', 'scripts', 'package.json'], { cwd: ROOT })
  execFileSync('tar', ['-xf', tar, '-C', source])
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(source, 'node_modules'), 'dir')
  fs.symlinkSync(path.join(ROOT, 'server', 'node_modules'), path.join(source, 'server', 'node_modules'), 'dir')

  // 2. Ihr Server, mit ihrem nachgebauten Ollama und ihrem Beispielbestand
  /** @type {any} */
  const demo = await import(pathToFileURL(path.join(source, 'scripts', 'demo-stock.mjs')).href)
  /** @type {any} */
  const fake = await import(pathToFileURL(path.join(source, 'scripts', 'fake-ollama.mjs')).href)
  /** @type {number} */
  const year = demo.YEAR
  const today = `${year + 1}-10-27`
  const fakeOllama = await fake.startFakeOllama({ port: ollamaPort, sequence: ['GARTEN'] })
  ollama = fakeOllama
  let log = ''
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: path.join(source, 'server'),
    env: {
      // Ohne die NKA_-Angaben des Entwicklers (wie startServerIn in server/testing/api.ts): Ein gesetztes NKA_AUTH,
      // NKA_PASSWORD oder NKA_AI_* veränderte sonst den Bestand oder ließe den Lauf an der Anmeldung scheitern.
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('NKA_'))), NKA_DATA_DIR: dataDir, NKA_PORT: String(port), NKA_HOST: '127.0.0.1', NKA_OLLAMA_URL: fakeOllama.url, NKA_OLLAMA_MODEL: 'qwen3.5:4b',
      NKA_TEST_IDS: 'seq', NKA_TEST_TODAY: today, CI: '1', NKA_UPDATE_URL: 'http://127.0.0.1:9/',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server = child
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; ; i++) {
    if (child.exitCode !== null || i > 240) throw new Error(`Der Server von ${tag} startet nicht:\n${log}`)
    /** @type {any} */
    const health = await fetch(`${base}/healthz`).then((r) => r.json(), () => null)
    if (health?.version === version) break
    if (health) throw new Error(`Auf Port ${port} antwortet etwas anderes: ${JSON.stringify(health).slice(0, 200)}`)
    await new Promise((r) => setTimeout(r, 250))
  }
  const api = demo.client(base)
  await demo.seed(api, async (/** @type {string} */ html) => demo.textPdf(html))

  // 3. Ein eingefrorener Stand: die Abrechnung des ersten Objekts abschließen, wie die Seite es tut
  /** @type {any[]} */
  const properties = await api.get('/api/properties')
  const house = properties[0]
  if (!house) throw new Error('kein Objekt im Bestand')
  await api.post(`/api/settlement/${year}/close?property=${house.id}`, { sentAt: `${year + 1}-03-16` })

  // 4. Was die Version dazu ausrechnet, und ihr Backup
  const results = []
  for (const p of properties) {
    const q = `?property=${p.id}`
    results.push({
      id: p.id, name: p.name,
      // Was die Seite Abrechnung neben dem Ergebnis bekommt, für den Nachdruck im Client-Test
      property: p, units: await api.get(`/api/units${q}`), tenancies: await api.get(`/api/tenancies${q}`),
      settlement: await api.get(`/api/settlement/${year}${q}`),
      consumption: await api.get(`/api/consumption/${year}${q}`),
      rentLedger: await api.get(`/api/rentledger/${year}${q}`),
      taxReport: await api.get(`/api/taxreport/${year}${q}`),
    })
  }
  const backup = await fetch(`${base}/api/backup`)
  if (!backup.ok) throw new Error(`Backup: HTTP ${backup.status}`)
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'backup.zip'), Buffer.from(await backup.arrayBuffer()))
  fs.writeFileSync(path.join(target, 'expected.json'), `${JSON.stringify({ version, year, today, settings: await api.get('/api/settings'), properties: results }, null, 1)}\n`, 'utf8')
  console.log(`${path.relative(ROOT, target)}: backup.zip (${fs.statSync(path.join(target, 'backup.zip')).size} Byte), expected.json, ${properties.length} Objekte, Jahr ${year}, heute ${today}`)
} finally {
  cleanUp()
}
