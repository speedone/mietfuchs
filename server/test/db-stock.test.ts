// Der Bestand in der Datenbank: hineinschreiben (db/write.ts) und wieder herauslesen
// (db/read.ts), #55.
//
// Geprüft wird die Rundreise, und zwar auf zwei Weisen, weil eine allein nicht reicht.
//
// **Erstens an dem, worauf das Geld ankommt: Aus dem zurückgelesenen Bestand muss dieselbe
// Abrechnung entstehen wie aus der Datei.** Das ist die Zusage des Umstiegs, und sie prüft sich
// am besten rechnend.
//
// **Zweitens feldweise über den ganzen Bestand.** Das ist nicht dasselbe und auch nicht
// überflüssig: In den Schnappschuss geht nur, was die Berechnung liest. IBAN, Kaution,
// Vertragsdatum, Notizen, Zimmerzahl, Etage, Lieferant, Belegdatei und Zählernummer stehen in
// keiner Rechnung. Fiele eines davon aus dem Lese- oder Schreibpfad heraus, bliebe der erste
// Test grün, der Übersetzer schwiege (sie sind alle optional, ein fehlendes optionales Feld ist
// kein Typfehler), und die Regression des Umstiegs sähe es ebenfalls nicht. Gemessen: Entfernt
// man `notes` aus read.ts, bleiben Typprüfung und alle 487 Tests grün. Der Umstieg verspricht
// aber, dass nichts verloren geht, und das ist der Test dafür.
//
// Die Reihenfolge bekommt einen eigenen Test. Sie ist kein Schönheitsfehler: Zwei Ablesungen
// mit demselben Datum ergeben je nach Reihenfolge einen anderen Verbrauch.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getTableColumns } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { CostItem, Meter, Payment, Reading, Settings, Tenancy, Unit } from '../../shared/types.ts'
import { computeSettlement, consumptionOverview, rentLedger, taxReport } from '../src/calc.ts'
import { straightenForDatabase } from '../src/legacy.ts'
import { snapshotFromDb, snapshotOf } from '../src/snapshot.ts'
import type { Db } from '../src/store.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { writeStock } from '../src/legacy/write.ts'
import {
  costItems as costItemsTable, meters as metersTable, payments as paymentsTable,
  readings as readingsTable, tenancies as tenanciesTable, units as unitsTable,
} from '../src/db/schema.ts'

// ---------- Ein Bestand, in dem alle vier Rechnungen etwas zu tun haben ----------

