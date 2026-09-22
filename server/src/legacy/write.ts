// Einen ganzen Datenbestand in die **eingefrorenen** Tabellen schreiben (Aufgabe 6b).
//
// Gebraucht wird das an genau einer Stelle, nämlich beim Umstieg eines vorhandenen Bestandes
// (`db/changeover.ts`). Geschrieben wird in das Schema, wie es nach Migration 0000 aussieht
// (`schema.ts` in diesem Ordner), und nicht in das heutige: Erst dadurch läuft die
// Migrationskette hinterher über den übernommenen Bestand, und erst dadurch trägt jeder Schritt
// seine Datenregel selbst. Die Begründung im Langen steht in [README.md](README.md).
//
// **Diese Datei wird nicht mehr geändert.** Wer eine Spalte hinzufügt, ändert `db/schema.ts` und
// erzeugt einen Migrationsschritt; hier ist nichts zu tun.
//
// Die Zuordnung ist mechanisch: ein Feld, eine Spalte. **Was krumm ist, wird vorher
// geradegerückt** (`straightenForDatabase` in legacy/migrate.ts), und deshalb steht hier keine einzige
// fachliche Regel. Der Typ der Eingabe sagt genau das: `StraightDb` ist ein Bestand, in dem jedes
// Feld, für das es eine Spalte ohne NULL gibt, einen Wert hat.
//
// Alles läuft in **einer** Transaktion. Scheitert ein Datensatz, ist auch der erste wieder weg;
// sonst stünde ein halber Bestand in der Datei, den niemand als halb erkennt.
//
// Tests benutzen die Funktion auch, um eine Datenbank überhaupt erst mit etwas zu füllen. Das ist
// heute unbedenklich, weil der Ausgangsstand und der neueste derselbe ist. Sobald ein zweiter
// Migrationsschritt dazukommt, wird ein solcher Test laut scheitern, nämlich an einer Spalte, die
// es im Ausgangsstand noch nicht gibt; dann gehört er auf das Repository umgestellt.

