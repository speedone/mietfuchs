// @vitest-environment jsdom
// Das neue Auswahlfeld „Jahr der Zahlung“ zeigt den gespeicherten Wert (CLAUDE.md, Tests Ebene 3).
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CostPeriodFields from './CostPeriodFields'
import { EMPTY_ITEM_FORM } from '../costForm'
import { LAW_AS_OF, valueAt } from '../../../shared/law/register.ts'
import { estgShortPeriodDays } from '../../../shared/law/estg.ts'


afterEach(cleanup)

describe('Leistungszeitraum und Jahr der Zahlung (#208)', () => {
  test('ein gewähltes Jahr steht im Feld', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, taxYear: '2026' }} onChange={() => {}} showTaxYear years={[2025, 2026, 2027]} />)
    const select = screen.getByRole('combobox', { name: /Jahr der Zahlung/ }) as HTMLSelectElement
    expect(select.value).toBe('2026')
    expect(select.selectedOptions[0]?.textContent).toBe('2026')
  })
  test('ohne Wahl steht „bitte wählen“ im Feld und nichts anderes', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, taxYear: '' }} onChange={() => {}} showTaxYear years={[2025, 2026, 2027]} />)
    const select = screen.getByRole('combobox', { name: /Jahr der Zahlung/ }) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(select.selectedOptions[0]?.textContent).toBe('– bitte wählen –')
  })
  test('Brennstoff nur bei Heizkosten, Jahr der Zahlung nur auf Wunsch', () => {
    const { rerender } = render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Grundsteuer' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.queryByLabelText('Teil der Heizkosten')).toBeNull()
    expect(screen.queryByRole('combobox', { name: /Jahr der Zahlung/ })).toBeNull()
    rerender(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.getByLabelText('Teil der Heizkosten')).toBeTruthy()
  })
  // Nachprüfung von #237: Die Auswahl zeigt jeden gespeicherten Teil der Heizkosten, auch „Betrieb“ und
  // „ohne Angabe“, und eine Wahl schickt genau diesen Wert.
  test('Teil der Heizkosten: angezeigter Wert = gespeicherter Wert', () => {
    for (const [part, label] of [['', 'ohne Angabe'], ['fuel', 'Brennstoff/Energie (Gas, Öl, Fernwärme, Strom der Wärmepumpe)'], ['operating', 'Betrieb, Wartung, Strom der Heizung'], ['metering', 'Messdienst, Ablesung, Geräte']] as const) {
      render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser', heatingPart: part }} onChange={() => {}} showTaxYear={false} years={[]} />)
      const select = screen.getByLabelText('Teil der Heizkosten') as HTMLSelectElement
      expect(select.value).toBe(part)
      expect(select.selectedOptions[0]?.textContent).toBe(label)
      cleanup()
    }
    let next = EMPTY_ITEM_FORM
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Heizung und Warmwasser' }} onChange={(f) => { next = f }} showTaxYear={false} years={[]} />)
    fireEvent.change(screen.getByLabelText('Teil der Heizkosten'), { target: { value: 'operating' } })
    expect(next.heatingPart).toBe('operating')
  })
  // Recht-H-1 und K-4 (Folge-PR zu #252), seit #267 umgedreht: Der Abzug folgt der Stromrechnung, die Heizposition hat
  // ihr eigenes Jahr; die Feldhilfe an der Heizposition sagt, warum das der Regel „wann Sie gezahlt haben“ nicht widerspricht.
  test('Feldhilfe zum Jahr beim Betriebsstrom in den Heizkosten, sonst nicht', () => {
    const satz = /steht sein Abzug beim Allgemeinstrom immer im Jahr der Stromrechnung, denn beide teilen die Stromrechnung nur auf\./
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, operatingPower: 'included' }} onChange={() => {}} showTaxYear years={[2025, 2026]} />)
    expect(screen.getByText(satz)).toBeTruthy()
    expect(screen.queryByText(/das der Heizposition/)).toBeNull()
    cleanup()
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM }} onChange={() => {}} showTaxYear years={[2025, 2026]} />)
    expect(screen.queryByText(satz)).toBeNull()
  })
  // #267: Ein Abzug beim Betriebsstrom hat kein eigenes Jahr; statt des Feldes steht das Jahr seiner Stromrechnung da.
  test('Abzug beim Betriebsstrom: kein Feld, sondern „wie die Stromrechnung (2026)“', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, operatingPower: 'deduction', taxYear: '2025' }} onChange={() => {}} showTaxYear years={[2025, 2026]} billTaxYear={2026} />)
    expect(screen.queryByRole('combobox', { name: /Jahr der Zahlung/ })).toBeNull()
    expect(screen.getByText(/Jahr der Zahlung \(Steuer\): wie die Stromrechnung \(2026\)\./)).toBeTruthy()
  })
})

