// Der Umstieg der vorhandenen Daten in die Datenbank (db/changeover.ts, #55).
//
// Hier werden zum ersten Mal echte Daten bewegt, und zwar die eines Menschen, der damit seine
// Nebenkostenabrechnung macht. Zwei Zusagen hängen an dieser Datei, und jede hat ihre eigene
// Gruppe von Tests:
//
//   1. **Weicht ein einziger Cent ab, wird nicht aktiviert.** Es bleibt alles, wie es war.
//   2. **Scheitert irgendein Schritt, ist der alte Zustand unberührt**, und Mietfuchs arbeitet
//      mit der db.json weiter wie bisher. Das wird je Schritt geprüft und nicht pauschal: Jeder
//      Schritt hat seinen eigenen Test, denn jeder kann auf seine eigene Weise etwas
//      liegenlassen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CostItem, Meter, Payment, Reading, Settings, Tenancy, Unit } from '../../shared/types.ts'
import { rentLedger } from '../src/calc.ts'
import { snapshotOf } from '../src/snapshot.ts'
import type { Db } from '../src/store.ts'
import { databaseFile, openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { writeStock } from '../src/db/write.ts'
import { actualOfSnapshot, loadFixtures } from '../testing/fixtures.ts'
import { straightenForDatabase } from '../src/legacy.ts'
import { LEGACY_JSON_NAME, PROTOCOL_NAME, runChangeover, TEMP_NAME, type ChangeoverHooks } from '../src/db/changeover.ts'
import { yearsToCheck } from '../src/db/regression.ts'
import { closedSettlements, costItems, units } from '../src/db/schema.ts'

// ---------- Bausteine ----------

const settings = (): Settings => ({
  houseName: 'Haus', address: 'Weg 1', landlordName: 'Vermieter', iban: '', paymentDeadlineDays: 30,
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
  ({ date: '2024-01-05', amountCents: 75000, ...p })

function fullDb(): Db {
  return {
    settings: settings(),
    units: [unit({ id: 'u1' }), unit({ id: 'u2', name: 'OG', areaM2: 60 })],
    tenancies: [
      tenancy({ id: 't1', unitId: 'u1' }),
      tenancy({ id: 't2', unitId: 'u2', tenantName: 'Schmidt', persons: 3, personHistory: [{ from: '2024-01-01', persons: 3 }] }),
    ],
    costItems: [
      costItem({ id: 'c1' }),
      costItem({ id: 'c2', description: 'Wasser', amountCents: 30000, key: 'meter', meterType: 'kaltwasser' }),
      costItem({ id: 'c3', year: 2023, description: 'Vorjahr', amountCents: 9000, key: 'units' }),
    ],
    meters: [meter({ id: 'm1', unitId: 'u1' }), meter({ id: 'm2', unitId: 'u2', name: 'Bad' })],
    readings: [
      reading({ id: 'r1', meterId: 'm1', date: '2023-12-31', value: 100 }),
      reading({ id: 'r2', meterId: 'm1', date: '2024-12-31', value: 160 }),
      reading({ id: 'r3', meterId: 'm2', date: '2023-12-31', value: 200 }),
      reading({ id: 'r4', meterId: 'm2', date: '2024-12-31', value: 240 }),
    ],
    payments: [payment({ id: 'p1', tenancyId: 't1' }), payment({ id: 'p2', tenancyId: 't2', amountCents: 60000 })],
    closedSettlements: [],
  }
}

// ---------- Werkzeug ----------

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-umstieg-'))
const dbFile = (dataDir: string): string => path.join(dataDir, 'db.json')
const writeFile = (dataDir: string, content: unknown): void =>
  fs.writeFileSync(dbFile(dataDir), typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8')

// Ein Umstieg auf einem Wegwerf-Ordner, mit allem, was danach noch zu prüfen ist. Die Datenbank
// wird am Ende geschlossen, sonst ließe sich der Ordner unter Windows nicht löschen.
async function changeoverIn(
  dataDir: string,
  check: (result: Awaited<ReturnType<typeof runChangeover>>, database: OpenedDatabase | null) => Promise<void>,
  hooks?: ChangeoverHooks,
): Promise<void> {
  const opened = await openDatabase({ dataDir })
  const result = await runChangeover({ dataDir, opened, reopen: () => openDatabase({ dataDir }), hooks })
  try {
    await check(result, result.database)
  } finally {
    result.database?.close()
  }
}

// Was in der Datenbank steht, unabhängig vom Umstieg gelesen.
async function stockOf(dataDir: string) {
  const opened = await openDatabase({ dataDir })
  try {
    return await readStock(opened.db)
  } finally {
    opened.close()
  }
}

const removeDir = (dir: string): void => fs.rmSync(dir, { recursive: true, force: true })

// ---------- Wann überhaupt etwas geschieht ----------

test('Ohne db.json geschieht nichts, und es entsteht auch nichts', async () => {
  const dataDir = tempDir()
  try {
    await changeoverIn(dataDir, async (result) => {
      assert.equal(result.state, 'none', result.message)
      assert.equal(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), false)
      assert.equal(fs.existsSync(path.join(dataDir, PROTOCOL_NAME)), false)
    })
    assert.deepEqual((await stockOf(dataDir)).units, [])
  } finally {
    removeDir(dataDir)
  }
})

test('Eine gefüllte Datenbank wird nicht angerührt', async () => {
  // Der Umstieg ist einmalig. Liegen schon Daten in der Datenbank, hat entweder ein früherer
  // Lauf sie hineingeschrieben oder eine neuere Version arbeitet damit; in beiden Fällen wäre
  // ein zweiter Umstieg ein Überschreiben.
  const dataDir = tempDir()
  try {
    const vorhanden = await openDatabase({ dataDir })
    const anderer = straightenForDatabase({ ...fullDb(), units: [unit({ id: 'schon-da', name: 'Bestand' })], tenancies: [], costItems: [], meters: [], readings: [], payments: [] })
    await writeStock(vorhanden.db, anderer)
    vorhanden.close()

    writeFile(dataDir, fullDb())
    await changeoverIn(dataDir, async (result) => {
      assert.equal(result.state, 'none')
      assert.match(result.message, /enthält bereits/)
      // **Und der Nutzer erfährt, dass da eine db.json liegt.** Ein gelungener Umstieg benennt
      // sie um, hier liegt also eine, die Mietfuchs nicht hinterlassen hat. Zwei Lagen führen
      // dorthin und verlangen entgegengesetzte Antworten: Jemand hat eine alte Sicherung von
      // Hand hereinkopiert (übernehmen wäre falsch), oder jemand hat mit einer Zwischenfassung
      // gearbeitet, die noch in die Datei schrieb (ignorieren wäre falsch). Mietfuchs entscheidet
      // das nicht, es sagt, was es vorfindet, und nennt den einen Weg, auf dem geprüft wird,
      // bevor etwas ersetzt ist.
      assert.match(result.message, /db\.json/, 'die Meldung verschweigt die vorgefundene Datei')
      assert.match(result.message, /Backup/, 'die Meldung nennt keinen Weg')
    })
    const stock = await stockOf(dataDir)
    assert.deepEqual(stock.units.map((u) => u.id), ['schon-da'], 'der vorhandene Bestand ist unverändert')
    assert.equal(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), false)
  } finally {
    removeDir(dataDir)
  }
})

// ---------- Der gelungene Umstieg ----------

test('Ein gewöhnlicher Bestand wandert vollständig hinüber', async () => {
  const dataDir = tempDir()
  try {
    const file = fullDb()
    writeFile(dataDir, file)
    const vorher = fs.readFileSync(dbFile(dataDir), 'utf8')

    await changeoverIn(dataDir, async (result, database) => {
      assert.equal(result.state, 'done', result.message)
      assert.ok(database, 'die Datenbank steht danach wieder offen')
      // Ein Satz, keine Fehlermeldung, keine Rückfrage.
      assert.match(result.message, /Datenbank/)
      assert.match(result.message, /db\.json/)
    })

    const stock = await stockOf(dataDir)
    assert.deepEqual(stock.units.map((u) => u.id), ['u1', 'u2'])
    assert.deepEqual(stock.costItems.map((c) => c.id), ['c1', 'c2', 'c3'])
    assert.equal(stock.readings.length, 4)
    assert.equal(stock.settings.houseName, 'Haus')

    // **Die db.json heißt danach nicht mehr so.** Ihr Inhalt bleibt unverändert der Rückweg,
    // aber unter einem Namen, den niemand für den laufenden Stand hält: Seit die Routen die
    // Datenbank schreiben, liegt sie tot im Ordner, sähe aber aus wie vorher. Wer hineinschaut,
    // soll ohne Erklärung erkennen, welche Datei gilt.
    assert.equal(fs.existsSync(dbFile(dataDir)), false, 'die db.json liegt noch unter ihrem alten Namen da')
    assert.equal(fs.readFileSync(path.join(dataDir, LEGACY_JSON_NAME), 'utf8'), vorher)
    // Und ein Protokoll, das nennt, was übernommen wurde.
    const protokoll = fs.readFileSync(path.join(dataDir, PROTOCOL_NAME), 'utf8')
    assert.match(protokoll, /2 Wohnungen/)
    assert.match(protokoll, /3 Kostenpositionen/)
    assert.match(protokoll, /2023/, 'die geprüften Jahre stehen dabei')
    // Die Datei für den Umstieg ist wieder weg.
    assert.equal(fs.existsSync(path.join(dataDir, TEMP_NAME)), false)
  } finally {
    removeDir(dataDir)
  }
})

test('Ein leerer Bestand wandert ebenso hinüber', async () => {
  // Der erste Start nach dem Update bei jemandem, der Mietfuchs nur angesehen hat: Die db.json
  // gibt es, sie enthält aber nur die Vorgabewerte.
  const dataDir = tempDir()
  try {
    writeFile(dataDir, { settings: settings(), units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [] })
    await changeoverIn(dataDir, async (result) => {
      assert.equal(result.state, 'done', result.message)
    })
    assert.equal((await stockOf(dataDir)).settings.houseName, 'Haus')
  } finally {
    removeDir(dataDir)
  }
})

test('Der feste Monatsbetrag wandert mit, und der Nutzer erfährt, dass sich das Mietkonto ändert', async () => {
  // Der eine hingenommene Fall, der eine Zahl bewegt. Ohne ihn verlöre der Mieter seine ganze
  // Vorauszahlung, und die Abrechnung sähe danach stimmig aus.
  const dataDir = tempDir()
  try {
    const file = fullDb()
    const alt: Tenancy & { prepaymentMonthlyCents?: number } = file.tenancies[1]
    alt.prepayments = []
    alt.prepaymentMonthlyCents = 12000
    writeFile(dataDir, file)

    await changeoverIn(dataDir, async (result) => {
      assert.equal(result.state, 'done', result.message)
      const hinweise = result.notes.join(' ')
      assert.match(hinweise, /Monatsbetrag/)
      assert.match(hinweise, /Mietkonto/, 'der Nutzer muss von der Änderung erfahren')
    })

    const stock = await stockOf(dataDir)
    const ledger = rentLedger(snapshotOf(stock, 2024))
    const zeile = ledger.rows.find((r) => r.tenancyId === 't2')
    if (!zeile) return assert.fail('die Zeile des Mietkontos fehlt')
    assert.equal(zeile.prepaymentYearCents, 12 * 12000, 'das Mietkonto rechnet jetzt mit der Vorauszahlung')
    assert.match(fs.readFileSync(path.join(dataDir, PROTOCOL_NAME), 'utf8'), /Monatsbetrag/)
  } finally {
    removeDir(dataDir)
  }
})

test('Zwei Staffeleinträge zum selben Stichtag: übernommen wird der letzte, wie ihn die Abrechnung liest', async () => {
  // Über die Oberfläche erzeugbar (zwei Zeilen ohne Monatsangabe tragen denselben
  // Einzugsmonat ein, siehe legacy.ts), in der Datenbank aber nur einmal speicherbar: der
  // Stichtag ist Teil des Primärschlüssels. Träfe `lastPerFrom` die falsche Wahl, bekäme die
  // Datenbank den ersten statt des letzten Eintrags, und die Regression läse aus der
  // unveränderten Datei weiterhin richtig den letzten (siehe `computePrepaymentCents` in
  // calc.ts) — die beiden Stände wichen voneinander ab, und der Umstieg bräche ab, statt eine
  // falsche Vorauszahlung zu aktivieren.
  const dataDir = tempDir()
  try {
    const file = fullDb()
    file.tenancies[1].prepayments = [
      { from: '2024-01', monthlyCents: 10000 },
      { from: '2024-01', monthlyCents: 25000 },
    ]
    writeFile(dataDir, file)

    await changeoverIn(dataDir, async (result) => {
      assert.equal(result.state, 'done', result.message)
    })

    const stock = await stockOf(dataDir)
    const ledger = rentLedger(snapshotOf(stock, 2024))
    const zeile = ledger.rows.find((r) => r.tenancyId === 't2')
    if (!zeile) return assert.fail('die Zeile des Mietkontos fehlt')
    assert.equal(zeile.prepaymentYearCents, 12 * 25000, 'übernommen wird der letzte Eintrag, nicht der erste')
  } finally {
    removeDir(dataDir)
  }
})

// ---------- Jeder Abbruch einzeln ----------

test('Abbruch: eine unlesbare db.json', async () => {
  const dataDir = tempDir()
  try {
    writeFile(dataDir, '{ das ist kein JSON')
    await changeoverIn(dataDir, async (result) => {
      assert.equal(result.state, 'failed')
      assert.match(result.message, /db\.json/)
      assert.match(result.message, /nächsten Start wird es erneut versucht/, 'die Meldung sagt, wie es weitergeht')
    })
    assert.deepEqual((await stockOf(dataDir)).units, [], 'es wurde nichts geschrieben')
    assert.equal(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), false)
  } finally {
    removeDir(dataDir)
  }
})

test('Abbruch: ein negativer Zählerstand wird benannt, damit er sich berichtigen lässt', async () => {
  // Über die Oberfläche erzeugbar, und deshalb ist ein bloßes Nein die falsche Antwort: Der
  // Vermieter stünde vor einer Ablehnung für etwas, das Mietfuchs ihm selbst erlaubt hat. Die
  // Meldung muss sagen, welche Ablesung er berichtigen soll.
  const dataDir = tempDir()
  try {
    const file = fullDb()
    file.readings[1].value = -5
    writeFile(dataDir, file)
    await changeoverIn(dataDir, async (result) => {
      assert.equal(result.state, 'failed')
      assert.match(result.message, /Ablesung/)
      assert.match(result.message, /Küche/, 'der Zähler steht dabei')
      assert.match(result.message, /2024-12-31/, 'das Datum steht dabei')
      assert.match(result.message, /Zählerstand/)
    })
    assert.deepEqual((await stockOf(dataDir)).units, [])
    assert.equal(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), false, 'geprüft wird, bevor irgendetwas geschrieben wird')
  } finally {
    removeDir(dataDir)
  }
})

