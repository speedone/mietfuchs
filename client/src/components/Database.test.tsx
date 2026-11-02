// @vitest-environment jsdom
// Der Hinweis zum Umstieg der Daten (#55). Wann er erscheint, prüft database.test.ts; hier geht
// es darum, dass er wirklich beim Server nachfragt, dass „Verstanden" ihn dauerhaft schließt
// und dass eine ausbleibende Antwort nichts kaputt macht.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DatabaseState } from '../types'
import { DISMISS_KEY, MIGRATION_GUIDE_URL, UPDATE_DISMISS_KEY } from '../database'
import DatabaseNotice from './Database'

const state = (changeover: DatabaseState['changeover']): DatabaseState => ({
  open: true, file: '/daten/mietfuchs.sqlite', migrations: 0, detail: 'geöffnet', changeover, migrated: null,
})

let report: { version?: string, database?: DatabaseState }
let failing = false
let asked: string[]
let posted: { url: string, body: unknown }[]

beforeEach(() => {
  asked = []
  posted = []
  failing = false
  report = { database: state({ state: 'done', message: 'Ihre Daten liegen jetzt in einer Datenbank.', notes: [] }) }
  localStorage.clear()
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    asked.push(String(url))
    if (failing) return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify(report), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('der gelungene Umstieg steht als ein Satz da und lässt sich schließen', async () => {
  report = {
    database: state({
      state: 'done',
      message: 'Ihre Daten liegen jetzt in einer Datenbank.',
      notes: ['Das Mietkonto rechnet ab jetzt mit der Vorauszahlung.'],
    }),
  }
  render(<DatabaseNotice />)
  await screen.findByText('Ihre Daten liegen jetzt in einer Datenbank.')
  expect(asked).toEqual(['/healthz'])
  // Auch der Hinweis auf die geänderte Zahl steht da: Der Nutzer muss davon erfahren.
  screen.getByText('Das Mietkonto rechnet ab jetzt mit der Vorauszahlung.')

  fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }))
  expect(screen.queryByText('Ihre Daten liegen jetzt in einer Datenbank.')).toBeNull()
  // Weggeklickt bleibt weggeklickt, auch nach dem nächsten Öffnen der Oberfläche.
  expect(localStorage.getItem(DISMISS_KEY)).toBe('Ihre Daten liegen jetzt in einer Datenbank.')
})

test('der gescheiterte Umstieg erklärt, wo die Daten sind und wie es weitergeht', async () => {
  // Der Wortlaut stammt aus changeover.ts. Seit die Routen die Datenbank lesen, sagt er nicht
  // mehr „Mietfuchs arbeitet weiter", denn das tut es nicht: Die Datenrouten sind gesperrt, bis
  // der Umstieg gelingt. Diese Meldung ist dann das Einzige, was der Vermieter zu sehen bekommt.
  report = {
    database: state({
      state: 'failed',
      message: 'Der Umstieg der Daten in die Datenbank ist nicht gelungen. Ihre Daten stehen ' +
        'unverändert in der Datei db.json, es geht nichts verloren. Bis der Umstieg gelingt, ' +
        'zeigt Mietfuchs sie allerdings nicht an; beim nächsten Start wird es erneut versucht.',
      notes: [],
    }),
  }
  render(<DatabaseNotice />)
  await screen.findByText(/es geht nichts verloren/)
  screen.getByRole('heading', { name: 'Der Umstieg der Daten ist nicht gelungen' })
})

test('gab es nichts zu übernehmen, steht auch nichts da', async () => {
  report = { database: state({ state: 'none', message: 'Es ist nichts zu übernehmen.', notes: [] }) }
  render(<DatabaseNotice />)
  await waitFor(() => expect(asked).toEqual(['/healthz']))
  expect(screen.queryByRole('status')).toBeNull()
})

