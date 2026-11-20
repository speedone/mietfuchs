// Kompatibilitätszusage (#447): ein Bestand, den eine veröffentlichte Version geschrieben hat, im Server von heute.
//
// Unter fixtures/releases/<Version>/ liegt je Version, was scripts/altbestand-fixture.mjs einmal erzeugt hat:
//   backup.zip     das Backup, wie die Version es über /api/backup schreibt (Datenbank auf ihrem Stand, Belege)
//   expected.json  Abrechnung, Verbrauch, Mietkonto und Steuer je Objekt, wie die Version sie selbst ausgerechnet hat
//
// Der Test spielt das Backup über die echte Wiederherstellung ein (die Kette der Migrationen läuft dabei über den
// Bestand) und vergleicht, was der Server von heute dazu ausrechnet: **Jeder Wert, den die alte Version nannte, steht
// heute genauso da.** Neue Felder dürfen dazukommen, deshalb der Vergleich „alt in neu“ statt wortgleich. Was sich
// seit der Version bewusst geändert hat, steht je Version in `KNOWN` mit Grund; alles andere ist ein Befund.
//
// **Eine Fixture wird nie erneuert**, auch nicht, wenn dieser Test rot wird: Sie ist der Bestand, den es draußen
// gibt. Rot heißt, dass der Server von heute einen alten Bestand anders liest oder rechnet. Entweder ist das ein
// Fehler, oder die Änderung ist gewollt, im CHANGELOG genannt, und bekommt hier einen Eintrag in `KNOWN`. Zu einer
// neuen Version kommt ein neuer Ordner daneben (Aufruf im Kopf des Skripts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMigrations } from '../src/db/client.ts'
import { readClosedSettlements } from '../src/db/read.ts'
import { releaseStepsOf } from '../src/db/releaseSteps.ts'
import { besideServer, inDatabase, jsonOf, removeDataDir, restore, startServerIn } from '../testing/api.ts'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'releases')

type Expected = {
  version: string
  year: number
  today: string
  // Dazu je Objekt `property`, `units`, `tenancies` und oben `settings` für den Nachdruck (client/src/pages/Abrechnung.nachdruck.test.tsx).
  properties: { id: string, name: string, settlement: unknown, consumption: unknown, rentLedger: unknown, taxReport: unknown }[]
}
const ROUTES = [['settlement', 'settlement'], ['consumption', 'consumption'], ['rentLedger', 'rentledger'], ['taxReport', 'taxreport']] as const

// Was sich seit einer Version bewusst geändert hat: Pfade (als regulärer Ausdruck über `Objekt/Route/Pfad`) mit Grund.
// Ein Eintrag nimmt den Pfad aus dem Vergleich; er gehört zu einer im CHANGELOG genannten Änderung.
const KNOWN: Record<string, { path: RegExp, why: string }[]> = {
  '0.13.1': [],
  '0.18.1': [],
}
// Was mit jeder Version wandern darf, ohne dass sich am Bestand etwas ändert.
const MOVING: { path: RegExp, why: string }[] = [
  { path: /\/settlement\.legalBasis\.asOf: /, why: 'der Stand des Rechtsregisters einer offenen Abrechnung; er wandert mit jeder Durchsicht der Rechtslage (#110)' },
]

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Jede Stelle, an der `now` nicht enthält, was `old` nannte. Listen müssen gleich lang sein und in derselben
// Reihenfolge stehen: Die Reihenfolge der Zeilen ist Teil der gedruckten Abrechnung.
function missing(old: unknown, now: unknown, at: string, out: string[]): string[] {
  if (Array.isArray(old)) {
    if (!Array.isArray(now) || now.length !== old.length) out.push(`${at}: Liste mit ${old.length} Einträgen, heute ${Array.isArray(now) ? now.length : typeof now}`)
    else old.forEach((v, i) => missing(v, now[i], `${at}[${i}]`, out))
  } else if (isRecord(old)) {
    if (!isRecord(now)) out.push(`${at}: Objekt, heute ${JSON.stringify(now)?.slice(0, 80)}`)
    else for (const [k, v] of Object.entries(old)) missing(v, now[k], `${at}.${k}`, out)
  } else if (old !== now) {
    out.push(`${at}: ${JSON.stringify(old)?.slice(0, 120)} wurde ${JSON.stringify(now)?.slice(0, 120)}`)
  }
  return out
}

