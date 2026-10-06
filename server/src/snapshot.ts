// Der Schnappschuss: der Ausschnitt des Datenbestands, aus dem die Abrechnung eines Jahres
// entsteht.
//
// Warum es ihn gibt: Bisher las die Berechnung unmittelbar den Datenbestand, den die Ablage im
// Speicher hält. Damit hing das Herzstück von Mietfuchs an der Bauart des Speichers. Hier
// verläuft nun die Grenze. Die Ablage füllt den Schnappschuss, die Berechnung liest ihn, und
// welcher Speicher dahinter liegt (heute die JSON-Datei, später eine Datenbank), bleibt ihr
// verborgen:
//
//     Speicher -> Repository -> Schnappschuss -> Berechnung -> Ergebnis
//
// Worin er sich von `Db` unterscheidet: `Db` ist die Gestalt der Datei, vollständig und über
// alle Jahre. Der Schnappschuss führt nur, was die Berechnung wirklich liest. Die Einstellungen
// fehlen ganz, ebenso die Kontaktdaten des Mieters, die Kaution, die Belegdatei einer
// Kostenposition und die Zimmerzahl einer Wohnung. Man soll ihm ansehen, woraus eine Abrechnung
// entsteht. Die Felder sind deshalb mit `Pick` aus den Domänentypen in shared/types.ts
// geschnitten und nicht neu erfunden: Was dort dazukommt, kommt hier nur an, wenn es jemand
// bewusst aufnimmt.

import type { BillingPeriod, Co2Statement, CostItem, DegreeDayValue, FrozenFuelCarry, FuelDelivery, HeatingPeriodData, HeatingPlant, Meter, Payment, PeriodKey, PeriodRules, Property, Reading, StockValue, Tenancy, Unit } from '../../shared/types.ts'
import { calendarPeriod, calendarYearPeriod, parsePeriodKey, periodContaining, periodLabel, periodOfKey, previousPeriod, rulesOf, settlementDeadline } from '../../shared/period.ts'
import { hasOwnRhythm, heatingPeriodsEndingIn, plantRules, sameFuelLine, settledSeparately, settlementKeyOf, type PlantWay } from '../../shared/heatingPeriod.ts'
import { isStockEnergy } from '../../shared/fuelStock.ts'
import { dayAfter, germanDate } from '../../shared/law/register.ts'
import { isStockFuelItem, readFrozenStock, settledByDefault, stockTemplateOfLine, type PreviousFuel, type StockPeriodInput } from './fuelStock.ts'
import { HEATING_CATEGORY } from '../../shared/heating.ts'
import type { Db } from './store.ts'

// Gelesen werden Kennung, Name (für Abrechnung und Warnungen), Wohnfläche und die beiden
// Kennzeichen der Beteiligung samt der Personenzahl des eigenen Haushalts. Zimmerzahl, Etage
// und Notiz sind reine Stammdaten und haben auf die Verteilung keinen Einfluss.
export type SnapshotUnit = Pick<Unit, 'id' | 'name' | 'areaM2' | 'participates' | 'selfUsed' | 'selfPersons' | 'mea' | 'noConnection'>

// Gelesen werden Kennung, Wohnung, Mietername, Zeitraum und die drei Staffeln samt der
// Jahreskorrektur der Vorauszahlung. `persons` bleibt dabei, weil es der Rückfall ist, wenn
// `personHistory` leer ist. Kontakt, Bankverbindung, Kaution und Vertragsdaten fehlen.
export type SnapshotTenancy = Pick<
  Tenancy,
  | 'id'
  | 'unitId'
  | 'tenantName'
  | 'persons'
  | 'personHistory'
  | 'start'
  | 'end'
  | 'prepayments'
  | 'prepaymentOverrides'
  | 'baseRents'
  | 'costModel'
  | 'heatingModel'
  | 'flatRates'
  // Heizstaffel und Heizkorrekturen (Heizung PR 5)
  | 'heatingPrepayments'
  | 'heatingPrepaymentOverrides'
> & {
  // Das Altformat der Vorauszahlung: ein fester Monatsbetrag statt einer Staffel. Im
  // Datenmodell gibt es das Feld nicht mehr, `load()` in store.ts wandelt es bei jedem
  // Einlesen um und löscht es. `computePrepaymentCents` liest es trotzdem weiterhin, und
  // deshalb steht es hier: Der Schnappschuss ist der Vertrag zwischen Ablage und Berechnung,
  // und was die Berechnung liest, muss darin vorkommen. Sonst baut ein späteres Repository
  // seine Mietverhältnisse ohne dieses Feld zusammen, der Übersetzer schweigt dazu, und ein
  // Bestand, der nie durch die Migration gelaufen ist, steht plötzlich ohne Vorauszahlung da.
  prepaymentMonthlyCents?: number
}

// Gelesen werden Kennung, Zeitraum, Kostenart, Beschreibung, Betrag, Schlüssel samt seiner Angaben
// und der Lohnanteil nach §35a. Der Rechnungssteller und die Belegdatei fehlen: Sie stehen auf
// der Abrechnung nicht und verteilen nichts.
export type SnapshotCostItem = Pick<
  CostItem,
  | 'id'
  | 'period'
  // Leistungszeitraum, Jahr der Zahlung und Brennstoffmerkmal (#208): für die Hinweise zum
  // Zeitraum, den Vorschlag nach § 560 im Rumpf und die Steuer.
  | 'serviceFrom'
  | 'serviceTo'
  | 'taxYear'
  | 'heatingPart'
  | 'category'
  | 'description'
  | 'amountCents'
  | 'key'
  | 'directUnitId'
  | 'meterType'
  | 'customShares'
  | 'participantUnitIds'
  | 'externalBasis'
  | 'tenancyAmounts'
  | 'selfAmounts'
  | 'labor35aCents'
  // Nur für den Hinweis auf eine mögliche Doppelung (shared/duplicates.ts); verteilt wird nach
  // keinem der beiden.
  | 'vendor'
  | 'invoiceFile'
  // Die Heizanlage (Heizung PR 5): Positionen einer Anlage mit eigener Heizperiode tragen deren Schlüssel.
  | 'heatingPlantId'
  // Die Lieferung (Heizung PR 7): Der Teil einer anderen Heizperiode folgt dem Schlüssel der Position.
  | 'fuelDeliveryId'
>

// Gelesen werden Kennung, Wohnung (null = Hauptzähler) und Zählertyp, dazu die Angaben zur
// Heizanlage (Heizung PR 4): Ein Zähler der Anlage ist kein Hauptzähler des Hauses, und
// Fernablesbarkeit und Einbau entscheiden über die Kürzung nach § 12 Abs. 1 Satz 2 HeizkostenV. Der
// Name nur für diesen Hinweis, deshalb optional; Zählernummer und Maßeinheit sind Anzeige, die
// Jahresübersicht der Zähler-Seite gibt nur `meterId` zurück und der Browser stellt sie daneben.
export type SnapshotMeter = Pick<Meter, 'id' | 'unitId' | 'type' | 'heatingPlantId' | 'heatingRole' | 'remoteReadable' | 'installedOn'> & Partial<Pick<Meter, 'name'>>

// Die Heizanlagen des Objekts (Heizung PR 4), eingedampft auf das, was die Berechnung liest. Seit
// Heizung PR 5 dazu Name, eigene Heizperiode und die Spannen nach Weg d; fehlen sie (ein von Hand
// gebauter Schnappschuss), folgt die Anlage dem Objekt und rechnet nichts getrennt ab. Seit PR 6 der
// Energieträger, Pflicht: Von ihm hängt ab, ob CO₂-Kosten aufzuteilen sind. Seit PR 7 die
// CO₂-Merkmale (§ 8, § 9, § 2 Abs. 4 Satz 2 CO2KostAufG); fehlen sie, hat die Anlage keine.
export type SnapshotHeatingPlant = Pick<HeatingPlant, 'id' | 'energy' | 'method' | 'source' | 'devicesRemote' | 'devicesInstalledAfter2021' | 'newDevicesInstall' | 'units'>
  & Partial<Pick<HeatingPlant, 'name' | 'periodStartMonth' | 'periodChanges' | 'separateSpans' | 'separateSettlement' | 'nonResidential' | 'restriction' | 'districtEtsNew' | 'supply' | 'endsOn' | 'replacesPlantId' | 'buildingWith' | 'takesOverStock'>>
