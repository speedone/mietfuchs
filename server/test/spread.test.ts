// Größeren Erhaltungsaufwand verteilen (§ 82b EStDV, #262 PR 1): die reinen Regeln aus shared/spread.ts, die Server
// und Formular gleich sehen. Entwurf docs/superpowers/specs/2026-10-30-erhaltungsaufwand-verteilen-design.md, E-1,
// E-4, E-9.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowsSpread, isSpreadYears, SPREAD_YEARS, spreadOptions, spreadQuestions, spreadRates, spreadRestQuestions, spreadSpan } from '../../shared/spread.ts'
import { joinQuestions } from '../../shared/paidOn.ts'
import { largestRemainder } from '../src/apportion.ts'
import { rngOf } from '../testing/revertFlows.ts'
import type { CostItem } from '../../shared/types.ts'

test('spreadRates: gleiche Raten, der Rest-Cent in den ersten Jahren, Summe genau', () => {
  for (const x of [0, 1, 4, 5, 99_999]) {
    for (const n of SPREAD_YEARS) {
      const rates = spreadRates(x, n)
      assert.equal(rates.length, n, `${x}/${n}`)
      assert.equal(rates.reduce((a, b) => a + b, 0), x, `${x}/${n}: Summe`)
      const base = Math.floor(x / n)
      for (const r of rates) assert.ok(r === base || r === base + 1, `${x}/${n}: ${r}`)
      // Nicht steigend: der Rest-Cent vorn.
      for (let i = 1; i < rates.length; i++) assert.ok((rates[i] ?? 0) <= (rates[i - 1] ?? 0), `${x}/${n}: nicht steigend`)
    }
  }
  assert.deepEqual(spreadRates(1_000_000, 3), [333_334, 333_333, 333_333])
  assert.deepEqual(spreadRates(4, 3), [2, 1, 1])
  assert.deepEqual(spreadRates(1, 5), [1, 0, 0, 0, 0])
  assert.deepEqual(spreadRates(0, 2), [0, 0])
})

test('spreadRates ist largestRemainder mit den Jahren als Schlüssel (1 000 Zufallsfälle, fester Startwert)', () => {
  const rng = rngOf(262)
  for (let i = 0; i < 1000; i++) {
    const x = Math.floor(rng() * 5_000_000)
    const n = SPREAD_YEARS[Math.floor(rng() * SPREAD_YEARS.length)] ?? 2
    const y0 = 2000 + Math.floor(rng() * 60)
    const years = Array.from({ length: n }, (_, k) => String(y0 + k))
    assert.deepEqual(spreadRates(x, n), largestRemainder(x, years.map(() => x / n), years), `${x}/${n}`)
  }
})

test('spreadRates lehnt einen Betrag unter 0 und eine Zahl von Jahren außerhalb 2 bis 5 ab', () => {
  assert.throws(() => spreadRates(-1, 2), /nicht negativ/)
  assert.throws(() => spreadRates(1.5, 2), /ganze Cent/)
  for (const n of [0, 1, 6, 2.5]) assert.throws(() => spreadRates(100, n), /2 bis 5/)
})

test('isSpreadYears: nur 2, 3, 4 und 5', () => {
  for (const v of [2, 3, 4, 5]) assert.equal(isSpreadYears(v), true, String(v))
  for (const v of [0, 1, 6, 2.5, '3', null, undefined]) assert.equal(isSpreadYears(v), false, String(v))
})

test('spreadOptions: „nicht verteilen“ zuerst, dann „auf 2 Jahre“ bis „auf 5 Jahre“', () => {
  assert.deepEqual(spreadOptions, [
    { value: '', label: 'nicht verteilen' },
    { value: '2', label: 'auf 2 Jahre' },
    { value: '3', label: 'auf 3 Jahre' },
    { value: '4', label: 'auf 4 Jahre' },
    { value: '5', label: 'auf 5 Jahre' },
  ])
})

const position = (over: Partial<CostItem> = {}): Pick<CostItem, 'category' | 'amountCents' | 'operatingPower' | 'key'> => ({
  category: 'Nicht umlagefähig', amountCents: 1_000_000, key: 'direct', ...over,
})

