// Die Vorgänge, die die Routen brauchen (db/repository.ts, #55, Aufgabe 6).
//
// Drei Zusagen hängen an dieser Datei, und jede hat ihre eigene Gruppe von Tests:
//
//   1. **`PUT` verschmilzt.** Die Oberfläche schickt Teilstücke: beim Auszug nur `{ end: … }`,
//      beim Ändern der gezahlten Vorauszahlungen nur `{ prepaymentOverrides: … }`. Würde die
//      Zeile ersetzt, wären danach Name, IBAN und alle Staffeln weg.
//   2. **Nichts bleibt halb.** Ein Vorgang über mehrere Tabellen läuft in einer Transaktion.
//   3. **Für ein unbekanntes Feld gibt es keinen Ort mehr** (#60).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getTableColumns } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import {
  closeSettlement, createEntity, findClosedSettlement, findEntity, invoiceFilesInUse,
  listCollection, removeEntity, reopenSettlement, setSentAt, sharesForUnit, updateEntity,
  type CollectionName,
} from '../src/db/repository.ts'
import {
  baseRents, costItemShares, costItems, meters, payments, personHistory, prepaymentOverrides,
  prepayments, readings, tenancies, units,
} from '../src/db/schema.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-repo-'))

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

// Ein Feld eines gelesenen Datensatzes, ohne Zusicherung: Was das Repository zurückgibt, ist
// eine Vereinigung der sechs Datentypen, und der Test fragt nach einem Feld, das nur einer von
// ihnen hat.
const fieldOf = (entity: unknown, key: string): unknown =>
  entity !== null && typeof entity === 'object' ? Reflect.get(entity, key) : undefined

// ---------- Anlegen, Lesen, Ändern ----------

test('Anlegen: der Datensatz kommt so zurück, wie er in der Datenbank steht', async () => {
  await withDatabase(async (opened) => {
    const u = await opened.write((db) => createEntity(db, 'units', 'u1', {
      name: 'EG links', areaM2: 80, participates: true, rooms: 3, floor: 'EG', notes: 'Notiz',
    }))
    assert.equal(u.id, 'u1')
    assert.equal(fieldOf(u, 'name'), 'EG links')
    assert.equal(fieldOf(u, 'areaM2'), 80)
    assert.equal(fieldOf(u, 'notes'), 'Notiz')
  })
})

test('Ändern verschmilzt: ein Teilstück lässt alles andere stehen', async () => {
  // **Der wichtigste Test dieser Datei.** Stammdaten.tsx schickt beim Auszug genau das hier:
  // nur das Ende, sonst nichts. Ersetzte die Zeile, wären danach Name, IBAN, Kaution und alle
  // drei Staffeln weg, und niemand bekäme eine Fehlermeldung.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', {
      unitId: 'u1', tenantName: 'Müller', persons: 2, start: '2024-01-01', end: null,
      iban: 'DE02120300000000202051', depositCents: 180000,
      personHistory: [{ from: '2024-01-01', persons: 2 }],
      prepayments: [{ from: '2024-01', monthlyCents: 15000 }],
      baseRents: [{ from: '2024-01', monthlyCents: 60000 }],
      prepaymentOverrides: { 2024: 170000 },
    }))

    const nachher = await opened.write((db) => updateEntity(db, 'tenancies', 't1', { end: '2024-12-31' }))
    if (!nachher) return assert.fail('das Mietverhältnis ist verschwunden')

    assert.equal(fieldOf(nachher, 'end'), '2024-12-31', 'das Ende ist gesetzt')
    assert.equal(fieldOf(nachher, 'tenantName'), 'Müller', 'der Name steht noch da')
    assert.equal(fieldOf(nachher, 'iban'), 'DE02120300000000202051', 'die IBAN steht noch da')
    assert.equal(fieldOf(nachher, 'depositCents'), 180000, 'die Kaution steht noch da')
    assert.deepEqual(fieldOf(nachher, 'prepayments'), [{ from: '2024-01', monthlyCents: 15000 }], 'die Staffel steht noch da')
    assert.deepEqual(fieldOf(nachher, 'baseRents'), [{ from: '2024-01', monthlyCents: 60000 }], 'die Kaltmiete steht noch da')
    assert.deepEqual(fieldOf(nachher, 'prepaymentOverrides'), { 2024: 170000 }, 'die Jahreskorrektur steht noch da')
  })
})

