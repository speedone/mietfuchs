// Wie aus dem Inhalt einer db.json ein Datenbestand wird: die Vorgabewerte und die Umwandlung
// der alten Formate.
//
// **Warum das eine eigene Datei ist.** Diese Regeln werden zweimal gebraucht. Beim Einlesen der
// Datei (`load()` in store.ts) und beim einmaligen Umstieg der vorhandenen Bestände in die
// Datenbank (#55). Zwei Fassungen, die auseinanderlaufen, änderten beim Umstieg still eine
// Abrechnung, und das ist der teuerste Fehler, den dieses Vorhaben haben kann. Deshalb steht
// hier die eine Fassung, und beide Wege benutzen sie.
//
// Der Validator in db/validate.ts prüft gegen dieselben Regeln: Was hier geradegezogen wird,
// lehnt er nicht ab.

import type { Tenancy } from '../../shared/types.ts'
import type { Db } from './store.ts'
import { migrateAi } from './ai/settings.ts'

// Standardmodell für die KI-Belegauswertung, gewählt mit dem KI-Prüflauf (#17): Auf Rechnern
// ohne Grafikkarte liest es PDFs mit Textebene fast fehlerfrei, einseitige Scans meist richtig,
// und es braucht rund 3,6 GB Arbeitsspeicher. Das Compose-Profil „ki“ lädt dasselbe Modell,
// ein Test gleicht beides ab.
export const DEFAULT_OLLAMA_MODEL = 'qwen3.5:4b'
// Früherer Standard, den es in der Ollama-Bibliothek nie gab (gemeint war qwen3.6:35b)
const INVALID_OLD_DEFAULT_MODEL = 'qwen3.6-35b'

// Das Altformat der Vorauszahlung: ein fester Monatsbetrag statt einer Staffel. Im heutigen
// `Tenancy` gibt es das Feld nicht mehr, nur noch in ungewanderten Altbeständen. Der Name steht
// als Konstante, weil auch der Validator ihn kennen muss.
export const LEGACY_PREPAYMENT_FIELD = 'prepaymentMonthlyCents'
export type LegacyTenancy = Tenancy & { prepaymentMonthlyCents?: number }

export const DEFAULT_DB: Db = {
  settings: {
    houseName: '',
    address: '',
    landlordName: '',
    iban: '',
    paymentDeadlineDays: 30,
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: DEFAULT_OLLAMA_MODEL,
  },
  units: [],
  tenancies: [],
  costItems: [],
  meters: [],
  readings: [],
  // Gebuchte Mietzahlungen (Geldeingänge) fürs Mietkonto
  payments: [],
  // Abgeschlossene Abrechnungen: eingefrorener Berechnungsstand je Jahr
  closedSettlements: [],
}

// Aus dem geparsten Inhalt einer db.json einen Datenbestand machen: fehlende Sammlungen und
// Einstellungen aus den Vorgabewerten ergänzen, alte Formate umwandeln. `null` steht für „es
// gibt noch keine Datei“, dann entsteht ein leerer Bestand.
//
// Der Typ des Inhalts ist eine Annahme und keine Prüfung: Was in der Datei steht, weiß vorher
// niemand. Wo geprüft werden muss, bevor etwas übernommen wird, tut das der Validator in
// db/validate.ts.
export function migrateLegacy(stored: Partial<Db> | null): Db {
  let next: Db
  if (stored) {
    next = { ...structuredClone(DEFAULT_DB), ...stored }
    next.settings = { ...DEFAULT_DB.settings, ...next.settings }
  } else {
    next = structuredClone(DEFAULT_DB)
  }
  // Der frühere Standard existierte nie, wer ihn nicht geändert hat, konnte gar nicht auswerten.
  // Eine eigene Wahl bleibt unangetastet.
  if (next.settings.ollamaModel === INVALID_OLD_DEFAULT_MODEL) next.settings.ollamaModel = DEFAULT_OLLAMA_MODEL
  if (next.settings.ai?.text?.model === INVALID_OLD_DEFAULT_MODEL) next.settings.ai.text.model = DEFAULT_OLLAMA_MODEL
  // KI-Anbieter (#18): `settings.ai` entsteht aus ollamaUrl und ollamaModel, fehlende Felder
  // werden ergänzt (siehe ai/settings.ts)
  migrateAi(next.settings)
  // Migrationen älterer Datenformate.
  // Wohnungen: `selfUsed`/`selfPersons` (Eigennutzung in der Verteilbasis) kamen später dazu.
  // Bewusst ohne Rück-Migration — ein automatisch gesetztes Kennzeichen würde die Verteilung
  // bereits abgerechneter Jahre verändern. Die Umstellung passiert in den Stammdaten; das
  // Cockpit weist auf nicht beteiligte Wohnungen mit Wohnfläche hin.
  for (const t of next.tenancies) {
    // fester Monatsbetrag → Vorauszahlungs-Staffel
    if (!Array.isArray(t.prepayments)) {
      // `prepaymentMonthlyCents` gibt es im heutigen Tenancy-Typ nicht mehr, nur noch in
      // ungewanderten Altbeständen. Daher der gezielte Zugriff über eine Erweiterung des Typs.
      const legacy: LegacyTenancy = t
      t.prepayments =
        legacy.prepaymentMonthlyCents != null
          ? [{ from: t.start.slice(0, 7), monthlyCents: legacy.prepaymentMonthlyCents }]
          : []
      delete legacy.prepaymentMonthlyCents
    }
    if (!t.prepaymentOverrides) t.prepaymentOverrides = {}
    // feste Personenzahl → Personen-Staffel
    if (!Array.isArray(t.personHistory)) {
      t.personHistory = [{ from: t.start, persons: t.persons ?? 1 }]
    }
    // Kaltmiete-Staffel kam später dazu — Altbestand hat sie noch nicht
    if (!Array.isArray(t.baseRents)) t.baseRents = []
  }
  return next
}
