// Den ganzen Datenbestand aus der Datenbank lesen (#55).
//
// Gegenstück zu write.ts. Heute braucht es das der Umstieg, um nachzurechnen, dass aus der
// Datenbank dieselbe Abrechnung entsteht wie aus der Datei (db/changeover.ts); danach lesen
// die Routen von hier.
//
// **Gelesen wird in der Reihenfolge, in der die Zeilen angelegt wurden** (`rowid`), und das ist
// keine Kosmetik. Zwei Ablesungen mit demselben Datum sortiert die Berechnung stabil, es gilt
// also die Reihenfolge der Datei: Welcher der beiden Stände der spätere ist, entscheidet über
// den Verbrauch und damit über Geld. Dasselbe in klein gilt für die Anzeige, denn die Zeilen
// der Abrechnung stehen in der Reihenfolge der Kostenpositionen. Ohne `ORDER BY` liefert SQLite
// zwar in aller Regel die rowid-Reihenfolge, zugesichert ist das aber nicht; sobald ein Index
// die Abfrage bedient, kann es anders kommen.

import { sql } from 'drizzle-orm'
import type { AiConsent, AiSettings, AiSlot, CostItem, Meter, Payment, Reading, Settings, Tenancy, Unit } from '../../../shared/types.ts'
import { migrateAi, type MigratedSettings } from '../ai/settings.ts'
import { DEFAULT_SETTINGS } from '../defaults.ts'
import { frozenSettlementOf, type SnapshotSource } from '../snapshot.ts'
import type { Database } from './client.ts'
import {
  aiSlots, baseRents, closedSettlements, costItemShares, costItems, meters, payments,
  personHistory, prepaymentOverrides, prepayments, readings, settings, tenancies, units,
} from './schema.ts'

// Eine abgeschlossene Abrechnung, wie sie in der Datenbank steht. `settlement` bleibt
// `unknown`: Es ist ein Archivstück, das wortgleich erhalten bleiben soll, und ein Typ darüber
// wäre eine Behauptung über etwas, das eine frühere Version geschrieben hat. Die Berechnung
// liest daraus nur den Eigenanteil und die Vorauszahlungen, und die holt `frozenSettlementOf`
// aus snapshot.ts heraus — dieselbe Funktion wie auf dem Weg über die Datei.
export type StoredClosedSettlement = {
  id: string
  year: number
  closedAt: string
  sentAt: string | null
  selfUsedShareCents: number
  prepaymentCents: number
  prepaymentOverridden: boolean
  settlement: unknown
}

// Der Bestand, wie er in der Datenbank liegt. Er erfüllt `SnapshotSource` (snapshot.ts), lässt
// sich also unmittelbar zu einem Schnappschuss eines Jahres machen.
export type Stock = SnapshotSource & {
  units: Unit[]
  tenancies: Tenancy[]
  costItems: CostItem[]
  meters: Meter[]
  readings: Reading[]
  payments: Payment[]
  closedSettlements: StoredClosedSettlement[]
  settings: MigratedSettings
}

// Ein fehlendes Feld kommt aus der Datenbank als NULL zurück. Im Datenmodell steht dort ein
// optionales Feld, also `undefined`. Der Unterschied ist für die Berechnung keiner (beide sind
// „nichts"), und `JSON.stringify` lässt ein `undefined` wieder ganz weg, sodass die Oberfläche
// genau das sieht, was sie heute sieht. Wo das Datenmodell `null` ausdrücklich zulässt (das
// offene Mietverhältnis, der Hauptzähler ohne Wohnung), bleibt das `null` stehen.
const orUndefined = <T>(value: T | null): T | undefined => value ?? undefined

// Zeilen nach ihrer Kennung bündeln, in der Reihenfolge, in der sie gelesen wurden.
function groupBy<T, K>(rows: T[], keyOf: (row: T) => string, valueOf: (row: T) => K): Map<string, K[]> {
  const groups = new Map<string, K[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const list = groups.get(key)
    if (list) list.push(valueOf(row))
    else groups.set(key, [valueOf(row)])
  }
  return groups
}

// Die Reihenfolge, in der die Zeilen angelegt wurden. Siehe oben; steht als Konstante da, damit
// keine Abfrage sie vergisst.
const INSERTION_ORDER = sql`rowid`

// ---------- Je Sammlung ein Leser ----------
//
// Jede Sammlung hat ihren eigenen Leser, und `readStock` setzt sie nur zusammen. Der Grund ist
// die Route: `GET /api/units` braucht die Wohnungen und nicht den ganzen Bestand. Damit steht
// die Naht zwischen Zeile und Domänentyp je Sammlung an genau einer Stelle, und sie ist eine
// benannte Funktion und keine Zusicherung (dasselbe Muster wie bei der KI-Auswertung, #63).

export async function readUnits(db: Database): Promise<Unit[]> {
  const rows = await db.select().from(units).orderBy(INSERTION_ORDER)
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    areaM2: u.areaM2,
    participates: u.participates,
    selfUsed: orUndefined(u.selfUsed),
    selfPersons: orUndefined(u.selfPersons),
    rooms: orUndefined(u.rooms),
    floor: orUndefined(u.floor),
    notes: orUndefined(u.notes),
  }))
}

