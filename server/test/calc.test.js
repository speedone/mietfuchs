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

// Beispielhaus für die Tests: 3 Wohnungen, davon eine selbstgenutzt und zwei vermietet.
// Die selbstgenutzte Wohnung ist hier ohne Eigennutzungs-Kennzeichen angelegt (Altbestand) —
// die Tests unten decken beide Varianten ab.
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

test('Restcent bei gleichen Anteilen: entscheidet die Kennung des Mietverhältnisses, nicht die Reihenfolge', () => {
  // 100,00 € auf drei gleich große Wohnungen: 33,33 € je Wohnung, ein Cent bleibt übrig.
  // Wer ihn trägt, ist fachlich beliebig — aber dieselben Daten müssen immer dieselbe
  // Abrechnung ergeben, egal in welcher Reihenfolge sie in der Datei stehen.
  const make = (order) => ({
    settings: {},
    units: order.map((n) => ({ id: `u${n}`, name: `Wohnung ${n}`, areaM2: 70, participates: true })),
    tenancies: order.map((n) => ({ id: `t${n}`, unitId: `u${n}`, tenantName: `Mieter ${n}`, persons: 2, start: '2020-01-01', end: null })),
    costItems: [{ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 10000, key: 'area' }],
  })
  for (const order of [[1, 2, 3], [3, 2, 1], [2, 3, 1]]) {
    const s = computeSettlement(make(order), 2025)
    const share = (id) => s.statements.find((x) => x.tenancyId === id).totalShareCents
    assert.deepEqual([share('t1'), share('t2'), share('t3')], [3334, 3333, 3333], `Reihenfolge ${order.join(', ')}`)
  }
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

// ---------- Eigennutzung in der Verteilbasis ----------
// `selfUsed: true` heißt: die Wohnung zählt in die Verteilbasis (Fläche/Einheiten/Personen),
// hat aber kein Mietverhältnis — ihr Anteil landet deshalb im Vermieteranteil (Eigenanteil).

test('Eigennutzung: Flächenschlüssel nimmt die eigene Wohnung in die Basis, der Anteil bleibt beim Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  // 2.300 € auf 230 m² (80 + 90 + 60) = 10 €/m²
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 90000)
  assert.equal(s.statements.find((x) => x.tenancyId === 't3').totalShareCents, 60000)
  assert.equal(s.landlord.totalCents, 80000) // 80 m² Eigenanteil
})

test('Eigennutzung: Einheitenschlüssel teilt durch drei, ein Drittel trägt der Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.costItems.push({ id: 'c1', year: 2025, category: 'Müllabfuhr', description: 'Müll', amountCents: 300000, key: 'units' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 100000)
  assert.equal(s.statements.find((x) => x.tenancyId === 't3').totalShareCents, 100000)
  assert.equal(s.landlord.totalCents, 100000)
})

test('Eigennutzung: Personenschlüssel zählt die eigenen Personen mit', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.units[0].selfPersons = 3
  // Personentage-Basis: (4 + 3 Mieter + 3 eigene) × 365
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'persons' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 40000)
  assert.equal(s.statements.find((x) => x.tenancyId === 't3').totalShareCents, 30000)
  assert.equal(s.landlord.totalCents, 30000)
})

test('Eigennutzung ohne Personenzahl: Warnung beim Personenschlüssel', () => {
  const db = makeDb()
  db.units[0].selfUsed = true // selfPersons fehlt
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'persons' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0], /Personenzahl/)
  // ohne Personenzahl bleibt die Verteilung wie zuvor (nur Mieter)
  assert.equal(s.landlord.totalCents, 0)
})

test('Eigennutzung und Leerstand werden im Vermieteranteil getrennt ausgewiesen', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.tenancies[1].end = '2025-03-31' // die zweite vermietete Wohnung steht ab April leer
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.selfUsedShareCents, 80000) // 80 von 230 m², ganzjährig
  assert.ok(s.landlord.totalCents > s.selfUsedShareCents) // zusätzlich der Leerstand
})

