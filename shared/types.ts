// Das Datenmodell von Mietfuchs, gemeinsam für Server und Client (#48). Was hier steht, hat
// keinen Laufzeitanteil: nur Typen. Oberflächentexte und Helfer stehen in client/src/types.ts.
// Einzige Ausnahme ist der Verweis auf die Begriffe des Lexikons (glossary.ts, #113), und auch
// der nur als Typ.

import type { TermId } from './glossary.ts'
import type { Allocation } from './allocation.ts'

// Beteiligung einer Wohnung an der Kostenverteilung:
//   'vermietet'  → participates: true — Anteil trägt der Mieter
//   'eigen'      → selfUsed: true — zählt in die Verteilbasis, Anteil trägt der Vermieter
//   'ausgenommen'→ beides false — gehört nicht zur Abrechnungseinheit, bleibt außen vor
export type UnitUsage = 'vermietet' | 'eigen' | 'ausgenommen'

// Die Art eines Objekts (#92): Mehrfamilienhaus, vermietete Eigentumswohnung, Einfamilienhaus,
// Zweifamilienhaus (#180, Heizung PR 4; nur Beschreibung, die Ausnahme des § 2 HeizkostenV hängt an
// den Wohnungen), Sonstiges (etwa ein Garagenhof).
export type PropertyKind = 'mfh' | 'etw' | 'efh' | 'zfh' | 'sonstiges'

// Ein Objekt ist zugleich die Abrechnungseinheit. Wohnungen, Zähler, Kostenpositionen und
// abgeschlossene Abrechnungen gehören zu genau einem; Mietverhältnisse, Zahlungen und
// Ablesungen erben es.
export type Property = {
  id: string
  name: string
  kind: PropertyKind
  address: string
  // Abweichend von den Einstellungen, etwa beim Haus der Eltern. `null` heißt „die Vorgabe aus
  // den Einstellungen gilt“, eine leere Zeichenkette „bewusst keine“.
  landlordName: string | null
  iban: string | null
  paymentDeadlineDays: number | null
  // Kabel- oder Antennenanlage vor dem 01.12.2021 errichtet (#121, § 2 Satz 2 BetrKV)? `null` heißt
  // unbekannt. Bei einer späteren Anlage war das TV-Signal nie umlagefähig.
  cableBuiltBeforeDec2021?: boolean | null
  // Der Rhythmus der Abrechnungszeiträume (#208). Der Server liefert ihn immer mit; fehlt er, gilt
  // das Kalenderjahr (`rulesOf` in shared/period.ts). Ändern lässt er sich in dieser Version nicht.
  periodRules?: PeriodRules
}

export type Unit = {
  id: string
  propertyId: string
  name: string
  areaM2: number
  participates: boolean
  // Selbstgenutzt: kein Mietverhältnis, aber Teil der Verteilbasis — der Anteil fällt dem
  // Vermieter zu (Eigenanteil). Kosten für das ganze Haus dürfen nur anteilig auf die
  // Mieter umgelegt werden; siehe UnitUsage.
  selfUsed?: boolean
  selfPersons?: number // Personen im eigenen Haushalt — nur für den Personenschlüssel
  // Miteigentumsanteile (#94), für den Schlüssel „laut Gemeinschaftsabrechnung“ bei einer
  // vermieteten Eigentumswohnung.
  mea?: number
  // Zählertypen, für die die Einheit keinen Anschluss hat (#117), etwa eine Garage ohne Wasser.
  // Sie gilt dann beim Verbrauchsschlüssel nicht als Wohnung ohne Zähler.
  noConnection?: MeterType[]
  // Erweiterte Stammdaten (optional, ohne Einfluss auf die Berechnung)
  rooms?: number // Zimmerzahl
  floor?: string // Etage, z. B. „EG“, „1. OG“
  notes?: string // freie Notiz zur Wohnung
}

export type PrepaymentEntry = {
  from: string // 'YYYY-MM' — ab diesem Monat gilt der Betrag
  monthlyCents: number
}

// Kaltmiete-Staffel — gleiche „ab Monat gilt Betrag“-Mechanik wie die Vorauszahlung.
// Bruttomiete = Kaltmiete + NK-Vorauszahlung des jeweiligen Monats.
export type RentEntry = {
  from: string // 'YYYY-MM'
  monthlyCents: number
}

export type PersonEntry = {
  from: string // 'YYYY-MM-DD' — ab diesem Tag gilt die Personenzahl
  persons: number
}

// Wie die Nebenkosten eines Mietverhältnisses geregelt sind (#93): Vorauszahlung mit Abrechnung,
// Betriebskostenpauschale (§ 556 Abs. 2 BGB) oder Inklusivmiete.
export type CostModel = 'settlement' | 'flatRate' | 'inclusive'

export type Tenancy = {
  id: string
  unitId: string
  // Getrennt für kalte Kosten und für Heizung und Warmwasser (#93); fehlend heißt `settlement`.
  costModel?: CostModel
  heatingModel?: CostModel
  // Die Pauschale je Monat (#93), eine eigene Staffel und nicht die der Vorauszahlung: Das
  // Mietkonto führt sie im Soll, die Abrechnung rechnet sie nie an. Stünde sie in der Staffel
  // der Vorauszahlung, würde sie bei einem gemischten Modell gegen die abgerechneten Kosten
  // gutgeschrieben.
  flatRates?: PrepaymentEntry[]
  tenantName: string
  persons: number // aktuelle Personenzahl (abgeleitet aus personHistory)
  personHistory: PersonEntry[]
  start: string
  end: string | null
  prepayments: PrepaymentEntry[]
  prepaymentOverrides: Record<string, number> // Zeitraum ('JJJJ-MM', #208) → tatsächlich gezahlter Betrag
  // Die Heizvorauszahlung, getrennt von den übrigen (Heizung PR 5, Entwurf 3.1, 5.3): Bei getrennter
  // Heizkostenabrechnung steht hier ab dem Umstellen der Heizanteil, in `prepayments` der Rest; je
  // Monat bleibt die Summe gleich. Fehlt die Staffel, ist die ganze Vorauszahlung in `prepayments`.
  heatingPrepayments?: PrepaymentEntry[]
  // Was an Heizvorauszahlungen einer Heizperiode tatsächlich gezahlt wurde, endgültig oder vorläufig
  // für einige Monate (D2). Je Anlage und Heizperiode höchstens eine.
  heatingPrepaymentOverrides?: HeatingPrepaymentOverride[]
  baseRents: RentEntry[] // Kaltmiete-Staffel (leer = nicht erfasst)
  // Erweiterte Stammdaten (optional, ohne Einfluss auf die Berechnung) — Kontakt, Kaution, Vertrag
  email?: string
  phone?: string
  correspondenceAddress?: string // abweichende Anschrift für Schriftverkehr (z. B. nach Auszug)
  iban?: string // Mieter-IBAN (für Lastschrift/Guthaben-Rückzahlung)
  contractDate?: string // 'YYYY-MM-DD' — Datum des Mietvertrags
  depositCents?: number // vereinbarte Kaution
  depositStatus?: DepositStatus // Stand der Kaution
  notes?: string // freie Notiz zum Mietverhältnis
}

export type DepositStatus = 'offen' | 'erhalten' | 'teilweise' | 'zurückgezahlt'

// Eine gebuchte Mietzahlung (Geldeingang). Pro Mietverhältnis, datiert.
export type Payment = {
  id: string
  tenancyId: string
  date: string // 'YYYY-MM-DD'
  amountCents: number
  note?: string
}

// ---------- Mietkonto / Zahlungs-Tracking ----------

// `notDue`: im laufenden Jahr ab dem aktuellen Monat, noch nicht fällig und kein Rückstand (#133).
export type RentMonthStatus = 'paid' | 'partial' | 'open' | 'notDue'

export type RentMonth = {
  month: number // 1..12
  baseRentCents: number
  prepaymentCents: number
  flatRateCents: number // Pauschale (#93)
  heatingPrepaymentCents?: number // Heizvorauszahlung (Heizung PR 5), nur mit Heizstaffel
  sollCents: number // Bruttomiete = Kaltmiete + Vorauszahlung + Heizvorauszahlung + Pauschale
  paidCents: number // dem Monat zugeordneter Zahlungseingang
  status: RentMonthStatus
}

export type RentLedgerRow = {
  tenancyId: string
  tenantName: string
  unitName: string
  months: RentMonth[]
  sollYearCents: number // Brutto-Soll des Jahres
  baseRentYearCents: number // davon Kaltmiete (Netto)
  prepaymentYearCents: number // davon NK-Vorauszahlung
  flatRateYearCents: number // davon Pauschale (#93)
  heatingPrepaymentYearCents?: number // davon Heizvorauszahlung (Heizung PR 5), nur mit Heizstaffel
  paidYearCents: number
  balanceCents: number // paid − soll des ganzen Jahres: >0 Guthaben/Überzahlung
  // Soll der fälligen Monate und was davon offen ist (#133): im laufenden Jahr nur die Monate vor
  // dem aktuellen, sonst das ganze Jahr.
  dueSollCents: number
  arrearsCents: number
  openMonths: number // fällige Monate, die nicht bezahlt sind
}

export type RentLedger = {
  year: number
  rows: RentLedgerRow[]
  totals: {
    sollYearCents: number
    paidYearCents: number
    openCents: number // Summe der offenen Rückstände (nur negative Salden)
  }
}

export type MeterType = 'kaltwasser' | 'warmwasser' | 'strom' | 'waerme' | 'hkv' | 'sonstig'

// Die Skala eines Heizkostenverteilers (Heizung PR 12, Entwurf 8.1): Einheitsskala, der Ablesewert zählt
// mal dem Bewertungsfaktor des Heizkörpers; Produktskala, der Faktor ist eingerechnet.
export type HcaScale = 'unit' | 'product'

export type Meter = {
  id: string
  // Eigens und nicht über die Wohnung: Ein Hauptzähler hat keine.
  propertyId: string
  name: string
  unitId: string | null // null = Hauptzähler (ganzes Objekt)
  type: MeterType
  meterNumber?: string
  unit: string // Maßeinheit, z. B. m³
  // Zähler der Heizanlage selbst (Heizung PR 4): ohne Wohnung, mit seiner Rolle (Versorgungszähler,
  // Wärmezähler am Warmwasserspeicher, Gesamtwärmezähler). Ohne Anlage keine Rolle.
  heatingPlantId?: string | null
  heatingRole?: HeatingRole | null
  // Fernablesbar und eingebaut am (§ 5 Abs. 2, 3 HeizkostenV, Entwurf 3.13). Fehlt die Angabe, ist
  // sie unbekannt.
  remoteReadable?: boolean | null
  installedOn?: string | null // 'YYYY-MM-DD'
  // Nur beim Heizkostenverteiler (Heizung PR 12): Skala und Bewertungsfaktor des Heizkörpers.
  hcaScale?: HcaScale | null
  ratingFactor?: number | null
}

export type Reading = {
  id: string
  meterId: string
  date: string
  value: number
  replacement?: boolean // Zählerwechsel: value = Startstand des neuen Geräts
  oldEndValue?: number // Endstand des alten Geräts
  note?: string
  // Bei einer Ablesung aus dem Mieterwechsel (#150) die Grenze, zu der sie gehört: der letzte Tag des
  // bisherigen Nutzers (Heizung PR 10). Fehlt bei allen übrigen Ablesungen.
  interimFor?: string
}

export type CostKey = 'area' | 'persons' | 'units' | 'direct' | 'meter' | 'custom' | 'external' | 'amounts' | 'heatingSystem'

// Der Maßstab einer Gemeinschaft (#94): Miteigentumsanteile, Fläche oder Einheiten.
export type ExternalMeasure = 'mea' | 'area' | 'units'

// Die Angaben aus der Abrechnung der Gemeinschaft zu einer Kostenart: Summe des Maßstabs in der
// Anlage und Gesamtkosten. Sie stehen neben dem Betrag der Kostenposition, der der eigene Anteil
// ist, und dienen dem Rechenweg auf der Abrechnung und der Plausibilitätsprüfung.
export type ExternalBasis = {
  measure: ExternalMeasure
  total: number
  totalCents: number
}

// Teil der Heizkosten (#208, Entwurf 5.3, A1): Brennstoff/Energie, Betrieb, Messdienst. Mit PR 3
// bietet die Oberfläche nur „Brennstoff/Energie“ an; der Vorschlag nach § 560 BGB im Rumpf rechnet
// Brennstoff nach Gradtagen hoch. Pflicht wird die Angabe mit der eigenen Heizkostenabrechnung.
export type HeatingPart = 'fuel' | 'operating' | 'metering'

export type CostItem = {
  id: string
  propertyId: string
  // Der Abrechnungszeitraum (#208), dem die Position ganz gehört.
  period: PeriodKey
  // Der Leistungszeitraum der Rechnung (#208, Entwurf 3.4): beide oder keines, je 'JJJJ-MM-TT' mit
  // inklusiven Grenzen. Eine kalte Rechnung über zwei Abrechnungszeiträume ist in je eine Position
  // aufgeteilt; jeder Teil trägt den ganzen Leistungszeitraum der Rechnung, sein Betrag ist der
  // Anteil seines Zeitraums.
  serviceFrom?: string
  serviceTo?: string
  // Das Jahr der Zahlung für die Steuer (#208, Entwurf 3.10). Fehlt es, liegt der Zeitraum der
  // Position in einem Kalenderjahr, und es ist dieses. Eine Vereinfachung, siehe CLAUDE.md
  // („Nicht dem Abflussprinzip folgen die Werbungskosten“).
  taxYear?: number
  // Nur bei der Kostenart „Heizung und Warmwasser“ (#208, A1).
  heatingPart?: HeatingPart
  // Wohin die Position bei der eigenen Heizkostenabrechnung gehört (Heizung PR 10, Entwurf 5.3):
  // Heizung und Warmwasser zusammen, nur Heizung oder nur Warmwasser. Pflicht beim Schlüssel
  // `heatingSystem`; bei freien Schlüsseln heißt „nur Heizung“, dass beim Mieterwechsel die Gradtage
  // gelten (§ 9b Abs. 2, A2, B7). Nur bei der Kostenart „Heizung und Warmwasser“. Wie `heatingPart`
  // (PR 3): fehlt, wenn nicht gesetzt.
  heatingTarget?: HeatingTarget
  category: string
  description: string
  vendor?: string
  amountCents: number
  key: CostKey
  // null = beim Schlüsselwechsel bewusst zurückgesetzt (siehe saveItem in Kosten.tsx)
  directUnitId?: string | null
  meterType?: MeterType | null
  // Vereinbarter Schlüssel: Wohnungs-ID → Prozentanteil. Die Anteile gelten absolut;
  // summieren sie unter 100 %, bleibt der Rest beim Vermieter.
  customShares?: Record<string, number> | null
  // Nur diese Wohnungen bilden die Verteilbasis (#94); fehlend oder null heißt alle.
  participantUnitIds?: string[] | null
  // Schlüssel „laut Gemeinschaftsabrechnung“ (#94).
  externalBasis?: ExternalBasis | null
  // Schlüssel „Einzelbeträge je Mietverhältnis“ (#94): Mietverhältnis-ID → Betrag in Cent, etwa
  // aus der Abrechnung eines Messdienstes.
  tenancyAmounts?: Record<string, number> | null
  // Dazu die Beträge selbstgenutzter Wohnungen (#104): Wohnungs-ID → Betrag in Cent. Sie sind der
  // Eigenanteil des Vermieters und in der Steuer privat.
  selfAmounts?: Record<string, number> | null
  labor35aCents?: number // Lohnanteil nach §35a EStG
  invoiceFile?: string
  // Die Heizanlage, zu der die Position gehört (Heizung PR 4), nur bei der Kostenart „Heizung und
  // Warmwasser“. Fehlt sie bei einer neuen Position, setzt der Server die einzige Anlage des Objekts.
  heatingPlantId?: string | null
  // Die Lieferung, deren Rechnung die Position ist (Heizung PR 7, Entwurf 5.4, G-C4): Abschläge,
  // Schlussrechnung und Gutschrift zeigen auf dieselbe Lieferung und werden im selben Verhältnis
  // abgegrenzt. Nur bei der Kostenart „Heizung und Warmwasser“ einer Anlage mit freien Schlüsseln.
  fuelDeliveryId?: string | null
  // Betriebsstrom der Heizung (Heizung PR 15): siehe `OperatingPower`. `operatingPowerItemId` nur am
  // Abzug: die Betriebsstrom-Position, zu der er gehört. `operatingPowerBasis` (P-W1): die Grundlage
  // der Schätzung, Zeile für Zeile, an Betriebsstrom und Abzug; bestreitet ein Mieter den Betrag, muss
  // der Vermieter sie darlegen (BGH, Versäumnisurteil vom 20.02.2008, VIII ZR 27/07, Leitsatz 3).
  operatingPower?: OperatingPower
  operatingPowerItemId?: string
  operatingPowerBasis?: string
  // Nur am Abzug: die Stromrechnung („Beleuchtung/Allgemeinstrom“), aus der er gerechnet wurde
  // (Durchsicht von #252, G-K3). Sie lässt sich nicht löschen, solange Abzüge auf sie zeigen.
  operatingPowerGeneralId?: string
}

// Ein Teil einer aufgeteilten Rechnung in der Vorschau (#208, Entwurf 3.4). `needsTaxYear`: Der
// Zeitraum reicht über zwei Kalenderjahre, das Jahr der Zahlung ist dort Pflicht. `closed`: Die
// Abrechnung des Zeitraums ist abgeschlossen; gespeichert wird dann nicht (409).
export type SplitPreviewPart = {
  period: PeriodKey
  label: string
  days: number
  amountCents: number
  labor35aCents: number | null
  description: string
  needsTaxYear: boolean
  closed: boolean
}

