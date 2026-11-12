// @vitest-environment jsdom
// Das Seitenfenster „Kaution“ (#228): Buchungen und Stand, das Feld Zweck nur bei einer Verrechnung, Anlegen und
// Löschen über die Routen, die Ablehnung des Servers am Formular.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import DepositDrawer from './DepositDrawer'
import { UIProvider } from './feedback'
import type { DepositEntry, DepositStatementInfo, Tenancy } from '../types'

const TENANCY: Tenancy = {
  id: 't', unitId: 'u', tenantName: 'Erika Mustermann', persons: 1, personHistory: [], start: '2025-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2025-01', monthlyCents: 80000 }], depositCents: 240000, depositForm: 'pledged',
}
const ENTRIES: DepositEntry[] = [
  { id: 'a', tenancyId: 't', date: '2025-01-05', kind: 'received', amountCents: 160000, note: 'erste Rate' },
  { id: 'b', tenancyId: 't', date: '2025-06-01', kind: 'applied', purpose: 'damage', amountCents: 10000 },
]

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let reply: { status: number; body: unknown }
beforeEach(() => {
  sent = []
  reply = { status: 200, body: { ok: true } }
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function open(entries: DepositEntry[] = ENTRIES) {
  const onChanged = vi.fn()
  const onClose = vi.fn()
  render(<UIProvider><DepositDrawer tenancy={TENANCY} entries={entries} onChanged={onChanged} onClose={onClose} /></UIProvider>)
  return { onChanged, onClose, drawer: screen.getByRole('dialog', { name: 'Kaution von Erika Mustermann' }) }
}
const select = (label: string): HTMLSelectElement => {
  const el = screen.getByLabelText(label)
  if (!(el instanceof HTMLSelectElement)) throw new Error(`${label} ist keine Auswahl`)
  return el
}

test('zeigt Buchungen und Stand', () => {
  const { drawer } = open()
  expect(within(drawer).getByText(/^Vereinbart 2\.400,00\s€, eingegangen 1\.600,00\s€, bei Ihnen liegen 1\.500,00\s€\.$/)).toBeTruthy()
  const rows = within(drawer).getAllByRole('row').slice(1).map((r) => (r.textContent ?? '').replace(/\u00a0/g, ' '))
  expect(rows[0]).toContain('05.01.2025')
  expect(rows[0]).toContain('Eingang')
  expect(rows[0]).toContain('1.600,00 €')
  expect(rows[0]).toContain('erste Rate')
  expect(rows[1]).toContain('Verrechnung (Schaden)')
  expect(rows[1]).toContain('-100,00 €')
  // Die Form der Sicherheit steuert nur einen Satz.
  expect(within(drawer).getByText(/Bei dieser Form fließt kein Geld an Sie/)).toBeTruthy()
})

test('ohne Buchung gilt der Stand aus den Stammdaten, eine Tabelle gibt es nicht', () => {
  const { drawer } = open([])
  expect(within(drawer).getByText(/Noch keine Kautionsbuchung/)).toBeTruthy()
  expect(within(drawer).queryByRole('table')).toBeNull()
})

test('das Feld Zweck erscheint nur bei Verrechnung, sein angezeigter Wert ist der gesendete', async () => {
  open()
  expect(screen.queryByLabelText('Verrechnet mit')).toBeNull()
  expect(select('Art').value).toBe('received')
  fireEvent.change(select('Art'), { target: { value: 'applied' } })
  const purpose = select('Verrechnet mit')
  // Vorbelegt mit der ersten Option, und genau die wird gesendet.
  expect(purpose.value).toBe('rent')
  expect([...purpose.options].map((o) => o.value)).toEqual(['rent', 'settlement', 'damage', 'other'])
  fireEvent.change(purpose, { target: { value: 'damage' } })
  expect(select('Verrechnet mit').value).toBe('damage')
  fireEvent.change(screen.getByLabelText(/^Betrag/), { target: { value: '50,00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(sent.at(-1)?.method).toBe('POST'))
  expect(sent.at(-1)?.body).toMatchObject({ tenancyId: 't', kind: 'applied', purpose: 'damage', amountCents: 5000 })
})

test('Anlegen ruft POST, meldet die Änderung und leert das Formular', async () => {
  const { onChanged } = open()
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2025-02-01' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/), { target: { value: '800' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(sent.at(-1)).toMatchObject({ url: '/api/deposit-entries', method: 'POST', body: { tenancyId: 't', date: '2025-02-01', kind: 'received', amountCents: 80000 } })
  const amount = screen.getByLabelText(/^Betrag/)
  expect(amount instanceof HTMLInputElement && amount.value).toBe('')
})

test('ohne Betrag wird nichts gesendet, die Meldung steht am Feld', async () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  expect(await screen.findAllByText(/Kein Betrag|Geben Sie den Betrag/)).not.toHaveLength(0)
  expect(sent).toEqual([])
})

test('die Ablehnung des Servers steht am Formular', async () => {
  const { onChanged } = open()
  reply = { status: 400, body: { error: 'Mehr als die Kaution hergibt: Am 01.02.2025 lägen -1.000,00 € bei Ihnen.' } }
  fireEvent.change(select('Art'), { target: { value: 'refunded' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/), { target: { value: '9000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  expect(await screen.findByText('Mehr als die Kaution hergibt: Am 01.02.2025 lägen -1.000,00 € bei Ihnen.')).toBeTruthy()
  expect(onChanged).not.toHaveBeenCalled()
})

test('Löschen fragt nach und ruft dann DELETE', async () => {
  const { onChanged, drawer } = open()
  fireEvent.click(within(drawer).getAllByRole('button', { name: 'Löschen …' })[0] ?? drawer)
  expect(sent).toEqual([])
  const question = await screen.findByRole('alertdialog')
  fireEvent.click(within(question).getByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(sent.at(-1)).toMatchObject({ url: '/api/deposit-entries/a', method: 'DELETE' })
})

test('die Buchungen stehen nach Datum, eine nachgetragene alte Rate oben', () => {
  const late: DepositEntry = { id: 'c', tenancyId: 't', date: '2024-12-20', kind: 'received', amountCents: 80000 }
  const { drawer } = open([...ENTRIES, late])
  const dates = within(drawer).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent)
  expect(dates).toEqual(['20.12.2024', '05.01.2025', '01.06.2025'])
})

test('nach dem Anlegen mit altem Datum schließt das Fenster ohne Rückfrage', async () => {
  const { onChanged, onClose } = open()
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2024-02-01' } })
  fireEvent.change(screen.getByLabelText(/^Betrag/), { target: { value: '800' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  // Das Datum bleibt für die nächste Rate stehen; offen ist trotzdem nichts.
  const date = screen.getByLabelText('Datum')
  expect(date instanceof HTMLInputElement && date.value).toBe('2024-02-01')
  const footerClose = screen.getAllByRole('button', { name: 'Schließen' }).find((b) => b.textContent === 'Schließen')
  if (!footerClose) throw new Error('kein Knopf „Schließen“ im Fuß')
  fireEvent.click(footerClose)
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('während eine Buchung gelöscht wird, sind Anlegen und Löschen gesperrt', async () => {
  let release: () => void = () => {}
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: {} })
    return new Promise<Response>((resolve) => { release = () => resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })) })
  })
  const { drawer } = open()
  fireEvent.click(within(drawer).getAllByRole('button', { name: 'Löschen …' })[0] ?? drawer)
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1))
  const anlegen = within(drawer).getByRole('button', { name: 'Anlegen' })
  expect(anlegen instanceof HTMLButtonElement && anlegen.disabled).toBe(true)
  expect(within(drawer).getAllByRole('button', { name: 'Löschen …' }).every((b) => b instanceof HTMLButtonElement && b.disabled)).toBe(true)
  release()
})

// ---------- Teil 2: Aufstellung zum Auszug ----------

const MOVED: Tenancy = { ...TENANCY, end: '2025-12-31', depositHoldCents: 30000, depositHoldNote: 'Nebenkosten 2025' }
const MOVED_ENTRIES: DepositEntry[] = [
  { id: 'a', tenancyId: 't', date: '2022-01-05', kind: 'received', amountCents: 240000 },
  { id: 'b', tenancyId: 't', date: '2025-12-31', kind: 'interest', amountCents: 1234 },
]
const INFO: DepositStatementInfo = { tenancyId: 't', last: { label: '2024', balanceCents: -18000 }, pending: ['2025'] }

function openMoved(tenancy: Tenancy = MOVED) {
  const onChanged = vi.fn()
  render(<UIProvider><DepositDrawer tenancy={tenancy} entries={MOVED_ENTRIES} info={INFO} onChanged={onChanged} onClose={vi.fn()} /></UIProvider>)
  return { onChanged, drawer: screen.getByRole('dialog', { name: 'Kaution von Erika Mustermann' }) }
}
const flat = (el: Element) => (el.textContent ?? '').replace(/\u00a0/g, ' ')

test('nach dem Auszug: Aufstellung mit Einbehalt, was auszuzahlen bleibt, letzter Abrechnung und Ausstehendem', () => {
  const { drawer } = openMoved()
  const section = within(drawer).getByRole('region', { name: 'Aufstellung zum Auszug' })
  expect(flat(section)).toContain('Bei Ihnen liegen 2.412,34 €')
  expect(flat(section)).toContain('Einbehalten: 300,00 € (Nebenkosten 2025)')
  expect(flat(section)).toContain('Bleibt auszuzahlen: 2.112,34 €')
  expect(flat(section)).toContain('Nebenkostenabrechnung 2024: Nachzahlung 180,00 €')
  expect(flat(section)).toContain('Abrechnung für 2025 steht noch aus')
  // Kein Vorschlag, kein Prozentsatz.
  expect(flat(section)).not.toMatch(/Vorschlag|%/)
})

test('vor dem Auszug gibt es keine Aufstellung', () => {
  const { drawer } = openMoved({ ...MOVED, end: null })
  expect(within(drawer).queryByRole('region', { name: 'Aufstellung zum Auszug' })).toBeNull()
})

test('Einbehalt speichern schickt Betrag und Grund ans Mietverhältnis', async () => {
  const { onChanged } = openMoved({ ...MOVED, depositHoldCents: undefined, depositHoldNote: undefined })
  fireEvent.change(screen.getByLabelText(/^Einbehalt €/), { target: { value: '300' } })
  fireEvent.change(screen.getByLabelText(/^Grund/), { target: { value: 'Nebenkosten 2025' } })
  fireEvent.click(screen.getByRole('button', { name: 'Einbehalt speichern' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(sent.at(-1)).toMatchObject({ url: '/api/tenancies/t', method: 'PUT', body: { depositHoldCents: 30000, depositHoldNote: 'Nebenkosten 2025' } })
})

test('ein Einbehalt ohne Grund wird nicht gesendet', async () => {
  openMoved({ ...MOVED, depositHoldCents: undefined, depositHoldNote: undefined })
  fireEvent.change(screen.getByLabelText(/^Einbehalt €/), { target: { value: '300' } })
  fireEvent.click(screen.getByRole('button', { name: 'Einbehalt speichern' }))
  expect(await screen.findAllByText(/Grund fehlt|Nennen Sie den Grund/)).not.toHaveLength(0)
  expect(sent).toEqual([])
})

test('Drucken druckt nur die Aufstellung', async () => {
  const print = vi.fn()
  vi.stubGlobal('print', print)
  openMoved()
  fireEvent.click(screen.getByRole('button', { name: 'Aufstellung drucken' }))
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
  expect(document.body.classList.contains('print-deposit')).toBe(true)
  const sheet = document.body.querySelector(':scope > .deposit-print') ?? expect.fail('kein Druckblatt am Ende von body')
  expect(flat(sheet)).toContain('Aufstellung zum Auszug')
  expect(flat(sheet)).toContain('Erika Mustermann')
  window.dispatchEvent(new Event('afterprint'))
  await waitFor(() => expect(document.body.classList.contains('print-deposit')).toBe(false))
})