test('Ändern: ein ausdrückliches null setzt zurück, ein fehlendes Feld nicht', async () => {
  // Der Unterschied zwischen Anwesenheit und Wert. In JSON gibt es kein `undefined`, die
  // Anwesenheit eines Schlüssels ist also die einzige Auskunft, die der Browser geben kann.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', {
      unitId: 'u1', tenantName: 'Müller', persons: 1, start: '2024-01-01', end: '2024-12-31',
    }))

    const ohneFeld = await opened.write((db) => updateEntity(db, 'tenancies', 't1', { persons: 3 }))
    assert.equal(fieldOf(ohneFeld, 'end'), '2024-12-31', 'ein fehlendes Feld ändert nichts')

    const mitNull = await opened.write((db) => updateEntity(db, 'tenancies', 't1', { end: null }))
    assert.equal(fieldOf(mitNull, 'end'), null, 'ein ausdrückliches null setzt zurück')
  })
})

test('Ändern lässt die Reihenfolge der Liste unverändert', async () => {
  // Gelesen wird nach `rowid`. Würde die Zeile gelöscht und neu eingefügt, spränge der
  // bearbeitete Datensatz ans Ende, und der Vermieter sähe seine Wohnungsliste nach jeder
  // Änderung neu sortiert.
  await withDatabase(async (opened) => {
    for (const id of ['u1', 'u2', 'u3']) {
      await opened.write((db) => createEntity(db, 'units', id, { name: id, areaM2: 50, participates: true }))
    }
    await opened.write((db) => updateEntity(db, 'units', 'u1', { name: 'geändert' }))
    const liste = await opened.read((db) => listCollection(db, 'units'))
    assert.deepEqual(liste.map((u) => u.id), ['u1', 'u2', 'u3'])
  })
})

