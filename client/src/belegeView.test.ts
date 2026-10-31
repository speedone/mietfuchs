// @vitest-environment jsdom
// Entscheidungslogik der Seite „Belege“ (#490): gemerkte Ansicht, Ablage, „Ohne Position“, Zeile für anderswo
// Offenes, Ort eines Treffers der Suche.
import { afterEach, expect, test, vi } from 'vitest'
import { aiMode, elsewhereGroups, hitPlace, readView, SKIPPED_FILES, splitFiles, VIEW_KEY, withoutPosition, writeView } from './belegeView'
import { receiptCards, type ReceiptUpload } from './receipts'
import type { QueueEntry } from './evaluationQueue'
import type { CostItem } from './types'
import { calendarPeriod } from '../../shared/period.ts'

const up = (file: string, over: Partial<ReceiptUpload> = {}): ReceiptUpload => ({
  file, size: 1, mtime: '2026-01-01T00:00:00.000Z', originalName: file, mimeType: 'application/pdf', uploadedAt: '2026-01-01T00:00:00.000Z',
  sha256: file, propertyId: null, year: null, invoiceDate: null, kind: 'receipt', ...over,
})
const entry = (id: number, over: Partial<QueueEntry>): QueueEntry => ({ id, fileName: `f${id}`, status: 'wartend', year: 2025, data: {}, ...over })

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

test('die zuletzt benutzte Ansicht gilt je Sitzung, ohne Angabe der Eingang', () => {
  expect(readView()).toBe('eingang')
  writeView('ordner')
  expect(sessionStorage.getItem(VIEW_KEY)).toBe('ordner')
  expect(readView()).toBe('ordner')
  writeView('eingang')
  expect(readView()).toBe('eingang')
})

test('ohne Speicher (privates Fenster) beginnt die Seite mit dem Eingang, ohne Absturz', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('gesperrt') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('gesperrt') })
  expect(() => writeView('ordner')).not.toThrow()
  expect(readView()).toBe('eingang')
})

test('Ablage: nur PDF und Bilder, die übrigen werden gezählt und mit einem Satz genannt', () => {
  const files = [new File(['x'], 'a.pdf', { type: 'application/pdf' }), new File(['x'], 'b.jpg', { type: 'image/jpeg' }), new File(['x'], 'c.docx', { type: 'application/msword' })]
  const { ok, skipped } = splitFiles(files)
  expect(ok.map((f) => f.name)).toEqual(['a.pdf', 'b.jpg'])
  expect(skipped).toBe(1)
  expect(SKIPPED_FILES).toMatch(/übergangen/)
})

test('Ablage: nur „nicht erreichbar“ ohne laufende Auswertung heißt ohne KI; ein Dienst im Internet wird nicht gefragt', () => {
  expect(aiMode(null, false)).toBe('ki')
  expect(aiMode({ ok: true }, false)).toBe('ki')
  expect(aiMode({ ok: false, reason: 'unreachable' }, false)).toBe('ohne')
  expect(aiMode({ ok: false, reason: 'timeout' }, false)).toBe('ki')
  expect(aiMode({ ok: false, reason: 'key' }, false)).toBe('ki')
  expect(aiMode({ ok: false }, false)).toBe('ki')
  expect(aiMode({ ok: false, reason: 'unreachable' }, false, true)).toBe('ki')
  expect(aiMode({ ok: false, reason: 'unreachable' }, true)).toBe('ki')
})

