// @vitest-environment jsdom
// Sammelbetrag des Messdienstes (#704): der Haken „enthält auch Kaltwasser und Abwasser“ an der Position und die Antwort
// „liegt bei“ der Karte „CO₂-Kosten“. Erst die Logik der Formulare (reine Module), dann, was nur der Browser zeigt: Die
// Auswahl zeigt den gespeicherten Wert, und gespeichert wird, was sie zeigt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fmtEuro } from './api'
import { buildCostItemBody, EMPTY_ITEM_FORM, INCLUDES_WATER_CO2_HELP, INCLUDES_WATER_HELP, INCLUDES_WATER_LABEL, itemToForm, showsIncludesWater, waterTwiceHints, type ItemForm } from './costForm'
import { carryOverForm, carryOverRows } from './carryOver'
import { CO2_ANSWER_OPTIONS, CO2_ENCLOSED_TAX, co2AnswerLabel, co2Body, co2EnclosedHelp, co2ToForm, includesWaterNote, probeLine, type Co2Context } from './co2Form'
import { co2Block, co2EnclosedReference } from './co2View'
import Co2Block from './components/Co2Block'
import Co2Card from './components/Co2Card'
import { UIProvider } from './components/feedback'
import { fieldLabel, formatValue } from './journalView'
import { noInfoView } from './testing/heatingView'
import { CO2_ENCLOSED_LABEL, CO2_ENCLOSED_LABEL_HOMEOWNERS } from '../../shared/co2Probe.ts'
import { categoryLabelOf, INCLUDES_WATER_SUFFIX } from '../../shared/includesWater.ts'
import { calendarPeriod, periodKey } from '../../shared/period.ts'
import type { Co2Assessment, Co2Statement, CostItem, HeatingPeriodView, HeatingStatement, Tenancy, Unit } from './types'

const HEATING = 'Heizung und Warmwasser'
const UNITS: Unit[] = [{ id: 'u1', propertyId: 'p', name: 'EG', areaM2: 50, participates: true }]
const TENANCIES: Tenancy[] = [{ id: 't1', unitId: 'u1', tenantName: 'Mieter Eins', persons: 1, personHistory: [], start: '2020-01-01', end: null, prepayments: [], prepaymentOverrides: {}, baseRents: [] }]
const sammel: CostItem = {
  id: 'hz', propertyId: 'p', period: calendarPeriod(2025), category: HEATING, description: 'Abrechnung des Messdienstes', amountCents: 182340, key: 'amounts',
  tenancyAmounts: { t1: 182340 }, includesWater: true,
}

// ---------- Bezeichnung ----------

test('Bezeichnung: mit der Angabe der Zusatz, ohne sie wortgleich die Kostenart', () => {
  expect(categoryLabelOf({ category: HEATING, includesWater: true })).toBe(`${HEATING} ${INCLUDES_WATER_SUFFIX}`)
  expect(categoryLabelOf({ category: HEATING, includesWater: true })).toBe('Heizung und Warmwasser einschließlich Kaltwasser und Abwasser (laut Abrechnung des Messdienstes)')
  expect(categoryLabelOf({ category: HEATING })).toBe(HEATING)
  expect(categoryLabelOf({ category: 'Grundsteuer', includesWater: false })).toBe('Grundsteuer')
})

// ---------- Kostenformular ----------

