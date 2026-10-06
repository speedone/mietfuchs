// Die Vorgänge auf dem Datenbestand, die die Routen wirklich brauchen, und keiner mehr (#55).
//
// Bis hierher gab es nur „den ganzen Bestand lesen“ und „den ganzen Bestand schreiben“, weil der
// Umstieg nichts anderes braucht. Die Routen brauchen etwas anderes: eine Sammlung auflisten,
// einen Datensatz anlegen, ändern, löschen.
//
// ---------- Drei Entscheidungen bestimmen diese Datei ----------
//
// **1. `PUT` verschmilzt, es ersetzt nicht.** Das ist an der Oberfläche abgelesen und nicht
// angenommen: Stammdaten.tsx schickt beim Auszug nur `{ end: … }`, Abrechnung.tsx beim Ändern
// der gezahlten Vorauszahlungen nur `{ prepaymentOverrides: … }`. Würde die Zeile ersetzt, wären
// danach Name, IBAN, Kaution und alle drei Staffeln weg — ein stiller Datenverlust bei einer
// ganz gewöhnlichen Eingabe. Genau so verhält sich auch die heutige Route über die db.json
// (`Object.assign(item, body, { id })`), und dabei bleibt es.
//
// Verschmolzen wird nach **Anwesenheit** und nicht nach Wert: `{ end: null }` setzt das Ende auf
// null, ein fehlendes `end` lässt es, wie es war. In JSON gibt es kein `undefined`, die
// Anwesenheit eines Schlüssels ist also die einzige Auskunft, die der Browser geben kann.
//
// **2. Die Hauptzeile wird geändert, nicht gelöscht und neu geschrieben.** Gelesen wird nach
// `rowid`, also in der Reihenfolge des Anlegens (siehe read.ts). Ein Löschen und Einfügen schöbe
// den Datensatz ans Ende, und der Vermieter sähe seine Wohnungsliste nach jeder Änderung neu
// sortiert. Die **Untertabellen** dagegen (die drei Staffeln, die Jahreskorrektur, die
// vereinbarten Anteile) werden ganz ersetzt: Ihre Reihenfolge untereinander trägt keine
// Bedeutung, denn der zusammengesetzte Primärschlüssel schließt zwei Einträge zum selben
// Stichtag ohnehin aus.
//
// **3. Für ein unbekanntes Feld gibt es keinen Ort mehr** (#60). Über die db.json übernahm die
// Route jeden Schlüssel des Rumpfes, auch einen erfundenen, und er blieb dort für immer stehen.
// Hier wird Feld für Feld gelesen, mit `typeof` verengt wie im Validator; was nicht vorgesehen
// ist, kommt nicht an. Dass dabei kein **vorgesehenes** Feld vergessen wird, hält ein Test fest,
// der seine Erwartung aus den Spalten des Schemas ableitet: Eine Liste von Hand vergisst der
// nächste, der eine Spalte hinzufügt.

import { and, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { BillingPeriod, CostItem, ExternalBasis, HeatingPrepaymentOverride, Meter, MeterType, Payment, PeriodKey, PeriodRules, PersonEntry, PrepaymentEntry, Property, Reading, RentEntry, SplitPreviewPart, Tenancy, Unit, UnitDependents } from '../../../shared/types.ts'
import { CALENDAR_RULES, calendarPeriod, paymentYear, formatDayRange, isCalendarRules, parsePeriodKey, periodContaining, periodLabel, periodMonths, periodOfKey, periodsBetween, rulesOf, spansTwoYears, startYearOf } from '../../../shared/period.ts'
import { heatingPeriodsEndingIn, isObjectPeriod, plantRules, servesUnit, spanOf } from '../../../shared/heatingPeriod.ts'
import { HEATING_CATEGORY } from '../../../shared/heating.ts'
import { andList } from '../../../shared/wording.ts'
import type { MigratedSettings } from '../ai/settings.ts'
import { lastPerFrom, straightenPersonHistory } from '../schedule.ts'
import { isSplitPart, splitByService } from '../serviceSplit.ts'
import { tenancyStamp } from '../../../shared/tenancyStamp.ts'
import type { Database, Executor } from './client.ts'
import {
  readClosedSettlements, readCostItems, readHeatingPlants, readMeters, readPayments, readProperties, readReadings, readTenancies,
  readUnits, type StoredClosedSettlement,
} from './read.ts'
import {
  aiSlots, assessmentLines, assessments, baseRents, co2Statements, co2TenantReliefs, heatingPeriods, closedHeatingSettlementHistory, closedHeatingSettlements, closedSettlementHistory, closedSettlements, COST_KEYS, COST_MODELS, costItemAmounts, costItemParticipants, costItemSelfAmounts, costItemShares, costItems, DEPOSIT_STATUS, EXTERNAL_MEASURES,
  HEATING_PARTS, HEATING_ROLES, heatingPeriodChanges, heatingPlants, heatingPlantUnits, heatingPrepaymentOverrides, heatingPrepayments, heatingSeparateSpans,
  flatRates, METER_TYPES, meters, payments, periodChanges, personHistory, prepaymentOverrides, prepayments, properties, PROPERTY_KINDS,
  readings, settings, tenancies, unitNoConnection, units, fuelCarryFrozen, fuelDeliveries,
} from './schema.ts'
import { aiSlotRows, settingsRow } from './write.ts'

export type CollectionName = 'units' | 'tenancies' | 'costItems' | 'meters' | 'readings' | 'payments'
export type CollectionEntity = Unit | Tenancy | CostItem | Meter | Reading | Payment

// ---------- Werkzeug für den Rumpf einer Anfrage ----------
//
// Was hereinkommt, ist beliebiges JSON aus einem Browser. Verengt wird ausschließlich mit
// `typeof` und `Reflect.get`, wie im Validator: Ein angeschriebenes Typprädikat wäre nur eine
// Behauptung, deren Rumpf niemand nachrechnet.

// Die Helfer hier lesen auch den Rumpf einer Heizanlage (db/heating.ts) und sind deshalb
// exportiert; heating.ts importiert von hier, nie umgekehrt.
const isObject = (body: unknown): boolean => body !== null && typeof body === 'object'
export const has = (body: unknown, key: string): boolean => isObject(body) && Object.hasOwn(Object(body), key)
export const raw = (body: unknown, key: string): unknown => (isObject(body) ? Reflect.get(Object(body), key) : undefined)

export const asText = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
// `Number.isFinite` schließt NaN und Unendlich aus; beides ergäbe in einer Spalte einen Wert,
// mit dem niemand rechnen kann.
const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const asBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

// Für Felder, die es auch gar nicht geben darf. `null` und ein fehlendes Feld sind dabei
// dasselbe: Beides heißt „nichts eingetragen“, und read.ts gibt für beides `undefined` zurück.
const asOptionalText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const asOptionalBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

// Das offene Mietverhältnis und der Hauptzähler ohne Wohnung: Dort ist `null` ein ausdrücklicher
// Wert und kein fehlendes Feld, deshalb eine eigene Lesart.
export const asNullableText = (value: unknown): string | null => (typeof value === 'string' ? value : null)

// Wie `asNullableText`, aber ein leeres Feld ist keine Angabe (Kennungen, Daten aus einem Formular).
export const asNullableFilled = (value: unknown): string | null => {
  const text = asNullableText(value)
  return text === '' ? null : text
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Nimmt den Wert aus dem Rumpf, wenn der Schlüssel dasteht, sonst den bisherigen.
export function merged<T>(body: unknown, key: string, current: T, read: (value: unknown) => T): T {
  return has(body, key) ? read(raw(body, key)) : current
}

// ---------- Die Staffeln ----------

// Eine Staffel ist eine Liste aus Stichtag und Wert. Steht im Rumpf etwas anderes als eine
// Liste, gilt sie als leer; ein Eintrag ohne brauchbaren Stichtag fällt weg, denn ohne ihn
// wüsste die Berechnung nicht, ab wann er gilt.
//
// **Zwei Einträge zum selben Stichtag werden angenommen, und es gilt der letzte**
// (`lastPerFrom`). Das ist kein Entgegenkommen, sondern die Regel, die legacy/migrate.ts beim Umstieg
// und calc.ts beim Rechnen ohnehin anwenden; sie steht deshalb in schedule.ts und hier nicht
// noch einmal. Ohne sie wäre eine ganz gewöhnliche Eingabe ein Fehler: Stammdaten.tsx setzt für
// eine Staffelzeile ohne Monat den Einzugsmonat ein und prüft nie auf Doppelung, und der
// Stichtag ist in der Datenbank Teil des Primärschlüssels. Der Vermieter bekäme für zwei so
// ausgefüllte Zeilen einen Fehler statt eines gespeicherten Mietverhältnisses, wo die db.json
// es klaglos annahm.
function readEntries<T>(value: unknown, entry: (row: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  const rows: T[] = []
  for (const row of value) {
    const gelesen = entry(row)
    if (gelesen !== null) rows.push(gelesen)
  }
  return rows
}

// Vorauszahlung und Kaltmiete: Es gilt der letzte.
const readSchedule = <T extends { from: string }>(value: unknown, entry: (row: unknown) => T | null): T[] =>
  lastPerFrom(readEntries(value, entry))

// **Die Personen-Staffel bekommt ihre eigene Regel**, und dafür braucht sie den Einzugstag:
// „es gilt der letzte“ würde hier Personentage verschieben, weil die erste Stufe ab Einzug gilt.
// Die Begründung steht in schedule.ts und ist nachgemessen.
const readPersonHistory = (value: unknown, start: string): PersonEntry[] =>
  straightenPersonHistory(readEntries(value, personEntry), start)

const personEntry = (row: unknown): PersonEntry | null => {
  const from = asOptionalText(raw(row, 'from'))
  return from === undefined ? null : { from, persons: asNumber(raw(row, 'persons'), 1) }
}
const moneyEntry = (row: unknown): PrepaymentEntry | null => {
  const from = asOptionalText(raw(row, 'from'))
  return from === undefined ? null : { from, monthlyCents: asNumber(raw(row, 'monthlyCents'), 0) }
}

// Jahreskorrektur: Zeitraumschlüssel ('JJJJ-MM') auf Betrag (#208). Ein Tab von vor dem Update
// schickt noch die nackte Jahreszahl („2024“); sie ist der Kalenderzeitraum 'JJJJ-01' und geht
// einem gleichzeitig mitgeschickten 'JJJJ-01' vor, denn nur ein alter Tab schreibt sie, und dann
// ist sie seine Eingabe. Ob das Objekt diesen Zeitraum hat, prüft `guardTenancy`.
//
// **Verlangt wird genau eine dieser beiden Formen**; für die Jahreszahl gilt dieselbe Grenze, die
// der Validator beim Umstieg zieht. `Number.isInteger(Number(…))` genügte nicht und war zweifach undicht: `Number('')`
// und `Number(' ')` sind 0, ein leerer Schlüssel ergäbe also eine Jahreskorrektur für das Jahr 0.
// Und zwei verschiedene Schlüssel können auf dieselbe Zahl führen („2024“ und „2024.0“), womit
// der zusammengesetzte Primärschlüssel den ganzen Vorgang scheitern ließe: Das Mietverhältnis
// wäre dann überhaupt nicht zu speichern.
const YEAR_KEY = /^\d{4}$/

function readOverrides(value: unknown): Record<string, number> {
  if (!isObject(value)) return {}
  const rows: Record<string, number> = {}
  const legacy: Record<string, number> = {}
  for (const [schluessel, betrag] of Object.entries(Object(value))) {
    const zahl = asOptionalNumber(betrag)
    if (zahl === undefined) continue
    if (YEAR_KEY.test(schluessel)) {
      legacy[calendarPeriod(Number(schluessel))] = zahl
      continue
    }
    const key = parsePeriodKey(schluessel)
    if (key !== null) rows[key] = zahl
  }
  // Schickt der Tab Jahreszahlen, gilt sein Stand vollständig für die Kalenderzeiträume (Durchsicht
  // von #222, M1): Ein 'JJJJ-01' daneben hat er so vom Server bekommen und nicht gemeint, und ein
  // Kalenderzeitraum ohne Jahreszahl ist gelöscht. Sonst bliebe eine zurückgesetzte Korrektur stehen,
  // und die Oberfläche meldete trotzdem „zurückgesetzt“.
  if (Object.keys(legacy).length === 0) return rows
  const others = Object.fromEntries(Object.entries(rows).filter(([key]) => !key.endsWith('-01')))
  return { ...others, ...legacy }
}

// Die Korrekturen der Heizvorauszahlung (Heizung PR 5, D2): je Anlage und Heizperiode eine, die
// letzte gilt. Eine vorläufige trägt ihre Monate; ob sie zur Heizperiode passen, prüft
// `guardHeatingOverrides`. Ein Eintrag ohne Anlage, Schlüssel oder Betrag fällt weg.
function readHeatingOverrides(value: unknown): HeatingPrepaymentOverride[] | undefined {
  if (value === null) return undefined
  if (!Array.isArray(value)) return []
  const byKey = new Map<string, HeatingPrepaymentOverride>()
  for (const row of value) {
    const plantId = asNullableFilled(raw(row, 'plantId'))
    const period = parsePeriodKey(raw(row, 'period'))
    const cents = asOptionalNumber(raw(row, 'cents'))
    if (plantId === null || period === null || cents === undefined) continue
    const provisional = raw(row, 'provisional') === true
    byKey.set(`${plantId}|${period}`, {
      plantId, period, cents, provisional,
      fromMonth: provisional ? parsePeriodKey(raw(row, 'fromMonth')) : null,
      toMonth: provisional ? parsePeriodKey(raw(row, 'toMonth')) : null,
    })
  }
  return [...byKey.values()]
}

// Wohnungs-Kennung zu Prozentanteil. Ein Anteil, der keine Zahl ist, fällt weg.
function readShares(value: unknown): Record<string, number> {
  if (!isObject(value)) return {}
  const rows: Record<string, number> = {}
  for (const [unitId, anteil] of Object.entries(Object(value))) {
    const zahl = asOptionalNumber(anteil)
    if (zahl !== undefined) rows[unitId] = zahl
  }
  return rows
}

// Die Teilnehmer einer Kostenposition (#94): eine Liste von Wohnungs-Kennungen, ohne Doppel.
function readParticipants(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))]
}

// Einzelbeträge je Mietverhältnis (#94). Ganze Cent; ein negativer bleibt stehen und wird von
// der Datenbank abgewiesen, damit der Nutzer die Meldung dazu bekommt statt eines still
// verschwundenen Betrags.
function readAmounts(value: unknown): Record<string, number> {
  if (!isObject(value)) return {}
  const rows: Record<string, number> = {}
  for (const [tenancyId, betrag] of Object.entries(Object(value))) {
    const zahl = asOptionalNumber(betrag)
    if (zahl !== undefined && Number.isInteger(zahl)) rows[tenancyId] = zahl
  }
  return rows
}

// Die Angaben der Gemeinschaft (#94). Unvollständig heißt: keine Angabe; die Zahlen prüft die
// Datenbank (Summe der Anlage größer null).
function readExternalBasis(value: unknown): ExternalBasis | null {
  const measure = oneOfOrUndefined(EXTERNAL_MEASURES, raw(value, 'measure'))
  const total = asOptionalNumber(raw(value, 'total'))
  const totalCents = asOptionalNumber(raw(value, 'totalCents'))
  if (!measure || total === undefined || totalCents === undefined || !Number.isInteger(totalCents)) return null
  return { measure, total, totalCents }
}

// Die Aufzählungen kommen aus schema.ts und stehen nicht noch einmal daneben. Beim ersten
// Entwurf standen sie hier abgeschrieben, und drei der Listen waren falsch: „sonstiges“ statt
// „sonstig“, ein erfundenes „warmwasser“, ein fehlendes „teilweise“. Der Übersetzer hat es
// gemeldet, aber genau dafür gibt es die eine Quelle; eine zweite Liste ist immer eine, die
// irgendwann abweicht.
//
// Ein unbekannter Wert wird zu „nichts eingetragen“ statt zu einem Fehler: Die Spalte ließe ihn
// ohnehin nicht zu, und die Prüfbedingung meldete ihn dann als technischen Befund, wo ein leeres
// Feld die ehrlichere Antwort ist.
export const oneOfOrUndefined = <T extends string>(known: readonly T[], value: unknown): T | undefined => {
  const text = asOptionalText(value)
  return known.find((eintrag) => eintrag === text)
}

// ---------- Je Sammlung eine Verschmelzung ----------
//
// Die Gegenrichtung zu den Lesern in read.ts, und wie sie eine benannte Funktion je Sammlung.

// Das Objekt einer Wurzel. Gesetzt wird es beim Anlegen von der Route; ob ein Wechsel erlaubt
// ist und ob ein Verweis dabei über die Objektgrenze zeigte, entscheidet `sameProperty` unten.
const mergedProperty = (body: unknown, current: string): string => merged(body, 'propertyId', current, (v) => asText(v, current))

function mergeUnit(current: Unit, body: unknown): Unit {
  return {
    id: current.id,
    propertyId: mergedProperty(body, current.propertyId),
    name: merged(body, 'name', current.name, (v) => asText(v, '')),
    areaM2: merged(body, 'areaM2', current.areaM2, (v) => asNumber(v, 0)),
    // `typeof v === 'boolean'` und nicht `!!v`: In JavaScript wäre die Zeichenkette „false“ wahr.
    participates: merged(body, 'participates', current.participates, (v) => asBoolean(v, false)),
    selfUsed: merged(body, 'selfUsed', current.selfUsed, asOptionalBoolean),
    selfPersons: merged(body, 'selfPersons', current.selfPersons, asOptionalNumber),
    mea: merged(body, 'mea', current.mea, asOptionalNumber),
    // Nur bekannte Zählertypen, jeder einmal (#117).
    noConnection: merged(body, 'noConnection', current.noConnection, (v) => (Array.isArray(v) ? [...new Set(v.filter((x): x is MeterType => oneOfOrUndefined(METER_TYPES, x) !== undefined))] : undefined)),
    rooms: merged(body, 'rooms', current.rooms, asOptionalNumber),
    floor: merged(body, 'floor', current.floor, asOptionalText),
    notes: merged(body, 'notes', current.notes, asOptionalText),
  }
}

