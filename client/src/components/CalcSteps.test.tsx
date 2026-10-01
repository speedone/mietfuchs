// @vitest-environment jsdom
// Der Rechenweg auf Klick (#114): aufklappbar und nie auf dem Ausdruck für den Mieter.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
