// Jede ausgelieferte Fassung des Rechtsregisters als Zahl (Heizung PR 1, Entwurf 4.4 und 4.7). Das
// ist die eigentliche Sicherung des Registers: Eine Fassung wird nie geändert, nur eine neue
// angelegt. Wer einen Wert berichtigt, legt eine neue Fassung an und **ergänzt** hier eine Zeile;
// eine bestehende Zeile ändert niemand. Einzige Ausnahme: Das offene Ende einer Fassung darf
// geschlossen werden, wenn eine neue anschließt (Durchsicht von #221, M2). Eine abgeschlossene Abrechnung bleibt dabei, wie sie ist,
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
  // 0.11.0 (Heizung PR 2, #208)
  'bgb.deadline-months|||12',
  'bgb.max-period-months|||12',
  // 0.11.0 (Heizung PR 3, #208). JSON.stringify stellt die Monate 10 bis 12 voran: Sie sind
  // ganzzahlige Schlüssel, „01“ bis „09“ wegen der führenden Null nicht.
  'hkv.degree-days|||{"months":{"10":80,"11":120,"12":160,"01":170,"02":150,"03":130,"04":80,"05":40,"09":30},"summer":40,"summerMonths":["06","07","08"]}',
  // 0.11.0 (Heizung PR 4)
  'hkv.remote-reading.new-devices||2021-12-01|{"required":false,"installedAfter":"2021-12-01"}',
  'hkv.remote-reading.new-devices|2021-12-02||{"required":true,"installedAfter":"2021-12-01"}',
  // 0.11.0 (Heizung PR 6)
  'co2.applicable-from||2022-12-31|false',
  'co2.applicable-from|2023-01-01||true',
  'co2.cut.missing|||3',
  'co2.rounding-decimals|||1',
  'co2.stage-table|||[{"from":0,"landlordPercent":0},{"from":12,"landlordPercent":10},{"from":17,"landlordPercent":20},{"from":22,"landlordPercent":30},{"from":27,"landlordPercent":40},{"from":32,"landlordPercent":50},{"from":37,"landlordPercent":60},{"from":42,"landlordPercent":70},{"from":47,"landlordPercent":80},{"from":52,"landlordPercent":95}]',
]

const current = (): string[] =>
  LAW_PARAMS.flatMap((p) => p.versions.map((v) => `${p.id}|${v.validFrom ?? ''}|${v.validTo ?? ''}|${JSON.stringify(v.value)}`))

// Die Abweichungen zwischen festgehaltenen und heutigen Fassungen. Eine festgehaltene Fassung mit
// offenem Ende (`id|ab||Wert`) darf heute geschlossen dastehen (`id|ab|bis|Wert`), sonst muss sie
// Zeichen für Zeichen da sein; jede heutige Fassung muss festgehalten sein, als sie selbst oder als
// geschlossene Form einer offenen.
function historyProblems(shipped: readonly string[], now: readonly string[]): string[] {
  const parts = (line: string) => line.split('|')
  const closes = (open: string, closed: string): boolean => {
    const [id, from, to, ...value] = parts(open)
    const [cid, cfrom, cto, ...cvalue] = parts(closed)
    return to === '' && cto !== '' && cid === id && cfrom === from && cvalue.join('|') === value.join('|')
  }
  return [
    ...shipped.filter((line) => !now.some((n) => n === line || closes(line, n))).map((line) => `ausgelieferte Fassung geändert oder entfernt: ${line}`),
    ...now.filter((line) => !shipped.some((x) => x === line || closes(x, line))).map((line) => `neue Fassung ohne Zeile in law-history.test.ts: ${line}`),
  ]
}

test('Register: jede ausgelieferte Fassung steht unverändert im Register, und jede Fassung ist hier festgehalten', () => {
  assert.deepEqual(historyProblems(SHIPPED, current()), [])
})

// Durchsicht von #221 (M2): Erlaubt ist genau eine Änderung an einer ausgelieferten Fassung, nämlich
// ihr offenes Ende zu schließen, wenn eine neue Fassung anschließt (die neue bekommt oben eine
// Zeile). Alles andere bleibt verboten.
test('Register-Geschichte: offenes Ende schließen ist erlaubt, jede andere Änderung nicht', () => {
  const shipped = ['a|2021-01-01||19', 'b||2024-06-30|1']
  assert.deepEqual(historyProblems([...shipped, 'a|2031-01-01||20'], ['a|2021-01-01|2030-12-31|19', 'a|2031-01-01||20', 'b||2024-06-30|1']), [])
  // Wert, Beginn oder ein schon gesetztes Ende geändert: die alte fehlt, die neue ist nicht festgehalten
  assert.equal(historyProblems(shipped, ['a|2021-01-01||18', 'b||2024-06-30|1']).length, 2)
  assert.equal(historyProblems(shipped, ['a|2020-01-01||19', 'b||2024-06-30|1']).length, 2)
  assert.equal(historyProblems(shipped, ['a|2021-01-01||19', 'b||2024-07-31|1']).length, 2)
  // Ein geschlossenes Ende wieder öffnen ist ebenso verboten.
  assert.equal(historyProblems(shipped, ['a|2021-01-01||19', 'b|||1']).length, 2)
  // Entfernt, oder neu ohne Zeile
  assert.equal(historyProblems(shipped, ['a|2021-01-01||19']).length, 1)
  assert.equal(historyProblems(shipped, ['a|2021-01-01||19', 'b||2024-06-30|1', 'c|||3']).length, 1)
})
