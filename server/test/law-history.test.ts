// Jede ausgelieferte Fassung des Rechtsregisters als Zahl (Heizung PR 1, Entwurf 4.4 und 4.7). Das
// ist die eigentliche Sicherung des Registers: Eine Fassung wird nie geändert, nur eine neue
// angelegt. Wer einen Wert berichtigt, legt eine neue Fassung an und **ergänzt** hier eine Zeile;
// eine bestehende Zeile ändert niemand. Eine abgeschlossene Abrechnung bleibt dabei, wie sie ist,
// und `deviation` zeigt die Auswirkung (CHANGELOG-Satz nach 4.4).
//
// Format je Zeile: Kennung, Grenzen (leer = offen) und der Wert als JSON.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAW_PARAMS } from '../../shared/law/params.ts'

const SHIPPED: readonly string[] = [
  // 0.11.0 (Heizung PR 1)
  'betrkv.tv-signal||2024-06-30|{"newSystemsFrom":"2021-12-01"}',
  'hkv.consumption-share|||{"min":50,"max":70}',
  'hkv.cut.not-by-consumption|||15',
  'hkv.cut.remote-reading|||3',
  'hkv.remote-reading.retrofit|2027-01-01||{"installedUpTo":"2021-12-01"}',
  'practice.vacancy-persons|||1',
  'ustg.standard-rate|2007-01-01|2020-06-30|19',
  'ustg.standard-rate|2020-07-01|2020-12-31|16',
  'ustg.standard-rate|2021-01-01||19',
]

const current = (): string[] =>
  LAW_PARAMS.flatMap((p) => p.versions.map((v) => `${p.id}|${v.validFrom ?? ''}|${v.validTo ?? ''}|${JSON.stringify(v.value)}`))

test('Register: jede ausgelieferte Fassung steht unverändert im Register', () => {
  const now = new Set(current())
  for (const line of SHIPPED) assert.ok(now.has(line), `ausgelieferte Fassung geändert oder entfernt: ${line}`)
})

test('Register: jede Fassung im Register ist hier festgehalten', () => {
  const shipped = new Set(SHIPPED)
  for (const line of current()) assert.ok(shipped.has(line), `neue Fassung ohne Zeile in law-history.test.ts: ${line}`)
})
