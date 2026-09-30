// Die Vorgänge auf dem Datenbestand, die die Routen wirklich brauchen, und keiner mehr (#55).
//
// Bis hierher gab es nur „den ganzen Bestand lesen" und „den ganzen Bestand schreiben", weil der
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

import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { CostItem, ExternalBasis, Meter, MeterType, Payment, PersonEntry, PrepaymentEntry, Property, Reading, RentEntry, Tenancy, Unit } from '../../../shared/types.ts'
import type { MigratedSettings } from '../ai/settings.ts'
import { lastPerFrom, straightenPersonHistory } from '../schedule.ts'
import type { Database, Executor } from './client.ts'
import {
  readClosedSettlements, readCostItems, readMeters, readPayments, readProperties, readReadings, readTenancies,
  readUnits, type StoredClosedSettlement,
} from './read.ts'
import {
  aiSlots, baseRents, closedSettlementHistory, closedSettlements, COST_KEYS, COST_MODELS, costItemAmounts, costItemParticipants, costItemSelfAmounts, costItemShares, costItems, DEPOSIT_STATUS, EXTERNAL_MEASURES,
  flatRates, METER_TYPES, meters, payments, personHistory, prepaymentOverrides, prepayments, properties, PROPERTY_KINDS,
  readings, settings, tenancies, unitNoConnection, units,
} from './schema.ts'
import { aiSlotRows, settingsRow } from './write.ts'

export type CollectionName = 'units' | 'tenancies' | 'costItems' | 'meters' | 'readings' | 'payments'
export type CollectionEntity = Unit | Tenancy | CostItem | Meter | Reading | Payment

// ---------- Werkzeug für den Rumpf einer Anfrage ----------
//
// Was hereinkommt, ist beliebiges JSON aus einem Browser. Verengt wird ausschließlich mit
// `typeof` und `Reflect.get`, wie im Validator: Ein angeschriebenes Typprädikat wäre nur eine
// Behauptung, deren Rumpf niemand nachrechnet.

const isObject = (body: unknown): boolean => body !== null && typeof body === 'object'
const has = (body: unknown, key: string): boolean => isObject(body) && Object.hasOwn(Object(body), key)
const raw = (body: unknown, key: string): unknown => (isObject(body) ? Reflect.get(Object(body), key) : undefined)

const asText = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
// `Number.isFinite` schließt NaN und Unendlich aus; beides ergäbe in einer Spalte einen Wert,
// mit dem niemand rechnen kann.
const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const asBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

// Für Felder, die es auch gar nicht geben darf. `null` und ein fehlendes Feld sind dabei
// dasselbe: Beides heißt „nichts eingetragen", und read.ts gibt für beides `undefined` zurück.
const asOptionalText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const asOptionalBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

// Das offene Mietverhältnis und der Hauptzähler ohne Wohnung: Dort ist `null` ein ausdrücklicher
// Wert und kein fehlendes Feld, deshalb eine eigene Lesart.
const asNullableText = (value: unknown): string | null => (typeof value === 'string' ? value : null)

