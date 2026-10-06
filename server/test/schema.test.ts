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
import type { AiSettings, AiSlot, Co2Statement, DegreeDayValue, FrozenFuelCarry, FuelDelivery, FuelDeliveryPart, Co2TenantRelief, CostItem, HeatingPeriodData, HeatingPlant, HeatingPlantUnit, HeatingPrepaymentOverride, SeparateSpan, PeriodKey, PeriodRules, Meter, Payment, PersonEntry, PrepaymentEntry, Reading, RentEntry, Settings, Tenancy, Unit, ExternalBasis, UploadInfo, StoredAssessment, StoredAssessmentLine } from '../../shared/types.ts'
import type { ClosedSettlement } from '../src/store.ts'
import { applyMigrations, connect, loadMigrations } from '../src/db/client.ts'
import * as schema from '../src/db/schema.ts'

// ---------- Ebene 1: Schema und Datenmodell ----------

// Beidseitige Gleichheit. `[A] extends [B]` statt `A extends B`, damit ein Vereinigungstyp
// nicht aufgeteilt und stückweise geprüft wird.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// Der Anker: Nur `true` ist zulässig. Steht dort `false`, nennt der Übersetzer die Zeile.
type Assert<T extends true> = T

// Passt der Wert einer Spalte in das Feld des Domänentyps? NULL in der Datenbank und ein
// fehlendes Feld im Modell meinen dasselbe („nicht gesetzt"), deshalb wird beides für den
// Vergleich der *Werte* abgezogen. Passt etwas nicht, steht statt `true` ein Objekt da, das den
// Namen der Spalte und beide Typen nennt. So sagt die Fehlermeldung, worum es geht.
type ValuesFit<Row, Domain> = {
  [K in keyof Row & keyof Domain]: Exclude<Row[K], null> extends Exclude<Domain[K], null | undefined>
    ? true
    : { spalte: K; inDerDatenbank: Row[K]; imModell: Domain[K] }
}[keyof Row & keyof Domain]

// Die Nullbarkeit selbst prüft der Wertevergleich oben gerade **nicht**, weil er sie abzieht.
// Sie ist aber die Hälfte der Zusicherung: Eine Spalte, die NULL zulässt, obwohl das Modell das
// Feld für verpflichtend hält, liefert der Anwendung irgendwann ein `null`, mit dem sie nicht
// rechnet. Umgekehrt zwingt ein `NOT NULL` auf einem Feld, das im Modell fehlen darf, den
// Aufrufer zu einem Wert, den es gar nicht gibt.
//
// Verglichen wird deshalb ausdrücklich, ob beide Seiten dasselbe über „darf fehlen" sagen: in
// der Datenbank `null`, im Modell ein optionales Feld (`undefined`) oder ein ausdrückliches
// `null`, wie es `CostItem.directUnitId` führt.
type NullableColumns<Row> = { [K in keyof Row]-?: null extends Row[K] ? K : never }[keyof Row]
type OptionalFields<Domain> = {
  [K in keyof Domain]-?: undefined extends Domain[K] ? K : null extends Domain[K] ? K : never
}[keyof Domain]

type NullabilityFits<Row, Domain> = Equals<NullableColumns<Row>, OptionalFields<Domain>> extends true
  ? true
  : {
      nurInDerDatenbankNullbar: Exclude<NullableColumns<Row>, OptionalFields<Domain>>
      nurImModellOptional: Exclude<OptionalFields<Domain>, NullableColumns<Row>>
    }

// Die drei Prüfungen je Tabelle: gleiche Namen, passende Werte, gleiche Nullbarkeit.
type Matches<Row, Domain> = Equals<keyof Row, keyof Domain> extends true
  ? Equals<ValuesFit<Row, Domain>, true> extends true
    ? NullabilityFits<Row, Domain>
    : Equals<ValuesFit<Row, Domain>, true>
  : { spaltenFehlen: Exclude<keyof Domain, keyof Row>; spaltenZuViel: Exclude<keyof Row, keyof Domain> }

// --- Wohnungen ---
// Die Zählertypen ohne Anschluss (#117) stehen in einer eigenen Tabelle.
type _Units = Assert<Matches<typeof schema.units.$inferSelect, Omit<Unit, 'noConnection'>>>

// --- Mietverhältnisse ---
// Die fünf verschachtelten Listen stehen in eigenen Tabellen und haben deshalb keine Spalte.
// Dass sie hier aufgezählt sind, ist Absicht: Wer eine davon wieder in die Zeile holt oder eine
// weitere hinzufügt, muss diese Zeile anfassen und stolpert über die Entscheidung. Die fünfte ist
// die Pauschale (#93).
// Heizstaffel und Heizkorrektur (Heizung PR 5) stehen ebenfalls in eigenen Tabellen.
type TenancyColumns = Omit<Tenancy, 'personHistory' | 'prepayments' | 'baseRents' | 'prepaymentOverrides' | 'flatRates' | 'heatingPrepayments' | 'heatingPrepaymentOverrides'>
type _Tenancies = Assert<Matches<typeof schema.tenancies.$inferSelect, TenancyColumns>>

type _PersonHistory = Assert<Matches<Omit<typeof schema.personHistory.$inferSelect, 'tenancyId'>, PersonEntry>>
type _Prepayments = Assert<Matches<Omit<typeof schema.prepayments.$inferSelect, 'tenancyId'>, PrepaymentEntry>>
type _BaseRents = Assert<Matches<Omit<typeof schema.baseRents.$inferSelect, 'tenancyId'>, RentEntry>>

// `prepaymentOverrides` ist im Modell `Record<string, number>`, Zeitraum auf Betrag (#208). In der
// Tabelle sind daraus zwei Spalten geworden; geprüft wird, dass der Schlüssel ein Zeitraumschlüssel
// ist und der Wert den Typ behält, den der Record vorgibt.
type OverrideRow = typeof schema.prepaymentOverrides.$inferSelect
type _Overrides = Assert<Equals<OverrideRow['period'], PeriodKey>>
type _OverrideAmount = Assert<Equals<OverrideRow['amountCents'], Tenancy['prepaymentOverrides'][string]>>

