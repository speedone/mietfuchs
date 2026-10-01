// Das Schema der Datenbank (#55). Eine Tabelle je Sammlung der bisherigen db.json, dazu die
// Tabellen, in die verschachtelte Listen auseinandergelegt sind.
//
// Das maßgebliche Datenmodell bleibt `shared/types.ts`, von Hand geschrieben, weil der Browser
// es benutzt und nichts von Drizzle wissen darf. Dass beide Seiten zueinander passen, hält
// `server/test/schema.test.ts` zur Übersetzungszeit fest.
//
// Zwei Dinge gelten durchgehend:
//   Geld ist immer ein ganzzahliger Cent-Betrag, nie eine Gleitkommazahl in Euro.
//   Zeitangaben sind ISO-Zeichenketten mit inklusiven Grenzen, gerechnet in UTC.

import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type {
  AiJsonMode,
  AiProviderKind,
  AiSlotName,
  CostKey,
  DepositStatus,
  ExternalMeasure,
  MeterType,
  PropertyKind,
  Settings,
} from '../../../shared/types.ts'

// Die Werte der Aufzählungstypen stehen hier noch einmal, weil `shared/types.ts` bewusst keinen
// Laufzeitanteil hat und eine Prüfbedingung einen solchen braucht. Ausgeführt werden sie, weil
// der Validator (validate.ts) dieselben Listen braucht: Er prüft genau das, was die Datenbank
// gleich verlangen wird, und eine zweite Abschrift liefe irgendwann davon weg.
//
// Dass sie doppelt stehen, ist deshalb unvermeidlich, aber nicht ungesichert: `exactly<T>()`
// unten bindet jede Liste an ihren Domänentyp, und zwar **in beide Richtungen**. Ein Wert zu
// viel fällt ohnehin auf, weil er nicht in den Typ passt. Der gefährlichere Fall ist der
// fehlende Wert, denn den bemerkt kein Typ von selbst: Die Spalte nähme ihn weiterhin an, aber
// die Prüfbedingung wiese ihn ab, und die Datenbank verweigerte plötzlich gültige Daten. Ein
// neuer Zählertyp in shared/types.ts, der hier vergessen wird, ließe sich also nicht mehr
// speichern. Genau das fängt die zweite Richtung ab.
const exactly =
  <T extends string>() =>
  <L extends readonly T[]>(values: L & ([T] extends [L[number]] ? unknown : never)): L =>
    values

export const COST_KEYS = exactly<CostKey>()(['area', 'persons', 'units', 'direct', 'meter', 'custom', 'external', 'amounts'] as const)
export const EXTERNAL_MEASURES = exactly<ExternalMeasure>()(['mea', 'area', 'units'] as const)
export const METER_TYPES = exactly<MeterType>()(['kaltwasser', 'strom', 'waerme', 'sonstig'] as const)
export const DEPOSIT_STATUS = exactly<DepositStatus>()(['offen', 'erhalten', 'teilweise', 'zurückgezahlt'] as const)
const AI_PROVIDERS = exactly<AiProviderKind>()(['ollama', 'openai'] as const)
const AI_JSON_MODES = exactly<AiJsonMode>()(['auto', 'schema', 'object', 'prompt'] as const)
const AI_SLOT_NAMES = exactly<AiSlotName>()(['text', 'images'] as const)
export const UPDATE_CHECK = exactly<NonNullable<Settings['updateCheck']>>()(['on', 'off'] as const)

// Prüfbedingung „dieser Betrag ist nicht negativ". Als Helfer, damit an jeder Stelle dasselbe
// steht und der Grund je Spalte daneben als Kommentar auftaucht statt als Wiederholung.
const notNegative = (name: string, column: string) => check(name, sql.raw(`"${column}" >= 0`))

