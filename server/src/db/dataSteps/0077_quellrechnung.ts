// Datenschritt zu 0077_quellrechnung (#455): Bestehende Teile einer aufgeteilten Rechnung bekommen ihre Quelle.
//
// **Eingefroren wie die SQL-Datei des Schrittes.** Was hier steht, ist der Stand von 0.13.1 und wird nach der
// Veröffentlichung nie geändert (Prüfsumme in server/test/data-steps.test.ts). Die Regeln, die der Schritt braucht
// (Zeiträume aus Beginnmonat und Wechseln, Basisbeschreibung, Familie), stehen deshalb als Kopie hier und nicht als
// Import aus shared/: Ändert sich die Regel dort, darf sich ein schon gelaufener Schritt nicht mit ihr ändern.
//
// Regel (Entwurf docs/superpowers/specs/2026-10-28-quellrechnung-design.md, „Datenschritt für bestehende Teile“):
//
// - Kandidat ist eine kalte Position mit Leistungszeitraum, nicht nach Einzelbeträgen und kein Abzug beim
//   Betriebsstrom, deren Leistungszeitraum mehr als einen Zeitraum ihres Objekts berührt oder deren Beschreibung den
//   Zusatz „(anteilig …)“ eines früheren Aufteilens trägt (Fall aus #455 nach Schritt 2, unten begründet).
// - Familie sind die Kandidaten eines Objekts mit gleicher Kostenart, Basisbeschreibung, Leistungszeitraum,
//   Rechnungssteller, Beleg und Schlüssel (`splitFamilyKey`, Stand 0.13.1).
// - Mindestens zwei Mitglieder, alle in verschiedenen Zeiträumen: eine Quelle. Genau diese Familien teilt der
//   Wechsel des Rhythmus bis 0.13.1 als Ganzes (`familyOf` in periodChange.ts).
// - Zwei oder mehr im selben Zeitraum: eine Quelle nur, wenn alle Mitglieder in jeder Angabe gleich sind (alle
//   Spalten außer denen, die je Teil gesetzt werden, und die Zeilen der Unterlisten) und keine zwei im selben
//   Zeitraum in Betrag und Beschreibung übereinstimmen. Sonst keine, wie heute.
//   Zwei solche Teile sind das Zeichen einer zweimal erfassten Rechnung: Wer in 0.13.1 dieselbe Rechnung zweimal mit
//   „Aufteilen und speichern“ sichert, bekommt je Zeitraum zwei Zeilen, gleich bis auf die Kennung. 0.13.1 nahm sie
//   nie als eine Rechnung (`familyOf`), und der Hinweis auf doppelte Positionen meldete sie; eine Quelle ließe ihn
//   verstummen, und der nächste Wechsel des Rhythmus zählte beide als eine Rechnung über den doppelten Betrag. Die
//   Teile aus #455 unterscheiden sich im selben Zeitraum dagegen in einem von beiden: nach Schritt 2 in der
//   Beschreibung (verschiedene Spannen), nach Schritt 4 im Betrag (Anteile verschieden großer Teile). Gleichen sich
//   dort ausnahmsweise beide (zwei gleich große Teile), bleibt auch dieser Fall ohne Quelle: Im Zweifel keine, die
//   alten Teile behalten dann das Verhalten von 0.13.1 (`isSplitPart`).
// - Beleg an nur einem Teil: Hängte der Vermieter in 0.13.1 den Beleg nachträglich an einen Teil, trennt der Beleg im
//   Familienschlüssel die Teile, und keiner bekäme eine Quelle; Steuer-ZIP und Belegkopien nennten den übrigen Teil
//   „kein Beleg“. 0.13.1 nahm sie beim Wechsel auch nicht als eine Rechnung (`familyOf` über `splitFamilyKey` mit dem
//   Beleg). Eindeutig eine Rechnung sind sie trotzdem, wenn genau eine Familie mit Beleg und genau eine ohne Beleg
//   denselben Schlüssel ohne Beleg haben und zusammen jedes Mitglied in einem anderen Zeitraum steht: So legt sie
//   „Aufteilen und speichern“ an, und nur der Beleg kam hinzu. Dann eine Familie. Zwei verschiedene Belege bleiben
//   getrennt, und stehen zwei im selben Zeitraum (eine zweimal erfasste Rechnung, einmal mit Beleg), bleibt jede
//   Familie, wie sie ist.
// - Die Kennung der Quelle ist die kleinste ihrer Teile; der Schritt ist damit reproduzierbar.
//
// **Der einzige Eingriff** ist `INSERT INTO cost_sources` und `UPDATE cost_items SET source_id`: kein Betrag, keine
// Zeile, keine Beschreibung, kein abgeschlossener Stand.
import type { Connection } from '../client.ts'