// --- Kostenpositionen ---
// Die drei Angaben aus #94 liegen woanders: Teilnehmer und Einzelbeträge in eigenen Tabellen,
// die Angaben der Gemeinschaft als drei Spalten statt eines Objekts. An ihrer Stelle stehen
// deshalb die drei Spalten im Vergleich. Die Eigenbeträge (#104) stehen ebenfalls in einer
// eigenen Tabelle.
type CostItemColumns = Omit<CostItem, 'customShares' | 'participantUnitIds' | 'tenancyAmounts' | 'selfAmounts' | 'externalBasis'> & {
  externalMeasure?: ExternalBasis['measure']
  externalTotal?: ExternalBasis['total']
  externalTotalCents?: ExternalBasis['totalCents']
  // Ob `participantUnitIds` gesetzt ist; die Liste selbst steht in cost_item_participants.
  participantsLimited?: boolean
}
type _CostItems = Assert<Matches<typeof schema.costItems.$inferSelect, CostItemColumns>>

type ParticipantRow = typeof schema.costItemParticipants.$inferSelect
type _ParticipantUnit = Assert<Equals<ParticipantRow['unitId'], Unit['id']>>
type AmountRow = typeof schema.costItemAmounts.$inferSelect
type SelfAmountRow = typeof schema.costItemSelfAmounts.$inferSelect
type _SelfAmountUnit = Assert<Equals<SelfAmountRow['unitId'], Unit['id']>>
type _AmountCents = Assert<Equals<AmountRow['amountCents'], number>>

// `customShares` ist `Record<Wohnungs-Kennung, Prozent>`. Auch hier prüft der Namensvergleich
// nichts, wohl aber die Typen der beiden Spalten, die daraus geworden sind.
type ShareRow = typeof schema.costItemShares.$inferSelect
type _ShareUnit = Assert<Equals<ShareRow['unitId'], Unit['id']>>
type _SharePercent = Assert<Equals<ShareRow['percent'], number>>

// --- Zähler, Ablesungen, Zahlungen ---
type _Meters = Assert<Matches<typeof schema.meters.$inferSelect, Meter>>
type _Readings = Assert<Matches<typeof schema.readings.$inferSelect, Reading>>
type _Payments = Assert<Matches<typeof schema.payments.$inferSelect, Payment>>
// --- Heizanlage (Heizung PR 4) ---
// Die angeschlossenen Wohnungen stehen in heating_plant_units. Ob es eine Liste gibt, sagt
// `units_limited`, wie `participants_limited` bei den Kostenpositionen (#94): Ohne die Spalte
// sähe eine Anlage, deren letzte Wohnung gelöscht wurde, aus wie eine ohne Liste.
// Die Wechsel der eigenen Heizperiode und die Spannen nach Weg d stehen in eigenen Tabellen
// (Heizung PR 5), wie die Wohnungen in heating_plant_units.
type HeatingPlantColumns = Omit<HeatingPlant, 'units' | 'periodChanges' | 'separateSpans'> & { unitsLimited: boolean }
type _HeatingPlants = Assert<Matches<typeof schema.heatingPlants.$inferSelect, HeatingPlantColumns>>
type _HeatingPlantUnits = Assert<Matches<Omit<typeof schema.heatingPlantUnits.$inferSelect, 'plantId'>, HeatingPlantUnit>>
type _HeatingPeriods = Assert<Matches<typeof schema.heatingPeriods.$inferSelect, HeatingPeriodData>>

// --- Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5) ---
type _HeatingPrepayments = Assert<Matches<Omit<typeof schema.heatingPrepayments.$inferSelect, 'tenancyId'>, PrepaymentEntry>>
type _HeatingPrepaymentOverrides = Assert<Matches<Omit<typeof schema.heatingPrepaymentOverrides.$inferSelect, 'tenancyId'>, HeatingPrepaymentOverride>>
type _HeatingSeparateSpans = Assert<Matches<Omit<typeof schema.heatingSeparateSpans.$inferSelect, 'plantId'>, SeparateSpan>>

// --- CO₂ (Heizung PR 6) ---
// Anlage und Heizperiode liest die Datenbank über `heating_period_id`; die Beträge je
// Mietverhältnis stehen in einer eigenen Tabelle.
type Co2StatementColumns = Omit<Co2Statement, 'plantId' | 'period' | 'reliefs'>
type _Co2Statements = Assert<Matches<typeof schema.co2Statements.$inferSelect, Co2StatementColumns>>
type _Co2Reliefs = Assert<Matches<Omit<typeof schema.co2TenantReliefs.$inferSelect, 'statementId'>, Co2TenantRelief>>
// --- Lieferungen (Heizung PR 7) ---
// Die Teilmengen stehen in einer eigenen Tabelle; eingefroren wird je Zeile in `heating_periods`.
type _FuelDeliveries = Assert<Matches<typeof schema.fuelDeliveries.$inferSelect, Omit<FuelDelivery, 'parts'>>>
type _FuelParts = Assert<Matches<Omit<typeof schema.fuelDeliveryParts.$inferSelect, 'deliveryId'>, FuelDeliveryPart>>
type _FuelFrozen = Assert<Matches<typeof schema.fuelCarryFrozen.$inferSelect, Omit<FrozenFuelCarry, 'plantId' | 'period'> & { heatingPeriodId: string }>>
type _DegreeDays = Assert<Matches<Omit<typeof schema.degreeDayValues.$inferSelect, 'propertyId'>, DegreeDayValue>>