// Prüfbedingung „dieser Wert ist einer aus der Liste".
//
// Nötig, weil `text(..., { enum: [...] })` allein **nur den Übersetzer** bindet und im
// erzeugten SQL nichts hinterlässt. Für den Browser und für unseren Code reicht das, für die
// Datenbank nicht: Ein fremder Wert käme unbemerkt hinein, etwa über ein Backup aus einer
// späteren Version oder durch Bearbeiten der Datei von Hand. Ein unbekannter Umlageschlüssel
// verteilte dann gar nichts, und die Position fiele still dem Vermieter zu.
//
// NULL lässt die Bedingung durch; ob die Spalte leer sein darf, sagt `notNull` und sonst
// niemand. SQLite wertet eine Prüfbedingung nur als verletzt, wenn sie falsch ist, und ein
// Vergleich mit NULL ist unbekannt, nicht falsch.
const oneOf = (name: string, column: string, values: readonly string[]) =>
  check(name, sql.raw(`"${column}" IN (${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')})`))

// ---------- Objekte ----------

// Die Arten eines Objekts (#92). Sie steuern später Voreinstellungen und Oberfläche (#94); in
// Teil 1 werden sie nur gespeichert und angezeigt.
export const PROPERTY_KINDS = exactly<PropertyKind>()(['mfh', 'etw', 'efh', 'sonstiges'] as const)

// Ein Objekt ist zugleich die Abrechnungseinheit: ein Mehrfamilienhaus, eine vermietete
// Eigentumswohnung, ein Einfamilienhaus. Mehrere Gebäude, die gemeinsam abrechnen, sind *ein*
// Objekt (BGH VIII ZR 73/10); eine Rechnung für mehrere Objekte wird vorverteilt (#95).
//
// Vermieter, Bankverbindung und Zahlungsfrist dürfen je Objekt abweichen, etwa beim Haus der
// Eltern oder einer Erbengemeinschaft. `null` heißt „die Vorgabe aus den Einstellungen gilt“,
// eine leere Zeichenkette dagegen „bewusst keine“.
export const properties = sqliteTable(
  'properties',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: PROPERTY_KINDS }).notNull(),
    address: text('address').notNull(),
    landlordName: text('landlord_name'),
    iban: text('iban'),
    paymentDeadlineDays: integer('payment_deadline_days'),
  },
  () => [
    oneOf('properties_kind_known', 'kind', PROPERTY_KINDS),
    // Wie `settings_deadline_not_negative`: Eine negative Frist datierte die Fälligkeit vor die
    // Abrechnung.
    notNegative('properties_deadline_not_negative', 'payment_deadline_days'),
  ],
)

// Wurzeln eines Objekts sind Wohnungen, Zähler (auch Hauptzähler ohne Wohnung), Kostenpositionen
// und abgeschlossene Abrechnungen. Alles Übrige erbt das Objekt über sie; eine zweite Spalte
// wäre eine zweite Wahrheit, die auseinanderlaufen kann.
//
// `RESTRICT` und nicht `CASCADE`: Ein Objekt mit Inhalt darf nicht verschwinden, schon gar nicht
// samt Mietverhältnissen, Zahlungen und bezahlten Rechnungen. Gelöscht wird nur ein leeres.
const propertyRef = () => text('property_id').notNull().references(() => properties.id, { onDelete: 'restrict' })

// ---------- Wohnungen ----------

export const units = sqliteTable(
  'units',
  {
    id: text('id').primaryKey().notNull(),
    propertyId: propertyRef(),
    name: text('name').notNull(),
    areaM2: real('area_m2').notNull(),
    participates: integer('participates', { mode: 'boolean' }).notNull(),
    // Selbstgenutzt: kein Mietverhältnis, aber Teil der Verteilbasis.
    selfUsed: integer('self_used', { mode: 'boolean' }),
    selfPersons: integer('self_persons'),
    mea: real('mea'),
    rooms: integer('rooms'),
    floor: text('floor'),
    notes: text('notes'),
  },
  (t) => [
    // Eine negative Wohnfläche verkleinerte die Verteilbasis und triebe damit die Mieteranteile
    // über 100 Prozent. calc.ts wehrt das heute mit `u.areaM2 || 0` ab; hier kann es gar nicht
    // erst entstehen.
    notNegative('units_area_not_negative', 'area_m2'),
    // Gleicher Grund, gleiche Abwehr in calc.ts (`selfPersonsOf`).
    notNegative('units_self_persons_not_negative', 'self_persons'),
    notNegative('units_rooms_not_negative', 'rooms'),
    notNegative('units_mea_not_negative', 'mea'),
  ],
)

