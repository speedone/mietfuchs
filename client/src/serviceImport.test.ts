// Eine ausgelesene Messdienstabrechnung übernehmen (Heizung PR 20, #103): Zuordnung der Nutzerzeilen,
// Prüfungen und die Rümpfe für die bestehenden Routen, ohne DOM.
import { expect, test } from 'vitest'
import {
  answerConflict, blockBlocked, co2FormFromExtraction, deductionHint, dhwNote, draftsOf, duplicateBlocks, itemBodies, matchLine, serviceChecks, targetOptions,
  type ImportContext,
} from './serviceImport'
import { co2ToForm } from './co2Form'
import { fmtEuro } from './api'
import type { ServiceStatementExtraction } from './types'

const ctx: ImportContext = {
  propertyId: 'objekt-1',
  plantId: 'hp',
  heating: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' },
  object: { key: '2025-01', from: '2025-01-01', to: '2025-12-31' },
  tenancies: [
    { id: 't1', unitId: 'a', tenantName: 'Erika Mustermann', start: '2020-01-01', end: null },
    { id: 't2', unitId: 'c', tenantName: 'Max Beispiel', start: '2024-06-01', end: null },
    { id: 't3', unitId: 'c', tenantName: 'Hans Vorher', start: '2019-01-01', end: '2024-05-31' },
  ],
  units: [
    { id: 'a', name: 'EG links', selfUsed: false }, { id: 'b', name: 'EG rechts', selfUsed: false },
    { id: 'c', name: 'OG links', selfUsed: false }, { id: 'd', name: 'OG rechts', selfUsed: true },
  ],
  existingAmountItems: 0,
}

const x: ServiceStatementExtraction = {
  vendor: 'Wärmedienst Beispiel GmbH', periodStart: '2025-01-01', periodEnd: '2025-12-31', unitsCount: 4, usersTotalEur: 3944.5, deductionEur: 87.5,
  fuelGrossEur: 3540, fuelNetEur: 3452.5,
  co2: { emissionsKg: 4456.4, areaM2: 194.6, kgPerM2: 22.9, landlordPercent: 30, totalEur: 291.67, landlordEur: 87.5 },
  dhwMethod: 'volumeFormula',
  blocks: [
    {
      title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', totalEur: 3944.5,
      lines: [
        { label: 'Mustermann, Erika', unitLabel: 'EG links', from: null, to: null, amountEur: 1180.25, vacancy: false },
        { label: 'Leerstand', unitLabel: 'EG rechts', from: null, to: null, amountEur: 702.1, vacancy: true },
        { label: 'Beispiel, Max', unitLabel: 'OG links', from: null, to: null, amountEur: 1065.4, vacancy: false },
        { label: 'Eigentümer (Eigennutzung)', unitLabel: 'OG rechts', from: null, to: null, amountEur: 996.75, vacancy: false },
      ],
    },
    {
      title: 'Kaltwasser und Abwasser', category: 'Wasser/Abwasser', totalEur: 1236,
      lines: [
        { label: 'Mustermann, Erika', unitLabel: 'EG links', from: null, to: null, amountEur: 402, vacancy: false },
        { label: 'Leerstand', unitLabel: 'EG rechts', from: null, to: null, amountEur: 85, vacancy: true },
        { label: 'Beispiel, Max', unitLabel: 'OG links', from: null, to: null, amountEur: 377, vacancy: false },
        { label: 'Eigentümer (Eigennutzung)', unitLabel: 'OG rechts', from: null, to: null, amountEur: 372, vacancy: false },
      ],
    },
  ],
}

// Eine Heizperiode Mai bis April, wie bei vielen Messdiensten; das Objekt rechnet im Kalenderjahr.
const mai: ImportContext = {
  ...ctx,
  heating: { key: '2025-05', from: '2025-05-01', to: '2026-04-30' },
  object: { key: '2025-05', from: '2025-05-01', to: '2026-04-30' },
}
const withYear = (c: ImportContext, year: string) => draftsOf(x, c).map((d) => ({ ...d, taxYear: year }))