// Seit Heizung PR 9 die Versorgung (`supply`); fehlt sie, ist die Anlage zentral.
// Die Angaben je Heizperiode, die die Berechnung liest: Warmwasser laut Messdienst (Heizung PR 6, #211)
// und der Vorrat (Heizung PR 8). Die Felder des Vorrats sind optional, damit ein von Hand gebauter
// Schnappschuss ohne Vorrat sie nicht nennen muss; fehlen sie, gibt es keinen.
export type SnapshotHeatingPeriodRow = Pick<HeatingPeriodData, 'plantId' | 'period' | 'dhwMethod' | 'dhwUnmeasurable'>
  & Partial<Pick<HeatingPeriodData, 'stockUnit' | 'openingQuantity' | 'openingCostCents' | 'openingEmissionsKg' | 'openingCo2Cents' | 'openingInvoicedBefore2023' | 'openingAlreadySettled' | 'closingQuantity' | 'closingMeasuredOn'>>

export const wayOf = (p: SnapshotHeatingPlant): PlantWay => ({
  periodStartMonth: p.periodStartMonth ?? null, periodChanges: p.periodChanges ?? [], separateSpans: p.separateSpans ?? [],
})

// Eine Heizperiode, die in P endet (Heizung PR 5, Entwurf 5.8): mit ihren Positionen und denen ihrer
// Vorperiode (für den Vorschlag nach § 560). `separate`: nach Weg d getrennt abgerechnet; dann steht
// sie nicht in P.
export type SnapshotHeatingPart = {
  plantId: string
  period: BillingPeriod
  previous: BillingPeriod
  items: SnapshotCostItem[]
  previousItems: SnapshotCostItem[]
  // Für den Vergleich mit dem Vorjahr (#141, Schlüssel und Doppelungen): die Heizpositionen, die im
  // Abrechnungszeitraum vor P abgerechnet wurden (`settlementKeyOf`), mit dem Schlüssel der
  // Vorperiode, damit der Vergleich sie findet. Meist sind das genau `previousItems`; dazu kommt eine
  // Heizposition ohne Anlage aus einem Zeitraum, der vor dem Einrichten der eigenen Heizperiode
  // abgeschlossen war und deshalb nie umgeschlüsselt wurde (Entwurf 3.0).
  comparableItems: SnapshotCostItem[]
  separate: boolean
}

// Was ein Schnappschuss rechnet, wenn nicht die Betriebskostenabrechnung: die Heizkostenabrechnung
// einer Heizperiode (Weg d) oder die Heizperiode, die eine Abrechnung P nach Weg b aufnimmt.
export type SnapshotScope = { kind: 'heating' | 'heatingPart'; plant: SnapshotHeatingPlant }

// Gelesen werden Zähler, Datum, Stand und der Zählerwechsel mit dem Endstand des alten Geräts.
// Die eigene Kennung der Ablesung und die Notiz braucht die Verbrauchsrechnung nicht.
export type SnapshotReading = Pick<Reading, 'meterId' | 'date' | 'value' | 'replacement' | 'oldEndValue'>

// Gelesen werden Mietverhältnis, Datum und Betrag. Kennung und Notiz braucht das Mietkonto
// nicht: Es zählt die Zahlungen des Jahres zusammen und verteilt sie von Januar an auf die
// Monate, ohne die einzelne Zahlung auszuweisen.
export type SnapshotPayment = Pick<Payment, 'tenancyId' | 'date' | 'amountCents'>

// Die abgeschlossene (eingefrorene) Abrechnung des Jahres, eingedampft auf das, was die
// Berechnung daraus liest: den Eigenanteil selbstgenutzter Wohnungen (als Summe und je Position,
// #163) und die Vorauszahlungen, die auf dem zugestellten Papier standen. Beides nimmt die Steuerübersicht von dort, damit sie
// nicht von der versendeten Abrechnung abweicht. `null` heißt, das Jahr ist nicht abgeschlossen;
// dann rechnet die Steuerübersicht selbst.
export type SnapshotClosedSettlement = {
  selfUsedShareCents: number
  // Was die zugestellte Abrechnung bei den Vorauszahlungen ansetzte (#70). Dieselbe Begründung
  // wie beim Eigenanteil: Die Steuerübersicht nennt diese Zahl als die der Abrechnung, und für
  // ein abgeschlossenes Jahr ist das die des Archivstücks und nicht die, die die heutigen Daten
  // ergäben.
  prepaymentCents: number
  prepaymentOverridden: boolean
  // Der Eigenanteil je Kostenposition und ob die Abrechnung sie gar nicht verteilen konnte, aus
  // der Zerlegung des Vermieteranteils (#142). Die Steuerübersicht teilt damit die Werbungskosten
  // auf (#163). `null`: Das Archivstück kennt die Zerlegung nicht (vor #142). Optional, weil
  // Schnappschüsse, die eine Prüfung von Hand baut, ihn nicht brauchen; fehlt er, gilt dasselbe
  // wie bei `null`.
  selfUseByItem?: Record<string, FrozenItemSelfUse> | null
  // Die Positionen des eingefrorenen Stands mit ihrem Betrag, aus den Zeilen der Mieter und des
  // Vermieters (#163, Durchsicht). Eine Position, die hier fehlt oder deren Betrag sich seither
  // geändert hat, stand so nicht auf dem Papier; die Steuerübersicht rechnet sie heute. `null`:
  // Das Archivstück lässt sich nicht lesen; fehlt das Feld, gilt dasselbe.
  itemTotals?: Record<string, number> | null
  // Die Übertragszeilen der Mieter (Heizung PR 7), für die Gutschrift je Mieter bei einer zu hohen
  // Schätzung (8.2, A4). Fehlt das Feld, gibt es keine.
  fuelCarryRows?: FrozenFuelRow[]
  // Die Überträge des eingefrorenen Stands je Anlage, Heizperiode und Lieferung (Nachprüfung von #233).
  fuelCarries?: FrozenFuelCarryOut[]
  // Der Vorrat des eingefrorenen Stands (Heizung PR 8, G-A4), je `Anlage:Heizperiode`: der Endbestand,
  // aus dem die Folgeperiode ihren Anfangsbestand liest, und der Anfangsbestand, wenn er aus der
  // Vorperiode übernommen war; dann ist er deren Endbestand. Fehlt das Feld, kennt der Stand keinen.
  stockClosings?: Record<string, StockValue> | null
  stockOpenings?: Record<string, StockValue> | null
}
export type FrozenItemSelfUse = { selfCents: number, noBasis: boolean }

// Die Eigenanteile je Position aus den Zeilen des Vermieteranteils. Fehlt einer Zeile die
// Zerlegung, ist das Archivstück älter als #142, und dann gibt es keine Auskunft je Position:
// Eine teilweise gelesene wäre eine Behauptung über die übrigen Zeilen.
function selfUseOf(landlord: unknown): Record<string, FrozenItemSelfUse> | null {
  if (landlord === null || typeof landlord !== 'object') return null
  const rows: unknown = Reflect.get(landlord, 'rows')
  if (!Array.isArray(rows)) return null
  const result: Record<string, FrozenItemSelfUse> = {}
  for (const row of rows) {
    if (row === null || typeof row !== 'object') return null
    const id: unknown = Reflect.get(row, 'costItemId')
    const parts: unknown = Reflect.get(row, 'landlordParts')
    if (typeof id !== 'string' || !Array.isArray(parts)) return null
    const entry = result[id] ?? { selfCents: 0, noBasis: false }
    for (const part of parts) {
      if (part === null || typeof part !== 'object') continue
      const reason: unknown = Reflect.get(part, 'reason')
      const cents: unknown = Reflect.get(part, 'cents')
      if (reason === 'selfUse' && typeof cents === 'number') entry.selfCents += cents
      if (reason === 'noBasis') entry.noBasis = true
    }
    result[id] = entry
  }
  return result
}