test('Abbruch: die Datenbank für den Umstieg lässt sich nicht anlegen', async () => {
  const dataDir = tempDir()
  try {
    writeFile(dataDir, fullDb())
    fs.mkdirSync(path.join(dataDir, TEMP_NAME))
    await changeoverIn(dataDir, async (result) => {
      assert.equal(result.state, 'failed')
      assert.match(result.message, /Umstieg/)
    })
    assert.deepEqual((await stockOf(dataDir)).units, [])
  } finally {
    removeDir(dataDir)
  }
})

test('Abbruch: ein Fehler beim Einfügen lässt nichts halb Geschriebenes zurück', async () => {
  const dataDir = tempDir()
  try {
    writeFile(dataDir, fullDb())
    await changeoverIn(
      dataDir,
      async (result) => {
        assert.equal(result.state, 'failed')
        assert.match(result.message, /schreiben|einfügen/i)
      },
      // Eine Wohnung mit derselben Kennung liegt schon in der Datei für den Umstieg: Das
      // Einfügen scheitert am Primärschlüssel, mitten im Vorgang.
      { beforeImport: async (db) => { await db.insert(units).values({ id: 'u1', name: 'doppelt', areaM2: 1, participates: false }) } },
    )
    assert.deepEqual((await stockOf(dataDir)).units, [], 'die richtige Datenbank ist unberührt')
    assert.equal(fs.existsSync(path.join(dataDir, TEMP_NAME)), false, 'die Datei für den Umstieg ist aufgeräumt')
  } finally {
    removeDir(dataDir)
  }
})

