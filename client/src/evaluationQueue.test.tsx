// @vitest-environment jsdom
// Die gemeinsame Warteschlange der KI-Auswertung (#170, eine für die App seit #490): nacheinander, mit Objekt, Jahr
// und Zeitraum je Eintrag, Belege aus dem Ordner nur mit ihrem Namen, Fehler und Abbruch je Eintrag. Eingang
// und Kostenseite benutzen sie beide; ihre Seitentests (aiCancel, kostenKiZiel, booking) und appQueue.test.tsx
// spielen sie durch die echten Seiten.
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { EvaluationQueue, EvaluationQueueProvider, storedNote, storedPlaces, useEvaluationQueue, waitingLabel, type QueueTarget } from './evaluationQueue'

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

// Durchsicht: Der Satz „steht unter „Ohne Position““ gilt nur, solange der Beleg dort liegt. Wo er liegt, sagt der
// Bestand der Seite (`storedPlaces`), nicht die Erinnerung der Schlange: neu ausgewertet, zugeordnet, gelöscht oder
// als Zählerfoto erkannt stimmt der Satz sonst nicht mehr.
test('der Satz am abgebrochenen Eintrag folgt dem Bestand: „Ohne Position“, „Zählerfotos“ oder nichts', () => {
  const entry = { status: 'abgebrochen' as const, file: 'srv-a.pdf' }
  const places = (list: Parameters<typeof storedPlaces>[0], linked: string[] = []) => storedPlaces(list, new Set(linked))
  expect(storedNote(entry, places([{ file: 'srv-a.pdf', kind: 'receipt' }]))).toMatch(/im Eingang unter „Ohne Position“/)
  expect(storedNote({ ...entry, status: 'fehler' }, places([{ file: 'srv-a.pdf', kind: 'receipt' }]))).toMatch(/„Ohne Position“/)
  expect(storedNote(entry, places([{ file: 'srv-a.pdf', kind: 'meterPhoto' }]))).toMatch(/im Ordner unter „Zählerfotos“/)
  // gelöscht, an einer Position, gebucht oder mit offener Auswertung unter „Zu prüfen“: kein Satz
  expect(storedNote(entry, places([]))).toBe('')
  expect(storedNote(entry, places([{ file: 'srv-a.pdf', kind: 'receipt' }], ['srv-a.pdf']))).toBe('')
  expect(storedNote(entry, places([{ file: 'srv-a.pdf', kind: 'receipt', bookedItemIds: ['c1'] }]))).toBe('')
  expect(storedNote(entry, places([{ file: 'srv-a.pdf', kind: 'receipt', assessment: { open: true } }]))).toBe('')
  // ohne Beleg in der Ablage und in jedem anderen Zustand ohnehin nicht
  expect(storedNote({ status: 'fehler' }, places([{ file: 'srv-a.pdf', kind: 'receipt' }]))).toBe('')
  expect(storedNote({ status: 'fertig', file: 'srv-a.pdf' }, places([{ file: 'srv-a.pdf', kind: 'receipt' }]))).toBe('')
})

test('„Per KI auswerten“ an einem abgebrochenen Beleg räumt dessen alten Eintrag', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf')], target))
  await waitFor(() => expect(pending).toHaveLength(1))
  await act(async () => result.current.cancel(result.current.queue[0]?.id ?? -1))
  await waitFor(() => expect(result.current.queue[0]?.status).toBe('abgebrochen'))
  act(() => result.current.addStored([{ file: pdf('a.pdf'), stored: 'srv-a.pdf' }], target))
  expect(result.current.queue.map((x) => [x.file, x.status === 'abgebrochen'])).toEqual([['srv-a.pdf', false]])
})

test('eine leere Datei wird nicht gespeichert: ein Fehler mit Satz, die übrigen laufen weiter', async () => {
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([new File([], 'leer.pdf', { type: 'application/pdf' }), pdf('b.pdf')], target))
  await waitFor(() => expect(result.current.queue[0]).toMatchObject({ status: 'fehler', error: '„leer.pdf“ ist leer (0 Byte) und wurde nicht gespeichert.' }))
  expect(result.current.queue[0]?.file).toBeUndefined()
  await waitFor(() => expect(pending).toHaveLength(1))
  expect(uploads.map((u) => u.name)).toEqual(['b.pdf'])
})

test('ein wartender Eintrag sagt, wie weit er ist: wartet auf das Speichern, wird gespeichert, gespeichert', async () => {
  let open: () => void = () => {}
  uploadGate.set('a.pdf', new Promise((resolve) => { open = resolve }))
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')], target))
  await waitFor(() => expect(uploads).toHaveLength(1))
  await waitFor(() => expect(result.current.queue.map(waitingLabel)).toEqual(['wird gespeichert …', 'wartet auf das Speichern …', 'wartet auf das Speichern …']))
  await act(async () => open())
  await waitFor(() => expect(pending).toHaveLength(1))
  await waitFor(() => expect(result.current.queue.slice(1).map(waitingLabel)).toEqual(['gespeichert, wartet …', 'gespeichert, wartet …']))
})

// Objekt- oder Jahreswechsel mitten im Stapel: Jeder Beleg trägt Objekt und Jahr des Ablegens, auch wenn sein Upload
// erst beginnt, nachdem anderswo schon weiter abgelegt wurde.
test('Wechsel mitten im Stapel: jeder Beleg wird mit Objekt und Jahr seines Ablegens gespeichert und ausgewertet', async () => {
  let open: () => void = () => {}
  uploadGate.set('a.pdf', new Promise((resolve) => { open = resolve }))
  const { result } = renderHook(() => useEvaluationQueue())
  act(() => result.current.addFiles([pdf('a.pdf'), pdf('b.pdf')], target))
  await waitFor(() => expect(uploads).toHaveLength(1))
  act(() => result.current.addFiles([pdf('c.pdf')], { propertyId: 'objekt-2', year: 2024, period: '2024' }))
  await act(async () => open())
  await waitFor(() => expect(uploads.map((u) => [u.name, u.propertyId, u.year])).toEqual([
    ['a.pdf', 'objekt-1', '2025'], ['b.pdf', 'objekt-1', '2025'], ['c.pdf', 'objekt-2', '2024'],
  ]))
  await waitFor(() => expect(pending).toHaveLength(1))
  await act(async () => pending[0]?.resolve(invoice('srv-a.pdf')))
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => pending[1]?.resolve(invoice('srv-b.pdf')))
  await waitFor(() => expect(pending).toHaveLength(3))
  expect([pending[2]?.form.get('existingFile'), pending[2]?.form.get('propertyId'), pending[2]?.form.get('year'), pending[2]?.form.get('period')])
    .toEqual(['srv-c.pdf', 'objekt-2', '2024', '2024'])
})

// App.tsx fragt `unsaved` beim Schließen des Tabs: auch, solange ein Upload aussteht.
test('solange ein Beleg noch nicht gespeichert ist, gilt die Schlange als ungespeichert', async () => {
  let open: () => void = () => {}
  uploadGate.set('a.pdf', new Promise((resolve) => { open = resolve }))
  const queue = new EvaluationQueue()
  queue.open()
  queue.addFiles([pdf('a.pdf')], target)
  await waitFor(() => expect(uploads).toHaveLength(1))
  expect(queue.getSnapshot()[0]?.file).toBeUndefined()
  expect(queue.unsaved()).toBe(true)
  queue.abortAll()
  open()
})
