// Das Schreiben einer Mieterhöhung (#191, PR 3): Pflichtangaben stehen fest im Text, alle Zahlen kommen aus der
// eingefrorenen Grundlage, ein qualifizierter Mietspiegel steht auch bei Vergleichswohnungen darin (§ 558a Abs. 3 BGB).
import { expect, test } from 'vitest'
import type { RentIncreaseBasis, RentIncreasePlan } from './types'
import { rentIncreaseLetterView } from './rentIncreaseLetter'

const PLAN: RentIncreasePlan = {
  kind: 'comparison', state: 'possible', reasons: [], refusals: [], warnings: [], needs: [], currentCents: 50000, currentSince: '2020-01-01',
  receivedOn: '2026-11-20', today: '2026-11-20', capBaseDay: '2024-02-01', earliestReceivedOn: '2026-11-20', effectiveFrom: '2027-02', earliestEffectiveFrom: '2027-02',
  consent: { consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitFrom: '2027-02-02', suitEnd: '2027-04-30' },
  cap: { capDate: '2024-02-01', baseDay: '2024-02-01', baseCents: 50000, baseSource: 'schedule', percent: 20, reduced: false, modernizationCents: 0, limitCents: 60000 },
  comparison: { centsPerM2: 1000, areaM2: 60, rentCents: 60000, operatingCostsCents: null, limitCents: 60000 },
  index: null, maxCents: 60000, newCents: 58000, steps: [], staggered: null, legalValues: [],
}
const QUALIFIED = { name: 'Qualifizierter Mietspiegel Musterstadt 2025', asOf: '2025-04', field: 'Baujahr 1950 bis 1964, mittlere Lage', rangeLowCentsPerM2: 850, rangeHighCentsPerM2: 1100, availableAt: 'www.musterstadt.de/mietspiegel' }
const BASIS: RentIncreaseBasis = {
  version: 1, letterDate: '2026-11-20', request: { kind: 'comparison' }, plan: PLAN,
  letter: {
    justification: 'comparables', survey: null, expert: null, database: null,
    comparables: [
      { address: 'Ahornweg 3, 12345 Musterstadt', location: '1. OG links', areaM2: 58, centsPerM2: 1020 },
      { address: 'Ahornweg 5, 12345 Musterstadt', location: 'EG rechts', areaM2: 62, centsPerM2: 1010 },
      { address: 'Birkenstraße 8, 12345 Musterstadt', location: '2. OG Mitte', areaM2: 60, centsPerM2: 1050 },
    ],
    qualifiedSurvey: 'yes', qualified: QUALIFIED, recipientName: 'Anna und Ben Becker', allLandlordsNamed: true, allTenantsNamed: true, extraParagraph: 'Für Rückfragen bin ich gern erreichbar.',
  },
  rentCap: { answer: 'no', answeredOn: '2026-11-20' },
  sender: { name: 'Max Vermieter', address: 'Ahornstraße 3, 12345 Musterstadt', contact: 'Tel. 0123 456', returnLine: 'Max Vermieter · Ahornstraße 3, 12345 Musterstadt', footer: '' },
  recipient: ['Anna und Ben Becker', 'Lindenweg 12', '12345 Musterstadt'], salutation: 'Guten Tag Anna und Ben Becker,',
  premises: { propertyName: 'Haus', address: 'Lindenweg 12, 12345 Musterstadt', unitName: 'EG', areaM2: 60 }, inclusive: false,
  prepayments: { operatingCents: 15000, heatingCents: 6000, flatRateCents: 0 },
}
const text = (b: RentIncreaseBasis): string => {
  const v = rentIncreaseLetterView(b)
  return [v.subject, v.salutation, ...v.paragraphs, v.greeting, v.signature].join('\n').replace(/\u00a0/g, ' ')
}
// Beträge tragen ein geschütztes Leerzeichen vor dem €.
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x).replace(/\u00a0/g, ' '))

test('Vergleichsmiete: Pflichtangaben aus der Grundlage, Zustimmungsfrist mit dem verlängerten Ende, Klage sachlich', () => {
  const v = rentIncreaseLetterView(BASIS)
  const t = text(BASIS)
  expect(v.subject).toBe('Mieterhöhungsverlangen nach § 558 BGB, Bitte um Zustimmung')
  expect(v.head.recipient).toEqual(['Anna und Ben Becker', 'Lindenweg 12', '12345 Musterstadt'])
  expect(v.head.sender).toBe('Max Vermieter')
  expect(t).toMatch(/Ich bitte Sie, einer Erhöhung der monatlichen Nettokaltmiete für die Wohnung EG, Lindenweg 12, 12345 Musterstadt nach § 558 BGB/)
  expect(t).toMatch(/bisher 500,00 €, bei einer Wohnfläche von 60 m² also 8,33 € je m²/)
  expect(t).toMatch(/ab Februar 2027 580,00 € betragen, das sind 9,66 € je m² und 80,00 € mehr im Monat/)
  expect(t).toMatch(/Kappungsgrenze ist eingehalten.*höchstens 20 %.*Am 01\.02\.2024 betrug sie 500,00 €; zulässig sind danach höchstens 600,00 €/)
  expect(t).toMatch(/bei Zugang am 20\.11\.2026 also bis zum 01\.02\.2027/)
  expect(t).toMatch(/ab dem 01\.02\.2027 zu zahlen/)
  expect(t).toMatch(/sieht das Gesetz vor, dass der Vermieter innerhalb von 3 weiteren Monaten auf Zustimmung klagen kann \(§ 558b Abs\. 2 BGB\)/)
  expect(t).toMatch(/Vorauszahlungen auf die Betriebskosten von 150,00 € und auf die Heiz- und Warmwasserkosten von 60,00 € bleiben unverändert/)
  expect(t).toMatch(/Für Rückfragen bin ich gern erreichbar\./)
  // Schweigen gilt nirgends als Zustimmung.
  expect(t).not.toMatch(/gilt als (zugestimmt|Zustimmung)|stillschweigend/)
  expect(plain(v.consentForm?.lines.join(' '))).toMatch(/von 500,00 € auf 580,00 € ab Februar 2027/)
})