test('Abbruch: weicht ein einziger Cent ab, wird nicht aktiviert', async () => {
  // Der eigentliche Prüfstein. Nachgestellt wird er, indem nach dem Einfügen ein Betrag in der
  // Datei für den Umstieg verändert wird — genau das, was ein Fehler beim Übernehmen anrichten
  // würde, nur absichtlich.
  const dataDir = tempDir()
  try {
    writeFile(dataDir, fullDb())
    await changeoverIn(
      dataDir,
      async (result) => {
        assert.equal(result.state, 'failed')
        assert.match(result.message, /2024/, 'die Meldung nennt das Jahr')
        assert.match(result.message, /Abrechnung/)
        assert.ok(/12000|11999/.test(result.message), `die Meldung nennt die Zahl: ${result.message}`)
      },
      { afterImport: async (db) => { await db.update(costItems).set({ amountCents: 11999 }).where(eq(costItems.id, 'c1')) } },
    )
    assert.deepEqual((await stockOf(dataDir)).units, [], 'es wurde nichts aktiviert')
    assert.equal(fs.existsSync(path.join(dataDir, TEMP_NAME)), false)
  } finally {
    removeDir(dataDir)
  }
})

test('Abbruch: eine eingefrorene Abrechnung, die anders zurückkommt, verhindert den Umstieg', async () => {
  // Ein Archivstück: Es ist das, was dem Mieter zugestellt wurde, und lässt sich nicht noch
  // einmal ausrechnen. Die Berechnung liest daraus nur den Eigenanteil, der Rest fiele also in
  // der Regression gar nicht auf. Deshalb wird er wortgleich verglichen.
  const dataDir = tempDir()
  try {
    const file = fullDb()
    file.closedSettlements = [{
      id: 's1', year: 2023, closedAt: '2024-03-01T10:00:00.000Z', sentAt: null,
      settlement: {
        year: 2023, daysInYear: 365, statements: [], landlord: { rows: [], totalCents: 900 },
        selfUsedShareCents: 400, totalCostsCents: 9000, warnings: [],
      },
    }]
    writeFile(dataDir, file)
    await changeoverIn(
      dataDir,
      async (result) => {
        assert.equal(result.state, 'failed')
        assert.match(result.message, /2023/)
        assert.match(result.message, /abgeschlossene Abrechnung|eingefroren/i)
      },
      // Der Eigenanteil bleibt, damit die vier Rechnungen nichts merken: Genau das ist der
      // Fall, den nur dieser Vergleich fängt.
      {
        afterImport: async (db) => {
          await db.update(closedSettlements).set({
            settlement: { year: 2023, daysInYear: 365, statements: [], landlord: { rows: [], totalCents: 1 }, selfUsedShareCents: 400, totalCostsCents: 9000, warnings: [] },
          })
        },
      },
    )
    assert.deepEqual((await stockOf(dataDir)).units, [])
  } finally {
    removeDir(dataDir)
  }
})