import type { AiSettings, AiSlot, AiSlotName } from '../../../shared/types.ts'
import type { MigratedSettings } from '../ai/settings.ts'
import type { StraightDb } from './migrate.ts'
import type { Database } from '../db/client.ts'
import {
  AI_JSON_MODES, AI_PROVIDERS, aiSlots, baseRents, closedSettlements, costItemShares, costItems,
  meters, payments, personHistory, prepaymentOverrides, prepayments, readings, settings, tenancies,
  units, UPDATE_CHECK,
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

// ---------- Der Wächter an der eingefrorenen Grenze ----------
//
// **Die Einstellungen laufen weiter durch lebenden Code**, nämlich `migrateAi` in ai/settings.ts,
// und das ist eine Entscheidung und kein Versäumnis. Die fachlichen Daten sind eingefroren, weil
// dieselbe Datei immer dieselben Zahlen ergeben muss; die sind einem Mieter zugestellt worden.
// Die Einstellungen brauchen die umgekehrte Zusage: Niemandem hilft eine Vorlagenwahl von 2026,
// wenn er in einem Jahr einspielt, ihm hilft eine Einrichtung, die mit dem Code von dann
// arbeitet. Und die Asymmetrie ist deutlich: Kommt eine Einstellung anders heraus, korrigiert es
// die Oberfläche und nichts ist verloren; kommt eine Zahl anders heraus, hat ein Mieter eine
// falsche Abrechnung bekommen.
//
// **Bleibt ein Risiko, und es ist begrenzt.** In den eingefrorenen Tabellen gibt es genau vier
// Aufzählungsbedingungen. Lieferte lebender Code eines Tages einen Wert, den der Wortschatz von
// damals nicht kennt, scheiterte der Umstieg an einer von ihnen, und zwar zur Laufzeit beim
// Vermieter. Nachgemessen an `update_check`: Ein erfundener Wert bricht das Einfügen der ganzen
// Zeile ab.
//
// Geklemmt wird deshalb hier, mit den Listen von damals. Das ist **kein Nachbau der Logik**,
// sondern eine Aussage über das Schema: Diese Spalten konnten damals genau das enthalten. Eine
// Kopie von `migrateAi` wäre die zweite Stelle, an der dieselbe Regel steht; dieser Wächter ist
// keine.
//
// Der Platz selbst (`ai_slots_slot_known`) braucht keinen Wächter: `aiSlotRows` unten liest genau
// `text` und `images`, ein dritter Name kommt also gar nicht erst an. Ein Test hält das fest.

// Was die Spalte nicht kennt, wird zum Rückfallwert. Die Listen stehen hier als Zeichenketten und
// nicht als Verweis auf `shared/types.ts`: Ein Verweis auf einen lebenden Typ wäre das Gegenteil
// von eingefroren.
const clamped = <T extends string>(known: readonly T[], value: unknown, fallback: T): T =>
  known.find((eintrag) => eintrag === value) ?? fallback

// Dasselbe für eine Spalte, die auch leer sein darf: Dort ist `null` der ehrlichere Rückfall als
// ein erfundener Wert, denn „nicht eingetragen" ist etwas, das die Oberfläche versteht.
const clampedOrNull = <T extends string>(known: readonly T[], value: unknown): T | null =>
  known.find((eintrag) => eintrag === value) ?? null

// **Die Listen kommen aus schema.ts daneben und stehen hier nicht noch einmal.** Eine zweite
// Abschrift ginge an allen drei Wächtern vorbei: Tabellen und Spalten blieben dieselben, das
// heutige Schema wäre nicht importiert, und die Prüfsumme von schema.ts bliebe gleich. Wer dort
// einen Wert ergänzte, brächte damit genau den Ausgang zurück, gegen den geklemmt wird.

// ---------- Die Zeilen der Einstellungen ----------
//
// **Hier steht eine Kopie, und das ist der Zweck der ganzen Aufteilung.** Dieselben Funktionen
// gibt es in `db/write.ts` für `PUT /api/settings`, und dort wandern sie mit jeder neuen Spalte
// mit. Hier nicht: Diese schreiben in den Ausgangsstand.
//
// Der Kommentar an der lebenden Fassung warnte einmal ausdrücklich vor genau dieser Doppelung
// („zwei Fassungen liefen auseinander, sobald jemand ein Feld ergänzt"). Die Warnung war richtig,
// solange beide auf dasselbe Schema zielten. Jetzt zielen sie auf verschiedene, und dass sie
// auseinanderlaufen, ist nicht die Gefahr, sondern die Absicht.

function settingsRow(s: MigratedSettings) {
  const ai = s.ai
  return {
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
    updateCheck: clampedOrNull(UPDATE_CHECK, s.updateCheck),
    updateDismissed: orNull(s.updateDismissed),
    aiTimeoutSeconds: orNull(ai.timeoutSeconds),
    aiNumCtx: orNull(ai.numCtx),
    aiMaxOutputTokens: orNull(ai.maxOutputTokens),
    aiPageImageEdge: orNull(ai.pageImageEdge),
    aiJsonMode: clamped(AI_JSON_MODES, ai.jsonMode, 'auto'),
    aiReasoningEffort: orNull(ai.reasoningEffort),
    aiExtraInstructions: ai.extraInstructions,
  }
}

function aiSlotRows(ai: AiSettings) {
  const slotRow = (name: AiSlotName, slot: AiSlot) => ({
    slot: name,
    provider: clamped(AI_PROVIDERS, slot.provider, 'ollama'),
    preset: slot.preset,
    url: slot.url,
    model: slot.model,
    vision: orNull(slot.vision),
    consentUrl: orNull(ai.consent[name]?.url),
    consentModel: orNull(ai.consent[name]?.model),
    consentDate: orNull(ai.consent[name]?.date),
  })
  return [slotRow('text', ai.text), ...(ai.images ? [slotRow('images', ai.images)] : [])]
}

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

  const slotRows = aiSlotRows(stock.settings.ai)

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
    // Die Einstellungen sind genau eine Zeile, die Prüfbedingung des Schemas sagt es.
    await tx.insert(settings).values(settingsRow(stock.settings))
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
