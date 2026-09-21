// Prüft einen Datenbestand, bevor er übernommen wird (#59).
//
// Gebraucht wird das an zwei Stellen: beim Wiederherstellen aus einem Backup (index.ts) und
// beim einmaligen Umstieg der vorhandenen Daten in die Datenbank (#55). Deshalb steht die
// Prüfung hier und nicht in einer der beiden.
//
// **Das Ergebnis ist eine Liste von Befunden mit Ort und Grund, kein Wahrheitswert.** „Die
// Datei enthält keine gültigen Daten" ist keine Antwort, mit der ein Vermieter etwas anfangen
// kann. Jeder Befund sagt, welcher Datensatz gemeint ist und was an ihm nicht stimmt, in ganzen
// Sätzen und ohne eine durchgereichte Meldung aus einer Bibliothek.
//
// ---------- Die Grenze zwischen kaputt und krumm ----------
//
// Das ist der Entwurfspunkt dieser Datei, und an ihm hängt später der Umstieg. Zu streng heißt:
// Ein Bestand, mit dem ein Vermieter seit Jahren arbeitet, käme nie in die Datenbank. Zu lasch
// heißt: Ein beschädigter Bestand kommt durch und wird erst beim Einfügen abgewiesen, mitten
// im Umstieg.
//
// Die Regel lautet deshalb:
//
//   **Abgelehnt** wird, was sich nicht übernehmen lässt, ohne eine Zahl der Abrechnung zu
//   verändern oder etwas Erfasstes zu verlieren.
//
//   **Hingenommen** wird, was beides erfüllt: Es entsteht durch gewöhnliche Bedienung oder in
//   einem älteren Bestand, **und** es lässt sich so geraderücken, dass die Abrechnung danach
//   dieselben Zahlen ergibt wie heute. Das Geraderücken folgt dabei immer einer Regel, die
//   schon in calc.ts oder legacy.ts steht, und erfindet nie eine neue.
//
// Was hingenommen wird, steht in `adjustments`: nicht als Mangel, sondern als Ankündigung
// dessen, was beim Übernehmen geschieht. Diese Liste ist zugleich die Vorschrift für den
// Umstieg. server/test/validate.test.ts rechnet für jeden dieser Fälle die Abrechnung vor und
// nach dem Geraderücken und vergleicht sie.
//
// Geprüft wird der **rohe** Inhalt der Datei und nicht der schon eingelesene Bestand. Das ist
// wichtig: `migrateLegacy` in legacy.ts verträgt keinen beliebigen Inhalt (ein Mietverhältnis
// ohne Beginn bringt es zum Absturz), und genau davor soll die Prüfung ja schützen.

import { COST_KEYS, DEPOSIT_STATUS, METER_TYPES, UPDATE_CHECK } from './schema.ts'
import { LEGACY_PREPAYMENT_FIELD } from '../legacy.ts'

export type Finding = {
  // Der Ort: „Wohnung 2 („OG", Kennung u2)". Gemeint ist die Stelle in der Datei, und zwar so
  // benannt, dass der Nutzer sie in der Oberfläche wiederfindet.
  where: string
  // Der Grund, als ganzer Satz.
  reason: string
}

export type Validation = {
  // Was der Übernahme im Weg steht. Ist die Liste leer, lässt sich der Bestand übernehmen.
  problems: Finding[]
  // Was krumm, aber gültig ist, mit dem, was beim Übernehmen daraus wird.
  adjustments: Finding[]
}

type Collector = { problems: Finding[], adjustments: Finding[] }
const problem = (c: Collector, where: string, reason: string): void => { c.problems.push({ where, reason }) }
const adjust = (c: Collector, where: string, reason: string): void => { c.adjustments.push({ where, reason }) }

// ---------- Lesen, ohne etwas zu behaupten ----------

// Ein Feld eines Werts, von dem niemand weiß, ob er überhaupt ein Objekt ist. `Reflect.get`
// nimmt jedes Objekt und liefert den Wert, ohne dass hier eine Zusicherung über die Gestalt
// nötig wäre. Was kein Objekt ist, hat auch keine Felder.
function fieldOf(value: unknown, name: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  return Reflect.get(value, name)
}

const isRecord = (value: unknown): boolean => value !== null && typeof value === 'object' && !Array.isArray(value)

// Ein Wert gekürzt für die Meldung: Ein ganzer Beleg im Fehlertext hilft niemandem.
const short = (text: string): string => (text.length > 40 ? `${text.slice(0, 40)}…` : text)

