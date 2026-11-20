// Die Warteschlange der KI-Auswertung (Belegbuchung, #170), eine für die ganze App (#490). Sie liegt oberhalb der
// Seiten (`EvaluationQueueProvider` in App.tsx, außerhalb des Schlüssels, mit dem App.tsx die Seiten je Objekt und
// Zeitraum neu aufstellt): Eine Auswertung läuft weiter, wenn man die Seite, das Objekt oder den Zeitraum wechselt,
// und ihr Ergebnis steht da, wenn man zurückkehrt. Jeder Eintrag trägt Objekt, Jahr und Zeitraum, mit denen er
// hochgeladen wurde; jede Seite zeigt die Einträge ihres Objekts und Zeitraums (`entriesFor`).
//
// **Ein abgelegter Beleg ist gespeichert, bevor er ausgewertet wird**: Jede Datei geht über `/api/upload` in die
// Ablage (mit Objekt und Jahr, wie „Nur ablegen, ohne Auswertung“), der Reihe nach und unabhängig davon, ob gerade
// eine Auswertung läuft; ausgewertet wird danach der gespeicherte Beleg (`existingFile`). Hängt die KI, wird die
// Auswertung abgebrochen, der Tab geschlossen oder die Seite neu geladen, geht von einem gespeicherten Beleg
// höchstens die Auswertung verloren: Er steht dann im Eingang unter „Ohne Position“. Ein Beleg, dessen Upload noch
// aussteht, ist dagegen nur im Browser; der Eintrag sagt, wie weit er ist (`waitingLabel`), und `unsaved` lässt den
// Browser beim Schließen fragen. Vorher lag nur der Beleg auf dem Server,
// der gerade ausgewertet wurde, und ein Abbruch löschte auch den.
//
// Ausgewertet wird nacheinander, denn ein lokales Modell verarbeitet sinnvoll nur eine Anfrage
// gleichzeitig. Schnellerfassung und Kosten werten über denselben Eingang aus (`/api/intake`), der Rechnung und
// Zählerfoto unterscheidet. Gebucht wird danach über die gespeicherte Auswertung („Auswertung prüfen“), ein
// Zählerstand mit „Ablesung übernehmen“.
import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { aiRequest, type AiProgress } from './aiRequest'
import { appFetch } from './access'
import { buildUpload } from './pdfIntake'
import { api, errorText } from './api'
import { failureOf } from './aiFailure'
import { readExifDate, type ReadingCandidate } from './readingCandidate'
import type { AiFailure, AssessmentView, IntakeResult } from './types'
import { isBankFileError, splitFiles } from './belegeView'

// 'gespeichert': Die KI ist gescheitert, der Beleg ist aber gespeichert (Fehler mit Ausweg, #487); `failure`
// sagt warum, und `retry` wertet ihn erneut aus, ohne ihn noch einmal hochzuladen.
// 'abgelegt': ein gespeicherter Eintrag, den der Nutzer aus der Liste genommen hat; an seiner Stelle steht, dass der
// Beleg weiter auf der Seite Belege liegt (`failure` bleibt für den Weg dorthin).
export type QueueStatus = 'wartend' | 'läuft' | 'fertig' | 'fehler' | 'gespeichert' | 'abgelegt' | 'abgebrochen' | 'übernommen'

// Wofür ein Beleg ausgewertet wird: Ein ungebuchter Beleg steht im Posteingang dieses Objekts, und nennt er kein
// Jahr, gilt das gewählte; der Zeitraum (#208) gilt nur, wenn es ihn für das Objekt gibt.
export type QueueTarget = {
  propertyId?: string
  year: number
  period?: string
  // Kantenlänge der Seitenbilder eines Scans (Einstellung „Erweitert“, #35)
  pageImageEdge?: number
  // 'rechnung': Der Beleg ist eine Rechnung, der Server fragt das Modell nicht nach der Belegart (Seite Kosten, #490,
  // und „Als Rechnung auswerten“ an einem erkannten Zählerfoto).
  docType?: 'rechnung'
}

export type QueueBase = {
  id: number
  fileName: string
  status: QueueStatus
  error?: string
  failure?: AiFailure
  // während der Auswertung: was das Modell gerade tut und seit wann
  progress?: AiProgress | null
  startedAt?: number
}