const settings = (): Settings => ({
  houseName: 'Haus', address: 'Weg 1', landlordName: 'Vermieter', iban: 'DE02', paymentDeadlineDays: 30,
  ollamaUrl: 'http://localhost:11434', ollamaModel: 'modell',
})
const unit = (u: Partial<Unit> & Pick<Unit, 'id'>): Unit => ({ name: 'EG', areaM2: 80, participates: true, ...u })
const tenancy = (t: Partial<Tenancy> & Pick<Tenancy, 'id' | 'unitId'>): Tenancy => ({
  tenantName: 'Müller', persons: 2, personHistory: [{ from: '2024-01-01', persons: 2 }],
  start: '2024-01-01', end: null, prepayments: [{ from: '2024-01', monthlyCents: 15000 }],
  prepaymentOverrides: {}, baseRents: [{ from: '2024-01', monthlyCents: 60000 }], ...t,
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

function fullDb(): Db {
  return {
    settings: settings(),
    units: [
      unit({ id: 'u1', rooms: 3, floor: 'EG', notes: 'Notiz' }),
      unit({ id: 'u2', name: 'OG', areaM2: 60 }),
      unit({ id: 'u3', name: 'Dach', areaM2: 40, participates: false, selfUsed: true, selfPersons: 2 }),
    ],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', prepaymentOverrides: { '2024': 170000 },
        email: 'a@b.de', phone: '0123', iban: 'DE01', contractDate: '2023-12-01',
        depositCents: 180000, depositStatus: 'erhalten', notes: 'Notiz',
      }),
      tenancy({
        id: 't2', unitId: 'u2', tenantName: 'Schmidt', persons: 3, start: '2024-04-01', end: '2024-10-31',
        personHistory: [{ from: '2024-04-01', persons: 3 }, { from: '2024-08-01', persons: 1 }],
        prepayments: [{ from: '2024-04', monthlyCents: 12000 }, { from: '2024-09', monthlyCents: 14000 }],
        baseRents: [{ from: '2024-04', monthlyCents: 50000 }],
      }),
    ],
    costItems: [
      costItem({ id: 'c1', labor35aCents: 3000, vendor: 'Stadt', invoiceFile: 'beleg.pdf' }),
      costItem({ id: 'c2', description: 'Hausreinigung', amountCents: 24000, key: 'units' }),
      costItem({ id: 'c3', description: 'Wasser', amountCents: 30000, key: 'meter', meterType: 'kaltwasser' }),
      costItem({ id: 'c4', description: 'Gartenpflege', amountCents: 18000, key: 'persons' }),
      costItem({ id: 'c5', description: 'Aufzug', amountCents: 50000, key: 'custom', customShares: { u1: 60, u2: 30 } }),
      costItem({ id: 'c6', description: 'Rohrbruch', amountCents: 30000, key: 'direct', directUnitId: 'u1' }),
      costItem({ id: 'c7', description: 'Gutschrift', amountCents: -5000, key: 'area' }),
      costItem({ id: 'c8', year: 2023, description: 'Vorjahr', amountCents: 9000, key: 'area' }),
    ],
    meters: [
      meter({ id: 'm1', unitId: 'u1', meterNumber: '4711' }),
      meter({ id: 'm2', unitId: 'u2', name: 'Bad' }),
      meter({ id: 'm3', unitId: null, name: 'Hauptzähler', type: 'strom', unit: 'kWh' }),
    ],
    readings: [
      reading({ id: 'r1', meterId: 'm1', date: '2023-12-31', value: 100 }),
      reading({ id: 'r2', meterId: 'm1', date: '2024-06-30', value: 130, replacement: true, oldEndValue: 128, note: 'Wechsel' }),
      reading({ id: 'r3', meterId: 'm1', date: '2024-12-31', value: 160 }),
      reading({ id: 'r4', meterId: 'm2', date: '2023-12-31', value: 200 }),
      reading({ id: 'r5', meterId: 'm2', date: '2024-12-31', value: 240.5 }),
      reading({ id: 'r6', meterId: 'm3', date: '2024-12-31', value: 8000 }),
    ],
    payments: [
      payment({ id: 'p1', tenancyId: 't1', amountCents: 750000 }),
      payment({ id: 'p2', tenancyId: 't1', date: '2024-07-05', amountCents: -15000, note: 'Rücklastschrift' }),
      payment({ id: 'p3', tenancyId: 't2', date: '2024-04-05', amountCents: 62000 }),
    ],
    closedSettlements: [
      {
        id: 's1', year: 2023, closedAt: '2024-03-01T10:00:00.000Z', sentAt: '2024-03-05T09:00:00.000Z',
        // **Mit Statements, und das ist kein Beiwerk.** Aus dem eingefrorenen Stand liest die
        // Steuerübersicht neben dem Eigenanteil die Vorauszahlungen der zugestellten Abrechnung
        // (#70). Stand hier eine leere Liste, lieferten beide Wege 0, und ein Leser, der immer 0
        // liefert, wäre grün durchgekommen — nachgemessen. Eine nach dem Umstieg abgeschlossene
        // Abrechnung steht nur in der Datenbank, die Regression sieht sie also nie.
        settlement: {
          year: 2023, daysInYear: 365,
          statements: [
            {
              tenancyId: 't1', tenantName: 'Alt', unitId: 'u1', unitName: 'EG',
              persons: 2, personDays: 730, days: 365,
              periodStart: '2023-01-01', periodEnd: '2023-12-31',
              rows: [], totalShareCents: 8000, total35aCents: 0,
              prepaymentCents: 12000, prepaymentOverridden: true,
              balanceCents: 4000, suggestedMonthlyCents: 15000,
            },
            {
              tenancyId: 't2', tenantName: 'Neu', unitId: 'u2', unitName: 'OG',
              persons: 1, personDays: 365, days: 365,
              periodStart: '2023-01-01', periodEnd: '2023-12-31',
              rows: [], totalShareCents: 1000, total35aCents: 0,
              prepaymentCents: 3000, prepaymentOverridden: false,
              balanceCents: 2000, suggestedMonthlyCents: 4000,
            },
          ],
          landlord: { rows: [], totalCents: 900 },
          selfUsedShareCents: 400, totalCostsCents: 9000, warnings: ['ein Hinweis'],
        },
      },
    ],
  }
}