// --- Abgeschlossene Abrechnungen ---
// `ClosedSettlement` steht in store.ts und nicht in shared/types.ts, weil nur der Server sie
// kennt. Geprüft wird sie trotzdem, denn sie beschreibt eine Tabelle.
//
// Der eingefrorene Berechnungsstand ist die eine Spalte, die bewusst JSON bleibt, und Drizzle
// gibt sie als `unknown` heraus. Das ist richtig so: Geschrieben hat sie eine Version, die es
// vielleicht nicht mehr gibt, und eine engere Zusage an dieser Stelle wäre eine Behauptung, die
// niemand einlöst. Geprüft wird deshalb der Rahmen ringsum vollständig, und für die Spalte
// selbst, dass sie überhaupt da ist und wirklich `unknown` liefert. Wer ihr später einen
// engeren Typ anschreibt, muss diese Zeile anfassen und sich die Frage dabei stellen.
//
// `ClosedSettlement` beschreibt die db.json mit Jahr; die Tabelle trägt seit #92 ein Objekt und
// seit #208 den Zeitraum statt des Jahres. Geprüft wird deshalb gegen diese Gestalt.
type ClosedRow = typeof schema.closedSettlements.$inferSelect
type ClosedWithProperty = Omit<ClosedSettlement, 'year'> & { propertyId: string, period: PeriodKey }
type _ClosedNames = Assert<Equals<keyof ClosedRow, keyof ClosedWithProperty>>
type _ClosedRahmen = Assert<Matches<Omit<ClosedRow, 'settlement'>, Omit<ClosedWithProperty, 'settlement'>>>
type _ClosedJson = Assert<Equals<ClosedRow['settlement'], unknown>>

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

// --- Angaben zu Belegen (#170) ---
// `mtime` ist die Zeit der Datei und steht nicht in der Datenbank; sie liest die Route von der
// Platte.
type _Uploads = Assert<Matches<typeof schema.uploads.$inferSelect, Omit<UploadInfo, 'mtime'>>>

// --- Belegbuchung (#170) ---
type _Assessments = Assert<Matches<typeof schema.assessments.$inferSelect, StoredAssessment>>
type _AssessmentLines = Assert<Matches<typeof schema.assessmentLines.$inferSelect, StoredAssessmentLine>>

// --- Wechsel des Rhythmus (#208) ---
type PeriodChangeRow = typeof schema.periodChanges.$inferSelect
type _PeriodChangeMonth = Assert<Equals<PeriodChangeRow['fromMonth'], PeriodRules['changes'][number]>>

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

const einWohnung = "INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u1', 'objekt-1', 'Links', 72, 1)"

test('Migration lässt sich anwenden und legt alle Tabellen an', async () => {
  const { connection, applied, cleanup } = await freshDb()
  try {
    assert.equal(applied, (await loadMigrations()).length, 'alle Migrationsschritte')
    const tables = connection
      .rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map((row) => String(row[0]))
    assert.deepEqual(tables, [
      '__drizzle_migrations',
      'ai_slots',
      'assessment_lines',
      'assessments',
      'base_rents',
      'closed_heating_settlement_history',
      'closed_heating_settlements',
      'closed_settlement_history',
      'closed_settlements',
      'co2_statements',
      'co2_tenant_reliefs',
      'cost_item_amounts',
      'cost_item_participants',
      'cost_item_self_amounts',
      'cost_item_shares',
      'cost_items',
      'degree_day_values',
      'flat_rates',
      'fuel_carry_frozen',
      'fuel_deliveries',
      'fuel_delivery_parts',
      'heating_period_changes',
      'heating_periods',
      'heating_plant_units',
      'heating_plants',
      'heating_prepayment_overrides',
      'heating_prepayments',
      'heating_separate_spans',
      'meters',
      'payments',
      'period_changes',
      'person_history',
      'prepayment_overrides',
      'prepayments',
      'properties',
      'readings',
      'settings',
      'sqlite_sequence',
      'tenancies',
      'unit_no_connection',
      'units',
      'uploads',
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
// weg, und SQLite liest das als Erlaubnis für NULL-Kennungen, sogar für mehrere. Eine
// Wohnung ohne Kennung ist aber keine Wohnung. Deshalb wird es hier nachgemessen statt
// vorausgesetzt, damit ein späterer Fassungswechsel hier scheitert und nicht bei einem Nutzer.
test('Primärschlüssel aus Text weisen eine leere Kennung ab', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    const fehler = rejects(connection, "INSERT INTO units (id, property_id, name, area_m2, participates) VALUES (NULL, 'objekt-1', 'Ohne', 50, 1)")
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
    connection.exec("INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('m1', 'objekt-1', 'Kaltwasser', 'u1', 'kaltwasser', 'm³')")
    connection.exec("INSERT INTO readings (id, meter_id, date, value) VALUES ('r1', 'm1', '2025-01-01', 100)")
    connection.exec("INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('c1', 'objekt-1', '2025-01', 'Gartenpflege', 'Garten', 60000, 'custom')")
    connection.exec("INSERT INTO cost_item_shares (cost_item_id, unit_id, percent) VALUES ('c1', 'u1', 50)")

    connection.exec("DELETE FROM units WHERE id = 'u1'")

    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    // Die Zahlung hängt über das Mietverhältnis an der Wohnung. Heute räumt index.ts sie über
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
      "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, direct_unit_id) VALUES ('c1', 'objekt-1', '2025-01', 'Sonstige Betriebskosten', 'Reparatur', 40000, 'direct', 'u1')",
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
      rejects(connection, "INSERT INTO units (id, property_id, name, area_m2, participates) VALUES ('u2', 'objekt-1', 'Minus', -10, 1)"),
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
      rejects(connection, "INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-01', -1)"),
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
      "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('c1', 'objekt-1', '2025-01', 'Sonstige Betriebskosten', 'Gutschrift', -5000, 'units')",
    )
    // calc.ts meldet einen Lohnanteil außerhalb von 0 bis zum Rechnungsbetrag als Warnung und
    // rechnet weiter. Verböte die Datenbank ihn, bekäme der Nutzer die erklärende Warnung nie
    // zu sehen, weil er den Beleg gar nicht erst speichern könnte.
    connection.exec(
      "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, labor_35a_cents) VALUES ('c2', 'objekt-1', '2025-01', 'Gartenpflege', 'Garten', 60000, 'units', -3000)",
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
        "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key) VALUES ('c1', 'objekt-1', '2025-01', 'X', 'X', 100, 'ausgedacht')",
      ),
      'unbekannter Umlageschlüssel',
    )
    assert.ok(
      rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit) VALUES ('m1', 'objekt-1', 'X', 'plasma', 'kWh')"),
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
    connection.exec("INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-01', 240000)")
    assert.ok(
      rejects(connection, "INSERT INTO prepayment_overrides (tenancy_id, period, amount_cents) VALUES ('t1', '2025-01', 250000)"),
      'zwei Jahreskorrekturen für dasselbe Jahr',
    )
  } finally {
    cleanup()
  }
})

test('je Jahr höchstens eine abgeschlossene Abrechnung', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec("INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s1', 'objekt-1', '2025-01', '2026-03-01', '{}')")
    assert.ok(
      rejects(connection, "INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s2', 'objekt-1', '2025-01', '2026-04-01', '{}')"),
      'zwei abgeschlossene Abrechnungen für 2025',
    )
  } finally {
    cleanup()
  }
})

