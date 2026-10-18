// @vitest-environment jsdom
// Kleinigkeiten der Abrechnungsseite aus der Abnahme (#142): was beim Mieter auf dem Papier steht
// und was beim Arbeiten verwirrt.
import { afterEach, assert, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PeriodProvider } from '../period'
import type { Notice, NoticeSubject, Settings, Settlement, Statement, Tenancy } from '../types'
import type { NoticeTab } from '../notices'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung, { PRINT_DRAFT_NOTE } from './Abrechnung'
// Die Auswahl der Seitenleiste (App.tsx): Die Seite selbst wählt das Jahr nicht mehr (#346 Schritt 8).
import { PeriodSelect } from '../components/PeriodSelect'
import type { HistoryEntry } from '../settlementHistory'
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'

// Die Seite rendert ganz; unter Last braucht das mehr als die voreingestellten Zeiten.
vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }

const YEAR = new Date().getFullYear() - 1
const TENANCIES: Tenancy[] = [{
  id: 't1', unitId: 'u1', tenantName: 'Meier', persons: 2,
  personHistory: [{ from: '2020-01-01', persons: 1 }, { from: `${YEAR}-10-01`, persons: 2 }],
  start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: { [calendarPeriod(YEAR)]: 50000 }, baseRents: [],
}]
const daysIn = (y: number) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365)
const bisSept = daysIn(YEAR) - 92
const STATEMENT: Statement = {
  tenancyId: 't1', unitId: 'u1', tenantName: 'Meier', unitName: 'EG', persons: 2, days: daysIn(YEAR), personDays: bisSept + 2 * 92,
  periodStart: `${YEAR}-01-01`, periodEnd: `${YEAR}-12-31`,
  rows: [{ costItemId: 'k1', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 60000, keyLabel: 'Wohnfläche', shareCents: 60000 }],
  totalShareCents: 60000, total35aCents: 0, prepaymentCents: 50000, prepaymentOverridden: true, suggestedMonthlyCents: 0, balanceCents: -10000,
}
let settlement: Settlement
let history: HistoryEntry[]

beforeEach(() => {
  settlement = {
    year: YEAR, daysInYear: daysIn(YEAR), period: settlementPeriod(calendarYearPeriod(YEAR)), deadline: `${YEAR + 1}-12-31`, statements: [STATEMENT], landlord: { rows: [], totalCents: 0 }, selfUsedShareCents: 0,
    totalCostsCents: 60000, warnings: [], notices: [], closed: null,
  }
  history = []
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/properties') return json([{ id: 'objekt-1', name: 'A', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null }])
    if (path === `/api/settlement/${YEAR}`) return json(settlement)
    if (path === `/api/settlement/${YEAR}/history`) return json(history)
    // Ein anderes Jahr (Test mit Jahreswechsel) bekommt eine leere offene Abrechnung, keine Liste.
    const other = /^\/api\/settlement\/(\d{4})$/.exec(path)
    if (other) return json({ ...settlement, year: Number(other[1]), statements: [], closed: null })
    if (/^\/api\/settlement\/\d{4}\/history$/.test(path)) return json([])
    return json([])
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = () => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider><PeriodSelect /><Abrechnung settings={null} units={[]} tenancies={TENANCIES} reload={async () => {}} /></UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

test('„(manuell angepasst)“ steht nur am Bildschirm, nicht auf dem Papier des Mieters', async () => {
  show()
  const mark = await screen.findByText(/manuell angepasst/, {}, SLOW)
  expect(mark.closest('.no-print')).not.toBeNull()
})

test('kein „Abflussprinzip“ mehr, sondern die Kosten des Abrechnungsjahres', async () => {
  show()
  await screen.findByText(`Abgerechnet werden die Kosten des Abrechnungsjahres ${YEAR}.`, { exact: false }, SLOW)
  expect(screen.queryByText(/Abflussprinzip/)).toBeNull()
})

test('Kopfzeile: wechselnde Personenzahl als Bereich mit Personentagen', async () => {
  show()
  await screen.findByText(new RegExp(`1 bis 2 Personen \\(${bisSept + 184} Personentage\\)`), {}, SLOW)
})

test('„✎ anpassen“ schließt mit Abbrechen und mit Esc', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: /anpassen/ }, SLOW))
  fireEvent.click(screen.getByRole('button', { name: /^Abbrechen$/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Abbrechen$/ })).toBeNull(), SLOW)

  fireEvent.click(screen.getByRole('button', { name: /anpassen/ }))
  const feld = screen.getByLabelText(/Gezahlte Vorauszahlung/)
  fireEvent.keyDown(feld, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByLabelText(/Gezahlte Vorauszahlung/)).toBeNull(), SLOW)
})