function mergeTenancy(current: Tenancy, body: unknown): Tenancy {
  // Der Einzugstag zuerst: Die Personen-Staffel wird gegen ihn geradegerückt, und im selben
  // Rumpf kann beides stehen.
  const start = merged(body, 'start', current.start, (v) => asText(v, ''))
  return {
    id: current.id,
    unitId: merged(body, 'unitId', current.unitId, (v) => asText(v, '')),
    tenantName: merged(body, 'tenantName', current.tenantName, (v) => asText(v, '')),
    persons: merged(body, 'persons', current.persons, (v) => asNumber(v, 1)),
    personHistory: merged(body, 'personHistory', current.personHistory, (v) => readPersonHistory(v, start)),
    start,
    end: merged(body, 'end', current.end, asNullableText),
    prepayments: merged(body, 'prepayments', current.prepayments, (v) => readSchedule<PrepaymentEntry>(v, moneyEntry)),
    flatRates: merged(body, 'flatRates', current.flatRates, (v) => (v === null ? undefined : readSchedule<PrepaymentEntry>(v, moneyEntry))),
    // Heizstaffel und Heizkorrekturen (Heizung PR 5): wie die Pauschale ganz ersetzt.
    heatingPrepayments: merged(body, 'heatingPrepayments', current.heatingPrepayments, (v) => (v === null ? undefined : readSchedule<PrepaymentEntry>(v, moneyEntry))),
    heatingPrepaymentOverrides: merged(body, 'heatingPrepaymentOverrides', current.heatingPrepaymentOverrides, readHeatingOverrides),
    prepaymentOverrides: merged(body, 'prepaymentOverrides', current.prepaymentOverrides, readOverrides),
    baseRents: merged(body, 'baseRents', current.baseRents, (v) => readSchedule<RentEntry>(v, moneyEntry)),
    email: merged(body, 'email', current.email, asOptionalText),
    phone: merged(body, 'phone', current.phone, asOptionalText),
    correspondenceAddress: merged(body, 'correspondenceAddress', current.correspondenceAddress, asOptionalText),
    iban: merged(body, 'iban', current.iban, asOptionalText),
    contractDate: merged(body, 'contractDate', current.contractDate, asOptionalText),
    depositCents: merged(body, 'depositCents', current.depositCents, asOptionalNumber),
    depositStatus: merged(body, 'depositStatus', current.depositStatus, (v) => oneOfOrUndefined(DEPOSIT_STATUS, v)),
    // Nebenkostenmodell (#93): ein unbekannter Wert heißt wie null die Abrechnung.
    costModel: merged(body, 'costModel', current.costModel, (v) => oneOfOrUndefined(COST_MODELS, v)),
    heatingModel: merged(body, 'heatingModel', current.heatingModel, (v) => oneOfOrUndefined(COST_MODELS, v)),
    notes: merged(body, 'notes', current.notes, asOptionalText),
  }
}

// Der Zeitraum einer Kostenposition (#208). `period` geht vor; ein Tab von vor dem Update schickt
// stattdessen `year`, und das ist der Kalenderzeitraum dieses Jahres. Ob das Objekt den Zeitraum
// hat, prüft `guardCostItem`. Ein ungültiger Zeitraum wird abgelehnt und nicht still durch den
// bisherigen ersetzt (Durchsicht von #222, M3): Gespeichert wäre dann etwas anderes als geschickt.
function mergedPeriod(body: unknown, current: PeriodKey): PeriodKey {
  if (has(body, 'period')) {
    const key = parsePeriodKey(raw(body, 'period'))
    if (key === null) throw new PeriodError('Ungültiger Zeitraum: erwartet wird der Monat des Beginns als JJJJ-MM, etwa 2025-05.')
    return key
  }
  const year = raw(body, 'year')
  return typeof year === 'number' && Number.isInteger(year) && year > 0 && year < 10000 ? calendarPeriod(year) : current
}

function mergeCostItem(current: CostItem, body: unknown): CostItem {
  const period = mergedPeriod(body, current.period)
  const shares = merged(body, 'customShares', current.customShares, (v) => (v === null ? null : readShares(v)))
  const participants = merged(body, 'participantUnitIds', current.participantUnitIds, (v) => (v === null ? null : readParticipants(v)))
  const external = merged(body, 'externalBasis', current.externalBasis, readExternalBasis)
  const amounts = merged(body, 'tenancyAmounts', current.tenancyAmounts, (v) => (v === null ? null : readAmounts(v)))
  const selfAmounts = merged(body, 'selfAmounts', current.selfAmounts, (v) => (v === null ? null : readAmounts(v)))
  const category = merged(body, 'category', current.category, (v) => asText(v, ''))
  return {
    id: current.id,
    propertyId: mergedProperty(body, current.propertyId),
    period,
    category,
    description: merged(body, 'description', current.description, (v) => asText(v, '')),
    vendor: merged(body, 'vendor', current.vendor, asOptionalText),
    amountCents: merged(body, 'amountCents', current.amountCents, (v) => asNumber(v, 0)),
    key: merged(body, 'key', current.key, (v) => oneOfOrUndefined(COST_KEYS, v) ?? current.key),
    // `null` ist hier ein ausdrücklicher Wert: Beim Wechsel des Umlageschlüssels wird die
    // Direktzuordnung bewusst zurückgesetzt (siehe saveItem in Kosten.tsx).
    directUnitId: merged(body, 'directUnitId', current.directUnitId, asNullableText),
    meterType: merged(body, 'meterType', current.meterType, (v) => oneOfOrUndefined(METER_TYPES, v) ?? null),
    // Das Feld nur, wenn es eines gibt: Ein `customShares: undefined` neben einer Position ohne
    // vereinbarte Anteile wäre ein Feld, das vorher nicht dastand.
    ...(shares === undefined ? {} : { customShares: shares }),
    ...(participants === undefined ? {} : { participantUnitIds: participants }),
    ...(external === undefined ? {} : { externalBasis: external }),
    ...(amounts === undefined ? {} : { tenancyAmounts: amounts }),
    ...(selfAmounts === undefined ? {} : { selfAmounts }),
    labor35aCents: merged(body, 'labor35aCents', current.labor35aCents, asOptionalNumber),
    invoiceFile: merged(body, 'invoiceFile', current.invoiceFile, asOptionalText),
    // `null` leert, wie bei den übrigen optionalen Feldern (#208).
    serviceFrom: merged(body, 'serviceFrom', current.serviceFrom, asOptionalText),
    serviceTo: merged(body, 'serviceTo', current.serviceTo, asOptionalText),
    taxYear: merged(body, 'taxYear', current.taxYear, asOptionalNumber),
    heatingPart: merged(body, 'heatingPart', current.heatingPart, (v) => oneOfOrUndefined(HEATING_PARTS, v)),
    // Die Heizanlage der Position (Heizung PR 4). Nur die Kostenart Heizung und Warmwasser gehört zu
    // einer Anlage; wechselt die Kostenart, fällt die Anlage weg. `undefined` heißt „nicht
    // angegeben“: bei einer neuen Position und bei einer, die gerade zur Heizposition wird
    // (Durchsicht von #230). Dann setzen `insert` und `replace` die Anlage des Objekts
    // (`defaultHeatingPlant`); eine Heizposition, die schon eine Kostenart Heizung hatte, behält ihre.
    heatingPlantId: category !== HEATING_CATEGORY
      ? null
      : has(body, 'heatingPlantId')
        ? asNullableFilled(raw(body, 'heatingPlantId'))
        : current.category === HEATING_CATEGORY ? (current.heatingPlantId ?? null) : undefined,
    // Die Lieferung (Heizung PR 7); `null` löst die Verknüpfung.
    fuelDeliveryId: merged(body, 'fuelDeliveryId', current.fuelDeliveryId, asNullableFilled),
  }
}

function mergeMeter(current: Meter, body: unknown): Meter {
  const heatingPlantId = merged(body, 'heatingPlantId', current.heatingPlantId ?? null, asNullableFilled)
  return {
    id: current.id,
    propertyId: mergedProperty(body, current.propertyId),
    name: merged(body, 'name', current.name, (v) => asText(v, '')),
    // `null` heißt Hauptzähler für das ganze Haus; eine leere Kennung liest die Abrechnung
    // schon heute genauso (`m.unitId && …`).
    unitId: merged(body, 'unitId', current.unitId, (v) => (asNullableText(v) === '' ? null : asNullableText(v))),
    type: merged(body, 'type', current.type, (v) => oneOfOrUndefined(METER_TYPES, v) ?? current.type),
    meterNumber: merged(body, 'meterNumber', current.meterNumber, asOptionalText),
    unit: merged(body, 'unit', current.unit, (v) => asText(v, '')),
    // Zähler der Heizanlage selbst (Heizung PR 4). Ohne Anlage keine Rolle.
    heatingPlantId,
    heatingRole: heatingPlantId === null ? null : merged(body, 'heatingRole', current.heatingRole ?? null, (v) => oneOfOrUndefined(HEATING_ROLES, v) ?? null),
    // Fernablesbar und eingebaut am (§ 5 Abs. 2, 3 HeizkostenV); `null` heißt unbekannt.
    remoteReadable: merged(body, 'remoteReadable', current.remoteReadable ?? null, (v) => (typeof v === 'boolean' ? v : null)),
    installedOn: merged(body, 'installedOn', current.installedOn ?? null, asNullableFilled),
  }
}

function mergeReading(current: Reading, body: unknown): Reading {
  return {
    id: current.id,
    meterId: merged(body, 'meterId', current.meterId, (v) => asText(v, '')),
    date: merged(body, 'date', current.date, (v) => asText(v, '')),
    value: merged(body, 'value', current.value, (v) => asNumber(v, 0)),
    replacement: merged(body, 'replacement', current.replacement, asOptionalBoolean),
    oldEndValue: merged(body, 'oldEndValue', current.oldEndValue, asOptionalNumber),
    note: merged(body, 'note', current.note, asOptionalText),
  }
}

function mergePayment(current: Payment, body: unknown): Payment {
  return {
    id: current.id,
    tenancyId: merged(body, 'tenancyId', current.tenancyId, (v) => asText(v, '')),
    date: merged(body, 'date', current.date, (v) => asText(v, '')),
    amountCents: merged(body, 'amountCents', current.amountCents, (v) => asNumber(v, 0)),
    note: merged(body, 'note', current.note, asOptionalText),
  }
}

