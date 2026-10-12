// §§ 5a, 5b, 5d CO2KostAufG in der Abrechnung (Heizung PR 18, #215): CO₂-Kosten nach Anfall, Netzentgelte und
// Biobrennstoff als Abzugszeilen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codesOf, delivery, item, partsOf, plant, reliefOf, settle, sumOf, textOf, textsOf } from '../testing/halfSplitSnapshot.ts'
import { periodKey } from '../../shared/period.ts'
import { valueAt } from '../../shared/law/register.ts'
import { hkvDegreeDays } from '../../shared/law/heizkostenv.ts'
import { degreeDayPermille } from '../../shared/degreeDays.ts'

test('Heizperiode 01.05.2027–30.04.2028: 530 ‰ ab 2028 hälftig, Stufe 60 % davor → 547 ‰ (Entwurf 3.9, 4.7)', () => {
  const r = settle('2027-05')
  // L = 773,79 € · 54,7 % = 423,26 €; Abzug nach Anteil am Brennstoff 50/30/20 %, Restcent an B.
  assert.deepEqual([reliefOf(r, 'ta', 'co2Relief'), reliefOf(r, 'tb', 'co2Relief'), reliefOf(r, 'tc', 'co2Relief')], [-21163, -12698, -8465])
  assert.deepEqual(partsOf(r, 'co2:hp:2027-05'), [{ reason: 'co2Share', cents: 42326 }])
  assert.equal(sumOf(r), 900000)
  const co2 = r.heating?.[0]?.co2 ?? assert.fail('keine Bewertung')
  assert.ok(Math.abs((co2.landlordPermille ?? 0) - 547) < 1e-9)
  assert.deepEqual(co2.adjustments, ['halfSplit'])
  assert.deepEqual(co2.halfSplit && { ...co2.halfSplit, co2SharePermille: Math.round(co2.halfSplit.co2SharePermille) }, { co2SharePermille: 530, landlordGridFeeCents: null, landlordBioCents: 0, basis: 'existing', twoFamily: null })
  const text = textOf(r, 'co2.half-split')
  assert.match(text, /am 01\.03\.2027 nach § 43 Abs\. 1 GModG eingebaut/)
  assert.match(text, /53 % der CO₂-Kosten/)
  // Prüfung K2: die Grenze beim Biobrennstoff; S11: die Lesart nach Anfall mit der Gegenstimme der Begründung.
  assert.match(text, /höchstens für 30 % des verbrauchten Brennstoffs/)
  assert.match(text, /nennt für die CO₂-Kosten nur den Stichtag/)
  assert.match(text, /BT-Drs\. 21\/6278, S\. 124/)
  assert.match(text, /Wohnraum/)
  assert.match(text, /Härtefall nach § 5d Abs\. 1/)
  // Prüfung M10: die Hybridheizung als Auslegung, nicht als Tatsache.
  assert.match(text, /Bei einer Hybridheizung .* Das ist eine Auslegung; ausdrücklich regeln Gesetz und Begründung diesen Fall nicht\./)
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'co2.half-split' && v.validFrom === '2028-01-01'))
  assert.ok(r.legalBasis.values?.some((v) => v.id === 'gmodg.heating-43'))
  assert.ok(r.legalBasis.rules.some((x) => x.code === 'co2-half-split'))
})

test('Vor 2028 und ohne Merkmal: keine Frage an das Register, keine Zahl anders (Wer nichts einstellt …)', () => {
  const vorher = settle('2026-05', { costItems: [item({ id: 'gas', period: periodKey('2026-05') })], fuelDeliveries: [delivery({ invoiceFrom: '2026-05-01', invoiceTo: '2027-04-30', label: 'Gas 2026/2027' })] })
  assert.ok(!(vorher.legalBasis.values ?? []).some((v) => v.id.startsWith('co2.half-split') || v.id === 'gmodg.heating-43'))
  assert.ok(!codesOf(vorher).some((c) => c.startsWith('co2.half-split')))
  const ohne = settle('2027-05', { heatingPlants: [plant({ gmodg43InstalledOn: null })] })
  assert.deepEqual([reliefOf(ohne, 'ta', 'co2Relief'), reliefOf(ohne, 'tb', 'co2Relief'), reliefOf(ohne, 'tc', 'co2Relief')], [-23214, -13928, -9285])
  assert.ok(!(ohne.legalBasis.values ?? []).some((v) => v.id.startsWith('co2.half-split') || v.id === 'gmodg.heating-43'))
  assert.ok(!codesOf(ohne).some((c) => c.startsWith('co2.half-split')))
  assert.equal(ohne.heating?.[0]?.co2?.halfSplit, undefined)
})

