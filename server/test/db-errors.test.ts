// Was SQLite sagt, in Worte fassen, mit denen ein Vermieter etwas anfangen kann (db/errors.ts).
//
// **Der Anlass ist gemessen.** Drizzle verpackt jeden Fehler von SQLite in einen eigenen, und
// dessen Meldung lautet:
//
//   Failed query: insert into "prepayments" ("tenancy_id", "from", "monthly_cents") values (?, ?, ?)
//   params: t1,2024-01,200
//
// Darin steckt zweierlei, das niemals zum Nutzer darf: das SQL und **die Werte seiner eigenen
// Daten**. Der wirkliche Grund steht nicht dort, sondern am Ende der `cause`-Kette. Wer die
// oberste Meldung weiterreicht, zeigt also genau das Falsche und verschweigt das Richtige.

import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { connect } from '../src/db/client.ts'
import { databaseFile, openDatabase, type OpenedDatabase } from '../src/db/open.ts'
import { databaseProblem } from '../src/db/errors.ts'
import { closedSettlements, prepayments, readings, tenancies, units } from '../src/db/schema.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-fehler-'))

// Ein Bestand, an dem sich jeder Verstoß auslösen lässt.
async function withDatabase(work: (opened: OpenedDatabase) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  try {
    await opened.write(async (db) => {
      await db.insert(units).values({ id: 'u1', name: 'EG', areaM2: 50, participates: true })
      await db.insert(tenancies).values({ id: 't1', unitId: 'u1', tenantName: 'Müller', persons: 1, start: '2024-01-01' })
    })
    await work(opened)
  } finally {
    opened.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Der Text, den der Nutzer zu sehen bekäme. Ausgelöst wird der Verstoß echt und nicht
// nachgebaut: Eine von Hand geschriebene Fehlermeldung bewiese nur, dass die Funktion ihre
// eigenen Beispiele übersetzt.
async function messageOfFailure(opened: OpenedDatabase, work: () => Promise<unknown>): Promise<string> {
  try {
    await work()
  } catch (err) {
    // Gefragt wird **derselbe** Weg, den auch die Fehlerbehandlung in index.ts geht. Eine
    // zweite, nur hier benutzte Funktion prüfte sich selbst: Genau daran ist diese Datei einmal
    // vorbeigelaufen, als sie importiert, aber nirgends aufgerufen war.
    const problem = databaseProblem(err)
    if (!problem) return assert.fail(`der Fehler gilt nicht als einer der Datenbank: ${String(err)}`)
    return problem.message
  }
  return assert.fail('der Verstoß hat gar keinen Fehler ausgelöst')
}

test('Ein Verweis ins Leere wird erklärt', async () => {
  await withDatabase(async (opened) => {
    const text = await messageOfFailure(opened, () =>
      opened.write((db) => db.insert(readings).values({ id: 'r1', meterId: 'gibt-es-nicht', date: '2024-06-30', value: 1 })))
    assert.match(text, /gibt es nicht mehr|nicht mehr gibt/, text)
  })
})

test('Ein zweiter Eintrag zum selben Stichtag wird erklärt', async () => {
  // Der Primärschlüssel der Staffeln ist zusammengesetzt, und genau das ist seine Aufgabe: Zwei
  // Vorauszahlungen ab demselben Monat wären nicht entscheidbar.
  await withDatabase(async (opened) => {
    const text = await messageOfFailure(opened, () =>
      opened.write(async (db) => {
        await db.insert(prepayments).values({ tenancyId: 't1', from: '2024-01', monthlyCents: 100 })
        await db.insert(prepayments).values({ tenancyId: 't1', from: '2024-01', monthlyCents: 200 })
      }))
    assert.match(text, /Stichtag/, text)
  })
})

test('Eine zweite abgeschlossene Abrechnung für dasselbe Jahr wird erklärt', async () => {
  await withDatabase(async (opened) => {
    const text = await messageOfFailure(opened, () =>
      opened.write(async (db) => {
        await db.insert(closedSettlements).values({ id: 's1', year: 2024, closedAt: '2025-01-01', settlement: {} })
        await db.insert(closedSettlements).values({ id: 's2', year: 2024, closedAt: '2025-01-02', settlement: {} })
      }))
    assert.match(text, /Jahr/, text)
    assert.match(text, /abgeschlossen/, text)
  })
})

test('Ein Datensatz, den es schon gibt, wird erklärt', async () => {
  await withDatabase(async (opened) => {
    const text = await messageOfFailure(opened, () =>
      opened.write((db) => db.insert(units).values({ id: 'u1', name: 'noch einmal', areaM2: 10, participates: true })))
    assert.match(text, /gibt es (schon|bereits)/, text)
  })
})

test('Ein negativer Wert wird erklärt, und zwar mit dem Feld', async () => {
  await withDatabase(async (opened) => {
    const text = await messageOfFailure(opened, () =>
      opened.write((db) => db.insert(units).values({ id: 'u2', name: 'X', areaM2: -5, participates: true })))
    assert.match(text, /negativ/, text)
    assert.match(text, /Wohnfläche|area/, text)
  })
})

test('Ein unbekannter Wert einer Aufzählung wird erklärt', async () => {
  await withDatabase(async (opened) => {
    // **Bewusst rohes SQL.** Über die getippte Schnittstelle ließe sich dieser Wert gar nicht
    // erst schreiben, der Übersetzer lehnt ihn ab. Genau das ist der Punkt: `text({ enum })`
    // bindet nur ihn, und ein Wert kann auf anderem Weg hereinkommen. Geprüft wird hier, was
    // die **Datenbank** tut, nicht was der Übersetzer verspricht.
    const text = await messageOfFailure(opened, () =>
      opened.write((db) => db.run(sql`INSERT INTO tenancies (id, unit_id, tenant_name, persons, start, deposit_status)
        VALUES ('t2', 'u1', 'B', 1, '2024-01-01', 'gibt-es-nicht')`)))
    assert.match(text, /Mietfuchs nicht kennt|nicht vorgesehen/, text)
  })
})

test('Ein fehlendes Pflichtfeld wird erklärt', async () => {
  await withDatabase(async (opened) => {
    // Auch hier rohes SQL, und aus demselben Grund: Eine Spalte ohne NULL lässt der Übersetzer
    // gar nicht leer, die Bedingung steht aber in der Datenbank und muss dort greifen.
    const text = await messageOfFailure(opened, () =>
      opened.write((db) => db.run(sql`INSERT INTO units (id, name, area_m2, participates)
        VALUES ('u3', NULL, 10, 1)`)))
    assert.match(text, /ausgefüllt|fehlt/, text)
  })
})

test('Weder SQL noch die Werte des Nutzers stehen in der Meldung', async () => {
  // Der eigentliche Grund für diese Datei. Die oberste Meldung von Drizzle führt beides mit
  // sich, und beides ginge den Nutzer nichts an: das SQL nicht, weil es ihm nichts sagt, und
  // seine eigenen Werte nicht, weil eine Fehlermeldung kein Ort für Daten ist.
  await withDatabase(async (opened) => {
    const text = await messageOfFailure(opened, () =>
      opened.write(async (db) => {
        await db.insert(prepayments).values({ tenancyId: 't1', from: '2024-01', monthlyCents: 100 })
        await db.insert(prepayments).values({ tenancyId: 't1', from: '2024-01', monthlyCents: 4711 })
      }))
    assert.doesNotMatch(text, /insert into|select |values \(/i, `SQL in der Meldung: ${text}`)
    assert.doesNotMatch(text, /params:/i, `Parameter in der Meldung: ${text}`)
    assert.doesNotMatch(text, /4711/, `ein Wert des Nutzers in der Meldung: ${text}`)
    assert.doesNotMatch(text, /Failed query/i, `die Hülle von Drizzle in der Meldung: ${text}`)
  })
})

test('Ein Fehler der Datenbank, den niemand vorhergesehen hat, wird nicht verschwiegen', async () => {
  // Eine Übersetzung, die nur ihre eigenen Fälle kennt, verschluckte alles andere. Was nicht
  // erkannt wird, kommt deshalb benannt am Ende heraus, wie in open.ts auch. Erkannt wird es an
  // Drizzles Hülle, denn gerade sie trägt das SQL und die Werte und darf nicht hinaus.
  const problem = databaseProblem(new Error('Failed query: …', { cause: new Error('etwas ganz Unerwartetes') }))
  if (!problem) return assert.fail('ein Fehler mit Drizzles Hülle gilt nicht als einer der Datenbank')
  assert.equal(problem.status, 500)
  assert.match(problem.message, /etwas ganz Unerwartetes/, problem.message)
  assert.match(problem.message, /Technischer Befund/, problem.message)
  assert.doesNotMatch(problem.message, /Failed query/i, problem.message)
})

test('Ein fremder Fehler wird nicht für einen der Datenbank ausgegeben', async () => {
  // **Zwei der Muster sind nicht datenbankeigen.** Ein schreibgeschützter Datenträger meldet
  // `EROFS` auch beim Ablegen eines Belegs, eine volle Platte `ENOSPC`. Wurde das eingeordnet,
  // las der Vermieter „In die Datenbank lässt sich nicht schreiben", während in Wahrheit sein
  // Beleg nicht abgelegt werden konnte. Ohne Drizzles Hülle gehört ein Fehler nicht hierher, und
  // die Fehlerbehandlung in index.ts bleibt dann bei ihrer eigenen Meldung.
  const fremde = [
    'EROFS: read-only file system, open /app/server/data/uploads/beleg.pdf',
    'ENOSPC: no space left on device, write',
    'Unexpected end of form',
    'etwas ganz Unerwartetes',
  ]
  for (const meldung of fremde) {
    assert.equal(databaseProblem(new Error(meldung)), null, meldung)
  }
})

test('Jede Prüfbedingung im Schema folgt der Namenskonvention', async () => {
  // Die Meldung wird aus dem **Namen** der Prüfbedingung abgeleitet und nicht aus einem
  // Katalog, den jemand pflegen müsste. Das trägt nur, solange die Namen der Konvention folgen.
  // Dieser Test hat sich schon einmal bezahlt gemacht: Er fand die Endung „_is_json“, die beim
  // ersten Durchsehen des Schemas untergegangen war.
  // Kommt eine Bedingung mit anderem Namen hinzu, bekäme der Nutzer die Rückfallmeldung, ohne
  // dass es jemandem auffiele. Hier fällt es auf.
  const dataDir = tempDir()
  const opened = await openDatabase({ dataDir })
  opened.close()
  // Über die rohe Verbindung und nicht über Drizzle: Der Proxy-Treiber liefert Zeilen als
  // Listen, und `all` bildete sie erst auf Feldnamen ab. Hier steht ohnehin nur eine Spalte.
  const connection = await connect(databaseFile(dataDir))
  try {
    const ddl = connection.rows("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").map((zeile) => String(zeile[0]))
    const namen = ddl.join('\n').match(/CONSTRAINT "([a-z0-9_]+)" CHECK/gi) ?? []
    assert.ok(namen.length >= 20, `zu wenige Prüfbedingungen gefunden: ${namen.length}`)
    for (const eintrag of namen) {
      const name = eintrag.replace(/CONSTRAINT "|" CHECK/gi, '')
      // Genau eine benannte Ausnahme: `settings_single_row` beschreibt kein Feld, sondern die
      // Tabelle selbst. Sie steht in errors.ts mit eigener Meldung da. Jede **weitere** Ausnahme
      // muss hier bewusst eingetragen werden, und genau das ist der Zweck dieses Tests.
      if (name === 'settings_single_row') continue
      assert.match(name, /_(not_negative|known|is_json)$/, `„${name}" folgt keiner der bekannten Endungen`)
    }
  } finally {
    connection.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
