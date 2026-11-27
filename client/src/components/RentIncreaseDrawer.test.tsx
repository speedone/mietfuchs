// @vitest-environment jsdom
// Das Seitenfenster „Mieterhöhung“ (#191): Auswahlfelder zeigen den vorbelegten Wert, die Rechnung geht mit genau diesem
// Wert an den Server, der Zustand steht als Wort da (PR 2). PR 3: Eingaben des Schreibens mit Auswahlfeldern, Entwurf mit
// der Marke des Plans, Liste der Verlangen mit Rückfrage vor jeder Antwort.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import RentIncreaseDrawer from './RentIncreaseDrawer'
import { UIProvider } from './feedback'
import type { Property, RentIncreaseBasis, RentIncreasePlan, RentIncreaseView, Settings, Tenancy, Unit } from '../types'

const TENANCY: Tenancy = {
  id: 't1', unitId: 'u1', tenantName: 'Erika Mustermann', persons: 1, personHistory: [], start: '2020-01-01', end: null,
  prepayments: [], prepaymentOverrides: {}, baseRents: [{ from: '2020-01', monthlyCents: 50000 }], rentKind: 'free', rentIncreaseExcluded: false,
}
const UNIT: Unit = { id: 'u1', propertyId: 'p1', name: 'EG', areaM2: 60, participates: true }
const PROPERTY = { id: 'p1', name: 'Haus', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, rentCapReduced: true } satisfies Property
const PLAN: RentIncreasePlan = {
  kind: 'comparison', state: 'notYet', reasons: ['Am 20.11.2026 ist es noch zu früh.'], warnings: [], needs: [], currentCents: 50000, currentSince: '2020-01-01',
  receivedOn: '2026-11-20', today: '2026-11-20', capBaseDay: null, earliestReceivedOn: '2026-12-02', effectiveFrom: '2027-03', earliestEffectiveFrom: '2027-03', consent: null, cap: null,
  comparison: null, index: null, maxCents: null, newCents: null, steps: [], staggered: null, legalValues: [], refusals: [],
}