// Die Datenbank prüft am Archivstück nur, dass es überhaupt JSON ist. Ob die Abrechnung darin
// fachlich stimmt, weiß sie nicht und soll sie nicht wissen. Eine abgeschnittene Zeichenkette
// fällt damit aber sofort auf statt erst Jahre später beim Öffnen der alten Abrechnung.
test('der eingefrorene Berechnungsstand muss gültiges JSON sein', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(
      `INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s1', 'objekt-1', '2025-01', '2026-03-01', '{"year":2025,"statements":[]}')`,
    )
    assert.ok(
      rejects(
        connection,
        `INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s2', 'objekt-1', '2024-01', '2026-03-01', '{"year":2024,"statem')`,
      ),
      'eine abgeschnittene Abrechnung',
    )
    assert.ok(
      rejects(connection, "INSERT INTO closed_settlements (id, property_id, period, closed_at, settlement) VALUES ('s3', 'objekt-1', '2023-01', '2026-03-01', 'kein JSON')"),
      'gar kein JSON',
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

// Der gefährlichste Fall, den dieses Schema haben kann, und er schlägt erst zu, wenn wir das
// Schema zum ersten Mal ändern.
//
// SQLite kann eine Spalte oder eine Prüfbedingung nicht an Ort und Stelle ändern. drizzle-kit
// baut die Tabelle dafür neu: neue Tabelle anlegen, Daten hinüberkopieren, alte löschen, neue
// umbenennen. Damit das Löschen nicht die Kinder mitreißt, schreibt es
// `PRAGMA foreign_keys=OFF` an den Anfang. Dieses Pragma ist laut SQLite-Dokumentation aber
// „a no-op within a transaction". Wer die Migration in BEGIN/COMMIT einschließt, schaltet die
// Prüfung also gar nicht ab. Das `DROP TABLE` kaskadiert dann, und das COMMIT meldet Erfolg.
// Der Nutzer verliert Mietverhältnisse, Zähler und Zahlungen, ohne dass irgendwo etwas steht.
//
// Nachgestellt wird hier genau das, was drizzle-kit für eine geänderte Prüfbedingung schreibt.
const tabelleNeuBauen = [
  'PRAGMA foreign_keys=OFF;',
  'CREATE TABLE `__new_units` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`area_m2` real NOT NULL,\n\t`participates` integer NOT NULL,\n\t`self_used` integer,\n\t`self_persons` integer,\n\t`rooms` integer,\n\t`floor` text,\n\t`notes` text\n);',
  'INSERT INTO `__new_units`("id", "name", "area_m2", "participates", "self_used", "self_persons", "rooms", "floor", "notes") SELECT "id", "name", "area_m2", "participates", "self_used", "self_persons", "rooms", "floor", "notes" FROM `units`;',
  'DROP TABLE `units`;',
  'ALTER TABLE `__new_units` RENAME TO `units`;',
  'PRAGMA foreign_keys=ON;',
]

test('eine spätere Migration, die eine Tabelle neu baut, verliert keine abhängigen Daten', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2025-01-01')")
    connection.exec("INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('m1', 'objekt-1', 'Kaltwasser', 'u1', 'kaltwasser', 'm³')")

    applyMigrations(connection, [
      { tag: '0001_probe', hash: 'probe-tabelle-neu-bauen', folderMillis: Date.now(), statements: tabelleNeuBauen },
    ])

    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    assert.equal(zahl('units'), 1, 'die Wohnung muss den Neubau überstehen')
    assert.equal(zahl('tenancies'), 1, 'das Mietverhältnis darf nicht mitgelöscht werden')
    assert.equal(zahl('meters'), 1, 'der Zähler darf nicht mitgelöscht werden')
  } finally {
    cleanup()
  }
})

test('nach dem Migrationslauf ist die Fremdschlüsselprüfung wieder an', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    applyMigrations(connection, [
      { tag: '0001_probe', hash: 'probe-pragma-wieder-an', folderMillis: Date.now(), statements: tabelleNeuBauen },
    ])
    assert.equal(Number(connection.rows('PRAGMA foreign_keys')[0]?.[0]), 1, 'PRAGMA foreign_keys muss wieder 1 sein')
    // Und sie greift auch wirklich wieder.
    assert.ok(
      rejects(
        connection,
        "INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t9', 'gibtesnicht', 'X', 1, '2025-01-01')",
      ),
    )
  } finally {
    cleanup()
  }
})

// Die Gegenprobe zur Behebung: Hinterlässt eine Migration wirklich einen kaputten Verweis, darf
// sie nicht stillschweigend durchgehen. `PRAGMA foreign_key_check` läuft deshalb noch innerhalb
// der Transaktion, sodass der Schritt zurückgerollt wird und die Datenbank auf dem Stand davor
// bleibt.
test('eine Migration, die einen Verweis ins Leere hinterlässt, wird zurückgerollt', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2025-01-01')")
    const kaputt = [
      'PRAGMA foreign_keys=OFF;',
      // Die Wohnung verschwindet, das Mietverhältnis bleibt zurück und zeigt ins Leere.
      "DELETE FROM `units` WHERE id = 'u1';",
      'PRAGMA foreign_keys=ON;',
    ]
    assert.throws(
      () =>
        applyMigrations(connection, [
          { tag: '9999_kaputt', hash: 'probe-kaputter-verweis', folderMillis: Date.now(), statements: kaputt },
        ]),
      /Fremdschlüssel/,
    )
    // Zurückgerollt: Die Wohnung ist noch da, und der Schritt gilt nicht als erledigt.
    assert.equal(Number(connection.rows('SELECT count(*) FROM units')[0]?.[0]), 1)
    const alle = (await loadMigrations()).length
    assert.equal(Number(connection.rows('SELECT count(*) FROM __drizzle_migrations')[0]?.[0]), alle, 'nur die echten Schritte, nicht der kaputte')
  } finally {
    cleanup()
  }
})

