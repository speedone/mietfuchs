import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeSettlement,
  computePrepaymentCents,
  consumptionInPeriod,
  meterSegments,
  overlapDays,
  daysInYear,
  personDaysInPeriod,
  rentLedger,
  taxReport,
} from '../src/calc.js'

// Szenario wie beim Nutzer: 3 Wohnungen, EG selbstbewohnt (nicht beteiligt),
// zwei vermietete Wohnungen tragen alle Kosten.
function makeDb() {
  return {
    settings: {},
    units: [
      { id: 'u1', name: 'EG (Eigennutzung)', areaM2: 80, participates: false },
      { id: 'u2', name: 'OG links', areaM2: 90, participates: true },
      { id: 'u3', name: 'OG rechts', areaM2: 60, participates: true },
    ],
    tenancies: [
      { id: 't2', unitId: 'u2', tenantName: 'Familie A', persons: 4, start: '2020-01-01', end: null, prepaymentMonthlyCents: 15000 },
      { id: 't3', unitId: 'u3', tenantName: 'Familie B', persons: 3, start: '2020-01-01', end: null, prepaymentMonthlyCents: 10000 },
    ],
    costItems: [],
  }
}

test('overlapDays: volles Jahr, Teiljahr, kein Überlapp', () => {
  assert.equal(overlapDays('2020-01-01', null, 2025), 365)
  assert.equal(overlapDays('2025-07-01', null, 2025), 184)
  assert.equal(overlapDays('2020-01-01', '2025-03-31', 2025), 90)
  assert.equal(overlapDays('2026-01-01', null, 2025), 0)
  assert.equal(daysInYear(2024), 366)
})

test('Flächenschlüssel: Eigennutzung bleibt außen vor, Verteilung 90:60', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(db, 2025)
  const a = s.statements.find((x) => x.tenancyId === 't2')
  const b = s.statements.find((x) => x.tenancyId === 't3')
  assert.equal(a.totalShareCents, 54000) // 90/150 von 900 €
  assert.equal(b.totalShareCents, 36000) // 60/150 von 900 €
  assert.equal(s.landlord.totalCents, 0)
})

test('Personenschlüssel: 4 vs 3 Personen, centgenau ohne Rest', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100001, key: 'persons' })
  const s = computeSettlement(db, 2025)
  const a = s.statements.find((x) => x.tenancyId === 't2')
  const b = s.statements.find((x) => x.tenancyId === 't3')
  assert.equal(a.totalShareCents + b.totalShareCents, 100001) // exakte Summe trotz krummer Teilung
  assert.equal(s.landlord.totalCents, 0)
  // 4/7 von 1000,01 € ≈ 571,43 €
  assert.ok(Math.abs(a.totalShareCents - 57143) <= 1)
})

test('Mieterwechsel: zeitanteilige Verteilung, Leerstand trägt der Vermieter', () => {
  const db = makeDb()
  // Familie B zieht Ende März aus, Wohnung steht danach leer
  db.tenancies[1].end = '2025-03-31'
  db.costItems.push({ id: 'c1', year: 2025, category: 'Versicherung', description: 'Gebäudeversicherung', amountCents: 60000, key: 'area' })
  const s = computeSettlement(db, 2025)
  const a = s.statements.find((x) => x.tenancyId === 't2')
  const b = s.statements.find((x) => x.tenancyId === 't3')
  assert.equal(a.totalShareCents, 36000) // 90/150 volles Jahr
  assert.equal(b.totalShareCents, Math.round(24000 * (90 / 365))) // 60/150, aber nur 90 Tage
  assert.equal(a.totalShareCents + b.totalShareCents + s.landlord.totalCents, 60000)
  assert.ok(s.landlord.totalCents > 0)
})

test('Direktzuordnung geht vollständig an eine Wohnung', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Zähler OG links', amountCents: 12345, key: 'direct', directUnitId: 'u2' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 12345)
  assert.equal(s.statements.find((x) => x.tenancyId === 't3').totalShareCents, 0)
})

test('Vorauszahlungen und Saldo', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 300000, key: 'units' })
  const s = computeSettlement(db, 2025)
  const a = s.statements.find((x) => x.tenancyId === 't2')
  assert.equal(a.prepaymentCents, 180000) // 150 € × 12
  assert.equal(a.totalShareCents, 150000) // halbe Kosten
  assert.equal(a.balanceCents, 30000) // 300 € Guthaben
})

