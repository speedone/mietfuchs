// Kompatibilitätszusage ab 1.0 (#447), Teil „Exportformate“: Die Form der Exporte ist hier gebunden, damit sie sich
// nicht nebenbei ändert. Was die Zusage meint, steht in docs/daten-backup.md („Exporte und ihre Form“):
//
// - **JSON-Export der Abrechnung** (`format: mietfuchs-abrechnung`, `version`): der ganze Export eines festen Bestands
//   wortgleich gegen die eingecheckte Datei fixtures/export/abrechnung-v<version>.json. Der Bestand ist Beispiel A
//   der eigenen Heizkostenabrechnung (server/testing/selfHeating.ts), weil er jeden Teil der Form füllt (Positionen,
//   Sonderzeilen, Heizungsblöcke).
// - **CSV-Export der Abrechnung** und **die beiden CSV-Dateien des Steuer-ZIP**: die Kopfzeile jeder Datei wortgleich,
//   in jeder ihrer Spielarten.
//
// **Die Fixture wird nie von selbst überschrieben.** Wer die Form bewusst ändert, startet mit
//     GOLDEN=diff node --test test/export-zusage.test.ts      (im Ordner server/)
// dann liegt das Ist-Ergebnis als abrechnung-v<version>.actual.json daneben. Die Übernahme ist ein eigener,
// begründeter Schritt: `EXPORT_VERSION` anheben, die Änderung im CHANGELOG nennen, die Datei unter dem Namen der
// neuen Fassung einchecken.
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

test('JSON-Export der Abrechnung: der ganze Export eines festen Bestands, wortgleich mit der eingecheckten Fassung', () => {
  const computed = computeSettlement(selfSnapshot())
  const actual = `${JSON.stringify(settlementExportJson({ ...computed, closed: null }, { id: 'objekt-1', name: 'Beispiel A' }), null, 2)}\n`
  const file = path.join(DIR, `abrechnung-v${EXPORT_VERSION}.json`)
  if (process.env.GOLDEN === 'diff') fs.writeFileSync(path.join(DIR, `abrechnung-v${EXPORT_VERSION}.actual.json`), actual, 'utf8')
  assert.ok(fs.existsSync(file), `Zur Fassung ${EXPORT_VERSION} des JSON-Exports fehlt die Datei ${path.basename(file)}. Erzeugen mit ${REGENERATE}, dann die .actual.json unter diesem Namen einchecken.`)
  assert.equal(actual, fs.readFileSync(file, 'utf8'),
    'Die Form des JSON-Exports der Abrechnung hat sich geändert (oder eine Zahl von Beispiel A). Der Export fällt unter die Kompatibilitätszusage ab 1.0 ' +
    '(docs/daten-backup.md): `version` anheben (`EXPORT_VERSION` in server/src/settlementExport.ts) und die Änderung im CHANGELOG nennen, dann die Fixture neu erzeugen mit ' +
    `${REGENERATE} und die .actual.json als abrechnung-v<neue Fassung>.json einchecken. ` +
    'Hat sich nur eine Zahl geändert und nicht die Form, ist das eine fachliche Frage an die Rechnung und keine an diese Datei.')
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
