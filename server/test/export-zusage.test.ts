// Kompatibilitätszusage ab 1.0 (#447), Teil „Exportformate“: Die Form der Exporte ist hier gebunden, damit sie sich
// nicht nebenbei ändert. Was die Zusage meint, steht in docs/daten-backup.md („Exporte und ihre Form“):
//
// - **JSON-Export der Abrechnung** (`format: mietfuchs-abrechnung`, `version`): der Export eines festen Bestands gegen
//   die eingecheckte Datei fixtures/export/abrechnung-v<version>.json. Der Bestand ist Beispiel A der eigenen
//   Heizkostenabrechnung (server/testing/selfHeating.ts), weil er jeden Teil der Form füllt (Positionen, Sonderzeilen,
//   Heizungsblöcke).
// - **CSV-Export der Abrechnung** und **die beiden CSV-Dateien des Steuer-ZIP**: die Kopfzeile jeder Datei wortgleich,
//   in jeder ihrer Spielarten.
//
// **Die Regel für das JSON** (dieselbe wie in der Doku): Vorhandene Felder behalten Namen, Art und Bedeutung; neue
// Felder können dazukommen, wer den Export liest, ignoriert unbekannte. Entfernen, Umbenennen oder eine andere
// Bedeutung verlangen `version` + 1 und einen Eintrag im CHANGELOG. Texte, die nur Anzeige sind (`DISPLAY_TEXT`),
// gehören nicht zur Zusage. Der Test unterscheidet deshalb drei Fälle, je mit eigener Ansage:
//   (a) Formbruch: ein Feld der Fixture fehlt oder hat eine andere Art.
//   (b) additiv: es gibt neue Felder. Erlaubt; die Fixture wird neu erzeugt, das CHANGELOG nennt sie.
//   (c) gleiche Form, anderer Wert: Die Berechnung von Beispiel A hat sich geändert. Kein Exportthema.
//
// **Die Fixture wird nie von selbst überschrieben.** Neu erzeugen:
//     GOLDEN=diff node --test test/export-zusage.test.ts      (im Ordner server/)
// dann liegt das Ist-Ergebnis als abrechnung-v<version>.actual.json daneben und wird von Hand übernommen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { periodKey } from '../../shared/period.ts'
import { computeSettlement, taxReport } from '../src/calc.ts'
import { EXPORT_FORMAT, EXPORT_VERSION, settlementExportCsv, settlementExportJson, type ExportableSettlement } from '../src/settlementExport.ts'
import { incomeCsv, planTaxArchive, type TaxSplitOfItem } from '../src/taxReceipts.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'export')
const REGENERATE = 'GOLDEN=diff node --test test/export-zusage.test.ts (im Ordner server/)'
const firstLine = (csv: string): string => csv.replace(/^﻿/, '').split('\r\n')[0] ?? assert.fail('leere Datei')

// Felder, deren Text nur Anzeige ist (aus der Berechnung erzeugte Sätze und Beschriftungen): gebunden ist ihre Art,
// nicht ihr Wortlaut. Als Pfad ohne Listenstellen.
const DISPLAY_TEXT = new Set([
  '.period.label',
  '.errors[].title',
  '.statements[].prepaymentNote',
  '.statements[].rows[].description', '.statements[].rows[].keyLabel', '.statements[].rows[].basisText',
  '.landlord.rows[].description', '.landlord.rows[].keyLabel', '.landlord.rows[].basisText',
  '.heating[].co2Check.findings[].texts[]',
  '.heating[].self.dhw.steps[]',
  '.heating[].info.contacts[].name', '.heating[].info.contacts[].url', '.heating[].info.contacts[].what', '.heating[].info.contactsChecked',
])