// ---------- Mietverhältnisse ----------

export const tenancies = sqliteTable(
  'tenancies',
  {
    id: text('id').primaryKey().notNull(),
    // Ein Mietverhältnis ohne Wohnung ergibt keinen Sinn, und calc.ts wirft es beim Rechnen
    // ohnehin weg. Beim Löschen der Wohnung fällt es deshalb mit.
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    tenantName: text('tenant_name').notNull(),
    // Die aktuelle Personenzahl, abgeleitet aus der Staffel. Sie bleibt als Feld erhalten, weil
    // calc.ts auf sie zurückfällt, wenn die Staffel leer ist.
    persons: integer('persons').notNull(),
    start: text('start').notNull(),
    // Offenes Mietverhältnis: kein Ende.
    end: text('end'),
    email: text('email'),
    phone: text('phone'),
    correspondenceAddress: text('correspondence_address'),
    iban: text('iban'),
    contractDate: text('contract_date'),
    depositCents: integer('deposit_cents'),
    depositStatus: text('deposit_status', { enum: DEPOSIT_STATUS }),
    notes: text('notes'),
  },
  (t) => [
    notNegative('tenancies_persons_not_negative', 'persons'),
    // Eine vereinbarte Kaution ist ein Betrag, den der Mieter hinterlegt; negativ ergibt er
    // keinen Sinn.
    notNegative('tenancies_deposit_not_negative', 'deposit_cents'),
    oneOf('tenancies_deposit_status_known', 'deposit_status', DEPOSIT_STATUS),
  ],
)

// Die drei Staffeln und die Jahreskorrektur bekommen eigene Tabellen statt einer Spalte mit
// JSON. Der Grund steht in CLAUDE.md ausführlich; kurz: In einer Spalte kann nichts davon
// zugesichert werden, was hier selbstverständlich ist: kein negativer Betrag, kein zweiter
// Eintrag zum selben Stichtag, kein Eintrag ohne Mietverhältnis.

// Personenzahl ab einem Tag (`from` ist 'YYYY-MM-DD', anders als bei den beiden Geld-Staffeln).
export const personHistory = sqliteTable(
  'person_history',
  {
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    from: text('from').notNull(),
    persons: integer('persons').notNull(),
  },
  (t) => [
    // Zwei Personenzahlen ab demselben Tag: Welche gilt, entschiede sonst die Reihenfolge beim
    // Sortieren, also der Zufall.
    primaryKey({ columns: [t.tenancyId, t.from] }),
    notNegative('person_history_persons_not_negative', 'persons'),
  ],
)