test('Nicht umlagefähige Kosten trägt vollständig der Vermieter', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Nicht umlagefähig', description: 'Dachreparatur', amountCents: 50000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 0)
  assert.equal(s.landlord.totalCents, 50000)
})

test('Vorauszahlungs-Staffel: Erhöhung zum Juli', () => {
  const t = {
    start: '2024-01-01', end: null,
    prepayments: [
      { from: '2024-01', monthlyCents: 15000 },
      { from: '2025-07', monthlyCents: 18000 },
    ],
  }
  // 6 × 150 € + 6 × 180 € = 1.980 €
  assert.deepEqual(computePrepaymentCents(t, 2025), { cents: 198000, overridden: false })
  // Vorjahr: ganzjährig 150 €
  assert.deepEqual(computePrepaymentCents(t, 2024), { cents: 180000, overridden: false })
})

test('Vorauszahlungen: Einzug Mitte März zählt ab April', () => {
  const t = { start: '2025-03-15', end: null, prepayments: [{ from: '2025-03', monthlyCents: 10000 }] }
  assert.equal(computePrepaymentCents(t, 2025).cents, 90000) // Apr–Dez = 9 Monate
})

test('Vorauszahlungen: manuelle Jahres-Korrektur hat Vorrang', () => {
  const t = {
    start: '2024-01-01', end: null,
    prepayments: [{ from: '2024-01', monthlyCents: 15000 }],
    prepaymentOverrides: { '2025': 165000 }, // ein Monat nicht gezahlt
  }
  assert.deepEqual(computePrepaymentCents(t, 2025), { cents: 165000, overridden: true })
  assert.equal(computePrepaymentCents(t, 2024).cents, 180000)
})

test('Vorauszahlungen: Altformat (fester Monatsbetrag) wird weiter unterstützt', () => {
  const t = { start: '2020-01-01', end: null, prepaymentMonthlyCents: 15000 }
  assert.equal(computePrepaymentCents(t, 2025).cents, 180000)
})

test('Kosten anderer Jahre werden ignoriert', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2024, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.totalCostsCents, 0)
})

test('Personen-Staffel: Geburt im Jahr ändert Personentage', () => {
  const t = {
    start: '2024-01-01', end: null,
    personHistory: [
      { from: '2024-01-01', persons: 2 },
      { from: '2025-07-01', persons: 3 }, // Nachwuchs ab Juli
    ],
  }
  // Jan–Jun: 181 Tage × 2 + Jul–Dez: 184 Tage × 3 = 362 + 552 = 914
  assert.equal(personDaysInPeriod(t, '2025-01-01', '2025-12-31'), 914)
  // Vorjahr: 366 Tage × 2 (Schaltjahr)
  assert.equal(personDaysInPeriod(t, '2024-01-01', '2024-12-31'), 732)
})

test('Personenschlüssel nutzt die Staffel in der Abrechnung', () => {
  const db = makeDb()
  db.tenancies[0].personHistory = [
    { from: '2020-01-01', persons: 4 },
    { from: '2025-07-01', persons: 5 },
  ]
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'persons' })
  const s = computeSettlement(db, 2025)
  const a = s.statements.find((x) => x.tenancyId === 't2')
  const b = s.statements.find((x) => x.tenancyId === 't3')
  const pdA = 181 * 4 + 184 * 5 // 1644
  const pdB = 365 * 3 // 1095
  assert.equal(a.totalShareCents + b.totalShareCents, 100000)
  assert.ok(Math.abs(a.totalShareCents - Math.round((100000 * pdA) / (pdA + pdB))) <= 1)
  assert.equal(a.persons, 5) // aktuelle Personenzahl am Periodenende
})

test('Verbrauch: lineare Interpolation über Jahresgrenze', () => {
  // Ablesung 31.12.2024: 100, Ablesung 31.12.2025: 200 → Jahr 2025 = volle 100
  const readings = [
    { date: '2024-12-31', value: 100 },
    { date: '2025-12-31', value: 200 },
  ]
  assert.ok(Math.abs(consumptionInPeriod(readings, '2025-01-01', '2025-12-31') - 100) < 1e-9)
  // halbes Jahr ≈ anteilig
  const half = consumptionInPeriod(readings, '2025-01-01', '2025-06-30')
  assert.ok(half > 49 && half < 51)
})