type FormDiff = { broken: string[], added: string[], changed: string[] }
const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'Liste' : typeof v === 'object' ? 'Objekt' : typeof v === 'string' ? 'Text' : typeof v === 'number' ? 'Zahl' : typeof v)
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// Vergleicht die eingecheckte Fassung (`old`) mit dem Export von heute. `at` ist die Stelle, `generic` derselbe Pfad
// ohne Listenstellen (für `DISPLAY_TEXT`).
function formDiff(old: unknown, now: unknown, at = '', generic = '', out: FormDiff = { broken: [], added: [], changed: [] }): FormDiff {
  if (kindOf(old) !== kindOf(now)) {
    out.broken.push(`${at || '(Wurzel)'}: ${kindOf(old)} wurde ${kindOf(now)}`)
  } else if (Array.isArray(old) && Array.isArray(now)) {
    if (old.length !== now.length) out.changed.push(`${at}: ${old.length} Einträge, heute ${now.length}`)
    for (let i = 0; i < Math.min(old.length, now.length); i++) formDiff(old[i], now[i], `${at}[${i}]`, `${generic}[]`, out)
  } else if (isObject(old) && isObject(now)) {
    for (const [k, v] of Object.entries(old)) {
      if (k in now) formDiff(v, now[k], `${at}.${k}`, `${generic}.${k}`, out)
      else out.broken.push(`${at}.${k}: fehlt`)
    }
    for (const k of Object.keys(now)) if (!(k in old)) out.added.push(`${at}.${k}`)
  } else if (old !== now && !DISPLAY_TEXT.has(generic)) {
    out.changed.push(`${at}: ${JSON.stringify(old)} wurde ${JSON.stringify(now)}`)
  }
  return out
}

const BREAK = (n: number): string =>
  `Formbruch im JSON-Export der Abrechnung (${n} Stellen): Ein Feld der Fassung ${EXPORT_VERSION} fehlt oder hat eine andere Art. Vorhandene Felder behalten Namen, Art und Bedeutung ` +
  '(Kompatibilitätszusage, docs/daten-backup.md). Ist der Bruch gewollt: `version` anheben (`EXPORT_VERSION` in server/src/settlementExport.ts), die Änderung im CHANGELOG nennen und die neue Form als ' +
  `abrechnung-v${EXPORT_VERSION + 1}.json daneben einchecken (${REGENERATE}); abrechnung-v${EXPORT_VERSION}.json bleibt als Beleg der alten Fassung liegen. ` +
  'Liefert nur Beispiel A an dieser Stelle etwas anderes (etwa null statt eines Blocks), ist erst die Rechnung zu klären.'
const CALC = (n: number): string =>
  `Die Berechnung von Beispiel A hat sich geändert (${n} Stellen bei gleicher Form): Das ist kein Exportthema, sondern ein Befund der Rechnung. Die Fixture wird dafür nicht einfach neu erzeugt; ` +
  'erst klären, warum Beispiel A (server/testing/selfHeating.ts) anders rechnet. Ist die neue Zahl richtig und gewollt, die Fixture mit Begründung erneuern.'
const ADDED = (n: number): string =>
  `Der JSON-Export der Abrechnung hat ${n} neue Felder. Das ist additiv und erlaubt (wer den Export liest, ignoriert unbekannte Felder), \`version\` bleibt ${EXPORT_VERSION}: ` +
  `die Fixture neu erzeugen mit ${REGENERATE}, die .actual.json als abrechnung-v${EXPORT_VERSION}.json übernehmen, die neuen Felder im CHANGELOG nennen und in docs/daten-backup.md nachtragen.`

