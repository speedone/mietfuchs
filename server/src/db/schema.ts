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
  AssessmentBooking,
  ChangeSplit,
  CostKey,
  CostModel,
  DepositStatus,
  DevicesInstalledAfter,
  DevicesRemote,
  DhwMethod,
  ExternalMeasure,
  HeatingEnergy,
  HeatingMethod,
  HeatingPart,
  HeatingRole,
  HeatingSource,
  HeatingSupply,
  InsulationRule,
  NewDevicesInstall,
  MeterType,
  PeriodKey,
  PropertyKind,
  Settings,
  StoredAssessment,
  UploadKind,
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
export const COST_MODELS = exactly<CostModel>()(['settlement', 'flatRate', 'inclusive'] as const)
export const METER_TYPES = exactly<MeterType>()(['kaltwasser', 'warmwasser', 'strom', 'waerme', 'hkv', 'sonstig'] as const)
export const HEATING_PARTS = exactly<HeatingPart>()(['fuel', 'operating', 'metering'] as const)
export const DEPOSIT_STATUS = exactly<DepositStatus>()(['offen', 'erhalten', 'teilweise', 'zurückgezahlt'] as const)
const AI_PROVIDERS = exactly<AiProviderKind>()(['ollama', 'openai'] as const)
const AI_JSON_MODES = exactly<AiJsonMode>()(['auto', 'schema', 'object', 'prompt'] as const)
const AI_SLOT_NAMES = exactly<AiSlotName>()(['text', 'images'] as const)
export const UPDATE_CHECK = exactly<NonNullable<Settings['updateCheck']>>()(['on', 'off'] as const)

// Prüfbedingung „dieser Betrag ist nicht negativ“. Als Helfer, damit an jeder Stelle dasselbe
// steht und der Grund je Spalte daneben als Kommentar auftaucht statt als Wiederholung.
const notNegative = (name: string, column: string) => check(name, sql.raw(`"${column}" >= 0`))

// Prüfbedingung „dieser Wert ist einer aus der Liste“.
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

// Prüfbedingung „ein Zeitraumschlüssel 'JJJJ-MM' mit Monat 01 bis 12“ (#208, G-C3). Ob es diesen
// Zeitraum für das Objekt gibt, weiß die Datenbank nicht; das prüft repository.ts beim Schreiben,
// und `orphanPeriodKeys` fragt es beim Wiederherstellen über den ganzen Bestand ab. NULL lässt sie
// durch wie `oneOf`.
const periodKeyCheck = (name: string, column: string) =>
  check(name, sql.raw(`"${column}" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND CAST(substr("${column}", 6, 2) AS INTEGER) BETWEEN 1 AND 12`))

// ---------- Objekte ----------

// Die Arten eines Objekts (#92). Sie steuern später Voreinstellungen und Oberfläche (#94); in
// Teil 1 werden sie nur gespeichert und angezeigt.
export const PROPERTY_KINDS = exactly<PropertyKind>()(['mfh', 'etw', 'efh', 'zfh', 'sonstiges'] as const)

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
    // Kabelanlage vor dem 01.12.2021 errichtet (#121); null heißt unbekannt.
    cableBuiltBeforeDec2021: integer('cable_built_before_dec_2021', { mode: 'boolean' }),
    // Beginnmonat der Abrechnungszeiträume von Anfang an (#208): 1 heißt Kalenderjahr. Die Zeiträume
    // werden berechnet (shared/period.ts), zusammen mit den Wechseln in `period_changes`.
    periodStartMonth: integer('period_start_month').notNull().default(1),
  },
  () => [
    oneOf('properties_kind_known', 'kind', PROPERTY_KINDS),
    // Wie `settings_deadline_not_negative`: Eine negative Frist datierte die Fälligkeit vor die
    // Abrechnung.
    notNegative('properties_deadline_not_negative', 'payment_deadline_days'),
    check('properties_period_start_month_valid', sql.raw('"period_start_month" BETWEEN 1 AND 12')),
  ],
)

