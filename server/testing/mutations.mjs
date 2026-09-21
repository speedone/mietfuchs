// Mutationslauf über die Zusicherungen des Repositories (#55, Aufgabe 6).
//
// **Warum es das gibt.** db/repository.ts ist implementierungsgetrieben entstanden: erst der
// Code, dann die Tests. Damit fehlt der Nachweis, den die rote Phase sonst liefert — dass ein
// Test den Fehler, gegen den er dasteht, wirklich fängt. Ein Test, der nie rot war, kann auch
// eine Zusicherung prüfen, die gar nicht gilt.
//
// Dieser Lauf holt das nach: Er verändert je Zusicherung genau eine Stelle im Produktionscode
// so, dass die Zusicherung verletzt ist, und lässt den zugehörigen Test laufen. **Bleibt er
// grün, ist er wertlos** und der Lauf meldet es.
//
// Ausführen: `node testing/mutations.mjs` im Ordner server/. Die Dateien werden dabei verändert
// und in jedem Fall wieder hergestellt, auch bei einem Abbruch.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'src/db/repository.ts'
const CLIENT = 'src/db/client.ts'
const OPEN = 'src/db/open.ts'
const TESTS = 'test/db-repository.test.ts'

// Je Zusicherung eine Mutation. `change` ist eine Liste aus Datei, gesuchtem Text und Ersatz;
// gefunden werden muss jeder, sonst ist die Mutation ins Leere gelaufen und der Lauf bricht ab.
const MUTATIONS = [
  {
    what: 'Anlegen gibt den gespeicherten Stand zurück',
    test: 'Anlegen: der Datensatz kommt so zurück',
    change: [[REPO, 'id: u.id, name: u.name, areaM2: u.areaM2', 'id: u.id, name: \'\', areaM2: u.areaM2']],
  },
  {
    what: 'PUT verschmilzt, statt zu ersetzen',
    test: 'Ändern verschmilzt',
    change: [[REPO, 'c.replace(tx, c.merge(current, body))', 'c.replace(tx, c.merge(c.empty(id), body))']],
  },
  {
    what: 'Verschmolzen wird nach Anwesenheit, nicht nach Wert',
    test: 'ein ausdrückliches null setzt zurück',
    change: [[REPO, 'return has(body, key) ? read(raw(body, key)) : current',
      'return raw(body, key) !== undefined && raw(body, key) !== null ? read(raw(body, key)) : current']],
  },
  {
    what: 'Die Hauptzeile wird geändert, nicht neu geschrieben',
    test: 'Ändern lässt die Reihenfolge',
    change: [[REPO, 'replace: async (db, u) => { await db.update(units).set(unitRow(u)).where(eq(units.id, u.id)) },',
      'replace: async (db, u) => { await db.delete(units).where(eq(units.id, u.id)); await db.insert(units).values(unitRow(u)) },']],
  },
  {
    what: 'Ein unbekanntes Feld kommt nicht an (#60)',
    test: 'Ein unbekanntes Feld kommt gar nicht erst an',
    // Einzeilig wie alle anderen: Ein Suchtext über mehrere Zeilen hinge an den Zeilenenden, und
    // die stehen unter Windows nicht fest (Git stellt Textdateien auf CRLF um).
    change: [[REPO, '  return gespeichert', '  return { ...gespeichert, ...Object(body) }']],
  },
  {
    what: 'Ein Datensatz, den es nicht gibt, meldet sich',
    test: 'Ändern eines Datensatzes, den es nicht gibt',
    change: [[REPO, 'if (!(await c.read(db)).some((eintrag) => eintrag.id === id)) return false', 'if (false) return false']],
  },
  {
    what: 'Die Kaskade räumt die abhängigen Daten weg',
    test: 'Löschen einer Wohnung räumt mit',
    change: [
      // Ohne »handle.exec« davor: Das Pragma steht in client.ts an drei Stellen, und die
      // letzte (am Ende der Migrationen) schaltet die Prüfung sonst wieder ein.
      [CLIENT, "'PRAGMA foreign_keys = ON'", "'PRAGMA foreign_keys = OFF'"],
      [OPEN, 'Number(fk[0]?.[0]) !== 1', 'Number(fk[0]?.[0]) !== 0'],
    ],
  },
  {
    what: 'Die Direktzuordnung wird auf null gesetzt, die Position bleibt',
    test: 'lässt die Kostenposition stehen',
    change: [
      // Ohne »handle.exec« davor: Das Pragma steht in client.ts an drei Stellen, und die
      // letzte (am Ende der Migrationen) schaltet die Prüfung sonst wieder ein.
      [CLIENT, "'PRAGMA foreign_keys = ON'", "'PRAGMA foreign_keys = OFF'"],
      [OPEN, 'Number(fk[0]?.[0]) !== 1', 'Number(fk[0]?.[0]) !== 0'],
    ],
  },
  {
    what: 'Die vereinbarten Anteile einer gelöschten Wohnung entfallen',
    test: 'räumt auch die vereinbarten Anteile weg',
    change: [
      // Ohne »handle.exec« davor: Das Pragma steht in client.ts an drei Stellen, und die
      // letzte (am Ende der Migrationen) schaltet die Prüfung sonst wieder ein.
      [CLIENT, "'PRAGMA foreign_keys = ON'", "'PRAGMA foreign_keys = OFF'"],
      [OPEN, 'Number(fk[0]?.[0]) !== 1', 'Number(fk[0]?.[0]) !== 0'],
    ],
  },
  {
    what: 'Ein Fehler mittendrin lässt nichts Halbes zurück',
    test: 'Ein Fehler mittendrin',
    change: [[REPO, 'await db.transaction(async (tx) => c.insert(tx, c.merge(c.empty(id), body)))',
      'await c.insert(db, c.merge(c.empty(id), body))']],
  },
  {
    what: 'Ein benutzter Beleg wird als benutzt gemeldet',
    test: 'Ein Beleg, der noch an einer Kostenposition hängt',
    change: [[REPO, 'if (files.length === 0) return new Set()', 'if (files.length >= 0) return new Set()']],
  },
  {
    what: 'Die Verschmelzung erreicht jede Spalte',
    test: 'jede Spalte des Schemas',
    change: [[REPO, "iban: merged(body, 'iban', current.iban, asOptionalText),", 'iban: undefined,']],
  },
]

