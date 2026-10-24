// Vorschaubilder von Belegen der Reihe nach: höchstens zwei zugleich, erst wenn sie zu sehen sind.
//
// Vorher startete jedes Vorschaubild im Belegordner sofort ein eigenes pdf.js-Dokument mit eigenem
// Worker, auch weit unter dem sichtbaren Bereich. Mit ein paar hundert Belegen („Belege aller Jahre
// zeigen“) stürzte der Tab ab und der Rechner lief voll. Hier liegt nur die Logik, ohne pdf.js und
// ohne Browser, damit die Tests sie ohne echten Worker prüfen können (previewQueue.test.ts):
//
// - `createLimiter`: eine Warteschlange mit fester Zahl gleichzeitiger Aufträge. Ein Auftrag, dessen
//   Signal abbricht, bevor er dran ist, wird nie gestartet.
// - `createPreviewCache`: fasst gleiche Anfragen (dieselbe Datei) zu einem Auftrag zusammen und merkt
//   sich höchstens `maxEntries` fertige Ergebnisse (die ältesten zuerst vergessen). Ein Fehler wird
//   nicht gemerkt. Ziehen alle Anfragen eines Auftrags zurück, bevor er dran ist, fällt er weg; läuft er
//   schon, läuft er zu Ende und sein Ergebnis bleibt gemerkt.
// - `previewWhenVisible`: ein Vorschaubild auf der Seite. Sichtbar fragt es an, unsichtbar zieht es
//   die Anfrage zurück; ist das Ergebnis da, bleibt es.

export const PREVIEW_CONCURRENCY = 2

export function abortError(): Error {
  const err = new Error('Die Vorschau wird nicht mehr gebraucht.')
  err.name = 'AbortError'
  return err
}

export const isAbort = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError'

// Ein Auftrag, der sein Zeitlimit überschreitet, scheitert wie ein unlesbarer Beleg. Sonst belegte ein
// hängendes Dokument (oder ein Worker, der nach dem Start stirbt) seinen Platz für immer, und mit zwei solchen
// stünden Vorschauen, Belegkopien und Belegmappe still (Durchsicht von PR #449, K1).
export function timeoutError(): Error {
  const err = new Error('Der Beleg ließ sich nicht rechtzeitig darstellen.')
  err.name = 'TimeoutError'
  return err
}

export const isTimeout = (err: unknown): boolean => err instanceof Error && err.name === 'TimeoutError'

export type Limiter = {
  // `timeoutMs`: Zeitlimit ab dem Start des Auftrags. Danach ist der Platz frei, eine späte Antwort zählt nicht.
  run<T>(job: () => Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T>
  readonly running: number
  readonly waiting: number
}

// `onTimeout`: läuft, wenn ein Auftrag sein Zeitlimit überschreitet (pdfPreview.ts verwirft dann den Worker).
export function createLimiter(limit: number = PREVIEW_CONCURRENCY, { onTimeout }: { onTimeout?: () => void } = {}): Limiter {
  let running = 0
  type Waiting = { start: () => void; cancel: () => void; signal: AbortSignal | undefined }
  const queue: Waiting[] = []
  const next = () => {
    while (running < limit && queue.length > 0) {
      const w = queue.shift()
      if (!w) break
      w.signal?.removeEventListener('abort', w.cancel)
      w.start()
    }
  }
  return {
    run<T>(job: () => Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) { reject(abortError()); return }
        const entry: Waiting = {
          signal,
          start: () => {
            running++
            let over = false
            const finish = () => {
              if (over) return false
              over = true
              if (timer !== undefined) clearTimeout(timer)
              running--
              next()
              return true
            }
            const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
              if (!finish()) return
              reject(timeoutError())
              onTimeout?.()
            }, timeoutMs)
            Promise.resolve()
              .then(job)
              .then(
                (value) => { if (finish()) resolve(value) },
                (err: unknown) => { if (finish()) reject(err) },
              )
          },
          cancel: () => {
            const i = queue.indexOf(entry)
            if (i === -1) return
            queue.splice(i, 1)
            reject(abortError())
          },
        }
        signal?.addEventListener('abort', entry.cancel, { once: true })
        queue.push(entry)
        next()
      })
    },
    get running() { return running },
    get waiting() { return queue.length },
  }
}