// Wechsel des Rhythmus (#208): Ab `from_month` ('JJJJ-MM') beginnt jeder Zeitraum in diesem Monat;
// der letzte Zeitraum davor endet am Tag vor dem Wechsel (Rumpfzeitraum). Gehört zum Objekt und
// fällt mit ihm.
export const periodChanges = sqliteTable(
  'period_changes',
  {
    propertyId: text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    fromMonth: text('from_month').notNull(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.fromMonth] }), periodKeyCheck('period_changes_from_month_valid', 'from_month')],
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
    // Nebenkostenmodell (#93), getrennt für kalte Kosten und Heizung. NULL heißt Abrechnung.
    costModel: text('cost_model', { enum: COST_MODELS }),
    heatingModel: text('heating_model', { enum: COST_MODELS }),
  },
  (t) => [
    notNegative('tenancies_persons_not_negative', 'persons'),
    // Eine vereinbarte Kaution ist ein Betrag, den der Mieter hinterlegt; negativ ergibt er
    // keinen Sinn.
    notNegative('tenancies_deposit_not_negative', 'deposit_cents'),
    oneOf('tenancies_deposit_status_known', 'deposit_status', DEPOSIT_STATUS),
    oneOf('tenancies_cost_model_known', 'cost_model', COST_MODELS),
    oneOf('tenancies_heating_model_known', 'heating_model', COST_MODELS),
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

// Pauschale ab einem Monat ('YYYY-MM', #93). Eine eigene Tabelle und nicht die der Vorauszahlung:
// Das Mietkonto führt sie im Soll, die Abrechnung rechnet sie nie an. In derselben Staffel würde
// sie bei einem gemischten Modell gegen die abgerechneten Kosten gutgeschrieben.
export const flatRates = sqliteTable(
  'flat_rates',
  {
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    from: text('from').notNull(),
    monthlyCents: integer('monthly_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenancyId, t.from] }),
    notNegative('flat_rates_monthly_not_negative', 'monthly_cents'),
  ],
)

// Kaltmiete ab einem Monat ('YYYY-MM'). Gleiche Mechanik wie die Vorauszahlung, aber bewusst
// eine eigene Tabelle: Ein gemeinsamer Tisch mit einer Spalte „welche Art“ spart nichts und
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

// Tatsächlich gezahlte Vorauszahlung eines Abrechnungszeitraums (#208). Sie hat Vorrang vor der
// Staffel, weil rechtlich zählt, was geflossen ist. Anders als die Staffeln ist sie nach **Zeitraum**
// geschlüsselt und nicht nach Datum; der zusammengesetzte Primärschlüssel sagt genau das.
export const prepaymentOverrides = sqliteTable(
  'prepayment_overrides',
  {
    tenancyId: text('tenancy_id')
      .notNull()
      .references(() => tenancies.id, { onDelete: 'cascade' }),
    period: text('period').$type<PeriodKey>().notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenancyId, t.period] }),
    periodKeyCheck('prepayment_overrides_period_valid', 'period'),
    // Was ein Mieter in einem Jahr insgesamt an Vorauszahlungen geleistet hat, ist kein
    // negativer Betrag.
    //
    // Das steht bewusst anders als bei `payments.amount_cents`, das ohne Bedingung bleibt, und
    // der Unterschied ist echt: Dort steht eine **einzelne** Buchung, und eine davon kann eine
    // Rücklastschrift sein, also ein negativer Eingang. Hier steht die **Summe des Zeitraums**, und die
    // fällt auch mit Rücklastschriften nicht unter null: Mehr zurückgeholt werden kann nicht,
    // als vorher geflossen ist.
    notNegative('prepayment_overrides_amount_not_negative', 'amount_cents'),
  ],
)

// ---------- Heizanlage (Heizung PR 4, Entwurf 5.3) ----------