test('Haken: nur bei „Heizung und Warmwasser“ mit Einzelbeträgen; gespeicherter Wert ins Formular und zurück in den Rumpf', () => {
  expect(showsIncludesWater({ category: HEATING, key: 'amounts' })).toBe(true)
  expect(showsIncludesWater({ category: HEATING, key: 'area' })).toBe(false)
  expect(showsIncludesWater({ category: 'Wasser/Abwasser', key: 'amounts' })).toBe(false)
  expect(EMPTY_ITEM_FORM.includesWater).toBe(false)
  const form = itemToForm(sammel)
  expect(form.includesWater).toBe(true)
  const built = buildCostItemBody(form, UNITS, 2025, TENANCIES)
  expect(built).toMatchObject({ body: { category: HEATING, key: 'amounts', includesWater: true } })
  // Ohne Haken schickt das Formular `false`, das eine gespeicherte Angabe entfernt.
  expect(buildCostItemBody({ ...form, includesWater: false }, UNITS, 2025, TENANCIES)).toMatchObject({ body: { includesWater: false } })
  // Wechselt die Kostenart oder der Schlüssel, wird der Haken nicht mitgeschickt, auch wenn er im Formular noch steht.
  expect(buildCostItemBody({ ...form, category: 'Wasser/Abwasser' }, UNITS, 2025, TENANCIES)).toMatchObject({ body: { includesWater: false } })
  expect(buildCostItemBody({ ...form, key: 'area', tenancyAmounts: {} }, UNITS, 2025, TENANCIES)).toMatchObject({ body: { includesWater: false } })
  // Eine Position ohne die Angabe (jede von vorher) kommt ohne Haken ins Formular.
  const { includesWater: _weg, ...alt } = sammel
  expect(itemToForm(alt).includesWater).toBe(false)
})

test('Hilfesatz am Haken: Bezeichnung, Beilage, die offene Frage, keine zweite Wasserposition, CO₂-Probe und Steuer', () => {
  expect(INCLUDES_WATER_LABEL).toBe('Der Betrag enthält auch Kaltwasser und Abwasser (der Messdienst rechnet sie in einem Betrag je Nutzer ab)')
  expect(INCLUDES_WATER_HELP).toContain('„Heizung und Warmwasser einschließlich Kaltwasser und Abwasser (laut Abrechnung des Messdienstes)“')
  expect(INCLUDES_WATER_HELP).toContain('Legen Sie jedem Mieter die Einzelabrechnung des Messdienstes bei')
  expect(INCLUDES_WATER_HELP).toContain('ist nicht entschieden')
  expect(INCLUDES_WATER_HELP).toContain('Eine eigene Position „Wasser/Abwasser“ für dieselben Kosten legen Sie dann nicht an.')
  expect(INCLUDES_WATER_CO2_HELP).toContain(`„${CO2_ENCLOSED_LABEL}“`)
  expect(INCLUDES_WATER_CO2_HELP).toContain('Summe aller Nutzer plus diesen Anteil')
  // Keine erfundene Fundstelle zur offenen Frage.
  expect(INCLUDES_WATER_HELP).not.toMatch(/§|BGH|Az\./)
})

test('Doppelerfassung im Formular: derselbe Satz wie in der Abrechnung, nur mit Haken und nur für Wasserpositionen des Zeitraums', () => {
  const form: ItemForm = itemToForm(sammel)
  const wasser = { id: 'w', category: 'Wasser/Abwasser', description: 'Stadtwerke Wasser', amountCents: 64000 }
  const andere = { id: 'g', category: 'Grundsteuer', description: 'Grundsteuer', amountCents: 50000 }
  const hints = waterTwiceHints(form, [wasser, andere])
  expect(hints).toHaveLength(1)
  expect(hints[0]).toContain(`„Abrechnung des Messdienstes“ (${fmtEuro(182340)})`)
  expect(hints[0]).toContain(`„Stadtwerke Wasser“ (${fmtEuro(64000)})`)
  expect(hints[0]).toMatch(/Prüfen Sie/)
  expect(hints[0]).toMatch(/Gartenwasser/)
  expect(waterTwiceHints({ ...form, includesWater: false }, [wasser])).toEqual([])
  expect(waterTwiceHints({ ...form, key: 'area' }, [wasser])).toEqual([])
  expect(waterTwiceHints(form, [andere])).toEqual([])
  // Eine neue Position ohne Beschreibung und Betrag nennt sich selbst ohne erfundene Zahl.
  expect(waterTwiceHints({ ...form, description: ' ', amount: '' }, [wasser])[0]).toContain('„Diese Position“ (Betrag noch offen)')
})

