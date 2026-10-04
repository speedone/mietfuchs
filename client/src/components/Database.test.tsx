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
  screen.getByText(/mietfuchs\.sqlite\.vor-0001_objekte im Datenordner/)
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
