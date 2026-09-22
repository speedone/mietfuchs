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

// Die abgeschlossene (eingefrorene) Abrechnung des Jahres, eingedampft auf das, was die
// Berechnung daraus liest: den Eigenanteil selbstgenutzter Wohnungen und die Vorauszahlungen,
// die auf dem zugestellten Papier standen. Beides nimmt die Steuerübersicht von dort, damit sie
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
// sind genau die Sorte Unterschied, die beim Umstieg als „Abrechnung weicht ab" auffällt und
// dann niemand erklären kann.
//
// Fehlt etwas, gilt 0 beziehungsweise „keine Korrektur". Das ist die richtige Antwort und keine
// Notlösung: Was nicht auf dem Papier stand, hat der Mieter auch nicht bekommen. Ein
// Schnappschuss von vor v0.3.0 kennt den Eigenanteil noch gar nicht.
export function frozenSettlementOf(settlement: unknown): SnapshotClosedSettlement {
  const leer = { selfUsedShareCents: 0, prepaymentCents: 0, prepaymentOverridden: false }
  if (settlement === null || typeof settlement !== 'object') return leer
  const eigenanteil: unknown = Reflect.get(settlement, 'selfUsedShareCents')
  const statements: unknown = Reflect.get(settlement, 'statements')
  const auszug = {
    ...leer,
    selfUsedShareCents: typeof eigenanteil === 'number' ? eigenanteil : 0,
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
  closedSettlements: (SnapshotClosedSettlement & { year: number })[]
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
export function snapshotOf(source: SnapshotSource, year: number): Snapshot {
  // Die Datensätze werden durchgereicht, nicht Feld für Feld neu gebaut. Der Schnappschuss ist
  // eine Sicht, keine Kopie; die Berechnung ändert nichts an ihm.
  //
  // Hier steht bewusst kein `?? []` an den Sammlungen. Der Typ verlangt sie, und wenn eine
  // trotzdem `null` ist (in der Datei steht `"costItems": null`, siehe #59), soll es krachen.
  // Ein aufgefangenes `null` ergäbe eine leere Abrechnung ohne Kosten, ohne Zeilen und ohne
  // Warnung, in der jeder Mieter seine Vorauszahlung voll erstattet bekommt. Sie sähe stimmig
  // aus und wäre falsch, und das ist der schlimmere der beiden Ausgänge. Ein Test in
  // calc.test.ts hält das fest.
  const closed = source.closedSettlements.find((c) => c.year === year)
  return {
    year,
    units: source.units,
    tenancies: source.tenancies,
    costItems: source.costItems.filter((c) => c.year === year),
    meters: source.meters,
    readings: source.readings,
    payments: source.payments,
    closedSettlement: closed
      ? {
          selfUsedShareCents: closed.selfUsedShareCents,
          prepaymentCents: closed.prepaymentCents,
          prepaymentOverridden: closed.prepaymentOverridden,
        }
      : null,
  }
}

// Der Schnappschuss aus dem Bestand der JSON-Datei.
export function snapshotFromDb(db: Db, year: number): Snapshot {
  return snapshotOf(
    {
      units: db.units,
      tenancies: db.tenancies,
      costItems: db.costItems,
      meters: db.meters,
      readings: db.readings,
      payments: db.payments,
      // Der Auszug steht in `frozenSettlementOf` und gilt für beide Wege; die Begründung dort.
      // Kein `?? []` um die Sammlung selbst: Ist sie `null`, soll es krachen, und `map` tut das.
      closedSettlements: db.closedSettlements.map((c) => ({
        year: c.year,
        ...frozenSettlementOf(c.settlement),
      })),
    },
    year,
  )
}