test('Aus dem Vorjahr übernehmen: der Haken kommt mit ins Formular, die Einzelbeträge nicht', () => {
  const rows = carryOverRows([sammel], 2026)
  const row = rows[0]
  if (!row) throw new Error('keine Vorlage')
  const form = carryOverForm(row)
  expect([form.category, form.key, form.includesWater, form.tenancyAmounts]).toEqual([HEATING, 'amounts', true, {}])
})

test('Verlauf: die Spalte hat eine Beschriftung und liest sich als ja oder nein', () => {
  expect(fieldLabel('includes_water', 'cost_items')).toBe('Betrag enthält auch Kaltwasser und Abwasser')
  expect(formatValue('includes_water', 1, 'cost_items')).toBe('ja')
  expect(formatValue('includes_water', null, 'cost_items')).toBe('leer')
})

// ---------- Karte „CO₂-Kosten“: Logik ----------

const item = (over: Partial<HeatingPeriodView['items'][number]> = {}): HeatingPeriodView['items'][number] => ({ id: 'hz', description: 'Abrechnung des Messdienstes', amountCents: 182340, key: 'amounts', tenancyAmounts: { t1: 182340 }, ...over })
const ctx = (items: HeatingPeriodView['items'], homeowners = false): Co2Context => ({ items, unitsCount: 1, homeowners })
const statement = (over: Partial<Co2Statement> = {}): Co2Statement => ({
  heatingPeriodId: 'h', plantId: 'hp', period: periodKey('2025-01'), method: 'serviceEnclosed', areaM2: null, serviceEmissionsKg: null,
  serviceAreaM2: null, serviceKgPerM2: null, serviceLandlordPermille: null, serviceTotalCents: null, serviceLandlordCents: null,
  serviceUsersTotalCents: null, serviceUsersTotalApprox: false, serviceUnitsCount: null, serviceCostItemId: null, serviceSelfLandlordCents: null,
  serviceFuelGrossCents: null, serviceFuelNetCents: null, reliefs: [], ...over,
})

test('Neue Antwort: steht in der Optionsliste, kommt aus dem gespeicherten Wert und geht als Methode allein in den Rumpf', () => {
  expect(CO2_ANSWER_OPTIONS.map((o) => o.value)).toEqual(['', 'deducted', 'shown', 'unsplit', 'enclosed'])
  const option = CO2_ANSWER_OPTIONS.find((o) => o.value === 'enclosed')
  expect(option?.label).toBe('Der Messdienst hat die CO₂-Kosten aufgeteilt und weist das in seiner Abrechnung aus; ich lege sie der Abrechnung bei')
  expect(option && co2AnswerLabel(option, true)).toBe(CO2_ENCLOSED_LABEL_HOMEOWNERS)
  const form = co2ToForm(statement(), ctx([item()]))
  expect(form.answer).toBe('enclosed')
  // Keine weiteren Angaben nötig, und keine wird geschickt: Was früher gespeichert war, bleibt beim Server stehen.
  expect(co2Body(form, ctx([item()]))).toEqual({ body: { method: 'serviceEnclosed' } })
  // Auch ein halb getipptes Feld einer anderen Antwort hält das Speichern nicht auf.
  expect(co2Body({ ...form, usersTotal: 'abc', landlordCo2: '', unitsCount: '' }, ctx([item()]))).toEqual({ body: { method: 'serviceEnclosed' } })
  expect(probeLine(form, ctx([item()]))).toBeNull()
  // Die übrigen Antworten verlangen ihre Angaben wie bisher.
  expect(co2Body({ ...form, answer: 'deducted' }, ctx([item()]))).toMatchObject({ error: expect.stringMatching(/Summe der Kosten aller Nutzer/) })
})

test('Texte der neuen Antwort: Beilage, § 7 Abs. 3 und 4 CO2KostAufG ohne Prozentzahl, und die Folge für die Steuer', () => {
  const help = co2EnclosedHelp(false)
  expect(help).toContain('die übrigen Angaben dieser Karte sind nicht nötig')
  expect(help).toContain('Legen Sie deshalb jedem Mieter die Heizkostenabrechnung des Messdienstes mit dem Abschnitt zu den CO₂-Kosten bei')
  expect(help).toContain('(§ 7 Abs. 3 CO2KostAufG)')
  expect(help).toContain('(§ 7 Abs. 4 CO2KostAufG)')
  expect(help).not.toMatch(/\d\s?%/)
  expect(co2EnclosedHelp(true)).toContain('die Einzelabrechnung (Heizung) Ihrer Wohnung')
  expect(CO2_ENCLOSED_TAX).toContain('Summe aller Nutzer plus diesen Anteil')
})

