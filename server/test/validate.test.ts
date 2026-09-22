// Der Validator (server/src/legacy/validate.ts, #59): Was darf in die Datenbank, und was nicht?
//
// Die Tests sind in drei Gruppen geteilt, und die mittlere ist die eigentliche Aussage dieser
// Datei:
//
//   1. Was durchgehen muss, weil es in Ordnung ist.
//   2. Was durchgehen muss, obwohl es krumm ist. Solche Bestände gibt es bei Leuten, die
//      Mietfuchs seit Jahren benutzen. Wer sie abweist, sperrt genau diese Nutzer aus.
//   3. Was abgelehnt werden muss, weil es sich nicht übernehmen ließe, ohne eine Zahl der
//      Abrechnung zu verändern oder Erfasstes zu verlieren.
//
// Die Gruppe „krumm" hat einen eigenen Abschnitt am Ende: Dort wird jeder dieser Fälle
// geradegerückt und die Abrechnung vorher und nachher verglichen. Das ist der Nachweis dafür,
// dass das Geraderücken keine Zahl verändert; behauptet wäre er sonst nur.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { findingsText, validateDb, type Finding } from '../src/legacy/validate.ts'
import { computeSettlement, consumptionOverview, rentLedger, taxReport } from '../src/calc.ts'
import { migrateLegacy, straightenForDatabase } from '../src/legacy/migrate.ts'
import { snapshotFromDb } from '../src/snapshot.ts'
import { FIXTURE_DIR } from '../testing/fixtures.ts'
import type { Db } from '../src/store.ts'
import type { CostItem, Meter, Payment, Reading, RentLedger, RentLedgerRow, Settings, Tenancy, Unit } from '../../shared/types.ts'

// ---------- Bausteine ----------
//
// Ein gesunder Bestand, aus dem jeder Test genau eine Stelle verbiegt. Gebaut über die Typen
// des Datenmodells, damit der Übersetzer die Pflichtfelder mitprüft; die verbogenen Stellen
// stehen darunter bewusst als das, was sie sind: etwas, das dem Modell nicht entspricht.