test('Abbruch: scheitert das Aktivieren, läuft Mietfuchs mit dem alten Stand weiter', async () => {
  const dataDir = tempDir()
  try {
    writeFile(dataDir, fullDb())
    await changeoverIn(
      dataDir,
      async (result, database) => {
        assert.equal(result.state, 'failed')
        assert.ok(database, 'die Datenbank ist danach wieder offen, auch wenn sie leer ist')
      },
      // Die fertige Datei verschwindet, kurz bevor sie an ihren Platz soll. Der Umstieg muss
      // danach die alte Datenbank wieder öffnen, statt ohne dazustehen.
      { beforeActivate: () => fs.rmSync(path.join(dataDir, TEMP_NAME), { force: true }) },
    )
    assert.deepEqual((await stockOf(dataDir)).units, [])
  } finally {
    removeDir(dataDir)
  }
})

test('Abbruch: eine Beidatei neben der fertigen Datei verhindert das Aktivieren', async () => {
  // Ein `rename` bewegt nur die Hauptdatei. Bliebe eine Beidatei liegen, gehörte sie danach zu
  // keiner Datenbank mehr und könnte die neue beschädigen. Deshalb wird vorher nachgesehen.
  const dataDir = tempDir()
  try {
    writeFile(dataDir, fullDb())
    await changeoverIn(
      dataDir,
      async (result) => {
        assert.equal(result.state, 'failed')
        assert.match(result.message, /Beidatei|-wal/)
      },
      { beforeActivate: () => fs.writeFileSync(path.join(dataDir, `${TEMP_NAME}-wal`), '') },
    )
    assert.deepEqual((await stockOf(dataDir)).units, [])
  } finally {
    removeDir(dataDir)
  }
})

