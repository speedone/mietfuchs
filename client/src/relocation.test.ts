// Umzug der Daten ins Programmfenster (#517): wann der Bildschirm erscheint und was er über einen Fund sagt.
import { describe, expect, test } from 'vitest'
import {
  adoptedText, arrivalFrom, arrivalSummary, arrivalUrl, candidateFacts, candidateProblem, folderBridge, inWindow, placeText, rankCandidates,
  type RelocationCandidate,
} from './relocation'
import { RELEASES_URL, STORE_URL } from './update'
import { CALENDAR_RULES, periodKey } from '../../shared/period.ts'

const candidate = (over: Partial<RelocationCandidate> = {}): RelocationCandidate => ({
  id: 'f-1',
  dataDir: 'C:\\Users\\Anna\\Downloads\\mietfuchs\\data', kind: 'database', modifiedAt: '2026-10-12T09:30:00.000Z',
  properties: 1, tenancies: 5, running: false, source: 'search', appVersion: null,
  names: [], problem: null, priorVersions: 0, place: { folder: 'mietfuchs', within: 'Downloads' }, ...over,
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
  // Praxistest B-01, D, O: kein langer Pfad vorn, sondern der Ordner und der bekannte Ort; der Pfad nur als „Genauer Ort“
  test('Ort in Worten, Objekte, zuletzt geändert und Bestand', () => {
    expect(candidateFacts(candidate({ names: ['Haus am Weg'] }))).toEqual({
      place: 'Ordner „mietfuchs“ in Downloads',
      path: 'C:\\Users\\Anna\\Downloads\\mietfuchs\\data',
      names: 'Haus am Weg',
      modified: 'Zuletzt geändert am 12. Oktober 2026',
      stock: '1 Objekt, 5 Mietverhältnisse',
    })
    expect(candidateFacts(candidate({ properties: 2, tenancies: 1 })).stock).toBe('2 Objekte, 1 Mietverhältnis')
    expect(candidateFacts(candidate({ names: ['A', 'B', 'C', 'D', 'E'] })).names).toBe('A, B, C und 2 weitere')
    expect(candidateFacts(candidate({ names: ['A', 'B'] })).names).toBe('A und B')
  })
  test('unlesbar: ohne Zahlen, ohne Datum', () => {
    const facts = candidateFacts(candidate({ properties: null, tenancies: null, modifiedAt: null }))
    expect(facts.modified).toBeNull()
    expect(facts.stock).toBeNull()
    expect(facts.names).toBeNull()
  })
})

test('placeText: Downloads, Schreibtisch, Dokumente, OneDrive, sonst nur der Ordner', () => {
  expect(placeText({ folder: 'mietfuchs-0.14.1', within: 'Downloads' })).toBe('Ordner „mietfuchs-0.14.1“ in Downloads')
  expect(placeText({ folder: 'mietfuchs', within: 'Schreibtisch' })).toBe('Ordner „mietfuchs“ auf dem Schreibtisch')
  expect(placeText({ folder: 'mietfuchs', within: 'Dokumente' })).toBe('Ordner „mietfuchs“ in Dokumente')
  expect(placeText({ folder: 'mietfuchs', within: 'OneDrive' })).toBe('Ordner „mietfuchs“ in OneDrive')
  expect(placeText({ folder: 'mietfuchs', within: null })).toBe('Ordner „mietfuchs“')
})

// Praxistest D: Zwei Funde sahen gleich aus; der neueste steht oben und heißt so, die übrigen sind ältere Stände
test('rankCandidates: der neueste zuerst und hervorgehoben, ein einzelner Fund ohne Rang', () => {
  const older = candidate({ id: 'alt', modifiedAt: '2025-03-14T10:00:00.000Z' })
  const newest = candidate({ id: 'neu', modifiedAt: '2026-11-02T11:00:00.000Z' })
  expect(rankCandidates([older, newest]).map((r) => [r.candidate.id, r.role])).toEqual([['neu', 'newest'], ['alt', 'older']])
  expect(rankCandidates([newest]).map((r) => r.role)).toEqual(['only'])
  // Ohne Datum hinten
  expect(rankCandidates([candidate({ id: 'ohne', modifiedAt: null }), older]).map((r) => r.candidate.id)).toEqual(['alt', 'ohne'])
})