test('Ohne Eigennutzungs-Kennzeichen bleibt die Verteilung wie bisher (Bestandsdaten)', () => {
  const db = makeDb() // units[0]: participates false, selfUsed nicht gesetzt
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  const s = computeSettlement(db, 2025)
  // Basis bleiben die 150 m² der vermieteten Wohnungen
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 138000)
  assert.equal(s.landlord.totalCents, 0)
})

test('Zählerschlüssel: Verbrauch einer nicht beteiligten Wohnung bleibt in der Basis', () => {
  // Ein Zählerstand belegt Verbrauch innerhalb der abgerechneten Menge — er zählt
  // deshalb unabhängig vom Beteiligungs-Kennzeichen in die Basis (Anteil → Vermieter).
  const db = makeDb()
  db.meters = [
    { id: 'm1', unitId: 'u1', type: 'kaltwasser', name: 'WZ EG' },
    { id: 'm2', unitId: 'u2', type: 'kaltwasser', name: 'WZ OG links' },
  ]
  db.readings = [
    { id: 'r1', meterId: 'm1', date: '2024-12-31', value: 0 },
    { id: 'r2', meterId: 'm1', date: '2025-12-31', value: 40 },
    { id: 'r3', meterId: 'm2', date: '2024-12-31', value: 0 },
    { id: 'r4', meterId: 'm2', date: '2025-12-31', value: 60 },
  ]
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'meter', meterType: 'kaltwasser' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 60000)
  assert.equal(s.landlord.totalCents, 40000)
})

test('Direktzuordnung an eine nicht vermietete Wohnung bleibt vollständig beim Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  // Die Wohnung war bis Ende März vermietet und wird danach selbst genutzt
  db.tenancies.push({ id: 't1', unitId: 'u1', tenantName: 'Vormieter', persons: 2, start: '2020-01-01', end: '2025-03-31', prepayments: [] })
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Direkt', amountCents: 100000, key: 'direct', directUnitId: 'u1' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.reduce((a, x) => a + x.totalShareCents, 0), 0) // die Wohnung ist nicht beteiligt
  assert.equal(s.landlord.totalCents, 100000) // kein Cent darf unterwegs verschwinden
  assert.equal(s.selfUsedShareCents, 100000)
})

test('Direktzuordnung auf eine gelöschte Wohnung: Warnung, Betrag beim Vermieter', () => {
  const db = makeDb()
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Verwaist', amountCents: 40000, key: 'direct', directUnitId: 'weg' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 40000)
  assert.equal(s.warnings.length, 1)
})

test('Eine Wohnung, die vermietet und als Eigennutzung markiert ist, gilt als vermietet', () => {
  const db = makeDb()
  db.units[1].selfUsed = true // widersprüchliche Kennzeichen
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 150000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 90000)
  assert.equal(s.selfUsedShareCents, 0) // kein Eigenanteil an einer vermieteten Wohnung
})

test('Negative Personenzahl der eigenen Wohnung zählt wie „nicht hinterlegt"', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.units[0].selfPersons = -5 // aus einem von Hand bearbeiteten Datenbestand
  db.costItems.push({ id: 'c1', year: 2025, category: 'Wasser/Abwasser', description: 'Wasser', amountCents: 100000, key: 'persons' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.reduce((a, x) => a + x.totalShareCents, 0), 100000)
  assert.equal(s.landlord.totalCents, 0) // keine negative Verteilbasis, kein negativer Anteil
  assert.equal(s.warnings.length, 1)
})

test('Eigennutzung ohne Wohnfläche: Warnung beim Flächenschlüssel', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.units[0].areaM2 = 0 // Wohnfläche noch nicht erfasst
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 100000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0], /Wohnfläche/)
})

// ---------- Vereinbarter Prozentschlüssel ----------

test('Prozentschlüssel: vereinbarte Anteile, der Rest trägt der Vermieter', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Hausmeister',
    amountCents: 100000, key: 'custom', customShares: { u2: 60, u3: 30 },
  })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 60000)
  assert.equal(s.statements.find((x) => x.tenancyId === 't3').totalShareCents, 30000)
  assert.equal(s.landlord.totalCents, 10000) // vereinbarter Eigenanteil
})