// Die Vorschau eines Wechsels des Abrechnungszeitraums (#208, Entwurf 3.6). `blocked`: Gründe, aus
// denen nicht gewechselt wird (abgeschlossene Abrechnungen). `moves`: kalte Rechnungen mit
// Leistungszeitraum, die nach Tagen auf die neuen Zeiträume aufgeteilt werden oder in einen
// anderen wandern. `groups`: Positionen ohne Leistungszeitraum und Heizkosten je bisherigem
// Zeitraum, die der Vermieter zuordnet. `overrides`: Jahreskorrekturen, die neu erfasst werden,
// je Mietverhältnis mit den Zeiträumen, für die gefragt wird. `assessments`: Belegauswertungen,
// deren gewählter Zeitraum entfällt.
export type PeriodChangePreview = {
  rules: PeriodRules
  periods: { key: PeriodKey; label: string; short: boolean }[]
  newShort: { key: PeriodKey; label: string }[]
  blocked: string[]
  moves: { costItemId: string; description: string; amountCents: number; parts: { period: PeriodKey; label: string; amountCents: number }[] }[]
  // Je bisherigem Zeitraum eine Gruppe für kalte Kosten und eine für Heizkosten (Laienprobe B2);
  // geantwortet wird unter `id`. Kalte Kosten ohne Leistungszeitraum lassen sich nach Tagen auf die
  // neuen Zeiträume aufteilen (`split`, Antwort 'split', Vorgabe): Die Rechnung stand im bisherigen
  // Zeitraum und gilt als dessen Kosten (Leistungsprinzip, Entwurf 3.4). Heizkosten teilt Mietfuchs
  // nie nach Tagen (VIII ZR 156/11); dort wählt der Vermieter, und die Oberfläche warnt mit Betrag.
  groups: {
    id: string
    from: PeriodKey
    fromLabel: string
    heating: boolean
    items: { costItemId: string; description: string; amountCents: number }[]
    options: { key: PeriodKey; label: string }[]
    // `notes` (Review der Laienprobe, Runde 1): warum das Aufteilen nicht vorbelegt ist (gebuchte
    // Belegzeilen, anderes Jahr der Zahlung) und wie viel Euro es zwischen Steuerjahren verschöbe.
    split: { range: string; items: { costItemId: string; parts: { period: PeriodKey; label: string; amountCents: number }[] }[]; notes: string[] } | null
    // Je Ziel „ganz nach …“, das Werbungskosten in ein anderes Jahr der Zahlung verschöbe, der Satz dazu.
    taxShifts: { key: PeriodKey; text: string }[]
    suggested: string
  }[]
  // Fristen und Ergebnisse der Zeiträume, die der Wechsel verändert und die schon begonnen haben
  // (Laienprobe B3). Bei abgelaufener Frist ist eine Nachforderung ausgeschlossen (§ 556 Abs. 3 S. 3 BGB).
  effects: PeriodEffect[]
  overrides: { tenancyId: string; tenantName: string; from: { key: PeriodKey; label: string; cents: number }[]; ask: { period: PeriodKey; label: string; months: string }[] }[]
  assessments: { assessmentId: string; file: string; from: PeriodKey; to: PeriodKey; toLabel: string }[]
  // Das Jahr der Zahlung (Entwurf 3.10) je Position und Zeitraum über zwei Kalenderjahre, in den sie
  // gelangt (Durchsicht von #226, I1, M4). `key` ist 'Kennung|Zeitraum'; vorbelegt mit dem bisherigen
  // Jahr, in die erlaubte Spanne geklemmt. Bei einer Gruppe steht je wählbarem Zeitraum ein Eintrag.
  taxYears: { key: string; costItemId: string; description: string; period: PeriodKey; label: string; suggested: number; options: number[] }[]
  // Die Marke dieser Vorschau (M2): Stimmt sie beim Wechsel nicht mehr, hat sich der Bestand
  // inzwischen geändert, und der Server antwortet mit 409 und der neuen Vorschau.
  token: string
}

// Was eine Änderung an Zeiträumen oder Vorauszahlungen mit einer Abrechnung macht, die schon
// begonnen hat (Laienprobe B3, B3a): Frist, Ergebnis je Mieter vorher und nachher (> 0 Guthaben,
// < 0 Nachzahlung; `beforeCents` null, wenn es den Zeitraum vorher so nicht gab) und, bei
// abgelaufener Frist, die Nachzahlungen, die nicht mehr verlangt werden dürfen (§ 556 Abs. 3 S. 3 BGB).
// Gerechnet nach den Vorschlägen der Vorschau; `tenants` leer, wenn sich nichts rechnen ließ.
export type PeriodEffect = {
  label: string
  deadline: string
  passed: boolean
  replaces: { label: string; deadline: string }[]
  tenants: { tenantName: string; beforeCents: number | null; afterCents: number }[]
  lostClaimsCents: number
}

// Die Antworten zur Vorschau: je Gruppe (bisheriger Zeitraum) der neue Zeitraum; je
// Mietverhältnis und gefragtem Zeitraum der tatsächlich gezahlte Betrag in Cent, `null` heißt
// „keine Korrektur, es gilt die Staffel“. Eine fehlende Antwort ist keine Antwort (409).
export type PeriodChangeAnswers = {
  groups?: Record<string, string>
  overrides?: Record<string, Record<string, number | null>>
  // Das Jahr der Zahlung je Eintrag aus `taxYears`; fehlt es, gilt der Vorschlag.
  taxYears?: Record<string, number>
  token?: string
  // Bestätigung, dass eine Abrechnung mit abgelaufener Frist entsteht oder sich ändert (Review, Runde 1).
  understood?: boolean
}

// Die Vorschau eines Wechsels der eigenen Heizperiode (Heizung PR 5, Entwurf 3.0, 3.6, B2).
// `rules` null heißt „wie das Objekt“. `moves`: Heizpositionen, die in eine andere Heizperiode
// kommen; `groups`: solche, bei denen der Vermieter wählt; `overrides`: Korrekturen, die neu erfasst
// werden, je Mietverhältnis mit den bisherigen (`from`) und den gefragten (`ask`): `heating` je
// getrennt abgerechneter Heizperiode, `total` je Abrechnung P für alles, was sie anrechnet (3.7);
// `endsSeparate`: Heizperioden, die danach in der Gesamtabrechnung stehen.
export type HeatingPeriodChangePreview = {
  rules: PeriodRules | null
  periods: { key: PeriodKey; label: string; short: boolean; separate: boolean }[]
  newShort: { key: PeriodKey; label: string }[]
  blocked: string[]
  // Laienprobe B12, B13: `to` ist vorbelegt mit der Heizperiode, die im bisherigen Abrechnungszeitraum
  // endet (Entwurf 3.0, BGH VIII ZR 240/07); `options` sind alle Heizperioden, die den bisherigen
  // Zeitraum berühren, gewählt wird unter `answers.moves`. `range` nennt die Tage, denn „2024/2025“
  // heißt bei der Heizung etwas anderes als beim Objekt. `check`: Die Position hat keinen
  // Leistungszeitraum; ob sie zur Heizperiode passt, weiß nur der Vermieter.
  moves: {
    costItemId: string; description: string; amountCents: number; from: PeriodKey; fromLabel: string; to: PeriodKey; toLabel: string
    fromRange: string; toRange: string; options: { key: PeriodKey; label: string; range: string }[]; check: boolean
  }[]
  groups: { from: PeriodKey; fromLabel: string; items: { costItemId: string; description: string; amountCents: number }[]; options: { key: PeriodKey; label: string; range: string }[]; suggested: PeriodKey }[]
  overrides: {
    tenancyId: string
    tenantName: string
    from: { kind: 'heating' | 'total'; key: PeriodKey; label: string; cents: number }[]
    ask: { kind: 'heating' | 'total'; period: PeriodKey; label: string; months: string }[]
  }[]
  endsSeparate: { key: PeriodKey; label: string }[]
  // Fristen und Ergebnisse schon begonnener Abrechnungen vorher und nachher (Review Runde 2, wie beim
  // Wechsel des Abrechnungszeitraums und beim Aufteilen).
  effects: PeriodEffect[]
  // Die Marke dieser Vorschau, wie beim Wechsel des Objektzeitraums (PR 3): Stimmt sie beim Wechsel
  // nicht mehr, hat sich der Bestand geändert, und es gibt 409 mit der neuen Vorschau.
  token: string
}

// Die Antworten: je Gruppe die neue Heizperiode; je Mietverhältnis und gefragter Heizperiode die
// tatsächlich gezahlte Heizvorauszahlung (`overrides`) und je gefragter Abrechnung P die tatsächlich
// gezahlten Vorauszahlungen insgesamt (`totals`), in Cent; `null` heißt „keine Korrektur, die
// Staffel gilt“.
export type HeatingPeriodChangeAnswers = {
  groups?: Record<string, string>
  understood?: boolean
  // Laienprobe B12: je verschobener Position die gewählte Heizperiode; fehlt sie, gilt die vorbelegte.
  moves?: Record<string, string>
  overrides?: Record<string, Record<string, number | null>>
  totals?: Record<string, Record<string, number | null>>
  token?: string
}

// Die Vorschau zum Ein- und Ausschalten der getrennten Heizkostenabrechnung (Heizung PR 5, Entwurf
// 3.1). `way`: 'separate' bei eigener Heizperiode, die kein Abrechnungszeitraum ist (Weg d), sonst
// 'samePeriod' (H = P, nur getrennter Ausweis). Einschalten: `month` ist X, `steps` jede Stufe ab X
// mit dem vorgeschlagenen Heizanteil, `overrides` die Jahreskorrekturen offener Abrechnungen mit
// Monaten ab X, `deadlines` die Fristen der getrennten Heizperioden (R-g). Ausschalten: `until` ist
// W, `keep` die Heizperioden, die getrennt bleiben, `merge` die zusammengeführte Staffel ab `month`,
// `overrides` die Jahreskorrekturen, die neu erfasst werden.
export type SeparatePreview = {
  separate: boolean
  way: 'separate' | 'samePeriod'
  month: string | null
  earliestMonth: string | null
  until: PeriodKey | null
  earliestUntil: PeriodKey | null
  share: { permille: number; source: string } | null
  steps: { tenancyId: string; tenantName: string; rows: { from: string; totalCents: number; heatingCents: number }[] }[]
  overrides: {
    tenancyId: string
    tenantName: string
    period: PeriodKey
    label: string
    cents: number | null
    asks: { kind: 'total' | 'heating' | 'provisional'; period: PeriodKey; label: string; months: string }[]
    remainder: { period: PeriodKey; label: string; months: string } | null
  }[]
  deadlines: { period: PeriodKey; label: string; deadline: string; passed: boolean }[]
  // Die Abrechnungen, deren Ergebnis sich durch das Aufteilen ändert und die schon begonnen haben
  // (Laienprobe B3a), vorher und nachher nach den Vorschlägen dieser Vorschau.
  effects: PeriodEffect[]
  keep: { period: PeriodKey; label: string; deadline: string }[]
  merge: { tenancyId: string; tenantName: string; rows: { from: string; prepaymentCents: number }[] }[]
  blocked: string[]
  // Die Marke dieser Vorschau (wie beim Wechsel des Zeitraums): Stimmt sie beim Speichern nicht
  // mehr, gibt es 409 mit der neuen Vorschau.
  token: string
}

// Die Antworten, Beträge in Cent: je Mietverhältnis und Stufe der Heizanteil (`steps`), je
// Heizperiode die Heizkorrektur (`overrides`, endgültig; bei einer Frage der Art `provisional`
// vorläufig für deren Monate), je Abrechnung P die Jahreskorrektur (`totals`; beim Einschalten
// „davon übrige“, beim Ausschalten „insgesamt“; `null` heißt keine Korrektur). `merge` false lässt
// beim Ausschalten beide Staffeln stehen.
export type SeparateAnswers = {
  steps?: Record<string, Record<string, number>>
  overrides?: Record<string, Record<string, number>>
  totals?: Record<string, Record<string, number | null>>
  merge?: boolean
  token?: string
  // Bestätigung, dass eine Abrechnung mit abgelaufener Frist betroffen ist (Review der Laienprobe, Runde 1).
  understood?: boolean
}

export type Settings = {
  houseName: string
  address: string
  landlordName: string
  iban: string
  paymentDeadlineDays: number
  ollamaUrl: string
  ollamaModel: string
  printAdjustSuggestion?: boolean // §560-Vorschlag zur Vorauszahlungsanpassung andrucken (Standard: ja)
  printAttachments?: boolean // Belegkopien als Anlage mit andrucken (Standard: nein)
  // Update-Hinweis: ohne Wert wurde noch nicht gefragt, 'on' erlaubt die Abfrage bei GitHub
  updateCheck?: 'on' | 'off'
  updateDismissed?: string // Version, deren Hinweis mit „Später“ ausgeblendet wurde
  // KI-Belegauswertung (#18), siehe server/src/ai/settings.ts. ollamaUrl und ollamaModel oben
  // spiegeln Adresse und Modell, solange Ollama der Standard-Anbieter ist.
  ai?: AiSettings
  // Per Umgebungsvariable festgelegt: Pfade wie 'ai.text.url' oder 'ai.timeoutSeconds', dazu
  // für ältere Tabs 'ollamaUrl' und 'ollamaModel'. Nur anzeigen, der Server übernimmt beim
  // Speichern keine Änderung daran.
  fixedByEnv?: string[]
  // Nur vom Server, nie gespeichert: ob je Platz ein API-Schlüssel gesetzt ist und ob die
  // Adresse aus dem Haus zeigt
  aiKeys?: Record<AiSlotName, AiKeyInfo>
  aiExternal?: Record<AiSlotName, boolean>
}

// ---------- KI-Anbieter (#18) ----------

export type AiSlotName = 'text' | 'images'
export type AiProviderKind = 'ollama' | 'openai' // 'openai' für alle OpenAI-kompatiblen Dienste
export type AiSlot = {
  provider: AiProviderKind
  preset: string // Kennung einer Vorlage aus /api/ai/presets
  url: string
  model: string
  vision: boolean | null // null: unbekannt (Ollama meldet es selbst), sonst Angabe des Nutzers
}
export type AiJsonMode = 'auto' | 'schema' | 'object' | 'prompt'
export type AiConsent = { url: string; model: string; date: string }
export type AiSettings = {
  text: AiSlot
  images: AiSlot | null // eigener Anbieter für Fotos und Scans
  // Für Fortgeschrittene, null = Standard
  timeoutSeconds: number | null
  numCtx: number | null // nur Ollama
  maxOutputTokens: number | null // nur OpenAI-kompatible Dienste
  pageImageEdge: number | null // lange Kante der Seitenbilder eines Scans, in Bildpunkten
  jsonMode: AiJsonMode
  reasoningEffort: string | null
  extraInstructions: string
  consent: Partial<Record<AiSlotName, AiConsent>> // ändert nur POST/DELETE /api/ai/consent
}
export type AiKeyInfo = { set: boolean; hint: string; fromEnv: string | null }
export type AiPreset = {
  id: string
  provider: AiProviderKind
  label: string
  url: string // leer: der Nutzer trägt die Adresse selbst ein
  key: 'none' | 'optional' | 'required'
  tokenField: string
  temperature: boolean
  jsonObject: boolean
  keyUrl: string | null
  privacyUrl: string | null
  notice: string | null
}

// Eine Empfehlung aus /api/ai/recommendations (server/src/ai/recommendations.ts). Sie belegt nur
// vor: Jedes andere Modell lässt sich weiterhin eintragen.
export type AiRecommendation = {
  name: string
  provider: AiProviderKind
  preset?: string // nur für einen bestimmten Dienst gedacht
  sizeGb?: number
  vision: boolean
  note: string
  scores?: { text?: number; scan?: number; photo?: number } // Treffer im KI-Prüflauf, in Prozent
}
export type AiRecommendations = { models: AiRecommendation[]; updated: string | null; source: 'mitgeliefert' | 'netz' }

// Ein Modell zur Auswahl (aus /api/ai/status, listOllamaModels und listOpenAiModels im Server).
// Fehlt eine Angabe beim Anbieter, ist sie null.
export type AiModel = {
  name: string
  sizeBytes: number | null
  vision: boolean | null // null: unbekannt, etwa bei älteren Ollama-Versionen
  remote: boolean // läuft bei einem Cloud-Dienst, nicht auf diesem Rechner
}
export type AiStatus = {
  ok: boolean
  models?: AiModel[]
  error?: string
  found?: string // Adresse, unter der ein lokales Ollama stattdessen antwortet
}
// Antwort von /api/ollama/status, bleibt für Tabs von vor #18
export type OllamaStatus = {
  ok: boolean
  models?: string[] // nur die Namen, für Tabs von vor dem Update
  modelDetails?: AiModel[]
  error?: string
  found?: string // Adresse, unter der Ollama stattdessen antwortet
}

// ---------- Die Datenbank beim Start (#55) ----------

// Was beim Start mit der Datenbank geschehen ist. Steht im Zustandsbericht (GET /healthz,
// server/src/health.ts), und zwar nicht nur für Container-Orchestratoren: **Die Oberfläche liest
// genau diesen Eintrag**, weil sie dem Nutzer einmal sagen muss, was mit seinen Daten geschehen
// ist. Beim Start aus einem Linux-Paket gibt es keine Konsole, auf der es sonst stünde.
//
//   'none'   Es gab nichts zu übernehmen (keine db.json, keine Datenbank). Der stumme Normalfall.
//   'done'   Die Daten liegen jetzt in der Datenbank.
//   'failed' Der Umstieg ist nicht gelungen; Mietfuchs arbeitet mit der db.json weiter.
//   'stale'  Unterblieben mit Hinweis (#89): Die Datenbank trägt schon Daten, und daneben liegt
//            eine db.json. Weder Erfolg noch Fehler, sondern eine Feststellung mit einem Weg.
export type ChangeoverState = 'none' | 'done' | 'failed' | 'stale'

export type DatabaseState = {
  open: boolean
  file: string
  migrations: number
  detail: string
  changeover: {
    state: ChangeoverState
    // Ein Satz für die Oberfläche.
    message: string
    // Was sich dadurch für den Nutzer ändert, etwa am Mietkonto.
    notes: string[]
    // Nur bei 'stale': Die Datenbank trägt nur Einstellungen, der Bestand liegt noch ganz in der
    // db.json. Dann sperren die Datenrouten wie bei 'failed' (#89).
    pending?: boolean
  }
  // Hat ein Update Schritte am Aufbau einer vorhandenen Datenbank nachgeholt, nennt das die
  // Sicherung davor (#154): nur ihr Name, sie liegt im Datenordner. Das gilt auch nach einem
  // Neustart, bis die Oberfläche den Hinweis wegklickt (#180, POST /api/database/migrated/seen).
  // Sonst null, auch nach einem Umstieg aus der db.json (deren Rückweg ist db.json.abgeloest)
  // und nach dem Wiederherstellen eines Backups (dort ist es mietfuchs.sqlite.vor-restore).
  // `at` ist der Zeitpunkt der Sicherung (ISO): Er unterscheidet sie von einer früheren gleichen
  // Namens, die beiseitegelegt wurde, und daran merkt sich die Oberfläche das Wegklicken.
  migrated: { steps: number, backup: string, at: string } | null
}

// Antwort von /api/update (server/src/update.ts)
export type UpdateStatus = {
  enabled: boolean // nur mit Zustimmung
  current: string
  mode: 'binary' | 'package' | 'docker' | 'npm' // 'package': aus einem Linux-Paket installiert
  latest: string | null
  available: boolean
  releaseUrl: string | null
  downloadUrl: string | null // nur bei der Programmdatei
  checkedAt: string | null
  error: string | null
}