// Ein frisch angelegter Datensatz ist ein leerer, in den derselbe Rumpf verschmolzen wird. Damit
// gibt es Anlegen und Ändern nur einmal, und ein Feld, das beim Anlegen anders behandelt würde
// als beim Ändern, kann gar nicht erst entstehen.
// Ein leeres Objekt (`''`) gibt es nicht; ohne `propertyId` im Rumpf scheitert das Anlegen am
// Fremdschlüssel. Die Route setzt es deshalb immer (index.ts, `propertyOf`).
const emptyUnit = (id: string): Unit => ({ id, propertyId: '', name: '', areaM2: 0, participates: false })
const emptyTenancy = (id: string): Tenancy => ({
  id, unitId: '', tenantName: '', persons: 1, personHistory: [], start: '', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const emptyCostItem = (id: string): CostItem => ({
  id, propertyId: '', period: calendarPeriod(new Date().getUTCFullYear()), category: '', description: '', amountCents: 0, key: 'area',
  directUnitId: null, meterType: null,
})
const emptyMeter = (id: string): Meter => ({ id, propertyId: '', name: '', unitId: null, type: 'sonstig', unit: '' })
const emptyReading = (id: string): Reading => ({ id, meterId: '', date: '', value: 0 })
const emptyPayment = (id: string): Payment => ({ id, tenancyId: '', date: '', amountCents: 0 })

// ---------- Die Grenze zwischen den Objekten (#92) ----------
//
// Ein Zähler, eine Direktzuordnung oder ein vereinbarter Anteil darf nicht auf die Wohnung eines
// anderen Objekts zeigen: Die Berechnung sähe sie nicht (`narrowToProperty`), und die Rechnung
// fiele still dem Vermieter zu oder verschwände aus dem falschen Haus. Zusammengesetzte
// Fremdschlüssel scheiden als Zusicherung aus, weil `direct_unit_id` mit `ON DELETE SET NULL`
// alle Spalten des Schlüssels leeren würde, auch das Pflichtfeld `property_id`. Deshalb steht
// die Prüfung hier, vor jedem Schreiben, und `crossPropertyViolations` fragt denselben Befund
// über den ganzen Bestand ab (Wiederherstellen eines Backups).

export class CrossPropertyError extends Error {
  status = 400
}

// Ein Zeitraum, den es für das Objekt nicht gibt, oder die Jahreszahl eines alten Tabs bei einem
// Objekt mit eigenem Rhythmus (#208). Die Meldung ist für den Nutzer geschrieben; die Route gibt
// sie mit 400 weiter wie `CrossPropertyError`.
export class PeriodError extends Error {
  status = 400
}

// Eine Ablehnung rund um die Heizanlage (Heizung PR 4): 400, wenn eine Angabe nicht passt oder eine
// Funktion erst mit einer späteren Version kommt; 409, wenn sich der Bestand inzwischen geändert hat
// oder ein abgeschlossener Zeitraum betroffen ist. Die Meldung ist für den Nutzer geschrieben; die
// Route gibt sie weiter wie `CrossPropertyError`.
export class HeatingError extends Error {
  status: 400 | 409
  constructor(status: 400 | 409, message: string) {
    super(message)
    this.status = status
  }
}

const PLANT_GONE = 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.'

// Nach Heizkostenverteilern verteilt Mietfuchs erst mit deren Bewertungsfaktoren (PR 12); rohe
// Einheiten verschiedener Heizkörper sind nicht vergleichbar.
const HKV_KEY =
  'Nach Heizkostenverteilern verteilt Mietfuchs noch nicht selbst; dafür braucht es die Bewertungsfaktoren der Geräte, und die kommen mit einer späteren Version. ' +
  'Übernehmen Sie bis dahin die Abrechnung des Messdienstes als Einzelbeträge (Schlüssel „Einzelbeträge“).'

async function plantOf(db: Executor, plantId: string): Promise<{ propertyId: string } | undefined> {
  return (await db.select({ propertyId: heatingPlants.propertyId }).from(heatingPlants).where(eq(heatingPlants.id, plantId)))[0]
}

async function isPeriodClosed(db: Executor, propertyId: string, period: CostItem['period']): Promise<boolean> {
  const rows = await db.select({ id: closedSettlements.id }).from(closedSettlements)
    .where(and(eq(closedSettlements.propertyId, propertyId), eq(closedSettlements.period, period)))
  return rows.length > 0
}

// Ist der Zeitraum einer Position abgeschlossen? Bei einer Heizposition mit eigener Heizperiode
// (Heizung PR 5): ihre Heizkostenabrechnung (Weg d) oder die Abrechnung, in der ihre Heizperiode endet.
export async function itemPeriodClosed(db: Executor, c: CostItem): Promise<boolean> {
  const heating = c.heatingPlantId ? await heatingRulesOf(db, c.heatingPlantId) : null
  if (!heating?.own || !c.heatingPlantId) return isPeriodClosed(db, c.propertyId, c.period)
  const h = periodOfKey(heating.rules, c.period)
  if (h === null) return false
  const zu = await db.select({ id: closedHeatingSettlements.id }).from(closedHeatingSettlements)
    .where(and(eq(closedHeatingSettlements.plantId, c.heatingPlantId), eq(closedHeatingSettlements.period, c.period)))
  if (zu.length > 0) return true
  return isPeriodClosed(db, c.propertyId, periodContaining(await rulesForProperty(db, c.propertyId), h.to).key)
}

// Die Heizperiode einer Anlage an einem Tag und ob sie abgeschlossen ist (Heizung PR 7): mit ihrer
// Heizkostenabrechnung nach Weg d oder mit der Abrechnung des Objektzeitraums, in dem sie endet (W1,
// B3), dieselbe Regel wie `itemPeriodClosed`. Gefragt wird in der laufenden Transaktion, deshalb
// unmittelbar an den Tabellen.
export async function heatingPeriodAt(db: Executor, plantId: string, date: string): Promise<{ period: BillingPeriod; closed: boolean } | null> {
  const heating = await heatingRulesOf(db, plantId)
  if (!heating) return null
  const h = periodContaining(heating.rules, date)
  if (!heating.own) return { period: h, closed: await isPeriodClosed(db, heating.propertyId, h.key) }
  const zu = await db.select({ id: closedHeatingSettlements.id }).from(closedHeatingSettlements)
    .where(and(eq(closedHeatingSettlements.plantId, plantId), eq(closedHeatingSettlements.period, h.key)))
  if (zu.length > 0) return { period: h, closed: true }
  return { period: h, closed: await isPeriodClosed(db, heating.propertyId, periodContaining(await rulesForProperty(db, heating.propertyId), h.to).key) }
}

// Hat die Heizperiode nach der, in die `date` fällt, beim Abschluss ihren Anfangsbestand aus dieser
// übernommen (Heizung PR 8, Durchsicht von #237, C2)? Dann gibt diese Heizperiode genau den
// eingefrorenen Bestand weiter, und Menge, Einheit, Lieferdatum und Verknüpfungen ihrer Lieferungen
// bleiben; Beträge dürfen sich ändern. Gibt die Bezeichnung der Folgeperiode zurück, sonst `null`.
export async function stockTakenOverBy(db: Executor, plantId: string, date: string): Promise<{ label: string } | null> {
  const heating = await heatingRulesOf(db, plantId)
  if (!heating) return null
  const h = periodContaining(heating.rules, date)
  const next = periodContaining(heating.rules, dayAfterIso(h.to))
  const [zu] = await db.select({ settlement: closedHeatingSettlements.settlement }).from(closedHeatingSettlements)
    .where(and(eq(closedHeatingSettlements.plantId, plantId), eq(closedHeatingSettlements.period, next.key)))
  let settlement: unknown = zu?.settlement
  if (settlement === undefined) {
    const p = periodContaining(await rulesForProperty(db, heating.propertyId), next.to)
    const [gesamt] = await db.select({ settlement: closedSettlements.settlement }).from(closedSettlements)
      .where(and(eq(closedSettlements.propertyId, heating.propertyId), eq(closedSettlements.period, p.key)))
    settlement = gesamt?.settlement
  }
  const list: unknown = settlement !== null && typeof settlement === 'object' ? Reflect.get(settlement, 'heating') : undefined
  if (!Array.isArray(list)) return null
  const took = list.some((x: unknown) => {
    if (x === null || typeof x !== 'object' || Reflect.get(x, 'plantId') !== plantId || Reflect.get(x, 'period') !== next.key) return false
    const stock: unknown = Reflect.get(x, 'stock')
    return stock !== null && typeof stock === 'object' && Reflect.get(stock, 'openingSource') !== 'own'
  })
  return took ? { label: periodLabel(next) } : null
}
const dayAfterIso = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
export const stockTakenOverText = (label: string, what: string): string =>
  `Die abgeschlossene Heizperiode ${label} hat den Endbestand dieser Heizperiode als Anfangsbestand übernommen; ${what} lassen sich deshalb nicht mehr ändern, Beträge schon. Öffnen Sie die Abrechnung ${label} wieder, um etwas zu ändern.`

// Ablesungen des Versorgungszählers einer Heizanlage mit Datum in einer abgeschlossenen Heizperiode
// sind gesperrt (Heizung PR 7, A10): Die Abgrenzung der Lieferungen dieser Heizperiode ist
// eingefroren, und ein später erfasster Stand änderte nur noch die Rechnung danach (8.2 Fall d).
async function guardSupplyReading(db: Executor, reading: Pick<Reading, 'meterId' | 'date'>): Promise<void> {
  const [m] = await db.select({ plantId: meters.heatingPlantId, role: meters.heatingRole }).from(meters).where(eq(meters.id, reading.meterId))
  if (!m || m.plantId === null || m.role !== 'supply') return
  const at = await heatingPeriodAt(db, m.plantId, reading.date)
  if (at?.closed) {
    throw new HeatingError(409,
      `Die Heizperiode ${periodLabel(at.period)} ist abgeschlossen; Ablesungen des Versorgungszählers mit einem Datum darin lassen sich nicht mehr ändern, denn die Aufteilung der Rechnungen ist eingefroren. Öffnen Sie die Abrechnung wieder, um etwas zu ändern.`)
  }
}

async function guardReading(db: Executor, before: Reading | null, after: Reading): Promise<void> {
  if (before) await guardSupplyReading(db, before)
  await guardSupplyReading(db, after)
}

// Die Lieferung einer Position (Heizung PR 7, Entwurf 5.4): nur bei der Kostenart Heizung, nur eine
// echte Lieferung der eigenen Anlage mit freien Schlüsseln, und die Position steht in der
// Heizperiode, die das Ende der Rechnung enthält. Sonst stünde die Rechnung in einer Heizperiode, in
// die sie nicht gehört, und ihr Teil liefe in die falsche Richtung (N1).
// Der Satz, wenn ein Teil einer Lieferung in einer abgeschlossenen Heizperiode eingefroren ist (db/fuel.ts
// nimmt ihn von hier, denn repository.ts kennt db/fuel.ts nicht).
export const frozenDeliveryText = (label: string): string =>
  `Ein Teil der Lieferung „${label}“ ist in einer abgeschlossenen Heizperiode eingefroren; Mengen, Zeiträume und Beträge lassen sich deshalb nicht mehr ändern, und ihre Positionen bleiben mit ihr verknüpft. Öffnen Sie die Abrechnung dieser Heizperiode wieder, um etwas zu ändern.`

// Hat eine abgeschlossene Heizperiode einen Teil der Lieferung herein- oder hinausgebucht (nicht 0)?
// Dann hängt an ihren Positionen Geld, das schon verteilt ist (Durchsicht von #233, I2). Eine 0 heißt:
// Beim Abschluss hatte die Lieferung noch keine Position; dann ist Verknüpfen ungefährlich, die
// Abrechnung trägt den Teil dieser Heizperiode beim Vermieter (I1).
async function frozenDeliveryLabel(db: Executor, deliveryId: string): Promise<string | null> {
  const rows = await db.select({ cents: fuelCarryFrozen.cents }).from(fuelCarryFrozen).where(eq(fuelCarryFrozen.deliveryId, deliveryId))
  if (!rows.some((r) => r.cents !== 0)) return null
  const [d] = await db.select({ label: fuelDeliveries.label }).from(fuelDeliveries).where(eq(fuelDeliveries.id, deliveryId))
  return d?.label || 'Lieferung'
}

// Lösen, Umhängen, Verschieben in eine andere Heizperiode und Löschen einer Position, deren Lieferung
// einen eingefrorenen Teil hat, verteilte dieselbe Rechnung doppelt (Durchsicht I2: 9.210,22 € für
// 6.500,00 €); ebenso eine weitere Position an einer solchen Lieferung.
// Nachprüfung (I-b): Gesperrt ist nur, was die letzte Position der Lieferung wegnähme; eine weitere
// Position (Abschlag, Gutschrift, Schlussrechnung) ist erlaubt, und solange eine bleibt, darf eine
// andere gelöst oder gelöscht werden. Die Heizperiode, die den Teil abgeschlossen hat, bleibt bei
// ihrem eingefrorenen Wert, und die verbleibenden Positionen buchen ihn weiter hinaus.
async function guardFrozenLink(db: Executor, before: Pick<CostItem, 'id' | 'fuelDeliveryId' | 'period'> | null, after: Pick<CostItem, 'fuelDeliveryId' | 'period'> | null): Promise<void> {
  const was = before?.fuelDeliveryId ?? null
  if (!before || !was) return
  if (after !== null && after.fuelDeliveryId === was && after.period === before.period) return
  const label = await frozenDeliveryLabel(db, was)
  if (!label) return
  const [others] = await db.select({ n: count() }).from(costItems).where(and(eq(costItems.fuelDeliveryId, was), ne(costItems.id, before.id)))
  if ((others?.n ?? 0) > 0) return
  throw new HeatingError(409,
    `Ein Teil der Lieferung „${label}“ ist in einer abgeschlossenen Heizperiode eingefroren, und dies ist ihre letzte Position. Ohne sie stünde dieser Teil doppelt in den Abrechnungen; die Position bleibt deshalb mit der Lieferung verknüpft. ` +
      'Öffnen Sie die Abrechnung der abgeschlossenen Heizperiode wieder, um etwas zu ändern.')
}

async function guardFuelLink(db: Executor, before: CostItem | null, after: CostItem): Promise<void> {
  await guardFrozenLink(db, before, after)
  // Vorrat (C2): Lösen oder Umhängen einer Position, deren Lieferung die abgeschlossene Folgeperiode
  // übernommen hat, änderte den weitergegebenen Bestand.
  // Eine neue Position an der Lieferung ändert nur den Betrag und bleibt erlaubt.
  for (const id of [before?.fuelDeliveryId ?? null]) {
    if (!id || id === (after.fuelDeliveryId ?? null)) continue
    const [d] = await db.select({ plantId: fuelDeliveries.plantId, deliveredAt: fuelDeliveries.deliveredAt, invoiceTo: fuelDeliveries.invoiceTo }).from(fuelDeliveries).where(eq(fuelDeliveries.id, id))
    if (!d || d.invoiceTo !== null || d.deliveredAt === null) continue
    const took = await stockTakenOverBy(db, d.plantId, d.deliveredAt)
    if (took) throw new HeatingError(409, stockTakenOverText(took.label, 'die Verknüpfungen ihrer Lieferungen'))
  }
  if (!after.fuelDeliveryId) return
  if (after.category !== HEATING_CATEGORY) {
    throw new HeatingError(400, `Eine Lieferung gehört nur zu einer Position der Kostenart „${HEATING_CATEGORY}“.`)
  }
  // Der Teil einer anderen Heizperiode folgt dem Schlüssel der Position; Einzelbeträge gelten für die
  // ganze Position und kommen vom Messdienst, nicht aus der Rechnung des Versorgers.
  if (after.key === 'amounts') {
    throw new HeatingError(400, 'Eine Rechnung des Versorgers verteilen Sie nach einem Schlüssel, nicht als Einzelbeträge; Einzelbeträge kommen vom Messdienst.')
  }
  const [d] = await db
    .select({ plantId: fuelDeliveries.plantId, from: fuelDeliveries.invoiceFrom, to: fuelDeliveries.invoiceTo, deliveredAt: fuelDeliveries.deliveredAt, estimated: fuelDeliveries.estimated, label: fuelDeliveries.label })
    .from(fuelDeliveries).where(eq(fuelDeliveries.id, after.fuelDeliveryId))
  if (!d) throw new HeatingError(400, 'Die gewählte Lieferung gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
  if (d.estimated) throw new HeatingError(400, 'Eine geschätzte Lieferung hat keine Kostenposition. Verknüpfen Sie die echte Rechnung, wenn sie da ist.')
  if (after.heatingPlantId != null && after.heatingPlantId !== d.plantId) {
    throw new HeatingError(400, 'Die Lieferung gehört zu einer anderen Heizanlage als die Position.')
  }
  const [plant] = await db.select({ method: heatingPlants.method, propertyId: heatingPlants.propertyId }).from(heatingPlants).where(eq(heatingPlants.id, d.plantId))
  // Objektgrenze (Durchsicht I5): Sonst ließe sich auch das eigene Backup nicht mehr einspielen.
  if (plant && plant.propertyId !== after.propertyId) {
    throw new CrossPropertyError(
      `Die Kostenposition gehört zu Objekt ${await propertyName(db, after.propertyId)}, die Lieferung aber zur Heizanlage von Objekt ${await propertyName(db, plant.propertyId)}. ` +
        'Eine Position zeigt nur auf eine Lieferung einer Heizanlage desselben Objekts.')
  }
  if (plant?.method !== 'manual') {
    throw new HeatingError(400,
      'Rechnet ein Messdienst oder die Gemeinschaft ab, steckt der Brennstoff in deren Einzelbeträgen; eine Lieferung wird dort mit keiner Position verknüpft. Tragen Sie die Rechnung nur als Lieferung ein.')
  }
  const end = d.to ?? d.deliveredAt
  const heating = await heatingRulesOf(db, d.plantId)
  if (end === null || heating === null) return
  const h = periodContaining(heating.rules, end)
  if (after.period !== h.key) {
    throw new HeatingError(400,
      `Die Rechnung „${d.label || formatDayRange(d.from ?? end, end)}“ endet am ${formatDayRange(end, end)} und gehört deshalb in die Heizperiode ${periodLabel(h)}. ` +
        'Bitte wählen Sie für die Position diesen Zeitraum; den Teil der Heizperiode davor bucht Mietfuchs selbst hinüber.')
  }
}

// Die Anlage, die eine neue Heizposition ohne Angabe bekommt: die einzige ihres Objekts, außer ihr
// Zeitraum ist abgeschlossen (Entwurf 3.0). Rechnet die Anlage in eigenen Heizperioden ab (Heizung
// PR 5), kommt die Position in die Heizperiode, die in ihrem Objektzeitraum endet, mit dem Jahr der
// Zahlung des Objektzeitraums, wenn die Heizperiode über zwei Kalenderjahre reicht; so legt ein Tab
// von vor dem Update oder die Belegbuchung keine Position unter einem Schlüssel an, den es für die
// Anlage nicht gibt. Endet dort keine oder mehr als eine Heizperiode, bleibt sie ohne Anlage, und
// der Vermieter ordnet sie zu.
// `invoiceDate` (Belegbuchung): Das Jahr der Zahlung einer Heizperiode über zwei Kalenderjahre ist das
// Jahr des Rechnungsdatums, geklemmt in ihre Spanne (Entwurf 3.10, `paymentYear`).
async function defaultHeatingPlant(db: Executor, c: CostItem, invoiceDate?: string | null): Promise<Pick<CostItem, 'heatingPlantId' | 'period' | 'taxYear'>> {
  const none = { heatingPlantId: null, period: c.period, taxYear: c.taxYear }
  if (c.category !== HEATING_CATEGORY) return none
  const [einzige, ...weitere] = await db.select({ id: heatingPlants.id }).from(heatingPlants).where(eq(heatingPlants.propertyId, c.propertyId))
  if (!einzige || weitere.length > 0) return none
  if (await isPeriodClosed(db, c.propertyId, c.period)) return none
  const heating = await heatingRulesOf(db, einzige.id)
  if (!heating?.own) return { ...none, heatingPlantId: einzige.id }
  const p = periodOfKey(await rulesForProperty(db, c.propertyId), c.period)
  const enden = p === null ? [] : heatingPeriodsEndingIn(heating.rules, p)
  const h = enden.length === 1 ? enden[0] : undefined
  if (h === undefined) return none
  // Eine Regel mit Formular und Belegbuchung (`paymentYear`, Durchsicht von #231): Aus der Buchung
  // (mit `invoiceDate`) das Rechnungsdatum, geklemmt in die Heizperiode; sonst ein angegebenes Jahr,
  // ohne Angabe das Jahr des Endes der Heizperiode.
  const year = invoiceDate !== undefined ? paymentYear(h, invoiceDate, c.taxYear).year : c.taxYear ?? paymentYear(h, null).year
  const neu = { heatingPlantId: einzige.id, period: h.key, taxYear: spansTwoYears(h) ? year : undefined }
  return (await itemPeriodClosed(db, { ...c, ...neu })) ? none : neu
}

// Eine Heizposition an der Anlage (Heizung PR 4): dieselbe Objektgrenze wie bei den Wohnungen, und in
// einem abgeschlossenen Zeitraum keine neue Zuordnung.
async function guardCostItemHeating(db: Executor, before: CostItem | null, after: CostItem): Promise<void> {
  if (after.key === 'meter' && after.meterType === 'hkv') throw new HeatingError(400, HKV_KEY)
  const plantId = after.heatingPlantId
  if (!plantId) return
  const plant = await plantOf(db, plantId)
  if (!plant) throw new HeatingError(400, PLANT_GONE)
  if (plant.propertyId !== after.propertyId) {
    throw new CrossPropertyError(
      `Die Kostenposition gehört zu Objekt ${await propertyName(db, after.propertyId)}, die Heizanlage aber zu ` +
        `${await propertyName(db, plant.propertyId)}. Eine Heizposition gehört zur Heizanlage ihres eigenen Objekts.`,
    )
  }
  if ((before?.heatingPlantId ?? null) !== plantId && (await itemPeriodClosed(db, after))) {
    throw new HeatingError(409,
      'Die Abrechnung dieses Zeitraums ist abgeschlossen; ihre Positionen bekommen keine Heizanlage mehr, denn der eingefrorene Stand bleibt maßgeblich. ' +
        'Öffnen Sie die Abrechnung wieder, wenn Sie die Position zuordnen wollen.')
  }
}

// Das Formular eines Mietverhältnisses kennt einen älteren Stand als den gespeicherten
// (Laienprobe B1, shared/tenancyStamp.ts). Gespeichert wird dann nichts: Das Formular schickt alle
// Staffeln, und ein Ersetzen mit dem alten Stand löschte, was ein anderer Weg inzwischen geschrieben
// hat, etwa die Heizvorauszahlung nach dem Aufteilen.
export class StaleTenancyError extends Error {
  status = 409
}

// Ein Vorgang, der eine abgeschlossene Abrechnung träfe (#208). Wie bei `findClosedSettlement`
// bleibt der eingefrorene Stand maßgeblich; wer ändern will, öffnet sie wieder (#56).
export class PeriodConflict extends Error {
  status = 409
}

const OLD_TAB =
  'Diese Seite ist älter als das Programm und kennt die Abrechnungszeiträume dieses Objekts noch nicht. ' +
  'Bitte laden Sie die Seite neu; gespeichert wurde nichts.'

const YEAR_ONLY = /^\d{4}$/

export async function rulesForProperty(db: Executor, propertyId: string): Promise<PeriodRules> {
  const [row] = await db.select({ startMonth: properties.periodStartMonth }).from(properties).where(eq(properties.id, propertyId))
  const changes = await db.select({ fromMonth: periodChanges.fromMonth }).from(periodChanges)
    .where(eq(periodChanges.propertyId, propertyId)).orderBy(periodChanges.fromMonth)
  return { startMonth: row?.startMonth ?? 1, changes: changes.map((c) => c.fromMonth) }
}

// Die Regeln, nach denen die Heizperioden einer Anlage gezählt werden (Heizung PR 5): die eigenen
// oder die des Objekts. `own` false heißt: Jede Heizperiode ist ein Abrechnungszeitraum des Objekts,
// und die Positionen tragen dessen Schlüssel wie bisher.
export async function heatingRulesOf(db: Executor, plantId: string): Promise<{ propertyId: string; own: boolean; rules: PeriodRules } | null> {
  const [plant] = await db.select({ propertyId: heatingPlants.propertyId, startMonth: heatingPlants.periodStartMonth }).from(heatingPlants).where(eq(heatingPlants.id, plantId))
  if (!plant) return null
  const objectRules = await rulesForProperty(db, plant.propertyId)
  if (plant.startMonth === null) return { propertyId: plant.propertyId, own: false, rules: objectRules }
  const changes = await db.select({ fromMonth: heatingPeriodChanges.fromMonth }).from(heatingPeriodChanges)
    .where(eq(heatingPeriodChanges.plantId, plantId)).orderBy(heatingPeriodChanges.fromMonth)
  return { propertyId: plant.propertyId, own: true, rules: plantRules({ periodStartMonth: plant.startMonth, periodChanges: changes.map((c) => c.fromMonth) }, objectRules) }
}

// Die Regeln des Schlüssels einer Kostenposition: bei einer Heizposition einer Anlage mit eigener
// Heizperiode deren, sonst die des Objekts.
async function itemRules(db: Executor, c: CostItem): Promise<PeriodRules> {
  const heating = c.heatingPlantId ? await heatingRulesOf(db, c.heatingPlantId) : null
  return heating?.own ? heating.rules : rulesForProperty(db, c.propertyId)
}

// G-A2: Eine Heizposition einer Anlage mit eigener Heizperiode steht unter einer Heizperiode der
// Anlage. Ein Objektzeitraum wäre dort ein Schlüssel ohne Abrechnung.
function requireHeatingPeriod(rules: PeriodRules, after: CostItem): void {
  if (periodOfKey(rules, after.period) !== null) return
  const nah = periodContaining(rules, `${after.period}-01`)
  throw new PeriodError(
    `Die Heizposition „${after.description}“ steht unter ${after.period}; die Heizanlage rechnet aber in eigenen Heizperioden ab. ` +
      `Bitte wählen Sie die Heizperiode; meinen Sie ${periodLabel(nah)}?`,
  )
}

// Wirft, wenn ein Schlüssel keinen Zeitraum des Objekts bezeichnet. `legacyYear` heißt: Der Rumpf
// kam mit einer nackten Jahreszahl, also von einem Tab von vor dem Update. Sie gilt nur bei einem
// reinen Kalenderobjekt; sonst fiele die Eingabe still in einen Zeitraum, der zufällig im Januar
// beginnt (bei einem Wechsel ab Mai der Rumpf).
async function requirePeriods(db: Executor, propertyId: string, keys: readonly string[], legacyYear: boolean, what: string): Promise<void> {
  if (keys.length === 0 && !legacyYear) return
  const rules = await rulesForProperty(db, propertyId)
  if (legacyYear && !isCalendarRules(rules)) throw new PeriodError(OLD_TAB)
  for (const key of keys) {
    const period = parsePeriodKey(key)
    if (period === null || periodOfKey(rules, period) === null) {
      throw new PeriodError(
        `${what} steht unter dem Zeitraum ${key}, den es für Objekt ${await propertyName(db, propertyId)} nicht gibt. ` +
          'Bitte wählen Sie einen Abrechnungszeitraum des Objekts.',
      )
    }
  }
}

// Was eine Kostenposition mit Leistungszeitraum und Zeitraum über zwei Kalenderjahre braucht
// (#208, Entwurf 3.4, 3.10). Die Datenbank prüft Form und Reihenfolge (0017), nicht aber, was an
// den Zeiträumen des Objekts hängt.
//
// **Eine kalte Rechnung über zwei Zeiträume wird nicht als eine Position angenommen.** Nach dem
// Leistungsprinzip gehört sie anteilig in jeden (VIII ZR 49/07 lässt beides zu, Mietfuchs wählt
// das Leistungsprinzip, Entwurf 3.4); als eine Position stünde sie ganz in einem und fehlte im
// anderen. Aufgeteilt wird sie mit `saveCostItemSplit` (Task 3), dessen Teile `splitPart` tragen.
// Ein Teil, dessen Leistungszeitraum und Zeitraum unverändert bleiben (der Betrag wird berichtigt),
// ist weiter erlaubt. **Heizkosten werden nie nach Tagen geteilt** (G-C1, VIII ZR 156/11); sie
// nimmt die Prüfung an, und die Abrechnung warnt (`period.heating-mismatch`).
export type CostItemGuardOptions = { splitPart?: boolean }

async function requireServiceAndTax(db: Executor, before: CostItem | null, after: CostItem, options: CostItemGuardOptions): Promise<void> {
  const what = `„${after.description}“`
  const from = after.serviceFrom
  const to = after.serviceTo
  if ((from === undefined) !== (to === undefined)) {
    throw new PeriodError(`Für ${what} fehlt ein Ende des Leistungszeitraums. Bitte tragen Sie Beginn und Ende ein oder lassen Sie beide leer.`)
  }
  if (from !== undefined && to !== undefined) {
    if (!isIsoDate(from) || !isIsoDate(to)) throw new PeriodError(`Der Leistungszeitraum von ${what} ist kein gültiges Datum.`)
    if (from > to) throw new PeriodError(`Der Leistungszeitraum von ${what} endet vor seinem Beginn.`)
  }
  if (after.heatingPart !== undefined && after.category !== HEATING_CATEGORY) {
    throw new PeriodError(`„Teil der Heizkosten“ gibt es nur bei der Kostenart „${HEATING_CATEGORY}“.`)
  }
  // Heizung PR 5: das Jahr der Zahlung einer Heizposition richtet sich nach ihrer Heizperiode.
  const rules = await itemRules(db, after)
  const period = periodOfKey(rules, after.period)
  // Einen Zeitraum, den es nicht gibt, hat `requirePeriods` schon abgelehnt.
  if (period === null) return
  requireTaxYear(period, after, what)
  // Ein Teil einer aufgeteilten Rechnung wird nur berichtigt (Durchsicht von #226, C1): Mit einem
  // anderen Leistungszeitraum oder Zeitraum stimmte sein Anteil nicht mehr zum Schnitt nach Tagen,
  // und die Geschwisterteile blieben stehen. Den Wechsel des Rhythmus (`splitPart`) betrifft das nicht.
  // Auch nicht zur Heizposition (Nachprüfung von #226): Heizkosten werden nie nach Tagen geteilt.
  if (before !== null && !options.splitPart && isSplitPart(rules, before) &&
    (before.serviceFrom !== from || before.serviceTo !== to || before.period !== after.period || after.category === HEATING_CATEGORY)) {
    throw new PeriodError(splitPartMessage(before))
  }
  if (from === undefined || to === undefined || after.category === HEATING_CATEGORY || options.splitPart) return
  // Wird aus einer Heizposition eine kalte, ist das keine unveränderte Position (Nachprüfung von
  // #226): Die Heizposition durfte über zwei Zeiträume reichen, die kalte muss aufgeteilt werden.
  const unchanged = before !== null && before.serviceFrom === from && before.serviceTo === to && before.period === after.period &&
    before.category !== HEATING_CATEGORY
  if (unchanged) return
  const touched = periodsBetween(rules, from, to)
  if (touched.length > 1) {
    throw new PeriodError(
      `Die Rechnung ${what} betrifft die Abrechnungszeiträume ${andList(touched.map(periodLabel))} (Leistungszeitraum ${formatDayRange(from, to)}). ` +
        'Kalte Betriebskosten gehören anteilig in jeden dieser Zeiträume; speichern Sie die Rechnung mit „Aufteilen und speichern“.',
    )
  }
}

// Ein Teil einer aufgeteilten Rechnung (#208): eine kalte Position, deren Leistungszeitraum mehr
// als einen Zeitraum des Objekts berührt. Anders entsteht so eine Position nicht, denn das
// gewöhnliche Speichern lehnt sie ab (oben); sie kommt aus `saveCostItemSplit` oder dem Wechsel des
// Rhythmus, und jeder Teil trägt den ganzen Leistungszeitraum der Rechnung.
export { isSplitPart }

const splitPartMessage = (c: CostItem): string =>
  `„${c.description}“ ist ein Teil einer aufgeteilten Rechnung (Leistungszeitraum ${formatDayRange(c.serviceFrom ?? '', c.serviceTo ?? '')}). ` +
  'Leistungszeitraum und Abrechnungszeitraum ändern Sie nicht an einem einzelnen Teil, sonst passten die Anteile nicht mehr zusammen. ' +
  'Betrag, Rechnungssteller und Beleg lassen sich berichtigen; für einen anderen Leistungszeitraum löschen Sie alle Teile und erfassen die Rechnung neu mit „Aufteilen und speichern“.'

// Das Jahr der Zahlung (Entwurf 3.10): Liegt der Zeitraum in einem Kalenderjahr, ist es dieses und
// darf nur leer oder genau dieses sein. Reicht er über zwei, ist es Pflicht und liegt zwischen dem
// Jahr des Beginns und dem Jahr nach dem Ende (eine Messdienstabrechnung kommt oft erst danach).
function requireTaxYear(period: BillingPeriod, after: CostItem, what: string): void {
  const startYear = Number(period.from.slice(0, 4))
  const endYear = Number(period.to.slice(0, 4))
  if (!spansTwoYears(period)) {
    if (after.taxYear !== undefined && after.taxYear !== startYear) {
      throw new PeriodError(`Der Abrechnungszeitraum ${periodLabel(period)} liegt im Kalenderjahr ${startYear}; für die Steuer zählt ${what} deshalb zu ${startYear}.`)
    }
    return
  }
  if (after.taxYear === undefined) {
    throw new PeriodError(`Der Abrechnungszeitraum ${periodLabel(period)} reicht über zwei Kalenderjahre. Bitte geben Sie bei ${what} das Jahr der Zahlung an (für die Steuer, § 11 Abs. 2 EStG).`)
  }
  if (after.taxYear < startYear || after.taxYear > endYear + 1) {
    throw new PeriodError(`Das Jahr der Zahlung von ${what} muss zwischen ${startYear} und ${endYear + 1} liegen.`)
  }
}

async function propertyName(db: Executor, propertyId: string): Promise<string> {
  const rows = await db.select({ name: properties.name }).from(properties).where(eq(properties.id, propertyId))
  const name = rows[0]?.name
  return name ? `„${name}“` : 'ohne Namen'
}

// Wirft, wenn eine der Wohnungen zu einem anderen Objekt gehört. `what` beschreibt den
// Datensatz, der verweist, für die Meldung.
export async function sameProperty(db: Executor, propertyId: string, unitIds: string[], what: string): Promise<void> {
  if (unitIds.length === 0) return
  const fremd = await db
    .select({ name: units.name, propertyId: units.propertyId })
    .from(units)
    .where(and(inArray(units.id, unitIds), ne(units.propertyId, propertyId)))
  const erste = fremd[0]
  if (!erste) return
  throw new CrossPropertyError(
    `${what} gehört zu Objekt ${await propertyName(db, propertyId)}, die Wohnung „${erste.name}“ aber zu ` +
      `${await propertyName(db, erste.propertyId)}. Ein Verweis über die Grenze eines Objekts ginge in keiner ` +
      `Abrechnung auf. Bitte wählen Sie eine Wohnung desselben Objekts.`,
  )
}

const noGuard = async (): Promise<void> => {}

async function guardMeter(db: Executor, _before: Meter | null, after: Meter): Promise<void> {
  await sameProperty(db, after.propertyId, after.unitId ? [after.unitId] : [], 'Der Zähler')
  if (after.type === 'hkv' && !after.unitId) {
    throw new HeatingError(400, 'Ein Heizkostenverteiler sitzt an einem Heizkörper einer Wohnung. Bitte wählen Sie bei der Zuordnung die Wohnung.')
  }
  if (after.installedOn && !ISO_DATE.test(after.installedOn)) {
    throw new HeatingError(400, 'Das Einbaudatum ist kein Datum. Bitte wählen Sie es im Kalender oder lassen Sie das Feld leer.')
  }
  const plantId = after.heatingPlantId
  if (!plantId) return
  // Ein Zähler der Anlage hängt an keiner Wohnung; sonst lehnte die Prüfbedingung ab, ohne Satz.
  if (after.unitId) {
    throw new HeatingError(400,
      'Ein Zähler an einer Wohnung gehört nicht zur Heizanlage selbst. Zur Anlage gehören nur Zähler ohne Wohnung, etwa der Gaszähler oder ein Wärmezähler am Warmwasserspeicher. ' +
        'Wählen Sie „Haus (Hauptzähler)“ oder nehmen Sie den Zähler aus der Anlage.')
  }
  const plant = await plantOf(db, plantId)
  if (!plant) throw new HeatingError(400, PLANT_GONE)
  if (plant.propertyId !== after.propertyId) {
    throw new CrossPropertyError(
      `Der Zähler gehört zu Objekt ${await propertyName(db, after.propertyId)}, die Heizanlage aber zu ` +
        `${await propertyName(db, plant.propertyId)}. Ein Zähler gehört zur Heizanlage seines eigenen Objekts.`,
    )
  }
  if (!after.heatingRole) {
    throw new HeatingError(400, 'Was misst der Zähler an der Heizanlage? Bitte wählen Sie Versorgungszähler, Wärmezähler Warmwasser oder Gesamtwärmezähler.')
  }
  if (after.heatingRole !== 'supply' && after.type !== 'waerme') {
    throw new HeatingError(400, 'Ein Wärmezähler an der Heizanlage hat die Sparte „Wärme“.')
  }
}

async function guardCostItem(db: Executor, before: CostItem | null, after: CostItem, body: unknown, options: CostItemGuardOptions = {}): Promise<void> {
  // Der Zeitraum (#208) muss zum Objekt gehören, bei einer Heizposition mit eigener Heizperiode zur
  // Anlage (Heizung PR 5). `year` ohne `period` schickt nur ein alter Tab.
  const heating = after.heatingPlantId ? await heatingRulesOf(db, after.heatingPlantId) : null
  if (heating?.own) requireHeatingPeriod(heating.rules, after)
  else await requirePeriods(db, after.propertyId, [after.period], has(body, 'year') && !has(body, 'period'), 'Die Kostenposition')
  await requireServiceAndTax(db, before, after, options)
  // Die Wohnungen der Einzelbeträge über ihr Mietverhältnis (#94).
  const mietverhaeltnisse = Object.keys(after.tenancyAmounts ?? {})
  const ihreWohnungen = mietverhaeltnisse.length === 0
    ? []
    : (await db.select({ unitId: tenancies.unitId }).from(tenancies).where(inArray(tenancies.id, mietverhaeltnisse))).map((r) => r.unitId)
  const ziele = [
    ...(after.directUnitId ? [after.directUnitId] : []),
    ...Object.keys(after.customShares ?? {}),
    ...(after.participantUnitIds ?? []),
    ...ihreWohnungen,
    ...Object.keys(after.selfAmounts ?? {}),
  ]
  await sameProperty(db, after.propertyId, ziele, 'Die Kostenposition')
  await guardCostItemHeating(db, before, after)
  await guardFuelLink(db, before, after)
}

// Eine Wohnung darf das Objekt wechseln, solange nichts Objektgebundenes an ihr hängt. Ihr
// Mietverhältnis nimmt sie mit, denn es erbt das Objekt über sie; ein Zähler, eine
// Direktzuordnung oder ein vereinbarter Anteil gehören dagegen zum alten Objekt.
// Welche Wohnungen eine Anlage mit getrennter Heizkostenabrechnung versorgt, entscheidet, welche
// Abrechnung eine Heizvorauszahlung anrechnet (`separateOwner` nur für versorgte Wohnungen, sonst P).
// Wechselte das still, stünde eine schon angerechnete Heizvorauszahlung in einer anderen Abrechnung
// als bisher, auch in einer abgeschlossenen (Durchsicht von #231, Critical 1). Deshalb abgelehnt, solange
// eine betroffene Wohnung ein Mietverhältnis mit Heizvorauszahlung hat und die Anlage Spannen nach
// Weg d führt. Eine Vorschau, die die Staffeln zusammenführt, verschöbe dieselben Monate ebenso; die
// Ablehnung mit Satz ist die ehrlichere Antwort.
export async function guardServedChange(db: Executor, plantId: string, unitIds: readonly string[]): Promise<void> {
  if (unitIds.length === 0) return
  const spans = await db.select({ from: heatingSeparateSpans.from }).from(heatingSeparateSpans).where(eq(heatingSeparateSpans.plantId, plantId))
  if (spans.length === 0) return
  const rows = await db
    .select({ name: tenancies.tenantName })
    .from(heatingPrepayments)
    .innerJoin(tenancies, eq(heatingPrepayments.tenancyId, tenancies.id))
    .where(and(inArray(tenancies.unitId, [...unitIds]), sql`${heatingPrepayments.monthlyCents} > 0`))
  const names = [...new Set(rows.map((r) => r.name))]
  if (names.length === 0) return
  throw new HeatingError(409,
    `Für ${andList(names.map((n) => `„${n}“`))} ist eine Heizvorauszahlung erfasst, und die Heizkosten werden getrennt abgerechnet. ` +
      'Ob die Heizanlage diese Wohnung versorgt, entscheidet, welche Abrechnung die Heizvorauszahlung anrechnet; nach der Änderung stünde sie in einer anderen als bisher, auch in einer schon abgeschlossenen. ' +
      'Das lässt Mietfuchs deshalb nicht zu, solange es diese Heizvorauszahlung gibt. Stimmt die Zuordnung nicht, tragen Sie bei diesen Mietverhältnissen die Heizvorauszahlung als übrige Vorauszahlung ein (Stammdaten → Mietverhältnis) und prüfen dabei die abgeschlossenen Abrechnungen. Gespeichert wurde nichts.')
}

async function guardUnit(db: Executor, before: Unit | null, after: Unit): Promise<void> {
  // „Kein Anschluss: Wärme“ ändert, welche Anlage ohne Liste die Wohnung versorgt (#117, Heizung PR 5).
  if (before && before.propertyId === after.propertyId) {
    const plants = await db.select({ id: heatingPlants.id }).from(heatingPlants)
      .where(and(eq(heatingPlants.propertyId, after.propertyId), eq(heatingPlants.unitsLimited, false)))
    for (const plant of plants) {
      if (servesUnit({ units: null }, before) !== servesUnit({ units: null }, after)) await guardServedChange(db, plant.id, [after.id])
    }
  }
  if (!before || before.propertyId === after.propertyId) return
  // An einer Heizanlage (Heizung PR 4, Durchsicht von #230): Die Anlage gehört zum bisherigen
  // Objekt; wechselte die Wohnung mit, versorgte sie eine Anlage über die Objektgrenze, und das
  // eigene Backup würde beim Einspielen abgelehnt.
  const anlagen = await db
    .select({ name: heatingPlants.name })
    .from(heatingPlantUnits)
    .innerJoin(heatingPlants, eq(heatingPlantUnits.plantId, heatingPlants.id))
    .where(eq(heatingPlantUnits.unitId, after.id))
  if (anlagen.length > 0) {
    throw new CrossPropertyError(
      `Die Wohnung „${after.name}“ hängt an der Heizanlage des bisherigen Objekts und kann deshalb nicht in ein anderes Objekt wechseln. ` +
        'Nehmen Sie sie zuerst in den Stammdaten unter „Heizung“ aus der Liste der angeschlossenen Wohnungen.',
    )
  }
  const haengt: string[] = []
  const zaehler = await db.select({ n: count() }).from(meters).where(eq(meters.unitId, after.id))
  if ((zaehler[0]?.n ?? 0) > 0) haengt.push('Zähler')
  const direkt = await db.select({ n: count() }).from(costItems).where(eq(costItems.directUnitId, after.id))
  if ((direkt[0]?.n ?? 0) > 0) haengt.push('direkt zugeordnete Kostenpositionen')
  const anteile = await db.select({ n: count() }).from(costItemShares).where(eq(costItemShares.unitId, after.id))
  if ((anteile[0]?.n ?? 0) > 0) haengt.push('vereinbarte Anteile')
  // Teilnehmer und Einzelbeträge (#94) gehören ebenso zum alten Objekt; der Wächter kannte sie
  // anfangs nicht, und die Position verlor den Teilnehmer dann still.
  const teilnahme = await db.select({ n: count() }).from(costItemParticipants).where(eq(costItemParticipants.unitId, after.id))
  if ((teilnahme[0]?.n ?? 0) > 0) haengt.push('Teilnahmen an Kostenpositionen')
  const eigenbetraege = await db.select({ n: count() }).from(costItemSelfAmounts).where(eq(costItemSelfAmounts.unitId, after.id))
  if ((eigenbetraege[0]?.n ?? 0) > 0) haengt.push('Eigenbeträge von Kostenpositionen')
  const betraege = await db
    .select({ n: count() })
    .from(costItemAmounts)
    .innerJoin(tenancies, eq(costItemAmounts.tenancyId, tenancies.id))
    .where(eq(tenancies.unitId, after.id))
  if ((betraege[0]?.n ?? 0) > 0) haengt.push('Einzelbeträge ihrer Mietverhältnisse')
  if (haengt.length === 0) return
  throw new CrossPropertyError(
    `Die Wohnung „${after.name}“ kann nicht in ein anderes Objekt wechseln, weil noch ${haengt.join(', ')} ` +
      `an ihr hängen, die zum bisherigen Objekt gehören. Bitte lösen Sie diese Verweise zuerst.`,
  )
}

async function guardTenancy(db: Executor, before: Tenancy | null, after: Tenancy, body: unknown): Promise<void> {
  // Laienprobe B1: Schickt das Formular die Marke des Stands, den es geladen hat, muss sie noch
  // stimmen. Ein Rumpf ohne Marke (Mieterwechsel, Jahreskorrektur aus der Abrechnung, ein alter Tab)
  // ändert nur, was er nennt, und braucht sie nicht.
  const expected = raw(body, 'ifUnchanged')
  if (before && typeof expected === 'string' && expected !== tenancyStamp(before)) {
    throw new StaleTenancyError(
      `Das Mietverhältnis „${before.tenantName}“ wurde inzwischen an anderer Stelle geändert, etwa beim Aufteilen der Vorauszahlung ` +
        'für die Heizung oder beim Wechsel des Abrechnungszeitraums. Gespeichert wurde nichts, damit diese Änderung nicht verloren geht. ' +
        'Bitte schließen Sie das Formular, öffnen Sie das Mietverhältnis erneut und tragen Sie Ihre Änderung noch einmal ein.',
    )
  }
  // Die Jahreskorrektur (#208): jeder Schlüssel ein Zeitraum des Objekts der Wohnung. Eine
  // vierstellige Jahreszahl im Rumpf schickt nur ein alter Tab.
  const sent = raw(body, 'prepaymentOverrides')
  const legacyYear = isObject(sent) && Object.keys(Object(sent)).some((k) => YEAR_ONLY.test(k))
  const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, after.unitId))
  if (unit) await requirePeriods(db, unit.propertyId, Object.keys(after.prepaymentOverrides), legacyYear, `Die Jahreskorrektur von „${after.tenantName}“`)
  await guardHeatingOverrides(db, after)
  await guardTenancyMove(db, before, after)
}

// Ein Mietverhältnis erbt sein Objekt über die Wohnung. Wechselt es in eine Wohnung eines anderen
// Objekts, bleiben seine Einzelbeträge (#94) beim alten zurück; dann lieber ablehnen.
async function guardTenancyMove(db: Executor, before: Tenancy | null, after: Tenancy): Promise<void> {
  if (!before || before.unitId === after.unitId) return
  await guardHeatingMove(db, before, after)
  const objektVon = async (unitId: string) =>
    (await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, unitId)))[0]?.propertyId
  if ((await objektVon(before.unitId)) === (await objektVon(after.unitId))) return
  const betraege = await db.select({ n: count() }).from(costItemAmounts).where(eq(costItemAmounts.tenancyId, after.id))
  // CO₂-Beträge „vom Vermieter übernommen“ (Heizung PR 6) gehören ebenso zur Heizanlage des alten Objekts.
  const co2 = await db.select({ n: count() }).from(co2TenantReliefs).where(eq(co2TenantReliefs.tenancyId, after.id))
  if ((betraege[0]?.n ?? 0) === 0 && (co2[0]?.n ?? 0) === 0) return
  throw new CrossPropertyError(
    `Das Mietverhältnis „${after.tenantName}“ kann nicht in eine Wohnung eines anderen Objekts wechseln, weil noch ` +
      'Einzelbeträge von Kostenpositionen oder CO₂-Angaben des bisherigen Objekts an ihm hängen. Bitte lösen Sie diese Verweise zuerst.',
  )
}

