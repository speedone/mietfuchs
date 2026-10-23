// Export der fertigen Abrechnung als Daten (#415, Teil 3): die reine Funktion, die aus dem Ergebnis die
// Exportform baut. Die Route prüft api-abrechnung-export.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodKey } from '../../shared/period.ts'
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
