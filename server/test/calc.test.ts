import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  compareName,
  compareText,
  capToShares,
  computeSettlement,
  computePrepaymentCents,
  consumptionInPeriod,
  consumptionOverview,
  meterSegments,
  overlapDays,
  daysInYear,
  personDaysInPeriod,
  isNotAllocable,
  largestRemainder,
  rentLedger,
  RESERVE_CATEGORY,
  taxReport,
  validLabor35aCents,
} from '../src/calc.ts'
import type { ComputedSettlement } from '../src/calc.ts'
import { snapshotFor, snapshotFromDb, snapshotOf, type PropertyScopedSource, type SnapshotSource } from '../src/snapshot.ts'
import type { ClosedSettlement, Db } from '../src/store.ts'
import type { CostKey, CostModel, MeterType, Payment, Reading, Settings, TaxExpenseGroup, TaxReport, Tenancy, UnitUsage } from '../../shared/types.ts'
// Die Tests bauen eine db.json; deren Wohnungen, Zähler und Kosten tragen kein Objekt (#92).
import type { LegacyCostItem as CostItem, LegacyCostKey, LegacyMeter as Meter, LegacyUnit as Unit } from '../src/store.ts'
import { assertLandlordParts } from '../testing/landlordParts.ts'

// ---------- Bausteine für die Testdaten ----------
//
// Die Engine sieht in den ganzen Bestand hinein, jeden Test interessiert aber nur ein
// Ausschnitt davon. Diese Helfer füllen die übrigen Pflichtfelder mit dem, was store.ts beim
// ersten Start anlegt, damit unten nur das Fachliche steht.

const emptySettings = (): Settings => ({
  houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434', ollamaModel: '',
})

const emptyDb = (): Db => ({
  settings: emptySettings(),
  units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
})

// Ein Mietverhältnis, wie es in der Datei steht: `prepaymentMonthlyCents` ist das Altformat der
// Vorauszahlung (ein fester Monatsbetrag), das die Engine weiterhin liest — siehe
// computePrepaymentCents in calc.ts, das dieselbe Erweiterung benutzt.
type StoredTenancy = Tenancy & { prepaymentMonthlyCents?: number }

const tenancy = (t: Partial<StoredTenancy> & Pick<Tenancy, 'id' | 'unitId'>): StoredTenancy => ({
  tenantName: '', persons: 0, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [], ...t,
})

// Eine Wohnung, bei der `areaM2` gar nicht in der Datei steht. Das Datenmodell verlangt das
// Feld, weil das Formular es erzwingt; in einer db.json aus früheren Versionen oder von Hand
// bearbeitet fehlt es. Die Engine rechnet ausdrücklich damit (`u.areaM2 || 0` in calc.ts) und
// meldet es als Mangel — genau das prüfen die Tests weiter unten. Der weitere Parametertyp
// erlaubt das Entfernen, ohne dem Übersetzer etwas vorzumachen.
type UnitWithoutArea = Omit<Unit, 'areaM2'> & { areaM2?: number }
const dropArea = (unit: UnitWithoutArea): void => { delete unit.areaM2 }

// Ablesungen eines Zählers. Kennung und Zähler gehören zu jeder Ablesung in der Datei; für die
// Verbrauchsrechnung selbst zählen nur Datum, Stand und ein etwaiger Zählerwechsel.
const readingsOf = (meterId: string, entries: Omit<Reading, 'id' | 'meterId'>[]): Reading[] =>
  entries.map((e, i) => ({ id: `${meterId}-r${i}`, meterId, ...e }))

// Die Abrechnung eines Mietverhältnisses. Fehlt sie, ist das der Befund des Tests, und er soll
// ihn benennen statt an undefined zu scheitern.
const statementOf = (s: ComputedSettlement, tenancyId: string) => {
  const statement = s.statements.find((x) => x.tenancyId === tenancyId)
  if (!statement) assert.fail(`keine Abrechnung für ${tenancyId}`)
  return statement
}

// Eine Werbungskosten-Gruppe der Steuerübersicht, ebenso benannt statt stillschweigend fehlend.
const groupOf = (report: TaxReport, group: string): TaxExpenseGroup => {
  const found = report.expenses.groups.find((g) => g.group === group)
  if (!found) assert.fail(`keine Gruppe „${group}“ in der Steuerübersicht`)
  return found
}

// Beispielhaus für die Tests: 3 Wohnungen, davon eine selbstgenutzt und zwei vermietet.
// Die selbstgenutzte Wohnung ist hier ohne Eigennutzungs-Kennzeichen angelegt (Altbestand) —
// die Tests unten decken beide Varianten ab.
function makeDb(): Db {
  return {
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG (Eigennutzung)', areaM2: 80, participates: false },
      { id: 'u2', name: 'OG links', areaM2: 90, participates: true },
      { id: 'u3', name: 'OG rechts', areaM2: 60, participates: true },
    ],
    tenancies: [
      tenancy({ id: 't2', unitId: 'u2', tenantName: 'Familie A', persons: 4, prepaymentMonthlyCents: 15000 }),
      tenancy({ id: 't3', unitId: 'u3', tenantName: 'Familie B', persons: 3, prepaymentMonthlyCents: 10000 }),
    ],
  }
}

test('overlapDays: volles Jahr, Teiljahr, kein Überlapp', () => {
  assert.equal(overlapDays('2020-01-01', null, 2025), 365)
  assert.equal(overlapDays('2025-07-01', null, 2025), 184)
  assert.equal(overlapDays('2020-01-01', '2025-03-31', 2025), 90)
  assert.equal(overlapDays('2026-01-01', null, 2025), 0)
  assert.equal(daysInYear(2024), 366)
})

// ---------- Die Schnappschuss-Grenze ----------
//
// Die Berechnung bekommt nicht mehr den Datenbestand, sondern den Schnappschuss eines Jahres.
// Welche Sammlung dabei nach Jahr eingegrenzt werden darf, entscheidet über die Richtigkeit der
// Abrechnung: Wer zu viel wegschneidet, bekommt kein Fehlerbild, sondern eine stille
// Falschrechnung. Diese Tests halten die Regel fest, damit sie nicht wieder verhandelt wird.

// Die Sammlungen des Schnappschusses sind Mengen: In welcher Reihenfolge die Datensätze in der
// Datei stehen, hat keine fachliche Bedeutung, und der Schnappschuss sagt dazu nichts zu. Die
// Tests unten vergleichen deshalb sortiert; sonst schriebe der erste Umbau der Ablage über
// einen roten Test hinweg, der nie etwas Fachliches gemeint hat.
const sorted = (values: string[]): string[] => values.slice().sort()

// Eine abgeschlossene (eingefrorene) Abrechnung, wie sie in der Datei steht. Für diese Tests
// zählt daran nur das Jahr und der Eigenanteil; der Rest sind die Pflichtfelder des Modells.
const closedSettlement = (year: number, selfUsedShareCents: number): ClosedSettlement => ({
  id: `cs${year}`,
  year,
  closedAt: `${year + 1}-06-30T10:00:00.000Z`,
  sentAt: null,
  settlement: {
    year,
    daysInYear: daysInYear(year),
    statements: [],
    landlord: { rows: [], totalCents: 0 },
    selfUsedShareCents,
    totalCostsCents: 0,
    warnings: [],
  },
})

test('Schnappschuss: Ablesungen bleiben vollständig, auch die vor dem Abrechnungsjahr', () => {
  const db = makeDb()
  db.meters.push({ id: 'm2', unitId: 'u2', type: 'kaltwasser', name: 'WZ OG links', unit: 'm³' })
  db.readings.push(...readingsOf('m2', [
    { date: '2024-12-31', value: 1000 },
    { date: '2025-12-31', value: 1100 },
    { date: '2026-12-31', value: 1250 },
  ]))
  const snap = snapshotFromDb(db, 2025)
  // Der Anfangsstand des Jahres ist die Ablesung vom 31. Dezember des Vorjahres. Ohne sie gibt
  // es kein Verbrauchssegment, und der Jahresverbrauch wäre still 0 statt 100.
  assert.deepEqual(sorted(snap.readings.map((r) => r.date)), ['2024-12-31', '2025-12-31', '2026-12-31'])
  assert.equal(consumptionInPeriod(snap.readings, '2025-01-01', '2025-12-31'), 100)
})

test('Schnappschuss: Staffeln von vor dem Abrechnungsjahr bleiben erhalten', () => {
  const db = makeDb()
  const t = db.tenancies[0]
  t.start = '2019-03-01'
  t.personHistory = [{ from: '2019-03-01', persons: 2 }]
  t.prepayments = [{ from: '2019-03', monthlyCents: 12000 }]
  t.baseRents = [{ from: '2019-03', monthlyCents: 65000 }]
  const snap = snapshotFromDb(db, 2025)
  const stored = snap.tenancies.find((x) => x.id === t.id)
  if (!stored) assert.fail('das Mietverhältnis fehlt im Schnappschuss')
  // „Ab diesem Datum gilt dieser Wert“: der maßgebliche Eintrag kann Jahre alt sein. Eine
  // Staffel auf das Abrechnungsjahr zu kürzen, setzte Personenzahl, Vorauszahlung und
  // Kaltmiete stillschweigend auf 0.
  assert.deepEqual(stored.personHistory, [{ from: '2019-03-01', persons: 2 }])
  assert.deepEqual(stored.prepayments, [{ from: '2019-03', monthlyCents: 12000 }])
  assert.deepEqual(stored.baseRents, [{ from: '2019-03', monthlyCents: 65000 }])
})

test('Schnappschuss: Wohnungen, Zähler, Mietverhältnisse und Zahlungen bleiben vollständig', () => {
  const db = makeDb()
  db.meters.push({ id: 'mh', unitId: null, type: 'kaltwasser', name: 'Hauptzähler', unit: 'm³' })
  db.tenancies.push(tenancy({ id: 't0', unitId: 'u2', tenantName: 'Vormieter', start: '2018-01-01', end: '2023-06-30' }))
  db.payments.push(
    { id: 'p1', tenancyId: 't2', date: '2024-12-05', amountCents: 15000 },
    { id: 'p2', tenancyId: 't2', date: '2025-03-05', amountCents: 15000 },
  )
  const snap = snapshotFromDb(db, 2025)
  // Wohnungen und Zähler tragen kein Jahr: sie gehören zum Haus, nicht zur Abrechnung.
  assert.deepEqual(sorted(snap.units.map((u) => u.id)), ['u1', 'u2', 'u3'])
  assert.deepEqual(sorted(snap.meters.map((m) => m.id)), ['mh'])
  // Ob ein Mietverhältnis ins Jahr fällt, entscheidet overlapDays in der Berechnung, und ob
  // eine Zahlung dazuzählt, entscheidet das Mietkonto. Beides bleibt dort, wo es geprüft ist.
  assert.deepEqual(sorted(snap.tenancies.map((t) => t.id)), ['t0', 't2', 't3'])
  assert.deepEqual(sorted(snap.payments.map((p) => p.date)), ['2024-12-05', '2025-03-05'])
})

test('Schnappschuss: Kostenpositionen und abgeschlossene Abrechnung gehören zum Jahr', () => {
  const db = makeDb()
  db.costItems.push(
    { id: 'c24', year: 2024, category: 'Grundsteuer', description: 'Vorjahr', amountCents: 10000, key: 'area' },
    { id: 'c25', year: 2025, category: 'Grundsteuer', description: 'Abrechnungsjahr', amountCents: 20000, key: 'area' },
  )
  db.closedSettlements.push(closedSettlement(2024, 11100), closedSettlement(2025, 22200))
  const snap = snapshotFromDb(db, 2025)
  // Beide tragen ihr Jahr als Feld. Eingrenzen heißt hier lesen, was dasteht, nicht herleiten.
  assert.deepEqual(sorted(snap.costItems.map((c) => c.id)), ['c25'])
  // Der eingefrorene Stand bringt mit, was die Steuerübersicht daraus liest: den Eigenanteil und
  // die Vorauszahlungen der zugestellten Abrechnung (#70). Die Prüfung steht bewusst als ganzes
  // Objekt da: Ein neues Feld, das niemand füllt, fiele sonst nicht auf.
  // Die Eigenanteile je Position (#163) fehlen: Das Archivstück hier hat keine Zeilen des
  // Vermieteranteils, die die Summe von 222 € tragen, und dann gilt nur die Summe.
  assert.deepEqual(snap.closedSettlement, {
    selfUsedShareCents: 22200,
    prepaymentCents: 0,
    prepaymentOverridden: false,
    selfUseByItem: null,
    // Welche Positionen auf dem Papier standen (Durchsicht zu #163): hier keine.
    itemTotals: {},
  })
  assert.strictEqual(snapshotFromDb(db, 2023).closedSettlement, null)
})

// Ein Datenbestand so, wie er aus der Datei kommt: ungeprüft. Genau so betritt er den Prozess,
// denn store.ts legt den Dateiinhalt über die Vorgabewerte, und ein `null` in der Datei gewinnt
// dabei (#59). JSON.parse ist hier der ehrliche Weg; eine Zusicherung würde behaupten, der
// Inhalt entspreche dem Modell, und genau das tut er im folgenden Test nicht.
const fromFile = (content: unknown): Db => JSON.parse(JSON.stringify(content))

test('Schnappschuss: eine Sammlung als null bricht ab, statt stillschweigend alles zu erstatten', () => {
  // Steht in der db.json `"costItems": null`, warf die Berechnung bisher, und der Nutzer sah
  // einen Fehler. Fängt der Schnappschuss das mit einem `?? []` ab, kommt stattdessen eine
  // leere Abrechnung heraus: keine Kosten, keine Zeilen, und jeder Mieter bekommt seine
  // Vorauszahlung in voller Höhe erstattet. Das sieht stimmig aus und ist falsch, und das ist
  // der schlimmere der beiden Ausgänge. Der Test bleibt gültig, wenn die Prüfung aus #59 die
  // Ursache beseitigt: Er baut den kaputten Bestand selbst und fragt nicht, wie er entstand.
  for (const collection of ['units', 'tenancies', 'costItems']) {
    const db = fromFile({ ...makeDb(), [collection]: null })
    assert.throws(
      () => computeSettlement(snapshotFromDb(db, 2025)),
      TypeError,
      `„${collection}“: null blieb unbemerkt, die Abrechnung wäre leer statt fehlerhaft`,
    )
  }
})

test('Schnappschuss: das Altformat der Vorauszahlung überlebt die Grenze', () => {
  // makeDb legt die Vorauszahlung im Altformat an (ein fester Monatsbetrag statt einer
  // Staffel), und computePrepaymentCents liest es weiterhin. Der Schnappschuss darf die
  // Datensätze deshalb nur durchreichen; baute er sie Feld für Feld neu, verschwände der
  // Betrag stillschweigend und der Mieter bekäme eine Nachforderung über das ganze Jahr.
  const snap = snapshotFromDb(makeDb(), 2025)
  const stored = snap.tenancies.find((x) => x.id === 't2')
  if (!stored) assert.fail('das Mietverhältnis fehlt im Schnappschuss')
  assert.equal(computePrepaymentCents(stored, 2025).cents, 180000) // 12 × 150 €
})

test('Flächenschlüssel: Eigennutzung bleibt außen vor, Verteilung 90:60', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  const a = statementOf(s, 't2')
  const b = statementOf(s, 't3')
  assert.equal(a.totalShareCents, 54000) // 90/150 von 900 €
  assert.equal(b.totalShareCents, 36000) // 60/150 von 900 €
  assert.equal(s.landlord.totalCents, 0)
})

test('Personenschlüssel: 4 vs 3 Personen, centgenau ohne Rest', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100001, key: 'persons' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  const a = statementOf(s, 't2')
  const b = statementOf(s, 't3')
  assert.equal(a.totalShareCents + b.totalShareCents, 100001) // exakte Summe trotz krummer Teilung
  assert.equal(s.landlord.totalCents, 0)
  // 4/7 von 1000,01 € ≈ 571,43 €
  assert.ok(Math.abs(a.totalShareCents - 57143) <= 1)
})

test('Restcent bei gleichen Anteilen: entscheidet die Kennung des Mietverhältnisses, nicht die Reihenfolge', () => {
  // 100,00 € auf drei gleich große Wohnungen: 33,33 € je Wohnung, ein Cent bleibt übrig.
  // Wer ihn trägt, ist fachlich beliebig — aber dieselben Daten müssen immer dieselbe
  // Abrechnung ergeben, egal in welcher Reihenfolge sie in der Datei stehen.
  const make = (order: number[]): Db => ({
    ...emptyDb(),
    units: order.map((n) => ({ id: `u${n}`, name: `Wohnung ${n}`, areaM2: 70, participates: true })),
    tenancies: order.map((n) => tenancy({ id: `t${n}`, unitId: `u${n}`, tenantName: `Mieter ${n}`, persons: 2 })),
    costItems: [{ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 10000, key: 'area' }],
  })
  for (const order of [[1, 2, 3], [3, 2, 1], [2, 3, 1]]) {
    const s = computeSettlement(snapshotFromDb(make(order), 2025))
    const share = (id: string) => statementOf(s, id).totalShareCents
    assert.deepEqual([share('t1'), share('t2'), share('t3')], [3334, 3333, 3333], `Reihenfolge ${order.join(', ')}`)
  }
})

