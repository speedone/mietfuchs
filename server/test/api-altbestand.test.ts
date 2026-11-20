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
  '0.13.1': [
    { path: /\/settlement\.legalBasis\.rules\[code=heating-consumption\]\.norm: /, why: 'die Norm der Regel zum Verbrauchsanteil nennt zusätzlich § 10 HeizkostenV (Hinweis „ganz nach Zählern“, rechtsgeschäftliche Bestimmung); nur die Fundstelle einer offenen Abrechnung, keine Zahl ändert sich' },
  ],
  '0.18.1': [
    { path: /\/settlement\.legalBasis\.rules\[code=heating-consumption\]\.norm: /, why: 'die Norm der Regel zum Verbrauchsanteil nennt zusätzlich § 10 HeizkostenV (Hinweis „ganz nach Zählern“, rechtsgeschäftliche Bestimmung); nur die Fundstelle einer offenen Abrechnung, keine Zahl ändert sich' },
  ],
}
// Was mit jeder Version wandern darf, ohne dass sich am Bestand etwas ändert. **Nur an einer offenen Abrechnung**: Eine
// abgeschlossene ist eingefroren, an ihr wandert nichts.
const MOVING_WHILE_OPEN: { path: RegExp, why: string }[] = [
  { path: /\/settlement\.legalBasis\.asOf: /, why: 'der Stand des Rechtsregisters einer offenen Abrechnung; er wandert mit jeder Durchsicht der Rechtslage (#110)' },
]

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Woran sich die Einträge einer Liste wiedererkennen lassen, in dieser Reihenfolge. `code` heißt: eine Liste von
// Hinweisen der Berechnung.
const LIST_KEYS = ['code', 'costItemId', 'tenancyId', 'id'] as const
const keyOfList = (old: unknown[]): typeof LIST_KEYS[number] | null =>
  LIST_KEYS.find((k) => old.length > 0 && old.every((v) => isRecord(v) && typeof v[k] === 'string')) ?? null
// Hinweise als bloße Sätze (`warnings`) gelten wie die mit `code`.
const isNoticeList = (at: string, key: string | null): boolean => key === 'code' || /\.warnings$/.test(at)

type Findings = { lines: string[], added: string[] }
const none = (): Findings => ({ lines: [], added: [] })

// Jede Stelle, an der `now` nicht enthält, was `old` nannte („alt in neu“).
//
// **Listen werden nach ihrem Schlüssel zugeordnet, nicht nach der Stelle**: Hinweise nach `code`, Zeilen nach
// `costItemId`, `tenancyId` oder `id`; nur Listen ohne solchen Schlüssel nach der Stelle. Jeder damalige Eintrag muss
// wieder da sein und wird Feld für Feld verglichen. **Kommt heute ein Hinweis dazu** (eine neue Prüfung der Berechnung
// an einem alten Bestand), ist das erlaubt und steht nur im Protokoll (`added`); so macht ein neuer Hinweis den Test
// nicht rot und nimmt keinen Geldvergleich aus dem Spiel. Ein zusätzlicher Eintrag in jeder anderen Liste (eine Zeile
// der Abrechnung, des Mietkontos, der Steuer) ist ein Fehler, ebenso eine andere Reihenfolge der damaligen Zeilen.
function missing(old: unknown, now: unknown, at: string, out: Findings): Findings {
  if (Array.isArray(old)) {
    if (!Array.isArray(now)) {
      out.lines.push(`${at}: Liste mit ${old.length} Einträgen, heute ${JSON.stringify(now)?.slice(0, 80)}`)
      return out
    }
    const key = keyOfList(old)
    const notices = isNoticeList(at, key)
    const used = new Set<number>()
    let last = -1
    old.forEach((v, i) => {
      const label = key && isRecord(v) ? `${at}[${key}=${String(v[key])}]` : `${at}[${i}]`
      let found = -1
      if (key && isRecord(v)) {
        // Mehrere Einträge mit demselben Schlüssel (derselbe Hinweis für zwei Mieter): zuerst der, an dem nichts fehlt.
        const candidates = now.flatMap((n, k) => (!used.has(k) && isRecord(n) && n[key] === v[key] ? [k] : []))
        found = candidates.find((k) => missing(v, now[k], label, none()).lines.length === 0) ?? candidates[0] ?? -1
      } else if (notices) {
        found = now.findIndex((n, k) => !used.has(k) && n === v)
      } else if (i < now.length) {
        found = i
      }
      if (found < 0) {
        out.lines.push(`${label}: fehlt heute (${JSON.stringify(v)?.slice(0, 120)})`)
        return
      }
      used.add(found)
      if (!notices && found < last) out.lines.push(`${label}: steht heute an anderer Stelle der Liste`)
      last = Math.max(last, found)
      missing(v, now[found], label, out)
    })
    const extra = now.flatMap((n, k) => (used.has(k) ? [] : [`${at}: heute zusätzlich ${JSON.stringify(n)?.slice(0, 160)}`]))
    if (notices) out.added.push(...extra)
    else out.lines.push(...extra)
  } else if (isRecord(old)) {
    if (!isRecord(now)) out.lines.push(`${at}: Objekt, heute ${JSON.stringify(now)?.slice(0, 80)}`)
    else for (const [k, v] of Object.entries(old)) missing(v, now[k], `${at}.${k}`, out)
  } else if (old !== now) {
    out.lines.push(`${at}: ${JSON.stringify(old)?.slice(0, 120)} wurde ${JSON.stringify(now)?.slice(0, 120)}`)
  }
  return out
}