test('Nach einem Fehler wird es beim nächsten Start erneut versucht', async () => {
  // Der Nutzer ist nie blockiert: Er berichtigt die Ablesung in der Oberfläche, startet neu,
  // und der Umstieg gelingt ohne weiteres Zutun.
  const dataDir = tempDir()
  try {
    const file = fullDb()
    file.readings[1].value = -5
    writeFile(dataDir, file)
    await changeoverIn(dataDir, async (result) => assert.equal(result.state, 'failed'))

    file.readings[1].value = 160
    writeFile(dataDir, file)
    await changeoverIn(dataDir, async (result) => assert.equal(result.state, 'done', result.message))
    assert.deepEqual((await stockOf(dataDir)).units.map((u) => u.id), ['u1', 'u2'])
  } finally {
    removeDir(dataDir)
  }
})

// ---------- Der Prüfkatalog durch den Umstieg ----------

test('Der Prüfkatalog kommt durch den Umstieg und rechnet danach aus der Datenbank dasselbe', async () => {
  // Elf durchgerechnete Beispielbestände mit Handrechnung (server/test/fixtures/settlement).
  // Sie laufen sonst gegen die Datei; hier laufen sie durch den ganzen Weg — Validator,
  // Geraderücken, Schreiben, Lesen — und werden danach gegen dieselbe Handrechnung gehalten.
  // Der Umstieg selbst rechnet zwar auch nach, aber er vergleicht mit sich selbst; hier steht
  // eine Erwartung daneben, die niemand aus dem Code abgelesen hat.
  const fixtures = loadFixtures()
  assert.ok(fixtures.length > 0, 'keine Fixtures gefunden')
  for (const fixture of fixtures) {
    const dataDir = tempDir()
    try {
      fs.copyFileSync(path.join(fixture.dir, 'db.json'), dbFile(dataDir))
      await changeoverIn(dataDir, async (result) => {
        assert.equal(result.state, 'done', `${fixture.name}: ${result.message}`)
      })
      const stock = await stockOf(dataDir)
      assert.deepStrictEqual(actualOfSnapshot(snapshotOf(stock, fixture.year)), fixture.expected, fixture.name)
    } finally {
      removeDir(dataDir)
    }
  }
})

