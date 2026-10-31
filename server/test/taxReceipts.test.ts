// „Belege für die Steuer“ (#170): ein ZIP je Objekt und Jahr, geordnet nach den Gruppen der
// Anlage V, mit allen Positionen, auch den nicht umlagefähigen.
import { CALENDAR_RULES, calendarPeriod } from '../../shared/period.ts'
import { taxReportFor } from '../src/calc.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem, TaxReceivedTenancy } from '../../shared/types.ts'
import { derivedTaxLines, incomeCsv, planTaxArchive } from '../src/taxReceipts.ts'

const item = (id: string, extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'p1', period: calendarPeriod(2025), category: 'Grundsteuer', description: `Position ${id}`, amountCents: 10000, key: 'area', ...extra,
})

const names = new Map([
  ['1_gs.pdf', 'Bescheid Grundsteuer.pdf'],
  ['2_wasser.pdf', 'Wasser.pdf'],
  ['3_verwaltung.pdf', 'Verwaltung: Hausverwaltung/2025.pdf'],
  ['4_ruecklage.pdf', 'Rücklage.pdf'],
  ['5_dach.pdf', 'Dach.pdf'],
])

test('Steuer-Belege: Ordner je Gruppe der Anlage V in deren Reihenfolge, nicht umlagefähige eingeschlossen', () => {
  const plan = planTaxArchive([
    item('w', { category: 'Wasser/Abwasser', invoiceFile: '2_wasser.pdf' }),
    item('a', { category: 'Wasser/Abwasser', description: 'Abwasser', invoiceFile: '2_wasser.pdf' }),
    item('gs', { invoiceFile: '1_gs.pdf' }),
    item('v', { category: 'Nicht umlagefähig', invoiceFile: '3_verwaltung.pdf' }),
    item('r', { category: 'Zuführung Erhaltungsrücklage', invoiceFile: '4_ruecklage.pdf' }),
    // #96: Die Entnahme aus der Rücklage ist Erhaltungsaufwand und hat ihren Ordner vor „Verwaltung & Instandhaltung“.
    item('e', { category: 'Entnahme Erhaltungsrücklage', invoiceFile: '5_dach.pdf' }),
    item('ohne', { category: 'Gartenpflege', amountCents: 5000 }),
    item('weg', { category: 'Müllabfuhr', invoiceFile: '9_fehlt.pdf' }),
  ], names)
  assert.deepEqual(plan.files.map((f) => [f.zipPath, f.file]), [
    ['1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Bescheid Grundsteuer.pdf', '1_gs.pdf'],
    // Ein Beleg für zwei Positionen derselben Gruppe kommt einmal hinein.
    ['2 Laufende Betriebskosten/Wasser-Abwasser - Wasser.pdf', '2_wasser.pdf'],
    ['4 Erhaltungsaufwand/Entnahme Erhaltungsrücklage - Dach.pdf', '5_dach.pdf'],
    ['5 Verwaltung & Instandhaltung/Nicht umlagefähig - Verwaltung- Hausverwaltung-2025.pdf', '3_verwaltung.pdf'],
    // Die Zuführung zur Rücklage ist keine Werbungskosten dieses Jahres und steht für sich.
    ['7 Erhaltungsrücklage (gesondert)/Zuführung Erhaltungsrücklage - Rücklage.pdf', '4_ruecklage.pdf'],
  ])
  const zeilen = plan.overviewCsv.replace(/^﻿/, '').trim().split('\r\n')
  assert.equal(zeilen[0], 'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg;Jahr der Zahlung')
  assert.equal(zeilen.length, 9)
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gartenpflege;Position ohne;;50,00;;;;kein Beleg;'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Müllabfuhr;Position weg;;100,00;;;;Datei fehlt;'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Wasser/Abwasser;Abwasser;;100,00;;;;2 Laufende Betriebskosten/Wasser-Abwasser - Wasser.pdf;'))
  assert.ok(plan.overviewCsv.startsWith('﻿'), 'mit BOM, damit Excel die Umlaute richtig liest')
})

