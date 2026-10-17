import { expect, test } from 'vitest'
import { NAV, navFor, pageLabel } from './nav'

test('Die Seite Heizkosten erscheint erst mit einer Heizanlage (Heizung PR 6, Entwurf 11.4)', () => {
  const ids = (hasPlant: boolean) => navFor(hasPlant).flatMap((g) => g.items.map((i) => i.id))
  expect(ids(false)).not.toContain('heizkosten')
  expect(ids(true)).toContain('heizkosten')
  expect(ids(false)).toEqual(NAV.flatMap((g) => g.items.map((i) => i.id)).filter((id) => id !== 'heizkosten'))
  expect(pageLabel('heizkosten')).toBe('Heizkosten')
})