test('JSON-Export der Abrechnung: Form und Zahlen eines festen Bestands wie in der eingecheckten Fassung', () => {
  const computed = computeSettlement(selfSnapshot())
  const actual = `${JSON.stringify(settlementExportJson({ ...computed, closed: null }, { id: 'objekt-1', name: 'Beispiel A' }), null, 2)}\n`
  const file = path.join(DIR, `abrechnung-v${EXPORT_VERSION}.json`)
  if (process.env.GOLDEN === 'diff') fs.writeFileSync(path.join(DIR, `abrechnung-v${EXPORT_VERSION}.actual.json`), actual, 'utf8')
  assert.ok(fs.existsSync(file), `Zur Fassung ${EXPORT_VERSION} des JSON-Exports fehlt die Datei ${path.basename(file)}. Erzeugen mit ${REGENERATE}, dann die .actual.json unter diesem Namen einchecken.`)
  const stored: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  const now: unknown = JSON.parse(actual)
  const diff = formDiff(stored, now)
  // In dieser Reihenfolge: Ein Bruch geht vor, und eine geänderte Zahl darf nicht mit „additiv, neu erzeugen“ untergehen.
  assert.deepEqual(diff.broken.slice(0, 30), [], BREAK(diff.broken.length))
  assert.deepEqual(diff.changed.slice(0, 30), [], CALC(diff.changed.length))
  assert.deepEqual(diff.added.slice(0, 30), [], ADDED(diff.added.length))
})

test('JSON-Export der Abrechnung: der Formvergleich unterscheidet Bruch, neues Feld, andere Zahl und Anzeigetext', () => {
  const old = { version: 1, statements: [{ tenancyId: 'A', balanceCents: 100, prepaymentNote: 'ein Satz', rows: [{ shareCents: 1, basisText: '60 von 120 m²', kind: null }] }] }
  const st = old.statements[0] ?? assert.fail('keine Abrechnung')
  const row = st.rows[0] ?? assert.fail('keine Zeile')
  const withRow = (r: unknown): unknown => ({ ...old, statements: [{ ...st, rows: [r] }] })
  assert.deepEqual(formDiff(old, structuredClone(old)), { broken: [], added: [], changed: [] })
  // (a) Feld fehlt, heißt anders oder hat eine andere Art
  assert.deepEqual(formDiff(old, withRow({ basisText: row.basisText, kind: null })).broken, ['.statements[0].rows[0].shareCents: fehlt'])
  assert.deepEqual(formDiff(old, withRow({ ...row, shareCents: '1' })).broken, ['.statements[0].rows[0].shareCents: Zahl wurde Text'])
  assert.deepEqual(formDiff(old, withRow({ ...row, kind: 'co2Relief' })).broken, ['.statements[0].rows[0].kind: null wurde Text'])
  // (b) neues Feld, sonst nichts
  assert.deepEqual(formDiff(old, withRow({ ...row, neu: 1 })), { broken: [], added: ['.statements[0].rows[0].neu'], changed: [] })
  // (c) andere Zahl, andere Zahl der Zeilen
  assert.deepEqual(formDiff(old, withRow({ ...row, shareCents: 2 })).changed, ['.statements[0].rows[0].shareCents: 1 wurde 2'])
  assert.equal(formDiff(old, { ...old, statements: [{ ...st, rows: [row, row] }] }).changed.length, 1)
  // Anzeigetext: nach Art, nicht nach Wortlaut
  assert.deepEqual(formDiff(old, { ...old, statements: [{ ...st, prepaymentNote: 'anders', rows: [{ ...row, basisText: '60 von 120 Quadratmetern' }] }] }), { broken: [], added: [], changed: [] })
  assert.equal(formDiff(old, withRow({ ...row, basisText: null })).broken.length, 1)
  // Kennungen sind kein Anzeigetext
  assert.equal(formDiff(old, { ...old, statements: [{ ...st, tenancyId: 'B' }] }).changed.length, 1)
})

test('JSON-Export der Abrechnung: Kennung und Fassung stehen vorn, und die Fixture trägt dieselbe Fassung', () => {
  const stored: unknown = JSON.parse(fs.readFileSync(path.join(DIR, `abrechnung-v${EXPORT_VERSION}.json`), 'utf8'))
  if (stored === null || typeof stored !== 'object') assert.fail('die Fixture ist kein Objekt')
  assert.deepEqual(Object.keys(stored).slice(0, 2), ['format', 'version'])
  assert.equal(Reflect.get(stored, 'format'), EXPORT_FORMAT)
  assert.equal(Reflect.get(stored, 'version'), EXPORT_VERSION)
  assert.equal(EXPORT_FORMAT, 'mietfuchs-abrechnung', 'die Kennung des Formats ändert sich nie; eine neue Form bekommt eine neue Fassung')
})

