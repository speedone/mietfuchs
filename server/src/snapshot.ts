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

import type { CostItem, Meter, Payment, Reading, Tenancy, Unit } from '../../shared/types.ts'
import type { Db } from './store.ts'

// Gelesen werden Kennung, Name (für Abrechnung und Warnungen), Wohnfläche und die beiden
// Kennzeichen der Beteiligung samt der Personenzahl des eigenen Haushalts. Zimmerzahl, Etage
// und Notiz sind reine Stammdaten und haben auf die Verteilung keinen Einfluss.
export type SnapshotUnit = Pick<Unit, 'id' | 'name' | 'areaM2' | 'participates' | 'selfUsed' | 'selfPersons'>

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
>

// Gelesen werden Kennung, Jahr, Kostenart, Beschreibung, Betrag, Schlüssel samt seiner Angaben
// und der Lohnanteil nach §35a. Der Rechnungssteller und die Belegdatei fehlen: Sie stehen auf
// der Abrechnung nicht und verteilen nichts.
export type SnapshotCostItem = Pick<
  CostItem,
  | 'id'
  | 'year'
  | 'category'
  | 'description'
  | 'amountCents'
  | 'key'
  | 'directUnitId'
  | 'meterType'
  | 'customShares'
  | 'labor35aCents'
>

// Gelesen werden Kennung, Wohnung (null = Hauptzähler) und Zählertyp. Name, Zählernummer und
// Maßeinheit sind Anzeige; die Jahresübersicht der Zähler-Seite gibt nur `meterId` zurück und
// der Browser stellt sie daneben.
export type SnapshotMeter = Pick<Meter, 'id' | 'unitId' | 'type'>

// Gelesen werden Zähler, Datum, Stand und der Zählerwechsel mit dem Endstand des alten Geräts.
// Die eigene Kennung der Ablesung und die Notiz braucht die Verbrauchsrechnung nicht.
export type SnapshotReading = Pick<Reading, 'meterId' | 'date' | 'value' | 'replacement' | 'oldEndValue'>

// Gelesen werden Mietverhältnis, Datum und Betrag. Kennung und Notiz braucht das Mietkonto
// nicht: Es zählt die Zahlungen des Jahres zusammen und verteilt sie von Januar an auf die
// Monate, ohne die einzelne Zahlung auszuweisen.
export type SnapshotPayment = Pick<Payment, 'tenancyId' | 'date' | 'amountCents'>

// Die abgeschlossene (eingefrorene) Abrechnung des Jahres, eingedampft auf die eine Zahl, die
// die Berechnung daraus liest: den Eigenanteil selbstgenutzter Wohnungen. Ihn nimmt die
// Steuerübersicht von dort, damit sie nicht von der versendeten Abrechnung abweicht. `null`
// heißt, das Jahr ist nicht abgeschlossen; dann rechnet die Steuerübersicht selbst.
export type SnapshotClosedSettlement = { selfUsedShareCents: number }

export type Snapshot = {
  // Das Abrechnungsjahr gehört zum Schnappschuss, nicht neben ihn. Sonst ließe sich ein
  // Schnappschuss für 2025 mit dem Jahr 2024 verrechnen, und weil die Kostenpositionen dann
  // fehlten, käme eine leere statt einer falschen Abrechnung heraus. Der Fehler fiele dann
  // erst dem Mieter auf.
  year: number
  units: SnapshotUnit[]
  tenancies: SnapshotTenancy[]
  costItems: SnapshotCostItem[]
  meters: SnapshotMeter[]
  readings: SnapshotReading[]
  payments: SnapshotPayment[]
  closedSettlement: SnapshotClosedSettlement | null
}

// Baut den Schnappschuss eines Abrechnungsjahres aus dem Datenbestand.
//
// Eingegrenzt wird nach Jahr nur, was sein Jahr als Feld dabei hat: die Kostenpositionen und
// die abgeschlossenen Abrechnungen. Dort heißt Eingrenzen, zu lesen, was dasteht. Bei allen
// anderen Sammlungen müsste die Zugehörigkeit hergeleitet werden, und eine Herleitung an
// dieser Grenze schneidet im Zweifel etwas weg, das die Abrechnung braucht:
//
//   Ablesungen         Der Verbrauch wird zwischen zwei Ablesungen tagesanteilig interpoliert.
//                      Der Anfangsstand des Jahres ist die Ablesung vom 31. Dezember des
//                      Vorjahres. Ohne sie entsteht kein Verbrauchssegment, und der
//                      Jahresverbrauch wäre 0. Die ganze Position fiele dem Vermieter zu,
//                      ohne dass irgendwo ein Fehler stünde.
//   Mietverhältnisse   Welche ins Jahr fallen, entscheidet `overlapDays` in der Berechnung:
//                      inklusive Grenzen, `end: null` = offen. Ebenso wichtig sind die
//                      Staffeln im Mietverhältnis selbst (Personenzahl, Vorauszahlung,
//                      Kaltmiete). Sie gelten „ab diesem Datum", und der maßgebliche Eintrag
//                      kann Jahre alt sein. Beides bleibt unangetastet.
//   Zahlungen          Welche Zahlung zum Jahr zählt, entscheidet das Mietkonto nach ihrem
//                      Datum. Diese Regel bleibt dort, wo sie kommentiert und geprüft ist.
//   Wohnungen, Zähler  tragen gar kein Jahr. Sie gehören zum Haus, nicht zur Abrechnung.
export function snapshotFromDb(db: Db, year: number): Snapshot {
  // Die Datensätze werden durchgereicht, nicht Feld für Feld neu gebaut. Der Schnappschuss ist
  // eine Sicht, keine Kopie; die Berechnung ändert nichts an ihm. Und sie liest an einer Stelle
  // bewusst ein Feld des Altformats, das der heutige Typ nicht mehr kennt
  // (`prepaymentMonthlyCents`, siehe computePrepaymentCents in calc.ts). Ein Neuaufbau ließe
  // es verschwinden und setzte die Vorauszahlung eines ungewanderten Bestands auf 0.
  const closed = (db.closedSettlements ?? []).find((c) => c.year === year)
  return {
    year,
    // Das `?? []` an jeder Sammlung: Die Typen sagen Pflichtfeld, eine von Hand bearbeitete
    // oder sehr alte db.json kann eine Sammlung trotzdem nicht haben. Bisher stand diese
    // Absicherung verstreut und uneinheitlich in der Berechnung; sie gehört auf diese Seite der
    // Grenze, denn sie betrifft die Ablage und nicht das Fachliche.
    units: db.units ?? [],
    tenancies: db.tenancies ?? [],
    costItems: (db.costItems ?? []).filter((c) => c.year === year),
    meters: db.meters ?? [],
    readings: db.readings ?? [],
    payments: db.payments ?? [],
    // Ein Schnappschuss von vor v0.3.0 kennt den Eigenanteil noch nicht. Der Rückfall auf 0
    // stand bisher in der Steuerübersicht; er gehört hierher, weil er die Gestalt alter
    // gespeicherter Daten betrifft.
    closedSettlement: closed ? { selfUsedShareCents: closed.settlement?.selfUsedShareCents ?? 0 } : null,
  }
}