test('Abbruch: eine Datenbank, die nicht mehr antwortet, beendet nicht den Start', async () => {
  // `runChangeover` verspricht, dass **jeder** Schritt eine Meldung ergibt und keinen Abbruch.
  // Daran hängt mehr als die Höflichkeit: index.ts ruft die Funktion mit `await` auf oberster
  // Ebene auf, ohne `try`. Käme von hier eine Ausnahme heraus, endete der Start mit einem
  // Stapelauszug, statt Mietfuchs weiterlaufen zu lassen — und der Nutzer stünde vor einem
  // Programm, das sich gar nicht mehr öffnen lässt, samt der Meldung, die darin stünde.
  //
  // Geprüft wird es am zweiten Schritt, der Frage nach schon gefüllten Tabellen: Er ist der
  // einzige, der die Datenbank befragt, bevor der eigentliche Umstieg beginnt. Eine geschlossene
  // Verbindung stellt die Bedingung her, ohne dass der Test etwas vortäuschen müsste.
  const dataDir = tempDir()
  try {
    writeFile(dataDir, fullDb())
    const opened = await openDatabase({ dataDir })
    opened.close()
    const result = await runChangeover({ dataDir, opened, reopen: () => openDatabase({ dataDir }) })
    assert.equal(result.state, 'failed')
    // Geprüft wird die Zusage, nicht der Wortlaut: Es ist nichts verloren, und es geht weiter.
    assert.match(result.message, /nichts verloren/)
    assert.match(result.message, /nächsten Start wird es erneut versucht/)
    // Und nichts ist halb getan: keine Datei für den Umstieg, keine Sicherung.
    assert.equal(fs.existsSync(path.join(dataDir, TEMP_NAME)), false, 'die Datei für den Umstieg liegt noch da')
    assert.equal(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), false, 'es wurde schon gesichert')
  } finally {
    removeDir(dataDir)
  }
})