const versions = fs.existsSync(DIR) ? fs.readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []

test('es gibt mindestens den Bestand aus 0.13.1, den #447 verlangt', () => {
  assert.ok(versions.includes('0.13.1'), `unter ${DIR} fehlt 0.13.1`)
  for (const v of versions) assert.ok(v in KNOWN, `Zu ${v} fehlt der Eintrag in KNOWN (leer, wenn nichts abweicht)`)
})

for (const version of versions) {
  test(`Bestand aus ${version}: Backup einspielen, Abrechnung, Verbrauch, Mietkonto und Steuer wie damals`, async () => {
    const expected = JSON.parse(fs.readFileSync(path.join(DIR, version, 'expected.json'), 'utf8')) as Expected
    assert.equal(expected.version, version)
    assert.ok(expected.properties.length > 0, 'kein Objekt in der Fixture')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-altbestand-'))
    const s = await startServerIn(dataDir, { NKA_TEST_TODAY: expected.today })
    try {
      const restored = await restore(s, fs.readFileSync(path.join(DIR, version, 'backup.zip')))
      assert.equal(restored.status, 200, JSON.stringify(restored.body))

      // Das Backup stand auf dem Stand der Version, heute steht die ganze Kette in der Datenbank.
      const beside = await besideServer(dataDir)
      let applied = 0
      try {
        applied = Number(beside.rows('SELECT count(*) FROM __drizzle_migrations')[0]?.[0])
      } finally {
        beside.close()
      }
      const steps = (await loadMigrations()).length
      assert.equal(applied, steps, 'nach dem Einspielen steht die ganze Kette in der Datenbank')
      assert.ok(releaseStepsOf(version) > 0 && releaseStepsOf(version) <= steps, `${version} brachte ${releaseStepsOf(version)} Schritte mit, heute sind es ${steps}`)

      const found: string[] = []
      for (const p of expected.properties) {
        for (const [key, route] of ROUTES) {
          const res = await fetch(`${s.base}/api/${route}/${expected.year}?property=${encodeURIComponent(p.id)}`)
          assert.equal(res.status, 200, `${route} für ${p.name}: HTTP ${res.status}`)
          missing(p[key], await jsonOf<unknown>(res), `${p.name}/${route}`, found)
        }
      }
      const known = KNOWN[version] ?? []
      const open = found.filter((line) => ![...known, ...MOVING].some((k) => k.path.test(line)))
      assert.deepEqual(open.slice(0, 40), [],
        `Der Server von heute liest oder rechnet den Bestand aus ${version} anders als ${version} selbst (${open.length} Stellen). ` +
        'Die Fixture wird nicht erneuert: Sie ist der Bestand, den es draußen gibt. Entweder ist das ein Fehler, oder die Änderung ist gewollt und im CHANGELOG genannt; ' +
        'dann bekommt sie einen Eintrag mit Grund in KNOWN in diesem Test.')
      for (const k of known) assert.ok(found.some((line) => k.path.test(line)), `KNOWN ${k.path} (${k.why}) trifft nichts mehr und kann weg`)

      // Der eingefrorene Stand der abgeschlossenen Abrechnung liegt wortgleich in der Datenbank, wie die Version ihn
      // schrieb: Zahlen, Zeilen, Hinweise, Anschreiben.
      const closed = await inDatabase(s, (db) => readClosedSettlements(db))
      const frozen = expected.properties.filter((p) => isRecord(p.settlement) && isRecord(p.settlement.closed))
      assert.ok(frozen.length > 0, 'die Fixture enthält keine abgeschlossene Abrechnung')
      assert.equal(closed.length, frozen.length)
      for (const p of frozen) {
        const stored = closed.find((c) => c.propertyId === p.id)?.settlement ?? assert.fail(`der Abschluss von ${p.name} fehlt`)
        if (!isRecord(p.settlement) || !isRecord(stored)) assert.fail('der eingefrorene Stand ist kein Objekt')
        for (const part of ['statements', 'landlord', 'totalCostsCents', 'letters', 'notices']) {
          assert.deepEqual(stored[part], p.settlement[part], `${p.name}: „${part}“ des eingefrorenen Standes ist nicht mehr, was ${version} zugestellt hat`)
        }
      }
    } finally {
      s.stop()
      removeDataDir(dataDir)
    }
  })
}
