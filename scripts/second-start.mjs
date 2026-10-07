// Prüft von außen, dass ein zweiter Start die Daten nicht anfasst, solange auf seinem Port schon
// Mietfuchs läuft (#244). Die CI ruft es nach dem Smoke-Test auf jeder Programmdatei auf, während
// die erste Instanz noch läuft:
//
//   node scripts/second-start.mjs --url http://127.0.0.1:3001 --program ./bin/mietfuchs-linux
//
// Der zweite Start bekommt einen eigenen Wegwerf-Datenordner, in dem er etwas zu tun hätte: eine
// db.json, die in die Datenbank umsteigen will. Ein Start, der die Datenbank vor dem Port öffnet,
// legte dort mietfuchs.sqlite an, migrierte sie und benannte die db.json in db.json.abgeloest um.
// Erwartet wird stattdessen: Exit 0, „läuft bereits“ und ein byteweise unveränderter Ordner.
//
// Geprüft wird hier die Programmdatei, also Bun auf jedem System: Ob ihr Port exklusiv gebunden
// wird und ein belegter Port als Fehler-Ereignis ankommt, zeigen die Tests unter Node nicht.
//
// Lokal lässt sich statt einer Programmdatei auch der Quellcode prüfen, dann mit der Betriebsart
// der Programmdatei, denn nur dort endet ein zweiter Start mit Code 0:
//
//   NKA_RUNTIME=binary node scripts/second-start.mjs --url http://127.0.0.1:4244 --program node -- server/src/index.ts
//
// Absichtlich ohne Abhängigkeiten, wie smoke-test.mjs.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const BASE = opt('url', 'http://127.0.0.1:3001').replace(/\/+$/, '')
const PROGRAM = opt('program', '')
const EXTRA = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : []
const TIMEOUT_SECONDS = Number(opt('timeout', '60'))

let passed = 0
function assert(condition, text, details) {
  if (!condition) throw new Error(`${text}${details === undefined ? '' : `\n    ${typeof details === 'string' ? details : JSON.stringify(details).slice(0, 2000)}`}`)
  passed++
  console.log(`  ✓ ${text}`)
}

// Jede Datei im Ordner mit ihrer Prüfsumme, Unterordner eingeschlossen.
function fingerprint(dir) {
  /** @type {Record<string, string>} */
  const result = {}
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    result[path.relative(dir, file).split(path.sep).join('/')] = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }
  return result
}

async function main() {
  if (!PROGRAM) throw new Error('Es fehlt --program, die Programmdatei für den zweiten Start.')
  const port = new URL(BASE).port || '80'

  // Die erste Instanz muss laufen und sich als Mietfuchs melden, sonst prüfte der zweite Start
  // etwas anderes als den zweiten Klick.
  /** @type {any} */
  const health = await (await fetch(`${BASE}/healthz`)).json()
  assert(health?.app === 'mietfuchs', `Auf ${BASE} läuft Mietfuchs`, health)

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zweiter-start-'))
  try {
    fs.mkdirSync(path.join(dataDir, 'uploads'))
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
      settings: { houseName: 'Zweiter Start', address: 'Weg 1', landlordName: 'V', iban: '', paymentDeadlineDays: 30 },
      units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }],
      tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
    }))
    const before = fingerprint(dataDir)

    // Die drei Angaben jedes Prüfstarts, CI hinter allem anderen: kein Browserfenster, kein GitHub,
    // ein Wegwerf-Ordner.
    // Ein Pfad zur Programmdatei wird absolut gemacht (unter Windows sucht CreateProcess sonst
    // nicht verlässlich im Arbeitsverzeichnis); ein bloßer Befehlsname wie `node` bleibt.
    const program = fs.existsSync(PROGRAM) ? path.resolve(PROGRAM) : PROGRAM
    const child = spawn(program, EXTRA, {
      env: { ...process.env, NKA_DATA_DIR: dataDir, NKA_PORT: port, NKA_UPDATE_URL: 'http://127.0.0.1:9/kein-internet-im-test', CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`Der zweite Start hat sich nach ${TIMEOUT_SECONDS} s nicht beendet.\n${output}`))
      }, TIMEOUT_SECONDS * 1000)
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.on('exit', (exitCode) => {
        clearTimeout(timer)
        resolve(exitCode)
      })
    })
    assert(code === 0, 'Der zweite Start endet mit Code 0', `Code ${code}\n${output}`)
    assert(/läuft bereits/.test(output), 'Er meldet, dass Mietfuchs bereits läuft', output)
    const after = fingerprint(dataDir)
    assert(JSON.stringify(after) === JSON.stringify(before), 'Sein Datenordner ist byteweise unverändert (keine Datenbank, keine Sicherung, db.json nicht umbenannt)', { vorher: before, nachher: after, ausgabe: output })

    /** @type {any} */
    const still = await (await fetch(`${BASE}/healthz`)).json()
    assert(still?.app === 'mietfuchs', 'Die erste Instanz läuft weiter', still)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
  console.log(`\nAlle ${passed} Prüfungen bestanden.`)
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