test('Ändern trägt in jeder Sammlung, nicht nur bei Wohnungen und Mietverhältnissen', async () => {
  // **Vier der sechs Änderungswege hatten keinen Test.** Geprüft wurde nur, was die Oberfläche
  // am häufigsten anfasst; `costItems`, `meters`, `readings` und `payments` liefen ungeprüft
  // mit. Gemessen: Ein `replace`, das statt auf die eigene Kennung auf ein anderes Feld
  // verweist, übersetzt anstandslos, antwortet 200 mit dem unveränderten Datensatz, und kein
  // Test würde rot. Eine korrigierte Ablesung ist eine der häufigsten Eingaben überhaupt und
  // wandert unmittelbar in die verbrauchsabhängige Verteilung.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true }))
    await opened.write((db) => createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', start: '2024-01-01' }))
    await opened.write((db) => createEntity(db, 'meters', 'm1', { name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³' }))
    await opened.write((db) => createEntity(db, 'readings', 'r1', { meterId: 'm1', date: '2024-12-31', value: 100 }))
    await opened.write((db) => createEntity(db, 'payments', 'p1', { tenancyId: 't1', date: '2024-01-05', amountCents: 50000 }))
    await opened.write((db) => createEntity(db, 'costItems', 'c1', {
      year: 2024, category: 'Müllabfuhr', description: 'Abfall', amountCents: 12000, key: 'area',
    }))

    const geaendert: [CollectionName, string, Record<string, unknown>, string, unknown][] = [
      ['costItems', 'c1', { amountCents: 13500 }, 'amountCents', 13500],
      ['meters', 'm1', { meterNumber: 'ZX-9' }, 'meterNumber', 'ZX-9'],
      ['readings', 'r1', { value: 142 }, 'value', 142],
      ['payments', 'p1', { amountCents: 49900 }, 'amountCents', 49900],
    ]
    for (const [coll, id, rumpf, feld, erwartet] of geaendert) {
      const zurueck = await opened.write((db) => updateEntity(db, coll, id, rumpf))
      assert.equal(fieldOf(zurueck, feld), erwartet, `${coll}: die Antwort trägt die Änderung nicht`)
      const gelesen = await opened.read((db) => findEntity(db, coll, id))
      assert.equal(fieldOf(gelesen, feld), erwartet, `${coll}: in der Datenbank steht der alte Wert`)
    }
  })
})

test('Ändern einer Kostenposition schreibt auch die vereinbarten Anteile', async () => {
  // Die Anteile liegen in einer eigenen Tabelle und werden beim Ändern ganz ersetzt. Geprüft war
  // bisher nur das Anlegen und das Wegräumen beim Löschen einer Wohnung; streicht man den Aufruf
  // im Änderungsweg, bleibt alles grün, und das Ändern vereinbarter Prozentanteile wird still
  // verworfen. Das ist der Umlageschlüssel, bei dem der Vermieter die Verteilung von Hand
  // festlegt, eine Änderung dort bewegt also unmittelbar Geld.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true }))
    await opened.write((db) => createEntity(db, 'units', 'u2', { name: 'OG', areaM2: 60, participates: true }))
    await opened.write((db) => createEntity(db, 'costItems', 'c1', {
      year: 2024, category: 'Müllabfuhr', description: 'Abfall', amountCents: 12000, key: 'custom',
      customShares: { u1: 70, u2: 30 },
    }))

    const zurueck = await opened.write((db) => updateEntity(db, 'costItems', 'c1', { customShares: { u1: 40, u2: 60 } }))
    assert.deepEqual(fieldOf(zurueck, 'customShares'), { u1: 40, u2: 60 }, 'die Antwort trägt die alten Anteile')
    const gelesen = await opened.read((db) => findEntity(db, 'costItems', 'c1'))
    assert.deepEqual(fieldOf(gelesen, 'customShares'), { u1: 40, u2: 60 }, 'in der Datenbank stehen die alten Anteile')

    // Und ein Anteil, der wegfällt, fällt wirklich weg, statt neben dem neuen stehen zu bleiben.
    await opened.write((db) => updateEntity(db, 'costItems', 'c1', { customShares: { u1: 100 } }))
    assert.deepEqual(fieldOf(await opened.read((db) => findEntity(db, 'costItems', 'c1')), 'customShares'), { u1: 100 })
  })
})

test('Die Jahreskorrektur nimmt nur vierstellige Jahreszahlen an', async () => {
  // In der Datei steht der Schlüssel als Text („2024"), in der Spalte als Zahl. Verlustfrei ist
  // das Hin und Her nur, solange der Schlüssel wirklich eine Jahreszahl ist, und der Validator
  // lässt beim Umstieg genau vierstellige durch. Der Schreibweg der Routen muss dieselbe Grenze
  // ziehen: `Number('')` ist 0 und damit ganzzahlig, ein leerer Schlüssel ergäbe also eine
  // Jahreskorrektur für das Jahr 0. Zwei Schlüssel, die auf dieselbe Zahl führen („2024" und
  // „2024.0"), ließen sogar den ganzen Vorgang am Primärschlüssel scheitern.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true }))
    const t = await opened.write((db) => createEntity(db, 'tenancies', 't1', {
      unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01',
      prepaymentOverrides: { '2024': 180000, '': 1, ' ': 2, '2024.0': 3, '1e3': 4, 'zweitausend': 5, '-5': 6 },
    }))
    assert.deepEqual(fieldOf(t, 'prepaymentOverrides'), { '2024': 180000 })
  })
})

test('Ein unbekanntes Feld kommt gar nicht erst an', async () => {
  // #60: Über die db.json übernahm die Route jeden Schlüssel des Rumpfes, auch einen
  // erfundenen, und er blieb dort für immer stehen. Mit Spalten gibt es für ihn keinen Ort.
  await withDatabase(async (opened) => {
    const u = await opened.write((db) => createEntity(db, 'units', 'u1', {
      name: 'EG', areaM2: 80, participates: true, fremdesFeld: 'bleibt haengen',
    }))
    assert.equal(fieldOf(u, 'fremdesFeld'), undefined, 'das erfundene Feld ist nicht angekommen')
    assert.ok(!JSON.stringify(u).includes('bleibt haengen'), JSON.stringify(u))
  })
})