// Die Beträge der Positionen, die im eingefrorenen Stand vorkommen: in einer Zeile eines Mieters
// oder des Vermieters. Eine Position, die ganz bei den Mietern lag, hat keine Zeile des Vermieters
// und gehört trotzdem dazu.
function itemTotalsOf(settlement: object): Record<string, number> | null {
  const rowsOf = (holder: unknown): unknown[] | null => {
    if (holder === null || typeof holder !== 'object') return null
    const rows: unknown = Reflect.get(holder, 'rows')
    return Array.isArray(rows) ? rows : null
  }
  const statements: unknown = Reflect.get(settlement, 'statements')
  const landlordRows = rowsOf(Reflect.get(settlement, 'landlord'))
  if (!Array.isArray(statements) || landlordRows === null) return null
  const rows = [...statements.flatMap((st) => rowsOf(st) ?? []), ...landlordRows]
  const result: Record<string, number> = {}
  for (const row of rows) {
    if (row === null || typeof row !== 'object') return null
    const id: unknown = Reflect.get(row, 'costItemId')
    const total: unknown = Reflect.get(row, 'totalCents')
    if (typeof id !== 'string' || typeof total !== 'number') return null
    result[id] = total
  }
  return result
}

// **Der eine Auszug aus einem eingefrorenen Berechnungsstand**, und zwar für beide Wege: die
// JSON-Datei unten und die Datenbank (`readClosedSettlements` in db/read.ts). Er nimmt `unknown`
// und nicht `Settlement`, denn ein Archivstück hat eine frühere Version geschrieben, und ein Typ
// darüber wäre eine Behauptung über etwas, für das niemand mehr geradesteht.
//
// **Dass er nur einmal dasteht, ist der Punkt.** Vorher zog die Datei ihre Felder mit
// `?? 0` und `?? []` heraus und die Datenbank mit geprüften Schritten. Bei sauberen Daten kam
// dasselbe heraus, bei krummen nicht: `statements` als Objekt statt als Liste warf auf dem einen
// Weg und ergab auf dem anderen 0. Zwei Leser desselben Archivstücks, die sich uneinig sind,
// sind genau die Sorte Unterschied, die beim Umstieg als „Abrechnung weicht ab“ auffällt und
// dann niemand erklären kann.
//
// Fehlt etwas, gilt 0 beziehungsweise „keine Korrektur“. Das ist die richtige Antwort und keine
// Notlösung: Was nicht auf dem Papier stand, hat der Mieter auch nicht bekommen. Ein
// Schnappschuss von vor v0.3.0 kennt den Eigenanteil noch gar nicht.
// Eine Übertragszeile eines eingefrorenen Stands (Heizung PR 7): `costItemId` ist
// `fuel:<Lieferung>:<Heizperiode>:<andere Heizperiode>:<Position>`.
export type FrozenFuelRow = { costItemId: string; tenancyId: string; tenantName: string; unitName: string; shareCents: number }

// Die Übertragszeilen aus einem Archivstück, wie `frozenSettlementOf` es liest: Was keine Zeile der Art
// `fuelCarry` ist oder nicht die erwartete Gestalt hat, fällt weg.
export function frozenFuelRowsOf(settlement: unknown): FrozenFuelRow[] {
  if (settlement === null || typeof settlement !== 'object') return []
  const statements: unknown = Reflect.get(settlement, 'statements')
  if (!Array.isArray(statements)) return []
  const rows: FrozenFuelRow[] = []
  for (const st of statements) {
    if (st === null || typeof st !== 'object') continue
    const tenancyId: unknown = Reflect.get(st, 'tenancyId')
    const tenantName: unknown = Reflect.get(st, 'tenantName')
    const unitName: unknown = Reflect.get(st, 'unitName')
    const list: unknown = Reflect.get(st, 'rows')
    if (typeof tenancyId !== 'string' || !Array.isArray(list)) continue
    for (const r of list) {
      if (r === null || typeof r !== 'object' || Reflect.get(r, 'kind') !== 'fuelCarry') continue
      const costItemId: unknown = Reflect.get(r, 'costItemId')
      const shareCents: unknown = Reflect.get(r, 'shareCents')
      if (typeof costItemId !== 'string' || typeof shareCents !== 'number') continue
      rows.push({ costItemId, tenancyId, tenantName: typeof tenantName === 'string' ? tenantName : '', unitName: typeof unitName === 'string' ? unitName : '', shareCents })
    }
  }
  return rows
}

// Was ein eingefrorener Stand je Anlage, Heizperiode und Lieferung in eine andere Heizperiode übertragen
// hat (`heating[].fuel.carries`; Heizung PR 7, Nachprüfung der Durchsicht von #233). Die Heizperiode, in
// die übertragen wurde, nimmt genau diesen Betrag, auch wenn sich die Positionen danach ändern.
export type FrozenFuelCarryOut = { plantId: string; period: string; deliveryId: string; other: string; cents: number; totalCents?: number }

export function frozenFuelCarriesOf(settlement: unknown): FrozenFuelCarryOut[] {
  if (settlement === null || typeof settlement !== 'object') return []
  const heating: unknown = Reflect.get(settlement, 'heating')
  if (!Array.isArray(heating)) return []
  const out: FrozenFuelCarryOut[] = []
  for (const h of heating) {
    if (h === null || typeof h !== 'object') continue
    const plantId: unknown = Reflect.get(h, 'plantId')
    const period: unknown = Reflect.get(h, 'period')
    const fuel: unknown = Reflect.get(h, 'fuel')
    const carries: unknown = fuel !== null && typeof fuel === 'object' ? Reflect.get(fuel, 'carries') : undefined
    if (typeof plantId !== 'string' || typeof period !== 'string' || !Array.isArray(carries)) continue
    for (const c of carries) {
      if (c === null || typeof c !== 'object') continue
      const deliveryId: unknown = Reflect.get(c, 'deliveryId')
      const other: unknown = Reflect.get(c, 'period')
      const cents: unknown = Reflect.get(c, 'cents')
      const totalCents: unknown = Reflect.get(c, 'totalCents')
      if (typeof deliveryId === 'string' && typeof other === 'string' && typeof cents === 'number') {
        out.push({ plantId, period, deliveryId, other, cents, ...(typeof totalCents === 'number' ? { totalCents } : {}) })
      }
    }
  }
  return out
}