test('§ 9 kürzt nur den Teil nach Stufen; der Hinweis sagt das im Wortlaut der Gegenprüfung (Abweichung 5, M6)', () => {
  const r = settle('2027-05', { heatingPlants: [plant({ restriction: 'building' })] })
  const co2 = r.heating?.[0]?.co2 ?? assert.fail('keine Bewertung')
  assert.ok(Math.abs((co2.landlordPermille ?? 0) - (300 * 0.47 + 500 * 0.53)) < 1e-9)
  const text = textOf(r, 'co2.restriction')
  assert.match(text, /nicht die Hälfte nach § 5a, weil § 9 Abs\. 1 CO2KostAufG den Anteil ‚nach § 5, 6, 7 oder 8‘ nennt und § 5a nicht/)
  assert.match(text, /‚in Abweichung von § 5 Absatz 2‘ \(§ 5a Abs\. 3 Nr\. 2\)/)
  assert.match(text, /§ 6 Abs\. 1 Satz 2 und Abs\. 2 Satz 1/)
  assert.doesNotMatch(text, /§ 7 Abs\. 1/)
  assert.doesNotMatch(text, /§§ 5 bis 8/)
  // Ohne Heizung nach § 43 bleibt der Text wie bisher.
  assert.doesNotMatch(textOf(settle('2027-05', { heatingPlants: [plant({ restriction: 'building', gmodg43InstalledOn: null })] }), 'co2.restriction'), /§ 5a/)
})

test('Notfalleinbau am 15.06.2027 (Review Focus 1): in dieser Heizperiode keine Teilung, der Hinweis nennt § 5a Abs. 4', () => {
  const r = settle('2027-05', { heatingPlants: [plant({ gmodg43InstalledOn: '2027-06-15', emergencyInstall: true })] })
  assert.ok(Math.abs((r.heating?.[0]?.co2?.landlordPermille ?? 0) - 600) < 1e-9)
  assert.match(textOf(r, 'co2.half-split'), /bis 15\.06\.2028 \(§ 5a Abs\. 4 Satz 1 CO2KostAufG\)/)
  // In der nächsten Heizperiode ab dem 16.06.2028.
  const danach = settle('2028-05', {
    heatingPlants: [plant({ gmodg43InstalledOn: '2027-06-15', emergencyInstall: true })],
    costItems: [item({ id: 'gas', period: periodKey('2028-05') })],
    fuelDeliveries: [delivery({ invoiceFrom: '2028-05-01', invoiceTo: '2029-04-30', label: 'Gas 2028/2029', gridFeeCents: 30000, bioCostCents: 0 })],
  })
  const p = danach.heating?.[0]?.co2?.landlordPermille ?? 0
  assert.ok(p > 500 && p < 600, `teilweise geteilt: ${p}`)
})

test('Notfalleinbau genau zwölf Monate vor dem 01.01.2028: Teilung ab 2028, als Auslegung genannt (Prüfung S14)', () => {
  const r = settle('2027-05', { heatingPlants: [plant({ gmodg43InstalledOn: '2027-01-01', emergencyInstall: true })] })
  assert.ok(Math.abs((r.heating?.[0]?.co2?.landlordPermille ?? 0) - 547) < 1e-9)
  assert.match(textOf(r, 'co2.half-split'), /genau zwölf Monate vor dem 01\.01\.2028 eingebaut.*„Havarie im Verlauf des Jahres 2027“.*das ist eine Auslegung/)
})

test('§ 5b: Neubau mit Bauantrag vor dem 13.05.2026 → Stufen (Entwurf 12.2)', () => {
  const r = settle('2027-05', { heatingPlants: [plant({ newBuildingFirstUse: '2027-04-01', buildingApplicationBefore20260513: true })] })
  assert.ok(Math.abs((r.heating?.[0]?.co2?.landlordPermille ?? 0) - 600) < 1e-9)
  assert.match(textOf(r, 'co2.half-split'), /§ 5b Satz 2 CO2KostAufG/)
  // Unbekannter Bauantrag: hälftig, mit Rückfrage.
  const unklar = settle('2027-05', { heatingPlants: [plant({ newBuildingFirstUse: '2027-04-01' })] })
  assert.ok(Math.abs((unklar.heating?.[0]?.co2?.landlordPermille ?? 0) - 547) < 1e-9)
  assert.match(textOf(unklar, 'co2.half-split'), /Ob der Bauantrag vor dem 13\.05\.2026 gestellt wurde, ist nicht angegeben/)
  assert.equal(unklar.heating?.[0]?.co2?.halfSplit?.basis, 'newBuilding')
})