// Die Korrekturen der Heizvorauszahlung (Heizung PR 5): Anlage desselben Objekts, Schlüssel einer
// getrennt abgerechneten Heizperiode der Anlage, eine vorläufige nur mit Monaten dieser
// Heizperiode (D2).
async function guardHeatingOverrides(db: Executor, after: Tenancy): Promise<void> {
  const overrides = after.heatingPrepaymentOverrides ?? []
  if (overrides.length === 0) return
  const [unit] = await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, after.unitId))
  for (const o of overrides) {
    const heating = await heatingRulesOf(db, o.plantId)
    if (!heating) throw new HeatingError(400, 'Diese Heizanlage gibt es nicht (mehr). Bitte laden Sie die Seite neu; gespeichert wurde nichts.')
    if (unit && heating.propertyId !== unit.propertyId) {
      throw new CrossPropertyError(
        `Die Heizvorauszahlung von „${after.tenantName}“ gehört zu Objekt ${await propertyName(db, unit.propertyId)}, die Heizanlage aber zu ` +
          `${await propertyName(db, heating.propertyId)}. Eine Korrektur gehört zur Heizanlage des eigenen Objekts.`,
      )
    }
    const h = periodOfKey(heating.rules, o.period)
    if (h === null) {
      throw new PeriodError(`Die Korrektur der Heizvorauszahlung von „${after.tenantName}“ steht unter ${o.period}, einer Heizperiode, die es für die Heizanlage nicht gibt.`)
    }
    // Eine Heizkorrektur gibt es nur für eine getrennt abgerechnete Heizperiode (Weg d). Sonst
    // rechnet die Abrechnung des Objekts die Heizstaffel an, und ihre Jahreskorrektur gilt für alles,
    // was sie anrechnet (3.7).
    const spans = await db.select({ from: heatingSeparateSpans.from, until: heatingSeparateSpans.until }).from(heatingSeparateSpans).where(eq(heatingSeparateSpans.plantId, o.plantId))
    if (!heating.own || isObjectPeriod(await rulesForProperty(db, heating.propertyId), h) || spanOf(spans, h) === undefined) {
      throw new PeriodError(
        `Die Korrektur der Heizvorauszahlung von „${after.tenantName}“ für ${periodLabel(h)}: Eine solche Korrektur gibt es nur für eine getrennt abgerechnete Heizperiode. ` +
          'Tragen Sie den tatsächlich gezahlten Betrag als Jahreskorrektur der Abrechnung ein.',
      )
    }
    if (!o.provisional) continue
    const months = periodMonths(h)
    if (o.fromMonth === null || o.toMonth === null || !months.includes(o.fromMonth) || !months.includes(o.toMonth) || o.toMonth < o.fromMonth) {
      throw new PeriodError(`Die vorläufige Korrektur der Heizvorauszahlung von „${after.tenantName}“ nennt Monate außerhalb der Heizperiode ${periodLabel(h)}.`)
    }
  }
}