test('Zuordnung: Name, Leerstand, Eigentümer; nur bei genau einem Treffer', () => {
  const [heizung] = x.blocks
  expect(heizung?.lines.map((l) => matchLine(l, ctx))).toEqual(['tenancy:t1', 'vacancy', 'tenancy:t2', 'self:d'])
  expect(matchLine({ label: 'Unbekannt', unitLabel: null, from: null, to: null, vacancy: false }, ctx)).toBe('')
  // Hans Vorher wohnte nur bis Mai 2024, die Heizperiode ist 2025.
  expect(matchLine({ label: 'Vorher, Hans', unitLabel: 'OG links', from: null, to: null, vacancy: false }, ctx)).toBe('')
  // Ein kurzes Wort („EG“, „von“) verbindet keine zwei Namen.
  expect(matchLine({ label: 'von EG', unitLabel: null, from: null, to: null, vacancy: false }, ctx)).toBe('')
  // Der Nutzungszeitraum der Zeile entscheidet zwischen Vornutzer und Nachnutzer.
  const wechsel: ImportContext = { ...ctx, tenancies: [...ctx.tenancies, { id: 't4', unitId: 'c', tenantName: 'Max Beispiel', start: '2019-01-01', end: '2024-05-31' }] }
  expect(matchLine({ label: 'Beispiel, Max', unitLabel: 'OG links', from: '2025-01-01', to: '2025-12-31', vacancy: false }, wechsel)).toBe('tenancy:t2')
})

test('Zuordnung: Eigentümer nur bei genau einer selbstgenutzten Wohnung oder passender Lage', () => {
  const zwei: ImportContext = { ...ctx, units: [...ctx.units, { id: 'e', name: 'DG', selfUsed: true }] }
  expect(matchLine({ label: 'Eigentümer', unitLabel: null, from: null, to: null, vacancy: false }, zwei)).toBe('')
  expect(matchLine({ label: 'Eigentümer', unitLabel: 'OG rechts', from: null, to: null, vacancy: false }, zwei)).toBe('self:d')
  const keine: ImportContext = { ...ctx, units: ctx.units.map((u) => ({ ...u, selfUsed: false })) }
  expect(matchLine({ label: 'Eigentümer', unitLabel: 'OG rechts', from: null, to: null, vacancy: false }, keine)).toBe('')
})

test('Review Focus 3: zwei Treffer bleiben offen; Übernehmen verlangt jede Zuordnung', () => {
  const zwei: ImportContext = { ...ctx, tenancies: [...ctx.tenancies, { id: 't5', unitId: 'b', tenantName: 'Erika Mustermann', start: '2025-06-01', end: null }] }
  expect(matchLine({ label: 'Mustermann, Erika', unitLabel: null, from: null, to: null, vacancy: false }, zwei)).toBe('')
  // Mit der Lage auf der Zeile ist es wieder eindeutig.
  expect(matchLine({ label: 'Mustermann, Erika', unitLabel: 'EG links', from: null, to: null, vacancy: false }, zwei)).toBe('tenancy:t1')
  const drafts = draftsOf(x, zwei).map((d, i) => (i === 0 ? { ...d, targets: d.targets.map((t, k) => (k === 0 ? '' : t)) } : d))
  expect(itemBodies(x, drafts, zwei, 'beleg.pdf')).toEqual({ error: 'Bitte ordnen Sie „Mustermann, Erika“ (Heizung und Warmwasser) einem Mieter, Ihrer eigenen Wohnung oder dem Leerstand zu.' })
})

test('Positionen: Heizung mit Betrag S + Abzugszeile, Einzel- und Eigenbeträge, Leerstand bleibt offen; Kaltwasser im Objektzeitraum', () => {
  const r = itemBodies(x, draftsOf(x, ctx), ctx, 'beleg.pdf')
  if ('error' in r) throw new Error(r.error)
  expect(r.bodies).toEqual([
    {
      propertyId: 'objekt-1', period: '2025-01', category: 'Heizung und Warmwasser', description: 'Heizung und Warmwasser (Wärmedienst Beispiel GmbH)', vendor: 'Wärmedienst Beispiel GmbH',
      amountCents: 403200, key: 'amounts', tenancyAmounts: { t1: 118025, t2: 106540 }, selfAmounts: { d: 99675 }, invoiceFile: 'beleg.pdf', heatingPlantId: 'hp',
    },
    {
      propertyId: 'objekt-1', period: '2025-01', category: 'Wasser/Abwasser', description: 'Kaltwasser und Abwasser (Wärmedienst Beispiel GmbH)', vendor: 'Wärmedienst Beispiel GmbH',
      amountCents: 123600, key: 'amounts', tenancyAmounts: { t1: 40200, t2: 37700 }, selfAmounts: { d: 37200 }, invoiceFile: 'beleg.pdf',
    },
  ])
  // Ohne Abzugszeile ist der Betrag S.
  const ohne = itemBodies({ ...x, deductionEur: null }, draftsOf({ ...x, deductionEur: null }, ctx), ctx, 'beleg.pdf')
  if ('error' in ohne) throw new Error(ohne.error)
  expect(ohne.bodies[0]?.amountCents).toBe(394450)
})