export type SettlementRow = {
  costItemId: string
  category: string
  description: string
  totalCents: number
  // Umlageschlüssel der Position. `keyLabel` daneben ist seine Beschriftung für die Abrechnung.
  // Die Zeilen des Vermieteranteils führen den Schlüssel nicht mit, dort wird nichts verteilt —
  // deshalb optional.
  key?: CostKey
  keyLabel: string
  basisText?: string
  shareCents: number
  // §35a-Lohnanteil dieser Zeile. Auch ihn gibt es nur in den Zeilen der Mieter.
  labor35aCents?: number
  // Der Rechenweg dieser Zeile (#114), mit den Zahlen der Abrechnung. Nur in den Zeilen der
  // Mieter, und optional, weil eine vorher abgeschlossene Abrechnung ihn nicht kennt.
  steps?: CalcStep[]
  // Woraus der Vermieteranteil dieser Position besteht (#142), zusammen genau `shareCents`. Nur
  // in den Zeilen des Vermieteranteils, und optional, weil eine vorher abgeschlossene Abrechnung
  // sie nicht kennt; die Oberfläche nennt die Gründe dann pauschal wie zuvor.
  landlordParts?: LandlordPart[]
  // Eine Zeile ohne Kostenposition (Heizung PR 6): `co2Relief` ist der CO₂-Anteil des Vermieters,
  // der dem Mieter als eigene Zeile abgezogen wird (Entwurf 7.5, 9.4). `costItemId` trägt dann die
  // Kennung des Topfs (`co2:<Anlage>:<Heizperiode>`), die keiner Position gehört. `fuelCarry`
  // (Heizung PR 7): der Teil einer Brennstoffrechnung aus einer anderen Heizperiode, verteilt mit
  // dem Schlüssel ihrer Position; `costItemId` ist `fuel:<Lieferung>:<Heizperiode>:<andere Heizperiode>:<Position>`.
  // Spätere PRs ergänzen `co2Refund`.
  kind?: 'co2Relief' | 'fuelCarry'
}

// Die Gründe, aus denen ein Teil einer Position beim Vermieter bleibt (#142):
//   `notAllocable`  die Kostenart ist nicht umlagefähig
//   `noBasis`       die Position ließ sich nicht verteilen (siehe die Hinweise der Abrechnung)
//   `selfUse`       Anteil selbstgenutzter Wohnungen (der Eigenanteil)
//   `vacancy`       Leerstand: Zeit oder Wohnung ohne Mietverhältnis
//   `flatRate`      Mietverhältnis mit Betriebskostenpauschale für diese Kostenart
//   `inclusive`     Mietverhältnis mit Inklusivmiete für diese Kostenart
//   `outsideUnit`   Wohnung außerhalb der Abrechnungseinheit (ihr Mietverhältnis, ihr Zähler, ihr
//                   vereinbarter Anteil)
//   `amountsRest`   bei Einzelbeträgen der Rest, den kein Mietverhältnis trägt
//   `customRest`    bei vereinbarten Anteilen, was unter 100 % fehlt
//   `mainMeterRest` beim Verbrauch der Teil des Hauptzählers, den kein Wohnungszähler misst
//   `co2Share`      CO₂-Anteil des Vermieters (Heizung PR 6): beim Vorwegabzug der abziehbare Teil
//                   in der Position des Messdienstes, beim reinen Ausweis die Summe der Abzugszeilen
//   `fuelCarry`        Gegenzeile zu einem Übertrag (Heizung PR 7): der Teil einer Rechnung, der in
//                      eine andere Heizperiode gehört; über die Zeiträume hinweg null
//   `fuelClosedPeriod` der Teil für eine abgeschlossene Heizperiode, die ohne Schätzung abgeschlossen wurde
//   `fuelEstimateDiff` tatsächlicher Teil minus Schätzung einer abgeschlossenen Heizperiode, mit Vorzeichen
//   `stockRemaining`   Restbestand im Vorrat einer stillgelegten Heizanlage (Kesseltausch, Heizung PR 9): Er
//                      gehört dem Vermieter, die Mieter tragen nur den verbrauchten Brennstoff
//   `rounding`      Rundungsrest (nur in Abrechnungen, die vor #202 abgeschlossen wurden)
export type LandlordReason =
  | 'notAllocable' | 'noBasis' | 'selfUse' | 'vacancy' | 'flatRate' | 'inclusive'
  | 'outsideUnit' | 'amountsRest' | 'customRest' | 'mainMeterRest' | 'co2Share'
  | 'fuelCarry' | 'fuelClosedPeriod' | 'fuelEstimateDiff' | 'stockRemaining' | 'rounding'
export type LandlordPart = { reason: LandlordReason; cents: number }

// Ein Schritt des Rechenwegs: Beschriftung, Wert als fertiger Text, auf Wunsch mit dem Begriff
// des Lexikons, der ihn erklärt.
export type CalcStep = { label: string; value: string; term?: TermId }

export type Statement = {
  tenancyId: string
  // Die Wohnung des Mietverhältnisses. Die Abrechnung zeigt `unitName` an; die Kennung braucht,
  // wer die Zeilen einer Wohnung zuordnet (etwa der Prüfkatalog).
  unitId: string
  tenantName: string
  unitName: string
  persons: number
  days: number
  // Personentage des Zeitraums: die Rechengrundlage des Personenschlüssels. `basisText` der
  // einzelnen Zeile beschreibt sie im Klartext, hier steht die Zahl dahinter.
  personDays: number
  periodStart: string
  periodEnd: string
  rows: SettlementRow[]
  totalShareCents: number
  total35aCents: number
  prepaymentCents: number
  prepaymentOverridden: boolean
  suggestedMonthlyCents: number
  balanceCents: number
  // Heizung PR 5 (Entwurf 5.7). `scope`: 'heating' in der Heizkostenabrechnung einer Heizperiode
  // (Weg d); fehlt es, ist es die Betriebskostenabrechnung. `heatingOnly`: Das Mietverhältnis hat im
  // Abrechnungszeitraum nicht mehr gewohnt, die Abrechnung enthält nur seine Heizkosten (3.1, R-A4);
  // `recommendedDeadline` ist dann die empfohlene, frühere Frist. `heatingPrepaymentCents`: der in
  // `prepaymentCents` enthaltene Teil der Heizvorauszahlung, nur wenn es eine Heizstaffel gibt.
  // `prepaymentNote`: wo Vorauszahlungen von Monaten dieser Abrechnung angerechnet sind (C3).
  scope?: 'all' | 'heating'
  heatingOnly?: boolean
  recommendedDeadline?: string
  heatingPrepaymentCents?: number
  prepaymentNote?: string
}

export type NotSettled = {
  tenancyId: string
  tenantName: string
  unitName: string
  costModel: CostModel
  heatingModel: CostModel
}

// Ein Hinweis der Berechnung (#112), in fester Gestalt statt als loser Satz. Die Stufe ist
// fachlich bestimmt: `error` heißt, die Angaben widersprechen sich und eine Position wird gar
// nicht verteilt; `warning`, Geld landet anders als vermutlich gewollt oder eine Rechtsregel ist
// verletzt; `hint`, etwas zum Prüfen ohne sicheren Fehler; `info` ist reine Auskunft.
export type NoticeLevel = 'info' | 'hint' | 'warning' | 'error'
// Wo man den Hinweis behebt. Daraus wird der Knopf „Hier beheben →“.
// `rentLedger` (#133): das Mietkonto eines Mietverhältnisses, `id` ist die Kennung des Mietverhältnisses.
// `heatingPlant` (Heizung PR 5): die Heizanlage in den Stammdaten; `id` leer heißt, es gibt noch keine,
// und der Knopf führt zur Einrichtung (PR 6). `heatingCosts` (Heizung PR 6): die CO₂-Angaben und das
// Warmwasser einer Anlage auf der Seite Heizkosten; `id` ist die Anlage.
export type NoticeSubject = { kind: 'costItem' | 'unit' | 'tenancy' | 'meter' | 'rentLedger' | 'heatingPlant' | 'heatingCosts' | 'heatingSettlement'; id: string }
export type Notice = {
  code: string
  level: NoticeLevel
  title: string
  text: string
  subject?: NoticeSubject
  // Code im Regelverzeichnis, wenn der Hinweis auf einer Rechtsregel beruht
  rule?: string
  // Begriffe des Lexikons, die den Hinweis erklären (#113). Optional, weil Hinweise einer
  // vorher abgeschlossenen Abrechnung sie nicht tragen.
  terms?: TermId[]
}
// Eine Regel, wie sie in einer Abrechnung als Rechtsstand steht: ohne Kurzfassung, denn die
// gehört zur Erklärung und nicht zum Archivstück.
export type AppliedRule = { code: string; title: string; norm: string; validFrom?: string; validTo?: string }
// Ein Wert aus dem Rechtsregister (shared/law/), wie ihn JSON speichern kann.
export type LawValue = number | string | boolean | null | readonly LawValue[] | { readonly [key: string]: LawValue }
// Ein Rechtswert, mit dem eine Abrechnung gerechnet hat (Heizung PR 1, Entwurf 4.4). `text` ist
// der Wert in Worten („15 %“), so wie er beim Rechnen dastand; er friert mit ein, damit eine
// spätere Fassung des Registers eine versandte Abrechnung nicht anders beschreibt.
export type AppliedValue = {
  id: string
  title: string
  norm: string
  cite: string
  value: LawValue
  text: string
  validFrom?: string
  validTo?: string
  // Vom Vermieter eingetragen, weil der amtliche Wert noch nicht im Programm stand (Heizung PR 17,
  // Entwurf 4.5); `source` ist seine Angabe, `enteredAt` der Tag des Eintrags.
  overridden?: { source: string; enteredAt: string }
}
// Ein vom Vermieter eingetragener Rechtswert (Heizung PR 17, Entwurf 4.5, 5.9): nur für überschreibbare
// Parameter und nur für ein Jahr, in dem das Register `null` hat. `validFrom` ist der 1. Januar.
export type LawOverride = { paramId: string; validFrom: string; value: number; source: string; enteredAt: string }
export type LawOverrideStatus = 'open' | 'entered' | 'superseded'
// Eine Zeile der Einstellungen: ein überschreibbarer Wert eines Jahres, amtlich oder eingetragen.
export type LawOverrideSlot = {
  paramId: string
  title: string
  norm: string
  reason: string
  year: number
  // Wie das Jahr zu lesen ist („2027“, beim Emissionshandel „für Rechnungen aus 2027 (Durchschnitt der
  // Versteigerungen 2026)“, Durchsicht von #246, R-W4).
  yearLabel: string
  validFrom: string
  official: number | null
  override: LawOverride | null
  status: LawOverrideStatus
}
// Datum des Rechtsregisters, die Regeln, die im Abrechnungsjahr gelten, und die Rechtswerte, mit
// denen gerechnet wurde. Wird mit der Abrechnung eingefroren, damit eine spätere Rechtsänderung
// eine versandte Abrechnung nicht rückwirkend anders erklärt. `values` ist optional, weil eine vor
// 0.11.0 abgeschlossene Abrechnung es nicht kennt.
export type LegalBasis = { asOf: string; rules: AppliedRule[]; values?: AppliedValue[] }

export type Settlement = {
  // Kalenderjahr, in dem der Abrechnungszeitraum beginnt (#208); bei einem Kalenderobjekt das
  // Abrechnungsjahr wie bisher.
  year: number
  // Tage des Abrechnungszeitraums (#208). Der Name stammt aus der Zeit, als jeder Zeitraum ein Jahr
  // war; ältere Tabs lesen ihn.
  daysInYear: number
  // Der Abrechnungszeitraum und das Ende der Frist nach § 556 Abs. 3 S. 2 BGB (#208). Eine vorher
  // abgeschlossene Abrechnung kennt beide nicht; die Route ergänzt sie aus dem Zeitraum.
  period: SettlementPeriod
  deadline: string
  // Heizung PR 5. `heatingPeriods`: die eigenen Heizperioden, deren Heizkosten in dieser Abrechnung
  // stehen (Weg b). `separateHeating`: Heizperioden, die in diesem Zeitraum enden, aber getrennt
  // abgerechnet werden (Weg d), mit ihrer Frist. `scope`: gesetzt in der Heizkostenabrechnung.
  heatingPeriods?: HeatingPeriodRef[]
  separateHeating?: SeparateHeatingRef[]
  scope?: HeatingScopeRef
  statements: Statement[]
  landlord: { rows: SettlementRow[]; totalCents: number }
  // im Vermieteranteil enthaltener Eigenanteil selbstgenutzter Wohnungen
  selfUsedShareCents: number
  totalCostsCents: number
  // die Texte der Hinweise, für ältere Tabs und für Abrechnungen, die vor #112 abgeschlossen wurden
  warnings: string[]
  // Optional, weil eine vor #112 abgeschlossene Abrechnung beide Felder nicht kennt.
  notices?: Notice[]
  legalBasis?: LegalBasis
  // Mietverhältnisse ohne Abrechnung (#93), mit ihrem Modell. Optional, weil eine vor #93
  // abgeschlossene Abrechnung das Feld nicht kennt.
  notSettled?: NotSettled[]
  // Einheiten ohne Fläche, die ausdrücklich mit 0 Personen genutzt werden (Garage, Stellplatz,
  // #135). Der Server entscheidet das (isGarageLike in calc.ts), das Cockpit übernimmt es.
  // Optional, weil eine vorher abgeschlossene Abrechnung das Feld nicht kennt.
  garageLikeUnitIds?: string[]
  // Je Heizanlage und Heizperiode dieser Abrechnung, was der Druckblock braucht (Heizung PR 6,
  // Entwurf 5.7, 9.5). Optional, weil eine vorher abgeschlossene Abrechnung es nicht kennt und eine
  // Abrechnung ohne Heizanlage es nicht hat.
  heating?: HeatingStatement[]
  // gesetzt, wenn die Abrechnung abgeschlossen (eingefroren) ist
  closed: { closedAt: string; sentAt: string | null } | null
  // Nur bei einer abgeschlossenen Abrechnung (#56): Was die heutige Berechnung je Mieter anders
  // ergäbe. Der eingefrorene Stand bleibt davon unberührt.
  deviation?: SettlementComparison
}

// Abweichung eines Mietverhältnisses zwischen eingefrorenem und heutigem Saldo (#56). Salden wie
// in der Abrechnung: über null Guthaben des Mieters, unter null Nachzahlung. `null` heißt, das
// Mietverhältnis steht nur auf einer der beiden Seiten.
export type SettlementDeviation = {
  tenancyId: string
  tenantName: string
  unitName: string
  frozenBalanceCents: number | null
  currentBalanceCents: number | null
  // heute minus eingefroren; über null zugunsten des Mieters
  differenceCents: number
  // `added` und `removed`: nur auf einer Seite, also nichts nachgerechnet (etwa eine Wohnung, die
  // das Objekt gewechselt hat). Eine Richtung wäre dort kein Befund.
  direction: 'tenant' | 'landlord' | 'added' | 'removed'
}
// Ein Rechtswert, der heute anders lautet als beim Abschluss (Heizung PR 1, Entwurf 4.4): Das
// Register hat eine neue Fassung bekommen, etwa nach einer Berichtigung. Die Texte stammen aus der
// eingefrorenen und aus der heutigen Abrechnung.
// `checkOnly`: ein Wert, mit dem die Abrechnung nur geprüft und nichts gerechnet hat (Heizung PR 17,
// Durchsicht von #246, G-K6); fehlt bei allen übrigen.
export type LawValueChange = { id: string; title: string; frozenText: string; currentText: string; checkOnly?: true }
export type SettlementComparison = {
  // false, wenn sich der eingefrorene Stand nicht lesen ließ; dann ist „keine Abweichung“ keine
  // Auskunft, und die Oberfläche sagt das.
  comparable: boolean
  deviations: SettlementDeviation[]
  // Leer, wenn nichts abweicht oder der eingefrorene Stand keine Rechtswerte kennt (vor 0.11.0).
  valueChanges: LawValueChange[]
  // Ende der Abrechnungsfrist nach § 556 Abs. 3 BGB und ob es vorbei ist
  deadline: string
  deadlinePassed: boolean
}

// ---------- Steuer-Export (Anlage V) ----------

// Bei teilweiser Eigennutzung (#163): `privateCents` entfällt auf selbstgenutzte Wohnungen und ist
// nicht abziehbar, `deductibleCents` ist der Rest. Zusammen immer `amountCents`. Ohne
// selbstgenutzte Wohnung ist `privateCents` 0.
export type TaxExpenseCategory = { category: string; amountCents: number; labor35aCents: number; privateCents: number; deductibleCents: number }
export type TaxExpenseGroup = {
  group: string // Anlage-V-nahe Gruppierung (z. B. „Laufende Betriebskosten“)
  amountCents: number
  labor35aCents: number
  privateCents: number
  deductibleCents: number
  categories: TaxExpenseCategory[]
}

// Wie der private Teil einer Position zustande kommt (#163, Regeln in calc.ts `taxReport`):
//   `settlement`     umlagefähig: der Eigenanteil laut Nebenkostenabrechnung
//   `direct-self`    direkt der selbstgenutzten Einheit zugeordnet
//   `direct-rented`  direkt einer vermieteten oder leeren Einheit zugeordnet, voll abziehbar
//   `direct-outside` direkt einer Einheit außerhalb der Abrechnungseinheit; abziehbar, Mietfuchs
//                    kann die Einheit aber nicht einordnen
//   `area`           nach der Fläche der betroffenen Einheiten (BFH-Regelmaßstab)
//   `unsplittable`   nicht aufteilbar, weil eine Fläche fehlt; ungekürzt abziehbar und gemeldet
export type TaxAllocation = 'settlement' | 'direct-self' | 'direct-rented' | 'direct-outside' | 'area' | 'unsplittable'
export type TaxExpenseItem = {
  costItemId: string
  category: string
  group: string
  description: string
  amountCents: number
  privateCents: number
  deductibleCents: number
  labor35aCents: number
  allocation: TaxAllocation
  // „abzugsfähiger Anteil (in %)“ der Anlage V, auf zwei Stellen, nur bei verhältnismäßiger
  // Zuordnung (`settlement`, `area`) und einem Betrag ungleich 0.
  deductiblePercent: number | null
  // Zum Vergleich der private Teil nach der Fläche des ganzen Gebäudes, wo die Abrechnung nach
  // einem anderen Maßstab als Fläche oder Verbrauch verteilt (Personen, Einheiten, vereinbart,
  // Gemeinschaft). Sonst null.
  areaPrivateCents: number | null
  // Zum Vergleich der Eigenanteil laut Abrechnung, wo die Steuer trotzdem nach der Fläche des
  // ganzen Gebäudes rechnet, weil es Einheiten außerhalb der Abrechnungseinheit gibt. Sonst null.
  settlementPrivateCents: number | null
  // Der Rechenweg (#114), als „gesonderte Aufstellung“ der Anleitung zur Anlage V.
  steps: CalcStep[]
  // Nur bei „Nicht umlagefähig“: die Einheiten, denen die Position unter „Betrifft (für die
  // Steuer)“ zugeordnet ist, sonst null (ganzes Gebäude, oder umlagefähig). Die Seite nennt sie in
  // einem Hinweis, denn Positionen aus 0.8.0 oder älter können eine solche Zuordnung noch aus dem
  // damaligen Umlageschlüssel tragen (Integrationsdurchsicht vor 0.10). Mit Kennung und Namen
  // unter `unitName`, damit die Regression des Umstiegs den Namen wie überall als Beschriftung
  // ausnimmt (regression.ts): Eine Wohnung ohne Namen in der db.json heißt danach ''.
  taxUnits: { unitId: string; unitName: string }[] | null
}