// UI-Durchsicht H4: Eine ungültige Eingabe wurde stumm verworfen, es geschah einfach nichts.
test('„✎ anpassen“ mit ungültigem Betrag: Meldung am Feld, nichts gespeichert', async () => {
  const inner = globalThis.fetch
  const writes: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') writes.push(`${init?.method} ${url}`)
    return inner(url, init)
  })
  show()
  fireEvent.click(await screen.findByRole('button', { name: /anpassen/ }, SLOW))
  const feld = screen.getByLabelText(/Gezahlte Vorauszahlung/)
  fireEvent.change(feld, { target: { value: 'abc' } })
  fireEvent.click(screen.getByRole('button', { name: /^OK$/ }))
  const alert = await screen.findByRole('alert', {}, SLOW)
  expect(alert.textContent).toMatch(/Betrag/)
  expect(feld.getAttribute('aria-invalid')).toBe('true')
  expect(feld.getAttribute('aria-describedby')).toBe(alert.id)
  fireEvent.keyDown(feld, { key: 'Enter' })
  fireEvent.change(feld, { target: { value: '-5' } })
  fireEvent.keyDown(feld, { key: 'Enter' })
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(writes).toEqual([])
  // Wer weitertippt, sieht die Meldung erst beim nächsten Versuch wieder.
  fireEvent.change(feld, { target: { value: '450' } })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(feld.getAttribute('aria-invalid')).toBeNull()
})

test('nach dem Wiederöffnen bleibt der frühere Versand sichtbar, die Frist läuft nicht scheinbar neu', async () => {
  history = [{ id: 'h1', closedAt: `${YEAR + 1}-01-10T09:00:00.000Z`, sentAt: `${YEAR + 1}-01-12`, reopenedAt: `${YEAR + 1}-03-01T10:00:00.000Z`, settlement: {} }]
  show()
  await screen.findByText(new RegExp(`frühere Fassung der Abrechnung ${YEAR} wurde am 12\\.01\\.${YEAR + 1} versendet`), {}, SLOW)
  expect(screen.queryByText(/^Abrechnungsfrist/)).toBeNull()
})

test('Vermieteranteil: die Spalte „Grund“ nennt die tatsächlichen Gründe der Zeile', async () => {
  settlement.landlord = {
    rows: [{ costItemId: 'k2', category: 'Müllabfuhr', description: 'Müll', totalCents: 40000, keyLabel: 'Wohnfläche', shareCents: 20000, landlordParts: [{ reason: 'flatRate', cents: 20000 }] }],
    totalCents: 20000,
  }
  show()
  const zeile = (await screen.findByText('Müll', {}, SLOW)).closest('tr')
  expect(zeile?.textContent).toMatch(/Betriebskostenpauschale/)
  expect(zeile?.textContent).not.toMatch(/Eigennutzung \/ Leerstand/)
})

test('Kopfzeile ohne Adresse endet nicht mit einem Trenner', async () => {
  show()
  await screen.findByText(/manuell angepasst/, {}, SLOW)
  const kopf = document.querySelector('.card.statement > .muted')
  expect(kopf?.textContent?.trim()).toBe('A')
})