// Was die Seiten am Eintrag ändern: den geprüften Zählerstand (ab der ersten Eingabe) und die Auswertung nach einer
// Buchung auf der Seite Kosten.
export type QueueData = { reading?: ReadingCandidate; assessment?: AssessmentView }

export type QueueEntry = QueueBase & {
  propertyId?: string
  year: number
  period?: string
  // die Antwort des Servers und, bei einem Zählerfoto, das Aufnahmedatum aus der Datei
  result?: IntakeResult
  exifDate?: string | null
  // Der Name des Belegs in der Ablage, sobald es ihn gibt (gleich nach dem Hochladen, bei einem Beleg aus dem Eingang
  // von Anfang an): Daran erkennt der Eingang, dass seine Karte schon anderswo steht (#490). Solange er an einem
  // wartenden Eintrag fehlt, ist der Beleg noch nicht gespeichert (`waitingLabel`).
  file?: string
  // Sein Upload läuft gerade (`waitingLabel`)
  storing?: boolean
  data: QueueData
}
export type QueuePatch = Partial<Omit<QueueEntry, 'id' | 'fileName' | 'data'>> & { data?: QueueData }

const NOT_SAVED = 'Die Auswertung ließ sich nicht speichern. Bitte versuchen Sie es noch einmal; gebucht wurde nichts.'

// Was aus einer Antwort wird. Ein Zählerfoto liest sein Aufnahmedatum jetzt, solange die Datei noch da ist; den
// Vorschlag (Zähler, Ampel) bildet die Seite mit ihren Zählern (readingCandidate.ts).
async function settle(res: IntakeResult, file: File): Promise<QueuePatch> {
  if (res.kind === 'zaehler') return { status: 'fertig', result: res, file: res.file, exifDate: await readExifDate(file) }
  if (!res.assessment) return { status: 'fehler', error: NOT_SAVED }
  return { status: res.assessment.open ? 'fertig' : 'übernommen', result: res, file: res.file }
}

// Die Auswertung, wie sie gerade steht: nach einer Buchung die neue Fassung, sonst die der Antwort.
export function assessmentOf(entry: QueueEntry): AssessmentView | null {
  return entry.data.assessment ?? (entry.result?.kind === 'rechnung' ? entry.result.assessment : null) ?? null
}

// Die Einträge eines Objekts und Zeitraums. Ohne Zeitraum am Eintrag (Seitentests) zählt nur das Objekt.
export const belongsTo = (entry: QueueEntry, propertyId: string | undefined, period: string | undefined): boolean =>
  entry.propertyId === propertyId && (entry.period === undefined || entry.period === period)

// Was in einem anderen Objekt oder Zeitraum noch Aufmerksamkeit braucht: alles außer Erledigtem.
export const isOpenEntry = (entry: QueueEntry): boolean =>
  entry.status !== 'übernommen' && entry.status !== 'abgelegt' && entry.status !== 'abgebrochen'

// Was an einem wartenden Eintrag steht: Erst mit dem Namen in der Ablage ist der Beleg gespeichert; davor wird er
// gerade hochgeladen oder wartet noch darauf (dann liegt er nur im Browser).
export const waitingLabel = (entry: Pick<QueueEntry, 'file' | 'storing'>): string =>
  (entry.file ? 'gespeichert, wartet …' : entry.storing ? 'wird gespeichert …' : 'wartet auf das Speichern …')
// Der Satz an einem abgebrochenen oder gescheiterten Eintrag, dessen Beleg in der Ablage liegt: Verloren ist nur die
// Auswertung. **Wo er liegt, sagt der Bestand der Seite** (`storedPlaces`), nicht die Erinnerung der Schlange: Ist der
// Beleg inzwischen gelöscht, zugeordnet, gebucht oder neu ausgewertet (dann steht er unter „Zu prüfen“), gibt es
// keinen Satz; ein vom Server schon als Zählerfoto erkanntes Bild steht im Ordner unter „Zählerfotos“.
export const STORED_NOTE = 'Der Beleg ist gespeichert und steht auf der Seite Belege im Eingang unter „Ohne Position“.'
export const STORED_PHOTO_NOTE = 'Das Foto ist gespeichert und steht auf der Seite Belege im Ordner unter „Zählerfotos“.'
export type StoredPlaces = { free: ReadonlySet<string>; photos: ReadonlySet<string> }
type StoredUpload = { file: string; kind?: string; bookedItemIds?: readonly string[]; assessment?: { open?: boolean } | null }
// `linked`: die Belege, auf die eine Kostenposition zeigt (`invoiceFile`)
export function storedPlaces(uploads: readonly StoredUpload[], linked: ReadonlySet<string>): StoredPlaces {
  const free = new Set<string>()
  const photos = new Set<string>()
  for (const u of uploads) {
    if (linked.has(u.file) || (u.bookedItemIds?.length ?? 0) > 0) continue
    if (u.kind === 'meterPhoto') photos.add(u.file)
    else if (!u.assessment?.open) free.add(u.file)
  }
  return { free, photos }
}
export function storedNote(entry: Pick<QueueEntry, 'status' | 'file'>, places: StoredPlaces): string {
  if ((entry.status !== 'abgebrochen' && entry.status !== 'fehler') || !entry.file) return ''
  return places.photos.has(entry.file) ? STORED_PHOTO_NOTE : places.free.has(entry.file) ? STORED_NOTE : ''
}