test('Ändern eines Datensatzes, den es nicht gibt, meldet sich mit null', async () => {
  await withDatabase(async (opened) => {
    assert.equal(await opened.write((db) => updateEntity(db, 'units', 'gibt-es-nicht', { name: 'X' })), null)
    assert.equal(await opened.write((db) => removeEntity(db, 'units', 'gibt-es-nicht')), false)
  })
})

// ---------- Löschen und die Kaskade ----------

test('Löschen einer Wohnung räumt mit, was an ihr hängt', async () => {
  // Heute geht index.ts das von Hand durch; bricht es mittendrin ab, bleiben Reste. Hier
  // erledigen es die Fremdschlüssel in einem Schritt.
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01' })
      await createEntity(db, 'payments', 'p1', { tenancyId: 't1', date: '2024-01-05', amountCents: 1000 })
      await createEntity(db, 'meters', 'm1', { name: 'Küche', unitId: 'u1', type: 'kaltwasser', unit: 'm³' })
      await createEntity(db, 'readings', 'r1', { meterId: 'm1', date: '2024-12-31', value: 100 })
    })

    assert.equal(await opened.write((db) => removeEntity(db, 'units', 'u1')), true)

    for (const coll of ['units', 'tenancies', 'payments', 'meters', 'readings'] as CollectionName[]) {
      const rest = await opened.read((db) => listCollection(db, coll))
      assert.deepEqual(rest, [], `in ${coll} ist etwas zurückgeblieben`)
    }
  })
})

test('Löschen einer Wohnung lässt die Kostenposition stehen und nimmt ihr nur das Ziel', async () => {
  // `SET NULL` und nicht `CASCADE`, so steht es im Schema: Die Rechnung ist bezahlt worden und
  // gehört weiter in die Abrechnung des Jahres. Sie mitzulöschen veränderte die Summe einer
  // bereits abgerechneten Vergangenheit.
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'costItems', 'c1', {
        year: 2024, category: 'Müll', description: 'Gebühren', amountCents: 12000,
        key: 'direct', directUnitId: 'u1',
      })
    })
    await opened.write((db) => removeEntity(db, 'units', 'u1'))

    const c = await opened.read((db) => findEntity(db, 'costItems', 'c1'))
    if (!c) return assert.fail('die Kostenposition ist mitgelöscht worden')
    assert.equal(fieldOf(c, 'amountCents'), 12000, 'der Betrag steht unverändert da')
    assert.equal(fieldOf(c, 'directUnitId'), null, 'die Direktzuordnung zeigt ins Leere')
  })
})

test('Löschen einer Wohnung räumt auch die vereinbarten Anteile weg', async () => {
  // Heute geht index.ts die Kostenpositionen dafür von Hand durch. Im Schema hängt es an
  // `cost_item_shares.unit_id`.
  await withDatabase(async (opened) => {
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'units', 'u2', { name: 'OG', areaM2: 60, participates: true })
      await createEntity(db, 'costItems', 'c1', {
        year: 2024, category: 'Müll', description: 'Gebühren', amountCents: 12000,
        key: 'custom', customShares: { u1: 60, u2: 40 },
      })
    })
    assert.equal(await opened.read((db) => sharesForUnit(db, 'u1')), 1)

    await opened.write((db) => removeEntity(db, 'units', 'u1'))
    assert.equal(await opened.read((db) => sharesForUnit(db, 'u1')), 0, 'der Anteil hängt noch da')

    const c = await opened.read((db) => findEntity(db, 'costItems', 'c1'))
    assert.deepEqual(fieldOf(c, 'customShares'), { u2: 40 }, 'der Anteil der anderen Wohnung bleibt')
  })
})