// Heizperiode 01.05.2027–30.04.2028, Heizung nach § 43 seit 01.03.2027, Abrechnungsfrist 30.04.2029.
const zfh = (tightMarket: boolean | null, notice: string | null, contractDate?: string, tightMarketTo?: string, gridFeeCents: number | null = null) => settle('2027-05', {
  properties: [{ id: 'objekt-1', kind: 'zfh', cableBuiltBeforeDec2021: null, tightMarket, ...(tightMarketTo ? { tightMarketFrom: '2020-01-01', tightMarketTo } : {}), periodRules: { startMonth: 5, changes: [] } }],
  units: [
    { id: 'a', name: 'Oben', areaM2: 300, participates: true, propertyId: 'objekt-1' },
    { id: 'b', name: 'Unten', areaM2: 300, participates: false, selfUsed: true, selfPersons: 1, propertyId: 'objekt-1' },
  ],
  tenancies: [{
    id: 'ta', unitId: 'a', tenantName: 'Mieter A', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [],
    ...(notice ? { halfSplitNoticeOn: notice } : {}), ...(contractDate ? { contractDate } : {}),
  }],
  heatingPlants: [plant()],
  fuelDeliveries: [delivery({ gridFeeCents })],
})

test('§ 5d Abs. 3: Zweifamilienhaus mit Eigennutzung → Stufen; angespannter Markt → hälftig (Entwurf 12.2)', () => {
  const ausnahme = zfh(false, '2027-04-01')
  assert.ok(Math.abs((ausnahme.heating?.[0]?.co2?.landlordPermille ?? 0) - 600) < 1e-9)
  assert.deepEqual(ausnahme.heating?.[0]?.co2?.adjustments, ['twoFamily'])
  assert.equal(ausnahme.heating?.[0]?.co2?.halfSplit?.twoFamily, 'excepted')
  const text = textOf(ausnahme, 'co2.half-split-two-family')
  assert.match(text, /nur die CO₂-Kosten nach dem Stufenmodell/)
  // Prüfung S9: das Gebiet, nicht die Gemeinde; S12: die Mitteilung als Voraussetzung ist Auslegung.
  assert.match(text, /Das Gebäude liegt nach Ihrer Angabe in dieser Heizperiode in keinem Gebiet/)
  assert.match(text, /dass die Mitteilung auch für Abs\. 3 nötig ist, ist eine Auslegung/)
  const angespannt = zfh(true, '2027-04-01')
  assert.ok(Math.abs((angespannt.heating?.[0]?.co2?.landlordPermille ?? 0) - 547) < 1e-9)
  assert.match(textOf(angespannt, 'co2.half-split-two-family'), /angespanntem Wohnungsmarkt/)
  assert.match(textOf(zfh(null, '2027-04-01'), 'co2.half-split-two-family'), /§ 556d BGB.*§ 558 Abs\. 3 BGB.*§ 577a Abs\. 2 BGB/)
  assert.match(textOf(zfh(false, null), 'co2.half-split-two-family'), /in Textform/)
  // Vertrag seit 2020, Einbau 2027: Mitteilung mit der Abrechnung genügt (§ 5d Abs. 4 Satz 2, Abweichung 3).
  const mitAbrechnung = zfh(false, '2028-06-15')
  assert.ok(Math.abs((mitAbrechnung.heating?.[0]?.co2?.landlordPermille ?? 0) - 600) < 1e-9)
  assert.match(textOf(mitAbrechnung, 'co2.half-split-two-family'), /mit dieser Abrechnung \(§ 5d Abs\. 4 Satz 2/)
  // Vertrag erst nach dem Einbau (Satz 1): Eine Mitteilung nach Beginn der Heizperiode zählt nicht (Satz 4).
  const spaet = zfh(false, '2027-06-01', '2027-04-01')
  assert.ok(Math.abs((spaet.heating?.[0]?.co2?.landlordPermille ?? 0) - 547) < 1e-9)
  assert.match(textOf(spaet, 'co2.half-split-two-family'), /§ 5d Abs\. 4 Satz 4/)
  // Verordnung bis 31.03.2027 (vor der Heizperiode): nicht mehr angespannt (Abweichung 4).
  assert.ok(Math.abs((zfh(true, '2027-04-01', undefined, '2027-03-31').heating?.[0]?.co2?.landlordPermille ?? 0) - 600) < 1e-9)
})

test('§ 5d Abs. 3: zwei Heizungen im Zweifamilienhaus sind keine gemeinsame Wärmeversorgung (Prüfung M9)', () => {
  const r = settle('2027-05', {
    properties: [{ id: 'objekt-1', kind: 'zfh', cableBuiltBeforeDec2021: null, tightMarket: false, periodRules: { startMonth: 5, changes: [] } }],
    units: [
      { id: 'a', name: 'Oben', areaM2: 300, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'Unten', areaM2: 300, participates: false, selfUsed: true, selfPersons: 1, propertyId: 'objekt-1' },
    ],
    tenancies: [{ id: 'ta', unitId: 'a', tenantName: 'Mieter A', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], halfSplitNoticeOn: '2027-04-01' }],
    heatingPlants: [plant({ units: [{ unitId: 'a', heatedAreaM2: null }] })],
  })
  assert.ok(!codesOf(r).includes('co2.half-split-two-family'))
  // Nur Oben (300 m²) an der Anlage: 80,4 kg je m², Stufe 95 %, gemischt 950 · 0,47 + 500 · 0,53 = 711,5 ‰.
  assert.ok(Math.abs((r.heating?.[0]?.co2?.landlordPermille ?? 0) - 711.5) < 1e-9)
})

