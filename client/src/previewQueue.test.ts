// Warteschlange und Sichtbarkeit der Vorschaubilder ohne pdf.js: Mit vielen Belegen startete vorher jede
// Vorschau sofort einen eigenen Worker, der Tab stürzte ab (Bericht der Leistungsprüfung, Befund 1).
import { describe, expect, test } from 'vitest'
import { createLimiter, createPreviewCache, isAbort, previewWhenVisible, type PreviewResult } from './previewQueue'

// Ein Auftrag, der erst endet, wenn der Test es sagt
function gate<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Warteschlange', () => {
  test('höchstens zwei Aufträge zugleich, der Rest wartet der Reihe nach', async () => {
    const limiter = createLimiter(2)
    const gates = Array.from({ length: 5 }, () => gate<number>())
    const started: number[] = []
    const results = gates.map((g, i) => limiter.run(() => { started.push(i); return g.promise }))
    const firstFailure = results[0]?.catch((e: unknown) => e)
    await flush()
    expect(started).toEqual([0, 1])
    expect(limiter.running).toBe(2)
    expect(limiter.waiting).toBe(3)
    gates[1]?.resolve(1)
    await flush()
    expect(started).toEqual([0, 1, 2])
    gates[0]?.reject(new Error('kaputt'))
    await flush()
    expect(started).toEqual([0, 1, 2, 3])
    gates[2]?.resolve(2)
    gates[3]?.resolve(3)
    await flush()
    gates[4]?.resolve(4)
    expect(await firstFailure).toEqual(new Error('kaputt'))
    expect(await Promise.all(results.slice(1))).toEqual([1, 2, 3, 4])
    expect(limiter.running).toBe(0)
  })

  test('ein Auftrag, der vor seinem Start zurückgezogen wird, läuft nie', async () => {
    const limiter = createLimiter(1)
    const first = gate<string>()
    const started: string[] = []
    void limiter.run(() => { started.push('a'); return first.promise })
    const c = new AbortController()
    const b = limiter.run(() => { started.push('b'); return Promise.resolve('b') }, c.signal)
    c.abort()
    await expect(b).rejects.toSatisfy(isAbort)
    first.resolve('a')
    await flush()
    expect(started).toEqual(['a'])
    expect(limiter.waiting).toBe(0)
  })

  test('ein schon abgebrochenes Signal startet nichts', async () => {
    const limiter = createLimiter(2)
    const c = new AbortController()
    c.abort()
    let ran = false
    await expect(limiter.run(async () => { ran = true }, c.signal)).rejects.toSatisfy(isAbort)
    expect(ran).toBe(false)
  })
})

describe('Zwischenspeicher', () => {
  test('gleiche Datei: ein Auftrag für alle Anfragen, danach aus dem Speicher', async () => {
    const cache = createPreviewCache<string>(createLimiter(2), 10)
    let runs = 0
    const job = async () => { runs++; return 'bild' }
    expect(await Promise.all([cache.get('a.pdf', job), cache.get('a.pdf', job)])).toEqual(['bild', 'bild'])
    expect(await cache.get('a.pdf', job)).toBe('bild')
    expect(runs).toBe(1)
  })

  test('begrenzt: die am längsten nicht gebrauchten fallen heraus', async () => {
    const cache = createPreviewCache<string>(createLimiter(2), 2)
    const runs: string[] = []
    const job = (k: string) => async () => { runs.push(k); return k }
    await cache.get('a', job('a'))
    await cache.get('b', job('b'))
    await cache.get('a', job('a')) // a ist wieder frisch
    await cache.get('c', job('c')) // b fällt heraus
    expect(cache.size).toBe(2)
    await cache.get('a', job('a'))
    await cache.get('b', job('b'))
    expect(runs).toEqual(['a', 'b', 'c', 'b'])
  })

  test('ein Fehler wird nicht gemerkt', async () => {
    const cache = createPreviewCache<string>(createLimiter(2), 10)
    let n = 0
    const job = async () => { n++; if (n === 1) throw new Error('kaputt'); return 'bild' }
    await expect(cache.get('a', job)).rejects.toThrow('kaputt')
    expect(await cache.get('a', job)).toBe('bild')
  })

  test('ziehen alle Anfragen vor dem Start zurück, fällt der Auftrag weg; eine bleibt, läuft er', async () => {
    const limiter = createLimiter(1)
    const cache = createPreviewCache<string>(limiter, 10)
    const blocker = gate<string>()
    void cache.get('vorne', () => blocker.promise)
    const started: string[] = []
    const one = new AbortController()
    const two = new AbortController()
    const a1 = cache.get('a', async () => { started.push('a'); return 'A' }, one.signal)
    const a2 = cache.get('a', async () => { started.push('a2'); return 'A2' }, two.signal)
    one.abort()
    await expect(a1).rejects.toSatisfy(isAbort)
    const b = new AbortController()
    const b1 = cache.get('b', async () => { started.push('b'); return 'B' }, b.signal)
    b.abort()
    await expect(b1).rejects.toSatisfy(isAbort)
    blocker.resolve('V')
    expect(await a2).toBe('A')
    expect(started).toEqual(['a'])
    expect(limiter.waiting).toBe(0)
  })

  test('ein laufender Auftrag läuft zu Ende, auch wenn niemand mehr wartet, und bleibt gemerkt', async () => {
    const cache = createPreviewCache<string>(createLimiter(2), 10)
    const g = gate<string>()
    let runs = 0
    const c = new AbortController()
    const p = cache.get('a', () => { runs++; return g.promise }, c.signal)
    await flush()
    c.abort()
    await expect(p).rejects.toSatisfy(isAbort)
    g.resolve('A')
    await flush()
    expect(await cache.get('a', async () => { runs++; return 'neu' })).toBe('A')
    expect(runs).toBe(1)
  })
})

