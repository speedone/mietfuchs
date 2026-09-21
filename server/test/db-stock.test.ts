// Der Bestand in der Datenbank: hineinschreiben (db/write.ts) und wieder herauslesen
// (db/read.ts), #55.
//
// Geprüft wird die Rundreise, und zwar an dem, worauf es ankommt: **Aus dem zurückgelesenen
// Bestand muss dieselbe Abrechnung entstehen wie aus der Datei.** Ein Vergleich der beiden
// Bestände selbst wäre schwächer und zugleich strenger als nötig — schwächer, weil er nichts
// über die Berechnung sagt, und strenger, weil ein `null` statt eines fehlenden Feldes dort als
// Unterschied zählte, obwohl keine Zahl davon abhängt.
//
// Die Reihenfolge bekommt einen eigenen Test. Sie ist kein Schönheitsfehler: Zwei Ablesungen
// mit demselben Datum ergeben je nach Reihenfolge einen anderen Verbrauch.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CostItem, Meter, Payment, Reading, Settings, Tenancy, Unit } from '../../shared/types.ts'
import { computeSettlement, consumptionOverview, rentLedger, taxReport } from '../src/calc.ts'
import { straightenForDatabase } from '../src/legacy.ts'
import { snapshotFromDb, snapshotOf } from '../src/snapshot.ts'
import type { Db } from '../src/store.ts'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { writeStock } from '../src/db/write.ts'

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
        settlement: {
          year: 2023, daysInYear: 365, statements: [], landlord: { rows: [], totalCents: 900 },
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