// Versorgt eine Anlage die Wohnung? Ohne Liste jede ohne „kein Anschluss: Wärme“, mit Liste genau
// die genannten (`servesUnit`, hier aus den Tabellen gelesen).
async function plantServes(db: Executor, plantId: string, unitsLimited: boolean, unitId: string): Promise<boolean> {
  if (unitsLimited) {
    return (await db.select({ unitId: heatingPlantUnits.unitId }).from(heatingPlantUnits)
      .where(and(eq(heatingPlantUnits.plantId, plantId), eq(heatingPlantUnits.unitId, unitId)))).length > 0
  }
  return (await db.select({ unitId: unitNoConnection.unitId }).from(unitNoConnection)
    .where(and(eq(unitNoConnection.unitId, unitId), eq(unitNoConnection.meterType, 'waerme')))).length === 0
}

// Ein Mietverhältnis mit Heizvorauszahlung wechselt in eine Wohnung, die eine Anlage mit Spannen nach
// Weg d anders versorgt als die bisherige (Durchsicht von #231, Minor 5): wie `guardServedChange`,
// denn auch dann stünde eine angerechnete Heizvorauszahlung danach in einer anderen Abrechnung.
// Bei H = P (Anlage ohne eigene Heizperiode, getrennte Vorauszahlung nur ausgewiesen) gibt es keine
// Spannen und damit keinen Monat, den eine eigene Heizkostenabrechnung anrechnet (`separateOwner` ist
// dort immer `null`): Jede Heizvorauszahlung rechnet die Abrechnung P an, gleich welche Wohnung die
// Anlage versorgt. Ein Wohnungswechsel verschiebt dann nichts; geprüft wird nur bei Spannen.
async function guardHeatingMove(db: Executor, before: Tenancy, after: Tenancy): Promise<void> {
  if (!(after.heatingPrepayments ?? before.heatingPrepayments ?? []).some((e) => e.monthlyCents > 0)) return
  const propertyIds = (await db.select({ propertyId: units.propertyId }).from(units).where(inArray(units.id, [before.unitId, after.unitId]))).map((u) => u.propertyId)
  if (propertyIds.length === 0) return
  const plants = await db.select({ id: heatingPlants.id, unitsLimited: heatingPlants.unitsLimited }).from(heatingPlants).where(inArray(heatingPlants.propertyId, propertyIds))
  for (const plant of plants) {
    const spans = await db.select({ from: heatingSeparateSpans.from }).from(heatingSeparateSpans).where(eq(heatingSeparateSpans.plantId, plant.id))
    if (spans.length === 0) continue
    if ((await plantServes(db, plant.id, plant.unitsLimited, before.unitId)) === (await plantServes(db, plant.id, plant.unitsLimited, after.unitId))) continue
    throw new HeatingError(409,
      `Für „${after.tenantName}“ ist eine Heizvorauszahlung erfasst, und die Heizkosten werden getrennt abgerechnet. Die neue Wohnung versorgt die Heizanlage anders als die bisherige; ` +
        'die Heizvorauszahlung stünde danach in einer anderen Abrechnung als bisher, auch in einer schon abgeschlossenen. Legen Sie für die neue Wohnung ein neues Mietverhältnis an (Mieterwechsel). Gespeichert wurde nichts.')
  }
}

// Verweise über Objektgrenzen im ganzen Bestand, als lesbare Sätze. Leer heißt in Ordnung.
export async function crossPropertyViolations(db: Database): Promise<string[]> {
  const befunde: string[] = []
  const zaehler = await db
    .select({ id: meters.id, name: meters.name })
    .from(meters)
    .innerJoin(units, eq(meters.unitId, units.id))
    .where(ne(meters.propertyId, units.propertyId))
  for (const z of zaehler) befunde.push(`Der Zähler „${z.name}“ gehört zu einem anderen Objekt als seine Wohnung.`)
  const direkt = await db
    .select({ description: costItems.description })
    .from(costItems)
    .innerJoin(units, eq(costItems.directUnitId, units.id))
    .where(ne(costItems.propertyId, units.propertyId))
  for (const c of direkt) befunde.push(`Die Kostenposition „${c.description}“ ist einer Wohnung eines anderen Objekts zugeordnet.`)
  const anteile = await db
    .select({ description: costItems.description })
    .from(costItemShares)
    .innerJoin(costItems, eq(costItemShares.costItemId, costItems.id))
    .innerJoin(units, eq(costItemShares.unitId, units.id))
    .where(ne(costItems.propertyId, units.propertyId))
  for (const c of anteile) befunde.push(`Die Kostenposition „${c.description}“ hat einen Anteil an einer Wohnung eines anderen Objekts.`)
  const teilnehmer = await db
    .select({ description: costItems.description })
    .from(costItemParticipants)
    .innerJoin(costItems, eq(costItemParticipants.costItemId, costItems.id))
    .innerJoin(units, eq(costItemParticipants.unitId, units.id))
    .where(ne(costItems.propertyId, units.propertyId))
  for (const c of teilnehmer) befunde.push(`Die Kostenposition „${c.description}“ hat eine Wohnung eines anderen Objekts als Teilnehmer.`)
  const betraege = await db
    .select({ description: costItems.description })
    .from(costItemAmounts)
    .innerJoin(costItems, eq(costItemAmounts.costItemId, costItems.id))
    .innerJoin(tenancies, eq(costItemAmounts.tenancyId, tenancies.id))
    .innerJoin(units, eq(tenancies.unitId, units.id))
    .where(ne(costItems.propertyId, units.propertyId))
  for (const c of betraege) befunde.push(`Die Kostenposition „${c.description}“ hat einen Einzelbetrag für ein Mietverhältnis eines anderen Objekts.`)
  const eigen = await db
    .select({ description: costItems.description })
    .from(costItemSelfAmounts)
    .innerJoin(costItems, eq(costItemSelfAmounts.costItemId, costItems.id))
    .innerJoin(units, eq(costItemSelfAmounts.unitId, units.id))
    .where(ne(costItems.propertyId, units.propertyId))
  for (const c of eigen) befunde.push(`Die Kostenposition „${c.description}“ hat einen Eigenbetrag für eine Wohnung eines anderen Objekts.`)
  // Heizung PR 5: eine Heizkorrektur auf die Anlage eines anderen Objekts.
  const anlagen = new Map((await db.select({ id: heatingPlants.id, propertyId: heatingPlants.propertyId }).from(heatingPlants)).map((p) => [p.id, p.propertyId]))
  const heiz = await db
    .select({ plantId: heatingPrepaymentOverrides.plantId, tenantName: tenancies.tenantName, propertyId: units.propertyId })
    .from(heatingPrepaymentOverrides)
    .innerJoin(tenancies, eq(heatingPrepaymentOverrides.tenancyId, tenancies.id))
    .innerJoin(units, eq(tenancies.unitId, units.id))
  for (const h of heiz) {
    if (anlagen.get(h.plantId) !== h.propertyId) befunde.push(`Die Korrektur der Heizvorauszahlung von „${h.tenantName}“ zeigt auf die Heizanlage eines anderen Objekts.`)
  }
  // CO₂-Angaben (Heizung PR 6): Beträge für Mietverhältnisse und die Position mit L gehören zum
  // Objekt der Heizanlage.
  const co2 = await db
    .select({ tenantName: tenancies.tenantName })
    .from(co2TenantReliefs)
    .innerJoin(co2Statements, eq(co2TenantReliefs.statementId, co2Statements.heatingPeriodId))
    .innerJoin(heatingPeriods, eq(co2Statements.heatingPeriodId, heatingPeriods.id))
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
    .innerJoin(tenancies, eq(co2TenantReliefs.tenancyId, tenancies.id))
    .innerJoin(units, eq(tenancies.unitId, units.id))
    .where(ne(heatingPlants.propertyId, units.propertyId))
  for (const c of co2) befunde.push(`Ein CO₂-Betrag „vom Vermieter übernommen“ für ${c.tenantName} gehört zu einer Heizanlage eines anderen Objekts.`)
  const co2Position = await db
    .select({ description: costItems.description })
    .from(co2Statements)
    .innerJoin(heatingPeriods, eq(co2Statements.heatingPeriodId, heatingPeriods.id))
    .innerJoin(heatingPlants, eq(heatingPeriods.plantId, heatingPlants.id))
    .innerJoin(costItems, eq(co2Statements.serviceCostItemId, costItems.id))
    .where(ne(costItems.propertyId, heatingPlants.propertyId))
  for (const c of co2Position) befunde.push(`Die CO₂-Angaben einer Heizanlage verweisen auf die Kostenposition „${c.description}“ eines anderen Objekts.`)
  // Lieferungen (Heizung PR 7): Eine Position zeigt nur auf eine Lieferung einer Anlage ihres Objekts.
  const lieferungen = await db
    .select({ description: costItems.description })
    .from(costItems)
    .innerJoin(fuelDeliveries, eq(costItems.fuelDeliveryId, fuelDeliveries.id))
    .innerJoin(heatingPlants, eq(fuelDeliveries.plantId, heatingPlants.id))
    .where(ne(heatingPlants.propertyId, costItems.propertyId))
  for (const c of lieferungen) befunde.push(`Die Kostenposition „${c.description}“ zeigt auf eine Lieferung einer Heizanlage eines anderen Objekts.`)
  return befunde
}