// Durchsicht von #222 (M1): Bei einem Kalenderobjekt nennt der Server die Jahreskorrektur nach
// Jahreszahl, damit ein Tab von vor dem Update sie zurücksetzen kann. Diese Seite schickt Zeiträume;
// „zurücksetzen“ muss die Korrektur des Jahres wirklich entfernen.
test('„zurücksetzen“ entfernt die Korrektur auch, wenn der Server sie nach Jahreszahl nennt (#208)', async () => {
  const puts: unknown[] = []
  const inner = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && url.startsWith('/api/tenancies/')) {
      puts.push(JSON.parse(String(init.body)))
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return inner(url, init)
  })
  const mitJahr: Tenancy[] = TENANCIES.map((t) => ({ ...t, prepaymentOverrides: { [String(YEAR - 1)]: 40000, [String(YEAR)]: 50000 } }))
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Abrechnung settings={null} units={[]} tenancies={mitJahr} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /^zurücksetzen$/ }, SLOW))
  await waitFor(() => expect(puts).toHaveLength(1), SLOW)
  expect(puts[0]).toEqual({ prepaymentOverrides: { [calendarPeriod(YEAR - 1)]: 40000 } })
})

// Sichtprüfung E45: „Heizkostenabrechnung … – Zur Abrechnung →“ im Cockpit wechselt in den Zeitraum,
// in dem die Heizperiode endet, und die Seite wählt dort die Heizkostenabrechnung aus.
test('ein Ziel „Heizkostenabrechnung“ wählt ihren Reiter', async () => {
  const h = { plantId: 'hp1', plantName: '', deadline: `${YEAR + 1}-04-30`, closed: null,
    period: { key: `${YEAR - 1}-05`, from: `${YEAR - 1}-05-01`, to: `${YEAR}-04-30`, short: false, label: `${YEAR - 1}/${YEAR}` } }
  const calls: string[] = []
  const base = globalThis.fetch
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    calls.push(path)
    if (path === '/api/heating-settlements') return json([h])
    if (path === `/api/heating-settlement/hp1/${YEAR - 1}-05`) return json({ ...settlement, period: h.period, scope: { kind: 'heating', plantId: 'hp1', plantName: '' } })
    return base(url, init)
  })
  const done = vi.fn()
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Abrechnung settings={null} units={[]} tenancies={TENANCIES} reload={async () => {}} focus={{ kind: 'heatingSettlement', id: `hp1|${YEAR - 1}-05` }} onFocusDone={done} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  await waitFor(() => expect(calls).toContain(`/api/heating-settlement/hp1/${YEAR - 1}-05`), SLOW)
  expect(done).toHaveBeenCalled()
  // Der Knopf nennt, was er abschließt; vorher stand dort „Abrechnung <Jahr> abschließen“.
  await screen.findByRole('button', { name: `🔒 Heizkostenabrechnung ${YEAR - 1}/${YEAR} abschließen` }, SLOW)
})

test('IBAN (#279): auf der Abrechnung in Vierergruppen, eine ungültige, wie sie gespeichert ist', async () => {
  const mit = (iban: string) => render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Abrechnung settings={{ landlordName: 'Erika', iban, paymentDeadlineDays: 30 } as Settings} units={[]} tenancies={TENANCIES} reload={async () => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  mit('DE89370400440532013000')
  expect(await screen.findByText('DE89 3704 0044 0532 0130 00', undefined, SLOW)).toBeTruthy()
  cleanup()
  mit('de00 1111')
  expect(await screen.findByText('de00 1111', undefined, SLOW)).toBeTruthy()
})

// #319: Meldet der Server beim Abschließen Fehler, nennt der Dialog sie mit Titel und „Hier beheben →“,
// und erst „Trotzdem abschließen“ sendet die Bestätigung.
const FEHLER2: Notice = { code: 'tenancy.overlap', level: 'error', title: 'Zweite Überschneidung', text: 'OG: zugleich.', subject: { kind: 'tenancy', id: 't2' } }
const FEHLER: Notice = { code: 'tenancy.overlap', level: 'error', title: 'Mietverhältnisse überschneiden sich', text: 'EG: Meier und Müller wohnen zugleich.', subject: { kind: 'tenancy', id: 't1' } }
function stubClose(bodies: unknown[]) {
  const before = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    if (path === `/api/settlement/${YEAR}/close` && init?.method === 'POST') {
      const body: unknown = JSON.parse(String(init.body))
      bodies.push(body)
      const confirmed = typeof body === 'object' && body !== null && 'despiteErrors' in body && body.despiteErrors === 'marke-1'
      if (confirmed) return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ error: 'Die Abrechnung enthält einen Fehler.', errorNotices: [FEHLER, FEHLER2], errorToken: 'marke-1' }), { status: 409, headers: { 'content-type': 'application/json' } })
    }
    return before(url, init)
  })
}
const showWithNav = (onNavigate: (tab: NoticeTab, focus?: NoticeSubject) => void) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider><Abrechnung settings={null} units={[]} tenancies={TENANCIES} reload={async () => {}} onNavigate={onNavigate} /></UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