test('Mieterwechsel: zeitanteilige Verteilung, Leerstand trägt der Vermieter', () => {
  const db = makeDb()
  // Familie B zieht Ende März aus, Wohnung steht danach leer
  db.tenancies[1].end = '2025-03-31'
  db.costItems.push({ id: 'c1', year: 2025, category: 'Versicherung', description: 'Gebäudeversicherung', amountCents: 60000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  const a = statementOf(s, 't2')
  const b = statementOf(s, 't3')
  assert.equal(a.totalShareCents, 36000) // 90/150 volles Jahr
  assert.equal(b.totalShareCents, Math.round(24000 * (90 / 365))) // 60/150, aber nur 90 Tage
  assert.equal(a.totalShareCents + b.totalShareCents + s.landlord.totalCents, 60000)
  assert.ok(s.landlord.totalCents > 0)
})

test('Direktzuordnung geht vollständig an eine Wohnung', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Zähler OG links', amountCents: 12345, key: 'direct', directUnitId: 'u2' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 12345)
  assert.equal(statementOf(s, 't3').totalShareCents, 0)
})

test('Vorauszahlungen und Saldo', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 300000, key: 'units' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  const a = statementOf(s, 't2')
  assert.equal(a.prepaymentCents, 180000) // 150 € × 12
  assert.equal(a.totalShareCents, 150000) // halbe Kosten
  assert.equal(a.balanceCents, 30000) // 300 € Guthaben
})

test('Nicht umlagefähige Kosten trägt vollständig der Vermieter', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Nicht umlagefähig', description: 'Dachreparatur', amountCents: 50000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 0)
  assert.equal(s.landlord.totalCents, 50000)
})

test('Vorauszahlungs-Staffel: Erhöhung zum Juli', () => {
  const t = tenancy({
    id: 't1', unitId: 'u1', start: '2024-01-01',
    prepayments: [
      { from: '2024-01', monthlyCents: 15000 },
      { from: '2025-07', monthlyCents: 18000 },
    ],
  })
  // 6 × 150 € + 6 × 180 € = 1.980 €
  assert.deepEqual(computePrepaymentCents(t, 2025), { cents: 198000, overridden: false })
  // Vorjahr: ganzjährig 150 €
  assert.deepEqual(computePrepaymentCents(t, 2024), { cents: 180000, overridden: false })
})

test('Vorauszahlungen: Einzug Mitte März zählt ab April', () => {
  const t = tenancy({ id: 't1', unitId: 'u1', start: '2025-03-15', prepayments: [{ from: '2025-03', monthlyCents: 10000 }] })
  assert.equal(computePrepaymentCents(t, 2025).cents, 90000) // Apr–Dez = 9 Monate
})

test('Vorauszahlungen: manuelle Jahres-Korrektur hat Vorrang', () => {
  const t = tenancy({
    id: 't1', unitId: 'u1', start: '2024-01-01',
    prepayments: [{ from: '2024-01', monthlyCents: 15000 }],
    prepaymentOverrides: { '2025': 165000 }, // ein Monat nicht gezahlt
  })
  assert.deepEqual(computePrepaymentCents(t, 2025), { cents: 165000, overridden: true })
  assert.equal(computePrepaymentCents(t, 2024).cents, 180000)
})

test('Vorauszahlungen: Altformat (fester Monatsbetrag) wird weiter unterstützt', () => {
  const t = tenancy({ id: 't1', unitId: 'u1', prepaymentMonthlyCents: 15000 })
  assert.equal(computePrepaymentCents(t, 2025).cents, 180000)
})

test('Kosten anderer Jahre werden ignoriert', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2024, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.totalCostsCents, 0)
})

test('Personen-Staffel: Geburt im Jahr ändert Personentage', () => {
  const t = tenancy({
    id: 't1', unitId: 'u1', start: '2024-01-01',
    personHistory: [
      { from: '2024-01-01', persons: 2 },
      { from: '2025-07-01', persons: 3 }, // Nachwuchs ab Juli
    ],
  })
  // Jan–Jun: 181 Tage × 2 + Jul–Dez: 184 Tage × 3 = 362 + 552 = 914
  assert.equal(personDaysInPeriod(t, '2025-01-01', '2025-12-31'), 914)
  // Vorjahr: 366 Tage × 2 (Schaltjahr)
  assert.equal(personDaysInPeriod(t, '2024-01-01', '2024-12-31'), 732)
})

test('Personenschlüssel nutzt die Staffel in der Abrechnung', () => {
  const db = makeDb()
  db.tenancies[0].personHistory = [
    { from: '2020-01-01', persons: 4 },
    { from: '2025-07-01', persons: 5 },
  ]
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'persons' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  const a = statementOf(s, 't2')
  const b = statementOf(s, 't3')
  const pdA = 181 * 4 + 184 * 5 // 1644
  const pdB = 365 * 3 // 1095
  assert.equal(a.totalShareCents + b.totalShareCents, 100000)
  assert.ok(Math.abs(a.totalShareCents - Math.round((100000 * pdA) / (pdA + pdB))) <= 1)
  assert.equal(a.persons, 5) // aktuelle Personenzahl am Periodenende
})

test('Verbrauch: lineare Interpolation über Jahresgrenze', () => {
  // Ablesung 31.12.2024: 100, Ablesung 31.12.2025: 200 → Jahr 2025 = volle 100
  const readings = readingsOf('m1', [
    { date: '2024-12-31', value: 100 },
    { date: '2025-12-31', value: 200 },
  ])
  assert.ok(Math.abs(consumptionInPeriod(readings, '2025-01-01', '2025-12-31') - 100) < 1e-9)
  // halbes Jahr ≈ anteilig
  const half = consumptionInPeriod(readings, '2025-01-01', '2025-06-30')
  assert.ok(half > 49 && half < 51)
})

test('Verbrauch: Zwischenablesung beim Mieterwechsel teilt exakt', () => {
  const readings = readingsOf('m1', [
    { date: '2024-12-31', value: 0 },
    { date: '2025-03-31', value: 30 }, // Zwischenablesung beim Auszug
    { date: '2025-12-31', value: 100 },
  ])
  assert.ok(Math.abs(consumptionInPeriod(readings, '2025-01-01', '2025-03-31') - 30) < 1e-9)
  assert.ok(Math.abs(consumptionInPeriod(readings, '2025-04-01', '2025-12-31') - 70) < 1e-9)
})

test('Zählerwechsel: Endstand alt + Startstand neu, kein negativer Verbrauch', () => {
  const readings = readingsOf('m1', [
    { date: '2024-12-31', value: 950 },
    { date: '2025-06-30', value: 3, replacement: true, oldEndValue: 980 }, // neuer Zähler startet bei 3
    { date: '2025-12-31', value: 40 },
  ])
  const total = consumptionInPeriod(readings, '2025-01-01', '2025-12-31')
  assert.ok(Math.abs(total - (30 + 37)) < 1e-9) // 980−950 + 40−3
  assert.equal(meterSegments(readings).warnings.length, 0)
  // ohne Wechsel-Markierung gäbe es eine Warnung
  const broken = readingsOf('m1', [{ date: '2024-12-31', value: 950 }, { date: '2025-06-30', value: 3 }])
  assert.equal(meterSegments(broken).warnings.length, 1)
})

test('Zwei Ablesungen am selben Tag: der Verbrauch dazwischen wird gemeldet (#69)', () => {
  // **Er verschwand bisher ersatzlos und ohne ein Wort.** Verbrauchssegmente entstehen nur, wenn
  // zwischen zwei Ablesungen mindestens ein Tag liegt, denn sonst müsste durch null geteilt
  // werden, um tagesanteilig zu verteilen. Das ist richtig. Die Differenz zwischen den beiden
  // Ständen fiel dabei aber unter den Tisch, statt irgendwo aufzutauchen.
  //
  // **Verteilt wird sie trotzdem nicht, und das ist eine Entscheidung mit Begründung.** Beide
  // erreichbaren Fälle sprechen dagegen. Zwei gewöhnliche Ablesungen am selben Tag sind fast
  // immer eine Korrektur; die Differenz ist dann ein Tippfehler und keine Menge Wasser, und sie
  // dem Nachbarsegment zuzuschlagen machte aus der Korrektur Verbrauch. Beim Zählerwechsel am
  // selben Tag ist die Differenz Verbrauch über null Tage, also selbst schon ein Widerspruch in
  // den Daten. In beiden Fällen weiß nur der Vermieter, welche der beiden Ablesungen stimmt.
  // Verteilen hieße raten. Es bleibt also bei der Meldung, wie bei der für negativen Verbrauch.
  const doppelt = readingsOf('m1', [
    { date: '2024-12-31', value: 100 },
    { date: '2025-06-30', value: 150 },
    { date: '2025-06-30', value: 160 }, // Korrektur am selben Tag: 10 fallen heraus
    { date: '2025-12-31', value: 200 },
  ])
  const { warnings, segments } = meterSegments(doppelt)
  assert.equal(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /30\.06\.2025/)
  assert.match(warnings[0], /nicht verteilt/)
  assert.match(warnings[0], /um 10,/, warnings[0])
  // Der Verbrauch selbst bleibt, wie er war: 50 bis zum Stichtag, 40 danach. Die 10 sind weg,
  // und genau das sagt die Meldung.
  assert.equal(segments.length, 2)
  assert.ok(Math.abs(consumptionInPeriod(doppelt, '2025-01-01', '2025-12-31') - 90) < 1e-9)

  // Zwei Ablesungen am selben Tag mit demselben Stand sind eine Doppeleingabe und kein Verlust.
  const gleich = readingsOf('m1', [
    { date: '2024-12-31', value: 100 },
    { date: '2025-06-30', value: 150 },
    { date: '2025-06-30', value: 150 },
  ])
  assert.deepEqual(meterSegments(gleich).warnings, [])
})

test('Zwei Ablesungen am selben Tag: der Zählerwechsel ist der ärgerliche Fall (#69)', () => {
  // Dafür gibt es das Kennzeichen, und genau hier wäre der verschwundene Verbrauch am
  // ärgerlichsten: Er fehlt beim Mieter und geht stillschweigend zulasten des Vermieters.
  const wechsel = readingsOf('m1', [
    { date: '2024-12-31', value: 950 },
    { date: '2025-06-30', value: 980 },
    // Wechsel am selben Tag: Der alte Zähler stand bei 995, die 15 dazwischen fallen heraus.
    { date: '2025-06-30', value: 0, replacement: true, oldEndValue: 995 },
    { date: '2025-12-31', value: 40 },
  ])
  const { warnings } = meterSegments(wechsel)
  assert.equal(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /nicht verteilt/)

  // Wird am Wechseltag gar nichts mehr verbraucht, gibt es auch nichts zu melden.
  const sauber = readingsOf('m1', [
    { date: '2024-12-31', value: 950 },
    { date: '2025-06-30', value: 980 },
    { date: '2025-06-30', value: 0, replacement: true, oldEndValue: 980 },
    { date: '2025-12-31', value: 40 },
  ])
  assert.deepEqual(meterSegments(sauber).warnings, [])
})

test('Zwei Ablesungen am selben Tag: dann gilt diese Meldung und nicht die für negativen Verbrauch (#69)', () => {
  // **Eine Meldung je Fall.** Die Meldung über negativen Verbrauch spricht von einem Zähler, der
  // über die Zeit zurückläuft; über null Tage gibt es diese Zeit nicht, und die Differenz geht
  // ohnehin nicht in die Rechnung ein. Zwei Meldungen nebeneinander sagten dasselbe zweimal und
  // schickten den Vermieter auf die falsche Fährte („Zählerwechsel markieren“), obwohl hier eine
  // der beiden Ablesungen zu korrigieren ist.
  const rueckwaerts = readingsOf('m1', [
    { date: '2024-12-31', value: 100 },
    { date: '2025-06-30', value: 160 },
    { date: '2025-06-30', value: 150 }, // die zweite steht niedriger
  ])
  const { warnings } = meterSegments(rueckwaerts)
  assert.equal(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /nicht verteilt/)
  assert.doesNotMatch(warnings[0], /Negativer Verbrauch/)
})

test('Zwei Ablesungen am selben Tag: einen Mieter kostet es Geld (#69)', () => {
  // **Nachgemessen, und es widerlegt die Annahme des Issues.** Dort steht, der verschwundene
  // Verbrauch gehe „stillschweigend zulasten des Vermieters“. Beim Verbrauchsschlüssel ist die
  // Verteilbasis aber die Summe des **gemessenen** Verbrauchs: Fehlt bei einem Zähler etwas,
  // schrumpfen Zähler und Nenner gemeinsam, und der Rechnungsbetrag wird trotzdem vollständig
  // verteilt. Der Vermieter trägt also nichts, und **ein anderer Mieter zahlt es**.
  //
  // Das ist der schlimmere der beiden Ausgänge: Ein Verlust beim Vermieter wäre ärgerlich, aber
  // niemandem unrecht. Hier bekommt ein Mieter eine zugestellte Abrechnung mit zu viel darauf,
  // und niemandem fällt es auf.
  const db = (readings: Reading[]): Db => ({
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG', areaM2: 100, participates: true },
      { id: 'u2', name: 'OG', areaM2: 100, participates: true },
    ],
    tenancies: [
      tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01' }),
      tenancy({ id: 't2', unitId: 'u2', tenantName: 'B', start: '2025-01-01' }),
    ],
    costItems: [{ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 200000, key: 'meter', meterType: 'kaltwasser' }],
    meters: [
      { id: 'm1', unitId: 'u1', name: 'A', type: 'kaltwasser', unit: 'm³' },
      { id: 'm2', unitId: 'u2', name: 'B', type: 'kaltwasser', unit: 'm³' },
    ],
    readings,
  })
  const ablesung = (id: string, meterId: string, date: string, value: number): Reading => ({ id, meterId, date, value })
  const beiB = [ablesung('b1', 'm2', '2024-12-31', 0), ablesung('b2', 'm2', '2025-12-31', 100)]
  const anteile = (readings: Reading[]) =>
    Object.fromEntries(computeSettlement(snapshotFromDb(db(readings), 2025)).statements.map((st) => [st.tenantName, st.totalShareCents]))

  const sauber = anteile([ablesung('a1', 'm1', '2024-12-31', 0), ablesung('a2', 'm1', '2025-12-31', 100), ...beiB])
  assert.deepEqual(sauber, { A: 100000, B: 100000 }, 'die Ausgangsrechnung stimmt nicht mehr')

  // Derselbe Bestand, nur mit einer korrigierten Ablesung am 30.06.: A misst 90 statt 100.
  const mitDoppelung = [
    ablesung('a1', 'm1', '2024-12-31', 0),
    ablesung('a2', 'm1', '2025-06-30', 50),
    ablesung('a3', 'm1', '2025-06-30', 60),
    ablesung('a4', 'm1', '2025-12-31', 100),
    ...beiB,
  ]
  assert.deepEqual(anteile(mitDoppelung), { A: 94737, B: 105263 }, 'die gemessene Verschiebung stimmt nicht mehr')
  // Der Vermieter trägt in beiden Fällen nichts — die Annahme des Issues war falsch.
  assert.equal(computeSettlement(snapshotFromDb(db(mitDoppelung), 2025)).landlord.totalCents, 0)
  // Und genau darüber meldet sich der Zähler.
  assert.equal(consumptionOverview(snapshotFromDb(db(mitDoppelung), 2025)).find((z) => z.meterId === 'm1')?.warnings.length, 1)
})

test('Drei Ablesungen am selben Tag: eine Meldung, nicht zwei (#69)', () => {
  // Je Paar gemeldet stünde hier zweimal wortgleich dasselbe, und das Wort „zwei“ stimmte nicht.
  const drei = readingsOf('m1', [
    { date: '2024-12-31', value: 100 },
    { date: '2025-06-30', value: 150 },
    { date: '2025-06-30', value: 160 },
    { date: '2025-06-30', value: 170 },
    { date: '2025-12-31', value: 200 },
  ])
  const { warnings } = meterSegments(drei)
  assert.equal(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /um 20,/, warnings[0])

  // Heben sich die Sprünge desselben Tages auf, fehlt nichts, und es gibt zu Recht keine Meldung.
  const hebtSichAuf = readingsOf('m1', [
    { date: '2024-12-31', value: 100 },
    { date: '2025-06-30', value: 150 },
    { date: '2025-06-30', value: 160 },
    { date: '2025-06-30', value: 150 },
    { date: '2025-12-31', value: 200 },
  ])
  assert.deepEqual(meterSegments(hebtSichAuf).warnings, [])
  assert.ok(Math.abs(consumptionInPeriod(hebtSichAuf, '2025-01-01', '2025-12-31') - 100) < 1e-9)
})