test('Prüfung M2: Zeitraum über zwei Kalenderjahre verlangt das Jahr der Zahlung je Block', () => {
  expect(draftsOf(x, mai)[0]?.taxYear).toBe('')
  expect(itemBodies(x, draftsOf(x, mai), mai, 'beleg.pdf')).toEqual({
    error: 'Block „Heizung und Warmwasser“: Der Zeitraum reicht über zwei Kalenderjahre. Bitte geben Sie das Jahr der Zahlung an (für die Steuer, § 11 Abs. 2 EStG).',
  })
  const r = itemBodies(x, withYear(mai, '2026'), mai, 'beleg.pdf')
  if ('error' in r) throw new Error(r.error)
  expect(r.bodies.map((b) => [b.period, b.taxYear])).toEqual([['2025-05', 2026], ['2025-05', 2026]])
  expect(itemBodies(x, withYear(mai, '26'), mai, 'beleg.pdf')).toEqual({ error: 'Block „Heizung und Warmwasser“: Das Jahr der Zahlung muss zwischen 2025 und 2027 liegen.' })
  // Im Kalenderjahr gibt es nichts zu fragen; ein eingetragenes Jahr geht trotzdem nicht verloren.
  const kalender = itemBodies(x, withYear(ctx, '2025'), ctx, 'beleg.pdf')
  if ('error' in kalender) throw new Error(kalender.error)
  expect(kalender.bodies[0]?.taxYear).toBeUndefined()
})

test('Review Focus 4: schon Einzelbeträge in der Heizperiode: Heizblock nicht vorgehakt, mit Satz', () => {
  const schon = { ...ctx, existingAmountItems: 1 }
  expect(draftsOf(x, schon)[0]?.include).toBe(false)
  expect(draftsOf(x, schon)[1]?.include).toBe(true)
  expect(serviceChecks(x, schon)).toContain('In dieser Heizperiode gibt es schon Einzelbeträge eines Messdienstes. Übernehmen Sie nur, was noch fehlt; sonst stünden die Heizkosten doppelt in der Abrechnung.')
})

test('Review Focus 5 und Prüfung S8: Kaltwasser bei abweichendem Objektzeitraum nicht übernommen, mit Satz', () => {
  const kalender: ImportContext = { ...mai, object: { key: '2026-01', from: '2026-01-01', to: '2026-12-31' } }
  const [, kalt] = x.blocks
  if (!kalt) throw new Error('Kaltwasserblock fehlt')
  expect(blockBlocked(kalt, kalender)).toBe('Der Block gilt für 01.05.2025–30.04.2026, Ihr Abrechnungszeitraum für 01.01.–31.12.2026. Mietfuchs ordnet kalte Kosten dem Zeitraum zu, in dem sie entstanden sind, und kann Einzelbeträge je Mieter nicht auf zwei Abrechnungszeiträume aufteilen. Erfassen Sie den Block bitte auf der Seite Kosten.')
  expect(draftsOf(x, kalender)[1]?.include).toBe(false)
  const r = itemBodies(x, withYear(kalender, '2026'), kalender, 'beleg.pdf')
  if ('error' in r) throw new Error(r.error)
  expect(r.bodies.map((b) => b.category)).toEqual(['Heizung und Warmwasser'])
  // Wer den Haken trotzdem setzt, bekommt den Satz statt einer Position.
  const erzwungen = withYear(kalender, '2026').map((d) => ({ ...d, include: true }))
  expect(itemBodies(x, erzwungen, kalender, 'beleg.pdf')).toEqual({ error: `Block „Kaltwasser und Abwasser“: ${blockBlocked(kalt, kalender)}` })
})

