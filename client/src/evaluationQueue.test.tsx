// @vitest-environment jsdom
// Die gemeinsame Warteschlange der KI-Auswertung (#170, eine für die App seit #490): nacheinander, mit Objekt, Jahr
// und Zeitraum je Eintrag, Belege aus dem Ordner nur mit ihrem Namen, Fehler und Abbruch je Eintrag. Eingang
// und Kostenseite benutzen sie beide; ihre Seitentests (aiCancel, kostenKiZiel, booking) und appQueue.test.tsx
// spielen sie durch die echten Seiten.
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { EvaluationQueueProvider, storedNote, useEvaluationQueue, type QueueTarget } from './evaluationQueue'

type Pending = { path: string; form: FormData; signal: AbortSignal; onProgress?: (p: unknown) => void; resolve: (v: unknown) => void; reject: (e: Error) => void }
const pending: Pending[] = []

vi.mock('./pdfIntake', () => ({
  buildUpload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fd
  },
}))
vi.mock('./aiRequest', () => ({
  aiRequest: (path: string, form: FormData, opts: { signal: AbortSignal; onProgress?: (p: unknown) => void }) => new Promise((resolve, reject) => {
    pending.push({ path, form, signal: opts.signal, onProgress: opts.onProgress, resolve, reject })
    opts.signal.addEventListener('abort', () => reject(new Error('abgebrochen')))
  }),
}))