// Nimmt den Wert aus dem Rumpf, wenn der Schlüssel dasteht, sonst den bisherigen.
function merged<T>(body: unknown, key: string, current: T, read: (value: unknown) => T): T {
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
// „es gilt der letzte" würde hier Personentage verschieben, weil die erste Stufe ab Einzug gilt.
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

// Jahr zu Betrag. In der Datei steht der Schlüssel als Text („2024"), in der Spalte als Zahl.
//
// **Verlangt wird genau eine vierstellige Jahreszahl**, dieselbe Grenze, die der Validator beim
// Umstieg zieht. `Number.isInteger(Number(…))` genügte nicht und war zweifach undicht: `Number('')`
// und `Number(' ')` sind 0, ein leerer Schlüssel ergäbe also eine Jahreskorrektur für das Jahr 0.
// Und zwei verschiedene Schlüssel können auf dieselbe Zahl führen („2024" und „2024.0"), womit
// der zusammengesetzte Primärschlüssel den ganzen Vorgang scheitern ließe: Das Mietverhältnis
// wäre dann überhaupt nicht zu speichern.
const YEAR_KEY = /^\d{4}$/

function readAmountsByYear(value: unknown): Record<string, number> {
  if (!isObject(value)) return {}
  const rows: Record<string, number> = {}
  for (const [schluessel, betrag] of Object.entries(Object(value))) {
    if (!YEAR_KEY.test(schluessel)) continue
    const zahl = asOptionalNumber(betrag)
    if (zahl !== undefined) rows[schluessel] = zahl
  }
  return rows
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
// Entwurf standen sie hier abgeschrieben, und drei der Listen waren falsch: „sonstiges" statt
// „sonstig", ein erfundenes „warmwasser", ein fehlendes „teilweise". Der Übersetzer hat es
// gemeldet, aber genau dafür gibt es die eine Quelle; eine zweite Liste ist immer eine, die
// irgendwann abweicht.
//
// Ein unbekannter Wert wird zu „nichts eingetragen" statt zu einem Fehler: Die Spalte ließe ihn
// ohnehin nicht zu, und die Prüfbedingung meldete ihn dann als technischen Befund, wo ein leeres
// Feld die ehrlichere Antwort ist.
const oneOfOrUndefined = <T extends string>(known: readonly T[], value: unknown): T | undefined => {
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
    // `typeof v === 'boolean'` und nicht `!!v`: In JavaScript wäre die Zeichenkette „false" wahr.
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
    prepaymentOverrides: merged(body, 'prepaymentOverrides', current.prepaymentOverrides, readAmountsByYear),
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

function mergeCostItem(current: CostItem, body: unknown): CostItem {
  const shares = merged(body, 'customShares', current.customShares, (v) => (v === null ? null : readShares(v)))
  const participants = merged(body, 'participantUnitIds', current.participantUnitIds, (v) => (v === null ? null : readParticipants(v)))
  const external = merged(body, 'externalBasis', current.externalBasis, readExternalBasis)
  const amounts = merged(body, 'tenancyAmounts', current.tenancyAmounts, (v) => (v === null ? null : readAmounts(v)))
  const selfAmounts = merged(body, 'selfAmounts', current.selfAmounts, (v) => (v === null ? null : readAmounts(v)))
  return {
    id: current.id,
    propertyId: mergedProperty(body, current.propertyId),
    year: merged(body, 'year', current.year, (v) => asNumber(v, current.year)),
    category: merged(body, 'category', current.category, (v) => asText(v, '')),
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
  }
}

function mergeMeter(current: Meter, body: unknown): Meter {
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
  id, propertyId: '', year: new Date().getUTCFullYear(), category: '', description: '', amountCents: 0, key: 'area',
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

async function propertyName(db: Executor, propertyId: string): Promise<string> {
  const rows = await db.select({ name: properties.name }).from(properties).where(eq(properties.id, propertyId))
  const name = rows[0]?.name
  return name ? `„${name}“` : 'ohne Namen'
}

// Wirft, wenn eine der Wohnungen zu einem anderen Objekt gehört. `what` beschreibt den
// Datensatz, der verweist, für die Meldung.
async function sameProperty(db: Executor, propertyId: string, unitIds: string[], what: string): Promise<void> {
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
}

async function guardCostItem(db: Executor, _before: CostItem | null, after: CostItem): Promise<void> {
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
}

// Eine Wohnung darf das Objekt wechseln, solange nichts Objektgebundenes an ihr hängt. Ihr
// Mietverhältnis nimmt sie mit, denn es erbt das Objekt über sie; ein Zähler, eine
// Direktzuordnung oder ein vereinbarter Anteil gehören dagegen zum alten Objekt.
async function guardUnit(db: Executor, before: Unit | null, after: Unit): Promise<void> {
  if (!before || before.propertyId === after.propertyId) return
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

// Ein Mietverhältnis erbt sein Objekt über die Wohnung. Wechselt es in eine Wohnung eines anderen
// Objekts, bleiben seine Einzelbeträge (#94) beim alten zurück; dann lieber ablehnen.
async function guardTenancy(db: Executor, before: Tenancy | null, after: Tenancy): Promise<void> {
  if (!before || before.unitId === after.unitId) return
  const objektVon = async (unitId: string) =>
    (await db.select({ propertyId: units.propertyId }).from(units).where(eq(units.id, unitId)))[0]?.propertyId
  if ((await objektVon(before.unitId)) === (await objektVon(after.unitId))) return
  const betraege = await db.select({ n: count() }).from(costItemAmounts).where(eq(costItemAmounts.tenancyId, after.id))
  if ((betraege[0]?.n ?? 0) === 0) return
  throw new CrossPropertyError(
    `Das Mietverhältnis „${after.tenantName}“ kann nicht in eine Wohnung eines anderen Objekts wechseln, weil noch ` +
      'Einzelbeträge von Kostenpositionen des bisherigen Objekts an ihm hängen. Bitte lösen Sie diese Verweise zuerst.',
  )
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

export type PropertyRemoval = { removed: true } | { removed: false, reason: 'missing' | 'last' } | { removed: false, reason: 'inUse', inUse: string }

// Gelöscht wird nur ein leeres Objekt, und nie das letzte: Eine neue Wohnung braucht eines.
// Was noch darin steht, nennt die Antwort, damit die Oberfläche es sagen kann.
export async function removeProperty(db: Database, id: string): Promise<PropertyRemoval> {
  const alle = await readProperties(db)
  if (!alle.some((p) => p.id === id)) return { removed: false, reason: 'missing' }
  if (alle.length === 1) return { removed: false, reason: 'last' }
  const zahl = async (table: typeof units | typeof meters | typeof costItems | typeof closedSettlements | typeof closedSettlementHistory) =>
    (await db.select({ n: count() }).from(table).where(eq(table.propertyId, id)))[0]?.n ?? 0
  const teile = [
    [await zahl(units), 'Wohnung', 'Wohnungen'],
    [await zahl(meters), 'Zähler', 'Zähler'],
    [await zahl(costItems), 'Kostenposition', 'Kostenpositionen'],
    [await zahl(closedSettlements), 'abgeschlossene Abrechnung', 'abgeschlossene Abrechnungen'],
    [await zahl(closedSettlementHistory), 'früherer Abschluss', 'frühere Abschlüsse'],
  ] as const
  const inUse = teile.filter(([n]) => n > 0).map(([n, eins, viele]) => `${n} ${n === 1 ? eins : viele}`)
  if (inUse.length > 0) return { removed: false, reason: 'inUse', inUse: inUse.join(', ') }
  await db.delete(properties).where(eq(properties.id, id))
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
  id: c.id, propertyId: c.propertyId, year: c.year, category: c.category, description: c.description, vendor: orNull(c.vendor),
  amountCents: c.amountCents, key: c.key, directUnitId: c.directUnitId ?? null,
  meterType: c.meterType ?? null, labor35aCents: orNull(c.labor35aCents), invoiceFile: orNull(c.invoiceFile),
  externalMeasure: c.externalBasis?.measure ?? null, externalTotal: c.externalBasis?.total ?? null,
  externalTotalCents: c.externalBasis?.totalCents ?? null,
  participantsLimited: Array.isArray(c.participantUnitIds),
})
const meterRow = (m: Meter) => ({
  id: m.id, propertyId: m.propertyId, name: m.name, unitId: m.unitId, type: m.type, meterNumber: orNull(m.meterNumber), unit: m.unit,
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
  if (t.personHistory.length > 0) {
    await db.insert(personHistory).values(t.personHistory.map((e) => ({ tenancyId: t.id, from: e.from, persons: e.persons })))
  }
  if (t.prepayments.length > 0) {
    await db.insert(prepayments).values(t.prepayments.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  }
  if (t.baseRents.length > 0) {
    await db.insert(baseRents).values(t.baseRents.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  }
  const jahre = Object.entries(t.prepaymentOverrides)
  if (jahre.length > 0) {
    await db.insert(prepaymentOverrides).values(jahre.map(([jahr, betrag]) => ({ tenancyId: t.id, year: Number(jahr), amountCents: betrag })))
  }
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
  guard: (db: Executor, before: T | null, after: T) => Promise<void>
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
    await db.insert(costItems).values(costItemRow(c))
    await writeCostItemShares(db, c)
  },
  replace: async (db, c) => {
    await db.update(costItems).set(costItemRow(c)).where(eq(costItems.id, c.id))
    await writeCostItemShares(db, c)
  },
  remove: async (db, id) => { await db.delete(costItems).where(eq(costItems.id, id)) },
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
  guard: noGuard,
  read: readReadings,
  empty: emptyReading,
  merge: mergeReading,
  insert: async (db, r) => { await db.insert(readings).values(readingRow(r)) },
  replace: async (db, r) => { await db.update(readings).set(readingRow(r)).where(eq(readings.id, r.id)) },
  remove: async (db, id) => { await db.delete(readings).where(eq(readings.id, id)) },
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
      await c.guard(tx, null, entity)
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
      await c.guard(tx, current, entity)
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

// Immer je Objekt und Jahr (#92): Vorher genügte das Jahr, und mit einem zweiten Objekt hätten
// Versanddatum und Wiederöffnen die Abrechnung des falschen Hauses getroffen.
export async function findClosedSettlement(db: Database, propertyId: string, year: number): Promise<StoredClosedSettlement | undefined> {
  return (await readClosedSettlements(db)).find((eintrag) => eintrag.propertyId === propertyId && eintrag.year === year)
}

const closedOf = (propertyId: string, year: number) =>
  and(eq(closedSettlements.propertyId, propertyId), eq(closedSettlements.year, year))

export async function closeSettlement(
  db: Database,
  entry: { id: string, propertyId: string, year: number, closedAt: string, sentAt: string | null, settlement: unknown },
): Promise<void> {
  await db.insert(closedSettlements).values(entry)
}

// `false`, wenn es für das Jahr keine abgeschlossene Abrechnung gibt; die Route macht daraus
// ihre 404.
export async function setSentAt(db: Database, propertyId: string, year: number, sentAt: string | null): Promise<boolean> {
  if (!(await findClosedSettlement(db, propertyId, year))) return false
  await db.update(closedSettlements).set({ sentAt }).where(closedOf(propertyId, year))
  return true
}

// Wiederöffnen verschiebt den Stand in den Verlauf (#56, Teil 2), statt ihn zu löschen, und zwar
// in einer Transaktion: Scheiterte das Löschen nach dem Einfügen, stünde das Jahr sonst zugleich
// als abgeschlossen und im Verlauf da (Befund der Durchsicht).
export async function reopenSettlement(db: Database, propertyId: string, year: number, historyId: string): Promise<boolean> {
  const eintrag = await findClosedSettlement(db, propertyId, year)
  if (!eintrag) return false
  await db.transaction(async (tx) => {
    await tx.insert(closedSettlementHistory).values({
      id: historyId, propertyId, year, closedAt: eintrag.closedAt, sentAt: eintrag.sentAt,
      reopenedAt: new Date().toISOString(), settlement: eintrag.settlement,
    })
    await tx.delete(closedSettlements).where(closedOf(propertyId, year))
  })
  return true
}

export type SettlementHistoryEntry = { id: string, closedAt: string, sentAt: string | null, reopenedAt: string, settlement: unknown }

// Frühere Abschlüsse eines Jahres, der zuletzt wiedergeöffnete zuerst.
export async function settlementHistory(db: Database, propertyId: string, year: number): Promise<SettlementHistoryEntry[]> {
  const rows = await db
    .select()
    .from(closedSettlementHistory)
    .where(and(eq(closedSettlementHistory.propertyId, propertyId), eq(closedSettlementHistory.year, year)))
    .orderBy(desc(closedSettlementHistory.reopenedAt), desc(sql`rowid`))
  return rows.map((r) => ({ id: r.id, closedAt: r.closedAt, sentAt: r.sentAt, reopenedAt: r.reopenedAt, settlement: r.settlement }))
}

// ---------- Was die Sonderrouten brauchen ----------

// Beim Löschen eines Belegs fragt die Route, ob er noch an einer Kostenposition hängt. Das stand
// bisher als `some()` über den ganzen Bestand; hier ist es eine Abfrage.
export async function invoiceFilesInUse(db: Database, files: string[]): Promise<Set<string>> {
  if (files.length === 0) return new Set()
  const rows = await db.select({ file: costItems.invoiceFile }).from(costItems).where(inArray(costItems.invoiceFile, files))
  return new Set(rows.map((r) => r.file).filter((file) => file !== null))
}

// Ob die Kaskade die vereinbarten Anteile einer gelöschten Wohnung wirklich weggeräumt hat,
// fragt ein Test über diese Abfrage. Sie steht hier und nicht im Test, damit die Tabelle nur an
// einer Stelle bekannt sein muss.
export async function sharesForUnit(db: Database, unitId: string): Promise<number> {
  const rows = await db.select({ unitId: costItemShares.unitId }).from(costItemShares).where(eq(costItemShares.unitId, unitId))
  return rows.length
}