test('Prozentschlüssel: 100 % werden centgenau verteilt', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Krumme Summe',
    amountCents: 100001, key: 'custom', customShares: { u2: 33.33, u3: 66.67 },
  })
  const s = computeSettlement(db, 2025)
  const a = s.statements.find((x) => x.tenancyId === 't2')
  const b = s.statements.find((x) => x.tenancyId === 't3')
  assert.equal(a.totalShareCents + b.totalShareCents, 100001)
  assert.equal(s.landlord.totalCents, 0)
})

test('Prozentschlüssel: Teiljahr wird tagesanteilig gekürzt', () => {
  const db = makeDb()
  db.tenancies[1].end = '2025-03-31' // Familie B zieht Ende März aus
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Wartung',
    amountCents: 100000, key: 'custom', customShares: { u2: 50, u3: 50 },
  })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 50000)
  assert.equal(s.statements.find((x) => x.tenancyId === 't3').totalShareCents, Math.round(50000 * (90 / 365)))
  assert.equal(
    s.statements.reduce((a, x) => a + x.totalShareCents, 0) + s.landlord.totalCents,
    100000,
  )
})

test('Prozentschlüssel über 100 %: Warnung, keine Verteilung', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Zu viel',
    amountCents: 100000, key: 'custom', customShares: { u2: 60, u3: 60 },
  })
  const s = computeSettlement(db, 2025)
  // Niemals mehr verteilen als die Rechnung hergibt — sonst wären auch die §35a-Anteile zu hoch
  assert.equal(s.statements.reduce((a, x) => a + x.totalShareCents, 0), 0)
  assert.equal(s.landlord.totalCents, 100000)
  assert.match(s.warnings[0], /100/)
})

test('Prozentschlüssel mit gelöschter Wohnung: Warnung, verfallener Anteil beim Vermieter', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Verwaist',
    amountCents: 100000, key: 'custom', customShares: { u2: 50, weg: 30 },
  })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 50000)
  assert.equal(s.landlord.totalCents, 50000)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0], /gelöschte Wohnung/)
})

test('Prozentschlüssel: Anteil einer nicht beteiligten Wohnung wird beim Namen genannt', () => {
  // Die Wohnung existiert, gehört aber nicht zur Abrechnungseinheit — die Warnung darf sie
  // nicht als gelöscht bezeichnen, sonst sucht man an der falschen Stelle.
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Vereinbart',
    amountCents: 100000, key: 'custom', customShares: { u1: 30, u2: 70 },
  })
  const s = computeSettlement(db, 2025)
  assert.match(s.warnings[0], /EG \(Eigennutzung\)/)
  assert.doesNotMatch(s.warnings[0], /gelöscht/)
})

test('Prozentschlüssel ohne Anteile: Warnung, Betrag an den Vermieter', () => {
  const db = makeDb()
  db.costItems.push({
    id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Ohne Anteile',
    amountCents: 50000, key: 'custom',
  })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 50000)
  assert.equal(s.warnings.length, 1)
})

// Fehlende Verteilbasis. Fehlt der Basiswert einer Wohnung (Fläche, Personen), verteilt der
// Schlüssel deren Anteil still auf die übrigen Wohnungen — die anderen Mieter zahlen mit.
// Fehlt er überall, geht der Betrag an den Vermieter. Beides soll gemeldet werden, und zwar
// nur dann, wenn sich etwas beheben lässt: Leerstand und Eigennutzung sind reguläre Fälle.
// Das Formular erzwingt Fläche > 0 und mindestens eine Person; fehlende Werte stammen aus
// Altbeständen oder von Hand bearbeiteten Daten.

test('Flächenschlüssel ohne jede Wohnfläche: eine Meldung je Position, Betrag beim Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  for (const u of db.units) delete u.areaM2
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  // Nicht umlagefähige Kosten landen ohnehin beim Vermieter — dort ist das keine Meldung wert
  db.costItems.push({ id: 'c2', year: 2025, category: 'Nicht umlagefähig', description: 'Dachreparatur', amountCents: 50000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 140000)
  // Keine zusätzliche Meldung zur Eigennutzung („verteilt nur auf die Mieter") — verteilt wird nichts
  assert.deepEqual(s.warnings, ['„Grundsteuer": für keine Wohnung ist eine Wohnfläche hinterlegt — Betrag geht an den Vermieter.'])
})