export type TaxReport = {
  year: number
  income: {
    baseRentSollCents: number // Kaltmiete (netto), vereinbart
    // davon Mieten, die Nebenkosten einschließen (Inklusivmiete kalt oder warm, #142). Sie stehen in
    // `baseRentSollCents` mit drin; die Übersicht nennt sie eigens, weil sie nicht „ohne Umlagen“ sind.
    inclusiveRentSollCents: number
    prepaymentSollCents: number // NK-Vorauszahlungen, vereinbart
    flatRateSollCents: number // Betriebskostenpauschalen, vereinbart (#93)
    // Was die Abrechnung desselben Jahres bei den Vorauszahlungen ansetzt, bei abgeschlossener
    // Abrechnung ihr eingefrorener Stand. Das ist nicht dasselbe wie `prepaymentSollCents`, und
    // der Unterschied ist gewollt: Die Abrechnung muss die tatsächlich geleisteten
    // Vorauszahlungen einstellen (§ 556 BGB, ständige Rechtsprechung des BGH), und sie verteilt
    // nur über Wohnungen, die zur Abrechnungseinheit gehören. Die Übersicht führt beide, damit
    // der Unterschied dasteht, statt dass jeder Nutzer ihn selbst herleitet (#70). `null`, wenn
    // kein Abrechnungszeitraum dem Kalenderjahr gleicht (#208, Entwurf 3.10): Eine Zahl aus zwei
    // halben Abrechnungen wäre eine erfundene.
    prepaymentSettlementCents: number | null
    // **Setzt die Abrechnung eine Jahreskorrektur an?** Bewusst nicht „ist eine erfasst“: Eine
    // Korrektur auf einem Mietverhältnis außerhalb der Abrechnungseinheit ist erfasst, geht aber
    // in keine Abrechnung ein. Gelesen wird deshalb dieselbe Quelle wie bei der Zahl darüber.
    prepaymentOverridden: boolean
    sollCents: number // Summe Soll (brutto)
    // Tatsächlich zugeflossen (§ 11 Abs. 1 Satz 1 EStG): alle Zahlungen mit Datum im Jahr,
    // unabhängig davon, ob das Mietkonto für sie eine Zeile führt. Siehe calc.ts.
    paidCents: number
    // Mietverhältnisse des Jahres mit einem Soll über null, und wie viele davon keine einzige
    // Zahlung haben. Nicht für eine Rechnung, sondern für den Hinweis: Eine unvollständige
    // Erfassung ergibt eine zu niedrige Einnahme, und die fällt sonst niemandem auf.
    tenanciesWithSoll: number
    tenanciesWithoutPayment: number
  }
  expenses: {
    groups: TaxExpenseGroup[]
    // Die Bruttosumme aller Positionen, ohne die Rücklage. Abziehbar ist `deductibleCents` (#163).
    totalCents: number
    privateCents: number
    deductibleCents: number
    labor35aCents: number // Summe der §35a-Arbeitskosten (Lohnanteile)
    // Heizung PR 8: Eigenanteil am Übertrag aus dem Brennstoffvorrat in den Abrechnungen dieses Jahres.
    // Die Abrechnung zeigt den Verbrauch, die Steuerübersicht das Bezahlte (Entwurf 8.2, N8); um diesen
    // Betrag liegen beide beim Eigenanteil auseinander. Fehlt das Feld, gibt es keinen Übertrag.
    stockCarrySelfCents?: number
    // Jede Position mit ihrer Aufteilung, in der Reihenfolge der Erfassung (#163)
    items: TaxExpenseItem[]
  }
  // Die Abrechnungen, aus denen die Eigenanteile stammen (#208): bei einem Kalenderobjekt die des
  // Jahres, bei Mai bis April die beiden, die das Jahr berühren.
  settlementPeriods: { key: PeriodKey; label: string }[]
  // Hatte eine selbstgenutzte Einheit im Jahr ein Mietverhältnis? Dann ist die Aufteilung nach
  // Fläche nicht nach Tagen gerechnet (#163).
  selfUseChangedInYear: boolean
  // Abgeschlossene Abrechnung, deren eingefrorene Eigenanteile von der heutigen Rechnung abweichen
  // oder je Position gar nicht vorliegen (Archivstück von vor #142).
  closedSelfUseDiffers: boolean
  // Positionen, die nach dem Abschluss erfasst oder im Betrag geändert wurden; sie rechnet die
  // Übersicht heute statt aus dem eingefrorenen Stand.
  closedItemsChanged: number
  // Zuführung zur Erhaltungsrücklage des Jahres (#143), nicht in den Werbungskosten: abziehbar
  // erst, wenn und soweit die Gemeinschaft sie verausgabt (BFH, Urteil vom 14.01.2025, IX R 19/24).
  reserveContributionCents: number
  // Positionen „Nicht umlagefähig“, deren Beschreibung nach Rücklage aussieht; sie stehen weiter
  // in den Werbungskosten, die Seite rät zur eigenen Kostenart.
  reserveSuspects: { costItemId: string; description: string; amountCents: number }[]
  // Gesamtfläche des Gebäudes und der selbstgenutzte Teil davon, in Quadratmetern. Genau die
  // beiden Zahlen fragt die Anlage V im Kopf ab. Gemessen wird das **Private** und nicht das
  // Vermietete: Nur das ist eindeutig, denn ob eine Wohnung außerhalb der Abrechnungseinheit
  // vermietet ist, weiß Mietfuchs nicht. Die Grundmenge ist das ganze Gebäude und damit eine
  // andere als die Verteilbasis der Abrechnung (#68), siehe calc.ts.
  totalAreaM2: number
  selfUsedAreaM2: number
  selfOccupiedExists: boolean // gibt es selbstgenutzte Einheiten (`selfUsed`, nicht vermietet)?
  // Gibt es Wohnungen außerhalb der Abrechnungseinheit? Mietfuchs kann sie nicht einordnen: Es
  // können getrennt abgerechnete Gewerbeeinheiten sein oder eine eigene Wohnung aus einem
  // Bestand von vor der dreiwertigen Unterscheidung.
  excludedExists: boolean
  selfUsedShareCents: number // auf selbstgenutzte Wohnungen entfallender Kostenanteil (privat)
  // Einkünfte = Einnahmen − abziehbare Werbungskosten (`expenses.deductibleCents`, #163)
  surplusSollCents: number // auf Soll-Basis
  surplusPaidCents: number // auf Ist-Basis (Zuflussprinzip)
  // Mietverhältnisse des Jahres, davon mit Inklusivmiete und mit Pauschale (#96, Zeilen 24 und 20
  // der Anlage V).
  // `inclusive`: kalt und warm inklusiv; `partlyInclusive`: nur eines von beiden.
  costModels: { tenancies: number; inclusive: number; partlyInclusive: number; flatRate: number }
}

// Ein Beleg im Belegordner (#170). `mtime` ist die Zeit der Datei und nur noch für ältere Tabs
// da; maßgeblich ist `uploadedAt` (siehe server/src/uploads.ts). `sha256` erkennt einen Beleg,
// der mit gleichem Inhalt zweimal hochgeladen wurde, auch unter anderem Namen.
export type UploadInfo = {
  file: string
  size: number
  mtime: string
  originalName: string
  mimeType: string
  uploadedAt: string
  sha256: string
  // Nur für einen Beleg im **Posteingang**, also an keiner Position: Objekt und Jahr, denen er
  // zugedacht ist. Hängt er an einer Position, ergeben sie sich aus ihr; diese Felder sagen dann
  // nichts mehr, damit es keine zweite Wahrheit gibt. `null` heißt „noch nicht zugeordnet“.
  propertyId: string | null
  year: number | null
  // Rechnungsdatum, wie es die KI-Auswertung gelesen hat oder jemand eingetragen hat (JJJJ-MM-TT)
  invoiceDate: string | null
  // Ein Beleg oder ein Zählerfoto aus der Schnellerfassung. Ein Zählerfoto belegt keine Kosten und
  // gehört deshalb weder in den Posteingang noch zum „Nachreichen“.
  kind: UploadKind
}
export type UploadKind = 'receipt' | 'meterPhoto'

// Was ein Beleg mit der Belegbuchung (#170) zu tun hat: an welchen Positionen er über gebuchte
// Zeilen hängt (zusätzlich zu `cost_items.invoice_file`) und ob er eine Auswertung hat. Der
// Belegordner liest beides aus `GET /api/uploads`.
export type UploadLinks = {
  bookedItemIds: string[]
  // Je Position die Summe der gebuchten Zeilen dieses Belegs, in Cent (eine nicht gelesene Zeile zählt 0)
  bookedCents: Record<string, number>
  assessment: { id: string; propertyId: string | null; open: boolean } | null
}
export type UploadEntry = UploadInfo & UploadLinks

// Was mit einer Wohnung gelöscht würde (#142), für die Löschfrage der Oberfläche. Die Kaskade
// erledigen die Fremdschlüssel (db/schema.ts); hier steht nur, wie viel sie träfe.
// `costItemLinks`: vereinbarte Anteile, Teilnahmen und Einzel- oder Eigenbeträge an
// Kostenpositionen, die mit der Wohnung entfallen. `directCostItems`: direkt zugeordnete
// Rechnungen; sie bleiben (`ON DELETE SET NULL`) und gehen danach an den Vermieter.
export type UnitDependents = {
  tenancies: number
  meters: number
  readings: number
  payments: number
  costItemLinks: number
  directCostItems: number
}

// Was die Oberfläche aus einer KI-Belegauswertung bekommt: das Ergebnis, nicht die rohe Antwort
// des Modells. Die beschreibt `RawExtraction` in server/src/invoiceAmounts.ts, und dort ist alles
// `unknown`; `toExtraction` in server/src/extract.ts ist die eine Stelle, an der daraus diese
// Zusage wird.
//
// `amountEur` fehlt, wenn das Modell den Betrag nicht lesen konnte. Das ist der ehrliche Fall:
// Die KI füllt ein Formular vor, ein Mensch prüft es, und ein leeres Feld kann er ausfüllen.
// `description` und `category` sind dagegen Pflicht, weil toExtraction dort im Zweifel eine
// leere Zeichenkette liefert.
export type Extraction = {
  vendor?: string
  invoiceDate?: string
  periodStart?: string | null
  periodEnd?: string | null
  totalGrossEur?: number
  positions?: { description: string; category: string; amountEur?: number; labor35aEur?: number | null }[]
  // Vom Server gerechnet (#34, server/src/invoiceAmounts.ts): 'netto' heißt, die Positionen
  // standen ohne Umsatzsteuer da und wurden auf den Rechnungsbetrag hochgerechnet
  amountsAdjusted?: 'netto'
  // Der Lohnanteil nach §35a stand nur als ein Betrag da und wurde auf die Positionen verteilt
  laborFromTotal?: boolean
}

// KI-Auswertung eines Zählerfotos (universeller Eingang)
export type MeterReadingExtraction = {
  meterNumber?: string | null
  value?: number | null
  dateOnImage?: string | null
}

// Antwort von /api/extract. `assessment` ist die gespeicherte Auswertung (Belegbuchung, #170);
// `null`, wenn sie sich nicht speichern ließ.
export type ExtractResult = { file: string; extraction: Extraction; assessment: AssessmentView | null }

// Antwort von /api/intake: erkennt automatisch Rechnung vs. Zählerfoto
export type IntakeResult = { file: string } & (
  | { kind: 'rechnung'; extraction: Extraction; assessment: AssessmentView | null }
  | { kind: 'zaehler'; reading: MeterReadingExtraction }
)

// Die Ampel einer ausgewerteten Rechnungsposition (Schnellerfassung, Belegbuchung #170): grün
// heißt sicher, gelb prüfen, rot fehlt etwas. Steht hier, weil Server und Browser sie zeigen.
export type TrafficLight = 'gruen' | 'gelb' | 'rot'

// ---------- Belegbuchung (#170) ----------
//
// Eine Auswertung ist das gespeicherte Ergebnis der KI zu einem Beleg, eine je Datei. Ihre Zeilen
// sind die Positionen der Rechnung. Ob eine Zeile gebucht ist, steht an ihr und nur dort; der
// Zustand wird abgeleitet (server/src/assessment.ts, `lineState`): ohne `costItemId` offen oder
// verworfen, mit ihr angelegt oder verknüpft. Löscht jemand die Position, macht der Fremdschlüssel
// (`ON DELETE SET NULL`) die Zeile von selbst wieder offen.
export type AssessmentBooking = 'created' | 'linked'
export type AssessmentLineState = 'open' | 'dismissed' | 'created' | 'linked'

export type StoredAssessment = {
  id: string
  file: string
  propertyId: string | null
  // Zieljahr der Buchung: das Jahr aus dem Beleg, sonst das gewählte; änderbar
  year: number
  // Das Jahr, das die KI aus dem Beleg gelesen hat (Leistungszeitraum, sonst Rechnungsdatum)
  detectedYear: number | null
  // Das gewählte Kalenderjahr: beim Auswerten mitgeschickt (die Seite, von der aus ausgewertet
  // wurde), danach das von Hand gesetzte; `null`, wenn keines mitkam. Es bleibt auch ohne Objekt
  // stehen (Durchsicht von #222, I1). Weicht `year` davon ab, steht die Ampel auf gelb und nichts ist
  // vorab angehakt.
  requestedYear: number | null
  // Der gewählte Abrechnungszeitraum (#208), aus `requestedYear` gebildet, sobald es ein Objekt gibt;
  // ohne Objekt `null`, denn ein Zeitraum ist nur am Objekt bestimmt (G-B7).
  requestedPeriod: PeriodKey | null
  vendor: string | null
  invoiceDate: string | null
  totalGrossCents: number | null
  // Vom Server gerechnet (#34): Positionen ohne Umsatzsteuer hochgerechnet, Lohnanteil verteilt
  amountsAdjusted: 'netto' | null
  laborFromTotal: boolean
  // Die nächste Zeilennummer, die es in dieser Auswertung noch nie gab (Hochwassermarke)
  nextIdx: number
  createdAt: string
}

export type StoredAssessmentLine = {
  assessmentId: string
  idx: number
  description: string
  category: string
  // Die Kostenart kam nur über die Beschreibung zustande (Ampel gelb)
  categoryGuessed: boolean
  // `null` heißt „nicht gelesen“, 0 ist eine Angabe
  amountCents: number | null
  labor35aCents: number | null
  booking: AssessmentBooking | null
  costItemId: string | null
  dismissed: boolean
  // Bei einer erneuten Auswertung dazugekommen, als aus dem Beleg schon Zeilen gebucht waren: Die
  // schon gebuchten Positionen dieses Belegs sind dann mögliche Doppelungen (Integrationsdurchsicht, H1).
  reassessed: boolean
}

// Die Angaben, die der Nutzer an einer Zeile vor dem Anlegen ändern kann.
export type LineFields = {
  description: string
  category: string
  amountCents: number | null
  labor35aCents: number | null
  key: CostKey
  // Der gemerkte Schlüssel (shared/allocation.ts), wenn die Zeile ihn übernimmt
  allocation: Allocation | null
  // Kosten der Gemeinschaft bei „laut Gemeinschaftsabrechnung“
  externalTotalCents: number | null
}

// Was der Browser je Zeile entscheidet. `despiteCandidates`: angelegt, obwohl es eine Position
// gibt, die dieselbe Rechnung sein könnte; der Nutzer hat die Rückfrage bestätigt. Beim
// Verknüpfen darf er einen falsch gelesenen Betrag berichtigen; `despiteCandidates` bestätigt dort
// das Verknüpfen einer erneut ausgewerteten Zeile mit einer schon aus diesem Beleg gebuchten
// Position (Integrationsdurchsicht, H1).
export type LineDecision =
  | { idx: number; action: 'create'; fields: LineFields; despiteCandidates?: boolean }
  | { idx: number; action: 'link'; costItemId: string; amountCents?: number | null; labor35aCents?: number | null; despiteCandidates?: boolean }
  | { idx: number; action: 'dismiss' }
  | { idx: number; action: 'release' }

// Eine Position, die dieselbe Rechnung sein könnte (shared/duplicates.ts). `formOnly`: Ihr Betrag
// hängt an weiteren Angaben (Einzelbeträge, Gemeinschaft), sie wird im Formular gepflegt.
export type LineCandidate = { id: string; description: string; amountCents: number; invoiceFile: string | null; key: CostKey; formOnly: boolean }

export type LineSuggestion = {
  fields: LineFields
  candidates: LineCandidate[]
  level: TrafficLight
  reasons: string[]
  preselected: boolean
}

// Eine Zeile, wie der Server sie zeigt: mit Zustand, der Beschreibung der Position, an der sie
// hängt, und für offene und verworfene Zeilen dem Vorschlag.
export type AssessmentLine = Omit<StoredAssessmentLine, 'assessmentId'> & {
  state: AssessmentLineState
  itemDescription: string | null
  suggestion: LineSuggestion | null
}

export type AssessmentView = StoredAssessment & {
  originalName: string
  lines: AssessmentLine[]
  // Hat die Auswertung noch offene Zeilen?
  open: boolean
  sumWarning: string | null
  // Der Zeitraum, in den die Auswertung bucht, und seine Bezeichnung (#208, `bookingPeriod`).
  // Optional, weil Testattrappen und ältere Antworten ihn nicht tragen.
  targetPeriod?: PeriodKey
  targetLabel?: string
}

// Je Position, die eine Buchung anlegt (`costItemId: null`) oder ändert: Betrag und Lohnanteil
// vorher und nachher.
export type PreviewItem = {
  costItemId: string | null
  lines: number[]
  description: string
  category: string
  year: number
  beforeCents: number | null
  afterCents: number
  beforeLabor35aCents: number | null
  afterLabor35aCents: number | null
}
export type PreviewProblem = { idx: number | null; message: string; openItemId?: string }