test('allowsSpread: „Nicht umlagefähig“ und „Entnahme Erhaltungsrücklage“ ja, Zuführung und umlagefähige Kostenarten nein', () => {
  assert.equal(allowsSpread(position()), true)
  assert.equal(allowsSpread(position({ category: 'Entnahme Erhaltungsrücklage' })), true)
  // Die Zuführung zählt nicht zu den Werbungskosten (#143, BFH IX R 19/24).
  assert.equal(allowsSpread(position({ category: 'Zuführung Erhaltungsrücklage' })), false)
  // Instandhaltung zählt nicht zu den Betriebskosten (§ 1 Abs. 2 Nr. 2 BetrKV); unter einer umlagefähigen Kostenart wäre sie falsch erfasst.
  for (const category of ['Grundsteuer', 'Gebäudereinigung', 'Sonstige Betriebskosten', 'Heizung und Warmwasser', 'Beleuchtung/Allgemeinstrom']) {
    assert.equal(allowsSpread(position({ category })), false, category)
  }
})

test('allowsSpread: nur ein Betrag über 0, kein Abzug beim Betriebsstrom, „laut Gemeinschaftsabrechnung“ erlaubt', () => {
  assert.equal(allowsSpread(position({ amountCents: 0 })), false)
  // Eine Gutschrift mindert die Werbungskosten im Jahr ihres Zuflusses und wird nicht verteilt.
  assert.equal(allowsSpread(position({ amountCents: -5000 })), false)
  assert.equal(allowsSpread(position({ amountCents: 1 })), true)
  assert.equal(allowsSpread(position({ operatingPower: 'deduction' })), false)
  // Der Anteil an einer Maßnahme der Gemeinschaft ist Erhaltungsaufwand des Eigentümers (E-10).
  assert.equal(allowsSpread(position({ key: 'external' })), true)
  assert.equal(allowsSpread(position({ key: 'external', category: 'Entnahme Erhaltungsrücklage' })), true)
})

type Dated = Parameters<typeof spreadQuestions>[0]
const stored = (over: Partial<NonNullable<Dated>> = {}): NonNullable<Dated> => ({ period: '2026-01', spreadYears: 5, ...over })
const BOUND = 'Die Wahl ist an die Erklärung des ersten Jahres gebunden.'
const ADVICE = 'Haben Sie die Steuererklärung eines betroffenen Jahres schon abgegeben, besprechen Sie die Änderung mit Ihrem Steuerberater oder Finanzamt.'

test('spreadQuestions: beim Anlegen nichts, ohne Änderung der Wahl oder des Jahres nichts', () => {
  assert.deepEqual(spreadQuestions(null, stored()), [])
  assert.deepEqual(spreadQuestions(stored(), stored()), [])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: undefined }), stored({ spreadYears: undefined, paidOn: '2027-01-05' })), [])
  // Ein anderes Datum im selben Jahr ändert keine Rate.
  assert.deepEqual(spreadQuestions(stored({ paidOn: '2026-03-01' }), stored({ paidOn: '2026-09-30' })), [])
})

test('spreadQuestions: Setzen, Ändern und Entfernen nennen die Jahre, die Bindung und den Rat', () => {
  assert.deepEqual(spreadQuestions(stored({ spreadYears: undefined }), stored({ spreadYears: 5 })), [
    'Für die Steuer wird die Position dann auf 5 Jahre verteilt: Abzug 2026 bis 2030 statt ganz 2026.', BOUND, ADVICE,
  ])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5 }), stored({ spreadYears: 2 })), [
    'Für die Steuer wird die Position dann auf 2 Jahre verteilt: Abzug 2026 bis 2027 statt 2026 bis 2030.', BOUND, ADVICE,
  ])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 2, taxYear: 2025 }), stored({ spreadYears: undefined, taxYear: 2025 })), [
    'Ohne Verteilung zählt die Position für die Steuer ganz im Jahr 2025; der Anteil 2026 entfällt.', BOUND, ADVICE,
  ])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 4 }), stored({ spreadYears: undefined })), [
    'Ohne Verteilung zählt die Position für die Steuer ganz im Jahr 2026; die Anteile 2027 bis 2029 entfallen.', BOUND, ADVICE,
  ])
})

test('spreadQuestions: ein anderes Jahr der Zahlung an einer verteilten Position verschiebt die Verteilung', () => {
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 3 }), stored({ spreadYears: 3, paidOn: '2027-01-08' })), [
    'Die Verteilung beginnt dann 2027 statt 2026: Abzug 2027 bis 2029 statt 2026 bis 2028.', BOUND, ADVICE,
  ])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 3, period: '2025-05', taxYear: 2025 }), stored({ spreadYears: 3, period: '2025-05', taxYear: 2026 })), [
    'Die Verteilung beginnt dann 2026 statt 2025: Abzug 2026 bis 2028 statt 2025 bis 2027.', BOUND, ADVICE,
  ])
})