// Was da steht, in der Sprache des Nutzers. Steht in jeder Meldung über einen falschen Typ,
// damit der Nutzer die Stelle in der Datei wiedererkennt.
function kindOf(value: unknown): string {
  if (value === null) return 'nichts'
  if (Array.isArray(value)) return 'eine Liste'
  if (typeof value === 'string') return `einen Text („${short(value)}")`
  if (typeof value === 'number') return `die Zahl ${value}`
  if (typeof value === 'boolean') return 'einen Wahrheitswert'
  if (typeof value === 'object') return 'ein Objekt'
  return 'einen unbrauchbaren Wert'
}

// Der Ort eines Datensatzes. Die laufende Nummer steht immer dabei, denn Name und Kennung
// können beide fehlen, und dann bliebe sonst nur „irgendwo".
function place(kind: string, index: number, record: unknown, nameField?: string): string {
  const details: string[] = []
  const name = nameField === undefined ? undefined : fieldOf(record, nameField)
  if (typeof name === 'string' && name.trim()) details.push(`„${name.trim()}"`)
  const id = fieldOf(record, 'id')
  if (typeof id === 'string' && id.trim()) details.push(`Kennung ${id.trim()}`)
  return details.length > 0 ? `${kind} ${index + 1} (${details.join(', ')})` : `${kind} ${index + 1}`
}

// ---------- Die Prüfungen je Feld ----------

type NumberOptions = {
  // Cent-Beträge und Jahreszahlen sind ganze Zahlen. Eine Zahl mit Nachkommastellen zu runden
  // veränderte einen Geldbetrag, und das darf beim Übernehmen nicht stillschweigend geschehen.
  integer?: boolean
  // Ohne Angabe ist ein negativer Wert eine Beanstandung. Erlaubt ist er dort, wo das Schema
  // bewusst keine Prüfbedingung hat: Gutschrift, Rücklastschrift, §35a-Lohnanteil.
  negative?: boolean
}

function fieldsOf(c: Collector, record: unknown, where: string) {
  const missing = (label: string, raw: unknown, expected: string): string =>
    raw === undefined || raw === null
      ? `Das Feld „${label}" fehlt.`
      : `Das Feld „${label}" enthält ${kindOf(raw)}, erwartet wird ${expected}.`
  const empty = (label: string): string => `Das Feld „${label}" ist leer.`

  const checkNumber = (raw: unknown, label: string, options: NumberOptions): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      problem(c, where, missing(label, raw, 'eine Zahl'))
      return null
    }
    if (options.integer && !Number.isInteger(raw)) {
      problem(c, where, `Das Feld „${label}" hat Nachkommastellen (${raw}). Hier stehen ganze Cent; runden würde den Betrag verändern.`)
      return null
    }
    if (!options.negative && raw < 0) {
      problem(c, where, `Das Feld „${label}" ist negativ (${raw}). Ein negativer Wert ergibt hier keinen Sinn und verschöbe die Verteilung.`)
      return null
    }
    return raw
  }

  return {
    // Pflichtfeld mit Text. `allowEmpty` ist der Normalfall: Ein Name darf leer bleiben, ein
    // Datum nicht, denn ohne Datum rechnet die Abrechnung still mit Unsinn.
    text(field: string, label: string, allowEmpty = true): string | null {
      const raw = fieldOf(record, field)
      if (typeof raw !== 'string') {
        problem(c, where, missing(label, raw, 'ein Text'))
        return null
      }
      if (!allowEmpty && !raw.trim()) {
        problem(c, where, empty(label))
        return null
      }
      return raw
    },
    optionalText(field: string, label: string): void {
      const raw = fieldOf(record, field)
      if (raw === undefined || raw === null || typeof raw === 'string') return
      problem(c, where, missing(label, raw, 'ein Text'))
    },
    // Ein Feld, das die Datenbank verlangt, das aber nur angezeigt wird: der Name einer
    // Wohnung, die Maßeinheit eines Zählers, die Beschreibung einer Kostenposition. Fehlt es,
    // wird es leer übernommen. Das erfindet nichts (dagestanden hat ohnehin nichts), verändert
    // keine Zahl (keine Berechnung liest diese Felder) und kostet den Nutzer einen Blick statt
    // eines gescheiterten Umstiegs. Steht dort etwas anderes als ein Text, ist es trotzdem eine
    // Beanstandung: Dann ist der Datensatz verdorben und nicht bloß unvollständig.
    displayText(field: string, label: string): void {
      const raw = fieldOf(record, field)
      if (typeof raw === 'string') return
      if (raw === undefined || raw === null) {
        adjust(c, where, `Das Feld „${label}" fehlt. Es wird leer übernommen; gerechnet wird damit ohnehin nicht.`)
        return
      }
      problem(c, where, missing(label, raw, 'ein Text'))
    },
    number(field: string, label: string, options: NumberOptions = {}): number | null {
      return checkNumber(fieldOf(record, field), label, options)
    },
    optionalNumber(field: string, label: string, options: NumberOptions = {}): void {
      const raw = fieldOf(record, field)
      if (raw === undefined || raw === null) return
      checkNumber(raw, label, options)
    },
    optionalBoolean(field: string, label: string): void {
      const raw = fieldOf(record, field)
      if (raw === undefined || raw === null || typeof raw === 'boolean') return
      // Bewusst streng: In JavaScript ist die Zeichenkette „false" wahr. Ein solcher Wert
      // kehrte die Beteiligung einer Wohnung um, ohne dass irgendwo etwas danebenstünde.
      problem(c, where, missing(label, raw, 'ja oder nein'))
    },
    // Ein Wert aus einer festen Liste. Dieselben Listen wie im Schema, damit beide nicht
    // auseinanderlaufen können.
    optionalOneOf(field: string, label: string, values: readonly string[]): void {
      const raw = fieldOf(record, field)
      if (raw === undefined || raw === null) return
      if (typeof raw === 'string' && values.includes(raw)) return
      problem(c, where, `Das Feld „${label}" hat den Wert ${kindOf(raw)}. Erlaubt ist nur: ${values.join(', ')}.`)
    },
    oneOf(field: string, label: string, values: readonly string[]): void {
      const raw = fieldOf(record, field)
      if (typeof raw === 'string' && values.includes(raw)) return
      problem(c, where, `Das Feld „${label}" hat den Wert ${kindOf(raw)}. Erlaubt ist nur: ${values.join(', ')}.`)
    },
  }
}