export const isBusy = (entry: QueueEntry): boolean => entry.status === 'wartend' || entry.status === 'läuft'
// Ein erkannter Zählerstand, der noch nicht übernommen ist: Er steht nur im Browser.
export const isOpenReading = (entry: QueueEntry): boolean => entry.status === 'fertig' && entry.result?.kind === 'zaehler'
// Erledigt: Was so steht, räumt das Verlassen der Seite aus der Anzeige (`sweep`).
const isDone = (entry: QueueEntry): boolean =>
  entry.status === 'übernommen' || entry.status === 'abgebrochen' || entry.status === 'abgelegt'

export class EvaluationQueue {
  private entries: readonly QueueEntry[] = []
  private listeners = new Set<() => void>()
  // Die Datei nur bis zu ihrer Auswertung: Liegt der Beleg danach im Belegordner, holt ein neuer Versuch ihn von dort.
  private files = new Map<number, File>()
  // Belege, die schon im Belegordner liegen (Posteingang): Name im Ordner je Eintrag
  private stored = new Map<number, string>()
  private edges = new Map<number, number>()
  private docTypes = new Map<number, 'rechnung'>()
  private nextId = 1
  // Abbruch je laufender Auswertung; der Server stoppt dann auch das Modell
  private aborts = new Map<number, AbortController>()
  // Der Grund eines gespeicherten Belegs während seines neuen Versuchs: Wird der abgebrochen, steht der Eintrag
  // wieder als „gespeichert“ mit diesem Grund da (Durchsicht #487).
  private kept = new Map<number, AiFailure>()
  // Neu abgelegte Dateien, die noch in die Ablage müssen, und der eine Upload, der gerade läuft. Nacheinander: Die
  // Reihenfolge der Ablage bleibt die der Belege (der Server benennt nach der Zeit), ein Handy schickt nie mehrere
  // große Fotos zugleich, und ein gescheiterter Upload betrifft nur seinen Beleg.
  private toStore = new Set<number>()
  private storing: { id: number; controller: AbortController } | null = null
  private closed = false

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot = (): readonly QueueEntry[] => this.entries

  // Läuft oder wartet etwas, oder steht ein erkannter Zählerstand noch nicht im Bestand? Dann fragt der Browser beim
  // Schließen des Tabs (App.tsx); beim Wechsel der Seite geht nichts davon verloren.
  unsaved = (): boolean => this.entries.some((x) => isBusy(x) || isOpenReading(x))

  private set(next: readonly QueueEntry[]) {
    this.entries = next
    for (const listener of this.listeners) listener()
    this.pump()
  }

  patch = (id: number, { data, ...rest }: QueuePatch): void => {
    if (!this.entries.some((x) => x.id === id)) return
    this.set(this.entries.map((x) => (x.id === id ? { ...x, ...rest, data: { ...x.data, ...data } } : x)))
  }

  private enqueue(list: { file: File; stored?: string }[], target: QueueTarget) {
    // Ein Beleg aus der Ablage wird neu ausgewertet: Was die Schlange zu ihm noch zeigt (abgebrochen, gescheitert),
    // ist damit erledigt, sonst stünde er zweimal da.
    for (const { stored } of list) if (stored) this.forgetFile(stored)
    const added: QueueEntry[] = []
    for (const { file, stored } of list) {
      const id = this.nextId++
      this.files.set(id, file)
      if (stored) this.stored.set(id, stored)
      else this.toStore.add(id)
      if (target.pageImageEdge !== undefined) this.edges.set(id, target.pageImageEdge)
      if (target.docType) this.docTypes.set(id, target.docType)
      added.push({ id, fileName: file.name, status: 'wartend', propertyId: target.propertyId, year: target.year, period: target.period, file: stored, data: {} })
    }
    if (added.length) this.set([...this.entries, ...added])
  }