test('Steuer-Belege: gleiche Namen in einem Ordner bekommen eine Nummer, Felder mit Semikolon werden gequotet', () => {
  const plan = planTaxArchive([
    item('a', { invoiceFile: 'x1.pdf', description: 'Teil; eins' }),
    item('b', { invoiceFile: 'x2.pdf' }),
  ], new Map([['x1.pdf', 'Bescheid.pdf'], ['x2.pdf', 'Bescheid.pdf']]))
  assert.deepEqual(plan.files.map((f) => f.zipPath), [
    '1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Bescheid.pdf',
    '1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Bescheid (2).pdf',
  ])
  assert.match(plan.overviewCsv, /;"Teil; eins";/)
})

test('Steuer-Belege: ein Feld, das mit = + - @ beginnt, wird nicht als Formel gelesen (Durchsicht)', () => {
  // Rechnungssteller und Beschreibung kommen auch aus der KI-Auswertung eines fremden Belegs. Eine
  // Zelle „=HYPERLINK(…)“ führte Excel beim Öffnen der Übersicht aus.
  const plan = planTaxArchive([
    item('a', { vendor: '=HYPERLINK("http://x")', description: '+1+1' }),
    item('b', { vendor: '@SUMME(A1)', description: '-2' }),
    item('c', { vendor: '\tTab', description: '\rCR' }),
  ], new Map())
  const zeilen = plan.overviewCsv.replace(/^﻿/, '').split('\r\n')
  assert.ok(zeilen.some((z) => z.includes(`;'+1+1;"'=HYPERLINK(""http://x"")";`)), zeilen.join('\n'))
  assert.ok(zeilen.some((z) => z.includes(`;'-2;'@SUMME(A1);`)), zeilen.join('\n'))
  assert.ok(plan.overviewCsv.includes(`'\tTab`), 'Tab entschärft')
  assert.ok(plan.overviewCsv.includes(`"'\rCR"`), 'CR entschärft und gequotet')
  // Beträge bleiben Zahlen, auch eine Gutschrift mit Minus.
  const gutschrift = planTaxArchive([item('g', { amountCents: -500 })], new Map()).overviewCsv
  assert.match(gutschrift, /;-5,00;/)
})

test('Steuer-Belege (#170): Abschlag und Restrechnung einer Position liegen beide im ZIP, die Position steht einmal in der Übersicht', () => {
  const st = item('st', { category: 'Wasser/Abwasser', invoiceFile: '1_abschlag.pdf', amountCents: 162000 })
  const plan = planTaxArchive([st], new Map([['1_abschlag.pdf', 'Abschlag.pdf'], ['2_rest.pdf', 'Rest.pdf']]), new Map([['st', ['2_rest.pdf', '1_abschlag.pdf']]]))
  assert.deepEqual(plan.files.map((f) => f.file), ['1_abschlag.pdf', '2_rest.pdf'])
  const zeilen = plan.overviewCsv.split('\r\n').filter((l) => l.includes('Position st'))
  assert.equal(zeilen.length, 1, 'die Position steht nicht doppelt in der Übersicht')
  assert.ok(zeilen[0]?.includes('Wasser-Abwasser - Abschlag.pdf | 2 Laufende Betriebskosten/Wasser-Abwasser - Rest.pdf'), zeilen[0])
})

test('Steuer-Belege (#170): eine Position ohne invoiceFile, deren Beleg nur an einer gebuchten Zeile hängt, hat ihn im ZIP', () => {
  const plan = planTaxArchive([item('st', { category: 'Wasser/Abwasser' })], new Map([['2_rest.pdf', 'Rest.pdf']]), new Map([['st', ['2_rest.pdf']]]))
  assert.deepEqual(plan.files.map((f) => f.file), ['2_rest.pdf'])
  assert.ok(!plan.overviewCsv.includes('kein Beleg'))
})