export const HEATING_ENERGIES = exactly<HeatingEnergy>()(['gas', 'oil', 'lpg', 'pellets', 'wood', 'districtHeating', 'heatPump', 'electric', 'coal', 'other'] as const)
export const HEATING_SUPPLIES = exactly<HeatingSupply>()(['central', 'perUnit'] as const)
export const HEATING_METHODS = exactly<HeatingMethod>()(['service', 'self', 'manual'] as const)
export const DEVICES_REMOTE = exactly<DevicesRemote>()(['all', 'none', 'partial', 'unknown'] as const)
export const DEVICES_INSTALLED_AFTER = exactly<DevicesInstalledAfter>()(['all', 'some', 'none', 'unknown'] as const)
export const NEW_DEVICES_INSTALLS = exactly<NewDevicesInstall>()(['single', 'whole'] as const)
export const HEATING_SOURCES = exactly<HeatingSource>()(['building', 'homeowners'] as const)
export const CHANGE_SPLITS = exactly<ChangeSplit>()(['degreeDays', 'time'] as const)
export const HEATING_ROLES = exactly<HeatingRole>()(['supply', 'dhwHeat', 'totalHeat'] as const)
export const INSULATION_RULES = exactly<InsulationRule>()(['applies', 'notApplies', 'unknown'] as const)
export const DHW_METHODS = exactly<DhwMethod>()(['heatMeter', 'volumeFormula', 'areaFormula'] as const)

// Die Heizanlage eines Objekts. Spalten späterer PRs kommen mit ihnen (CO₂-Merkmale mit PR 7, §§ 5a
// bis 5d mit PR 18, Erfassung und Ausnahmen mit PR 10 und 14); was PR 4 schon anlegt, aber erst
// später rechnet (`separate_settlement`, `period_start_month`), lehnt der Server bis dahin ab.
export const heatingPlants = sqliteTable(
  'heating_plants',
  {
    id: text('id').primaryKey().notNull(),
    propertyId: propertyRef(),
    // Ab der zweiten Anlage Pflicht (PR 9); bis dahin darf er leer sein.
    name: text('name').notNull().default(''),
    energy: text('energy', { enum: HEATING_ENERGIES }).notNull(),
    supply: text('supply', { enum: HEATING_SUPPLIES }).notNull().default('central'),
    method: text('method', { enum: HEATING_METHODS }).notNull().default('manual'),
    separateSettlement: integer('separate_settlement', { mode: 'boolean' }),
    devicesRemote: text('devices_remote', { enum: DEVICES_REMOTE }).notNull().default('unknown'),
    devicesInstalledAfter2021: text('devices_installed_after_2021_12', { enum: DEVICES_INSTALLED_AFTER }).notNull().default('unknown'),
    // Einzeln ersetzt oder als Ganzes neu (§ 5 Abs. 2 Satz 1 und 4 HeizkostenV); NULL heißt unbeantwortet.
    newDevicesInstall: text('new_devices_install', { enum: NEW_DEVICES_INSTALLS }),
    source: text('source', { enum: HEATING_SOURCES }).notNull().default('building'),
    captureInstalledOn: text('capture_installed_on'),
    capturedOnOct2024: integer('captured_on_2024_10_01', { mode: 'boolean' }),
    warmRentAverageCents: integer('warm_rent_average_2022_2024'),
    changeSplit: text('change_split', { enum: CHANGE_SPLITS }).notNull().default('degreeDays'),
    periodStartMonth: integer('period_start_month'),
    // Ob die Anlage eine Liste der angeschlossenen Wohnungen hat; ohne Liste alle (siehe
    // heating_plant_units). Eigens gespeichert wie `participants_limited` (#94).
    unitsLimited: integer('units_limited', { mode: 'boolean' }).notNull().default(false),
  },
  () => [
    oneOf('heating_plants_energy_known', 'energy', HEATING_ENERGIES),
    oneOf('heating_plants_supply_known', 'supply', HEATING_SUPPLIES),
    oneOf('heating_plants_method_known', 'method', HEATING_METHODS),
    oneOf('heating_plants_devices_remote_known', 'devices_remote', DEVICES_REMOTE),
    oneOf('heating_plants_devices_installed_known', 'devices_installed_after_2021_12', DEVICES_INSTALLED_AFTER),
    oneOf('heating_plants_new_devices_install_known', 'new_devices_install', NEW_DEVICES_INSTALLS),
    oneOf('heating_plants_source_known', 'source', HEATING_SOURCES),
    oneOf('heating_plants_change_split_known', 'change_split', CHANGE_SPLITS),
    check('heating_plants_period_start_month_valid', sql.raw('"period_start_month" BETWEEN 1 AND 12')),
    // Die Gemeinschaft liefert eine fertige Abrechnung; übernommen wird sie wie die eines
    // Messdienstes (Entwurf 8.9, D-F2).
    check('heating_plants_source_method_valid', sql.raw(`"source" <> 'homeowners' OR "method" = 'service'`)),
    notNegative('heating_plants_warm_rent_not_negative', 'warm_rent_average_2022_2024'),
  ],
)