let sent: { url: string; method: string; body: Record<string, unknown> }[]
let reply: (body: Record<string, unknown>) => RentIncreasePlan
let increases: RentIncreaseView[]
// Ob die Gestaltung ein Briefpapier nennt (GET /api/letter-design).
let paper: boolean
beforeEach(() => {
  sent = []
  increases = []
  paper = false
  // Ein Browser, der Ränder je Druckseite kann (Chromium, Firefox); jsdom kennt die Eigenschaft nicht.
  vi.stubGlobal('CSS', { supports: () => true })
  reply = () => PLAN
  vi.stubGlobal('fetch', async (address: string, init?: RequestInit) => {
    // Die Aufrufe nennen das gewählte Objekt (#692, Wächter in objektBeimAendern.test.tsx); verglichen wird der Pfad.
    const url = address.split('?')[0] ?? address
    const method = init?.method ?? 'GET'
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    sent.push({ url, method, body })
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })
    if (url.endsWith('/rent-increases') && method === 'GET') return json(increases)
    if (url.endsWith('/rent-increase/plan')) return json({ ...reply(body), token: 'marke-1' })
    if (url.startsWith('/api/letter-design')) return json({ installation: { logo: null, paper: paper ? { file: 'paper-0123456789abcdef.pdf', type: 'pdf' } : null, paperNext: 'same', paperNextFile: null, margins: { top: 45, right: 20, bottom: 30, left: 25 } }, property: null })
    return json({ ok: true })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const missing = (): never => { throw new Error('Knopf fehlt') }
const plans = () => sent.filter((x) => x.url.endsWith('/rent-increase/plan'))

const open = (tenancy: Tenancy = TENANCY, property: Property | null = PROPERTY, settings: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'landlordAddress' | 'landlordContact'> | null = null) =>
  render(<UIProvider><RentIncreaseDrawer tenancy={tenancy} unit={UNIT} property={property} settings={settings} onClose={() => {}} /></UIProvider>)

test('Mieterhöhung: Auswahlfelder zeigen den vorbelegten Wert, und genau der geht an den Server', async () => {
  open()
  const kind = screen.getByLabelText('Art der Erhöhung') as HTMLSelectElement
  expect(kind.value).toBe('comparison')
  expect(kind.selectedOptions[0]?.textContent).toMatch(/Vergleichsmiete/)
  const cap = screen.getByLabelText(/Verordnung zur/) as HTMLSelectElement
  expect(cap.value).toBe('yes')
  expect(cap.selectedOptions[0]?.textContent).toMatch(/^Ja/)
  await waitFor(() => expect(plans().length).toBe(1))
  expect(plans()[0]?.method).toBe('POST')
  expect(plans()[0]?.body).toMatchObject({ kind: 'comparison', rentCap: 'yes', areaM2: 60 })
  expect(await screen.findByText('Noch nicht möglich')).toBeTruthy()
  expect(screen.getByText('Am 20.11.2026 ist es noch zu früh.')).toBeTruthy()
  // „Noch nicht möglich“ ohne neue Miete: kein Schreiben.
  expect(screen.queryByRole('button', { name: /Schreiben als Entwurf anlegen/ })).toBeNull()
})

test('Mieterhöhung: bei Indexmiete ist die Art vorbelegt, ohne Angabe am Objekt „weiß nicht“; ein Wechsel rechnet neu', async () => {
  open({ ...TENANCY, rentKind: 'index' }, null)
  expect((screen.getByLabelText('Art der Erhöhung') as HTMLSelectElement).value).toBe('index')
  await waitFor(() => expect(plans().length).toBe(1))
  expect(plans()[0]?.body).toMatchObject({ kind: 'index' })
  fireEvent.change(screen.getByLabelText('Art der Erhöhung'), { target: { value: 'comparison' } })
  const cap = await screen.findByLabelText(/Verordnung zur/) as HTMLSelectElement
  expect(cap.value).toBe('unknown')
  await waitFor(() => expect(plans().length).toBe(2))
  expect(plans()[1]?.body).toMatchObject({ kind: 'comparison', rentCap: 'unknown' })
})

const POSSIBLE: RentIncreasePlan = {
  ...PLAN, state: 'possible', reasons: [], earliestReceivedOn: '2026-11-20', effectiveFrom: '2027-02', newCents: 60000, maxCents: 60000,
  consent: { consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitFrom: '2027-02-02', suitEnd: '2027-04-30' },
  comparison: { centsPerM2: 1000, areaM2: 60, rentCents: 60000, operatingCostsCents: null, limitCents: 60000 },
}
const BASIS: RentIncreaseBasis = {
  version: 1, letterDate: '2026-11-20', request: { kind: 'comparison' }, plan: POSSIBLE,
  letter: { justification: 'expert', survey: null, expert: { name: 'Dipl.-Ing. Muster', date: '2026-10-01' }, database: null, comparables: [], qualifiedSurvey: 'no', qualified: null, recipientName: 'Erika Mustermann', severalLandlords: false, allLandlordsNamed: true, allTenantsNamed: true, extraParagraph: '' },
  rentCap: { answer: 'yes', answeredOn: '2026-11-20' },
  sender: { name: 'Max Vermieter', address: 'Ahornstraße 3, 12345 Musterstadt', contact: '', returnLine: 'Max Vermieter · Ahornstraße 3, 12345 Musterstadt', footer: '' },
  recipient: ['Erika Mustermann', 'Lindenweg 12', '12345 Musterstadt'], salutation: 'Guten Tag Erika Mustermann,',
  premises: { propertyName: 'Haus', address: 'Lindenweg 12, 12345 Musterstadt', unitName: 'EG', areaM2: 60 }, inclusive: false,
  prepayments: { operatingCents: 15000, heatingCents: 0, flatRateCents: 0 }, sentPlan: null,
}
const SENT: RentIncreaseView = {
  id: 'r1', tenancyId: 't1', kind: 'comparison', createdOn: '2026-11-20', receivedOn: '2026-11-20', effectiveFrom: '2027-02', fromCents: 50000, toCents: 60000,
  basis: BASIS, status: 'sent', agreedCents: null, decidedOn: null, token: 'marke-r1',
}

test('Mieterhöhung, Schreiben: Auswahlfelder zeigen den Wert, „Bitte wählen“ beim qualifizierten Mietspiegel; Entwurf mit der Marke des Plans', async () => {
  reply = () => POSSIBLE
  open()
  const justification = await screen.findByLabelText('Begründungsmittel') as HTMLSelectElement
  expect(justification.value).toBe('survey')
  expect(justification.selectedOptions[0]?.textContent).toBe('Mietspiegel')
  const qualified = screen.getByLabelText(/qualifizierten Mietspiegel/) as HTMLSelectElement
  expect(qualified.value).toBe('')
  expect(qualified.selectedOptions[0]?.textContent).toBe('Bitte wählen')
  expect((screen.getByLabelText('Empfänger') as HTMLInputElement).value).toBe('Erika Mustermann')
  // Unvollständig: Meldungen, nichts gesendet.
  fireEvent.click(screen.getByRole('button', { name: 'Schreiben als Entwurf anlegen' }))
  await waitFor(() => expect(screen.getAllByText(/qualifizierten Mietspiegel gibt/).length).toBeGreaterThan(0))
  expect(sent.some((x) => x.url.endsWith('/rent-increases') && x.method === 'POST')).toBe(false)
  fireEvent.change(justification, { target: { value: 'expert' } })
  fireEvent.change(qualified, { target: { value: 'no' } })
  expect(qualified.value).toBe('no')
  fireEvent.change(screen.getByLabelText(/Sachverständiger/), { target: { value: 'Dipl.-Ing. Muster' } })
  fireEvent.change(screen.getByLabelText('Datum des Gutachtens'), { target: { value: '2026-10-01' } })
  fireEvent.click(screen.getByLabelText(/Mehrere Vermieter/))
  fireEvent.click(screen.getByLabelText(/alle Vermieter laut Mietvertrag/))
  fireEvent.click(screen.getByLabelText(/alle Mieter laut Mietvertrag/))
  await waitFor(() => expect(plans().length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('button', { name: 'Schreiben als Entwurf anlegen' }))
  await waitFor(() => expect(sent.some((x) => x.url === '/api/tenancies/t1/rent-increases' && x.method === 'POST')).toBe(true))
  const post = sent.find((x) => x.url === '/api/tenancies/t1/rent-increases' && x.method === 'POST')
  expect(post?.body).toMatchObject({ token: 'marke-1', request: { kind: 'comparison', rentCap: 'yes' }, letter: { justification: 'expert', qualifiedSurvey: 'no', expert: { name: 'Dipl.-Ing. Muster', date: '2026-10-01' }, recipientName: 'Erika Mustermann', severalLandlords: true } })
})

test('Mieterhöhung, Liste: Schreiben aus der Grundlage, Zustimmung erst nach Rückfrage mit dem Satz zum Schweigen', async () => {
  increases = [SENT]
  open()
  expect(await screen.findByText('Versandt')).toBeTruthy()
  expect(screen.getByText(/Zustimmungsfrist bis 01\.02\.2027/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Schreiben ansehen' }))
  expect(screen.getByText(/Gutachten des öffentlich bestellten und vereidigten Sachverständigen Dipl\.-Ing\. Muster/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Zugestimmt …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/Schweigen ist keine Zustimmung/)
  fireEvent.click(screen.getByRole('button', { name: 'Eintragen' }))
  await waitFor(() => expect(sent.some((x) => x.url === '/api/rent-increases/r1/status')).toBe(true))
  expect(sent.find((x) => x.url === '/api/rent-increases/r1/status')?.body).toMatchObject({ status: 'agreed', token: 'marke-r1', agreedCents: null })
})

test('Mieterhöhung: „bisher“ ist die heute geltende Stufe, nicht eine künftige (Durchsicht S4)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'))
  try {
    open({ ...TENANCY, rentKind: 'staggered', baseRents: [{ from: '2020-01', monthlyCents: 50000 }, { from: '2027-01', monthlyCents: 55000, reason: 'staggered' }] })
    await screen.findByText('Noch nicht möglich')
    expect(screen.getByText(/bisher/).textContent).toMatch(/bisher 500,00\s€ ab Januar 2020/)
  } finally {
    vi.useRealTimers()
  }
})

test('Mieterhöhung: das Feld „Miete am …“ nennt den Stichtag und schickt ihn mit (Durchsicht K1)', async () => {
  reply = (body) => ({ ...PLAN, state: 'blocked', needs: ['rentAtCapDate'], capBaseDay: body.effectiveFrom === '2027-05' ? '2024-05-01' : '2024-02-01' })
  open()
  const field = await screen.findByLabelText('Miete am 01.02.2024 €')
  fireEvent.change(field, { target: { value: '480' } })
  await waitFor(() => expect(plans().at(-1)?.body).toMatchObject({ rentAtCapDateCents: 48000, rentAtCapDateOn: '2024-02-01' }))
  // Ein anderer Monat verschiebt den Stichtag; die Eingabe trägt weiter ihren Tag, das Feld nennt den neuen.
  const month = screen.getByRole('textbox', { name: 'Wirksam ab' })
  fireEvent.change(month, { target: { value: '5.2027' } })
  fireEvent.blur(month)
  await waitFor(() => expect(plans().at(-1)?.body).toMatchObject({ effectiveFrom: '2027-05', rentAtCapDateOn: '2024-02-01' }))
  expect(await screen.findByLabelText('Miete am 01.05.2024 €')).toBeTruthy()
})


test('Mieterhöhung: fällt das Ende der Zustimmungsfrist auf ein Wochenende oder einen Feiertag, steht das verlängerte Datum dabei (Durchsicht K4)', async () => {
  reply = () => ({ ...PLAN, consent: { consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitFrom: '2027-02-02', suitEnd: '2027-04-30' } })
  open()
  const term = await screen.findByText(/bis 31\.01\.2027/)
  expect(term.textContent).toMatch(/nach § 193 BGB bis 01\.02\.2027/)
  expect(term.textContent).toMatch(/Wochenende oder Feiertag/)
  cleanup()
  reply = () => ({ ...PLAN, consent: { consentEnd: '2026-12-31', consentEndOnWorkday: '2026-12-31', suitFrom: '2027-01-01', suitEnd: '2027-03-31' } })
  open()
  expect((await screen.findByText(/bis 31\.12\.2026/)).textContent).not.toMatch(/§ 193/)
})

const DRAFT: RentIncreaseView = { ...SENT, id: 'r2', status: 'draft', receivedOn: null, token: 'marke-r2' }

test('Mieterhöhung, Entwurf zu früh: Karte und Rückfrage vor dem Druck sagen „Nicht vor dem … zugehen lassen“ (Durchsicht S1)', async () => {
  increases = [{ ...DRAFT, basis: { ...BASIS, plan: { ...POSSIBLE, state: 'notYet', receivedOn: '2026-12-02', earliestReceivedOn: '2026-12-02' } } }]
  open()
  expect(await screen.findByText(/Nicht vor dem 02\.12\.2026 zugehen lassen/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Drucken' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/Nicht vor dem 02\.12\.2026 zugehen lassen/)
})

test('Mieterhöhung, Liste: tatsächlicher Zugang getrennt vom Zugang, mit dem das Schreiben rechnet (Durchsicht M1)', async () => {
  increases = [{ ...SENT, receivedOn: '2026-11-25', basis: { ...BASIS, sentPlan: { ...POSSIBLE, receivedOn: '2026-11-25' } } }]
  open()
  expect(await screen.findByText(/Zugang am 25\.11\.2026/)).toBeTruthy()
  expect(screen.getByText(/Das Schreiben rechnet mit dem Zugang am 20\.11\.2026/)).toBeTruthy()
})

test('Mieterhöhung, Liste: eine Grundlage aus einer anderen Fassung zeigt einen Satz statt des Schreibens (Durchsicht K1)', async () => {
  increases = [{ ...SENT, basis: { version: 2 } as unknown as RentIncreaseBasis }]
  open()
  expect(await screen.findByText(/Dieses Schreiben stammt aus einer anderen Fassung von Mietfuchs/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Drucken' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Schreiben ansehen' })).toBeNull()
})

test('Mieterhöhung, Liste: weicht der heutige Absender vom eingefrorenen ab, steht ein Hinweis dabei (Durchsicht K2)', async () => {
  increases = [SENT]
  open(TENANCY, PROPERTY, { landlordName: 'Erika Vermieterin', iban: '', paymentDeadlineDays: 14, landlordAddress: 'Ahornstraße 3, 12345 Musterstadt', landlordContact: '' })
  expect(await screen.findByText(/„Max Vermieter“.*„Erika Vermieterin“/)).toBeTruthy()
})

test('Mieterhöhung: ein offener Entwurf steht als Hinweis oben, denn solange erinnert das Cockpit nicht (Durchsicht K7)', async () => {
  increases = [{ ...SENT, id: 'r2', status: 'draft', receivedOn: null, createdOn: '2026-11-18' }]
  open()
  expect(await screen.findByText(/Ein Entwurf vom 18\.11\.2026 ist noch offen; solange erinnert das Cockpit nicht an eine mögliche Mieterhöhung\./)).toBeTruthy()
  cleanup()
  increases = [SENT]
  open()
  await screen.findByText('Versandt')
  expect(screen.queryByText(/ist noch offen; solange erinnert/)).toBeNull()
})

// Füllt die Eingaben des Schreibens so aus, dass der Entwurf angelegt werden kann (Gutachten, kein qualifizierter Mietspiegel).
async function fillLetter() {
  fireEvent.change(await screen.findByLabelText('Begründungsmittel'), { target: { value: 'expert' } })
  fireEvent.change(screen.getByLabelText(/qualifizierten Mietspiegel/), { target: { value: 'no' } })
  fireEvent.change(screen.getByLabelText(/Sachverständiger/), { target: { value: 'Dipl.-Ing. Muster' } })
  fireEvent.change(screen.getByLabelText('Datum des Gutachtens'), { target: { value: '2026-10-01' } })
  const head = screen.getByLabelText(/alle Vermieter laut Mietvertrag/) as HTMLInputElement
  if (!head.disabled) fireEvent.click(head)
  fireEvent.click(screen.getByLabelText(/alle Mieter laut Mietvertrag/))
}
const drafts = () => sent.filter((x) => x.url === '/api/tenancies/t1/rent-increases' && x.method === 'POST')

test('Mieterhöhung: nach dem Anlegen des Entwurfs fragt „Schließen“ nicht „Änderungen verwerfen?“, nach einer weiteren Eingabe wieder', async () => {
  reply = () => POSSIBLE
  const onClose = vi.fn()
  render(<UIProvider><RentIncreaseDrawer tenancy={TENANCY} unit={UNIT} property={PROPERTY} onClose={onClose} /></UIProvider>)
  await fillLetter()
  // Ungespeichert: Schließen fragt.
  fireEvent.click(screen.getAllByRole('button', { name: 'Schließen' })[0] ?? missing())
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }))
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Schreiben als Entwurf anlegen' }))
  await waitFor(() => expect(drafts().length).toBe(1))
  await screen.findByText('Schreiben als Entwurf angelegt.')
  // Gespeichert: Die Eingaben stehen noch im Fenster, sind aber im Entwurf; Schließen fragt nicht.
  fireEvent.click(screen.getAllByRole('button', { name: 'Schließen' })[0] ?? missing())
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  // Eine Eingabe danach ist wieder ungespeichert.
  // (nach dem Anlegen rechnet das Fenster neu, die Eingaben des Schreibens stehen kurz darauf wieder da)
  fireEvent.change(await screen.findByLabelText(/Sachverständiger/), { target: { value: 'Dr. Anders' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Schließen' })[0] ?? missing())
  expect((await screen.findByRole('alertdialog')).textContent).toMatch(/Änderungen verwerfen/)
  expect(onClose).toHaveBeenCalledTimes(1)
})

const NAMELESS = { landlordName: '', iban: '', paymentDeadlineDays: 14, landlordAddress: '', landlordContact: '' }

test('Mieterhöhung, Schreiben: ohne Namen des Vermieters eine Warnung mit beiden Auswegen, der Briefkopf bleibt unbestätigt, der Entwurf entsteht', async () => {
  reply = () => POSSIBLE
  open(TENANCY, PROPERTY, NAMELESS)
  await fillLetter()
  const warning = await screen.findByText(/Es ist kein Name des Vermieters eingetragen: Im Briefkopf/)
  expect(warning.textContent).toMatch(/§ 126b BGB/)
  expect(warning.textContent).toMatch(/„Name des Vermieters“/)
  expect(warning.textContent).toMatch(/von Hand/)
  expect(warning.closest('.notice-item')?.textContent).toMatch(/Warnung/)
  const head = screen.getByLabelText(/alle Vermieter laut Mietvertrag/) as HTMLInputElement
  expect(head.disabled).toBe(true)
  expect(head.checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Schreiben als Entwurf anlegen' }))
  await waitFor(() => expect(drafts().length).toBe(1))
  expect(drafts()[0]?.body).toMatchObject({ letter: { allLandlordsNamed: false, allTenantsNamed: true } })
})

test('Mieterhöhung, Versand: bei einem Schreiben ohne Namen des Vermieters nennt die Rückfrage den Mangel, sonst nicht', async () => {
  increases = [{ ...DRAFT, basis: { ...BASIS, sender: { ...BASIS.sender, name: '' } } }]
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Als versendet speichern …' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/nennt keinen Namen des Vermieters/)
  expect(dialog.textContent).toMatch(/von Hand/)
  expect(dialog.textContent).toMatch(/§ 126b BGB/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(sent.some((x) => x.url === '/api/rent-increases/r2/send')).toBe(true))
  cleanup()
  increases = [DRAFT]
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Als versendet speichern …' }))
  expect((await screen.findByRole('alertdialog')).textContent).not.toMatch(/Namen des Vermieters/)
})

test('Mieterhöhung: nach „Entwurf löschen“ gelten die Eingaben wieder als ungespeichert, „Schließen“ fragt', async () => {
  reply = () => POSSIBLE
  const onClose = vi.fn()
  render(<UIProvider><RentIncreaseDrawer tenancy={TENANCY} unit={UNIT} property={PROPERTY} onClose={onClose} /></UIProvider>)
  await fillLetter()
  // Nach dem Anlegen kennt der Server den Entwurf; gelöscht wird er über seine Karte.
  increases = [DRAFT]
  fireEvent.click(screen.getByRole('button', { name: 'Schreiben als Entwurf anlegen' }))
  await waitFor(() => expect(drafts().length).toBe(1))
  await screen.findByText('Schreiben als Entwurf angelegt.')
  fireEvent.click(await screen.findByRole('button', { name: 'Entwurf löschen …' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }))
  await screen.findByText('Entwurf gelöscht.')
  fireEvent.click(screen.getAllByRole('button', { name: 'Schließen' })[0] ?? missing())
  expect((await screen.findByRole('alertdialog')).textContent).toMatch(/Änderungen verwerfen/)
  expect(onClose).not.toHaveBeenCalled()
})

test('Mieterhöhung: die Meldung nach einer Antwort kommt erst, wenn die Seite neu geladen hat', async () => {
  increases = [SENT]
  let loaded: () => void = () => {}
  const onChanged = vi.fn(() => new Promise<void>((resolve) => { loaded = resolve }))
  render(<UIProvider><RentIncreaseDrawer tenancy={TENANCY} unit={UNIT} property={PROPERTY} onClose={() => {}} onChanged={onChanged} /></UIProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Zugestimmt …' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Eintragen' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Zugestimmt: gespeichert.')).toBeNull()
  // Solange gilt das Fenster als beschäftigt: Schließen geht nicht.
  expect((screen.getAllByRole('button', { name: 'Schließen' })[0] as HTMLButtonElement).disabled).toBe(true)
  loaded()
  expect(await screen.findByText('Zugestimmt: gespeichert.')).toBeTruthy()
})

test('Mieterhöhung, Schreiben: mit Briefpapier ohne Namen nur eine Warnung, der Entwurf entsteht; am Objekt eingetragen gilt der Name', async () => {
  reply = () => POSSIBLE
  paper = true
  open(TENANCY, PROPERTY, NAMELESS)
  expect(await screen.findByText(/nur, wenn Ihr Briefpapier ihn trägt/)).toBeTruthy()
  expect(screen.queryByText(/Es ist kein Name des Vermieters eingetragen: Im Briefkopf/)).toBeNull()
  await fillLetter()
  fireEvent.click(screen.getByRole('button', { name: 'Schreiben als Entwurf anlegen' }))
  await waitFor(() => expect(drafts().length).toBe(1))
  cleanup()
  sent = []
  paper = false
  open(TENANCY, { ...PROPERTY, landlordName: 'Erika Eigentümerin' }, NAMELESS)
  await fillLetter()
  expect(screen.queryByText(/Es ist kein Name des Vermieters eingetragen: Im Briefkopf/)).toBeNull()
})

test('Mieterhöhung: kann der Browser kein Briefpapier je Druckseite, sagt das Fenster es, und ohne Namen warnt es wie ohne Briefpapier', async () => {
  // jsdom kennt `box-decoration-break: clone` nicht (wie Safari): Das Schreiben druckt dann ohne Briefpapier.
  vi.stubGlobal('CSS', { supports: () => false })
  reply = () => POSSIBLE
  paper = true
  increases = [DRAFT]
  open(TENANCY, PROPERTY, NAMELESS)
  expect(await screen.findByText('Briefpapier druckt dieser Browser nicht')).toBeTruthy()
  expect(await screen.findByText(/Es ist kein Name des Vermieters eingetragen: Im Briefkopf/)).toBeTruthy()
  cleanup()
  paper = false
  open(TENANCY, PROPERTY, NAMELESS)
  await screen.findByText('Entwurf')
  expect(screen.queryByText('Briefpapier druckt dieser Browser nicht')).toBeNull()
})

test('Mieterhöhung, Liste: ein Entwurf ohne Namen des Vermieters trägt den Hinweis, versandt nicht mehr', async () => {
  increases = [{ ...DRAFT, basis: { ...BASIS, sender: { ...BASIS.sender, name: '' } } }]
  open()
  expect(await screen.findByText(/Dieses Schreiben nennt keinen Namen des Vermieters/)).toBeTruthy()
  cleanup()
  increases = [DRAFT]
  open()
  await screen.findByText('Entwurf')
  expect(screen.queryByText(/Dieses Schreiben nennt keinen Namen des Vermieters/)).toBeNull()
})

test('Mieterhöhung: nach Versand und Antwort meldet das Fenster der Seite, dass sich die Staffel geändert haben kann; beim Löschen nicht', async () => {
  increases = [DRAFT]
  const onChanged = vi.fn()
  render(<UIProvider><RentIncreaseDrawer tenancy={TENANCY} unit={UNIT} property={PROPERTY} onClose={() => {}} onChanged={onChanged} /></UIProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Entwurf löschen …' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(sent.some((x) => x.method === 'DELETE')).toBe(true))
  await screen.findByText('Entwurf gelöscht.')
  expect(onChanged).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Als versendet speichern …' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
})

test('Mieterhöhung: fehlt die Art der Miete, führt „Hier beheben“ ins Mietverhältnis', async () => {
  const onEditTenancy = vi.fn()
  const { rentKind: _none, ...noKind } = TENANCY
  render(<UIProvider><RentIncreaseDrawer tenancy={noKind} unit={UNIT} property={PROPERTY} onClose={() => {}} onEditTenancy={onEditTenancy} /></UIProvider>)
  expect(screen.getByText('Art der Miete fehlt')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Hier beheben → Mietverhältnis' }))
  await waitFor(() => expect(onEditTenancy).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  // Mit Eingaben fragt der Knopf wie jedes Schließen; „Abbrechen“ bleibt im Fenster.
  fireEvent.change(screen.getByLabelText(/Vergleichsmiete/), { target: { value: '9,50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Hier beheben → Mietverhältnis' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/Änderungen verwerfen/)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(onEditTenancy).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Hier beheben → Mietverhältnis' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }))
  await waitFor(() => expect(onEditTenancy).toHaveBeenCalledTimes(2))
  cleanup()
  open()
  expect(screen.queryByText('Art der Miete fehlt')).toBeNull()
})
