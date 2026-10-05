// Die Migrationen gibt es auf zwei Wegen: von der Platte (npm-Betrieb und Docker-Image) und
// aus dem eingebetteten Modul (Bun-Programmdatei, siehe scripts/embed-migrations.mjs). Zwei
// Wege heißt: Sie können auseinanderlaufen. Dieser Test hält sie zusammen.
//
// Dazu die Regel aus server/drizzle/README.md, geprüft statt nur aufgeschrieben: Die Marke über
// dem Inhalt jeder Migration darf sich nicht ändern. Wer einen bereits veröffentlichten Schritt
// nachbessert, ändert sie, und dann wird dieser Test rot statt eines Nutzers Datenbestand.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashOf, loadMigrations, parseJournal, splitStatements, toSqlValue } from '../src/db/client.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..')
const migrationsDir = path.join(root, 'server', 'drizzle')
const embeddedFile = path.join(root, 'server', 'src', 'db', 'embedded-migrations.js')

test('der eingebettete Stand entspricht den Dateien auf der Platte', async () => {
  // Frisch erzeugen, damit der Test nicht einen alten Stand von einem früheren Lauf vergleicht.
  execFileSync(process.execPath, [path.join(root, 'scripts', 'embed-migrations.mjs')], { cwd: root })
  const { migrations: embedded } = await import(`file://${embeddedFile.split(path.sep).join('/')}?frisch=${Date.now()}`)
  const fromDisk = await loadMigrations()
  assert.deepEqual(embedded, fromDisk, 'eingebettet und auf der Platte müssen dasselbe sein')
})

test('jede Migration im Journal hat ihre Datei, und die Reihenfolge stimmt', async () => {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'))
  const migrations = await loadMigrations()
  assert.equal(migrations.length, journal.entries.length)
  const zeiten = migrations.map((m) => m.folderMillis)
  assert.deepEqual(zeiten, [...zeiten].sort((a, b) => a - b), 'aufsteigend nach Zeitpunkt')
  for (const m of migrations) {
    assert.ok(fs.existsSync(path.join(migrationsDir, `${m.tag}.sql`)), `Datei zu ${m.tag}`)
    assert.ok(m.statements.length > 0, `${m.tag} enthält Anweisungen`)
  }
})