test('Personenschlüssel ohne jede Personenzahl: eine Meldung je Position, Betrag beim Vermieter', () => {
  const db = makeDb()
  db.units[0].selfUsed = true // ohne selfPersons
  for (const t of db.tenancies) t.persons = 0
  db.costItems.push({ id: 'c1', year: 2025, category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'persons' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 30000)
  assert.deepEqual(s.warnings, ['„Müll": für die vermieteten Wohnungen sind keine Personen hinterlegt — Betrag geht an den Vermieter.'])
})

test('Einheitenschlüssel ohne Wohnung in der Abrechnungseinheit: Meldung, Betrag beim Vermieter', () => {
  const db = makeDb()
  for (const u of db.units) u.participates = false
  db.costItems.push({ id: 'c1', year: 2025, category: 'Hauswart', description: 'Hauswart', amountCents: 24000, key: 'units' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 24000)
  assert.deepEqual(s.warnings, ['„Hauswart": keine Wohnung gehört zur Abrechnungseinheit — Betrag geht an den Vermieter.'])
})

test('Vermietete Wohnung ohne Wohnfläche: Meldung nennt die Wohnung, einmal im Jahr', () => {
  const db = makeDb()
  db.units[2].areaM2 = 0 // OG rechts
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  db.costItems.push({ id: 'c2', year: 2025, category: 'Versicherung', description: 'Gebäudeversicherung', amountCents: 60000, key: 'area' })
  const s = computeSettlement(db, 2025)
  // So rechnet es heute: OG links trägt alles — genau das muss auffallen
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 150000)
  assert.deepEqual(s.warnings, ['Für die Wohnung(en) OG rechts ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.'])
})

test('Vermietete Wohnungen ohne Fläche, Eigennutzung mit Fläche: Meldung nennt die vermieteten Wohnungen', () => {
  const db = makeDb()
  db.units[0].selfUsed = true // EG, 80 m²
  db.units[1].areaM2 = 0
  db.units[2].areaM2 = 0
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 90000)
  assert.deepEqual(s.warnings, ['Für die Wohnung(en) OG links, OG rechts ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.'])
})

test('Leerstehende Wohnung ohne Fläche: Meldung, sonst tragen die Mieter ihren Anteil mit', () => {
  const db = makeDb()
  db.units.push({ id: 'u4', name: 'DG', participates: true }) // ohne areaM2, ohne Mietverhältnis
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 0)
  assert.deepEqual(s.warnings, ['Für die Wohnung(en) DG ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.'])
})

test('Fehlt das Feld areaM2 bei einer vermieteten Wohnung ganz: keine Ausnahme, sondern eine Meldung', () => {
  const db = makeDb()
  delete db.units[2].areaM2
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 90000, key: 'area' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't3').totalShareCents, 0)
  assert.deepEqual(s.warnings, ['Für die Wohnung(en) OG rechts ist keine Wohnfläche hinterlegt — der Flächenschlüssel verteilt ihren Anteil auf die übrigen Wohnungen.'])
})

test('Mietverhältnis ohne Personen: Meldung nennt Mieter und Wohnung', () => {
  const db = makeDb()
  db.tenancies[1].persons = 0 // Familie B, OG rechts
  db.costItems.push({ id: 'c1', year: 2025, category: 'Müllabfuhr', description: 'Müll', amountCents: 30000, key: 'persons' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.statements.find((x) => x.tenancyId === 't2').totalShareCents, 30000)
  assert.deepEqual(s.warnings, ['Für Familie B (OG rechts) ist keine Personenzahl hinterlegt — der Personenschlüssel verteilt deren Anteil auf die übrigen Wohnungen.'])
})

test('Direktzuordnung auf eine ganzjährig leerstehende Wohnung: regulärer Fall, keine Meldung', () => {
  const db = makeDb()
  db.units.push({ id: 'u4', name: 'DG', areaM2: 50, participates: true })
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Rauchmelder DG', amountCents: 8000, key: 'direct', directUnitId: 'u4' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 8000)
  assert.deepEqual(s.warnings, [])
})

test('Direktzuordnung auf eine Wohnung außerhalb der Abrechnungseinheit: Meldung, Betrag beim Vermieter', () => {
  const db = makeDb() // u1 ist weder vermietet noch als Eigennutzung gekennzeichnet
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Rauchmelder EG', amountCents: 8000, key: 'direct', directUnitId: 'u1' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 8000)
  assert.deepEqual(s.warnings, ['„Rauchmelder EG": die direkt zugeordnete Wohnung EG (Eigennutzung) gehört nicht zur Abrechnungseinheit — Betrag geht an den Vermieter.'])
})

test('Direktzuordnung auf die selbstgenutzte Wohnung: Eigenanteil, keine Meldung', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.costItems.push({ id: 'c1', year: 2025, category: 'Sonstige Betriebskosten', description: 'Rauchmelder EG', amountCents: 8000, key: 'direct', directUnitId: 'u1' })
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 8000)
  assert.equal(s.selfUsedShareCents, 8000)
  assert.deepEqual(s.warnings, [])
})