test('Zwei Ablesungen am selben Tag: kleine Unterschiede werden nicht zu null gerundet (#69)', () => {
  // Ein Wasserzähler zeigt drei Nachkommastellen. Mit zwei Stellen meldete die Warnung einen
  // „Unterschied von 0“ und widerspräche sich selbst.
  const fein = readingsOf('m1', [
    { date: '2024-12-31', value: 150.001 },
    { date: '2025-06-30', value: 150.004 },
    { date: '2025-06-30', value: 150.008 },
  ])
  const { warnings } = meterSegments(fein)
  assert.equal(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /0,004/, warnings[0])
  // Das Datum deutsch, wie in der Meldung zum Zählerwechsel (#142).
  assert.match(warnings[0], /am 30\.06\.2025/, warnings[0])
})

test('Zählerwechsel ohne Endstand des alten Geräts: Meldung statt negativem Verbrauch (#83)', () => {
  // **Gemessen minus 910 für ein Jahr, und nichts hielt das auf.** Der Endstand des alten Geräts
  // steht in `oldEndValue`. Fehlt er, las die Berechnung ihn mit `?? 0` als Null, und aus einem
  // Zählerstand von 980 wurde ein Segment von minus 980. Ein negativer Verbrauch ist nicht bloß
  // eine falsche Zahl: Beim Verbrauchsschlüssel geht er in die Verteilbasis ein und verschiebt
  // die Anteile aller Mieter.
  //
  // Die Oberfläche verlangt den Endstand, sobald der Wechsel angehakt ist. Über die
  // Schnittstelle, über eine von Hand bearbeitete Datei und über ein fremdes Backup kommt der
  // Eintrag trotzdem herein, und das Schema lässt die Spalte leer.
  const ohneEndstand = readingsOf('m1', [
    { date: '2024-12-31', value: 950 },
    { date: '2025-06-30', value: 3, replacement: true },
    { date: '2025-12-31', value: 40 },
  ])
  const { warnings, segments } = meterSegments(ohneEndstand)
  assert.equal(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /Endstand/)
  // Das Datum deutsch wie überall in der Oberfläche, nicht in ISO-Form (#142).
  assert.match(warnings[0], /am 30\.06\.2025/)
  assert.doesNotMatch(warnings[0], /2025-06-30/)

  // Der Verbrauch des alten Geräts bis zum Wechsel ist unbekannt und wird nicht erfunden; das
  // neue Gerät rechnet ganz normal weiter.
  assert.equal(segments.length, 1, JSON.stringify(segments))
  assert.ok(Math.abs(consumptionInPeriod(ohneEndstand, '2025-01-01', '2025-12-31') - 37) < 1e-9)
  // Vor allem: nichts Negatives mehr.
  assert.ok(consumptionInPeriod(ohneEndstand, '2025-01-01', '2025-12-31') >= 0)
})

test('Zählerwechsel ohne Endstand: auch das kostet einen Mieter Geld (#83)', () => {
  // **Dieselbe Mechanik wie bei #69, und sie gehört auch hier hingeschrieben.** Der fehlende
  // Verbrauch geht nicht dem Vermieter verloren: Beim Verbrauchsschlüssel ist die Verteilbasis
  // die Summe des gemessenen Verbrauchs, und der Rechnungsbetrag wird trotzdem vollständig
  // verteilt. Gemessen an zwei Wohnungen mit 2.000 € Wasser: Fehlt der Endstand bei Mieter A,
  // sinkt sein Anteil von 802,40 € auf 540,15 €, und **Mieter B zahlt 1.459,85 € statt
  // 1.197,60 €**, also 262,25 € zu viel. Der Vermieter trägt in beiden Fällen nichts.
  //
  // Die Meldung ist deshalb kein Beiwerk, sondern das Einzige, was den Vermieter darauf stößt:
  // Auf der Abrechnung selbst liest sich der Rechenweg völlig plausibel.
  const db = (readings: Reading[]): Db => ({
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG', areaM2: 100, participates: true },
      { id: 'u2', name: 'OG', areaM2: 100, participates: true },
    ],
    tenancies: [
      tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01' }),
      tenancy({ id: 't2', unitId: 'u2', tenantName: 'B', start: '2025-01-01' }),
    ],
    costItems: [{ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 200000, key: 'meter', meterType: 'kaltwasser' }],
    meters: [
      { id: 'm1', unitId: 'u1', name: 'A', type: 'kaltwasser', unit: 'm³' },
      { id: 'm2', unitId: 'u2', name: 'B', type: 'kaltwasser', unit: 'm³' },
    ],
    readings,
  })
  const ablesung = (id: string, meterId: string, date: string, value: number, mehr: Partial<Reading> = {}): Reading =>
    ({ id, meterId, date, value, ...mehr })
  const beiB = [ablesung('b1', 'm2', '2024-12-31', 0), ablesung('b2', 'm2', '2025-12-31', 100)]
  const anteile = (readings: Reading[]) =>
    Object.fromEntries(computeSettlement(snapshotFromDb(db(readings), 2025)).statements.map((st) => [st.tenantName, st.totalShareCents]))

  const mitEndstand = [
    ablesung('a1', 'm1', '2024-12-31', 950),
    ablesung('a2', 'm1', '2025-06-30', 3, { replacement: true, oldEndValue: 980 }),
    ablesung('a3', 'm1', '2025-12-31', 40),
    ...beiB,
  ]
  assert.deepEqual(anteile(mitEndstand), { A: 80240, B: 119760 }, 'die Ausgangsrechnung stimmt nicht mehr')

  const ohneEndstand = [
    ablesung('a1', 'm1', '2024-12-31', 950),
    ablesung('a2', 'm1', '2025-06-30', 3, { replacement: true }),
    ablesung('a3', 'm1', '2025-12-31', 40),
    ...beiB,
  ]
  assert.deepEqual(anteile(ohneEndstand), { A: 54015, B: 145985 }, 'die gemessene Verschiebung stimmt nicht mehr')
  assert.equal(computeSettlement(snapshotFromDb(db(ohneEndstand), 2025)).landlord.totalCents, 0)
  // Und genau darüber meldet sich der Zähler.
  assert.equal(consumptionOverview(snapshotFromDb(db(ohneEndstand), 2025)).find((z) => z.meterId === 'm1')?.warnings.length, 1)
})

test('Zählerwechsel ohne Endstand am selben Tag: diese Meldung gilt, nicht die über zwei Ablesungen (#83)', () => {
  // **Die Reihenfolge der beiden Prüfungen ist eine Entscheidung und muss gehalten werden.**
  // Gewänne die Prüfung auf den gleichen Tag (#69), entstünde aus dem fehlenden Feld ein
  // `delta` von minus 950, und der Vermieter läse „Die Stände unterscheiden sich um 950“ — eine
  // Zahl, die aus nichts errechnet ist. Genau davor soll die Behebung schützen, und ohne diesen
  // Test bleibt die Reihenfolge unbewacht: nachgemessen blieben bei umgedrehter Reihenfolge
  // alle Tests grün.
  const selberTag = readingsOf('m1', [
    { date: '2025-06-30', value: 950 },
    { date: '2025-06-30', value: 3, replacement: true },
    { date: '2025-12-31', value: 40 },
  ])
  const { warnings } = meterSegments(selberTag)
  assert.equal(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /Endstand/)
  assert.doesNotMatch(warnings[0], /Mehrere Ablesungen/)
})

test('Zählerwechsel: ein Endstand von 0 ist etwas anderes als keiner (#83)', () => {
  // **Das `?? 0` warf beide Fälle zusammen, und das war der Kern des Fehlers.** Ein ausdrücklich
  // eingetragener Endstand von 0 ist eine Angabe: Der alte Zähler stand auf null, lief also
  // rückwärts, und dafür gibt es die Meldung über negativen Verbrauch. Ein fehlendes Feld ist
  // keine Angabe. Gefragt wird deshalb nach `null` und nicht nach dem Wert.
  const endstandNull = readingsOf('m1', [
    { date: '2024-12-31', value: 950 },
    { date: '2025-06-30', value: 3, replacement: true, oldEndValue: 0 },
    { date: '2025-12-31', value: 40 },
  ])
  const { warnings } = meterSegments(endstandNull)
  assert.equal(warnings.length, 1, warnings.join(' | '))
  assert.match(warnings[0], /Negativer Verbrauch/)
  assert.doesNotMatch(warnings[0], /Endstand des alten/)
  assert.match(warnings[0], /zwischen dem 31\.12\.2024 und dem 30\.06\.2025/, warnings[0])
})

test('Verbrauchsschlüssel: Verteilung nach Wohnungszählern', () => {
  const db = makeDb()
  db.meters = [
    { id: 'm2', unitId: 'u2', type: 'kaltwasser', name: 'WZ OG links', unit: 'm³' },
    { id: 'm3', unitId: 'u3', type: 'kaltwasser', name: 'WZ OG rechts', unit: 'm³' },
  ]
  db.readings = [
    { id: 'r1', meterId: 'm2', date: '2024-12-31', value: 0 },
    { id: 'r2', meterId: 'm2', date: '2025-12-31', value: 60 },
    { id: 'r3', meterId: 'm3', date: '2024-12-31', value: 0 },
    { id: 'r4', meterId: 'm3', date: '2025-12-31', value: 40 },
  ]
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 60000)
  assert.equal(statementOf(s, 't3').totalShareCents, 40000)
  assert.equal(s.landlord.totalCents, 0)
})

test('Verbrauchsschlüssel ohne Ablesungen: Warnung, Betrag an Vermieter', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 50000, key: 'meter', meterType: 'kaltwasser' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 50000)
  assert.equal(s.warnings.length, 1)
})

test('§35a: Lohnanteil wird anteilig je Mieter ausgewiesen', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 60000, key: 'units', labor35aCents: 30000 })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  const a = statementOf(s, 't2')
  assert.equal(a.totalShareCents, 30000) // halbe Kosten (2 Einheiten)
  assert.equal(a.total35aCents, 15000) // halber Lohnanteil
})

// §35a-Lohnanteil mit Restverfahren. Die Mieter bekommen zusammen den Lohnanteil, der auf ihre
// gebuchten Kostenanteile entfällt — kaufmännisch auf den Cent gerundet, nie mehr als der
// Lohnanteil der Rechnung. Gerechnet wird mit dem **ungerundeten** Kostenanteil (#180): Wer 70/220
// der Rechnung trägt, trägt auch 70/220 des Lohnanteils, so wie man es von Hand nachrechnet. Diese
// Summe wird wie die Kosten nach dem größten Rest verteilt, Gleichstand entscheidet die ID des
// Mietverhältnisses.
//
// Handrechnung zum folgenden Test (Gartenpflege, Flächenschlüssel):
//    1. Rechnungsbetrag                          30.000 ct
//    2. Lohnanteil                               10.000 ct
//    3. Kostenanteil je Mietverhältnis           30.000 × 70/220 = 9.545,45 → 9.545 ct (t1 und t2)
//                                                (EG mit 80 m² ist selbstgenutzt, sein Teil bleibt
//                                                beim Vermieter: 30.000 − 2 × 9.545 = 10.910 ct)
//    4. Mieter-Lohn gesamt, exakt                10.000 × 140/220 = 6.363,64 ct
//    5. … kaufmännisch gerundet                  6.364 ct (≤ 10.000 ct Lohnanteil)
//    6. exakter Anteil je Mietverhältnis         10.000 × 70/220 = 3.181,82 ct (t1 und t2)
//    7. ganze Cent vor der Restverteilung        3.181 + 3.181 = 6.362 ct → 2 Rest-Cent
//    8. §35a je Mietverhältnis                   t1 = 3.182 ct, t2 = 3.182 ct, Summe 6.364 ct,
//                                                wie von Hand: 100,00 € × 70/220 = 31,82 €
// Bis #180 ging die Rechnung vom gerundeten Kostenanteil aus (10.000 × 9.545/30.000 = 3.181,67 ct,
// Summe 6.363 ct), und t2 bekam 31,81 € bescheinigt, einen Cent unter der Handrechnung. Davor wurde
// je Zeile gerundet, was mehr bescheinigen konnte, als die Rechnung enthält.
test('§35a: Mieter-Lohnanteil kaufmännisch gerundet, Rest-Cent nach Restverfahren (Handrechnung)', () => {
  const make = (order: number[]): Db => ({
    ...emptyDb(),
    units: [
      { id: 'u0', name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 },
      { id: 'u1', name: 'OG links', areaM2: 70, participates: true },
      { id: 'u2', name: 'OG rechts', areaM2: 70, participates: true },
    ],
    tenancies: order.map((n) => tenancy({ id: `t${n}`, unitId: `u${n}`, tenantName: `Mieter ${n}`, persons: 2 })),
    costItems: [{ id: 'c1', year: 2025, category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 30000, key: 'area', labor35aCents: 10000 }],
  })
  for (const order of [[1, 2], [2, 1]]) {
    const s = computeSettlement(snapshotFromDb(make(order), 2025))
    const st = (id: string) => statementOf(s, id)
    assert.equal(st('t1').totalShareCents, 9545)
    assert.equal(st('t2').totalShareCents, 9545)
    assert.equal(st('t1').total35aCents, 3182, `Reihenfolge ${order.join(', ')}`)
    assert.equal(st('t2').total35aCents, 3182, `Reihenfolge ${order.join(', ')}`)
  }
})

test('§35a (#180): der Lohnanteil folgt dem ungerundeten Kostenanteil, nicht dem auf Cent gerundeten', () => {
  // 1.000 € Hausmeister mit 300 € Lohnanteil, Einzug am 07.11.2025, also 55 von 365 Tagen.
  // Kostenanteil 1.000 € × 55/365 = 150,684… € → 150,68 €. Lohnanteil von Hand: 300 € × 55/365 =
  // 45,205… € → 45,21 €. Aus dem gerundeten Kostenanteil gerechnet kamen 45,20 € heraus.
  const db: Db = {
    ...emptyDb(),
    units: [{ id: 'u1', name: 'W1', areaM2: 60, participates: true }],
    tenancies: [tenancy({ id: 't1', unitId: 'u1', tenantName: 'M1', persons: 1, start: '2025-11-07' })],
    costItems: [{ id: 'c1', year: 2025, category: 'Hauswart', description: 'Hausmeister', amountCents: 100000, key: 'area', labor35aCents: 30000 }],
  }
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't1').totalShareCents, 15068, 'der Kostenanteil bleibt')
  assert.equal(statementOf(s, 't1').total35aCents, 4521)
})

test('§35a (Durchsicht von #196): der Lohnanteil eines Mieters liegt nie über seinem Kostenanteil', () => {
  // 500 € Hausmeister, ganz Lohn. OG 70 m² und DG 55 m² vermietet, EG 80 m² selbstgenutzt; im DG
  // wohnt t2 erst ab 10.03.2025. Kostenanteil t2: 500 € × 55/205 × 297/365 = 109,154… € → 109,15 €.
  // Lohnanteil von Hand derselbe Betrag, denn die Rechnung ist ganz Lohn: 109,15 €. Die erste
  // Fassung von #180 bescheinigte 109,16 €, einen Cent mehr, als t2 überhaupt bezahlt.
  const db: Db = {
    ...emptyDb(),
    units: [
      { id: 'og', name: 'OG', areaM2: 70, participates: true },
      { id: 'dg', name: 'DG', areaM2: 55, participates: true },
      { id: 'eg', name: 'EG', areaM2: 80, participates: false, selfUsed: true, selfPersons: 2 },
    ],
    tenancies: [
      tenancy({ id: 't1', unitId: 'og', tenantName: 'M1', persons: 1, start: '2024-01-01' }),
      tenancy({ id: 't2', unitId: 'dg', tenantName: 'M2', persons: 1, start: '2025-03-10' }),
    ],
    costItems: [{ id: 'c1', year: 2025, category: 'Hauswart', description: 'Hausmeister', amountCents: 50000, key: 'area', labor35aCents: 50000 }],
  }
  const s = computeSettlement(snapshotFromDb(db, 2025))
  for (const st of s.statements) {
    for (const r of st.rows) assert.ok((r.labor35aCents ?? 0) <= r.shareCents, `${st.tenancyId}: Lohn ${r.labor35aCents} > Anteil ${r.shareCents}`)
  }
  assert.equal(statementOf(s, 't2').totalShareCents, 10915)
  assert.equal(statementOf(s, 't2').total35aCents, 10915)
  assert.equal(statementOf(s, 't1').total35aCents, statementOf(s, 't1').totalShareCents, 'ganz Lohn: Lohnanteil = Kostenanteil')
})

