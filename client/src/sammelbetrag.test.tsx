// @vitest-environment jsdom
// Sammelbetrag des Messdienstes (#704): der Haken „enthält auch Kaltwasser und Abwasser“ an der Position und die Antwort
// „liegt bei“ der Karte „CO₂-Kosten“. Erst die Logik der Formulare (reine Module), dann, was nur der Browser zeigt: Die
// Auswahl zeigt den gespeicherten Wert, und gespeichert wird, was sie zeigt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fmtEuro } from './api'
import { buildCostItemBody, EMPTY_ITEM_FORM, INCLUDES_WATER_CO2_HELP, INCLUDES_WATER_HELP, INCLUDES_WATER_LABEL, itemToForm, showsIncludesWater, waterTwiceHints, type ItemForm } from './costForm'
import { carryOverForm, carryOverRows } from './carryOver'
import { CO2_ANSWER_OPTIONS, CO2_ENCLOSED_JOINT, CO2_ENCLOSED_TAX, CO2_ENTRY_OPTIONS, CO2_ENTRY_QUESTION, CO2_EXAMPLE, CO2_NOT_A_SIGN, co2Body, co2EnclosedHelp, co2EntryLabel, co2ToForm, includesWaterNote, isEnclosed, probeLine, showsEntry, type Co2Context } from './co2Form'
import { co2Block, co2EnclosedReference } from './co2View'
import Co2Block from './components/Co2Block'
import Co2Card from './components/Co2Card'
import { UIProvider } from './components/feedback'
import { fieldLabel, formatValue } from './journalView'
import { noInfoView } from './testing/heatingView'
import { CO2_DEDUCTED_LABEL, CO2_EMISSIONS_FIELD, CO2_ENCLOSED_LABEL, CO2_ENCLOSED_LABEL_HOMEOWNERS, CO2_ENTER_LABEL } from '../../shared/co2Probe.ts'
import { categoryLabelOf, COMBINED_LINE_RISK, INCLUDES_WATER_SUFFIX } from '../../shared/includesWater.ts'
import { GLOSSARY } from '../../shared/glossary.ts'
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