test('spreadQuestions: Löschen einer verteilten Position nennt die entfallenden Anteile', () => {
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5 }), null), ['Die Anteile 2027 bis 2030 entfallen damit.', BOUND, ADVICE])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 2 }), null), ['Der Anteil 2027 entfällt damit.', BOUND, ADVICE])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: undefined }), null), [])
})

test('spreadQuestions: Teile einer Rechnung werden genannt, denn die Wahl gilt für alle', () => {
  const q = spreadQuestions(stored({ spreadYears: undefined }), stored({ spreadYears: 3 }), ['2025', '2026'])
  assert.deepEqual(q, [
    'Für die Steuer wird die Position dann auf 3 Jahre verteilt: Abzug 2026 bis 2028 statt ganz 2026.',
    'Die Wahl gilt für die ganze Rechnung und wird auch an den übrigen Teilen (2025, 2026) gespeichert.',
    BOUND, ADVICE,
  ])
})

// Durchsicht S1: mehrere Rückfragen eines Speicherns als eine, jeder Satz einmal, der Rat einmal am Ende.
test('joinQuestions: Sätze nacheinander, doppelte einmal, der Rat einmal am Ende; ohne Rat keiner', () => {
  assert.deepEqual(joinQuestions(['A.', ADVICE], ['B.', BOUND, ADVICE]), ['A.', 'B.', BOUND, ADVICE])
  assert.deepEqual(joinQuestions(['A.', ADVICE], [], ['A.', ADVICE]), ['A.', ADVICE])
  assert.deepEqual(joinQuestions([], []), [])
  assert.deepEqual(joinQuestions(['A.']), ['A.'])
})

// Durchsicht von #262 PR 3, K2: Eine gespeicherte Wahl an einer Position, an der nicht verteilt werden kann (Ablage von
// Hand, `spreadIgnored`), hat Mietfuchs nie gerechnet. Entfernen oder Löschen nennt dann keine entfallenden Anteile.
test('spreadQuestions: eine nie gerechnete Wahl entfällt ohne „Anteile entfallen“, mit eigenem Satz', () => {
  const krumm = { period: '2026-01', spreadYears: 3 as const, category: 'Grundsteuer', amountCents: 60_000 }
  const entfernt = spreadQuestions(krumm, { ...krumm, spreadYears: null })
  assert.deepEqual(entfernt, ['An dieser Position war eine Verteilung gespeichert, die Mietfuchs nie gerechnet hat, weil sie sich nicht verteilen lässt; sie entfällt, an den Zahlen der Steuer ändert sich nichts.'])
  assert.deepEqual(spreadQuestions(krumm, null), entfernt)
  // Eine verteilbare Position bleibt bei den bisherigen Sätzen.
  assert.match(spreadQuestions({ ...krumm, category: 'Nicht umlagefähig' }, null)[0] ?? '', /entfallen damit/)
})

