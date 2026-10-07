import { describe, expect, it } from 'vitest'
import { contractBody, contractToForm, dwdHint, infoBody, infoToForm } from './heatingInfoForm'
import { AGREED_OPTIONS, asksScope, billingText, EXEMPTION_NOT_OFFERED, EXEMPTION_OPTIONS, EXEMPTION_SCOPE_OPTIONS, inheritedText, laterClosedText, MONTHLY_ELSEWHERE_LABEL } from './heatingRulesForm'
import { CONTRACT_HELP, CONTRACT_OPTIONS } from './heatingInfoForm'

const info = { infoTaxesText: null, infoDistrictGhg: null, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: null, climateFactorSource: 'DWD', infoReferenceKwhPerM2: null, infoReferenceSource: null, infoComparisonSource: null, postalCode: '79100' }

describe('Angaben nach § 6a (Heizung PR 14)', () => {
  it('Formular aus der Ansicht und zurück; Komma als Dezimalzeichen, deutsche Tausender', () => {
    const f = infoToForm(info)
    expect([f.climateFactor, f.climateSource]).toEqual(['1,08', 'DWD'])
    expect(infoBody({ ...f, climateFactorPrev: '1,15', taxes: ' Energiesteuer 312,00 € ', ghg: '1.200' })).toEqual({ body: {
      infoTaxesText: 'Energiesteuer 312,00 €', infoDistrictGhg: 1200, infoDistrictPef: null, climateFactor: 1.08, climateFactorPrev: 1.15, climateFactorSource: 'DWD',
      infoReferenceKwhPerM2: null, infoReferenceSource: null, infoComparisonSource: null,
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
    expect(EXEMPTION_OPTIONS.map((o) => o.value)).toEqual(['none', 'lowDemand', 'disproportionate', 'pre1981', 'renewable', 'chp', 'authority'])
    const text = (v: string) => EXEMPTION_OPTIONS.find((o) => o.value === v)?.text ?? ''
    expect(text('lowDemand')).toMatch(/weniger als 15 kWh je m² und Jahr/)
    expect(text('pre1981')).toMatch(/vor dem 01\.07\.1981 bezugsfertig/)
    // Durchsicht von #243, R-K1: Nr. 1 b mit dem ganzen Wortlaut.
    expect(text('disproportionate')).toMatch(/das Anbringen der Ausstattung zur Verbrauchserfassung, die Erfassung des Wärmeverbrauchs oder die Verteilung der Kosten des Wärmeverbrauchs nicht oder nur mit unverhältnismäßig hohen Kosten.*10 Jahren/)
    // R-W7: Die Bedingung des Buchst. b steht nicht bei Buchst. a.
    expect(text('renewable')).toMatch(/bis zum 30\.09\.2024 beginnen, auch aus Wärmepumpen/)
    expect(text('renewable')).not.toMatch(/sofern|nicht erfasst/)
    expect(text('chp')).toMatch(/Kraft-Wärme-Kopplung.*sofern der Wärmeverbrauch des Gebäudes nicht erfasst wird \(§ 11 Abs\. 1 Nr\. 3 Buchst\. b/)
    // R-K6: kurze Beschriftungen, damit das Auswahlfeld nichts abschneidet.
    expect(Math.max(...EXEMPTION_OPTIONS.map((o) => o.label.length))).toBeLessThanOrEqual(45)
    // Runde 2, R2-N-K6: Nr. 5 mit ihrem Zweck.
    expect(text('authority')).toMatch(/um einen unangemessenen Aufwand oder sonstige unbillige Härten zu vermeiden/)
    // R-K2: was nicht zur Wahl steht.
    expect(EXEMPTION_NOT_OFFERED).toMatch(/Pflegeheime.*Nr\. 2.*Hausanlagen.*Nr\. 4/s)
    expect(EXEMPTION_SCOPE_OPTIONS.map((o) => o.value)).toEqual(['heat', 'both'])
    expect(AGREED_OPTIONS.map((o) => o.value)).toEqual(['none', 'area', 'fixedPercent', 'consumption'])
  })
  it('Durchsicht von #243: Umfang nur mit Warmwasser (R-K6), CO₂-Satz je Umfang (R-W8), Rückfrage bei abgeschlossenen (G-K1), Verbrauchervertrag (R-K5)', () => {
    expect(asksScope({ exemption: 'lowDemand' }, false)).toBe(false)
    expect(asksScope({ exemption: 'lowDemand' }, true)).toBe(true)
    expect(billingText('both')).toMatch(/^Nur dann werden unter einer Ausnahme für Wärme und Warmwasser die CO₂-Kosten/)
    expect(billingText('heat')).toMatch(/teilt Mietfuchs die CO₂-Kosten ohnehin weiter auf.*BT-Drs\. 20\/3172, S\. 28; Auslegung von Mietfuchs/)
    expect(laterClosedText([])).toBeNull()
    expect(laterClosedText(['2025-01'])).toMatch(/Die Heizperiode 2025 ist abgeschlossen und bleibt, wie sie abgerechnet wurde\. Die nächste offene Heizperiode übernimmt die Angabe an ihr vorbei/)
    expect(laterClosedText(['2025-01', '2026-01'])).toMatch(/Die Heizperioden 2025 und 2026 sind abgeschlossen/)
    expect(CONTRACT_HELP).toMatch(/Unternehmer \(§ 14 BGB\).*Verbraucher ist \(§ 13 BGB\).*Liste der Verbraucherschlichtungsstellen.*Bundesamt für Justiz/s)
    expect(CONTRACT_HELP).not.toMatch(/welche Stelle zuständig ist und ob Sie teilnehmen, entscheiden Sie/)
    // Runde 2, R2-N-K2 und R2-N-K3.
    expect(CONTRACT_HELP).toMatch(/§§ 36, 37 VSBG bleiben davon unberührt, soweit sie Sie treffen/)
    expect(CONTRACT_HELP).not.toMatch(/gelten daneben/)
    expect(CONTRACT_HELP).toMatch(/vgl\. BGH, Urteil vom 23\.10\.2001, XI ZR 63\/01/)
    expect(CONTRACT_OPTIONS.map((o) => o.value)).toEqual(['', 'none', 'yes'])
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