// Die angeschlossenen Wohnungen einer Anlage. Eine gelöschte Wohnung fällt heraus; die Anlage
// behält über `units_limited` ihre Liste, auch wenn sie leer wird.
export const heatingPlantUnits = sqliteTable(
  'heating_plant_units',
  {
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    heatedAreaM2: real('heated_area_m2'),
  },
  (t) => [
    primaryKey({ columns: [t.plantId, t.unitId] }),
    check('heating_plant_units_heated_area_positive', sql.raw('"heated_area_m2" > 0')),
  ],
)

// Eine Zeile je Anlage und Heizperiode (Entwurf 5.3), ohne die Spalten des Vorrats (PR 7, 8). In
// PR 4 ist die Heizperiode der Abrechnungszeitraum des Objekts; eine eigene kommt mit PR 5.
export const heatingPeriods = sqliteTable(
  'heating_periods',
  {
    id: text('id').primaryKey().notNull(),
    plantId: text('plant_id')
      .notNull()
      .references(() => heatingPlants.id, { onDelete: 'cascade' }),
    period: text('period').$type<PeriodKey>().notNull(),
    // Verteilung (§§ 6 Abs. 4, 7, 8, 10 HeizkostenV)
    heatConsumptionPct: real('heat_consumption_pct'),
    waterConsumptionPct: real('water_consumption_pct'),
    above70Agreed: integer('above_70_agreed', { mode: 'boolean' }),
    insulationRule: text('insulation_rule', { enum: INSULATION_RULES }),
    // Warmwasser (§ 9 HeizkostenV)
    dhwMethod: text('dhw_method', { enum: DHW_METHODS }),
    dhwHeatKwh: real('dhw_heat_kwh'),
    totalHeatKwh: real('total_heat_kwh'),
    dhwVolumeM3: real('dhw_volume_m3'),
    dhwTempC: real('dhw_temp_c'),
    dhwUnmeasurable: integer('dhw_unmeasurable', { mode: 'boolean' }),
    // Abrechnungsinformationen (§ 6a Abs. 3 HeizkostenV)
    infoTaxesText: text('info_taxes_text'),
    infoDistrictGhg: real('info_district_ghg'),
    infoDistrictPef: real('info_district_pef'),
    climateFactor: real('climate_factor'),
    climateFactorPrev: real('climate_factor_prev'),
    consumerContract: text('consumer_contract'),
    infoContactsConfirmed: integer('info_contacts_confirmed', { mode: 'boolean' }),
  },
  (t) => [
    uniqueIndex('heating_periods_plant_period_idx').on(t.plantId, t.period),
    // Derselbe Wortlaut wie bei `period` der Kostenpositionen (PR 2, G-C3).
    periodKeyCheck('heating_periods_period_valid', 'period'),
    check('heating_periods_heat_pct_valid', sql.raw('"heat_consumption_pct" BETWEEN 0 AND 100')),
    check('heating_periods_water_pct_valid', sql.raw('"water_consumption_pct" BETWEEN 0 AND 100')),
    oneOf('heating_periods_insulation_rule_known', 'insulation_rule', INSULATION_RULES),
    oneOf('heating_periods_dhw_method_known', 'dhw_method', DHW_METHODS),
    notNegative('heating_periods_dhw_heat_not_negative', 'dhw_heat_kwh'),
    notNegative('heating_periods_total_heat_not_negative', 'total_heat_kwh'),
    notNegative('heating_periods_dhw_volume_not_negative', 'dhw_volume_m3'),
  ],
)

// ---------- Kostenpositionen ----------