test('Prüfungen: Zeitraum, Summe je Block, S, Nutzeinheiten, CO₂-Anteil gegen Abzugszeile', () => {
  expect(serviceChecks(x, ctx)).toEqual([])
  const abweichend: ServiceStatementExtraction = {
    ...x, periodStart: '2024-05-01', periodEnd: '2025-04-30', unitsCount: 5, usersTotalEur: 3950,
    co2: { emissionsKg: null, areaM2: null, kgPerM2: null, landlordPercent: null, totalEur: null, landlordEur: 90 },
    blocks: [{ ...(x.blocks[0] ?? { title: '', category: '', lines: [] }), totalEur: 3944.6 }],
  }
  expect(serviceChecks(abweichend, ctx)).toEqual([
    'Die Abrechnung gilt für 01.05.2024–30.04.2025, die Heizperiode in Mietfuchs für 01.01.–31.12.2025. Prüfen Sie den Zeitraum der Heizanlage unter Stammdaten.',
    `Block „Heizung und Warmwasser“: Die Nutzerzeilen ergeben ${fmtEuro(394450)}, die Summe laut Abrechnung ist ${fmtEuro(394460)}.`,
    `Die Summe der Nutzerkosten Heizung und Warmwasser (S) ist ${fmtEuro(395000)}, der Block nennt ${fmtEuro(394460)}.`,
    'Die Abrechnung nennt 5 Nutzeinheiten, im Block stehen 4 Nutzerzeilen.',
    `Der CO₂-Anteil des Vermieters ist ${fmtEuro(9000)}, die Abzugszeile ${fmtEuro(8750)}.`,
  ])
  // Rundung der Nutzerzeilen bis 2 ct je Zeile ist kein Befund.
  const gerundet: ServiceStatementExtraction = { ...x, blocks: [{ ...(x.blocks[0] ?? { title: '', category: '', lines: [] }), totalEur: 3944.58 }] }
  expect(serviceChecks(gerundet, ctx).some((c) => c.startsWith('Block'))).toBe(false)
})

test('CO₂: Formular vorbelegt ohne Antwort, auch Ausstoß, Fläche, G und V (Prüfung M3, K7); gespeicherte Werte bleiben ohne Lesung', () => {
  const form = co2FormFromExtraction(x, co2ToForm(null, { items: [], unitsCount: 4 }))
  expect(form.answer).toBe('')
  expect([form.usersTotal, form.unitsCount, form.kgPerM2, form.landlordPercent, form.totalCo2, form.landlordCo2]).toEqual(['3.944,50', '4', '22,9', '30', '291,67', '87,50'])
  expect([form.emissionsKg, form.serviceArea, form.fuelGross, form.fuelNet]).toEqual(['4456,4', '194,6', '3.540,00', '3.452,50'])
  // Was der Vermieter schon eingetragen hat, bleibt, wenn die Auswertung dazu nichts gelesen hat.
  const base = { ...co2ToForm(null, { items: [], unitsCount: 4 }), emissionsKg: '4000', serviceArea: '190', fuelGross: '1,00', costItemId: 'alt' }
  const ohne = co2FormFromExtraction({ ...x, co2: null, fuelGrossEur: null }, base)
  expect([ohne.emissionsKg, ohne.serviceArea, ohne.fuelGross, ohne.costItemId]).toEqual(['4000', '190', '1,00', 'alt'])
  // Die angelegte Heizposition wird verknüpft, wenn noch keine gewählt ist (Prüfung S5).
  expect(co2FormFromExtraction(x, co2ToForm(null, { items: [], unitsCount: 4 }), 'neu').costItemId).toBe('neu')
  expect(co2FormFromExtraction(x, base, 'neu').costItemId).toBe('alt')
})

test('CO₂: Abzugszeile als Satz; Warnung bei „nur ausgewiesen“ und „nicht aufgeteilt“ (Prüfung S5)', () => {
  expect(deductionHint(x)).toBe(`In Ihrer Abrechnung steht die Zeile „Abzüglich CO₂-Kosten Vermieter“ mit ${fmtEuro(8750)}.`)
  expect(deductionHint({ ...x, deductionEur: null })).toBeNull()
  expect(answerConflict(x, 'shown')).toBe('Die Auswertung hat eine Abzugszeile gefunden. Steht sie in Ihrer Abrechnung, wählen Sie „Ja, es gibt eine Abzugszeile“. Mit „Nein, die CO₂-Kosten sind nur ausgewiesen“ schlägt die Probe fehl, weil der Betrag der Position die Abzugszeile enthält.')
  expect(answerConflict(x, 'unsplit')).toBe('Die Auswertung hat eine Abzugszeile gefunden, der Messdienst hat die CO₂-Kosten also aufgeteilt. Steht sie in Ihrer Abrechnung, wählen Sie „Ja, es gibt eine Abzugszeile“. Mit „Der Messdienst hat die CO₂-Kosten gar nicht aufgeteilt“ teilte Mietfuchs sie ein zweites Mal auf.')
  expect(answerConflict(x, 'deducted')).toBeNull()
  expect(answerConflict(x, '')).toBeNull()
  expect(answerConflict({ ...x, deductionEur: null }, 'shown')).toBeNull()
})