  // Neue Dateien: nur PDF und Bilder. Ergibt, wie viele übergangen wurden; die Seite sagt es (SKIPPED_FILES).
  addFiles = (files: Iterable<File>, target: QueueTarget): number => {
    const { ok, skipped } = splitFiles(files)
    this.enqueue(ok.map((file) => ({ file })), target)
    return skipped
  }
  // Belege aus dem Belegordner: An den Server geht nur ihr Name, sonst lägen sie danach doppelt dort.
  addStored = (list: { file: File; stored: string }[], target: QueueTarget): void => this.enqueue(list, target)

  private forget(id: number) {
    this.toStore.delete(id)
    this.files.delete(id)
    this.stored.delete(id)
    this.edges.delete(id)
    this.docTypes.delete(id)
    this.kept.delete(id)
  }

  // Einen Eintrag aus der Liste nehmen. Ein wartender Beleg, der schon gespeichert ist, bleibt gespeichert: Sein
  // Eintrag steht dann als „abgebrochen“ da und sagt, wo der Beleg liegt (`storedNote`); erst ein zweites Entfernen
  // nimmt ihn aus der Liste. Wird er gerade hochgeladen, bricht der Upload ab (kam er beim Server schon an, liegt der
  // Beleg unter „Ohne Position“: lieber einer zu viel als einer verloren).
  remove = (id: number): void => {
    const entry = this.entries.find((x) => x.id === id)
    if (entry?.status === 'wartend' && entry.file && !this.kept.has(id)) {
      this.forget(id)
      this.set(this.entries.map((x) => (x.id === id ? { ...x, status: 'abgebrochen' } : x)))
      return
    }
    if (this.storing?.id === id) this.storing.controller.abort()
    this.forget(id)
    this.set(this.entries.filter((x) => x.id !== id))
  }
  cancel = (id: number): void => { this.aborts.get(id)?.abort() }
  // Ein Beleg ist gelöscht, zugeordnet oder samt Auswertung in ein anderes Objekt verschoben: Was die Schlange zu ihm
  // noch zeigt (gespeichert, ausgewertet, erkannt), ist erledigt und verschwindet, statt als „übernommen“ oder mit
  // „Erneut versuchen“ stehen zu bleiben (Durchsicht S3, S-A, S-D). Was gerade läuft oder wartet, bleibt.
  forgetFile = (file: string): void => {
    const gone = this.entries.filter((x) => !isBusy(x) && ((x.failure?.file ?? x.file ?? x.result?.file) === file))
    if (gone.length === 0) return
    for (const x of gone) this.forget(x.id)
    this.set(this.entries.filter((x) => !gone.includes(x)))
  }
  // Einen gespeicherten Eintrag aus der Liste nehmen: Der Beleg bleibt im Belegordner, der Browser vergisst die Datei.
  takeOff = (id: number): void => {
    this.forget(id)
    this.set(this.entries.map((x) => (x.id === id && x.status === 'gespeichert' ? { ...x, status: 'abgelegt' } : x)))
  }
  // Ein gespeicherter, nicht ausgewerteter Beleg noch einmal: Die Datei bleibt im Browser (ein PDF liest er vor der
  // Auswertung selbst), an den Server geht nur ihr Name im Belegordner.
  retry = (id: number): void => {
    const entry = this.entries.find((x) => x.id === id)
    if (!entry || entry.status !== 'gespeichert' || !this.stored.has(id)) return
    if (entry.failure) this.kept.set(id, entry.failure)
    this.set(this.entries.map((x) => (x.id === id ? { ...x, status: 'wartend', failure: undefined, error: undefined } : x)))
  }