const read = (file) => fs.readFileSync(path.join(serverRoot, file), 'utf8')
const write = (file, text) => fs.writeFileSync(path.join(serverRoot, file), text, 'utf8')

const originals = new Map()
for (const file of [REPO, CLIENT, OPEN]) originals.set(file, read(file))
const restore = () => { for (const [file, text] of originals) write(file, text) }
process.on('exit', restore)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { restore(); process.exit(1) })

const results = []
for (const mutation of MUTATIONS) {
  restore()
  for (const [file, find, replacement] of mutation.change) {
    const before = read(file)
    const treffer = before.split(find).length - 1
    if (treffer === 0) {
      console.error(`Die Mutation „${mutation.what}" findet ihre Stelle nicht in ${file}.`)
      process.exit(2)
    }
    // **Alle Vorkommen und nicht nur das erste.** Genau daran sind die ersten Läufe gescheitert:
    // `PRAGMA foreign_keys` steht in client.ts an drei Stellen, und die letzte schaltet die
    // Prüfung am Ende der Migrationen wieder ein. Blieb sie stehen, lief die Mutation ins Leere,
    // und drei Tests galten als wirkungslos, obwohl sie es nicht sind. Eine halb angewandte
    // Mutation ist schlimmer als gar keine: Sie belastet die Tests für einen Fehler, den der
    // Lauf selbst gemacht hat. Deshalb steht unten auch die Nachschau.
    write(file, before.split(find).join(replacement))
    // Nachsehen, dass die Mutation wirklich auf der Platte steht. Ohne diese Zeile meldet der
    // Lauf einen Test als wirkungslos, obwohl in Wahrheit die Mutation nicht angekommen ist —
    // und das ist die gefährlichste Auskunft, die ein Mutationslauf geben kann.
    if (!read(file).includes(replacement)) {
      console.error(`Die Mutation „${mutation.what}" ist in ${file} nicht angekommen.`)
      process.exit(2)
    }
  }
  if (process.env.MUTATION_DEBUG) {
    for (const [file] of mutation.change) {
      const zeilen = read(file).split('\n').filter((z) => /foreign_keys|fk\[0\]/.test(z) && !z.trimStart().startsWith('//'))
      if (zeilen.length > 0) console.error(`  [${file}] ${zeilen.map((z) => z.trim()).join(' | ')}`)
    }
  }
  const run = spawnSync(process.execPath, ['--test', '--test-name-pattern', mutation.test, TESTS], {
    cwd: serverRoot, encoding: 'utf8',
  })
  // `node --test` endet mit 0, wenn alles grün war. Zusätzlich wird geprüft, dass der Lauf
  // überhaupt einen Test gefunden hat: Ein Muster, das ins Leere greift, wäre sonst „rot genug".
  const liefen = /ℹ tests (\d+)/.exec(run.stdout)
  const zahl = liefen ? Number(liefen[1]) : 0
  const caught = run.status !== 0
  if (!caught && process.env.MUTATION_DEBUG) {
    console.error(`\n--- „${mutation.what}" entwischt, Ausgabe des Laufs ---`)
    console.error(run.stdout.split('\n').filter((z) => /^ℹ|^✔|^✖|not ok|Error/.test(z)).slice(0, 12).join('\n'))
    console.error(run.stderr.slice(0, 400))
  }
  results.push({ ...mutation, caught, ran: zahl })
}
restore()

console.log('\nMutationslauf über db/repository.ts\n')
let offen = 0
for (const r of results) {
  const zeichen = r.ran === 0 ? '?' : r.caught ? 'gefangen' : 'ENTWISCHT'
  if (r.ran === 0 || !r.caught) offen++
  console.log(`  ${zeichen.padEnd(10)} ${r.what}${r.ran === 0 ? '  (kein Test gefunden)' : ''}`)
}
console.log(`\n${results.length - offen} von ${results.length} Mutationen wurden gefangen.`)
process.exit(offen === 0 ? 0 : 1)