test('Drizzle liest und schreibt über den Proxy', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    await connection.db.insert(schema.units).values({ id: 'u1', propertyId: 'objekt-1', name: 'Links', areaM2: 72.5, participates: true })
    const rows = await connection.db.select().from(schema.units)
    assert.deepEqual(rows, [
      { id: 'u1', propertyId: 'objekt-1', name: 'Links', areaM2: 72.5, participates: true, selfUsed: null, selfPersons: null, mea: null, rooms: null, floor: null, notes: null },
    ])
    // Wahrheitswerte kommen als 0 und 1 in die Datenbank und als boolean zurück.
    const eine = await connection.db.select().from(schema.units).get()
    assert.equal(eine?.participates, true)
  } finally {
    cleanup()
  }
})

// ---------- Heizanlage (Heizung PR 4) ----------

const eineAnlage = "INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp1', 'objekt-1', 'gas')"

test('Heizanlage: Vorgaben, und die Gemeinschaft rechnet nur wie ein Messdienst ab', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(eineAnlage)
    assert.deepEqual(
      connection.rows('SELECT name, supply, method, devices_remote, devices_installed_after_2021_12, source, change_split, units_limited FROM heating_plants')[0],
      ['', 'central', 'manual', 'unknown', 'unknown', 'building', 'degreeDays', 0],
    )
    assert.ok(
      rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, source, method) VALUES ('hp2', 'objekt-1', 'gas', 'homeowners', 'manual')"),
      'Gemeinschaft mit freien Schlüsseln',
    )
    assert.equal(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, source, method) VALUES ('hp3', 'objekt-1', 'gas', 'homeowners', 'service')"), null)
    assert.ok(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy) VALUES ('hp4', 'objekt-1', 'kernkraft')"), 'unbekannter Energieträger')
    assert.ok(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, period_start_month) VALUES ('hp5', 'objekt-1', 'gas', 13)"), 'Monat 13')
    assert.ok(rejects(connection, "INSERT INTO heating_plants (id, property_id, energy, warm_rent_average_2022_2024) VALUES ('hp6', 'objekt-1', 'gas', -1)"), 'negativer Betrag')
  } finally {
    cleanup()
  }
})

test('Heizanlage: Zähler der Anlage haben eine Rolle und keine Wohnung; Warmwasser und HKV sind Zählertypen', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec(eineAnlage)
    assert.equal(rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit, heating_plant_id, heating_role) VALUES ('m1', 'objekt-1', 'Speicher', 'waerme', 'kWh', 'hp1', 'dhwHeat')"), null)
    assert.ok(rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit, heating_plant_id) VALUES ('m2', 'objekt-1', 'Ohne Rolle', 'waerme', 'kWh', 'hp1')"), 'Anlage ohne Rolle')
    assert.ok(rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit, heating_role) VALUES ('m3', 'objekt-1', 'Rolle ohne Anlage', 'waerme', 'kWh', 'supply')"), 'Rolle ohne Anlage')
    assert.ok(
      rejects(connection, "INSERT INTO meters (id, property_id, name, unit_id, type, unit, heating_plant_id, heating_role) VALUES ('m4', 'objekt-1', 'An Wohnung', 'u1', 'waerme', 'kWh', 'hp1', 'totalHeat')"),
      'Anlagenzähler an einer Wohnung',
    )
    assert.ok(rejects(connection, "INSERT INTO meters (id, property_id, name, type, unit, heating_plant_id, heating_role) VALUES ('m5', 'objekt-1', 'X', 'waerme', 'kWh', 'hp1', 'kessel')"), 'unbekannte Rolle')
    assert.equal(
      rejects(connection, "INSERT INTO meters (id, property_id, name, unit_id, type, unit, remote_readable, installed_on) VALUES ('m6', 'objekt-1', 'HKV Bad', 'u1', 'hkv', 'Einheiten', 0, '2021-12-15')"),
      null,
    )
    assert.equal(rejects(connection, "INSERT INTO meters (id, property_id, name, unit_id, type, unit) VALUES ('m7', 'objekt-1', 'Warmwasser Küche', 'u1', 'warmwasser', 'm³')"), null)
    assert.equal(rejects(connection, "INSERT INTO unit_no_connection (unit_id, meter_type) VALUES ('u1', 'warmwasser')"), null)
    assert.equal(rejects(connection, "UPDATE properties SET kind = 'zfh' WHERE id = 'objekt-1'"), null)
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'eine Anlage mit Zähler bleibt stehen')
  } finally {
    cleanup()
  }
})