test('Steuer-Belege: privat und abziehbar je Position aus der Steuerübersicht, die Rücklage ohne (#163)', () => {
  const plan = planTaxArchive([
    item('gs', { amountCents: 50000 }),
    item('r', { category: 'Zuführung Erhaltungsrücklage', amountCents: 30000 }),
  ], names, new Map(), new Map([['gs', { privateCents: 30000, deductibleCents: 20000 }]]))
  const zeilen = plan.overviewCsv.replace(/^\uFEFF/, '').trim().split('\r\n')
  assert.ok(zeilen.includes('Grundsteuer & öffentliche Abgaben;Grundsteuer;Position gs;;500,00;300,00;200,00;;kein Beleg;'), zeilen.join('\n'))
  assert.ok(zeilen.includes('Erhaltungsrücklage (gesondert);Zuführung Erhaltungsrücklage;Position r;;300,00;;;;kein Beleg;2025, Jahr der Abrechnung (ohne Angabe)'), zeilen.join('\n'))
})

// Integrationsdurchsicht vor 0.10 (N2): Die Steuerübersicht setzt einen ungültigen Lohnanteil
// (über dem Betrag oder negativ) nicht an (`validLabor35aCents`); die Übersicht im ZIP darf ihn
// dann ebenso wenig nennen, sonst sagen beide Verschiedenes zur selben Position.
test('Steuer-Belege: ein ungültiger §35a-Lohnanteil steht wie in der Steuerübersicht nicht in der Übersicht', () => {
  const plan = planTaxArchive([
    item('zuviel', { category: 'Gartenpflege', amountCents: 1000, labor35aCents: 2000 }),
    item('negativ', { category: 'Hauswart', amountCents: 1000, labor35aCents: -100 }),
    item('gut', { category: 'Gebäudereinigung', amountCents: 1000, labor35aCents: 600 }),
  ], names)
  const zeilen = plan.overviewCsv.replace(/^﻿/, '').trim().split('\r\n')
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gartenpflege;Position zuviel;;10,00;;;;kein Beleg;'), zeilen.join('\n'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Hauswart;Position negativ;;10,00;;;;kein Beleg;'), zeilen.join('\n'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gebäudereinigung;Position gut;;10,00;;;6,00;kein Beleg;'), zeilen.join('\n'))
})