// Die Vorschau des Servers. `token` bindet eine Buchung an genau diesen Stand: Hat er sich bis
// zum Buchen geändert, antwortet der Server mit 409 und einer neuen Vorschau.
export type BookingPreview = {
  items: PreviewItem[]
  notices: string[]
  errors: PreviewProblem[]
  confirm: PreviewProblem[]
  token: string
}

// ---------- Abrechnungszeitraum (#208) ----------

// Der Schlüssel eines Abrechnungszeitraums: der Monat seines Beginns als 'JJJJ-MM'. Kein Zeitraum
// beginnt im selben Monat wie ein anderer, auch nicht über einen Rumpfzeitraum hinweg; deshalb ist
// der Beginnmonat eindeutig. Ein Markentyp über `string`: Eine Jahreszahl passt nicht hinein, und
// jede Stelle, die noch mit `year - 1` rechnet, fällt beim Übersetzen auf. Aus Text wird er nur in
// shared/period.ts.
export type PeriodKey = string & { readonly __periodKey: unique symbol }

// Der Rhythmus eines Objekts: der Beginnmonat von Anfang an (1 heißt Kalenderjahr) und die Wechsel
// als 'JJJJ-MM', ab denen jeder Zeitraum in diesem Monat beginnt. Die Zeiträume selbst werden daraus
// berechnet und nie gespeichert.
export type PeriodRules = { startMonth: number; changes: string[] }

// Ein Abrechnungszeitraum mit inklusiven Grenzen als 'JJJJ-MM-TT'. `short` heißt Rumpfzeitraum:
// kürzer als zwölf Monate, weil danach ein Wechsel kommt.
export type BillingPeriod = { key: PeriodKey; from: string; to: string; short: boolean }

// Der Zeitraum, wie eine Abrechnung ihn trägt, mit der Bezeichnung für Kopf und Druck
// („2025“, „2025/2026“, „01.01.–30.04.2025“).
export type SettlementPeriod = BillingPeriod & { label: string }

// ---------- Heizanlage (Heizung PR 4, Entwurf 5.3) ----------

// Womit geheizt wird. Pellets und Holz stehen getrennt, weil ihre Heizwerte verschieden sind
// (§ 9 Abs. 3 HeizkostenV, W8); Fernwärme heißt nicht pauschal „fossil“ (R-A28).
export type HeatingEnergy = 'gas' | 'oil' | 'lpg' | 'pellets' | 'wood' | 'districtHeating' | 'heatPump' | 'electric' | 'coal' | 'other'
// `perUnit`: Etagenheizungen mit Vertrag auf den Vermieter (§ 5 Abs. 1 Satz 2 CO2KostAufG); kommt mit PR 9.
export type HeatingSupply = 'central' | 'perUnit'
// Wer die Heizkostenabrechnung erstellt: Messdienst oder Gemeinschaft (`service`), Mietfuchs nach der
// Heizkostenverordnung (`self`, PR 10), niemand, also freie Schlüssel wie bisher (`manual`).
export type HeatingMethod = 'service' | 'self' | 'manual'
// Fernablesbarkeit und Einbau der Geräte als Angabe an der Anlage, wenn Mietfuchs die Zähler nicht
// kennt (G-C2, R-A1).
export type DevicesRemote = 'all' | 'none' | 'partial' | 'unknown'
export type DevicesInstalledAfter = 'all' | 'some' | 'none' | 'unknown'
// Wie die nicht fernablesbaren Geräte nach dem Stichtag eingebaut wurden (§ 5 Abs. 2 HeizkostenV,
// Nachprüfung von #230): einzeln als Ersatz oder Ergänzung in ein bestehendes, nicht fernablesbares
// System (Satz 4, dann Frist nach Abs. 3) oder als Ganzes neu (Satz 1). `null` heißt unbeantwortet.
export type NewDevicesInstall = 'single' | 'whole'
// `homeowners`: vermietete Eigentumswohnung, die Gemeinschaft liefert die Abrechnung (§ 1 Abs. 2 Nr. 3
// HeizkostenV, D-F2); nur mit `service`.
export type HeatingSource = 'building' | 'homeowners'
// Mieterwechsel: übrige Wärmekosten nach Gradtagen oder zeitanteilig (§ 9b Abs. 2 HeizkostenV). Wirkt
// bei `manual` erst auf Positionen „nur Heizung“ (PR 10, A2).
export type ChangeSplit = 'degreeDays' | 'time'
export type HeatingRole = 'supply' | 'dhwHeat' | 'totalHeat'
export type InsulationRule = 'applies' | 'notApplies' | 'unknown'
export type DhwMethod = 'heatMeter' | 'volumeFormula' | 'areaFormula'

// Eine angeschlossene Wohnung. Die beheizte Fläche (§ 7 Abs. 1 Satz 5) kommt mit PR 10.
export type HeatingPlantUnit = { unitId: string; heatedAreaM2: number | null }

export type HeatingPlant = {
  id: string
  propertyId: string
  name: string
  energy: HeatingEnergy
  supply: HeatingSupply
  method: HeatingMethod
  // Werden die Heizkosten getrennt abgerechnet, mit eigener Vorauszahlung (3.1)? `null` unbekannt.
  separateSettlement: boolean | null
  devicesRemote: DevicesRemote
  devicesInstalledAfter2021: DevicesInstalledAfter
  newDevicesInstall: NewDevicesInstall | null
  source: HeatingSource
  // Wärmepumpe (§ 12 Abs. 3 HeizkostenV): Verbrauch am 01.10.2024 schon erfasst? Sonst seit wann.
  captureInstalledOn: string | null
  capturedOnOct2024: boolean | null
  // Durchschnittliche Heizkosten 2022 bis 2024 bei Bruttowarmmiete (§ 12 Abs. 3 Satz 3), in Cent.
  warmRentAverageCents: number | null
  changeSplit: ChangeSplit
  // CO₂-Merkmale (Heizung PR 7, Entwurf 5.3): Nichtwohngebäude (§ 8 CO2KostAufG), Beschränkungen bei
  // energetischen Verbesserungen (§ 9) und Wärme aus dem Emissionshandel bei erstem Anschluss nach
  // dem Stichtag (§ 2 Abs. 4 Satz 2, nur bei Fernwärme).
  nonResidential: boolean
  restriction: Co2Restriction
  districtEtsNew: boolean
  // Eigene Heizperiode (#217, Heizung PR 5); `null` heißt wie das Objekt. Gesetzt nur über den Wechsel mit Vorschau.
  periodStartMonth: number | null
  // Die Wechsel der eigenen Heizperiode als 'JJJJ-MM', aufsteigend, wie beim Objekt (Heizung PR 5).
  // Ohne eigene Heizperiode leer.
  periodChanges: string[]
  // Die Zeitspannen, in denen die Heizkosten getrennt abgerechnet werden (Weg d), aufsteigend.
  separateSpans: SeparateSpan[]
  // `null`: alle Wohnungen des Objekts ohne „kein Anschluss: Wärme“ (#117). Eine Liste, auch eine
  // leere, nennt die angeschlossenen.
  units: HeatingPlantUnit[] | null
  // Kesseltausch (Heizung PR 9): der letzte Betriebstag einer stillgelegten Anlage und an der neuen die
  // Anlage, die sie ersetzt. Gesetzt nur über den Kesseltausch; sonst `null`.
  endsOn: string | null
  replacesPlantId: string | null
  // Gebäude (Heizung PR 9, § 5 Abs. 1 CO2KostAufG): Heizen zwei Anlagen gleichzeitig, sagt die zweite,
  // ob sie im selben Gebäude steht wie eine andere (deren Kennung) oder in einem eigenen (`'own'`).
  // `null`: nicht gefragt (die erste Anlage, oder sie ersetzt eine andere und übernimmt deren Angabe).
  buildingWith: string | null
  // Kesseltausch mit demselben Vorratsbrennstoff (Öl → Öl, Nachprüfung von #238): Verheizt die neue
  // Anlage den Brennstoff im Tank weiter? Dann ist der Restbestand der alten ihr Anfangsbestand; sonst
  // bleibt er beim Vermieter. `null`: nicht gefragt, weil die Anlage keine mit demselben Brennstoff ersetzt.
  takesOverStock: boolean | null
  // Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 5.3). Wird das Warmwasser mit derselben
  // Anlage bereitet (`combined`, dann wird nach § 9 aufgeteilt), getrennt (`separate`) oder gar nicht
  // (`none`)? Womit wird erfasst (bei `self` Pflicht; Heizkostenverteiler und Werte eines
  // Ablesedienstes kommen mit PR 12)? Grundkosten Heizung nach Wohnfläche oder beheizter Fläche
  // (§ 7 Abs. 1 Satz 5; Warmwasser immer nach Wohnfläche, § 8 Abs. 1). Und bei einer Wärmepumpe, wann
  // sie eingebaut wurde (§ 12 Abs. 3, Abweichung 1 des Plans).
  hotWater: HotWater
  capture: CaptureMethod | null
  areaBasisHeat: AreaBasisHeat
  heatPumpInstalledOn: string | null
  // Erzeugt die Anlage die Wärme allein oder mit einem weiteren Erzeuger? (Heizung PR 11, § 9 Abs. 1
  // Satz 5 und Abs. 2 Satz 6 Nr. 3 HeizkostenV). Nur für den Warmwasseranteil nach einer Formel gefragt.
  heatGeneration: HeatGeneration | null
  // Wärmepumpe: mehr als die Hälfte der Wärme des Gebäudes (Heizung PR 11, § 11 Abs. 1 Nr. 3 Buchst. a a. F.).
  heatPumpMajority: HeatPumpMajority | null
  // Bauart der Heizkostenverteiler (Heizung PR 12, Entwurf 5.3), nur zur Beschreibung im Ausweis.
  hcaModel: string | null
  // Die Zeiträume der eigenen Heizkostenabrechnung (Durchsicht von #239), aufsteigend; `until` NULL beim
  // laufenden.
  selfSpans?: SelfSpanRange[]
}
// Ein Zeitraum der eigenen Heizkostenabrechnung, Schlüssel von Heizperioden; `until` ist die erste ohne.
// `capture` und `hotWater` (Heizung PR 12, Durchsicht von #241, I2): womit der Verbrauch in diesem Zeitraum
// erfasst wird und wie das Warmwasser bereitet wird; eine Änderung beginnt einen neuen Zeitraum. Fehlt die
// Angabe (Zeitraum von vor PR 12), gilt die der Anlage.
export type SelfSpanRange = { from: string; until: string | null; capture?: CaptureMethod | null; hotWater?: HotWater | null }

// Die Angaben einer Heizperiode (Entwurf 5.3; den Vorrat seit Heizung PR 8). Geschrieben werden sie ab PR 6 (Warmwasser
// laut Messdienst), PR 10 (Verteilung) und PR 14 (§ 6a); PR 4 legt nur die Tabelle an.
export type HeatingPeriodData = {
  id: string
  plantId: string
  period: PeriodKey
  heatConsumptionPct: number | null
  waterConsumptionPct: number | null
  above70Agreed: boolean | null
  insulationRule: InsulationRule | null
  dhwMethod: DhwMethod | null
  dhwHeatKwh: number | null
  totalHeatKwh: number | null
  dhwVolumeM3: number | null
  dhwTempC: number | null
  dhwUnmeasurable: boolean | null
  infoTaxesText: string | null
  infoDistrictGhg: number | null
  infoDistrictPef: number | null
  climateFactor: number | null
  climateFactorPrev: number | null
  consumerContract: string | null
  infoContactsConfirmed: boolean | null
  // § 6a Abs. 3 Nr. 4 und 5 (Heizung PR 14): der Vergleichswert eines Durchschnittsnutzers in kWh je m²
  // Wohnfläche für die Heizperiode, mit Quelle (etwa die Vergleichswerte des Ablesedienstes; kein Durchschnitt
  // des eigenen Hauses, BR-Drs. 643/21, S. 19, 21), und die Quelle der beiden Klimafaktoren.
  infoReferenceKwhPerM2: number | null
  infoReferenceSource: string | null
  climateFactorSource: string | null
  // Ausnahme nach § 11, Vereinbarung nach § 2 und die monatliche Verbrauchsinformation (Heizung PR 14). Sie
  // stehen **je Heizperiode** und gelten ab ihr für die folgenden der Linie, bis eine spätere etwas anderes sagt
  // (`periodRulesOf` in server/src/heatingInfo.ts); `null` heißt: nicht beantwortet, es gilt die vorige.
  // So ändert eine Antwort keine frühere Heizperiode, weder eine offene noch eine abgeschlossene.
  // `exemptionScope`: nur die Wärme (`heat`) oder auch das Warmwasser (`both`, § 11 Abs. 2); ohne Antwort
  // nur die Wärme. `exemptionBillingAgreed`: § 2 Abs. 7 CO2KostAufG. `agreedOtherwise`: `none` heißt
  // ausdrücklich keine Vereinbarung.
  exemption: HeatingExemption | null
  exemptionScope: ExemptionScope | null
  exemptionBillingAgreed: boolean | null
  agreedOtherwise: AgreedOtherwise | null
  monthlyInfoElsewhere: boolean | null
  // Durchsicht von #243, R-W1: Quelle des beigelegten Vergleichs des Ablesedienstes (§ 6a Abs. 3 Nr. 4, bei
  // freien Schlüsseln Nr. 4 und 5), wo Mietfuchs ihn nicht rechnet; `null`: nicht bestätigt.
  infoComparisonSource: string | null
  // Vorrat (Heizung PR 8, Entwurf 5.3, 8.2): Einheit, Anfangsbestand mit Wert, kg und CO₂-Kosten, ob
  // er vor dem 01.01.2023 in Rechnung gestellt wurde, Endbestand und Tag der Peilung. Eingetragen wird
  // der Anfangsbestand nur in der ersten Heizperiode mit Vorrat; danach ist er der Endbestand der
  // Vorperiode.
  stockUnit: StockUnit | null
  openingQuantity: number | null
  openingCostCents: number | null
  openingEmissionsKg: number | null
  openingCo2Cents: number | null
  openingInvoicedBefore2023: boolean | null
  // Schon mit einer früheren Abrechnung umgelegt (nach Lieferung, vor dem ersten Vorrat): Dann zählt
  // der Anfangsbestand mit 0 € und ohne CO₂-Kosten, seine kg zählen für die Einstufung. `null`: keine
  // Antwort; dann gilt „ja“, wenn die Vorperiode Brennstoff dieser Anlage abgerechnet hat.
  openingAlreadySettled: boolean | null
  closingQuantity: number | null
  closingMeasuredOn: string | null
}

// Ein Wert eines Ablesedienstes für eine Wohnung und einen Nutzungszeitraum (Heizung PR 12, Entwurf
// 5.6). `heatValue` sind bewertete Einheiten für die Heizung, `waterValue` für das Warmwasser (optional:
// ohne ihn zählen die Warmwasserzähler). Die Grenzen gelten einschließlich. `heatUnit`: worin der Dienst
// die Heizung nennt, bewertete Einheiten (Heizkostenverteiler) oder kWh (Wärmezähler); das Warmwasser in m³.
export type ServiceHeatUnit = 'units' | 'kWh'
export type HeatingServiceValue = { plantId: string; period: PeriodKey; unitId: string; from: string; to: string; heatValue: number; waterValue: number | null; heatUnit: ServiceHeatUnit }

// Ein Heizkostenverteiler im Ausweis (Heizung PR 12, Entwurf 8.8): abgelesene Einheiten in der
// Heizperiode, Skala, Faktor und die bewerteten Einheiten, mit denen verteilt wird.
// `userKeys`, `from`, `to` (Durchsicht von #241, Recht-I1): der Nutzer bzw. die Gruppe nach § 9b Abs. 3 und
// ihr Zeitraum; jeder Mieter bekommt nur seine Zeilen.
export type HcaDeviceLine = { unitId: string; meterId: string; name: string; scale: HcaScale; factor: number; raw: number; rated: number; userKeys: string[]; from: string; to: string }

// ---------- Warmwasser ohne Wärmezähler (Heizung PR 11, Entwurf 8.3, #211) ----------

// Die Zeile der Heizwerttabelle des § 9 Abs. 3 HeizkostenV, nach der ein Brennstoff ohne Heizwert auf
// der Rechnung hilfsweise bewertet wird. Die Tabelle unterscheidet feiner als der Energieträger der
// Anlage (Erdgas H oder L, leichtes oder schweres Heizöl, drei Kohlen, Brennholz oder Hackschnitzel);
// deshalb wählt der Vermieter die Zeile an der Lieferung.
export type FuelGrade =
  | 'heatingOilEL' | 'heavyFuelOil' | 'naturalGasH' | 'naturalGasL' | 'lpg' | 'coke' | 'lignite' | 'hardCoal'
  | 'firewood' | 'woodPellets' | 'woodChips'
// Erzeugt die Anlage die Wärme allein (ein Kessel, eine Wärmepumpe, Fernwärme) oder zusammen mit einem
// zweiten Erzeuger (Solaranlage, Heizstab, zweiter Kessel)? § 9 Abs. 1 Satz 5 und Abs. 2 Satz 6 Nr. 3
// HeizkostenV („monovalente Wärmepumpe“). `null` heißt: nicht beantwortet.
export type HeatGeneration = 'single' | 'mixed'
// Liefert die Wärmepumpe mehr als die Hälfte der Wärme des Gebäudes? Nur für Abrechnungszeiträume, die vor
// dem 01.10.2024 beginnen (§ 11 Abs. 1 Nr. 3 Buchst. a HeizkostenV a. F.). `null` heißt: nicht beantwortet.
export type HeatPumpMajority = 'yes' | 'no' | 'unknown'
// Die Einheit eines Heizwerts und einer Brennstoffmenge im Sinne des § 9 Abs. 3.
export type HeatingValueUnit = 'l' | 'm3' | 'kg' | 'srm'
export type HeatingValueRow = { readonly kwh: number; readonly per: HeatingValueUnit }
// Die Heizwerttabelle einer Fassung: die Einheiten, in denen § 9 Abs. 3 Satz 1 den
// Brennstoffverbrauch bestimmt, und je Zeile Heizwert und Einheit. Schlüssel sind `FuelGrade`.
export type HeatingValueTable = {
  readonly units: readonly HeatingValueUnit[]
  readonly values: { readonly [grade: string]: HeatingValueRow }
}
// Ein Heizwert, mit dem der Warmwasseranteil gerechnet wurde: laut Rechnung oder hilfsweise aus der
// Tabelle des § 9 Abs. 3 HeizkostenV.
export type DhwHeatingValue = { label: string; kwh: number; per: HeatingValueUnit; source: 'invoice' | 'table'; grade: FuelGrade | null }
// Womit ein Formelwert umgerechnet wurde (§ 9 Abs. 2 Satz 6 Nr. 1 bis 3).
export type DhwFactorKind = 'gasCalorific' | 'heatSupply' | 'heatPump'
// Wogegen die Wärme für das Warmwasser gestellt wurde: Brennstoff in kWh laut Rechnung, Brennstoff als
// Menge (B = Q / Hᵢ), gelieferte Wärme (Fernwärme), Strom (Wärmepumpe mit Formel, Stromheizung
// gemessen), gemessene Gesamtwärme.
export type DhwDenominator = 'fuelKwh' | 'fuelQuantity' | 'deliveredHeat' | 'electricity' | 'measuredTotalHeat'
// Der Warmwasseranteil α einer Anlage in einer Heizperiode samt Rechenweg (Entwurf 8.3, 8.8 „α mit
// Methode“). `heatKwh` ist Q, wie es in den Bruch eingeht (bei einer Formel nach dem Faktor),
// `formulaKwh` das Ergebnis der Zahlenwertgleichung davor.
export type DhwStatement = {
  method: DhwMethod
  alpha: number
  heatKwh: number
  formulaKwh: number | null
  factor: { kind: DhwFactorKind; value: number } | null
  denominator: { kind: DhwDenominator; value: number; unit: 'kWh' | HeatingValueUnit }
  // Die Energie des Nenners in kWh, auch bei Brennstoff als Menge (Menge · Heizwert); für `self.alpha`
  // (PR 10: `referenceKwh`).
  energyKwh: number
  fuelForDhw: { quantity: number; unit: HeatingValueUnit; heatingValue: number } | null
  heatingValues: DhwHeatingValue[]
  // α beruht auf der Schätzung beim Abschluss (PR 7, PR 10 Abweichung 11).
  estimated: boolean
  steps: string[]
}