// ---------- Eingefrorene Regeln, Stand 0.13.1 ----------

// shared/heating.ts, HEATING_CATEGORY
const HEATING_CATEGORY = 'Heizung und Warmwasser'
// shared/splitPart.ts, SPLIT_SUFFIX
const SPLIT_SUFFIX = / \(anteilig [^)]*\)$/
// § 556 Abs. 3 BGB, `bgb.max-period-months` im Rechtsregister: eine Fassung, 12 Monate.
const MAX_PERIOD_MONTHS = 12
// shared/period.ts, KEY
const PERIOD_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

// shared/period.ts: Monate als fortlaufende Zahl (Jahr · 12 + Monat − 1).
const monthIndex = (year: number, month: number): number => year * 12 + month - 1
const monthOf = (index: number): number => index - Math.floor(index / 12) * 12 + 1
const indexOfDate = (date: string): number => monthIndex(Number(date.slice(0, 4)), Number(date.slice(5, 7)))

type Rhythm = { initial: number; changes: number[] }

// shared/period.ts, `rhythmOf`: ungültige Wechsel fallen weg.
function rhythmOf(startMonth: number, changeMonths: readonly string[]): Rhythm {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error(`Beginnmonat ${startMonth} liegt nicht zwischen 1 und 12.`)
  }
  const changes = new Set<number>()
  for (const change of changeMonths) if (PERIOD_KEY.test(change)) changes.add(indexOfDate(change))
  return { initial: startMonth, changes: [...changes].sort((a, b) => a - b) }
}

// shared/period.ts, `anchorAt`, `startOf`, `nextStart`.
function anchorAt(r: Rhythm, index: number): number {
  let anchor = r.initial
  for (const change of r.changes) if (change <= index) anchor = monthOf(change)
  return anchor
}
function startOf(r: Rhythm, index: number): number {
  const anchor = anchorAt(r, index)
  return index - ((((index - (anchor - 1)) % 12) + 12) % 12)
}
function nextStart(r: Rhythm, start: number): number {
  let next = start + MAX_PERIOD_MONTHS
  for (const change of r.changes) if (change > start && change < next) next = change
  return next
}

// shared/period.ts, `periodsBetween(…).length > 1`, und shared/splitPart.ts, `isSplitPart`: Berührt die Spanne
// mehr als einen Zeitraum?
function touchesSeveralPeriods(r: Rhythm, from: string, to: string): boolean {
  if (from > to) return false
  const first = startOf(r, indexOfDate(from))
  return nextStart(r, first) <= indexOfDate(to)
}

// shared/splitPart.ts, `baseDescription` und `splitFamilyKey` (Stand 0.13.1).
const baseDescription = (description: string): string => description.replace(SPLIT_SUFFIX, '')
const familyKey = (c: CostItemRow): string =>
  [c.category, baseDescription(c.description), c.serviceFrom, c.serviceTo, c.vendor ?? '', c.invoiceFile ?? '', c.key].join('\u0000')
// Derselbe Schlüssel ohne den Beleg (Beleg an nur einem Teil, siehe oben).
const keyWithoutReceipt = (c: CostItemRow): string =>
  [c.category, baseDescription(c.description), c.serviceFrom, c.serviceTo, c.vendor ?? '', c.key].join('\u0000')