// Die Marken der bereits veröffentlichten Schritte. Ein neuer Schritt kommt unten dazu, ein
// vorhandener wird nie geändert. Ändert ihn doch jemand, passt seine Marke nicht mehr.
const VEROEFFENTLICHT: Record<string, string> = {
  '0000_ordinary_karnak': 'd37deabbc5753761291aa59754f1569d11591512821c1825c180b41da1109fe9',
  // Mehrere Objekte (#92). Eingetragen vor dem Merge und nicht erst beim Release: Jeder Push auf
  // main veröffentlicht das Image ghcr.io/speedone/mietfuchs:main, und ab dann haben Nutzer
  // diese Schritte angewendet.
  '0001_objekte': '6cffdd54299e361e826b45ccdda8da9b53ad265020f8cc3a601569cd4f44e100',
  '0002_objekte_pflicht': '51304780eb2e8ad1f0333f6b18dd329a60ec001ee82f32d4adb7350bbd3d7f45',
  // Verteilbasis erweitern (#94).
  '0003_verteilbasis': '6ab375fd88adf1f65f20fc928422b40dcfd7d4fa4cd111013aec412c0eb86428',
  '0004_verteilbasis_bedingungen': '186b5b46f6785fdaf01d406f9c3040fb1ee8374ab00c1e3ab36e1e03f56955a1',
  // Nebenkostenmodell am Mietverhältnis (#93).
  '0005_mietmodell': 'efb7a4bcd10936d2c7b81547dc6b165815edd8109b4e35a21985ea1fe0aa6ce4',
  '0006_mietmodell_bedingungen': 'e3e8edcdd6b7e1353f60285d2c172c632583a0434633569bb7c65471c797cf42',
  '0007_pauschale': 'a20f80e56b92f2f3f4abf5f5b1a5b300c9ab6d30a8c0abc53bc1070bbd6429b3',
  '0008_eigenbetraege': '7bdddcbf821254935aab0edace93460b7c838470e651001e5f20d5c74d83874f',
  '0009_abschluss_verlauf': 'd68cb5d05641d52b7c3f96a08f0fbf664cb214db053ebcf2c4176c582129f63b',
  '0010_ohne_anschluss': '78e852dae3ad183f2dbbcaaa15fb3b47e2889ed7458287fad6cfb16e63ed761f',
  '0011_kabel_baujahr': '5ab69587079473d1b0af45d15d09ed5882407dd7c2a5373c7743fbd4b4880e8d',
  // Angaben zu Belegen (#170).
  // Vor der Veröffentlichung neu erzeugt (Spalte kind, Durchsicht); der Schritt hat den Arbeitszweig nie verlassen.
  '0012_belege': '02a985bcc59b65113f13754a77ce17b4800357f8149ce5b73690c4d8e4b7bf71',
  // Belegbuchung (#170). Eingetragen vor dem Merge, wie 0001: Jeder Push auf main veröffentlicht
  // das Image, und ab dann haben Nutzer den Schritt angewendet. Wird 0013 vor dem Push neu
  // erzeugt, hier die neue Marke eintragen. Neu erzeugt in der Schlussdurchsicht (Spalte requested_year, I1)
  // und in der Integrationsdurchsicht (Spalte reassessed, H1); main hat der Schritt nie erreicht.
  '0013_belegbuchung': '5d795633e62b473feb51bebd39c506e8572bf29838a11aa211c9ab152ac3bd2a',
  // Abrechnungszeitraum (#208). Eingetragen vor dem Merge, wie 0001: Jeder Push auf main
  // veröffentlicht das Image, und ab dann haben Nutzer die Schritte angewendet. Werden 0014 oder
  // 0015 vor dem Push neu erzeugt, hier die neue Marke eintragen.
  '0014_zeitraum': '1ecbae16aa915909c1ad530ab2bbc8d2696df0fb1caca86539d0f618fc2727bf',
  '0015_zeitraum_pflicht': 'e535b04eab6a8bee3e0c3acaf25e89c5592c8166490e89b670aed4f928d19442',
  // Leistungszeitraum, Jahr der Zahlung, Brennstoffmerkmal (#208, PR 3). Eingetragen vor dem
  // Merge; werden 0016 oder 0017 vor dem ersten Push neu erzeugt, hier die neue Marke eintragen.
  '0016_leistungszeitraum': '2bed08c8351a3f4f5406e5029cda357d3fa6f4bc9416c3030251b65002d01588',
  '0017_leistungszeitraum_pruefung': '704a4352ea7810cd18325a9ce8e8443a96313908b9688492cc7db61c076c3991',
  // Heizung PR 4. Wird PR 3 vor dem Push neu erzeugt, werden diese beiden Schritte neu erzeugt und
  // die Marken hier ersetzt.
  '0018_heizanlage': '86c29da100e22ec3386a757a673a468cda567904cfc18894b866f5e768ff66ca',
  '0019_heizanlage_bedingungen': '20506c7a6cddb70de5c0ca509fadebdbe722ee666f89205be8052f64b873e17c',
}

test('ein bereits veröffentlichter Migrationsschritt ist unverändert', async () => {
  for (const m of await loadMigrations()) {
    const erwartet = VEROEFFENTLICHT[m.tag]
    if (!erwartet) continue // ein neuer Schritt, der noch nicht veröffentlicht ist
    assert.equal(
      m.hash,
      erwartet,
      `Der Schritt ${m.tag} wurde nachträglich verändert. Das darf nicht sein: Wer ihn schon ` +
        `angewendet hat, behält die alte Fassung, und ab da weichen zwei Datenbestände ` +
        `voneinander ab, die sich für denselben halten. Korrigiert wird mit einem neuen Schritt.`,
    )
  }
})

test('die Marke hängt wirklich am Inhalt', () => {
  assert.notEqual(hashOf('CREATE TABLE a (id text)'), hashOf('CREATE TABLE a (id text );'))
  assert.equal(hashOf('gleich'), hashOf('gleich'))
})

// Git stellt Textdateien beim Auschecken unter Windows auf CRLF um. Ohne Normalisierung hinge
// die Marke am Betriebssystem, und der Test oben schlüge auf einem frisch geklonten
// Windows-Rechner fehl, auf dem Linux-Runner der CI aber nicht. Eine Marke, die vom Rechner
// abhängt, taugt nicht als Marke.
test('die Marke ist auf jedem System dieselbe, egal welche Zeilenenden', () => {
  const lf = 'CREATE TABLE a (id text);\n--> statement-breakpoint\nCREATE TABLE b (id text);\n'
  const crlf = lf.replace(/\n/g, '\r\n')
  assert.equal(hashOf(crlf), hashOf(lf))
  assert.deepEqual(splitStatements(crlf), splitStatements(lf))
})