test('ohne Antwort bleibt der Hinweis aus, statt einen Fehler zu zeigen', async () => {
  failing = true
  render(<DatabaseNotice />)
  await waitFor(() => expect(asked).toEqual(['/healthz']))
  expect(screen.queryByRole('status')).toBeNull()
})

test('eine alte db.json neben der gefüllten Datenbank erscheint als Hinweis, nicht als Fehler (#89)', async () => {
  report = { database: state({ state: 'stale', message: 'Die Datenbank enthält bereits Daten (Einstellungen); der Umstieg ist schon gelaufen.', notes: [] }) }
  const { container } = render(<DatabaseNotice />)
  await waitFor(() => screen.getByText('Im Datenordner liegt noch eine alte Datei'))
  expect(screen.getByText(/enthält bereits Daten/)).toBeTruthy()
  expect(container.querySelector('.db-notice-problem')).toBeNull()
})

test('nach einem Update steht die Sicherung da, mit Link zur Anleitung, und bleibt geschlossen (#154)', async () => {
  report = {
    version: '0.9.0',
    database: {
      ...state({ state: 'none', message: 'Es gibt noch keine db.json; es ist nichts zu übernehmen.', notes: [] }),
      migrations: 2,
      migrated: { steps: 2, backup: 'mietfuchs.sqlite.vor-0001_objekte', at: '2026-10-01T10:00:00.000Z' },
    },
  }
  const { unmount } = render(<DatabaseNotice />)
  await screen.findByText(/Mietfuchs wurde auf Version 0\.9\.0 aktualisiert/)
  screen.getByText(/Sie finden sie unter Verlauf/)
  const link = screen.getByRole('link', { name: /Anleitung/ })
  expect(link.getAttribute('href')).toBe(MIGRATION_GUIDE_URL)
  // Nur dieser eine Hinweis: Neben einem Umstieg, den es nicht gab, steht nichts.
  expect(screen.getAllByRole('status')).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }))
  expect(screen.queryByText(/aktualisiert/)).toBeNull()
  expect(localStorage.getItem(UPDATE_DISMISS_KEY)).toBe('mietfuchs.sqlite.vor-0001_objekte@2026-10-01T10:00:00.000Z')
  // Und der Server erfährt es (#180): Der Hinweis übersteht einen Neustart, bis er weggeklickt ist,
  // und soll danach auch in keinem anderen Browser wiederkommen.
  await waitFor(() => expect(posted).toEqual([
    { url: '/api/database/migrated/seen', body: { key: 'mietfuchs.sqlite.vor-0001_objekte@2026-10-01T10:00:00.000Z' } },
  ]))

  // Beim nächsten Öffnen der Oberfläche, solange derselbe Start läuft, kommt er nicht wieder.
  unmount()
  asked = []
  render(<DatabaseNotice />)
  await waitFor(() => expect(asked).toEqual(['/healthz']))
  expect(screen.queryByText(/aktualisiert/)).toBeNull()
})

test('ohne Zugriff auf den Speicher des Browsers erscheint der Hinweis trotzdem und lässt sich schließen', async () => {
  report = {
    database: { ...state({ state: 'none', message: '', notes: [] }), migrated: { steps: 1, backup: 'mietfuchs.sqlite.vor-0002_x', at: '2026-10-01T10:00:00.000Z' } },
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('gesperrt') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('gesperrt') })
  try {
    render(<DatabaseNotice />)
    await screen.findByText(/Mietfuchs wurde aktualisiert/)
    fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }))
    expect(screen.queryByText(/aktualisiert/)).toBeNull()
  } finally {
    vi.restoreAllMocks()
  }
})