test('Leerstand im ganzen Haus ist keine fehlende Verteilbasis: keine Meldung', () => {
  const db = makeDb()
  db.tenancies = []
  // Ohne Mietverhältnis gibt es auch keine Personentage — das ist Leerstand, kein Datenmangel
  for (const key of ['area', 'units', 'persons']) {
    db.costItems.push({ id: key, year: 2025, category: 'Grundsteuer', description: key, amountCents: 90000, key })
  }
  const s = computeSettlement(db, 2025)
  assert.equal(s.landlord.totalCents, 270000)
  assert.deepEqual(s.warnings, [])
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

test('Steuer (Anlage V): abgeschlossene Abrechnung liefert den eingefrorenen Eigenanteil', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.payments = []
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  db.closedSettlements = [
    { id: 'x', year: 2025, closedAt: '2026-01-05', sentAt: null, settlement: computeSettlement(db, 2025) },
  ]
  // Nachträgliche Änderung an den Kosten: der eingefrorene Stand bleibt maßgeblich,
  // sonst widersprächen Steuerübersicht und versendete Abrechnung einander.
  db.costItems[0].amountCents = 460000
  assert.equal(taxReport(db, 2025).selfUsedShareCents, 80000)
})

test('Steuer (Anlage V): auf die eigene Wohnung entfallender Anteil wird ausgewiesen', () => {
  const db = makeDb()
  db.units[0].selfUsed = true
  db.payments = []
  db.costItems.push({ id: 'c1', year: 2025, category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 230000, key: 'area' })
  const r = taxReport(db, 2025)
  // 80 von 230 m² entfallen auf die eigene Wohnung — dieser Teil ist privat, nicht abziehbar
  assert.equal(r.selfUsedShareCents, 80000)
  assert.equal(r.expenses.totalCents, 230000) // die Werbungskosten selbst bleiben unangetastet
})

// ---------- Invarianten über zufällige Datenbestände ----------
// Eine Abrechnung ist ein Rechtsdokument: Mieteranteile plus Vermieteranteil müssen die
// Gesamtkosten centgenau ergeben, und der ausgewiesene Eigenanteil darf nie größer sein als
// der Vermieteranteil, in dem er steckt. Statt einzelne Fälle zu raten, prüft dieser Test
// viele zufällige Konstellationen — mit festem Startwert, damit Fehlschläge reproduzierbar
// bleiben.
function makeRng(seed) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function randomDb(rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const unitCount = 1 + Math.floor(rnd() * 4)
  const units = []
  for (let i = 0; i < unitCount; i++) {
    const usage = pick(['vermietet', 'vermietet', 'eigen', 'ausgenommen'])
    units.push({
      id: `u${i}`,
      name: `W${i}`,
      areaM2: rnd() < 0.15 ? 0 : Math.round(rnd() * 120),
      participates: usage === 'vermietet',
      selfUsed: usage === 'eigen',
      selfPersons: usage === 'eigen' ? Math.floor(rnd() * 4) : undefined,
    })
  }
  const tenancies = []
  for (const u of units) {
    // auch nicht vermietete Wohnungen können ein beendetes Mietverhältnis haben
    if (rnd() < 0.2) continue
    const start = rnd() < 0.3 ? `2025-${String(1 + Math.floor(rnd() * 9)).padStart(2, '0')}-01` : '2020-01-01'
    const end = rnd() < 0.3 ? `2025-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-28` : null
    tenancies.push({
      id: `t${tenancies.length}`, unitId: u.id, tenantName: `M${tenancies.length}`,
      start, end, persons: 1 + Math.floor(rnd() * 4),
      personHistory: [{ from: start, persons: 1 + Math.floor(rnd() * 4) }],
      prepayments: [], baseRents: [], prepaymentOverrides: {},
    })
  }
  const meters = []
  const readings = []
  for (const u of units) {
    if (rnd() < 0.5) continue
    const id = `m${meters.length}`
    meters.push({ id, unitId: u.id, type: pick(['kaltwasser', 'sonstig']), name: id, unit: 'm³' })
    readings.push({ id: `${id}a`, meterId: id, date: '2024-12-31', value: 0 })
    readings.push({ id: `${id}b`, meterId: id, date: '2025-12-31', value: Math.round(rnd() * 100) })
  }
  const costItems = []
  const itemCount = 1 + Math.floor(rnd() * 5)
  for (let i = 0; i < itemCount; i++) {
    const key = pick(['area', 'persons', 'units', 'meter', 'direct', 'custom'])
    const item = {
      id: `c${i}`, year: 2025,
      category: pick(['Grundsteuer', 'Wasser/Abwasser', 'Gartenpflege', 'Nicht umlagefähig']),
      description: `P${i}`,
      amountCents: 1 + Math.floor(rnd() * 500000),
      key,
    }
    if (key === 'meter') item.meterType = pick(['kaltwasser', 'sonstig', undefined])
    if (key === 'direct') item.directUnitId = pick([...units.map((u) => u.id), 'weg'])
    if (key === 'custom') {
      item.customShares = {}
      for (const u of units) if (rnd() < 0.6) item.customShares[u.id] = Math.round(rnd() * 6000) / 100
    }
    if (rnd() < 0.3) item.labor35aCents = Math.floor(rnd() * item.amountCents)
    costItems.push(item)
  }
  return { settings: {}, payments: [], units, tenancies, meters, readings, costItems }
}

test('Invariante: Mieteranteile + Vermieteranteil ergeben immer die Gesamtkosten', () => {
  const rnd = makeRng(20260918)
  for (let i = 0; i < 500; i++) {
    const db = randomDb(rnd)
    const s = computeSettlement(db, 2025)
    const mieter = s.statements.reduce((a, x) => a + x.totalShareCents, 0)
    assert.equal(
      mieter + s.landlord.totalCents,
      s.totalCostsCents,
      `Fall ${i}: ${mieter} + ${s.landlord.totalCents} ≠ ${s.totalCostsCents}\n${JSON.stringify(db)}`,
    )
  }
})

test('Invariante: kein Mieter trägt einen negativen Anteil', () => {
  const rnd = makeRng(4711)
  for (let i = 0; i < 500; i++) {
    const db = randomDb(rnd)
    for (const st of computeSettlement(db, 2025).statements) {
      for (const row of st.rows) {
        assert.ok(row.shareCents >= 0, `Fall ${i}: negativer Anteil ${row.shareCents}\n${JSON.stringify(db)}`)
        assert.ok(row.labor35aCents <= row.shareCents + 1, `Fall ${i}: §35a-Anteil über dem Kostenanteil`)
      }
    }
  }
})

test('Invariante: der Eigenanteil steckt im Vermieteranteil', () => {
  const rnd = makeRng(1234567)
  for (let i = 0; i < 500; i++) {
    const db = randomDb(rnd)
    const s = computeSettlement(db, 2025)
    assert.ok(
      s.selfUsedShareCents <= s.landlord.totalCents,
      `Fall ${i}: Eigenanteil ${s.selfUsedShareCents} > Vermieteranteil ${s.landlord.totalCents}\n${JSON.stringify(db)}`,
    )
    assert.ok(s.selfUsedShareCents >= 0, `Fall ${i}: negativer Eigenanteil`)
  }
})