// ---------- Die Sammlungen ----------

// Beschriftungen für den Nutzer. Englisch heißen die Sammlungen im Code, auf dem Bildschirm
// stehen sie deutsch.
const COLLECTIONS = [
  { name: 'units', many: 'Wohnungen', one: 'Wohnung' },
  { name: 'tenancies', many: 'Mietverhältnisse', one: 'Mietverhältnis' },
  { name: 'costItems', many: 'Kostenpositionen', one: 'Kostenposition' },
  { name: 'meters', many: 'Zähler', one: 'Zähler' },
  { name: 'readings', many: 'Ablesungen', one: 'Ablesung' },
  { name: 'payments', many: 'Zahlungen', one: 'Zahlung' },
  { name: 'closedSettlements', many: 'Abgeschlossene Abrechnungen', one: 'Abgeschlossene Abrechnung' },
] as const

type Collection = { entries: unknown[], usable: boolean }

// Eine Sammlung aus der Datei holen. Fehlt sie, ist das in Ordnung: Ein Backup aus einer
// früheren Version kennt die späteren Sammlungen noch nicht, und legacy.ts ergänzt sie leer.
// Steht dort etwas anderes als eine Liste, ist es der Fall aus #59, und er wird abgelehnt.
function collectionOf(c: Collector, db: unknown, name: string, many: string): Collection {
  const raw = fieldOf(db, name)
  if (raw === undefined) {
    adjust(c, `Die Sammlung „${many}"`, 'Sie fehlt in der Datei und wird leer angelegt.')
    return { entries: [], usable: true }
  }
  if (Array.isArray(raw)) return { entries: raw, usable: true }
  problem(
    c,
    `Die Sammlung „${many}"`,
    `Dort steht ${kindOf(raw)} statt einer Liste. Mietfuchs könnte damit nicht arbeiten und käme nach dem Übernehmen gar nicht mehr hoch.`,
  )
  return { entries: [], usable: false }
}

// Die Kennungen einer Sammlung, und zugleich die Prüfung auf Doppelungen: In der Datenbank ist
// die Kennung der Primärschlüssel, ein zweiter Datensatz mit derselben käme nicht hinein.
function idsOf(c: Collector, collection: Collection, kind: string, nameField?: string): Set<string> {
  const ids = new Set<string>()
  collection.entries.forEach((entry, index) => {
    const id = fieldOf(entry, 'id')
    if (typeof id !== 'string' || !id.trim()) return // meldet die Prüfung des Datensatzes selbst
    if (ids.has(id)) {
      problem(
        c,
        place(kind, index, entry, nameField),
        `Die Kennung ${id} kommt mehrfach vor. Von zwei Datensätzen mit derselben Kennung käme nur einer an, und der andere fehlte, ohne dass es auffiele.`,
      )
      return
    }
    ids.add(id)
  })
  return ids
}