test('Hilfesatz am Haken (Durchsicht S8): kurze Sätze, die Rechtslage vor der Beilage, und zur Karte „CO₂-Kosten“ nur der Verweis', () => {
  expect(INCLUDES_WATER_LABEL).toBe('Der Betrag enthält auch Kaltwasser und Abwasser (der Messdienst rechnet sie in einem Betrag je Nutzer ab)')
  // Rechtslage gelesen am 27.11.2026: Der Satz dazu steht vor der Aufforderung, die Einzelabrechnung beizulegen.
  expect(INCLUDES_WATER_HELP).toBe('Nur, wenn die Abrechnung des Messdienstes je Mieter einen einzigen Betrag für Heizung, Warmwasser, Kaltwasser und Abwasser nennt. Der Haken ändert keinen Betrag, nur die Bezeichnung der Zeile in der Abrechnung des Mieters. Eine solche Sammelzeile ist formell angreifbar: Ob die beiliegende Abrechnung des Messdienstes als Aufschlüsselung genügt, hat der Bundesgerichtshof nicht entschieden. Sicher sind getrennte Positionen für Heizung und Warmwasser sowie für Kaltwasser und Abwasser. Legen Sie jedem Mieter die Einzelabrechnung des Messdienstes bei; sie schlüsselt die Kostenarten auf. Eine eigene Position „Wasser/Abwasser“ für dieselben Kosten legen Sie dann nicht an.')
  expect(INCLUDES_WATER_HELP.indexOf('formell angreifbar')).toBeLessThan(INCLUDES_WATER_HELP.indexOf('Legen Sie jedem Mieter'))
  expect(INCLUDES_WATER_HELP).not.toMatch(/ist nicht entschieden\./)
  // Durchsicht M1: der Weg über „Ja“, und bei „nur ausgewiesen“ getrennte Positionen. Kein Steuersatz mehr an dieser Stelle.
  expect(INCLUDES_WATER_CO2_HELP).toBe(`CO₂-Kosten: Hat der Messdienst den CO₂-Anteil des Vermieters vor der Verteilung abgezogen, wählen Sie auf der Seite Heizkosten in der Karte „CO₂-Kosten“ nach „${CO2_DEDUCTED_LABEL}“ die Angabe „${CO2_ENCLOSED_LABEL}“. Weist er ihn nur aus, erfassen Sie Heizung und Warmwasser und das Wasser als getrennte Positionen, damit Mietfuchs den Anteil abziehen kann.`)
  expect(INCLUDES_WATER_CO2_HELP).not.toMatch(/Werbungskosten/)
  // Die Fundstellen stehen im Lexikon unter „Sammelzeile“, genau die belegten.
  expect(GLOSSARY.combinedLine.norm).toBe('BGH, Urteil vom 15.07.2009, VIII ZR 340/08, Rn. 19; BGH, Urteil vom 22.09.2010, VIII ZR 285/09, Rn. 40 bis 42; Urteil vom 14.02.2007, VIII ZR 1/06, Rn. 11, 12; BGH, Urteil vom 26.10.2011, VIII ZR 268/10, Rn. 11; zur Aufschlüsselung in einer Anlage BGH, Beschluss vom 06.07.2021, VIII ZR 371/19, Rn. 14; Beschluss vom 24.01.2017, VIII ZR 285/15, Rn. 5 bis 7')
  expect(GLOSSARY.combinedLine.short).toContain(COMBINED_LINE_RISK)
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
  // Durchsicht S3: gar nicht erfassen, nicht „nicht umlagefähig“.
  expect(hints[0]).toContain('Dann erfassen Sie die Rechnung des Versorgers gar nicht als eigene Position; ihre Kosten stecken schon im Betrag des Messdienstes.')
  expect(hints[0]).not.toMatch(/umlagefähige Position/)
  expect(hints[0]).toMatch(/Wasser einer Wohnung, die der Messdienst nicht abrechnet, oder Gartenwasser/)
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

// Durchsicht M1: „Liegt bei“ ist keine vierte Antwort mehr. Die Frage nach der Abzugszeile behält ihre drei Antworten;
// nur nach „Ja“ folgt die zweite Wahl, eintragen oder nicht eintragen.
test('Zweistufige Wahl: drei Antworten zur Abzugszeile, die zweite Wahl nur nach „Ja“; gespeichertes „liegt bei“ zeigt „Ja“ und „Nicht eintragen“', () => {
  expect(CO2_ANSWER_OPTIONS.map((o) => o.value)).toEqual(['', 'deducted', 'shown', 'unsplit'])
  expect(CO2_ENTRY_OPTIONS).toEqual([
    { value: 'enter', label: 'Angaben aus der Abrechnung hier eintragen (Mietfuchs prüft und druckt die CO₂-Aufteilung)' },
    { value: 'enclosed', label: 'Nicht eintragen: Die Heizkostenabrechnung des Messdienstes liegt jeder Abrechnung bei' },
  ])
  expect(CO2_ENTRY_OPTIONS[0]?.label).toBe(CO2_ENTER_LABEL)
  const enclosedOption = CO2_ENTRY_OPTIONS[1]
  expect(enclosedOption && co2EntryLabel(enclosedOption, true)).toBe(CO2_ENCLOSED_LABEL_HOMEOWNERS)
  const form = co2ToForm(statement(), ctx([item()]))
  expect([form.answer, form.entry, isEnclosed(form)]).toEqual(['deducted', 'enclosed', true])
  // Ein gespeicherter Vorwegabzug mit Angaben und eine neue Heizperiode stehen auf „eintragen“.
  expect(co2ToForm(statement({ method: 'serviceDeducted' }), ctx([item()])).entry).toBe('enter')
  expect(co2ToForm(null, ctx([item()])).entry).toBe('enter')
  // Die zweite Wahl gibt es nur nach „Ja“.
  expect(showsEntry({ answer: 'deducted', entry: 'enter' }, {})).toBe(true)
  for (const answer of ['', 'shown', 'unsplit'] as const) {
    expect(showsEntry({ answer, entry: 'enclosed' }, {})).toBe(false)
    expect(isEnclosed({ answer, entry: 'enclosed' })).toBe(false)
  }
  // Durchsicht S11: ohne CO₂-Kosten wird sie nicht angeboten, ein gespeichertes „liegt bei“ bleibt aber sichtbar.
  expect(showsEntry({ answer: 'deducted', entry: 'enter' }, { offersEnclosed: false })).toBe(false)
  expect(showsEntry({ answer: 'deducted', entry: 'enclosed' }, { offersEnclosed: false })).toBe(true)
})

test('Rumpf: „Ja“ mit „Nicht eintragen“ schickt nur die Methode; „nur ausgewiesen“ bleibt serviceShown, auch wenn die zweite Wahl noch auf „Nicht eintragen“ steht', () => {
  const form = co2ToForm(statement(), ctx([item()]))
  // Keine weiteren Angaben nötig, und keine wird geschickt: Was früher gespeichert war, bleibt beim Server stehen.
  expect(co2Body(form, ctx([item()]))).toEqual({ body: { method: 'serviceEnclosed' } })
  // Auch ein halb getipptes Feld einer anderen Antwort hält das Speichern nicht auf.
  expect(co2Body({ ...form, usersTotal: 'abc', landlordCo2: '', unitsCount: '' }, ctx([item()]))).toEqual({ body: { method: 'serviceEnclosed' } })
  expect(probeLine(form, ctx([item()]))).toBeNull()
  // „Ja“ mit „eintragen“ verlangt die Angaben wie bisher und speichert serviceDeducted.
  expect(co2Body({ ...form, entry: 'enter' }, ctx([item()]))).toMatchObject({ error: expect.stringMatching(/Summe der Kosten aller Nutzer/) })
  expect(co2Body({ ...form, entry: 'enter', usersTotal: '1.818,40', landlordCo2: '5,00', unitsCount: '1' }, ctx([item()]))).toMatchObject({ body: { method: 'serviceDeducted' } })
  // Wechselt die Antwort auf „nur ausgewiesen“, gilt die zweite Wahl nicht mehr: nie serviceEnclosed.
  expect(co2Body({ ...form, answer: 'shown', usersTotal: '1.823,40', landlordCo2: '5,00', unitsCount: '1' }, ctx([item()]))).toMatchObject({ body: { method: 'serviceShown' } })
  expect(co2Body({ ...form, answer: 'unsplit' }, ctx([item()]))).toMatchObject({ body: { method: 'selfAfterService' } })
  // Ohne Antwort auf die erste Frage passt die Meldung zu beiden Stufen: Sie nennt die Frage nach der Abzugszeile.
  expect(co2Body({ ...form, answer: '' }, ctx([item()]))).toEqual({ error: 'Bitte beantworten Sie zuerst die Frage nach der Abzugszeile.' })
})

test('Durchsicht S2: bei gemeinsamer Einstufung geht mit „liegt bei“ der Ausstoß mit, sonst nichts', () => {
  const form = { ...co2ToForm(statement(), ctx([item()])), emissionsKg: '3.000' }
  const joint: Co2Context = { ...ctx([item()]), joint: true }
  expect(co2Body(form, joint)).toEqual({ body: { method: 'serviceEnclosed', serviceEmissionsKg: 3000 } })
  expect(co2Body({ ...form, emissionsKg: '' }, joint)).toEqual({ body: { method: 'serviceEnclosed', serviceEmissionsKg: null } })
  expect(co2Body({ ...form, emissionsKg: 'viel' }, joint)).toEqual({ error: `Bitte prüfen Sie „${CO2_EMISSIONS_FIELD}“: keine Zahl ab 0.` })
  expect(co2Body(form, ctx([item()]))).toEqual({ body: { method: 'serviceEnclosed' } })
  expect(CO2_ENCLOSED_JOINT).toContain('Tragen Sie deshalb den CO₂-Ausstoß dieser Anlage aus der Abrechnung ein')
})

test('Texte zu „liegt bei“: zuerst die Voraussetzung Vorwegabzug, die Pflicht des Vermieters mit Vorbehalt, ohne Prozentzahl; Steuer mit der eigenen Wohnung', () => {
  const help = co2EnclosedHelp(false)
  expect(help).toBe('Das setzt voraus, dass der Messdienst den CO₂-Anteil des Vermieters vor der Verteilung abgezogen hat und die Beträge je Mieter ihn nicht enthalten. Weist die Abrechnung den Anteil nur aus, muss Mietfuchs ihn abziehen, sonst tragen die Mieter ihn mit. Mietfuchs prüft und bucht dann keine CO₂-Aufteilung; die Abrechnung jedes Mieters verweist auf die beiliegende Heizkostenabrechnung des Messdienstes. Nach § 7 Abs. 3 CO2KostAufG weisen Sie in der Heizkostenabrechnung den Anteil des Mieters an den CO₂-Kosten, die Einstufung des Gebäudes und die Berechnungsgrundlagen aus; fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten kürzen (§ 7 Abs. 4 CO2KostAufG). Ob der Verweis auf die beiliegende Abrechnung des Messdienstes dafür genügt, ist nicht entschieden.')
  expect(help).not.toMatch(/\d\s?%/)
  expect(co2EnclosedHelp(true)).toContain('dass die Gemeinschaft den CO₂-Anteil des Vermieters vor der Verteilung abgezogen hat')
  expect(CO2_ENCLOSED_TAX).toBe('Für die Steuer: Den CO₂-Anteil des Vermieters kennt Mietfuchs dann nicht als eigenen Posten. Wer ihn als Werbungskosten ansetzen will, nimmt als Betrag der Position die Summe aller Nutzer plus diesen Anteil. Setzen Sie den CO₂-Anteil des Vermieters als Werbungskosten an, gehört der Teil, der auf Ihre selbst bewohnte Wohnung entfällt, zu deren Eigenbetrag und ist privat.')
})

test('Haken und eine Antwort mit Probe: die Karte nennt den Grund, den Weg über „Ja“ und sagt, dass der Sammelbetrag bei „nur ausgewiesen“ nicht passt', () => {
  const mit = ctx([item({ includesWater: true })])
  const note = includesWaterNote({ answer: 'deducted', entry: 'enter' }, mit)
  expect(note).toBe(`„Abrechnung des Messdienstes“ enthält nach Ihrer Angabe auch Kaltwasser und Abwasser; die Probe vergleicht den Betrag aber mit den Kosten für Heizung und Warmwasser allein und kann so nicht aufgehen. Hat der Messdienst den CO₂-Anteil des Vermieters vor der Verteilung abgezogen, wählen Sie auf der Seite Heizkosten in der Karte „CO₂-Kosten“ nach „${CO2_DEDUCTED_LABEL}“ die Angabe „${CO2_ENCLOSED_LABEL}“. Weist die Abrechnung den Anteil nur aus, passt der Sammelbetrag nicht: Erfassen Sie dann Heizung und Warmwasser und das Wasser als getrennte Positionen, damit Mietfuchs den Anteil des Vermieters abziehen kann.`)
  expect(includesWaterNote({ answer: 'shown', entry: 'enter' }, mit)).toBe(note)
  // „Nur ausgewiesen“ bleibt eine Antwort mit Probe, gleich wo die zweite Wahl steht.
  expect(includesWaterNote({ answer: 'shown', entry: 'enclosed' }, mit)).toBe(note)
  expect(includesWaterNote({ answer: 'deducted', entry: 'enclosed' }, mit)).toBeNull()
  expect(includesWaterNote({ answer: 'unsplit', entry: 'enter' }, mit)).toBeNull()
  expect(includesWaterNote({ answer: '', entry: 'enter' }, mit)).toBeNull()
  expect(includesWaterNote({ answer: 'deducted', entry: 'enter' }, ctx([item()]))).toBeNull()
  // Der Haken an einer Position ohne Einzelbeträge zählt nicht (der Server speichert ihn dort auch nicht).
  expect(includesWaterNote({ answer: 'deducted', entry: 'enter' }, ctx([item({ key: 'area', includesWater: true })]))).toBeNull()
  expect(includesWaterNote({ answer: 'deducted', entry: 'enter' }, ctx([item({ includesWater: true })], true))).toContain(`„${CO2_ENCLOSED_LABEL_HOMEOWNERS}“`)
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
const auswahl = (name: string): HTMLSelectElement => {
  const el = screen.getByLabelText(name)
  if (!(el instanceof HTMLSelectElement)) throw new Error('keine Auswahl')
  return el
}
const frage = (): HTMLSelectElement => auswahl('Abzugszeile')
const eintragen = (): HTMLSelectElement => auswahl('CO₂-Angaben eintragen')
type CardProps = { homeowners?: boolean; offersEnclosed?: boolean; joint?: boolean }
const card = (v: HeatingPeriodView, onSaved: () => void = () => {}, props: CardProps = {}) => render(<UIProvider><Co2Card view={v} tenancies={TENANCIES} unitsCount={1} {...props} onSaved={onSaved} /></UIProvider>)

test('Karte: gespeichertes „liegt bei“ zeigt in der ersten Auswahl „Ja“, in der zweiten „Nicht eintragen“, ohne weitere Felder und ohne Probe; Speichern schickt genau das', async () => {
  const saved = vi.fn()
  card(view(statement()), saved)
  expect(frage().value).toBe('deducted')
  expect(frage().selectedOptions[0]?.textContent).toBe(CO2_DEDUCTED_LABEL)
  expect([...frage().options].map((o) => o.value)).toEqual(['', 'deducted', 'shown', 'unsplit'])
  expect(screen.getByText(CO2_ENTRY_QUESTION)).toBeTruthy()
  expect(eintragen().value).toBe('enclosed')
  expect(eintragen().selectedOptions[0]?.textContent).toBe(CO2_ENCLOSED_LABEL)
  expect(screen.getByText(co2EnclosedHelp(false))).toBeTruthy()
  expect(screen.getByText(CO2_ENCLOSED_TAX)).toBeTruthy()
  // Beispielzeile und der Satz „kein Zeichen“ stehen weiter an der ersten Frage, je einmal.
  expect(screen.getAllByText(CO2_EXAMPLE, { exact: false })).toHaveLength(1)
  expect(screen.getAllByText(CO2_NOT_A_SIGN)).toHaveLength(1)
  expect(screen.queryByLabelText(/Summe der Kosten aller Nutzer/)).toBeNull()
  expect(screen.queryByLabelText(/Nutzeinheiten/)).toBeNull()
  expect(screen.queryByLabelText(/CO₂-Ausstoß insgesamt/)).toBeNull()
  expect(screen.queryByText(/^Probe:/)).toBeNull()
  fireEvent.click(screen.getByText('CO₂-Angaben speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent).toEqual([{ url: '/api/heating-plants/hp/periods/2025-01/co2', method: 'PUT', body: { method: 'serviceEnclosed' } }])
})

test('Karte: die zweite Auswahl gibt es nur nach „Ja“; sie steht auf „eintragen“, und gespeichert wird, was beide Auswahlfelder zeigen', async () => {
  const saved = vi.fn()
  card(view(null), saved)
  expect(frage().value).toBe('')
  expect(screen.queryByLabelText('CO₂-Angaben eintragen')).toBeNull()
  fireEvent.change(frage(), { target: { value: 'shown' } })
  expect(screen.queryByLabelText('CO₂-Angaben eintragen')).toBeNull()
  fireEvent.change(frage(), { target: { value: 'unsplit' } })
  expect(screen.queryByLabelText('CO₂-Angaben eintragen')).toBeNull()
  fireEvent.change(frage(), { target: { value: 'deducted' } })
  expect(eintragen().value).toBe('enter')
  expect(eintragen().selectedOptions[0]?.textContent).toBe(CO2_ENTER_LABEL)
  expect(screen.getByLabelText(/Summe der Kosten aller Nutzer/)).toBeTruthy()
  fireEvent.change(eintragen(), { target: { value: 'enclosed' } })
  expect(eintragen().value).toBe('enclosed')
  expect(screen.queryByLabelText(/Summe der Kosten aller Nutzer/)).toBeNull()
  fireEvent.click(screen.getByText('CO₂-Angaben speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent[0]?.body).toEqual({ method: 'serviceEnclosed' })
  // Zurück auf „nur ausgewiesen“: Die zweite Auswahl verschwindet, die Felder der Probe sind wieder da.
  fireEvent.change(frage(), { target: { value: 'shown' } })
  expect(screen.queryByLabelText('CO₂-Angaben eintragen')).toBeNull()
  expect(screen.getByLabelText(/Summe der Kosten aller Nutzer/)).toBeTruthy()
  expect(screen.queryByText(co2EnclosedHelp(false))).toBeNull()
})

test('Karte: Eigentumswohnung, kein CO₂-pflichtiger Energieträger und gemeinsame Einstufung', async () => {
  card(view(statement()), () => {}, { homeowners: true })
  expect(eintragen().selectedOptions[0]?.textContent).toBe(CO2_ENCLOSED_LABEL_HOMEOWNERS)
  cleanup()
  // Durchsicht S11: ohne CO₂-Kosten bietet die Karte die Wahl nicht an.
  card(view(statement({ method: 'serviceDeducted', serviceUsersTotalCents: 182340, serviceLandlordCents: 0, serviceUnitsCount: 1 })), () => {}, { offersEnclosed: false })
  expect(frage().value).toBe('deducted')
  expect(screen.queryByLabelText('CO₂-Angaben eintragen')).toBeNull()
  cleanup()
  // Durchsicht S2: mit einer zweiten Anlage im Gebäude fragt die Karte bei „liegt bei“ nach dem Ausstoß, und nur danach.
  const saved = vi.fn()
  card(view(statement({ serviceEmissionsKg: 3000 })), saved, { joint: true })
  const feld = screen.getByLabelText(CO2_EMISSIONS_FIELD) as HTMLInputElement
  expect(feld.value).toBe('3000')
  expect(screen.getByText(CO2_ENCLOSED_JOINT)).toBeTruthy()
  expect(screen.queryByLabelText(/Wohnfläche/)).toBeNull()
  fireEvent.change(feld, { target: { value: '3.250' } })
  fireEvent.click(screen.getByText('CO₂-Angaben speichern'))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(sent[0]?.body).toEqual({ method: 'serviceEnclosed', serviceEmissionsKg: 3250 })
})

test('Karte: Haken an der Position und eine Antwort mit Probe: ein Satz nennt den Grund und den Weg; mit „Nicht eintragen“ und ohne Haken nicht', () => {
  const deducted = statement({ method: 'serviceDeducted', serviceUsersTotalCents: 150000, serviceLandlordCents: 500, serviceUnitsCount: 1 })
  card(view(deducted, [item({ includesWater: true })]))
  expect(screen.getByText(/enthält nach Ihrer Angabe auch Kaltwasser und Abwasser/)).toBeTruthy()
  fireEvent.change(eintragen(), { target: { value: 'enclosed' } })
  expect(screen.queryByText(/enthält nach Ihrer Angabe auch Kaltwasser und Abwasser/)).toBeNull()
  fireEvent.change(frage(), { target: { value: 'shown' } })
  expect(screen.getByText(/Weist die Abrechnung den Anteil nur aus, passt der Sammelbetrag nicht/)).toBeTruthy()
  cleanup()
  card(view(deducted))
  expect(screen.queryByText(/enthält nach Ihrer Angabe auch Kaltwasser und Abwasser/)).toBeNull()
})
