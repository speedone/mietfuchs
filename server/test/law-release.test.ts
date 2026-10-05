// Release-Sperre des Rechtsregisters (Heizung PR 1, Entwurf 4.7): Ein Release bricht ab, solange
// ein Wert `checked: 'unchecked'` hat. Der Test läuft nur, wenn MIETFUCHS_RELEASE=1 gesetzt ist;
// das tut release.yml beim Tag („Rechtsregister geprüft?“). Im gewöhnlichen Lauf wäre er rot,
// sobald eine PR einen ungeprüften Wert einträgt, und das soll eine PR dürfen: Geprüft sein muss
// erst das Release (G-C7).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import type { LawParam, Timing } from '../../shared/law/register.ts'
import type { LawValue } from '../../shared/types.ts'

const uncheckedValues = (params: readonly LawParam<LawValue, Timing>[]): string[] =>
  params.flatMap((p) => p.versions.filter((v) => v.source.checked === 'unchecked').map((v) => `${p.id} (${v.source.cite}, ${v.validFrom ?? '…'} bis ${v.validTo ?? '…'})`))

test('Release: kein ungeprüfter Wert im Rechtsregister', { skip: process.env.MIETFUCHS_RELEASE !== '1' }, () => {
  const open = uncheckedValues(LAW_PARAMS)
  assert.deepEqual(open, [], `Vor dem Release an der Quelle lesen und als geprüft eintragen:\n${open.join('\n')}`)
})

test('Release-Sperre: sie findet einen ungeprüften Wert und übersieht die geprüften', () => {
  // Ohne diese Probe könnte die Sperre grün sein, weil sie gar nichts findet.
  const source = { rank: 'law', cite: '§ 1', url: 'https://example.org/1', retrieved: '2026-10-05' } as const
  const param: LawParam<number, 'periodStart'> = {
    id: 'test.offen', title: 'Offen', norm: '§ 1', timing: 'periodStart', describe: (v) => String(v),
    versions: [
      { validTo: '2022-12-31', value: 1, source: { ...source, checked: 'checked' }, enacted: 'a' },
      { validFrom: '2023-01-01', value: 2, source: { ...source, checked: 'unchecked' }, enacted: 'b' },
    ],
  }
  assert.deepEqual(uncheckedValues([param]), ['test.offen (§ 1, 2023-01-01 bis …)'])
})
