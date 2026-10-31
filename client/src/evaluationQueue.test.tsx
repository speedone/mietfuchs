// @vitest-environment jsdom
// Die gemeinsame Warteschlange der KI-Auswertung (#170, eine für die App seit #490): nacheinander, mit Objekt, Jahr
// und Zeitraum je Eintrag, Belege aus dem Ordner nur mit ihrem Namen, Fehler und Abbruch je Eintrag. Eingang
// und Kostenseite benutzen sie beide; ihre Seitentests (aiCancel, kostenKiZiel, booking) und appQueue.test.tsx
// spielen sie durch die echten Seiten.
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { EvaluationQueueProvider, useEvaluationQueue, type QueueTarget } from './evaluationQueue'

type Pending = { path: string; form: FormData; signal: AbortSignal; resolve: (v: unknown) => void; reject: (e: Error) => void }
const pending: Pending[] = []

vi.mock('./pdfIntake', () => ({
  buildUpload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fd
  },
}))
vi.mock('./aiRequest', () => ({
  aiRequest: (path: string, form: FormData, opts: { signal: AbortSignal }) => new Promise((resolve, reject) => {
    pending.push({ path, form, signal: opts.signal, resolve, reject })
    opts.signal.addEventListener('abort', () => reject(new Error('abgebrochen')))
  }),
}))

// Ein neuer Versuch holt den Beleg aus dem Ordner der Seite Belege (die Datei bleibt nicht im Browser, Durchsicht K2)
let fetched: string[] = []
beforeEach(() => {
  fetched = []
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url)
    return new Response(new Blob(['PDF'], { type: 'application/pdf' }), { status: 200 })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  pending.length = 0
})

const pdf = (name: string) => new File(['PDF'], name, { type: 'application/pdf' })
const target: QueueTarget = { propertyId: 'objekt-1', year: 2025, period: '2025' }
const invoice = (file: string) => ({ file, kind: 'rechnung', extraction: { positions: [] }, assessment: { id: `a-${file}`, open: true } })

test('Belege gehen nacheinander an den Eingang, mit Objekt, Jahr und Zeitraum; jeder Eintrag trägt sie', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf'), new File(['x'], 'notiz.txt', { type: 'text/plain' }), pdf('b.pdf')], target))
  expect(result.current.queue.map((e) => e.fileName)).toEqual(['a.pdf', 'b.pdf'])
  await waitFor(() => expect(pending).toHaveLength(1))
  expect(pending[0]?.path).toBe('/api/intake')
  expect([pending[0]?.form.get('propertyId'), pending[0]?.form.get('year'), pending[0]?.form.get('period')]).toEqual(['objekt-1', '2025', '2025'])
  expect(result.current.queue.map((e) => e.status)).toEqual(['läuft', 'wartend'])
  expect(result.current.queue[1]).toMatchObject({ propertyId: 'objekt-1', year: 2025, period: '2025' })
  await act(async () => pending[0]?.resolve(invoice('server-a.pdf')))
  await waitFor(() => expect(pending).toHaveLength(2))
  expect(result.current.queue[0]).toMatchObject({ status: 'fertig', result: { file: 'server-a.pdf', kind: 'rechnung' } })
  await act(async () => pending[1]?.reject(new Error('Ollama ist nicht erreichbar.')))
  await waitFor(() => expect(result.current.queue[1]).toMatchObject({ status: 'fehler', error: 'Ollama ist nicht erreichbar.' }))
})

test('ein Beleg aus dem Ordner geht nur mit seinem Namen; Abbrechen ist kein Fehler', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addStored([{ file: pdf('Rechnung.pdf'), stored: '1700-rechnung.pdf' }], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  expect([pending[0]?.form.get('file'), pending[0]?.form.get('existingFile')]).toEqual([null, '1700-rechnung.pdf'])
  const id = result.current.queue[0]?.id ?? -1
  await act(async () => result.current.cancel(id))
  await waitFor(() => expect(result.current.queue[0]?.status).toBe('abgebrochen'))
})

// Fehler mit Ausweg: Scheitert die KI an einem gespeicherten Beleg, ist der Eintrag „gespeichert“ statt
// „fehler“, und ein neuer Versuch nennt den Beleg nur mit seinem Namen, statt ihn noch einmal hochzuladen.
test('ein gespeicherter Beleg ohne Auswertung lässt sich erneut auswerten, ohne neue Kopie', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  const failure = { error: 'Ollama ist nicht erreichbar.', file: 'srv-a.pdf', reason: 'unreachable' as const, kept: true as const }
  await act(async () => pending[0]?.reject(Object.assign(new Error(failure.error), { failure })))
  await waitFor(() => expect(result.current.queue[0]).toMatchObject({ status: 'gespeichert', failure }))
  expect(pending[0]?.form.get('file')).toBeInstanceOf(File)
  const id = result.current.queue[0]?.id ?? -1
  act(() => result.current.retry(id))
  await waitFor(() => expect(pending).toHaveLength(2))
  expect([pending[1]?.form.get('file'), pending[1]?.form.get('existingFile')]).toEqual([null, 'srv-a.pdf'])
  // Die Datei kam aus dem Ordner der Seite Belege, nicht aus dem Speicher des Browsers
  expect(fetched).toEqual(['/uploads/srv-a.pdf'])
  expect(result.current.queue[0]?.failure).toBeUndefined()
  await act(async () => pending[1]?.resolve(invoice('srv-a.pdf')))
  await waitFor(() => expect(result.current.queue[0]).toMatchObject({ status: 'fertig', result: { file: 'srv-a.pdf' } }))
})