test('Haken und eine Antwort mit Probe: die Karte sagt, warum die Probe nicht aufgehen kann, und nennt die neue Antwort', () => {
  const mit = ctx([item({ includesWater: true })])
  const note = includesWaterNote({ answer: 'deducted' }, mit)
  expect(note).toContain('„Abrechnung des Messdienstes“ enthält nach Ihrer Angabe auch Kaltwasser und Abwasser')
  expect(note).toContain(`„${CO2_ENCLOSED_LABEL}“`)
  expect(includesWaterNote({ answer: 'shown' }, mit)).toBe(note)
  expect(includesWaterNote({ answer: 'enclosed' }, mit)).toBeNull()
  expect(includesWaterNote({ answer: 'unsplit' }, mit)).toBeNull()
  expect(includesWaterNote({ answer: '' }, mit)).toBeNull()
  expect(includesWaterNote({ answer: 'deducted' }, ctx([item()]))).toBeNull()
  // Der Haken an einer Position ohne Einzelbeträge zählt nicht (der Server speichert ihn dort auch nicht).
  expect(includesWaterNote({ answer: 'deducted' }, ctx([item({ key: 'area', includesWater: true })]))).toBeNull()
  expect(includesWaterNote({ answer: 'deducted' }, ctx([item({ includesWater: true })], true))).toContain(`„${CO2_ENCLOSED_LABEL_HOMEOWNERS}“`)
})

// ---------- Druck: Verweis statt Block ----------

const assessment = (over: Partial<Co2Assessment> = {}): Co2Assessment => ({
  method: 'serviceEnclosed', booked: false, deducted: false, totalCents: null, landlordCents: null, landlordPermille: null, kgPerM2: null,
  emissionsKg: null, areaM2: null, stage: null, table: [], shortened: false, selfLandlordCents: null, selfApproximated: false, tenants: [],
  enclosedFor: ['t1'], enclosedBy: 'service', ...over,
})
const anlage = (co2: Co2Assessment | null): HeatingStatement => ({ plantId: 'hp', plantName: 'Gas', energy: 'gas', period: periodKey('2025-01'), from: '2025-01-01', to: '2025-12-31', co2 })

