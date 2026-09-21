// Hält Schema und Datenmodell zusammen, und prüft die Zusicherungen an einer echten Datenbank.
//
// Zwei Ebenen, und beide werden gebraucht:
//
//   Zur Übersetzungszeit  Die Spalten einer Tabelle und die Felder des Domänentyps aus
//                         shared/types.ts müssen einander entsprechen. Das kostet zur Laufzeit
//                         nichts und schlägt fehl, sobald jemand nur eine Seite ändert. Nötig
//                         ist es, weil die Domänentypen bewusst von Hand geschrieben bleiben:
//                         Der Browser benutzt sie und darf von Drizzle nichts wissen.
//   Zur Laufzeit          Dass die erzeugte Migration wirklich anwendbar ist und die
//                         Fremdschlüssel, Prüfbedingungen und Primärschlüssel tatsächlich
//                         greifen. Ein Schema, das nur gut aussieht, hilft niemandem.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AiSettings, AiSlot, CostItem, Meter, Payment, PersonEntry, PrepaymentEntry, Reading, RentEntry, Settings, Tenancy, Unit } from '../../shared/types.ts'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import * as schema from '../src/db/schema.ts'

// ---------- Ebene 1: Schema und Datenmodell ----------

// Beidseitige Gleichheit. `[A] extends [B]` statt `A extends B`, damit ein Vereinigungstyp
// nicht aufgeteilt und stückweise geprüft wird.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// Der Anker: Nur `true` ist zulässig. Steht dort `false`, nennt der Übersetzer die Zeile.
type Assert<T extends true> = T

// Passt der Wert einer Spalte in das Feld des Domänentyps? NULL in der Datenbank und ein
// fehlendes Feld im Modell meinen dasselbe („nicht gesetzt"), deshalb wird beides vor dem
// Vergleich abgezogen. Passt etwas nicht, steht statt `true` ein Objekt da, das den Namen der
// Spalte und beide Typen nennt — so sagt die Fehlermeldung, worum es geht.
type ValuesFit<Row, Domain> = {
  [K in keyof Row & keyof Domain]: Exclude<Row[K], null> extends Exclude<Domain[K], null | undefined>
    ? true
    : { spalte: K; inDerDatenbank: Row[K]; imModell: Domain[K] }
}[keyof Row & keyof Domain]

// Die beiden Prüfungen je Tabelle: gleiche Namen, passende Werte.
type Matches<Row, Domain> = Equals<keyof Row, keyof Domain> extends true
  ? Equals<ValuesFit<Row, Domain>, true>
  : { spaltenFehlen: Exclude<keyof Domain, keyof Row>; spaltenZuViel: Exclude<keyof Row, keyof Domain> }

// --- Wohnungen ---
type _Units = Assert<Matches<typeof schema.units.$inferSelect, Unit>>

// --- Mietverhältnisse ---
// Die vier verschachtelten Listen stehen in eigenen Tabellen und haben deshalb keine Spalte.
// Dass sie hier aufgezählt sind, ist Absicht: Wer eine davon wieder in die Zeile holt oder eine
// fünfte hinzufügt, muss diese Zeile anfassen und stolpert über die Entscheidung.
type TenancyColumns = Omit<Tenancy, 'personHistory' | 'prepayments' | 'baseRents' | 'prepaymentOverrides'>
type _Tenancies = Assert<Matches<typeof schema.tenancies.$inferSelect, TenancyColumns>>

type _PersonHistory = Assert<Matches<Omit<typeof schema.personHistory.$inferSelect, 'tenancyId'>, PersonEntry>>
type _Prepayments = Assert<Matches<Omit<typeof schema.prepayments.$inferSelect, 'tenancyId'>, PrepaymentEntry>>
type _BaseRents = Assert<Matches<Omit<typeof schema.baseRents.$inferSelect, 'tenancyId'>, RentEntry>>