test('§35a: tragen die Mieter die Rechnung ganz, ergibt ihr Lohnanteil genau den der Rechnung', () => {
  // 300 € mit 200 € Lohnanteil auf drei gleiche Wohnungen: je 66,67 € einzeln gerundet wären 200,01 €
  const db: Db = {
    ...emptyDb(),
    units: [1, 2, 3].map((n) => ({ id: `u${n}`, name: `W${n}`, areaM2: 60, participates: true })),
    tenancies: [1, 2, 3].map((n) => tenancy({ id: `t${n}`, unitId: `u${n}`, tenantName: `M${n}`, persons: 1 })),
    costItems: [{ id: 'c1', year: 2025, category: 'Gartenpflege', description: 'Garten', amountCents: 30000, key: 'area', labor35aCents: 20000 }],
  }
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.deepEqual(s.statements.map((x) => [x.tenancyId, x.total35aCents]), [['t1', 6667], ['t2', 6667], ['t3', 6666]])
})

test('§35a: ungültiger Lohnanteil (negativ oder über dem Rechnungsbetrag) wird nicht bescheinigt, sondern gemeldet', () => {
  for (const labor of [-3000, 70000]) {
    const db = makeDb()
    db.costItems.push({ id: 'c1', year: 2025, category: 'Gartenpflege', description: 'Garten', amountCents: 60000, key: 'units', labor35aCents: labor })
    const s = computeSettlement(snapshotFromDb(db, 2025))
    assert.deepEqual(s.statements.map((x) => x.total35aCents), [0, 0], `Lohnanteil ${labor}`)
    assert.equal(statementOf(s, 't2').totalShareCents, 30000) // Kosten bleiben unberührt
    assert.deepEqual(s.warnings, ['„Garten“: der §35a-Lohnanteil muss zwischen 0 und dem Rechnungsbetrag liegen — es wird kein Lohnanteil bescheinigt.'])
  }
})

test('§35a: eine Position ohne Lohnanteil löst keine §35a-Meldung aus, auch mit negativem Betrag', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Gutschrift', amountCents: -5000, key: 'units' })
  assert.deepEqual(computeSettlement(snapshotFromDb(db, 2025)).warnings, [])
})

test('§35a bei einer Gutschrift (#139): ein Lohnanteil wird nicht bescheinigt, sondern gemeldet', () => {
  // Das Kostenformular lehnt ihn ab; hereinkommen kann er noch über die API. Dann bescheinigt die
  // Berechnung nichts und sagt es, statt den Lohnanteil gegen den negativen Betrag zu verteilen.
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Gartenpflege', description: 'Gutschrift Garten', amountCents: -5400, key: 'units', labor35aCents: 1000 })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.deepEqual(s.statements.map((x) => x.total35aCents), [0, 0])
  assert.deepEqual(s.warnings, ['„Gutschrift Garten“: der §35a-Lohnanteil muss zwischen 0 und dem Rechnungsbetrag liegen — es wird kein Lohnanteil bescheinigt.'])
})

test('Vorschlag neue Vorauszahlung: ein Zwölftel, auf volle Euro gerundet', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 290050, key: 'units' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  const a = statementOf(s, 't2')
  // 1450,25 € / 12 = 120,85 € → 121 €
  assert.equal(a.suggestedMonthlyCents, 12100)
})

// #134: Die Kosten fallen künftig für zwölf Monate an. Wer erst im Jahr einzog, hat einen Anteil
// für weniger Tage; ein Zwölftel davon wäre zu wenig und führte im Folgejahr zur Nachzahlung.
const teiljahr = (start: string, end: string | null): Db => ({
  ...emptyDb(),
  units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }],
  tenancies: [tenancy({ id: 't', unitId: 'a', tenantName: 'M', start, end, personHistory: [{ from: start, persons: 1 }] })],
  // 2025 hat 365 Tage, ab 01.03. sind es 306; ein Anteil von 730,56 € wie im Issue entsteht aus
  // 871,42 € × 306/365 (Flächenschlüssel, einzige Wohnung, also Tagesanteil).
  costItems: [{ id: 'c', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 87142, key: 'area' }],
})

test('Vorschlag neue Vorauszahlung bei Einzug im Jahr: auf das volle Jahr hochgerechnet', () => {
  const st = statementOf(computeSettlement(snapshotFromDb(teiljahr('2025-03-01', null), 2025)), 't')
  assert.equal(st.totalShareCents, 73056)
  // 730,56 € × 365/306 / 12 = 72,62 € → 73 €, nicht 61 €
  assert.equal(st.suggestedMonthlyCents, 7300)
})

test('Vorschlag neue Vorauszahlung: nie negativ, auch wenn Gutschriften überwiegen (Integrationsdurchsicht)', () => {
  const db = teiljahr('2020-01-01', null)
  db.costItems = [{ id: 'g', year: 2025, category: 'Grundsteuer', description: 'Erstattung', amountCents: -60000, key: 'area' }]
  const st = statementOf(computeSettlement(snapshotFromDb(db, 2025)), 't')
  assert.equal(st.totalShareCents, -60000)
  assert.equal(st.suggestedMonthlyCents, 0)
})

test('Vorschlag neue Vorauszahlung bei Auszug im Jahr: keiner', () => {
  const st = statementOf(computeSettlement(snapshotFromDb(teiljahr('2020-01-01', '2025-08-31'), 2025)), 't')
  assert.ok(st.totalShareCents > 0)
  assert.equal(st.suggestedMonthlyCents, 0)
})

test('Vorschlag neue Vorauszahlung bei Auszug zum 31.12.: keiner, es gibt keine künftige Vorauszahlung', () => {
  const st = statementOf(computeSettlement(snapshotFromDb(teiljahr('2020-01-01', '2025-12-31'), 2025)), 't')
  assert.ok(st.totalShareCents > 0)
  assert.equal(st.suggestedMonthlyCents, 0)
})

test('Mietkonto: Soll = Kaltmiete + Vorauszahlung, Zahlungen füllen Monate der Reihe nach', () => {
  const db: Db = {
    ...emptyDb(),
    units: [{ id: 'u1', name: 'OG links', areaM2: 90, participates: true }],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', tenantName: 'Familie A', start: '2025-01-01',
        personHistory: [{ from: '2025-01-01', persons: 2 }],
        baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
        prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
      }),
    ],
    payments: [
      // 3,5 Monatsmieten = 350.000 ct → Jan–Mär voll, Apr teilweise
      { id: 'p1', tenancyId: 't1', date: '2025-01-05', amountCents: 100000 },
      { id: 'p2', tenancyId: 't1', date: '2025-02-05', amountCents: 100000 },
      { id: 'p3', tenancyId: 't1', date: '2025-03-05', amountCents: 100000 },
      { id: 'p4', tenancyId: 't1', date: '2025-04-05', amountCents: 50000 },
    ],
  }
  const l = rentLedger(snapshotFromDb(db, 2025))
  const r = l.rows[0]
  assert.equal(r.months[0].sollCents, 100000) // 800 + 200 €
  assert.equal(r.sollYearCents, 1200000) // 12 × 1000 €
  assert.equal(r.baseRentYearCents, 960000)
  assert.equal(r.prepaymentYearCents, 240000)
  assert.equal(r.paidYearCents, 350000)
  assert.equal(r.months[0].status, 'paid')
  assert.equal(r.months[2].status, 'paid')
  assert.equal(r.months[3].status, 'partial')
  assert.equal(r.months[3].paidCents, 50000)
  assert.equal(r.months[4].status, 'open')
  assert.equal(r.balanceCents, -850000) // 3.500 − 12.000 €
  assert.equal(l.totals.openCents, 850000)
})

test('Mietkonto: Teiljahr — vor Einzug kein Soll, Monat gilt als gedeckt', () => {
  const db: Db = {
    ...emptyDb(),
    units: [{ id: 'u1', name: 'OG', areaM2: 90, participates: true }],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', tenantName: 'B', start: '2025-07-01',
        personHistory: [{ from: '2025-07-01', persons: 1 }],
        baseRents: [{ from: '2025-07', monthlyCents: 50000 }],
      }),
    ],
  }
  const l = rentLedger(snapshotFromDb(db, 2025))
  const r = l.rows[0]
  assert.equal(r.months[0].sollCents, 0) // Januar vor Einzug
  assert.equal(r.months[0].status, 'paid') // kein Soll → gedeckt
  assert.equal(r.months[6].sollCents, 50000) // Juli
  assert.equal(r.sollYearCents, 300000) // 6 × 500 €
  assert.equal(r.openMonths, 6) // Juli–Dez unbezahlt
})

// ---------- Eigennutzung in der Verteilbasis ----------
// `selfUsed: true` heißt: die Wohnung zählt in die Verteilbasis (Fläche/Einheiten/Personen),
// hat aber kein Mietverhältnis — ihr Anteil landet deshalb im Vermieteranteil (Eigenanteil).

test('Eigennutzung: Flächenschlüssel nimmt die eigene Wohnung in die Basis, der Anteil bleibt beim Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  // 2.300 € auf 230 m² (80 + 90 + 60) = 10 €/m²
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 90000)
  assert.equal(statementOf(s, 't3').totalShareCents, 60000)
  assert.equal(s.landlord.totalCents, 80000) // 80 m² Eigenanteil
})

test('Eigennutzung: Einheitenschlüssel teilt durch drei, ein Drittel trägt der Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.costItems.push({ id: 'c1', year: 2025, category: 'Müllabfuhr', description: 'Müll', amountCents: 300000, key: 'units' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 100000)
  assert.equal(statementOf(s, 't3').totalShareCents, 100000)
  assert.equal(s.landlord.totalCents, 100000)
})

test('Eigennutzung: Personenschlüssel zählt die eigenen Personen mit', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.units[0].selfPersons = 3
  // Personentage-Basis: (4 + 3 Mieter + 3 eigene) × 365
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'persons' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 40000)
  assert.equal(statementOf(s, 't3').totalShareCents, 30000)
  assert.equal(s.landlord.totalCents, 30000)
})

test('Eigennutzung ohne Personenzahl: Warnung beim Personenschlüssel', () => {
  const db = makeDb()
  db.units[0].selfUsed = true // selfPersons fehlt
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'persons' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0], /Personenzahl/)
  // ohne Personenzahl bleibt die Verteilung wie zuvor (nur Mieter)
  assert.equal(s.landlord.totalCents, 0)
})

test('Eigennutzung und Leerstand werden im Vermieteranteil getrennt ausgewiesen', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.tenancies[1].end = '2025-03-31' // die zweite vermietete Wohnung steht ab April leer
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.selfUsedShareCents, 80000) // 80 von 230 m², ganzjährig
  assert.ok(s.landlord.totalCents > s.selfUsedShareCents) // zusätzlich der Leerstand
})

test('Ohne Eigennutzungs-Kennzeichen bleibt die Verteilung wie bisher (Bestandsdaten)', () => {
  const db = makeDb() // units[0]: participates false, selfUsed nicht gesetzt
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  // Basis bleiben die 150 m² der vermieteten Wohnungen
  assert.equal(statementOf(s, 't2').totalShareCents, 138000)
  assert.equal(s.landlord.totalCents, 0)
})

test('Zählerschlüssel: Verbrauch einer nicht beteiligten Wohnung bleibt in der Basis', () => {
  // Ein Zählerstand belegt Verbrauch innerhalb der abgerechneten Menge — er zählt
  // deshalb unabhängig vom Beteiligungs-Kennzeichen in die Basis (Anteil → Vermieter).
  const db = makeDb()
  db.meters = [
    { id: 'm1', unitId: 'u1', type: 'kaltwasser', name: 'WZ EG', unit: 'm³' },
    { id: 'm2', unitId: 'u2', type: 'kaltwasser', name: 'WZ OG links', unit: 'm³' },
  ]
  db.readings = [
    { id: 'r1', meterId: 'm1', date: '2024-12-31', value: 0 },
    { id: 'r2', meterId: 'm1', date: '2025-12-31', value: 40 },
    { id: 'r3', meterId: 'm2', date: '2024-12-31', value: 0 },
    { id: 'r4', meterId: 'm2', date: '2025-12-31', value: 60 },
  ]
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 60000)
  assert.equal(s.landlord.totalCents, 40000)
})

test('Direktzuordnung an eine nicht vermietete Wohnung bleibt vollständig beim Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  // Die Wohnung war bis Ende März vermietet und wird danach selbst genutzt
  db.tenancies.push(tenancy({ id: 't1', unitId: 'u1', tenantName: 'Vormieter', persons: 2, end: '2025-03-31' }))
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Direkt', amountCents: 100000, key: 'direct', directUnitId: 'u1' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.statements.reduce((a, x) => a + x.totalShareCents, 0), 0) // die Wohnung ist nicht beteiligt
  assert.equal(s.landlord.totalCents, 100000) // kein Cent darf unterwegs verschwinden
  assert.equal(s.selfUsedShareCents, 100000)
})

test('Direktzuordnung auf eine gelöschte Wohnung: Warnung, Betrag beim Vermieter', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Verwaist', amountCents: 40000, key: 'direct', directUnitId: 'weg' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 40000)
  assert.equal(s.warnings.length, 1)
})

test('Eine Wohnung, die vermietet und als Eigennutzung markiert ist, gilt als vermietet', () => {
  const db = makeDb()
  db.units[1].selfUsed = true // widersprüchliche Kennzeichen
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 150000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 90000)
  assert.equal(s.selfUsedShareCents, 0) // kein Eigenanteil an einer vermieteten Wohnung
})

test('Negative Personenzahl der eigenen Wohnung zählt wie „nicht hinterlegt“', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.units[0].selfPersons = -5 // aus einem von Hand bearbeiteten Datenbestand
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'persons' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.statements.reduce((a, x) => a + x.totalShareCents, 0), 100000)
  assert.equal(s.landlord.totalCents, 0) // keine negative Verteilbasis, kein negativer Anteil
  assert.equal(s.warnings.length, 1)
})

test('Eigennutzung ohne Wohnfläche: Warnung beim Flächenschlüssel', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.units[0].areaM2 = 0 // Wohnfläche noch nicht erfasst
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0], /Wohnfläche/)
})

// ---------- Vereinbarter Prozentschlüssel ----------

test('Prozentschlüssel: vereinbarte Anteile, der Rest trägt der Vermieter', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Hausmeister',
    amountCents: 100000, key: 'custom', customShares: { u2: 60, u3: 30 },
  })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 60000)
  assert.equal(statementOf(s, 't3').totalShareCents, 30000)
  assert.equal(s.landlord.totalCents, 10000) // vereinbarter Eigenanteil
})

test('Prozentschlüssel: 100 % werden centgenau verteilt', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Krumme Summe',
    amountCents: 100001, key: 'custom', customShares: { u2: 33.33, u3: 66.67 },
  })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  const a = statementOf(s, 't2')
  const b = statementOf(s, 't3')
  assert.equal(a.totalShareCents + b.totalShareCents, 100001)
  assert.equal(s.landlord.totalCents, 0)
})

test('Prozentschlüssel: Teiljahr wird tagesanteilig gekürzt', () => {
  const db = makeDb()
  db.tenancies[1].end = '2025-03-31' // Familie B zieht Ende März aus
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Wartung',
    amountCents: 100000, key: 'custom', customShares: { u2: 50, u3: 50 },
  })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 50000)
  assert.equal(statementOf(s, 't3').totalShareCents, Math.round(50000 * (90 / 365)))
  assert.equal(
    s.statements.reduce((a, x) => a + x.totalShareCents, 0) + s.landlord.totalCents,
    100000,
  )
})

test('Prozentschlüssel über 100 %: Warnung, keine Verteilung', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Zu viel',
    amountCents: 100000, key: 'custom', customShares: { u2: 60, u3: 60 },
  })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  // Niemals mehr verteilen als die Rechnung hergibt — sonst wären auch die §35a-Anteile zu hoch
  assert.equal(s.statements.reduce((a, x) => a + x.totalShareCents, 0), 0)
  assert.equal(s.landlord.totalCents, 100000)
  assert.match(s.warnings[0], /100/)
})

test('Prozentschlüssel mit gelöschter Wohnung: Warnung, verfallener Anteil beim Vermieter', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Verwaist',
    amountCents: 100000, key: 'custom', customShares: { u2: 50, weg: 30 },
  })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 50000)
  assert.equal(s.landlord.totalCents, 50000)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0], /gelöschte Wohnung/)
})

test('Prozentschlüssel: Anteil einer nicht beteiligten Wohnung wird beim Namen genannt', () => {
  // Die Wohnung existiert, gehört aber nicht zur Abrechnungseinheit — die Warnung darf sie
  // nicht als gelöscht bezeichnen, sonst sucht man an der falschen Stelle.
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Vereinbart',
    amountCents: 100000, key: 'custom', customShares: { u1: 30, u2: 70 },
  })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.match(s.warnings[0], /EG \(Eigennutzung\)/)
  assert.doesNotMatch(s.warnings[0], /gelöscht/)
})