// Ein Verweis, der auf nichts zeigt. Gemeinsame Meldung, weil der Fall überall derselbe ist.
function checkReference(
  c: Collector,
  where: string,
  value: unknown,
  label: string,
  known: Set<string>,
  usable: boolean,
  target: string,
): void {
  if (typeof value !== 'string' || !value.trim()) {
    problem(c, where, `Das Feld „${label}" fehlt oder ist leer. Ohne ${target} gehört der Datensatz nirgendwohin.`)
    return
  }
  // Ist die Zielsammlung selbst unbrauchbar, ist darüber schon alles gesagt; jeder Verweis
  // dorthin ergäbe sonst eine zweite Meldung über dieselbe Ursache.
  if (!usable || known.has(value)) return
  problem(c, where, `${target} mit der Kennung ${value} kommt in der Datei nicht vor.`)
}

// ---------- Die Staffeln ----------

// Personenzahl, Vorauszahlung und Kaltmiete stehen als „ab Datum gilt Wert". Alle drei werden
// gleich geprüft, nur der Betrag heißt jeweils anders.
function checkSchedule(
  c: Collector,
  where: string,
  entries: unknown[],
  label: string,
  fromLabel: string,
  amountField: string,
  amountLabel: string,
  integer: boolean,
): void {
  const seen = new Set<string>()
  entries.forEach((entry, index) => {
    const at = `${where}, ${label} Zeile ${index + 1}`
    if (!isRecord(entry)) {
      problem(c, at, `Dort steht ${kindOf(entry)} statt eines Eintrags.`)
      return
    }
    const fields = fieldsOf(c, entry, at)
    const from = fields.text('from', fromLabel, false)
    fields.number(amountField, amountLabel, { integer })
    if (from === null) return
    if (seen.has(from)) {
      // Kommt vor: Die Oberfläche setzt für eine Zeile ohne Monat den Einzugsmonat ein und
      // prüft nie auf Doppelung. Die Berechnung sortiert nach Stichtag und nimmt den letzten
      // Eintrag, der gilt; das ist bei gleichem Stichtag der spätere in der Datei.
      adjust(c, at, `Zum ${fromLabel} ${from} steht schon ein Eintrag. Beim Übernehmen bleibt der letzte, genau wie ihn die Abrechnung heute nimmt.`)
      return
    }
    seen.add(from)
  })
}

// Eine Staffel aus dem Mietverhältnis holen. Steht dort keine Liste, greift die Regel aus
// legacy.ts, und die ist kein Mangel, sondern das alte Format.
function scheduleOf(c: Collector, tenancy: unknown, field: string, where: string, missing: string): unknown[] | null {
  const raw = fieldOf(tenancy, field)
  if (Array.isArray(raw)) return raw
  adjust(c, where, missing)
  return null
}

// ---------- Die einzelnen Sammlungen ----------

function checkUnits(c: Collector, units: Collection): void {
  units.entries.forEach((entry, index) => {
    const where = place('Wohnung', index, entry, 'name')
    if (!isRecord(entry)) {
      problem(c, where, `Dort steht ${kindOf(entry)} statt einer Wohnung.`)
      return
    }
    const fields = fieldsOf(c, entry, where)
    fields.text('id', 'Kennung', false)
    fields.displayText('name', 'Name')
    // Die Wohnfläche darf fehlen: Die Berechnung rechnet ausdrücklich damit (`u.areaM2 || 0`)
    // und meldet die Wohnung als Mangel in der Abrechnung. Wer diesen Bestand abweist, sperrt
    // jemanden aus, bei dem heute alles läuft.
    if (fieldOf(entry, 'areaM2') === undefined) {
      adjust(c, where, 'Es ist keine Wohnfläche hinterlegt. Übernommen wird 0 m², so wie die Abrechnung sie heute schon liest.')
    } else {
      fields.number('areaM2', 'Wohnfläche')
    }
    if (fieldOf(entry, 'participates') === undefined) {
      adjust(c, where, 'Es ist nicht vermerkt, ob die Wohnung zur Abrechnungseinheit gehört. Übernommen wird „nein", so wie die Abrechnung es heute schon liest.')
    } else {
      fields.optionalBoolean('participates', 'Gehört zur Abrechnungseinheit')
    }
    fields.optionalBoolean('selfUsed', 'Selbstgenutzt')
    fields.optionalNumber('selfPersons', 'Personen im eigenen Haushalt')
    fields.optionalNumber('rooms', 'Zimmer')
    fields.optionalText('floor', 'Etage')
    fields.optionalText('notes', 'Notiz')
  })
}

