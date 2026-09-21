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

import { eq, inArray } from 'drizzle-orm'
import type { CostItem, Meter, Payment, PersonEntry, PrepaymentEntry, Reading, RentEntry, Tenancy, Unit } from '../../../shared/types.ts'
import type { Database, Executor } from './client.ts'
import { readCostItems, readMeters, readPayments, readReadings, readTenancies, readUnits } from './read.ts'
import {
  baseRents, COST_KEYS, costItemShares, costItems, DEPOSIT_STATUS, METER_TYPES, meters, payments,
  personHistory, prepaymentOverrides, prepayments, readings, tenancies, units,
} from './schema.ts'

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
function readSchedule<T>(value: unknown, entry: (row: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  const rows: T[] = []
  for (const row of value) {
    const gelesen = entry(row)
    if (gelesen !== null) rows.push(gelesen)
  }
  return rows
}

const personEntry = (row: unknown): PersonEntry | null => {
  const from = asOptionalText(raw(row, 'from'))
  return from === undefined ? null : { from, persons: asNumber(raw(row, 'persons'), 1) }
}
const moneyEntry = (row: unknown): PrepaymentEntry | null => {
  const from = asOptionalText(raw(row, 'from'))
  return from === undefined ? null : { from, monthlyCents: asNumber(raw(row, 'monthlyCents'), 0) }
}

// Jahr zu Betrag, und beides muss stimmen: Ein Jahr, das keine Zahl ist, hätte in der Spalte
// nichts zu suchen, denn dort steht es als Zahl und nicht als Text.
function readAmountsByYear(value: unknown): Record<string, number> {
  if (!isObject(value)) return {}
  const rows: Record<string, number> = {}
  for (const [schluessel, betrag] of Object.entries(Object(value))) {
    if (!Number.isInteger(Number(schluessel))) continue
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

function mergeUnit(current: Unit, body: unknown): Unit {
  return {
    id: current.id,
    name: merged(body, 'name', current.name, (v) => asText(v, '')),
    areaM2: merged(body, 'areaM2', current.areaM2, (v) => asNumber(v, 0)),
    // `typeof v === 'boolean'` und nicht `!!v`: In JavaScript wäre die Zeichenkette „false" wahr.
    participates: merged(body, 'participates', current.participates, (v) => asBoolean(v, false)),
    selfUsed: merged(body, 'selfUsed', current.selfUsed, asOptionalBoolean),
    selfPersons: merged(body, 'selfPersons', current.selfPersons, asOptionalNumber),
    rooms: merged(body, 'rooms', current.rooms, asOptionalNumber),
    floor: merged(body, 'floor', current.floor, asOptionalText),
    notes: merged(body, 'notes', current.notes, asOptionalText),
  }
}

function mergeTenancy(current: Tenancy, body: unknown): Tenancy {
  return {
    id: current.id,
    unitId: merged(body, 'unitId', current.unitId, (v) => asText(v, '')),
    tenantName: merged(body, 'tenantName', current.tenantName, (v) => asText(v, '')),
    persons: merged(body, 'persons', current.persons, (v) => asNumber(v, 1)),
    personHistory: merged(body, 'personHistory', current.personHistory, (v) => readSchedule<PersonEntry>(v, personEntry)),
    start: merged(body, 'start', current.start, (v) => asText(v, '')),
    end: merged(body, 'end', current.end, asNullableText),
    prepayments: merged(body, 'prepayments', current.prepayments, (v) => readSchedule<PrepaymentEntry>(v, moneyEntry)),
    prepaymentOverrides: merged(body, 'prepaymentOverrides', current.prepaymentOverrides, readAmountsByYear),
    baseRents: merged(body, 'baseRents', current.baseRents, (v) => readSchedule<RentEntry>(v, moneyEntry)),
    email: merged(body, 'email', current.email, asOptionalText),
    phone: merged(body, 'phone', current.phone, asOptionalText),
    correspondenceAddress: merged(body, 'correspondenceAddress', current.correspondenceAddress, asOptionalText),
    iban: merged(body, 'iban', current.iban, asOptionalText),
    contractDate: merged(body, 'contractDate', current.contractDate, asOptionalText),
    depositCents: merged(body, 'depositCents', current.depositCents, asOptionalNumber),
    depositStatus: merged(body, 'depositStatus', current.depositStatus, (v) => oneOfOrUndefined(DEPOSIT_STATUS, v)),
    notes: merged(body, 'notes', current.notes, asOptionalText),
  }
}

function mergeCostItem(current: CostItem, body: unknown): CostItem {
  const shares = merged(body, 'customShares', current.customShares, (v) => (v === null ? null : readShares(v)))
  return {
    id: current.id,
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
    labor35aCents: merged(body, 'labor35aCents', current.labor35aCents, asOptionalNumber),
    invoiceFile: merged(body, 'invoiceFile', current.invoiceFile, asOptionalText),
  }
}

function mergeMeter(current: Meter, body: unknown): Meter {
  return {
    id: current.id,
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
const emptyUnit = (id: string): Unit => ({ id, name: '', areaM2: 0, participates: false })
const emptyTenancy = (id: string): Tenancy => ({
  id, unitId: '', tenantName: '', persons: 1, personHistory: [], start: '', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const emptyCostItem = (id: string): CostItem => ({
  id, year: new Date().getUTCFullYear(), category: '', description: '', amountCents: 0, key: 'area',
  directUnitId: null, meterType: null,
})
const emptyMeter = (id: string): Meter => ({ id, name: '', unitId: null, type: 'sonstig', unit: '' })
const emptyReading = (id: string): Reading => ({ id, meterId: '', date: '', value: 0 })
const emptyPayment = (id: string): Payment => ({ id, tenancyId: '', date: '', amountCents: 0 })

// ---------- Die Zeilen ----------

const orNull = <T>(value: T | undefined): T | null => value ?? null

const unitRow = (u: Unit) => ({
  id: u.id, name: u.name, areaM2: u.areaM2, participates: u.participates,
  selfUsed: orNull(u.selfUsed), selfPersons: orNull(u.selfPersons), rooms: orNull(u.rooms),
  floor: orNull(u.floor), notes: orNull(u.notes),
})
const tenancyRow = (t: Tenancy) => ({
  id: t.id, unitId: t.unitId, tenantName: t.tenantName, persons: t.persons, start: t.start, end: t.end,
  email: orNull(t.email), phone: orNull(t.phone), correspondenceAddress: orNull(t.correspondenceAddress),
  iban: orNull(t.iban), contractDate: orNull(t.contractDate), depositCents: orNull(t.depositCents),
  depositStatus: orNull(t.depositStatus), notes: orNull(t.notes),
})
const costItemRow = (c: CostItem) => ({
  id: c.id, year: c.year, category: c.category, description: c.description, vendor: orNull(c.vendor),
  amountCents: c.amountCents, key: c.key, directUnitId: c.directUnitId ?? null,
  meterType: c.meterType ?? null, labor35aCents: orNull(c.labor35aCents), invoiceFile: orNull(c.invoiceFile),
})
const meterRow = (m: Meter) => ({
  id: m.id, name: m.name, unitId: m.unitId, type: m.type, meterNumber: orNull(m.meterNumber), unit: m.unit,
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

async function writeCostItemShares(db: Executor, c: CostItem): Promise<void> {
  await db.delete(costItemShares).where(eq(costItemShares.costItemId, c.id))
  const anteile = Object.entries(c.customShares ?? {})
  if (anteile.length > 0) {
    await db.insert(costItemShares).values(anteile.map(([unitId, percent]) => ({ costItemId: c.id, unitId, percent })))
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
  empty: (id: string) => T
  merge: (current: T, body: unknown) => T
  insert: (db: Executor, entity: T) => Promise<void>
  replace: (db: Executor, entity: T) => Promise<void>
  remove: (db: Executor, id: string) => Promise<void>
}

const unitCollection: Collection<Unit> = {
  read: readUnits,
  empty: emptyUnit,
  merge: mergeUnit,
  insert: async (db, u) => { await db.insert(units).values(unitRow(u)) },
  replace: async (db, u) => { await db.update(units).set(unitRow(u)).where(eq(units.id, u.id)) },
  remove: async (db, id) => { await db.delete(units).where(eq(units.id, id)) },
}

const tenancyCollection: Collection<Tenancy> = {
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
  read: readMeters,
  empty: emptyMeter,
  merge: mergeMeter,
  insert: async (db, m) => { await db.insert(meters).values(meterRow(m)) },
  replace: async (db, m) => { await db.update(meters).set(meterRow(m)).where(eq(meters.id, m.id)) },
  remove: async (db, id) => { await db.delete(meters).where(eq(meters.id, id)) },
}

const readingCollection: Collection<Reading> = {
  read: readReadings,
  empty: emptyReading,
  merge: mergeReading,
  insert: async (db, r) => { await db.insert(readings).values(readingRow(r)) },
  replace: async (db, r) => { await db.update(readings).set(readingRow(r)).where(eq(readings.id, r.id)) },
  remove: async (db, id) => { await db.delete(readings).where(eq(readings.id, id)) },
}

const paymentCollection: Collection<Payment> = {
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
    await db.transaction(async (tx) => c.insert(tx, c.merge(c.empty(id), body)))
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
    await db.transaction(async (tx) => c.replace(tx, c.merge(current, body)))
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
