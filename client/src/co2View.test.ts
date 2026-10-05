import { expect, test } from 'vitest'
import { fmtEuro } from './api'
import { co2Block } from './co2View'
import { periodKey } from '../../shared/period.ts'
import type { Co2Assessment, HeatingStatement } from './types'

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
