// Ablage der db.json (store.ts): das Verhalten von load()/getDb() bei einem scheiternden
// Migrationsschritt und die Regeln, nach denen aus dem Inhalt einer Datei ein Datenbestand
// wird. Alles andere rund um den Datenordner steht in dataDir.test.ts.
//
// `DATA_DIR` wird beim Import von store.ts einmalig aus der Umgebung berechnet, und `db` ist
// modulweiter Zustand. Damit jeder Testfall mit einem eigenen Datenordner und einem frischen
// `db` startet, wird store.ts hier über einen Cache-Buster in der Import-Spezifikation jedes
// Mal neu geladen (Node behandelt eine andere Spezifikation als eigenes Modul, auch wenn sie
// auf dieselbe Datei zeigt).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Tenancy } from '../../shared/types.ts'
import type { Db } from '../src/store.ts'

async function freshStore(dataDir: string): Promise<typeof import('../src/store.ts')> {
  const prevEnv = process.env.NKA_DATA_DIR
  process.env.NKA_DATA_DIR = dataDir
  try {
    return await import(`../src/store.ts?fresh=${Math.random()}`)
  } finally {
    if (prevEnv === undefined) delete process.env.NKA_DATA_DIR
    else process.env.NKA_DATA_DIR = prevEnv
  }
}