// Vorauszahlung ab einem Monat ('YYYY-MM').
export const prepayments = sqliteTable(
  'prepayments',
  {
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    from: text('from').notNull(),
    monthlyCents: integer('monthly_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenancyId, t.from] }),
    // Eine negative monatliche Vorauszahlung gibt es nicht: Der Mieter zahlt voraus, er bekommt
    // nicht monatlich etwas ausgezahlt.
    notNegative('prepayments_monthly_not_negative', 'monthly_cents'),
  ],
)

// Kaltmiete ab einem Monat ('YYYY-MM'). Gleiche Mechanik wie die Vorauszahlung, aber bewusst
// eine eigene Tabelle: Ein gemeinsamer Tisch mit einer Spalte „welche Art" spart nichts und
// zwänge jede Abfrage, die Art mitzufiltern.
export const baseRents = sqliteTable(
  'base_rents',
  {
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    from: text('from').notNull(),
    monthlyCents: integer('monthly_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenancyId, t.from] }),
    // Eine negative Kaltmiete gibt es nicht.
    notNegative('base_rents_monthly_not_negative', 'monthly_cents'),
  ],
)

// Tatsächlich gezahlte Vorauszahlung eines Jahres. Sie hat Vorrang vor der Staffel, weil
// rechtlich zählt, was geflossen ist. Anders als die Staffeln ist sie nach **Jahr** geschlüsselt
// und nicht nach Datum; der zusammengesetzte Primärschlüssel sagt genau das.
export const prepaymentOverrides = sqliteTable(
  'prepayment_overrides',
  {
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenancyId, t.year] }),
    // Was ein Mieter in einem Jahr insgesamt an Vorauszahlungen geleistet hat, ist kein
    // negativer Betrag.
    //
    // Das steht bewusst anders als bei `payments.amount_cents`, das ohne Bedingung bleibt, und
    // der Unterschied ist echt: Dort steht eine **einzelne** Buchung, und eine davon kann eine
    // Rücklastschrift sein, also ein negativer Eingang. Hier steht die **Jahressumme**, und die
    // fällt auch mit Rücklastschriften nicht unter null: Mehr zurückgeholt werden kann nicht,
    // als vorher geflossen ist.
    notNegative('prepayment_overrides_amount_not_negative', 'amount_cents'),
  ],
)

// ---------- Kostenpositionen ----------

export const costItems = sqliteTable(
  'cost_items',
  {
    id: text('id').primaryKey().notNull(),
    propertyId: propertyRef(),
    year: integer('year').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    vendor: text('vendor'),
    amountCents: integer('amount_cents').notNull(),
    key: text('key', { enum: COST_KEYS }).notNull(),
    // Direktzuordnung. Bewusst `SET NULL` und nicht `CASCADE`: Wird die Wohnung gelöscht, ist
    // die Rechnung trotzdem bezahlt worden und gehört weiter in die Abrechnung des Jahres.
    // `CASCADE` löschte sie und veränderte damit die Summe einer bereits abgerechneten
    // Vergangenheit, und das darf eine Datenbank niemals von sich aus tun.
    //
    // Heute räumt das Löschen einer Wohnung in index.ts die vereinbarten Anteile weg, lässt
    // `directUnitId` aber stehen; calc.ts fängt den ins Leere zeigenden Verweis mit der Warnung
    // „die direkt zugeordnete Wohnung gibt es nicht mehr — Betrag geht an den Vermieter" ab.
    // `SET NULL` erhält genau dieses Verhalten, denn `null` trifft in der Nachschlagetabelle
    // ebenso ins Leere wie eine unbekannte Kennung.
    directUnitId: text('direct_unit_id').references(() => units.id, { onDelete: 'set null' }),
    meterType: text('meter_type', { enum: METER_TYPES }),
    labor35aCents: integer('labor_35a_cents'),
    invoiceFile: text('invoice_file'),
    // Die Angaben der Gemeinschaft zum Schlüssel „laut Gemeinschaftsabrechnung“ (#94), drei
    // Spalten für einen Wert: alle drei oder keine.
    externalMeasure: text('external_measure', { enum: EXTERNAL_MEASURES }),
    externalTotal: real('external_total'),
    // Ohne Vorzeichenbedingung, aus demselben Grund wie `amount_cents`: eine Gutschrift.
    externalTotalCents: integer('external_total_cents'),
    // Ob die Position Teilnehmer hat (#94), eigens gespeichert: Ohne diese Spalte sähe eine
    // Position, deren letzte Teilnehmerwohnung gelöscht wurde, aus wie eine ohne Teilnehmer, und
    // ihre Kosten verteilten sich still auf alle Wohnungen. So bleibt es eine leere Liste, und die
    // Berechnung meldet sie.
    participantsLimited: integer('participants_limited', { mode: 'boolean' }),
  },
  (t) => [
    // Der einzige Filter, den der Schnappschuss wirklich setzt: die Kostenpositionen eines
    // Abrechnungsjahres (siehe snapshot.ts), seit #92 innerhalb eines Objekts.
    index('cost_items_property_year_idx').on(t.propertyId, t.year),
    // Ein unbekannter Umlageschlüssel verteilte gar nichts, und die Position fiele still dem
    // Vermieter zu. Deshalb hier eine echte Bedingung und nicht nur der Typ.
    oneOf('cost_items_key_known', 'key', COST_KEYS),
    oneOf('cost_items_meter_type_known', 'meter_type', METER_TYPES),
    oneOf('cost_items_external_measure_known', 'external_measure', EXTERNAL_MEASURES),
    // Eine Summe der Anlage von null ergäbe eine Division durch null im Rechenweg.
    check('cost_items_external_total_positive', sql.raw('"external_total" > 0')),
    check(
      'cost_items_external_complete',
      sql.raw('("external_measure" IS NULL) = ("external_total" IS NULL) AND ("external_measure" IS NULL) = ("external_total_cents" IS NULL)'),
    ),
    // Hier steht bewusst **keine** Bedingung auf `amount_cents`. Eine Gutschrift ist ein
    // negativer Betrag, und calc.test.ts hält den Fall ausdrücklich fest (Position
    // „Gutschrift" über -5000 Cent, die keine Warnung auslösen darf).
    //
    // Ebenso keine auf `labor_35a_cents`: calc.ts meldet einen Lohnanteil außerhalb von 0 bis
    // zum Rechnungsbetrag als Warnung und rechnet weiter. Eine Prüfbedingung machte daraus ein
    // hartes Nein beim Speichern, und der Nutzer bekäme die Warnung, die ihm den Fehler erklärt,
    // dann nie zu sehen.
  ],
)