// Zeitraumschlüssel, die für ihr Objekt keinen Zeitraum bezeichnen (#208), als lesbare Sätze. Über
// die Routen entsteht keiner (die Schreibprüfungen oben); in einem Archiv kann einer stehen, etwa von
// Hand bearbeitet. Was darunter steht, erschiene in keiner Abrechnung.
export async function orphanPeriodKeys(db: Database): Promise<string[]> {
  const rulesById = new Map((await readProperties(db)).map((p) => [p.id, rulesOf(p)]))
  const befunde: string[] = []
  const pruefe = (propertyId: string | null, key: string, was: string): void => {
    const rules = propertyId === null ? undefined : rulesById.get(propertyId)
    if (!rules) return
    const period = parsePeriodKey(key)
    if (period === null || periodOfKey(rules, period) === null) befunde.push(`${was} steht unter dem Zeitraum ${key}, den es für das Objekt nicht gibt.`)
  }
  // Heizpositionen und Heizkorrekturen einer Anlage mit eigener Heizperiode tragen deren Schlüssel
  // (Heizung PR 5); ohne eigene die des Objekts.
  const plantRulesById = new Map((await readHeatingPlants(db)).map((p) => [p.id, {
    propertyId: p.propertyId,
    rules: p.periodStartMonth === null ? null : plantRules(p, rulesById.get(p.propertyId) ?? CALENDAR_RULES),
  }]))
  const pruefeHeizung = (plantId: string | null, propertyId: string | null, key: string, was: string): void => {
    const plant = plantId === null ? undefined : plantRulesById.get(plantId)
    if (!plant?.rules) return pruefe(plant?.propertyId ?? propertyId, key, was)
    const period = parsePeriodKey(key)
    if (period === null || periodOfKey(plant.rules, period) === null) befunde.push(`${was} steht unter der Heizperiode ${key}, die es für die Heizanlage nicht gibt.`)
  }
  for (const c of await db.select({ propertyId: costItems.propertyId, period: costItems.period, description: costItems.description, plantId: costItems.heatingPlantId }).from(costItems)) {
    pruefeHeizung(c.plantId, c.propertyId, c.period, `Die Kostenposition „${c.description}“`)
  }
  for (const c of await db.select({ propertyId: closedSettlements.propertyId, period: closedSettlements.period }).from(closedSettlements)) {
    pruefe(c.propertyId, c.period, 'Eine abgeschlossene Abrechnung')
  }
  for (const c of await db.select({ propertyId: closedSettlementHistory.propertyId, period: closedSettlementHistory.period }).from(closedSettlementHistory)) {
    pruefe(c.propertyId, c.period, 'Ein früherer Abschluss')
  }
  const korrekturen = await db
    .select({ propertyId: units.propertyId, period: prepaymentOverrides.period, tenantName: tenancies.tenantName })
    .from(prepaymentOverrides)
    .innerJoin(tenancies, eq(prepaymentOverrides.tenancyId, tenancies.id))
    .innerJoin(units, eq(tenancies.unitId, units.id))
  for (const k of korrekturen) pruefe(k.propertyId, k.period, `Die Jahreskorrektur von „${k.tenantName}“`)
  for (const a of await db.select({ propertyId: assessments.propertyId, period: assessments.requestedPeriod, file: assessments.file }).from(assessments)) {
    if (a.period !== null) pruefe(a.propertyId, a.period, `Die Auswertung des Belegs „${a.file}“`)
  }
  const heizkorrekturen = await db
    .select({ plantId: heatingPrepaymentOverrides.plantId, period: heatingPrepaymentOverrides.period, tenantName: tenancies.tenantName })
    .from(heatingPrepaymentOverrides)
    .innerJoin(tenancies, eq(heatingPrepaymentOverrides.tenancyId, tenancies.id))
  for (const k of heizkorrekturen) pruefeHeizung(k.plantId, null, k.period, `Die Korrektur der Heizvorauszahlung von „${k.tenantName}“`)
  for (const c of await db.select({ plantId: closedHeatingSettlements.plantId, period: closedHeatingSettlements.period }).from(closedHeatingSettlements)) {
    pruefeHeizung(c.plantId, null, c.period, 'Eine abgeschlossene Heizkostenabrechnung')
  }
  for (const c of await db.select({ plantId: closedHeatingSettlementHistory.plantId, period: closedHeatingSettlementHistory.period }).from(closedHeatingSettlementHistory)) {
    pruefeHeizung(c.plantId, null, c.period, 'Ein früherer Abschluss einer Heizkostenabrechnung')
  }
  return befunde
}

// ---------- Die Objekte selbst (#92) ----------

function mergeProperty(current: Property, body: unknown): Property {
  // `null` ist bei den drei abweichenden Angaben ein ausdrücklicher Wert („die Vorgabe gilt“),
  // deshalb dieselbe Lesart wie beim offenen Mietverhältnis.
  const nullableNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    id: current.id,
    name: merged(body, 'name', current.name, (v) => asText(v, '')),
    kind: merged(body, 'kind', current.kind, (v) => oneOfOrUndefined(PROPERTY_KINDS, v) ?? current.kind),
    address: merged(body, 'address', current.address, (v) => asText(v, '')),
    landlordName: merged(body, 'landlordName', current.landlordName, asNullableText),
    iban: merged(body, 'iban', current.iban, asNullableText),
    paymentDeadlineDays: merged(body, 'paymentDeadlineDays', current.paymentDeadlineDays, nullableNumber),
    // `null` heißt unbekannt und ist ein ausdrücklicher Wert (#121).
    cableBuiltBeforeDec2021: merged(body, 'cableBuiltBeforeDec2021', current.cableBuiltBeforeDec2021 ?? null, (v) => (typeof v === 'boolean' ? v : null)),
  }
}

const emptyProperty = (id: string): Property => ({
  id, name: '', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null,
})

export const listProperties = readProperties

async function findProperty(db: Database, id: string): Promise<Property | undefined> {
  return (await readProperties(db)).find((p) => p.id === id)
}

export async function createProperty(db: Database, id: string, body: unknown): Promise<Property> {
  await db.insert(properties).values(mergeProperty(emptyProperty(id), body))
  const gespeichert = await findProperty(db, id)
  if (!gespeichert) throw new Error('Das Objekt ist nach dem Anlegen nicht auffindbar.')
  return gespeichert
}

export async function updateProperty(db: Database, id: string, body: unknown): Promise<Property | null> {
  const current = await findProperty(db, id)
  if (!current) return null
  const { id: _id, ...rest } = mergeProperty(current, body)
  await db.update(properties).set(rest).where(eq(properties.id, id))
  return (await findProperty(db, id)) ?? null
}

// Was das Löschen einer Wohnung mitnähme (#142), damit die Löschfrage es nennen kann. Gezählt wird
// entlang derselben Fremdschlüssel, die beim Löschen kaskadieren (db/schema.ts): Mietverhältnisse
// und über sie Zahlungen und Einzelbeträge, Zähler und über sie Ablesungen, dazu die vereinbarten
// Anteile, Teilnahmen und Eigenbeträge der Wohnung. Direkt zugeordnete Rechnungen bleiben
// (`SET NULL`) und stehen deshalb getrennt da. `null`, wenn es die Wohnung nicht gibt.
export async function unitDependents(db: Executor, unitId: string): Promise<UnitDependents | null> {
  const unit = await db.select({ id: units.id }).from(units).where(eq(units.id, unitId))
  if (unit.length === 0) return null
  const n = async (rows: Promise<{ n: number }[]>) => (await rows)[0]?.n ?? 0
  const ihreMietverhaeltnisse = db.select({ id: tenancies.id }).from(tenancies).where(eq(tenancies.unitId, unitId))
  const ihreZaehler = db.select({ id: meters.id }).from(meters).where(eq(meters.unitId, unitId))
  const verweise = await n(db.select({ n: count() }).from(costItemShares).where(eq(costItemShares.unitId, unitId))) +
    await n(db.select({ n: count() }).from(costItemParticipants).where(eq(costItemParticipants.unitId, unitId))) +
    await n(db.select({ n: count() }).from(costItemSelfAmounts).where(eq(costItemSelfAmounts.unitId, unitId))) +
    await n(db.select({ n: count() }).from(costItemAmounts).where(inArray(costItemAmounts.tenancyId, ihreMietverhaeltnisse)))
  return {
    tenancies: await n(db.select({ n: count() }).from(tenancies).where(eq(tenancies.unitId, unitId))),
    meters: await n(db.select({ n: count() }).from(meters).where(eq(meters.unitId, unitId))),
    readings: await n(db.select({ n: count() }).from(readings).where(inArray(readings.meterId, ihreZaehler))),
    payments: await n(db.select({ n: count() }).from(payments).where(inArray(payments.tenancyId, ihreMietverhaeltnisse))),
    costItemLinks: verweise,
    directCostItems: await n(db.select({ n: count() }).from(costItems).where(eq(costItems.directUnitId, unitId))),
  }
}

export type PropertyRemoval = { removed: true } | { removed: false, reason: 'missing' | 'last' } | { removed: false, reason: 'inUse', inUse: string }

// Gelöscht wird nur ein leeres Objekt, und nie das letzte: Eine neue Wohnung braucht eines.
// Was noch darin steht, nennt die Antwort, damit die Oberfläche es sagen kann.
export async function removeProperty(db: Database, id: string): Promise<PropertyRemoval> {
  const alle = await readProperties(db)
  if (!alle.some((p) => p.id === id)) return { removed: false, reason: 'missing' }
  if (alle.length === 1) return { removed: false, reason: 'last' }
  const zahl = async (table: typeof units | typeof meters | typeof costItems | typeof closedSettlements | typeof closedSettlementHistory | typeof heatingPlants) =>
    (await db.select({ n: count() }).from(table).where(eq(table.propertyId, id)))[0]?.n ?? 0
  const teile = [
    [await zahl(units), 'Wohnung', 'Wohnungen'],
    [await zahl(meters), 'Zähler', 'Zähler'],
    [await zahl(costItems), 'Kostenposition', 'Kostenpositionen'],
    [await zahl(heatingPlants), 'Heizanlage', 'Heizanlagen'],
    [await zahl(closedSettlements), 'abgeschlossene Abrechnung', 'abgeschlossene Abrechnungen'],
    [await zahl(closedSettlementHistory), 'früherer Abschluss', 'frühere Abschlüsse'],
  ] as const
  const inUse = teile.filter(([n]) => n > 0).map(([n, eins, viele]) => `${n} ${n === 1 ? eins : viele}`)
  if (inUse.length > 0) return { removed: false, reason: 'inUse', inUse: inUse.join(', ') }
  // Eine Auswertung verliert mit ihrem Objekt auch den gewählten Zeitraum (#208): Der Fremdschlüssel
  // setzt `property_id` auf NULL, und ein Zeitraum ohne Objekt verletzte die Prüfbedingung.
  await db.transaction(async (tx) => {
    await tx.update(assessments).set({ requestedPeriod: null }).where(eq(assessments.propertyId, id))
    await tx.delete(properties).where(eq(properties.id, id))
  })
  return { removed: true }
}

// ---------- Die Zeilen ----------

const orNull = <T>(value: T | undefined): T | null => value ?? null

const unitRow = (u: Unit) => ({
  id: u.id, propertyId: u.propertyId, name: u.name, areaM2: u.areaM2, participates: u.participates,
  selfUsed: orNull(u.selfUsed), selfPersons: orNull(u.selfPersons), mea: orNull(u.mea), rooms: orNull(u.rooms),
  floor: orNull(u.floor), notes: orNull(u.notes),
})
const tenancyRow = (t: Tenancy) => ({
  id: t.id, unitId: t.unitId, tenantName: t.tenantName, persons: t.persons, start: t.start, end: t.end,
  email: orNull(t.email), phone: orNull(t.phone), correspondenceAddress: orNull(t.correspondenceAddress),
  iban: orNull(t.iban), contractDate: orNull(t.contractDate), depositCents: orNull(t.depositCents),
  depositStatus: orNull(t.depositStatus), notes: orNull(t.notes),
  costModel: orNull(t.costModel), heatingModel: orNull(t.heatingModel),
})
const costItemRow = (c: CostItem) => ({
  id: c.id, propertyId: c.propertyId, period: c.period, category: c.category, description: c.description, vendor: orNull(c.vendor),
  amountCents: c.amountCents, key: c.key, directUnitId: c.directUnitId ?? null,
  meterType: c.meterType ?? null, labor35aCents: orNull(c.labor35aCents), invoiceFile: orNull(c.invoiceFile),
  externalMeasure: c.externalBasis?.measure ?? null, externalTotal: c.externalBasis?.total ?? null,
  externalTotalCents: c.externalBasis?.totalCents ?? null,
  participantsLimited: Array.isArray(c.participantUnitIds),
  serviceFrom: orNull(c.serviceFrom), serviceTo: orNull(c.serviceTo), taxYear: orNull(c.taxYear), heatingPart: orNull(c.heatingPart),
  heatingPlantId: c.heatingPlantId ?? null,
  fuelDeliveryId: c.fuelDeliveryId ?? null,
})
const meterRow = (m: Meter) => ({
  id: m.id, propertyId: m.propertyId, name: m.name, unitId: m.unitId, type: m.type, meterNumber: orNull(m.meterNumber), unit: m.unit,
  heatingPlantId: m.heatingPlantId ?? null, heatingRole: m.heatingRole ?? null, remoteReadable: m.remoteReadable ?? null, installedOn: m.installedOn ?? null,
})
const readingRow = (r: Reading) => ({
  id: r.id, meterId: r.meterId, date: r.date, value: r.value,
  replacement: orNull(r.replacement), oldEndValue: orNull(r.oldEndValue), note: orNull(r.note),
})
const paymentRow = (p: Payment) => ({
  id: p.id, tenancyId: p.tenancyId, date: p.date, amountCents: p.amountCents, note: orNull(p.note),
})

