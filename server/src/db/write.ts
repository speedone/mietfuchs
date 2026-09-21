// Einen ganzen Datenbestand in die Datenbank schreiben (#55).
//
// Gebraucht wird das beim Umstieg der vorhandenen Bestände (db/changeover.ts). Die Zuordnung
// ist mechanisch: ein Feld, eine Spalte. **Was krumm ist, wird vorher geradegerückt**
// (`straightenForDatabase` in legacy.ts), und deshalb steht hier keine einzige fachliche Regel.
// Der Typ der Eingabe sagt genau das: `StraightDb` ist ein Bestand, in dem jedes Feld, für das
// es eine Spalte ohne NULL gibt, einen Wert hat.
//
// Alles läuft in **einer** Transaktion. Scheitert ein Datensatz, ist auch der erste wieder weg;
// sonst stünde ein halber Bestand in der Datei, den niemand als halb erkennt.

import type { StraightDb } from '../legacy.ts'
import type { Database } from './client.ts'
import {
  aiSlots, baseRents, closedSettlements, costItemShares, costItems, meters, payments,
  personHistory, prepaymentOverrides, prepayments, readings, settings, tenancies, units,
} from './schema.ts'

// Was in welcher Zahl angekommen ist. Steht im Protokoll des Umstiegs, damit der Vermieter
// nachsehen kann, ob sein Bestand vollständig übernommen wurde.
export type StockCounts = {
  units: number
  tenancies: number
  personHistory: number
  prepayments: number
  baseRents: number
  prepaymentOverrides: number
  costItems: number
  costItemShares: number
  meters: number
  readings: number
  payments: number
  closedSettlements: number
}

// SQLite bindet je Anweisung nur eine begrenzte Zahl von Werten (ältere Fassungen 999, neuere
// 32766). Ein Haus mit wenigen Wohnungen bleibt weit darunter. Die Aufteilung steht trotzdem
// da, weil ein Bestand mit vielen Ablesungen sonst an einer Grenze scheiterte, die mit seinen
// Daten nichts zu tun hat. 50 Zeilen mal der breitesten Tabelle bleiben auch unter 999.
const CHUNK = 50

function chunks<T>(rows: T[]): T[][] {
  const parts: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK) parts.push(rows.slice(i, i + CHUNK))
  return parts
}

// `null` statt `undefined` an jeder Stelle, an der ein Feld fehlen darf. In SQL heißt NULL
// „kein Wert", in JavaScript heißt `undefined` meist „hier fehlt etwas, das dastehen sollte";
// client.ts wirft deshalb ausdrücklich, wenn ein `undefined` bis zur Datenbank durchkommt.
const orNull = <T>(value: T | undefined | null): T | null => value ?? null