// Ein neuer Versuch holt den Beleg aus dem Ordner der Seite Belege (die Datei bleibt nicht im Browser, Durchsicht K2).
// Jede abgelegte Datei geht zuerst an `/api/upload`: Der nachgestellte Server nennt sie `srv-<Name>`; `uploadGate` hält
// einen Upload an, `uploadRefusal` lehnt einen ab.
type Upload = { name: string; propertyId: unknown; year: unknown; signal: AbortSignal | null | undefined }
let fetched: string[] = []
let uploads: Upload[] = []
let uploadGate: Map<string, Promise<void>> = new Map()
let uploadRefusal: Map<string, { status: number; error: string }> = new Map()
beforeEach(() => {
  fetched = []
  uploads = []
  uploadGate = new Map()
  uploadRefusal = new Map()
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/upload' && init?.body instanceof FormData) {
      const file = init.body.get('file')
      const name = file instanceof File ? file.name : ''
      uploads.push({ name, propertyId: init.body.get('propertyId'), year: init.body.get('year'), signal: init.signal })
      await uploadGate.get(name)
      if (init.signal?.aborted) throw new DOMException('abgebrochen', 'AbortError')
      const refusal = uploadRefusal.get(name)
      if (refusal) return new Response(JSON.stringify({ error: refusal.error }), { status: refusal.status })
      return new Response(JSON.stringify({ file: `srv-${name}` }), { status: 200 })
    }
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
  expect([pending[0]?.form.get('file'), pending[0]?.form.get('existingFile')]).toEqual([null, 'srv-a.pdf'])
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

// ---------- Erst speichern, dann auswerten (Befund der Systemprüfung: ein Stapel mit hängender KI ging verloren) ----------

test('ein Stapel wird sofort gespeichert, bevor irgendetwas ausgewertet ist; ausgewertet wird der gespeicherte Beleg', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')], target))
  // Die KI hängt (die erste Anfrage wird nie beantwortet): trotzdem liegen alle drei auf dem Server
  await waitFor(() => expect(uploads.map((u) => u.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']))
  expect(uploads.map((u) => [u.propertyId, u.year])).toEqual([['objekt-1', '2025'], ['objekt-1', '2025'], ['objekt-1', '2025']])
  await waitFor(() => expect(result.current.queue.map((x) => x.file)).toEqual(['srv-a.pdf', 'srv-b.pdf', 'srv-c.pdf']))
  await waitFor(() => expect(pending).toHaveLength(1))
  expect([pending[0]?.form.get('file'), pending[0]?.form.get('existingFile')]).toEqual([null, 'srv-a.pdf'])
  expect(result.current.queue.map((x) => x.status)).toEqual(['läuft', 'wartend', 'wartend'])
})

test('hochgeladen wird nacheinander, in der Reihenfolge der Ablage', async () => {
  let open: () => void = () => {}
  uploadGate.set('a.pdf', new Promise((resolve) => { open = resolve }))
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf'), pdf('b.pdf')], target))
  await waitFor(() => expect(uploads).toHaveLength(1))
  expect(result.current.queue.map((x) => x.file)).toEqual([undefined, undefined])
  expect(pending).toHaveLength(0)
  await act(async () => open())
  await waitFor(() => expect(uploads.map((u) => u.name)).toEqual(['a.pdf', 'b.pdf']))
})

test('Abbrechen der laufenden Auswertung: der Beleg bleibt gespeichert, der Eintrag nennt ihn', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  // Der Server löscht nur einen Beleg, der mit der Auswertung hochgeladen wurde; dieser kam als `existingFile`
  expect([pending[0]?.form.get('file'), pending[0]?.form.get('existingFile')]).toEqual([null, 'srv-a.pdf'])
  await act(async () => result.current.cancel(result.current.queue[0]?.id ?? -1))
  await waitFor(() => expect(result.current.queue[0]).toMatchObject({ status: 'abgebrochen', file: 'srv-a.pdf' }))
})

test('ein gescheiterter Upload ist ein Fehler dieses einen Belegs; die übrigen werden gespeichert und ausgewertet', async () => {
  uploadRefusal.set('a.pdf', { status: 422, error: 'Das ist ein Kontoauszug. Kontoauszüge lesen Sie auf der Seite Kontoauszug ein.' })
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf'), pdf('b.pdf')], target))
  await waitFor(() => expect(result.current.queue[0]).toMatchObject({ status: 'fehler', error: 'Das ist ein Kontoauszug. Kontoauszüge lesen Sie auf der Seite Kontoauszug ein.' }))
  expect(result.current.queue[0]?.file).toBeUndefined()
  await waitFor(() => expect(pending).toHaveLength(1))
  expect(pending[0]?.form.get('existingFile')).toBe('srv-b.pdf')
})

test('„Entfernen“ an einem wartenden Beleg: gespeichert bleibt er liegen (abgebrochen), noch nicht hochgeladen verschwindet er', async () => {
  let open: () => void = () => {}
  uploadGate.set('b.pdf', new Promise((resolve) => { open = resolve }))
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  await waitFor(() => expect(uploads).toHaveLength(2))
  const [, b, c] = result.current.queue
  // c wartet noch auf seinen Upload: nichts ist gespeichert, der Eintrag geht
  act(() => result.current.remove(c?.id ?? -1))
  expect(result.current.queue.map((x) => x.fileName)).toEqual(['a.pdf', 'b.pdf'])
  // b wird gerade hochgeladen: Der Upload wird abgebrochen
  act(() => result.current.remove(b?.id ?? -1))
  expect(uploads[1]?.signal?.aborted).toBe(true)
  await act(async () => open())
  expect(result.current.queue.map((x) => x.fileName)).toEqual(['a.pdf'])
  expect(uploads).toHaveLength(2)
})

test('„Entfernen“ an einem gespeicherten, wartenden Beleg lässt ihn als „abgebrochen“ mit seinem Namen stehen', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf'), pdf('b.pdf')], target))
  await waitFor(() => expect(result.current.queue[1]?.file).toBe('srv-b.pdf'))
  act(() => result.current.remove(result.current.queue[1]?.id ?? -1))
  expect(result.current.queue[1]).toMatchObject({ status: 'abgebrochen', file: 'srv-b.pdf' })
  // und wird nicht mehr ausgewertet
  await act(async () => pending[0]?.resolve(invoice('srv-a.pdf')))
  await waitFor(() => expect(result.current.queue[0]?.status).toBe('fertig'))
  expect(pending).toHaveLength(1)
  // „Entfernen“ am abgebrochenen Eintrag nimmt ihn aus der Liste
  act(() => result.current.remove(result.current.queue[1]?.id ?? -1))
  expect(result.current.queue.map((x) => x.fileName)).toEqual(['a.pdf'])
})

// Ein Bild, das der Server schon als Zählerfoto erkannt hat (er liest gerade den Stand), liegt nach dem Abbruch nicht
// unter „Ohne Position“, sondern im Ordner unter „Zählerfotos“: Der Satz am Eintrag nennt den richtigen Ort.
test('abgebrochen beim Lesen des Zählerstands: der Eintrag nennt die Zählerfotos, sonst „Ohne Position“', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([new File(['JPEG'], 'foto.jpg', { type: 'image/jpeg' }), pdf('b.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  act(() => pending[0]?.onProgress?.({ step: 'meterReading', phase: 'waiting' }))
  await act(async () => result.current.cancel(result.current.queue[0]?.id ?? -1))
  await waitFor(() => expect(result.current.queue[0]?.status).toBe('abgebrochen'))
  expect(storedNote(result.current.queue[0] ?? { status: 'fertig' })).toMatch(/im Ordner unter „Zählerfotos“/)
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => result.current.cancel(result.current.queue[1]?.id ?? -1))
  await waitFor(() => expect(result.current.queue[1]?.status).toBe('abgebrochen'))
  expect(storedNote(result.current.queue[1] ?? { status: 'fertig' })).toMatch(/im Eingang unter „Ohne Position“/)
  // Ohne Beleg in der Ablage kein Satz
  expect(storedNote({ status: 'fehler' })).toBe('')
})