test('Messdienst: der Hinweis verlangt den Abzug durch den Vermieter, geprüft in der Abrechnung des Messdienstes (Prüfung S10)', () => {
  const r = settle('2027-05', {
    heatingPlants: [plant({ method: 'service' })],
    costItems: [item({ id: 'hz', description: 'Heizung laut Messdienst', key: 'amounts', tenancyAmounts: { ta: 450000, tb: 270000, tc: 180000 }, fuelDeliveryId: null, heatingPart: undefined })],
    fuelDeliveries: [],
  })
  const text = textOf(r, 'co2.half-split')
  assert.match(text, /müssen Sie von den Heizkosten abziehen, bevor verteilt wird \(§ 7 Abs\. 5 CO2KostAufG\); rechnet ein Messdienst für Sie ab, prüfen Sie das in seiner Abrechnung/)
  assert.doesNotMatch(text, /Der Messdienst muss/)
})

// ---------- Netzentgelte und Biobrennstoff (§ 5a Abs. 1, 3, § 7 Abs. 5) ----------

test('Netzentgelte 300 €: 530 ‰ fallen ab 2028 an, der Vermieter trägt 79,50 €, verteilt nach dem Brennstoff', () => {
  const r = settle('2027-05', { fuelDeliveries: [delivery({ gridFeeCents: 30000 })] })
  assert.deepEqual([reliefOf(r, 'ta', 'gmodgRelief'), reliefOf(r, 'tb', 'gmodgRelief'), reliefOf(r, 'tc', 'gmodgRelief')], [-3975, -2385, -1590])
  assert.deepEqual(partsOf(r, 'gmodg:hp:2027-05'), [{ reason: 'gmodgShare', cents: 7950 }])
  assert.equal(sumOf(r), 900000)
  // Die CO₂-Aufteilung bleibt, wie sie war.
  assert.deepEqual([reliefOf(r, 'ta', 'co2Relief'), reliefOf(r, 'tb', 'co2Relief'), reliefOf(r, 'tc', 'co2Relief')], [-21163, -12698, -8465])
  const h = r.heating?.[0]?.co2?.halfSplit ?? assert.fail('keine Angaben zu § 5a')
  assert.deepEqual([h.landlordGridFeeCents, h.landlordBioCents], [7950, 0])
  const zeile = r.statements[0]?.rows.find((row) => row.kind === 'gmodgRelief') ?? assert.fail('keine Zeile')
  assert.equal(zeile.description, 'Netzentgelte und Biobrennstoff: Anteil des Vermieters (§ 5a CO2KostAufG)')
  assert.match(zeile.steps?.[0]?.value ?? '', /^Netzentgelte 79,50 €/)
  assert.ok(!codesOf(r).includes('co2.half-split-missing'))
})