test('Heizanlage: Wohnungen und Heizperioden fallen mit, eine Kostenposition hält die Anlage', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec(eineAnlage)
    connection.exec("INSERT INTO heating_plant_units (plant_id, unit_id) VALUES ('hp1', 'u1')")
    assert.ok(rejects(connection, "INSERT INTO heating_plant_units (plant_id, unit_id) VALUES ('hp1', 'u1')"), 'dieselbe Wohnung zweimal')
    assert.ok(rejects(connection, "UPDATE heating_plant_units SET heated_area_m2 = 0"), 'beheizte Fläche 0')
    connection.exec("INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')")
    assert.ok(rejects(connection, "INSERT INTO heating_periods (id, plant_id, period) VALUES ('h2', 'hp1', '2025-01')"), 'Heizperiode doppelt')
    assert.ok(rejects(connection, "INSERT INTO heating_periods (id, plant_id, period) VALUES ('h3', 'hp1', '2025-13')"), 'Monat 13')
    assert.ok(rejects(connection, "INSERT INTO heating_periods (id, plant_id, period, heat_consumption_pct) VALUES ('h4', 'hp1', '2026-01', 101)"), 'über 100 %')
    assert.ok(rejects(connection, "INSERT INTO heating_periods (id, plant_id, period, dhw_method) VALUES ('h5', 'hp1', '2027-01', 'schaetzung')"), 'unbekanntes Verfahren')
    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    connection.exec("DELETE FROM units WHERE id = 'u1'")
    assert.equal(zahl('heating_plant_units'), 0, 'die Zeile der Wohnung fällt mit')
    connection.exec(
      "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, heating_plant_id) VALUES ('c1', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'Gas', 100000, 'area', 'hp1')",
    )
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'die Kostenposition hält die Anlage')
    connection.exec("DELETE FROM cost_items WHERE id = 'c1'")
    connection.exec("DELETE FROM heating_plants WHERE id = 'hp1'")
    assert.equal(zahl('heating_periods'), 0, 'die Heizperioden fallen mit der Anlage')
  } finally {
    cleanup()
  }
})

// ---------- Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5) ----------

const einMieter = "INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'A', 1, '2024-01-01')"

test('Heizperiode: Wechsel und Spannen nach Weg d gehören zur Anlage und fallen mit ihr', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(eineAnlage)
    assert.equal(rejects(connection, "INSERT INTO heating_period_changes (plant_id, from_month) VALUES ('hp1', '2026-01')"), null)
    assert.ok(rejects(connection, "INSERT INTO heating_period_changes (plant_id, from_month) VALUES ('hp1', '2026-13')"), 'Monat 13')
    assert.equal(rejects(connection, "INSERT INTO heating_separate_spans (plant_id, from_month, until_period) VALUES ('hp1', '2026-01', NULL)"), null)
    assert.ok(rejects(connection, "INSERT INTO heating_separate_spans (plant_id, from_month, until_period) VALUES ('hp1', '2027-05', '2026-05')"), 'Ende vor Beginn')
    assert.ok(rejects(connection, "INSERT INTO heating_separate_spans (plant_id, from_month, until_period) VALUES ('hp1', '2025-5', NULL)"), 'kein Monat')
    connection.exec("DELETE FROM heating_plants WHERE id = 'hp1'")
    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    assert.equal(zahl('heating_period_changes'), 0)
    assert.equal(zahl('heating_separate_spans'), 0)
  } finally {
    cleanup()
  }
})

test('Heizstaffel und Heizkorrektur: nie negativ, vorläufig nur mit Monaten, endgültig ohne', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec(einMieter)
    connection.exec(eineAnlage)
    assert.equal(rejects(connection, "INSERT INTO heating_prepayments (tenancy_id, \"from\", monthly_cents) VALUES ('t1', '2025-05', 12300)"), null)
    assert.ok(rejects(connection, "INSERT INTO heating_prepayments (tenancy_id, \"from\", monthly_cents) VALUES ('t1', '2026-01', -1)"), 'negativ')
    // Durchsicht von #231 (Minor 9): ein Monat in der Form JJJJ-MM.
    assert.ok(rejects(connection, "INSERT INTO heating_prepayments (tenancy_id, \"from\", monthly_cents) VALUES ('t1', '2026-13', 100)"), 'Monat 13')
    assert.ok(rejects(connection, "INSERT INTO heating_prepayments (tenancy_id, \"from\", monthly_cents) VALUES ('t1', 'ab Mai', 100)"), 'kein Monat')
    const korrektur = (werte: string) => `INSERT INTO heating_prepayment_overrides (tenancy_id, plant_id, period, amount_cents, provisional, from_month, to_month) VALUES ${werte}`
    assert.equal(rejects(connection, korrektur("('t1', 'hp1', '2025-05', 30000, 0, NULL, NULL)")), null)
    assert.equal(rejects(connection, korrektur("('t1', 'hp1', '2026-05', 87600, 1, '2026-05', '2026-12')")), null)
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2027-05', 100, 1, NULL, NULL)")), 'vorläufig ohne Monate')
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2028-05', 100, 0, '2028-05', '2028-12')")), 'endgültig mit Monaten')
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2029-05', 100, 1, '2029-12', '2029-05')")), 'Ende vor Beginn')
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2030-05', -1, 0, NULL, NULL)")), 'negativ')
    assert.ok(rejects(connection, korrektur("('t1', 'hp1', '2025-05', 1, 0, NULL, NULL)")), 'je Heizperiode eine')
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'eine Heizkorrektur hält die Anlage')
    connection.exec("DELETE FROM tenancies WHERE id = 't1'")
    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    assert.equal(zahl('heating_prepayments'), 0, 'die Staffel fällt mit dem Mietverhältnis')
    assert.equal(zahl('heating_prepayment_overrides'), 0, 'die Korrektur fällt mit dem Mietverhältnis')
  } finally {
    cleanup()
  }
})

test('Abgeschlossene Heizkostenabrechnung: eindeutig je Anlage und Heizperiode, JSON, hält die Anlage', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(eineAnlage)
    const abschluss = (id: string, period: string, inhalt = "'{}'") =>
      `INSERT INTO closed_heating_settlements (id, plant_id, period, closed_at, settlement) VALUES ('${id}', 'hp1', '${period}', '2027-01-10', ${inhalt})`
    assert.equal(rejects(connection, abschluss('a1', '2025-05')), null)
    assert.ok(rejects(connection, abschluss('a2', '2025-05')), 'zweimal dieselbe Heizperiode')
    assert.ok(rejects(connection, abschluss('a3', '2026-05', "'kein json'")), 'kein JSON')
    assert.ok(rejects(connection, abschluss('a4', '2026-13')), 'Monat 13')
    assert.equal(rejects(connection, "INSERT INTO closed_heating_settlement_history (id, plant_id, period, closed_at, reopened_at, settlement) VALUES ('v1', 'hp1', '2025-05', '2027-01-10', '2027-02-01', '{}')"), null)
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'ein Abschluss hält die Anlage')
  } finally {
    cleanup()
  }
})