// Vereinbarte Prozentanteile je Wohnung (§556a Abs. 1 Satz 1 BGB). Von allen verschachtelten
// Listen ist das die, die am deutlichsten in eine Tabelle gehört: Ihre Schlüssel sind
// Wohnungs-Kennungen, also Fremdschlüssel. In einer JSON-Spalte kann sie niemand schützen,
// weshalb index.ts sie beim Löschen einer Wohnung heute von Hand durchgeht und den Eintrag
// herausnimmt. Genau diese Handarbeit übernimmt hier `ON DELETE CASCADE`.
export const costItemShares = sqliteTable(
  'cost_item_shares',
  {
    costItemId: text('cost_item_id')
      .notNull()
      .references(() => costItems.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    percent: real('percent').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.costItemId, t.unitId] }),
    // Ein negativer Anteil ergibt keinen Sinn; calc.ts klammert ihn heute mit `Math.max(0, …)`
    // ab. Nach oben steht bewusst keine Grenze: Anteile über 100 Prozent in der Summe sind ein
    // Fall, den die Verteilung selbst behandelt, und eine Grenze hier verböte Daten, die das
    // Fachliche zulässt.
    notNegative('cost_item_shares_percent_not_negative', 'percent'),
  ],
)

// Die Teilnehmer einer Kostenposition (#94): Nur diese Wohnungen bilden ihre Verteilbasis. Keine
// Zeile heißt alle Wohnungen des Objekts. Dasselbe Muster wie `cost_item_shares`, und aus
// demselben Grund keine JSON-Spalte: Die Einträge sind Fremdschlüssel, und eine gelöschte
// Wohnung fällt über `ON DELETE CASCADE` heraus.
export const costItemParticipants = sqliteTable(
  'cost_item_participants',
  {
    costItemId: text('cost_item_id')
      .notNull()
      .references(() => costItems.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.costItemId, t.unitId] })],
)