test('der Vergleich „alt in neu“: Hinweise dürfen dazukommen, Geldzeilen nicht, und daneben wird weiter verglichen', () => {
  const c1 = { costItemId: 'c1', shareCents: 100 }
  const c2 = { costItemId: 'c2', shareCents: 200 }
  const old = { notices: [{ code: 'a', text: 'A' }, { code: 'b', text: 'B' }], warnings: ['ein Satz'], rows: [c1, c2], months: [1, 2] }
  const withHint = [{ code: 'neu', text: 'N' }, ...old.notices]
  // Ein neuer Hinweis vorn: erlaubt, und die Zeilen daneben werden weiter verglichen.
  const hint = missing(old, { ...old, notices: withHint, warnings: ['neu', 'ein Satz'] }, 'x', none())
  assert.deepEqual(hint.lines, [])
  assert.equal(hint.added.length, 2)
  // Ein Cent neben einem neuen Hinweis fällt weiter auf.
  const cent = missing(old, { ...old, notices: withHint, rows: [c1, { ...c2, shareCents: 201 }] }, 'x', none())
  assert.deepEqual(cent.lines, ['x.rows[costItemId=c2].shareCents: 200 wurde 201'])
  // Ein damaliger Hinweis fehlt, sein Text ist anders, eine Geldzeile kommt dazu, fehlt oder steht woanders: Fehler.
  assert.equal(missing(old, { ...old, notices: [{ code: 'a', text: 'A' }] }, 'x', none()).lines.length, 1)
  assert.equal(missing(old, { ...old, notices: [{ code: 'a', text: 'anders' }, { code: 'b', text: 'B' }] }, 'x', none()).lines.length, 1)
  assert.equal(missing(old, { ...old, rows: [c1, c2, { costItemId: 'c3', shareCents: 1 }] }, 'x', none()).lines.length, 1)
  assert.equal(missing(old, { ...old, rows: [c1] }, 'x', none()).lines.length, 1)
  assert.equal(missing(old, { ...old, rows: [c2, c1] }, 'x', none()).lines.length, 1)
  assert.equal(missing(old, { ...old, months: [1, 2, 3] }, 'x', none()).lines.length, 1)
  // Derselbe Hinweis zweimal (zwei Mieter): jeder findet seinen.
  const twice = { notices: [{ code: 'a', text: 'eins' }, { code: 'a', text: 'zwei' }] }
  assert.deepEqual(missing(twice, { notices: [{ code: 'a', text: 'zwei' }, { code: 'a', text: 'eins' }] }, 'x', none()).lines, [])
})

const versions = fs.existsSync(DIR) ? fs.readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []

test('es gibt mindestens den Bestand aus 0.13.1, den #447 verlangt', () => {
  assert.ok(versions.includes('0.13.1'), `unter ${DIR} fehlt 0.13.1`)
  for (const v of versions) assert.ok(v in KNOWN, `Zu ${v} fehlt der Eintrag in KNOWN (leer, wenn nichts abweicht)`)
})

for (const version of versions) {
  test(`Bestand aus ${version}: Backup einspielen, Abrechnung, Verbrauch, Mietkonto und Steuer wie damals`, async (t) => {
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

      const closedStock = await inDatabase(s, (db) => readClosedSettlements(db))
      const found: string[] = []
      const added: string[] = []
      for (const p of expected.properties) {
        const isOpen = !(isRecord(p.settlement) && isRecord(p.settlement.closed))
        for (const [key, route] of ROUTES) {
          const res = await fetch(`${s.base}/api/${route}/${expected.year}?property=${encodeURIComponent(p.id)}`)
          assert.equal(res.status, 200, `${route} für ${p.name}: HTTP ${res.status}`)
          const result = missing(p[key], await jsonOf<unknown>(res), `${p.name}/${route}`, none())
          // Was wandern darf, wandert nur an der offenen Abrechnung.
          found.push(...result.lines.filter((line) => !(isOpen && MOVING_WHILE_OPEN.some((m) => m.path.test(line)))))
          added.push(...result.added)
        }
      }
      // Neue Hinweise der Berechnung an einem alten Bestand sind erlaubt und stehen im Protokoll.
      for (const line of added) t.diagnostic(`neuer Hinweis: ${line}`)
      const known = KNOWN[version] ?? []
      const open = found.filter((line) => !known.some((k) => k.path.test(line)))
      assert.deepEqual(open.slice(0, 40), [],
        `Der Server von heute liest oder rechnet den Bestand aus ${version} anders als ${version} selbst (${open.length} Stellen). ` +
        'Die Fixture wird nicht erneuert: Sie ist der Bestand, den es draußen gibt. Entweder ist das ein Fehler, oder die Änderung ist gewollt und im CHANGELOG genannt; ' +
        'dann bekommt sie einen Eintrag mit Grund in KNOWN in diesem Test, so eng wie möglich (ein Feld, nicht eine ganze Liste).')
      for (const k of known) assert.ok(found.some((line) => k.path.test(line)), `KNOWN ${k.path} (${k.why}) trifft nichts mehr und kann weg`)

      // Der eingefrorene Stand der abgeschlossenen Abrechnung liegt **ganz und wortgleich** in der Datenbank, wie die
      // Version ihn schrieb: jedes Feld, auch Hinweise, Anschreiben und der Stand des Rechts. Hier gilt keine Ausnahme,
      // weder KNOWN noch was an einer offenen Abrechnung wandern darf. Verglichen wird mit der Antwort der Version auf
      // ihren eigenen Abschluss, die den Stand unverändert enthält.
      const frozen = expected.properties.filter((p) => isRecord(p.settlement) && isRecord(p.settlement.closed))
      assert.ok(frozen.length > 0, 'die Fixture enthält keine abgeschlossene Abrechnung')
      assert.equal(closedStock.length, frozen.length)
      for (const p of frozen) {
        const stored = closedStock.find((c) => c.propertyId === p.id)?.settlement ?? assert.fail(`der Abschluss von ${p.name} fehlt`)
        if (!isRecord(p.settlement) || !isRecord(stored)) assert.fail('der eingefrorene Stand ist kein Objekt')
        for (const part of ['statements', 'landlord', 'totalCostsCents', 'letters', 'notices', 'legalBasis']) assert.ok(part in stored, `${p.name}: dem eingefrorenen Stand fehlt „${part}“`)
        for (const [part, value] of Object.entries(stored)) {
          assert.deepEqual(value, p.settlement[part], `${p.name}: „${part}“ des eingefrorenen Standes ist nicht mehr, was ${version} zugestellt hat`)
        }
      }
    } finally {
      s.stop()
      removeDataDir(dataDir)
    }
  })
}
