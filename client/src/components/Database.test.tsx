// @vitest-environment jsdom
// Der Hinweis zum Umstieg der Daten (#55). Wann er erscheint, prüft database.test.ts; hier geht
// es darum, dass er wirklich beim Server nachfragt, dass „Verstanden" ihn dauerhaft schließt
// und dass eine ausbleibende Antwort nichts kaputt macht.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DatabaseState } from '../types'
import { DISMISS_KEY } from '../database'
import DatabaseNotice from './Database'

const state = (changeover: DatabaseState['changeover']): DatabaseState => ({
  open: true, file: '/daten/mietfuchs.sqlite', migrations: 0, detail: 'geöffnet', changeover,
})

let report: { database?: DatabaseState }
let failing = false
let asked: string[]

beforeEach(() => {
  asked = []
  failing = false
  report = { database: state({ state: 'done', message: 'Ihre Daten liegen jetzt in einer Datenbank.', notes: [] }) }
  localStorage.clear()
  vi.stubGlobal('fetch', async (url: string) => {
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