test('Verbrauch: Zwischenablesung beim Mieterwechsel teilt exakt', () => {
  const readings = [
    { date: '2024-12-31', value: 0 },
    { date: '2025-03-31', value: 30 }, // Zwischenablesung beim Auszug
    { date: '2025-12-31', value: 100 },
  ]
  assert.ok(Math.abs(consumptionInPeriod(readings, '2025-01-01', '2025-03-31') - 30) < 1e-9)
  assert.ok(Math.abs(consumptionInPeriod(readings, '2025-04-01', '2025-12-31') - 70) < 1e-9)
})

test('Zählerwechsel: Endstand alt + Startstand neu, kein negativer Verbrauch', () => {
  const readings = [
    { date: '2024-12-31', value: 950 },
    { date: '2025-06-30', value: 3, replacement: true, oldEndValue: 980 }, // neuer Zähler startet bei 3
    { date: '2025-12-31', value: 40 },
  ]
  const total = consumptionInPeriod(readings, '2025-01-01', '2025-12-31')
  assert.ok(Math.abs(total - (30 + 37)) < 1e-9) // 980−950 + 40−3
  assert.equal(meterSegments(readings).warnings.length, 0)
  // ohne Wechsel-Markierung gäbe es eine Warnung
  const broken = [{ date: '2024-12-31', value: 950 }, { date: '2025-06-30', value: 3 }]
  assert.equal(meterSegments(broken).warnings.length, 1)
})

test('Verbrauchsschlüssel: Verteilung nach Wohnungszählern', () => {
  const db = makeDb()
  db.meters = [
    { id: 'm2', unitId: 'u2', type: 'kaltwasser', name: 'WZ OG links' },
    { id: 'm3', unitId: 'u3', type: 'kaltwasser', name: 'WZ OG rechts' },
  ]
  db.readings = [
    { id: 'r1', meterId: 'm2', date: '2024-12-31', value: 0 },
    { id: 'r2', meterId: 'm2', date: '2025-12-31', value: 60 },
    { id: 'r3', meterId: 'm3', date: '2024-12-31', value: 0 },
    { id: 'r4', meterId: 'm3', date: '2025-12-31', value: 40 },
  ]
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 60000)
  assert.equal(s.statements.find((x) => x.tenancyId === 't3').totalShareCents, 40000)
  assert.equal(s.landlord.totalCents, 0)
})

test('Verbrauchsschlüssel ohne Ablesungen: Warnung, Betrag an Vermieter', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 50000, key: 'meter', meterType: 'kaltwasser' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 50000)
  assert.equal(s.warnings.length, 1)
})

test('§35a: Lohnanteil wird anteilig je Mieter ausgewiesen', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Gartenpflege', description: 'Gartenpflege', amountCents: 60000, key: 'units', labor35aCents: 30000 })
  const s = computeSettlement(db, 2025)
  const a = s.statements.find((x) => x.tenancyId === 't2')
  assert.equal(a.totalShareCents, 30000) // halbe Kosten (2 Einheiten)
  assert.equal(a.total35aCents, 15000) // halber Lohnanteil
})

test('Vorschlag neue Vorauszahlung: ein Zwölftel, auf volle Euro gerundet', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 290050, key: 'units' })
  const s = computeSettlement(db, 2025)
  const a = s.statements.find((x) => x.tenancyId === 't2')
  // 1450,25 € / 12 = 120,85 € → 121 €
  assert.equal(a.suggestedMonthlyCents, 12100)
})

test('Mietkonto: Soll = Kaltmiete + Vorauszahlung, Zahlungen füllen Monate der Reihe nach', () => {
  const db = {
    settings: {},
    units: [{ id: 'u1', name: 'OG links', areaM2: 90, participates: true }],
    tenancies: [
      {
        id: 't1', unitId: 'u1', tenantName: 'Familie A', start: '2025-01-01', end: null,
        personHistory: [{ from: '2025-01-01', persons: 2 }],
        baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
        prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
      },
    ],
    payments: [
      // 3,5 Monatsmieten = 350.000 ct → Jan–Mär voll, Apr teilweise
      { id: 'p1', tenancyId: 't1', date: '2025-01-05', amountCents: 100000 },
      { id: 'p2', tenancyId: 't1', date: '2025-02-05', amountCents: 100000 },
      { id: 'p3', tenancyId: 't1', date: '2025-03-05', amountCents: 100000 },
      { id: 'p4', tenancyId: 't1', date: '2025-04-05', amountCents: 50000 },
    ],
  }
  const l = rentLedger(db, 2025)
  const r = l.rows[0]
  assert.equal(r.months[0].sollCents, 100000) // 800 + 200 €
  assert.equal(r.sollYearCents, 1200000) // 12 × 1000 €
  assert.equal(r.baseRentYearCents, 960000)
  assert.equal(r.prepaymentYearCents, 240000)
  assert.equal(r.paidYearCents, 350000)
  assert.equal(r.months[0].status, 'paid')
  assert.equal(r.months[2].status, 'paid')
  assert.equal(r.months[3].status, 'partial')
  assert.equal(r.months[3].paidCents, 50000)
  assert.equal(r.months[4].status, 'open')
  assert.equal(r.balanceCents, -850000) // 3.500 − 12.000 €
  assert.equal(l.totals.openCents, 850000)
})

