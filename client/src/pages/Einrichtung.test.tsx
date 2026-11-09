// @vitest-environment jsdom
// Die Einrichtung (#528): ungleiche oder zu kurze Passwörter gehen nicht hinaus, „Ohne Passwort weiter“ fragt zurück,
// der Code aus der Adresse steht schon im Feld, im Programmfenster gibt es kein Codefeld.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccessInfo } from '../access'
import { UIProvider } from '../components/feedback'
import Einrichtung from './Einrichtung'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base: AccessInfo = { mode: 'setup', required: true, signedIn: false, window: false, device: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'binary', codeFile: '/home/v/mietfuchs/data/einrichtungscode.txt' }

function setup(info: AccessInfo = base, code = '', answer: { status: number; body: unknown } = { status: 200, body: { ok: true, mode: 'password' } }) {
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  })
  const onDone = vi.fn()
  render(<UIProvider><Einrichtung info={info} code={code} onDone={onDone} /></UIProvider>)
  return { calls, onDone }
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

test('der Satz des Entwurfs, Code aus der Adresse vorbelegt, wo er steht', () => {
  setup(base, 'K7QM-4XPA-9TRW')
  expect(document.body.textContent).toContain('Mietfuchs ist von anderen Geräten in Ihrem Netz erreichbar. Legen Sie ein Passwort fest, damit nur Sie Ihre Daten sehen.')
  expect((screen.getByLabelText('Einrichtungscode') as HTMLInputElement).value).toBe('K7QM-4XPA-9TRW')
  expect(document.body.textContent).toContain('Konsolenfenster')
  expect(document.body.textContent).toContain('/home/v/mietfuchs/data/einrichtungscode.txt')
  expect(screen.getByLabelText('Passwort wiederholen')).toBeTruthy()
})

test('zwei Felder ungleich: Satz, kein Abruf', async () => {
  const { calls } = setup(base, 'K7QM-4XPA-9TRW')
  type('Passwort', 'tisch-garten-wolke-ofen')
  type('Passwort wiederholen', 'tisch-garten-wolke-ofe')
  fireEvent.click(screen.getByRole('button', { name: 'Passwort festlegen' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Die beiden Passwörter stimmen nicht überein.')
  expect(calls).toEqual([])
})

test('zu kurz: Satz mit der Mindestlänge des Servers', async () => {
  const { calls } = setup({ ...base, minLength: 20 }, 'K7QM-4XPA-9TRW')
  type('Passwort', 'kurz-und-knapp')
  type('Passwort wiederholen', 'kurz-und-knapp')
  fireEvent.click(screen.getByRole('button', { name: 'Passwort festlegen' }))
  expect((await screen.findByRole('alert')).textContent).toContain('mindestens 20 Zeichen')
  expect(calls).toEqual([])
})

test('richtig: mit Code an den Server, danach weiter', async () => {
  const { calls, onDone } = setup(base, 'K7QM-4XPA-9TRW')
  type('Passwort', 'tisch-garten-wolke-ofen')
  type('Passwort wiederholen', 'tisch-garten-wolke-ofen')
  fireEvent.click(screen.getByRole('button', { name: 'Passwort festlegen' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(calls).toEqual([{ url: '/api/auth/setup', body: { code: 'K7QM-4XPA-9TRW', password: 'tisch-garten-wolke-ofen' } }])
})

test('der Vorschlag füllt beide Felder und steht lesbar da', () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Passwort vorschlagen' }))
  const a = (screen.getByLabelText('Passwort') as HTMLInputElement).value
  expect(a.split('-')).toHaveLength(4)
  expect((screen.getByLabelText('Passwort wiederholen') as HTMLInputElement).value).toBe(a)
  expect(screen.getByRole('status').textContent).toContain(a)
})

test('„Ohne Passwort weiter“ fragt zurück und schickt erst nach Bestätigung', async () => {
  const { calls, onDone } = setup(base, 'K7QM-4XPA-9TRW')
  fireEvent.click(screen.getByRole('button', { name: 'Ohne Passwort weiter …' }))
  const question = await screen.findByRole('alertdialog')
  expect(question.textContent).toContain('jedes Gerät in Ihrem Netz')
  expect(calls).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Ohne Passwort weiter' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(calls).toEqual([{ url: '/api/auth/setup', body: { code: 'K7QM-4XPA-9TRW', withoutPassword: true } }])
})

test('im Programmfenster ohne Codefeld und ohne Code im Rumpf', async () => {
  const { calls, onDone } = setup({ ...base, window: true })
  expect(screen.queryByLabelText('Einrichtungscode')).toBeNull()
  type('Passwort', 'tisch-garten-wolke-ofen')
  type('Passwort wiederholen', 'tisch-garten-wolke-ofen')
  fireEvent.click(screen.getByRole('button', { name: 'Passwort festlegen' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(calls).toEqual([{ url: '/api/auth/setup', body: { password: 'tisch-garten-wolke-ofen' } }])
})

const fill = () => {
  type('Passwort', 'tisch-garten-wolke-ofen')
  type('Passwort wiederholen', 'tisch-garten-wolke-ofen')
  fireEvent.click(screen.getByRole('button', { name: 'Passwort festlegen' }))
}

test('„Der Code stimmt nicht.“ steht am Codefeld', async () => {
  setup(base, 'FALS-CHER-CODE', { status: 400, body: { error: 'Der Code stimmt nicht.' } })
  fill()
  await waitFor(() => expect(screen.getByLabelText('Einrichtungscode').getAttribute('aria-invalid')).toBe('true'))
  expect((await screen.findByRole('alert')).textContent).toContain('Der Code stimmt nicht.')
})

test('409 (inzwischen anderswo festgelegt): Zustand neu lesen und den Satz als Mitteilung', async () => {
  const { onDone } = setup(base, 'K7QM-4XPA-9TRW', { status: 409, body: { error: 'Ein Passwort ist schon festgelegt. Ändern lässt es sich in den Einstellungen.' } })
  fill()
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(await screen.findAllByText('Ein Passwort ist schon festgelegt. Ändern lässt es sich in den Einstellungen.')).not.toHaveLength(0)
})