// ---------- CO₂ (Heizung PR 6) ----------

const eineHeizperiode = [
  "INSERT INTO heating_plants (id, property_id, energy, method) VALUES ('hp1', 'objekt-1', 'gas', 'service')",
  "INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')",
]

test('CO₂: eine Zeile je Heizperiode, Summen beim Messdienst Pflicht, Grenzen der Werte', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    for (const sql of eineHeizperiode) connection.exec(sql)
    assert.ok(rejects(connection, "INSERT INTO co2_statements (heating_period_id, method) VALUES ('h1', 'serviceDeducted')"), 'Vorwegabzug ohne S, L und NE')
    assert.equal(rejects(connection, "INSERT INTO co2_statements (heating_period_id, method, service_users_total_cents, service_landlord_cents, service_units_count) VALUES ('h1', 'serviceDeducted', 384551, 8750, 4)"), null)
    assert.ok(rejects(connection, "INSERT INTO co2_statements (heating_period_id, method) VALUES ('h1', 'selfAfterService')"), 'eine zweite Zeile für dieselbe Heizperiode')
    assert.deepEqual(connection.rows("SELECT service_users_total_approx FROM co2_statements")[0], [0])
    assert.ok(rejects(connection, "UPDATE co2_statements SET method = 'geschaetzt'"), 'unbekannte Methode')
    assert.ok(rejects(connection, 'UPDATE co2_statements SET service_landlord_permille = 1001'), 'über 1000 ‰')
    assert.ok(rejects(connection, 'UPDATE co2_statements SET service_units_count = 0'), 'keine Nutzeinheit')
    assert.ok(rejects(connection, 'UPDATE co2_statements SET service_landlord_cents = -1'), 'negativer CO₂-Anteil')
    assert.ok(rejects(connection, 'UPDATE co2_statements SET area_m2 = 0'), 'Fläche 0')
    assert.equal(rejects(connection, "UPDATE co2_statements SET method = 'selfAfterService', service_users_total_cents = NULL, service_landlord_cents = NULL, service_units_count = NULL"), null)
  } finally {
    cleanup()
  }
})

test('CO₂: Beträge je Mietverhältnis fallen mit Mietverhältnis und Datensatz, die Position wird nur gelöst', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec(einWohnung)
    connection.exec("INSERT INTO tenancies (id, unit_id, tenant_name, persons, start) VALUES ('t1', 'u1', 'Meier', 2, '2025-01-01')")
    for (const sql of eineHeizperiode) connection.exec(sql)
    connection.exec(
      "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, heating_plant_id) VALUES ('c1', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'Messdienst', 100000, 'amounts', 'hp1')",
    )
    connection.exec("INSERT INTO co2_statements (heating_period_id, method, service_users_total_cents, service_landlord_cents, service_units_count, service_cost_item_id) VALUES ('h1', 'serviceShown', 100000, 5000, 1, 'c1')")
    connection.exec("INSERT INTO co2_tenant_reliefs (statement_id, tenancy_id, cents) VALUES ('h1', 't1', 2500)")
    assert.ok(rejects(connection, "INSERT INTO co2_tenant_reliefs (statement_id, tenancy_id, cents) VALUES ('h1', 't1', 100)"), 'derselbe Mieter zweimal')
    assert.ok(rejects(connection, "UPDATE co2_tenant_reliefs SET cents = -1"), 'negativer Betrag')
    const zahl = (table: string) => Number(connection.rows(`SELECT count(*) FROM ${table}`)[0]?.[0])
    connection.exec("DELETE FROM cost_items WHERE id = 'c1'")
    assert.deepEqual(connection.rows('SELECT service_cost_item_id FROM co2_statements')[0], [null])
    connection.exec("DELETE FROM tenancies WHERE id = 't1'")
    assert.equal(zahl('co2_tenant_reliefs'), 0, 'der Betrag fällt mit dem Mietverhältnis')
    connection.exec("DELETE FROM heating_periods WHERE id = 'h1'")
    assert.equal(zahl('co2_statements'), 0, 'der Datensatz fällt mit der Heizperiode')
  } finally {
    cleanup()
  }
})

// ---------- Lieferungen (Heizung PR 7) ----------

const eineGasanlage = [
  "INSERT INTO heating_plants (id, property_id, energy, method) VALUES ('hp1', 'objekt-1', 'gas', 'manual')",
  "INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')",
]

test('Lieferungen: Rechnungszeitraum paarweise und geordnet, Anteil bis 1000 ‰, Zahlen nicht negativ', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    for (const sql of eineGasanlage) connection.exec(sql)
    assert.equal(rejects(connection, "INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d1', 'hp1', '2025-03-15', '2026-03-14')"), null)
    assert.deepEqual(connection.rows("SELECT label, estimated, used_by_service FROM fuel_deliveries")[0], ['', 0, 1])
    assert.ok(rejects(connection, "INSERT INTO fuel_deliveries (id, plant_id, invoice_from) VALUES ('d2', 'hp1', '2025-03-15')"), 'Beginn ohne Ende')
    assert.ok(rejects(connection, "INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d3', 'hp1', '2026-03-14', '2025-03-15')"), 'Ende vor Beginn')
    assert.ok(rejects(connection, "INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d4', 'hp1', '15.03.2025', '14.03.2026')"), 'kein ISO-Datum')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET share_permille = 1001"), 'über 1000 ‰')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET fixed_cents = -1"), 'negativer fester Teil')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET emissions_kg = -1"), 'negativer Ausstoß')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET quantity_unit = 'fass'"), 'unbekannte Einheit')
    assert.ok(rejects(connection, "UPDATE fuel_deliveries SET heating_value = 0"), 'Heizwert 0')
    assert.equal(rejects(connection, "INSERT INTO fuel_delivery_parts (delivery_id, \"from\", \"to\", amount_cents) VALUES ('d1', '2025-03-15', '2025-12-31', 500000)"), null)
    assert.ok(rejects(connection, "INSERT INTO fuel_delivery_parts (delivery_id, \"from\", \"to\", amount_cents) VALUES ('d1', '2025-03-15', '2025-12-31', 1)"), 'dieselbe Teilmenge zweimal')
    assert.ok(rejects(connection, "INSERT INTO fuel_delivery_parts (delivery_id, \"from\", \"to\", amount_cents) VALUES ('d1', '2026-01-02', '2026-01-01', 1)"), 'Teilmenge endet vor Beginn')
  } finally {
    cleanup()
  }
})

