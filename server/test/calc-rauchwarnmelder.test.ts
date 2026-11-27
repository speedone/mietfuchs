// #714: Die Miete von Rauchwarnmeldern ist nicht umlagefähig (BGH VIII ZR 379/20), die Wartung als sonstige Betriebskosten
// schon (BGH VIII ZR 117/21). Rechnungen führen beides oft in einer Position. Verteilt wird wie erfasst; die Abrechnung
// sagt es und beziffert, was die Position auf Mieter umlegt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/calc.ts'
import { snapshotFor } from '../src/snapshot.ts'
import { CALENDAR_RULES, calendarYearPeriod, periodKey } from '../../shared/period.ts'
import { smokeDetectorKind } from '../../shared/smokeDetector.ts'

type Source = Parameters<typeof snapshotFor>[0]
const haus = (items: { description: string, category?: string, amountCents?: number }[]): Source => ({
  properties: [{ id: 'objekt-1', kind: 'mfh', cableBuiltBeforeDec2021: null, periodRules: CALENDAR_RULES }],
  units: [
    { id: 'u1', propertyId: 'objekt-1', name: 'EG', areaM2: 60, participates: true },
    { id: 'u2', propertyId: 'objekt-1', name: 'OG', areaM2: 40, participates: false, selfUsed: true },
  ],
  tenancies: [{ id: 't1', unitId: 'u1', tenantName: 'Anna', persons: 1, personHistory: [{ from: '2024-01-01', persons: 1 }], start: '2024-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }],
  costItems: items.map((it, i) => ({ id: `c${i}`, propertyId: 'objekt-1', period: periodKey('2025-01'), category: it.category ?? 'Sonstige Betriebskosten', description: it.description, amountCents: it.amountCents ?? 10000, key: 'area' as const, namedTenancyIds: ['t1'] })),
  meters: [], readings: [], payments: [], closedSettlements: [], heatingPlants: [],
} as Source)
const notices = (items: Parameters<typeof haus>[0]) =>
  (computeSettlement(snapshotFor(haus(items), 'objekt-1', calendarYearPeriod(2025))).notices ?? []).filter((n) => n.code.startsWith('cost.smoke-detector'))

test('#714: woran eine Position zu Rauchwarnmeldern erkannt wird und ob sie Miete enthält', () => {
  assert.equal(smokeDetectorKind('Rauchwarnmelder Miete und Wartung'), 'rent')
  assert.equal(smokeDetectorKind('Gerätemiete Rauchmelder'), 'rent')
  assert.equal(smokeDetectorKind('Anmietung Rauchwarnmelder'), 'rent')
  assert.equal(smokeDetectorKind('Rauchwarnmelder'), 'unclear')
  assert.equal(smokeDetectorKind('Rauchwarnmelder Wartung'), null)
  assert.equal(smokeDetectorKind('Funktionsprüfung Rauchmelder'), null)
  // „Mieter“ ist keine Miete, und andere Positionen sind nicht gemeint.
  assert.equal(smokeDetectorKind('Rauchwarnmelder Wartung Mieter Meier'), null)
  assert.equal(smokeDetectorKind('Gerätemiete Wasserzähler'), null)
  assert.equal(smokeDetectorKind(''), null)
})

// Durchsicht von #714: Die gängigste Sammelbezeichnung wurde als reine Wartung gelesen, und „Service“ unterdrückte den
// Hinweis bei Verträgen, die üblicherweise Miete enthalten. Im Zweifel fragt der ruhige Hinweis, statt zu schweigen.
test('#714: Schreibweisen aus der Praxis: Ergänzungsstrich, Mehrzahl, Service, Abkürzung, Verneinung', () => {
  for (const text of ['Rauchwarnmelder Miet- und Wartungskosten', 'Miet-/Wartungskosten Rauchwarnmelder', 'Rauchwarnmelder-Mieten', 'Gerätemieten Rauchmelder', 'Rauchwarnmelder (Mietgeräte)', 'Rauchwarnmelder Mietservice', 'Rauchwarnmelder Leihgebühr', 'RWM Miete', 'Rauchwarn-Melder Miete', 'Rauchwarnm. Miete']) {
    assert.equal(smokeDetectorKind(text), 'rent', text)
  }
  for (const text of ['Rauchwarnmelder Full-Service', 'Rauchwarnmelder Servicepauschale', 'Rauchmelder-Service', 'Rauchwarnmelder Mieter-Service', 'RWM', 'Rauch-Warnmelder']) {
    assert.equal(smokeDetectorKind(text), 'unclear', text)
  }
  for (const text of ['Wartung Rauchmelder (keine Miete)', 'Rauchwarnmelder ohne Miete, nur Wartung', 'RWM Wartung', 'Rauchwarnmelder Funkprüfung']) {
    assert.equal(smokeDetectorKind(text), null, text)
  }
  // Der Rechnungssteller und andere Geräte sind nicht gemeint.
  assert.equal(smokeDetectorKind('Brandmelder (Miete)'), null)
})

test('#714: Miete in einer umgelegten Position: Warnung mit dem Betrag, den die Position auf Mieter umlegt', () => {
  const [n, ...rest] = notices([{ description: 'Rauchwarnmelder Miete und Wartung' }])
  assert.deepEqual(rest, [])
  assert.deepEqual([n?.code, n?.level, n?.subject], ['cost.smoke-detector-rent', 'warning', { kind: 'costItem', id: 'c0' }])
  // 100 € nach Fläche, 60 von 100 m² vermietet: 60 € beim Mieter.
  assert.match(n?.text ?? '', /^„Rauchwarnmelder Miete und Wartung“: Die Miete von Rauchwarnmeldern ist nicht umlagefähig, ebenso wenig ihr Kauf \(BGH VIII ZR 379\/20\); umlegbar sind nur die Kosten der Wartung als sonstige Betriebskosten, wenn der Mietvertrag sie nennt \(BGH VIII ZR 117\/21\)\. Die Position legt 60,00 € auf Mieter um\./)
  assert.match(n?.text ?? '', /Kostenart „Nicht umlagefähig“/)
})

// Nachprüfung von #714: Neben „Wartung“ schwieg die Erkennung, sobald die Miete anders hieß als in einer Wortliste. Jetzt
// zählt jedes „miet…“ außer den harmlosen Zusammensetzungen, und Wörter wie Full-Service, Überlassung oder Kauf fragen
// auch neben „Wartung“ nach.
test('#714: Miete neben Wartung in beliebiger Schreibweise; Überlassung, Full-Service und Kauf fragen nach', () => {
  for (const text of ['Rauchwarnmelder Mietpauschale inkl. Wartung', 'Rauchwarnmelder Wartung und Mietpauschale', 'Rauchwarnmelder Mietanteil und Wartung', 'Rauchwarnmelder Mietpreis und Wartung',
    'Rauchwarnmelder Mietrate inkl. Wartung', 'Rauchwarnmelder Miet. u. Wartung', 'Rauchwarnmelder gemietet, inkl. Wartung', 'Rauchwarnmelder Wartung u. Vermietung', 'Rauchwarnmelder Leihe und Wartung',
    'Rauchwarnmelder Mietwartung', 'Rauchwarngeräte Miete', 'Rauchdetektor Miete']) {
    assert.equal(smokeDetectorKind(text), 'rent', text)
  }
  for (const text of ['Rauchwarnmelder Full-Service inkl. Wartung', 'Rauchwarnmelder Überlassung und Wartung', 'Rauchwarnmelder Bereitstellung u. Funktionsprüfung', 'Rauchwarnmelder Kauf und Wartung', 'Rauchwarnmelder Montage und Wartung']) {
    assert.equal(smokeDetectorKind(text), 'unclear', text)
  }
  // Harmlose Zusammensetzungen und ausdrücklich getrennte Miete bleiben still.
  for (const text of ['Rauchwarnmelder Wartung gem. Mietvertrag', 'Rauchwarnmelder Wartung Mieteinheit 3', 'Rauchwarnmelder Wartung Mieterwechsel', 'Rauchwarnmelder Wartung Mietwohnung EG',
    'Rauchwarnmelder Wartung (Miete nicht enthalten)', 'Rauchwarnmelder Wartung exkl. Miete', 'Rauchwarnmelder Wartung, Miete separat', 'Rauchwarnmelder Funktionstest', 'Rauchwarnmelder jährliche Kontrolle']) {
    assert.equal(smokeDetectorKind(text), null, text)
  }
})

// Dritte Prüfung von #714 (264 Beschreibungen): Schweigen trotz Miete, Kauf oder Einbau. „zzgl. Miete“ heißt, die Miete
// kommt dazu; neben „Wartung“ fragen auch Einbau, Lieferung, Austausch, Gerätekosten und Komplettservice nach; der
// Mietvertrag der Geräte ist kein Verweis auf den Wohnungsmietvertrag; Abkürzungen und Tippfehler des Geräts.
test('#714: zzgl. Miete, Einbau und Gerätekosten neben Wartung, Mietvertrag der Geräte, Abkürzungen', () => {
  for (const text of ['Rauchwarnmelder Wartung zzgl. Miete', 'Rauchwarnmelder Wartung zzgl. Mietanteil', 'Rauchm. Miete', 'Miete Rauchm.', 'Rauchmeld. Miete + Wartung', 'Rauchwarmelder Miete und Wartung',
    'Rauchwanmelder Miete', 'Rauchmeldegeräte Miete und Wartung', 'Miete RWMs', 'Rauchwarnmelder geliehen, Wartung']) {
    assert.equal(smokeDetectorKind(text), 'rent', text)
  }
  for (const text of ['Rauchwarnmelder Einbau und Wartung', 'Einbau Rauchwarnmelder inkl. Wartung', 'Rauchwarnmelder Lieferung und Wartung', 'Rauchwarnmelder Austausch und Wartung', 'Rauchwarnmelder Ersatzgeräte und Wartung',
    'Rauchwarnmelder Nachrüstung und Wartung', 'Rauchwarnmelder Erstausstattung inkl. Wartung', 'Rauchwarnmelder Gerätekosten und Wartung', 'Rauchwarnmelder Nutzungsgebühr und Wartung', 'Rauchwarnmelder Wartung inkl. Gerät',
    'Rauchwarnmelder Komplettservice inkl. Wartung', 'Rauchwarnmelder Rundum-Service inkl. Wartung', 'Rauchwarnmelder Ueberlassung und Wartung', 'Rauchwarnmelder Beschaffung und Wartung',
    'Rauchwarnmelder Mietvertrag Nr. 4711 inkl. Wartung', 'Mietvertrag Rauchwarnmelder, Wartung']) {
    assert.equal(smokeDetectorKind(text), 'unclear', text)
  }
  for (const text of ['Rauchwarnmelder Wartung gem. Mietvertrag', 'Rauchwarnmelder Wartung laut Mietvertrag § 7', 'Rauchwarnmelder Wartung Mietwhg. 2', 'Rauchwarnmelder Wartung Mieteinh. 3', 'Rauchwarnmelder Wartung Mieträume',
    'Rauchwarnmelder Wartung ohne Gerätemiete', 'Rauchwarnmelder Wartung, nicht gemietet', 'Rauchwarnmelder Wartung, Miete herausgerechnet', 'Rauchwarnmelder Wartg.', 'Rauchwarnmelder Funktionspruefung',
    'Rauchwarnmelder Batteriewechsel', 'Rauchwarnmelder Wartung und Batterieaustausch', 'Rauchabzug Wartung und Miete', 'Wasserzähler Miete']) {
    assert.equal(smokeDetectorKind(text), null, text)
  }
})

// Durchsicht von #714: je Umlageschlüssel und Mietmodell der Betrag, den die Position wirklich auf Mieter umlegt.
test('#714: der genannte Betrag folgt dem, was Mieter tragen: Einzelbeträge, nicht vereinbart, Gutschrift, andere Kostenart', () => {
  const src = (item: Record<string, unknown>, tenancy: Record<string, unknown> = {}) => {
    const base = haus([{ description: 'Rauchwarnmelder Miete' }])
    return { ...base, tenancies: base.tenancies.map((t) => ({ ...t, ...tenancy })), costItems: base.costItems.map((c) => ({ ...c, ...item })) } as Source
  }
  const of = (s: Source) => (computeSettlement(snapshotFor(s, 'objekt-1', calendarYearPeriod(2025))).notices ?? []).filter((n) => n.code.startsWith('cost.smoke-detector')).map((n) => /legt ([\d.,]+) € auf Mieter um/.exec(n.text)?.[1] ?? 'ohne Betrag')
  assert.deepEqual(of(src({ key: 'amounts', tenancyAmounts: { t1: 2500 } })), ['25,00'])
  assert.deepEqual(of(src({ notAgreedTenancyIds: ['t1'] })), [])
  assert.deepEqual(of(src({ amountCents: -10000 })), [])
  assert.deepEqual(of(src({ key: 'direct', directUnitId: 'u2' })), [])
  // Auch unter einer anderen umlagefähigen Kostenart, etwa beim Hauswart.
  assert.deepEqual(of(src({ category: 'Hauswart', namedTenancyIds: [] })), ['60,00'])
})

test('#714: unklar, ob Miete darin steckt: ein Hinweis; nur Wartung, nicht umlagefähig oder nichts beim Mieter: keiner', () => {
  const [n] = notices([{ description: 'Rauchwarnmelder' }])
  assert.deepEqual([n?.code, n?.level], ['cost.smoke-detector-unclear', 'hint'])
  assert.match(n?.text ?? '', /Enthält der Betrag Miete, Kauf oder Einbau der Geräte\?.*Die Position legt 60,00 € auf Mieter um\./)
  assert.deepEqual(notices([{ description: 'Rauchwarnmelder Wartung' }]), [])
  assert.deepEqual(notices([{ description: 'Rauchwarnmelder Miete', category: 'Nicht umlagefähig' }]), [])
  assert.deepEqual(notices([{ description: 'Hausmeister' }]), [])
})