describe('Bezahlt am (für die Steuer, #255 PR 3)', () => {
  test('das Feld zeigt den gespeicherten Tag und meldet eine Änderung', () => {
    const seen: string[] = []
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, paidOn: '2027-02-10' }} onChange={(f) => seen.push(f.paidOn)} showTaxYear={false} years={[]} paidOnChanges={['Mit dem Datum 10.02.2027 zählt die Position für die Steuer zu 2027 statt zu 2026.']} />)
    const input = screen.getByLabelText('Bezahlt am (für die Steuer)') as HTMLInputElement
    expect(input.value).toBe('2027-02-10')
    expect(screen.getByRole('status').textContent).toContain('zu 2027 statt zu 2026')
    fireEvent.change(input, { target: { value: '2027-03-01' } })
    expect(seen).toEqual(['2027-03-01'])
    expect(screen.getByText(/nicht das Rechnungsdatum/)).toBeTruthy()
    expect(screen.getByText(/Abschlägen gezahlt/)).toBeTruthy()
  })
  test('Zehn-Tage-Hinweis um den Jahreswechsel, nicht bei der Grundsteuer', () => {
    const { rerender } = render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', paidOn: '2025-12-28' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.queryByText(/Zahlung um den Jahreswechsel/)).toBeTruthy()
    rerender(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Grundsteuer', paidOn: '2025-12-28' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.queryByText(/Zahlung um den Jahreswechsel/)).toBeNull()
  })
  // #312 PR 3 (Nachdurchsicht K3): die Zahl der Tage aus dem Rechtsregister, nicht fest im Text.
  test('Zehn-Tage-Texte lesen die Zahl der Tage aus dem Register', () => {
    const days = valueAt(estgShortPeriodDays, LAW_AS_OF)
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Müllabfuhr', paidOn: '2025-12-28', taxYear: '2025' }} onChange={() => {}} showTaxYear years={[2025, 2026]} />)
    expect(screen.getByText(/Zahlung um den Jahreswechsel/).textContent).toContain(`bis ${days} Tage vor oder nach dem Jahreswechsel`)
    expect(screen.getByText(/Abschlägen über zwei Kalenderjahre/).textContent).toContain(`(bis ${days} Tage davor oder danach)`)
    expect(document.body.textContent).not.toMatch(/zehn Tage/)
  })
  test('bei Hausgeld laut Gemeinschaftsabrechnung kein Feld, sondern der Hinweis (R-6)', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, key: 'external' }} onChange={() => {}} showTaxYear={false} years={[]} />)
    expect(screen.queryByLabelText('Bezahlt am (für die Steuer)')).toBeNull()
    expect(screen.getByText(/IX R 19\/24/)).toBeTruthy()
  })
})

// #96 PR 1 (R-G): Bei der Entnahme aus der Erhaltungsrücklage heißt das Feld nach dem, was zählt, mit Hilfe für Laien;
// ein Zahlungsdatum gibt es nicht, und der angezeigte Wert ist der gespeicherte.
describe('Entnahme Erhaltungsrücklage (#96)', () => {
  test('Jahr, in dem die Gemeinschaft bezahlt hat: Beschriftung, Hilfe, gespeichertes Jahr; kein Datumsfeld', () => {
    render(<CostPeriodFields form={{ ...EMPTY_ITEM_FORM, category: 'Entnahme Erhaltungsrücklage', taxYear: '2026' }} onChange={() => {}} showTaxYear years={[2024, 2025, 2026, 2027, 2028]} emptyLabel="wie Abrechnungsjahr (2025)" droppedPaidOn="Das Zahlungsdatum 10.02.2026 entfällt, die Position bleibt für die Steuer im Jahr 2026." />)
    const select = screen.getByRole('combobox', { name: /Jahr, in dem die Gemeinschaft bezahlt hat/ }) as HTMLSelectElement
    expect(select.value).toBe('2026')
    expect(select.selectedOptions[0]?.textContent).toBe('2026')
    expect(screen.getByText(/Steht in der Hausgeldabrechnung dieses Jahres \(Entnahmen aus der Erhaltungsrücklage\)\. Ohne Angabe gilt das Jahr der Abrechnung\./)).toBeTruthy()
    expect(screen.getByText(/nicht als Entnahme/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Das Zahlungsdatum 10.02.2026 entfällt, die Position bleibt für die Steuer im Jahr 2026.')
    expect(screen.queryByLabelText('Bezahlt am (für die Steuer)')).toBeNull()
    expect(screen.queryByText(/Maßgeblich ist, wann Sie gezahlt haben/)).toBeNull()
  })
})