test('Ein Fehler mittendrin lässt nichts Halbes zurück', async () => {
  // Ein Mietverhältnis liegt über fünf Tabellen. Scheitert das Schreiben einer Staffel, darf
  // die Hauptzeile nicht allein zurückbleiben.
  //
  // **Der Auslöser war einmal ein doppelter Stichtag**, und das war die falsche Wahl: Der Fall
  // ist über die Oberfläche erzeugbar, und seit repository.ts ihn nach der Regel aus schedule.ts
  // geraderückt, löst er gar nichts mehr aus. Ein Test, der einen echten Bedienfall als
  // Fehlerauslöser braucht, hält ihn fest, statt ihn zu melden. Jetzt ist es eine negative
  // Vorauszahlung: Die Prüfbedingung `prepayments_monthly_not_negative` lehnt sie ab, und zwar
  // erst, nachdem die Hauptzeile schon geschrieben ist.
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true }))
    await assert.rejects(
      () => opened.write((db) => createEntity(db, 'tenancies', 't1', {
        unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01',
        prepayments: [{ from: '2024-01', monthlyCents: 100 }, { from: '2024-02', monthlyCents: -200 }],
      })),
    )
    assert.deepEqual(await opened.read((db) => listCollection(db, 'tenancies')), [], 'die Hauptzeile ist zurückgeblieben')
  })
})

// ---------- Was die Sonderrouten brauchen ----------

test('Ein Beleg, der noch an einer Kostenposition hängt, wird als benutzt gemeldet', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'costItems', 'c1', {
      year: 2024, category: 'Müll', description: 'G', amountCents: 1, key: 'area', invoiceFile: 'beleg.pdf',
    }))
    const benutzt = await opened.read((db) => invoiceFilesInUse(db, ['beleg.pdf', 'frei.pdf']))
    assert.equal(benutzt.has('beleg.pdf'), true)
    assert.equal(benutzt.has('frei.pdf'), false)
    assert.equal((await opened.read((db) => invoiceFilesInUse(db, []))).size, 0)
  })
})

// ---------- Die abgeschlossene Abrechnung ----------
//
// Sie ist keine gewöhnliche Sammlung: Angelegt wird sie nicht mit beliebigem Rumpf, sondern mit
// dem Berechnungsstand, den der Server selbst gerade gerechnet hat.

test('Abschließen: die Abrechnung lässt sich danach wiederfinden', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => closeSettlement(db, {
      id: 's1', year: 2024, closedAt: '2025-01-15T10:00:00.000Z', sentAt: null,
      settlement: { year: 2024, totalCostsCents: 12000 },
    }))
    const gefunden = await opened.read((db) => findClosedSettlement(db, 2024))
    if (!gefunden) return assert.fail('die abgeschlossene Abrechnung ist nicht auffindbar')
    assert.equal(gefunden.year, 2024)
    assert.equal(gefunden.sentAt, null)
    // Wortgleich: Der eingefrorene Stand ist ein Archivstück und soll bleiben, wie er ist.
    assert.deepEqual(gefunden.settlement, { year: 2024, totalCostsCents: 12000 })
    assert.equal(await opened.read((db) => findClosedSettlement(db, 2023)), undefined)
  })
})

test('Abschließen: ein zweites Mal für dasselbe Jahr lehnt die Datenbank ab', async () => {
  // Der eindeutige Index auf `year` ist zugleich die Zusicherung, dass es je Jahr höchstens eine
  // abgeschlossene Abrechnung gibt. Ohne ihn entschiede die Reihenfolge beim Lesen, welche gilt.
  await withDatabase(async (opened) => {
    const eintrag = { year: 2024, closedAt: '2025-01-15T10:00:00.000Z', sentAt: null, settlement: {} }
    await opened.write((db) => closeSettlement(db, { ...eintrag, id: 's1' }))
    await assert.rejects(() => opened.write((db) => closeSettlement(db, { ...eintrag, id: 's2' })))
  })
})

test('Das Versanddatum lässt sich nachtragen und wieder entfernen', async () => {
  // An ihm hängt die Frist aus §556 BGB.
  await withDatabase(async (opened) => {
    await opened.write((db) => closeSettlement(db, {
      id: 's1', year: 2024, closedAt: '2025-01-15T10:00:00.000Z', sentAt: null, settlement: {},
    }))
    assert.equal(await opened.write((db) => setSentAt(db, 2024, '2025-02-01')), true)
    assert.equal((await opened.read((db) => findClosedSettlement(db, 2024)))?.sentAt, '2025-02-01')
    assert.equal(await opened.write((db) => setSentAt(db, 2024, null)), true)
    assert.equal((await opened.read((db) => findClosedSettlement(db, 2024)))?.sentAt, null)
    assert.equal(await opened.write((db) => setSentAt(db, 2023, '2025-02-01')), false, 'ein Jahr ohne Abschluss meldet sich')
  })
})