// Eine Heizposition, die beim Anlegen der Anlage zugeordnet werden kann (Vorschau, 11.2).
export type AssignableHeatingItem = Pick<CostItem, 'id' | 'period' | 'description' | 'amountCents'>

// ---------- Eigene Heizperiode und getrennte Heizkostenabrechnung (Heizung PR 5) ----------

// Ein Zeitraum, in dem die Heizkosten einer Anlage getrennt abgerechnet werden (Weg d, Entwurf 3.1).
// `from` ist der Monat X ('JJJJ-MM'), ab dem die Heizstaffel der getrennten Abrechnung gehört;
// `until` die erste Heizperiode, die wieder in der Gesamtabrechnung steht (W), `null` heißt: bis auf
// Weiteres. Getrennt abgerechnet wird jede Heizperiode, die in diese Spanne reicht und kein
// Abrechnungszeitraum des Objekts ist (`settledSeparately` in shared/heatingPeriod.ts). Gespeichert,
// weil Ein- und Ausschalten nicht rückwirkend wirken dürfen (C3, D1).
export type SeparateSpan = { from: string; until: PeriodKey | null }

// Die Korrektur der Heizvorauszahlung einer Heizperiode (Entwurf 3.1, D2 der achten Fassung).
// Endgültig (`provisional` false, ohne Monate) ersetzt sie die Anrechnung der ganzen Heizperiode;
// vorläufig gilt sie nur für die Monate `fromMonth` bis `toMonth`, die übrigen rechnen nach der
// Staffel. Eine vorläufige entsteht beim Aufteilen der Korrektur eines Abrechnungszeitraums und wird
// beim Abrechnen der Heizperiode durch die endgültige ersetzt.
export type HeatingPrepaymentOverride = {
  plantId: string
  period: PeriodKey
  cents: number
  provisional: boolean
  fromMonth: string | null
  toMonth: string | null
}

export type HeatingPeriodRef = { plantId: string; period: SettlementPeriod }
export type SeparateHeatingRef = { plantId: string; plantName: string; period: SettlementPeriod; deadline: string }
export type HeatingScopeRef = { kind: 'heating'; plantId: string; plantName: string }
// Eine Heizkostenabrechnung nach Weg d in der Liste für Cockpit und Abrechnungsseite (Heizung PR 5).
export type HeatingSettlementInfo = SeparateHeatingRef & { closed: { closedAt: string; sentAt: string | null } | null }

// ---------- CO₂ (Heizung PR 6, Entwurf 5.5, 7, 9.5) ----------

// Wie die CO₂-Kosten in der Heizkostenabrechnung stehen. `serviceDeducted`: Der Messdienst hat den
// Anteil des Vermieters in der Kostenaufstellung abgezogen („Abzüglich CO₂-Kosten Vermieter“);
// `serviceShown`: nur ausgewiesen; `selfAfterService`: gar nicht aufgeteilt; `self`: Mietfuchs teilt
// selbst auf (PR 7).
export type Co2Method = 'serviceDeducted' | 'serviceShown' | 'selfAfterService' | 'self'

// Ein Betrag „vom Vermieter übernommen“ laut Messdienst, je Mietverhältnis.
export type Co2TenantRelief = { tenancyId: string; cents: number }

// Die CO₂-Angaben einer Heizperiode. Die Felder `service*` stehen so in der Abrechnung des
// Messdienstes oder der Gemeinschaft. S (`serviceUsersTotalCents`) ist die gedruckte Zeile der zu
// verteilenden Kosten Heizung und Warmwasser, beim Vorwegabzug also nach dem Abzug (G-B3);
// `serviceUsersTotalApprox`: Die Zeile war nicht zu finden, S ist die Summe der Einzelbeträge
// aller Nutzeinheiten (Entwurf 7.3, R6). L ist `serviceLandlordCents`, L_self
// `serviceSelfLandlordCents`, G und V `serviceFuelGrossCents` und `serviceFuelNetCents`.
export type Co2Statement = {
  heatingPeriodId: string
  plantId: string
  period: PeriodKey
  method: Co2Method
  areaM2: number | null
  serviceEmissionsKg: number | null
  serviceAreaM2: number | null
  serviceKgPerM2: number | null
  serviceLandlordPermille: number | null
  serviceTotalCents: number | null
  serviceLandlordCents: number | null
  serviceUsersTotalCents: number | null
  serviceUsersTotalApprox: boolean
  serviceUnitsCount: number | null
  serviceCostItemId: string | null
  serviceSelfLandlordCents: number | null
  serviceFuelGrossCents: number | null
  serviceFuelNetCents: number | null
  reliefs: Co2TenantRelief[]
}

// Eine Zeile des Ausweises je Mieter: „vom Vermieter übernommen“ und „in Ihren Heizkosten
// enthalten“. `approximated`: nach dem Anteil an den Messdienstbeträgen gerechnet, weil die
// Abrechnung keinen Wert je Mieter nennt; `tenantCents` ist null ohne die CO₂-Kosten insgesamt.
// `tenantApproximated`: der Anteil des Mieters ist genähert ((C − L) · x / S); `false` heißt aus dem
// Betrag laut Messdienst berechnet (r · (1000 − ‰) / ‰), wegen des gerundeten r ebenfalls nicht
// centgenau. Ohne Angabe (ältere abgeschlossene Abrechnung) gilt er als genähert.
export type Co2TenantLine = { tenancyId: string; landlordCents: number; tenantCents: number | null; approximated: boolean; tenantApproximated?: boolean }

// Die Stufe als Spanne, für den Druckblock: von `from` bis unter `to` kg je m² (ohne `to`: ab).
export type Co2StageRange = { from: number; to: number | null; landlordPercent: number }

// Was die Abrechnung zur CO₂-Aufteilung einer Heizperiode weiß (Entwurf 9.5). `booked`: die
// Aufteilung ist gebucht (Probe bestanden oder S geschätzt); `deducted`: beim Messdienst schon
// abgezogen. `stage` ist die Stufe, in die Mietfuchs den Wert laut Messdienst einordnet, `table`
// die Tabelle (bei kurzer Heizperiode mit gekürzten Grenzen, `shortened`).
// Was die Einstufung bei der eigenen Aufteilung verändert hat (Heizung PR 7): § 8 (Nichtwohngebäude,
// 500 ‰ statt der Stufe), § 9 Abs. 1 (halber Anteil) und § 9 Abs. 2 (keine Aufteilung).
export type Co2Adjustment = 'nonResidential' | 'restrictionHalf' | 'restrictionNone'

export type Co2Assessment = {
  method: Co2Method
  booked: boolean
  deducted: boolean
  totalCents: number | null
  landlordCents: number | null
  landlordPermille: number | null
  kgPerM2: number | null
  emissionsKg: number | null
  areaM2: number | null
  stage: Co2StageRange | null
  table: Co2StageRange[]
  shortened: boolean
  // Passt der Anteil laut Abrechnung zur Stufe des Werts (Nachstufung, Entwurf 9.2)? `null`: nicht zu
  // prüfen. Optional, weil eine vorher abgeschlossene Abrechnung es nicht kennt.
  stageMatches?: boolean | null
  selfLandlordCents: number | null
  selfApproximated: boolean
  tenants: Co2TenantLine[]
  // Woher die Angaben stammen (Heizung PR 7): laut Messdienst oder von Mietfuchs aus den Lieferungen,
  // dann mit der Abdeckung der Heizperiode durch die Rechnungen in Promille der Gradtage. Fehlt das
  // Feld (vor PR 7 abgeschlossen), sind es Angaben laut Messdienst.
  // `stock`: aus der Bestandsrechnung des Vorrats (Heizung PR 8).
  basis?: 'service' | 'deliveries' | 'stock'
  coveragePermille?: number | null
  // Bei der eigenen Aufteilung: § 8 und § 9, und woher die Fläche der Einstufung stammt (eingetragen
  // oder die Wohnfläche der versorgten Wohnungen, Entwurf 9.2, 9.5).
  adjustments?: Co2Adjustment[]
  areaSource?: 'entered' | 'served'
  // `building`: die gemeinsame Fläche mehrerer Anlagen eines Gebäudes (§ 5 Abs. 1 Satz 2 CO2KostAufG);
  // `plant`: die der Anlage. Fehlt in einer vorher abgeschlossenen Abrechnung.
  areaScope?: 'plant' | 'building'
}

// Eine Heizanlage in einer Abrechnung, mit der Heizperiode, die darin abgerechnet wird.
export type HeatingStatement = {
  plantId: string
  plantName: string
  energy: HeatingEnergy
  period: PeriodKey
  from: string
  to: string
  co2: Co2Assessment | null
  // Lieferungen, Abgrenzung, Überträge und Lücken dieser Heizperiode (Heizung PR 7); fehlt ohne Lieferungen.
  fuel?: FuelAssessment
  // Die Bestandsrechnung dieser Heizperiode (Heizung PR 8). Sie friert mit dem Abschluss ein; die
  // Folgeperiode liest daraus ihren Anfangsbestand, die Vorperiode ihren Endbestand (G-A4). Fehlt
  // sie, gibt es keinen Vorrat oder er ließ sich nicht rechnen.
  stock?: HeatingStockStatement | null
  // Die eigene Heizkostenabrechnung dieser Heizperiode (Heizung PR 10), nur bei `method = 'self'`.
  self?: SelfHeatingStatement
  // Die Informationen nach § 6a (Heizung PR 14), bei eigener Abrechnung und bei freien Schlüsseln (dort ohne
  // die Vergleiche); nicht beim Messdienst, bei einer Etagenheizung und wenn Wärme und Warmwasser nach § 11
  // ausgenommen sind. Nach einem Kesseltausch einmal je Linie. Fehlt in älteren Abrechnungen.
  info?: HeatingInfoStatement
  // Die Prüfung der CO₂-Angaben nach dem CO2KostAufG (Heizung PR 17, #246): ob das Gesetz für diese Heizperiode
  // gilt (`applies`; nicht bei Wärme aus dem Emissionshandel mit Anschluss nach dem Stichtag, § 2 Abs. 4 Satz 2,
  // und nicht unter einer Ausnahme nach § 11 HeizkostenV für Wärme und Warmwasser ohne vereinbarte Abrechnung,
  // § 2 Abs. 7), die Ausnahme im Wortlaut der Abrechnung (`exemption`) und die Befunde je Rechnung. Anzeige und
  // Blatt für den Messdienst lesen sie von hier. Fehlt in älteren Abrechnungen.
  co2Check?: { applies: boolean; exemption: string | null; findings: { deliveryId: string; texts: string[] }[] }
}

// Was die Seite Heizkosten zu einer Heizperiode lädt (Heizung PR 6): die Angabe zum Warmwasser, die
// CO₂-Angaben und die Positionen der Anlage in dieser Heizperiode für die Probe.
export type HeatingPeriodView = {
  plantId: string
  period: PeriodKey
  label: string
  from: string
  to: string
  short: boolean
  closed: boolean
  hotWater: Pick<HeatingPeriodData, 'dhwMethod' | 'dhwUnmeasurable' | 'dhwHeatKwh' | 'totalHeatKwh' | 'dhwVolumeM3' | 'dhwTempC'>
  // Für die Formeln (Heizung PR 11): Σ der Warmwasserzähler der angeschlossenen Wohnungen in der
  // Heizperiode als Vorschlag für V (null ohne solche Zähler) und die mit Warmwasser versorgte Fläche.
  // Beim Kesseltausch (Durchsicht von #240) gelten Vorschlag und Beschriftung der Laufzeit der Anlage
  // (`running`, sonst null); fehlt ein Stand, sagt `volumeMissing`, welcher.
  hotWaterBasis: { volumeFromMetersM3: number | null; volumeMissing: string | null; running: { from: string; to: string } | null; suppliedAreaM2: number }
  co2: Co2Statement | null
  items: Pick<CostItem, 'id' | 'description' | 'amountCents' | 'key' | 'tenancyAmounts' | 'selfAmounts' | 'fuelDeliveryId'>[]
  // Der Vorrat dieser Heizperiode (Heizung PR 8); `null` bei einer Anlage ohne Vorratsenergie.
  stock: StockView | null
  // Anteil nach Verbrauch dieser Heizperiode (Heizung PR 10), nur bei `method = 'self'`.
  distribution?: HeatingDistribution | null
  // Heizung PR 12: womit der Verbrauch in dieser Heizperiode erfasst wird (`null` ohne eigene Abrechnung) und
  // die Werte des Ablesedienstes dieser Heizperiode (leer bei anderer Erfassung).
  capture?: CaptureMethod | null
  serviceValues?: HeatingServiceValue[]
  // Die Warmwasserbereitung dieser Heizperiode bei eigener Abrechnung (Durchsicht von #241, I2), sonst `null`.
  selfHotWater?: HotWater | null
  // Heizung PR 14: die Eingaben zu § 6a dieser Heizperiode (eigene Zeile), die geltenden Angaben zu § 11, § 2,
  // monatlicher Information und Verbrauchervertrag und die Antworten der eigenen Zeile (`null`: keine).
  info: HeatingInfoInputs
  rules: HeatingRules
  ownRules: Pick<HeatingPeriodData, 'exemption' | 'exemptionScope' | 'exemptionBillingAgreed' | 'agreedOtherwise' | 'monthlyInfoElsewhere' | 'consumerContract'>
  // Durchsicht von #243: bereitet die Anlage Warmwasser (R-K6), und erlaubt das Haus eine Vereinbarung nach § 2 (R-K7)?
  centralHotWater: boolean
  agreeable: boolean
}

// ---------- Brennstofflieferungen (Heizung PR 7, Entwurf 5.4, 8.2) ----------

export type FuelQuantityUnit = 'l' | 'kg' | 'm3' | 'kWh' | 'srm'
// Gas nach Brennwert (Hₛ) oder Heizwert (Hᵢ) abgerechnet.
export type GasBasis = 'hs' | 'hi'
// § 9 CO2KostAufG: Vorgaben stehen einer Verbesserung des Gebäudes, der Wärmeversorgung oder beidem entgegen.
export type Co2Restriction = 'none' | 'building' | 'supply' | 'both'

// Eine Teilmenge laut Rechnung (Stufe 3 in 3.2): ein Teilzeitraum mit eigener Menge und eigenem Betrag,
// etwa bei einer Preisänderung. `fixedCents` ist sein fester Preisbestandteil.
export type FuelDeliveryPart = {
  from: string
  to: string
  energyKwh: number | null
  amountCents: number
  fixedCents: number | null
  emissionsKg: number | null
  co2CostCents: number | null
}

// Eine Rechnung des Versorgers an der Heizanlage. `amountCents` steht nur bei einer Anlage mit
// Messdienst (dort zeigt keine Position auf die Lieferung) und bei einer Schätzung; sonst ist der Betrag
// die Summe der verknüpften Positionen. `sharePermille` ist ein eingetragener Anteil des
// verbrauchsabhängigen Teils an der Heizperiode, in der die Rechnung endet (Stufe 0). `estimated`:
// beim Abschluss geschätzt, weil die Rechnung fehlte (8.2). `usedByService`: der Messdienst hat die
// Rechnung in seinen Brennstoffkosten angesetzt (7.6).
export type FuelDelivery = {
  id: string
  plantId: string
  label: string
  invoiceDate: string | null
  deliveredAt: string | null
  invoiceFrom: string | null
  invoiceTo: string | null
  unitId: string | null
  amountCents: number | null
  quantity: number | null
  quantityUnit: FuelQuantityUnit | null
  energyKwh: number | null
  gasBasis: GasBasis | null
  heatingValue: number | null
  // Die Zeile der Heizwerttabelle (§ 9 Abs. 3 HeizkostenV), falls die Rechnung keinen Heizwert nennt
  // (Heizung PR 11). Der Heizwert laut Rechnung geht vor.
  fuelGrade: FuelGrade | null
  emissionsKg: number | null
  co2CostCents: number | null
  emissionFactor: number | null
  gridFeeCents: number | null
  bioCostCents: number | null
  sharePermille: number | null
  fixedCents: number | null
  estimated: boolean
  usedByService: boolean
  parts: FuelDeliveryPart[]
}

