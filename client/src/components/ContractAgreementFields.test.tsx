// @vitest-environment jsdom
// Die Fragen zu „nicht im Mietvertrag vereinbart“ im Seitenfenster der Kostenposition (#258): die Warum-Frage unter
// einer abgewählten Wohnung, der Textlink für alle übrigen Fälle und der Abschnitt bei „Sonstige Betriebskosten“.
import { afterEach, expect, test } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { BillingPeriod, Tenancy, Unit } from '../types'
import { EMPTY_ITEM_FORM, type ItemForm } from '../costForm'
import ContractAgreementFields, { WhyQuestion } from './ContractAgreementFields'

const unit = (id: string, name: string): Unit => ({ propertyId: 'objekt-1', id, name, areaM2: 50, participates: true })
const UNITS = [unit('u1', 'EG links'), unit('u2', 'OG rechts')]
const tenancy = (id: string, unitId: string, tenantName: string, start: string, end: string | null): Tenancy => ({
  id, unitId, tenantName, persons: 1, personHistory: [], start, end, prepayments: [], prepaymentOverrides: {}, baseRents: [],
})
const PERIOD: Pick<BillingPeriod, 'from' | 'to'> = { from: '2025-01-01', to: '2025-12-31' }
const TENANCIES = [tenancy('t1', 'u1', 'Anna Becker', '2020-01-01', null), tenancy('t2', 'u2', 'Jonas Hartmann', '2020-01-01', null)]
const base = (patch: Partial<ItemForm> = {}): ItemForm => ({ ...EMPTY_ITEM_FORM, category: 'Aufzug', ...patch })

afterEach(cleanup)

let last: ItemForm
function Harness({ initial, tenancies = TENANCIES, error }: { initial: ItemForm; tenancies?: Tenancy[]; error?: string }) {
  const [form, setForm] = useState(initial)
  // Die Wohnungen, bei denen „Steht nicht im Mietvertrag von:“ gewählt ist (Hilfe der Seite, wie in Kosten.tsx)
  const [chosen, setChosen] = useState<string[]>([])
  last = form
  const change = (f: ItemForm) => { last = f; setForm(f) }
  return (
    <>
      {UNITS.filter((u) => form.pendingWhy.includes(u.id) || chosen.includes(u.id)).map((u) => (
        <WhyQuestion key={u.id} form={form} unit={u} units={UNITS} tenancies={tenancies} period={PERIOD} onChange={change} field={{ id: 'feld-teilnehmer', error }}
          chosen={chosen.includes(u.id)} onChoose={(c) => setChosen((x) => (c ? [...x, u.id] : x.filter((id) => id !== u.id)))} />
      ))}
      <ContractAgreementFields form={form} units={UNITS} tenancies={tenancies} period={PERIOD} onChange={change} />
    </>
  )
}

test('Warum-Frage: zwei Antworten; „Steht nicht im Mietvertrag“ nimmt die Wohnung zurück und merkt den Mieter', () => {
  render(<Harness initial={base({ participants: ['u2'], pendingWhy: ['u1'] })} />)
  const group = screen.getByRole('group', { name: 'Warum trägt EG links diese Kosten nicht?' })
  expect(within(group).getByLabelText('Betrifft die Wohnung nicht, etwa Aufzug für das Erdgeschoss. Die übrigen Wohnungen tragen den Anteil.')).toBeTruthy()
  fireEvent.click(within(group).getByLabelText('Steht nicht im Mietvertrag von Anna Becker. Den Anteil trägt der Vermieter.'))
  expect(last).toMatchObject({ participants: ['u2', 'u1'], notAgreed: ['t1'], pendingWhy: [] })
  expect(screen.queryByText('Warum trägt EG links diese Kosten nicht?')).toBeNull()
})

test('Warum-Frage: „Betrifft die Wohnung nicht“ lässt sie abgewählt', () => {
  render(<Harness initial={base({ participants: ['u2'], pendingWhy: ['u1'] })} />)
  fireEvent.click(screen.getByLabelText(/^Betrifft die Wohnung nicht/))
  expect(last).toMatchObject({ participants: ['u2'], notAgreed: [], pendingWhy: [] })
})

test('Warum-Frage: Meldung am Feld, die Sammelmeldung zeigt auf die erste Antwort', () => {
  render(<Harness initial={base({ participants: ['u2'], pendingWhy: ['u1'] })} error="Bitte wählen Sie, warum" />)
  expect(screen.getByText('Bitte wählen Sie, warum')).toBeTruthy()
  expect(document.getElementById('feld-teilnehmer')?.getAttribute('type')).toBe('radio')
})

