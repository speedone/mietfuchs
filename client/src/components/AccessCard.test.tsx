// @vitest-environment jsdom
// Karte „Anmeldung“ in den Einstellungen (#528): Passwort ändern verlangt das bisherige, „Anmeldung ausschalten“ fragt
// zurück, bei NKA_AUTH nur Anzeige des Schalters, im Übergang der Satz zu Version 1.0.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AccessContext, type AccessInfo } from '../access'
import { UIProvider } from './feedback'
import AccessCard from './AccessCard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base: AccessInfo = { mode: 'password', required: true, signedIn: true, window: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker' }

function setup(info: AccessInfo = base, setupCode = '', answer: { status: number; body: unknown } = { status: 200, body: { ok: true } }) {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  })
  const reload = vi.fn(async () => {})
  const clearSetupCode = vi.fn()
  render(<UIProvider><AccessContext.Provider value={{ info, reload, setupCode, clearSetupCode }}><AccessCard /></AccessContext.Provider></UIProvider>)
  return { calls, reload, clearSetupCode }
}
const drawer = () => screen.getByRole('dialog')
const type = (label: string, value: string) => fireEvent.change(within(drawer()).getByLabelText(label), { target: { value } })

test('lokal ohne Passwort keine Karte', () => {
  setup({ ...base, mode: 'none', reachable: 'local', required: false, signedIn: false })
  expect(screen.queryByRole('heading', { name: 'Anmeldung' })).toBeNull()
})

test('Passwort ändern verlangt das bisherige', async () => {
  const { calls, reload } = setup()
  expect(screen.getByRole('heading', { name: 'Anmeldung' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Passwort ändern' }))
  type('Neues Passwort', 'tisch-garten-wolke-ofen')
  type('Neues Passwort wiederholen', 'tisch-garten-wolke-ofen')
  fireEvent.click(within(drawer()).getByRole('button', { name: 'Speichern' }))
  expect((await within(drawer()).findByRole('alert')).textContent).toContain('Bitte geben Sie Ihr bisheriges Passwort ein.')
  expect(calls).toEqual([])
  type('Bisheriges Passwort', 'das-alte-passwort-hier')
  fireEvent.click(within(drawer()).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(reload).toHaveBeenCalled())
  expect(calls).toEqual([{ url: '/api/auth/password', method: 'PUT', body: { current: 'das-alte-passwort-hier', password: 'tisch-garten-wolke-ofen' } }])
})

test('im Fenster ohne bisheriges Passwort', async () => {
  const { calls } = setup({ ...base, window: true })
  fireEvent.click(screen.getByRole('button', { name: 'Auf allen Geräten abmelden' }))
  expect(within(drawer()).queryByLabelText('Bisheriges Passwort')).toBeNull()
  fireEvent.click(within(drawer()).getByRole('button', { name: 'Abmelden' }))
  await waitFor(() => expect(calls).toEqual([{ url: '/api/auth/logout-all', method: 'POST', body: {} }]))
})

test('„Anmeldung ausschalten“ fragt mit Warnung zurück', async () => {
  const { calls, reload } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Anmeldung ausschalten …' }))
  type('Bisheriges Passwort', 'das-alte-passwort-hier')
  fireEvent.click(within(drawer()).getByRole('button', { name: 'Ausschalten' }))
  const question = await screen.findByRole('alertdialog')
  expect(question.textContent).toContain('jedes Gerät in Ihrem Netz')
  expect(calls).toEqual([])
  fireEvent.click(within(question).getByRole('button', { name: 'Ausschalten' }))
  await waitFor(() => expect(reload).toHaveBeenCalled())
  expect(calls).toEqual([{ url: '/api/auth/off', method: 'POST', body: { current: 'das-alte-passwort-hier' } }])
})

test('bei NKA_AUTH: der Satz zur Umgebung, kein Ausschalten', () => {
  setup({ ...base, envFixed: true })
  expect(document.body.textContent).toContain('Von der Umgebung festgelegt (NKA_AUTH)')
  expect(screen.queryByRole('button', { name: 'Anmeldung ausschalten …' })).toBeNull()
})

test('NKA_AUTH=off im Netz: nur Anzeige', () => {
  setup({ ...base, mode: 'none', envFixed: true, required: false, signedIn: false })
  expect(document.body.textContent).toContain('Von der Umgebung festgelegt (NKA_AUTH)')
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})

test('im Übergang: Satz zu Version 1.0, Passwort festlegen mit Code aus der Adresse, ohne Passwort weiter mit Rückfrage', async () => {
  const { calls, clearSetupCode } = setup({ ...base, mode: 'transition', required: false, signedIn: false, codeFileName: 'einrichtungscode.txt' }, 'K7QM-4XPA-9TRW')
  expect(document.body.textContent).toContain('Ab Version 1.0 verlangt Mietfuchs hier ein Passwort.')
  expect(screen.queryByRole('button', { name: 'Passwort ändern' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Passwort festlegen' }))
  expect((within(drawer()).getByLabelText('Einrichtungscode') as HTMLInputElement).value).toBe('K7QM-4XPA-9TRW')
  fireEvent.click(within(drawer()).getByRole('button', { name: 'Ohne Passwort weiter …' }))
  const question = await screen.findByRole('alertdialog')
  fireEvent.click(within(question).getByRole('button', { name: 'Ohne Passwort weiter' }))
  await waitFor(() => expect(calls).toEqual([{ url: '/api/auth/setup', method: 'POST', body: { code: 'K7QM-4XPA-9TRW', withoutPassword: true } }]))
  // Der Server gibt danach einen neuen Code aus; der aus der Adresse gilt nicht mehr
  await waitFor(() => expect(clearSetupCode).toHaveBeenCalled())
})

test('„Das bisherige Passwort stimmt nicht.“ steht am Feld', async () => {
  setup(base, '', { status: 403, body: { error: 'Das bisherige Passwort stimmt nicht.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Auf allen Geräten abmelden' }))
  type('Bisheriges Passwort', 'falsch-falsch-falsch')
  fireEvent.click(within(drawer()).getByRole('button', { name: 'Abmelden' }))
  await waitFor(() => expect(within(drawer()).getByLabelText('Bisheriges Passwort').getAttribute('aria-invalid')).toBe('true'))
})

test('409: Fenster zu, Zustand neu lesen, der Satz als Mitteilung', async () => {
  const { reload } = setup({ ...base, mode: 'off', required: false, signedIn: false }, '', { status: 409, body: { error: 'Ein Passwort ist schon festgelegt. Ändern lässt es sich in den Einstellungen.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Passwort festlegen' }))
  type('Einrichtungscode', 'K7QM-4XPA-9TRW')
  type('Passwort', 'tisch-garten-wolke-ofen')
  type('Passwort wiederholen', 'tisch-garten-wolke-ofen')
  fireEvent.click(within(drawer()).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(reload).toHaveBeenCalled())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(await screen.findAllByText('Ein Passwort ist schon festgelegt. Ändern lässt es sich in den Einstellungen.')).not.toHaveLength(0)
})
