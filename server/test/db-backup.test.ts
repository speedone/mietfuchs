// Backup und Wiederherstellen, soweit sie die Datenbank betreffen (db/backup.ts, #55).
//
// Der Grund für diese Aufgabe ist ein Ausgang, den es zu vermeiden gilt: Sobald die Routen aus
// der Datenbank lesen, spielt jemand ein Backup ein, sieht eine Bestätigung und arbeitet danach
// mit den alten Daten weiter. Er glaubt, sein Backup sei zurück, und es ist nicht so. Für eine
// Funktion, die es gerade für den Ernstfall gibt, ist das der schlimmste Fehler.
//
// Zwei Zusagen hängen deshalb an dieser Datei:
//
//   1. **Das Archiv enthält einen in sich stimmigen Stand der Datenbank.** Eine laufende
//      SQLite-Datei zu kopieren liefert im schlechtesten Fall einen Stand, den es nie gab.
//   2. **Geprüft wird, bevor irgendetwas ersetzt wird.** Eine beschädigte oder neuere Datenbank
//      aus einem Archiv darf nie an ihrem Platz landen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Db } from '../src/store.ts'
import { straightenForDatabase } from '../src/legacy.ts'
import { connect, loadMigrations } from '../src/db/client.ts'
import { databaseFile, openDatabase } from '../src/db/open.ts'
import { readStock } from '../src/db/read.ts'
import { writeStock } from '../src/legacy/write.ts'
import { archiveDatabaseProblem, archiveInfoText, originText, writeDatabaseSnapshot } from '../src/db/backup.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-backup-'))

const someDb = (): Db => ({
  settings: {
    houseName: 'Haus', address: 'Weg 1', landlordName: 'Vermieter', iban: '', paymentDeadlineDays: 30,
    ollamaUrl: 'http://localhost:11434', ollamaModel: 'modell',
  },
  units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true, notes: 'Notiz' }],
  tenancies: [{
    id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 2,
    personHistory: [{ from: '2024-01-01', persons: 2 }], start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 15000 }], prepaymentOverrides: {},
    baseRents: [{ from: '2024-01', monthlyCents: 60000 }], iban: 'DE01',
  }],
  costItems: [{ id: 'c1', year: 2024, category: 'Müllabfuhr', description: 'Gebühren', amountCents: 12000, key: 'area' }],
  meters: [], readings: [], payments: [], closedSettlements: [],
})