// Die Untertabellen eines Mietverhältnisses, ganz ersetzt. Siehe die Begründung am Kopf.
async function writeTenancyChildren(db: Executor, t: Tenancy): Promise<void> {
  await db.delete(personHistory).where(eq(personHistory.tenancyId, t.id))
  await db.delete(prepayments).where(eq(prepayments.tenancyId, t.id))
  await db.delete(flatRates).where(eq(flatRates.tenancyId, t.id))
  const pauschalen = t.flatRates ?? []
  if (pauschalen.length > 0) {
    await db.insert(flatRates).values(pauschalen.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  }
  await db.delete(baseRents).where(eq(baseRents.tenancyId, t.id))
  await db.delete(prepaymentOverrides).where(eq(prepaymentOverrides.tenancyId, t.id))
  await db.delete(heatingPrepayments).where(eq(heatingPrepayments.tenancyId, t.id))
  const heizstaffel = t.heatingPrepayments ?? []
  if (heizstaffel.length > 0) {
    await db.insert(heatingPrepayments).values(heizstaffel.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  }
  await db.delete(heatingPrepaymentOverrides).where(eq(heatingPrepaymentOverrides.tenancyId, t.id))
  const heizkorrekturen = t.heatingPrepaymentOverrides ?? []
  if (heizkorrekturen.length > 0) await db.insert(heatingPrepaymentOverrides).values(heizkorrekturen.map((o) => ({ tenancyId: t.id, ...o })))
  if (t.personHistory.length > 0) {
    await db.insert(personHistory).values(t.personHistory.map((e) => ({ tenancyId: t.id, from: e.from, persons: e.persons })))
  }
  if (t.prepayments.length > 0) {
    await db.insert(prepayments).values(t.prepayments.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  }
  if (t.baseRents.length > 0) {
    await db.insert(baseRents).values(t.baseRents.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  }
  const korrekturen = Object.entries(t.prepaymentOverrides).flatMap(([schluessel, betrag]) => {
    const period = parsePeriodKey(schluessel)
    return period === null ? [] : [{ tenancyId: t.id, period, amountCents: betrag }]
  })
  if (korrekturen.length > 0) await db.insert(prepaymentOverrides).values(korrekturen)
}

// Die Untertabellen einer Kostenposition, ganz ersetzt: vereinbarte Anteile, Teilnehmer (#94)
// und Einzelbeträge (#94).
async function writeCostItemShares(db: Executor, c: CostItem): Promise<void> {
  await db.delete(costItemShares).where(eq(costItemShares.costItemId, c.id))
  const anteile = Object.entries(c.customShares ?? {})
  if (anteile.length > 0) {
    await db.insert(costItemShares).values(anteile.map(([unitId, percent]) => ({ costItemId: c.id, unitId, percent })))
  }
  await db.delete(costItemParticipants).where(eq(costItemParticipants.costItemId, c.id))
  const teilnehmer = c.participantUnitIds ?? []
  if (teilnehmer.length > 0) {
    await db.insert(costItemParticipants).values(teilnehmer.map((unitId) => ({ costItemId: c.id, unitId })))
  }
  await db.delete(costItemAmounts).where(eq(costItemAmounts.costItemId, c.id))
  const betraege = Object.entries(c.tenancyAmounts ?? {})
  if (betraege.length > 0) {
    await db.insert(costItemAmounts).values(betraege.map(([tenancyId, amountCents]) => ({ costItemId: c.id, tenancyId, amountCents })))
  }
  await db.delete(costItemSelfAmounts).where(eq(costItemSelfAmounts.costItemId, c.id))
  const eigen = Object.entries(c.selfAmounts ?? {})
  if (eigen.length > 0) {
    await db.insert(costItemSelfAmounts).values(eigen.map(([unitId, amountCents]) => ({ costItemId: c.id, unitId, amountCents })))
  }
}

// ---------- Ein Deskriptor je Sammlung ----------
//
// **Die Fallunterscheidung steht genau einmal**, nämlich in `withCollection` unten. Alles andere
// arbeitet mit dem Deskriptor, und der hält je Sammlung zusammen, was zusammengehört: lesen,
// leer anlegen, verschmelzen, einfügen, ändern, löschen.
//
// Der erste Entwurf dieser Datei hat die Sammlungen an ihren Feldern erkannt (`'areaM2' in
// current`). Das ist Duck-Typing: Der Übersetzer sichert dabei nichts zu, zwei Sammlungen mit
// ähnlichen Feldern lassen sich verwechseln, und beim nächsten Datentyp bricht es still. Hier
// bindet `Collection<T>` die sechs Funktionen aneinander; wer eine Sammlung hinzufügt, bekommt
// vom Übersetzer gesagt, was ihr noch fehlt.
type Collection<T extends CollectionEntity> = {
  read: (db: Database) => Promise<T[]>
  // Hält die Grenze zwischen den Objekten (#92), vor dem Schreiben. `before` ist beim Anlegen
  // `null`. Eigens und nicht in `merge`, weil die Prüfung die Datenbank fragen muss.
  guard: (db: Executor, before: T | null, after: T, body: unknown) => Promise<void>
  empty: (id: string) => T
  merge: (current: T, body: unknown) => T
  insert: (db: Executor, entity: T) => Promise<void>
  replace: (db: Executor, entity: T) => Promise<void>
  remove: (db: Executor, id: string) => Promise<void>
}

async function writeUnitChildren(db: Executor, u: Unit): Promise<void> {
  await db.delete(unitNoConnection).where(eq(unitNoConnection.unitId, u.id))
  const types = u.noConnection ?? []
  if (types.length > 0) await db.insert(unitNoConnection).values(types.map((meterType) => ({ unitId: u.id, meterType })))
}

const unitCollection: Collection<Unit> = {
  guard: guardUnit,
  read: readUnits,
  empty: emptyUnit,
  merge: mergeUnit,
  insert: async (db, u) => {
    await db.insert(units).values(unitRow(u))
    await writeUnitChildren(db, u)
  },
  replace: async (db, u) => {
    await db.update(units).set(unitRow(u)).where(eq(units.id, u.id))
    await writeUnitChildren(db, u)
  },
  remove: async (db, id) => { await db.delete(units).where(eq(units.id, id)) },
}

const tenancyCollection: Collection<Tenancy> = {
  guard: guardTenancy,
  read: readTenancies,
  empty: emptyTenancy,
  merge: mergeTenancy,
  insert: async (db, t) => {
    await db.insert(tenancies).values(tenancyRow(t))
    await writeTenancyChildren(db, t)
  },
  replace: async (db, t) => {
    await db.update(tenancies).set(tenancyRow(t)).where(eq(tenancies.id, t.id))
    await writeTenancyChildren(db, t)
  },
  remove: async (db, id) => { await db.delete(tenancies).where(eq(tenancies.id, id)) },
}

const costItemCollection: Collection<CostItem> = {
  guard: guardCostItem,
  read: readCostItems,
  empty: emptyCostItem,
  merge: mergeCostItem,
  insert: async (db, c) => {
    // Eine neue Heizposition ohne Angabe gehört zur Anlage ihres Objekts (Heizung PR 4). `undefined`
    // heißt „nicht angegeben“, `null` „ausdrücklich ohne“; nur das Erste wird ergänzt.
    const entity = c.heatingPlantId === undefined ? { ...c, ...(await defaultHeatingPlant(db, c)) } : c
    await db.insert(costItems).values(costItemRow(entity))
    await writeCostItemShares(db, entity)
  },
  replace: async (db, c) => {
    // Wird eine Position zur Heizposition, bekommt sie die Anlage wie beim Anlegen (Durchsicht von #230).
    const entity = c.heatingPlantId === undefined ? { ...c, ...(await defaultHeatingPlant(db, c)) } : c
    await db.update(costItems).set(costItemRow(entity)).where(eq(costItems.id, entity.id))
    await writeCostItemShares(db, entity)
  },
  remove: async (db, id) => {
    const [c] = await db.select({ fuelDeliveryId: costItems.fuelDeliveryId, period: costItems.period }).from(costItems).where(eq(costItems.id, id))
    if (c) await guardFrozenLink(db, { id, fuelDeliveryId: c.fuelDeliveryId, period: c.period }, null)
    await db.delete(costItems).where(eq(costItems.id, id))
  },
}

const meterCollection: Collection<Meter> = {
  guard: guardMeter,
  read: readMeters,
  empty: emptyMeter,
  merge: mergeMeter,
  insert: async (db, m) => { await db.insert(meters).values(meterRow(m)) },
  replace: async (db, m) => { await db.update(meters).set(meterRow(m)).where(eq(meters.id, m.id)) },
  remove: async (db, id) => { await db.delete(meters).where(eq(meters.id, id)) },
}

const readingCollection: Collection<Reading> = {
  guard: guardReading,
  read: readReadings,
  empty: emptyReading,
  merge: mergeReading,
  insert: async (db, r) => { await db.insert(readings).values(readingRow(r)) },
  replace: async (db, r) => { await db.update(readings).set(readingRow(r)).where(eq(readings.id, r.id)) },
  // Eine Ablesung des Versorgungszählers in einer abgeschlossenen Heizperiode bleibt (Heizung PR 7).
  remove: async (db, id) => {
    const [r] = await db.select({ meterId: readings.meterId, date: readings.date }).from(readings).where(eq(readings.id, id))
    if (r) await guardSupplyReading(db, r)
    await db.delete(readings).where(eq(readings.id, id))
  },
}

const paymentCollection: Collection<Payment> = {
  guard: noGuard,
  read: readPayments,
  empty: emptyPayment,
  merge: mergePayment,
  insert: async (db, p) => { await db.insert(payments).values(paymentRow(p)) },
  replace: async (db, p) => { await db.update(payments).set(paymentRow(p)).where(eq(payments.id, p.id)) },
  remove: async (db, id) => { await db.delete(payments).where(eq(payments.id, id)) },
}

// Der Rückruf bekommt den Deskriptor **mit seinem eigenen Typ**, nicht als Vereinigung der
// sechs. Nur so hält der Übersetzer `current`, `merge` und `insert` zusammen; über einen
// Zugriff wie `DESKRIPTOREN[coll]` wäre jedes davon eine Vereinigung, und jeder Aufruf müsste
// behaupten, welcher Fall gerade vorliegt. Der `switch` ist erschöpfend, einen Rückfall gibt es
// deshalb nicht: Kommt eine Sammlung hinzu, meldet der Übersetzer den fehlenden Zweig.
function withCollection<R>(coll: CollectionName, use: <T extends CollectionEntity>(c: Collection<T>) => R): R {
  switch (coll) {
    case 'units': return use(unitCollection)
    case 'tenancies': return use(tenancyCollection)
    case 'costItems': return use(costItemCollection)
    case 'meters': return use(meterCollection)
    case 'readings': return use(readingCollection)
    case 'payments': return use(paymentCollection)
  }
}

// ---------- Lesen ----------

export async function listCollection(db: Database, coll: CollectionName): Promise<CollectionEntity[]> {
  return withCollection<Promise<CollectionEntity[]>>(coll, (c) => c.read(db))
}

export async function findEntity(db: Database, coll: CollectionName, id: string): Promise<CollectionEntity | undefined> {
  const alle = await listCollection(db, coll)
  return alle.find((eintrag) => eintrag.id === id)
}

// ---------- Anlegen und Ändern ----------
//
// Beide Wege gehen durch dieselbe Verschmelzung, damit kein Feld beim Anlegen anders behandelt
// wird als beim Ändern. Geschrieben wird in einer Transaktion, denn ein Mietverhältnis und eine
// Kostenposition liegen über mehrere Tabellen; bricht etwas dazwischen ab, bleibt nichts Halbes
// zurück.
//
// Zurückgegeben wird, was **in der Datenbank steht**, und nicht, was hineingeschickt wurde. Der
// Unterschied ist keiner auf dem Papier: Was die Spalten nicht aufnehmen, fehlt danach, und die
// Oberfläche soll denselben Stand sehen wie der nächste Aufruf.

export async function createEntity(db: Database, coll: CollectionName, id: string, body: unknown): Promise<CollectionEntity> {
  await withCollection<Promise<void>>(coll, async (c) => {
    const entity = c.merge(c.empty(id), body)
    await db.transaction(async (tx) => {
      await c.guard(tx, null, entity, body)
      await c.insert(tx, entity)
    })
  })
  const gespeichert = await findEntity(db, coll, id)
  if (!gespeichert) throw new Error('Der Datensatz ist nach dem Anlegen nicht auffindbar.')
  return gespeichert
}

// `null`, wenn es den Datensatz nicht gibt; die Route macht daraus ihre 404.
export async function updateEntity(db: Database, coll: CollectionName, id: string, body: unknown): Promise<CollectionEntity | null> {
  const geschrieben = await withCollection<Promise<boolean>>(coll, async (c) => {
    const current = (await c.read(db)).find((eintrag) => eintrag.id === id)
    if (!current) return false
    const entity = c.merge(current, body)
    await db.transaction(async (tx) => {
      await c.guard(tx, current, entity, body)
      await c.replace(tx, entity)
    })
    return true
  })
  if (!geschrieben) return null
  return (await findEntity(db, coll, id)) ?? null
}

// ---------- Löschen ----------
//
// **Die Kaskade erledigen die Fremdschlüssel**, nicht eine Schleife in der Route. Heute geht
// index.ts von Hand durch Mietverhältnisse, Zähler, Ablesungen und Zahlungen; bricht das
// mittendrin ab, bleiben Reste. Das Schema beschreibt dieselben Wege als `ON DELETE CASCADE`
// (Wohnung zu Mietverhältnissen zu Zahlungen, Wohnung zu Zählern zu Ablesungen, Wohnung zu
// vereinbarten Anteilen, Kostenposition zu vereinbarten Anteilen), und die Datenbank führt sie
// in einem Schritt aus.
//
// **Eine Ausnahme steht im Schema und gilt weiter:** `cost_items.direct_unit_id` ist `SET NULL`
// und nicht `CASCADE`. Die Rechnung ist bezahlt worden und gehört weiter in die Abrechnung des
// Jahres; sie mitzulöschen veränderte die Summe einer bereits abgerechneten Vergangenheit.
export async function removeEntity(db: Database, coll: CollectionName, id: string): Promise<boolean> {
  return withCollection<Promise<boolean>>(coll, async (c) => {
    if (!(await c.read(db)).some((eintrag) => eintrag.id === id)) return false
    await db.transaction(async (tx) => c.remove(tx, id))
    return true
  })
}

// ---------- Für die Belegbuchung (#170) ----------
//
// Die Buchung legt Positionen an und ändert ihre Beträge **innerhalb ihrer eigenen Transaktion**
// (db/booking.ts). `createEntity` und `updateEntity` öffnen jeweils eine eigene; SQLite kennt
// keine geschachtelte. Deshalb hier dieselbe Verschmelzung, derselbe Wächter und dasselbe Schreiben,
// nur ohne Transaktion: Ein Weg mit eigenen Regeln wäre ein zweiter, der auseinanderläuft.
export async function insertCostItemIn(tx: Executor, id: string, body: unknown, hints: { invoiceDate?: string | null } = {}): Promise<void> {
  const merged = mergeCostItem(emptyCostItem(id), body)
  // Mit Rechnungsdatum (Belegbuchung) schon hier die Anlage und ihre Heizperiode, damit das Jahr der
  // Zahlung aus dem Beleg kommt; die Schreibprüfung sieht dann die Heizperiode.
  const entity = hints.invoiceDate !== undefined && merged.heatingPlantId === undefined ? { ...merged, ...(await defaultHeatingPlant(tx, merged, hints.invoiceDate)) } : merged
  await guardCostItem(tx, null, entity, body)
  await costItemCollection.insert(tx, entity)
}

export async function patchCostItemIn(tx: Executor, current: CostItem, body: unknown): Promise<void> {
  const entity = mergeCostItem(current, body)
  await guardCostItem(tx, current, entity, body)
  await costItemCollection.replace(tx, entity)
}

// ---------- Eine Rechnung aufteilen (#208, Entwurf 3.4) ----------

export type PartWrite = { period: PeriodKey; amountCents: number; labor35aCents: number | null; description: string; taxYear: number | null }

// Schreibt die Teile einer Rechnung durch dieselbe Verschmelzung, denselben Wächter und dasselbe
// Schreiben wie das gewöhnliche Anlegen; `base` gibt alles Übrige (Schlüssel, Anteile, Beleg).
// `keepId`: Die Kennung bleibt am Teil dieses Zeitraums, sonst am ersten. Ohne Transaktion, denn
// beide Aufrufer (Aufteilen, Wechsel des Rhythmus) laufen schon in einer.
export async function writeCostItemParts(tx: Executor, base: CostItem, parts: readonly PartWrite[], newId: () => string, keepId: string | null): Promise<string[]> {
  const keepAt = Math.max(0, parts.findIndex((p) => p.period === base.period))
  const written: string[] = []
  for (const [i, part] of parts.entries()) {
    const id = keepId !== null && i === keepAt ? keepId : newId()
    const entity = mergeCostItem(keepId !== null && i === keepAt ? base : { ...base, id }, {
      period: part.period, amountCents: part.amountCents, labor35aCents: part.labor35aCents, description: part.description, taxYear: part.taxYear,
    })
    await guardCostItem(tx, keepId !== null && i === keepAt ? base : null, entity, {}, { splitPart: true })
    if (keepId !== null && i === keepAt) await costItemCollection.replace(tx, entity)
    else await costItemCollection.insert(tx, entity)
    written.push(id)
  }
  return written
}

// Schreibt eine aufgeteilte Rechnung neu (Nachprüfung von #226, 2): `members` sind ihre bisherigen
// Teile, `parts` die neuen. Ein Teil behält die Kennung des bisherigen Teils desselben Zeitraums,
// sonst die eines übrigen; was übrig bleibt, wird gelöscht. Vorher wandern die gebuchten Zeilen
// einer Belegauswertung und der Beleg auf einen verbleibenden Teil derselben Rechnung: Mit
// `SET NULL` stünde die schon gebuchte Rechnung sonst wieder offen im Posteingang und ließe sich ein
// zweites Mal buchen (#184). Ohne Transaktion, der Aufrufer läuft in einer.
export async function rewriteCostItemFamily(tx: Executor, members: readonly CostItem[], parts: readonly PartWrite[], newId: () => string): Promise<string[]> {
  const first = members[0]
  if (first === undefined) return []
  const unused = [...members]
  const take = (m: CostItem | undefined): CostItem | undefined => {
    if (m !== undefined) unused.splice(unused.indexOf(m), 1)
    return m
  }
  const exact = parts.map((p) => take(unused.find((m) => m.period === p.period)))
  const chosen = exact.map((m) => m ?? take(unused[0]))
  const written: string[] = []
  for (const [i, part] of parts.entries()) {
    const fields = { period: part.period, amountCents: part.amountCents, labor35aCents: part.labor35aCents, description: part.description, taxYear: part.taxYear }
    const member = chosen[i]
    if (member !== undefined) {
      const entity = mergeCostItem(member, fields)
      await guardCostItem(tx, member, entity, {}, { splitPart: true })
      await costItemCollection.replace(tx, entity)
      written.push(member.id)
    } else {
      const id = newId()
      const entity = mergeCostItem({ ...first, id }, fields)
      await guardCostItem(tx, null, entity, {}, { splitPart: true })
      await costItemCollection.insert(tx, entity)
      written.push(id)
    }
  }
  const keep = chosen.find((m) => m !== undefined)
  for (const m of unused) {
    const booked = await tx.select({ idx: assessmentLines.idx }).from(assessmentLines).where(eq(assessmentLines.costItemId, m.id))
    if (keep === undefined && (booked.length > 0 || m.invoiceFile !== undefined)) {
      throw new PeriodConflict(`An „${m.description}“ hängen ein Beleg oder gebuchte Zeilen einer Belegauswertung, und nach dem Wechsel bliebe kein Teil dieser Rechnung, der sie übernehmen könnte. Gespeichert wurde nichts.`)
    }
    if (keep !== undefined) {
      await tx.update(assessmentLines).set({ costItemId: keep.id }).where(eq(assessmentLines.costItemId, m.id))
      if (m.invoiceFile !== undefined && keep.invoiceFile === undefined) await tx.update(costItems).set({ invoiceFile: m.invoiceFile }).where(eq(costItems.id, keep.id))
    }
    await costItemCollection.remove(tx, m.id)
  }
  return written
}

// Die Rechnung, wie sie aufgeteilt würde: aus der gespeicherten Position (`currentId`) und dem
// Rumpf, sonst aus dem Rumpf allein. Das Objekt kommt bei einer vorhandenen Position von ihr.
async function splitBase(db: Database, propertyId: string | null, body: unknown, currentId: string | null): Promise<{ base: CostItem; from: string; to: string }> {
  const current = currentId === null ? undefined : (await readCostItems(db)).find((c) => c.id === currentId)
  if (currentId !== null && !current) throw new PeriodError('Diese Kostenposition gibt es nicht (mehr). Bitte laden Sie die Seite neu.')
  // Ein schon aufgeteilter Teil ist nicht die ganze Rechnung (Durchsicht von #226, C1): Ihn noch
  // einmal aufzuteilen, verteilte seinen Anteil ein zweites Mal über beide Zeiträume.
  if (current && isSplitPart(await rulesForProperty(db, current.propertyId), current)) throw new PeriodError(splitPartMessage(current))
  const base = mergeCostItem(current ?? emptyCostItem(currentId ?? 'vorschau'), current ? body : { ...Object(body), propertyId })
  if (base.category === HEATING_CATEGORY) {
    throw new PeriodError('Heizkosten teilt Mietfuchs nicht nach Tagen auf: Sie müssen den Verbrauch im Abrechnungszeitraum abbilden (BGH VIII ZR 156/11).')
  }
  if (base.serviceFrom === undefined || base.serviceTo === undefined || !isIsoDate(base.serviceFrom) || !isIsoDate(base.serviceTo) || base.serviceFrom > base.serviceTo) {
    throw new PeriodError(`Zum Aufteilen braucht „${base.description}“ einen Leistungszeitraum mit Beginn und Ende.`)
  }
  return { base, from: base.serviceFrom, to: base.serviceTo }
}

export async function previewCostItemSplit(db: Database, propertyId: string | null, body: unknown, currentId: string | null): Promise<SplitPreviewPart[]> {
  const { base, from, to } = await splitBase(db, propertyId, body, currentId)
  const rules = await rulesForProperty(db, base.propertyId)
  const closed = new Set((await readClosedSettlements(db)).filter((c) => c.propertyId === base.propertyId).map((c) => c.period))
  return splitByService(rules, { ...base, serviceFrom: from, serviceTo: to }).map((p) => ({
    period: p.period.key,
    label: periodLabel(p.period),
    days: p.days,
    amountCents: p.amountCents,
    labor35aCents: p.labor35aCents,
    description: p.description,
    needsTaxYear: spansTwoYears(p.period),
    closed: closed.has(p.period.key),
  }))
}

// Speichert eine Rechnung als ihre Teile, in einer Transaktion: alle oder keiner. Ein Teil in
// einem abgeschlossenen Zeitraum lehnt ab (409), bevor etwas geschrieben ist. Das Jahr der Zahlung
// des Rumpfes gilt für jeden Teil über zwei Kalenderjahre; ein Teil in einem Kalenderjahr hat
// keines (Entwurf 3.10). Gelesen wird vor der Transaktion: Die Lesefunktionen aus read.ts nehmen
// die Verbindung und keine Transaktion, und die Schlange in open.ts lässt zwischen Lesen und
// Schreiben keine andere Anfrage herein.
export async function saveCostItemSplit(db: Database, propertyId: string | null, body: unknown, currentId: string | null, newId: () => string): Promise<CostItem[]> {
  const parts = await previewCostItemSplit(db, propertyId, body, currentId)
  if (parts.length < 2) throw new PeriodError('Diese Rechnung liegt in einem einzigen Abrechnungszeitraum; speichern Sie sie bitte gewöhnlich.')
  const zu = parts.find((p) => p.closed)
  if (zu) throw new PeriodConflict(`Die Abrechnung ${zu.label} ist abgeschlossen und bleibt, wie sie verschickt wurde. Öffnen Sie sie wieder, wenn die Rechnung anteilig hinein soll.`)
  const { base } = await splitBase(db, propertyId, body, currentId)
  const ids = await db.transaction((tx) => writeCostItemParts(tx, base, parts.map((p) => ({
    period: p.period, amountCents: p.amountCents, labor35aCents: p.labor35aCents, description: p.description,
    taxYear: p.needsTaxYear ? base.taxYear ?? null : null,
  })), newId, currentId))
  const all = await readCostItems(db)
  return ids.map((id) => all.find((c) => c.id === id)).filter((c): c is CostItem => c !== undefined)
}

// ---------- Der Mieterwechsel (#150) ----------
//
// **Alles oder nichts.** Der Assistent in Stammdaten.tsx schickte drei Anfragen nacheinander:
// altes Mietverhältnis beenden, Zwischenablesungen anlegen, Nachmieter anlegen. Lehnte der
// Server den dritten Schritt ab (etwa eine negative Vorauszahlung an der Prüfbedingung), standen
// die ersten beiden schon da, und ein zweiter Versuch legte die Ablesungen doppelt an. Hier läuft
// der ganze Wechsel in einer Transaktion, und zwar durch dieselben Verschmelzungen, Wächter und
// Einfügungen wie die einzelnen Routen: Ein Mietverhältnis, das beim Wechsel anders gelesen
// würde als beim gewöhnlichen Anlegen, wäre ein zweiter Weg mit eigenen Regeln.
//
// **Geprüft wird vorher, was die Datenbank nicht prüfen kann**: dass der Auszug nach dem Einzug
// und der Einzug des Nachmieters nach dem Auszug liegt, dass jeder Stand eine Zahl ist und dass
// jeder Zähler zur Wohnung gehört oder der Hauptzähler desselben Objekts ist. Der Nachmieter zieht
// immer in dieselbe Wohnung; eine andere Kennung im Rumpf ist ein Fehler und kein Umzug.
//
// **Nur ein offenes Mietverhältnis wird gewechselt.** Ein zweimal abgeschickter Wechsel trifft
// sonst ein schon beendetes und legt Ablesungen und Nachmieter ein zweites Mal an.

// Eine Ablehnung mit einer Meldung für den Nutzer; die Fehlerbehandlung in index.ts gibt sie
// unverändert weiter.
export class TenantChangeError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type TenantChange = { ended: Tenancy, newTenancy: Tenancy | null, readings: Reading[] }

// „2025-06-30“ als „30.06.2025“, für Meldungen an den Nutzer.
const isoToGerman = (iso: string): string => iso.split('-').reverse().join('.')
const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && ISO_DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

// `null`, wenn es das Mietverhältnis nicht gibt; die Route macht daraus ihre 404.
export async function changeTenant(
  db: Database, propertyId: string, tenancyId: string, body: unknown, nextId: () => string,
): Promise<TenantChange | null> {
  const current = (await readTenancies(db)).find((t) => t.id === tenancyId)
  if (!current) return null
  const wohnung = (await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, current.unitId)))[0]
  if (wohnung?.propertyId !== propertyId) {
    throw new CrossPropertyError(
      `Das Mietverhältnis „${current.tenantName}“ gehört nicht zu Objekt ${await propertyName(db, propertyId)}. ` +
        'Bitte laden Sie die Seite neu.',
    )
  }
  if (current.end !== null) {
    throw new TenantChangeError(409,
      `Das Mietverhältnis „${current.tenantName}“ ist bereits zum ${isoToGerman(current.end)} beendet. Der Mieterwechsel ist ` +
        'vermutlich schon gespeichert; bitte laden Sie die Seite neu.')
  }

  const end = raw(body, 'end')
  if (!isIsoDate(end) || end < current.start) {
    throw new TenantChangeError(400, 'Bitte ein gültiges Auszugsdatum angeben, das nicht vor dem Einzug liegt.')
  }

  // Die Zwischenablesungen: je Zähler höchstens eine, nur Zähler der Wohnung und Hauptzähler.
  const zaehler = (await readMeters(db)).filter((m) => m.propertyId === propertyId)
  const angaben = raw(body, 'readings') ?? []
  if (!Array.isArray(angaben)) throw new TenantChangeError(400, 'Die Zwischenablesungen fehlen oder sind unlesbar.')
  const gesehen = new Set<string>()
  const ablesungen: Reading[] = []
  for (const angabe of angaben) {
    const meterId = raw(angabe, 'meterId')
    const meter = zaehler.find((m) => m.id === meterId)
    if (!meter || (meter.unitId !== null && meter.unitId !== current.unitId)) {
      throw new TenantChangeError(400,
        'Ein Zähler der Zwischenablesung gehört nicht zu dieser Wohnung oder zu diesem Objekt. Bitte laden Sie die Seite neu.')
    }
    const value = asOptionalNumber(raw(angabe, 'value'))
    if (value === undefined) throw new TenantChangeError(400, `Der Zählerstand für „${meter.name}“ ist keine gültige Zahl.`)
    if (gesehen.has(meter.id)) throw new TenantChangeError(400, `Für den Zähler „${meter.name}“ stehen zwei Stände da.`)
    gesehen.add(meter.id)
    ablesungen.push(mergeReading(emptyReading(nextId()), {
      meterId: meter.id, date: end, value, note: `Zwischenablesung Mieterwechsel ${current.tenantName}`,
    }))
  }

  // Der Nachmieter, oder Leerstand.
  const nachmieterRumpf = raw(body, 'newTenancy')
  let nachmieter: Tenancy | null = null
  if (nachmieterRumpf !== null && nachmieterRumpf !== undefined) {
    if (!isObject(nachmieterRumpf)) throw new TenantChangeError(400, 'Die Angaben zum neuen Mietverhältnis sind unlesbar.')
    if (has(nachmieterRumpf, 'unitId') && raw(nachmieterRumpf, 'unitId') !== current.unitId) {
      throw new CrossPropertyError('Beim Mieterwechsel zieht der neue Mieter in dieselbe Wohnung. Bitte laden Sie die Seite neu.')
    }
    nachmieter = mergeTenancy(emptyTenancy(nextId()), { ...Object(nachmieterRumpf), unitId: current.unitId, end: null })
    if (!isIsoDate(nachmieter.start) || nachmieter.start <= end) {
      throw new TenantChangeError(400, 'Der Einzug des neuen Mieters muss ein gültiges Datum nach dem Auszug sein.')
    }
  }

  const beendet = mergeTenancy(current, { end })
  await db.transaction(async (tx) => {
    await guardTenancy(tx, current, beendet, { end })
    await tenancyCollection.replace(tx, beendet)
    for (const ablesung of ablesungen) await readingCollection.insert(tx, ablesung)
    if (nachmieter) {
      await guardTenancy(tx, null, nachmieter, nachmieterRumpf)
      await tenancyCollection.insert(tx, nachmieter)
    }
  })

  // Zurück kommt, was in der Datenbank steht, wie beim Anlegen.
  const mietverhaeltnisse = await readTenancies(db)
  const gelesen = (id: string): Tenancy => {
    const t = mietverhaeltnisse.find((eintrag) => eintrag.id === id)
    if (!t) throw new Error('Das Mietverhältnis ist nach dem Mieterwechsel nicht auffindbar.')
    return t
  }
  const neueIds = new Set(ablesungen.map((r) => r.id))
  return {
    ended: gelesen(current.id),
    newTenancy: nachmieter ? gelesen(nachmieter.id) : null,
    readings: (await readReadings(db)).filter((r) => neueIds.has(r.id)),
  }
}

// ---------- Die Einstellungen ----------

// Sie sind genau eine Zeile, dazu bis zu zwei für die KI-Plätze; die Prüfbedingung des Schemas
// sagt es. Geschrieben wird deshalb nicht Feld für Feld, sondern die Zeile als Ganzes ersetzt.
// Gebaut wird sie mit derselben Funktion wie beim Umstieg (db/write.ts): Zwei Fassungen liefen
// auseinander, sobald jemand ein Feld ergänzt, und gemerkt hätte man es erst daran, dass eine
// Einstellung nach dem Umstieg anders dasteht als nach dem Speichern.
export async function writeSettings(db: Database, settingsToStore: MigratedSettings): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(aiSlots)
    await tx.delete(settings)
    await tx.insert(settings).values(settingsRow(settingsToStore))
    await tx.insert(aiSlots).values(aiSlotRows(settingsToStore.ai))
  })
}