const statement: ExportableSettlement['statements'][number] = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Mieter', unitName: 'EG', persons: 2, days: 365, personDays: 730, periodStart: '2025-01-01', periodEnd: '2025-12-31',
  rows: [{ costItemId: 'c1', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 60000, key: 'area', keyLabel: 'Wohnfläche', shareCents: 30000 }],
  totalShareCents: 30000, total35aCents: 0, prepaymentCents: 48000, prepaymentOverridden: false, suggestedMonthlyCents: 2500, balanceCents: 18000,
}
const settlement: ExportableSettlement = {
  period: { key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', short: false, label: '2025' },
  deadline: '2026-12-31', totalCostsCents: 60000, statements: [statement], landlord: { totalCents: 30000, rows: [] }, closed: null,
}

const CHANGED = 'Die Kopfzeile fällt unter die Kompatibilitätszusage ab 1.0 (docs/daten-backup.md, „Exporte und ihre Form“): Eine Änderung braucht einen Eintrag im CHANGELOG, und die Doku nennt die neue Kopfzeile.'

test('CSV-Export der Abrechnung: Kopfzeile wortgleich, mit und ohne Kosten der Gemeinschaft', () => {
  assert.equal(firstLine(settlementExportCsv(settlement)),
    'Mieter;Wohnung;Zeitraum von;Zeitraum bis;Zeile;Kostenart;Beschreibung;Gesamtkosten;Schlüssel;Basis;Anteil;davon Lohnanteil § 35a', CHANGED)
  const external = { ...statement, rows: statement.rows.map((r) => ({ ...r, key: 'external' as const })) }
  assert.equal(firstLine(settlementExportCsv({ ...settlement, statements: [external] })),
    'Mieter;Wohnung;Zeitraum von;Zeitraum bis;Zeile;Kostenart;Beschreibung;Gesamtkosten bzw. Anteil an der Gemeinschaft;Schlüssel;Basis;Anteil;davon Lohnanteil § 35a', CHANGED)
})

test('CSV-Export der Abrechnung: die Werte der Spalte „Zeile“ für Positionen, Summen und Ergebnis', () => {
  const kinds = (s: ExportableSettlement): string[] => settlementExportCsv(s).split('\r\n').slice(1).filter(Boolean).map((l) => l.split(';')[4] ?? '')
  assert.deepEqual(kinds(settlement), ['Position', 'Summe Ihrer Kosten', 'Geleistete Vorauszahlungen', 'Guthaben'], CHANGED)
  assert.equal(kinds({ ...settlement, statements: [{ ...statement, balanceCents: -100 }] }).at(-1), 'Nachzahlung', CHANGED)
  assert.equal(kinds({ ...settlement, statements: [{ ...statement, balanceCents: 0 }] }).at(-1), 'Ausgeglichen', CHANGED)
})

// Die Übersicht.csv des Steuer-ZIP hat vier Spielarten: Die Spalten „unentgeltlich“ (#257) und „verteilt“ (#262) stehen
// nur, wenn es so einen Teil gibt.
test('Steuer-ZIP, Übersicht.csv: Kopfzeile wortgleich in allen vier Spielarten', () => {
  const split = (over: Partial<TaxSplitOfItem>): Map<string, TaxSplitOfItem> => new Map([['c1', { privateCents: 0, deductibleCents: 100, ...over }]])
  const head = (over: Partial<TaxSplitOfItem>): string => firstLine(planTaxArchive([], new Map(), new Map(), split(over)).overviewCsv)
  assert.equal(head({}), 'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg;Jahr der Zahlung', CHANGED)
  assert.equal(head({ gratuitousCents: 1 }),
    'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);unentgeltlich § 21 Abs. 2 EStG (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg;Jahr der Zahlung', CHANGED)
  assert.equal(head({ deferredCents: 1 }),
    'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);verteilt § 82b EStDV (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg;Jahr der Zahlung', CHANGED)
  assert.equal(head({ gratuitousCents: 1, deferredCents: 1 }),
    'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);unentgeltlich § 21 Abs. 2 EStG (EUR);verteilt § 82b EStDV (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg;Jahr der Zahlung', CHANGED)
})

// Die Steuerübersicht desselben Bestands (Beispiel A, 2025): Auf die Zahlen kommt es hier nicht an, nur auf die Kopfzeile.
const noIncome = taxReport(selfSnapshot())

test('Steuer-ZIP, Einnahmen.csv: Kopfzeile wortgleich, das Jahr steht in zwei Spalten', () => {
  assert.equal(firstLine(incomeCsv(noIncome)),
    'Wohnung;Mieter;Beginn;Ende;an Angehörige vermietet;Miete ohne Umlagen (EUR);davon Inklusivmiete (EUR);davon ohne vereinbarte Miete (EUR);Umlagen laufend (EUR);davon Pauschale (EUR);' +
    'Abrechnung Nachzahlung/Erstattung (EUR);Mieten für frühere Jahre (EUR);Einnahmen 2025, Summe der Zeilen (EUR);darin aus dem Vorjahr nach der Zehn-Tage-Regel (EUR);' +
    'nicht darin, zählt im Folgejahr nach der Zehn-Tage-Regel (EUR);gezahlt 2025 laut Datum, zum Abgleich mit dem Kontoauszug (EUR)', CHANGED)
})

test('alle CSV-Exporte: Byte-Order-Mark, Semikolon, Zeilenende CRLF', () => {
  for (const [name, csv] of [['Abrechnung', settlementExportCsv(settlement)], ['Übersicht.csv', planTaxArchive([], new Map()).overviewCsv], ['Einnahmen.csv', incomeCsv(noIncome)]] as const) {
    assert.ok(csv.startsWith('﻿'), `${name}: Byte-Order-Mark`)
    assert.ok(csv.endsWith('\r\n') && !csv.replace(/\r\n/g, '').includes('\n'), `${name}: Zeilenende CRLF`)
    assert.ok(firstLine(csv).includes(';'), `${name}: Semikolon`)
  }
})

// Die Nutzerdoku nennt die Form, auf die sich die Zusage bezieht. Steht dort etwas anderes als im Programm, gilt keins.
test('docs/daten-backup.md nennt die Fassung des JSON-Exports, sein Beispiel, seine Felder und jede Kopfzeile wortgleich', () => {
  const doc = fs.readFileSync(path.join(DIR, '..', '..', '..', '..', 'docs', 'daten-backup.md'), 'utf8')
  const need = (text: string): void => assert.ok(doc.includes(text), `In docs/daten-backup.md („Exporte und ihre Form“) fehlt: ${text}`)
  need(`"format": "${EXPORT_FORMAT}"`)
  need(`"version": ${EXPORT_VERSION}`)
  need(`server/test/fixtures/export/abrechnung-v${EXPORT_VERSION}.json`)
  need(`\`${firstLine(settlementExportCsv(settlement))}\``)
  need(`\`${firstLine(planTaxArchive([], new Map()).overviewCsv)}\``)
  need(`\`${firstLine(incomeCsv(noIncome))}\``)
  for (const column of ['Gesamtkosten bzw. Anteil an\nder Gemeinschaft', 'unentgeltlich § 21 Abs. 2 EStG (EUR)', 'verteilt § 82b EStDV (EUR)']) need(`\`${column}\``)
  // Die Felder der obersten Ebene, je Mieter und je Zeile, wie die Tabelle sie nennt.
  const json = settlementExportJson(settlement, { id: 'p', name: 'H' })
  const first = json.statements[0] ?? assert.fail('keine Abrechnung')
  for (const key of [...Object.keys(json), ...Object.keys(first), ...Object.keys(first.rows[0] ?? assert.fail('keine Zeile'))]) need(`\`${key}\``)
})