test('Prozentschlüssel ohne Anteile: Warnung, Betrag an den Vermieter', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Ohne Anteile',
    amountCents: 50000, key: 'custom',
  })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 50000)
  assert.equal(s.warnings.length, 1)
})

// Fehlende Verteilbasis. Fehlt der Basiswert einer Wohnung (Fläche, Personen), verteilt der
// Schlüssel deren Anteil still auf die übrigen Wohnungen — die anderen Mieter zahlen mit.
// Fehlt er überall, geht der Betrag an den Vermieter. Beides soll gemeldet werden, und zwar
// nur dann, wenn sich etwas beheben lässt: Leerstand und Eigennutzung sind reguläre Fälle.
// Das Formular erzwingt Fläche > 0 und mindestens eine Person; fehlende Werte stammen aus
// Altbeständen oder von Hand bearbeiteten Daten.

test('Flächenschlüssel ohne jede Wohnfläche: eine Meldung je Position, Betrag beim Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  for (const u of db.units) dropArea(u)
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  // Nicht umlagefähige Kosten landen ohnehin beim Vermieter — dort ist das keine Meldung wert
  db.costItems.push({ id: 'c2', year: 2025, category: 'Nicht umlagefähig', description: 'Dachreparatur', amountCents: 50000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 140000)
  // Keine zusätzliche Meldung zur Eigennutzung („verteilt nur auf die Mieter“) — verteilt wird nichts
  assert.deepEqual(s.warnings, ['„Grundsteuer“: für keine Wohnung ist eine Wohnfläche hinterlegt — Betrag geht an den Vermieter.'])
})

test('Personenschlüssel ohne jede Personenzahl: eine Meldung je Position, Betrag beim Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true // ohne selfPersons
  for (const t of db.tenancies) t.persons = 0
  db.costItems.push({ id: 'c1', year: 2025, category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'persons' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 30000)
  assert.deepEqual(s.warnings, ['„Müll“: für die vermieteten Wohnungen sind keine Personen hinterlegt — Betrag geht an den Vermieter.'])
})

test('Einheitenschlüssel ohne Wohnung in der Abrechnungseinheit: Meldung, Betrag beim Vermieter', () => {
  const db = makeDb()
  for (const u of db.units) u.participates = false
  db.costItems.push({ id: 'c1', year: 2025, category: 'Hauswart', description: 'Hauswart', amountCents: 24000, key: 'units' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 24000)
  assert.deepEqual(s.warnings, ['„Hauswart“: keine Wohnung gehört zur Abrechnungseinheit — Betrag geht an den Vermieter.'])
})

test('Vermietete Wohnung ohne Wohnfläche: Meldung nennt die Wohnung, einmal im Jahr', () => {
  const db = makeDb()
  db.units[2].areaM2 = 0 // OG rechts
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  db.costItems.push({ id: 'c2', year: 2025, category: 'Versicherung', description: 'Gebäudeversicherung', amountCents: 60000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  // So rechnet es heute: OG links trägt alles — genau das muss auffallen
  assert.equal(statementOf(s, 't2').totalShareCents, 150000)
  assert.deepEqual(s.warnings, ['Für die Einheit OG rechts ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.'])
  // Durchsicht zu #135: Wohnt dort jemand, ist 0 m² eine vergessene Fläche und keine Garage.
  assert.deepEqual(s.notices.map((n) => [n.code, n.level]), [['basis.unit-no-area', 'warning']])
})

test('Vermietete Wohnungen ohne Fläche, Eigennutzung mit Fläche: Meldung nennt die vermieteten Wohnungen', () => {
  const db = makeDb()
  db.units[0].selfUsed = true // EG, 80 m²
  db.units[1].areaM2 = 0
  db.units[2].areaM2 = 0
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 90000)
  assert.deepEqual(s.warnings, ['Für die Einheiten OG links und OG rechts ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.'])
})

test('Leerstehende Wohnung ohne Fläche: Meldung, sonst tragen die Mieter ihren Anteil mit', () => {
  const db = makeDb()
  const dg: Unit = { id: 'u4', name: 'DG', areaM2: 0, participates: true }
  dropArea(dg) // in der Datei steht areaM2 gar nicht, und es gibt kein Mietverhältnis
  db.units.push(dg)
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 0)
  // Ohne jedes Mietverhältnis ist 0 m² keine Angabe, sonst wanderte der Anteil des Leerstands still
  // zu den Mietern; eine leere Garage warnt dann eben, das ist der billigere Irrtum (#135).
  assert.deepEqual(s.notices.map((n) => [n.code, n.level]), [['basis.unit-no-area', 'warning']])
  assert.deepEqual(s.warnings, ['Für die Einheit DG ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.'])
})

test('Fehlt das Feld areaM2 bei einer vermieteten Wohnung ganz: keine Ausnahme, sondern eine Meldung', () => {
  const db = makeDb()
  dropArea(db.units[2])
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't3').totalShareCents, 0)
  assert.deepEqual(s.warnings, ['Für die Einheit OG rechts ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.'])
})

test('Mietverhältnis ohne Personen: Meldung nennt Mieter und Wohnung', () => {
  const db = makeDb()
  db.tenancies[1].persons = 0 // Familie B, OG rechts
  db.costItems.push({ id: 'c1', year: 2025, category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'persons' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(statementOf(s, 't2').totalShareCents, 30000)
  assert.deepEqual(s.warnings, ['Für Familie B (OG rechts) ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt deren Anteil auf die übrigen Wohnungen.'])
  assert.deepEqual(s.notices.map((n) => [n.code, n.level]), [['basis.tenancy-no-persons', 'warning']])
})

test('Direktzuordnung auf eine ganzjährig leerstehende Wohnung: regulärer Fall, keine Meldung', () => {
  const db = makeDb()
  db.units.push({ id: 'u4', name: 'DG', areaM2: 50, participates: true })
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Rauchmelder DG', amountCents: 8000, key: 'direct', directUnitId: 'u4' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 8000)
  assert.deepEqual(s.warnings, [])
})

test('Direktzuordnung auf eine Wohnung außerhalb der Abrechnungseinheit: Meldung, Betrag beim Vermieter', () => {
  const db = makeDb() // u1 ist weder vermietet noch als Eigennutzung gekennzeichnet
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Rauchmelder EG', amountCents: 8000, key: 'direct', directUnitId: 'u1' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 8000)
  assert.deepEqual(s.warnings, ['„Rauchmelder EG“: die direkt zugeordnete Wohnung EG (Eigennutzung) gehört nicht zur Abrechnungseinheit — Betrag geht an den Vermieter.'])
})

test('Direktzuordnung auf die selbstgenutzte Wohnung: Eigenanteil, keine Meldung', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Rauchmelder EG', amountCents: 8000, key: 'direct', directUnitId: 'u1' })
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 8000)
  assert.equal(s.selfUsedShareCents, 8000)
  assert.deepEqual(s.warnings, [])
})

test('Leerstand im ganzen Haus ist keine fehlende Verteilbasis: keine Meldung', () => {
  const db = makeDb()
  db.tenancies = []
  // Ohne Mietverhältnis gibt es auch keine Personentage — das ist Leerstand, kein Datenmangel
  const keys: LegacyCostKey[] = ['area', 'units', 'persons']
  for (const key of keys) {
    db.costItems.push({ id: key, year: 2025, category: 'Grundsteuer', description: key, amountCents: 90000, key })
  }
  const s = computeSettlement(snapshotFromDb(db, 2025))
  assert.equal(s.landlord.totalCents, 270000)
  assert.deepEqual(s.warnings, [])
})

test('Steuer (Anlage V): Einnahmen aus Mietkonto, Werbungskosten nach Gruppen, Überschuss', () => {
  const db: Db = {
    ...emptyDb(),
    units: [
      // Das Kennzeichen stand hier nicht, obwohl der Name es sagt. Solange die Übersicht
      // zweiwertig fragte, fiel das nicht auf — genau der Befund aus #68.
      { id: 'u1', name: 'EG (Eigennutzung)', areaM2: 100, participates: false, selfUsed: true, selfPersons: 2 },
      { id: 'u2', name: 'OG', areaM2: 100, participates: true },
    ],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u2', tenantName: 'A', start: '2025-01-01',
        personHistory: [{ from: '2025-01-01', persons: 2 }],
        baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
        prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
      }),
    ],
    payments: [
      // nur 11 von 12 Monaten gezahlt → Soll 1.200.000, Ist 1.100.000
      { id: 'p1', tenancyId: 't1', date: '2025-01-05', amountCents: 1100000 },
    ],
    costItems: [
      { id: 'c1', year: 2025, category: 'Grundsteuer', description: 'GS', amountCents: 50000, key: 'units' },
      { id: 'c2', year: 2025, category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'persons' },
      { id: 'c3', year: 2025, category: 'Gartenpflege', description: 'Garten', amountCents: 20000, key: 'units', labor35aCents: 12000 },
      { id: 'c4', year: 2024, category: 'Grundsteuer', description: 'Vorjahr', amountCents: 99999, key: 'units' },
    ],
  }
  const r = taxReport(snapshotFromDb(db, 2025))
  assert.equal(r.income.baseRentSollCents, 960000) // 12 × 800 €
  assert.equal(r.income.prepaymentSollCents, 240000) // 12 × 200 €
  assert.equal(r.income.sollCents, 1200000)
  assert.equal(r.income.paidCents, 1100000)
  // Werbungskosten: nur 2025, gruppiert
  assert.equal(r.expenses.totalCents, 100000) // 500 + 300 + 200 €
  assert.equal(r.expenses.labor35aCents, 12000)
  assert.equal(groupOf(r, 'Grundsteuer & öffentliche Abgaben').amountCents, 50000)
  assert.equal(groupOf(r, 'Laufende Betriebskosten').amountCents, 50000) // Müll + Garten
  // Überschuss aus dem abziehbaren Teil (#163): Die eigene Wohnung trägt laut Abrechnung die
  // Hälfte jeder Position (1 von 2 Einheiten, 2 von 4 Personen), privat sind also 500 €.
  assert.equal(r.expenses.privateCents, 50000)
  assert.equal(r.expenses.deductibleCents, 50000)
  assert.equal(r.surplusSollCents, 1150000) // 1.200.000 − 50.000
  assert.equal(r.surplusPaidCents, 1050000) // 1.100.000 − 50.000
  // gemischte Nutzung: die halbe Fläche ist selbstgenutzt und damit privat
  assert.equal(r.selfOccupiedExists, true)
  assert.equal(r.selfUsedAreaM2, 100)
  assert.equal(r.totalAreaM2, 200)
  assert.equal(r.excludedExists, false)
})

test('Steuer (Anlage V): eine ausgenommene Wohnung ist keine Eigennutzung (#68)', () => {
  // **Die Steuerübersicht prüfte noch zweiwertig**, obwohl es drei Zustände gibt: vermietet,
  // selbstgenutzt und außerhalb der Abrechnungseinheit (`UnitUsage` in shared/types.ts). Gefragt
  // wurde `!u.participates`, und damit schlug eine ausdrücklich ausgenommene Wohnung — etwa eine
  // getrennt abgerechnete Gewerbeeinheit — als Eigennutzung durch. Der Vermieter bekam dann die
  // Aufforderung, den selbstgenutzten Anteil herauszurechnen, obwohl er gar nichts selbst nutzt.
  //
  // Gefragt wird jetzt nach derselben Regel, nach der auch die Abrechnung ihre selbstgenutzten
  // Wohnungen erkennt (`selfUnits` in computeSettlement): `selfUsed` und nicht vermietet.
  const db: Db = {
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG', areaM2: 100, participates: true },
      { id: 'u2', name: 'Laden', areaM2: 100, participates: false, selfUsed: false },
    ],
    tenancies: [tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01' })],
  }
  const r = taxReport(snapshotFromDb(db, 2025))
  assert.equal(r.selfOccupiedExists, false, 'eine ausgenommene Wohnung gilt als Eigennutzung')
  assert.equal(r.selfUsedAreaM2, 0, 'eine ausgenommene Wohnung zählt als privat')
  assert.equal(r.totalAreaM2, 200, 'die Gesamtfläche umfasst das ganze Gebäude')
  // Sie ist aber nicht nichts: Der Vermieter soll wissen, dass Mietfuchs sie nicht einordnen kann.
  assert.equal(r.excludedExists, true)
})

test('Steuer (Anlage V): der Flächenanteil misst das Private, nicht das Vermietete (#68)', () => {
  // **Die zweite Frage des Issues, und die Antwort ist: Die Grundmengen dürfen auseinanderlaufen.**
  // Die Verteilbasis der Abrechnung beantwortet „welche Wohnungen teilen sich diese Rechnung“,
  // der steuerliche Flächenanteil beantwortet „wie viel meines Gebäudes ist privat“. Eine
  // getrennt abgerechnete Gewerbeeinheit ist bei der ersten Frage draußen und bei der zweiten
  // Teil des Gebäudes.
  //
  // Gemessen wird deshalb das **Private** und nicht das Vermietete. Nur das ist eindeutig: Ob
  // eine ausgenommene Wohnung vermietet ist, weiß Mietfuchs nicht, ob sie selbstgenutzt ist,
  // sehr wohl. Und die steuerliche Frage ist ohnehin die nach dem privaten Anteil, denn er ist
  // der nicht abziehbare.
  const db: Db = {
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG', areaM2: 100, participates: true },
      { id: 'u2', name: 'OG', areaM2: 50, participates: false, selfUsed: true, selfPersons: 2 },
      { id: 'u3', name: 'Laden', areaM2: 50, participates: false, selfUsed: false },
    ],
    tenancies: [tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01' })],
  }
  const r = taxReport(snapshotFromDb(db, 2025))
  assert.equal(r.selfOccupiedExists, true)
  assert.equal(r.excludedExists, true)
  // 50 von 200 m² sind selbstgenutzt. Der Laden zählt nicht dazu, obwohl er nicht vermietet ist,
  // steht aber im Nenner: Die Frage lautet, wie viel des **Gebäudes** privat genutzt wird.
  assert.equal(r.selfUsedAreaM2, 50)
  assert.equal(r.totalAreaM2, 200)
})

test('Steuer (Anlage V): ein Bestand von vor der dreiwertigen Unterscheidung (#68)', () => {
  // **Der Fall, der den naheliegenden Fix zur Verschlechterung machte.** CLAUDE.md sagt
  // ausdrücklich, dass die Migration in legacy/migrate.ts das Kennzeichen bewusst **nicht** setzt, weil ein
  // gesetztes Kennzeichen die Verteilung bereits abgerechneter Jahre veränderte. Wer seine eigene
  // Wohnung damals nur auf „nicht beteiligt“ gestellt hat, trägt also `participates: false` ohne
  // `selfUsed`. Für die Abrechnung ist das „außerhalb der Abrechnungseinheit“.
  //
  // Der Hinweis muss diesen Vermieter weiterhin erreichen, sonst nimmt die Behebung ausgerechnet
  // dem die Hilfe weg, der sie braucht. Er darf nur nicht mehr behaupten, die Wohnung sei
  // selbstgenutzt — er fordert auf, sie einzuordnen.
  const db: Db = {
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG', areaM2: 100, participates: true },
      { id: 'u2', name: 'OG (eigene Wohnung, alt erfasst)', areaM2: 100, participates: false },
    ],
    tenancies: [tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01' })],
  }
  const r = taxReport(snapshotFromDb(db, 2025))
  assert.equal(r.selfOccupiedExists, false, 'ohne gesetztes Kennzeichen wird Eigennutzung behauptet')
  assert.equal(r.excludedExists, true, 'der Hinweis erreicht alte Bestände nicht mehr')
  assert.equal(r.selfUsedAreaM2, 0)
})

test('Steuer (Anlage V): ohne erfasste Fläche wird kein Anteil behauptet (#68)', () => {
  // Erreichbar ist das, weil die Datenbank `area_m2 >= 0` zulässt; nur die Oberfläche lehnt die
  // Null ab. Ein Anteil von 0 wäre dort eine Aussage über etwas, das niemand eingetragen hat,
  // und die Oberfläche lässt den Prozentsatz deshalb weg. Damit sie das kann, muss die
  // Gesamtfläche als eigene Zahl herauskommen und nicht als fertiges Verhältnis.
  const db: Db = {
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG', areaM2: 0, participates: true },
      { id: 'u2', name: 'OG', areaM2: 0, participates: false, selfUsed: true },
    ],
    tenancies: [tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01' })],
  }
  const r = taxReport(snapshotFromDb(db, 2025))
  assert.equal(r.totalAreaM2, 0)
  assert.equal(r.selfUsedAreaM2, 0)
  assert.equal(r.selfOccupiedExists, true, 'die Eigennutzung hängt an der Nutzungsart, nicht an der Fläche')
})