// ---------- Die abgeschlossene Abrechnung ----------
//
// Sie ist keine gewöhnliche Sammlung, deshalb eigene Vorgänge und keine Verschmelzung: Angelegt
// wird sie nicht mit einem beliebigen Rumpf, sondern mit dem Berechnungsstand, den der Server
// selbst gerade gerechnet hat. Der eingefrorene Stand bleibt dabei JSON, siehe die Begründung am
// Schema: Er ist ein Archivstück, das wortgleich erhalten bleiben soll, auch wenn spätere
// Versionen anders rechnen.

// Immer je Objekt und Zeitraum (#92, #208): Vorher genügte das Jahr, und mit einem zweiten Objekt
// hätten Versanddatum und Wiederöffnen die Abrechnung des falschen Hauses getroffen.
export async function findClosedSettlement(db: Database, propertyId: string, period: PeriodKey): Promise<StoredClosedSettlement | undefined> {
  return (await readClosedSettlements(db)).find((eintrag) => eintrag.propertyId === propertyId && eintrag.period === period)
}

const closedOf = (propertyId: string, period: PeriodKey) =>
  and(eq(closedSettlements.propertyId, propertyId), eq(closedSettlements.period, period))

export async function closeSettlement(
  db: Executor,
  entry: { id: string, propertyId: string, period: PeriodKey, closedAt: string, sentAt: string | null, settlement: unknown },
): Promise<void> {
  await db.insert(closedSettlements).values(entry)
}

// `false`, wenn es für den Zeitraum keine abgeschlossene Abrechnung gibt; die Route macht daraus
// ihre 404.
export async function setSentAt(db: Database, propertyId: string, period: PeriodKey, sentAt: string | null): Promise<boolean> {
  if (!(await findClosedSettlement(db, propertyId, period))) return false
  await db.update(closedSettlements).set({ sentAt }).where(closedOf(propertyId, period))
  return true
}

// Wiederöffnen verschiebt den Stand in den Verlauf (#56, Teil 2), statt ihn zu löschen, und zwar
// in einer Transaktion: Scheiterte das Löschen nach dem Einfügen, stünde der Zeitraum sonst zugleich
// als abgeschlossen und im Verlauf da (Befund der Durchsicht). `alsoInTransaction` läuft im selben
// Vorgang mit dem eingefrorenen Stand (Heizung PR 7: die eingefrorenen Lieferungsteile freigeben);
// repository.ts kennt db/fuel.ts nicht, deshalb reicht die Route es herein.
export async function reopenSettlement(
  db: Database,
  propertyId: string,
  period: PeriodKey,
  historyId: string,
  alsoInTransaction: (tx: Executor, settlement: unknown) => Promise<void> = async () => {},
): Promise<boolean> {
  const eintrag = await findClosedSettlement(db, propertyId, period)
  if (!eintrag) return false
  await db.transaction(async (tx) => {
    await tx.insert(closedSettlementHistory).values({
      id: historyId, propertyId, period, closedAt: eintrag.closedAt, sentAt: eintrag.sentAt,
      reopenedAt: new Date().toISOString(), settlement: eintrag.settlement,
    })
    await tx.delete(closedSettlements).where(closedOf(propertyId, period))
    await alsoInTransaction(tx, eintrag.settlement)
  })
  return true
}

export type SettlementHistoryEntry = { id: string, closedAt: string, sentAt: string | null, reopenedAt: string, settlement: unknown }

// Frühere Abschlüsse eines Zeitraums, der zuletzt wiedergeöffnete zuerst.
export async function settlementHistory(db: Database, propertyId: string, period: PeriodKey): Promise<SettlementHistoryEntry[]> {
  const rows = await db
    .select()
    .from(closedSettlementHistory)
    .where(and(eq(closedSettlementHistory.propertyId, propertyId), eq(closedSettlementHistory.period, period)))
    .orderBy(desc(closedSettlementHistory.reopenedAt), desc(sql`rowid`))
  return rows.map((r) => ({ id: r.id, closedAt: r.closedAt, sentAt: r.sentAt, reopenedAt: r.reopenedAt, settlement: r.settlement }))
}

// ---------- Was die Sonderrouten brauchen ----------

// Beim Löschen eines Belegs fragt die Route, ob er noch an einer Kostenposition hängt: über
// `invoice_file` oder über eine gebuchte Zeile seiner Auswertung (Belegbuchung, #170). Ein
// Beleg, der nur so an einer Position hängt, belegt sie genauso.
export async function invoiceFilesInUse(db: Database, files: string[]): Promise<Set<string>> {
  if (files.length === 0) return new Set()
  const direct = await db.select({ file: costItems.invoiceFile }).from(costItems).where(inArray(costItems.invoiceFile, files))
  const booked = await db.select({ file: assessments.file }).from(assessmentLines)
    .innerJoin(assessments, eq(assessments.id, assessmentLines.assessmentId))
    .where(and(inArray(assessments.file, files), isNotNull(assessmentLines.costItemId)))
  return new Set([...direct, ...booked].map((r) => r.file).filter((file) => file !== null))
}

// Ob die Kaskade die vereinbarten Anteile einer gelöschten Wohnung wirklich weggeräumt hat,
// fragt ein Test über diese Abfrage. Sie steht hier und nicht im Test, damit die Tabelle nur an
// einer Stelle bekannt sein muss.
export async function sharesForUnit(db: Database, unitId: string): Promise<number> {
  const rows = await db.select({ unitId: costItemShares.unitId }).from(costItemShares).where(eq(costItemShares.unitId, unitId))
  return rows.length
}