test('Abrechnung des Mieters: statt des Blocks ein Satz, der auf die beiliegende Heizkostenabrechnung verweist; nur für Mieter mit Heizkosten', () => {
  const v = co2Block(anlage(assessment()), 't1')
  expect(v).toEqual({ title: 'CO₂-Kostenaufteilung', lines: [], table: [], notes: [], reference: co2EnclosedReference(false) })
  expect(v?.reference).toBe('Die CO₂-Kosten hat der Messdienst zwischen Vermieter und Mieter aufgeteilt. Ihren Anteil an den CO₂-Kosten, die Einstufung des Gebäudes und die Berechnungsgrundlagen weist die beiliegende Heizkostenabrechnung des Messdienstes aus (§ 7 Abs. 3 CO2KostAufG).')
  expect(co2Block(anlage(assessment()), 't2')).toBeNull()
  expect(co2Block(anlage(assessment({ enclosedBy: 'homeowners' })), 't1')?.reference).toContain('die Abrechnung der Gemeinschaft')
  // Ein eingefrorener Stand ohne die Liste (gibt es nicht, aber er darf nichts Falsches drucken): kein Block.
  const { enclosedFor: _weg, ...ohne } = assessment()
  expect(co2Block(anlage(ohne), 't1')).toBeNull()
  render(<Co2Block view={v} />)
  expect(screen.getByRole('heading', { name: 'CO₂-Kostenaufteilung' })).toBeTruthy()
  expect(screen.getByText(/beiliegende Heizkostenabrechnung des Messdienstes/)).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

// ---------- Karte „CO₂-Kosten“ im Browser ----------

const view = (co2: Co2Statement | null, items: HeatingPeriodView['items'] = [item()]): HeatingPeriodView => ({
  plantId: 'hp', period: periodKey('2025-01'), label: '2025', from: '2025-01-01', to: '2025-12-31', short: false, closed: false,
  ...noInfoView(), hotWater: { dhwMethod: null, dhwUnmeasurable: null, dhwHeatKwh: null, totalHeatKwh: null, dhwVolumeM3: null, dhwTempC: null }, hotWaterBasis: { volumeFromMetersM3: null, volumeMissing: null, running: null, suppliedAreaM2: 0 }, co2, stock: null,
  items,
})
let sent: { url: string; method: string; body: Record<string, unknown> }[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const frage = (): HTMLSelectElement => {
  const el = screen.getByLabelText('Abzugszeile')
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}
const card = (v: HeatingPeriodView, onSaved: () => void = () => {}, homeowners = false) => render(<UIProvider><Co2Card view={v} tenancies={TENANCIES} unitsCount={1} homeowners={homeowners} onSaved={onSaved} /></UIProvider>)

test('Karte: die Auswahl zeigt die gespeicherte neue Antwort, ohne weitere Felder und ohne Probe; Speichern schickt genau sie', async () => {
  const saved = vi.fn()
  card(view(statement()), saved)
  expect(frage().value).toBe('enclosed')
  expect(frage().selectedOptions[0]?.textContent).toBe(CO2_ENCLOSED_LABEL)
  expect(screen.getByText(co2EnclosedHelp(false))).toBeTruthy()
  expect(screen.getByText(CO2_ENCLOSED_TAX)).toBeTruthy()
  expect(screen.queryByLabelText(/Summe der Kosten aller Nutzer/)).toBeNull()
  expect(screen.queryByLabelText(/Nutzeinheiten/)).toBeNull()
  expect(screen.queryByText(/^Probe:/)).toBeNull()
  fireEvent.click(screen.getByText('CO₂-Angaben speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent).toEqual([{ url: '/api/heating-plants/hp/periods/2025-01/co2', method: 'PUT', body: { method: 'serviceEnclosed' } }])
})

test('Karte: neue Heizperiode, Antwort gewählt, gespeichert wird der angezeigte Wert; bei der Eigentumswohnung heißt die Antwort nach der Gemeinschaft', async () => {
  const saved = vi.fn()
  card(view(null), saved)
  expect(frage().value).toBe('')
  fireEvent.change(frage(), { target: { value: 'enclosed' } })
  expect(frage().value).toBe('enclosed')
  expect(frage().selectedOptions[0]?.textContent).toBe(CO2_ENCLOSED_LABEL)
  fireEvent.click(screen.getByText('CO₂-Angaben speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent[0]?.body).toEqual({ method: 'serviceEnclosed' })
  cleanup()
  card(view(statement()), () => {}, true)
  expect(frage().selectedOptions[0]?.textContent).toBe(CO2_ENCLOSED_LABEL_HOMEOWNERS)
})

test('Karte: Haken an der Position und eine Antwort mit Probe: ein Satz nennt den Grund und die neue Antwort; ohne Haken nicht', () => {
  const deducted = statement({ method: 'serviceDeducted', serviceUsersTotalCents: 150000, serviceLandlordCents: 500, serviceUnitsCount: 1 })
  card(view(deducted, [item({ includesWater: true })]))
  expect(screen.getByText(/enthält nach Ihrer Angabe auch Kaltwasser und Abwasser/)).toBeTruthy()
  fireEvent.change(frage(), { target: { value: 'enclosed' } })
  expect(screen.queryByText(/enthält nach Ihrer Angabe auch Kaltwasser und Abwasser/)).toBeNull()
  cleanup()
  card(view(deducted))
  expect(screen.queryByText(/enthält nach Ihrer Angabe auch Kaltwasser und Abwasser/)).toBeNull()
})
