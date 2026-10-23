// Export der fertigen Abrechnung als Daten (#415, Teil 3): die reine Funktion, die aus dem Ergebnis die
// Exportform baut. Die Route prüft api-abrechnung-export.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodKey } from '../../shared/period.ts'
import { computeSettlement } from '../src/calc.ts'
import { selfSnapshot } from '../testing/selfHeating.ts'
import { textField } from '../src/taxReceipts.ts'
import { exportFilename, settlementExportCsv, settlementExportJson, type ExportableSettlement } from '../src/settlementExport.ts'

const statement: ExportableSettlement['statements'][number] = {
  tenancyId: 't1', unitId: 'u1', tenantName: '=HYPERLINK("x")', unitName: 'EG', persons: 2, days: 365, personDays: 730,
  periodStart: '2025-01-01', periodEnd: '2025-12-31',
  rows: [
    { costItemId: 'c1', category: 'Grundsteuer', description: 'Grundsteuer; Haus "A"', totalCents: 60000, key: 'area', keyLabel: 'Wohnfläche', basisText: '60 von 120 m²', shareCents: 30000, labor35aCents: 1234 },
    { costItemId: 'c2', category: 'Versicherung', description: '-Gutschrift', totalCents: -1000, key: 'area', keyLabel: 'Wohnfläche', shareCents: -500 },
  ],
  totalShareCents: 29500, total35aCents: 1234, prepaymentCents: 48000, prepaymentOverridden: false, suggestedMonthlyCents: 4000, balanceCents: 18500,
}
const settlement: ExportableSettlement = {
  period: { key: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', short: false, label: '2025' },
  deadline: '2026-12-31', totalCostsCents: 59000, statements: [statement],
  landlord: { totalCents: 29500, rows: [] }, closed: null,
}

test('JSON: Version, Cent als ganze Zahlen, alle gedruckten Zahlen', () => {
  const json = settlementExportJson(settlement, { id: 'p1', name: 'Lindenweg 12' })
  assert.equal(json.format, 'mietfuchs-abrechnung')
  assert.equal(json.version, 1)
  assert.deepEqual(json.property, { id: 'p1', name: 'Lindenweg 12' })
  assert.equal(json.period.label, '2025')
  assert.equal(json.totalCostsCents, 59000)
  const st = json.statements[0] ?? assert.fail('keine Abrechnung')
  assert.equal(st.balanceCents, 18500)
  assert.equal(st.prepaymentCents, 48000)
  assert.equal(st.rows[0]?.shareCents, 30000)
  assert.equal(st.rows[0]?.basisText, '60 von 120 m²')
  assert.equal(st.rows[0]?.labor35aCents, 1234)
  for (const n of [st.totalShareCents, st.prepaymentCents, st.balanceCents, ...st.rows.map((r) => r.totalCents)]) assert.ok(Number.isInteger(n))
  assert.equal(json.closed, null)
})

test('CSV: BOM, Semikolon, deutsche Beträge, Schutz gegen Formeln und Anführungszeichen', () => {
  const csv = settlementExportCsv(settlement)
  assert.ok(csv.startsWith('﻿'))
  const lines = csv.slice(1).split('\r\n')
  assert.equal(lines.at(-1), '')
  assert.equal(lines[0], 'Mieter;Wohnung;Zeitraum von;Zeitraum bis;Zeile;Kostenart;Beschreibung;Gesamtkosten;Schlüssel;Basis;Anteil;davon Lohnanteil § 35a')
  assert.ok(lines.includes(`'=HYPERLINK(""x"")`.replace(/^/, '"') + '";EG;2025-01-01;2025-12-31;Position;Grundsteuer;"Grundsteuer; Haus ""A""";600,00;Wohnfläche;60 von 120 m²;300,00;12,34'), lines.join('\n'))
  assert.ok(lines.some((l) => l.includes(`;'-Gutschrift;-10,00;Wohnfläche;;-5,00;`)), 'Gutschrift bleibt negativ, Text entschärft')
  assert.ok(lines.some((l) => l.includes(';Summe Ihrer Kosten;') && l.includes(';295,00;12,34')))
  assert.ok(lines.some((l) => l.includes(';Geleistete Vorauszahlungen;') && l.includes(';480,00')))
  assert.ok(lines.some((l) => l.includes(';Guthaben;') && l.includes(';185,00')))
})

test('CSV: Nachzahlung als negativer Saldo benannt', () => {
  const csv = settlementExportCsv({ ...settlement, statements: [{ ...statement, balanceCents: -2000 }] })
  assert.ok(csv.includes(';Nachzahlung;') && csv.includes(';20,00'))
})

test('Dateiname mit Objekt und Zeitraum, ohne Sonderzeichen', () => {
  assert.equal(exportFilename('Lindenweg 12 / Süd', '2025/2026', 'csv'), 'abrechnung-Lindenweg-12-Süd-2025-2026.csv')
  assert.equal(exportFilename('', '2025', 'json'), 'abrechnung-objekt-2025.json')
})

test('JSON: Heizungsblöcke, Art der Zeile und die Angaben je Mieter wie gedruckt (M1)', () => {
  const computed = computeSettlement(selfSnapshot())
  assert.ok((computed.heating ?? []).length > 0, 'der Bestand hat eine Heizanlage')
  const json = settlementExportJson({ ...computed, closed: null }, { id: 'p', name: 'Haus' })
  assert.deepEqual(json.heating, computed.heating)
  const first = computed.statements[0] ?? assert.fail('keine Abrechnung')
  const st = json.statements[0] ?? assert.fail('keine Abrechnung')
  assert.equal(st.prepaymentNote, first.prepaymentNote ?? null)
  assert.equal(st.heatingPrepaymentCents, first.heatingPrepaymentCents ?? null)
  assert.equal(st.suggestedMonthlyCents, first.suggestedMonthlyCents)
  assert.equal(st.prepaymentOverridden, first.prepaymentOverridden)
  assert.equal(st.recommendedDeadline, first.recommendedDeadline ?? null)
  assert.ok(json.statements.flatMap((x) => x.rows).every((r) => r.kind === null || typeof r.kind === 'string'))
})

test('JSON: gewählte Anpassung der Vorauszahlung aus dem Anschreiben', () => {
  const letters = { t1: { adjustment: { mode: 'custom', newCents: 5000 } } } as unknown as ExportableSettlement['letters']
  const json = settlementExportJson({ ...settlement, letters }, { id: 'p1', name: 'H' })
  assert.deepEqual(json.statements[0]?.adjustment, { mode: 'custom', newCents: 5000 })
  assert.equal(settlementExportJson(settlement, { id: 'p1', name: 'H' }).statements[0]?.adjustment, null)
})

test('CSV: Sonderzeilen tragen ihre Art statt „Position“; Hinweis auf das JSON bei Heizungsangaben', () => {
  const co2 = { ...statement.rows[0]!, costItemId: 'co2:p:2025', kind: 'co2Relief' as const, category: 'Heizung', description: 'CO₂-Anteil Vermieter' }
  const heating = [{ plantId: 'hp' }] as unknown as ExportableSettlement['heating']
  const csv = settlementExportCsv({ ...settlement, heating, statements: [{ ...statement, rows: [co2] }] })
  const lines = csv.slice(1).split('\r\n')
  assert.equal(lines[0], 'Angaben der Heizkostenabrechnung (§ 6a, CO₂, Vorrat) nur im JSON-Export')
  assert.ok(lines.some((l) => l.includes(';CO₂-Anteil des Vermieters;')), lines.join('\n'))
  assert.ok(!lines.slice(1).some((l) => l.includes(';Position;')))
  assert.ok(!settlementExportCsv(settlement).includes('nur im JSON-Export'))
})

test('CSV: Spaltenkopf nennt die Gemeinschaft, sobald es eine solche Zeile gibt (K8)', () => {
  const ext = { ...statement.rows[0]!, key: 'external' as const }
  assert.match(settlementExportCsv({ ...settlement, statements: [{ ...statement, rows: [ext] }] }), /;Gesamtkosten bzw\. Anteil an der Gemeinschaft;/)
  assert.match(settlementExportCsv(settlement), /;Gesamtkosten;/)
})

test('Entwurf: Fehler der Abrechnung stehen im JSON (draft, errors) und in der CSV (S3); eine abgeschlossene nie', () => {
  const notices = [{ code: 'tenancy.overlap', level: 'error', title: 'Mietverhältnisse überschneiden sich', text: 'x' }] as unknown as ExportableSettlement['notices']
  const json = settlementExportJson({ ...settlement, notices }, { id: 'p', name: 'H' })
  assert.equal(json.draft, true)
  assert.deepEqual(json.errors, [{ code: 'tenancy.overlap', title: 'Mietverhältnisse überschneiden sich' }])
  assert.ok(settlementExportCsv({ ...settlement, notices }).slice(1).startsWith('Entwurf, nicht versenden'))
  const closed = { ...settlement, notices, closed: { closedAt: '2026-01-01T00:00:00Z', sentAt: null } }
  assert.equal(settlementExportJson(closed, { id: 'p', name: 'H' }).draft, false)
  assert.deepEqual(settlementExportJson(closed, { id: 'p', name: 'H' }).errors, [])
  assert.equal(settlementExportJson(settlement, { id: 'p', name: 'H' }).draft, false)
})

test('textField: Formelzeichen auch nach Leerraum und geschütztem Leerzeichen entschärfen (K7)', () => {
  for (const v of [' =1+1', '\u00a0=1+1', '\t+SUM(A1)', '  @x', '\r-1', '\u00a0 -x']) assert.ok(textField(v).replace(/^"/, '').startsWith("'"), JSON.stringify(v))
  assert.equal(textField('Müll'), 'Müll')
})