function checkTenancies(c: Collector, tenancies: Collection, units: Collection, unitIds: Set<string>): void {
  tenancies.entries.forEach((entry, index) => {
    const where = place('Mietverhältnis', index, entry, 'tenantName')
    if (!isRecord(entry)) {
      problem(c, where, `Dort steht ${kindOf(entry)} statt eines Mietverhältnisses.`)
      return
    }
    const fields = fieldsOf(c, entry, where)
    fields.text('id', 'Kennung', false)
    fields.displayText('tenantName', 'Mietername')
    checkReference(c, where, fieldOf(entry, 'unitId'), 'Wohnung', unitIds, units.usable, 'Eine Wohnung')
    // Ohne Beginn lässt sich nichts ausrechnen, und legacy.ts stürzt daran ab.
    fields.text('start', 'Beginn', false)
    fields.optionalText('end', 'Ende')
    if (fieldOf(entry, 'persons') === undefined) {
      adjust(c, where, 'Es ist keine Personenzahl hinterlegt. Übernommen wird 1, so wie Mietfuchs sie heute schon einliest.')
    } else {
      fields.number('persons', 'Personenzahl')
    }

    const personHistory = scheduleOf(c, entry, 'personHistory', where, 'Die Personen-Staffel fehlt. Sie entsteht beim Übernehmen aus der Personenzahl ab dem Einzugstag, wie bisher beim Einlesen.')
    if (personHistory) checkSchedule(c, where, personHistory, 'Personen-Staffel', 'Stichtag', 'persons', 'Personenzahl', false)

    const prepayments = scheduleOf(c, entry, 'prepayments', where, 'Die Vorauszahlungs-Staffel fehlt. Sie entsteht beim Übernehmen aus dem festen Monatsbetrag, wie bisher beim Einlesen.')
    if (prepayments) checkSchedule(c, where, prepayments, 'Vorauszahlungs-Staffel', 'Monat', 'monthlyCents', 'Vorauszahlung', true)

    // Der feste Monatsbetrag aus der Zeit vor der Staffel. Er zählt auch neben einer **leeren**
    // Staffel, denn genau so liest ihn die Abrechnung heute (computePrepaymentCents in calc.ts).
    // In der Datenbank gibt es für ihn keine Spalte mehr: Wer ihn beim Übernehmen übergeht,
    // nimmt dem Mieter seine ganze Vorauszahlung aus der Abrechnung.
    const legacyMonthly = fieldOf(entry, LEGACY_PREPAYMENT_FIELD)
    if (legacyMonthly !== undefined && legacyMonthly !== null && (prepayments === null || prepayments.length === 0)) {
      fields.number(LEGACY_PREPAYMENT_FIELD, 'Fester Monatsbetrag', { integer: true })
      adjust(c, where, 'Die Vorauszahlung steht noch als fester Monatsbetrag da. Daraus wird ein Staffeleintrag ab dem Einzugsmonat, genau wie ihn die Abrechnung heute liest.')
    }

    const baseRents = scheduleOf(c, entry, 'baseRents', where, 'Die Kaltmiete-Staffel fehlt. Sie bleibt leer, wie bisher beim Einlesen.')
    if (baseRents) checkSchedule(c, where, baseRents, 'Kaltmiete-Staffel', 'Monat', 'monthlyCents', 'Kaltmiete', true)

    checkOverrides(c, entry, where)

    fields.optionalText('email', 'E-Mail')
    fields.optionalText('phone', 'Telefon')
    fields.optionalText('correspondenceAddress', 'Abweichende Anschrift')
    fields.optionalText('iban', 'IBAN')
    fields.optionalText('contractDate', 'Vertragsdatum')
    fields.optionalNumber('depositCents', 'Kaution', { integer: true })
    fields.optionalOneOf('depositStatus', 'Stand der Kaution', DEPOSIT_STATUS)
    fields.optionalText('notes', 'Notiz')
  })
}

// Die tatsächlich gezahlte Vorauszahlung eines Jahres: nach Jahr geschlüsselt, nicht nach Datum.
function checkOverrides(c: Collector, tenancy: unknown, where: string): void {
  const raw = fieldOf(tenancy, 'prepaymentOverrides')
  if (raw === undefined || raw === null || raw === '') {
    adjust(c, where, 'Es sind keine tatsächlich gezahlten Vorauszahlungen vermerkt. Der Eintrag bleibt leer, wie bisher beim Einlesen.')
    return
  }
  if (!isRecord(raw)) {
    problem(c, where, `Bei den tatsächlich gezahlten Vorauszahlungen steht ${kindOf(raw)} statt einer Zuordnung von Jahr zu Betrag.`)
    return
  }
  for (const [year, amount] of Object.entries(raw)) {
    const at = `${where}, gezahlte Vorauszahlung ${year}`
    if (!/^\d{4}$/.test(year)) {
      problem(c, at, `„${short(year)}" ist keine Jahreszahl. Der Betrag ließe sich keinem Abrechnungsjahr zuordnen.`)
      continue
    }
    fieldsOf(c, raw, at).number(year, `Gezahlte Vorauszahlung ${year}`, { integer: true })
  }
}