test('„Ohne Position“ lässt aus, was ausgewertet wird oder unter „Zu prüfen“ steht, und nennt Gespeichertes', () => {
  const cards = receiptCards([
    up('1_frei.pdf'),
    up('2_laeuft.pdf'),
    up('3_offen.pdf', { assessment: { id: 'a3', propertyId: 'p1', open: true } }),
    up('4_offen-anderswo.pdf', { assessment: { id: 'a4', propertyId: null, open: true } }),
    up('5_gescheitert.pdf'),
  ], [])
  const queue = [
    entry(1, { status: 'läuft', file: '2_laeuft.pdf' }),
    entry(2, { status: 'gespeichert', file: '5_gescheitert.pdf', failure: { reason: 'unreachable', file: '5_gescheitert.pdf', error: '' } as QueueEntry['failure'] }),
  ]
  const { cards: shown, kept } = withoutPosition(cards, queue, new Set(['a3']))
  expect(shown.map((c) => c.upload.file)).toEqual(['1_frei.pdf', '4_offen-anderswo.pdf', '5_gescheitert.pdf'])
  expect(kept.get('5_gescheitert.pdf')?.id).toBe(2)
})

test('Belege für ein anderes Objekt oder Jahr: je Ziel ihre Zahl; ohne Zuordnung zählt nicht', () => {
  const item: CostItem = { id: 'x', propertyId: 'p1', period: calendarPeriod(2025), category: 'Grundsteuer', description: 'GS', amountCents: 1, key: 'area', invoiceFile: '9_gebucht.pdf' }
  const cards = receiptCards([
    up('1_hier.pdf', { propertyId: 'p1', year: 2025 }),
    up('2_ohne.pdf'),
    up('3_p2.pdf', { propertyId: 'p2', year: 2025 }),
    up('4_p2.pdf', { propertyId: 'p2', year: 2025 }),
    up('5_vorjahr.pdf', { propertyId: 'p1', year: 2024 }),
    up('6_vorjahr-ohne-objekt.pdf', { year: 2024 }),
    up('7_foto.jpg', { propertyId: 'p2', kind: 'meterPhoto' }),
    up('9_gebucht.pdf', { propertyId: 'p2' }),
  ], [item])
  expect(elsewhereGroups(cards, { propertyId: 'p1', year: 2025 })).toEqual([
    { propertyId: 'p2', year: null, count: 2 },
    { propertyId: null, year: 2024, count: 2 },
  ])
  expect(elsewhereGroups(cards, { propertyId: 'all', year: 'all' })).toEqual([])
})

test('Suche: ein Treffer nennt Objekt und Jahr, ein Beleg ohne Position, wem er zugedacht ist', () => {
  const items: CostItem[] = [
    { id: 'a', propertyId: 'p1', period: calendarPeriod(2024), category: 'Grundsteuer', description: 'GS', amountCents: 1, key: 'area', invoiceFile: '1_gs.pdf' },
  ]
  const [linked, free, loose] = receiptCards([up('1_gs.pdf'), up('2_frei.pdf', { propertyId: 'p2', year: 2025 }), up('3_lose.pdf')], items)
  const name = (id: string) => ({ p1: 'Lindenstraße', p2: 'Ahornweg' }[id] ?? '?')
  expect(linked && hitPlace(linked, name, true)).toBe('Lindenstraße · 2024')
  expect(free && hitPlace(free, name, true)).toBe('Ahornweg · 2025')
  expect(loose && hitPlace(loose, name, true)).toBe('ohne Objekt · ohne Jahr')
  expect(linked && hitPlace(linked, name, false)).toBe('2024')
})

// Durchsicht (Kann): Ein Beleg eines anderen Jahres, dessen offene Auswertung schon unter „Zu prüfen“ steht, zählt in der
// Zeile „Ohne Position an anderer Stelle“ nicht noch einmal.
test('anderswo: ein Beleg mit gezeigter Auswertung zählt nicht', () => {
  const cards = receiptCards([
    up('1_vorjahr.pdf', { propertyId: 'p1', year: 2024, assessment: { id: 'a1', propertyId: 'p1', open: true } }),
    up('2_vorjahr.pdf', { propertyId: 'p1', year: 2024 }),
  ], [])
  expect(elsewhereGroups(cards, { propertyId: 'p1', year: 2025 }, new Set(['a1']))).toEqual([{ propertyId: null, year: 2024, count: 1 }])
})