// `prepaymentOverrides` ist im Modell `Record<string, number>`, also Jahr auf Betrag. In der
// Tabelle sind daraus zwei Spalten geworden. Ein Namensvergleich ginge hier ins Leere; geprüft
// wird deshalb, dass Schlüssel und Wert die Typen behalten, die der Record vorgibt. Das Jahr
// wird dabei zur Zahl, was es inhaltlich immer war — als Schlüssel eines JSON-Objekts konnte es
// nur nicht anders als eine Zeichenkette dastehen.
type OverrideRow = typeof schema.prepaymentOverrides.$inferSelect
type _Overrides = Assert<Equals<OverrideRow['year'], number>>
type _OverrideAmount = Assert<Equals<OverrideRow['amountCents'], Tenancy['prepaymentOverrides'][string]>>

// --- Kostenpositionen ---
type CostItemColumns = Omit<CostItem, 'customShares'>
type _CostItems = Assert<Matches<typeof schema.costItems.$inferSelect, CostItemColumns>>

// `customShares` ist `Record<Wohnungs-Kennung, Prozent>`. Auch hier prüft der Namensvergleich
// nichts, wohl aber die Typen der beiden Spalten, die daraus geworden sind.
type ShareRow = typeof schema.costItemShares.$inferSelect
type _ShareUnit = Assert<Equals<ShareRow['unitId'], Unit['id']>>
type _SharePercent = Assert<Equals<ShareRow['percent'], number>>

// --- Zähler, Ablesungen, Zahlungen ---
type _Meters = Assert<Matches<typeof schema.meters.$inferSelect, Meter>>
type _Readings = Assert<Matches<typeof schema.readings.$inferSelect, Reading>>
type _Payments = Assert<Matches<typeof schema.payments.$inferSelect, Payment>>

// --- Einstellungen ---
// Was hier nicht als Spalte auftaucht und warum:
//   ai                              steht teils in `ai_slots`, teils als Spalte mit Präfix
//   fixedByEnv, aiKeys, aiExternal  rechnet der Server bei jeder Antwort aus und speichert sie nie
type SettingsColumns = Omit<Settings, 'ai' | 'fixedByEnv' | 'aiKeys' | 'aiExternal'> & {
  // Die eine Zeile. Eine Prüfbedingung hält sie bei 1.
  id: number
  // Die Einstellungen für Fortgeschrittene. Der Zugriff über `AiSettings['…']` ist Absicht:
  // Ändert sich dort ein Typ oder fällt ein Feld weg, bricht genau diese Zeile.
  aiTimeoutSeconds: AiSettings['timeoutSeconds']
  aiNumCtx: AiSettings['numCtx']
  aiMaxOutputTokens: AiSettings['maxOutputTokens']
  aiPageImageEdge: AiSettings['pageImageEdge']
  aiJsonMode: AiSettings['jsonMode']
  aiReasoningEffort: AiSettings['reasoningEffort']
  aiExtraInstructions: AiSettings['extraInstructions']
}
type _Settings = Assert<Matches<typeof schema.settings.$inferSelect, SettingsColumns>>

// --- Die Plätze der KI ---
// `consent` gehört zum Platz und steht deshalb in derselben Zeile, aufgeteilt auf drei Spalten.
type AiSlotColumns = AiSlot & {
  slot: 'text' | 'images'
  consentUrl: string | null
  consentModel: string | null
  consentDate: string | null
}
type _AiSlots = Assert<Matches<typeof schema.aiSlots.$inferSelect, AiSlotColumns>>

// ---------- Ebene 2: die Zusicherungen an einer echten Datenbank ----------

