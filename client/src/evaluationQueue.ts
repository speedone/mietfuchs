// Die Warteschlange der KI-Auswertung (Belegbuchung, #170), gemeinsam für Schnellerfassung und
// Kostenseite. Vorher stand sie in beiden Seiten je einmal: Hochladen, Abruf als Strom, Abbruch und
// Fortschritt. Belege gehen nacheinander an den Server, denn ein lokales Modell verarbeitet
// sinnvoll nur eine Anfrage gleichzeitig. Was aus einer Antwort wird, entscheidet die Seite
// (`finish`); gebucht wird danach über die gespeicherte Auswertung („Auswertung prüfen“).
import { useEffect, useRef, useState } from 'react'
import { aiRequest, type AiProgress } from './aiRequest'
import { buildUpload } from './pdfIntake'
import { errorText } from './api'

export type QueueStatus = 'wartend' | 'läuft' | 'fertig' | 'fehler' | 'abgebrochen' | 'übernommen'

// Ein Eintrag. Was die Seite dazu führt (`X`), steht getrennt in `data`: Es kommt erst mit der
// Antwort und ist deshalb optional, und es kann die Felder der Warteschlange nicht überdecken.
export type QueueBase = {
  id: number
  fileName: string
  status: QueueStatus
  error?: string
  // während der Auswertung: was das Modell gerade tut und seit wann
  progress?: AiProgress | null
  startedAt?: number
}
export type QueueEntry<X extends object> = QueueBase & { data: Partial<X> }
// Was sich an einem Eintrag ändert: Felder der Warteschlange und, ergänzend, die der Seite.
export type QueuePatch<X extends object> = Partial<Omit<QueueBase, 'id' | 'fileName'>> & { data?: Partial<X> }

export type QueueOptions<R, X extends object> = {
  endpoint: '/api/intake' | '/api/extract'
  // Kantenlänge der Seitenbilder eines Scans (Einstellung „Erweitert“, #35)
  pageImageEdge?: number
  // Objekt und Jahr der Auswertung: Ein ungebuchter Beleg steht im Posteingang dieses Objekts, und
  // nennt er kein Jahr, gilt das gewählte.
  propertyId?: string
  year: number
  // Der gewählte Abrechnungszeitraum (#208); der Server nimmt ihn nur, wenn es ihn für das Objekt gibt.
  period?: string
  // Was aus der Antwort wird. Gilt jeweils in der Fassung des letzten Renderns.
  finish: (result: R, file: File, entry: QueueEntry<X>) => QueuePatch<X> | Promise<QueuePatch<X>>
}

export function useEvaluationQueue<R, X extends object>(options: QueueOptions<R, X>) {
  const [queue, setQueue] = useState<QueueEntry<X>[]>([])
  const optionsRef = useRef(options)
  optionsRef.current = options
  const filesRef = useRef(new Map<number, File>())
  // Belege, die schon im Belegordner liegen (Posteingang): Name im Ordner je Eintrag
  const storedRef = useRef(new Map<number, string>())
  const nextIdRef = useRef(1)
  // Abbruch je laufender Auswertung; der Server stoppt dann auch das Modell
  const abortRef = useRef(new Map<number, AbortController>())

  const patchEntry = (id: number, { data, ...rest }: QueuePatch<X>) =>
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...rest, data: { ...x.data, ...data } } : x)))

  function enqueue(list: { file: File; stored?: string }[]) {
    const entries: QueueEntry<X>[] = []
    for (const { file, stored } of list) {
      const id = nextIdRef.current++
      filesRef.current.set(id, file)
      if (stored) storedRef.current.set(id, stored)
      entries.push({ id, fileName: file.name, status: 'wartend', data: {} })
    }
    if (entries.length) setQueue((q) => [...q, ...entries])
  }

  // Neue Dateien: nur PDF und Bilder.
  const addFiles = (files: Iterable<File>) =>
    enqueue([...files].filter((f) => /^(application\/pdf|image\/)/.test(f.type)).map((file) => ({ file })))
  // Belege aus dem Belegordner: An den Server geht nur ihr Name, sonst lägen sie danach doppelt dort.
  const addStored = (list: { file: File; stored: string }[]) => enqueue(list)

  function remove(id: number) {
    filesRef.current.delete(id)
    storedRef.current.delete(id)
    setQueue((q) => q.filter((x) => x.id !== id))
  }
  const cancel = (id: number) => abortRef.current.get(id)?.abort()

  // Wer die Seite verlässt, wartet nicht mehr auf die Auswertung
  useEffect(() => () => { for (const controller of abortRef.current.values()) controller.abort() }, [])

  useEffect(() => {
    if (queue.some((x) => x.status === 'läuft')) return
    const next = queue.find((x) => x.status === 'wartend')
    if (!next) return
    const file = filesRef.current.get(next.id)
    if (!file) {
      patchEntry(next.id, { status: 'fehler', error: 'Die Datei ist nicht mehr da. Bitte laden Sie sie noch einmal hoch.' })
      return
    }
    const controller = new AbortController()
    abortRef.current.set(next.id, controller)
    patchEntry(next.id, { status: 'läuft', startedAt: Date.now(), progress: null })
    void (async () => {
      const o = optionsRef.current
      try {
        // PDFs liest der Browser selbst und schickt Text oder Seitenbilder mit (pdfIntake.ts)
        const fd = await buildUpload(file, undefined, o.pageImageEdge)
        const stored = storedRef.current.get(next.id)
        if (stored) {
          fd.delete('file')
          fd.append('existingFile', stored)
        }
        if (o.propertyId) fd.append('propertyId', o.propertyId)
        fd.append('year', String(o.year))
        if (o.period) fd.append('period', o.period)
        const res = await aiRequest<R>(o.endpoint, fd, {
          signal: controller.signal,
          onProgress: (progress) => patchEntry(next.id, { progress }),
        })
        patchEntry(next.id, await optionsRef.current.finish(res, file, next))
      } catch (e) {
        // Selbst abgebrochen ist kein Fehler
        if (controller.signal.aborted) patchEntry(next.id, { status: 'abgebrochen' })
        else patchEntry(next.id, { status: 'fehler', error: errorText(e) })
      } finally {
        filesRef.current.delete(next.id)
        storedRef.current.delete(next.id)
        abortRef.current.delete(next.id)
      }
    })()
  }, [queue])

  return { queue, patchEntry, setQueue, addFiles, addStored, remove, cancel }
}
