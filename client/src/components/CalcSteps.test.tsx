// @vitest-environment jsdom
// Der Rechenweg auf Klick (#114): aufklappbar und nie auf dem Ausdruck für den Mieter.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { press } from '../testing/keys'
import CalcSteps from './CalcSteps'

afterEach(cleanup)

test('Rechenweg klappt auf und zu, und alles davon ist vom Druck ausgenommen', () => {
  const { container } = render(
    <table><tbody><CalcSteps colSpan={4} row={{
      costItemId: 'k', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 100000, keyLabel: 'Wohnfläche', shareCents: 33333,
      steps: [{ label: 'Rechnungsbetrag', value: '1.000,00 €' }, { label: 'Anteil an der Verteilbasis', value: '60 von 180 m²', term: 'distributionBasis' }],
    }}>{(toggle) => <tr><td>{toggle}</td></tr>}</CalcSteps></tbody></table>,
  )
  const knopf = screen.getByRole('button', { name: /Rechenweg/ })
  expect(knopf.closest('.no-print')).toBeTruthy()
  expect(screen.queryByText('1.000,00 €')).toBeNull()
  fireEvent.click(knopf)
  expect(screen.getByText('1.000,00 €')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Anteil an der Verteilbasis' })).toBeTruthy()
  for (const tr of container.querySelectorAll('tr.calc-steps')) expect(tr.classList.contains('no-print')).toBe(true)
  fireEvent.click(knopf)
  expect(screen.queryByText('1.000,00 €')).toBeNull()
})

// #142: Mit aufgeklapptem Begriff stand die Erklärung mitten in der Zeile, zwischen Beschriftung
// und Wert, und der Rest („: 40 von 180“) rutschte darunter. Seit #346 Schritt 6 ist sie ein Popover und
// steht gar nicht in der Zeile.
test('der geöffnete Begriff schiebt die Zeile nicht auseinander, Beschriftung und Wert bleiben zusammen', async () => {
  render(
    <table><tbody><CalcSteps colSpan={4} row={{
      costItemId: 'k', category: 'Grundsteuer', description: 'Grundsteuer', totalCents: 90000, keyLabel: 'Wohnfläche', shareCents: 20000,
      steps: [{ label: 'Anteil an der Verteilbasis', value: '40 von 180 m²', term: 'distributionBasis' }],
    }}>{(toggle) => <tr><td>{toggle}</td></tr>}</CalcSteps></tbody></table>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Rechenweg/ }))
  const begriff = screen.getByRole('button', { name: 'Anteil an der Verteilbasis' })
  begriff.focus()
  fireEvent.click(begriff)
  const pop = screen.getByRole('dialog', { name: 'Verteilbasis' })
  const zeile = begriff.closest('li')
  if (!zeile) return expect.fail('der Begriff steht nicht in der Zeile seines Schritts')
  expect(zeile.contains(pop)).toBe(false)
  expect(zeile.textContent).toBe('Anteil an der Verteilbasis: 40 von 180 m²')
  expect(begriff.getAttribute('aria-controls')).toBe(pop.id)
  // Esc schließt die Erklärung weiterhin.
  press('Escape')
  expect(pop.matches(':popover-open')).toBe(false)
  await waitFor(() => expect(document.activeElement).toBe(begriff))
})