// #268: Der Ausgleich beim Betriebsstrom ist keine Position, gehört aber zu den Werbungskosten der Übersicht. Im ZIP
// steht er als eigene Zeile ohne eigenen Beleg; die Summen der Spalten sind dann die der Steuerübersicht.
test('Steuer-Belege (#268): der Ausgleich beim Betriebsstrom steht als Zeile ohne eigenen Beleg, Summen wie in der Übersicht', () => {
  const plant = {
    id: 'hp1', propertyId: 'p1', name: 'Kessel', method: 'manual' as const, source: 'building' as const, supply: 'central' as const, energy: 'gas' as const,
    devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, units: null,
    periodStartMonth: null, periodChanges: [], separateSpans: [], separateSettlement: false, endsOn: null, replacesPlantId: null,
  }
  const items = [
    item('gas', { category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, heatingPlantId: 'hp1', heatingPart: 'fuel' }),
    item('hs', { category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units' }),
    item('ab', { category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom', amountCents: -20000, key: 'units', operatingPower: 'deduction', operatingPowerGeneralId: 'hs' }),
  ]
  const source = {
    properties: [{ id: 'p1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    units: [{ id: 'u1', propertyId: 'p1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', propertyId: 'p1', name: 'OG', areaM2: 40, participates: true }],
    tenancies: [], costItems: items, meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [plant],
  }
  const report = taxReportFor(source, 'p1', 2025)
  const split = new Map(report.expenses.items.map((i) => [i.costItemId, i]))
  const plan = planTaxArchive(items, names, new Map(), split, report.expenses.items.filter((i) => i.operatingPowerBalance))
  const zeilen = plan.overviewCsv.replace(/^﻿/, '').trim().split('\r\n')
  assert.ok(zeilen.includes('Laufende Betriebskosten;Beleuchtung/Allgemeinstrom;Betriebsstrom der Heizung, selbst getragen;;200,00;0,00;200,00;;kein eigener Beleg (Teil der Stromrechnung);'), zeilen.join('\n'))
  const cents = (s: string | undefined) => Math.round(Number((s ?? '').replace(',', '.')) * 100)
  const rows = zeilen.slice(1).map((z) => z.split(';'))
  const strom = rows.filter((r) => r[1] === 'Beleuchtung/Allgemeinstrom').reduce((a, r) => a + cents(r[4]), 0)
  assert.equal(strom, 100000, 'Allgemeinstrom 1.000 − 200 + 200: die bezahlte Stromrechnung')
  assert.equal(rows.reduce((a, r) => a + cents(r[4]), 0), report.expenses.totalCents)
  assert.equal(rows.reduce((a, r) => a + cents(r[6]), 0), report.expenses.deductibleCents)
})

// Nachprüfung N-4 zu PR 19: Die Übersicht führt jede Zeile der Steuerübersicht, auch die an Selbstversorger ausgezahlte
// CO₂-Erstattung neben dem Ausgleich beim Betriebsstrom (#268). Summe der CSV = Werbungskosten der Steuerübersicht.
test('Steuer-Belege (N-4): CO₂-Erstattung und Betriebsstrom-Ausgleich als Zeilen ohne eigenen Beleg; Summen wie in der Übersicht', () => {
  const plant = {
    id: 'hp1', propertyId: 'p1', name: 'Kessel', method: 'manual' as const, source: 'building' as const, supply: 'central' as const, energy: 'gas' as const,
    devicesRemote: 'unknown' as const, devicesInstalledAfter2021: 'unknown' as const, newDevicesInstall: null, units: [{ unitId: 'u2', heatedAreaM2: null }],
    periodStartMonth: null, periodChanges: [], separateSpans: [], separateSettlement: false, endsOn: null, replacesPlantId: null,
  }
  const items = [
    item('gas', { category: 'Heizung und Warmwasser', description: 'Gas', amountCents: 500000, heatingPlantId: 'hp1', heatingPart: 'fuel' }),
    item('hs', { category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom', amountCents: 100000, key: 'units' }),
    item('ab', { category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug Betriebsstrom', amountCents: -20000, key: 'units', operatingPower: 'deduction', operatingPowerGeneralId: 'hs' }),
  ]
  const mieter = (id: string, unitId: string, over: Record<string, unknown> = {}) => ({
    id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [], ...over,
  })
  const source = {
    properties: [{ id: 'p1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    units: [{ id: 'u1', propertyId: 'p1', name: 'EG', areaM2: 60, participates: true }, { id: 'u2', propertyId: 'p1', name: 'OG', areaM2: 40, participates: true }],
    tenancies: [mieter('t1', 'u1', { heatingModel: 'selfSupply' as const }), mieter('t2', 'u2')],
    costItems: items, meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [plant],
    co2Refunds: [{
      id: 'e1', tenancyId: 't1', supplierBilledAt: '2025-01-20', claimedAt: '2025-03-01', amountCents: 5000, settlePeriod: null, paidOutOn: '2025-06-01',
      billedFrom: '2024-01-01', billedTo: '2024-12-31', emissionsKg: null, co2CostCents: null, areaM2: null, ownAppliances: false, commercialUse: false,
      commercialMetered: false, nonResidential: false, restriction: 'none' as const, halfSplitFrom: null, gridFeeCents: null, bioCostCents: null,
    }],
  }
  const report = taxReportFor(source, 'p1', 2025)
  const split = new Map(report.expenses.items.map((i) => [i.costItemId, i]))
  const plan = planTaxArchive(items, names, new Map(), split, derivedTaxLines(report))
  const zeilen = plan.overviewCsv.replace(/^\uFEFF/, '').trim().split('\r\n')
  assert.ok(zeilen.includes('Sonstige Werbungskosten;CO₂-Erstattung an Mieter (§ 6 Abs. 2 CO2KostAufG);CO₂-Erstattung an Mieter, ausgezahlt am 01.06.2025;;50,00;0,00;50,00;;kein eigener Beleg (Auszahlung an den Mieter, Nachweis über den Kontoauszug);'), zeilen.join('\n'))
  assert.ok(zeilen.some((z) => z.includes('Betriebsstrom der Heizung, selbst getragen;;200,00')), zeilen.join('\n'))
  const cents = (s: string | undefined) => Math.round(Number((s ?? '').replace(',', '.')) * 100)
  const rows = zeilen.slice(1).map((z) => z.split(';'))
  assert.equal(rows.reduce((a, r) => a + cents(r[4]), 0), report.expenses.totalCents)
  assert.equal(rows.reduce((a, r) => a + cents(r[5]), 0), report.expenses.privateCents)
  assert.equal(rows.reduce((a, r) => a + cents(r[6]), 0), report.expenses.deductibleCents)
})

// #255, PR 4 (T14): Die Übersicht nennt je Position das Jahr der Zahlung und woher es kommt, aus der Steuerübersicht.
test('Steuer-Belege (#255): die Spalte „Jahr der Zahlung“ nennt die Quelle, bei Verschiebung die Abrechnung', () => {
  const plan = planTaxArchive([
    item('gs', { description: 'Grundsteuer 2025', amountCents: 60000, paidOn: '2026-02-20' }),
    item('vers', { category: 'Sach- und Haftpflichtversicherung', description: 'Versicherung 2026', amountCents: 125000 }),
    item('jahr', { category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 1000, taxYear: 2026 }),
    item('ab', { category: 'Beleuchtung/Allgemeinstrom', description: 'Abzug', amountCents: -1000 }),
  ], names, new Map(), new Map([
    ['gs', { privateCents: 0, deductibleCents: 60000, outflow: { year: 2026, source: 'paid' as const, paidOn: '2026-02-20' }, settlementPeriod: { key: calendarPeriod(2025), label: '2025' } }],
    ['vers', { privateCents: 0, deductibleCents: 125000, outflow: { year: 2026, source: 'period' as const } }],
    ['jahr', { privateCents: 0, deductibleCents: 1000, outflow: { year: 2026, source: 'stated' as const } }],
    ['ab', { privateCents: 0, deductibleCents: -1000, outflow: { year: 2026, source: 'bill' as const } }],
  ]))
  const zeilen = plan.overviewCsv.replace(/^﻿/, '').trim().split('\r\n')
  assert.ok(zeilen[0]?.endsWith(';Beleg;Jahr der Zahlung'), zeilen[0])
  const last = (desc: string) => (zeilen.find((z) => z.split(';')[2] === desc) ?? assert.fail(desc)).split(';').at(-1)
  assert.equal(last('Grundsteuer 2025'), '2026, bezahlt am 20.02.2026, aus Abrechnung 2025')
  assert.equal(last('Versicherung 2026'), '2026, Jahr der Abrechnung (ohne Angabe)')
  assert.equal(last('Wasser'), '2026, als Jahr der Zahlung angegeben')
  assert.equal(last('Abzug'), '2026, wie die Stromrechnung')
})

// Durchsicht von PR 4, K3: Die Rücklage steht wegen ihres Jahres der Zahlung im Archiv, also nennt die Spalte es auch;
// ein Datum außerhalb der üblichen Spanne bekommt den Hinweis zum Prüfen.
test('Steuer-Belege (#255): „Jahr der Zahlung“ auch bei der Rücklage, und der Hinweis zur Spanne', () => {
  const plan = planTaxArchive([
    item('r', { category: 'Zuführung Erhaltungsrücklage', description: 'Rücklage', amountCents: 30000, paidOn: '2026-01-20' }),
    item('r2', { category: 'Zuführung Erhaltungsrücklage', description: 'Rücklage ohne', amountCents: 30000 }),
    item('gs', { description: 'Grundsteuer spät', amountCents: 1000, paidOn: '2030-03-01' }),
  ], names, new Map(), new Map([
    ['gs', { privateCents: 0, deductibleCents: 1000, outflow: { year: 2030, source: 'paid' as const, paidOn: '2030-03-01' }, settlementPeriod: { key: calendarPeriod(2025), label: '2025' }, outsideSpan: true as const }],
  ]))
  const zeilen = plan.overviewCsv.replace(/^\uFEFF/, '').trim().split('\r\n')
  const last = (desc: string) => (zeilen.find((z) => z.split(';')[2] === desc) ?? assert.fail(desc)).split(';').at(-1)
  assert.equal(last('Rücklage'), '2026, bezahlt am 20.01.2026')
  assert.equal(last('Rücklage ohne'), '2025, Jahr der Abrechnung (ohne Angabe)')
  assert.equal(last('Grundsteuer spät'), '2030, bezahlt am 01.03.2030, aus Abrechnung 2025, außerhalb der üblichen Spanne, bitte prüfen')
})

test('Steuer-Belege: mit verbilligter Vermietung (#257) eine Spalte „unentgeltlich“, sonst nicht', () => {
  const split = new Map([['d', { privateCents: 0, deductibleCents: 5333, gratuitousCents: 4667 }]])
  const zeilen = planTaxArchive([item('d', { category: 'Nicht umlagefähig' })], names, new Map(), split).overviewCsv.replace(/^\uFEFF/, '').trim().split('\r\n')
  assert.equal(zeilen[0], 'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);unentgeltlich § 21 Abs. 2 EStG (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg;Jahr der Zahlung')
  assert.equal(zeilen[1], 'Verwaltung & Instandhaltung;Nicht umlagefähig;Position d;;100,00;0,00;46,67;53,33;;kein Beleg;')
})

// #469: Ein Teil einer aufgeteilten Rechnung (#455) ohne eigenen Beleg ist belegt, wenn ein anderer Teil derselben
// Quelle ihn trägt (wie `isItemCovered` im Belegordner). Die Übersicht nennt dann den Beleg der Rechnung, und die Datei
// liegt im ZIP, auch wenn der Teil mit dem Beleg in einem anderen Steuerjahr steht; einmal, nicht je Teil.
test('Steuer-Belege (#469): ein Teil ohne eigenen Beleg nennt den Beleg seiner Rechnung, die Datei liegt einmal im ZIP', () => {
  const a = item('a', { category: 'Gartenpflege', description: 'Garten (anteilig 1/2)', sourceId: 'q1', invoiceFile: '1_gs.pdf', amountCents: 5000 })
  const b = item('b', { category: 'Gartenpflege', description: 'Garten (anteilig 2/2)', sourceId: 'q1', amountCents: 5000 })
  const fremd = item('f', { category: 'Gartenpflege', description: 'Anderer Garten', sourceId: 'q2' })
  const parts = new Map([['q1', [a, b]], ['q2', [fremd]]])
  // Beide Teile im selben Jahr: dieselbe Datei, einmal im ZIP, in beiden Zeilen genannt.
  const both = planTaxArchive([a, b, fremd], names, new Map(), new Map(), [], parts)
  assert.deepEqual(both.files.map((f) => [f.zipPath, f.file]), [['2 Laufende Betriebskosten/Gartenpflege - Bescheid Grundsteuer.pdf', '1_gs.pdf']])
  const zeilen = both.overviewCsv.replace(/^﻿/, '').trim().split('\r\n')
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gartenpflege;Garten (anteilig 2/2);;50,00;;;;2 Laufende Betriebskosten/Gartenpflege - Bescheid Grundsteuer.pdf;'), zeilen.join('\n'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gartenpflege;Anderer Garten;;100,00;;;;kein Beleg;'), 'eine andere Quelle ohne Beleg bleibt ohne')
  // Nur der Teil ohne Beleg in diesem Jahr: Die Datei kommt trotzdem mit.
  const alone = planTaxArchive([b], names, new Map(), new Map(), [], parts)
  assert.deepEqual(alone.files.map((f) => f.file), ['1_gs.pdf'])
  assert.ok(!alone.overviewCsv.includes('kein Beleg'), alone.overviewCsv)
  // Auch ein Beleg, der nur an einer gebuchten Zeile des anderen Teils hängt.
  const a2: CostItem = { ...a, id: 'a2' }
  delete a2.invoiceFile
  const viaBooked = planTaxArchive([b], names, new Map([['a2', ['2_wasser.pdf']]]), new Map(), [], new Map([['q1', [a2, b]]]))
  assert.deepEqual(viaBooked.files.map((f) => f.file), ['2_wasser.pdf'])
  // Der eigene Beleg geht vor: Trägt der Teil einen, kommt der des anderen Teils nicht dazu.
  const own = planTaxArchive([{ ...b, invoiceFile: '2_wasser.pdf' }], names, new Map(), new Map(), [], parts)
  assert.deepEqual(own.files.map((f) => f.file), ['2_wasser.pdf'])
  // Ohne Quelle (alter Teil) bleibt es wie bisher.
  const old: CostItem = { ...b }
  delete old.sourceId
  const plain = planTaxArchive([old], names, new Map(), new Map(), [], parts)
  assert.deepEqual(plain.files, [])
  assert.match(plain.overviewCsv, /;kein Beleg;/)
})

// #262 PR 2 (Durchsicht): Die Übersicht.csv einer Verteilung nach § 82b EStDV. Im Jahr des Abflusses steht die Position
// mit dem verschobenen Teil in einer eigenen Spalte, in den Folgejahren die Rate als Zeile ohne eigenen Beleg; je Zeile
// gilt Betrag = privat + unentgeltlich + verteilt + abziehbar, und die Spalten ergeben die Summen der Steuerübersicht.
test('Steuer-Belege (#262): Spalte „verteilt § 82b EStDV“ und die Rate des Folgejahres ohne eigenen Beleg', () => {
  const dach = item('dach', { category: 'Nicht umlagefähig', description: 'Dachsanierung', period: calendarPeriod(2026), amountCents: 1_000_000, spreadYears: 3, invoiceFile: '5_dach.pdf' })
  const mieter = (id: string, unitId: string) => ({
    id, unitId, tenantName: id, persons: 1, personHistory: [{ from: '2020-01-01', persons: 1 }], start: '2020-01-01', end: null,
    prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 50_000 }],
  })
  const source = {
    properties: [{ id: 'p1', kind: 'mfh' as const, cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
    units: [{ id: 'u1', propertyId: 'p1', name: 'EG', areaM2: 40, participates: false, selfUsed: true }, { id: 'u2', propertyId: 'p1', name: 'OG', areaM2: 60, participates: true }],
    tenancies: [mieter('t2', 'u2')],
    costItems: [dach, item('gs', { period: calendarPeriod(2027), amountCents: 60_000 })], meters: [], readings: [], payments: [], closedSettlements: [],
  }
  const cents = (s: string | undefined) => Math.round(Number((s ?? '').replace(',', '.')) * 100)
  for (const year of [2026, 2027]) {
    const report = taxReportFor(source, 'p1', year)
    const split = new Map(report.expenses.items.map((i) => [i.costItemId, i]))
    const items = source.costItems.filter((c) => c.period === calendarPeriod(year))
    const zeilen = planTaxArchive(items, names, new Map(), split, derivedTaxLines(report)).overviewCsv.replace(/^﻿/, '').trim().split('\r\n')
    const head = (zeilen[0] ?? '').split(';')
    assert.ok(head.includes('verteilt § 82b EStDV (EUR)'), zeilen[0])
    const col = (name: string) => head.indexOf(name)
    const rows = zeilen.slice(1).map((z) => z.split(';'))
    const sum = (name: string) => rows.reduce((a, r) => a + cents(r[col(name)]), 0)
    assert.equal(sum('Betrag (EUR)'), report.expenses.totalCents, `${year}: Betrag`)
    assert.equal(sum('privat (EUR)'), report.expenses.privateCents, `${year}: privat`)
    assert.equal(sum('verteilt § 82b EStDV (EUR)'), report.expenses.deferredCents ?? 0, `${year}: verteilt`)
    assert.equal(sum('abziehbar (EUR)'), report.expenses.deductibleCents, `${year}: abziehbar`)
    for (const r of rows) {
      assert.equal(cents(r[col('privat (EUR)')]) + cents(r[col('verteilt § 82b EStDV (EUR)')]) + cents(r[col('abziehbar (EUR)')]), cents(r[col('Betrag (EUR)')]), `${year}: ${r.join(';')}`)
    }
    if (year === 2026) {
      const z = rows.find((r) => r[2] === 'Dachsanierung') ?? assert.fail('Zeile fehlt')
      assert.deepEqual([z[col('Betrag (EUR)')], z[col('privat (EUR)')], z[col('verteilt § 82b EStDV (EUR)')], z[col('abziehbar (EUR)')]], ['10000,00', '4000,00', '4000,00', '2000,00'])
      assert.equal(z.at(-1), '2026, Jahr der Abrechnung (ohne Angabe), auf 3 Jahre verteilt, 2026 bis 2028')
    } else {
      const z = rows.find((r) => r[2] === 'Anteil 2 von 3 aus 2026: Dachsanierung') ?? assert.fail(`Zeile fehlt: ${zeilen.join('\n')}`)
      assert.deepEqual([z[col('Betrag (EUR)')], z[col('verteilt § 82b EStDV (EUR)')], z[col('abziehbar (EUR)')]], ['0,00', '-2000,00', '2000,00'])
      assert.equal(z[col('Beleg')], 'kein eigener Beleg (Anteil 2 von 3 aus 2026, Beleg im Steuer-ZIP 2026)')
      assert.equal(z.at(-1), '2026, Anteil 2 von 3')
    }
  }
  // Ohne Verteilung keine Spalte.
  const ohne = planTaxArchive([item('gs')], names, new Map(), new Map([['gs', { privateCents: 0, deductibleCents: 10000 }]])).overviewCsv
  assert.equal(ohne.includes('verteilt'), false)
})

// #312 PR 3: `Einnahmen.csv` neben der Übersicht, gleiche Form (BOM, `;`, CRLF, Euro wie `euro()`), eine Zeile je
// Mietverhältnis aus `income.received.byTenancy`, Summenzeile am Ende.
const rentRow = (over: Partial<TaxReceivedTenancy> = {}): TaxReceivedTenancy => ({
  tenancyId: 't1', unitId: 'u1', tenantName: 'Meyer', unitName: 'EG', start: '2020-03-01', end: null, relative: false,
  rentCents: 720000, inclusiveRentCents: 0, allocationsCents: 240000, settlementCents: 15000, formerYearsCents: 0, unallocatedCents: 0, forwardCents: 0,
  ...over,
})
const INCOME_HEAD = 'Wohnung;Mieter;Beginn;Ende;Miete ohne Umlagen (EUR);davon Inklusivmiete (EUR);Umlagen laufend (EUR);Abrechnung Nachzahlung/Erstattung (EUR);Mieten für frühere Jahre (EUR);ohne vereinbarte Miete (EUR);Zufluss gesamt (EUR);Zehn-Tage-Regel Folgejahr (EUR)'

test('Einnahmen.csv: Kopf, eine Zeile je Mietverhältnis, Summe, BOM und CRLF (#312)', () => {
  const csv = incomeCsv([
    rentRow(),
    rentRow({ tenancyId: 't2', unitName: 'OG', tenantName: '=Schulz; Anna', start: '2025-07-01', end: '2025-12-31', rentCents: 300000, inclusiveRentCents: 300000, allocationsCents: 0, settlementCents: -5000, formerYearsCents: 0, unallocatedCents: 2000, forwardCents: 80000 }),
  ])
  assert.ok(csv.startsWith('﻿'), 'Byte-Order-Mark')
  assert.ok(csv.endsWith('\r\n'))
  const lines = csv.slice(1).split('\r\n')
  assert.equal(lines.pop(), '')
  assert.deepEqual(lines, [
    INCOME_HEAD,
    'EG;Meyer;01.03.2020;;7200,00;0,00;2400,00;150,00;0,00;0,00;9750,00;0,00',
    // Ein Name, der mit = beginnt, wird entschärft; das Semikolon steht in Anführungszeichen.
    `OG;"'=Schulz; Anna";01.07.2025;31.12.2025;3000,00;3000,00;0,00;-50,00;0,00;20,00;2950,00;800,00`,
    'Summe;;;;10200,00;3000,00;2400,00;100,00;0,00;20,00;12700,00;800,00',
  ])
  // Zufluss gesamt = Miete + Umlagen + Abrechnung + frühere Jahre; die Zehn-Tage-Regel steht daneben und zählt nicht mit.
  assert.equal(720000 + 240000 + 15000, 975000)
  assert.equal(300000 - 5000, 295000)
})

test('Einnahmen.csv ohne Mietverhältnis: Kopf und Summe 0 (#312)', () => {
  assert.equal(incomeCsv([]), `﻿${INCOME_HEAD}\r\nSumme;;;;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00\r\n`)
})