  // Ein erkanntes Zählerfoto ist eine Rechnung: noch einmal auswerten, ohne nach der Belegart zu fragen. Der Beleg
  // liegt schon im Belegordner und geht nur mit seinem Namen an den Server, der ihn wieder als Beleg führt.
  asInvoice = (id: number): void => {
    const entry = this.entries.find((x) => x.id === id)
    if (!entry || !isOpenReading(entry) || !entry.result) return
    this.stored.set(id, entry.result.file)
    this.docTypes.set(id, 'rechnung')
    this.set(this.entries.map((x) => (x.id === id
      ? { ...x, status: 'wartend', result: undefined, exifDate: undefined, data: {}, error: undefined, failure: undefined }
      : x)))
  }

  // Erledigtes aus der Anzeige räumen (übernommen, abgebrochen, aus der Liste genommen), wenn man eine Seite verlässt.
  sweep = (): void => {
    const done = this.entries.filter(isDone)
    if (done.length === 0) return
    for (const x of done) this.forget(x.id)
    this.set(this.entries.filter((x) => !isDone(x)))
  }

  // Bricht alles ab, was läuft (nur beim Aushängen der ganzen Schlange, etwa am Ende eines Tests).
  // Wieder eingehängt (React hängt im Entwicklungsmodus jede Komponente einmal aus und wieder ein)
  open = (): void => {
    this.closed = false
    this.pump()
  }
  abortAll = (): void => {
    this.closed = true
    this.storing?.controller.abort()
    for (const controller of this.aborts.values()) controller.abort()
  }

  // Der nächste Beleg, der noch in die Ablage muss; unabhängig davon, ob gerade ausgewertet wird.
  private pumpStore() {
    if (this.storing) return
    const next = this.entries.find((x) => x.status === 'wartend' && this.toStore.has(x.id))
    const file = next && this.files.get(next.id)
    if (!next || !file) return
    // Eine leere Datei ist kein Beleg (ein abgebrochener Download, ein Scan ohne Inhalt): nicht speichern, sagen.
    if (file.size === 0) {
      this.toStore.delete(next.id)
      this.files.delete(next.id)
      this.patch(next.id, { status: 'fehler', error: `„${next.fileName}“ ist leer (0 Byte) und wurde nicht gespeichert.` })
      return
    }
    const controller = new AbortController()
    this.storing = { id: next.id, controller }
    this.patch(next.id, { storing: true })
    void this.store(next, file, controller)
  }