test('Review Focus 3: Die Zwischenrechnung bis 31.12.2027 bleibt beim Mieter, die Schlussrechnung wird für ihren Teil geteilt', () => {
  const r = settle('2027-05', {
    costItems: [
      item({ id: 'gasA', amountCents: 200000, fuelDeliveryId: 'A' }),
      item({ id: 'gasB', amountCents: 700000, fuelDeliveryId: 'B', period: periodKey('2028-05') }),
    ],
    fuelDeliveries: [
      delivery({ id: 'A', label: 'Gas bis 31.12.2027', invoiceFrom: '2027-10-15', invoiceTo: '2027-12-31', emissionsKg: 3000, co2CostCents: 10000, gridFeeCents: 5000 }),
      delivery({ id: 'B', label: 'Gas 2028', invoiceFrom: '2028-01-01', invoiceTo: '2028-10-14', emissionsKg: 12000, co2CostCents: 40000, gridFeeCents: 20000 }),
    ],
  })
  const table = valueAt(hkvDegreeDays, '2027-05-01')
  const anteilB = degreeDayPermille([{ from: '2028-01-01', to: '2028-04-30' }], table) / degreeDayPermille([{ from: '2028-01-01', to: '2028-10-14' }], table)
  assert.deepEqual(partsOf(r, 'gmodg:hp:2027-05'), [{ reason: 'gmodgShare', cents: Math.round(20000 * anteilB * 0.5) }])
})

test('Ohne Netzentgelte an der Gasrechnung: Warnung mit 3 % je Mieter, keine Zeile (Abweichung 9)', () => {
  const r = settle('2027-05')
  const n = r.notices.find((x) => x.code === 'co2.half-split-missing') ?? assert.fail('keine Warnung')
  assert.equal(n.level, 'warning')
  assert.match(n.text, /fehlen die Netzentgelte/)
  assert.match(n.text, /§ 7 Abs\. 5 Satz 3, Abs\. 4 CO2KostAufG/)
  // Die Beträge der Kürzung je Mieter (Entwurf 6.5): 3 % seiner Heizkosten nach Abzug.
  assert.match(n.text, /hier: Mieter A \(A\) 128,65 €/)
  assert.equal(reliefOf(r, 'ta', 'gmodgRelief'), 0)
})

test('Biobrennstoff fehlt an einer Gasrechnung ab 2029: Warnung im Wortlaut der Gegenprüfung (Prüfung M7, R18-3)', () => {
  const r = settle('2028-05', {
    costItems: [item({ id: 'gas', period: periodKey('2028-05') })],
    fuelDeliveries: [delivery({ invoiceFrom: '2028-05-01', invoiceTo: '2029-04-30', label: 'Gas 2028/2029', gridFeeCents: 30000 })],
  })
  const texte = textsOf(r, 'co2.half-split-missing')
  assert.equal(texte.length, 1)
  const t = texte[0] ?? ''
  assert.match(t, /fehlen die Kosten des Pflichtanteils an Biobrennstoff/)
  assert.match(t, /höchstens für 30 % des verbrauchten Brennstoffs/)
  assert.match(t, /etwa weil die Pflicht ganz anders erfüllt ist \(§ 43 Abs\. 3 bis 5, § 45 Abs\. 2 GModG\) oder noch nicht gilt \(§ 43 Abs\. 1 und 7 GModG\), tragen Sie 0 ein/)
  assert.match(t, /fordern Sie ihn beim Lieferanten an; er muss ihn ausweisen \(§ 3 Abs\. 1 Nr\. 6 CO2KostAufG\)/)
  // Mit der 0 entfällt die Warnung, und gezählt werden nur die Netzentgelte.
  const null0 = settle('2028-05', {
    costItems: [item({ id: 'gas', period: periodKey('2028-05') })],
    fuelDeliveries: [delivery({ invoiceFrom: '2028-05-01', invoiceTo: '2029-04-30', label: 'Gas 2028/2029', gridFeeCents: 30000, bioCostCents: 0 })],
  })
  assert.ok(!codesOf(null0).includes('co2.half-split-missing'))
  assert.deepEqual(partsOf(null0, 'gmodg:hp:2028-05'), [{ reason: 'gmodgShare', cents: 15000 }])
  // Ein Betrag ab 2029: hälftig für den Teil ab dem 01.01.2029.
  const mitBio = settle('2028-05', {
    costItems: [item({ id: 'gas', period: periodKey('2028-05') })],
    fuelDeliveries: [delivery({ invoiceFrom: '2028-05-01', invoiceTo: '2029-04-30', label: 'Gas 2028/2029', gridFeeCents: 0, bioCostCents: 10000 })],
  })
  const table = valueAt(hkvDegreeDays, '2028-05-01')
  const ab2029 = degreeDayPermille([{ from: '2029-01-01', to: '2029-04-30' }], table) / degreeDayPermille([{ from: '2028-05-01', to: '2029-04-30' }], table)
  assert.deepEqual(partsOf(mitBio, 'gmodg:hp:2028-05'), [{ reason: 'gmodgShare', cents: Math.round(10000 * ab2029 * 0.5) }])
})