test('Abschließen mit Fehlern (#319): der Dialog nennt sie, „Trotzdem abschließen“ sendet die Bestätigung', async () => {
  const bodies: unknown[] = []
  stubClose(bodies)
  showWithNav(() => {})
  fireEvent.click(await screen.findByRole('button', { name: `🔒 Abrechnung ${YEAR} abschließen` }, SLOW))
  fireEvent.click(await screen.findByRole('button', { name: 'Abschließen' }))
  const dialog = await screen.findByRole('alertdialog', { name: /Fehler/ }, SLOW)
  expect(dialog.textContent).toContain('Mietverhältnisse überschneiden sich')
  expect(dialog.textContent).toContain('EG: Meier und Müller wohnen zugleich.')
  // K1: Gleich benannte Knöpfe unterscheidet die Beschreibung mit dem Titel des Fehlers.
  const knoepfe = screen.getAllByRole('button', { name: 'Hier beheben → Stammdaten' })
  expect(knoepfe.map((k) => document.getElementById(k.getAttribute('aria-describedby') ?? '')?.textContent)).toEqual(['Mietverhältnisse überschneiden sich', 'Zweite Überschneidung'])
  fireEvent.click(screen.getByRole('button', { name: 'Trotzdem abschließen' }))
  await waitFor(() => expect(bodies).toEqual([{}, { despiteErrors: 'marke-1' }]), SLOW)
})

