// Das Datenmodell von Mietfuchs, gemeinsam für Server und Client (#48). Was hier steht, hat
// keinen Laufzeitanteil: nur Typen. Oberflächentexte und Helfer stehen in client/src/types.ts.

// Beteiligung einer Wohnung an der Kostenverteilung:
//   'vermietet'  → participates: true — Anteil trägt der Mieter
//   'eigen'      → selfUsed: true — zählt in die Verteilbasis, Anteil trägt der Vermieter
//   'ausgenommen'→ beides false — gehört nicht zur Abrechnungseinheit, bleibt außen vor
export type UnitUsage = 'vermietet' | 'eigen' | 'ausgenommen'

export type Unit = {
  id: string
  name: string
  areaM2: number
  participates: boolean
  // Selbstgenutzt: kein Mietverhältnis, aber Teil der Verteilbasis — der Anteil fällt dem
  // Vermieter zu (Eigenanteil). Kosten für das ganze Haus dürfen nur anteilig auf die
  // Mieter umgelegt werden; siehe UnitUsage.
  selfUsed?: boolean
  selfPersons?: number // Personen im eigenen Haushalt — nur für den Personenschlüssel
  // Erweiterte Stammdaten (optional, ohne Einfluss auf die Berechnung)
  rooms?: number // Zimmerzahl
  floor?: string // Etage, z. B. „EG", „1. OG"
  notes?: string // freie Notiz zur Wohnung
}

export type PrepaymentEntry = {
  from: string // 'YYYY-MM' — ab diesem Monat gilt der Betrag
  monthlyCents: number
}

// Kaltmiete-Staffel — gleiche „ab Monat gilt Betrag"-Mechanik wie die Vorauszahlung.
// Bruttomiete = Kaltmiete + NK-Vorauszahlung des jeweiligen Monats.
export type RentEntry = {
  from: string // 'YYYY-MM'
  monthlyCents: number
}

export type PersonEntry = {
  from: string // 'YYYY-MM-DD' — ab diesem Tag gilt die Personenzahl
  persons: number
}

export type Tenancy = {
  id: string
  unitId: string
  tenantName: string
  persons: number // aktuelle Personenzahl (abgeleitet aus personHistory)
  personHistory: PersonEntry[]
  start: string
  end: string | null
  prepayments: PrepaymentEntry[]
  prepaymentOverrides: Record<string, number> // Jahr → tatsächlich gezahlter Betrag
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

export type RentMonthStatus = 'paid' | 'partial' | 'open'

export type RentMonth = {
  month: number // 1..12
  baseRentCents: number
  prepaymentCents: number
  sollCents: number // Bruttomiete = Kaltmiete + Vorauszahlung
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
  paidYearCents: number
  balanceCents: number // paid − soll: >0 Guthaben/Überzahlung, <0 offener Rückstand
  openMonths: number
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
  name: string
  unitId: string | null // null = Hauptzähler (ganzes Haus)
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

export type CostKey = 'area' | 'persons' | 'units' | 'direct' | 'meter' | 'custom'

export type CostItem = {
  id: string
  year: number
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
  updateDismissed?: string // Version, deren Hinweis mit „Später" ausgeblendet wurde
  // KI-Belegauswertung (#18), siehe server/src/ai/settings.js. ollamaUrl und ollamaModel oben
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

// Eine Empfehlung aus /api/ai/recommendations (server/src/ai/recommendations.js). Sie belegt nur
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

// Antwort von /api/update (server/src/update.js)
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
  keyLabel: string
  basisText?: string
  shareCents: number
  labor35aCents?: number
}

export type Statement = {
  tenancyId: string
  tenantName: string
  unitName: string
  persons: number
  days: number
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

export type Settlement = {
  year: number
  daysInYear: number
  statements: Statement[]
  landlord: { rows: SettlementRow[]; totalCents: number }
  // im Vermieteranteil enthaltener Eigenanteil selbstgenutzter Wohnungen
  selfUsedShareCents: number
  totalCostsCents: number
  warnings: string[]
  // gesetzt, wenn die Abrechnung abgeschlossen (eingefroren) ist
  closed: { closedAt: string; sentAt: string | null } | null
}

// ---------- Steuer-Export (Anlage V) ----------

export type TaxExpenseCategory = { category: string; amountCents: number; labor35aCents: number }
export type TaxExpenseGroup = {
  group: string // Anlage-V-nahe Gruppierung (z. B. „Laufende Betriebskosten")
  amountCents: number
  labor35aCents: number
  categories: TaxExpenseCategory[]
}

export type TaxReport = {
  year: number
  income: {
    baseRentSollCents: number // Kaltmiete (netto), vereinbart
    prepaymentSollCents: number // NK-Vorauszahlungen, vereinbart
    sollCents: number // Summe Soll (brutto)
    paidCents: number // tatsächlich eingegangen (Zuflussprinzip)
  }
  expenses: {
    groups: TaxExpenseGroup[]
    totalCents: number
    labor35aCents: number // Summe der §35a-Arbeitskosten (Lohnanteile)
  }
  rentedAreaShare: number // vermietete Fläche / Gesamtfläche (0..1)
  selfOccupiedExists: boolean // gibt es nicht vermietete (selbstgenutzte) Einheiten?
  selfUsedShareCents: number // auf selbstgenutzte Wohnungen entfallender Kostenanteil (privat)
  surplusSollCents: number // Einkünfte auf Soll-Basis = Einnahmen(Soll) − Werbungskosten
  surplusPaidCents: number // Einkünfte auf Ist-Basis (Zuflussprinzip)
}

export type UploadInfo = {
  file: string
  size: number
  mtime: string
}

export type Extraction = {
  vendor?: string
  invoiceDate?: string
  periodStart?: string | null
  periodEnd?: string | null
  totalGrossEur?: number
  positions?: { description: string; category: string; amountEur: number; labor35aEur?: number | null }[]
  // Vom Server gerechnet (#34, server/src/invoiceAmounts.js): 'netto' heißt, die Positionen
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

// Antwort von /api/intake: erkennt automatisch Rechnung vs. Zählerfoto
export type IntakeResult = { file: string } & (
  | { kind: 'rechnung'; extraction: Extraction }
  | { kind: 'zaehler'; reading: MeterReadingExtraction }
)