// ---------- Lesen ----------

// Was je Teil neu gesetzt wird (`SPLIT_FIELDS` mit `part`, Stand 0.13.1); alle übrigen Spalten müssen bei Teilen
// im selben Zeitraum gleich sein.
const PART_COLUMNS = new Set(['id', 'period', 'amount_cents', 'labor_35a_cents', 'description', 'tax_year'])
// Die Unterlisten einer Kostenposition zur Zeit des Schrittes.
const SUBLISTS = ['cost_item_shares', 'cost_item_participants', 'cost_item_amounts', 'cost_item_contract', 'cost_item_self_amounts'] as const

type CostItemRow = {
  id: string
  propertyId: string
  period: string
  category: string
  description: string
  amountCents: number
  vendor: string | null
  invoiceFile: string | null
  key: string
  serviceFrom: string
  serviceTo: string
  // Alle Spalten außer PART_COLUMNS, als Text verglichen.
  shape: string
}

const quote = (value: string): string => `'${value.split("'").join("''")}'`
const columnsOf = (connection: Connection, table: string): string[] =>
  connection.rows(`PRAGMA table_info(${table})`).map((row) => String(row[1]))

// Ein Wert, wie ihn SQLite liefert, als Text samt Art: 1 und '1' sind verschieden, NULL ist kein leerer Text.
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'n'
  if (typeof value === 'number' || typeof value === 'bigint') return `z${String(value)}`
  if (typeof value === 'string') return `t${JSON.stringify(value)}`
  if (value instanceof Uint8Array) return `b${Buffer.from(value).toString('hex')}`
  throw new Error(`Unerwarteter Wert in der Datenbank: ${String(value)}`)
}
const textOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

// ---------- Der Schritt ----------