test('Anweisungen werden an der Marke von drizzle-kit zerlegt', () => {
  assert.deepEqual(splitStatements('EINS;\n--> statement-breakpoint\nZWEI;'), ['EINS;', 'ZWEI;'])
  assert.deepEqual(splitStatements('  NUR EINE;  '), ['NUR EINE;'])
  assert.deepEqual(splitStatements(''), [])
})

// `JSON.parse` liefert `any`, und ein `any` nimmt jede Behauptung widerspruchslos an. Der
// Bauweg (scripts/embed-migrations.mjs) prüft an denselben Stellen und sagt, was fehlt; dieser
// Weg hier ist der, den ein Vermieter tatsächlich geht, und darf nicht weniger können.
test('eine kaputte Buchführung wird nicht durchgewinkt, sondern benannt', () => {
  const kaputt: [string, unknown, RegExp][] = [
    ['gar kein Objekt', 42, /kein Feld/],
    ['kein entries', { schritte: [] }, /kein Feld/],
    ['entries ist keine Liste', { entries: 'nein' }, /keine Liste/],
    ['entries ist leer', { entries: [] }, /keinen einzigen/],
    ['Eintrag ohne Felder', { entries: [{}] }, /braucht die Felder/],
    ['Tippfehler im Feldnamen', { entries: [{ tag: 'x', wann: 1 }] }, /braucht die Felder/],
    ['tag ist leer', { entries: [{ tag: '', when: 1 }] }, /kein brauchbares .tag/],
    ['when ist Text', { entries: [{ tag: 'x', when: '1' }] }, /kein brauchbares .when/],
    ['when ist NaN', { entries: [{ tag: 'x', when: Number.NaN }] }, /kein brauchbares .when/],
  ]
  for (const [was, raw, erwartet] of kaputt) {
    assert.throws(() => parseJournal(raw, 'journal.json'), erwartet, was)
  }
  // Und was in Ordnung ist, kommt durch.
  assert.deepEqual(parseJournal({ entries: [{ tag: '0000_x', when: 5, extra: 'egal' }] }, 'journal.json'), [
    { tag: '0000_x', when: 5 },
  ])
})

// `undefined` darf nicht still zu NULL werden: In SQL ist `= NULL` nie wahr, eine Abfrage käme
// also leer zurück, und niemand erführe warum.
test('undefined an die Datenbank ist ein Fehler mit Ansage, kein stilles NULL', () => {
  assert.throws(() => toSqlValue(undefined), /undefined/)
  assert.throws(() => toSqlValue({ a: 1 }), /lässt sich nicht an SQLite übergeben/)
  // Was erlaubt ist, geht unverändert durch; `null` bleibt ausdrücklich `null`.
  assert.equal(toSqlValue(null), null)
  assert.equal(toSqlValue(42), 42)
  assert.equal(toSqlValue('Meier'), 'Meier')
  assert.equal(toSqlValue(true), 1)
  assert.equal(toSqlValue(false), 0)
})

// Beim Neubau einer Tabelle schreibt drizzle-kit eine Prüfbedingung, die eine Spalte mit dem
// Tabellennamen anspricht, mit dem Namen des Zwischenstands (`"__new_closed_settlements"."settlement"`).
// Das SQLite unter Node und im Linux-Bun schreibt den Verweis beim Umbenennen mit; das SQLite des
// Systems unter macOS nicht, und dort scheiterte der Schritt mit „no such column“: Die
// Programmdatei startete nach dem Update ohne Datenbank (#92, gefunden auf dem macOS-Runner).
// Prüfbedingungen sprechen ihre Spalten deshalb unqualifiziert an, und dieser Test hält es für
// jeden Schritt fest.
test('kein Migrationsschritt verweist auf einen Zwischenstand beim Neubau', async () => {
  for (const m of await loadMigrations()) {
    for (const statement of m.statements) {
      assert.doesNotMatch(statement, /"__new_[a-z_]+"\./, `${m.tag}: Verweis auf eine Spalte des Zwischenstands`)
    }
  }
})