// Der Vorrat aus `heating` eines Stands (Heizung PR 8): Endbestände und übernommene Anfangsbestände je
// `Anlage:Heizperiode`. Ein Eintrag, der sich nicht lesen lässt, fehlt; dann gilt der eingetragene Wert.
function stockOf(heating: unknown, which: 'closing' | 'opening'): Record<string, StockValue> | null {
  if (!Array.isArray(heating)) return null
  const out: Record<string, StockValue> = {}
  for (const h of heating) {
    if (h === null || typeof h !== 'object') continue
    const plantId: unknown = Reflect.get(h, 'plantId')
    const period: unknown = Reflect.get(h, 'period')
    const stock: unknown = Reflect.get(h, 'stock')
    if (typeof plantId !== 'string' || typeof period !== 'string' || stock === null || typeof stock !== 'object') continue
    if (which === 'opening' && Reflect.get(stock, 'openingSource') === 'own') continue
    // Weitergegeben wird, was die Heizperiode weitergibt (`handover`, #237 C1/I1); ältere Stände kennen nur den Endbestand.
    const handover: unknown = which === 'closing' ? Reflect.get(stock, 'handover') : undefined
    const value = readFrozenStock(handover ?? Reflect.get(stock, which))
    if (value) out[`${plantId}:${period}`] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

export function frozenSettlementOf(settlement: unknown): SnapshotClosedSettlement & { selfUseByItem: Record<string, FrozenItemSelfUse> | null, itemTotals: Record<string, number> | null, fuelCarryRows: FrozenFuelRow[], fuelCarries: FrozenFuelCarryOut[], stockClosings: Record<string, StockValue> | null, stockOpenings: Record<string, StockValue> | null } {
  const leer = { selfUsedShareCents: 0, prepaymentCents: 0, prepaymentOverridden: false, selfUseByItem: null, itemTotals: null, fuelCarryRows: [], fuelCarries: [], stockClosings: null, stockOpenings: null }
  if (settlement === null || typeof settlement !== 'object') return leer
  const eigenanteil: unknown = Reflect.get(settlement, 'selfUsedShareCents')
  const statements: unknown = Reflect.get(settlement, 'statements')
  const auszug = {
    ...leer,
    selfUsedShareCents: typeof eigenanteil === 'number' ? eigenanteil : 0,
    selfUseByItem: selfUseOf(Reflect.get(settlement, 'landlord')),
    itemTotals: itemTotalsOf(settlement),
    fuelCarryRows: frozenFuelRowsOf(settlement),
    fuelCarries: frozenFuelCarriesOf(settlement),
    stockClosings: stockOf(Reflect.get(settlement, 'heating'), 'closing'),
    stockOpenings: stockOf(Reflect.get(settlement, 'heating'), 'opening'),
  }
  // Ergeben die Eigenanteile je Position nicht die Summe des Papiers, ist das Archivstück in sich
  // nicht stimmig (etwa von Hand gebaut), und dann gilt nur die Summe; die Steuerübersicht verteilt
  // sie wie bei einem Stand von vor #142 (#163).
  if (auszug.selfUseByItem && Object.values(auszug.selfUseByItem).reduce((a, x) => a + x.selfCents, 0) !== auszug.selfUsedShareCents) {
    auszug.selfUseByItem = null
  }
  if (!Array.isArray(statements)) return auszug
  for (const statement of statements) {
    if (statement === null || typeof statement !== 'object') continue
    const betrag: unknown = Reflect.get(statement, 'prepaymentCents')
    if (typeof betrag === 'number') auszug.prepaymentCents += betrag
    if (Reflect.get(statement, 'prepaymentOverridden') === true) auszug.prepaymentOverridden = true
  }
  return auszug
}

export type Snapshot = {
  // Der Abrechnungszeitraum (#208). Er gehört zum Schnappschuss, nicht neben ihn: Sonst ließe sich
  // ein Schnappschuss mit einem anderen Zeitraum verrechnen, und weil die Kostenpositionen dann
  // fehlten, käme eine leere statt einer falschen Abrechnung heraus. Der Fehler fiele erst dem
  // Mieter auf.
  period: BillingPeriod
  // Der Zeitraum davor, für den Vergleich der Schlüssel und der Doppelungen (#141).
  previousPeriod: BillingPeriod
  // Das Kalenderjahr, in dem `period` beginnt. Mietkonto und Steuer rechnen im Kalenderjahr.
  year: number
  // Das Objekt, dessen Daten der Schnappschuss trägt (#92), aus demselben Grund wie das Jahr:
  // Er soll sich nicht mit einem anderen verwechseln lassen. `null` ist ein Bestand ohne
  // Objekte, also der Stand von Migration 0000, wie ihn Regression und Umstieg rechnen.
  propertyId: string | null
  units: SnapshotUnit[]
  tenancies: SnapshotTenancy[]
  costItems: SnapshotCostItem[]
  meters: SnapshotMeter[]
  readings: SnapshotReading[]
  payments: SnapshotPayment[]
  closedSettlement: SnapshotClosedSettlement | null
  // Was die Berechnung vom Objekt wissen muss (#121). Fehlt es, etwa beim Umstieg aus einer
  // db.json, rechnet sie wie ohne die Angabe.
  property?: SnapshotProperty | null
  // Die Kostenpositionen des Vorjahres (#141), nur für den Hinweis, dass eine Position einen
  // anderen Schlüssel hat als dieselbe Kostenart im Vorjahr. Verteilt wird nichts davon. Fehlt
  // die Angabe, etwa in einem von Hand gebauten Schnappschuss, entfällt nur der Hinweis.
  previousCostItems?: SnapshotCostItem[]
  // Nur in der Teilrechnung einer Heizperiode: womit der Vergleich mit dem Vorjahr statt mit
  // `previousCostItems` rechnet (`SnapshotHeatingPart.comparableItems`). `previousCostItems` bleibt
  // die Vorperiode der Heizung, denn mit ihr rechnet der Vorschlag nach § 560 einen Rumpf hoch.
  comparableCostItems?: SnapshotCostItem[]
  // Die Heizanlagen des Objekts (Heizung PR 4). Fehlt die Angabe (db.json, Regression, ein von Hand
  // gebauter Schnappschuss), rechnet die Berechnung wie ohne Anlage, und dasselbe gilt für eine
  // leere Liste.
  heatingPlants?: SnapshotHeatingPlant[]
  // CO₂-Angaben und Warmwasser je Heizperiode (Heizung PR 6). Fehlt die Angabe, rechnet die
  // Berechnung wie ohne Angaben: Hinweise ja, Buchung nein.
  co2Statements?: Co2Statement[]
  heatingPeriodRows?: SnapshotHeatingPeriodRow[]
  // Heizung PR 5. Der Rhythmus des Objekts (für die empfohlene Frist und die Frage H = P), die
  // Heizperioden, die in P enden, und was der Schnappschuss rechnet. Fehlt alles (db.json, Umstieg,
  // Regression, ein von Hand gebauter Schnappschuss), rechnet die Berechnung wie bisher.
  objectRules?: PeriodRules
  heatingParts?: SnapshotHeatingPart[]
  scope?: SnapshotScope
  // Lieferungen, Überträge und abgeschlossene Heizperioden (Heizung PR 7). Fehlt das Feld, gibt es
  // keine Lieferungen, und die Berechnung rechnet wie vorher.
  fuel?: SnapshotFuel
  // Je Anlage mit Vorratsenergie und Heizperiode dieser Berechnung die Kette für die
  // Bestandsrechnung (Heizung PR 8). Fehlt sie, gibt es keinen Vorrat.
  stockChains?: SnapshotStockChain[]
}

// Die Lieferungen im Schnappschuss (Heizung PR 7, Entwurf 5.8). Die Abgrenzung liest Zeitraum, Betrag,
// feste Bestandteile, Anteil, Ausstoß und CO₂-Kosten; Menge, Heizwert und Rechnungsdatum nicht.
export type SnapshotFuelDelivery = Pick<
  FuelDelivery,
  'id' | 'plantId' | 'label' | 'invoiceFrom' | 'invoiceTo' | 'deliveredAt' | 'amountCents' | 'fixedCents' | 'sharePermille' | 'emissionsKg' | 'co2CostCents' | 'estimated' | 'usedByService' | 'parts'
> & Partial<Pick<FuelDelivery, 'invoiceDate' | 'quantity' | 'quantityUnit' | 'unitId'>>
// Rechnungsdatum, Menge und Einheit liest seit Heizung PR 8 die Bestandsrechnung; optional, damit ein
// von Hand gebauter Schnappschuss einer Gasrechnung sie nicht nennen muss.
// Eine abgeschlossene Heizperiode einer Anlage, mit der Bezeichnung und der Frist der Abrechnung, die
// sie abgeschlossen hat, und deren Übertragszeilen.
// `carries`: was diese Heizperiode beim Abschluss je Lieferung in andere übertragen hat.
export type SnapshotClosedHeating = { plantId: string; period: PeriodKey; label: string; deadline: string; fuelRows: FrozenFuelRow[]; carries?: { deliveryId: string; other: string; cents: number }[] }
export type SnapshotFuel = {
  deliveries: SnapshotFuelDelivery[]
  items: SnapshotCostItem[]
  frozen: FrozenFuelCarry[]
  closed: SnapshotClosedHeating[]
  degreeDays: DegreeDayValue[]
}

type FuelSource = {
  fuelDeliveries?: SnapshotFuelDelivery[]
  fuelCarryFrozen?: FrozenFuelCarry[]
  degreeDayValues?: (DegreeDayValue & { propertyId: string })[]
  closedHeatingSettlements?: (SnapshotClosedSettlement & { plantId: string; period: PeriodKey })[]
}

// Die Lieferungen der Anlagen eines Objekts (Heizung PR 7): alle, mit den Positionen, die auf sie
// zeigen, über alle Zeiträume; die eingefrorenen Überträge; die abgeschlossenen Heizperioden. Eine
// Heizperiode ist abgeschlossen mit der Abrechnung des Objektzeitraums, in dem sie endet, oder nach
// Weg d mit ihrer Heizkostenabrechnung (W1, B3). Ohne Lieferung `undefined`: Dann bleibt der
// Schnappschuss, wie er war, und keine Abrechnung ändert sich.
const carriesOf = (list: FrozenFuelCarryOut[] | undefined, plantId: string, period: string) =>
  (list ?? []).filter((x) => x.plantId === plantId && x.period === period).map(({ deliveryId, other, cents, totalCents }) => ({ deliveryId, other, cents, ...(totalCents !== undefined ? { totalCents } : {}) }))

function fuelSnapshotOf(
  source: FuelSource,
  propertyId: string,
  narrowed: { costItems: SnapshotCostItem[]; closedSettlements: (SnapshotClosedSettlement & { period: PeriodKey })[] },
  plants: readonly SnapshotHeatingPlant[],
  objectRules: PeriodRules,
): SnapshotFuel | undefined {
  const plantIds = new Set(plants.map((p) => p.id))
  const deliveries = (source.fuelDeliveries ?? []).filter((d) => plantIds.has(d.plantId))
  if (deliveries.length === 0) return undefined
  const ids = new Set(deliveries.map((d) => d.id))
  const closed: SnapshotClosedHeating[] = []
  for (const plant of plants) {
    const way = wayOf(plant)
    const rules = plantRules(way, objectRules)
    const own = (plant.periodStartMonth ?? null) !== null
    for (const c of narrowed.closedSettlements) {
      const p = periodOfKey(objectRules, c.period)
      if (!p) continue
      const hs = own ? heatingPeriodsEndingIn(rules, p).filter((h) => !settledSeparately(way, objectRules, h)) : [p]
      for (const h of hs) closed.push({ plantId: plant.id, period: h.key, label: periodLabel(p), deadline: settlementDeadline(p), fuelRows: c.fuelCarryRows ?? [], carries: carriesOf(c.fuelCarries, plant.id, h.key) })
    }
    for (const c of (source.closedHeatingSettlements ?? []).filter((x) => x.plantId === plant.id)) {
      const h = periodOfKey(rules, c.period)
      if (h) closed.push({ plantId: plant.id, period: h.key, label: periodLabel(h), deadline: settlementDeadline(h), fuelRows: c.fuelCarryRows ?? [], carries: carriesOf(c.fuelCarries, plant.id, h.key) })
    }
  }
  return {
    deliveries,
    items: narrowed.costItems.filter((c) => c.fuelDeliveryId != null && ids.has(c.fuelDeliveryId)),
    frozen: (source.fuelCarryFrozen ?? []).filter((f) => plantIds.has(f.plantId)),
    closed,
    degreeDays: (source.degreeDayValues ?? []).filter((v) => v.propertyId === propertyId).map(({ month, value }) => ({ month, value })),
  }
}

export type SnapshotProperty = Pick<Property, 'kind' | 'cableBuiltBeforeDec2021'>

// Die Sammlungen, aus denen ein Schnappschuss entsteht, ohne die Frage, woher sie kommen. Die
// JSON-Datei füllt sie über `snapshotFromDb` unten, die Datenbank über `snapshotFromStock` in
// db/read.ts.
//
// **Die Regel, was nach Jahr eingegrenzt wird, steht deshalb nur einmal**, nämlich in
// `snapshotOf`. Zwei Fassungen davon wären die gefährlichste Doppelung im ganzen Umbau: Wer
// dort zu viel eingrenzt, bekommt keine Fehlermeldung, sondern eine stille Falschrechnung
// (siehe die Begründung je Sammlung unten).
export type SnapshotSource = {
  units: SnapshotUnit[]
  tenancies: SnapshotTenancy[]
  costItems: SnapshotCostItem[]
  meters: SnapshotMeter[]
  readings: SnapshotReading[]
  payments: SnapshotPayment[]
  // Alle Jahre, jedes eingedampft auf das, was die Berechnung daraus liest.
  closedSettlements: (SnapshotClosedSettlement & { period: PeriodKey })[]
  // Die abgeschlossenen Heizkostenabrechnungen nach Weg d (Heizung PR 5); fehlt die Angabe, gibt es keine.
  closedHeatingSettlements?: (SnapshotClosedSettlement & { plantId: string; period: PeriodKey })[]
}

// Ein Bestand, dessen Wurzeln ihr Objekt tragen (#92). db/read.ts `Stock` erfüllt ihn.
//
// Generisch über die Datensätze, damit `narrowToProperty` zurückgibt, was hineinging: Die
// Routen listen damit vollständige Datensätze auf, der Schnappschuss liest nur seinen Ausschnitt.
// Eine Regel für beide, und keine Behauptung über einen Typ.
export type ScopedSource<
  U extends SnapshotUnit & { propertyId: string } = SnapshotUnit & { propertyId: string },
  T extends SnapshotTenancy = SnapshotTenancy,
  C extends SnapshotCostItem & { propertyId: string } = SnapshotCostItem & { propertyId: string },
  M extends SnapshotMeter & { propertyId: string } = SnapshotMeter & { propertyId: string },
  R extends SnapshotReading = SnapshotReading,
  P extends SnapshotPayment = SnapshotPayment,
  X extends SnapshotClosedSettlement & { period: PeriodKey, propertyId: string } = SnapshotClosedSettlement & { period: PeriodKey, propertyId: string },
> = { units: U[], tenancies: T[], costItems: C[], meters: M[], readings: R[], payments: P[], closedSettlements: X[] }

export type PropertyScopedSource = ScopedSource

// Grenzt einen Bestand auf ein Objekt ein, und das **nur hier**.
//
// Ein fehlender Filter ergibt keine Fehlermeldung, sondern eine Verteilung über zwei Häuser: Die
// Verteilbasis bekäme die Wohnungen des anderen Objekts, und jeder Mieter trüge einen zu
// kleinen, der Vermieter einen zu großen Anteil. Deshalb steht die Regel einmal; die Routen
// rechnen über `snapshotFor` und listen über diese Funktion.
//
// Die Wurzeln (Wohnungen, Zähler samt Hauptzähler, Kostenpositionen, Abschlüsse) tragen ihr
// Objekt. Was erbt, folgt seiner Wurzel: Mietverhältnisse ihrer Wohnung, Zahlungen ihrem
// Mietverhältnis, Ablesungen ihrem Zähler. Nach Jahr wird hier nichts eingegrenzt; das bleibt
// die Sache von `snapshotOf`.
export function narrowToProperty<
  U extends SnapshotUnit & { propertyId: string },
  T extends SnapshotTenancy,
  C extends SnapshotCostItem & { propertyId: string },
  M extends SnapshotMeter & { propertyId: string },
  R extends SnapshotReading,
  P extends SnapshotPayment,
  X extends SnapshotClosedSettlement & { period: PeriodKey, propertyId: string },
>(source: ScopedSource<U, T, C, M, R, P, X>, propertyId: string): ScopedSource<U, T, C, M, R, P, X> {
  const units = source.units.filter((u) => u.propertyId === propertyId)
  const unitIds = new Set(units.map((u) => u.id))
  const tenancies = source.tenancies.filter((t) => unitIds.has(t.unitId))
  const tenancyIds = new Set(tenancies.map((t) => t.id))
  const meters = source.meters.filter((m) => m.propertyId === propertyId)
  const meterIds = new Set(meters.map((m) => m.id))
  return {
    units,
    tenancies,
    costItems: source.costItems.filter((c) => c.propertyId === propertyId),
    meters,
    readings: source.readings.filter((r) => meterIds.has(r.meterId)),
    payments: source.payments.filter((p) => tenancyIds.has(p.tenancyId)),
    closedSettlements: source.closedSettlements.filter((c) => c.propertyId === propertyId),
  }
}

// ---------- Brennstoffvorrat (Heizung PR 8, Entwurf 5.8, 8.2) ----------

// Je Anlage mit Vorratsenergie und Heizperiode dieser Berechnung die Kette der Heizperioden für die
// Bestandsrechnung (fuelStock.ts): die Heizperiode selbst und davor jede Vorperiode mit eingetragenem
// Endbestand, bis zur ersten, deren Endbestand eingefroren ist. Lieferungen gehören zur Heizperiode
// ihres Lieferdatums (Entwurf 5.4); geschätzte Lieferungen (PR 7) gibt es beim Vorrat nicht. Der Betrag
// einer Lieferung ist Σ ihrer Positionen, über alle Zeiträume, sonst der an der Lieferung (5.4).
// Ist die Folgeperiode einer Heizperiode abgeschlossen und hat sie deren Endbestand übernommen, steht
// ihr eingefrorener Anfangsbestand dabei (`nextFrozenOpening`, G-A4).
export type SnapshotStockChain = { plantId: string; period: PeriodKey; chain: StockPeriodInput[] }

export type StockChainSource = {
  costItems: readonly Pick<SnapshotCostItem, 'amountCents' | 'fuelDeliveryId' | 'category' | 'heatingPlantId' | 'heatingPart' | 'key' | 'period' | 'description'>[]
  closedSettlements: readonly (SnapshotClosedSettlement & { period: PeriodKey })[]
  closedHeatingSettlements?: readonly (SnapshotClosedSettlement & { plantId: string; period: PeriodKey })[]
  heatingPeriodRows?: readonly SnapshotHeatingPeriodRow[]
  fuelDeliveries?: readonly SnapshotFuelDelivery[]
}

// Mehr Vorperioden liest niemand; eine längere Kette ohne eingefrorenen Endbestand gibt es nur bei
// einem Bestand, der hundert Heizperioden nie abgeschlossen hat.
const STOCK_CHAIN_LIMIT = 100

// `plants`: die Anlagen des Objekts. Ersetzt die Anlage eine mit demselben Vorratsbrennstoff (Kesseltausch
// Öl → Öl, Recht I1 der Durchsicht von #238), beginnt ihre Kette mit der Kette der alten: Deren Restbestand
// ist ihr Anfangsbestand, außer der Vermieter hat einen eigenen eingetragen.
export function stockChainsOf(source: StockChainSource, plant: SnapshotHeatingPlant, objectRules: PeriodRules, hs: readonly BillingPeriod[], plants: readonly SnapshotHeatingPlant[] = []): SnapshotStockChain[] {
  if (!isStockEnergy(plant.energy)) return []
  const way = wayOf(plant)
  const rules = plantRules(way, objectRules)
  const rows = new Map((source.heatingPeriodRows ?? []).filter((r) => r.plantId === plant.id).map((r) => [String(r.period), r]))
  const deliveries = (source.fuelDeliveries ?? []).filter((d) => d.plantId === plant.id && !d.estimated)
  const linked = new Map<string, number>()
  for (const c of source.costItems) {
    if (c.fuelDeliveryId) linked.set(c.fuelDeliveryId, (linked.get(c.fuelDeliveryId) ?? 0) + c.amountCents)
  }
  const dateOf = (d: SnapshotFuelDelivery): string | null => d.deliveredAt ?? d.invoiceDate ?? null
  const labelOf = (d: SnapshotFuelDelivery, date: string): string => d.label || `Lieferung vom ${germanDate(date)}`
  // Der eingefrorene Stand, der eine Heizperiode abgeschlossen hat: ihre Heizkostenabrechnung nach
  // Weg d, sonst die Abrechnung des Objektzeitraums, in dem sie endet (W1, B3).
  const closedOf = (p: BillingPeriod): SnapshotClosedSettlement | undefined =>
    settledSeparately(way, objectRules, p)
      ? source.closedHeatingSettlements?.find((c) => c.plantId === plant.id && c.period === p.key)
      : source.closedSettlements.find((c) => c.period === periodContaining(objectRules, p.to).key)
  const frozenOf = (p: BillingPeriod): StockValue | null => closedOf(p)?.stockClosings?.[`${plant.id}:${p.key}`] ?? null
  const nextOf = (p: BillingPeriod): BillingPeriod => periodContaining(rules, dayAfter(p.to))
  // Kesseltausch mit demselben Brennstoff (Durchsicht von #238): Die Folgeperiode der letzten Heizperiode
  // ist die erste der neuen Anlage; ob sie den Restbestand übernommen hat, steht unter deren Kennung.
  // Mit „nein“ auf die Frage, ob die neue Anlage den Brennstoff weiter verheizt, übernimmt sie nichts.
  const successor = plants.find((p) => p.replacesPlantId === plant.id && p.energy === plant.energy && p.takesOverStock !== false)
  const endsIn = (p: BillingPeriod): boolean => endsOn !== null && endsOn >= p.from && endsOn <= p.to
  const handoverTo = (): { id: string; period: BillingPeriod } | null =>
    successor && endsOn !== null ? { id: successor.id, period: periodContaining(plantRules(wayOf(successor), objectRules), dayAfter(endsOn)) } : null
  const nextFrozenOf = (p: BillingPeriod): StockValue | null => {
    const to = endsIn(p) ? handoverTo() : null
    if (endsIn(p)) return to ? closedOf(to.period)?.stockOpenings?.[`${to.id}:${to.period.key}`] ?? null : null
    const next = nextOf(p)
    return closedOf(next)?.stockOpenings?.[`${plant.id}:${next.key}`] ?? null
  }
  const nextClosedOf = (p: BillingPeriod): boolean => {
    if (!endsIn(p)) return closedOf(nextOf(p)) !== undefined
    const to = handoverTo()
    return to !== null && closedOf(to.period) !== undefined
  }
  const itemsIn = (key: string) => source.costItems.filter((c) => c.period === key)
  // Hat diese Heizperiode Heizkosten der Anlage abgerechnet (C1, Nachprüfung N2)? Indiz ist jede Position
  // der Kostenart Heizung mit Betrag an dieser Anlage oder ohne Anlage, außer sie ist ausdrücklich kein
  // Brennstoff (Betrieb, Messdienst). Dann ist der Anfangsbestand der Folgeperiode vermutlich schon
  // umgelegt. „Abgeschlossen ohne Vorrat“ allein ist kein Indiz.
  const previousFuelOf = (p: BillingPeriod): PreviousFuel | null => {
    const fuel = itemsIn(p.key).filter((c) => c.category === HEATING_CATEGORY && c.amountCents !== 0 && (c.heatingPlantId === plant.id || !c.heatingPlantId) && (c.heatingPart ?? 'fuel') === 'fuel')
    if (fuel.length === 0) return null
    const explicit = fuel.filter((c) => c.heatingPart === 'fuel' || (c.fuelDeliveryId ?? null) !== null)
    // Gutschriften ohne Kennzeichen zählen nicht gegen die Schwelle (Nachprüfung von 819398e).
    const loose = fuel.filter((c) => !explicit.includes(c) && c.amountCents > 0)
    return {
      label: periodLabel(p), cents: fuel.reduce((a, c) => a + c.amountCents, 0), explicitCents: explicit.reduce((a, c) => a + c.amountCents, 0),
      loose: loose.map((c) => ({ description: c.description, cents: c.amountCents })),
    }
  }
  // Kesseltausch (Heizung PR 9): Eine stillgelegte Anlage heizt nur bis zu ihrem letzten Betriebstag;
  // dort endet ihre letzte Heizperiode, und dort wird der Restbestand gepeilt.
  const endsOn = plant.endsOn ?? null
  const inputOf = (p: BillingPeriod): StockPeriodInput => {
    const to = endsOn !== null && endsOn >= p.from && endsOn < p.to ? endsOn : p.to
    const row = rows.get(p.key)
    const measured = row?.closingMeasuredOn ?? null
    const opening = row?.openingQuantity ?? null
    return {
      key: p.key,
      label: periodLabel(p),
      from: p.from,
      to,
      unit: row?.stockUnit ?? null,
      ownOpening: row && opening !== null
        ? {
          quantity: opening, costCents: row.openingCostCents ?? null, emissionsKg: row.openingEmissionsKg ?? null, co2Cents: row.openingCo2Cents ?? null,
          invoicedBefore2023: row.openingInvoicedBefore2023 ?? null,
          // Ohne Antwort gilt „schon umgelegt“, wenn die Vorperiode Heizkosten der Anlage abgerechnet hat (C1, N2).
          alreadySettled: row.openingAlreadySettled ?? settledByDefault(previousFuelOf(previousPeriod(rules, p)), row.openingCostCents ?? null) !== null,
          settledSource: row.openingAlreadySettled === null || row.openingAlreadySettled === undefined
            ? (settledByDefault(previousFuelOf(previousPeriod(rules, p)), row.openingCostCents ?? null) ?? 'default')
            : 'entered' as const,
        }
        : null,
      previousFuel: previousFuelOf(previousPeriod(rules, p)),
      closedWithoutStock: closedOf(p) !== undefined && frozenOf(p) === null,
      closingQuantity: row?.closingQuantity ?? null,
      closingMeasuredOn: measured,
      deliveries: deliveries.flatMap((d) => {
        const date = dateOf(d)
        if (date === null || date < p.from || date > to) return []
        return [{
          id: d.id, label: labelOf(d, date), date, invoiceDate: d.invoiceDate ?? date, quantity: d.quantity ?? null, quantityUnit: d.quantityUnit ?? null,
          costCents: linked.get(d.id) ?? d.amountCents, emissionsKg: d.emissionsKg, co2Cents: d.co2CostCents,
        }]
      }),
      laterDeliveries: measured !== null && measured > to
        ? deliveries.flatMap((d) => {
          const date = dateOf(d)
          return date !== null && date > to && date <= measured ? [{ label: labelOf(d, date), date }] : []
        })
        : [],
      frozenClosing: frozenOf(p),
      nextFrozenOpening: nextFrozenOf(p),
      hasKey: stockTemplateOfLine(itemsIn(p.key), itemsIn(previousPeriod(rules, p).key), sameFuelLine(plant, plants), HEATING_CATEGORY) !== null,
      // Nach dem letzten Betriebstag gibt es keine Folgeperiode, die den Endbestand übernähme.
      nextClosedWithoutStock: nextClosedOf(p) && nextFrozenOf(p) === null,
    }
  }
  const predecessor = plant.replacesPlantId && plant.takesOverStock !== false ? plants.find((p) => p.id === plant.replacesPlantId && p.energy === plant.energy) : undefined
  const startsOn = predecessor?.endsOn ? dayAfter(predecessor.endsOn) : null
  return hs.filter((h) => (endsOn === null || endsOn >= h.from) && (startsOn === null || startsOn <= h.to)).map((h) => {
    const chain = [inputOf(h)]
    let cur = h
    for (let i = 0; i < STOCK_CHAIN_LIMIT; i++) {
      // Die erste Heizperiode nach einem Tausch mit demselben Brennstoff: weiter in der Kette der alten.
      if (predecessor && startsOn !== null && cur.from <= startsOn && startsOn <= cur.to) {
        if (!chain[0]?.ownOpening && predecessor.endsOn) {
          // Die letzte Heizperiode der alten Anlage: dieselbe oder, bei einem Tausch zum Ersten, die davor.
          const last = periodContaining(plantRules(wayOf(predecessor), objectRules), predecessor.endsOn)
          const before = stockChainsOf(source, predecessor, objectRules, [last], plants)[0]?.chain ?? []
          chain.unshift(...before.map((x) => ({ ...x, plantName: predecessor.name ?? '' })))
        }
        break
      }
      const prev = previousPeriod(rules, cur)
      const input = inputOf(prev)
      if (!input.frozenClosing && input.closingQuantity === null && !input.nextFrozenOpening) break
      chain.unshift(input)
      if (input.frozenClosing) break
      cur = prev
    }
    return { plantId: plant.id, period: h.key, chain }
  })
}

// Der Schnappschuss eines Objekts in einem Abrechnungszeitraum. Die Routen rechnen nur hierüber; den
// Vorzeitraum bestimmt der Rhythmus des Objekts (#208).
//
// **Eigene Heizperiode (Heizung PR 5).** Die Positionen einer Anlage mit eigener Heizperiode tragen
// den Schlüssel ihrer Heizperiode, nicht den von P (Entwurf 3.0); ein gleicher Schlüssel hieße nicht
// dieselben Tage. Sie gehen deshalb nicht in `costItems`, sondern je Heizperiode, die in P endet, in
// `heatingParts`. Ohne eigene Heizperiode bleibt alles wie bisher.
export function snapshotFor(
  source: PropertyScopedSource & {
    properties?: (SnapshotProperty & { id: string, periodRules?: PeriodRules })[]
    heatingPlants?: (SnapshotHeatingPlant & { propertyId: string })[]
    // CO₂-Angaben und Zeilen der Heizperioden (Heizung PR 6); sie erben das Objekt über die Anlage.
    co2Statements?: Co2Statement[]
    heatingPeriodRows?: SnapshotHeatingPeriodRow[]
    // Die abgeschlossenen Heizkostenabrechnungen (Heizung PR 5), für `heatingSnapshotFor`.
    closedHeatingSettlements?: (SnapshotClosedSettlement & { plantId: string; period: PeriodKey })[]
  } & FuelSource,
  propertyId: string,
  period: BillingPeriod,
): Snapshot {
  const found = source.properties?.find((p) => p.id === propertyId)
  const objectRules = rulesOf(found)
  const narrowed = narrowToProperty(source, propertyId)
  const plants = (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId)
  const own = plants.filter((p) => (p.periodStartMonth ?? null) !== null)
  const ownIds = new Set(own.map((p) => p.id))
  const general = { ...narrowed, costItems: narrowed.costItems.filter((c) => !(c.heatingPlantId && ownIds.has(c.heatingPlantId))) }
  const heatingParts = own.flatMap((plant) => {
    const way = wayOf(plant)
    const rules = plantRules(way, objectRules)
    const mine = narrowed.costItems.filter((c) => c.heatingPlantId === plant.id)
    const priorP = previousPeriod(objectRules, period).key
    const ways = own.map((p) => ({ ...wayOf(p), id: p.id }))
    const prior = narrowed.costItems.filter((c) =>
      (c.heatingPlantId === plant.id || (!c.heatingPlantId && c.category === HEATING_CATEGORY)) && settlementKeyOf(c, objectRules, ways).key === priorP)
    return heatingPeriodsEndingIn(rules, period).map((h): SnapshotHeatingPart => {
      const previous = previousPeriod(rules, h)
      return {
        plantId: plant.id, period: h, previous,
        items: mine.filter((c) => c.period === h.key),
        previousItems: mine.filter((c) => c.period === previous.key),
        comparableItems: prior.map((c) => (c.period === previous.key ? c : { ...c, period: previous.key })),
        separate: settledSeparately(way, objectRules, h),
      }
    })
  })
  const fuel = fuelSnapshotOf(source, propertyId, narrowed, plants, objectRules)
  // Brennstoffvorrat (Heizung PR 8): je Anlage mit Vorratsenergie die Kette ihrer Heizperioden in P.
  // Eine Anlage mit eigener Heizperiode rechnet in jeder Heizperiode, die in P endet.
  const stockSource: StockChainSource = {
    costItems: narrowed.costItems,
    closedSettlements: narrowed.closedSettlements,
    closedHeatingSettlements: source.closedHeatingSettlements,
    heatingPeriodRows: source.heatingPeriodRows,
    fuelDeliveries: source.fuelDeliveries,
  }
  const stockChains = plants.flatMap((p) =>
    stockChainsOf(stockSource, p, objectRules, hasOwnRhythm(wayOf(p)) ? heatingPeriodsEndingIn(plantRules(wayOf(p), objectRules), period) : [period], plants))
  return {
    ...snapshotOfPeriod(general, period, previousPeriod(objectRules, period)),
    propertyId,
    property: found ? { kind: found.kind, cableBuiltBeforeDec2021: found.cableBuiltBeforeDec2021 ?? null } : null,
    // Die Anlagen tragen ihr Objekt wie die Wurzeln in `narrowToProperty`; eingegrenzt wird hier.
    heatingPlants: plants,
    co2Statements: (source.co2Statements ?? []).filter((c) => plants.some((p) => p.id === c.plantId)),
    heatingPeriodRows: (source.heatingPeriodRows ?? []).filter((r) => plants.some((p) => p.id === r.plantId)),
    objectRules,
    ...(heatingParts.length > 0 ? { heatingParts } : {}),
    ...(fuel ? { fuel } : {}),
    ...(stockChains.length > 0 ? { stockChains } : {}),
  }
}

// Der Schnappschuss der Heizkostenabrechnung einer Heizperiode nach Weg d (Heizung PR 5, Entwurf
// 3.1, 6.1 Nr. 7): nur die Positionen der Anlage unter dieser Heizperiode; Mietverhältnisse,
// Ablesungen und Zahlungen wie immer vollständig. Der abgeschlossene Stand ist der der
// Heizkostenabrechnung und nie der einer Abrechnung des Objekts mit zufällig gleichem Schlüssel.
// Ob die Heizperiode wirklich getrennt abgerechnet wird, prüft die Route; `null` ohne Anlage.
export function heatingSnapshotFor(source: Parameters<typeof snapshotFor>[0], propertyId: string, plantId: string, h: BillingPeriod): Snapshot | null {
  const found = source.properties?.find((p) => p.id === propertyId)
  const objectRules = rulesOf(found)
  const plants = (source.heatingPlants ?? []).filter((p) => p.propertyId === propertyId)
  const plant = plants.find((p) => p.id === plantId)
  if (!plant) return null
  const rules = plantRules(wayOf(plant), objectRules)
  const narrowed = narrowToProperty(source, propertyId)
  const mine = narrowed.costItems.filter((c) => c.heatingPlantId === plantId)
  const frozen = (source.closedHeatingSettlements ?? []).find((c) => c.plantId === plantId && c.period === h.key)
  const fuel = fuelSnapshotOf(source, propertyId, narrowed, plants, objectRules)
  // Heizung PR 8: die Kette des Vorrats für diese eine Heizperiode.
  const stockChains = stockChainsOf({
    costItems: narrowed.costItems,
    closedSettlements: narrowed.closedSettlements,
    closedHeatingSettlements: source.closedHeatingSettlements,
    heatingPeriodRows: source.heatingPeriodRows,
    fuelDeliveries: source.fuelDeliveries,
  }, plant, objectRules, [h])
  return {
    ...snapshotOfPeriod({ ...narrowed, costItems: mine, closedSettlements: [] }, h, previousPeriod(rules, h)),
    propertyId,
    property: found ? { kind: found.kind, cableBuiltBeforeDec2021: found.cableBuiltBeforeDec2021 ?? null } : null,
    heatingPlants: plants,
    co2Statements: (source.co2Statements ?? []).filter((c) => c.plantId === plantId),
    heatingPeriodRows: (source.heatingPeriodRows ?? []).filter((r) => r.plantId === plantId),
    objectRules,
    closedSettlement: frozen
      ? {
          selfUsedShareCents: frozen.selfUsedShareCents,
          prepaymentCents: frozen.prepaymentCents,
          prepaymentOverridden: frozen.prepaymentOverridden,
          selfUseByItem: frozen.selfUseByItem ?? null,
          itemTotals: frozen.itemTotals ?? null,
        }
      : null,
    scope: { kind: 'heating', plant },
    ...(fuel ? { fuel } : {}),
    ...(stockChains.length > 0 ? { stockChains } : {}),
  }
}

// Baut den Schnappschuss eines Abrechnungszeitraums aus dem Datenbestand.
//
// Nach Zeitraum eingegrenzt wird nur, was seinen Zeitraum als Feld trägt: die Kostenpositionen und
// die abgeschlossenen Abrechnungen. Dort heißt Eingrenzen, zu lesen, was dasteht. Bei allen
// anderen Sammlungen müsste die Zugehörigkeit hergeleitet werden, und eine Herleitung an
// dieser Grenze schneidet im Zweifel etwas weg, das die Abrechnung braucht:
//
//   Ablesungen         Der Verbrauch wird zwischen zwei Ablesungen tagesanteilig interpoliert.
//                      Der Anfangsstand des Zeitraums ist die Ablesung vom Tag vor seinem
//                      Beginn, im Kalenderjahr die vom 31. Dezember des Vorjahres. Ohne sie entsteht kein Verbrauchssegment, und der
//                      Jahresverbrauch wäre 0. Die ganze Position fiele dem Vermieter zu,
//                      ohne dass irgendwo ein Fehler stünde.
//   Mietverhältnisse   Welche in den Zeitraum fallen, entscheidet die Berechnung:
//                      inklusive Grenzen, `end: null` = offen. Ebenso wichtig sind die
//                      Staffeln im Mietverhältnis selbst (Personenzahl, Vorauszahlung,
//                      Kaltmiete). Sie gelten „ab diesem Datum“, und der maßgebliche Eintrag
//                      kann Jahre alt sein. Beides bleibt unangetastet.
//   Zahlungen          Welche Zahlung zum Zeitraum zählt, entscheidet das Mietkonto nach ihrem
//                      Datum. Diese Regel bleibt dort, wo sie kommentiert und geprüft ist.
//   Wohnungen, Zähler  tragen gar keinen Zeitraum. Sie gehören zum Haus, nicht zur Abrechnung.
export function snapshotOfPeriod(source: SnapshotSource, period: BillingPeriod, previous: BillingPeriod): Snapshot {
  // Die Datensätze werden durchgereicht, nicht Feld für Feld neu gebaut. Der Schnappschuss ist
  // eine Sicht, keine Kopie; die Berechnung ändert nichts an ihm.
  //
  // Hier steht bewusst kein `?? []` an den Sammlungen. Der Typ verlangt sie, und wenn eine
  // trotzdem `null` ist (in der Datei steht `"costItems": null`, siehe #59), soll es krachen.
  // Ein aufgefangenes `null` ergäbe eine leere Abrechnung ohne Kosten, ohne Zeilen und ohne
  // Warnung, in der jeder Mieter seine Vorauszahlung voll erstattet bekommt. Sie sähe stimmig
  // aus und wäre falsch, und das ist der schlimmere der beiden Ausgänge. Ein Test in
  // calc.test.ts hält das fest.
  const closed = source.closedSettlements.find((c) => c.period === period.key)
  return {
    period,
    previousPeriod: previous,
    year: Number(period.from.slice(0, 4)),
    propertyId: null,
    units: source.units,
    tenancies: source.tenancies,
    costItems: source.costItems.filter((c) => c.period === period.key),
    // Der Vorzeitraum nur für den Vergleich der Schlüssel (#141) und der Doppelungen; dieselbe
    // Eingrenzung nach dem Feld `period`, deshalb hier und nicht in `snapshotFor`.
    previousCostItems: source.costItems.filter((c) => c.period === previous.key),
    meters: source.meters,
    readings: source.readings,
    payments: source.payments,
    closedSettlement: closed
      ? {
          selfUsedShareCents: closed.selfUsedShareCents,
          prepaymentCents: closed.prepaymentCents,
          prepaymentOverridden: closed.prepaymentOverridden,
          selfUseByItem: closed.selfUseByItem ?? null,
          itemTotals: closed.itemTotals ?? null,
        }
      : null,
  }
}

// Der Eingang im Kalenderjahr: db.json, Umstieg, Regression und Tests. Die db.json kannte nichts
// anderes, und hier ist der Vorzeitraum wirklich das Vorjahr.
export function snapshotOf(source: SnapshotSource, year: number): Snapshot {
  return snapshotOfPeriod(source, calendarYearPeriod(year), calendarYearPeriod(year - 1))
}

// Die Jahreskorrektur der db.json und der Datenbank von 0000 ist nach Jahr geschlüsselt („2024“),
// die Berechnung fragt nach dem Zeitraum (#208). Ein Jahr ist dort immer ein Kalenderjahr. Ein
// Schlüssel, der schon ein Zeitraum ist, bleibt; alles andere las die Berechnung nie und fällt weg.
export function overridesByPeriod(overrides: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [schluessel, betrag] of Object.entries(overrides)) {
    if (/^\d{4}$/.test(schluessel)) result[calendarPeriod(Number(schluessel))] = betrag
    else if (parsePeriodKey(schluessel) !== null) result[schluessel] = betrag
  }
  return result
}

// Der Schnappschuss aus dem Bestand der JSON-Datei. Der Schnappschuss reicht die Datensätze durch
// und kopiert sie nicht. Die Mietverhältnisse der Datei sind die Ausnahme: Ihre Jahreskorrektur
// wird auf Zeiträume umgeschlüsselt (#208), und das geht nur an einer Kopie.
export function snapshotFromDb(db: Db, year: number): Snapshot {
  return snapshotOf(
    {
      units: db.units,
      tenancies: db.tenancies.map((t) => ({ ...t, prepaymentOverrides: overridesByPeriod(t.prepaymentOverrides ?? {}) })),
      costItems: db.costItems.map((c) => ({ ...c, period: calendarPeriod(c.year) })),
      meters: db.meters,
      readings: db.readings,
      payments: db.payments,
      // Der Auszug steht in `frozenSettlementOf` und gilt für beide Wege; die Begründung dort.
      // Kein `?? []` um die Sammlung selbst: Ist sie `null`, soll es krachen, und `map` tut das.
      closedSettlements: db.closedSettlements.map((c) => ({
        period: calendarPeriod(c.year),
        ...frozenSettlementOf(c.settlement),
      })),
    },
    year,
  )
}