test('Review Focus 4: Ölheizung nach § 43 ab 2029, Biobrennstoff aus dem Vorrat → Warnung statt stiller Null', () => {
  const r = settle('2028-05', {
    heatingPlants: [plant({ energy: 'oil' })],
    costItems: [item({ id: 'oel', period: periodKey('2028-05'), description: 'Heizöl', fuelDeliveryId: null })],
    fuelDeliveries: [],
  })
  const t = textOf(r, 'co2.half-split-missing')
  assert.match(t, /Vorrat/)
  assert.match(t, /ganz anders erfüllt/)
  // Ist an jeder Lieferung 0 eingetragen, gibt es keinen Pflichtanteil im Tank und keine Warnung (Abweichung 9, 10).
  const ohneBio = settle('2028-05', {
    heatingPlants: [plant({ energy: 'oil' })],
    costItems: [item({ id: 'oel', period: periodKey('2028-05'), description: 'Heizöl', fuelDeliveryId: null })],
    fuelDeliveries: [delivery({ id: 'oel1', label: 'Heizöl', invoiceFrom: null, invoiceTo: null, deliveredAt: '2028-09-01', quantity: 3000, quantityUnit: 'l', bioCostCents: 0 })],
  })
  assert.ok(!codesOf(ohneBio).includes('co2.half-split-missing'))
  // Vor 2029 gibt es beim Vorrat noch nichts zu teilen.
  const vorher = settle('2027-05', {
    heatingPlants: [plant({ energy: 'oil' })],
    costItems: [item({ id: 'oel', description: 'Heizöl', fuelDeliveryId: null })],
    fuelDeliveries: [],
  })
  assert.ok(!codesOf(vorher).includes('co2.half-split-missing'))
})

test('Contracting mit Gas (Abweichung 11): Netzentgelte nach dem Brennstoff des Lieferanten', () => {
  // snapshotFor macht daraus über asBilledPlant (PR 16) energy 'districtHeating' mit fuelEnergy 'gas'.
  const r = settle('2027-05', { heatingPlants: [plant({ contracting: true })], fuelDeliveries: [delivery({ gridFeeCents: 30000 })] })
  assert.deepEqual(partsOf(r, 'gmodg:hp:2027-05'), [{ reason: 'gmodgShare', cents: 7950 }])
  assert.match(textOf(r, 'co2.half-split'), /Contractor/)
  // Contracting mit Heizöl: keine Netzentgelte zu teilen, auch wenn eine Zahl dasteht.
  const oel = settle('2027-05', { heatingPlants: [plant({ contracting: true, energy: 'oil' })], fuelDeliveries: [delivery({ gridFeeCents: 30000 })] })
  assert.deepEqual(partsOf(oel, 'gmodg:hp:2027-05'), [])
})

test('Zweifamilienhaus mit Ausnahme: keine Netzentgelte beim Vermieter (§ 5d Abs. 3: „nur die Kohlendioxidkosten“)', () => {
  const r = zfh(false, '2027-04-01', undefined, undefined, 30000)
  assert.equal(reliefOf(r, 'ta', 'gmodgRelief'), 0)
  assert.deepEqual(partsOf(r, 'gmodg:hp:2027-05'), [])
  assert.ok(!codesOf(r).includes('co2.half-split-missing'))
  // Ohne Ausnahme (angespannter Markt) werden sie geteilt.
  assert.ok(reliefOf(zfh(true, '2027-04-01', undefined, undefined, 30000), 'ta', 'gmodgRelief') < 0)
})