// Einzelbeträge je Mietverhältnis (#94), etwa aus der Abrechnung eines Messdienstes. Ein
// gelöschtes Mietverhältnis nimmt seinen Betrag mit; der Rest fällt dem Vermieter zu, wie bei
// jedem verschwundenen Verteilziel.
export const costItemAmounts = sqliteTable(
  'cost_item_amounts',
  {
    costItemId: text('cost_item_id')
      .notNull()
      .references(() => costItems.id, { onDelete: 'cascade' }),
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.costItemId, t.tenancyId] }),
    // Ein negativer Einzelbetrag machte den Anteil des Vermieters größer als die Rechnung.
    notNegative('cost_item_amounts_not_negative', 'amount_cents'),
  ],
)

// ---------- Zähler und Ablesungen ----------

export const meters = sqliteTable(
  'meters',
  {
    id: text('id').primaryKey().notNull(),
    // Eigens und nicht über die Wohnung: Ein Hauptzähler hat keine.
    propertyId: propertyRef(),
    name: text('name').notNull(),
    // null heißt Hauptzähler für das ganze Haus. Deshalb ohne `notNull`, aber mit
    // Fremdschlüssel: Zeigt er auf eine Wohnung, muss es sie geben. Beim Löschen der Wohnung
    // fällt der Zähler mit, wie heute in index.ts.
    unitId: text('unit_id').references(() => units.id, { onDelete: 'cascade' }),
    type: text('type', { enum: METER_TYPES }).notNull(),
    meterNumber: text('meter_number'),
    unit: text('unit').notNull(),
  },
  () => [
    // Der Zählertyp verbindet Zähler und Kostenposition (`cost_items.meter_type`). Ein
    // unbekannter Wert fände keine Zähler und ergäbe eine Position ohne Verteilbasis.
    oneOf('meters_type_known', 'type', METER_TYPES),
  ],
)

export const readings = sqliteTable(
  'readings',
  {
    id: text('id').primaryKey().notNull(),
    meterId: text('meter_id')
      .notNull()
      .references(() => meters.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    value: real('value').notNull(),
    // Zählerwechsel: `value` ist dann der Startstand des neuen Geräts.
    replacement: integer('replacement', { mode: 'boolean' }),
    oldEndValue: real('old_end_value'),
    note: text('note'),
  },
  (t) => [
    // Ein Zählerstand ist eine ablesbare Menge und läuft nicht unter null. Der negative
    // *Verbrauch*, vor dem calc.ts warnt, entsteht aus zwei Ständen und ist etwas anderes.
    notNegative('readings_value_not_negative', 'value'),
    notNegative('readings_old_end_value_not_negative', 'old_end_value'),
  ],
)

// ---------- Zahlungen ----------

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey().notNull(),
  // Heute räumt index.ts die Zahlungen beim Löschen eines Mietverhältnisses weg, und beim
  // Löschen einer Wohnung über den Umweg der zugehörigen Mietverhältnisse. Beides erledigt
  // dieser eine Fremdschlüssel, der zweite Fall über die Kette von der Wohnung zum Mietverhältnis.
  tenancyId: text('tenancy_id')
    .notNull()
    .references(() => tenancies.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  // Ohne Prüfbedingung: Eine Rücklastschrift ist ein echter Vorgang und stünde hier als
  // negativer Eingang. Nichts im Fachcode schließt das aus, also verbietet es die Datenbank
  // auch nicht.
  amountCents: integer('amount_cents').notNull(),
  note: text('note'),
})

// ---------- Abgeschlossene Abrechnungen ----------