function checkCostItems(c: Collector, costItems: Collection, units: Collection, unitIds: Set<string>): void {
  costItems.entries.forEach((entry, index) => {
    const where = place('Kostenposition', index, entry, 'description')
    if (!isRecord(entry)) {
      problem(c, where, `Dort steht ${kindOf(entry)} statt einer Kostenposition.`)
      return
    }
    const fields = fieldsOf(c, entry, where)
    fields.text('id', 'Kennung', false)
    fields.number('year', 'Abrechnungsjahr', { integer: true })
    fields.text('category', 'Kostenart')
    fields.displayText('description', 'Beschreibung')
    // Ohne Vorzeichenbedingung: Eine Gutschrift ist ein negativer Rechnungsbetrag, und das
    // Schema lässt sie ausdrücklich zu.
    fields.number('amountCents', 'Betrag', { integer: true, negative: true })
    fields.oneOf('key', 'Umlageschlüssel', COST_KEYS)
    fields.optionalOneOf('meterType', 'Zählertyp', METER_TYPES)
    // Ebenfalls ohne Vorzeichenbedingung: Einen unsinnigen Lohnanteil meldet die Abrechnung
    // als Warnung und rechnet weiter. Eine Ablehnung nähme dem Nutzer genau diese Erklärung.
    fields.optionalNumber('labor35aCents', '§35a-Lohnanteil', { integer: true, negative: true })
    fields.optionalText('vendor', 'Rechnungssteller')
    fields.optionalText('invoiceFile', 'Beleg')

    // Die Direktzuordnung auf eine gelöschte Wohnung ist der bekannteste krumme Fall: Das
    // Löschen einer Wohnung lässt den Verweis heute stehen, und die Abrechnung fängt ihn mit
    // einer Warnung ab. Die Zeile zu verwerfen entfernte eine bezahlte Rechnung aus einem
    // abgerechneten Jahr; auf `null` zu setzen ändert dagegen nichts, denn die Abrechnung
    // schlägt eine unbekannte Kennung genauso vergeblich nach wie `null`.
    const direct = fieldOf(entry, 'directUnitId')
    if (typeof direct === 'string' && direct.trim() && units.usable && !unitIds.has(direct)) {
      adjust(c, where, `Die Direktzuordnung zeigt auf die Wohnung ${direct}, die es nicht mehr gibt. Sie wird als „keine Zuordnung" übernommen; der Betrag geht wie bisher an den Vermieter.`)
    } else {
      fields.optionalText('directUnitId', 'Direkt zugeordnete Wohnung')
    }

    checkShares(c, entry, where, units, unitIds)
  })
}

// Vereinbarte Prozentanteile je Wohnung. Die Schlüssel sind Wohnungs-Kennungen.
function checkShares(c: Collector, item: unknown, where: string, units: Collection, unitIds: Set<string>): void {
  const raw = fieldOf(item, 'customShares')
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    problem(c, where, `Bei den vereinbarten Anteilen steht ${kindOf(raw)} statt einer Zuordnung von Wohnung zu Prozentanteil.`)
    return
  }
  for (const [unitId, percent] of Object.entries(raw)) {
    const at = `${where}, vereinbarter Anteil für ${unitId}`
    fieldsOf(c, raw, at).number(unitId, 'Prozentanteil')
    // Beim Löschen einer Wohnung räumt Mietfuchs diese Einträge heute weg. Übrig bleiben kann
    // einer trotzdem, etwa wenn ein zweiter Tab die Kostenposition danach noch einmal
    // speichert. Verteilt wird er ohnehin nicht, die Abrechnung zählt nur Wohnungen der
    // Abrechnungseinheit; es entfällt also keine Zahl, sondern nur die Warnung darüber.
    if (units.usable && !unitIds.has(unitId)) {
      adjust(c, at, 'Die Wohnung gibt es nicht mehr. Der vereinbarte Anteil entfällt beim Übernehmen; verteilt wurde er schon bisher nicht.')
    }
  }
}