export type PreviewCache<T> = {
  get(key: string, job: () => Promise<T>, signal?: AbortSignal): Promise<T>
  readonly size: number
}

export function createPreviewCache<T>(limiter: Limiter, maxEntries: number, { timeoutMs }: { timeoutMs?: number } = {}): PreviewCache<T> {
  const done = new Map<string, T>()
  type Pending = { promise: Promise<T>; controller: AbortController; users: number; started: boolean }
  const pending = new Map<string, Pending>()
  const remember = (key: string, value: T) => {
    done.delete(key)
    done.set(key, value)
    while (done.size > maxEntries) {
      const oldest = done.keys().next()
      if (oldest.done) break
      done.delete(oldest.value)
    }
  }
  return {
    get(key, job, signal) {
      if (done.has(key)) {
        const value = done.get(key) as T
        remember(key, value) // zuletzt gebraucht: rückt ans Ende
        return Promise.resolve(value)
      }
      if (signal?.aborted) return Promise.reject(abortError())
      let entry = pending.get(key)
      if (!entry) {
        const controller = new AbortController()
        const created: Pending = { promise: Promise.resolve() as unknown as Promise<T>, controller, users: 0, started: false }
        created.promise = limiter.run(() => { created.started = true; return job() }, controller.signal, timeoutMs).then(
          (value) => {
            if (pending.get(key) === created) pending.delete(key)
            remember(key, value)
            return value
          },
          (err: unknown) => {
            if (pending.get(key) === created) pending.delete(key)
            throw err
          },
        )
        // Die Ablehnung erreicht die Anfragenden über ihre eigenen Zusagen; diese hier bleibt still.
        created.promise.catch(() => {})
        pending.set(key, created)
        entry = created
      }
      const own = entry
      own.users++
      return new Promise<T>((resolve, reject) => {
        let settled = false
        const withdraw = () => {
          if (settled) return
          settled = true
          own.users--
          if (own.users === 0 && !own.started) {
            if (pending.get(key) === own) pending.delete(key)
            own.controller.abort()
          }
          reject(abortError())
        }
        signal?.addEventListener('abort', withdraw, { once: true })
        own.promise.then(
          (value) => { if (settled) return; settled = true; own.users--; signal?.removeEventListener('abort', withdraw); resolve(value) },
          (err: unknown) => { if (settled) return; settled = true; own.users--; signal?.removeEventListener('abort', withdraw); reject(err) },
        )
      })
    },
    get size() { return done.size },
  }
}

export type PreviewResult<T> = { ok: true; value: T } | { ok: false; error: unknown }

// Ein Vorschaubild auf der Seite: `visible(true)` fragt an, `visible(false)` zieht eine noch offene
// Anfrage zurück, `dispose()` beim Verlassen der Seite. `onResult` kommt höchstens einmal.
export function previewWhenVisible<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onResult: (result: PreviewResult<T>) => void,
): { visible: (isVisible: boolean) => void; dispose: () => void } {
  let current: AbortController | null = null
  let finished = false
  return {
    visible(isVisible) {
      if (finished) return
      if (isVisible && !current) {
        const c = new AbortController()
        current = c
        load(c.signal).then(
          (value) => {
            if (current !== c) return
            current = null
            finished = true
            onResult({ ok: true, value })
          },
          (error: unknown) => {
            if (current !== c) return
            current = null
            if (isAbort(error)) return
            finished = true
            onResult({ ok: false, error })
          },
        )
      } else if (!isVisible && current) {
        const c = current
        current = null
        c.abort()
      }
    },
    dispose() {
      finished = true
      const c = current
      current = null
      c?.abort()
    },
  }
}