export const costItems = sqliteTable(
  'cost_items',
  {
    id: text('id').primaryKey().notNull(),
    propertyId: propertyRef(),
    period: text('period').$type<PeriodKey>().notNull(),
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
    // „die direkt zugeordnete Wohnung gibt es nicht mehr — Betrag geht an den Vermieter“ ab.
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
    // Der Leistungszeitraum der Rechnung (#208, Entwurf 3.4), beide oder keines. Bei einer
    // aufgeteilten kalten Rechnung steht an jedem Teil der ganze Leistungszeitraum.
    serviceFrom: text('service_from'),
    serviceTo: text('service_to'),
    // Das Jahr der Zahlung für die Steuer (#208, Entwurf 3.10); NULL heißt das Kalenderjahr des
    // Zeitraums, wenn er in einem liegt. Pflicht bei einem Zeitraum über zwei Jahre prüft
    // repository.ts, denn die Datenbank kennt die Zeiträume nicht.
    taxYear: integer('tax_year'),
    // Teil der Heizkosten (#208, Entwurf 5.3, A1), nur bei „Heizung und Warmwasser“.
    heatingPart: text('heating_part', { enum: HEATING_PARTS }),
    // Die Heizanlage der Position (Heizung PR 4). `RESTRICT`: Eine Anlage mit Positionen wird nicht
    // still gelöscht; `removeHeatingPlant` gibt sie vorher frei.
    heatingPlantId: text('heating_plant_id').references(() => heatingPlants.id, { onDelete: 'restrict' }),
  },
  (t) => [
    // Der einzige Filter, den der Schnappschuss wirklich setzt: die Kostenpositionen eines
    // Abrechnungszeitraums (siehe snapshot.ts), innerhalb eines Objekts.
    index('cost_items_property_period_idx').on(t.propertyId, t.period),
    periodKeyCheck('cost_items_period_valid', 'period'),
    // Ein unbekannter Umlageschlüssel verteilte gar nichts, und die Position fiele still dem
    // Vermieter zu. Deshalb hier eine echte Bedingung und nicht nur der Typ.
    oneOf('cost_items_key_known', 'key', COST_KEYS),
    oneOf('cost_items_meter_type_known', 'meter_type', METER_TYPES),
    oneOf('cost_items_external_measure_known', 'external_measure', EXTERNAL_MEASURES),
    // Leistungszeitraum (#208): beide oder keines, als Datum, Beginn nicht nach dem Ende.
    // Die Namen folgen der Konvention aus errors.ts (db-errors.test.ts); die Sätze dazu stehen
    // dort je Bedingung, weil `_complete` und `_valid` sonst von etwas anderem sprächen.
    check('cost_items_service_complete', sql.raw('("service_from" IS NULL) = ("service_to" IS NULL)')),
    check('cost_items_service_from_valid', sql.raw(`"service_from" IS NULL OR "service_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('cost_items_service_to_valid', sql.raw(`"service_to" IS NULL OR "service_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)),
    check('cost_items_service_order_valid', sql.raw('"service_from" IS NULL OR "service_from" <= "service_to"')),
    // Ein Jahr der Zahlung, das es geben kann; die genaue Spanne je Zeitraum prüft repository.ts.
    check('cost_items_tax_year_valid', sql.raw('"tax_year" IS NULL OR "tax_year" BETWEEN 1900 AND 2200')),
    oneOf('cost_items_heating_part_known', 'heating_part', HEATING_PARTS),
    // Ein Brennstoffmerkmal an Müllabfuhr hätte keine Bedeutung und verwirrte den Vorschlag nach § 560.
    check('cost_items_heating_part_category_valid', sql.raw(`"heating_part" IS NULL OR "category" = 'Heizung und Warmwasser'`)),
    // Eine Summe der Anlage von null ergäbe eine Division durch null im Rechenweg.
    check('cost_items_external_total_positive', sql.raw('"external_total" > 0')),
    check(
      'cost_items_external_complete',
      sql.raw('("external_measure" IS NULL) = ("external_total" IS NULL) AND ("external_measure" IS NULL) = ("external_total_cents" IS NULL)'),
    ),
    // Hier steht bewusst **keine** Bedingung auf `amount_cents`. Eine Gutschrift ist ein
    // negativer Betrag, und calc.test.ts hält den Fall ausdrücklich fest (Position
    // „Gutschrift“ über -5000 Cent, die keine Warnung auslösen darf).
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

// Beträge selbstgenutzter Wohnungen (#104), etwa aus derselben Abrechnung des Messdienstes. Sie
// sind der Eigenanteil des Vermieters. Eine gelöschte Wohnung nimmt ihren Betrag mit, wie bei den
// Einzelbeträgen der Mietverhältnisse.
export const costItemSelfAmounts = sqliteTable(
  'cost_item_self_amounts',
  {
    costItemId: text('cost_item_id')
      .notNull()
      .references(() => costItems.id, { onDelete: 'cascade' }),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.costItemId, t.unitId] }),
    notNegative('cost_item_self_amounts_not_negative', 'amount_cents'),
  ],
)

// Zählertypen, für die eine Einheit keinen Anschluss hat (#117), etwa eine Garage ohne Wasser.
// Eine Liste und keine Spalten je Typ, damit die Tabelle der Wohnungen unberührt bleibt; ein neuer
// Zählertyp braucht wegen der Prüfbedingung hier wie bei den Zählern einen Neubau dieser Tabelle.
// Eine gelöschte Wohnung nimmt ihre Einträge mit. Die Angabe gilt nicht je Jahr: Wer sie ändert,
// ändert auch die noch offenen früheren Jahre, wie bei der Nutzungsart.
export const unitNoConnection = sqliteTable(
  'unit_no_connection',
  {
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    meterType: text('meter_type', { enum: METER_TYPES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.meterType] }),
    oneOf('unit_no_connection_meter_type_known', 'meter_type', METER_TYPES),
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
    // Zähler der Heizanlage selbst (Heizung PR 4): ohne Wohnung, mit Rolle. `RESTRICT`: Ohne Anlage
    // wäre er ein Hauptzähler des Hauses und verteilte Verbrauch um (#116).
    heatingPlantId: text('heating_plant_id').references(() => heatingPlants.id, { onDelete: 'restrict' }),
    heatingRole: text('heating_role', { enum: HEATING_ROLES }),
    // Fernablesbar und eingebaut am (§ 5 Abs. 2, 3 HeizkostenV); null heißt unbekannt.
    remoteReadable: integer('remote_readable', { mode: 'boolean' }),
    installedOn: text('installed_on'),
  },
  () => [
    // Der Zählertyp verbindet Zähler und Kostenposition (`cost_items.meter_type`). Ein
    // unbekannter Wert fände keine Zähler und ergäbe eine Position ohne Verteilbasis.
    oneOf('meters_type_known', 'type', METER_TYPES),
    oneOf('meters_heating_role_known', 'heating_role', HEATING_ROLES),
    // Ein Zähler der Anlage hat eine Rolle, und nur er (Heizung PR 4).
    check('meters_heating_role_plant_valid', sql.raw('("heating_plant_id" IS NULL) = ("heating_role" IS NULL)')),
    // Ein Zähler der Anlage hängt an keiner Wohnung; die Zähler der Wohnungen gehören zu ihr über
    // die angeschlossenen Wohnungen.
    check('meters_heating_plant_unit_valid', sql.raw('"heating_plant_id" IS NULL OR "unit_id" IS NULL')),
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
    period: text('period').$type<PeriodKey>().notNull(),
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
    // Zugleich Zusicherung und die zweite Abfrage des Schnappschusses: Je Objekt und Zeitraum gibt
    // es höchstens eine abgeschlossene Abrechnung. Vor #92 galt das je Jahr; mit zwei Objekten
    // sperrte das eine sonst das andere.
    uniqueIndex('closed_settlements_property_period_idx').on(t.propertyId, t.period),
    periodKeyCheck('closed_settlements_period_valid', 'period'),
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

// Frühere Abschlüsse (#56, Teil 2). Wird eine abgeschlossene Abrechnung wiedergeöffnet, wandert
// ihr Stand hierher, statt gelöscht zu werden: Er ist das Dokument, das der Mieter bekommen hat,
// und wird gebraucht, sobald eine Korrektur zu begründen ist, dem Mieter wie dem Finanzamt
// gegenüber. Eine eigene Tabelle und keine Spalte an `closed_settlements`, damit dort alles bleibt,
// wie es ist: je Objekt und Zeitraum höchstens ein gültiger Stand, und jeder, der ihn liest, bekommt
// nur diesen.
export const closedSettlementHistory = sqliteTable(
  'closed_settlement_history',
  {
    id: text('id').primaryKey().notNull(),
    propertyId: propertyRef(),
    period: text('period').$type<PeriodKey>().notNull(),
    closedAt: text('closed_at').notNull(),
    sentAt: text('sent_at'),
    // Wann wiedergeöffnet wurde, als Zeitstempel wie `closed_at`.
    reopenedAt: text('reopened_at').notNull(),
    settlement: text('settlement', { mode: 'json' }).notNull(),
  },
  (t) => [
    index('closed_settlement_history_property_period_idx').on(t.propertyId, t.period),
    periodKeyCheck('closed_settlement_history_period_valid', 'period'),
    // Unqualifiziert, aus demselben Grund wie oben.
    check('closed_settlement_history_settlement_is_json', sql.raw('json_valid("settlement")')),
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
    // null heißt „unbekannt“: Ollama meldet selbst, ob das Modell Bilder versteht.
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

// ---------- Angaben zu Belegen (#170) ----------

// Eine Zeile je Datei im Belegordner (`uploads/`). Die Datei selbst bleibt auf der Platte; hier
// steht, was sich ihr nicht zuverlässig ansehen lässt: wie sie beim Hochladen hieß, wann genau
// das war und ihre Prüfsumme, an der ein zweites Hochladen desselben Belegs auffällt.
//
// **Objekt und Jahr nur für den Posteingang.** Ein Beleg, der an einer Position hängt, hat Objekt
// und Jahr seiner Positionen; trüge die Zeile sie ebenfalls, liefen zwei Wahrheiten auseinander,
// sobald jemand eine Position verschiebt. Die Spalten sagen deshalb nur, wohin ein noch nicht
// verknüpfter Beleg gehört. `SET NULL` beim Objekt: Wird es gelöscht (das geht nur leer), fällt
// der Beleg in den Posteingang ohne Objekt zurück, statt mit ihm zu verschwinden.
//
// **Eine fehlende Zeile ist kein Fehler.** Alles, was vor dieser Tabelle hochgeladen wurde, und
// jeder Beleg aus einem Backup einer älteren Version hat keine; die Route beschreibt ihn dann aus
// der Datei (server/src/uploads.ts). Deshalb gibt es auch keinen Fremdschlüssel von
// `cost_items.invoice_file` hierher: Er lehnte genau diese Belege ab.
export const UPLOAD_KINDS = exactly<UploadKind>()(['receipt', 'meterPhoto'] as const)

export const uploads = sqliteTable(
  'uploads',
  {
    file: text('file').primaryKey().notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
    propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
    year: integer('year'),
    invoiceDate: text('invoice_date'),
    // Zählerfotos der Schnellerfassung liegen im selben Ordner, belegen aber keine Kosten.
    kind: text('kind', { enum: UPLOAD_KINDS }).notNull().default('receipt'),
  },
  () => [
    notNegative('uploads_size_not_negative', 'size_bytes'),
    oneOf('uploads_kind_known', 'kind', UPLOAD_KINDS),
    // Ein Jahr 0 oder darunter wäre ein Tippfehler, kein Abrechnungsjahr.
    check('uploads_year_positive', sql.raw('"year" > 0')),
  ],
)

// ---------- Belegbuchung (#170) ----------
//
// **Eine Auswertung je Beleg** (eindeutig über `file`). Wird derselbe Beleg erneut ausgewertet,
// ersetzt die neue Auswertung nur die offenen und verworfenen Zeilen (db/assessments.ts).
//
// **Der Zustand einer Zeile steht nicht in einer Spalte**, er wird aus `cost_item_id`, `booking`
// und `dismissed` abgeleitet. `cost_item_id` ist `SET NULL`: Löscht jemand die Position, ist die
// Zeile von selbst wieder offen, und kein zweites Feld müsste nachgezogen werden. `booking` bleibt
// dann stehen, sagt aber nichts mehr, denn ohne Position ist die Zeile offen.
//
// `property_id` ist `SET NULL` wie bei `uploads`: Ein Objekt wird nur leer gelöscht, und eine
// Auswertung ohne Objekt lässt sich nicht buchen, bis jemand eines wählt.
export const ASSESSMENT_BOOKINGS = exactly<AssessmentBooking>()(['created', 'linked'] as const)
const AMOUNTS_ADJUSTED = exactly<NonNullable<StoredAssessment['amountsAdjusted']>>()(['netto'] as const)

export const assessments = sqliteTable(
  'assessments',
  {
    id: text('id').primaryKey().notNull(),
    file: text('file').notNull(),
    propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
    year: integer('year').notNull(),
    detectedYear: integer('detected_year'),
    // Das gewählte Kalenderjahr: beim Auswerten mitgeschickt, danach das von Hand gesetzte. Es bleibt
    // auch ohne Objekt stehen (Durchsicht von #222, I1): Sonst wäre eine später zugeordnete Auswertung
    // grün, obwohl ihr Beleg aus einem anderen Jahr stammt. Weicht das Jahr der Auswertung davon ab,
    // ist ihre Ampel gelb (Schlussdurchsicht, I1).
    requestedYear: integer('requested_year'),
    // Der gewählte Abrechnungszeitraum (#208), aus dem gewählten Jahr gebildet, sobald es ein Objekt
    // gibt. Nur mit Objekt (G-B7): Ein Zeitraum ist nur am Objekt bestimmt.
    requestedPeriod: text('requested_period').$type<PeriodKey>(),
    vendor: text('vendor'),
    invoiceDate: text('invoice_date'),
    totalGrossCents: integer('total_gross_cents'),
    amountsAdjusted: text('amounts_adjusted', { enum: AMOUNTS_ADJUSTED }),
    laborFromTotal: integer('labor_from_total', { mode: 'boolean' }).notNull().default(false),
    // Hochwassermarke der Zeilennummern: die nächste Nummer, die es in dieser Auswertung noch nie gab.
    nextIdx: integer('next_idx').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('assessments_file_unique').on(t.file),
    // Posteingang und Schnellerfassung fragen die offenen Auswertungen eines Objekts ab.
    index('assessments_property_idx').on(t.propertyId),
    check('assessments_year_positive', sql.raw('"year" > 0')),
    check('assessments_requested_year_positive', sql.raw('"requested_year" IS NULL OR "requested_year" > 0')),
    check('assessments_requested_period_with_property', sql.raw('"requested_period" IS NULL OR "property_id" IS NOT NULL')),
    periodKeyCheck('assessments_requested_period_valid', 'requested_period'),
    notNegative('assessments_next_idx_not_negative', 'next_idx'),
    oneOf('assessments_amounts_adjusted_known', 'amounts_adjusted', AMOUNTS_ADJUSTED),
  ],
)

export const assessmentLines = sqliteTable(
  'assessment_lines',
  {
    assessmentId: text('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    categoryGuessed: integer('category_guessed', { mode: 'boolean' }).notNull().default(false),
    // Ohne Vorzeichenbedingung: Eine Gutschrift ist negativ, wie bei `cost_items.amount_cents`.
    amountCents: integer('amount_cents'),
    labor35aCents: integer('labor_35a_cents'),
    booking: text('booking', { enum: ASSESSMENT_BOOKINGS }),
    costItemId: text('cost_item_id').references(() => costItems.id, { onDelete: 'set null' }),
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
    // Die Zeile kam bei einer erneuten Auswertung dazu, als aus dem Beleg schon Zeilen gebucht waren
    // (Integrationsdurchsicht, H1). Für sie sind die schon gebuchten Positionen dieses Belegs
    // mögliche Doppelungen; für die Zeilen der ersten Auswertung nicht (Frischwasser und Abwasser).
    reassessed: integer('reassessed', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.assessmentId, t.idx] }),
    // Die Summenregel fragt je Position alle Zeilen, die an ihr hängen.
    index('assessment_lines_cost_item_idx').on(t.costItemId),
    notNegative('assessment_lines_idx_not_negative', 'idx'),
    oneOf('assessment_lines_booking_known', 'booking', ASSESSMENT_BOOKINGS),
    // Eine gebuchte Zeile sagt, wie sie gebucht ist.
    check('assessment_lines_booking_complete', sql.raw('"cost_item_id" IS NULL OR "booking" IS NOT NULL')),
  ],
)
