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
  assert.equal(zeilen[0], 'Gruppe;Kostenart;Beschreibung;Rechnungssteller;Betrag (EUR);Lohnanteil § 35a (EUR);Beleg')
  assert.equal(zeilen.length, 8)
  assert.ok(zeilen.includes('Laufende Betriebskosten;Gartenpflege;Position ohne;;50,00;;kein Beleg'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Müllabfuhr;Position weg;;100,00;;Datei fehlt'))
  assert.ok(zeilen.includes('Laufende Betriebskosten;Wasser/Abwasser;Abwasser;;100,00;;2 Laufende Betriebskosten/Wasser-Abwasser - Wasser.pdf'))
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