// Druck (#415): Die Hinweise gehören zur Oberfläche, nicht aufs Papier. Gedruckt erzeugte „Sicherung vor dem Update
// angelegt“ vor der Abrechnung eine eigene leere Seite (nachgemessen im PDF der Seite Abrechnung).
test('beide Hinweise werden nicht gedruckt', async () => {
  const { unmount } = render(<DatabaseNotice />)
  const done = await screen.findByRole('status')
  expect(done.classList.contains('no-print')).toBe(true)
  unmount()
  report = {
    version: '0.9.0',
    database: { ...state({ state: 'none', message: '', notes: [] }), migrated: { steps: 2, backup: 'mietfuchs.sqlite.vor-0001_objekte', at: '2026-10-01T10:00:00.000Z' } },
  }
  render(<DatabaseNotice />)
  await screen.findByText(/Mietfuchs wurde auf Version 0\.9\.0 aktualisiert/)
  expect(screen.getByRole('status').classList.contains('no-print')).toBe(true)
})

test('ohne Datenbank steht der Grund da, obwohl der Zustandsbericht mit 503 antwortet', async () => {
  // /healthz antwortet dann zu Recht mit 503 (Container sollen den Fehler sehen); die Oberfläche las den Bericht
  // deshalb gar nicht und versprach in jeder Fehlermeldung einen Grund „im Cockpit“, der dort nie stand.
  const detail = 'Die Datenbank C:\\Users\\x\\Mietfuchs\\mietfuchs.sqlite stammt aus einer neueren Mietfuchs-Version.'
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    status: 'error',
    database: { open: false, file: 'C:\\Users\\x\\Mietfuchs\\mietfuchs.sqlite', migrations: 0, detail, changeover: { state: 'none', message: 'Ohne geöffnete Datenbank ist nichts zu übernehmen.', notes: [] }, migrated: null },
  }), { status: 503, headers: { 'content-type': 'application/json' } }))
  render(<DatabaseNotice />)
  await screen.findByText(detail)
  screen.getByRole('heading', { name: 'Mietfuchs kann Ihre Daten gerade nicht öffnen' })
  expect(screen.queryByRole('button', { name: 'Verstanden' })).toBeNull()
})

// Praxistest O: Der Grund stand doppelt (oben und als roter Kasten der Seite); App.tsx blendet die Seite aus, solange
// dieser Hinweis steht, und „Mietfuchs beenden“ steht hier statt nur in der Seitenleiste
test('ohne Datenbank: sagt es der App und trägt „Mietfuchs beenden“', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    status: 'error',
    database: { open: false, file: 'C:\\x\\mietfuchs.sqlite', migrations: 0, detail: 'Die Datenbank stammt aus einer neueren Mietfuchs-Version.', changeover: { state: 'none', message: '', notes: [] }, migrated: null },
  }), { status: 503, headers: { 'content-type': 'application/json' } }))
  const onClosed = vi.fn()
  render(<DatabaseNotice onClosed={onClosed} quit={<button type="button">Mietfuchs beenden</button>} />)
  await screen.findByText('Die Datenbank stammt aus einer neueren Mietfuchs-Version.')
  const box = screen.getByRole('heading', { name: 'Mietfuchs kann Ihre Daten gerade nicht öffnen' }).closest('section') as HTMLElement
  expect(box.querySelector('button')?.textContent).toBe('Mietfuchs beenden')
  await waitFor(() => expect(onClosed).toHaveBeenCalledWith(true))
})

test('mit Datenbank: kein „Mietfuchs beenden“ im Hinweis, und die App erfährt, dass alles offen ist', async () => {
  const onClosed = vi.fn()
  render(<DatabaseNotice onClosed={onClosed} quit={<button type="button">Mietfuchs beenden</button>} />)
  await screen.findByText('Ihre Daten liegen jetzt in einer Datenbank.')
  expect(screen.queryByRole('button', { name: 'Mietfuchs beenden' })).toBeNull()
  await waitFor(() => expect(onClosed).toHaveBeenCalledWith(false))
})