test('Ein gescheiterter Umstieg lässt die db.json, wo sie ist', async () => {
  // Der Name ist die Zusage „ab hier gilt die Datenbank". Solange sie nicht gilt, darf er auch
  // nicht dastehen, sonst suchte der Nutzer seine Daten unter einem Namen, der behauptet, sie
  // seien umgezogen.
  const dataDir = tempDir()
  try {
    const bestand = fullDb()
    bestand.readings = [reading({ id: 'r1', meterId: 'm1', value: -5 })]
    writeFile(dataDir, bestand)
    await changeoverIn(dataDir, async (result) => assert.equal(result.state, 'failed'))
    assert.ok(fs.existsSync(dbFile(dataDir)), 'die db.json ist verschwunden')
    assert.equal(fs.existsSync(path.join(dataDir, LEGACY_JSON_NAME)), false, 'sie gilt als abgelöst, obwohl nichts umgezogen ist')
  } finally {
    removeDir(dataDir)
  }
})

// ---------- Welche Jahre geprüft werden ----------

test('Geprüft wird jedes Jahr, in dem etwas steht, und jedes Jahr dazwischen', () => {
  const db = fullDb()
  db.costItems = [costItem({ id: 'c1', year: 2020 }), costItem({ id: 'c2', year: 2024 })]
  db.tenancies = [tenancy({ id: 't1', unitId: 'u1', start: '2021-05-01', end: '2022-03-31' })]
  db.readings = []
  db.payments = []
  // Die Jahre dazwischen gehören dazu: Ein Mietverhältnis läuft durch sie hindurch, und der
  // Verbrauch wird zwischen zwei Ablesungen tagesanteilig interpoliert. Ein Jahr ohne eigenen
  // Datensatz hat deshalb sehr wohl Zahlen.
  assert.deepEqual(yearsToCheck(db, 2026), [2020, 2021, 2022, 2023, 2024])
})

