import { describe, expect, it } from 'vitest'
import { contractBody, contractToForm, dwdHint, infoBody, infoToForm } from './heatingInfoForm'
import { AGREED_OPTIONS, EXEMPTION_OPTIONS, EXEMPTION_SCOPE_OPTIONS, inheritedText, MONTHLY_ELSEWHERE_LABEL } from './heatingRulesForm'

const info = { infoTaxesText: null, infoDistrictGhg: null, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: null, climateFactorSource: 'DWD', infoReferenceKwhPerM2: null, infoReferenceSource: null, postalCode: '79100' }

describe('Angaben nach § 6a (Heizung PR 14)', () => {
  it('Formular aus der Ansicht und zurück; Komma als Dezimalzeichen, deutsche Tausender', () => {
    const f = infoToForm(info)
    expect([f.climateFactor, f.climateSource]).toEqual(['1,08', 'DWD'])
    expect(infoBody({ ...f, climateFactorPrev: '1,15', taxes: ' Energiesteuer 312,00 € ', ghg: '1.200' })).toEqual({ body: {
      infoTaxesText: 'Energiesteuer 312,00 €', infoDistrictGhg: 1200, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: 1.15, climateFactorSource: 'DWD',
      infoReferenceKwhPerM2: null, infoReferenceSource: null,
    } })
  })
  it('Nr. 4: Vergleichswert über 0 und nur mit Quelle', () => {
    expect(infoBody({ ...infoToForm(info), reference: '120' })).toEqual({ error: expect.stringMatching(/Quelle des Vergleichswerts.*eigenen Haus/) })
    expect(infoBody({ ...infoToForm(info), reference: '0', referenceSource: 'Ablesedienst' })).toEqual({ error: expect.stringMatching(/Vergleichswert.*größer als 0/) })
    expect(infoBody({ ...infoToForm(info), reference: '120,5', referenceSource: ' Ablesedienst 2025 ' })).toMatchObject({ body: { infoReferenceKwhPerM2: 120.5, infoReferenceSource: 'Ablesedienst 2025' } })
  })
  it('Nr. 5: Klimafaktor über 0 und nur mit Quelle; Unsinn wird abgelehnt statt gelesen', () => {
    expect(infoBody({ ...infoToForm(info), climateFactor: '0' })).toEqual({ error: expect.stringMatching(/Klimafaktor.*größer als 0/) })
    expect(infoBody({ ...infoToForm(info), climateFactor: '1,0,8' })).toEqual({ error: expect.stringMatching(/Klimafaktor/) })
    expect(infoBody({ ...infoToForm(info), climateSource: ' ' })).toEqual({ error: expect.stringMatching(/Quelle der Klimafaktoren/) })
  })
  it('Verbrauchervertrag: Text Pflicht, wenn „ja“; „Bitte wählen“ heißt unbeantwortet', () => {
    expect(contractBody({ contract: 'yes', disputeText: ' ' })).toEqual({ error: expect.stringMatching(/Streitbeilegung/) })
    expect(contractBody({ contract: '', disputeText: '' })).toEqual({ body: { consumerContract: null } })
    expect(contractBody({ contract: 'none', disputeText: '' })).toEqual({ body: { consumerContract: 'none' } })
    expect(contractToForm('Wir nehmen nicht teil.')).toEqual({ contract: 'yes', disputeText: 'Wir nehmen nicht teil.' })
  })
  it('Hinweis zum DWD mit Postleitzahl und Zeitraum', () => {
    expect(dwdHint('79100', '2025-01-01', '2025-12-31')).toMatch(/Postleitzahl 79100, Zeitraum 01\.01\.2025 bis 31\.12\.2025/)
    expect(dwdHint(null, '2025-01-01', '2025-12-31')).toMatch(/Adresse des Objekts mit Postleitzahl/)
  })
})

describe('§ 11 und § 2 (Entwurf 8.9)', () => {
  it('Ausnahmen mit den Zahlen des Registers, ohne Heime und Hausanlagen', () => {
    expect(EXEMPTION_OPTIONS.map((o) => o.value)).toEqual(['none', 'lowDemand', 'disproportionate', 'pre1981', 'renewable', 'authority'])
    expect(EXEMPTION_OPTIONS.find((o) => o.value === 'lowDemand')?.label).toMatch(/weniger als 15 kWh je m² und Jahr/)
    expect(EXEMPTION_OPTIONS.find((o) => o.value === 'pre1981')?.label).toMatch(/vor dem 01\.07\.1981 bezugsfertig/)
    expect(EXEMPTION_OPTIONS.find((o) => o.value === 'disproportionate')?.label).toMatch(/10 Jahren/)
    expect(EXEMPTION_OPTIONS.find((o) => o.value === 'renewable')?.label).toMatch(/bis 30\.09\.2024 auch Wärmepumpen/)
    expect(EXEMPTION_SCOPE_OPTIONS.map((o) => o.value)).toEqual(['heat', 'both'])
    expect(AGREED_OPTIONS.map((o) => o.value)).toEqual(['none', 'area', 'fixedPercent', 'consumption'])
  })
  it('„Mitteilen“: ein Portal nur mit einer Nachricht jeden Monat', () => {
    expect(MONTHLY_ELSEWHERE_LABEL).toMatch(/Portal mit einer Nachricht jeden Monat/)
  })
  it('geerbte Angabe nennt die Heizperiode, aus der sie stammt', () => {
    expect(inheritedText('2024-01', '2025-01')).toBe('Übernommen aus der Heizperiode 2024; eine Änderung gilt ab dieser Heizperiode.')
    expect(inheritedText('2024-07', '2025-07')).toMatch(/07\/2024/)
    expect(inheritedText('2025-01', '2025-01')).toBeNull()
    expect(inheritedText(null, '2025-01')).toBeNull()
  })
})
