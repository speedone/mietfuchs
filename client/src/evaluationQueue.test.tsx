// @vitest-environment jsdom
// Die gemeinsame Warteschlange der KI-Auswertung (#170): nacheinander, mit Objekt und Jahr, Belege
// aus dem Ordner nur mit ihrem Namen, Fehler und Abbruch je Eintrag. Schnellerfassung und
// Kostenseite benutzen sie beide; ihre Seitentests (aiCancel, kostenKiZiel, booking) spielen sie
// durch die echten Seiten.
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useEvaluationQueue, type QueueOptions } from './evaluationQueue'

type Pending = { form: FormData; resolve: (v: { file: string }) => void; reject: (e: Error) => void }
const pending: Pending[] = []

vi.mock('./pdfIntake', () => ({
  buildUpload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fd
  },
}))
vi.mock('./aiRequest', () => ({
  aiRequest: (_path: string, form: FormData, opts: { signal: AbortSignal }) => new Promise((resolve, reject) => {
    pending.push({ form, resolve, reject })
    opts.signal.addEventListener('abort', () => reject(new Error('abgebrochen')))
  }),
}))

afterEach(() => {
  cleanup()
  pending.length = 0
})

const pdf = (name: string) => new File(['PDF'], name, { type: 'application/pdf' })
const options = (patch: Partial<QueueOptions<{ file: string }, { serverFile: string }>> = {}): QueueOptions<{ file: string }, { serverFile: string }> => ({
  endpoint: '/api/extract', propertyId: 'objekt-1', year: 2025,
  finish: (res) => ({ status: 'fertig', data: { serverFile: res.file } }),
  ...patch,
})

test('Belege gehen nacheinander an den Server, mit Objekt und Jahr; die Antwort setzt die Seite um', async () => {
  const { result } = renderHook(() => useEvaluationQueue(options()))
  act(() => result.current.addFiles([pdf('a.pdf'), new File(['x'], 'notiz.txt', { type: 'text/plain' }), pdf('b.pdf')]))
  expect(result.current.queue.map((e) => e.fileName)).toEqual(['a.pdf', 'b.pdf'])
  await waitFor(() => expect(pending).toHaveLength(1))
  expect([pending[0]?.form.get('propertyId'), pending[0]?.form.get('year')]).toEqual(['objekt-1', '2025'])
  expect(result.current.queue.map((e) => e.status)).toEqual(['läuft', 'wartend'])
  await act(async () => pending[0]?.resolve({ file: 'server-a.pdf' }))
  await waitFor(() => expect(pending).toHaveLength(2))
  expect(result.current.queue[0]).toMatchObject({ status: 'fertig', data: { serverFile: 'server-a.pdf' } })
  await act(async () => pending[1]?.reject(new Error('Ollama ist nicht erreichbar.')))
  await waitFor(() => expect(result.current.queue[1]).toMatchObject({ status: 'fehler', error: 'Ollama ist nicht erreichbar.' }))
})

test('ein Beleg aus dem Ordner geht nur mit seinem Namen; Abbrechen ist kein Fehler', async () => {
  const { result } = renderHook(() => useEvaluationQueue(options()))
  act(() => result.current.addStored([{ file: pdf('Rechnung.pdf'), stored: '1700-rechnung.pdf' }]))
  await waitFor(() => expect(pending).toHaveLength(1))
  expect([pending[0]?.form.get('file'), pending[0]?.form.get('existingFile')]).toEqual([null, '1700-rechnung.pdf'])
  const id = result.current.queue[0]?.id ?? -1
  await act(async () => result.current.cancel(id))
  await waitFor(() => expect(result.current.queue[0]?.status).toBe('abgebrochen'))
})