test('Abschließen mit Fehlern (#319): „Hier beheben →“ schließt nicht ab und führt zum Eintrag', async () => {
  const bodies: unknown[] = []
  stubClose(bodies)
  const nav = vi.fn()
  showWithNav(nav)
  fireEvent.click(await screen.findByRole('button', { name: `🔒 Abrechnung ${YEAR} abschließen` }, SLOW))
  fireEvent.click(await screen.findByRole('button', { name: 'Abschließen' }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Hier beheben → Stammdaten' }, SLOW))[0] ?? assert.fail('kein Knopf'))
  await waitFor(() => expect(nav).toHaveBeenCalledWith('stammdaten', { kind: 'tenancy', id: 't1' }), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(bodies).toEqual([{}])
})

// #309: Das Versanddatum setzt die Frist des § 556 Abs. 3 BGB. Ein verklicktes Datum im Kalender
// stand vorher sofort fest; jetzt ist es ein Entwurf, bis „Speichern“ es schickt.
function stubSentAt(puts: unknown[]) {
  settlement.closed = { closedAt: `${YEAR + 1}-01-08T09:00:00.000Z`, sentAt: `${YEAR + 1}-01-10` }
  const before = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    if (path === `/api/settlement/${YEAR}/close` && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { sentAt: string | null }
      puts.push(body)
      settlement = { ...settlement, closed: { closedAt: settlement.closed?.closedAt ?? '', sentAt: body.sentAt } }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return before(url, init)
  })
}
const sentAtField = async () => (await screen.findByLabelText(/versendet am/, {}, SLOW)) as HTMLInputElement

test('Versanddatum: Ändern sendet nichts, „Speichern“ sendet genau einmal (#309)', async () => {
  const puts: unknown[] = []
  stubSentAt(puts)
  show()
  const feld = await sentAtField()
  expect(feld.value).toBe(`${YEAR + 1}-01-10`)
  expect(screen.queryByRole('button', { name: 'Speichern (Versanddatum)' })).toBeNull()
  fireEvent.change(feld, { target: { value: `${YEAR + 1}-01-15` } })
  expect(puts).toEqual([])
  const speichern = screen.getByRole('button', { name: 'Speichern (Versanddatum)' })
  fireEvent.click(speichern)
  fireEvent.click(speichern)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern (Versanddatum)' })).toBeNull(), SLOW)
  expect(puts).toEqual([{ sentAt: `${YEAR + 1}-01-15` }])
  expect((await sentAtField()).value).toBe(`${YEAR + 1}-01-15`)
})

test('Versanddatum: „Verwerfen“ stellt das gespeicherte Datum her, ohne zu senden (#309)', async () => {
  const puts: unknown[] = []
  stubSentAt(puts)
  show()
  const feld = await sentAtField()
  fireEvent.change(feld, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Versanddatum)' }))
  expect(feld.value).toBe(`${YEAR + 1}-01-10`)
  expect(screen.queryByRole('button', { name: 'Speichern (Versanddatum)' })).toBeNull()
  expect(puts).toEqual([])
})

test('Versanddatum: ein ungespeichertes Datum fragt beim Wechsel des Jahres nach (#309)', async () => {
  const puts: unknown[] = []
  stubSentAt(puts)
  show()
  const feld = await sentAtField()
  fireEvent.change(feld, { target: { value: `${YEAR + 1}-01-15` } })
  fireEvent.change(screen.getByLabelText('Abrechnungsjahr'), { target: { value: String(YEAR - 1) } })
  expect(await screen.findByText('Offene Eingaben verwerfen?', {}, SLOW)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByText('Offene Eingaben verwerfen?')).toBeNull(), SLOW)
  // Wer abbricht, bleibt im Jahr und behält seine Eingabe.
  expect((screen.getByLabelText('Abrechnungsjahr') as HTMLSelectElement).value).toBe(String(YEAR))
  expect((await sentAtField()).value).toBe(`${YEAR + 1}-01-15`)
  expect(puts).toEqual([])
})

// Durchsicht zu #309: Wer mit einem ungespeicherten Datum „Wieder öffnen“ wählt, verschwindet das
// Feld. Der Entwurf darf danach nicht unsichtbar als offenes Formular weiterzählen und beim nächsten
// Abschluss wieder auftauchen.
test('Versanddatum: nach „Wieder öffnen“ bleibt kein unsichtbarer Entwurf zurück (#309)', async () => {
  const puts: unknown[] = []
  stubSentAt(puts)
  const before = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    if (path === `/api/settlement/${YEAR}/close` && init?.method === 'DELETE') {
      settlement = { ...settlement, closed: null }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return before(url, init)
  })
  show()
  fireEvent.change(await sentAtField(), { target: { value: `${YEAR + 1}-01-15` } })
  fireEvent.click(screen.getByRole('button', { name: 'Wieder öffnen' }))
  const dialog = await screen.findByRole('alertdialog', {}, SLOW)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Wieder öffnen' }))
  await waitFor(() => expect(screen.queryByLabelText(/versendet am/)).toBeNull(), SLOW)
  fireEvent.change(screen.getByLabelText('Abrechnungsjahr'), { target: { value: String(YEAR - 1) } })
  await waitFor(() => expect((screen.getByLabelText('Abrechnungsjahr') as HTMLSelectElement).value).toBe(String(YEAR - 1)), SLOW)
  expect(screen.queryByText('Offene Eingaben verwerfen?')).toBeNull()
  expect(puts).toEqual([])
})