async function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-schema-'))
  const connection = await connect(path.join(dir, 'test.db'))
  const applied = applyMigrations(connection, await loadMigrations())
  return {
    connection,
    applied,
    cleanup: () => {
      connection.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

// Führt SQL aus und sagt, ob SQLite es abgewiesen hat. Die eigentliche Meldung steckt bei
// Drizzle in `cause`; hier arbeiten wir roh, also kommt sie unmittelbar.
function rejects(connection: { exec: (sql: string) => void }, sql: string): string | null {
  try {
    connection.exec(sql)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const einWohnung = "INSERT INTO units (id, name, area_m2, participates) VALUES ('u1', 'Links', 72, 1)"

test('Migration lässt sich anwenden und legt alle Tabellen an', async () => {
  const { connection, applied, cleanup } = await freshDb()
  try {
    assert.equal(applied, 1, 'genau ein Migrationsschritt')
    const tables = connection
      .rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((row) => String(row[0]))
    assert.deepEqual(tables, [
      '__drizzle_migrations',
      'ai_slots',
      'base_rents',
      'closed_settlements',
      'cost_item_shares',
      'cost_items',
      'meters',
      'payments',
      'person_history',
      'prepayment_overrides',
      'prepayments',
      'readings',
      'settings',
      'sqlite_sequence',
      'tenancies',
      'units',
    ])
  } finally {
    cleanup()
  }
})

test('ein zweiter Lauf wendet nichts noch einmal an', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    assert.equal(applyMigrations(connection, await loadMigrations()), 0)
  } finally {
    cleanup()
  }
})

// Der Grund für diesen Test steht in server/drizzle/README.md und im Bericht zu Aufgabe 2: Eine
// Fassung von drizzle-kit (1.0.0-rc.4) lässt bei einem Primärschlüssel aus Text das `NOT NULL`
// weg, und SQLite liest das als Erlaubnis für NULL-Kennungen — sogar für mehrere. Eine
// Wohnung ohne Kennung ist aber keine Wohnung. Deshalb wird es hier nachgemessen statt
// vorausgesetzt, damit ein späterer Fassungswechsel hier scheitert und nicht bei einem Nutzer.
test('Primärschlüssel aus Text weisen eine leere Kennung ab', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    const fehler = rejects(connection, "INSERT INTO units (id, name, area_m2, participates) VALUES (NULL, 'Ohne', 50, 1)")
    assert.ok(fehler, 'eine Wohnung ohne Kennung muss abgewiesen werden')
    assert.match(fehler, /NOT NULL/i)
  } finally {
    cleanup()
  }
})

test('im erzeugten SQL steht NOT NULL an jedem Primärschlüssel aus Text', async () => {
  const migrations = await loadMigrations()
  const sql = migrations.flatMap((m) => m.statements).join('\n')
  const textPrimaryKeys = sql.match(/text PRIMARY KEY.*/g) ?? []
  assert.ok(textPrimaryKeys.length >= 7, `zu wenige Primärschlüssel gefunden: ${textPrimaryKeys.length}`)
  for (const line of textPrimaryKeys) {
    assert.match(line, /text PRIMARY KEY NOT NULL/, `ohne NOT NULL: ${line}`)
  }
})

test('Fremdschlüssel: eine Wohnung, die es nicht gibt, wird abgewiesen', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    const fehler = rejects(
      connection,
      "INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'gibtesnicht', 'Meier', 2, '2025-01-01')",
    )
    assert.match(fehler ?? '', /FOREIGN KEY/i)
  } finally {
    cleanup()
  }
})

test('Löschen einer Wohnung räumt ab, was ohne sie sinnlos wäre', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2025-01-01')")
    connection.exec("INSERT INTO payments (id, tenancy_id, date, amount_cents) VALUES ('p1', 't1', '2025-01-05', 85000)")
    connection.exec("INSERT INTO prepayments (tenancy_id, `from`, monthly_cents) VALUES ('t1', '2025-01', 20000)")
    connection.exec("INSERT INTO meters (id, name, unit_id, type, unit) VALUES ('m1', 'Kaltwasser', 'u1', 'kaltwasser', 'm³')")
    connection.exec("INSERT INTO readings (id, meter_id, date, value) VALUES ('r1', 'm1', '2025-01-01', 100)")
    connection.exec("INSERT INTO cost_items (id, year, category, description, amount_cents, key) VALUES ('c1', 2025, 'Gartenpflege', 'Garten', 60000, 'custom')")
    connection.exec("INSERT INTO cost_item_shares (cost_item_id, unit_id, percent) VALUES ('c1', 'u1', 50)")

    connection.exec("DELETE FROM units WHERE id = 'u1'")

    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    // Die Zahlung hängt über das Mietverhältnis an der Wohnung — heute räumt index.ts sie über
    // genau diesen Umweg weg, hier tut es die Kette der Fremdschlüssel.
    assert.equal(zahl('tenancies'), 0, 'Mietverhältnisse')
    assert.equal(zahl('payments'), 0, 'Zahlungen über das Mietverhältnis')
    assert.equal(zahl('prepayments'), 0, 'Vorauszahlungs-Staffel')
    assert.equal(zahl('meters'), 0, 'Zähler')
    assert.equal(zahl('readings'), 0, 'Ablesungen über den Zähler')
    assert.equal(zahl('cost_item_shares'), 0, 'vereinbarte Anteile')
    // Die Kostenposition selbst bleibt: Die Rechnung ist bezahlt worden.
    assert.equal(zahl('cost_items'), 1, 'die Kostenposition bleibt')
  } finally {
    cleanup()
  }
})

