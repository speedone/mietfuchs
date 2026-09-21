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

import type { PersonEntry, PrepaymentEntry, Settings, Tenancy } from '../../shared/types.ts'
import type { Db } from './store.ts'
import { migrateAi, type MigratedSettings } from './ai/settings.ts'

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

// ---------- Der feste Monatsbetrag aus der Zeit vor der Staffel ----------

// Wie steht die Vorauszahlung eines Mietverhältnisses da? Die Frage wird an zwei Stellen
// gestellt, und beide müssen dieselbe Antwort bekommen: beim Prüfen (db/validate.ts sagt an,
// was beim Übernehmen geschieht) und beim Übernehmen selbst (straightenForDatabase unten).
// Deshalb steht sie hier und nimmt beliebige Werte entgegen, denn der Validator sieht den rohen
// Inhalt der Datei und nicht den eingelesenen Bestand.
//
//   'none'              Kein alter Betrag oder eine gefüllte Staffel: nichts zu tun.
//   'missing-schedule'  Keine Staffel, aber ein alter Betrag. Daraus macht schon `migrateLegacy`
//                       einen Staffeleintrag ab dem Einzugsmonat, und zwar bei jedem Einlesen.
//                       Dabei bewegt sich keine Zahl: Abrechnung und Mietkonto rechnen danach
//                       mit demselben Betrag wie vorher.
//   'empty-schedule'    Eine **leere** Staffel neben einem alten Betrag. `migrateLegacy` fasst
//                       das nicht an, denn seine Bedingung lautet „keine Liste", und eine leere
//                       Liste ist eine. Die Abrechnung liest den alten Betrag trotzdem
//                       (`computePrepaymentCents` in calc.ts), das Mietkonto nicht (`rentLedger`
//                       liest nur `prepayments`). In der Datenbank gibt es für das Feld keine
//                       Spalte mehr: Wer es übergeht, nimmt dem Mieter die ganze Vorauszahlung
//                       aus der Abrechnung. Daraus wird deshalb ein Staffeleintrag — der eine
//                       Fall, der eine Zahl bewegt, nämlich die des Mietkontos und damit der
//                       Steuerübersicht (#70). Wer davon betroffen ist, erfährt es beim Umstieg.
export type LegacyPrepaymentCase = 'none' | 'missing-schedule' | 'empty-schedule'

export function legacyPrepaymentCase(prepayments: unknown, monthlyCents: unknown): LegacyPrepaymentCase {
  // Eine 0 ist ein Betrag und kein fehlendes Feld: `!= null` und nicht `!value`.
  if (monthlyCents === undefined || monthlyCents === null) return 'none'
  if (!Array.isArray(prepayments)) return 'missing-schedule'
  return prepayments.length === 0 ? 'empty-schedule' : 'none'
}

// Der Staffeleintrag, der aus dem alten Monatsbetrag wird: ab dem Einzugsmonat, genau wie ihn
// `computePrepaymentCents` in calc.ts heute schon liest. `null`, wenn es nichts umzuwandeln gibt.
//
// Zwei Stellen brauchen ihn, und beide müssen denselben Eintrag bekommen: das Geraderücken
// (unten) und der Vergleichsstand der Regression (db/regression.ts). Zwei Fassungen davon
// ließen die Regression genau dort blind werden, wo sie am meisten zu tun hat.
export function legacyPrepaymentEntry(tenancy: LegacyTenancy): PrepaymentEntry | null {
  const monthly = tenancy.prepaymentMonthlyCents
  if (monthly == null || legacyPrepaymentCase(tenancy.prepayments, monthly) === 'none') return null
  return { from: textOr(tenancy.start, '').slice(0, 7), monthlyCents: monthly }
}

// ---------- Geraderücken für die Datenbank ----------

// Ein Bestand, wie ihn die Datenbank annimmt: Die Einstellungen führen die KI-Felder, und jedes
// Feld, für das es eine Spalte ohne NULL gibt, hat einen Wert.
export type StraightDb = Omit<Db, 'settings'> & { settings: MigratedSettings }