test('ein scheiternder Migrationsschritt hinterlässt keinen halb migrierten Bestand', async () => {
  // Ein Mietverhältnis ohne `prepayments`, aber mit dem Altformat-Feld und einem kaputten
  // `start`: Die Migration in load() versucht `t.start.slice(0, 7)` und wirft, bevor sie diese
  // Wohnung fertig migrieren kann. Ein realistischer Fall für eine von Hand verdorbene db.json,
  // nicht nur ein Testkonstrukt.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-migration-fehler-'))
  try {
    fs.writeFileSync(
      path.join(tmp, 'db.json'),
      JSON.stringify({
        tenancies: [
          { id: 't1', unitId: 'u1', tenantName: 'Kaputt', persons: 1, start: null, end: null, prepaymentMonthlyCents: 15000 },
        ],
      }),
    )
    const store = await freshStore(tmp)

    // Erster Aufruf: wirft in jeder Fassung von load(), weil die Migration mittendrin scheitert.
    assert.throws(() => store.getDb(), TypeError)

    // Zweiter Aufruf ist der eigentliche Befund: Die alte Fassung von load() wies das Ergebnis
    // schon vor der Migrationsschleife der modulweiten Variable `db` zu, sodass sie nach dem
    // Fehler einen halb migrierten Bestand enthielt (Einstellungen migriert, die kaputte
    // Wohnung nicht). `getDb()` hätte ihn beim zweiten Aufruf klaglos zurückgegeben, und ein
    // nachfolgendes save() hätte ihn auf die Platte geschrieben. Die jetzige Fassung weist erst
    // ganz am Ende zu, `db` bleibt also `null` und jeder weitere Aufruf scheitert genauso wie
    // der erste, statt einen kaputten Bestand auszuliefern.
    assert.throws(() => store.getDb(), TypeError)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ---------- Die Regeln für die alten Formate ----------
//
// Was load() aus dem Inhalt einer db.json macht, ist nicht nur eine Frage des Einlesens: Der
// Umstieg der vorhandenen Bestände in die Datenbank (#55) braucht **dieselben** Regeln. Zwei
// Fassungen, die auseinanderlaufen, änderten beim Umstieg still eine Abrechnung. Diese Tests
// halten die Regeln fest, bevor sie in eine eigene Datei wandern; grün davor und grün danach
// ist der Nachweis, dass sich am Verhalten nichts geändert hat.

// Ein Mietverhältnis, wie es in einer db.json aus der Zeit vor den Staffeln steht: ein fester
// Monatsbetrag statt der Vorauszahlungs-Staffel, eine feste Personenzahl statt der
// Personen-Staffel, keine Kaltmiete und keine Jahreskorrektur. Ausdrücklich getypt, damit im
// Test nur das Fachliche steht und der Übersetzer den Rest vergleicht.
type LegacyTenancy = Omit<Tenancy, 'persons' | 'personHistory' | 'prepayments' | 'prepaymentOverrides' | 'baseRents'> & {
  persons?: number
  prepaymentMonthlyCents?: number
}

const legacyTenancy = (extra: Partial<LegacyTenancy> = {}): LegacyTenancy => ({
  id: 't1',
  unitId: 'u1',
  tenantName: 'Müller',
  persons: 2,
  start: '2024-03-15',
  end: null,
  ...extra,
})

// Schreibt eine db.json in einen Wegwerf-Ordner und reicht den eingelesenen Bestand weiter.
async function loaded(file: unknown, check: (db: Db) => void): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-altformat-'))
  try {
    if (file !== undefined) fs.writeFileSync(path.join(tmp, 'db.json'), JSON.stringify(file))
    check((await freshStore(tmp)).getDb())
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

test('Altformat: ein fester Monatsbetrag wird zur Vorauszahlungs-Staffel ab dem Einzugsmonat', async () => {
  await loaded({ tenancies: [legacyTenancy({ prepaymentMonthlyCents: 15000 })] }, (db) => {
    assert.deepEqual(db.tenancies[0].prepayments, [{ from: '2024-03', monthlyCents: 15000 }])
    // Das alte Feld wird dabei entfernt, sonst stünden zwei Wahrheiten nebeneinander.
    assert.equal('prepaymentMonthlyCents' in db.tenancies[0], false)
  })
})

test('Altformat: ohne festen Monatsbetrag bleibt die Vorauszahlungs-Staffel leer', async () => {
  await loaded({ tenancies: [legacyTenancy()] }, (db) => {
    assert.deepEqual(db.tenancies[0].prepayments, [])
  })
})

test('Altformat: eine vorhandene Staffel bleibt unangetastet, auch die leere', async () => {
  const staffel = [{ from: '2024-06', monthlyCents: 20000 }]
  await loaded({ tenancies: [{ ...legacyTenancy({ prepaymentMonthlyCents: 15000 }), prepayments: staffel }] }, (db) => {
    assert.deepEqual(db.tenancies[0].prepayments, staffel)
  })
  // Eine leere Staffel zählt als vorhanden: Das alte Feld wird dann **nicht** umgewandelt und
  // bleibt stehen. Die Berechnung liest es weiterhin (computePrepaymentCents fällt darauf
  // zurück, solange die Staffel leer ist), die Vorauszahlung geht also nicht verloren. Für den
  // Umstieg in die Datenbank ist genau das die Stelle zum Hinsehen: Dort gibt es für das alte
  // Feld keine Spalte mehr.
  await loaded({ tenancies: [{ ...legacyTenancy({ prepaymentMonthlyCents: 15000 }), prepayments: [] }] }, (db) => {
    assert.deepEqual(db.tenancies[0].prepayments, [])
    assert.equal('prepaymentMonthlyCents' in db.tenancies[0], true)
  })
})

test('Altformat: die feste Personenzahl wird zur Personen-Staffel ab dem Einzugstag', async () => {
  await loaded({ tenancies: [legacyTenancy({ persons: 3 })] }, (db) => {
    assert.deepEqual(db.tenancies[0].personHistory, [{ from: '2024-03-15', persons: 3 }])
  })
  // Ohne Personenzahl gilt eine Person. Anders als bei der Vorauszahlung bleibt `persons`
  // stehen, denn das Datenmodell führt es weiterhin als aktuelle Personenzahl.
  await loaded({ tenancies: [legacyTenancy({ persons: undefined })] }, (db) => {
    assert.deepEqual(db.tenancies[0].personHistory, [{ from: '2024-03-15', persons: 1 }])
  })
})

test('Altformat: Kaltmiete-Staffel und Jahreskorrektur werden leer ergänzt', async () => {
  await loaded({ tenancies: [legacyTenancy()] }, (db) => {
    assert.deepEqual(db.tenancies[0].baseRents, [])
    assert.deepEqual(db.tenancies[0].prepaymentOverrides, {})
  })
  const overrides = { '2024': 180000 }
  await loaded({ tenancies: [{ ...legacyTenancy(), prepaymentOverrides: overrides }] }, (db) => {
    assert.deepEqual(db.tenancies[0].prepaymentOverrides, overrides)
  })
})

test('Altformat: das frühere Standardmodell, das es nie gab, wird ersetzt', async () => {
  await loaded({ settings: { ollamaModel: 'qwen3.6-35b' } }, (db) => {
    assert.notEqual(db.settings.ollamaModel, 'qwen3.6-35b')
    assert.equal(db.settings.ollamaModel, db.settings.ai?.text.model)
  })
  // Eine eigene Wahl bleibt unangetastet.
  await loaded({ settings: { ollamaModel: 'eigenes-modell' } }, (db) => {
    assert.equal(db.settings.ollamaModel, 'eigenes-modell')
  })
})

test('Altformat: fehlende Sammlungen und Einstellungen kommen aus den Vorgabewerten', async () => {
  await loaded({ units: [{ id: 'u1', name: 'EG', areaM2: 80, participates: true }] }, (db) => {
    assert.deepEqual(db.tenancies, [])
    assert.deepEqual(db.costItems, [])
    assert.deepEqual(db.meters, [])
    assert.deepEqual(db.readings, [])
    assert.deepEqual(db.payments, [])
    assert.deepEqual(db.closedSettlements, [])
    assert.equal(db.settings.paymentDeadlineDays, 30)
    // Die KI-Einstellungen entstehen aus Adresse und Modell (siehe ai/settings.ts).
    assert.equal(db.settings.ai?.text.provider, 'ollama')
  })
})

test('Ohne db.json entsteht ein leerer Bestand mit den Vorgabewerten', async () => {
  await loaded(undefined, (db) => {
    assert.deepEqual(db.units, [])
    assert.equal(db.settings.paymentDeadlineDays, 30)
    assert.equal(db.settings.ai?.text.provider, 'ollama')
  })
})
