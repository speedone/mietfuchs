// @vitest-environment jsdom
// Die Fragen zum Betriebsstrom am Kostenformular (Heizung PR 15, #212): Norm an der Rechtsaussage (P-K1),
// Grundlage der Schätzung sichtbar und änderbar (P-W1), Verknüpfung eines Abzugs (P-W2).
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import OperatingPowerFields from './OperatingPowerFields'
import { EMPTY_ITEM_FORM, type ItemForm } from '../costForm'
import { periodKey } from '../../../shared/period.ts'
import type { CostItem } from '../types'

afterEach(cleanup)

const bs: CostItem = { id: 'bs', propertyId: 'o', period: periodKey('2025-01'), category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung (geschätzt)', amountCents: 14784, key: 'area', operatingPower: 'included' }

test('Heizkosten: Frage mit Norm (P-K1), Grundlage der Schätzung sichtbar und änderbar (P-W1)', () => {
  const onChange = vi.fn()
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', operatingPower: 'included', operatingPowerBasis: 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh' }
  render(<OperatingPowerFields form={form} items={[bs]} onChange={onChange} />)
  expect(screen.getByText(/§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV; BGH, Urteil vom 03\.06\.2016, V ZR 166\/15/)).toBeTruthy()
  expect(screen.getByText(/BGH, Versäumnisurteil vom 20\.02\.2008, VIII ZR 27\/07, Leitsatz 3/)).toBeTruthy()
  const basis = screen.getByLabelText(/Grundlage der Schätzung/) as HTMLTextAreaElement
  expect(basis.value).toBe('Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh')
  fireEvent.change(basis, { target: { value: 'neu' } })
  expect(onChange).toHaveBeenCalledWith({ ...form, operatingPowerBasis: 'neu' })
})

test('Heizkosten mit Teil „Brennstoff“ und andere Kostenarten: keine Frage', () => {
  const { container } = render(<OperatingPowerFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', heatingPart: 'fuel' }} items={[bs]} onChange={vi.fn()} />)
  expect(container.textContent).toBe('')
  cleanup()
  const other = render(<OperatingPowerFields form={{ ...EMPTY_ITEM_FORM, category: 'Grundsteuer' }} items={[bs]} onChange={vi.fn()} />)
  expect(other.container.textContent).toBe('')
})

test('Allgemeinstrom mit negativem Betrag: die Auswahl zeigt den gespeicherten Verweis (angezeigter = gespeicherter Wert)', () => {
  const onChange = vi.fn()
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Beleuchtung/Allgemeinstrom', amount: '-147,84', operatingPower: 'deduction', operatingPowerItemId: 'bs' }
  render(<OperatingPowerFields form={form} items={[bs]} onChange={onChange} />)
  const select = screen.getByLabelText(/Abzug des Betriebsstroms/) as HTMLSelectElement
  expect(select.value).toBe('bs')
  fireEvent.change(select, { target: { value: '' } })
  expect(onChange).toHaveBeenCalledWith({ ...form, operatingPower: '', operatingPowerItemId: '', operatingPowerBasis: '' })
})
