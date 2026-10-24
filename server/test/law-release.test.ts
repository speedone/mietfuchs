// Release-Sperre des Rechtsregisters (Heizung PR 1, Entwurf 4.7): Ein Release bricht ab, solange
// ein Wert `checked: 'unchecked'` hat. Der Test läuft nur, wenn MIETFUCHS_RELEASE=1 gesetzt ist;
// das tut release.yml beim Tag („Rechtsregister geprüft?“). Im gewöhnlichen Lauf wäre er rot,
// sobald eine PR einen ungeprüften Wert einträgt, und das soll eine PR dürfen: Geprüft sein muss
// erst das Release (G-C7).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAW_PARAMS } from '../../shared/law/params.ts'
import { releaseStepsOf } from '../src/db/releaseSteps.ts'
import { APP_VERSION } from '../src/version.ts'
import type { LawParam, Timing } from '../../shared/law/register.ts'
import type { LawValue } from '../../shared/types.ts'

const uncheckedValues = (params: readonly LawParam<LawValue, Timing>[]): string[] =>
  params.flatMap((p) => p.versions.filter((v) => v.source.checked === 'unchecked').map((v) => `${p.id} (${v.source.cite}, ${v.validFrom ?? '…'} bis ${v.validTo ?? '…'})`))

test('Release: kein ungeprüfter Wert im Rechtsregister', { skip: process.env.MIETFUCHS_RELEASE !== '1' }, () => {
  const open = uncheckedValues(LAW_PARAMS)
  assert.deepEqual(open, [], `Vor dem Release an der Quelle lesen und als geprüft eintragen:\n${open.join('\n')}`)
})

// Durchsicht von PR #442, K3: Beim Tag (set-version.mjs hat die Version schon gesetzt) muss RELEASE_STEPS
// (server/src/db/releaseSteps.ts) für diese Version genau so viele Schritte nennen, wie server/drizzle/*.sql hat. Sonst
// hieße die Sicherung vor dem Update auf sie in der Zeitachse nur „Vor einem Update“, und die Merkdatei nennte keine
// Version. Läuft im selben Schritt von release.yml wie die Sperre des Rechtsregisters.
test('Release: RELEASE_STEPS nennt die Schritte dieser Version', { skip: process.env.MIETFUCHS_RELEASE !== '1' }, () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle')
  const steps = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).length
  assert.equal(releaseStepsOf(APP_VERSION), steps,
    `In server/src/db/releaseSteps.ts fehlt ein Eintrag { version: '${APP_VERSION.replace(/-.*$/, '').replace(/\.\d+$/, '.0')}', steps: ${steps} }.`)
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

// Durchsicht von #221 (M8): Die Sperre darf nicht still ausfallen. Fehlt beim Tag die Variable,
// überspringt node:test den Sperrtest und meldet trotzdem Erfolg. Der Schritt in release.yml prüft
// deshalb an der Ausgabe, dass nichts übersprungen wurde und der Sperrtest wirklich lief. Geprüft wird
// der Quelltext des Workflows, denn ausführen lässt er sich hier nicht.
test('Release-Sperre: der Schritt in release.yml prüft, dass der Sperrtest nicht übersprungen wurde', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/release.yml')
  const yml = fs.readFileSync(file, 'utf8')
  const start = yml.indexOf('- name: Rechtsregister geprüft?')
  if (start < 0) return assert.fail('Schritt „Rechtsregister geprüft?“ fehlt in release.yml')
  const step = yml.slice(start, yml.indexOf('\n      - ', start + 1))
  assert.match(step, /if: github\.ref_type == 'tag'/)
  assert.match(step, /MIETFUCHS_RELEASE: '1'/)
  // Ohne `shell: bash` läuft die Pipe ohne pipefail, und ein anderer gescheiterter Test der Datei
  // ginge in `tee` unter (Nachprüfung von #221).
  assert.match(step, /\n\s+shell: bash\n/)
  assert.match(step, /--test-reporter=tap test\/law-release\.test\.ts/)
  assert.match(step, /grep -qx '# skipped 0'/)
  assert.match(step, /grep -qE '\^ok \[0-9\]\+ - Release: kein ungeprüfter Wert im Rechtsregister\$'/)
  assert.match(step, /grep -qE '\^ok \[0-9\]\+ - Release: RELEASE_STEPS nennt die Schritte dieser Version\$'/)
})
