// „Belege für die Steuer“ (#170): ein ZIP je Objekt und Jahr, geordnet nach den Gruppen der
// Anlage V, mit allen Positionen, auch den nicht umlagefähigen.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { CostItem } from '../../shared/types.ts'
import { planTaxArchive } from '../src/taxReceipts.ts'

const item = (id: string, extra: Partial<CostItem> = {}): CostItem => ({
  id, propertyId: 'p1', year: 2025, category: 'Grundsteuer', description: `Position ${id}`, amountCents: 10000, key: 'area', ...extra,
})

const names = new Map([
  ['1_gs.pdf', 'Bescheid Grundsteuer.pdf'],
  ['2_wasser.pdf', 'Wasser.pdf'],
  ['3_verwaltung.pdf', 'Verwaltung: Hausverwaltung/2025.pdf'],
  ['4_ruecklage.pdf', 'Rücklage.pdf'],
])

test('Steuer-Belege: Ordner je Gruppe der Anlage V in deren Reihenfolge, nicht umlagefähige eingeschlossen', () => {
  const plan = planTaxArchive([
    item('w', { category: 'Wasser/Abwasser', invoiceFile: '2_wasser.pdf' }),
    item('a', { category: 'Wasser/Abwasser', description: 'Abwasser', invoiceFile: '2_wasser.pdf' }),
    item('gs', { invoiceFile: '1_gs.pdf' }),
    item('v', { category: 'Nicht umlagefähig', invoiceFile: '3_verwaltung.pdf' }),
    item('r', { category: 'Zuführung Erhaltungsrücklage', invoiceFile: '4_ruecklage.pdf' }),
    item('ohne', { category: 'Gartenpflege', amountCents: 5000 }),
    item('weg', { category: 'Müllabfuhr', invoiceFile: '9_fehlt.pdf' }),
  ], names)
  assert.deepEqual(plan.files.map((f) => [f.zipPath, f.file]), [
    ['1 Grundsteuer & öffentliche Abgaben/Grundsteuer - Bescheid Grundsteuer.pdf', '1_gs.pdf'],
    // Ein Beleg für zwei Positionen derselben Gruppe kommt einmal hinein.
    ['2 Laufende Betriebskosten/Wasser-Abwasser - Wasser.pdf', '2_wasser.pdf'],
    ['4 Verwaltung & Instandhaltung/Nicht umlagefähig - Verwaltung- Hausverwaltung-2025.pdf', '3_verwaltung.pdf'],
    // Die Zuführung zur Rücklage ist keine Werbungskosten dieses Jahres und steht für sich.
    ['6 Erhaltungsrücklage (gesondert)/Zuführung Erhaltungsrücklage - Rücklage.pdf', '4_ruecklage.pdf'],
  ])
  const zeilen = plan.overviewCsv.replace(/^﻿/, '').trim().split('\r\n')
  assert.equal(zeilen[0], 'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);privat (EUR);abziehbar (EUR);Lohnanteil § 35a (EUR);Beleg')
  assert.equal(zeilen.length, 8)
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gartenpflege;Position ohne;;50,00;;;;kein Beleg'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Müllabfuhr;Position weg;;100,00;;;;Datei fehlt'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Wasser/Abwasser;Abwasser;;100,00;;;;2 Laufende Betriebskosten/Wasser-Abwasser - Wasser.pdf'))
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
  assert.ok(zeilen.includes('Grundsteuer & öffentliche Abgaben;Grundsteuer;Position gs;;500,00;300,00;200,00;;kein Beleg'), zeilen.join('\n'))
  assert.ok(zeilen.includes('Erhaltungsrücklage (gesondert);Zuführung Erhaltungsrücklage;Position r;;300,00;;;;kein Beleg'), zeilen.join('\n'))
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
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gartenpflege;Position zuviel;;10,00;;;;kein Beleg'), zeilen.join('\n'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Hauswart;Position negativ;;10,00;;;;kein Beleg'), zeilen.join('\n'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gebäudereinigung;Position gut;;10,00;;;6,00;kein Beleg'), zeilen.join('\n'))
})