export async function writeStock(db: Database, stock: StraightDb): Promise<StockCounts> {
  // Die Staffeln stehen als eigene Tabellen und nicht als JSON in einer Spalte. Sie werden
  // deshalb hier aus den Mietverhältnissen herausgezogen, mitsamt der Kennung, an der sie
  // hängen.
  const personRows = stock.tenancies.flatMap((t) =>
    t.personHistory.map((e) => ({ tenancyId: t.id, from: e.from, persons: e.persons })))
  const prepaymentRows = stock.tenancies.flatMap((t) =>
    t.prepayments.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  const baseRentRows = stock.tenancies.flatMap((t) =>
    t.baseRents.map((e) => ({ tenancyId: t.id, from: e.from, monthlyCents: e.monthlyCents })))
  // Die Jahreskorrektur ist nach Jahr geschlüsselt und nicht nach Datum. Der Schlüssel steht in
  // der Datei als Text („2024"), in der Spalte als Zahl; der Validator lässt nur vierstellige
  // Jahreszahlen durch, das Hin und Her ist also verlustfrei.
  const overrideRows = stock.tenancies.flatMap((t) =>
    Object.entries(t.prepaymentOverrides).map(([year, amountCents]) => ({
      tenancyId: t.id, year: Number(year), amountCents,
    })))
  const shareRows = stock.costItems.flatMap((item) =>
    Object.entries(item.customShares ?? {}).map(([unitId, percent]) => ({
      costItemId: item.id, unitId, percent,
    })))

  const ai = stock.settings.ai
  // Die beiden Plätze der KI sind Zeilen und keine Spalten mit Präfix. Die Bestätigung eines
  // externen Dienstes steht in derselben Zeile wie die Adresse, für die sie gilt.
  const slotRows = [
    { slot: 'text' as const, ...ai.text },
    ...(ai.images ? [{ slot: 'images' as const, ...ai.images }] : []),
  ].map((slot) => ({
    slot: slot.slot,
    provider: slot.provider,
    preset: slot.preset,
    url: slot.url,
    model: slot.model,
    vision: orNull(slot.vision),
    consentUrl: orNull(ai.consent[slot.slot]?.url),
    consentModel: orNull(ai.consent[slot.slot]?.model),
    consentDate: orNull(ai.consent[slot.slot]?.date),
  }))

  await db.transaction(async (tx) => {
    // Die Reihenfolge ist die der Verweise: Erst die Wohnung, dann alles, was auf sie zeigt.
    // Mit eingeschalteter Fremdschlüsselprüfung (siehe client.ts) ginge es sonst nicht.
    for (const part of chunks(stock.units)) {
      await tx.insert(units).values(part.map((u) => ({
        id: u.id,
        name: u.name,
        areaM2: u.areaM2,
        participates: u.participates,
        selfUsed: orNull(u.selfUsed),
        selfPersons: orNull(u.selfPersons),
        rooms: orNull(u.rooms),
        floor: orNull(u.floor),
        notes: orNull(u.notes),
      })))
    }
    for (const part of chunks(stock.tenancies)) {
      await tx.insert(tenancies).values(part.map((t) => ({
        id: t.id,
        unitId: t.unitId,
        tenantName: t.tenantName,
        persons: t.persons,
        start: t.start,
        end: orNull(t.end),
        email: orNull(t.email),
        phone: orNull(t.phone),
        correspondenceAddress: orNull(t.correspondenceAddress),
        iban: orNull(t.iban),
        contractDate: orNull(t.contractDate),
        depositCents: orNull(t.depositCents),
        depositStatus: orNull(t.depositStatus),
        notes: orNull(t.notes),
      })))
    }
    for (const part of chunks(personRows)) await tx.insert(personHistory).values(part)
    for (const part of chunks(prepaymentRows)) await tx.insert(prepayments).values(part)
    for (const part of chunks(baseRentRows)) await tx.insert(baseRents).values(part)
    for (const part of chunks(overrideRows)) await tx.insert(prepaymentOverrides).values(part)
    for (const part of chunks(stock.costItems)) {
      await tx.insert(costItems).values(part.map((c) => ({
        id: c.id,
        year: c.year,
        category: c.category,
        description: c.description,
        vendor: orNull(c.vendor),
        amountCents: c.amountCents,
        key: c.key,
        directUnitId: orNull(c.directUnitId),
        meterType: orNull(c.meterType),
        labor35aCents: orNull(c.labor35aCents),
        invoiceFile: orNull(c.invoiceFile),
      })))
    }
    for (const part of chunks(shareRows)) await tx.insert(costItemShares).values(part)
    for (const part of chunks(stock.meters)) {
      await tx.insert(meters).values(part.map((m) => ({
        id: m.id,
        name: m.name,
        unitId: orNull(m.unitId),
        type: m.type,
        meterNumber: orNull(m.meterNumber),
        unit: m.unit,
      })))
    }
    for (const part of chunks(stock.readings)) {
      await tx.insert(readings).values(part.map((r) => ({
        id: r.id,
        meterId: r.meterId,
        date: r.date,
        value: r.value,
        replacement: orNull(r.replacement),
        oldEndValue: orNull(r.oldEndValue),
        note: orNull(r.note),
      })))
    }
    for (const part of chunks(stock.payments)) {
      await tx.insert(payments).values(part.map((p) => ({
        id: p.id,
        tenancyId: p.tenancyId,
        date: p.date,
        amountCents: p.amountCents,
        note: orNull(p.note),
      })))
    }
    for (const part of chunks(stock.closedSettlements)) {
      await tx.insert(closedSettlements).values(part.map((c) => ({
        id: c.id,
        year: c.year,
        closedAt: c.closedAt,
        sentAt: orNull(c.sentAt),
        // Wortgleich, wie er dasteht: ein Archivstück und kein Ergebnis, das sich neu rechnen
        // ließe.
        settlement: c.settlement,
      })))
    }
    const s = stock.settings
    // Die Einstellungen sind genau eine Zeile, die Prüfbedingung des Schemas sagt es.
    await tx.insert(settings).values({
      id: 1,
      houseName: s.houseName,
      address: s.address,
      landlordName: s.landlordName,
      iban: s.iban,
      paymentDeadlineDays: s.paymentDeadlineDays,
      ollamaUrl: s.ollamaUrl,
      ollamaModel: s.ollamaModel,
      printAdjustSuggestion: orNull(s.printAdjustSuggestion),
      printAttachments: orNull(s.printAttachments),
      updateCheck: orNull(s.updateCheck),
      updateDismissed: orNull(s.updateDismissed),
      aiTimeoutSeconds: orNull(ai.timeoutSeconds),
      aiNumCtx: orNull(ai.numCtx),
      aiMaxOutputTokens: orNull(ai.maxOutputTokens),
      aiPageImageEdge: orNull(ai.pageImageEdge),
      aiJsonMode: ai.jsonMode,
      aiReasoningEffort: orNull(ai.reasoningEffort),
      aiExtraInstructions: ai.extraInstructions,
    })
    await tx.insert(aiSlots).values(slotRows)
  })

  return {
    units: stock.units.length,
    tenancies: stock.tenancies.length,
    personHistory: personRows.length,
    prepayments: prepaymentRows.length,
    baseRents: baseRentRows.length,
    prepaymentOverrides: overrideRows.length,
    costItems: stock.costItems.length,
    costItemShares: shareRows.length,
    meters: stock.meters.length,
    readings: stock.readings.length,
    payments: stock.payments.length,
    closedSettlements: stock.closedSettlements.length,
  }
}
