// Der Wechsel des Rhythmus nach Quelle (#455, Entwurf „Wechsel des Rhythmus“, Invariante 4).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLOW_COUNT, runFlows, type Flow } from '../testing/periodChangeFlows.ts'

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'period', 'quellrechnung-vorher.json')

// Die Datei entstand mit dem Code vor dem Umbau (Commit vor Task 6 von #455) und wird nie neu geschrieben, um grün zu
// werden. `NKA_WRITE_GOLDEN=1` schreibt sie neu; das ist nur auf dem Stand vor dem Umbau sinnvoll.
test('Golden: je Zeitraum dieselben Summen wie vor dem Umbau', { timeout: 600000 }, async () => {
  const flows = await runFlows(FLOW_COUNT)
  if (process.env.NKA_WRITE_GOLDEN === '1') {
    fs.writeFileSync(GOLDEN, `${JSON.stringify(flows)}\n`)
    return
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Flow[]
  assert.equal(flows.length, golden.length)
  for (const [i, flow] of flows.entries()) {
    const was = golden[i] ?? assert.fail(`Ablauf ${i} fehlt in der Datei`)
    assert.deepEqual(flow, was, `Ablauf ${i}`)
  }
})