function checkMeters(c: Collector, meters: Collection, units: Collection, unitIds: Set<string>): void {
  meters.entries.forEach((entry, index) => {
    const where = place('Zähler', index, entry, 'name')
    if (!isRecord(entry)) {
      problem(c, where, `Dort steht ${kindOf(entry)} statt eines Zählers.`)
      return
    }
    const fields = fieldsOf(c, entry, where)
    fields.text('id', 'Kennung', false)
    fields.displayText('name', 'Name')
    fields.displayText('unit', 'Maßeinheit')
    fields.oneOf('type', 'Zählertyp', METER_TYPES)
    fields.optionalText('meterNumber', 'Zählernummer')
    // Ohne Wohnung ist es ein Hauptzähler für das ganze Haus, und das ist der Normalfall für
    // `null`. Zeigt der Verweis dagegen auf eine Wohnung, die es nicht gibt, hilft kein
    // Geraderücken: Ihn zum Hauptzähler zu machen wäre die einzige Möglichkeit, und sie
    // veränderte die Verteilbasis, denn ein Wohnungszähler zählt hinein und ein Hauptzähler
    // nicht.
    const unitId = fieldOf(entry, 'unitId')
    if (unitId === undefined || unitId === null) return
    if (typeof unitId !== 'string' || !unitId.trim()) {
      problem(c, where, `Das Feld „Wohnung" enthält ${kindOf(unitId)}, erwartet wird eine Kennung oder gar nichts (Hauptzähler).`)
      return
    }
    if (units.usable && !unitIds.has(unitId)) {
      problem(
        c,
        where,
        `Die Wohnung mit der Kennung ${unitId} kommt in der Datei nicht vor. Den Zähler stattdessen als Hauptzähler zu übernehmen ginge nicht ohne Folgen: Er zählte dann nicht mehr in die Verbrauchsbasis, und die Abrechnung verteilte andere Beträge als bisher.`,
      )
    }
  })
}

function checkReadings(c: Collector, readings: Collection, meters: Collection, meterIds: Set<string>): void {
  readings.entries.forEach((entry, index) => {
    const where = place('Ablesung', index, entry)
    if (!isRecord(entry)) {
      problem(c, where, `Dort steht ${kindOf(entry)} statt einer Ablesung.`)
      return
    }
    const fields = fieldsOf(c, entry, where)
    fields.text('id', 'Kennung', false)
    checkReference(c, where, fieldOf(entry, 'meterId'), 'Zähler', meterIds, meters.usable, 'Ein Zähler')
    fields.text('date', 'Datum', false)
    // Ein Zählerstand ist eine abgelesene Menge und läuft nicht unter null. Der negative
    // *Verbrauch*, vor dem die Abrechnung warnt, entsteht aus zwei Ständen und ist etwas anderes.
    fields.number('value', 'Zählerstand')
    fields.optionalBoolean('replacement', 'Zählerwechsel')
    fields.optionalNumber('oldEndValue', 'Endstand des alten Geräts')
    fields.optionalText('note', 'Notiz')
  })
}

function checkPayments(c: Collector, payments: Collection, tenancies: Collection, tenancyIds: Set<string>): void {
  payments.entries.forEach((entry, index) => {
    const where = place('Zahlung', index, entry)
    if (!isRecord(entry)) {
      problem(c, where, `Dort steht ${kindOf(entry)} statt einer Zahlung.`)
      return
    }
    const fields = fieldsOf(c, entry, where)
    fields.text('id', 'Kennung', false)
    checkReference(c, where, fieldOf(entry, 'tenancyId'), 'Mietverhältnis', tenancyIds, tenancies.usable, 'Ein Mietverhältnis')
    fields.text('date', 'Datum', false)
    // Ohne Vorzeichenbedingung: Eine Rücklastschrift ist ein echter Vorgang und steht hier als
    // negativer Eingang.
    fields.number('amountCents', 'Betrag', { integer: true, negative: true })
    fields.optionalText('note', 'Notiz')
  })
}

function checkClosedSettlements(c: Collector, closed: Collection): void {
  const years = new Set<number>()
  closed.entries.forEach((entry, index) => {
    const where = place('Abgeschlossene Abrechnung', index, entry)
    if (!isRecord(entry)) {
      problem(c, where, `Dort steht ${kindOf(entry)} statt einer abgeschlossenen Abrechnung.`)
      return
    }
    const fields = fieldsOf(c, entry, where)
    fields.text('id', 'Kennung', false)
    fields.text('closedAt', 'Abgeschlossen am', false)
    fields.optionalText('sentAt', 'Versandt am')
    // Der eingefrorene Berechnungsstand ist ein Archivstück: was er enthält, geht die Prüfung
    // nichts an, er muss nur überhaupt einer sein.
    const settlement = fieldOf(entry, 'settlement')
    if (!isRecord(settlement)) {
      problem(c, where, `Der eingefrorene Berechnungsstand fehlt oder ist unbrauchbar (dort steht ${kindOf(settlement)}). Er ist das, was dem Mieter zugestellt wurde, und lässt sich nicht wiederherstellen.`)
    }
    const year = fields.number('year', 'Abrechnungsjahr', { integer: true })
    if (year === null) return
    if (years.has(year)) {
      problem(c, where, `Für ${year} ist schon eine abgeschlossene Abrechnung vorhanden. Es kann nur eine geben, und welche von beiden die versandte ist, steht nirgends.`)
      return
    }
    years.add(year)
  })
}