test('Netzentgelte auch ohne CO₂-Aufteilung: fehlen die CO₂-Angaben, wird trotzdem geteilt', () => {
  const r = settle('2027-05', { fuelDeliveries: [delivery({ gridFeeCents: 30000, emissionsKg: null, co2CostCents: null })] })
  assert.ok(codesOf(r).includes('co2.incomplete'))
  assert.deepEqual(partsOf(r, 'gmodg:hp:2027-05'), [{ reason: 'gmodgShare', cents: 7950 }])
})

// ---------- Gegenmutationen (Heizung PR 18): Fälle, die eine Mutation überlebt hätten ----------

test('Vorrat: Steht nur an einer von zwei Lieferungen eine 0, bleibt die Warnung (Abweichung 9, 10)', () => {
  const r = settle('2028-05', {
    heatingPlants: [plant({ energy: 'oil' })],
    costItems: [item({ id: 'oel', period: periodKey('2028-05'), description: 'Heizöl', fuelDeliveryId: null })],
    fuelDeliveries: [
      delivery({ id: 'oel1', label: 'Heizöl Sept.', invoiceFrom: null, invoiceTo: null, deliveredAt: '2028-09-01', quantity: 3000, quantityUnit: 'l', bioCostCents: 0 }),
      delivery({ id: 'oel2', label: 'Heizöl Jan.', invoiceFrom: null, invoiceTo: null, deliveredAt: '2029-01-15', quantity: 2000, quantityUnit: 'l', bioCostCents: null }),
    ],
  })
  assert.match(textOf(r, 'co2.half-split-missing'), /Vorrat/)
})

test('CO₂ nach den Lieferungen, nicht nach Gradtagen: Die Zwischenrechnung 2027 zählt mit ihren CO₂-Kosten (Abweichung 2)', () => {
  const r = settle('2027-05', {
    costItems: [
      item({ id: 'gasA', amountCents: 200000, fuelDeliveryId: 'A' }),
      item({ id: 'gasB', amountCents: 700000, fuelDeliveryId: 'B', period: periodKey('2028-05') }),
    ],
    fuelDeliveries: [
      delivery({ id: 'A', label: 'Gas bis 31.12.2027', invoiceFrom: '2027-10-15', invoiceTo: '2027-12-31', emissionsKg: 3000, co2CostCents: 10000, gridFeeCents: 5000 }),
      delivery({ id: 'B', label: 'Gas 2028', invoiceFrom: '2028-01-01', invoiceTo: '2028-10-14', emissionsKg: 12000, co2CostCents: 40000, gridFeeCents: 20000 }),
    ],
  })
  const table = valueAt(hkvDegreeDays, '2027-05-01')
  const anteilB = degreeDayPermille([{ from: '2028-01-01', to: '2028-04-30' }], table) / degreeDayPermille([{ from: '2028-01-01', to: '2028-10-14' }], table)
  const w = (40000 * anteilB) / (10000 + 40000 * anteilB)
  const co2 = r.heating?.[0]?.co2 ?? assert.fail('keine Bewertung')
  const stufe = (co2.stage?.landlordPercent ?? 0) * 10
  assert.ok(Math.abs((co2.landlordPermille ?? 0) - (stufe * (1 - w) + 500 * w)) < 1e-9, `${co2.landlordPermille}`)
  assert.ok(Math.abs((co2.halfSplit?.co2SharePermille ?? 0) - w * 1000) < 1e-9)
})

const messdienst = (permille: number) => settle('2027-05', {
  heatingPlants: [plant({ method: 'service' })],
  costItems: [item({ id: 'hz', description: 'Heizung laut Messdienst', key: 'amounts', tenancyAmounts: { ta: 450000, tb: 270000, tc: 180000 }, fuelDeliveryId: null, heatingPart: undefined })],
  fuelDeliveries: [],
  co2Statements: [{
    heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2027-05'), method: 'serviceShown', areaM2: null, serviceEmissionsKg: null, serviceAreaM2: null, serviceKgPerM2: 40.2,
    serviceLandlordPermille: permille, serviceTotalCents: null, serviceLandlordCents: null, serviceUsersTotalCents: null, serviceUsersTotalApprox: false,
    serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null, serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [],
  }],
})