// Das Blatt „CO₂-Angaben für den Messdienst“ (Heizung PR 17, #210): je Rechnung, die die Heizperiode
// berührt, die Angaben des § 3 Abs. 1 Nr. 1–4 CO2KostAufG samt Menge, Zeitraum, Rechnungsdatum und Betrag,
// und die Hinweise der Plausibilitätsprüfung als fertige Sätze. Abgegrenzt wird nicht: Der Messdienst
// rechnet über seinen Zeitraum selbst.
export type Co2SheetDelivery = {
  id: string
  label: string
  invoiceDate: string | null
  from: string | null
  to: string | null
  deliveredAt: string | null
  quantity: number | null
  quantityUnit: FuelQuantityUnit | null
  energyKwh: number | null
  gasBasis: GasBasis | null
  emissionFactor: number | null
  emissionsKg: number | null
  co2CostCents: number | null
  amountCents: number | null
  estimated: boolean
  // Was davon in der Summe zählt (Durchsicht von #246, G-W1), nach denselben Regeln wie die Abrechnung:
  // `full` kg und CO₂-Kosten, `partial` beides mit `factor` (eine Schätzung für die Tage ohne Rechnung),
  // `kgOnly` nur die kg (§ 11 Abs. 2 Satz 2), `none` nichts (storniert, abgedeckte Schätzung). `note` sagt
  // es in der dritten Person, für den Empfänger des Blatts.
  counted: 'full' | 'partial' | 'kgOnly' | 'none'
  factor: number
  note: string | null
  // Der Teil dieser Rechnung, den die Abrechnung der Heizperiode zuordnet (`fuel.deliveries`), mit Anteil in
  // Promille und Verfahren; `null` ohne Abgrenzung (Vorrat, Messdienst ohne Lieferzeilen).
  inPeriod: { emissionsKg: number | null; co2Cents: number | null; sharePermille: number; method: FuelMethod } | null
  findings: string[]
}
export type Co2SheetStock = Pick<HeatingPeriodData, 'stockUnit' | 'openingQuantity' | 'openingEmissionsKg' | 'openingCo2Cents' | 'openingInvoicedBefore2023' | 'openingAlreadySettled' | 'closingQuantity' | 'closingMeasuredOn'>
// Der Anfangsbestand als Zeile des Blatts (G-W2): seine kg zählen immer, seine CO₂-Kosten nur, wenn er
// nicht vor 2023 in Rechnung gestellt und nicht schon umgelegt wurde.
// Seit der Nachprüfung von #246 (O2a/O2b) die Entscheidung der Bestandsrechnung der Abrechnung: `co2CostCents`
// sind die dort berücksichtigten CO₂-Kosten; rechnet die Abrechnung den Vorrat nicht, die eingetragenen.
// `co2CostCents` ist der Betrag laut Rechnung bzw. Eintrag (wie bei den Rechnungen), `countedCents` der davon
// berücksichtigte Teil (Durchsicht von #246, Runde 3, S-K1). `adminNote`: die genauen Gründe einer
// unvollständigen Bestandsrechnung für den Vermieter, nicht gedruckt (W-N4).
export type Co2SheetOpening = {
  quantity: number | null
  emissionsKg: number | null
  co2CostCents: number | null
  countedCents: number
  kgCounted: boolean
  co2Counted: boolean
  note: string | null
  adminNote: string | null
  // `entered`: in dieser Heizperiode eingetragen; `carried`: aus dem Endbestand der Vorperiode übernommen,
  // dann gibt es keine Rechnung, und die CO₂-Kosten sind die übernommenen (Runde 4, S-K1).
  source: 'entered' | 'carried'
}
// Was die Abrechnung der Heizperiode daraus macht (Durchsicht von #246, Runde 3, S-W1): gelesen aus ihrem
// Ergebnis (`heating[]`), nicht vom Blatt gerechnet. `closing`/`consumed` aus der Bestandsrechnung des
// Vorrats, `inPeriod` die Summe der auf die Heizperiode abgegrenzten Rechnungen (`fuel.deliveries`) samt
// Abdeckung, `basis` die Grundlage der CO₂-Aufteilung mit kg/m² und Stufe (`co2`). Jede Angabe fehlt, wo
// die Abrechnung sie nicht hat.
export type Co2SheetBilling = {
  closing: { quantity: number; emissionsKg: number; co2Cents: number; measuredOn: string | null } | null
  consumed: { quantity: number; emissionsKg: number; co2Cents: number } | null
  inPeriod: { emissionsKg: number; co2Cents: number; coveragePermille: number } | null
  basis: {
    source: 'stock' | 'deliveries'
    emissionsKg: number | null
    co2Cents: number | null
    kgPerM2: number | null
    areaM2: number | null
    landlordPermille: number | null
    stage: Co2StageRange | null
  } | null
}
// `areaM2`: die Fläche der Einstufung, eingetragen (`entered`) oder die Wohnfläche der Wohnungen, die die
// Anlage versorgt (`served`); `null`, wenn keine bekannt ist.
export type Co2Sheet = {
  propertyName: string
  address: string
  landlordName: string
  plantName: string
  energy: HeatingEnergy
  period: { key: string; from: string; to: string }
  areaM2: number | null
  // `building`: die gemeinsame Fläche mehrerer Anlagen eines Gebäudes, wie die Abrechnung sie einstuft.
  areaSource: 'entered' | 'served' | 'building' | null
  nonResidential: boolean
  restriction: Co2Restriction
  districtEtsNew: boolean
  stock: Co2SheetStock | null
  opening: Co2SheetOpening | null
  billing: Co2SheetBilling
  deliveries: Co2SheetDelivery[]
  totals: { emissionsKg: number; co2CostCents: number }
  // Der Tag, an dem das Blatt erstellt wurde (R-K6), und ob geprüft wurde: nicht bei Wärme aus dem
  // Emissionshandel mit Anschluss nach dem Stichtag (§ 2 Abs. 4 Satz 2, R-W1).
  createdOn: string
  checked: boolean
  // Die Ausnahme nach § 11 HeizkostenV, unter der das CO2KostAufG nicht gilt (§ 2 Abs. 7), im Wortlaut der
  // Abrechnung (`co2Check.exemption`); `null` sonst.
  exemption: string | null
}

// Eine Gradtagzahl des Deutschen Wetterdienstes für den Ort des Objekts und einen Monat ('JJJJ-MM').
export type DegreeDayValue = { month: string; value: number }

// Was eine abgeschlossene Heizperiode je Lieferung herein- (+) oder hinausgebucht (−) hat, dazu Ausstoß
// und CO₂-Kosten dieser Lieferung in der Heizperiode (G-A4).
export type FrozenFuelCarry = { deliveryId: string; plantId: string; period: PeriodKey; cents: number; emissionsKg: number; co2Cents: number }

// Wie der Teil einer Lieferung bestimmt ist (Stufen in 3.2).
export type FuelMethod = 'entered' | 'measured' | 'inside' | 'parts' | 'localDegreeDays' | 'degreeDays'

// Eine Lieferung in der Bewertung einer Heizperiode: ihr Anteil am Verbrauch (‰), ob sie geteilt ist,
// ihr Betrag und der Teil dieser Heizperiode, Ausstoß und CO₂-Kosten darin.
export type FuelDeliveryLine = {
  deliveryId: string
  label: string
  from: string | null
  to: string | null
  estimated: boolean
  method: FuelMethod
  sharePermille: number
  fixedKnown: boolean
  split: boolean
  amountCents: number | null
  inPeriodCents: number | null
  emissionsKg: number | null
  co2Cents: number | null
  // Energie in der Heizperiode in kWh, wie abgerechnet (Heizung PR 10); `null` ohne Angabe.
  energyKwh: number | null
}

// Ein Übertrag der Mieterseite dieser Heizperiode aus oder in die Heizperiode `period`.
// `totalCents`: die Summe der Positionen der Rechnung, aus der der Übertrag gerechnet ist (Nachprüfung von
// 47f2373: Wird sie nach dem Abschluss storniert, nennt die andere Heizperiode, was die Mieter zu viel trugen).
// `landlordBorne`: Der hinausgebuchte Teil steht beim Vermieter (`fuelClosedPeriod`), weil die andere Heizperiode
// beim Abschluss schon ohne ihn abgeschlossen war; sie hat ihn also nie hereingebucht, und eine Gegenbuchung
// dort gäbe es zweimal (Invariante, Startwert 509).
export type FuelCarryLine = { deliveryId: string; period: PeriodKey; cents: number; totalCents?: number; landlordBorne?: true }

// Der Vorschlag einer geschätzten Lieferung für eine Lücke (8.2 Nr. 2), aus der letzten Rechnung.
export type FuelEstimateProposal = {
  from: string
  to: string
  amountCents: number
  emissionsKg: number | null
  co2CostCents: number | null
  // kWh im selben Verhältnis (Heizung PR 10, Abweichung 11); `null`, wenn die Vorlage keine nennt.
  energyKwh: number | null
  basedOn: string
  byMeter: boolean
  // Der Anteil der Rechnung `basedOn`, der für die Lücke angesetzt ist, in Promille (Durchsicht von #233,
  // Recht I2: Die Abrechnung nennt die Grundlage der Schätzung).
  factorPermille: number
}

// `zeroInvoices`: Rechnungen im Zeitraum der Lücke, deren Positionen zusammen 0 € ergeben (als storniert behandelt).
export type FuelGap = { from: string; to: string; days: number; permille: number; estimate: FuelEstimateProposal | null; zeroInvoices?: string[] }

export type FuelAssessment = {
  coveragePermille: number
  emissionsKg: number | null
  co2Cents: number | null
  deliveries: FuelDeliveryLine[]
  carries: FuelCarryLine[]
  gaps: FuelGap[]
  // Lieferungen, deren Positionen zusammen 0 € ergeben (als storniert behandelt) und die die Heizperiode
  // berühren. Eingefroren sagt das einer anderen Heizperiode, dass die Rechnung beim Abschluss verknüpft, aber
  // storniert war, und nicht unverknüpft (Runde 2 zu Startwert 515). Fehlt das Feld, gab es keine.
  zeroInvoiceIds?: string[]
}

// Die Rückfrage beim Abschluss (8.2, Dialog „Trotzdem abschließen?“).
// `deadline`: bis wann die Abrechnung, die abgeschlossen werden soll, den Mietern zugehen muss (Abwarten).
export type FuelGapQuestion = { plantId: string; plantName: string; period: PeriodKey; from: string; to: string; amountCents: number; deadline: string; zeroInvoices?: string[] }

// ---------- Brennstoffvorrat (Heizung PR 8, Entwurf 5.3, 8.2) ----------

// Die Einheit eines Vorrats: Liter (Heizöl, Flüssiggas), Kilogramm (Flüssiggas, Pellets, Holz, Kohle),
// Schüttraummeter (Holzhackschnitzel).
export type StockUnit = 'l' | 'kg' | 'srm'

// Ein Teil eines Vorrats mit seiner Herkunft. `costCents` null: Der Betrag ist unbekannt (Messdienst
// ohne Rechnungsbetrag). `co2Counted` false: in Rechnung gestellt vor dem 01.01.2023; die kg zählen,
// die CO₂-Kosten nicht (§ 11 Abs. 2 Satz 2 CO2KostAufG). `co2Cents` ist der Betrag laut Rechnung.
export type StockLayer = {
  label: string
  date: string | null
  quantity: number
  costCents: number | null
  emissionsKg: number
  co2Cents: number
  co2Counted: boolean
}

// Ein bewerteter Bestand, zusammen und je Teil. `co2Cents` zählt nur die berücksichtigten CO₂-Kosten;
// `costCents` ist null, wenn ein Teil keinen Betrag hat.
export type StockValue = {
  quantity: number
  costCents: number | null
  emissionsKg: number
  co2Cents: number
  layers: StockLayer[]
}

// Die Bestandsrechnung einer Heizperiode.
export type HeatingStockStatement = {
  unit: StockUnit
  opening: StockValue
  // Woher der Anfangsbestand kommt: eingetragen (erste Heizperiode mit Vorrat), aus dem Endbestand
  // der offenen Vorperiode oder aus dem eingefrorenen einer abgeschlossenen.
  openingSource: 'own' | 'previous' | 'frozen'
  deliveries: StockLayer[]
  closing: StockValue
  // Der Endbestand ist der eingefrorene Anfangsbestand der abgeschlossenen Folgeperiode (G-A4).
  closingFrozen?: boolean
  // Was diese Heizperiode an die nächste weitergibt: der Endbestand, wenn sie ihn als „im Vorrat“
  // gutschreibt; sonst (Verteilung nach Lieferung, ohne Schlüssel) derselbe Bestand mit 0 € und ohne
  // CO₂-Kosten, denn die Mieter haben ihn dann schon bezahlt (Befunde C1, I1 der Durchsicht von #237).
  // Fehlt das Feld (ältere Stände), ist es der Endbestand.
  handover?: StockValue
  // Der eingetragene Anfangsbestand war schon umgelegt und zählt mit 0 €; hier sein Wert laut Eintrag,
  // und ob der Vermieter es angegeben hat oder Mietfuchs es nach der Vorperiode annimmt.
  openingSettledCents?: number | null
  // `defaultLoose`: vorbelegt nur nach Heizpositionen ohne Kennzeichen „Brennstoff“ (Nachprüfung von 7ce5958).
  openingSettledSource?: 'entered' | 'default' | 'defaultLoose'
  closingMeasuredOn: string | null
  consumed: { quantity: number; costCents: number | null; emissionsKg: number; co2Cents: number }
  // Σ der Lieferungen dieser Heizperiode; null, wenn eine keinen Betrag hat.
  paidCents: number | null
  // kg aus Brennstoff mit Rechnung vor dem 01.01.2023, die in dieser Heizperiode verbraucht wurden.
  oldStockKg: number
}

// Was die Karte „Vorrat“ zu einer Heizperiode lädt.
export type StockRow = Pick<
  HeatingPeriodData,
  'stockUnit' | 'openingQuantity' | 'openingCostCents' | 'openingEmissionsKg' | 'openingCo2Cents' | 'openingInvoicedBefore2023' | 'openingAlreadySettled' | 'closingQuantity' | 'closingMeasuredOn'
>
export type StockView = {
  row: StockRow
  // Der Anfangsbestand aus der Vorperiode; dann ist keiner einzutragen. `frozen`: aus einer
  // abgeschlossenen Vorperiode.
  derived: { value: StockValue; period: PeriodKey; label: string; frozen: boolean } | null
  // Die Folgeperiode ist abgeschlossen und hat diesen Endbestand als Anfangsbestand übernommen;
  // dann ist der Endbestand gesperrt (G-A4).
  closingLockedBy: { period: PeriodKey; label: string } | null
  // Die Vorperiode hat Brennstoff dieser Anlage nach Lieferung abgerechnet (oder ist ohne Vorrat
  // abgeschlossen): Dann fragt die Karte, ob der Anfangsbestand schon umgelegt wurde (C1).
  askAlreadySettled: boolean
  // Die Vorbelegung des Servers ohne Antwort (Nachprüfung von 819398e): Nur bei `default` (ausdrücklich
  // Brennstoff in der Vorperiode) belegt die Karte „Ja“ vor; sonst bleibt die Auswahl leer und der Server
  // entscheidet nach der Schwelle.
  defaultAlreadySettled: 'default' | 'defaultLoose' | null
  statement: HeatingStockStatement | null
  // Bei einer abgeschlossenen Heizperiode die eingefrorene Bestandsrechnung, wie sie abgerechnet ist.
  frozen: HeatingStockStatement | null
  // Was fehlt oder nicht passt, als Satz für die Karte.
  problem: string | null
}

// ---------- Eigene Heizkostenabrechnung (Heizung PR 10, Entwurf 5.3, 8) ----------

export type HeatingTarget = 'both' | 'heating' | 'water'
export type HotWater = 'combined' | 'separate' | 'none'
export type CaptureMethod = 'heatMeter' | 'hca' | 'serviceValues'
export type AreaBasisHeat = 'area' | 'heatedArea'

// Antwort des Vermieters zur Zwischenablesung an einer Grenze (Entwurf 3.5): keine, weil „nicht
// möglich“ (§ 9b Abs. 3 Alt. 1) oder „nicht durchgeführt“; oder eine Ablesung ab der Warngrenze, die
// er nach § 9b Abs. 3 Alt. 2 als ungenau behandelt (`imprecise`) oder bewusst verwendet
// (`useReading`). `date` ist der letzte Tag des bisherigen Nutzers (Abweichungen 8 und 22 des Plans).
export type InterimGapStatus = 'impossible' | 'missed' | 'imprecise' | 'useReading'
export type InterimGap = { unitId: string; date: string; status: InterimGapStatus; reason: string }

// Der Anteil nach Verbrauch einer Heizperiode, wie ihn die Seite Heizkosten zeigt (§ 6 Abs. 4, § 7
// Abs. 1 Satz 2). `own`: eigene Zeile dieser Heizperiode; `effective`: was gilt, eigen oder aus der
// Vorperiode; `begun`: die Heizperiode hat begonnen, ein anderer Anteil ist gesperrt; `first`: es
// gibt noch keinen Anteil.
export type HeatingDistribution = {
  own: { heating: number | null; water: number | null; insulationRule: InsulationRule | null; above70Agreed?: boolean }
  // `water` ist null, wenn es kein zentrales Warmwasser gibt oder der Wert fehlt (§ 8 Abs. 1 verlangt
  // eine eigene Wahl, Abweichung 14).
  // `above70Agreed` (Heizung PR 14): mehr als 70 % nach Verbrauch sind vereinbart (§ 10).
  effective: { heating: number; water: number | null; insulationRule: InsulationRule | null; above70Agreed?: boolean } | null
  inherited: boolean
  begun: boolean
  first: boolean
  forcedPercent: number | null
}

