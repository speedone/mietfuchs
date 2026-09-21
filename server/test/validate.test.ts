// Der Validator (server/src/db/validate.ts, #59): Was darf in die Datenbank, und was nicht?
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
import { findingsText, validateDb, type Finding } from '../src/db/validate.ts'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFromDb } from '../src/snapshot.ts'
import { FIXTURE_DIR } from '../testing/fixtures.ts'
import type { Db } from '../src/store.ts'
import type { CostItem, Meter, Payment, Reading, Settings, Tenancy, Unit } from '../../shared/types.ts'

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
  assert.deepEqual(problemsOf(value), [], `${hint}: unerwartete Beanstandung — ${textOf(problemsOf(value))}`)
}

// ---------- 1. Was in Ordnung ist ----------

test('Ein gewöhnlicher Bestand hat keine Beanstandung', () => {
  expectClean(healthyDb(), 'gesunder Bestand')
})

test('Die Beispielbestände des Prüfkatalogs kommen ohne Beanstandung durch', () => {
  // Der Prüfkatalog ist das Nächste, was wir an echten Daten haben: vollständige Bestände, die
  // bis auf den Cent nachgerechnet sind. Wäre der Validator zu streng, fiele hier etwas heraus.
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
    /negativ/,
    'negative Vorauszahlung',
  )
  expectProblem(dbWith({ units: [unit({ id: 'u1', areaM2: -80 })] }), /negativ/, 'negative Wohnfläche')
  expectProblem(dbWith({ readings: [reading({ id: 'r1', meterId: 'm1', value: -5 })] }), /negativ/, 'negativer Zählerstand')
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

// ---------- 4. Geraderücken ändert keine Zahl ----------
//
// Hier steht die Begründung der ganzen Grenze. Jeder krumme Fall wird so geradegerückt, wie es
// der Hinweis ankündigt, und die Abrechnung wird vorher und nachher verglichen. Kommt dasselbe
// heraus, war das Hinnehmen richtig; käme etwas anderes heraus, gehörte der Fall abgelehnt.

const settlementOf = (db: Db) => computeSettlement(snapshotFromDb(db, 2024))

// Ein Bestand mit zwei Wohnungen, zwei Mietverhältnissen und mehreren Kostenpositionen: Erst
// dann fällt eine verschobene Verteilung überhaupt auf.
function twoUnits(): Db {
  return {
    ...healthyDb(),
    tenancies: [tenancy({ id: 't1', unitId: 'u1' }), tenancy({ id: 't2', unitId: 'u2', tenantName: 'Schmidt' })],
    costItems: [costItem({ id: 'c1' }), costItem({ id: 'c2', description: 'Hausreinigung', amountCents: 24000, key: 'units' })],
  }
}

test('Geraderücken: eine Direktzuordnung ins Leere ist dasselbe wie keine Zuordnung', () => {
  const krumm = twoUnits()
  krumm.costItems.push(costItem({ id: 'c3', description: 'Rohrbruch', amountCents: 30000, key: 'direct', directUnitId: 'weg' }))
  const gerade = structuredClone(krumm)
  gerade.costItems[2].directUnitId = null
  // Auch die Warnung bleibt dieselbe: Die Berechnung schlägt eine unbekannte Kennung genauso
  // nach wie `null`, nämlich vergeblich.
  assert.deepEqual(settlementOf(gerade), settlementOf(krumm))
})

test('Geraderücken: beim doppelten Stichtag gilt der letzte Eintrag der Datei', () => {
  const krumm = twoUnits()
  krumm.tenancies[0].prepayments = [{ from: '2024-01', monthlyCents: 15000 }, { from: '2024-01', monthlyCents: 18000 }]
  krumm.tenancies[0].personHistory = [{ from: '2024-01-01', persons: 2 }, { from: '2024-01-01', persons: 5 }]
  const gerade = structuredClone(krumm)
  gerade.tenancies[0].prepayments = [{ from: '2024-01', monthlyCents: 18000 }]
  gerade.tenancies[0].personHistory = [{ from: '2024-01-01', persons: 5 }]
  assert.deepEqual(settlementOf(gerade), settlementOf(krumm))
})

test('Geraderücken: ein vereinbarter Anteil ins Leere ändert keine Zahl', () => {
  const krumm = twoUnits()
  krumm.costItems.push(costItem({ id: 'c3', description: 'Aufzug', amountCents: 50000, key: 'custom', customShares: { u1: 60, weg: 40 } }))
  const gerade = structuredClone(krumm)
  gerade.costItems[2].customShares = { u1: 60 }
  const a = settlementOf(krumm)
  const b = settlementOf(gerade)
  assert.deepEqual({ ...b, warnings: [] }, { ...a, warnings: [] })
  // Der eine Unterschied, und er ist benannt: Die Warnung über den verfallenen Anteil entfällt,
  // weil es den Eintrag danach nicht mehr gibt. Kein Cent verschiebt sich dadurch.
  assert.ok(a.warnings.some((w) => /vereinbarte Anteil/.test(w)), a.warnings.join(' | '))
  assert.ok(!b.warnings.some((w) => /vereinbarte Anteil/.test(w)), b.warnings.join(' | '))
})

test('Geraderücken: eine fehlende Wohnfläche ist dasselbe wie 0 m²', () => {
  const krumm = twoUnits()
  // Das Feld wirklich entfernen, nicht auf undefined setzen: Genau so steht es in der Datei.
  const ohneFlaeche: Omit<Unit, 'areaM2'> & { areaM2?: number } = krumm.units[1]
  delete ohneFlaeche.areaM2
  const gerade = structuredClone(krumm)
  gerade.units[1].areaM2 = 0
  assert.deepEqual(settlementOf(gerade), settlementOf(krumm))
})

test('Geraderücken: der feste Monatsbetrag neben einer leeren Staffel bleibt die Vorauszahlung', () => {
  // Beim Einlesen wandelt legacy.ts den festen Monatsbetrag nur um, wenn die Staffel ganz
  // fehlt. Steht daneben eine leere Staffel, bleibt das alte Feld liegen, und die Berechnung
  // liest es weiterhin. In der Datenbank gibt es dafür keine Spalte mehr: Wer das beim Umstieg
  // übersieht, nimmt dem Mieter seine ganze Vorauszahlung aus der Abrechnung.
  const krumm = twoUnits()
  const alt: Tenancy & { prepaymentMonthlyCents?: number } = krumm.tenancies[0]
  alt.prepayments = []
  alt.prepaymentMonthlyCents = 15000
  const gerade = structuredClone(krumm)
  const geradeAlt: Tenancy & { prepaymentMonthlyCents?: number } = gerade.tenancies[0]
  delete geradeAlt.prepaymentMonthlyCents
  gerade.tenancies[0].prepayments = [{ from: '2024-01', monthlyCents: 15000 }]
  assert.deepEqual(settlementOf(gerade), settlementOf(krumm))
  // Und der Hinweis kündigt genau das an.
  assert.match(textOf(adjustmentsOf(krumm)), /Monatsbetrag/)
})