export const closedSettlements = sqliteTable(
  'closed_settlements',
  {
    id: text('id').primaryKey().notNull(),
    propertyId: propertyRef(),
    year: integer('year').notNull(),
    closedAt: text('closed_at').notNull(),
    // Datum des Versands, für die Frist nach §556 Abs. 3 BGB. null = noch nicht versandt.
    sentAt: text('sent_at'),
    // Hier steht bewusst JSON, und das ist kein Rückfall in die alte Ablage. Der eingefrorene
    // Berechnungsstand ist ein **Archivstück**: das Ergebnis von computeSettlement zu dem
    // Zeitpunkt, als die Abrechnung verschickt wurde. Er soll wortgleich erhalten bleiben, auch
    // wenn spätere Versionen anders rechnen oder andere Felder führen. Ihn in Spalten zu
    // zerlegen hieße, ihn an das heutige Ergebnisformat zu binden, denn dann veränderte eine
    // Programmänderung rückwirkend, was dem Mieter zugestellt wurde.
    settlement: text('settlement', { mode: 'json' }).notNull(),
  },
  (t) => [
    // Zugleich Zusicherung und die zweite Abfrage des Schnappschusses: Je Objekt und Jahr gibt
    // es höchstens eine abgeschlossene Abrechnung. Vor #92 galt das je Jahr; mit zwei Objekten
    // sperrte das eine sonst das andere.
    uniqueIndex('closed_settlements_property_year_idx').on(t.propertyId, t.year),
    // Dass der Inhalt überhaupt JSON ist, kann die Datenbank prüfen, und nur das prüft sie hier.
    // Ob die Abrechnung darin fachlich stimmt, weiß sie nicht und soll sie nicht wissen; das ist
    // gerade der Sinn eines Archivstücks. Eine abgeschnittene oder verstümmelte Zeichenkette
    // fällt damit aber sofort auf, statt erst Jahre später beim Öffnen der alten Abrechnung.
    //
    // Diese Bedingung muss jetzt stehen oder nie: SQLite kann eine Prüfbedingung nicht
    // nachträglich hinzufügen, das ginge nur über einen Neubau der ganzen Tabelle. Solange
    // niemand Daten darin hat, kostet sie nichts.
    // Unqualifiziert (`"settlement"` statt `"closed_settlements"."settlement"`): Beim Neubau der
    // Tabelle stünde sonst der Name des Zwischenstands darin, und das SQLite von macOS lehnt den
    // Verweis nach dem Umbenennen ab (migrations.test.ts).
    check('closed_settlements_settlement_is_json', sql.raw('json_valid("settlement")')),
  ],
)

// ---------- Einstellungen ----------

// Echte Spalten statt eines JSON-Klumpens, und zwar genau deshalb, weil #60 sonst unverändert
// mitwanderte: `PUT /api/settings` übernimmt heute jeden Schlüssel des Rumpfes, auch einen
// erfundenen, und schreibt ihn dauerhaft. Mit Spalten gibt es für ein unbekanntes Feld keinen
// Ort mehr. Die Datenbank weist es ab, ohne dass jemand eine Liste erlaubter Felder pflegen
// muss.
export const settings = sqliteTable(
  'settings',
  {
    id: integer('id').primaryKey().notNull(),
    houseName: text('house_name').notNull(),
    address: text('address').notNull(),
    landlordName: text('landlord_name').notNull(),
    iban: text('iban').notNull(),
    paymentDeadlineDays: integer('payment_deadline_days').notNull(),
    // Adresse und Modell von Ollama. Sie spiegeln den Standard-Platz, solange Ollama der
    // Anbieter ist, und ein Tab von vor #18 schickt nur sie.
    ollamaUrl: text('ollama_url').notNull(),
    ollamaModel: text('ollama_model').notNull(),
    printAdjustSuggestion: integer('print_adjust_suggestion', { mode: 'boolean' }),
    printAttachments: integer('print_attachments', { mode: 'boolean' }),
    // Ohne Wert wurde noch nicht gefragt; 'on' erlaubt die Abfrage bei GitHub.
    updateCheck: text('update_check', { enum: UPDATE_CHECK }),
    updateDismissed: text('update_dismissed'),
    // Die Einstellungen der KI für Fortgeschrittene. Sie sind einzelne Werte mit einem
    // Wertebereich und gehören deshalb hierher; was es je Platz zweimal gibt, steht in
    // `ai_slots`.
    aiTimeoutSeconds: integer('ai_timeout_seconds'),
    aiNumCtx: integer('ai_num_ctx'),
    aiMaxOutputTokens: integer('ai_max_output_tokens'),
    aiPageImageEdge: integer('ai_page_image_edge'),
    aiJsonMode: text('ai_json_mode', { enum: AI_JSON_MODES }).notNull(),
    aiReasoningEffort: text('ai_reasoning_effort'),
    aiExtraInstructions: text('ai_extra_instructions').notNull(),
  },
  (t) => [
    // Die Einstellungen sind genau eine Zeile. Ohne diese Bedingung könnte eine zweite
    // entstehen, und welche dann gölte, entschiede die Reihenfolge beim Lesen.
    check('settings_single_row', sql`${t.id} = 1`),
    // Eine negative Zahlungsfrist datierte die Fälligkeit vor die Abrechnung.
    notNegative('settings_deadline_not_negative', 'payment_deadline_days'),
    oneOf('settings_update_check_known', 'update_check', UPDATE_CHECK),
    oneOf('settings_ai_json_mode_known', 'ai_json_mode', AI_JSON_MODES),
  ],
)