describe('Sichtbarkeit', () => {
  // Ein Bild, das erst im Bild angefragt wird, über eine Warteschlange mit einem Platz
  function setup() {
    const limiter = createLimiter(1)
    const cache = createPreviewCache<string>(limiter, 10)
    const started: string[] = []
    const gates = new Map<string, ReturnType<typeof gate<string>>>()
    const results: Record<string, PreviewResult<string>[]> = {}
    const thumb = (file: string) => previewWhenVisible(
      (signal) => cache.get(file, () => { started.push(file); const g = gate<string>(); gates.set(file, g); return g.promise }, signal),
      (r) => { (results[file] ??= []).push(r) },
    )
    return { limiter, started, gates, results, thumb }
  }

  test('nicht sichtbar: nichts wird gerendert', async () => {
    const { started, thumb } = setup()
    thumb('a.pdf')
    thumb('b.pdf').visible(false)
    await flush()
    expect(started).toEqual([])
  })

  test('aus dem Bild gescrollt, bevor es dran war: wird nicht gerendert', async () => {
    const { started, gates, results, thumb } = setup()
    const a = thumb('a.pdf')
    const b = thumb('b.pdf')
    const c = thumb('c.pdf')
    a.visible(true)
    b.visible(true)
    c.visible(true)
    await flush()
    expect(started).toEqual(['a.pdf'])
    b.visible(false) // vorbeigescrollt
    gates.get('a.pdf')?.resolve('A')
    await flush()
    expect(started).toEqual(['a.pdf', 'c.pdf'])
    expect(results['a.pdf']).toEqual([{ ok: true, value: 'A' }])
    expect(results['b.pdf']).toBeUndefined()
    // Wieder im Bild: jetzt kommt es dran
    b.visible(true)
    gates.get('c.pdf')?.resolve('C')
    await flush()
    expect(started).toEqual(['a.pdf', 'c.pdf', 'b.pdf'])
  })

  test('ein Fehler kommt einmal an, danach fragt das Bild nicht erneut', async () => {
    const { started, gates, results, thumb } = setup()
    const a = thumb('a.pdf')
    a.visible(true)
    await flush()
    gates.get('a.pdf')?.reject(new Error('beschädigt'))
    await flush()
    a.visible(false)
    a.visible(true)
    await flush()
    expect(started).toEqual(['a.pdf'])
    expect(results['a.pdf']?.map((r) => r.ok)).toEqual([false])
  })

  test('verlassen: die offene Anfrage wird zurückgezogen', async () => {
    const { started, gates, thumb, limiter } = setup()
    thumb('a.pdf').visible(true)
    const b = thumb('b.pdf')
    b.visible(true)
    b.dispose()
    gates.get('a.pdf')?.resolve('A')
    await flush()
    expect(started).toEqual(['a.pdf'])
    expect(limiter.waiting).toBe(0)
  })
})