// Ein Text, wie ihn eine Spalte ohne NULL verlangt. Der Typ sagt `string`, die Datei kann
// trotzdem etwas anderes enthalten: Der Validator lässt ein **fehlendes** Anzeigefeld
// ausdrücklich durch (Name der Wohnung, Mietername, Beschreibung, Name und Maßeinheit eines
// Zählers), weil es in keine Rechnung eingeht. Gerechnet wird damit nichts, angezeigt schon.
const textOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)

// Dasselbe für eine Zahl. `Number.isFinite` schließt NaN und Unendlich mit ein; beides lehnt der
// Validator ab, und beides ergäbe in einer Spalte einen Wert, mit dem niemand rechnen kann.
const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

// Zwei Einträge zum selben Stichtag sind über die Oberfläche erzeugbar: Sie setzt für eine Zeile
// ohne Monat den Einzugsmonat ein und prüft nie auf Doppelung. In der Datenbank ist der Stichtag
// Teil des Primärschlüssels, es kann ihn also nur einmal geben.
//
// **Es gilt der letzte.** Genau so liest ihn die Abrechnung: Sie sortiert nach Stichtag
// (`Array.prototype.sort` ist stabil, gleiche Stichtage behalten die Reihenfolge der Datei) und
// übernimmt den letzten Eintrag, dessen Stichtag erreicht ist. Gemessen ergibt [100 €, 250 €]
// eine Jahresvorauszahlung von 3000 € und [250 €, 100 €] eine von 1200 €; wer hier den falschen
// nähme, änderte eine Abrechnung um 1800 €. Die Reihenfolge der übrigen Einträge bleibt, wie sie
// in der Datei stand.
function lastPerFrom<T extends { from: string }>(entries: T[]): T[] {
  const lastIndex = new Map<string, number>()
  entries.forEach((entry, index) => lastIndex.set(entry.from, index))
  return entries.filter((entry, index) => lastIndex.get(entry.from) === index)
}

// Der letzte Eintrag der Personen-Staffel, also die Personenzahl, die heute gilt. Sortiert wird
// nach Stichtag, wie in `personsAt` in calc.ts.
function currentPersons(history: PersonEntry[]): number | null {
  const sorted = history.slice().sort((a, b) => a.from.localeCompare(b.from))
  const last = sorted.at(-1)
  return last ? numberOr(last.persons, 1) : null
}

// Ein `null` in den Einstellungen zählt wie ein fehlendes Feld, und genau so liest es auch der
// Validator. Nötig ist das, weil `{ ...DEFAULT, ...{ houseName: null } }` das null übernimmt:
// Die Vorgabewerte greifen also gerade dort nicht, wo sie gebraucht würden, und die Spalte
// verlangt einen Wert.
function withoutEmptyFields(settings: Settings): Partial<Settings> {
  const kept: Partial<Settings> = {}
  for (const key of Object.keys(settings)) {
    const value: unknown = Reflect.get(settings, key)
    if (value !== null && value !== undefined) Reflect.set(kept, key, value)
  }
  return kept
}