test('Review Focus 5 in der Abrechnung: 50 % für die ganze Heizperiode passt nicht, 54,7 % gedruckt als 54,7 oder 54,8 passt', () => {
  const falsch = messdienst(500)
  const t = textOf(falsch, 'co2.stage-mismatch')
  assert.match(t, /für 53 % der Heizperiode nach Gradtagen; erwartet ist deshalb ein Anteil des Vermieters von 54,7 %/)
  assert.ok(!codesOf(messdienst(547)).includes('co2.stage-mismatch'))
  assert.ok(!codesOf(messdienst(548)).includes('co2.stage-mismatch'), 'gerundet gedruckt, innerhalb von 1 ‰')
  assert.ok(codesOf(messdienst(600)).includes('co2.stage-mismatch'), 'die Stufe allein passt nicht mehr')
})

test('Ausnahme nach § 11 ohne vereinbarte Abrechnung (§ 2 Abs. 7 CO2KostAufG): auch keine Teilung nach § 5a', () => {
  const r = settle('2027-05', { heatingPeriodRows: [{ plantId: 'hp', period: periodKey('2027-05'), dhwMethod: null, dhwUnmeasurable: null, exemption: 'lowDemand', exemptionScope: 'both' }] })
  assert.ok(!codesOf(r).some((c) => c.startsWith('co2.half-split')), codesOf(r).join(', '))
  assert.ok(!(r.legalBasis.values ?? []).some((v) => v.id.startsWith('co2.half-split')))
})

test('§ 5d Abs. 4: Endete die Verordnung vor der Heizperiode, traten die Voraussetzungen erst danach ein (Abweichung 3)', () => {
  // Einbau 01.03.2027, Verordnung bis 31.03.2027, Vertrag am 15.03.2027: Bei Vertragsschluss lagen die
  // Voraussetzungen noch nicht vor (Satz 2), die Mitteilung mit der Abrechnung genügt.
  const r = zfh(true, '2028-06-15', '2027-03-15', '2027-03-31')
  assert.ok(Math.abs((r.heating?.[0]?.co2?.landlordPermille ?? 0) - 600) < 1e-9)
  assert.match(textOf(r, 'co2.half-split-two-family'), /Satz 2/)
})

// Durchsicht M3: Gilt die Ausnahme nach § 5d Abs. 3, nennt der Hinweis zu § 5a weder den Teilungssatz noch den
// Abzug samt Kürzung, sondern nur, dass § 5a hier nicht gilt; beim Messdienst wie bei der eigenen Aufteilung.
test('§ 5d Abs. 3 mit Ausnahme: der Hinweis zu § 5a nennt keine Teilung und keine Kürzung (manual und service)', () => {
  const manual = zfh(false, '2027-04-01')
  const service = settle('2027-05', {
    properties: [{ id: 'objekt-1', kind: 'zfh', cableBuiltBeforeDec2021: null, tightMarket: false, periodRules: { startMonth: 5, changes: [] } }],
    units: [
      { id: 'a', name: 'Oben', areaM2: 300, participates: true, propertyId: 'objekt-1' },
      { id: 'b', name: 'Unten', areaM2: 300, participates: false, selfUsed: true, selfPersons: 1, propertyId: 'objekt-1' },
    ],
    tenancies: [{ id: 'ta', unitId: 'a', tenantName: 'Mieter A', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [], halfSplitNoticeOn: '2027-04-01' }],
    costItems: [item({ id: 'gas', key: 'amounts', tenancyAmounts: { ta: 450000 } })],
    heatingPlants: [plant({ method: 'service' })],
    fuelDeliveries: [delivery()],
  })
  for (const [name, r] of [['manual', manual], ['service', service]] as const) {
    const text = textOf(r, 'co2.half-split')
    assert.match(text, /Die hälftige Teilung nach § 5a gilt hier wegen § 5d Abs\. 3/, name)
    assert.doesNotMatch(text, /tragen Sie die Hälfte/, name)
    assert.doesNotMatch(text, /der CO₂-Kosten in die Teilung/, name)
    assert.doesNotMatch(text, /kürzen/, name)
    assert.equal(textsOf(r, 'co2.half-split-missing').length, 0, name)
    assert.match(textOf(r, 'co2.half-split-two-family'), /nur die CO₂-Kosten nach dem Stufenmodell/, name)
  }
})