test('Direktzuordnung überlebt das Löschen ihrer Wohnung, nur der Verweis fällt weg', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec(
      "INSERT INTO cost_items (id, year, category, description, amount_cents, key, direct_unit_id) VALUES ('c1', 2025, 'Sonstige Betriebskosten', 'Reparatur', 40000, 'direct', 'u1')",
    )
    connection.exec("DELETE FROM units WHERE id = 'u1'")
    const row = connection.rows("SELECT amount_cents, direct_unit_id FROM cost_items WHERE id = 'c1'")[0]
    assert.ok(row, 'die Kostenposition muss es noch geben')
    // Der Betrag ist unverändert: Eine gelöschte Wohnung darf die Summe eines abgerechneten
    // Jahres nicht verändern.
    assert.equal(Number(row[0]), 40000)
    assert.equal(row[1], null, 'der Verweis zeigt ins Leere, wie calc.ts es erwartet')
  } finally {
    cleanup()
  }
})

test('Prüfbedingungen: was nicht negativ sein darf, ist es auch nicht', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2025-01-01')")
    assert.ok(
      rejects(connection, "INSERT INTO units (id, name, area_m2, participates) VALUES ('u2', 'Minus', -10, 1)"),
      'negative Wohnfläche',
    )
    assert.ok(
      rejects(connection, "INSERT INTO prepayments (tenancy_id, `from`, monthly_cents) VALUES ('t1', '2025-02', -1)"),
      'negative Vorauszahlung',
    )
    assert.ok(
      rejects(connection, "INSERT INTO base_rents (tenancy_id, `from`, monthly_cents) VALUES ('t1', '2025-02', -1)"),
      'negative Kaltmiete',
    )
    assert.ok(
      rejects(connection, "INSERT INTO person_history (tenancy_id, `from`, persons) VALUES ('t1', '2025-02-01', -1)"),
      'negative Personenzahl',
    )
    assert.ok(
      rejects(connection, "INSERT INTO prepayment_overrides (tenancy_id, year, amount_cents) VALUES ('t1', 2025, -1)"),
      'negative Jahreszahlung',
    )
  } finally {
    cleanup()
  }
})

// Die Gegenprobe, und sie ist die wichtigere Hälfte: Eine Prüfbedingung, die zu viel verbietet,
// nimmt dem Nutzer einen Fall weg, den das Fachliche kennt.
test('eine Gutschrift darf negativ sein, und ein gemeldeter §35a-Lohnanteil auch', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(
      "INSERT INTO cost_items (id, year, category, description, amount_cents, key) VALUES ('c1', 2025, 'Sonstige Betriebskosten', 'Gutschrift', -5000, 'units')",
    )
    // calc.ts meldet einen Lohnanteil außerhalb von 0 bis zum Rechnungsbetrag als Warnung und
    // rechnet weiter. Verböte die Datenbank ihn, bekäme der Nutzer die erklärende Warnung nie
    // zu sehen, weil er den Beleg gar nicht erst speichern könnte.
    connection.exec(
      "INSERT INTO cost_items (id, year, category, description, amount_cents, key, labor_35a_cents) VALUES ('c2', 2025, 'Gartenpflege', 'Garten', 60000, 'units', -3000)",
    )
    // Eine Rücklastschrift ist ein echter Vorgang.
    connection.exec(einWohnung)
    connection.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2025-01-01')")
    connection.exec("INSERT INTO payments (id, tenancy_id, date, amount_cents) VALUES ('p1', 't1', '2025-02-01', -85000)")
    assert.equal(Number(connection.rows('SELECT count(*) FROM cost_items')[0]?.[0]), 2)
  } finally {
    cleanup()
  }
})