// Bringt einen eingelesenen Bestand in die Gestalt, die die Datenbank verlangt.
//
// **Jede Regel hier folgt einer, die schon in calc.ts oder oben in dieser Datei steht**, und
// keine erfindet eine neue. Deshalb bewegt das Geraderücken keine Zahl — mit der einen benannten
// Ausnahme des festen Monatsbetrags neben einer leeren Staffel, siehe `legacyPrepaymentCase`.
// Nachgerechnet wird das zweimal: in validate.test.ts für jeden hingenommenen Fall und beim
// Umstieg selbst für den wirklichen Bestand des Nutzers (db/changeover.ts).
//
// Die Eingabe bleibt unberührt. Der Umstieg rechnet beide Stände durch, den krummen und den
// geradegerückten; änderte diese Funktion ihre Eingabe, verglichen beide Seiten dasselbe, und
// die Regression wäre blind.
export function straightenForDatabase(stored: Db): StraightDb {
  const db = structuredClone(stored)
  const knownUnits = new Set(db.units.map((u) => u.id))

  const units = db.units.map((u) => ({
    ...u,
    name: textOr(u.name, ''),
    areaM2: numberOr(u.areaM2, 0),
    // Ohne Kennzeichen gehört die Wohnung nicht zur Abrechnungseinheit, so liest die Abrechnung
    // sie heute schon. `=== true` und nicht `!!`: Der Validator lässt nur ja, nein oder gar
    // nichts durch, und in JavaScript wäre die Zeichenkette „false" wahr.
    participates: u.participates === true,
  }))

  const tenancies = db.tenancies.map((t) => {
    const legacy: LegacyTenancy = { ...t }
    const fromLegacy = legacyPrepaymentEntry(legacy)
    const schedule = fromLegacy ? [fromLegacy] : Array.isArray(t.prepayments) ? t.prepayments : []
    delete legacy.prepaymentMonthlyCents
    const personHistory = lastPerFrom(Array.isArray(t.personHistory) ? t.personHistory : [])
    return {
      ...legacy,
      tenantName: textOr(t.tenantName, ''),
      // Die aktuelle Personenzahl ist aus der Staffel abgeleitet; gerechnet wird mit der
      // Staffel, und nur wenn die leer ist, fällt die Abrechnung auf dieses Feld zurück. Ohne
      // beides gilt eine Person, wie beim Einlesen (`t.persons ?? 1`).
      persons: numberOr(t.persons, currentPersons(personHistory) ?? 1),
      personHistory,
      prepayments: lastPerFrom(schedule),
      baseRents: lastPerFrom(Array.isArray(t.baseRents) ? t.baseRents : []),
      prepaymentOverrides: t.prepaymentOverrides ?? {},
    }
  })

  const costItems = db.costItems.map((item) => {
    // Die Direktzuordnung auf eine gelöschte Wohnung bleibt als Zeile stehen und verliert nur
    // ihr Ziel, wie `ON DELETE SET NULL` es täte. Die Zeile zu verwerfen entfernte eine bezahlte
    // Rechnung aus einem abgerechneten Jahr. Die Abrechnung schlägt `null` genauso vergeblich
    // nach wie eine unbekannte Kennung, es bewegt sich also nichts.
    const direct = typeof item.directUnitId === 'string' && knownUnits.has(item.directUnitId) ? item.directUnitId : null
    // Vereinbarte Anteile für gelöschte Wohnungen entfallen. Verteilt wurden sie schon bisher
    // nicht, die Abrechnung zählt nur Wohnungen der Abrechnungseinheit; es entfällt also keine
    // Zahl, sondern nur die Warnung darüber.
    // Das Feld nur anfassen, wenn es eines gibt: Ein `customShares: undefined` neben einer
    // Position ohne vereinbarte Anteile wäre ein Feld, das vorher nicht dastand.
    const shares = item.customShares
      ? { customShares: Object.fromEntries(Object.entries(item.customShares).filter(([unitId]) => knownUnits.has(unitId))) }
      : {}
    // `directUnitId` steht danach immer da, entweder mit einer Kennung oder ausdrücklich als
    // „keine Zuordnung". Genau das hält auch die Spalte fest.
    return { ...item, description: textOr(item.description, ''), directUnitId: direct, ...shares }
  })

  const meters = db.meters.map((m) => ({
    ...m,
    name: textOr(m.name, ''),
    unit: textOr(m.unit, ''),
    // Eine leere Kennung liest die Abrechnung schon heute wie gar keine (`m.unitId && …`): Es
    // ist ein Hauptzähler für das ganze Haus.
    unitId: typeof m.unitId === 'string' && m.unitId !== '' ? m.unitId : null,
  }))

  return {
    ...db,
    settings: migrateAi({ ...DEFAULT_DB.settings, ...withoutEmptyFields(db.settings) }),
    units,
    tenancies,
    costItems,
    meters,
  }
}