test('Ein unbefristetes Mietverhältnis reicht bis ins laufende Jahr', () => {
  const db = fullDb()
  db.costItems = []
  db.readings = []
  db.payments = []
  db.tenancies = [tenancy({ id: 't1', unitId: 'u1', start: '2023-01-01', end: null })]
  assert.deepEqual(yearsToCheck(db, 2026), [2023, 2024, 2025, 2026])
})

test('Ein leerer Bestand hat keine Jahre zu prüfen', () => {
  const db = fullDb()
  db.costItems = []
  db.tenancies = []
  db.readings = []
  db.payments = []
  db.closedSettlements = []
  assert.deepEqual(yearsToCheck(db, 2026), [])
})

test('Eine unsinnige Jahreszahl sprengt den Vergleich nicht', () => {
  // Der Validator prüft keine Datumsformate, eine von Hand verdorbene Datei kann also das Jahr
  // 9999 enthalten. Der Bereich dazwischen wäre dann sinnlos groß; geprüft werden dann die
  // genannten Jahre selbst.
  const db = fullDb()
  db.costItems = [costItem({ id: 'c1', year: 2024 }), costItem({ id: 'c2', year: 9999 })]
  db.tenancies = []
  db.readings = []
  db.payments = []
  const jahre = yearsToCheck(db, 2026)
  assert.ok(jahre.includes(2024) && jahre.includes(9999), jahre.join(', '))
  assert.ok(jahre.length < 100, `zu viele Jahre: ${jahre.length}`)
})

test('Ein krummes Datum nimmt der Prüfung nicht die Jahre dazwischen', () => {
  // Der gefährliche Teil der vorigen Regel. `yearOfDate` liest die ersten vier Zeichen als Zahl,
  // aus „12" wird also das Jahr 12. Reißt das den Bereich auf, fällt Mietfuchs darauf zurück,
  // nur noch die Jahre zu prüfen, in denen ein Datensatz steht — und das sind ausgerechnet nicht
  // die Jahre, für die die Berechnung am meisten herleitet. Ein Mietverhältnis von 2020 bis 2024
  // hat auch 2022 ein Mietsoll.
  //
  // Erreichbar ist so ein Datum: Der Validator lehnt ein leeres Feld ab, prüft aber
  // ausdrücklich keine Datumsformate, und die generischen CRUD-Routen prüfen gar nichts.
  const db = fullDb()
  db.costItems = []
  db.readings = []
  db.tenancies = [tenancy({ id: 't1', unitId: 'u1', start: '2020-01-01', end: '2024-12-31' })]
  db.payments = [payment({ id: 'p1', tenancyId: 't1', date: '12' })]
  const jahre = yearsToCheck(db, 2026)
  for (const jahr of [2021, 2022, 2023]) {
    assert.ok(jahre.includes(jahr), `${jahr} wird nicht geprüft: ${jahre.join(', ')}`)
  }
  // Das krumme Jahr selbst bleibt dabei, denn dort steht ein Datensatz.
  assert.ok(jahre.includes(12), jahre.join(', '))
})

test('Ein altes, aber mögliches Jahr bleibt im zusammenhängenden Bereich', () => {
  // Die Gegenprobe zur vorigen Regel: Sie darf nicht dazu führen, dass weniger geprüft wird als
  // vorher. Ein Mietverhältnis, das weit zurückreicht, ist ungewöhnlich, aber kein Unsinn, und
  // die Jahre dazwischen haben ein Mietsoll wie alle anderen auch. Die Grenze liegt deshalb am
  // laufenden Jahr und nicht auf einer festen Jahreszahl.
  const db = fullDb()
  db.costItems = []
  db.readings = []
  db.payments = []
  db.tenancies = [tenancy({ id: 't1', unitId: 'u1', start: '1950-01-01', end: '1955-12-31' })]
  const jahre = yearsToCheck(db, 2026)
  assert.deepEqual(jahre, [1950, 1951, 1952, 1953, 1954, 1955])
})
