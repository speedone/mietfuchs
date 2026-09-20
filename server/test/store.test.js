// Ablage der db.json (store.ts): hier nur das Verhalten von load()/getDb() bei einem
// scheiternden Migrationsschritt. Alles andere rund um den Datenordner steht in dataDir.test.js.
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

async function freshStore(dataDir) {
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