test('Lieferungen: die Anlage bleibt stehen, Teilmengen fallen mit, Positionen und Eingefrorenes halten die Lieferung', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    for (const sql of eineGasanlage) connection.exec(sql)
    connection.exec("INSERT INTO fuel_deliveries (id, plant_id, invoice_from, invoice_to) VALUES ('d1', 'hp1', '2025-01-01', '2025-12-31')")
    connection.exec("INSERT INTO fuel_delivery_parts (delivery_id, \"from\", \"to\", amount_cents) VALUES ('d1', '2025-01-01', '2025-06-30', 100)")
    connection.exec("INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, heating_plant_id, fuel_delivery_id) VALUES ('c1', 'objekt-1', '2025-01', 'Heizung und Warmwasser', 'Gas', 100000, 'area', 'hp1', 'd1')")
    assert.ok(rejects(connection, "INSERT INTO cost_items (id, property_id, period, category, description, amount_cents, key, fuel_delivery_id) VALUES ('c2', 'objekt-1', '2025-01', 'Grundsteuer', 'G', 1, 'area', 'd1')"), 'Lieferung an einer kalten Position')
    assert.ok(rejects(connection, "DELETE FROM heating_plants WHERE id = 'hp1'"), 'die Lieferung hält die Anlage')
    assert.ok(rejects(connection, "DELETE FROM fuel_deliveries WHERE id = 'd1'"), 'die Position hält die Lieferung')
    connection.exec("DELETE FROM cost_items WHERE id = 'c1'")
    connection.exec("INSERT INTO fuel_carry_frozen (delivery_id, heating_period_id, cents) VALUES ('d1', 'h1', -98339)")
    assert.deepEqual(connection.rows('SELECT emissions_kg, co2_cents FROM fuel_carry_frozen')[0], [0, 0])
    assert.ok(rejects(connection, "DELETE FROM fuel_deliveries WHERE id = 'd1'"), 'das Eingefrorene hält die Lieferung')
    connection.exec('DELETE FROM fuel_carry_frozen')
    connection.exec("DELETE FROM fuel_deliveries WHERE id = 'd1'")
    assert.equal(Number(connection.rows('SELECT count(*) FROM fuel_delivery_parts')[0]?.[0]), 0, 'die Teilmengen fallen mit')
  } finally {
    cleanup()
  }
})

test('CO₂-Merkmale der Anlage und Ortswerte der Gradtage', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    for (const sql of eineGasanlage) connection.exec(sql)
    assert.deepEqual(connection.rows('SELECT non_residential, restriction, district_ets_new FROM heating_plants')[0], [0, 'none', 0])
    assert.ok(rejects(connection, "UPDATE heating_plants SET restriction = 'denkmal'"), 'unbekannte Beschränkung')
    assert.ok(rejects(connection, 'UPDATE heating_plants SET district_ets_new = 1'), 'Emissionshandel nur bei Fernwärme')
    assert.equal(rejects(connection, "UPDATE heating_plants SET energy = 'districtHeating', district_ets_new = 1"), null)
    assert.equal(rejects(connection, "INSERT INTO degree_day_values (property_id, month, value) VALUES ('objekt-1', '2025-01', 412.5)"), null)
    assert.ok(rejects(connection, "INSERT INTO degree_day_values (property_id, month, value) VALUES ('objekt-1', '2025-13', 1)"), 'Monat 13')
    assert.ok(rejects(connection, "INSERT INTO degree_day_values (property_id, month, value) VALUES ('objekt-1', '2025-02', 0)"), 'Wert 0')
  } finally {
    cleanup()
  }
})

// ---------- Vorrat (Heizung PR 8) ----------

test('Vorrat: Einheit aus der Liste, Mengen, Beträge und kg ab 0, Peildatum als Datum', async () => {
  const { connection, cleanup } = await freshDb()
  try {
    connection.exec("INSERT INTO heating_plants (id, property_id, energy, method) VALUES ('hp1', 'objekt-1', 'oil', 'manual')")
    connection.exec("INSERT INTO heating_periods (id, plant_id, period) VALUES ('h1', 'hp1', '2025-01')")
    assert.deepEqual(
      connection.rows('SELECT stock_unit, opening_quantity, opening_cost_cents, opening_emissions_kg, opening_co2_cents, opening_invoiced_before_2023, closing_quantity, closing_measured_on FROM heating_periods')[0],
      [null, null, null, null, null, null, null, null],
    )
    assert.equal(
      rejects(connection, "UPDATE heating_periods SET stock_unit = 'l', opening_quantity = 2000, opening_cost_cents = 190000, opening_emissions_kg = 5352.6, opening_co2_cents = 0, opening_invoiced_before_2023 = 1, closing_quantity = 1800, closing_measured_on = '2025-12-31'"),
      null,
    )
    assert.ok(rejects(connection, "UPDATE heating_periods SET stock_unit = 'm3'"), 'Einheit m³ gibt es beim Vorrat nicht')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET opening_quantity = -1'), 'negative Menge')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET opening_cost_cents = -1'), 'negativer Betrag')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET opening_emissions_kg = -0.1'), 'negative kg')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET opening_co2_cents = -1'), 'negative CO₂-Kosten')
    assert.ok(rejects(connection, 'UPDATE heating_periods SET closing_quantity = -5'), 'negativer Endbestand')
    assert.ok(rejects(connection, "UPDATE heating_periods SET closing_measured_on = '31.12.2025'"), 'Peildatum kein ISO-Datum')
  } finally {
    cleanup()
  }
})