// Durchsicht #487: Ein abgebrochener neuer Versuch stellt den gespeicherten Zustand mit dem alten Grund wieder her.
test('ein abgebrochener neuer Versuch kehrt zu „gespeichert“ mit dem alten Grund zurück', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  const failure = { error: 'Ollama ist nicht erreichbar.', file: 'srv-a.pdf', reason: 'unreachable' as const, kept: true as const }
  await act(async () => pending[0]?.reject(Object.assign(new Error(failure.error), { failure })))
  await waitFor(() => expect(result.current.queue[0]?.status).toBe('gespeichert'))
  const id = result.current.queue[0]?.id ?? -1
  act(() => result.current.retry(id))
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => result.current.cancel(id))
  await waitFor(() => expect(result.current.queue[0]).toMatchObject({ status: 'gespeichert', failure }))
  // und lässt sich danach wieder versuchen, weiter ohne neue Datei
  act(() => result.current.retry(id))
  await waitFor(() => expect(pending).toHaveLength(3))
  expect([pending[2]?.form.get('file'), pending[2]?.form.get('existingFile')]).toEqual([null, 'srv-a.pdf'])
})

// #490: Mit dem Provider der App gehört die Schlange nicht der Seite. Hängt die Seite aus, läuft die Auswertung
// weiter, und eine neu eingehängte Seite sieht ihr Ergebnis.
function Page({ id }: { id: string }) {
  useEvaluationQueue()
  return createElement('div', null, id)
}
test('in der App überlebt die Auswertung das Aushängen der Seite', async () => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(EvaluationQueueProvider, null, children)
  // Die Seite hängt neben dem Hook, der die Schlange beobachtet: erst ein, dann aus
  const { result, rerender } = renderHook(({ page }: { page: boolean }) => {
    const q = useEvaluationQueue()
    return { q, page: page ? createElement(Page, { id: 'kosten' }) : null }
  }, { wrapper, initialProps: { page: true } })
  act(() => result.current.q.addFiles([pdf('a.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  rerender({ page: false })
  expect(pending[0]?.signal.aborted).toBe(false)
  await act(async () => pending[0]?.resolve(invoice('srv-a.pdf')))
  await waitFor(() => expect(result.current.q.queue[0]?.status).toBe('fertig'))
})

test('ohne Provider (eine Seite für sich) bricht das Aushängen ab, was läuft', async () => {
  const { result, unmount } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  unmount()
  expect(pending[0]?.signal.aborted).toBe(true)
})

test('ein Zählerfoto ist fertig mit der Antwort; die Rechnung ohne gespeicherte Auswertung ein Fehler', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' }), pdf('b.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  await act(async () => pending[0]?.resolve({ file: 'srv-foto.jpg', kind: 'zaehler', reading: { meterNumber: '4711', value: 12, dateOnImage: null } }))
  await waitFor(() => expect(pending).toHaveLength(2))
  expect(result.current.queue[0]).toMatchObject({ status: 'fertig', result: { kind: 'zaehler' }, exifDate: null })
  await act(async () => pending[1]?.resolve({ file: 'srv-b.pdf', kind: 'rechnung', extraction: { positions: [] }, assessment: null }))
  await waitFor(() => expect(result.current.queue[1]).toMatchObject({ status: 'fehler', error: expect.stringMatching(/nicht speichern/) }))
})

// Durchsicht K1/S4: `sweep` räumt Erledigtes, `asInvoice` wertet ein Zählerfoto als Rechnung neu aus.
test('Erledigtes räumt `sweep`; ein Zählerfoto lässt sich als Rechnung neu auswerten', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' }), pdf('b.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  await act(async () => pending[0]?.resolve({ file: 'srv-foto.jpg', kind: 'zaehler', reading: { meterNumber: null, value: 3, dateOnImage: null } }))
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => result.current.cancel(result.current.queue[1]?.id ?? -1))
  await waitFor(() => expect(result.current.queue[1]?.status).toBe('abgebrochen'))
  act(() => result.current.sweep())
  expect(result.current.queue.map((x) => x.fileName)).toEqual(['foto.jpg'])
  act(() => result.current.asInvoice(result.current.queue[0]?.id ?? -1))
  await waitFor(() => expect(pending).toHaveLength(3))
  expect([pending[2]?.form.get('docType'), pending[2]?.form.get('existingFile'), pending[2]?.form.get('file')]).toEqual(['rechnung', 'srv-foto.jpg', null])
})