// ---------- Werkzeug ----------

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-stock-'))

// Eine offene Datenbank auf einem Wegwerf-Ordner, sauber geschlossen und gelöscht.
async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Alles, was Mietfuchs aus einem Bestand rechnet, für ein Jahr.
function resultsOfSnapshot(snapshot: ReturnType<typeof snapshotFromDb>) {
  return {
    settlement: computeSettlement(snapshot),
    ledger: rentLedger(snapshot),
    tax: taxReport(snapshot),
    consumption: consumptionOverview(snapshot),
  }
}

// ---------- Die Rundreise ----------

test('Rundreise: aus der Datenbank kommt dieselbe Abrechnung wie aus der Datei', async () => {
  await withDatabase(async (opened) => {
    const file = fullDb()
    const gerade = straightenForDatabase(file)
    await writeStock(opened.db, gerade)
    const stock = await readStock(opened.db)
    for (const year of [2023, 2024, 2025]) {
      assert.deepEqual(
        resultsOfSnapshot(snapshotOf(stock, year)),
        resultsOfSnapshot(snapshotFromDb(gerade, year)),
        `Jahr ${year}`,
      )
    }
  })
})

test('Rundreise: der eingefrorene Berechnungsstand kommt wortgleich zurück', async () => {
  // Ein Archivstück: Es ist das, was dem Mieter zugestellt wurde, und lässt sich nicht noch
  // einmal ausrechnen. Deshalb steht es als JSON in einer Spalte, und deshalb wird hier
  // verglichen, was hineinging und was herauskommt.
  await withDatabase(async (opened) => {
    const gerade = straightenForDatabase(fullDb())
    await writeStock(opened.db, gerade)
    const stock = await readStock(opened.db)
    assert.equal(stock.closedSettlements.length, 1)
    assert.deepEqual(stock.closedSettlements[0].settlement, gerade.closedSettlements[0].settlement)
    assert.equal(stock.closedSettlements[0].sentAt, '2024-03-05T09:00:00.000Z')
    assert.equal(stock.closedSettlements[0].closedAt, '2024-03-01T10:00:00.000Z')

    // **Der Auszug daraus, und zwar an Zahlen, die nicht null sind.** Aus dem Archivstück liest
    // die Steuerübersicht den Eigenanteil und die Vorauszahlungen der zugestellten Abrechnung
    // (#70). Solange die Statements der Vorlage leer waren, lieferte jeder Leser 0, auch einer,
    // der gar nichts täte — nachgemessen: Ein Leser, der fest `{ cents: 0, overridden: false }`
    // zurückgab, kam grün durch. Genau dieser Weg ist der Produktivweg, denn eine nach dem
    // Umstieg abgeschlossene Abrechnung steht nur in der Datenbank.
    assert.equal(stock.closedSettlements[0].selfUsedShareCents, 400)
    assert.equal(stock.closedSettlements[0].prepaymentCents, 15000, '12.000 + 3.000 aus den beiden Statements')
    assert.equal(stock.closedSettlements[0].prepaymentOverridden, true, 'ein Statement trägt die Jahreskorrektur')

    // Und beide Wege in den Schnappschuss sagen dasselbe. Zwei Leser desselben Archivstücks, die
    // sich uneinig sind, fielen erst beim Umstieg als „Abrechnung weicht ab" auf.
    assert.deepEqual(
      snapshotOf(stock, 2023).closedSettlement,
      snapshotFromDb(gerade, 2023).closedSettlement,
      'Datei und Datenbank lesen den eingefrorenen Stand verschieden',
    )
  })
})