// Die beiden Plätze der KI-Belegauswertung als Zeilen, nicht als Spalten mit Präfix.
//
// `text` und `images` sind zwei Ausprägungen **derselben** Gestalt (`AiSlot` in
// shared/types.ts), und `images` darf fehlen. Als Spalten wären das zehn Stück
// (`ai_text_url`, `ai_images_url`, …), die man für alle Zeiten von Hand im Gleichschritt
// halten müsste, und ein dritter Platz wäre wieder fünf neue Spalten. Als Zeilen ist er eine
// Zeile, und die Prüfbedingungen auf Anbieter und Vorlage stehen einmal statt zweimal.
//
// Die Bestätigung eines externen Dienstes steht bewusst in derselben Zeile: Sie gilt für eine
// bestimmte Adresse und ein bestimmtes Modell, und nur so lässt sich später prüfen, wofür sie
// erteilt wurde.
//
// Eine Folge davon ist erwähnenswert, weil sie sich vom heutigen Verhalten unterscheidet: Wird
// der Platz für Fotos und Scans entfernt, verschwindet mit seiner Zeile auch seine Bestätigung.
// In der db.json überlebt sie das heute, weil `ai.consent` neben den Plätzen liegt. Die
// Richtung ist die sichere: Wer den Platz neu einrichtet, wird erneut gefragt, bevor ein Beleg
// hinausgeht. Der Preis ist eine Rückfrage, die man schon einmal beantwortet hatte, und den
// ist die Zusicherung wert, dass es keine Bestätigung ohne den Dienst gibt, für den sie gilt.
//
// **Kein Feld für den API-Schlüssel.** Die Schlüssel liegen weiterhin außerhalb der Datenbank
// in `data/secrets.json` (unter Unix mit 0600) und gehören auch nicht ins Backup. Das bleibt so.
export const aiSlots = sqliteTable(
  'ai_slots',
  {
    slot: text('slot', { enum: AI_SLOT_NAMES }).primaryKey().notNull(),
    provider: text('provider', { enum: AI_PROVIDERS }).notNull(),
    preset: text('preset').notNull(),
    url: text('url').notNull(),
    model: text('model').notNull(),
    // null heißt „unbekannt": Ollama meldet selbst, ob das Modell Bilder versteht.
    vision: integer('vision', { mode: 'boolean' }),
    consentUrl: text('consent_url'),
    consentModel: text('consent_model'),
    consentDate: text('consent_date'),
  },
  () => [
    // Es gibt genau zwei Plätze. Ein dritter Name wäre eine Einstellung, die nie jemand liest.
    oneOf('ai_slots_slot_known', 'slot', AI_SLOT_NAMES),
    oneOf('ai_slots_provider_known', 'provider', AI_PROVIDERS),
  ],
)