function checkSettings(c: Collector, db: unknown): void {
  const where = 'Die Einstellungen'
  const raw = fieldOf(db, 'settings')
  if (raw === undefined || raw === null) {
    adjust(c, where, 'Sie fehlen in der Datei und werden mit den Vorgabewerten angelegt.')
    return
  }
  if (!isRecord(raw)) {
    problem(c, where, `Dort steht ${kindOf(raw)} statt der Einstellungen.`)
    return
  }
  const fields = fieldsOf(c, raw, where)
  fields.optionalText('houseName', 'Name des Hauses')
  fields.optionalText('address', 'Anschrift')
  fields.optionalText('landlordName', 'Name des Vermieters')
  fields.optionalText('iban', 'IBAN')
  fields.optionalNumber('paymentDeadlineDays', 'Zahlungsfrist in Tagen', { integer: true })
  fields.optionalText('ollamaUrl', 'Adresse der KI')
  fields.optionalText('ollamaModel', 'Modell der KI')
  fields.optionalBoolean('printAdjustSuggestion', 'Anpassungsvorschlag drucken')
  fields.optionalBoolean('printAttachments', 'Belege mitdrucken')
  fields.optionalOneOf('updateCheck', 'Update-Hinweis', UPDATE_CHECK)
  fields.optionalText('updateDismissed', 'Ausgeblendete Version')
  // `settings.ai` wird hier bewusst nicht geprüft: migrateAi in ai/settings.ts nimmt jeden
  // Inhalt entgegen, prüft jedes Feld einzeln und ersetzt, was nicht passt. Eine zweite Prüfung
  // daneben könnte nur strenger sein als die, die am Ende gilt.
}

// ---------- Die Prüfung ----------

const KNOWN_KEYS = ['settings', ...COLLECTIONS.map((c) => c.name)]

export function validateDb(value: unknown): Validation {
  const c: Collector = { problems: [], adjustments: [] }

  if (!isRecord(value)) {
    problem(c, 'Die Datei', `Sie enthält ${kindOf(value)} statt eines Datenbestands.`)
    return c
  }
  // Eine beliebige JSON-Datei ist kein Mietfuchs-Backup. Ohne diese Frage käme sie durch, und
  // danach stünde der Nutzer vor einem leeren Programm, das ihm nichts erklärt.
  if (!KNOWN_KEYS.some((key) => fieldOf(value, key) !== undefined)) {
    problem(c, 'Die Datei', 'Sie enthält keine der Angaben, aus denen ein Mietfuchs-Datenbestand besteht. Ist es wirklich die db.json aus einem Backup?')
    return c
  }

  const lists = new Map<string, Collection>()
  for (const { name, many } of COLLECTIONS) lists.set(name, collectionOf(c, value, name, many))
  // Jede Sammlung steht in COLLECTIONS, also gibt es sie hier; der Rückfall ist nur der Weg,
  // ohne Zusicherung über die Map zu kommen.
  const of = (name: string): Collection => lists.get(name) ?? { entries: [], usable: false }

  const units = of('units')
  const tenancies = of('tenancies')
  const meters = of('meters')
  const unitIds = idsOf(c, units, 'Wohnung', 'name')
  const tenancyIds = idsOf(c, tenancies, 'Mietverhältnis', 'tenantName')
  const meterIds = idsOf(c, meters, 'Zähler', 'name')
  idsOf(c, of('costItems'), 'Kostenposition', 'description')
  idsOf(c, of('readings'), 'Ablesung')
  idsOf(c, of('payments'), 'Zahlung')
  idsOf(c, of('closedSettlements'), 'Abgeschlossene Abrechnung')

  checkUnits(c, units)
  checkTenancies(c, tenancies, units, unitIds)
  checkCostItems(c, of('costItems'), units, unitIds)
  checkMeters(c, meters, units, unitIds)
  checkReadings(c, of('readings'), meters, meterIds)
  checkPayments(c, of('payments'), tenancies, tenancyIds)
  checkClosedSettlements(c, of('closedSettlements'))
  checkSettings(c, value)

  return c
}

// Die Befunde als ein Text für die Oberfläche. Höchstens `max` Stück und danach die Zahl der
// übrigen: Eine Liste mit fünfzig Zeilen liest niemand, und die ersten sagen fast immer schon,
// was los ist. Die Sätze werden mit Zeilenumbrüchen verbunden; im Browser stehen sie damit als
// fortlaufender Absatz, auf der Konsole untereinander.
export function findingsText(findings: Finding[], max = 5): string {
  const shown = findings.slice(0, max).map((f) => `${f.where}: ${f.reason}`)
  const rest = findings.length - shown.length
  if (rest > 0) shown.push(`Dazu ${rest} weitere ${rest === 1 ? 'Beanstandung' : 'Beanstandungen'}.`)
  return shown.join('\n')
}
