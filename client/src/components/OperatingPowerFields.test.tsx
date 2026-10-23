// @vitest-environment jsdom
// Die Fragen zum Betriebsstrom am Kostenformular (Heizung PR 15, #212): Norm an der Rechtsaussage (P-K1),
// Grundlage der Schätzung sichtbar und änderbar (P-W1), Verknüpfung eines Abzugs (P-W2).
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import OperatingPowerFields from './OperatingPowerFields'
import { EMPTY_ITEM_FORM, type ItemForm } from '../costForm'
import { periodKey } from '../../../shared/period.ts'
import { OPERATING_POWER_INCLUDED_QUESTION, OPERATING_POWER_INCLUDED_YES, OPERATING_POWER_KEPT } from '../../../shared/operatingPower.ts'
import type { CostItem } from '../types'

afterEach(cleanup)

const bs: CostItem = { id: 'bs', propertyId: 'o', period: periodKey('2025-01'), category: 'Heizung und Warmwasser', description: 'Betriebsstrom Heizung (geschätzt)', amountCents: 14784, key: 'area', operatingPower: 'included' }

test('Heizkosten: Frage mit Norm (P-K1), Grundlage der Schätzung sichtbar und änderbar (P-W1)', () => {
  const onChange = vi.fn()
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', operatingPower: 'included', operatingPowerBasis: 'Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh' }
  render(<OperatingPowerFields form={form} items={[bs]} periodKey={periodKey('2025-01')} service={false} onChange={onChange} />)
  expect(screen.getByText(/§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV; BGH, Urteil vom 03\.06\.2016, V ZR 166\/15/)).toBeTruthy()
  expect(screen.getByText(/BGH, Versäumnisurteil vom 20\.02\.2008, VIII ZR 27\/07, Leitsatz c/)).toBeTruthy()
  const basis = screen.getByLabelText(/Grundlage der Schätzung/) as HTMLTextAreaElement
  expect(basis.value).toBe('Pumpe: 45 W × 24 h × 220 Tage = 237,6 kWh')
  fireEvent.change(basis, { target: { value: 'neu' } })
  expect(onChange).toHaveBeenCalledWith({ ...form, operatingPowerBasis: 'neu' })
})

// #266 (R-4): Der Hinweis „Abzug des Betriebsstroms fehlt“ zitiert Frage und Antwort wörtlich aus shared/operatingPower.ts.
test('Heizkosten: Frage und Antwort stehen wortgleich wie im Hinweis „Abzug fehlt“', () => {
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', heatingPart: 'operating' }
  render(<OperatingPowerFields form={form} items={[]} periodKey={periodKey('2025-01')} service={false} onChange={vi.fn()} />)
  const select = screen.getByLabelText(/über den Stromzähler des Hauses\?/) as HTMLSelectElement
  expect(select.closest('label')?.querySelector('span')?.textContent).toBe(OPERATING_POWER_INCLUDED_QUESTION)
  expect([...select.options].map((o) => o.textContent)).toContain(OPERATING_POWER_INCLUDED_YES)
  expect(select.querySelector('option[value="included"]')?.textContent).toBe(OPERATING_POWER_INCLUDED_YES)
})

test('Heizkosten mit Teil „Brennstoff“ und andere Kostenarten: keine Frage', () => {
  const { container } = render(<OperatingPowerFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', heatingPart: 'fuel' }} items={[bs]} periodKey={periodKey('2025-01')} service={false} onChange={vi.fn()} />)
  expect(container.textContent).toBe('')
  cleanup()
  const other = render(<OperatingPowerFields form={{ ...EMPTY_ITEM_FORM, category: 'Grundsteuer' }} items={[bs]} periodKey={periodKey('2025-01')} service={false} onChange={vi.fn()} />)
  expect(other.container.textContent).toBe('')
})

test('Allgemeinstrom mit negativem Betrag: die Auswahl zeigt den gespeicherten Verweis (angezeigter = gespeicherter Wert)', () => {
  const onChange = vi.fn()
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Beleuchtung/Allgemeinstrom', amount: '-147,84', operatingPower: 'deduction', operatingPowerItemId: 'bs' }
  render(<OperatingPowerFields form={form} items={[bs]} periodKey={periodKey('2025-01')} service={false} onChange={onChange} />)
  const select = screen.getByLabelText(/Abzug des Betriebsstroms/) as HTMLSelectElement
  expect(select.value).toBe('bs')
  fireEvent.change(select, { target: { value: '' } })
  expect(onChange).toHaveBeenCalledWith({ ...form, operatingPower: '', operatingPowerItemId: '', operatingPowerGeneralId: '', operatingPowerBasis: '', operatingPowerReported: null })
})

// #268: Ohne Messdienst heißt der Abzug ohne Verweis „selbst getragen“, mit einem Satz zur Steuer; mit Messdienst wie bisher.
test('Abzug ohne Verweis: ohne Messdienst „trage ihn selbst“ samt Hinweis zur Steuer, mit Messdienst „dem Messdienst gemeldet“', () => {
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Beleuchtung/Allgemeinstrom', amount: '-147,84', operatingPower: 'deduction', operatingPowerItemId: '' }
  render(<OperatingPowerFields form={form} items={[bs]} periodKey={periodKey('2025-01')} service={false} onChange={vi.fn()} />)
  const select = screen.getByLabelText(/Abzug des Betriebsstroms/) as HTMLSelectElement
  expect(select.value).toBe('kept')
  expect(select.querySelector('option[value="kept"]')?.textContent).toBe(OPERATING_POWER_KEPT)
  expect(select.querySelector('option[value="service"]')).toBeNull()
  expect(screen.getByText(/In der Steuerübersicht zählt Mietfuchs ihn trotzdem zu Ihren Werbungskosten, denn Sie haben die ganze Stromrechnung bezahlt\./)).toBeTruthy()
  cleanup()
  render(<OperatingPowerFields form={form} items={[bs]} periodKey={periodKey('2025-01')} service onChange={vi.fn()} />)
  const mit = screen.getByLabelText(/Abzug des Betriebsstroms/) as HTMLSelectElement
  expect(mit.value).toBe('service')
  expect(mit.querySelector('option[value="service"]')?.textContent).toBe('Ja, der Betrag ist dem Messdienst als Betriebsstrom gemeldet')
  // #270: daneben „selbst getragen“, mit demselben Satz zur Steuer, wenn gewählt.
  expect(mit.querySelector('option[value="kept"]')?.textContent).toBe(OPERATING_POWER_KEPT)
  expect(screen.queryByText(/zu Ihren Werbungskosten/)).toBeNull()
  cleanup()
  const onChange = vi.fn()
  render(<OperatingPowerFields form={{ ...form, operatingPowerReported: false }} items={[bs]} periodKey={periodKey('2025-01')} service onChange={onChange} />)
  const selbst = screen.getByLabelText(/Abzug des Betriebsstroms/) as HTMLSelectElement
  expect(selbst.value).toBe('kept')
  expect(screen.getByText(/In der Steuerübersicht zählt Mietfuchs ihn trotzdem zu Ihren Werbungskosten/)).toBeTruthy()
  expect(screen.getByText(/nicht in der Abrechnung des Messdienstes/)).toBeTruthy()
  fireEvent.change(selbst, { target: { value: 'service' } })
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ operatingPower: 'deduction', operatingPowerItemId: '', operatingPowerReported: true }))
})

