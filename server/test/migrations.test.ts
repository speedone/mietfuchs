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
  '0018_heizanlage': '17887b3be11aa23782feeae5ff30b011298d3c360f3a1e22b5561877b216a01f',
  '0019_heizanlage_bedingungen': '20506c7a6cddb70de5c0ca509fadebdbe722ee666f89205be8052f64b873e17c',
  // Heizung PR 5. Wird PR 4 vor dem Push neu erzeugt, wird dieser Schritt neu erzeugt und die Marke
  // hier ersetzt.
  '0020_heizperiode': '3ea767aa7c4597181555eeda5b781ce48c144e46421244fe0d5dc3060c36d83e',
  // Heizung PR 6. Wird PR 5 vor dem Push neu erzeugt, wird dieser Schritt neu erzeugt und die
  // Marke hier ersetzt.
  '0021_co2_messdienst': 'e4b544dd481fd450ea2b09f9c26ef9d6a04af39aaab90f3d2867b11de7ddc43a',
  // Heizung PR 7. Wird ein früherer Schritt vor dem Push neu erzeugt, werden diese beiden Schritte
  // neu erzeugt und die Marken hier ersetzt.
  '0022_lieferungen': '1fead047c247bb489df09a25a5f2dcba6eae96d2ee94ff1c04e14cc9eb7370db',
  '0023_lieferungen_bedingungen': '0e73c25626805e01fb878d234ab71f42736917ce967196bc96aa713117daad6a',
  // Heizung PR 8. Wird PR 8 vor dem Push neu erzeugt, werden diese beiden Schritte neu erzeugt und die
  // Marken hier ersetzt.
  '0024_vorrat': '790d0a3771f7504c2cda7fae1497a5251ca343b67f2f62b333aacdc0e164ade8',
  '0025_vorrat_bedingungen': '3545f80a98da04aff0f80639e9890888c1f9ac3cfab9a4fdf8c28297213e072b',
  // Heizung PR 9 (Kesseltausch). Wird der Schritt vor dem Push neu erzeugt, hier die neue Marke eintragen.
  // Neu erzeugt in der Durchsicht von #238 (Spalte building_with, Recht I3) und in ihrer Nachprüfung
  // (Spalte takes_over_stock); main hat er nie erreicht.
  '0026_kesseltausch': '50b85a7bcbe2d3e8dd367a83895e076909aa7050bfa0bd38d27d5f5bcbab5337',
  // Heizung PR 10. Wird ein Schritt von PR 9 vor dem Push neu erzeugt, werden diese beiden Schritte
  // neu erzeugt und die Marken hier ersetzt. Neu erzeugt in der Nachprüfung von #239 (Tabelle
  // heating_self_spans, W1/W2 und Runde 3; 0028 ist wieder der Stand von Runde 1); main hat er nie erreicht.
  '0027_heizkostenabrechnung': 'd86baa5699643afc2e0ac837a95a21630f589ad329407a1dc534e65ae0d4709a',
  '0028_heizkostenabrechnung_bedingungen': '3898a4defcee79eacb162e80d1c2b74910ff98211ce51289e529337588dfe54e',
  // Heizung PR 11 (Warmwasser). Wird ein Schritt davor vor dem Push neu erzeugt, werden diese beiden
  // Schritte neu erzeugt und die Marken hier ersetzt.
  '0029_warmwasser': 'f6d62af1554a999b3656e0e6ddaede7801f12ca09919463f0714df3e77077d6d',
  '0030_warmwasser_bedingungen': '70bd0e5c1985b194afe1a3d309c244d4e4e7a52ef027f484798ad355552d6f16',
  // Heizung PR 12 (Heizkostenverteiler und Ablesedienst). Wird ein Schritt davor vor dem Push neu
  // erzeugt, werden diese beiden Schritte neu erzeugt und die Marken hier ersetzt.
  '0031_hkv': 'bb0a2160eca94099a689bd27d279213dea7ea0ee45d2903886fb73aad491c226',
  '0032_hkv_bedingungen': '3deed9e24e0f674d9fb16bfebdc3cd41b8944c313d43c6365cb211ceb52a4449',
  // Heizung PR 13 (Schätzung nach § 9a), neu erzeugt mit der Durchsicht von #242 (Grund, Erfassung, Einheit). Wird ein Schritt von PR 12 vor dem Push neu erzeugt, wird dieser
  // Schritt neu erzeugt und die Marke hier ersetzt.
  '0033_schaetzung': 'ec08c84ef61a91c67f770f34aaaa321093981bf4f92bdefc120bb980db72e325',
  // Heizung PR 14 (Pflichtangaben nach § 6a, § 11, § 2): erst die Spalten, dann die Bedingungen. Wird ein Schritt
  // davor neu erzeugt, werden diese beiden neu erzeugt.
  '0034_pflichtangaben': 'ccb396773010e9ce632fafa32d034bc8a2878179b9cb367f8fc2b1df33525149',
  '0035_pflichtangaben_bedingungen': '33f3efa315491aedc2588d98d155ded3528c08674b88d6923b4d887348655348',
  // Heizung PR 17 (Rechtswerte des Vermieters), beim Einreihen hinter PR 14 neu erzeugt (vorher 0034_rechtswerte).
  '0036_rechtswerte': 'fa04523c822daae898ca0df2f0232974756e1ee0b16c4548f983e482bbead86b',
  // Heizung PR 15 (#212): Betriebsstrom, Spalten und Bedingungen. Wird vor dem Merge ein anderer PR
  // davor eingereiht, werden beide Schritte neu erzeugt und die Marken hier ersetzt (wie 0036 bei PR 17).
  '0037_betriebsstrom': '3db36489ededcfad423b5357b9ef630bf8cd5e519d60c906ae5d588bc0652010',
  '0038_betriebsstrom_bedingungen': '014caffd9f0830b49f0f773ffef8f1e9b13bf01becd9bb17f398711b2396713d',
  // Durchsicht von #252: Verweis des Abzugs auf seine Stromrechnung (G-K3) und weitere Bedingungen.
  '0039_betriebsstrom_rechnung': 'd22026ba92def77199d78861dc8b87da6ba326acde9427582461d2a206196b00',
  '0040_betriebsstrom_rechnung_bedingungen': 'e2eecf27fec26048119dc209fdf662657fd9dc3309a90345e00c9e9225e40bf1',
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