test('Aufzählungen: ein unbekannter Umlageschlüssel kommt nicht hinein', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    assert.ok(
      rejects(
        connection,
        "INSERT INTO cost_items (id, year, category, description, amount_cents, key) VALUES ('c1', 2025, 'X', 'X', 100, 'ausgedacht')",
      ),
      'unbekannter Umlageschlüssel',
    )
    assert.ok(
      rejects(connection, "INSERT INTO meters (id, name, type, unit) VALUES ('m1', 'X', 'plasma', 'kWh')"),
      'unbekannter Zählertyp',
    )
  } finally {
    cleanup()
  }
})

test('je Stichtag nur ein Staffeleintrag', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2025-01-01')")
    connection.exec("INSERT INTO prepayments (tenancy_id, `from`, monthly_cents) VALUES ('t1', '2025-01', 20000)")
    assert.ok(
      rejects(connection, "INSERT INTO prepayments (tenancy_id, `from`, monthly_cents) VALUES ('t1', '2025-01', 25000)"),
      'zwei Vorauszahlungen ab demselben Monat',
    )
    connection.exec("INSERT INTO prepayment_overrides (tenancy_id, year, amount_cents) VALUES ('t1', 2025, 240000)")
    assert.ok(
      rejects(connection, "INSERT INTO prepayment_overrides (tenancy_id, year, amount_cents) VALUES ('t1', 2025, 250000)"),
      'zwei Jahreskorrekturen für dasselbe Jahr',
    )
  } finally {
    cleanup()
  }
})

test('je Jahr höchstens eine abgeschlossene Abrechnung', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec("INSERT INTO closed_settlements (id, year, closed_at, settlement) VALUES ('s1', 2025, '2026-03-01', '{}')")
    assert.ok(
      rejects(connection, "INSERT INTO closed_settlements (id, year, closed_at, settlement) VALUES ('s2', 2025, '2026-04-01', '{}')"),
      'zwei abgeschlossene Abrechnungen für 2025',
    )
  } finally {
    cleanup()
  }
})

test('die Einstellungen bleiben eine einzige Zeile', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    const einfuegen = (id: number) =>
      `INSERT INTO settings (id, house_name, address, landlord_name, iban, payment_deadline_days, ollama_url, ollama_model, ai_json_mode, ai_extra_instructions) VALUES (${id}, '', '', '', '', 30, 'http://localhost:11434', 'qwen3.5:4b', 'auto', '')`
    connection.exec(einfuegen(1))
    assert.ok(rejects(connection, einfuegen(2)), 'eine zweite Zeile mit anderer Kennung')
    assert.ok(rejects(connection, einfuegen(1)), 'eine zweite Zeile mit derselben Kennung')
  } finally {
    cleanup()
  }
})

// Das hier ist der Grund für den ganzen Umbau, deshalb steht es als Test und nicht nur im
// Kommentar: Das Löschen einer Wohnung soll nicht mehr halb geschehen können.
test('eine gescheiterte Transaktion hinterlässt nichts', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    await assert.rejects(
      connection.db.transaction(async (tx) => {
        await tx.insert(schema.tenancies).values({ id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 2, start: '2025-01-01' })
        // Dieselbe Kennung ein zweites Mal: Der Primärschlüssel weist es ab.
        await tx.insert(schema.tenancies).values({ id: 't1', unitId: 'u1', tenantName: 'Doppelt', persons: 1, start: '2025-02-01' })
      }),
    )
    assert.equal(
      Number(connection.rows('SELECT count(*) FROM tenancies')[0]?.[0]),
      0,
      'auch das erste Mietverhältnis muss zurückgerollt sein',
    )
  } finally {
    cleanup()
  }
})

test('Drizzle liest und schreibt über den Proxy', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    await connection.db.insert(schema.units).values({ id: 'u1', name: 'Links', areaM2: 72.5, participates: true })
    const rows = await connection.db.select().from(schema.units)
    assert.deepEqual(rows, [
      { id: 'u1', name: 'Links', areaM2: 72.5, participates: true, selfUsed: null, selfPersons: null, rooms: null, floor: null, notes: null },
    ])
    // Wahrheitswerte kommen als 0 und 1 in die Datenbank und als boolean zurück.
    const eine = await connection.db.select().from(schema.units).get()
    assert.equal(eine?.participates, true)
  } finally {
    cleanup()
  }
})