test('Steuer (Anlage V): abgeschlossene Abrechnung liefert den eingefrorenen Eigenanteil', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.payments = []
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  db.closedSettlements = [
    { id: 'x', year: 2025, closedAt: '2026-01-05', sentAt: null, settlement: computeSettlement(snapshotFromDb(db, 2025)) },
  ]
  // Nachträgliche Änderung an den Kosten: der eingefrorene Stand bleibt maßgeblich,
  // sonst widersprächen Steuerübersicht und versendete Abrechnung einander.
  db.costItems[0].amountCents = 460000
  assert.equal(taxReport(snapshotFromDb(db, 2025)).selfUsedShareCents, 80000)
})

test('Steuer (Anlage V): auf die eigene Wohnung entfallender Anteil wird ausgewiesen', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.payments = []
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  const r = taxReport(snapshotFromDb(db, 2025))
  // 80 von 230 m² entfallen auf die eigene Wohnung — dieser Teil ist privat, nicht abziehbar
  assert.equal(r.selfUsedShareCents, 80000)
  assert.equal(r.expenses.totalCents, 230000) // die Werbungskosten selbst bleiben unangetastet
})

test('Steuer (Anlage V): die Jahreskorrektur der Vorauszahlungen wird ausgewiesen (#70)', () => {
  // **Der Befund aus #70, an seinem Ursprung gemessen.** Die Abrechnung setzt die tatsächlich
  // geleisteten Vorauszahlungen an, denn nach ständiger Rechtsprechung des BGH muss sie das;
  // eine Abrechnung auf Soll-Basis ist materiell falsch, und nach Ablauf der Frist des § 556
  // Abs. 3 BGB gibt es dann keinen Nachforderungsanspruch mehr. Die Steuerübersicht dagegen
  // hat bisher nur das vereinbarte Soll geführt. Beide Zahlen standen unkommentiert
  // nebeneinander, und wer sie verglich, hielt eine davon für falsch.
  //
  // Geprüft wird deshalb **gegen die Abrechnung** und nicht gegen eine im Test noch einmal
  // hingeschriebene Zahl: Die Zusage lautet, dass die Steuerübersicht dieselbe Vorauszahlung
  // nennt, die auf der Abrechnung desselben Jahres steht. Rechneten beide getrennt, könnten
  // sie wieder auseinanderlaufen, ohne dass ein Test es merkt.
  const db: Db = {
    ...emptyDb(),
    units: [{ id: 'u1', name: 'OG', areaM2: 100, participates: true }],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01',
        personHistory: [{ from: '2025-01-01', persons: 2 }],
        baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
        prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
        // Tatsächlich geflossen sind 1.800 € statt der vereinbarten 2.400 €.
        prepaymentOverrides: { '2025': 180000 },
      }),
    ],
    costItems: [{ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'GS', amountCents: 50000, key: 'units' }],
  }
  const snapshot = snapshotFromDb(db, 2025)
  const r = taxReport(snapshot)

  // Das vereinbarte Soll bleibt, wie es war: Es ist der Abgleich, nicht die steuerliche Zahl.
  assert.equal(r.income.prepaymentSollCents, 240000)
  // Und daneben steht jetzt, was die Abrechnung ansetzt.
  assert.equal(r.income.prepaymentOverridden, true)
  const statement = computeSettlement(snapshot).statements[0]
  if (!statement) return assert.fail('die Abrechnung führt kein Mietverhältnis; der Test wäre wirkungslos')
  assert.equal(statement.prepaymentCents, 180000, 'die Abrechnung rechnet nicht mit der Jahreskorrektur')
  assert.equal(r.income.prepaymentSettlementCents, statement.prepaymentCents)
})

test('Steuer (Anlage V): jede Zahlung des Jahres zählt, auch ohne Zeile im Mietkonto (#70)', () => {
  // **Der schwerste Befund der Durchsicht, und er wird erst durch diesen PR gefährlich.**
  // `rentLedger` bildet Zeilen nur für Mietverhältnisse mit Überlappung im Jahr und zählt
  // Zahlungen nur innerhalb dieser Zeilen. Zwei gewöhnliche Fälle fallen dadurch aus **beiden**
  // Jahren heraus:
  //
  //   Ein Mietverhältnis endet am 31.12., die Dezembermiete geht am 5. Januar ein. Im alten Jahr
  //   liegt die Zahlung außerhalb, im neuen gibt es keine Zeile mehr.
  //
  //   Ein Mietverhältnis beginnt am 1. Januar, der Dauerauftrag bucht die Januarmiete am
  //   30. Dezember. Im neuen Jahr liegt die Zahlung außerhalb, im alten gibt es noch keine Zeile.
  //
  // Solange das vereinbarte Soll die Vorgabe der Steuerübersicht war, bestimmte diese Lücke
  // nicht die Kopfzahl. Jetzt ist das tatsächlich Zugeflossene die Vorgabe und damit die Zahl,
  // die in die Anlage V wandert. Zugeflossen ist Geld aber nach § 11 Abs. 1 Satz 1 EStG, wenn es
  // da ist, und nicht, wenn das Mietkonto eine Zeile dafür führt.
  //
  // **Die Steuerübersicht summiert deshalb die Zahlungen selbst**, nach Datum, und nicht über
  // das Mietkonto. Das Mietkonto behält seine Zeilen: Es beantwortet die Frage, bis zu welchem
  // Monat ein laufendes Mietverhältnis gedeckt ist, und dafür ist eine Zahlung ohne Zeile kein
  // Beitrag.
  const beendet: Db = {
    ...emptyDb(),
    units: [{ id: 'u1', name: 'OG', areaM2: 100, participates: true }],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', tenantName: 'A', start: '2024-01-01', end: '2025-12-31',
        personHistory: [{ from: '2024-01-01', persons: 2 }],
        baseRents: [{ from: '2024-01', monthlyCents: 80000 }],
      }),
    ],
    // Die Dezembermiete 2025, eingegangen am 5. Januar 2026.
    payments: [{ id: 'p1', tenancyId: 't1', date: '2026-01-05', amountCents: 80000 }],
  }
  assert.equal(rentLedger(snapshotFromDb(beendet, 2026)).rows.length, 0, 'das Mietkonto führt 2026 eine Zeile; der Test prüft dann etwas anderes')
  assert.equal(taxReport(snapshotFromDb(beendet, 2026)).income.paidCents, 80000, 'die Zahlung nach dem Ende fällt aus der Steuerübersicht')
  assert.equal(taxReport(snapshotFromDb(beendet, 2025)).income.paidCents, 0, 'die Zahlung zählt doppelt')

  const kuenftig: Db = {
    ...emptyDb(),
    units: [{ id: 'u1', name: 'OG', areaM2: 100, participates: true }],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', tenantName: 'A', start: '2026-01-01',
        personHistory: [{ from: '2026-01-01', persons: 2 }],
        baseRents: [{ from: '2026-01', monthlyCents: 80000 }],
      }),
    ],
    // Die Januarmiete 2026, per Dauerauftrag am 30. Dezember 2025 gebucht.
    payments: [{ id: 'p1', tenancyId: 't1', date: '2025-12-30', amountCents: 80000 }],
  }
  assert.equal(rentLedger(snapshotFromDb(kuenftig, 2025)).rows.length, 0, 'das Mietkonto führt 2025 eine Zeile; der Test prüft dann etwas anderes')
  assert.equal(taxReport(snapshotFromDb(kuenftig, 2025)).income.paidCents, 80000, 'die Zahlung vor dem Beginn fällt aus der Steuerübersicht')

  // Und der Überschuss folgt derselben Zahl, sonst stünden Einnahme und Ergebnis auseinander.
  assert.equal(taxReport(snapshotFromDb(kuenftig, 2025)).surplusPaidCents, 80000)
})

test('Steuer (Anlage V): bei abgeschlossener Abrechnung gilt ihr eingefrorener Stand (#70)', () => {
  // **Dieselbe Regel wie beim Eigenanteil, und aus demselben Grund.** Der Satz in der Oberfläche
  // nennt die Zahl, die auf der Abrechnung steht. Ist die Abrechnung abgeschlossen, steht dort
  // der eingefrorene Stand, und zwar bei dem Mieter im Briefkasten. Nähme die Übersicht den
  // lebenden, nennte sie eine Zahl, die auf keinem zugestellten Papier steht — genau der
  // Widerspruch, gegen den #70 antritt.
  const db: Db = {
    ...emptyDb(),
    units: [{ id: 'u1', name: 'OG', areaM2: 100, participates: true }],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01',
        personHistory: [{ from: '2025-01-01', persons: 2 }],
        baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
        prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
      }),
    ],
    costItems: [{ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'GS', amountCents: 50000, key: 'units' }],
  }
  db.closedSettlements = [
    { id: 'x', year: 2025, closedAt: '2026-01-05', sentAt: null, settlement: computeSettlement(snapshotFromDb(db, 2025)) },
  ]
  // Nachträglich eine Jahreskorrektur erfasst: Der eingefrorene Stand kennt sie nicht.
  const t1 = db.tenancies[0]
  if (!t1) return assert.fail('das Mietverhältnis fehlt')
  t1.prepaymentOverrides = { '2025': 180000 }

  const r = taxReport(snapshotFromDb(db, 2025))
  assert.equal(r.income.prepaymentSettlementCents, 240000, 'die Übersicht nennt eine Zahl, die auf der zugestellten Abrechnung nicht steht')
  assert.equal(r.income.prepaymentOverridden, false, 'die zugestellte Abrechnung kennt keine Jahreskorrektur')
})

test('Steuer (Anlage V): Mietverhältnisse ohne jede Zahlung werden gezählt (#70)', () => {
  // **Die Lücke, die der Hinweis „keine Zahlung erfasst“ bisher nicht sah.** Er hing an
  // `paidCents === 0`. Sind für einen Mieter Zahlungen erfasst und für einen zweiten nicht, ist
  // die Summe größer als null, es erscheint kein Hinweis, und eine zu niedrige Einnahme geht
  // ohne Vorbehalt in die Anlage V. Das ist der häufigere Fall, denn wer gar nichts erfasst
  // hat, sieht die 0 wenigstens.
  const db: Db = {
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG', areaM2: 100, participates: true },
      { id: 'u2', name: 'OG', areaM2: 100, participates: true },
    ],
    tenancies: [
      tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01', baseRents: [{ from: '2025-01', monthlyCents: 80000 }] }),
      tenancy({ id: 't2', unitId: 'u2', tenantName: 'B', start: '2025-01-01', baseRents: [{ from: '2025-01', monthlyCents: 80000 }] }),
    ],
    payments: [{ id: 'p1', tenancyId: 't1', date: '2025-01-05', amountCents: 960000 }],
  }
  const r = taxReport(snapshotFromDb(db, 2025))
  assert.equal(r.income.tenanciesWithSoll, 2)
  assert.equal(r.income.tenanciesWithoutPayment, 1)
  // Ohne Soll zählt ein Mietverhältnis nicht mit: Dort ist eine fehlende Zahlung kein Versäumnis.
  assert.equal(taxReport(snapshotFromDb(emptyDb(), 2025)).income.tenanciesWithSoll, 0)

  // **Gezählt wird „nichts erfasst“, nicht „Summe null“.** Eine Zahlung und eine Rücklastschrift
  // heben sich auf; erfasst ist dann sehr wohl etwas, und der Satz „für dieses Mietverhältnis ist
  // keine einzige Zahlung erfasst" wäre schlicht falsch. Ohne diesen Fall bliebe der Unterschied
  // zwischen beiden Regeln ungeprüft — nachgemessen, der Test war vorher auch mit der Summe grün.
  const t2 = db.tenancies[1]
  if (!t2) return assert.fail('das zweite Mietverhältnis fehlt')
  db.payments.push(
    { id: 'p2', tenancyId: t2.id, date: '2025-02-01', amountCents: 80000 },
    { id: 'p3', tenancyId: t2.id, date: '2025-02-10', amountCents: -80000, note: 'Rücklastschrift' },
  )
  const nachRuecklastschrift = taxReport(snapshotFromDb(db, 2025))
  assert.equal(nachRuecklastschrift.income.tenanciesWithoutPayment, 0, 'eine Rücklastschrift gilt als „keine Zahlung erfasst“')
  // Und die Einnahme folgt dem Geld: Die beiden heben sich auf.
  assert.equal(nachRuecklastschrift.income.paidCents, 960000)
})

test('Steuer (Anlage V): ohne Jahreskorrektur nennen beide dieselbe Zahl (#70)', () => {
  // Die Gegenprobe. Ohne Korrektur gibt es keinen Unterschied zu erklären, und die Oberfläche
  // soll dann auch nichts erklären. Ohne diesen Fall bliebe offen, ob das Kennzeichen
  // überhaupt etwas unterscheidet oder immer gesetzt ist.
  const db: Db = {
    ...emptyDb(),
    units: [{ id: 'u1', name: 'OG', areaM2: 100, participates: true }],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01',
        personHistory: [{ from: '2025-01-01', persons: 2 }],
        baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
        prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
      }),
    ],
  }
  const r = taxReport(snapshotFromDb(db, 2025))
  assert.equal(r.income.prepaymentOverridden, false)
  assert.equal(r.income.prepaymentSettlementCents, r.income.prepaymentSollCents)
})

test('Sortieren: Kennungen zeichenweise, Namen auf Deutsch — beides fest (#70)', () => {
  // **Die Kleinigkeit aus #70, und sie ist eine Haltungsfrage.** `largestRemainder` vergleicht
  // seine Kennungen ausdrücklich Zeichen für Zeichen und begründet es: Sonst hinge das Ergebnis
  // von der Locale der Laufzeit ab, und dieselben Daten ergäben auf zwei Rechnern zwei
  // Reihenfolgen. Das Mietkonto sortierte daneben mit blankem `localeCompare()`, also genau so,
  // wie die Laufzeit gerade eingestellt ist.
  //
  // **Die Antwort ist nicht, überall zeichenweise zu vergleichen.** „Älter“ gehört vor „Zaun“,
  // und zeichenweise landete es dahinter, weil U+00C4 hinter dem Z liegt. Ein Vermieter mit
  // Umlauten im Haus sähe eine Liste in einer Ordnung, die es in keiner Sprache gibt. Die
  // Antwort ist, die Sprache festzunageln, wie es dieselbe Datei beim Formatieren von Zahlen
  // schon tut (`toLocaleString('de-DE')`).
  //
  // Gemessen wird am Umlaut, denn genau dort gehen die beiden Ordnungen auseinander. Ohne einen
  // solchen Fall wäre der Test wirkungslos, weil sie bei reinem ASCII dasselbe ergeben.
  assert.ok(compareName('Älter', 'Zaun') < 0, 'Namen werden nicht auf Deutsch sortiert')
  assert.ok(compareText('Älter', 'Zaun') > 0, 'Kennungen werden nicht zeichenweise verglichen')

  const db: Db = {
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'Zaun', areaM2: 100, participates: true },
      { id: 'u2', name: 'Älter', areaM2: 100, participates: true },
    ],
    tenancies: [
      tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01', baseRents: [{ from: '2025-01', monthlyCents: 1000 }] }),
      tenancy({ id: 't2', unitId: 'u2', tenantName: 'B', start: '2025-01-01', baseRents: [{ from: '2025-01', monthlyCents: 1000 }] }),
    ],
  }
  const rows = rentLedger(snapshotFromDb(db, 2025)).rows
  assert.deepEqual(rows.map((r) => r.unitName), ['Älter', 'Zaun'])
})

