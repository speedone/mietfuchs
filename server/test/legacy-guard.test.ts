// Der Wächter an der eingefrorenen Grenze (server/src/legacy/write.ts, Aufgabe 6b).
//
// ---------- Warum es ihn gibt, und warum keine Kopie ----------
//
// Der Eingang liest eine alte `db.json` und schreibt in die Tabellen, wie sie nach Migration 0000
// aussehen. Die **fachlichen** Daten sind eingefroren, weil dieselbe Datei immer dieselben Zahlen
// ergeben muss: Die sind einem Mieter zugestellt worden.
//
// Die **Einstellungen** sind das nicht, und das ist eine Entscheidung und kein Versäumnis. Sie
// laufen weiter durch `migrateAi` in ai/settings.ts, also durch lebenden Code. Der Grund ist die
// Zusage, die sie brauchen: Niemandem hilft eine Vorlagenwahl von 2026, wenn er in einem Jahr
// einspielt; ihm hilft eine Einrichtung, die mit dem Code von dann arbeitet. Und die Asymmetrie
// ist deutlich: Kommt eine Einstellung anders heraus, korrigiert es die Oberfläche und nichts ist
// verloren. Kommt eine Zahl anders heraus, hat ein Mieter eine falsche Abrechnung bekommen.
//
// **Bleibt ein Risiko, und es ist begrenzt.** In den eingefrorenen Tabellen gibt es genau vier
// Aufzählungsbedingungen. Lieferte lebender Code eines Tages einen Wert, den der Wortschatz von
// damals nicht kennt, scheiterte der Umstieg an einer dieser Bedingungen — zur Laufzeit beim
// Vermieter und nicht beim Übersetzen. Deshalb klemmt der Schreiber diese vier, und zwar mit
// eingefrorenen Listen.
//
// Das ist kein Nachbau der Logik, sondern eine Aussage über das Schema: Diese Spalten konnten
// damals genau das enthalten. Eine Kopie von `migrateAi` wäre die zweite Stelle, an der dieselbe
// Regel steht; dieser Wächter ist keine.
//
// Erreichbar ist der Fall heute nicht: Ab diesem Release schreibt Mietfuchs keine `db.json` mehr,
// die Menge aller Dateien, die es je geben wird, steht also fest, und ihr Wortschatz ist der von
// v0. Der Wächter ist der Gurt für das, was sich nicht ausschließen lässt, nämlich dass ein
// künftiges `migrateAi` aus einer alten Adresse einen neuen Anbieter ableitet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrateLegacy, straightenForDatabase } from '../src/legacy/migrate.ts'
import type { Db } from '../src/store.ts'
import { applyMigrations, connect, loadMigrations, type Database } from '../src/db/client.ts'
import { readSettings } from '../src/legacy/read.ts'
import { writeStock } from '../src/legacy/write.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-wachter-'))

// **Eine Datenbank mit genau Migration 0000**, so wie der Umstieg sie anlegt, und nicht mit der
// ganzen Kette. Das ist der Unterschied, auf den es hier ankommt: Geklemmt wird gegen die
// Prüfbedingungen von **damals**, und `openDatabase` wendet alle Schritte an. Solange beide
// Stände dieselben sind, fiele das nicht auf; ab der ersten Migration, die eine Liste ändert,
// träfe der Test die heutigen Bedingungen und bewiese etwas anderes, als er behauptet.
async function withV0Database(work: (db: Database) => Promise<void>): Promise<void> {
  const dataDir = tempDir()
  const connection = await connect(path.join(dataDir, 'v0.sqlite'))
  try {
    const migrations = await loadMigrations()
    const ausgangsstand = migrations[0]
    if (!ausgangsstand) return assert.fail('es gibt keine Migrationen')
    applyMigrations(connection, [ausgangsstand])
    await work(connection.db)
  } finally {
    connection.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

// Ein Bestand, dessen Einstellungen Werte tragen, die der Wortschatz von damals nicht kennt.
// Hergestellt wird das über den gewöhnlichen Weg (`migrateLegacy`) und danach von Hand gesetzt:
// So sähe der Bestand aus, wenn ein künftiges `migrateAi` etwas Neues ableitet.
function withUnknownVocabulary(): Db {
  const stand = migrateLegacy({
    settings: { houseName: 'Haus', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' },
    units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
  })
  const ai = stand.settings.ai
  if (!ai) return assert.fail('migrateLegacy hat die KI-Einstellungen nicht ergänzt')
  // `Reflect.set` und nicht eine Zuweisung: Die Werte gibt es im heutigen Typ gar nicht, und
  // genau das ist der geprüfte Fall. Eine Zusicherung darüber wäre eine Behauptung über eine
  // Zukunft, die niemand kennt.
  Reflect.set(ai.text, 'provider', 'anthropic')
  Reflect.set(ai, 'jsonMode', 'ganz-neuer-modus')
  Reflect.set(stand.settings, 'updateCheck', 'vielleicht')
  return stand
}

test('Ein Wert, den der Wortschatz von damals nicht kennt, klemmt der Schreiber', async () => {
  // Ohne den Wächter scheitert schon das Schreiben, und zwar an
  // `ai_slots_provider_known`, `settings_ai_json_mode_known` und `settings_update_check_known`.
  await withV0Database(async (db) => {
    const stand = withUnknownVocabulary()
    await writeStock(db, straightenForDatabase(stand))

    const gelesen = await readSettings(db)
    assert.equal(gelesen.ai.text.provider, 'ollama', 'der unbekannte Anbieter ist durchgekommen')
    assert.equal(gelesen.ai.jsonMode, 'auto', 'der unbekannte Modus ist durchgekommen')
    assert.equal(gelesen.updateCheck, undefined, 'die unbekannte Update-Einstellung ist durchgekommen')
    // Und der Rest der Einstellungen ist unangetastet: Geklemmt wird genau, was nicht passt.
    assert.equal(gelesen.houseName, 'Haus')
  })
})

test('Ein Platz, den es damals nicht gab, kommt gar nicht in die Tabelle', async () => {
  // `ai_slots_slot_known` kennt genau `text` und `images`. Ein dritter Platz wäre eine
  // Einstellung, die niemand liest, und ein Import daran zu scheitern wäre das Schlechteste.
  await withV0Database(async (db) => {
    const stand = migrateLegacy({
      settings: { houseName: 'Haus', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' },
      units: [], tenancies: [], costItems: [], meters: [], readings: [], payments: [], closedSettlements: [],
    })
    const ai = stand.settings.ai
    if (!ai) return assert.fail('migrateLegacy hat die KI-Einstellungen nicht ergänzt')
    Reflect.set(ai, 'stimme', { provider: 'ollama', preset: 'ollama-local', url: 'http://x:1', model: 'm', vision: null })

    await writeStock(db, straightenForDatabase(stand))
    const gelesen = await readSettings(db)
    assert.equal(gelesen.ai.text.provider, 'ollama')
    assert.equal(gelesen.ai.images, null, 'ein erfundener Platz ist als Bilder-Platz angekommen')
  })
})