export function assignSources(connection: Connection): void {
  const columns = columnsOf(connection, 'cost_items')
  const at = (name: string): number => {
    const index = columns.indexOf(name)
    if (index < 0) throw new Error(`Die Spalte cost_items.${name} fehlt.`)
    return index
  }
  const rows = connection.rows(
    `SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM cost_items ` +
      `WHERE category <> ${quote(HEATING_CATEGORY)} AND service_from IS NOT NULL AND service_to IS NOT NULL ` +
      `AND key <> 'amounts' AND operating_power IS NOT 'deduction' ORDER BY rowid`,
  )
  // Ohne Position mit Leistungszeitraum gibt es nichts zu tun; das ist fast jeder Bestand.
  if (rows.length === 0) return

  const rhythms = new Map<string, Rhythm>()
  for (const [id, startMonth] of connection.rows('SELECT id, period_start_month FROM properties')) {
    const changes = connection
      .rows(`SELECT from_month FROM period_changes WHERE property_id = ${quote(String(id))}`)
      .map((row) => String(row[0]))
    rhythms.set(String(id), rhythmOf(Number(startMonth), changes))
  }

  const shapeColumns = columns.map((name, index) => ({ name, index })).filter((c) => !PART_COLUMNS.has(c.name))
  const families = new Map<string, CostItemRow[]>()
  for (const row of rows) {
    const item: CostItemRow = {
      id: String(row[at('id')]),
      propertyId: String(row[at('property_id')]),
      period: String(row[at('period')]),
      category: String(row[at('category')]),
      description: String(row[at('description')]),
      amountCents: Number(row[at('amount_cents')]),
      vendor: textOrNull(row[at('vendor')]),
      invoiceFile: textOrNull(row[at('invoice_file')]),
      key: String(row[at('key')]),
      serviceFrom: String(row[at('service_from')]),
      serviceTo: String(row[at('service_to')]),
      shape: shapeColumns.map((c) => canonical(row[c.index])).join('|'),
    }
    const rhythm = rhythms.get(item.propertyId)
    if (rhythm === undefined) throw new Error(`Die Kostenposition ${item.id} verweist auf ein Objekt, das es nicht gibt.`)
    // Ein Teil, den ein früherer Wechsel des Rhythmus aufgeteilt hat und dessen Leistungszeitraum nach einem weiteren
    // Wechsel in einem einzigen Zeitraum liegt (Fall aus #455 nach Schritt 2: Wechsel entfernt, beide Teile stehen
    // einzeln in 2025-01), ist kein Teil nach `isSplitPart` mehr. Er trägt aber den Zusatz „(anteilig …)“, und nur das
    // Aufteilen schreibt ihn. Ohne diesen Zusatz bleibt eine Rechnung in einem einzigen Zeitraum außen vor: Zwei
    // gleiche Rechnungen eines Kalenderobjekts sind keine Teile, und der Hinweis auf doppelte Positionen soll sie
    // weiter melden.
    if (!touchesSeveralPeriods(rhythm, item.serviceFrom, item.serviceTo) && !SPLIT_SUFFIX.test(item.description)) continue
    const key = `${item.propertyId}\u0000${familyKey(item)}`
    families.set(key, [...(families.get(key) ?? []), item])
  }

  // Beleg an nur einem Teil: genau eine Familie mit Beleg und eine ohne, zusammen je Mitglied ein anderer Zeitraum.
  const byKeyWithoutReceipt = new Map<string, string[]>()
  for (const [key, members] of families) {
    const first = members[0]
    if (first === undefined) continue
    const loose = `${first.propertyId}\u0000${keyWithoutReceipt(first)}`
    byKeyWithoutReceipt.set(loose, [...(byKeyWithoutReceipt.get(loose) ?? []), key])
  }
  for (const keys of byKeyWithoutReceipt.values()) {
    if (keys.length !== 2) continue
    const withReceipt = keys.find((k) => (families.get(k)?.[0]?.invoiceFile ?? null) !== null)
    const without = keys.find((k) => (families.get(k)?.[0]?.invoiceFile ?? null) === null)
    if (withReceipt === undefined || without === undefined) continue
    const union = [...(families.get(withReceipt) ?? []), ...(families.get(without) ?? [])]
    if (new Set(union.map((m) => m.period)).size < union.length) continue
    families.set(withReceipt, union)
    families.delete(without)
  }

  const sublistColumns = SUBLISTS.map((table) => ({ table, columns: columnsOf(connection, table).filter((c) => c !== 'cost_item_id') }))
  // Die Zeilen der Unterlisten einer Position, je Tabelle sortiert.
  const sublistsOf = (id: string): string =>
    sublistColumns
      .map(({ table, columns: cols }) =>
        connection
          .rows(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${table} WHERE cost_item_id = ${quote(id)}`)
          .map((row) => row.map(canonical).join('|'))
          .sort()
          .join('\n'),
      )
      .join('\u0000')

  for (const members of families.values()) {
    if (members.length < 2) continue
    const periods = new Set(members.map((m) => m.period))
    if (periods.size < members.length) {
      // Teile im selben Zeitraum (Fall aus #455): nur, wenn alle in jeder Angabe gleich sind.
      const [first, ...rest] = members
      if (first === undefined) continue
      if (rest.some((m) => m.shape !== first.shape)) continue
      // Zwei im selben Zeitraum mit gleichem Betrag und gleicher Beschreibung: eine zweimal erfasste Rechnung.
      const twins = new Set(members.map((m) => [m.period, m.amountCents, m.description].join('\u0000')))
      if (twins.size < members.length) continue
      const lists = sublistsOf(first.id)
      if (rest.some((m) => sublistsOf(m.id) !== lists)) continue
    }
    const ids = members.map((m) => m.id).sort()
    const sourceId = ids[0]
    const propertyId = members[0]?.propertyId
    if (sourceId === undefined || propertyId === undefined) continue
    connection.exec(`INSERT INTO cost_sources (id, property_id, rule) VALUES (${quote(sourceId)}, ${quote(propertyId)}, 'days')`)
    connection.exec(`UPDATE cost_items SET source_id = ${quote(sourceId)} WHERE id IN (${ids.map(quote).join(', ')})`)
  }
}