  private async store(entry: QueueEntry, file: File, controller: AbortController) {
    const id = entry.id
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (entry.propertyId) fd.append('propertyId', entry.propertyId)
      fd.append('year', String(entry.year))
      const res = await api<{ file: string }>('/api/upload', { method: 'POST', body: fd, signal: controller.signal })
      if (typeof res.file !== 'string' || res.file === '') throw new Error('Mietfuchs hat den Beleg nicht bestätigt.')
      this.storing = null
      // Währenddessen entfernt: Der Beleg liegt in der Ablage, einen Eintrag gibt es nicht mehr.
      if (!this.toStore.delete(id)) return
      this.stored.set(id, res.file)
      this.patch(id, { file: res.file, storing: false })
    } catch (e) {
      this.storing = null
      if (!this.toStore.delete(id)) return
      this.files.delete(id)
      // Der Satz zum Kontoauszug bleibt wörtlich, die Seite setzt den Knopf zur Seite Kontoauszug daneben.
      const text = errorText(e)
      this.patch(id, { status: 'fehler', storing: false, error: isBankFileError(text) ? text : `„${entry.fileName}“ wurde nicht hochgeladen: ${text}` })
    } finally {
      this.pump()
    }
  }

  private pump() {
    // Ausgehängt: Was noch wartet, beginnt nicht mehr (sonst startete der Abbruch des einen den nächsten).
    if (this.closed) return
    this.pumpStore()
    if (this.entries.some((x) => x.status === 'läuft')) return
    // Ausgewertet wird nur, was gespeichert ist; ein Beleg, der noch hochgeladen wird, kommt danach an die Reihe.
    const next = this.entries.find((x) => x.status === 'wartend' && !this.toStore.has(x.id))
    if (!next) return
    const file = this.files.get(next.id)
    if (!file && !this.stored.has(next.id)) {
      this.patch(next.id, { status: 'fehler', error: 'Die Datei ist nicht mehr da. Bitte laden Sie sie noch einmal hoch.' })
      return
    }
    const controller = new AbortController()
    this.aborts.set(next.id, controller)
    this.patch(next.id, { status: 'läuft', startedAt: Date.now(), progress: null })
    void this.run(next, file, controller)
  }

  private async run(entry: QueueEntry, given: File | undefined, controller: AbortController) {
    const id = entry.id
    // Ein neuer Versuch eines gespeicherten Belegs: bei Abbruch zurück zu „gespeichert“
    const before = this.kept.get(id)
    this.kept.delete(id)
    let kept = false
    try {
      const stored = this.stored.get(id)
      // Ein Beleg aus dem Belegordner ohne Datei im Browser (neuer Versuch): von dort holen, denn ein PDF liest der
      // Browser selbst und schickt Text oder Seitenbilder mit (pdfIntake.ts)
      const file = given ?? (stored ? await fetchStored(stored, entry.fileName, controller.signal) : null)
      if (!file) throw new Error('Die Datei ist nicht mehr da. Bitte laden Sie sie noch einmal hoch.')
      const fd = await buildUpload(file, undefined, this.edges.get(id))
      if (stored) {
        fd.delete('file')
        fd.append('existingFile', stored)
      }
      if (entry.propertyId) fd.append('propertyId', entry.propertyId)
      fd.append('year', String(entry.year))
      if (entry.period) fd.append('period', entry.period)
      const docType = this.docTypes.get(id)
      if (docType) fd.append('docType', docType)
      const res = await aiRequest<IntakeResult>('/api/intake', fd, {
        signal: controller.signal,
        onProgress: (progress) => this.patch(id, { progress }),
      })
      this.patch(id, await settle(res, file))
    } catch (e) {
      // Selbst abgebrochen ist kein Fehler
      if (controller.signal.aborted) {
        if (before) {
          kept = true
          this.patch(id, { status: 'gespeichert', failure: before })
        } else this.patch(id, { status: 'abgebrochen' })
      } else {
        const failure = failureOf(e)
        if (failure) {
          kept = true
          this.stored.set(id, failure.file)
          this.patch(id, { status: 'gespeichert', failure, file: failure.file })
        } else this.patch(id, { status: 'fehler', error: errorText(e) })
      }
    } finally {
      this.files.delete(id)
      if (!kept) this.stored.delete(id)
      this.aborts.delete(id)
      // Ein Eintrag, der während der Auswertung entfernt wurde, gibt den Platz frei.
      this.pump()
    }
  }
}

async function fetchStored(name: string, fileName: string, signal: AbortSignal): Promise<File> {
  const res = await appFetch(`/uploads/${encodeURIComponent(name)}`, { signal })
  if (!res.ok) throw new Error(`„${fileName}“ ließ sich nicht aus der Ablage der Belege holen (HTTP ${res.status}).`)
  const blob = await res.blob()
  return new File([blob], fileName, { type: blob.type })
}

const QueueCtx = createContext<EvaluationQueue | null>(null)

// Die eine Warteschlange der App. Sie bricht nur ab, wenn sie selbst ausgehängt wird.
export function EvaluationQueueProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(() => new EvaluationQueue())
  useEffect(() => { queue.open(); return () => queue.abortAll() }, [queue])
  return createElement(QueueCtx.Provider, { value: queue }, children)
}

// Die Schlange selbst, ohne bei jeder Änderung neu zu zeichnen (App.tsx fragt `busy` erst beim Schließen des Tabs).
export function useEvaluationQueueStore(): EvaluationQueue | null {
  return useContext(QueueCtx)
}

// Die Einträge und was sich mit ihnen tun lässt. Ohne Provider (Tests einzelner Seiten) hat die Seite eine eigene
// Schlange, die beim Aushängen abbricht, was läuft.
export function useEvaluationQueue() {
  const shared = useContext(QueueCtx)
  const [own] = useState(() => new EvaluationQueue())
  useEffect(() => { if (shared) return undefined; own.open(); return () => own.abortAll() }, [shared, own])
  const queue = shared ?? own
  const entries = useSyncExternalStore(queue.subscribe, queue.getSnapshot)
  return {
    queue: entries,
    addFiles: queue.addFiles,
    addStored: queue.addStored,
    patchEntry: queue.patch,
    remove: queue.remove,
    forgetFile: queue.forgetFile,
    cancel: queue.cancel,
    retry: queue.retry,
    takeOff: queue.takeOff,
    asInvoice: queue.asInvoice,
    sweep: queue.sweep,
  }
}
