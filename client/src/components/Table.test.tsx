// @vitest-environment jsdom
// Browserlauf (#340, axe „scrollable-region-focusable“): Ist eine Tabelle breiter als ihr Bereich, lässt sich
// der Bereich per Tastatur erreichen und mit den Pfeiltasten seitlich rollen, auch wenn in der Tabelle nichts
// Bedienbares steht (Kostenvergleich am Handy). jsdom rechnet kein Layout, die Breiten sind deshalb gesetzt.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import Table from './Table'

let widths = { scroll: 0, client: 0 }
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => widths.scroll)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => widths.client)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const table = () => <Table><tbody><tr><td>1.234,56 €</td></tr></tbody></Table>

test('ein breiterer Bereich ist per Tastatur erreichbar und benannt', () => {
  widths = { scroll: 700, client: 358 }
  const { container } = render(table())
  const region = container.querySelector('.table-scroll')
  expect(region?.getAttribute('tabindex')).toBe('0')
  expect(region?.getAttribute('role')).toBe('region')
  expect(region?.getAttribute('aria-label')).toMatch(/seitlich/)
})

// Mehrere rollende Tabellen auf einer Seite (Kostenvergleich) heißen nicht alle gleich: Der Name kommt aus der
// Beschriftung der Tabelle, sonst aus der Überschrift ihrer Karte, und erst dann „Tabelle“.
test('der Bereich trägt den Namen der Tabelle oder ihrer Überschrift', () => {
  widths = { scroll: 700, client: 358 }
  const { container } = render(
    <>
      <Table aria-label="Kosten je Jahr"><tbody><tr><td>1</td></tr></tbody></Table>
      <div className="card"><h2>Verbrauch</h2><Table><tbody><tr><td>2</td></tr></tbody></Table></div>
    </>,
  )
  const names = [...container.querySelectorAll('.table-scroll')].map((r) => r.getAttribute('aria-label'))
  expect(names).toEqual(['Kosten je Jahr, seitlich scrollbar', 'Verbrauch, seitlich scrollbar'])
})

test('ein Bereich, in den die Tabelle passt, ist kein Halt beim Tabben', () => {
  widths = { scroll: 358, client: 358 }
  const { container } = render(table())
  const region = container.querySelector('.table-scroll')
  expect(region?.hasAttribute('tabindex')).toBe(false)
  expect(region?.hasAttribute('role')).toBe(false)
})
