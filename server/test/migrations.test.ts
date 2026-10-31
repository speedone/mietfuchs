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
  // Angabe an der Heizanlage, wie der Betriebsstrom erfasst ist (#266).
  '0041_betriebsstrom_angabe': '94e4d24d44f0e495635b97cada6b1aaca11c08e8a81a493172f40fd701aae751',
  '0042_betriebsstrom_angabe_bedingungen': '8135925667a0a3c6c12c40ba421dbc9d5447f8ab376ba6927363c9253b4e4d22',
  // Heizung PR 16 (#213): Wärmelieferung, Contracting und Angaben zur Umstellung.
  '0043_waermelieferung': 'eeeff16072c8d2a0aae9e91b524eeb9d2eab80bc0f613e56d229f0fb955bdb64',
  '0044_waermelieferung_bedingungen': 'ddf0ba665f5ea0ec4d6d08ae5019aab806ed09e2a6e5cb10b1eca73500878faa',
  // Heizung PR 22 (#99): monatliche Verbrauchsinformation, eine neue Tabelle samt Bedingungen in einem Schritt
  // (kein Neubau einer bestehenden Tabelle). Wird vor dem Merge ein anderer PR davor eingereiht, wird der
  // Schritt neu erzeugt und die Marke hier ersetzt.
  '0045_verbrauchsinfo': 'dc4a4796c387372915cbc4875a03638231a476d38abc8fc5b48ab3c1883b80ab',
  // Heizung PR 21 (#98): eine Spalte an `meters`, danach ihre Bedingungen im Neubau. Wird vor dem Merge ein
  // anderer PR davor eingereiht (PR 18, PR 19), werden beide Schritte neu erzeugt und die Marken hier ersetzt.
  '0046_eichfrist': '63919a2e200380422b92dbd2a3f4a213a4d28a7bb96beee94e94c099b79dff69',
  '0047_eichfrist_bedingungen': '49516eb29851052b6872639d50790b3c7909e52f8796d5ab0eb92afc9e9b5113',
  // Heizung PR 18 (#215): Merkmale nach §§ 5a, 5b, 5d CO2KostAufG an Heizanlage, Objekt und Mietverhältnis, danach
  // ihre Bedingungen im Neubau der drei Tabellen. Wird vor dem Merge ein anderer PR davor eingereiht, werden beide
  // Schritte neu erzeugt und die Marken hier ersetzt.
  '0048_gmodg': 'ef5a9fb55225d55c3f156396388a0e5e72d0912b2d7094d4f307a930ebd949ff',
  '0049_gmodg_bedingungen': 'cd6436edeb5048ad3e74fcac65330714d91c947dfeb8ae603ae0ead5570bb127',
  // Heizung PR 19 (#97): „Mieter heizt selbst“ an der Bedingung des Heizmodells. Entsteht #251 vorher, wird neu nummeriert.
  '0050_heizmodell_bedingungen': '979c6a51940cb3e849ecf5c40bd31e557eeeb021be61c7fe47d298c3ee7326f6',
  '0051_co2_erstattung': 'e86c45142ebab514818eb66f24e697e079d7bbcfcddf8740c06670a53f139ba8',
  // Durchsicht S-2: die Art der Selbstversorgung, Spalte und Bedingungen in zwei Schritten.
  '0052_selbstversorgung_art': '6ec38b08901f1041b7004cf22fb4cb7e55b5a86258f11d1f9f2923e866ae3986',
  '0053_selbstversorgung_art_bedingungen': '158eb57b89c3fdc9719abfe68029e1dbc088200b2b2b22af52c129e431d85258',
  // #251: Gutschrift ohne Rechnung, Spalte und Bedingung in zwei Schritten (nach PR 18, 19, 21 als 0054/0055 neu
  // erzeugt). Wird vor dem Merge ein anderer PR davor eingereiht, werden beide Schritte neu erzeugt und die Marken ersetzt.
  '0054_gutschrift_ohne_rechnung': '8633158cbfbdb4c92b7d28b86ad9a04bdba89cd44ea446794c8f5b74e0b2f5a5',
  '0055_gutschrift_ohne_rechnung_bedingungen': '1fc0eeeaf991d182b605ecf06f57b9d7ad8dde0cdd4a1eec7eac786c9ce4e476',
  // #280: die Art einer Zahlung, Spalte mit Vorgabe „rent“ und Bedingung in zwei Schritten (nach #330 als 0058/0059 neu
  // erzeugt). Wird vor dem Merge ein anderer PR davor eingereiht, werden beide Schritte neu erzeugt und die Marken ersetzt.
  '0058_zahlungsart': '8a8d8cb03e0b6097acf8ef304d1187492d5e8ee57b20877a53a3d4f68ed40581',
  '0059_zahlungsart_bedingungen': '401935f55d38ffafdcd67f0e3b86a682c33ac9f965a9151031f790ec8dc0a0c9',
  // #290: Bundesland am Objekt (Fristen und Feiertage), Spalte und Bedingung in zwei Schritten (nach #328 als
  // 0060/0061 neu erzeugt). Wird vor dem Merge ein anderer PR davor eingereiht, werden beide Schritte neu erzeugt
  // und die Marken ersetzt.
  '0060_bundesland': '4553e45643c584947b7dc193ae4a216af5b3ac01049795243d818a3f6a4d76e8',
  '0061_bundesland_bedingung': '95f0407dab0f6a9421d80935f336b81f8f1c477a446873548833207e6a83c9d4',
  // #258: die Umlagevereinbarung je Mietverhältnis (cost_item_contract). Wird vor dem Merge ein anderer PR davor
  // eingereiht, wird der Schritt neu erzeugt und die Marke ersetzt.
  '0062_kosten_vertrag': '5919ae32ddedf2e1a67268ba7f583d2b762d92dad7487289909ff96683a0bee6',
  // #270: am Abzug des Betriebsstroms, ob er dem Messdienst gemeldet ist; Spalte und Bedingung in zwei Schritten. Wird
  // vor dem Merge ein anderer PR davor eingereiht, werden beide Schritte neu erzeugt und die Marken ersetzt.
  '0063_betriebsstrom_gemeldet': '99f6d5daebf177094a79c6e3d1d07e56150c7660297cb1803dc883fbc1114871',
  '0064_betriebsstrom_gemeldet_bedingung': 'f9846e5c1a86612ef85758688cd84ee2816c7f30fd5a97220f0ad787df1d9495',
  // #415: die Texte des Anschreibens je Ebene, die Anpassung der Vorauszahlung je Mieter und die Falzmarken. Wird vor dem
  // Merge ein anderer PR davor eingereiht, wird der Schritt neu erzeugt und die Marke ersetzt.
  '0065_anschreiben': '932fedc5b3c8bc712ccb56f73ea52dad6723fa2ea14a121cc3065684d54ec2ad',
  // #257: die ortsübliche Warmmiete je Wohnung (unit_local_rents) und die direkt an Dritte gezahlten Kosten je
  // Mietverhältnis (tenancy_direct_charges). Wird vor dem Merge ein anderer PR davor eingereiht, wird der Schritt neu erzeugt
  // und die Marke ersetzt.
  '0066_ortsuebliche_miete': 'ce4bc86a16067fa26001e5f5c17fce3d07bda30a0e8879f0900ad05a29adfddf',
  // #259: die Nutzungswechsel einer Einheit (unit_usage_changes). Wird vor dem Merge ein anderer PR davor
  // eingereiht, wird der Schritt neu erzeugt und die Marke ersetzt.
  '0067_nutzungswechsel': '145af2eb7878a321169faa408498c418ce3f50679c6994525f236c2432bc7456',
  // #415, Teil 2: Anschrift und Kontakt des Vermieters, „Anschreiben mitdrucken“, Fußzeile, Anrede je Mietverhältnis und
  // das Objekt im Schlüssel der Anschreiben je Mieter (Datenanweisung). Wird vor dem Merge ein anderer PR davor eingereiht,
  // wird der Schritt neu erzeugt, die Datenanweisung wieder angehängt und die Marke ersetzt.
  '0068_anschreiben_teil2': 'ec6708b5449d1f9a31b4547b0a8b84adedd264e4b14101ae013df08ba1a119cd',
  // #318: das Änderungsjournal (change_groups, change_log); die Trigger stehen nicht im Schritt, sie entstehen beim
  // Öffnen (db/journal.ts). Wird vor dem Merge ein anderer PR davor eingereiht, wird der Schritt neu erzeugt und die
  // Marke ersetzt.
  '0069_journal': '0e0b8a409fa913639e1ffd34fe2d8a7e9c91bfc58f94bdf5cfecbfa740136fa4',
  // #415, Teil 2b: Logo und Briefpapier (letter_design, property_letter_designs). Wird vor dem Merge ein anderer PR davor
  // eingereiht, wird der Schritt neu erzeugt und die Marke ersetzt.
  '0070_briefpapier': '78ea72142d083b93845687c8bfa7c7515d7eff764f230fd054b2d1a4541ae94c',
  // #322: der umbaute Raum an der Zuordnung Wohnung–Anlage (Spalte), danach die Bedingungen (Rauminhalt über 0, Maßstab
  // `volume`). Wird vor dem Merge ein anderer PR davor eingereiht, werden beide Schritte neu erzeugt und die Marken ersetzt.
  '0071_umbauter_raum': 'f23762af4b54160ad62aac0d61a2411fc057095843ad8fd2f4aaa6a2318ea6ab',
  '0072_umbauter_raum_bedingung': '6787967df4df190829113c6fe8f0592c97710e0d2484b73aaac406201a30bd2e',
  // #317: der Monat der Anpassung je Mieter (tenancy_letter_adjustments.from_month), danach die Bedingung (JJJJ-MM). Wird
  // vor dem Merge ein anderer PR davor eingereiht, werden beide Schritte neu erzeugt und die Marken ersetzt.
  '0073_anpassung_ab': '90ae182e62dce87a4d834055f0f36b919d0d92c6bd359002fc937fadb6be364c',
  '0074_anpassung_ab_bedingung': 'c69cb4611b76c351f193316e74cd2da764fa9aded2d1049cf0a9a3f8827933c0',
  // #318, Schritte 4 und 5 (veröffentlicht mit 0.13.0): Rücksprung und Papierkorb, danach die Bedingung.
  '0075_verlauf_ruecksprung': '33fe6d87cd312b6cf4bf00c92b164b74f105a14f6b5b82287b5c886cf86aeda1',
  '0076_verlauf_ruecksprung_bedingung': '5a8b6435478cb0030e3ef5a79e24aac47bb03e0bdbe394e98b800cccf9d88936',
  // #455: Quellen aufgeteilter Rechnungen (cost_sources, cost_items.source_id); der Datenschritt in TypeScript ist in
  // data-steps.test.ts festgehalten. Wird vor dem Merge ein anderer PR davor eingereiht, wird der Schritt neu erzeugt
  // und die Marke ersetzt.
  '0077_quellrechnung': '7538641d77fbb6d3e995c8aa3f9f77930edecbd1d47e5eb5b30044322e107cf1',
  // #96 PR 2: Kopf der Anlage V (Aktenzeichen, vier Daten am Objekt, `tenancies.relative`), danach die Bedingungen. Wird
  // vor dem Merge ein anderer PR davor eingereiht, werden beide Schritte neu erzeugt und die Marken ersetzt.
  '0080_anlage_v_kopf': 'b0aa4d93b41fee7484792ae946b2a463b038f39c885429f5b2bfeb5fc13d2a57',
  '0081_anlage_v_kopf_bedingungen': 'e0a3af39a5a3ca86677db2e5004bd5a3c1426290dea0e09ed062b286a975efbf',
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