// Ein Mietverhältnis liegt über fünf Tabellen: sich selbst und die drei Staffeln, dazu die
// Jahreskorrektur. Deshalb liest dieser Leser mehr als einen Tisch, und deshalb ist er der
// einzige, bei dem das so ist.
export async function readTenancies(db: Database): Promise<Tenancy[]> {
  const rows = await db.select().from(tenancies).orderBy(INSERTION_ORDER)
  const personRows = await db.select().from(personHistory).orderBy(INSERTION_ORDER)
  const prepaymentRows = await db.select().from(prepayments).orderBy(INSERTION_ORDER)
  const baseRentRows = await db.select().from(baseRents).orderBy(INSERTION_ORDER)
  const overrideRows = await db.select().from(prepaymentOverrides).orderBy(INSERTION_ORDER)

  const persons = groupBy(personRows, (r) => r.tenancyId, (r) => ({ from: r.from, persons: r.persons }))
  const prepaid = groupBy(prepaymentRows, (r) => r.tenancyId, (r) => ({ from: r.from, monthlyCents: r.monthlyCents }))
  const rents = groupBy(baseRentRows, (r) => r.tenancyId, (r) => ({ from: r.from, monthlyCents: r.monthlyCents }))
  // Die Jahreskorrektur wird gleich zu einem Objekt (`Object.fromEntries`), deshalb Paare. Der
  // angeschriebene Rückgabetyp macht daraus ein Paar statt einer Liste, ohne etwas zu behaupten:
  // Er beschreibt, was danebensteht, und der Übersetzer rechnet es nach.
  const overrides = groupBy(overrideRows, (r) => r.tenancyId, (r): [string, number] => [String(r.year), r.amountCents])

  return rows.map((t) => ({
    id: t.id,
    unitId: t.unitId,
    tenantName: t.tenantName,
    persons: t.persons,
    personHistory: persons.get(t.id) ?? [],
    start: t.start,
    end: t.end,
    prepayments: prepaid.get(t.id) ?? [],
    prepaymentOverrides: Object.fromEntries(overrides.get(t.id) ?? []),
    baseRents: rents.get(t.id) ?? [],
    email: orUndefined(t.email),
    phone: orUndefined(t.phone),
    correspondenceAddress: orUndefined(t.correspondenceAddress),
    iban: orUndefined(t.iban),
    contractDate: orUndefined(t.contractDate),
    depositCents: orUndefined(t.depositCents),
    depositStatus: orUndefined(t.depositStatus),
    notes: orUndefined(t.notes),
  }))
}

export async function readCostItems(db: Database): Promise<CostItem[]> {
  const rows = await db.select().from(costItems).orderBy(INSERTION_ORDER)
  const shareRows = await db.select().from(costItemShares).orderBy(INSERTION_ORDER)
  const shares = groupBy(shareRows, (r) => r.costItemId, (r): [string, number] => [r.unitId, r.percent])
  return rows.map((c) => {
    const own = shares.get(c.id)
    return {
      id: c.id,
      year: c.year,
      category: c.category,
      description: c.description,
      vendor: orUndefined(c.vendor),
      amountCents: c.amountCents,
      key: c.key,
      directUnitId: c.directUnitId,
      meterType: c.meterType,
      // Das Feld nur, wenn es Anteile gibt: Eine Position ohne vereinbarte Anteile hat es
      // auch in der Datei nicht.
      ...(own ? { customShares: Object.fromEntries(own) } : {}),
      labor35aCents: orUndefined(c.labor35aCents),
      invoiceFile: orUndefined(c.invoiceFile),
    }
  })
}

export async function readMeters(db: Database): Promise<Meter[]> {
  const rows = await db.select().from(meters).orderBy(INSERTION_ORDER)
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    unitId: m.unitId,
    type: m.type,
    meterNumber: orUndefined(m.meterNumber),
    unit: m.unit,
  }))
}

export async function readReadings(db: Database): Promise<Reading[]> {
  const rows = await db.select().from(readings).orderBy(INSERTION_ORDER)
  return rows.map((r) => ({
    id: r.id,
    meterId: r.meterId,
    date: r.date,
    value: r.value,
    replacement: orUndefined(r.replacement),
    oldEndValue: orUndefined(r.oldEndValue),
    note: orUndefined(r.note),
  }))
}

export async function readPayments(db: Database): Promise<Payment[]> {
  const rows = await db.select().from(payments).orderBy(INSERTION_ORDER)
  return rows.map((p) => ({
    id: p.id,
    tenancyId: p.tenancyId,
    date: p.date,
    amountCents: p.amountCents,
    note: orUndefined(p.note),
  }))
}

