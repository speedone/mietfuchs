// @vitest-environment jsdom
// Kleinigkeiten der Abrechnungsseite aus der Abnahme (#142): was beim Mieter auf dem Papier steht
// und was beim Arbeiten verwirrt.
import { afterEach, assert, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PeriodProvider } from '../period'
import type { CostItem, Notice, NoticeSubject, Settings, Settlement, Statement, Tenancy, UploadEntry } from '../types'
import type { NoticeTab } from '../notices'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung, { PRINT_DRAFT_NOTE } from './Abrechnung'
// Die Auswahl der Seitenleiste (App.tsx): Die Seite selbst wählt das Jahr nicht mehr (#346 Schritt 8).
import { PeriodSelect } from '../components/PeriodSelect'
import type { HistoryEntry } from '../settlementHistory'
import { calendarPeriod, calendarYearPeriod, settlementPeriod } from '../../../shared/period.ts'
import samplesRaw from '../testing/noticeSamples.json?raw'

// Echte Texte der Berechnung je Code (noticeText.test.ts pflegt sie).
const samples = JSON.parse(samplesRaw) as { code: string, text: string }[]
const sample = (code: string): string => samples.find((x) => x.code === code)?.text ?? assert.fail(`kein Beispiel für ${code}`)

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

test('kein „Abflussprinzip“ mehr; der Abrechnungszeitraum steht im Kopf der Aufstellung', async () => {
  show()
  const term = (await screen.findAllByText('Abrechnungszeitraum', { selector: 'dl.statement-facts dt' }, SLOW))[0]
  expect(term?.nextElementSibling?.textContent).toContain(`01.01.${YEAR} – 31.12.${YEAR}`)
  expect(screen.queryByText(/Abflussprinzip/)).toBeNull()
  expect(screen.queryByText(/Abgerechnet werden die Kosten/)).toBeNull()
})

test('Kopfzeile: wechselnde Personenzahl als Bereich mit Personentagen', async () => {
  show()
  await screen.findByText(new RegExp(`1 bis 2 Personen \\(${bisSept + 184} Personentage\\)`), {}, SLOW)
})