// Durchsicht S3: Der Satz zur Steuer gehört nur zur Antwort „trage ihn selbst“, nicht zum verknüpften Abzug und nicht zu „Nein“.
test('Abzug ohne Messdienst: verknüpft oder „Nein“ ohne Satz zur Steuer', () => {
  const linked: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Beleuchtung/Allgemeinstrom', amount: '-147,84', operatingPower: 'deduction', operatingPowerItemId: 'bs' }
  render(<OperatingPowerFields form={linked} items={[bs]} periodKey={periodKey('2025-01')} service={false} onChange={vi.fn()} />)
  expect((screen.getByLabelText(/Abzug des Betriebsstroms/) as HTMLSelectElement).value).toBe('bs')
  expect(screen.queryByText(/zu Ihren Werbungskosten/)).toBeNull()
  cleanup()
  render(<OperatingPowerFields form={{ ...linked, operatingPower: '', operatingPowerItemId: '' }} items={[bs]} periodKey={periodKey('2025-01')} service={false} onChange={vi.fn()} />)
  expect((screen.getByLabelText(/Abzug des Betriebsstroms/) as HTMLSelectElement).value).toBe('')
  expect(screen.queryByText(/zu Ihren Werbungskosten/)).toBeNull()
})

// G-K3: Der Abzug nennt seine Stromrechnung; die Auswahl zeigt den gespeicherten Wert und übernimmt die Verteilung.
test('Abzug: Auswahl der Stromrechnung zeigt den gespeicherten Wert, eine Wahl übernimmt den Schlüssel', () => {
  const strom: CostItem = { id: 'strom', propertyId: 'o', period: periodKey('2025-01'), category: 'Beleuchtung/Allgemeinstrom', description: 'Hausstrom 2025', amountCents: 105000, key: 'units' }
  const onChange = vi.fn()
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Beleuchtung/Allgemeinstrom', amount: '-147,84', key: 'area', operatingPower: 'deduction', operatingPowerItemId: 'bs', operatingPowerGeneralId: '' }
  render(<OperatingPowerFields form={form} items={[bs, strom]} periodKey={periodKey('2025-01')} service={false} onChange={onChange} />)
  const select = screen.getByLabelText(/Stromrechnung, aus der der Abzug stammt/) as HTMLSelectElement
  expect(select.value).toBe('')
  fireEvent.change(select, { target: { value: 'strom' } })
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ operatingPowerGeneralId: 'strom', key: 'units' }))
})

// R-W2: Bei einer Wärmepumpe fragt das Formular auch an der Strom-Position, mit der Auslegung im Satz.
test('Strom der Wärmepumpe (Teil „Brennstoff“): Frage mit Auslegung; bei Gas keine Frage', () => {
  const form: ItemForm = { ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', heatingPart: 'fuel' }
  render(<OperatingPowerFields form={form} items={[]} periodKey={periodKey('2025-01')} service={false} plantEnergy="heatPump" onChange={vi.fn()} />)
  expect(screen.getByLabelText(/Läuft dieser Strom über den Stromzähler des Hauses/)).toBeTruthy()
  expect(screen.getByText(/Auslegung von Mietfuchs/)).toBeTruthy()
  cleanup()
  const gas = render(<OperatingPowerFields form={form} items={[]} periodKey={periodKey('2025-01')} service={false} plantEnergy="gas" onChange={vi.fn()} />)
  expect(gas.container.textContent).toBe('')
})