test('Vergleichswohnungen als Begründung: Tabelle mit Anschrift und Lage, und der qualifizierte Mietspiegel steht trotzdem darin', () => {
  const v = rentIncreaseLetterView(BASIS)
  expect(plain(v.comparables?.rows)).toEqual([
    { address: 'Ahornweg 3, 12345 Musterstadt', location: '1. OG links', area: '58 m²', perM2: '10,20 €' },
    { address: 'Ahornweg 5, 12345 Musterstadt', location: 'EG rechts', area: '62 m²', perM2: '10,10 €' },
    { address: 'Birkenstraße 8, 12345 Musterstadt', location: '2. OG Mitte', area: '60 m²', perM2: '10,50 €' },
  ])
  expect(v.paragraphs[v.comparables?.after ?? -1]).toMatch(/^Zur Begründung nenne ich drei vergleichbare Wohnungen/)
  const t = text(BASIS)
  expect(t).toMatch(/qualifizierten Mietspiegel „Qualifizierter Mietspiegel Musterstadt 2025“ \(Stand April 2025\)\. Darin ist die Wohnung einzuordnen in: Baujahr 1950 bis 1964, mittlere Lage\. Die Spanne dieses Feldes reicht von 8,50 € bis 11,00 € je m²\. Der Mietspiegel ist allgemein zugänglich: www\.musterstadt\.de\/mietspiegel\./)
  expect(t).toMatch(/Nach § 558a Abs\. 3 BGB teile ich Ihnen seine Angaben/)
})

test('Mietspiegel ohne Angabe, wo er zugänglich ist: Er liegt bei; mehrere Vermieter sprechen in der Mehrzahl', () => {
  const b: RentIncreaseBasis = { ...BASIS, sender: { ...BASIS.sender, name: 'Max und Erika Vermieter' }, letter: { ...BASIS.letter, justification: 'survey', comparables: [], qualifiedSurvey: 'no', qualified: null, survey: { ...QUALIFIED, name: 'Mietspiegel Musterstadt', availableAt: '', rangeLowCentsPerM2: null, rangeHighCentsPerM2: null } } }
  const t = text(b)
  expect(t).toMatch(/^Wir bitten Sie/m)
  expect(t).toMatch(/ergibt sich aus dem Mietspiegel „Mietspiegel Musterstadt“ \(Stand April 2025\)\..*Der Mietspiegel liegt diesem Schreiben bei\./)
  expect(t).not.toMatch(/Spanne/)
  expect(t).not.toMatch(/§ 558a Abs\. 3/)
})

test('Inklusivmiete: Betriebskostenanteil und Vergleichsrechnung (VIII ZR 108/20)', () => {
  const plan: RentIncreasePlan = { ...PLAN, newCents: 66000, comparison: { centsPerM2: 1000, areaM2: 60, rentCents: 60000, operatingCostsCents: 8000, limitCents: 68000 } }
  const t = text({ ...BASIS, plan, inclusive: true, prepayments: { operatingCents: 0, heatingCents: 0, flatRateCents: 0 } })
  expect(t).toMatch(/In der Miete sind Betriebskosten enthalten; auf die Wohnung entfallen davon 80,00 € im Monat\. Ohne sie beträgt die bisherige Miete 420,00 €, die neue 580,00 €/)
  expect(t).toMatch(/Vergleichsmiete von 10,00 € je m² ergibt für 60 m² 600,00 €, zuzüglich der enthaltenen Betriebskosten von 80,00 € also 680,00 €/)
  expect(t).not.toMatch(/Vorauszahlungen/)
})

test('Indexmiete: beide Indexwerte mit Monat und Basis, bisherige und neue Miete, Erhöhung in Euro, ab Monat; keine Zustimmungserklärung', () => {
  const plan: RentIncreasePlan = { ...PLAN, kind: 'index', consent: null, cap: null, comparison: null, currentCents: 77153, newCents: 79988, effectiveFrom: '2027-01', index: { from: { month: '2024-12', value: 106.1, base: 2020 }, to: { month: '2026-10', value: 110, base: 2020 } } }
  const b: RentIncreaseBasis = { ...BASIS, plan, rentCap: null, letter: { ...BASIS.letter, justification: null, comparables: [], qualifiedSurvey: null, qualified: null, extraParagraph: '' } }
  const v = rentIncreaseLetterView(b)
  const t = text(b)
  expect(v.subject).toBe('Anpassung der Miete nach § 557b BGB (Indexmiete)')
  expect(t).toMatch(/106,1 Punkte im Dezember 2024 \(Basis 2020 = 100\).*110,0 Punkte im Oktober 2026 \(Basis 2020 = 100\)/)
  expect(t).toMatch(/bisherige Nettokaltmiete von 771,53 € ändert sich .* auf 799,88 €.*Erhöhung um 28,35 € im Monat/)
  expect(t).toMatch(/ab dem 01\.01\.2027 zu zahlen/)
  expect(v.consentForm).toBeNull()
  expect(v.comparables).toBeNull()
})