test('Mietkonto: Teiljahr — vor Einzug kein Soll, Monat gilt als gedeckt', () => {
  const db = {
    settings: {},
    units: [{ id: 'u1', name: 'OG', areaM2: 90, participates: true }],
    tenancies: [
      {
        id: 't1', unitId: 'u1', tenantName: 'B', start: '2025-07-01', end: null,
        personHistory: [{ from: '2025-07-01', persons: 1 }],
        baseRents: [{ from: '2025-07', monthlyCents: 50000 }],
        prepayments: [],
      },
    ],
    payments: [],
  }
  const l = rentLedger(db, 2025)
  const r = l.rows[0]
  assert.equal(r.months[0].sollCents, 0) // Januar vor Einzug
  assert.equal(r.months[0].status, 'paid') // kein Soll → gedeckt
  assert.equal(r.months[6].sollCents, 50000) // Juli
  assert.equal(r.sollYearCents, 300000) // 6 × 500 €
  assert.equal(r.openMonths, 6) // Juli–Dez unbezahlt
})

test('Steuer (Anlage V): Einnahmen aus Mietkonto, Werbungskosten nach Gruppen, Überschuss', () => {
  const db = {
    settings: {},
    units: [
      { id: 'u1', name: 'EG (Eigennutzung)', areaM2: 100, participates: false },
      { id: 'u2', name: 'OG', areaM2: 100, participates: true },
    ],
    tenancies: [
      {
        id: 't1', unitId: 'u2', tenantName: 'A', start: '2025-01-01', end: null,
        personHistory: [{ from: '2025-01-01', persons: 2 }],
        baseRents: [{ from: '2025-01', monthlyCents: 80000 }],
        prepayments: [{ from: '2025-01', monthlyCents: 20000 }],
      },
    ],
    payments: [
      // nur 11 von 12 Monaten gezahlt → Soll 1.200.000, Ist 1.100.000
      { id: 'p1', tenancyId: 't1', date: '2025-01-05', amountCents: 1100000 },
    ],
    costItems: [
      { id: 'c1', year: 2025, category: 'Grundsteuer', description: 'GS', amountCents: 50000, key: 'units' },
      { id: 'c2', year: 2025, category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'persons' },
      { id: 'c3', year: 2025, category: 'Gartenpflege', description: 'Garten', amountCents: 20000, key: 'units', labor35aCents: 12000 },
      { id: 'c4', year: 2024, category: 'Grundsteuer', description: 'Vorjahr', amountCents: 99999, key: 'units' },
    ],
  }
  const r = taxReport(db, 2025)
  assert.equal(r.income.baseRentSollCents, 960000) // 12 × 800 €
  assert.equal(r.income.prepaymentSollCents, 240000) // 12 × 200 €
  assert.equal(r.income.sollCents, 1200000)
  assert.equal(r.income.paidCents, 1100000)
  // Werbungskosten: nur 2025, gruppiert
  assert.equal(r.expenses.totalCents, 100000) // 500 + 300 + 200 €
  assert.equal(r.expenses.labor35aCents, 12000)
  const grundsteuer = r.expenses.groups.find((g) => g.group === 'Grundsteuer & öffentliche Abgaben')
  assert.equal(grundsteuer.amountCents, 50000)
  const laufend = r.expenses.groups.find((g) => g.group === 'Laufende Betriebskosten')
  assert.equal(laufend.amountCents, 50000) // Müll + Garten
  // Überschuss
  assert.equal(r.surplusSollCents, 1100000) // 1.200.000 − 100.000
  assert.equal(r.surplusPaidCents, 1000000) // 1.100.000 − 100.000
  // gemischte Nutzung: halbe Fläche vermietet
  assert.equal(r.selfOccupiedExists, true)
  assert.equal(r.rentedAreaShare, 0.5)
})