test('Warmwasser: Formel nennt die Voraussetzung und die Kürzung (Prüfung K3)', () => {
  expect(dhwNote('heatMeter')).toBeNull()
  expect(dhwNote('volumeFormula')).toMatch(/^Eine Formel ist nur zulässig, wenn sich die Wärmemenge für das Warmwasser nicht oder nur mit unzumutbar hohem Aufwand messen lässt.*Karte „Warmwasser“.*§ 12 Abs\. 1 Satz 1 HeizkostenV/)
  expect(dhwNote('areaFormula')).toMatch(/§ 12 Abs\. 1 Satz 1 HeizkostenV/)
})

test('Auswahl der Ziele: bitte zuordnen, Leerstand, Mietverhältnisse der Heizperiode, eigene Wohnung', () => {
  expect(targetOptions(ctx)).toEqual([
    { value: '', label: 'Bitte zuordnen …' },
    { value: 'vacancy', label: 'Leerstand oder nicht vermietet (bleibt beim Vermieter)' },
    { value: 'tenancy:t1', label: 'Erika Mustermann (EG links)' },
    { value: 'tenancy:t2', label: 'Max Beispiel (OG links)' },
    { value: 'self:d', label: 'Eigene Wohnung OG rechts' },
  ])
})

test('Eine Zeile ohne Betrag lässt sich nur dem Leerstand zuordnen', () => {
  const ohne: ServiceStatementExtraction = { ...x, blocks: [{ title: 'Heizung und Warmwasser', category: 'Heizung und Warmwasser', lines: [{ label: 'Mustermann, Erika', unitLabel: null, from: null, to: null, vacancy: false }] }] }
  expect(itemBodies(ohne, draftsOf(ohne, ctx), ctx, 'beleg.pdf')).toEqual({ error: '„Mustermann, Erika“ (Heizung und Warmwasser) hat keinen Betrag. Bitte tragen Sie ihn nach der Übernahme auf der Seite Kosten ein oder ordnen Sie die Zeile dem Leerstand zu.' })
  const leer = draftsOf(ohne, ctx).map((d) => ({ ...d, targets: ['vacancy'] }))
  const r = itemBodies(ohne, leer, ctx, 'beleg.pdf')
  if ('error' in r) throw new Error(r.error)
  expect(r.bodies[0]).toMatchObject({ tenancyAmounts: {}, selfAmounts: {} })
})

test('Durchsicht S4: erneut ausgelesen, sind auch kalte Blöcke mit vorhandenen Einzelbeträgen nicht vorgehakt, mit Satz und Rückfrage', () => {
  const nochmal: ImportContext = { ...ctx, existingAmountItems: 1, existingAmountCategories: ['Wasser/Abwasser'] }
  expect(draftsOf(x, nochmal).map((d) => d.include)).toEqual([false, false])
  expect(serviceChecks(x, nochmal)).toContain('Im Abrechnungszeitraum gibt es schon Einzelbeträge der Kostenart „Wasser/Abwasser“. Übernehmen Sie den Block „Kaltwasser und Abwasser“ nur, wenn er noch fehlt; sonst stünden die Kosten doppelt in der Abrechnung.')
  // Wer die Haken trotzdem setzt, wird gefragt: beide Blöcke stünden doppelt.
  const trotzdem = draftsOf(x, nochmal).map((d) => ({ ...d, include: true }))
  expect(duplicateBlocks(x, trotzdem, nochmal)).toEqual(['Heizung und Warmwasser', 'Kaltwasser und Abwasser'])
  expect(duplicateBlocks(x, draftsOf(x, ctx), ctx)).toEqual([])
  // Eine andere Kostenart ist kein Grund.
  expect(draftsOf(x, { ...ctx, existingAmountCategories: ['Müllabfuhr'] })[1]?.include).toBe(true)
})
