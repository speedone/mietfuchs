// Umzug der Daten ins Programmfenster (#517): wann der Bildschirm erscheint und was er über einen Fund sagt.
import { describe, expect, test } from 'vitest'
import { adoptedText, candidateFacts, folderBridge, inWindow, type RelocationCandidate } from './relocation'

const candidate = (over: Partial<RelocationCandidate> = {}): RelocationCandidate => ({
  dataDir: 'C:\\Users\\Anna\\Downloads\\mietfuchs\\data', kind: 'database', modifiedAt: '2026-10-12T09:30:00.000Z',
  properties: 1, tenancies: 5, running: false, source: 'search', appVersion: null, ...over,
})

describe('inWindow und folderBridge', () => {
  test('nur im Programmfenster: im Browser und auf dem Handy gibt es keine Brücke', () => {
    expect(inWindow(undefined)).toBe(false)
    expect(inWindow({})).toBe(false)
    expect(inWindow({ mietfuchsDesktop: { print: async () => {} } })).toBe(true)
  })
  test('die Wahl des Ordners nur, wenn das Fenster sie kennt', () => {
    const choose = async () => 'C:\\x'
    expect(folderBridge({ mietfuchsDesktop: { print: async () => {} } })).toBeNull()
    expect(folderBridge({ mietfuchsDesktop: { chooseFolder: choose } })).toBe(choose)
  })
})

describe('candidateFacts', () => {
  test('Ort, zuletzt geändert und Bestand', () => {
    expect(candidateFacts(candidate())).toEqual({
      place: 'C:\\Users\\Anna\\Downloads\\mietfuchs\\data',
      modified: 'Zuletzt geändert am 12. Oktober 2026',
      stock: '1 Objekt, 5 Mietverhältnisse',
    })
    expect(candidateFacts(candidate({ properties: 2, tenancies: 1 })).stock).toBe('2 Objekte, 1 Mietverhältnis')
  })
  test('unlesbar: ohne Zahlen, ohne Datum', () => {
    expect(candidateFacts(candidate({ properties: null, tenancies: null, modifiedAt: null }))).toEqual({
      place: 'C:\\Users\\Anna\\Downloads\\mietfuchs\\data', modified: null, stock: null,
    })
  })
})

test('adoptedText: was übernommen wurde', () => {
  expect(adoptedText({ properties: 1, tenancies: 2, costItems: 14, receipts: 1 }))
    .toBe('Übernommen: 1 Objekt, 2 Mietverhältnisse, 14 Kostenpositionen und 1 Beleg.')
  expect(adoptedText({ properties: 2, tenancies: 1, costItems: 1, receipts: 0 }))
    .toBe('Übernommen: 2 Objekte, 1 Mietverhältnis und 1 Kostenposition.')
})
