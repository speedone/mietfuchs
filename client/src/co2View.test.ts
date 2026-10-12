import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { co2Block } from './co2View'
import { periodKey } from '../../shared/period.ts'
import type { Co2Assessment, Co2HalfSplit, HeatingStatement } from './types'

// `node:assert` gibt es im Client nicht; für die eine Stelle, die ohne Block abbrechen soll.
const assert = { fail: (text: string): never => { throw new Error(text) } }
const TABELLE = [[0, 12, 0], [12, 17, 10], [17, 22, 20], [22, 27, 30], [27, 32, 40], [32, 37, 50], [37, 42, 60], [42, 47, 70], [47, 52, 80], [52, null, 95]]
  .map(([from, to, landlordPercent]) => ({ from: from ?? 0, to: to ?? null, landlordPercent: landlordPercent ?? 0 }))
const bewertung = (over: Partial<Co2Assessment> = {}): Co2Assessment => ({
  method: 'serviceDeducted', booked: true, deducted: true, totalCents: 25000, landlordCents: 8750, landlordPermille: 350, kgPerM2: 46.4,
  emissionsKg: null, areaM2: null, stage: { from: 42, to: 47, landlordPercent: 70 }, table: TABELLE, shortened: false,
  selfLandlordCents: null, selfApproximated: false, tenants: [{ tenancyId: 'ta', landlordCents: 2511, tenantCents: 4662, approximated: true }], ...over,
})
const anlage = (co2: Co2Assessment | null): HeatingStatement => ({ plantId: 'hp', plantName: 'Gas', energy: 'gas', period: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', co2 })

test('Druckblock (§ 7 Abs. 3 CO2KostAufG): Anteil des Mieters, Einstufung mit markierter Stufe, Grundlagen laut Messdienst', () => {
  const v = co2Block(anlage(bewertung()), 'ta') ?? assert.fail('kein Block')
  expect(v.title).toBe('CO₂-Kostenaufteilung')
  expect(v.lines.map((l) => l.label)).toEqual([
    'Energieträger', 'Heizperiode', 'CO₂-Ausstoß je m² und Jahr', 'Anteil des Vermieters laut Abrechnung', 'CO₂-Kosten insgesamt',
    'davon trägt der Vermieter', 'Ihr Anteil an den CO₂-Kosten', 'vom Vermieter übernommen (bereits abgezogen)',
  ])
  expect(v.lines.find((l) => l.label === 'CO₂-Ausstoß je m² und Jahr')?.value).toBe('46,4 kg')
  expect(v.lines.find((l) => l.label === 'Anteil des Vermieters laut Abrechnung')?.value).toBe('35 %')
  expect(v.lines.find((l) => l.label === 'vom Vermieter übernommen (bereits abgezogen)')?.value).toBe(`${fmtEuro(2511)} (näherungsweise nach Ihrem Anteil an den Heizkosten; maßgeblich ist der Betrag in der Einzelabrechnung des Messdienstes)`)
  expect(v.table.filter((s) => s.marked)).toEqual([{ range: '42 bis unter 47 kg', percent: '70 %', marked: true }])
  expect(v.table.at(-1)).toEqual({ range: 'ab 52 kg', percent: '95 %', marked: false })
  expect(v.notes).toEqual(['Angaben laut Abrechnung des Messdienstes oder der Gemeinschaft (§ 7 Abs. 3 CO2KostAufG).'])
  // Ein Anteil, der aus dem Betrag laut Messdienst folgt, ist nicht genähert (Durchsicht I3).
  const genau = co2Block(anlage(bewertung({ tenants: [{ tenancyId: 'ta', landlordCents: 2500, tenantCents: 4643, approximated: false, tenantApproximated: false }] })), 'ta') ?? assert.fail('kein Block')
  // Aus dem gerundeten Betrag berechnet, also nicht centgenau (Nachprüfung 3): als berechnet gekennzeichnet.
  expect(genau.lines.find((l) => l.label === 'Ihr Anteil an den CO₂-Kosten')?.value).toBe(`≈ ${fmtEuro(4643)} (aus dem Betrag laut Abrechnung berechnet)`)
  // Weicht der Anteil laut Abrechnung von der Stufe ab, sagt der Druck es und nennt den Grund nicht selbst (Durchsicht I2).
  const ab = co2Block(anlage(bewertung({ stageMatches: false })), 'ta') ?? assert.fail('kein Block')
  expect(ab.notes).toContain('Der Anteil des Vermieters laut Abrechnung (35 %) weicht von der markierten Stufe ab (70 %). Den Grund nennt die Abrechnung des Messdienstes, etwa eine Kürzung nach § 9 CO2KostAufG.')
})

test('Kein Block ohne Buchung, ohne Angaben oder für einen Mieter ohne Heizkosten; kurze Heizperiode mit Hinweis', () => {
  expect(co2Block(anlage(null), 'ta')).toBeNull()
  expect(co2Block(anlage(bewertung({ booked: false })), 'ta')).toBeNull()
  expect(co2Block(anlage(bewertung()), 'tx')).toBeNull()
  const kurz = co2Block(anlage(bewertung({ shortened: true, deducted: false, method: 'serviceShown' })), 'ta') ?? assert.fail('kein Block')
  expect(kurz.notes).toContain('Die Heizperiode ist kürzer als ein Jahr; die Grenzen der Stufentabelle sind anteilig gekürzt (§ 5 Abs. 1 Satz 4 CO2KostAufG).')
  expect(kurz.lines.at(-1)?.label).toBe('vom Vermieter übernommen (eigene Zeile)')
})

test('Eigene Aufteilung: berechnet aus den Rechnungen, Ausstoß umgerechnet, Fläche mit Herkunft, § 8 und § 9', () => {
  const eigen = bewertung({
    method: 'self', deducted: false, basis: 'deliveries', coveragePermille: 848.71, emissionsKg: 24105.6, areaM2: 600, areaSource: 'served',
    kgPerM2: 40.2, landlordPermille: 300, totalCents: 77379, landlordCents: 23214, stage: { from: 37, to: 42, landlordPercent: 60 },
    adjustments: ['restrictionHalf'], tenants: [{ tenancyId: 'ta', landlordCents: 11607, tenantCents: 27083, approximated: false }],
  })
  const v = co2Block(anlage(eigen), 'ta') ?? assert.fail('kein Block')
  expect(v.lines.find((l) => l.label === 'CO₂-Ausstoß, umgerechnet auf die Heizperiode')?.value).toBe('24.105,6 kg (die Rechnungen decken 848,7 ‰ der Gradtage ab)')
  expect(v.lines.find((l) => l.label === 'Wohnfläche der Einstufung')?.value).toBe('600 m² (versorgte Wohnungen)')
  expect(v.lines.find((l) => l.label === 'Anteil des Vermieters')?.value).toBe('30 %')
  expect(v.lines.at(-1)).toEqual({ label: 'vom Vermieter übernommen (eigene Zeile)', value: `${fmtEuro(11607)} (nach Ihrem Anteil an den Brennstoffkosten)` })
  expect(v.notes).toEqual([
    'Berechnet von Mietfuchs aus den Rechnungen des Versorgers (§ 7 Abs. 3 CO2KostAufG); der Ausstoß ist auf die Heizperiode umgerechnet (§ 5 Abs. 1 Satz 5 CO2KostAufG).',
    'Der Anteil des Vermieters ist wegen öffentlich-rechtlicher Vorgaben um die Hälfte gekürzt (§ 9 Abs. 1 CO2KostAufG).',
  ])
})

test('Eigene Aufteilung aus dem Vorrat (Heizung PR 8): Ausstoß des verbrauchten Brennstoffs, ohne Gradtage', () => {
  const vorrat = bewertung({
    method: 'self', deducted: false, basis: 'stock', coveragePermille: 1000, emissionsKg: 15254.91, areaM2: 300, areaSource: 'served',
    kgPerM2: 50.8, landlordPermille: 800, totalCents: 64810, landlordCents: 51848, stage: { from: 47, to: 52, landlordPercent: 80 },
    tenants: [{ tenancyId: 'ta', landlordCents: 17283, tenantCents: 4321, approximated: false }],
  })
  const v = co2Block(anlage(vorrat), 'ta') ?? assert.fail('kein Block')
  expect(v.lines.find((l) => l.label === 'CO₂-Ausstoß des verbrauchten Brennstoffs')?.value).toBe('15.254,9 kg (Anfangsbestand + Lieferungen − Endbestand)')
  expect(v.notes[0]).toMatch(/aus den Lieferungen und dem Vorrat/)
})

// Heizung PR 16 (Prüfung C-S3): Bei Contracting nennt der Ausweis die Wärmelieferung mit dem Brennstoff des Lieferanten.
test('Contracting: der Ausweis nennt Wärmelieferung mit Brennstoff', () => {
  const v = co2Block({ ...anlage(bewertung()), energy: 'districtHeating', contracting: true, fuelEnergy: 'gas' }, 'ta') ?? assert.fail('kein Block')
  expect(v.lines.find((l) => l.label === 'Energieträger')?.value).toBe('Wärmelieferung (Contracting, erzeugt mit Gas)')
})

// ---------- Hälftige Teilung nach § 5a (Heizung PR 18, Entwurf 9.5) ----------

const eigen = (halfSplit: Co2HalfSplit, adjustments: Co2Assessment['adjustments'] = ['halfSplit']): HeatingStatement => anlage(bewertung({
  method: 'self', deducted: false, basis: 'deliveries', landlordPermille: 547, adjustments, halfSplit,
  tenants: [{ tenancyId: 'ta', landlordCents: 21163, tenantCents: 17526, approximated: false }],
}))

test('Ausweis: § 5a anteilig mit Netzentgelten (Entwurf 9.5)', () => {
  const view = co2Block(eigen({ co2SharePermille: 530, landlordGridFeeCents: 7950, landlordBioCents: 0, basis: 'existing', twoFamily: null }), 'ta') ?? assert.fail('kein Block')
  expect(view.lines).toEqual(expect.arrayContaining([
    { label: 'Hälftige Teilung nach § 5a CO2KostAufG', value: '53 % der CO₂-Kosten nach Anfall' },
    { label: 'Netzentgelte: Anteil des Vermieters', value: fmtEuro(7950) },
  ]))
  expect(view.lines.some((l) => l.label.startsWith('Biobrennstoff'))).toBe(false)
  // Die Teilung ist keine Beschränkung nach § 9: kein Satz über § 9 Abs. 2.
  expect(view.notes.some((n) => /§ 9/.test(n))).toBe(false)
  expect(view.notes).toContain('Bei einer Heizung nach § 43 Abs. 1 GModG tragen Vermieter und Mieter die CO₂-Kosten ab 2028 je zur Hälfte (§ 5a Abs. 3 CO2KostAufG); der Anteil des Vermieters mischt die Stufe und die Hälfte nach dem Anfall in der Heizperiode.')
  const zfh = co2Block(eigen({ co2SharePermille: 0, landlordGridFeeCents: null, landlordBioCents: null, basis: 'existing', twoFamily: 'excepted' }, ['twoFamily']), 'ta') ?? assert.fail('kein Block')
  expect(zfh.notes).toEqual(expect.arrayContaining(['Zweifamilienhaus mit Eigennutzung: keine hälftige Teilung (§ 5d Abs. 3 CO2KostAufG).']))
  expect(zfh.notes.some((n) => /§ 9/.test(n))).toBe(false)
  const neu = co2Block(eigen({ co2SharePermille: 1000, landlordGridFeeCents: 0, landlordBioCents: 1200, basis: 'newBuilding', twoFamily: null }), 'ta') ?? assert.fail('kein Block')
  expect(neu.lines).toEqual(expect.arrayContaining([{ label: 'Biobrennstoff: Anteil des Vermieters', value: fmtEuro(1200) }]))
  expect(neu.notes).toContain('Neubau: hälftige Teilung nach § 5b CO2KostAufG.')
})