// #262 PR 4 (E-7): das Jahr des vorzeitigen Endes am Objekt. Die Rückfrage nennt je betroffener Position den Zeitraum des
// Abzugs vorher und nachher; ohne betroffene Position ist nichts zu bestätigen.
test('spreadRestQuestions: Setzen, Ändern und Entfernen des Endes nennen je Position den Abzug vorher und nachher', () => {
  const dach = { description: 'Dach', period: '2026-01', spreadYears: 5 as const, category: 'Nicht umlagefähig', amountCents: 1_000_000 }
  const fenster = { description: 'Fenster', period: '2027-01', spreadYears: 2 as const, category: 'Nicht umlagefähig', amountCents: 300_000 }
  const plain = { description: 'Grundsteuer', period: '2026-01', category: 'Grundsteuer', amountCents: 60_000 }
  const krumm = { description: 'Krumm', period: '2026-01', spreadYears: 3 as const, category: 'Grundsteuer', amountCents: 60_000 }
  assert.deepEqual(spreadSpan(dach), { from: 2026, to: 2030 })
  assert.deepEqual(spreadSpan({ ...dach, taxYear: 2025 }), { from: 2025, to: 2029 })
  const set = spreadRestQuestions(null, 2027, [dach, fenster, plain, krumm])
  assert.deepEqual(set, [
    'Im Jahr 2027 wird der noch nicht abgezogene Teil des verteilten Erhaltungsaufwands auf einmal abgezogen (§ 82b Abs. 2 EStDV).',
    '„Dach“: Abzug 2026 bis 2027 (Rest 2027) statt 2026 bis 2030.',
    '„Fenster“: Abzug ganz 2027 statt 2027 bis 2028.',
    ADVICE,
  ])
  // Ein späteres Jahr betrifft das Fenster nicht mehr (Ende im letzten Jahr wirkt nicht).
  assert.deepEqual(spreadRestQuestions(2027, 2028, [dach, fenster]).slice(1, -1), ['„Dach“: Abzug 2026 bis 2028 (Rest 2028) statt 2026 bis 2027 (Rest 2027).', '„Fenster“: Abzug 2027 bis 2028 statt ganz 2027.'])
  assert.deepEqual(spreadRestQuestions(2027, null, [dach]), [
    'Ohne dieses Jahr laufen die Verteilungen wie gewählt.',
    '„Dach“: Abzug 2026 bis 2030 statt 2026 bis 2027 (Rest 2027).',
    ADVICE,
  ])
  // Ein Jahr, in dem keine Verteilung vorzeitig endet, sagt das statt „auf einmal abgezogen“.
  assert.deepEqual(spreadRestQuestions(2027, 2030, [dach]).slice(0, 2), [
    'Im Jahr 2030 endet keine Verteilung vorzeitig; sie laufen wie gewählt.',
    '„Dach“: Abzug 2026 bis 2030 statt 2026 bis 2027 (Rest 2027).',
  ])
  // Durchsicht S2: Ein Ende vor dem Beginn betrifft die Position nicht; das Fenster ab 2027 läuft bei Ende 2026 weiter.
  assert.deepEqual(spreadRestQuestions(null, 2026, [fenster]), [])
  assert.deepEqual(spreadRestQuestions(null, 2026, [dach, fenster]).slice(1, -1), ['„Dach“: Abzug ganz 2026 statt 2026 bis 2030.'])
  // Nichts betroffen: keine Rückfrage.
  assert.deepEqual(spreadRestQuestions(null, 2030, [dach]), [])
  assert.deepEqual(spreadRestQuestions(null, 2031, [dach, plain, krumm]), [])
  assert.deepEqual(spreadRestQuestions(2027, 2027, [dach]), [])
  assert.deepEqual(spreadRestQuestions(null, 2027, []), [])
})

// Durchsicht S3: Die Rückfrage an der Position kennt das Ende am Objekt; ändert die Wahl dadurch nichts, fragt sie nicht.
test('spreadQuestions mit Ende am Objekt: Abzug mit Rest, keine Frage, wo sich nichts ändert', () => {
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5 }), stored({ spreadYears: 3 }), [], 2027), [
    'Für die Steuer wird die Position dann auf 3 statt 5 Jahre verteilt: Abzug 2026 bis 2027 (Rest 2027).', BOUND, ADVICE,
  ])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: undefined }), stored({ spreadYears: 5 }), [], 2027), [
    'Für die Steuer wird die Position dann auf 5 Jahre verteilt: Abzug 2026 bis 2027 (Rest 2027) statt ganz 2026.', BOUND, ADVICE,
  ])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5 }), stored({ spreadYears: undefined }), [], 2027)[0],
    'Ohne Verteilung zählt die Position für die Steuer ganz im Jahr 2026; der Anteil 2027 entfällt.')
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5 }), null, [], 2027)[0], 'Der Anteil 2027 entfällt damit.')
  // Ende im Jahr der Zahlung: verteilt wird ohnehin nicht, keine Frage.
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5 }), stored({ spreadYears: 3 }), [], 2026), [])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: undefined }), stored({ spreadYears: 3 }), [], 2026), [])
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5 }), null, [], 2026), [])
  // Ein Ende vor dem Jahr der Zahlung wirkt nicht (S2).
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5 }), stored({ spreadYears: 2 }), [], 2025),
    spreadQuestions(stored({ spreadYears: 5 }), stored({ spreadYears: 2 })))
  // Ein anderes Jahr der Zahlung: beide Abzüge mit dem Ende.
  assert.deepEqual(spreadQuestions(stored({ spreadYears: 5, taxYear: 2026 }), stored({ spreadYears: 5, taxYear: 2027 }), [], 2028)[0],
    'Die Verteilung beginnt dann 2027 statt 2026: Abzug 2027 bis 2028 (Rest 2028) statt 2026 bis 2028 (Rest 2028).')
})