test('Warum-Frage bei zwei Mietverhältnissen: zweite Antwort ist ein Optionsfeld, darunter je Mietverhältnis ein Häkchen, mehrere wählbar', () => {
  const tenancies = [tenancy('t1', 'u1', 'Anna Becker', '2020-01-01', '2025-06-30'), tenancy('t3', 'u1', 'Lea Schneider', '2025-07-01', null), TENANCIES[1]]
  render(<Harness initial={base({ participants: ['u2'], pendingWhy: ['u1'] })} tenancies={tenancies} />)
  expect(screen.queryByLabelText('Anna Becker')).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: /Steht nicht im Mietvertrag von:/ }))
  expect(last).toMatchObject({ participants: ['u2', 'u1'], notAgreed: [], pendingWhy: [] })
  const group = screen.getByRole('group', { name: /im Mietvertrag von/ })
  expect((screen.getByRole('radio', { name: /Steht nicht im Mietvertrag von:/ }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(within(group).getByLabelText('Anna Becker'))
  fireEvent.click(within(group).getByLabelText('Lea Schneider'))
  expect(last.notAgreed).toEqual(['t1', 't3'])
  expect((within(group).getByLabelText('Anna Becker') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(within(group).getByLabelText('Anna Becker'))
  expect(last.notAgreed).toEqual(['t3'])
  // Umentschieden: „Betrifft die Wohnung nicht“ wählt sie wieder ab und nimmt die Mieter zurück.
  fireEvent.click(screen.getByLabelText(/^Betrifft die Wohnung nicht/))
  expect(last).toMatchObject({ participants: ['u2'], notAgreed: [], pendingWhy: [] })
  expect(screen.queryByText(/Warum trägt EG links/)).toBeNull()
})

test('Heizung und Warmwasser: keine zweite Antwort, stattdessen der Satz zur Heizkostenverordnung, kein Textlink', () => {
  render(<Harness initial={base({ category: 'Heizung und Warmwasser', participants: ['u2'], pendingWhy: ['u1'] })} />)
  expect(screen.queryByLabelText(/Steht nicht im Mietvertrag/)).toBeNull()
  // Keine einzelne Antwort ohne Wahl: nur der Satz, nichts zu beantworten.
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.getByText(/Die Heizkostenverordnung gilt auch, wenn der Mietvertrag die Heizkosten nicht nennt; der Heizanteil der Miete wird dann als Vorauszahlung angerechnet \(BGH VIII ZR 212\/05\)\. Stellen Sie dafür beim Mietverhältnis die Heizkosten auf ‚in der Miete enthalten‘\./)).toBeTruthy()
  expect(screen.queryByText(/Ein Mieter trägt das laut Mietvertrag nicht/)).toBeNull()
})

test('Textlink: zu, solange niemand angehakt ist; Häkchen je Mietverhältnis setzt „nicht vereinbart“', () => {
  render(<Harness initial={base()} />)
  const details = screen.getByText('Ein Mieter trägt das laut Mietvertrag nicht …').closest('details')
  expect(details?.open).toBe(false)
  fireEvent.click(screen.getByLabelText(/Anna Becker \(EG links\)/))
  expect(last.notAgreed).toEqual(['t1'])
  fireEvent.click(screen.getByLabelText(/Anna Becker \(EG links\)/))
  expect(last.notAgreed).toEqual([])
})

test('Textlink: offen, wenn schon ein Mietverhältnis angehakt ist', () => {
  render(<Harness initial={base({ notAgreed: ['t2'] })} />)
  expect(screen.getByText('Ein Mieter trägt das laut Mietvertrag nicht …').closest('details')?.open).toBe(true)
  expect((screen.getByLabelText(/Jonas Hartmann \(OG rechts\)/) as HTMLInputElement).checked).toBe(true)
})

test('kein Textlink bei „Nicht umlagefähig“ und „Zuführung Erhaltungsrücklage“', () => {
  render(<Harness initial={base({ category: 'Nicht umlagefähig' })} />)
  expect(screen.queryByText(/Ein Mieter trägt das laut Mietvertrag nicht/)).toBeNull()
  cleanup()
  render(<Harness initial={base({ category: 'Zuführung Erhaltungsrücklage' })} />)
  expect(screen.queryByText(/Ein Mieter trägt das laut Mietvertrag nicht/)).toBeNull()
})

test('Sonstige Betriebskosten: Einleitungssatz, je Mietverhältnis „Ja“/„Nein“, ohne Antwort nichts gewählt', () => {
  render(<Harness initial={base({ category: 'Sonstige Betriebskosten' })} />)
  expect(screen.getByText('Gehört die Position eigentlich zu einer anderen Kostenart, wählen Sie diese oben.')).toBeTruthy()
  expect(screen.getByText(/Sonstige Betriebskosten trägt ein Mieter nur, wenn der Vertrag sie beim Namen nennt, etwa „Dachrinnenreinigung“ \(BGH VIII ZR 167\/03\)\./)).toBeTruthy()
  const anna = screen.getByRole('group', { name: /Anna Becker/ })
  const jonas = screen.getByRole('group', { name: /Jonas Hartmann/ })
  expect((within(anna).getByLabelText('Ja') as HTMLInputElement).checked).toBe(false)
  expect((within(anna).getByLabelText('Nein') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(within(anna).getByLabelText('Ja'))
  fireEvent.click(within(jonas).getByLabelText('Nein'))
  expect(last).toMatchObject({ named: ['t1'], notAgreed: ['t2'] })
  // Der Textlink fragte dasselbe ein zweites Mal.
  expect(screen.queryByText(/Ein Mieter trägt das laut Mietvertrag nicht/)).toBeNull()
})
