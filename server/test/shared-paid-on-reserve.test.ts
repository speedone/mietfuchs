// Durchsicht #96 PR 1, K4: An Zuführung und Entnahme der Erhaltungsrücklage gibt es kein Zahlungsdatum, gleich welcher
// Schlüssel; daneben bleibt „Nicht umlagefähig“ datierbar (shared/paidOn.ts, `allowsPaidOn`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowsPaidOn } from '../../shared/paidOn.ts'
import type { CostKey } from '../../shared/types.ts'

test('allowsPaidOn: false für beide Kostenarten der Erhaltungsrücklage, true für „Nicht umlagefähig“', () => {
  for (const key of ['area', 'external', 'direct'] satisfies CostKey[]) {
    assert.equal(allowsPaidOn({ key, category: 'Zuführung Erhaltungsrücklage' }), false, key)
    assert.equal(allowsPaidOn({ key, category: 'Entnahme Erhaltungsrücklage' }), false, key)
    assert.equal(allowsPaidOn({ key, category: 'Nicht umlagefähig' }), true, key)
  }
})