test('Sortieren: in calc.ts gibt es kein blankes localeCompare (#70)', () => {
  // **Die Zusage, die sich auf einem einzelnen Rechner nicht messen lässt.** `localeCompare()`
  // ohne Sprache liest die Einstellung der Laufzeit. Hier entwickelt jemand auf Deutsch, und
  // deshalb sagt jeder Vergleich dasselbe wie der deutsche Kollator — bis die Datei irgendwo
  // anders läuft. Ein Verhaltenstest dafür bräuchte einen zweiten Prozess mit gesetzter Locale,
  // und den beachtet Windows nicht; das wäre ein Test, der nur auf einem System prüft, und
  // genau davor warnt CLAUDE.md.
  //
  // Geprüft wird deshalb der Quelltext. Wer hier etwas ändert, soll sich zwischen den beiden
  // benannten Funktionen entscheiden müssen und nicht zwischen ihnen hindurchrutschen können.
  // **Beide Schreibweisen, und die zweite ist die wahrscheinlichere.** Der erste Entwurf suchte
  // nur nach `.localeCompare(`. Durch ging damit `new Intl.Collator()` **ohne Sprachargument**,
  // und das ist genau der Fall, den die Regel verhindern soll: Wer später einen zweiten Kollator
  // für eine weitere Liste anlegt, schreibt ihn leicht so, und er liest dann die Einstellung der
  // Laufzeit. Gemessen: Mit beiden Lücken eingebaut blieben die Sortier-Tests grün.
  //
  // Das Leerzeichen in `\s*` ist billig mitgenommen: `a.localeCompare (b)` ist gültiges
  // JavaScript und rutschte sonst ebenfalls durch.
  //
  // **Geprüft wird nicht nur calc.ts.** Die beiden anderen halten dieselben Regeln über Staffeln
  // und Ablesungen: schedule.ts entscheidet, welcher von zwei Einträgen zum selben Stichtag gilt,
  // und legacy/migrate.ts rückt einen alten Bestand gerade. Beide sagen in ihren
  // Kommentaren „wie in calc.ts“, und solange das nur ein Kommentar war, konnte die eine Seite
  // wechseln, ohne die andere mitzunehmen. Genau das ist beim Umstellen passiert, und ohne diesen
  // Test wäre es unbemerkt geblieben: Bei ISO-Stichtagen sagen Kollator und Zeichenvergleich
  // dasselbe, ein Verhaltenstest kann den Unterschied also gar nicht zeigen.
  const verboten = [/\.localeCompare\s*\(/, /new Intl\.Collator\(\s*\)/]
  for (const datei of ['calc.ts', 'schedule.ts', 'legacy/migrate.ts']) {
    const quelle = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', datei), 'utf8')
    const treffer = quelle
      .split('\n')
      .filter((zeile) => !zeile.trimStart().startsWith('//'))
      .filter((zeile) => verboten.some((muster) => muster.test(zeile)))
    assert.deepEqual(treffer, [], `${datei} sortiert nach der Locale der Laufzeit statt mit compareText/compareName`)
  }
})

// ---------- Invarianten über zufällige Datenbestände ----------
// Eine Abrechnung ist ein Rechtsdokument: Mieteranteile plus Vermieteranteil müssen die
// Gesamtkosten centgenau ergeben, und der ausgewiesene Eigenanteil darf nie größer sein als
// der Vermieteranteil, in dem er steckt. Statt einzelne Fälle zu raten, prüft dieser Test
// viele zufällige Konstellationen — mit festem Startwert, damit Fehlschläge reproduzierbar
// bleiben.
type Rng = () => number

function makeRng(seed: number): Rng {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

// Der Bestand deckt ab, was Geld bewegt (Integrationsdurchsicht Geld): Gutschriften, Heizung und Erhaltungsrücklage, die Garage mit 0 m² und 0
// Personen, Pauschale und Inklusivmiete, Zahlungen und den Hauptzähler.
function randomDb(rnd: Rng): Db {
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
  const unitCount = 1 + Math.floor(rnd() * 4)
  const units: Unit[] = []
  const garages = new Set<string>()
  for (let i = 0; i < unitCount; i++) {
    const usage = pick<UnitUsage>(['vermietet', 'vermietet', 'eigen', 'ausgenommen'])
    const garage = usage === 'vermietet' && rnd() < 0.15
    if (garage) garages.add(`u${i}`)
    units.push({
      id: `u${i}`,
      name: `W${i}`,
      areaM2: garage ? 0 : rnd() < 0.15 ? 0 : Math.round(rnd() * 120),
      participates: usage === 'vermietet',
      selfUsed: usage === 'eigen',
      selfPersons: usage === 'eigen' ? Math.floor(rnd() * 4) : undefined,
    })
  }
  const tenancies: Tenancy[] = []
  const models: CostModel[] = ['settlement', 'settlement', 'settlement', 'flatRate', 'inclusive']
  for (const u of units) {
    // auch nicht vermietete Wohnungen können ein beendetes Mietverhältnis haben
    if (rnd() < 0.2) continue
    const start = rnd() < 0.3 ? `2025-${String(1 + Math.floor(rnd() * 9)).padStart(2, '0')}-01` : '2020-01-01'
    const end = rnd() < 0.3 ? `2025-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-28` : null
    const persons = garages.has(u.id) ? 0 : 1 + Math.floor(rnd() * 4)
    const costModel = pick(models)
    const heatingModel = pick(models)
    tenancies.push(tenancy({
      id: `t${tenancies.length}`, unitId: u.id, tenantName: `M${tenancies.length}`,
      start, end, persons,
      personHistory: [{ from: start, persons }],
      prepayments: [{ from: '2020-01', monthlyCents: Math.floor(rnd() * 30000) }],
      ...(costModel !== 'settlement' ? { costModel } : {}),
      ...(heatingModel !== 'settlement' ? { heatingModel } : {}),
      ...(costModel === 'flatRate' || heatingModel === 'flatRate' ? { flatRates: [{ from: '2020-01', monthlyCents: Math.floor(rnd() * 15000) }] } : {}),
    }))
  }
  const meters: Meter[] = []
  const readings: Reading[] = []
  for (const u of units) {
    if (rnd() < 0.5) continue
    const id = `m${meters.length}`
    meters.push({ id, unitId: u.id, type: pick<MeterType>(['kaltwasser', 'sonstig', 'waerme']), name: id, unit: 'm³' })
    readings.push({ id: `${id}a`, meterId: id, date: '2024-12-31', value: 0 })
    readings.push({ id: `${id}b`, meterId: id, date: '2025-12-31', value: Math.round(rnd() * 100) })
  }
  // Ein Hauptzähler, manchmal nur für einen Teil des Jahres abgelesen.
  if (rnd() < 0.3) {
    const id = `m${meters.length}`
    meters.push({ id, unitId: null, type: 'kaltwasser', name: id, unit: 'm³' })
    readings.push({ id: `${id}a`, meterId: id, date: rnd() < 0.8 ? '2024-12-31' : '2025-06-30', value: 0 })
    readings.push({ id: `${id}b`, meterId: id, date: '2025-12-31', value: Math.round(rnd() * 400) })
  }
  const payments: Payment[] = []
  for (const t of tenancies) {
    const n = Math.floor(rnd() * 4)
    for (let k = 0; k < n; k++) {
      payments.push({ id: `p${payments.length}`, tenancyId: t.id, date: `2025-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-0${1 + Math.floor(rnd() * 9)}`, amountCents: Math.floor(rnd() * 200000) - 10000 })
    }
  }
  const costItems: CostItem[] = []
  const itemCount = 1 + Math.floor(rnd() * 5)
  for (let i = 0; i < itemCount; i++) {
    // Einzelbeträge kennt die db.json nicht (LegacyCostKey); sie prüft randomSource in
    // calc-verteilbasis.test.ts.
    const key = pick<LegacyCostKey>(['area', 'persons', 'units', 'meter', 'direct', 'custom'])
    const amount = 1 + Math.floor(rnd() * 500000)
    const item: CostItem = {
      id: `c${i}`, year: 2025,
      category: pick(['Grundsteuer', 'Wasser/Abwasser', 'Gartenpflege', 'Nicht umlagefähig', 'Heizung und Warmwasser', RESERVE_CATEGORY]),
      description: `P${i}`,
      amountCents: rnd() < 0.15 ? -amount : amount,
      key,
    }
    if (key === 'meter') item.meterType = pick<MeterType | undefined>(['kaltwasser', 'sonstig', 'waerme', undefined])
    if (key === 'direct') item.directUnitId = pick([...units.map((u) => u.id), 'weg'])
    if (key === 'custom') {
      const shares: Record<string, number> = {}
      for (const u of units) if (rnd() < 0.6) shares[u.id] = Math.round(rnd() * 6000) / 100
      item.customShares = shares
    }
    if (rnd() < 0.3) item.labor35aCents = Math.floor(rnd() * item.amountCents * (rnd() < 0.1 ? 1.5 : 1))
    costItems.push(item)
  }
  return { ...emptyDb(), units, tenancies, meters, readings, payments, costItems }
}

// Was eine Position im Ergebnis ergibt: die Zeilen der Mieter und die des Vermieters.
const rowsOfItem = (s: ComputedSettlement, id: string) => ({
  tenants: s.statements.flatMap((st) => st.rows.filter((r) => r.costItemId === id)),
  landlord: s.landlord.rows.filter((r) => r.costItemId === id).reduce((a, r) => a + r.shareCents, 0),
})

test('Invariante: Mieteranteile + Vermieteranteil ergeben die Gesamtkosten, je Position und insgesamt', () => {
  const rnd = makeRng(20260918)
  for (let i = 0; i < 500; i++) {
    const db = randomDb(rnd)
    const s = computeSettlement(snapshotFromDb(db, 2025))
    const tenantsCents = s.statements.reduce((a, x) => a + x.totalShareCents, 0)
    assert.equal(
      tenantsCents + s.landlord.totalCents,
      s.totalCostsCents,
      `Fall ${i}: ${tenantsCents} + ${s.landlord.totalCents} ≠ ${s.totalCostsCents}\n${JSON.stringify(db)}`,
    )
    for (const item of db.costItems) {
      const { tenants, landlord } = rowsOfItem(s, item.id)
      assert.equal(tenants.reduce((a, r) => a + r.shareCents, 0) + landlord, item.amountCents, `Fall ${i}, ${item.id}\n${JSON.stringify(db)}`)
    }
    // Die Zerlegung des Vermieteranteils in seine Gründe (#142) geht auf.
    assertLandlordParts(s, db.tenancies.length, `Fall ${i}\n${JSON.stringify(db)}`)
  }
})

// Vorher „kein Mieter trägt einen negativen Anteil“. Seit der Generator Gutschriften erzeugt, ist
// das die falsche Frage: Eine Gutschrift gehört anteilig dem Mieter. Richtig ist, dass ein Anteil
// das Vorzeichen seiner Position hat (oder 0), und dass nicht umlagefähige Kostenarten nie in einer
// Zeile der Mieter stehen.
test('Invariante: ein Anteil hat das Vorzeichen seiner Position, nicht Umlagefähiges trägt kein Mieter', () => {
  const rnd = makeRng(4711)
  for (let i = 0; i < 500; i++) {
    const db = randomDb(rnd)
    const byId = new Map(db.costItems.map((c) => [c.id, c]))
    for (const st of computeSettlement(snapshotFromDb(db, 2025)).statements) {
      for (const row of st.rows) {
        const item = byId.get(row.costItemId)
        if (!item) return assert.fail(`Fall ${i}: Zeile ohne Position ${row.costItemId}`)
        assert.ok(row.shareCents === 0 || Math.sign(row.shareCents) === Math.sign(item.amountCents), `Fall ${i}: Anteil ${row.shareCents} an Position ${item.amountCents}\n${JSON.stringify(db)}`)
        assert.ok(!isNotAllocable(item.category), `Fall ${i}: ${item.category} in einer Mieterzeile`)
        // Die Zeilen der Mieter führen den Lohnanteil immer mit (im Typ ist er optional, weil
        // die Zeilen des Vermieteranteils ihn nicht haben). Das gehört mit zur Invariante.
        assert.ok(
          typeof row.labor35aCents === 'number' && row.labor35aCents >= 0 && row.labor35aCents <= Math.max(0, row.shareCents),
          `Fall ${i}: §35a-Anteil ${row.labor35aCents} außerhalb von 0…${row.shareCents}`,
        )
      }
    }
  }
})

// Der Zufallsbestand für §35a (Durchsicht von #196): randomDb erzeugt Lohnanteile nur als
// beliebigen Bruchteil und Einzüge nur am Monatsersten. Gefährlich sind aber gerade die Fälle, in
// denen der Lohn fast den ganzen Betrag ausmacht (80–100 %) und die Mieter nicht alles tragen
// (Eigennutzung, Leerstand, Einzug mitten im Monat): Dort konnte der Lohnanteil eines Mieters über
// seinem Kostenanteil liegen.
function randomLaborDb(rnd: Rng): Db {
  const db = randomDb(rnd)
  if (rnd() < 0.5) db.units.push({ id: 'eigen', name: 'Eigen', areaM2: 20 + Math.round(rnd() * 100), participates: false, selfUsed: true, selfPersons: 1 + Math.floor(rnd() * 3) })
  if (rnd() < 0.5) db.units.push({ id: 'leer', name: 'Leer', areaM2: 20 + Math.round(rnd() * 100), participates: true })
  for (const t of db.tenancies) {
    if (rnd() < 0.5) t.start = `2025-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`
    if (t.end && t.end < t.start) t.end = null
  }
  for (const c of db.costItems) {
    if (c.amountCents <= 0) continue
    const r = rnd()
    if (r < 0.35) c.labor35aCents = c.amountCents
    else if (r < 0.7) c.labor35aCents = Math.round(c.amountCents * (0.8 + rnd() * 0.2))
  }
  return db
}

test('Invariante: §35a-Lohnanteil der Mieter — Summe, Obergrenze, Reihenfolge, Kosten unberührt', () => {
  const rnd = makeRng(3552025)
  for (let i = 0; i < 1000; i++) {
    const db = i % 2 === 0 ? randomDb(rnd) : randomLaborDb(rnd)
    const s = computeSettlement(snapshotFromDb(db, 2025))
    for (const item of db.costItems.filter((c) => c.year === 2025)) {
      // Nur ein gültiger Lohnanteil wird bescheinigt (#148); ein ungültiger ergibt eine Warnung.
      const itemLabor = validLabor35aCents(item) ?? 0
      if (itemLabor <= 0) continue
      const rows = s.statements.flatMap((st) => st.rows.filter((r) => r.costItemId === item.id))
      const costCents = rows.reduce((a, r) => a + r.shareCents, 0)
      const laborCents = rows.reduce((a, r) => a + (r.labor35aCents ?? 0), 0)
      // Je Zeile nie mehr Lohnanteil als Kostenanteil (Durchsicht von #196): Bescheinigt wird, was
      // der Mieter für Arbeit bezahlt hat, und mehr als seinen Anteil hat er nicht bezahlt.
      for (const r of rows) {
        assert.ok((r.labor35aCents ?? 0) <= r.shareCents, `Fall ${i}, ${item.id}: Lohnanteil ${r.labor35aCents} über dem Kostenanteil ${r.shareCents}\n${JSON.stringify(db)}`)
      }
      // Der Lohnanteil folgt dem ungerundeten Kostenanteil (#180), und der steht nicht in der
      // Abrechnung. Gegen die gerundeten Anteile gemessen weicht die Summe höchstens um ihren
      // eigenen Rundungscent ab und um den Lohn auf die Rundung der Kostenanteile, die zusammen
      // unter einem halben Cent je Zeile liegt (mindestens ein halber).
      const proportional = (itemLabor * costCents) / item.amountCents
      const tolerance = 0.5 + (itemLabor / item.amountCents) * Math.max(0.5, rows.length / 2)
      assert.ok(laborCents <= itemLabor, `Fall ${i}: mehr bescheinigt (${laborCents}) als die Rechnung enthält (${itemLabor})`)
      assert.ok(Math.abs(laborCents - proportional) <= tolerance, `Fall ${i}, ${item.id}: Summe ${laborCents} weit weg vom anteiligen Lohn ${proportional}\n${JSON.stringify(db)}`)
      if (costCents === item.amountCents) assert.equal(laborCents, itemLabor, `Fall ${i}: volle Umlage, aber Lohnanteil nicht vollständig`)
    }
    // Reihenfolge ohne Einfluss
    const rev = structuredClone(db)
    rev.units.reverse()
    rev.tenancies.reverse()
    rev.costItems.reverse()
    const byTenancy = (r: ComputedSettlement) => JSON.stringify(r.statements.map((st) => [st.tenancyId, st.total35aCents, st.totalShareCents]).sort())
    assert.equal(byTenancy(computeSettlement(snapshotFromDb(rev, 2025))), byTenancy(s), `Fall ${i}: Ergebnis hängt von der Reihenfolge ab`)
    // Die Kostenverteilung selbst hängt nicht am Lohnanteil
    const withoutLabor = structuredClone(db)
    for (const c of withoutLabor.costItems) delete c.labor35aCents
    const shares = (r: ComputedSettlement) => JSON.stringify(r.statements.map((st) => [st.tenancyId, st.rows.map((x) => x.shareCents)]))
    assert.equal(shares(computeSettlement(snapshotFromDb(withoutLabor, 2025))), shares(s), `Fall ${i}: Lohnanteil verändert die Kostenverteilung`)
  }
})

// Vorher über die Summe gefasst (0 ≤ Eigenanteil ≤ Vermieteranteil). Mit Gutschriften gilt das
// nur noch je Position: Eine Gutschrift senkt den Eigenanteil (#129) und kann die Summe unter 0
// drücken. Je Position wird gerechnet, indem der Bestand nur diese Position trägt; die Summe der
// Eigenanteile je Position ist dann der Eigenanteil der ganzen Abrechnung.
test('Invariante: der Eigenanteil steckt je Position im Vermieteranteil, mit gleichem Vorzeichen', () => {
  const rnd = makeRng(1234567)
  for (let i = 0; i < 500; i++) {
    const db = randomDb(rnd)
    const s = computeSettlement(snapshotFromDb(db, 2025))
    let sum = 0
    for (const item of db.costItems) {
      const one = computeSettlement(snapshotFromDb({ ...db, costItems: [item] }, 2025))
      const self = one.selfUsedShareCents
      const landlord = rowsOfItem(one, item.id).landlord
      sum += self
      assert.ok(self === 0 || Math.sign(self) === Math.sign(landlord), `Fall ${i}, ${item.id}: Eigenanteil ${self}, Vermieteranteil ${landlord}\n${JSON.stringify(db)}`)
      assert.ok(Math.abs(self) <= Math.abs(landlord), `Fall ${i}, ${item.id}: Eigenanteil ${self} > Vermieteranteil ${landlord}\n${JSON.stringify(db)}`)
    }
    assert.equal(s.selfUsedShareCents, sum, `Fall ${i}: Eigenanteil der Abrechnung ≠ Summe je Position`)
  }
})

test('Invariante: Steuer — Werbungskosten + Rücklage = Kostensumme, §35a = gültige Lohnanteile ohne Rücklage', () => {
  const rnd = makeRng(1432025)
  for (let i = 0; i < 300; i++) {
    const db = randomDb(rnd)
    const r = taxReport(snapshotFromDb(db, 2025))
    const items = db.costItems.filter((c) => c.year === 2025)
    assert.equal(r.expenses.totalCents + r.reserveContributionCents, items.reduce((a, c) => a + c.amountCents, 0), `Fall ${i}\n${JSON.stringify(db)}`)
    assert.equal(r.reserveContributionCents, items.filter((c) => c.category === RESERVE_CATEGORY).reduce((a, c) => a + c.amountCents, 0), `Fall ${i}`)
    const labor = items.filter((c) => c.category !== RESERVE_CATEGORY).reduce((a, c) => a + (validLabor35aCents(c) ?? 0), 0)
    assert.equal(r.expenses.labor35aCents, labor, `Fall ${i}\n${JSON.stringify(db)}`)
  }
})

// ---------- Teilweise Eigennutzung (#163) ----------

test('Invariante: Steuer — privat + abziehbar = Betrag je Position, Kostenart, Gruppe und gesamt; privat nie über dem Betrag', () => {
  const rnd = makeRng(1632025)
  for (let i = 0; i < 400; i++) {
    const db = randomDb(rnd)
    const r = taxReport(snapshotFromDb(db, 2025))
    const fall = `Fall ${i}\n${JSON.stringify(db)}`
    for (const x of r.expenses.items) {
      assert.equal(x.privateCents + x.deductibleCents, x.amountCents, `${fall}: Position ${x.costItemId}`)
      assert.ok(x.privateCents === 0 || Math.sign(x.privateCents) === Math.sign(x.amountCents), `${fall}: privat ${x.privateCents} gegen das Vorzeichen von ${x.amountCents}`)
      assert.ok(Math.abs(x.privateCents) <= Math.abs(x.amountCents), `${fall}: privat ${x.privateCents} über dem Betrag ${x.amountCents}`)
    }
    for (const g of r.expenses.groups) {
      assert.equal(g.privateCents + g.deductibleCents, g.amountCents, `${fall}: Gruppe ${g.group}`)
      for (const c of g.categories) assert.equal(c.privateCents + c.deductibleCents, c.amountCents, `${fall}: Kostenart ${c.category}`)
      const ofGroup = r.expenses.items.filter((x) => x.group === g.group)
      assert.equal(ofGroup.reduce((a, x) => a + x.privateCents, 0), g.privateCents, `${fall}: Gruppe ${g.group} ≠ Summe der Positionen`)
    }
    assert.equal(r.expenses.privateCents + r.expenses.deductibleCents, r.expenses.totalCents, fall)
    assert.equal(r.expenses.items.reduce((a, x) => a + x.amountCents, 0), r.expenses.totalCents, `${fall}: Positionen ≠ Werbungskosten`)
    assert.equal(r.surplusPaidCents, r.income.paidCents - r.expenses.deductibleCents, fall)
    assert.equal(r.surplusSollCents, r.income.sollCents - r.expenses.deductibleCents, fall)
  }
})

test('Invariante: Steuer — ohne selbstgenutzte Wohnung ist nichts privat, und der Überschuss bleibt der bisherige', () => {
  const rnd = makeRng(163)
  let geprueft = 0
  for (let i = 0; i < 400; i++) {
    const db = randomDb(rnd)
    // Jede selbstgenutzte Wohnung wird vermietet; der Bestand bleibt sonst derselbe.
    for (const u of db.units) if (u.selfUsed) { u.selfUsed = false; u.participates = true }
    const r = taxReport(snapshotFromDb(db, 2025))
    const fall = `Fall ${i}\n${JSON.stringify(db)}`
    assert.equal(r.expenses.privateCents, 0, fall)
    for (const x of r.expenses.items) assert.equal(x.privateCents, 0, `${fall}: ${x.costItemId}`)
    assert.equal(r.surplusPaidCents, r.income.paidCents - r.expenses.totalCents, fall)
    assert.equal(r.surplusSollCents, r.income.sollCents - r.expenses.totalCents, fall)
    geprueft += r.expenses.items.length
  }
  assert.ok(geprueft > 400, 'der Generator erzeugt kaum Positionen')
})

test('Invariante: Steuer — bei umlagefähigen Kosten ist der private Teil der Eigenanteil der Abrechnung', () => {
  // Summenprobe: Was die Steuer laut Abrechnung oder direkt zuordnet, ergibt zusammen genau den
  // Eigenanteil der Abrechnung. Positionen, die die Abrechnung nicht verteilt hat, gehen nach
  // Fläche und tragen dort keinen Eigenanteil.
  const rnd = makeRng(1630)
  let mitEigenanteil = 0
  for (let i = 0; i < 400; i++) {
    const db = randomDb(rnd)
    const snapshot = snapshotFromDb(db, 2025)
    const r = taxReport(snapshot)
    const s = computeSettlement(snapshot)
    const ausAbrechnung = r.expenses.items.filter((x) => !isNotAllocable(x.category) && x.allocation !== 'area' && x.allocation !== 'unsplittable')
    // Gibt es Einheiten außerhalb, rechnet die Steuer nach der Gebäudefläche und führt den Eigenanteil
    // der Abrechnung als Vergleich (`settlementPrivateCents`); zusammen ergibt es wieder die Summe.
    const verglichen = r.expenses.items.reduce((a, x) => a + (x.settlementPrivateCents ?? 0), 0)
    assert.equal(ausAbrechnung.reduce((a, x) => a + x.privateCents, 0) + verglichen, s.selfUsedShareCents, `Fall ${i}\n${JSON.stringify(db)}`)
    if (s.selfUsedShareCents !== 0) mitEigenanteil++
  }
  assert.ok(mitEigenanteil > 50, `nur ${mitEigenanteil} Fälle mit Eigenanteil`)
})

// ---------- Mehrere Objekte (#92) ----------
// Ein Bestand mit zwei Objekten muss je Objekt genau das rechnen, was ein Bestand ergäbe, der nur
// aus diesem Objekt besteht. Das ist der Fehler, der sonst still bliebe: Ein Filter fehlt, und
// eine Rechnung wird über zwei Häuser verteilt. Keine Ausnahme, keine Warnung, nur falsche Zahlen.

// Alle Kennungen eines zufälligen Bestands mit einem Präfix, samt der Verweise darauf. So lassen
// sich zwei Bestände zusammenlegen, ohne dass eine Kennung doppelt vorkommt.
function prefixed(db: Db, p: string): Db {
  const id = (x: string) => `${p}-${x}`
  return {
    ...db,
    units: db.units.map((u) => ({ ...u, id: id(u.id) })),
    tenancies: db.tenancies.map((t) => ({ ...t, id: id(t.id), unitId: id(t.unitId) })),
    meters: db.meters.map((m) => ({ ...m, id: id(m.id), unitId: m.unitId === null ? null : id(m.unitId) })),
    readings: db.readings.map((r) => ({ ...r, id: id(r.id), meterId: id(r.meterId) })),
    payments: db.payments.map((x) => ({ ...x, id: id(x.id), tenancyId: id(x.tenancyId) })),
    costItems: db.costItems.map((c) => ({
      ...c,
      id: id(c.id),
      ...(c.directUnitId ? { directUnitId: id(c.directUnitId) } : {}),
      ...(c.customShares ? { customShares: Object.fromEntries(Object.entries(c.customShares).map(([k, v]) => [id(k), v])) } : {}),
    })),
  }
}

// Die Sammlungen eines Bestands, wie der Schnappschuss sie liest, mit einem Objekt an den Wurzeln.
function scopedSource(db: Db, propertyId: string): PropertyScopedSource {
  return {
    units: db.units.map((u) => ({ ...u, propertyId })),
    tenancies: db.tenancies,
    costItems: db.costItems.map((c) => ({ ...c, propertyId })),
    meters: db.meters.map((m) => ({ ...m, propertyId })),
    readings: db.readings,
    payments: db.payments,
    closedSettlements: [],
  }
}

const sourceOf = (db: Db): SnapshotSource => ({ ...scopedSource(db, 'x'), closedSettlements: [] })

function merged(a: PropertyScopedSource, b: PropertyScopedSource): PropertyScopedSource {
  return {
    units: [...a.units, ...b.units],
    tenancies: [...a.tenancies, ...b.tenancies],
    costItems: [...a.costItems, ...b.costItems],
    meters: [...a.meters, ...b.meters],
    readings: [...a.readings, ...b.readings],
    payments: [...a.payments, ...b.payments],
    closedSettlements: [...a.closedSettlements, ...b.closedSettlements],
  }
}

test('Invariante: mit zwei Objekten rechnet jedes, als wäre es allein', () => {
  const rnd = makeRng(92)
  for (let i = 0; i < 200; i++) {
    const a = prefixed(randomDb(rnd), 'A')
    const b = prefixed(randomDb(rnd), 'B')
    const beide = merged(scopedSource(a, 'objekt-a'), scopedSource(b, 'objekt-b'))
    for (const [allein, propertyId] of [[a, 'objekt-a'], [b, 'objekt-b']] as const) {
      const imVerbund = snapshotFor(beide, propertyId, 2025)
      const fuerSich = snapshotOf(sourceOf(allein), 2025)
      const fall = `Fall ${i}, ${propertyId}`
      assert.deepEqual(computeSettlement(imVerbund), computeSettlement(fuerSich), `${fall}: Abrechnung`)
      assert.deepEqual(rentLedger(imVerbund), rentLedger(fuerSich), `${fall}: Mietkonto`)
      assert.deepEqual(taxReport(imVerbund), taxReport(fuerSich), `${fall}: Steuer`)
      assert.deepEqual(consumptionOverview(imVerbund), consumptionOverview(fuerSich), `${fall}: Verbrauch`)
    }
  }
})

// Mietkonto im laufenden Jahr (Refs #133, zweite Browserabnahme): Monate ab dem laufenden sind noch
// nicht fällig und kein Rückstand. Dieselbe Regel wie beim Hinweis auf einen Rückstand.
test('Mietkonto mit Stichtag: künftige Monate sind „noch nicht fällig“ und kein Rückstand', () => {
  const db: Db = {
    ...emptyDb(),
    units: [{ id: 'a', name: 'EG', areaM2: 50, participates: true }],
    tenancies: [tenancy({ id: 't', unitId: 'a', tenantName: 'M', start: '2020-01-01', end: null, baseRents: [{ from: '2020-01', monthlyCents: 100000 }], prepayments: [] })],
    payments: [{ id: 'p', tenancyId: 't', date: '2026-09-03', amountCents: 900000 }],
  }
  const snapshot = snapshotFromDb(db, 2026)
  const heute = rentLedger(snapshot, { asOf: '2026-10-15' })
  const row = heute.rows[0]
  if (!row) return assert.fail('keine Zeile')
  assert.deepEqual(row.months.map((m) => m.status), [...Array(9).fill('paid'), 'notDue', 'notDue', 'notDue'])
  assert.equal(row.arrearsCents, 0)
  assert.equal(row.openMonths, 0)
  assert.equal(heute.totals.openCents, 0)
  // Ein fälliger Monat ohne Zahlung bleibt offen: Stichtag November, Oktober fehlt.
  const spaeter = rentLedger(snapshot, { asOf: '2026-11-15' })
  assert.equal(spaeter.rows[0]?.arrearsCents, 100000)
  assert.equal(spaeter.totals.openCents, 100000)
  // Ohne Stichtag ist das ganze Jahr fällig, wie bisher.
  assert.equal(rentLedger(snapshot).totals.openCents, 300000)
  // Das Soll und damit die Steuerübersicht hängen nicht am Stichtag.
  assert.equal(heute.totals.sollYearCents, 1200000)
  assert.equal(taxReport(snapshot).income.sollCents, 1200000)
})

test('Nicht umlagefähig: der gespeicherte Schlüssel ändert keine Zahl (#142)', () => {
  // Das Formular speichert für nicht umlagefähige Positionen jetzt die neutrale Vorgabe „area“
  // ohne Zuordnungen. Bestehende Positionen tragen irgendeinen Schlüssel; beides muss dieselben
  // Zahlen ergeben, in der Abrechnung, im Eigenanteil und in der Steuerübersicht.
  const withKey = (patch: Partial<CostItem>): Db => ({
    ...emptyDb(),
    units: [
      { id: 'u1', name: 'EG', areaM2: 80, participates: true },
      { id: 'u2', name: 'OG', areaM2: 60, participates: false, selfUsed: true, selfPersons: 2 },
    ],
    tenancies: [tenancy({ id: 't1', unitId: 'u1', tenantName: 'A', start: '2025-01-01' })],
    meters: [{ id: 'm1', unitId: 'u1', name: 'KW', type: 'kaltwasser', unit: 'm³' }],
    costItems: [
      { id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 70000, key: 'area' },
      { id: 'c2', year: 2025, category: 'Nicht umlagefähig', description: 'Verwaltung', amountCents: 36000, key: 'area', ...patch },
      { id: 'c3', year: 2025, category: RESERVE_CATEGORY, description: 'Rücklage', amountCents: 90000, key: 'area', ...patch },
    ],
  })
  const numbers = (db: Db) => {
    const s = computeSettlement(snapshotFromDb(db, 2025))
    const t = taxReport(snapshotFromDb(db, 2025))
    return {
      shares: s.statements.map((st) => [st.tenancyId, st.totalShareCents]),
      landlord: s.landlord.totalCents,
      self: s.selfUsedShareCents,
      total: s.totalCostsCents,
      tax: [t.expenses.totalCents, t.reserveContributionCents, t.selfUsedShareCents, t.surplusSollCents, t.surplusPaidCents],
    }
  }
  const neutral = numbers(withKey({}))
  for (const patch of [
    { key: 'persons' },
    { key: 'meter', meterType: 'kaltwasser' },
    { key: 'custom', customShares: { u1: 50, u2: 50 } },
  ] satisfies Partial<CostItem>[]) {
    assert.deepEqual(numbers(withKey(patch)), neutral, JSON.stringify(patch))
  }
  // **Die Direktzuordnung ist seit #163 eine Angabe für die Steuer**: Sie ordnet die Verwaltung der
  // eigenen Wohnung zu, die dann ganz privat ist (360 € statt 360 € × 60/140 = 154,29 €). Die
  // Abrechnung bleibt dieselbe, die Rücklage ebenso.
  const direkt = numbers(withKey({ key: 'direct', directUnitId: 'u2' }))
  assert.deepEqual({ ...direkt, tax: direkt.tax.slice(0, 3) }, { ...neutral, tax: neutral.tax.slice(0, 3) })
  assert.deepEqual(direkt.tax.slice(3), neutral.tax.slice(3).map((x) => x + (36000 - 15429)), 'weniger abziehbar, also mehr Überschuss')
})

test('§35a: ein gedeckelter Cent geht an die Zeile, die ihm am nächsten liegt (capToShares)', () => {
  // Rechnung 12 ct, Lohn 10 ct, davon tragen die Mieter 7 ct. Genaue Lohnanteile 2,32 / 0,34 / 2,85 / 1,14, Kostenanteile 3 / 0 / 4 / 1.
  // Das Restverfahren ergibt 2 / 1 / 3 / 1; die zweite Zeile wird auf 0 gedeckelt. Der freie Cent
  // gehört zu 2,32 (2 → 3, noch unter dem Aufrunden), nicht zu 2,85, die ihren Aufrundungs-Cent
  // schon hat (3 → 4 entfernte sie weiter vom genauen Wert).
  const exact = [2.32, 0.34, 2.85, 1.14]
  const keys = ['a', 'b', 'c', 'd']
  const parts = largestRemainder(7, exact, keys)
  assert.deepEqual(parts, [2, 1, 3, 1])
  assert.deepEqual(capToShares(parts, exact, [3, 0, 4, 1], keys), [3, 0, 3, 1])
  // Ohne Luft unterhalb des Aufrundens erst danach bis zum Kostenanteil; ohne jede Luft beim Vermieter.
  assert.deepEqual(capToShares([2, 1], [1.6, 0.4], [3, 0], ['a', 'b']), [3, 0])
  assert.deepEqual(capToShares([1, 1], [0.6, 0.4], [1, 0], ['a', 'b']), [1, 0])
})