test('Wieder öffnen verwirft den eingefrorenen Stand', async () => {
  await withDatabase(async (opened) => {
    await opened.write((db) => closeSettlement(db, {
      id: 's1', year: 2024, closedAt: '2025-01-15T10:00:00.000Z', sentAt: null, settlement: {},
    }))
    assert.equal(await opened.write((db) => reopenSettlement(db, 2024)), true)
    assert.equal(await opened.read((db) => findClosedSettlement(db, 2024)), undefined)
    assert.equal(await opened.write((db) => reopenSettlement(db, 2024)), false, 'ein zweites Mal meldet sich')
  })
})

// ---------- Der Wächter über die Verschmelzung ----------

test('Die Verschmelzung erreicht jede Spalte des Schemas', async () => {
  // **Der Test, der diese Datei am Leben hält.** Die Verschmelzung liest Feld für Feld; wer eine
  // Spalte hinzufügt und sie hier vergisst, verliert sie beim Speichern still. Die Erwartung
  // wird deshalb aus den Spalten abgeleitet und nicht danebengeschrieben.
  //
  // `id` bleibt außen vor, die vergibt die Route; Fremdschlüssel bekommen eine Kennung, die es
  // wirklich gibt, sonst lehnte die Datenbank schon das Einfügen ab.
  const proben: { coll: CollectionName, table: SQLiteTable, body: Record<string, unknown> }[] = [
    {
      coll: 'units', table: units,
      body: { name: 'EG', areaM2: 80, participates: true, selfUsed: true, selfPersons: 2, rooms: 3, floor: 'EG', notes: 'Notiz' },
    },
    {
      coll: 'tenancies', table: tenancies,
      body: {
        unitId: 'u1', tenantName: 'Müller', persons: 2, start: '2024-01-01', end: '2024-12-31',
        email: 'a@b.de', phone: '0123', correspondenceAddress: 'Weg 1', iban: 'DE01',
        contractDate: '2023-12-01', depositCents: 1000, depositStatus: 'erhalten', notes: 'Notiz',
      },
    },
    {
      coll: 'costItems', table: costItems,
      body: {
        year: 2024, category: 'Müll', description: 'Gebühren', vendor: 'Firma', amountCents: 12000,
        key: 'direct', directUnitId: 'u1', meterType: 'kaltwasser', labor35aCents: 400, invoiceFile: 'b.pdf',
      },
    },
    {
      coll: 'meters', table: meters,
      body: { name: 'Küche', unitId: 'u1', type: 'kaltwasser', meterNumber: 'ABC', unit: 'm³' },
    },
    {
      coll: 'readings', table: readings,
      body: { meterId: 'm1', date: '2024-12-31', value: 160, replacement: true, oldEndValue: 155, note: 'Wechsel' },
    },
    {
      coll: 'payments', table: payments,
      body: { tenancyId: 't1', date: '2024-01-05', amountCents: 1000, note: 'Dauerauftrag' },
    },
  ]

  await withDatabase(async (opened) => {
    // Die Datensätze, auf die die Fremdschlüssel zeigen.
    await opened.write(async (db) => {
      await createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true })
      await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01' })
      await createEntity(db, 'meters', 'm1', { name: 'K', unitId: 'u1', type: 'kaltwasser', unit: 'm³' })
    })

    for (const { coll, table, body } of proben) {
      const id = `probe-${coll}`
      const gespeichert = await opened.write((db) => createEntity(db, coll, id, body))
      for (const spalte of Object.keys(getTableColumns(table))) {
        if (spalte === 'id') continue
        assert.ok(
          Object.hasOwn(body, spalte),
          `${coll}: Die Probe belegt die Spalte „${spalte}" nicht, der Test bewacht sie deshalb nicht`,
        )
        assert.deepEqual(
          fieldOf(gespeichert, spalte), body[spalte],
          `${coll}: Die Spalte „${spalte}" ist beim Verschmelzen verlorengegangen`,
        )
      }
    }
  })
})