test('„✎ anpassen“ schließt mit Verwerfen und mit Esc', async () => {
  show()
  fireEvent.click(await screen.findByRole('button', { name: /anpassen/ }, SLOW))
  // Feste Verben (#346 Schritt 7, N3): Entwurf am Feld mit „Speichern“ und „Verwerfen“, kein „OK“.
  expect(screen.queryByRole('button', { name: /^OK$/ })).toBeNull()
  expect(screen.getByRole('button', { name: /^Speichern$/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Verwerfen$/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Verwerfen$/ })).toBeNull(), SLOW)

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
  fireEvent.click(screen.getByRole('button', { name: /^Speichern$/ }))
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
  // Seit #415 ist sie die Rücksendeangabe über der Anschrift des Anschreibens.
  const kopf = document.querySelector('.card.statement .letter-return')
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
  // Seit #415 im Anschreiben, im Satz zur Nachzahlung.
  mit('DE89370400440532013000')
  expect(await screen.findByText(/auf das Konto DE89 3704 0044 0532 0130 00 \(Erika\)\./, undefined, SLOW)).toBeTruthy()
  cleanup()
  mit('de00 1111')
  expect(await screen.findByText(/auf das Konto de00 1111 \(Erika\)\./, undefined, SLOW)).toBeTruthy()
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

// #409: Ob alle Rechnungen des Jahres vorliegen, weiß nur der Vermieter. Die Rückfrage zum Abschließen
// fragt es deshalb; „Abschließen“ ist dann die Bestätigung, ohne einen Klick mehr.
test('Abschließen fragt, ob alle Rechnungen des Jahres vorliegen (#409)', async () => {
  const bodies: unknown[] = []
  stubClose(bodies)
  showWithNav(() => {})
  fireEvent.click(await screen.findByRole('button', { name: `🔒 Abrechnung ${YEAR} abschließen` }, SLOW))
  const dialog = await screen.findByRole('alertdialog', {}, SLOW)
  expect(dialog.textContent).toContain(`Liegen alle Rechnungen für ${YEAR} vor`)
  expect(dialog.textContent).toMatch(/Versorgerabrechnungen/)
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(bodies).toEqual([])
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
  fireEvent.click(screen.getByRole('button', { name: 'Wieder öffnen …' }))
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
// Gedruckt wird über das Fenster „Drucken“: aus der Vorschau eines Mieters dieser Mieter, aus der Kopfzeile alle.
const printDrawer = async () => screen.findByRole('dialog', { name: 'Drucken' }, SLOW)
async function printOne() {
  fireEvent.click(await screen.findByRole('button', { name: /^Ansehen/ }, SLOW))
  fireEvent.click(await screen.findByRole('button', { name: /^🖨 Drucken \(/ }, SLOW))
  fireEvent.click(within(await printDrawer()).getByRole('button', { name: 'Drucken' }))
}

test('Drucken mit Fehlern: Rückfrage, Vorgabe „Nicht drucken“, „Trotzdem drucken“ druckt', async () => {
  settlement.notices = [HEAT_ERROR]
  showWithNav(() => {})
  await printOne()
  const dialog = await screen.findByRole('alertdialog', { name: /Fehler/ }, SLOW)
  expect(dialog.textContent).toContain('Heizkostenabrechnung unvollständig')
  expect(document.activeElement?.textContent).toBe('Nicht drucken')
  fireEvent.click(screen.getByRole('button', { name: 'Nicht drucken' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(printing()).toBe(false)
  // Das Fenster „Drucken“ bleibt offen; ein zweiter Versuch fragt wieder.
  fireEvent.click(within(await printDrawer()).getByRole('button', { name: 'Drucken' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem drucken' }, SLOW))
  await waitFor(() => expect(printing()).toBe(true), SLOW)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Drucken' })).toBeNull(), SLOW)
})

test('Drucken mit Fehlern: „Hier beheben →“ druckt nicht und führt zum Eintrag', async () => {
  settlement.notices = [HEAT_ERROR]
  const nav = vi.fn()
  showWithNav(nav)
  await printOne()
  const dialog = await screen.findByRole('alertdialog', { name: /Fehler/ }, SLOW)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hier beheben → Stammdaten' }))
  await waitFor(() => expect(nav).toHaveBeenCalledWith('stammdaten', { kind: 'tenancy', id: 't1' }), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(printing()).toBe(false)
})

test('Drucken: eine Auskunft aus INFORMATIONAL und Warnungen fragen nicht nach', async () => {
  settlement.notices = [INFO_ERROR, { code: 'w', level: 'warning', title: 'Warnung', text: 'W' }]
  show()
  await printOne()
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
  await printOne()
  await waitFor(() => expect(printing()).toBe(true), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

// Durchsicht S2 (#341): Der gedruckte Vermerk deckt auch Strg+P und das Browsermenü ab, die die Seite nicht abfängt.
test('Druckvermerk „Entwurf, nicht versenden“ nur bei Fehlern, und nur im Druck', async () => {
  settlement.notices = [HEAT_ERROR]
  const first = show()
  // Auf dem Anschreiben und über der Aufstellung (#415): Beide Seiten liegen beim Mieter.
  const marks = await screen.findAllByText(/Entwurf, nicht versenden/, {}, SLOW)
  expect(marks).toHaveLength(2)
  for (const mark of marks) {
    expect(mark.closest('.print-only')).not.toBeNull()
    expect(mark.closest('.statement')).not.toBeNull()
  }
  expect(marks[0]?.closest('.letter')).not.toBeNull()
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
// Seit #415 wählt das Anschreiben die Anpassung der Vorauszahlung je Mieter; hier stehen Falzmarken und Belegkopien.
const foldBox = async () => (await screen.findByLabelText(/Falz- und Lochmarken/, {}, SLOW)) as HTMLInputElement
const attachBox = () => screen.getByLabelText(/Belegkopien als Anlage/) as HTMLInputElement
// Seit der Neuordnung der Seite stehen die Häkchen im Fenster „Drucken“, das „🖨 Drucken / PDF“ öffnet.
const openPrintSettings = async () => fireEvent.click(await screen.findByRole('button', { name: /Drucken \/ PDF/ }, SLOW))

test('Druckeinstellungen: Anklicken sendet nichts, „Speichern“ sendet beide genau einmal (#309)', async () => {
  const puts: unknown[] = []
  stubSettings(puts)
  const reload = vi.fn(async () => {})
  showWithSettings(SETTINGS, reload)
  await openPrintSettings()
  fireEvent.click(await foldBox())
  fireEvent.click(attachBox())
  expect((await foldBox()).checked).toBe(true)
  expect(attachBox().checked).toBe(true)
  expect(puts).toEqual([])
  // Durchsicht KANN 9: Der Entwurf wirkt schon im Druck, gemerkt wird er erst mit „Speichern“.
  expect(screen.getByText(PRINT_DRAFT_NOTE)).toBeTruthy()
  const speichern = screen.getByRole('button', { name: 'Speichern (Druckeinstellungen)' })
  fireEvent.click(speichern)
  fireEvent.click(speichern)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeNull(), SLOW)
  // Die Fußzeile (#415, Teil 2) gehört zu denselben Druckeinstellungen und geht unverändert mit.
  expect(puts).toEqual([{ printFoldMarks: true, printAttachments: true, printFooter: false }])
  expect(reload).toHaveBeenCalledTimes(1)
})

test('Druckeinstellungen: „Verwerfen“ stellt beide her, ohne zu senden (#309)', async () => {
  const puts: unknown[] = []
  stubSettings(puts)
  showWithSettings({ ...SETTINGS, printAttachments: true }, async () => {})
  await openPrintSettings()
  fireEvent.click(await foldBox())
  fireEvent.click(attachBox())
  fireEvent.click(screen.getByRole('button', { name: 'Verwerfen (Druckeinstellungen)' }))
  expect((await foldBox()).checked).toBe(false)
  expect(attachBox().checked).toBe(true)
  expect(screen.queryByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeNull()
  expect(puts).toEqual([])
})

test('Druckeinstellungen: scheitert das Speichern, steht der Grund am Knopf und der Entwurf bleibt (#309)', async () => {
  const puts: unknown[] = []
  stubSettings(puts, true)
  const reload = vi.fn(async () => {})
  showWithSettings(SETTINGS, reload)
  await openPrintSettings()
  fireEvent.click(await foldBox())
  fireEvent.click(screen.getByRole('button', { name: 'Speichern (Druckeinstellungen)' }))
  const alert = await screen.findByRole('alert', {}, SLOW)
  expect(alert.textContent).toMatch(/^Nicht gespeichert: .*Platte voll/)
  expect(alert.closest('.draft-actions')).not.toBeNull()
  expect((await foldBox()).checked).toBe(true)
  expect(screen.getByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeTruthy()
  expect(reload).not.toHaveBeenCalled()
})

test('Druckeinstellungen: ungespeichert fragt der Wechsel des Jahres nach (#309)', async () => {
  const puts: unknown[] = []
  stubSettings(puts)
  showWithSettings(SETTINGS, async () => {})
  window.print = vi.fn()
  await openPrintSettings()
  fireEvent.click(await foldBox())
  // Gedruckt (alle Mieter): Das Fenster ist zu, der Entwurf steht mit „Speichern“ in der Kopfzeile.
  fireEvent.click(within(await printDrawer()).getByRole('button', { name: 'Drucken' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Drucken' })).toBeNull(), SLOW)
  await waitFor(() => expect(window.print).toHaveBeenCalled(), SLOW)
  expect(document.body.classList.contains('print-one')).toBe(false)
  expect(screen.getByText(PRINT_DRAFT_NOTE)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Abrechnungsjahr'), { target: { value: String(YEAR - 1) } })
  expect(await screen.findByText('Offene Eingaben verwerfen?', {}, SLOW)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByText('Offene Eingaben verwerfen?')).toBeNull(), SLOW)
  await openPrintSettings()
  expect((await foldBox()).checked).toBe(true)
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

// #415 Teil 3: Export als Daten.
function exportFetch(answer: (path: string, query: string) => Response | null) {
  const before = globalThis.fetch
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const [path = '', query = ''] = url.split('?')
    if (/\/export$/.test(path)) { calls.push(url); return answer(path, query) ?? new Response('{}', { status: 200 }) }
    return before(url, init)
  })
  return calls
}
function captureDownload() {
  const names: string[] = []
  URL.createObjectURL = () => 'blob:x'
  URL.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
  return names
}

test('Export: Knöpfe laden die Datei und speichern sie unter dem Namen aus filename*', async () => {
  const calls = exportFetch((_p, q) => new Response('{}', { status: 200, headers: { 'content-disposition': `attachment; filename=x.${q.includes('csv') ? 'csv' : 'json'}; filename*=UTF-8''abrechnung-S%C3%BCd-${YEAR}.${q.includes('csv') ? 'csv' : 'json'}` } }))
  const names = captureDownload()
  show()
  fireEvent.click(await screen.findByRole('button', { name: /^Mehr/ }, SLOW))
  fireEvent.click(await screen.findByRole('button', { name: 'Als CSV exportieren' }, SLOW))
  await waitFor(() => expect(names).toEqual([`abrechnung-Süd-${YEAR}.csv`]), SLOW)
  expect(calls[0]).toContain(`/api/settlement/${YEAR}/export?format=csv`)
  fireEvent.click(screen.getByRole('button', { name: 'Als JSON exportieren' }))
  await waitFor(() => expect(names).toHaveLength(2), SLOW)
  expect(calls[1]).toContain('format=json')
  expect(screen.getByRole('button', { name: 'Als JSON exportieren' }).closest('.no-print')).not.toBeNull()
})

test('Export: eine Absage des Servers erscheint als Mitteilung, nichts wird gespeichert', async () => {
  exportFetch(() => new Response(JSON.stringify({ error: 'Der eingefrorene Stand lässt sich nicht als Daten ausgeben.' }), { status: 409, headers: { 'content-type': 'application/json' } }))
  const names = captureDownload()
  show()
  fireEvent.click(await screen.findByRole('button', { name: /^Mehr/ }, SLOW))
  fireEvent.click(await screen.findByRole('button', { name: 'Als JSON exportieren' }, SLOW))
  expect((await screen.findAllByText(/nicht als Daten ausgeben/, undefined, SLOW)).length).toBeGreaterThan(0)
  expect(names).toEqual([])
})

test('Export mit Fehlern: Rückfrage wie vor dem Drucken, „Nicht exportieren“ lädt nichts', async () => {
  settlement.notices = [HEAT_ERROR]
  const calls = exportFetch(() => null)
  const names = captureDownload()
  showWithNav(() => {})
  fireEvent.click(await screen.findByRole('button', { name: /^Mehr/ }, SLOW))
  fireEvent.click(await screen.findByRole('button', { name: 'Als JSON exportieren' }, SLOW))
  await screen.findByRole('alertdialog', { name: /Fehler/ }, SLOW)
  fireEvent.click(screen.getByRole('button', { name: 'Nicht exportieren' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), SLOW)
  expect(calls).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Als JSON exportieren' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem exportieren' }, SLOW))
  await waitFor(() => expect(names).toHaveLength(1), SLOW)
})

test('Export: bei der Heizkostenabrechnung nach Weg d gibt es die Knöpfe nicht', async () => {
  const h = { plantId: 'hp1', plantName: '', deadline: `${YEAR + 1}-04-30`, closed: null,
    period: { key: `${YEAR - 1}-05`, from: `${YEAR - 1}-05-01`, to: `${YEAR}-04-30`, short: false, label: `${YEAR - 1}/${YEAR}` } }
  const base = globalThis.fetch
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url
    if (path === '/api/heating-settlements') return json([h])
    if (path === `/api/heating-settlement/hp1/${YEAR - 1}-05`) return json({ ...settlement, period: h.period, scope: { kind: 'heating', plantId: 'hp1', plantName: '' } })
    return base(url, init)
  })
  render(
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><Abrechnung settings={null} units={[]} tenancies={TENANCIES} reload={async () => {}} focus={{ kind: 'heatingSettlement', id: `hp1|${YEAR - 1}-05` }} onFocusDone={() => {}} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>,
  )
  await screen.findByRole('button', { name: `🔒 Heizkostenabrechnung ${YEAR - 1}/${YEAR} abschließen` }, SLOW)
  const more = screen.queryByRole('button', { name: /^Mehr/ })
  if (more) fireEvent.click(more)
  expect(screen.queryByRole('button', { name: 'Als JSON exportieren' })).toBeNull()
})

// ---------- Die Seite in drei Zonen und die Vorschau je Mieter ----------

const SECOND: Statement = { ...STATEMENT, tenancyId: 't2', tenantName: 'Schulz', unitName: 'OG', balanceCents: 2500, prepaymentOverridden: false,
  rows: [{ ...STATEMENT.rows[0]!, steps: [{ label: 'Rechnungsbetrag', value: '600,00 €' }] }] }

test('Übersicht: eine Zeile je Mieter mit Ergebnis, ohne Abrechnung mit Grund, kein Rechenweg-Knopf je Zeile', async () => {
  settlement.statements = [STATEMENT, SECOND]
  settlement.notSettled = [{ tenancyId: 't3', tenantName: 'Paul', unitName: 'Garage', costModel: 'flatRate', heatingModel: 'settlement' }]
  show()
  const table = await screen.findByRole('table', { name: 'Abrechnungen je Mieter' }, SLOW)
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringMatching(/^Meier.*EG.*Nachzahlung 100,00\s€.*Ansehen/),
    expect.stringMatching(/^Schulz.*OG.*Guthaben 25,00\s€.*Ansehen/),
    expect.stringMatching(/^Paul.*Garage.*Ohne Abrechnung: Nebenkosten als Pauschale$/),
  ])
  expect(screen.queryByRole('button', { name: /^Rechenweg/ })).toBeNull()
  expect(screen.queryByText('Ohne Abrechnung')).toBeNull()
})

test('Vorschau: Fokus auf die Überschrift, Blättern zum nächsten Mieter, zurück mit Fokus auf „Ansehen“', async () => {
  settlement.statements = [STATEMENT, SECOND]
  show()
  const ansehen = await screen.findByRole('button', { name: 'Ansehen (Schulz, OG)' }, SLOW)
  fireEvent.click(screen.getByRole('button', { name: 'Ansehen (Meier, EG)' }))
  const heading = await screen.findByRole('heading', { name: 'Vorschau: Meier · EG' }, SLOW)
  await waitFor(() => expect(document.activeElement).toBe(heading))
  // In der Vorschau keine Übersicht und kein „Zu prüfen“
  expect(screen.queryByRole('table', { name: 'Abrechnungen je Mieter' })).toBeNull()
  // Nur die Abrechnung der Vorschau steht am Bildschirm, die übrigen bleiben für den Druck im Dokument.
  const cards = [...document.querySelectorAll('.card.statement')]
  expect(cards.map((c) => c.classList.contains('statement-hidden'))).toEqual([false, true])
  expect((screen.getByRole('button', { name: /^‹ Vorheriger Mieter/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Nächster Mieter › (Schulz)' }))
  const second = await screen.findByRole('heading', { name: 'Vorschau: Schulz · OG' }, SLOW)
  await waitFor(() => expect(document.activeElement).toBe(second))
  expect([...document.querySelectorAll('.card.statement')].map((c) => c.classList.contains('statement-hidden'))).toEqual([true, false])
  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück zur Übersicht' }))
  await screen.findByRole('table', { name: 'Abrechnungen je Mieter' }, SLOW)
  await waitFor(() => expect(document.activeElement?.textContent).toBe(ansehen.textContent))
  expect([...document.querySelectorAll('.card.statement')].every((c) => c.classList.contains('statement-hidden'))).toBe(true)
})

test('Vorschau: ein Schalter „Rechenweg zeigen“ für die ganze Aufstellung, nie im Druck', async () => {
  settlement.statements = [SECOND]
  show()
  fireEvent.click(await screen.findByRole('button', { name: /^Ansehen/ }, SLOW))
  const toggle = await screen.findByRole('checkbox', { name: 'Rechenweg zeigen' }, SLOW)
  expect(document.querySelectorAll('tr.calc-steps')).toHaveLength(0)
  fireEvent.click(toggle)
  const steps = document.querySelectorAll('tr.calc-steps')
  expect(steps).toHaveLength(1)
  expect(steps[0]?.classList.contains('no-print')).toBe(true)
  expect(steps[0]?.textContent).toContain('Rechnungsbetrag: 600,00 €')
  expect(toggle.closest('.no-print')).not.toBeNull()
})

// Durchsicht M1 und K3: Was ein Hinweis an Beträgen, Kürzungen und Aufforderungen trägt, steht offen da, wie beim Baustein
// Notice; eingeklappt ist nur „Mehr dazu“. Kein einzelner Betrag als Kopf (bei co2.missing war das der Anteil des ersten
// Mieters). Zusammengefasst werden nur stille Hinweise, „Hier beheben →“ ist bei jedem offenen ohne Aufklappen erreichbar.
const shown = (el: Element) => !el.closest('details:not([open])') && !el.closest('[hidden]')
test('Zu prüfen: Fehler und Warnungen offen mit allen Beträgen, Hinweise mit Kürzung offen, stille Hinweise in einer Zeile', async () => {
  settlement.notices = [
    { code: 'h1', level: 'hint', title: 'Leerstand', text: 'Ein Hinweis.' },
    { code: 'co2.missing', level: 'warning', title: 'CO₂-Angaben fehlen', text: sample('co2.missing'), subject: { kind: 'tenancy', id: 't1' } },
    HEAT_ERROR,
    { code: 'co2.fuel-unknown', level: 'hint', title: 'Brennstoff unbekannt', text: sample('co2.fuel-unknown'), subject: { kind: 'heatingPlant', id: '' } },
    { code: 'h2', level: 'hint', title: 'Schlüssel geändert', text: 'Noch ein Hinweis.' },
  ]
  const nav = vi.fn()
  showWithNav(nav)
  const card = (await screen.findByRole('heading', { name: 'Zu prüfen' }, SLOW)).closest('section') as HTMLElement
  expect(shown(within(card).getByText('Heizkostenabrechnung unvollständig'))).toBe(true)
  // Die Warnung: alle Beträge je Mieter sichtbar, kein Einzelbetrag als Kopf.
  for (const part of [/Mieter A \(A\) 58,86 €/, /Mieter B \(B\) 78,48 €/, /Mieter C2 \(C\) 22,52 €/]) expect(shown(within(card).getByText(part))).toBe(true)
  expect(card.textContent).not.toMatch(/CO₂-Angaben fehlen · /)
  // Der Hinweis mit Kürzung und Beträgen steht offen.
  expect(shown(within(card).getByText(/Zora \(Wohnung B\) 15,00 €/))).toBe(true)
  // Nur die stillen Hinweise zusammengefasst
  const group = within(card).getByText('2 Hinweise (Leerstand, Schlüssel geändert)')
  expect(group.closest('summary')).not.toBeNull()
  expect(shown(within(card).getByText('Ein Hinweis.'))).toBe(false)
  // „Hier beheben →“ ohne Aufklappen
  const fixes = within(card).getAllByRole('button', { name: 'Hier beheben → Stammdaten' })
  expect(fixes).toHaveLength(2)
  for (const f of fixes) expect(shown(f)).toBe(true)
  expect(shown(within(card).getByRole('button', { name: 'Heizung einrichten →' }))).toBe(true)
  fireEvent.click(fixes[1] ?? assert.fail('kein Knopf'))
  expect(nav).toHaveBeenCalledWith('stammdaten', { kind: 'tenancy', id: 't1' })
})

// Durchsicht K4: Hat die Abrechnung Fehler, sagt es die Vorschau eines Mieters, mit dem Weg zurück zu „Zu prüfen“.
test('Vorschau mit Fehlern: ein Satz mit der Zahl und der Rücksprung zu „Zu prüfen“, nie im Druck', async () => {
  settlement.notices = [HEAT_ERROR, { ...HEAT_ERROR, title: 'Zweiter Fehler' }]
  show()
  fireEvent.click(await screen.findByRole('button', { name: /^Ansehen/ }, SLOW))
  const note = await screen.findByText('Diese Abrechnung hat 2 Fehler; sie stehen unter „Zu prüfen“.', {}, SLOW)
  expect(note.closest('.no-print')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Zurück zu „Zu prüfen“' }))
  const heading = await screen.findByRole('heading', { name: 'Zu prüfen' }, SLOW)
  await waitFor(() => expect(document.activeElement).toBe(heading.closest('section')))
})
test('Vorschau ohne Fehler: kein Satz zu Fehlern', async () => {
  settlement.notices = [{ code: 'w', level: 'warning', title: 'Warnung', text: 'W' }]
  show()
  fireEvent.click(await screen.findByRole('button', { name: /^Ansehen/ }, SLOW))
  await screen.findByRole('heading', { name: /^Vorschau/ }, SLOW)
  expect(screen.queryByText(/Diese Abrechnung hat \d+ Fehler/)).toBeNull()
})

// Durchsicht K5: Die früheren Abschlüsse stehen auch im leeren Zeitraum da.
test('frühere Abschlüsse auch ohne Kosten und ohne Kopfzeile', async () => {
  settlement = { ...settlement, statements: [], totalCostsCents: 0, landlord: { rows: [], totalCents: 0 } }
  history = [{ id: 'h1', closedAt: `${YEAR + 1}-01-10T10:00:00Z`, reopenedAt: `${YEAR + 1}-01-20T10:00:00Z`, sentAt: null, settlement: settlement }]
  show()
  expect(await screen.findByText('Frühere Abschlüsse dieses Jahres (1)', {}, SLOW)).toBeTruthy()
})

test('Drucken: „Abbrechen“ im Fenster stellt Häkchen und „Anschreiben mitdrucken“ wieder her', async () => {
  const puts: unknown[] = []
  stubSettings(puts)
  showWithSettings(SETTINGS, async () => {})
  await openPrintSettings()
  const drawer = await printDrawer()
  const letter = within(drawer).getByRole('checkbox', { name: /Anschreiben mitdrucken/ }) as HTMLInputElement
  expect(letter.checked).toBe(true)
  fireEvent.click(letter)
  fireEvent.click(await foldBox())
  fireEvent.click(within(drawer).getByRole('button', { name: 'Abbrechen' }))
  fireEvent.click(within(await screen.findByRole('alertdialog', {}, SLOW)).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Drucken' })).toBeNull(), SLOW)
  expect(screen.queryByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeNull()
  await openPrintSettings()
  expect((await foldBox()).checked).toBe(false)
  expect((within(await printDrawer()).getByRole('checkbox', { name: /Anschreiben mitdrucken/ }) as HTMLInputElement).checked).toBe(true)
  expect(puts).toEqual([])
})

test('Drucken: „Was drucken?“ wählt alle Mieter oder einen; alle ohne Seitenzahl, einer mit', async () => {
  settlement.statements = [STATEMENT, SECOND]
  window.print = vi.fn()
  show()
  await openPrintSettings()
  const scope = within(await printDrawer()).getByRole('combobox', { name: 'Was drucken?' }) as HTMLSelectElement
  expect([...scope.options].map((o) => o.text)).toEqual(['Alle Mieter (2)', 'Meier (EG)', 'Schulz (OG)'])
  fireEvent.click(within(await printDrawer()).getByRole('button', { name: 'Drucken' }))
  await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), SLOW)
  expect(printing()).toBe(false)
  expect(document.querySelector('style[data-page-numbers]')).toBeNull()
  // Die nächste Bedienung räumt den Druck auf (printJob.ts), dann einer allein.
  fireEvent.pointerDown(document.body)
  await openPrintSettings()
  fireEvent.change(within(await printDrawer()).getByRole('combobox', { name: 'Was drucken?' }), { target: { value: 't2' } })
  fireEvent.click(within(await printDrawer()).getByRole('button', { name: 'Drucken' }))
  await waitFor(() => expect(printing()).toBe(true), SLOW)
  expect(document.querySelector('.card.statement.print-target')?.textContent).toContain('Schulz')
  expect(document.querySelector('style[data-page-numbers]')).not.toBeNull()
})

// Durchsicht K2: Wer im Fenster „Drucken“ die Druckeinstellungen speichert und danach „Abbrechen“ wählt, wird nicht
// mehr nach Verwerfen gefragt, und ein Entwurf von vorher lebt nicht wieder auf.
test('Drucken: nach „Speichern“ schließt „Abbrechen“ ohne Rückfrage und stellt keinen alten Entwurf her', async () => {
  const puts: unknown[] = []
  stubSettings(puts)
  window.print = vi.fn()
  let current: Settings = SETTINGS
  const tree = () => (
    <PeriodProvider>
      <PropertyProvider>
        <UIProvider><PeriodSelect /><Abrechnung settings={current} units={[]} tenancies={TENANCIES} reload={reload} /></UIProvider>
      </PropertyProvider>
    </PeriodProvider>
  )
  // Wie die App: Nach dem Speichern kommen die Einstellungen neu vom Server.
  async function reload() {
    const last = puts.at(-1)
    if (last && typeof last === 'object') current = { ...current, ...(last as Partial<Settings>) }
    view.rerender(tree())
  }
  const view = render(tree())
  // Ein Entwurf von vorher: Falzmarken an, gedruckt, nicht gespeichert.
  await openPrintSettings()
  fireEvent.click(await foldBox())
  fireEvent.click(within(await printDrawer()).getByRole('button', { name: 'Drucken' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Drucken' })).toBeNull(), SLOW)
  // Im Fenster dazu die Belegkopien, dann beides gespeichert.
  await openPrintSettings()
  fireEvent.click(attachBox())
  fireEvent.click(within(await printDrawer()).getByRole('button', { name: 'Speichern (Druckeinstellungen)' }))
  await waitFor(() => expect(puts).toEqual([{ printFoldMarks: true, printAttachments: true, printFooter: false }]), SLOW)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeNull(), SLOW)
  fireEvent.click(within(await printDrawer()).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Drucken' })).toBeNull(), SLOW)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Speichern (Druckeinstellungen)' })).toBeNull()
  await openPrintSettings()
  expect((await foldBox()).checked).toBe(true)
  expect(attachBox().checked).toBe(true)
})

// Leistungsprüfung mit großem Bestand: Derselbe Hinweis je Mieter füllte als eigener Kasten zwei Drittel der Seite.
// Mit vier Mietern steht „Rückstand im Mietkonto“ einmal da, mit jedem Namen, jedem Betrag und je einem „Hier beheben →“.
test('Zu prüfen: gleicher Hinweis bei vier Mietern steht in einem Kasten, jeder Betrag bleibt sichtbar', async () => {
  const four = [['t1', 'Meier', 'EG', '374,80 €'], ['t2', 'Schulz', 'OG', '408,00 €'], ['t3', 'Wagner', 'DG', '180,00 €'], ['t4', 'Becker', 'UG', '200,00 €']] as const
  const text = sample('prepayment.arrears')
  settlement.statements = four.map(([id, name, unit]) => ({ ...STATEMENT, tenancyId: id, tenantName: name, unitName: unit }))
  settlement.notices = four.map(([id, name, unit, open]): Notice => ({
    code: 'prepayment.arrears', level: 'warning', title: 'Rückstand im Mietkonto', text: text.replace('u3 (W3)', `${name} (${unit})`).replace('140,00 €', open), subject: { kind: 'rentLedger', id },
  }))
  const nav = vi.fn()
  showWithNav(nav)
  const card = (await screen.findByRole('heading', { name: 'Zu prüfen' }, SLOW)).closest('section') ?? assert.fail('keine Karte')
  expect(within(card).getAllByText('Rückstand im Mietkonto')).toHaveLength(1)
  expect(card.textContent).toContain('Betrifft 4 Mietverhältnisse:')
  for (const [, name, unit, open] of four) {
    expect(within(card).getByText(`${name} (${unit})`, { selector: 'strong' })).toBeTruthy()
    expect(card.textContent).toContain(open)
  }
  // Der gemeinsame Text einmal
  expect(card.textContent?.split('tragen Sie die Zahlung im Mietkonto nach')).toHaveLength(2)
  // Durchsicht K2: Der Knopf nennt den Mieter (für Vorleser), der Titel beschreibt ihn wie bei einem einzelnen Hinweis.
  const fixes = within(card).getAllByRole('button', { name: /^Hier beheben → Mietkonto / })
  expect(fixes.map((k) => k.textContent)).toEqual(['Hier beheben → Mietkonto Meier (EG)', 'Hier beheben → Mietkonto Schulz (OG)', 'Hier beheben → Mietkonto Wagner (DG)', 'Hier beheben → Mietkonto Becker (UG)'])
  expect(fixes.map((k) => document.getElementById(k.getAttribute('aria-describedby') ?? '')?.textContent)).toEqual(Array(4).fill('Rückstand im Mietkonto'))
  fireEvent.click(fixes[2] ?? assert.fail('kein dritter Knopf'))
  expect(nav).toHaveBeenCalledWith('mietkonto', { kind: 'rentLedger', id: 't3' })
})

// #470: Ein Beleg, der nur über eine gebuchte Zeile an der Position hängt, liegt den Belegkopien bei; die Seite lädt dafür
// GET /api/uploads. Scheitert das, druckt sie weiter, mit den Belegen aus `invoiceFile`.
const GRUNDSTEUER: CostItem = {
  id: 'k1', propertyId: 'objekt-1', period: calendarPeriod(YEAR), category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 60000, key: 'area', vendor: 'Stadtkasse',
}
const BESCHEID: UploadEntry = {
  file: '2_bescheid.pdf', size: 10, mtime: '2026-01-02T10:00:00.000Z', originalName: 'bescheid.pdf', mimeType: 'application/pdf', uploadedAt: '2026-01-02T10:00:00.000Z',
  sha256: 'sha', propertyId: null, year: null, invoiceDate: null, kind: 'receipt', bookedItemIds: ['k1'], bookedCents: { k1: 60000 }, assessment: null,
}
function stubReceipts(uploads: 'fail' | UploadEntry[] | Promise<UploadEntry[]>, item: CostItem = GRUNDSTEUER) {
  const before = globalThis.fetch
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const path = url.split('?')[0] ?? url
    if (path === '/api/costItems') return json([item])
    if (path === '/api/uploads') return uploads === 'fail' ? json({ error: 'Liste kaputt' }, 500) : json(await uploads)
    return before(url, init)
  })
}

test('Belegkopien: ein nur über eine gebuchte Zeile verknüpfter Beleg liegt bei (#470)', async () => {
  stubReceipts([BESCHEID])
  showWithSettings({ ...SETTINGS, printAttachments: true }, async () => {})
  expect(await screen.findByText('Anlage beim Druck: Stadtkasse — Grundsteuer', {}, SLOW)).toBeTruthy()
})

test('Belegkopien: scheitert die Liste der Belege, bleibt der Beleg der Position, ohne Fehler (#470)', async () => {
  stubReceipts('fail', { ...GRUNDSTEUER, invoiceFile: '1_eigen.pdf' })
  showWithSettings({ ...SETTINGS, printAttachments: true }, async () => {})
  expect(await screen.findByText('Anlage beim Druck: Stadtkasse — Grundsteuer', {}, SLOW)).toBeTruthy()
  expect(screen.getByRole('button', { name: /Drucken \/ PDF/ })).toBeTruthy()
  expect(screen.queryByText(/Liste kaputt/)).toBeNull()
})

// Durchsicht zu #470: Solange die Liste der Belege fehlt, fehlten den Belegkopien die gebuchten Belege, und der Druck
// lief trotzdem. Jetzt wartet „Drucken“, bis die Liste da ist (oder gescheitert).
test('Belegkopien: Drucken wartet auf die Liste der gebuchten Belege (#470)', async () => {
  let release: (list: UploadEntry[]) => void = () => assert.fail('Liste nicht angefragt')
  stubReceipts(new Promise<UploadEntry[]>((resolve) => { release = resolve }), { ...GRUNDSTEUER, invoiceFile: '1_eigen.pdf' })
  showWithSettings({ ...SETTINGS, printAttachments: true }, async () => {})
  await openPrintSettings()
  const knopf = within(await printDrawer()).getByRole('button', { name: 'Drucken' }) as HTMLButtonElement
  expect(knopf.disabled).toBe(true)
  expect(within(await printDrawer()).getByText('Belegkopien werden noch vorbereitet …')).toBeTruthy()
  release([BESCHEID])
  expect(await screen.findByText('Anlage beim Druck: Stadtkasse — Grundsteuer', {}, SLOW)).toBeTruthy()
})