const settings = (): Settings => ({
  houseName: 'Haus', address: 'Weg 1', landlordName: 'Vermieter', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434', ollamaModel: '',
})
const unit = (u: Partial<Unit> & Pick<Unit, 'id'>): Unit => ({ name: 'EG', areaM2: 80, participates: true, ...u })
const tenancy = (t: Partial<Tenancy> & Pick<Tenancy, 'id' | 'unitId'>): Tenancy => ({
  tenantName: 'Müller', persons: 2, personHistory: [{ from: '2024-01-01', persons: 2 }],
  start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 15000 }],
  prepaymentOverrides: {}, baseRents: [], ...t,
})
const costItem = (c: Partial<CostItem> & Pick<CostItem, 'id'>): CostItem => ({
  year: 2024, category: 'Müllabfuhr', description: 'Abfallgebühren', amountCents: 12000, key: 'area', ...c,
})
const meter = (m: Partial<Meter> & Pick<Meter, 'id'>): Meter =>
  ({ name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³', ...m })
const reading = (r: Partial<Reading> & Pick<Reading, 'id' | 'meterId'>): Reading =>
  ({ date: '2024-12-31', value: 120, ...r })
const payment = (p: Partial<Payment> & Pick<Payment, 'id' | 'tenancyId'>): Payment =>
  ({ date: '2024-01-05', amountCents: 15000, ...p })

const healthyDb = (): Db => ({
  settings: settings(),
  units: [unit({ id: 'u1' }), unit({ id: 'u2', name: 'OG', areaM2: 60 })],
  tenancies: [tenancy({ id: 't1', unitId: 'u1' })],
  costItems: [costItem({ id: 'c1' })],
  meters: [meter({ id: 'm1' })],
  readings: [reading({ id: 'r1', meterId: 'm1' })],
  payments: [payment({ id: 'p1', tenancyId: 't1' })],
  closedSettlements: [],
})

// Der Bestand mit einer verbogenen Stelle. Der weite Typ ist Absicht: Hier entsteht gerade das,
// was das Datenmodell nicht zulässt, und der Validator bekommt es als `unknown`.
const dbWith = (broken: Record<string, unknown>): unknown => ({ ...healthyDb(), ...broken })

// Kurzform für die beiden Fragen, die jeder Test stellt.
const problemsOf = (value: unknown): Finding[] => validateDb(value).problems
const adjustmentsOf = (value: unknown): Finding[] => validateDb(value).adjustments
const textOf = (findings: Finding[]): string => findings.map((f) => `${f.where}: ${f.reason}`).join(' ')

// Eine Beanstandung erwarten und ihren Wortlaut prüfen. Scheitert sie, steht der ganze Befund
// in der Meldung: Bei einem Validator ist fast immer die Frage, was er stattdessen gefunden hat.
function expectProblem(value: unknown, pattern: RegExp, hint: string): void {
  const problems = problemsOf(value)
  assert.ok(problems.length > 0, `${hint}: keine Beanstandung`)
  assert.match(textOf(problems), pattern, hint)
}

function expectClean(value: unknown, hint: string): void {
  assert.deepEqual(problemsOf(value), [], `${hint}: unerwartete Beanstandung, ${textOf(problemsOf(value))}`)
}

// ---------- 1. Was in Ordnung ist ----------

test('Ein gewöhnlicher Bestand hat keine Beanstandung', () => {
  expectClean(healthyDb(), 'gesunder Bestand')
})

test('Die Beispielbestände des Prüfkatalogs kommen ohne Beanstandung durch', () => {
  // Der Prüfkatalog ist das Nächste, was wir an erfundenen, aber vollständigen Beständen
  // haben: bis auf den Cent nachgerechnet. Wäre der Validator zu streng, fiele hier etwas
  // heraus; genau das ist einmal passiert, und daraufhin ist die Regel für reine Anzeigefelder
  // entstanden.
  //
  // **Achtung beim Pflegen der Fixtures.** Die Fangkraft dieses Tests hängt daran, dass die
  // Zähler in F05 und F06 zwei Felder nicht führen (`name` und `unit`; statt `name` steht dort
  // ein `label`, das es im Datenmodell gar nicht gibt). Wer die Beispieldaten vervollständigt,
  // nimmt dem Test still seine schärfste Stelle. Dann gehört hier ein Bestand hinein, der
  // weiterhin Felder auslässt, sonst prüft der Test nur noch das Erwartbare.
  const dirs = fs.readdirSync(FIXTURE_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())
  assert.ok(dirs.length > 0, 'keine Fixtures gefunden')
  for (const dir of dirs) {
    const file = path.join(FIXTURE_DIR, dir.name, 'db.json')
    expectClean(JSON.parse(fs.readFileSync(file, 'utf8')), dir.name)
  }
})

test('Optionale Felder dürfen leer stehen, wie die Oberfläche sie schreibt', () => {
  // Die Formulare schicken für ein leeres Feld ausdrücklich `null` (siehe unitForm.ts und
  // Kosten.tsx). Im Datenmodell steht dort ein optionales Feld, also „fehlt oder hat einen
  // Wert". Wer `null` hier abweist, weist den halben Bestand jedes Nutzers ab.
  expectClean(
    dbWith({
      units: [{ ...unit({ id: 'u1' }), selfUsed: null, selfPersons: null, rooms: null, floor: null, notes: null }],
      costItems: [{ ...costItem({ id: 'c1' }), directUnitId: null, meterType: null, customShares: null, labor35aCents: null }],
      meters: [{ ...meter({ id: 'm1' }), unitId: null, meterNumber: null }],
      tenancies: [],
      payments: [],
    }),
    'leere optionale Felder',
  )
})

test('Negative Beträge, die es geben darf, sind keine Beanstandung', () => {
  // Eine Gutschrift ist ein negativer Rechnungsbetrag, eine Rücklastschrift ein negativer
  // Zahlungseingang. Das Schema lässt beides ausdrücklich zu, und die Berechnung rechnet damit.
  expectClean(
    dbWith({
      costItems: [costItem({ id: 'c1', description: 'Gutschrift', amountCents: -5000 })],
      payments: [payment({ id: 'p1', tenancyId: 't1', amountCents: -15000 })],
    }),
    'Gutschrift und Rücklastschrift',
  )
})

// ---------- 2. Was abgelehnt werden muss ----------

test('Eine Sammlung, die keine Liste ist, wird abgelehnt', () => {
  // Der Fall aus #59: `{"units": null}` verdrängt beim Einlesen den Vorgabewert, das Einlesen
  // wirft, und danach scheitert jede weitere Anfrage. Wer das Archiv eingespielt hat, steht vor
  // einer Anwendung, die sich nur noch von Hand im Dateisystem retten lässt.
  expectProblem(dbWith({ units: null }), /Wohnungen/, 'units: null')
  expectProblem(dbWith({ costItems: 'keine' }), /Kostenpositionen/, 'costItems: Text')
  expectProblem(dbWith({ readings: { r1: {} } }), /Ablesungen/, 'readings: Objekt')
})

test('Ein Eintrag, der kein Objekt ist, wird abgelehnt', () => {
  expectProblem(dbWith({ costItems: [[]] }), /Kostenposition 1/, 'Liste statt Kostenposition')
  expectProblem(dbWith({ units: [null] }), /Wohnung 1/, 'null statt Wohnung')
  expectProblem(dbWith({ settings: [] }), /Einstellungen/, 'Liste statt Einstellungen')
})

test('Eine Ablesung ohne Zähler wird abgelehnt', () => {
  expectProblem(dbWith({ readings: [reading({ id: 'r1', meterId: 'weg' })] }), /Zähler/, 'Ablesung ohne Zähler')
  expectProblem(dbWith({ readings: [{ ...reading({ id: 'r1', meterId: 'm1' }), meterId: null }] }), /Zähler/, 'Ablesung ohne Zählerfeld')
})

test('Ein Mietverhältnis ohne Wohnung wird abgelehnt', () => {
  expectProblem(dbWith({ tenancies: [tenancy({ id: 't1', unitId: 'weg' })] }), /Wohnung/, 'Mietverhältnis ohne Wohnung')
})

test('Eine Zahlung ohne Mietverhältnis wird abgelehnt', () => {
  expectProblem(dbWith({ payments: [payment({ id: 'p1', tenancyId: 'weg' })] }), /Mietverhältnis/, 'Zahlung ohne Mietverhältnis')
})

test('Ein Zähler, dessen Wohnung es nicht gibt, wird abgelehnt', () => {
  // Der einzige Ausweg wäre, ihn zum Hauptzähler zu machen. Das änderte die Verteilbasis:
  // Ein Wohnungszähler zählt in die Basis des Zählerschlüssels, ein Hauptzähler nicht.
  expectProblem(dbWith({ meters: [meter({ id: 'm1', unitId: 'weg' })] }), /Wohnung/, 'Zähler ohne Wohnung')
  // Aus demselben Grund ist eine Kennung aus Leerzeichen ein Verweis ins Leere und keine leere
  // Kennung: `m.unitId && …` in calc.ts hält sie für ausgefüllt.
  expectProblem(dbWith({ meters: [meter({ id: 'm1', unitId: '  ' })] }), /Wohnung/, 'Zähler mit Leerzeichen als Kennung')
})

test('Krumm: ein Zähler ohne ausgefüllte Wohnung wird nicht abgelehnt', () => {
  // Die leere Kennung liest die Abrechnung schon heute wie gar keine, er ist also ein
  // Hauptzähler für das ganze Haus.
  const krumm = dbWith({ meters: [meter({ id: 'm1', unitId: '' })] })
  expectClean(krumm, 'Zähler mit leerer Wohnungs-Kennung')
  assert.match(textOf(adjustmentsOf(krumm)), /Hauptzähler/)
})

test('Ein Betrag, der keine Zahl ist, wird abgelehnt', () => {
  expectProblem(dbWith({ costItems: [{ ...costItem({ id: 'c1' }), amountCents: '120,00' }] }), /Betrag/, 'Betrag als Text')
  expectProblem(dbWith({ costItems: [{ ...costItem({ id: 'c1' }), amountCents: null }] }), /Betrag/, 'Betrag fehlt')
})

test('Ein Cent-Betrag mit Nachkommastellen wird abgelehnt', () => {
  // Geraderücken hieße hier runden, und Runden verändert einen Geldbetrag. Genau das darf beim
  // Übernehmen nicht stillschweigend geschehen.
  expectProblem(dbWith({ costItems: [{ ...costItem({ id: 'c1' }), amountCents: 12000.5 }] }), /ganze Zahl|Cent/, 'krummer Cent-Betrag')
})

test('Ein negativer Betrag, wo keiner sein darf, wird abgelehnt', () => {
  expectProblem(
    dbWith({ tenancies: [tenancy({ id: 't1', unitId: 'u1', prepayments: [{ from: '2024-01', monthlyCents: -15000 }] })] }),
    /unter null/,
    'negative Vorauszahlung',
  )
  expectProblem(dbWith({ units: [unit({ id: 'u1', areaM2: -80 })] }), /unter null/, 'negative Wohnfläche')
  expectProblem(dbWith({ readings: [reading({ id: 'r1', meterId: 'm1', value: -5 })] }), /unter null/, 'negativer Zählerstand')
})

test('Ein unbekannter Umlageschlüssel oder Zählertyp wird abgelehnt', () => {
  // Ein unbekannter Schlüssel verteilte gar nichts, und die Position fiele still dem Vermieter
  // zu. Das Schema hat dafür eine echte Prüfbedingung, und der Validator prüft dasselbe.
  expectProblem(dbWith({ costItems: [{ ...costItem({ id: 'c1' }), key: 'wetter' }] }), /Umlageschlüssel/, 'unbekannter Schlüssel')
  expectProblem(dbWith({ meters: [{ ...meter({ id: 'm1' }), type: 'gas' }] }), /Zählertyp/, 'unbekannter Zählertyp')
  expectProblem(
    dbWith({ costItems: [{ ...costItem({ id: 'c1', key: 'meter' }), meterType: 'gas' }] }),
    /Zählertyp/,
    'unbekannter Zählertyp an der Kostenposition',
  )
})

test('Eine doppelte Kennung wird abgelehnt', () => {
  // In der Datenbank ist die Kennung der Primärschlüssel: Der zweite Datensatz käme gar nicht
  // erst hinein, und niemand bemerkte, dass er fehlt.
  expectProblem(dbWith({ units: [unit({ id: 'u1' }), unit({ id: 'u1', name: 'OG' })] }), /Kennung/, 'doppelte Wohnung')
})

test('Zwei abgeschlossene Abrechnungen für dasselbe Jahr werden abgelehnt', () => {
  const closed = { id: 's1', year: 2024, closedAt: '2025-03-01', sentAt: null, settlement: { year: 2024 } }
  expectProblem(dbWith({ closedSettlements: [closed, { ...closed, id: 's2' }] }), /2024/, 'zwei Abrechnungen eines Jahres')
})

test('Eine Datei, die gar keinen Bestand enthält, wird abgelehnt', () => {
  // Auch ein Objekt, in dem keine einzige der erwarteten Angaben vorkommt: Sonst käme eine
  // beliebige JSON-Datei durch, und der Nutzer stünde danach vor einem leeren Programm.
  for (const value of [null, 42, 'Text', [], true, {}, { foo: 1 }]) {
    assert.ok(problemsOf(value).length > 0, `${JSON.stringify(value)} müsste abgelehnt werden`)
  }
})

test('Jede Beanstandung nennt Ort und Grund', () => {
  const problems = problemsOf(dbWith({ units: [unit({ id: 'u1', areaM2: -80 })], readings: [reading({ id: 'r1', meterId: 'weg' })] }))
  assert.ok(problems.length >= 2, textOf(problems))
  for (const finding of problems) {
    assert.ok(finding.where.trim().length > 0, 'Ort fehlt')
    // Ein ganzer Satz, keine durchgereichte Meldung aus einer Bibliothek.
    assert.match(finding.reason, /^[A-ZÄÖÜ].*\.$/s, `kein Satz: ${finding.reason}`)
  }
})

test('Die Meldung nennt die ersten Beanstandungen und dann ihre Zahl', () => {
  const many: Finding[] = Array.from({ length: 8 }, (_, i) => ({ where: `Wohnung ${i + 1}`, reason: 'Die Wohnfläche fehlt.' }))
  const text = findingsText(many)
  assert.match(text, /Wohnung 1: Die Wohnfläche fehlt\./)
  assert.doesNotMatch(text, /Wohnung 8/)
  assert.match(text, /3 weitere/)
  // Ohne Rest steht auch kein Hinweis darauf.
  assert.doesNotMatch(findingsText(many.slice(0, 2)), /weitere/)
})

// ---------- 3. Was krumm ist und trotzdem durchgeht ----------

test('Krumm: eine Direktzuordnung auf eine gelöschte Wohnung wird nicht abgelehnt', () => {
  // Das Löschen einer Wohnung lässt diesen Verweis heute stehen, die Berechnung fängt ihn mit
  // einer Warnung ab. Die Zeile zu verwerfen entfernte eine bezahlte Rechnung aus einem
  // abgerechneten Jahr.
  const krumm = dbWith({ costItems: [costItem({ id: 'c1', key: 'direct', directUnitId: 'weg' })] })
  expectClean(krumm, 'Direktzuordnung ins Leere')
  assert.match(textOf(adjustmentsOf(krumm)), /Direktzuordnung|zugeordnete Wohnung/)
})

test('Krumm: zwei Einträge einer Staffel zum selben Stichtag werden nicht abgelehnt', () => {
  const krumm = dbWith({
    tenancies: [tenancy({
      id: 't1', unitId: 'u1',
      prepayments: [{ from: '2024-01', monthlyCents: 15000 }, { from: '2024-01', monthlyCents: 18000 }],
      personHistory: [{ from: '2024-01-01', persons: 2 }, { from: '2024-01-01', persons: 3 }],
    })],
  })
  expectClean(krumm, 'doppelter Stichtag')
  assert.match(textOf(adjustmentsOf(krumm)), /Stichtag|2024-01/)
})

test('Krumm: die alten Formate werden nicht abgelehnt', () => {
  const alt = {
    settings: settings(),
    units: [unit({ id: 'u1' })],
    // Wie eine db.json vor den Staffeln: fester Monatsbetrag, feste Personenzahl, sonst nichts.
    tenancies: [{ id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2, start: '2024-03-15', end: null, prepaymentMonthlyCents: 15000 }],
  }
  expectClean(alt, 'Altformat')
  assert.match(textOf(adjustmentsOf(alt)), /Monatsbetrag/)
  // Ein leerer Eintrag für die tatsächlich gezahlten Vorauszahlungen zählt wie keiner. Die
  // Bedingung ist dieselbe wie beim Einlesen (`if (!t.prepaymentOverrides)`); eine strengere
  // liefe genau dort auseinander, wo beide zusammenbleiben müssen.
  expectClean(dbWith({ tenancies: [{ ...tenancy({ id: 't1', unitId: 'u1' }), prepaymentOverrides: 0 }] }), 'leerer Jahreseintrag')
})

test('Krumm: eine Wohnung ohne Wohnfläche wird nicht abgelehnt', () => {
  // Die Berechnung rechnet ausdrücklich damit (`u.areaM2 || 0`) und meldet sie als Mangel. Wer
  // sie hier abweist, sperrt einen Bestand aus, der heute mit einer Warnung funktioniert.
  const ohne = { ...healthyDb(), units: [{ id: 'u1', name: 'EG', participates: true }] }
  expectClean(ohne, 'Wohnung ohne Wohnfläche')
  assert.match(textOf(adjustmentsOf(ohne)), /Wohnfläche/)
})

test('Krumm: ein vereinbarter Anteil auf eine gelöschte Wohnung wird nicht abgelehnt', () => {
  const krumm = dbWith({
    costItems: [costItem({ id: 'c1', key: 'custom', customShares: { u1: 60, weg: 40 } })],
  })
  expectClean(krumm, 'vereinbarter Anteil ins Leere')
  assert.match(textOf(adjustmentsOf(krumm)), /vereinbarte/)
})

test('Krumm: eine fehlende Sammlung und fehlende Einstellungen werden nicht abgelehnt', () => {
  // Ein Backup aus einer früheren Version kennt `payments` und `closedSettlements` noch nicht.
  expectClean({ units: [unit({ id: 'u1' })] }, 'Bestand ohne die späteren Sammlungen')
  expectClean({ units: [], tenancies: [] }, 'Bestand ohne Einstellungen')
})

// ---------- 4. Geraderücken bewegt keine Zahl ----------
//
// Hier steht die Begründung der ganzen Grenze, und deshalb steht hier **jeder** hingenommene
// Fall und nicht eine Auswahl. Jeder wird so geradegerückt, wie es der Hinweis ankündigt, und
// beide Stände werden durchgerechnet. Kommt dasselbe heraus, war das Hinnehmen richtig; kommt
// etwas anderes heraus, gehört der Fall abgelehnt oder der Unterschied benannt.
//
// **Verglichen wird alles, was Mietfuchs rechnet**, und das ist nicht nur die Abrechnung.
// Mietkonto und Abrechnung lesen die Vorauszahlung verschieden (#70), und genau dort sitzt der
// eine Fall, der doch etwas bewegt. Wer nur die Abrechnung vergliche, übersähe ihn.

function resultsOf(file: Db) {
  // Aus der Datei wird erst ein Bestand, mit denselben Regeln wie beim Einlesen. Geklont, weil
  // migrateLegacy die Mietverhältnisse an Ort und Stelle ändert und die Testdaten sonst nach
  // dem ersten Durchlauf andere wären.
  const snapshot = snapshotFromDb(migrateLegacy(structuredClone(file)), 2024)
  return {
    settlement: computeSettlement(snapshot),
    ledger: rentLedger(snapshot),
    tax: taxReport(snapshot),
    consumption: consumptionOverview(snapshot),
  }
}

// Derselbe Bestand, aber so, wie ihn der Umstieg in die Datenbank schreibt: nach dem Einlesen
// noch einmal durch `straightenForDatabase` (legacy/migrate.ts).
//
// **Das ist der Unterschied zu früher, und er ist der Punkt dieser Datei.** Vorher rückte jeder
// Test hier von Hand gerade und verglich das Ergebnis mit dem krummen Bestand. Damit prüfte er,
// dass *seine eigene* Handarbeit keine Zahl bewegt, und die Hinweise des Validators blieben
// eine Beschreibung ohne Gegenstück im Code. Jetzt prüft er die Funktion, die beim Umstieg
// wirklich läuft.
function straightResultsOf(file: Db) {
  const snapshot = snapshotFromDb(straightenForDatabase(migrateLegacy(structuredClone(file))), 2024)
  return {
    settlement: computeSettlement(snapshot),
    ledger: rentLedger(snapshot),
    tax: taxReport(snapshot),
    consumption: consumptionOverview(snapshot),
  }
}

// Der geradegerückte Bestand selbst, für die Frage, ob das Geraderücken auch das tut, was der
// Hinweis ankündigt. Dass keine Zahl wandert, sagt `unchanged`.
const straightened = (file: Db): Db => straightenForDatabase(migrateLegacy(structuredClone(file)))

// Alle vier Rechnungen sagen vor und nach dem Geraderücken dasselbe.
const unchanged = (krumm: Db, hint: string): void =>
  assert.deepEqual(straightResultsOf(krumm), resultsOf(krumm), hint)

// Die Mietkonto-Zeile eines Mietverhältnisses. Nach Kennung gesucht und nicht über den Index
// genommen: `rentLedger` sortiert seine Zeilen nach Wohnungs- und Mietername, ein Zugriff über
// den Index prüfte also je nach Namen eine andere Zeile. Genau das ist hier einmal passiert,
// und der Test war dadurch grün an der falschen Stelle.
function ledgerRow(ledger: RentLedger, tenancyId: string): RentLedgerRow {
  const row = ledger.rows.find((r) => r.tenancyId === tenancyId)
  if (!row) assert.fail(`Im Mietkonto fehlt die Zeile für ${tenancyId}`)
  return row
}

// Ein Feld wirklich entfernen, nicht auf undefined setzen: Genau so fehlt es in der Datei. Der
// Typ des Helfers sagt, dass das Feld fehlen darf; zugesichert wird dabei nichts.
function drop<K extends string, T extends Partial<Record<K, unknown>>>(record: T, field: K): void {
  delete record[field]
}

// Ein Bestand, in dem alle vier Rechnungen etwas zu tun haben: zwei Wohnungen, zwei
// Mietverhältnisse mit Kaltmiete und Vorauszahlung, vier Kostenpositionen mit vier Schlüsseln,
// zwei Zähler mit Ablesungen über den Jahreswechsel und eine Zahlung. An einem leeren Bestand
// ließe sich nichts davon zeigen.
function fullDb(): Db {
  return {
    settings: settings(),
    units: [unit({ id: 'u1' }), unit({ id: 'u2', name: 'OG', areaM2: 60 })],
    tenancies: [
      tenancy({ id: 't1', unitId: 'u1', baseRents: [{ from: '2024-01', monthlyCents: 60000 }] }),
      tenancy({
        id: 't2', unitId: 'u2', tenantName: 'Schmidt', persons: 3,
        personHistory: [{ from: '2024-01-01', persons: 3 }],
        baseRents: [{ from: '2024-01', monthlyCents: 50000 }],
      }),
    ],
    costItems: [
      costItem({ id: 'c1' }),
      costItem({ id: 'c2', description: 'Hausreinigung', amountCents: 24000, key: 'units' }),
      costItem({ id: 'c3', description: 'Wasser', amountCents: 30000, key: 'meter', meterType: 'kaltwasser' }),
      costItem({ id: 'c4', description: 'Gartenpflege', amountCents: 18000, key: 'persons' }),
    ],
    meters: [meter({ id: 'm1', unitId: 'u1' }), meter({ id: 'm2', unitId: 'u2', name: 'Bad' })],
    readings: [
      reading({ id: 'r1', meterId: 'm1', date: '2023-12-31', value: 100 }),
      reading({ id: 'r2', meterId: 'm1', date: '2024-12-31', value: 160 }),
      reading({ id: 'r3', meterId: 'm2', date: '2023-12-31', value: 200 }),
      reading({ id: 'r4', meterId: 'm2', date: '2024-12-31', value: 240 }),
    ],
    // Die Zahlung für t2 deckt bei 50000 Kaltmiete genau zwei Monate. Ohne sie ließe sich am
    // Mietkonto kein Statuswechsel zeigen, und genau darauf kommt es unten an.
    payments: [payment({ id: 'p1', tenancyId: 't1', amountCents: 150000 }), payment({ id: 'p2', tenancyId: 't2', amountCents: 100000 })],
    closedSettlements: [],
  }
}

test('Geraderücken: fehlende Sammlungen, Einstellungen, Kaltmiete-Staffel und Jahreskorrektur', () => {
  // Ein Backup aus einer früheren Version führt die späteren Sammlungen nicht, und die beiden
  // Staffeln kamen ebenfalls später dazu. Die Einstellungen gehen in keine der vier Rechnungen
  // ein, der Schnappschuss führt sie gar nicht; der Vergleich hält genau das fest, und wer
  // eines Tages eine Einstellung in die Berechnung zieht, bekommt hier einen roten Test.
  const krumm = fullDb()
  drop(krumm, 'payments')
  drop(krumm, 'closedSettlements')
  drop(krumm, 'settings')
  drop(krumm.tenancies[1], 'baseRents')
  drop(krumm.tenancies[0], 'prepaymentOverrides')
  unchanged(krumm, 'fehlende Sammlungen und Staffeln')
  const gerade = straightened(krumm)
  assert.deepEqual(gerade.payments, [])
  assert.deepEqual(gerade.tenancies[1].baseRents, [])
  assert.deepEqual(gerade.tenancies[0].prepaymentOverrides, {})
})

test('Geraderücken: eine fehlende Wohnfläche ist dasselbe wie 0 m²', () => {
  const krumm = fullDb()
  drop(krumm.units[1], 'areaM2')
  unchanged(krumm, 'Wohnung ohne Wohnfläche')
  assert.equal(straightened(krumm).units[1].areaM2, 0)
})

test('Geraderücken: eine fehlende Beteiligung ist dasselbe wie „gehört nicht dazu"', () => {
  const krumm = fullDb()
  drop(krumm.units[1], 'participates')
  unchanged(krumm, 'Wohnung ohne Beteiligung')
  assert.equal(straightened(krumm).units[1].participates, false)
})

test('Geraderücken: eine fehlende Personenzahl', () => {
  // Mit Staffel liest die Berechnung das Feld gar nicht, dort gilt der letzte Eintrag.
  const mitStaffel = fullDb()
  drop(mitStaffel.tenancies[1], 'persons')
  unchanged(mitStaffel, 'Personenzahl fehlt, Staffel vorhanden')
  assert.equal(straightened(mitStaffel).tenancies[1].persons, 3, 'der letzte Eintrag der Staffel')

  // Ohne Staffel ist sie der Rückfall, und ohne beides gilt eine Person.
  const ohneStaffel = fullDb()
  drop(ohneStaffel.tenancies[1], 'personHistory')
  drop(ohneStaffel.tenancies[1], 'persons')
  unchanged(ohneStaffel, 'Personenzahl und Staffel fehlen')
  assert.equal(straightened(ohneStaffel).tenancies[1].persons, 1)
})

test('Geraderücken: eine fehlende Personen-Staffel entsteht aus der Personenzahl', () => {
  const krumm = fullDb()
  drop(krumm.tenancies[1], 'personHistory')
  unchanged(krumm, 'Personen-Staffel fehlt')
  assert.deepEqual(straightened(krumm).tenancies[1].personHistory, [{ from: krumm.tenancies[1].start, persons: 3 }])
})

test('Geraderücken: eine fehlende Vorauszahlungs-Staffel, mit und ohne festen Monatsbetrag', () => {
  const ohne = fullDb()
  drop(ohne.tenancies[1], 'prepayments')
  unchanged(ohne, 'Staffel fehlt, kein alter Betrag')
  assert.deepEqual(straightened(ohne).tenancies[1].prepayments, [])

  // Mit altem Betrag entsteht der Staffeleintrag ab dem Einzugsmonat, und zwar schon beim
  // Einlesen. Deshalb ist dieser Fall auch im Mietkonto zahlenneutral, anders als der nächste.
  const mit = fullDb()
  drop(mit.tenancies[1], 'prepayments')
  const alt: Tenancy & { prepaymentMonthlyCents?: number } = mit.tenancies[1]
  alt.prepaymentMonthlyCents = 12000
  unchanged(mit, 'Staffel fehlt, alter Betrag vorhanden')
  assert.deepEqual(straightened(mit).tenancies[1].prepayments, [
    { from: mit.tenancies[1].start.slice(0, 7), monthlyCents: 12000 },
  ])
})

test('Geraderücken: der feste Monatsbetrag neben einer leeren Staffel bewegt das Mietkonto', () => {
  // **Der eine hingenommene Fall, der eine Zahl bewegt.** Beim Einlesen bleibt der alte Betrag
  // liegen, weil die leere Staffel als vorhanden zählt. Die Abrechnung liest ihn trotzdem
  // (computePrepaymentCents), das Mietkonto nicht (rentLedger liest nur `prepayments`). Also
  // bleibt die Abrechnung gleich, und das Mietkonto zeigt nachher, was die Abrechnung ohnehin
  // schon ansetzt. Das ist eine gemessene Ausprägung von #70.
  const krumm = fullDb()
  krumm.tenancies[1].prepayments = []
  const alt: Tenancy & { prepaymentMonthlyCents?: number } = krumm.tenancies[1]
  alt.prepaymentMonthlyCents = 12000

  const vorher = resultsOf(krumm)
  const nachher = straightResultsOf(krumm)
  const jahr = 12 * 12000

  // Das Geraderücken macht daraus den Staffeleintrag ab dem Einzugsmonat, und das alte Feld
  // verschwindet: In der Datenbank gibt es dafür keine Spalte mehr.
  const gerade = straightened(krumm)
  assert.deepEqual(gerade.tenancies[1].prepayments, [{ from: krumm.tenancies[1].start.slice(0, 7), monthlyCents: 12000 }])
  assert.equal('prepaymentMonthlyCents' in gerade.tenancies[1], false)

  // Die Abrechnung bleibt bis auf den Cent gleich, der Verbrauch ohnehin.
  assert.deepEqual(nachher.settlement, vorher.settlement, 'Abrechnung')
  assert.deepEqual(nachher.consumption, vorher.consumption, 'Verbrauch')

  // Das Mietkonto bewegt sich, und zwar um genau die Vorauszahlung.
  const vorherZeile = ledgerRow(vorher.ledger, 't2')
  const nachherZeile = ledgerRow(nachher.ledger, 't2')
  assert.equal(vorherZeile.prepaymentYearCents, 0, 'heute fehlt die Vorauszahlung im Mietkonto')
  assert.equal(nachherZeile.prepaymentYearCents, jahr)
  assert.equal(nachherZeile.sollYearCents - vorherZeile.sollYearCents, jahr)

  // Und die Steuerübersicht nimmt die Zahlen des Mietkontos mit, bewegt sich also ebenfalls.
  // Das ist der Grund, hier alle vier Rechnungen zu vergleichen und nicht nur die Abrechnung.
  assert.equal(nachher.tax.income.prepaymentSollCents - vorher.tax.income.prepaymentSollCents, jahr, 'Steuerübersicht')

  // Was der Vermieter davon sieht: Das Soll steigt, also deckt dieselbe Zahlung weniger Monate.
  // Ein Monat, der als bezahlt dastand, ist danach nur noch teilweise gedeckt. Das ist die
  // Richtung, in die es gehört, denn die Abrechnung rechnet schon heute mit diesem Betrag; das
  // Mietkonto hat bisher zu wenig gefordert.
  assert.equal(vorherZeile.months[1].status, 'paid')
  assert.equal(nachherZeile.months[1].status, 'partial')
  const statement = vorher.settlement.statements.find((s) => s.tenancyId === 't2')
  if (!statement) return assert.fail('Abrechnung für t2 fehlt')
  assert.equal(statement.prepaymentCents, jahr, 'die Abrechnung rechnet schon heute mit dem alten Betrag')
  assert.equal(nachherZeile.prepaymentYearCents, statement.prepaymentCents, 'danach sagen beide dasselbe')
})

test('Geraderücken: beim doppelten Stichtag gilt der letzte Eintrag der Datei', () => {
  const krumm = fullDb()
  krumm.tenancies[0].prepayments = [{ from: '2024-01', monthlyCents: 15000 }, { from: '2024-01', monthlyCents: 18000 }]
  krumm.tenancies[0].personHistory = [{ from: '2024-01-01', persons: 2 }, { from: '2024-01-01', persons: 5 }]
  unchanged(krumm, 'doppelter Stichtag')
  // 150 gegen 180 Euro im Monat: Nähme das Geraderücken den ersten, wäre die Abrechnung um 360
  // Euro im Jahr anders. Die Abrechnung nimmt den letzten, und genau den behält die Datenbank.
  const gerade = straightened(krumm)
  assert.deepEqual(gerade.tenancies[0].prepayments, [{ from: '2024-01', monthlyCents: 18000 }])
  assert.deepEqual(gerade.tenancies[0].personHistory, [{ from: '2024-01-01', persons: 5 }])
})

test('Geraderücken: eine Direktzuordnung ins Leere ist dasselbe wie keine Zuordnung', () => {
  const krumm = fullDb()
  krumm.costItems.push(costItem({ id: 'c5', description: 'Rohrbruch', amountCents: 30000, key: 'direct', directUnitId: 'gibt-es-nicht' }))
  // Auch die Warnung bleibt dieselbe: Die Berechnung schlägt eine unbekannte Kennung genauso
  // nach wie `null`, nämlich vergeblich.
  unchanged(krumm, 'Direktzuordnung ins Leere')
  assert.equal(straightened(krumm).costItems[4].directUnitId, null)
  // Und die Zeile bleibt: Sie zu verwerfen entfernte eine bezahlte Rechnung aus einem
  // abgerechneten Jahr.
  assert.equal(straightened(krumm).costItems.length, 5)
})

test('Geraderücken: ein vereinbarter Anteil ins Leere bewegt keine Zahl, nur die Warnung entfällt', () => {
  const krumm = fullDb()
  krumm.costItems.push(costItem({ id: 'c5', description: 'Aufzug', amountCents: 50000, key: 'custom', customShares: { u1: 60, weg: 40 } }))
  const nachher = straightResultsOf(krumm)
  const vorher = resultsOf(krumm)
  assert.deepEqual(straightened(krumm).costItems[4].customShares, { u1: 60 })
  assert.deepEqual({ ...nachher.settlement, warnings: [] }, { ...vorher.settlement, warnings: [] })
  assert.deepEqual(nachher.ledger, vorher.ledger)
  assert.deepEqual(nachher.tax, vorher.tax)
  // Der eine Unterschied, und er ist benannt: Die Warnung über den verfallenen Anteil entfällt,
  // weil es den Eintrag danach nicht mehr gibt. Kein Cent verschiebt sich dadurch.
  assert.ok(vorher.settlement.warnings.some((w) => /vereinbarte Anteil/.test(w)), vorher.settlement.warnings.join(' | '))
  assert.ok(!nachher.settlement.warnings.some((w) => /vereinbarte Anteil/.test(w)), nachher.settlement.warnings.join(' | '))
})

test('Geraderücken: ein Zähler ohne ausgefüllte Wohnung ist ein Hauptzähler', () => {
  const krumm = fullDb()
  krumm.meters[0].unitId = ''
  unchanged(krumm, 'Zähler mit leerer Wohnungs-Kennung')
  assert.equal(straightened(krumm).meters[0].unitId, null)
})

// Nur für den einen Fall, in dem sich Anzeigetexte ändern dürfen, Beträge aber nicht: Jeder
// Text wird durch dieselbe Marke ersetzt, ein fehlender Text ebenso. Was danach noch
// unterschiedlich ist, ist keine Frage der Beschriftung.
function withoutTexts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTexts)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) out[key] = withoutTexts(Reflect.get(value, key))
    return out
  }
  return typeof value === 'string' || value === undefined ? 'Text' : value
}

test('Geraderücken: fehlende Anzeigefelder bewegen keine Zahl, ändern aber das Aussehen', () => {
  const krumm = fullDb()
  drop(krumm.units[1], 'name')
  drop(krumm.tenancies[1], 'tenantName')
  drop(krumm.costItems[0], 'description')
  drop(krumm.meters[0], 'name')
  drop(krumm.meters[0], 'unit')

  const vorher = resultsOf(krumm)
  const nachher = straightResultsOf(krumm)
  const gerade = straightened(krumm)
  assert.equal(gerade.units[1].name, '')
  assert.equal(gerade.meters[0].unit, '')
  assert.deepEqual(withoutTexts(nachher), withoutTexts(vorher), 'Zahlen')
  // Der benannte Unterschied: Das Mietkonto setzt für eine Wohnung ohne Namen einen Strich ein.
  // Nach dem Übernehmen steht dort der leere Name. Beide sagen dasselbe, nämlich dass kein Name
  // erfasst ist, und kein Betrag ändert sich dadurch.
  assert.equal(ledgerRow(vorher.ledger, 't2').unitName, '—')
  assert.equal(ledgerRow(nachher.ledger, 't2').unitName, '')
})