// Eine gefüllte Datenbank auf einem Wegwerf-Ordner.
async function withFilledDatabase(work: (opened: Awaited<ReturnType<typeof openDatabase>>, dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await writeStock(opened.db, straightenForDatabase(someDb()))
    await work(opened, dataDir)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// ---------- Der Schnappschuss ----------

test('Der Schnappschuss ist eine eigenständige Datei mit demselben Inhalt', async () => {
  // `VACUUM INTO` statt einer Dateikopie: Die Datei ist die ganze Laufzeit offen, und eine
  // laufende SQLite-Datei zu kopieren liefert im schlechtesten Fall einen Stand, den es nie gab
  // (halb geschriebene Seite, Beidatei nicht mitgenommen).
  await withFilledDatabase(async (opened, dataDir) => {
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    await writeDatabaseSnapshot(opened, ziel)

    assert.ok(fs.existsSync(ziel), 'die Datei ist entstanden')
    // Keine Beidateien: Das Archiv nimmt nur die eine Datei mit, und was daneben läge, fehlte
    // danach. Aus demselben Grund läuft auch der Umstieg ohne WAL.
    for (const suffix of ['-wal', '-shm', '-journal']) {
      assert.equal(fs.existsSync(`${ziel}${suffix}`), false, `neben dem Schnappschuss liegt ${suffix}`)
    }

    // Und sie lässt sich für sich allein lesen, mit demselben Bestand.
    const eigene = await connect(ziel)
    try {
      const zurueck = await readStock(eigene.db)
      const hier = await readStock(opened.db)
      assert.deepStrictEqual(zurueck, hier, 'der Schnappschuss hat denselben Bestand')
    } finally {
      eigene.close()
    }
  })
})

test('Der Schnappschuss nimmt die Buchführung über den Aufbau mit', async () => {
  // Ohne sie wüsste das Wiederherstellen nicht, aus welchem Schema die Datei stammt, und die
  // Prüfung „aus einer neueren Version?" hätte nichts, woran sie sich halten könnte.
  await withFilledDatabase(async (opened, dataDir) => {
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    await writeDatabaseSnapshot(opened, ziel)
    const eigene = await connect(ziel)
    try {
      const marken = eigene.rows('SELECT count(*) FROM __drizzle_migrations')
      assert.equal(Number(marken[0]?.[0]), (await loadMigrations()).length, 'alle Schritte stehen darin')
    } finally {
      eigene.close()
    }
  })
})

// ---------- Die Prüfung vor dem Austausch ----------

test('Eine gesunde Datenbank aus dem Archiv wird nicht beanstandet', async () => {
  await withFilledDatabase(async (opened, dataDir) => {
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    await writeDatabaseSnapshot(opened, ziel)
    assert.equal(await archiveDatabaseProblem(ziel), null)
  })
})

test('Eine beschädigte Datenbank aus dem Archiv wird beanstandet', async () => {
  // Sie darf nie an ihren Platz gelangen. Bemerkt würde es sonst erst beim nächsten Start, und
  // dann liegt die alte Datei schon nicht mehr da.
  await withFilledDatabase(async (opened, dataDir) => {
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    await writeDatabaseSnapshot(opened, ziel)
    const kaputt = fs.readFileSync(ziel)
    kaputt.fill(0x5a, 4096, 8192)
    fs.writeFileSync(ziel, kaputt)

    const befund = await archiveDatabaseProblem(ziel)
    assert.ok(befund, 'es gibt eine Beanstandung')
    assert.match(befund, /beschädigt/, 'die Meldung sagt, was los ist')
    assert.match(befund, /Technischer Befund:/, 'die Meldung von SQLite ist eingeordnet, nicht allein')
  })
})

test('Eine Datenbank aus einer neueren Version wird beanstandet', async () => {
  // Über den Umweg Backup käme ein neueres Schema sonst herein, und die Prüfung beim Start käme
  // zu spät: Die Datei läge dann schon an ihrem Platz.
  await withFilledDatabase(async (opened, dataDir) => {
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    await writeDatabaseSnapshot(opened, ziel)
    const fremd = await connect(ziel)
    fremd.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('kennen-wir-nicht', 1893456000000)")
    fremd.close()

    const befund = await archiveDatabaseProblem(ziel)
    assert.ok(befund, 'es gibt eine Beanstandung')
    assert.match(befund, /neueren Mietfuchs-Version/, 'die Meldung sagt, was los ist')
    // Was zu tun ist, unterscheidet sich vom Start: Dort geht es um die eigene Arbeitsdatei,
    // hier um ein Archiv, das mit der neueren Fassung eingespielt gehört.
    assert.match(befund, /neueren Fassung/, 'die Meldung sagt, was zu tun ist')
  })
})

test('Eine Datei, die gar keine Datenbank ist, wird beanstandet', async () => {
  const dataDir = tempDir()
  try {
    const ziel = path.join(dataDir, 'schnappschuss.sqlite')
    fs.writeFileSync(ziel, 'Das ist ein Brief und keine Datenbank.', 'utf8')
    const befund = await archiveDatabaseProblem(ziel)
    assert.ok(befund, 'es gibt eine Beanstandung')
    assert.match(befund, /beschädigt|keine Datenbank/, befund)
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

// ---------- Die Herkunftsangabe ----------

test('Das Archiv nennt, aus welcher Version es stammt', () => {
  // Ohne diese Angabe lässt sich nicht sagen, ob ein unbekanntes Feld aus einer neueren Fassung
  // stammt oder Müll ist.
  const text = archiveInfoText(new Date('2026-09-21T10:00:00.000Z'))
  const gelesen: unknown = JSON.parse(text)
  assert.ok(gelesen !== null && typeof gelesen === 'object')
  assert.equal(Reflect.get(gelesen, 'app'), 'mietfuchs')
  assert.match(originText(gelesen), /Mietfuchs \d+\.\d+\.\d+/, originText(gelesen))
  assert.match(originText(gelesen), /21\.09\.2026/, originText(gelesen))
})

test('Eine fehlende oder unsinnige Herkunftsangabe wirft nichts um', () => {
  // Sie ist eine Auskunft und keine Prüfung: Ein Archiv ohne sie ist eines aus einer älteren
  // Version, und genau die liegen bei den heutigen Nutzern.
  for (const unsinn of [null, undefined, 42, 'Text', {}, { app: 'etwas anderes' }, { version: 7 }]) {
    const text = originText(unsinn)
    assert.equal(typeof text, 'string')
    assert.ok(text.length > 0, `leere Auskunft für ${JSON.stringify(unsinn)}`)
  }
  assert.match(originText(null), /unbekannt/)
})