// UI-Durchsicht H6: Drucken und das Versanddatum gingen ohne Hinweis, obwohl die Abrechnung Fehler
// enthielt (etwa „Heizkostenabrechnung unvollständig“: die Heizkosten fehlten in jeder Mieterabrechnung).
// Jetzt fragt die Seite nach, nach dem Muster der Rückfrage zum Abschließen (#319).
const HEAT_ERROR = { code: 'heating.self-incomplete', level: 'error' as const, title: 'Heizkostenabrechnung unvollständig', text: 'Die Heizkosten fehlen in jeder Mieterabrechnung.', subject: { kind: 'tenancy' as const, id: 't1' } }
const INFO_ERROR = { code: 'period.short', level: 'error' as const, title: 'Nur Auskunft', text: 'Färbt nicht.' }
const printing = () => document.body.classList.contains('print-one')

test('Drucken mit Fehlern: Rückfrage, Vorgabe „Nicht drucken“, „Trotzdem drucken“ druckt', async () => {
  settlement.notices = [HEAT_ERROR]
  showWithNav(() => {})
  fireEvent.click(await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW))
  const dialog = await screen.findByRole('alertdialog', { name: /Fehler/ }, SLOW)
  expect(dialog.textContent).toContain('Heizkostenabrechnung unvollständig')
  expect(document.activeElement?.textContent).toBe('Nicht drucken')
  fireEvent.click(screen.getByRole('button', { name: 'Nicht drucken' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(printing()).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /Drucken \/ PDF/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem drucken' }, SLOW))
  await waitFor(() => expect(printing()).toBe(true), SLOW)
})

test('Drucken mit Fehlern: „Hier beheben →“ druckt nicht und führt zum Eintrag', async () => {
  settlement.notices = [HEAT_ERROR]
  const nav = vi.fn()
  showWithNav(nav)
  fireEvent.click(await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW))
  const dialog = await screen.findByRole('alertdialog', { name: /Fehler/ }, SLOW)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hier beheben → Stammdaten' }))
  await waitFor(() => expect(nav).toHaveBeenCalledWith('stammdaten', { kind: 'tenancy', id: 't1' }), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(printing()).toBe(false)
})

test('Drucken: eine Auskunft aus INFORMATIONAL und Warnungen fragen nicht nach', async () => {
  settlement.notices = [INFO_ERROR, { code: 'w', level: 'warning', title: 'Warnung', text: 'W' }]
  show()
  fireEvent.click(await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW))
  await waitFor(() => expect(printing()).toBe(true), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

// Durchsicht S6 (#341): Eine abgeschlossene Abrechnung fragt weder beim Versanddatum noch beim Drucken nach,
// denn beim Abschluss wurde trotz der Fehler bestätigt (#319). Auch der Vermerk „Entwurf, nicht versenden“ fehlt:
// Er gehört nur in den Entwurf, sonst ließe sich eine bewusst trotz Fehlern abgeschlossene Abrechnung nie ohne
// ihn drucken (Nachprüfung N1).
test('abgeschlossen mit Fehlern: Versanddatum und Druck fragen nicht nach, ohne Druckvermerk', async () => {
  const puts: unknown[] = []
  stubSentAt(puts)
  settlement.notices = [HEAT_ERROR]
  show()
  const feld = await sentAtField()
  fireEvent.change(feld, { target: { value: `${YEAR + 1}-01-15` } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Versanddatum)' }))
  await waitFor(() => expect(puts).toEqual([{ sentAt: `${YEAR + 1}-01-15` }]), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.queryByText(/Entwurf, nicht versenden/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Drucken \/ PDF/ }))
  await waitFor(() => expect(printing()).toBe(true), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

// Durchsicht S2 (#341): Der gedruckte Vermerk deckt auch Strg+P und das Browsermenü ab, die die Seite nicht abfängt.
test('Druckvermerk „Entwurf, nicht versenden“ nur bei Fehlern, und nur im Druck', async () => {
  settlement.notices = [HEAT_ERROR]
  const first = show()
  const mark = await screen.findByText(/Entwurf, nicht versenden/, {}, SLOW)
  expect(mark.closest('.print-only')).not.toBeNull()
  expect(mark.closest('.statement')).not.toBeNull()
  first.unmount()
  settlement.notices = [INFO_ERROR, { code: 'w', level: 'warning', title: 'Warnung', text: 'W' }]
  show()
  await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW)
  expect(screen.queryByText(/Entwurf, nicht versenden/)).toBeNull()
})

// Durchsicht S2 (#341): Die erste Rückfrage zum Abschluss nennt die Fehler; bestätigt der Vermieter dort, fragt
// die Antwort des Servers zu denselben Fehlern nicht noch einmal.
test('Abschließen mit Fehlern auf der Seite: eine Rückfrage nennt sie, „Trotzdem abschließen“ sendet die Bestätigung', async () => {
  const bodies: unknown[] = []
  stubClose(bodies)
  settlement.notices = [FEHLER, FEHLER2]
  showWithNav(() => {})
  fireEvent.click(await screen.findByRole('button', { name: `🔒 Abrechnung ${YEAR} abschließen` }, SLOW))
  const dialog = await screen.findByRole('alertdialog', {}, SLOW)
  expect(dialog.textContent).toContain('Mietverhältnisse überschneiden sich')
  expect(document.activeElement?.textContent).toBe('Nicht abschließen')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Trotzdem abschließen' }))
  await waitFor(() => expect(bodies).toEqual([{}, { despiteErrors: 'marke-1' }]), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('Abschließen mit Fehlern auf der Seite: „Nicht abschließen“ sendet nichts', async () => {
  const bodies: unknown[] = []
  stubClose(bodies)
  settlement.notices = [FEHLER]
  showWithNav(() => {})
  fireEvent.click(await screen.findByRole('button', { name: `🔒 Abrechnung ${YEAR} abschließen` }, SLOW))
  fireEvent.click(await screen.findByRole('button', { name: 'Nicht abschließen' }, SLOW))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(bodies).toEqual([])
})

// #309: Die beiden Häkchen zum Druck sind Einstellungen und speicherten beim Anklicken. Jetzt sind sie
// ein Entwurf mit einem „Speichern“ für beide.
function stubSettings(puts: unknown[], fail = false) {
  const before = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/settings' && init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)))
      if (fail) return new Response(JSON.stringify({ error: 'Platte voll' }), { status: 503, headers: { 'content-type': 'application/json' } })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return before(url, init)
  })
}
const SETTINGS: Settings = { houseName: '', address: '', landlordName: '', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '' }
const showWithSettings = (s: Settings, reload: () => Promise<void>) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider><PeriodSelect /><Abrechnung settings={s} units={[]} tenancies={TENANCIES} reload={reload} /></UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)
const adjustBox = async () => (await screen.findByLabelText(/Vorauszahlung.*vorschlagen/, {}, SLOW)) as HTMLInputElement
const attachBox = () => screen.getByLabelText(/Belegkopien als Anlage/) as HTMLInputElement

test('Druckeinstellungen: Anklicken sendet nichts, „Speichern“ sendet beide genau einmal (#309)', async () => {
  const puts: unknown[] = []
  stubSettings(puts)
  const reload = vi.fn(async () => {})
  showWithSettings(SETTINGS, reload)
  fireEvent.click(await adjustBox())
  fireEvent.click(attachBox())
  expect((await adjustBox()).checked).toBe(false)
  expect(attachBox().checked).toBe(true)
  expect(puts).toEqual([])
  // Durchsicht KANN 9: Der Entwurf wirkt schon im Druck, gemerkt wird er erst mit „Speichern“.
  expect(screen.getByText(PRINT_DRAFT_NOTE)).toBeTruthy()
  const speichern = screen.getByRole('button', { name: 'Speichern (Druckeinstellungen)' })
  fireEvent.click(speichern)
  fireEvent.click(speichern)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeNull(), SLOW)
  expect(puts).toEqual([{ printAdjustSuggestion: false, printAttachments: true }])
  expect(reload).toHaveBeenCalledTimes(1)
})

test('Druckeinstellungen: „Verwerfen“ stellt beide her, ohne zu senden (#309)', async () => {
  const puts: unknown[] = []
  stubSettings(puts)
  showWithSettings({ ...SETTINGS, printAttachments: true }, async () => {})
  fireEvent.click(await adjustBox())
  fireEvent.click(attachBox())
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Druckeinstellungen)' }))
  expect((await adjustBox()).checked).toBe(true)
  expect(attachBox().checked).toBe(true)
  expect(screen.queryByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeNull()
  expect(puts).toEqual([])
})

test('Druckeinstellungen: scheitert das Speichern, steht der Grund am Knopf und der Entwurf bleibt (#309)', async () => {
  const puts: unknown[] = []
  stubSettings(puts, true)
  const reload = vi.fn(async () => {})
  showWithSettings(SETTINGS, reload)
  fireEvent.click(await adjustBox())
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Druckeinstellungen)' }))
  const alert = await screen.findByRole('alert', {}, SLOW)
  expect(alert.textContent).toMatch(/^Nicht gespeichert: .*Platte voll/)
  expect(alert.closest('.draft-actions')).not.toBeNull()
  expect((await adjustBox()).checked).toBe(false)
  expect(screen.getByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeTruthy()
  expect(reload).not.toHaveBeenCalled()
})

test('Druckeinstellungen: ungespeichert fragt der Wechsel des Jahres nach (#309)', async () => {
  const puts: unknown[] = []
  stubSettings(puts)
  showWithSettings(SETTINGS, async () => {})
  fireEvent.click(await adjustBox())
  fireEvent.change(screen.getByLabelText('Abrechnungsjahr'), { target: { value: String(YEAR - 1) } })
  expect(await screen.findByText('Offene Eingaben verwerfen?', {}, SLOW)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByText('Offene Eingaben verwerfen?')).toBeNull(), SLOW)
  expect((await adjustBox()).checked).toBe(false)
  expect(puts).toEqual([])
})

// Durchsicht zu #333: Der Reiter zwischen Betriebs- und Heizkostenabrechnung wechselt den scope des
// Versanddatums. Vorher war ein ungespeichertes Datum dann ohne Rückfrage weg.
test('Versanddatum: der Wechsel zur Heizkostenabrechnung fragt bei einem ungespeicherten Datum nach (#309)', async () => {
  const puts: unknown[] = []
  stubSentAt(puts)
  const h = { plantId: 'hp1', plantName: '', deadline: `${YEAR + 1}-04-30`, closed: null,
    period: { key: `${YEAR - 1}-05`, from: `${YEAR - 1}-05-01`, to: `${YEAR}-04-30`, short: false, label: `${YEAR - 1}/${YEAR}` } }
  const base = globalThis.fetch
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    if (path === '/api/heating-settlements') return json([h])
    if (path === `/api/heating-settlement/hp1/${YEAR - 1}-05`) return json({ ...settlement, closed: null, period: h.period, scope: { kind: 'heating', plantId: 'hp1', plantName: '' } })
    if (path === `/api/heating-settlement/hp1/${YEAR - 1}-05/history`) return json([])
    return base(url, init)
  })
  show()
  fireEvent.change(await sentAtField(), { target: { value: `${YEAR + 1}-01-15` } })
  const heizung = await screen.findByRole('button', { name: /^Heizkosten / }, SLOW)
  fireEvent.click(heizung)
  const dialog = await screen.findByRole('alertdialog', {}, SLOW)
  expect(dialog.textContent).toMatch(/Ungespeicherte Änderung verwerfen\?/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(heizung.getAttribute('aria-pressed')).toBe('false')
  expect((await sentAtField()).value).toBe(`${YEAR + 1}-01-15`)
  // Mit „Verwerfen“ wechselt der Reiter.
  fireEvent.click(heizung)
  fireEvent.click(within(await screen.findByRole('alertdialog', {}, SLOW)).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(heizung.getAttribute('aria-pressed')).toBe('true'), SLOW)
  expect(puts).toEqual([])
})