describe('candidateProblem', () => {
  // Praxistest J: kein Rat ins alte Mietfuchs, das die Datei ebenso wenig öffnet
  test('beschädigt: nichts verändert, Backup einspielen, Vorversionen genannt', () => {
    const p = candidateProblem(candidate({ problem: 'damaged', priorVersions: 3 }), false)
    expect(p?.title).toBe('Beschädigt, lässt sich nicht lesen')
    expect(p?.text).toMatch(/An der Datei wurde nichts verändert\./)
    expect(p?.text).toMatch(/Backup \(eine ZIP-Datei\).*hier ein/)
    expect(p?.text).toMatch(/3 automatische Vorversionen.*„vorversionen“/)
    expect(p?.text).not.toMatch(/Öffnen Sie|herunterladen/)
    expect(p?.link).toBeNull()
    expect(candidateProblem(candidate({ problem: 'damaged' }), false)?.text).not.toMatch(/Vorversion/)
  })
  // Praxistest I: vorab gesagt, ohne „Änderung am Aufbau“, mit festem Weg zur neuesten Version
  test('neuere Version: verständlich, mit Link zur neuesten Version bzw. in den Store', () => {
    const p = candidateProblem(candidate({ problem: 'newer' }), false)
    expect(p?.title).toBe('Aus einer neueren Mietfuchs-Version')
    expect(p?.text).not.toMatch(/Aufbau/)
    expect(p?.link).toEqual({ label: 'Neueste Version herunterladen', href: RELEASES_URL })
    expect(candidateProblem(candidate({ problem: 'newer' }), true)?.link).toEqual({ label: 'Mietfuchs im Microsoft Store aktualisieren', href: STORE_URL })
    expect(candidateProblem(candidate(), false)).toBeNull()
  })
})

// Praxistest B-04, E-04, P-05: Nach dem Umzug stand das Cockpit im aktuellen Jahr bei „0,00 €“
describe('Ankunft nach Umzug oder Backup', () => {
  test('die Adresse trägt den Anlass über das Neuladen, danach ist er wieder weg', () => {
    expect(arrivalUrl('http://127.0.0.1:17517/', 'moved')).toBe('http://127.0.0.1:17517/?arrived=moved')
    expect(arrivalUrl('http://127.0.0.1:17517/?x=1#a', 'backup')).toBe('http://127.0.0.1:17517/?x=1&arrived=backup#a')
    expect(arrivalFrom('?arrived=moved')).toBe('moved')
    expect(arrivalFrom('?arrived=newer')).toBe('newer')
    expect(arrivalFrom('?arrived=unsinn')).toBeNull()
    expect(arrivalFrom('')).toBeNull()
  })
  const haus = { id: 'p1', name: 'Haus am Weg', rules: CALENDAR_RULES }
  test('ein Objekt: das Jahr mit den jüngsten Kosten, Zahl der Mietverhältnisse', () => {
    const s = arrivalSummary('moved', [{ property: haus, tenancies: 2, periods: [periodKey('2023-01'), periodKey('2024-01')] }], 'p1')
    expect(s.title).toBe('Ihre Daten sind da')
    expect(s.text).toBe('2 Mietverhältnisse in „Haus am Weg“. Mietfuchs zeigt das Abrechnungsjahr 2024, in dem zuletzt Kosten erfasst sind. Ein anderes Jahr wählen Sie unter „Abrechnungsjahr“.')
    expect(s.target).toEqual({ propertyId: 'p1', periodKey: '2024-01' })
  })
  test('mehrere Objekte: das mit den jüngsten Kosten, bei Gleichstand das gewählte', () => {
    const lind = { id: 'p2', name: 'Lindenweg', rules: CALENDAR_RULES }
    const s = arrivalSummary('backup', [
      { property: haus, tenancies: 1, periods: [periodKey('2024-01')] },
      { property: lind, tenancies: 3, periods: [periodKey('2024-01')] },
    ], 'p2')
    expect(s.title).toBe('Ihr Backup ist eingespielt')
    expect(s.text).toMatch(/^4 Mietverhältnisse in 2 Objekten\. Mietfuchs zeigt „Lindenweg“, Abrechnungsjahr 2024, in dem zuletzt Kosten erfasst sind\./)
    expect(s.target).toEqual({ propertyId: 'p2', periodKey: '2024-01' })
  })
  test('ohne Kosten: kein Sprung, nur der Bestand', () => {
    const s = arrivalSummary('newer', [{ property: haus, tenancies: 1, periods: [] }], 'p1')
    expect(s.title).toBe('Der neuere Stand ist übernommen')
    expect(s.text).toBe('1 Mietverhältnis in „Haus am Weg“.')
    expect(s.target).toBeNull()
  })
})

test('adoptedText: was übernommen wurde', () => {
  expect(adoptedText({ properties: 1, tenancies: 2, costItems: 14, receipts: 1 }))
    .toBe('Übernommen: 1 Objekt, 2 Mietverhältnisse, 14 Kostenpositionen und 1 Beleg.')
  expect(adoptedText({ properties: 2, tenancies: 1, costItems: 1, receipts: 0 }))
    .toBe('Übernommen: 2 Objekte, 1 Mietverhältnis und 1 Kostenposition.')
})