test('Rundreise: die Einstellungen samt KI-Plätzen kommen zurück', async () => {
  await withDatabase(async (opened) => {
    const file = fullDb()
    file.settings.printAttachments = true
    file.settings.updateCheck = 'on'
    const gerade = straightenForDatabase(file)
    gerade.settings.ai.images = { provider: 'openai', preset: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-4o', vision: true }
    gerade.settings.ai.consent = { images: { url: 'https://api.openai.com/v1', model: 'gpt-4o', date: '2025-01-01' } }
    gerade.settings.ai.timeoutSeconds = 600
    await writeStock(opened.db, gerade)
    const stock = await readStock(opened.db)
    assert.deepEqual(stock.settings, gerade.settings)
  })
})

test('Rundreise: die Reihenfolge der Datei bleibt erhalten', async () => {
  // Zwei Ablesungen mit demselben Datum: Die Berechnung sortiert nach Datum und lässt bei
  // Gleichstand die Reihenfolge der Datei stehen. Der Verbrauch hängt daran, welcher der beiden
  // Stände der spätere ist — käme die Datenbank sie anders zurück, wanderte Geld.
  await withDatabase(async (opened) => {
    const file = fullDb()
    file.readings = [
      reading({ id: 'r1', meterId: 'm1', date: '2023-12-31', value: 100 }),
      reading({ id: 'r2', meterId: 'm1', date: '2024-06-30', value: 111 }),
      reading({ id: 'r3', meterId: 'm1', date: '2024-06-30', value: 122 }),
      reading({ id: 'r4', meterId: 'm1', date: '2024-12-31', value: 160 }),
    ]
    const gerade = straightenForDatabase(file)
    await writeStock(opened.db, gerade)
    const stock = await readStock(opened.db)
    assert.deepEqual(stock.readings.map((r) => r.value), [100, 111, 122, 160])
    assert.deepEqual(stock.units.map((u) => u.id), ['u1', 'u2', 'u3'])
    assert.deepEqual(stock.costItems.map((c) => c.id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'])
    assert.deepEqual(
      resultsOfSnapshot(snapshotOf(stock, 2024)).consumption,
      resultsOfSnapshot(snapshotFromDb(gerade, 2024)).consumption,
    )
  })
})

// ---------- Feldtreue ----------

// Ein Bestand, in dem **jedes** Feld des Datenmodells einen eigenen, wiedererkennbaren Wert
// trägt, auch jedes optionale. Kein Feld bleibt hier absichtlich leer: Ein leeres Feld könnte
// nicht verloren gehen, und genau darum geht es.
//
// Die eine Kostenposition trägt alle Felder zugleich, auch solche, die fachlich nicht
// zusammenpassen (eine Direktzuordnung neben einem Zählertyp und vereinbarten Anteilen). Das ist
// Absicht: Geprüft wird die Treue der Übertragung und nicht die Sinnhaftigkeit der Eingabe, und
// jedes Feld, das hier fehlte, wäre eines, das der Test nicht bewachen kann.
function everyFieldDb(): Db {
  return {
    settings: settings(),
    units: [
      unit({ id: 'u1', name: 'EG links', areaM2: 80, participates: true, selfUsed: false, selfPersons: 1, rooms: 3, floor: 'EG', notes: 'Notiz zur Wohnung' }),
      unit({ id: 'u2', name: 'OG rechts', areaM2: 60, participates: false, selfUsed: true, selfPersons: 2, rooms: 2, floor: '1. OG', notes: 'selbst bewohnt' }),
    ],
    tenancies: [
      tenancy({
        id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2,
        personHistory: [{ from: '2024-01-01', persons: 2 }],
        start: '2024-01-01', end: '2024-12-31',
        prepayments: [{ from: '2024-01', monthlyCents: 15000 }],
        prepaymentOverrides: { '2024': 170000 },
        baseRents: [{ from: '2024-01', monthlyCents: 60000 }],
        email: 'mueller@example.org', phone: '0123 456789',
        correspondenceAddress: 'Neue Straße 5, 12345 Anderswo',
        iban: 'DE02120300000000202051', contractDate: '2023-12-01',
        depositCents: 180000, depositStatus: 'erhalten', notes: 'Notiz zum Mietverhältnis',
      }),
    ],
    costItems: [
      costItem({
        id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Abfallgebühren',
        vendor: 'Firma Meier', amountCents: 12000, key: 'direct', directUnitId: 'u1',
        meterType: 'kaltwasser', customShares: { u1: 60, u2: 40 },
        labor35aCents: 4000, invoiceFile: 'beleg-2024-01.pdf',
      }),
    ],
    meters: [meter({ id: 'm1', name: 'Küche', unitId: 'u1', type: 'kaltwasser', meterNumber: 'ABC-123', unit: 'm³' })],
    readings: [
      reading({ id: 'r1', meterId: 'm1', date: '2023-12-31', value: 100, replacement: false, oldEndValue: 0, note: 'Jahresablesung' }),
      reading({ id: 'r2', meterId: 'm1', date: '2024-12-31', value: 160, replacement: true, oldEndValue: 155, note: 'Zählerwechsel' }),
    ],
    payments: [payment({ id: 'p1', tenancyId: 't1', date: '2024-01-05', amountCents: 75000, note: 'Dauerauftrag' })],
    closedSettlements: [],
  }
}

// Jede Sammlung mit ihrer Tabelle. Aus den Spalten leitet der Test seine Erwartung ab, statt
// eine Liste von Feldnamen danebenzuschreiben: Eine solche Liste vergisst der nächste, der eine
// Spalte hinzufügt, und dann bewacht der Test genau das Neue nicht.
const collectionsWithTable = (stock: ReturnType<typeof straightenForDatabase>): { what: string, table: SQLiteTable, rows: readonly unknown[] }[] => [
  { what: 'Wohnungen', table: unitsTable, rows: stock.units },
  { what: 'Mietverhältnisse', table: tenanciesTable, rows: stock.tenancies },
  { what: 'Kostenpositionen', table: costItemsTable, rows: stock.costItems },
  { what: 'Zähler', table: metersTable, rows: stock.meters },
  { what: 'Ablesungen', table: readingsTable, rows: stock.readings },
  { what: 'Zahlungen', table: paymentsTable, rows: stock.payments },
]

test('Rundreise: die Probe belegt jede Spalte des Schemas', () => {
  // Der Wächter über dem Wächter. Der Test darunter kann nur finden, was in der Probe steht;
  // kommt eine Spalte hinzu und niemand belegt sie, wäre er still wirkungslos. Hier schlägt er
  // dann fehl und sagt, welches Feld in `everyFieldDb` fehlt.
  const stock = straightenForDatabase(everyFieldDb())
  for (const { what, table, rows } of collectionsWithTable(stock)) {
    for (const column of Object.keys(getTableColumns(table))) {
      const belegt = rows.some((row) => row !== null && typeof row === 'object' && Reflect.get(row, column) !== undefined)
      assert.ok(belegt, `${what}: „${column}" ist in everyFieldDb nicht belegt, der Test bewacht das Feld deshalb nicht`)
    }
  }
})

test('Rundreise: jedes Feld des Datenmodells kommt zurück', async () => {
  // Die Felder, die in keine Rechnung eingehen. Geht eines verloren, merkt es weder die
  // Abrechnung noch die Regression des Umstiegs, sondern erst der Vermieter, wenn er Monate
  // später die IBAN seines Mieters sucht.
  await withDatabase(async (opened) => {
    const gerade = straightenForDatabase(everyFieldDb())
    await writeStock(opened.db, gerade)
    const stock = await readStock(opened.db)
    assert.deepStrictEqual(stock.units, gerade.units, 'Wohnungen')
    assert.deepStrictEqual(stock.tenancies, gerade.tenancies, 'Mietverhältnisse')
    assert.deepStrictEqual(stock.costItems, gerade.costItems, 'Kostenpositionen')
    assert.deepStrictEqual(stock.meters, gerade.meters, 'Zähler')
    assert.deepStrictEqual(stock.readings, gerade.readings, 'Ablesungen')
    assert.deepStrictEqual(stock.payments, gerade.payments, 'Zahlungen')
  })
})

test('Schreiben: ein leerer Bestand legt nur die Einstellungen an', async () => {
  await withDatabase(async (opened) => {
    const leer = straightenForDatabase({
      settings: settings(), units: [], tenancies: [], costItems: [], meters: [], readings: [],
      payments: [], closedSettlements: [],
    })
    const counts = await writeStock(opened.db, leer)
    assert.equal(counts.units, 0)
    assert.equal(counts.readings, 0)
    const stock = await readStock(opened.db)
    assert.deepEqual(stock.units, [])
    assert.equal(stock.settings.houseName, 'Haus')
  })
})

test('Schreiben: gezählt wird, was wirklich angekommen ist', async () => {
  await withDatabase(async (opened) => {
    const gerade = straightenForDatabase(fullDb())
    const counts = await writeStock(opened.db, gerade)
    assert.deepEqual(counts, {
      units: 3,
      tenancies: 2,
      personHistory: 3,
      prepayments: 3,
      baseRents: 2,
      prepaymentOverrides: 1,
      costItems: 8,
      costItemShares: 2,
      meters: 3,
      readings: 6,
      payments: 3,
      closedSettlements: 1,
    })
  })
})

test('Schreiben: ein Fehler mittendrin lässt nichts halb Geschriebenes zurück', async () => {
  // Alles in einer Transaktion: Scheitert ein Datensatz, ist auch der erste wieder weg. Sonst
  // stünde in der Datenbank ein halber Bestand, den niemand als halb erkennt.
  await withDatabase(async (opened) => {
    const kaputt = straightenForDatabase(fullDb())
    // Eine Ablesung ohne Zähler: Das lehnt die Fremdschlüsselprüfung ab, und zwar erst, nachdem
    // die Wohnungen längst geschrieben sind.
    kaputt.readings[5].meterId = 'diesen-zaehler-gibt-es-nicht'
    await assert.rejects(
      () => writeStock(opened.db, kaputt),
      (err: unknown) => {
        // Drizzle verpackt jeden Fehler von SQLite in einen eigenen und hängt den echten Grund
        // als `cause` daran. Geprüft wird die ganze Kette, sonst stünde hier nur „Failed query".
        const texte: string[] = []
        let current: unknown = err
        while (current instanceof Error) {
          texte.push(current.message)
          current = current.cause
        }
        assert.match(texte.join(' | '), /FOREIGN KEY/i, 'aus einem anderen Grund gescheitert')
        return true
      },
    )
    const stock = await readStock(opened.db)
    assert.deepEqual(stock.units, [], 'die Wohnungen von vorher sind mit zurückgerollt')
    assert.deepEqual(stock.costItems, [])
  })
})