test('Die Verschmelzung erreicht auch jede Spalte der Untertabellen', async () => {
  // **Der Wächter darüber sieht nur die sechs Haupttabellen.** Die fünf Untertabellen hängen am
  // Mietverhältnis beziehungsweise an der Kostenposition und werden von `personEntry`,
  // `moneyEntry`, `readAmountsByYear` und `readShares` gelesen; eine neue Spalte dort ginge beim
  // Speichern still verloren, und der Wächter oben bemerkte es nicht. Die Erwartung wird auch
  // hier aus den Spalten abgeleitet.
  //
  // `tenancy_id` und `cost_item_id` bleiben außen vor: Sie stehen nicht im Eintrag, sondern
  // ergeben sich aus dem Datensatz, an dem die Liste hängt.
  const staffeln: { table: SQLiteTable, feld: string, eintrag: Record<string, unknown> }[] = [
    // Der Stichtag ist hier der Einzugstag, und das ist kein Zufall: Die Personen-Staffel wird
    // gegen ihn geradegerückt (schedule.ts), ein späterer erster Stichtag würde also vorgezogen
    // und der Vergleich schlüge aus einem Grund fehl, der mit den Spalten nichts zu tun hat.
    { table: personHistory, feld: 'personHistory', eintrag: { from: '2024-01-01', persons: 3 } },
    { table: prepayments, feld: 'prepayments', eintrag: { from: '2024-03', monthlyCents: 15000 } },
    { table: baseRents, feld: 'baseRents', eintrag: { from: '2024-03', monthlyCents: 60000 } },
  ]

  await withDatabase(async (opened) => {
    await opened.write((db) => createEntity(db, 'units', 'u1', { name: 'EG', areaM2: 80, participates: true }))

    for (const { table, feld, eintrag } of staffeln) {
      const gespeichert = await opened.write((db) => createEntity(db, 'tenancies', `t-${feld}`, {
        unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01', [feld]: [eintrag],
      }))
      const zurueck = fieldOf(gespeichert, feld)
      for (const spalte of Object.keys(getTableColumns(table))) {
        if (spalte === 'tenancyId') continue
        assert.ok(
          Object.hasOwn(eintrag, spalte),
          `${feld}: Die Probe belegt die Spalte „${spalte}" nicht, der Test bewacht sie deshalb nicht`,
        )
      }
      assert.deepEqual(zurueck, [eintrag], `${feld}: der Eintrag ist beim Verschmelzen verlorengegangen`)
    }

    // Die Jahreskorrektur und die vereinbarten Anteile sind Zuordnungen und keine Listen; ihre
    // Spalten stehen deshalb hier benannt, und der Vergleich gegen `getTableColumns` sichert ab,
    // dass es bei diesen dreien bleibt.
    for (const [table, erwartet] of [
      [prepaymentOverrides, ['tenancyId', 'year', 'amountCents']],
      [costItemShares, ['costItemId', 'unitId', 'percent']],
    ] as const) {
      assert.deepEqual(Object.keys(getTableColumns(table)).sort(), [...erwartet].sort())
    }
    const mitKorrektur = await opened.write((db) => createEntity(db, 'tenancies', 't-korrektur', {
      unitId: 'u1', tenantName: 'A', persons: 1, start: '2024-01-01', prepaymentOverrides: { '2024': 180000 },
    }))
    assert.deepEqual(fieldOf(mitKorrektur, 'prepaymentOverrides'), { '2024': 180000 })
    const mitAnteilen = await opened.write((db) => createEntity(db, 'costItems', 'c-anteile', {
      year: 2024, category: 'Müll', description: 'G', amountCents: 100, key: 'custom', customShares: { u1: 55 },
    }))
    assert.deepEqual(fieldOf(mitAnteilen, 'customShares'), { u1: 55 })
  })
})