export type SelfPot = 'heating' | 'water'
export type SelfRole = 'tenancy' | 'vacancy' | 'self' | 'outside'
// Ein Topf im Ausweis (Entwurf 8.8): Kosten, Anteil nach Verbrauch, Gesamteinheiten, Preis je
// Einheit. `byAreaOnly`: kein Verbrauch erfasst, nur nach Fläche verteilt.
export type SelfPotView = {
  pot: SelfPot
  costCents: number
  consumptionPct: number
  byAreaOnly: boolean
  areaM2: number
  consumption: number
  // Heizkostenverteiler und Ablesedienste zählen Einheiten, keine Kilowattstunden (Heizung PR 12).
  consumptionUnit: 'kWh' | 'm³' | 'Einheiten'
  baseCentsPerM2: number
  consumptionCentsPerUnit: number | null
  // Schätzung (Heizung PR 13): geschätzte Fläche des Topfs und ob sie die Grenze des § 9a Abs. 2
  // überschreitet; dann ist `consumptionPct` 0 und der Topf nur nach Fläche verteilt. Fehlen in einer
  // Abrechnung, die vor Heizung PR 13 abgeschlossen wurde.
  overThreshold?: boolean
  estimatedAreaM2?: number
  // Der Teil von `consumption`, der aus Schätzungen kommt (Durchsicht von #242, R-M9).
  estimatedConsumption?: number
}
// Eine Ablesung an einer Grenze: `date` null heißt, es gibt keine.
// `oldEndValue` (Durchsicht von #241, Recht-I2): bei einem Wechsel oder Stichtag an der Grenze der Stand davor; beim
// Heizkostenverteiler der Stichtagswert.
export type SelfReadingView = { meterId: string; meterName: string; pot: SelfPot; boundary: string; date: string | null; value: number | null; oldEndValue?: number }
// Eine Grenze einer Wohnung für die Ampel der Seite Heizkosten.
export type SelfBoundaryView = {
  date: string
  kind: 'start' | 'end' | 'change'
  status: 'read' | 'off' | 'missing'
  offDays: number
  // ab der Warngrenze neben dem Wechsel (`practice.reading-off-warning`); dann wählt der Vermieter
  far: boolean
  gap: InterimGapStatus | null
  // Der Grund, wenn die Zwischenablesung nicht möglich war (Durchsicht von #239, I3).
  gapReason?: string
}
// Ein Nutzer einer Wohnung (Mieter, Leerstand, Eigennutzung, außerhalb) mit seinen Werten.
export type SelfUserView = {
  key: string
  role: SelfRole
  tenancyId: string | null
  label: string
  from: string
  to: string
  days: number
  degreeDayPermille: number
  heatingConsumption: number | null
  waterConsumption: number | null
  heatingGroup: boolean
  waterGroup: boolean
  heatingCents: number
  waterCents: number
  // Der Teil seines CO₂-Abzugs, der auf den Topf entfällt (Abweichung 15): Topfbetrag nach Abzug =
  // heatingCents − heatingCo2Cents. 0 ohne Abzug.
  heatingCo2Cents: number
  waterCo2Cents: number
  // Der Verbrauch dieses Nutzers beruht auf einer Schätzung nach § 9a (Heizung PR 13).
  heatingEstimated?: boolean
  waterEstimated?: boolean
}
export type SelfUnitView = {
  unitId: string
  unitName: string
  areaM2: number
  heatAreaM2: number
  readings: SelfReadingView[]
  boundaries: SelfBoundaryView[]
  users: SelfUserView[]
}
export type SelfHeatingStatement = {
  ok: boolean
  // Die Erfassung der Heizperiode (Durchsicht von #242 Runde 3, N2-M1); fehlt in älteren Abrechnungen.
  capture?: CaptureMethod
  heatPump: 'applies' | 'notYet' | 'missing' | null
  changeSplit: ChangeSplit
  areaBasisHeat: AreaBasisHeat
  hotWater: HotWater
  alpha: { percent: number; dhwHeatKwh: number; referenceKwh: number; reference: 'fuel' | 'totalHeat'; estimated: boolean } | null
  // Der Rechenweg zum Warmwasseranteil (Heizung PR 11, Entwurf 8.8 „α mit Methode“); fehlt ohne α.
  dhw?: DhwStatement
  shares: { heating: number; water: number | null; forced: boolean; previous: { heating: number; water: number | null } | null; above70Agreed?: boolean } | null
  // Verteilt nach einer Vereinbarung nach § 2 HeizkostenV „nach Wohnfläche“ (Durchsicht von #243, G-W3).
  agreedArea?: true
  pots: SelfPotView[]
  units: SelfUnitView[]
  // Heizkostenverteiler je Gerät mit Skala und Faktor (Heizung PR 12, Entwurf 8.8) bzw. die Werte des
  // Ablesedienstes; nur bei dieser Erfassung.
  devices?: HcaDeviceLine[]
  serviceValues?: HeatingServiceValue[]
  // Schätzungen nach § 9a (Heizung PR 13), die Wohnungen und Töpfe, für die der Dialog eine anbietet, und
  // die Grenze des § 9a Abs. 2 (null, wenn nicht gefragt). Fehlen in einer Abrechnung, die vor Heizung PR 13
  // abgeschlossen wurde.
  estimates?: SelfEstimateView[]
  estimateOptions?: SelfEstimateOption[]
  threshold?: number | null
}

// ---------- Schätzung nach § 9a HeizkostenV (Heizung PR 13, Entwurf 5.6, 8.7) ----------

// Topf der Schätzung in der Schreibweise der Tabelle (Entwurf 5.6); die Rechnung nennt die Töpfe
// `heating` und `water` (shared/heating.ts ordnet zu).
export type EstimatePart = 'heat' | 'water'
// Die drei Wege des § 9a Abs. 1: Verbrauch der betroffenen Räume in vergleichbaren Zeiträumen,
// vergleichbarer anderer Räume im selben Zeitraum, Durchschnittsverbrauch des Gebäudes.
export type EstimateMethod = 'previousPeriod' | 'comparableUnit' | 'buildingAverage'
// Der Grund nach § 9a Abs. 1 Satz 1 (Durchsicht von #242, R-I1): Geräteausfall oder ein anderer zwingender Grund,
// aus dem der Verbrauch nicht ordnungsgemäß erfasst werden kann.
export type EstimateCause = 'deviceFailure' | 'wrongReading' | 'readingImpossible' | 'otherReason'
// Die Einheit des geschätzten Werts: die des Topfs bei der Erfassung, unter der geschätzt wurde.
export type EstimateValueUnit = 'kWh' | 'm³' | 'Einheiten'
// Eine Schätzung: der Verbrauch einer Wohnung in einem Topf für die ganze Heizperiode, in der Einheit
// der Erfassung (kWh, m³ oder Einheiten). Begründung ist Pflicht; `confirmed` heißt, der Vermieter hat
// bestätigt, dass der Verbrauch nicht ordnungsgemäß erfasst werden konnte. `capture` und `valueUnit`
// (Durchsicht von #242, G-I1): die Erfassung und Einheit beim Speichern; passt eine von beiden nicht mehr zur
// Heizperiode, rechnet Mietfuchs die Schätzung nicht (`heating.estimate-stale`).
export type HeatingEstimate = {
  plantId: string
  period: PeriodKey
  unitId: string
  part: EstimatePart
  value: number
  method: EstimateMethod
  reason: string
  confirmed: boolean
  cause: EstimateCause
  capture: CaptureMethod
  valueUnit: EstimateValueUnit
}
// Ein Vorschlag je Weg. `value` null mit Grund: keine Vorperiode, andere Länge, kein erfasster
// Verbrauch der übrigen Wohnungen.
export type EstimateProposal = { method: EstimateMethod; value: number | null; perM2: number | null; why: 'ok' | 'noPrevious' | 'lengthDiffers' | 'noMeasured' }
export type ComparableUnit = { unitId: string; unitName: string; perM2: number; value: number }
// Im Ausweis (Entwurf 8.8: „Schätzungen mit Methode“). `plantId`: die Anlage, an der die Schätzung steht (nach
// einem Kesseltausch auch die Vorgängerin der Linie); `users`: Zahl der Nutzer der Wohnung, deren Verbrauch
// aus der Schätzung kommt (mehr als einer heißt: wie nach § 9b Abs. 3 geteilt); `kept`: Zahl der Nutzer, die
// ihren abgelesenen Verbrauch behalten; `complete`: Die Ablesungen waren vollständig, die Schätzung ersetzt
// alle (`heating.estimate-complete`).
// `stale` (Durchsicht von #242, G-I1): eingetragen unter einer anderen Erfassung oder Einheit, wird nicht gerechnet.
export type SelfEstimateView = {
  plantId: string; unitId: string; unitName: string; part: EstimatePart; value: number; method: EstimateMethod; reason: string; confirmed: boolean
  cause: EstimateCause; capture: CaptureMethod; valueUnit: EstimateValueUnit
  users: number; kept: number; complete: boolean; stale?: boolean
  // Die Schätzung ersetzt bei einem Nutzer ein gemessenes Teilstück (Durchsicht von #242 Runde 2, N-I2); fehlt in älteren Abrechnungen.
  replacesMeasured?: boolean
}
// Für den Dialog der Seite Heizkosten: je Wohnung und Topf mit Gerät, was fehlt (`why`, null heißt:
// nichts, eine Schätzung wäre die Markierung „unbrauchbar“; `noValues`: der Ablesedienst hat für die Wohnung
// keine Werte), die Fläche des Topfs und die Vorschläge.
export type SelfEstimateOption = {
  unitId: string
  unitName: string
  part: EstimatePart
  areaM2: number
  why: 'noReading' | 'replacement' | 'negative' | 'noValues' | null
  boundary: string | null
  estimated: boolean
  // Ein Teil der Heizperiode der Wohnung ist gültig abgelesen (etwa beim Vormieter); gezählt wird für § 9a Abs. 2
  // trotzdem die ganze Fläche (Durchsicht von #242, R-I5). Fehlt in älteren Antworten.
  partlyMeasured?: boolean
  proposals: EstimateProposal[]
  comparable: ComparableUnit[]
}

// ---------- Informationen nach § 6a HeizkostenV (Heizung PR 14) ----------

export type InfoContact = { name: string; url: string; what: string }
// `renewable`: § 11 Abs. 1 Nr. 3 Buchst. a (Wärmerückgewinnung, Solar; bis 30.09.2024 auch Wärmepumpen); `chp`:
// Buchst. b (Kraft-Wärme-Kopplung, Abwärme), nur wenn der Wärmeverbrauch des Gebäudes nicht erfasst wird.
export type HeatingExemption = 'none' | 'lowDemand' | 'disproportionate' | 'pre1981' | 'renewable' | 'chp' | 'authority'
// Welche Töpfe eine Ausnahme nach § 11 betrifft: nur die Wärme (Abs. 1) oder auch das Warmwasser (Abs. 2,
// „entsprechend“).
export type ExemptionScope = 'heat' | 'both'
// Vereinbarung nach § 2 HeizkostenV über die Verteilung; `none`: ausdrücklich keine.
export type AgreedOtherwise = 'none' | 'area' | 'fixedPercent' | 'consumption'
// Die Nummern des § 6a Abs. 3 Satz 1 HeizkostenV.
export type InfoItem = '1a' | '1b' | '1c' | '2' | '3' | '4' | '5'
// Was der Vermieter je Heizperiode zu § 6a einträgt, und die Postleitzahl des Objekts für den Hinweis zum
// Klimafaktor (Heizung PR 14).
export type HeatingInfoInputs = Pick<HeatingPeriodData, 'infoTaxesText' | 'infoDistrictGhg' | 'infoDistrictPef' | 'climateFactor' | 'climateFactorPrev' | 'climateFactorSource' | 'infoReferenceKwhPerM2' | 'infoReferenceSource' | 'infoComparisonSource'> & { postalCode: string | null }
// Ausnahme, Vereinbarung, monatliche Information und Verbrauchervertrag einer Heizperiode, wie sie gelten
// (eigene Zeile oder geerbt von der vorigen der Linie). `fromPeriod` je Angabe: die Heizperiode, aus der sie
// stammt (`null`: keine Antwort, es gilt die Vorgabe).
export type HeatingRules = {
  exemption: HeatingExemption
  // Mit Ausnahme der geltende Umfang (ohne Antwort `heat`); ohne Ausnahme null.
  exemptionScope: ExemptionScope | null
  exemptionBillingAgreed: boolean
  agreedOtherwise: AgreedOtherwise
  monthlyInfoElsewhere: boolean
  consumerContract: string | null
  fromPeriod: { exemption: string | null; agreedOtherwise: string | null; monthlyInfoElsewhere: string | null; consumerContract: string | null }
}
// Vergleich je Mieter (Nr. 4 und 5). Verbrauch in der Einheit des Topfs; `null`: nicht erfasst.
// `referenceKwh`: der Vergleichswert des Durchschnittsnutzers, umgerechnet auf Wohnfläche und Tage des
// Mieters; kein Hausdurchschnitt.
export type InfoComparison = {
  tenancyId: string
  label: string
  days: number
  prevDays: number | null
  heating: { now: number | null; estimated: boolean; referenceKwh: number | null; prev: number | null; nowAdjusted: number | null; prevAdjusted: number | null } | null
  water: { now: number | null; prev: number | null } | null
  // Der Mieter wohnte im vorhergehenden Zeitraum nicht in der Wohnung (Entwurf 15.1 Nr. 14).
  firstPeriod: boolean
  // Er wohnte dort, aber Mietfuchs kennt seinen Verbrauch im vorhergehenden Zeitraum nicht (keine
  // vergleichbare Ablesung, andere Erfassung, Werte eines Ablesedienstes).
  prevUnknown: boolean
  // Sein Verbrauch ist nach § 9a geschätzt: Die Vergleiche nach § 6a Abs. 3 gehören dann nicht dazu
  // (BR-Drs. 643/21, S. 19), und Mietfuchs nennt für ihn keine Kürzung dafür (Durchsicht von #243, R-W5).
  estimated: boolean
  // Was nur ihm fehlt (Nr. 4 ohne Wohnfläche, Nr. 5 ohne bekannten Vorjahresverbrauch; Durchsicht von #243, R-W2).
  missing: InfoItem[]
  // Sein Anteil an den jährlichen Treibhausgasemissionen der Fernwärme in kg CO₂-Äquivalent.
  ghgKg: number | null
}
// Die Informationen nach § 6a einer Anlage (bei einem Kesseltausch: ihrer Linie) und Heizperiode.
export type HeatingInfoStatement = {
  // `full`: § 6a Abs. 3; `minimal`: Abs. 5, nur Nr. 2 und 3.
  scope: 'full' | 'minimal'
  // Nr. 1 a: die Energieträger mit ihrem Anteil in Prozent (`null`: nicht bekannt).
  carriers: { energy: HeatingEnergy; percent: number | null }[]
  // Bei Fernwärme: Faktor laut Versorger (g CO₂-Äquivalent je kWh), Primärenergiefaktor und die jährliche
  // Menge in kg CO₂-Äquivalent (Faktor mal gelieferte kWh der Heizperiode).
  district: { ghg: number | null; pef: number | null; annualKg: number | null } | null
  taxesText: string | null
  // Nr. 1 c: die Entgelte aus den Positionen mit dem Teil „Erfassung“, für das ganze Gebäude; `null`: keine
  // Position trägt ihn (Durchsicht von #243, R-W6).
  meteringCents: number | null
  // Der beigelegte Vergleich des Ablesedienstes mit Quelle (R-W1); `null`: nicht bestätigt.
  comparisonSource: string | null
  // Er deckt auch Nr. 5 (Werte des Ablesedienstes, Runde 2).
  comparisonCoversPrev?: true
  // Nr. 4: der eingetragene Vergleichswert mit Quelle (`null`: fehlt) und ob Mietfuchs ihn mit dem Verbrauch
  // vergleichen kann (Wärme in kWh; nicht bei Heizkostenverteilern oder ausgenommener Wärme).
  reference: { kwhPerM2: number; source: string } | null
  referenceComparable: boolean
  contacts: InfoContact[]
  contactsChecked: string
  // Nr. 3: `none` kein Verbrauchervertrag, `text` die Information, `unknown` unbeantwortet.
  dispute: { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'unknown' }
  climate: { factor: number | null; factorPrev: number | null; source: string | null }
  units: { heating: string; water: string }
  users: InfoComparison[]
  // Sicher fehlend, und vielleicht fehlend (Fernwärme vor 2022, Verbrauchervertrag unbeantwortet, erstes Jahr
  // eines Mieters).
  missing: InfoItem[]
  uncertain: InfoItem[]
  // Was für jeden Mieter fehlt (die Angaben zur Anlage); was nur einzelnen fehlt, steht bei `users[].missing`
  // (Durchsicht von #243, R-W2). Fehlt in Abrechnungen, die vorher abgeschlossen wurden.
  missingCommon?: InfoItem[]
  // Ob Mietfuchs die Vergleiche Nr. 4 und 5 gerechnet hat (nur aus der eigenen Abrechnung), ob die Anlage
  // einen weiteren Erzeuger hat und ob die Wärme nach § 11 ausgenommen ist (die Angaben betreffen dann das
  // Warmwasser).
  comparisons: boolean
  mixedGeneration: boolean
  heatExempt: boolean
  // Die Mietverhältnisse, die über diese Anlage abgerechnet werden; nur sie bekommen den Block gedruckt. Fehlt in
  // einer Abrechnung, die vor diesem Feld abgeschlossen wurde.
  tenancyIds?: string[]
}

// ---------- Betriebsstrom der Heizung (Heizung PR 15, #212) ----------

// An einer Position „Heizung und Warmwasser“ heißt `included`: Dieser Betriebsstrom (Brenner,
// Umwälzpumpe, Regelung) steckt auch in der Stromrechnung des Allgemeinstroms, weil er über den Zähler
// des Hauses läuft, gemessen mit Zwischenzähler oder geschätzt. An einer Position
// „Beleuchtung/Allgemeinstrom“ heißt `deduction`: der Abzug dieses Stroms. Ohne Angabe ist eine
// Position weder das eine noch das andere.
export type OperatingPower = 'included' | 'deduction'

// Ein Gerät der Heizung für die Schätzung nach Leistung und Heiztagen (BGH, Urteil vom 03.06.2016,
// V ZR 166/15, Rn. 14: „Stromverbrauchswert der angeschlossenen Geräte und … Heiztage“). `days`: eigene
// Betriebstage des Geräts (P-K8, etwa die Warmwasserpumpe das ganze Jahr); fehlt die Angabe, gelten die
// Heiztage.
export type OperatingPowerDevice = { label: string; watts: number; hoursPerDay: number; days?: number | null }

// Was ein Abzug in einer abgeschlossenen Abrechnung den Mietern gebracht hat (P-W3, R2-W2), gelesen am
// eingefrorenen Stand (`itemTotals`):
// - `credited`: Er steht dort mit seinem heutigen Betrag, ist also gutgeschrieben.
// - `changed`: Er steht dort, aber mit einem anderen Betrag (`frozenCents`), weil er nach dem Abschluss
//   geändert wurde; gutgeschrieben ist der eingefrorene Betrag.
// - `missing`: Er steht nicht darin, wurde also nach dem Abschluss angelegt; gutgeschrieben ist nichts.
// - `unknown`: Der eingefrorene Stand führt keine Beträge je Position (ältere oder unlesbare
//   Abrechnung); ob er gutgeschrieben ist, lässt sich nicht lesen.
export type OperatingPowerCredit =
  | { label: string; state: 'credited' | 'missing' | 'unknown' }
  | { label: string; state: 'changed'; frozenCents: number }

// Ein Abzug beim Allgemeinstrom, wie der Schnappschuss ihn führt: aus allen Zeiträumen des Objekts,
// denn er gehört zu der Betriebsstrom-Position, auf die er zeigt, und nicht zum Zeitraum. `itemId` ist
// null bei einer Anlage mit Messdienst, dessen Beträge den Betriebsstrom enthalten. `closed`: `null`,
// wenn sein Zeitraum offen ist; sonst die abgeschlossene Abrechnung und was er dort gebracht hat.
export type OperatingPowerDeduction = {
  id: string
  itemId: string | null
  period: PeriodKey
  description: string
  amountCents: number
  closed: OperatingPowerCredit | null
  // Das Steuerjahr des Abzugs (Durchsicht von #252, N1), zum Vergleich mit seinem Betriebsstrom. Fehlt es
  // (ein von Hand gebauter Schnappschuss), wird nicht verglichen.
  taxYear?: number
}
