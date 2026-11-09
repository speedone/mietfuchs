// @vitest-environment jsdom
// Die Anmeldung aus Sicht der Oberfläche (#528): Ein 401 der Vorschaltung meldet das Ereignis, `api()` wirft trotzdem
// weiter seinen Fehler, und kein Abruf der Oberfläche geht an `appFetch` vorbei.
import { afterEach, expect, test, vi } from 'vitest'
import { accessInfoOf, appFetch, demandOf, onAccessDemand, type AccessDemand } from './access'
import { api, ApiError } from './api'

afterEach(() => vi.unstubAllGlobals())

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('nur die Vorschaltung verlangt eine Anmeldung, ein falsches Passwort nicht', () => {
  expect(demandOf(401, { error: 'Bitte melden Sie sich an.', login: true })).toBe('login')
  expect(demandOf(401, { error: 'Bitte legen Sie zuerst ein Passwort für Mietfuchs fest.', setup: true })).toBe('setup')
  expect(demandOf(401, { error: 'Das Passwort stimmt nicht.' })).toBeNull()
  expect(demandOf(403, { login: true })).toBeNull()
  expect(demandOf(401, null)).toBeNull()
})

test('401 mit login löst das Ereignis aus, und api() wirft weiter ApiError mit dem Satz des Servers', async () => {
  vi.stubGlobal('fetch', reply(401, { error: 'Bitte melden Sie sich an.', login: true }))
  const seen: AccessDemand[] = []
  const off = onAccessDemand((d) => seen.push(d))
  const err = await api('/api/units').catch((e: unknown) => e)
  off()
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).message).toBe('Bitte melden Sie sich an.')
  expect((err as ApiError).status).toBe(401)
  expect(seen).toEqual(['login'])
})

test('401 mit setup meldet die Einrichtung; andere Antworten melden nichts', async () => {
  const seen: AccessDemand[] = []
  const off = onAccessDemand((d) => seen.push(d))
  vi.stubGlobal('fetch', reply(401, { error: 'x', setup: true }))
  await appFetch('/uploads/a.pdf')
  vi.stubGlobal('fetch', reply(401, { error: 'Das Passwort stimmt nicht.' }))
  const res = await appFetch('/api/auth/login', { method: 'POST' })
  // Der Rumpf bleibt für den Aufrufer lesbar
  expect(await res.json()).toEqual({ error: 'Das Passwort stimmt nicht.' })
  vi.stubGlobal('fetch', reply(200, []))
  await appFetch('/api/units')
  off()
  expect(seen).toEqual(['setup'])
})

test('der Zustand wird nur aus einer passenden Antwort gelesen', () => {
  expect(accessInfoOf([])).toBeNull()
  expect(accessInfoOf({ mode: 'irgendwas' })).toBeNull()
  expect(accessInfoOf({ mode: 'password', required: true, signedIn: false, window: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker' }))
    .toEqual({ mode: 'password', required: true, signedIn: false, window: false, device: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker' })
  expect(accessInfoOf({ mode: 'password', signedIn: true, device: true })?.device).toBe(true)
})

// Wächter: Ein roher `fetch(` ginge an der Anmeldung vorbei; die Seite bliebe dann stumm bei einem Fehler stehen.
const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./testing/**', '!./**/*.d.ts'], { query: '?raw', import: 'default', eager: true })
test('außerhalb von api.ts und access.ts ruft die Oberfläche fetch nicht selbst auf', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(100)
  const found = Object.entries(sources).filter(([file]) => file !== './api.ts' && file !== './access.ts').flatMap(([file, raw]) => {
    const src = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    return [...src.matchAll(/(?<![\w.])fetch\s*\(|window\.fetch\s*\(|globalThis\.fetch\s*\(/g)].map((m) => `${file}:${src.slice(0, m.index).split('\n').length}`)
  })
  expect(found).toEqual([])
  // Probe des Wächters
  expect('const r = await fetch(url)'.match(/(?<![\w.])fetch\s*\(/)).not.toBeNull()
  expect('await appFetch(url)'.match(/(?<![\w.])fetch\s*\(/)).toBeNull()
})
