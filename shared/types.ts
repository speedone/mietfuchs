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
// Sonstiges (etwa ein Garagenhof).
export type PropertyKind = 'mfh' | 'etw' | 'efh' | 'sonstiges'

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
  sollCents: number // Bruttomiete = Kaltmiete + Vorauszahlung + Pauschale
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

export type MeterType = 'kaltwasser' | 'strom' | 'waerme' | 'sonstig'

export type Meter = {
  id: string
  // Eigens und nicht über die Wohnung: Ein Hauptzähler hat keine.
  propertyId: string
  name: string
  unitId: string | null // null = Hauptzähler (ganzes Objekt)
  type: MeterType
  meterNumber?: string
  unit: string // Maßeinheit, z. B. m³
}

export type Reading = {
  id: string
  meterId: string
  date: string
  value: number
  replacement?: boolean // Zählerwechsel: value = Startstand des neuen Geräts
  oldEndValue?: number // Endstand des alten Geräts
  note?: string
}

export type CostKey = 'area' | 'persons' | 'units' | 'direct' | 'meter' | 'custom' | 'external' | 'amounts'

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

export type CostItem = {
  id: string
  propertyId: string
  // Das Kalenderjahr, in dem `period` beginnt. Gespeichert wird es nicht mehr, sondern aus `period`
  // abgeleitet (#208), für Leser, die noch nicht auf `period` umgestellt sind.
  year: number
  // Der Abrechnungszeitraum (#208), dem die Position ganz gehört. Aus der Datenbank kommt er immer
  // (`StoredCostItem` in server/src/db/read.ts); optional nur, solange `year` daneben steht.
  period?: PeriodKey
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
//   `rounding`      Rundungsrest (nur in Abrechnungen, die vor #202 abgeschlossen wurden)
export type LandlordReason =
  | 'notAllocable' | 'noBasis' | 'selfUse' | 'vacancy' | 'flatRate' | 'inclusive'
  | 'outsideUnit' | 'amountsRest' | 'customRest' | 'mainMeterRest' | 'rounding'
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
export type NoticeSubject = { kind: 'costItem' | 'unit' | 'tenancy' | 'meter' | 'rentLedger'; id: string }
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
}
// Datum des Rechtsregisters, die Regeln, die im Abrechnungsjahr gelten, und die Rechtswerte, mit
// denen gerechnet wurde. Wird mit der Abrechnung eingefroren, damit eine spätere Rechtsänderung
// eine versandte Abrechnung nicht rückwirkend anders erklärt. `values` ist optional, weil eine vor
// 0.11.0 abgeschlossene Abrechnung es nicht kennt.
export type LegalBasis = { asOf: string; rules: AppliedRule[]; values?: AppliedValue[] }

export type Settlement = {
  year: number
  daysInYear: number
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
export type LawValueChange = { id: string; title: string; frozenText: string; currentText: string }
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
    // der Unterschied dasteht, statt dass jeder Nutzer ihn selbst herleitet (#70).
    prepaymentSettlementCents: number
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
    // Jede Position mit ihrer Aufteilung, in der Reihenfolge der Erfassung (#163)
    items: TaxExpenseItem[]
  }
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
  // Der gewählte Abrechnungszeitraum (#208): beim Auswerten mitgeschickt (die Seite, von der aus
  // ausgewertet wurde), danach der von Hand gesetzte. Nur mit Objekt, denn ein Zeitraum ist nur am
  // Objekt bestimmt (G-B7); `null`, wenn keiner gewählt ist. Weicht `year` davon ab, steht die Ampel
  // auf gelb und nichts ist vorab angehakt.
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