export async function readClosedSettlements(db: Database): Promise<StoredClosedSettlement[]> {
  const rows = await db.select().from(closedSettlements).orderBy(INSERTION_ORDER)
  return rows.map((c) => ({
    id: c.id,
    year: c.year,
    closedAt: c.closedAt,
    sentAt: c.sentAt,
    // Derselbe Auszug wie auf dem Weg über die Datei (snapshot.ts). Zwei Leser desselben
    // Archivstücks, die sich bei krummem Inhalt uneinig sind, wären genau die Sorte Unterschied,
    // die beim Umstieg als „Abrechnung weicht ab" auffällt und die dann niemand erklären kann.
    ...frozenSettlementOf(c.settlement),
    settlement: c.settlement,
  }))
}

// Der ganze Bestand. Braucht ihn, wer rechnet (der Schnappschuss) oder wer ihn als Ganzes
// vergleicht (der Umstieg und sein Gleichstand).
export async function readStock(db: Database): Promise<Stock> {
  return {
    units: await readUnits(db),
    tenancies: await readTenancies(db),
    costItems: await readCostItems(db),
    meters: await readMeters(db),
    readings: await readReadings(db),
    payments: await readPayments(db),
    closedSettlements: await readClosedSettlements(db),
    settings: await readSettings(db),
  }
}

// Die Einstellungen samt der beiden KI-Plätze.
//
// **Fehlt die Zeile, gelten die Vorgabewerte einer neuen Einrichtung.** Das ist der häufigste
// Fall überhaupt, nämlich jeder erste Start, denn die Zeile entsteht erst beim ersten Speichern.
// Früher beantwortete das `load()` in store.ts, indem es eine fehlende db.json mit `DEFAULT_DB`
// auffüllte; die Datenbank ist deren Nachfolgerin und antwortet deshalb genauso.
//
// Entschieden wird das an der **Zeile** und nie an einem Wert. Ein Feld, das der Nutzer geleert
// hat, bleibt leer; eine Adresse still durch die Voreinstellung zu ersetzen, wäre eine Änderung
// hinter seinem Rücken. Deshalb steht der Rückfall ganz oben und nicht als `?? ''` an jedem
// einzelnen Feld.
export async function readSettings(db: Database): Promise<MigratedSettings> {
  const rows = await db.select().from(settings).orderBy(INSERTION_ORDER)
  const row = rows[0]
  if (!row) return migrateAi({ ...DEFAULT_SETTINGS })
  const slotRows = await db.select().from(aiSlots).orderBy(INSERTION_ORDER)
  const slotOf = (name: 'text' | 'images'): AiSlot | null => {
    const found = slotRows.find((s) => s.slot === name)
    if (!found) return null
    return { provider: found.provider, preset: found.preset, url: found.url, model: found.model, vision: found.vision }
  }
  const consent: Partial<Record<'text' | 'images', AiConsent>> = {}
  for (const slot of slotRows) {
    if (slot.consentUrl !== null && slot.consentModel !== null && slot.consentDate !== null) {
      consent[slot.slot] = { url: slot.consentUrl, model: slot.consentModel, date: slot.consentDate }
    }
  }
  // Ohne Zeile für den Standard-Platz gäbe es keinen Anbieter. Durch Mietfuchs selbst kann das
  // nicht entstehen: Einstellungen und Plätze werden immer zusammen in einer Transaktion
  // geschrieben. Ein Wert muss hier trotzdem stehen, weil der Typ einen verlangt, und die alten
  // Ollama-Felder derselben Zeile sind das Nächstliegende.
  const text = slotOf('text') ?? { provider: 'ollama', preset: 'ollama-local', url: row.ollamaUrl, model: row.ollamaModel, vision: null }
  const ai: AiSettings = {
    text,
    images: slotOf('images'),
    timeoutSeconds: row.aiTimeoutSeconds,
    numCtx: row.aiNumCtx,
    maxOutputTokens: row.aiMaxOutputTokens,
    pageImageEdge: row.aiPageImageEdge,
    jsonMode: row.aiJsonMode,
    reasoningEffort: row.aiReasoningEffort,
    extraInstructions: row.aiExtraInstructions,
    consent,
  }
  const stored: Settings = {
    houseName: row.houseName,
    address: row.address,
    landlordName: row.landlordName,
    iban: row.iban,
    paymentDeadlineDays: row.paymentDeadlineDays,
    ollamaUrl: row.ollamaUrl,
    ollamaModel: row.ollamaModel,
    // Diese vier gibt es nur, wenn ein Wert dasteht. Ein Feld mit dem Wert `undefined` wäre
    // etwas anderes als ein fehlendes Feld, sobald jemand zwei Stände vergleicht — und genau
    // das tut der Umstieg.
    ...(row.printAdjustSuggestion == null ? {} : { printAdjustSuggestion: row.printAdjustSuggestion }),
    ...(row.printAttachments == null ? {} : { printAttachments: row.printAttachments }),
    ...(row.updateCheck == null ? {} : { updateCheck: row.updateCheck }),
    ...(row.updateDismissed == null ? {} : { updateDismissed: row.updateDismissed }),
    ai,
  }
  return { ...stored, ai }
}