// Praxistest N-01-390: Am Handy steht „Verstanden“ unter dem Text, nicht daneben
test('am Handy steht „Verstanden“ unter dem Text', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 899px)', addEventListener: () => {}, removeEventListener: () => {} }))
  report = {
    version: '0.15.0',
    database: { ...state({ state: 'none', message: '', notes: [] }), migrated: { steps: 2, backup: 'mietfuchs.sqlite.vor-0001_objekte', at: '2026-10-01T10:00:00.000Z' } },
  }
  render(<DatabaseNotice />)
  await screen.findByText(/Sie finden sie unter Verlauf/)
  expect(screen.getByRole('button', { name: 'Verstanden' }).closest('.db-notice-body')).toBeTruthy()
})

// Durchsicht vor 0.15.0 (Daten, 6): Ohne Datenbank laden die Einstellungen nicht, und die Meldung rät zum Backup. Der
// Weg dorthin steht deshalb im Hinweis selbst. Die Datei, die sich nicht öffnen ließ, legt der Server beim Einspielen
// als mietfuchs.sqlite.vor-restore beiseite (restoreDatabase), es geht also nichts verloren.
test('ohne Datenbank: ein Backup lässt sich direkt im Hinweis einspielen', async () => {
  const posted: { url: string, body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url: String(url), body: init.body })
      return new Response('{"notes":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      status: 'error',
      database: { open: false, file: 'C:\\x\\mietfuchs.sqlite', migrations: 0, detail: 'Die Datenbank ist beschädigt.', changeover: { state: 'none', message: '', notes: [] }, migrated: null },
    }), { status: 503, headers: { 'content-type': 'application/json' } })
  })
  const reloadPage = vi.fn()
  render(<DatabaseNotice reloadPage={reloadPage} />)
  await screen.findByText('Die Datenbank ist beschädigt.')
  const box = screen.getByRole('heading', { name: 'Mietfuchs kann Ihre Daten gerade nicht öffnen' }).closest('section') as HTMLElement
  expect(box.textContent).toMatch(/bleibt daneben erhalten/)
  const input = screen.getByLabelText('Backup einspielen …') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['zip'], 'mietfuchs-backup.zip', { type: 'application/zip' })] } })
  await waitFor(() => expect(reloadPage).toHaveBeenCalled())
  expect(posted.map((p) => p.url)).toEqual(['/api/restore'])
  expect(posted[0]?.body).toBeInstanceOf(FormData)
})

test('ohne Datenbank: scheitert das Einspielen, steht der Grund im Hinweis; Hinweise des Servers vor dem Neuladen', async () => {
  let answer: Response = new Response('{"error":"Die Datei ist kein Mietfuchs-Backup."}', { status: 400, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return answer
    return new Response(JSON.stringify({
      status: 'error',
      database: { open: false, file: 'C:\\x\\mietfuchs.sqlite', migrations: 0, detail: 'Die Datenbank ist beschädigt.', changeover: { state: 'none', message: '', notes: [] }, migrated: null },
    }), { status: 503, headers: { 'content-type': 'application/json' } })
  })
  const reloadPage = vi.fn()
  render(<DatabaseNotice reloadPage={reloadPage} />)
  await screen.findByText('Die Datenbank ist beschädigt.')
  const input = screen.getByLabelText('Backup einspielen …') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'], 'falsch.zip', { type: 'application/zip' })] } })
  expect((await screen.findByText('Das Backup ließ sich nicht einspielen')).closest('.notice-item')?.textContent).toContain('Die Datei ist kein Mietfuchs-Backup.')
  expect(reloadPage).not.toHaveBeenCalled()

  answer = new Response('{"notes":["Zwei Belege fehlten im Backup."]}', { status: 200, headers: { 'content-type': 'application/json' } })
  fireEvent.change(input, { target: { files: [new File(['zip'], 'mietfuchs-backup.zip', { type: 'application/zip' })] } })
  await screen.findByText('Zwei Belege fehlten im Backup.')
  expect(screen.queryByText('Das Backup ließ sich nicht einspielen')).toBeNull()
  expect(reloadPage).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Mietfuchs neu laden' }))
  expect(reloadPage).toHaveBeenCalled()
})
