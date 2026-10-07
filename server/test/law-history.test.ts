// Jede ausgelieferte Fassung des Rechtsregisters als Zahl (Heizung PR 1, Entwurf 4.4 und 4.7). Das
// ist die eigentliche Sicherung des Registers: Eine Fassung wird nie geändert, nur eine neue
// angelegt. Wer einen Wert berichtigt, legt eine neue Fassung an und **ergänzt** hier eine Zeile;
// eine bestehende Zeile ändert niemand. Einzige Ausnahme: Das offene Ende einer Fassung darf
// geschlossen werden, wenn eine neue anschließt (Durchsicht von #221, M2). Zweite Ausnahme (Heizung
// PR 17): Ein Wert `null`, den eine Behörde später veröffentlicht, darf durch den veröffentlichten ersetzt
// werden (Entwurf 4.5). Eine abgeschlossene Abrechnung bleibt dabei, wie sie ist,
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
  // 0.11.0 (Heizung PR 7)
  'co2.district-ets-new|||{"connectedAfter":"2023-01-01"}',
  'co2.non-residential|||500',
  'co2.restriction|||{"factor":0.5,"bothSplit":false}',
  // 0.11.0 (Heizung PR 8)
  'co2.costs-before||2022-12-31|true',
  'co2.costs-before|2023-01-01||false',
  // 0.11.0 (Heizung PR 10, #99)
  'hkv.consumption-share-forced|||70',
  // Nachprüfung von #239, N2.
  'hkv.settlement-info||2021-11-30|false',
  'hkv.settlement-info|2021-12-01||true',
  'hkv.heat-pump.capture|||{"capturedBy":"2024-10-01","installBy":"2025-09-30"}',
  'practice.reading-off-warning|||{"months":1,"winterMonths":["10","11","12","01","02","03","04"]}',
  // 0.11.0 (Heizung PR 11, #211)
  'hkv.dhw.volume-formula|||{"effort":2.5,"coldWaterC":10}',
  'hkv.dhw.area-formula|||{"kwhPerM2":32}',
  'hkv.dhw.factors||2024-09-30|{"gasCalorific":1.11,"heatSupplyDivisor":1.15,"heatPump":null}',
  'hkv.dhw.factors|2024-10-01||{"gasCalorific":1.11,"heatSupplyDivisor":1.15,"heatPump":0.3}',
  'hkv.heating-values||2021-11-30|{"units":["l","m3","kg","srm"],"values":{"heatingOilEL":{"kwh":10,"per":"l"},"heavyFuelOil":{"kwh":10.9,"per":"l"},"naturalGasH":{"kwh":10,"per":"m3"},"naturalGasL":{"kwh":9,"per":"m3"},"lpg":{"kwh":13,"per":"kg"},"coke":{"kwh":8,"per":"kg"},"lignite":{"kwh":5.5,"per":"kg"},"hardCoal":{"kwh":8,"per":"kg"},"firewood":{"kwh":4.1,"per":"kg"},"woodPellets":{"kwh":5,"per":"kg"},"woodChips":{"kwh":650,"per":"srm"}}}',
  'hkv.heating-values|2021-12-01||{"units":["l","m3","kg"],"values":{"heatingOilEL":{"kwh":10,"per":"l"},"heavyFuelOil":{"kwh":10.9,"per":"l"},"naturalGasH":{"kwh":10,"per":"m3"},"naturalGasL":{"kwh":9,"per":"m3"},"lpg":{"kwh":13,"per":"kg"},"coke":{"kwh":8,"per":"kg"},"lignite":{"kwh":5.5,"per":"kg"},"hardCoal":{"kwh":8,"per":"kg"},"firewood":{"kwh":4.1,"per":"kg"},"woodPellets":{"kwh":5,"per":"kg"},"woodChips":{"kwh":4,"per":"kg"}}}',
  'hkv.exemption.renewable||2024-09-30|{"heatPump":true}',
  'hkv.exemption.renewable|2024-10-01||{"heatPump":false}',
  // 0.11.0 (Heizung PR 12, #99)
  'practice.evaporator-window|||{"min":400,"max":800}',
  // 0.11.0 (Heizung PR 13, #99)
  'hkv.estimate-threshold|||25',
  // 0.11.0 (Heizung PR 14, #99)
  'hkv.cut.information|||3',
  'hkv.info.district-emissions||2021-12-31|{"scope":"largeOnly","thresholdMw":20}',
  'hkv.info.district-emissions|2022-01-01||{"scope":"all","thresholdMw":20}',
  'hkv.monthly-info|2022-01-01||{"interval":"monthly"}',
  'hkv.exemptions|||{"lowDemandKwhPerM2Year":15,"readyBefore":"1981-07-01","paybackYears":10}',
  // 0.11.0 (Heizung PR 17, #97)
  'co2.ebev-factors|2023-01-01|2030-12-31|{"gas":{"tPerGj":0.0558,"hsGjPerMwh":3.2508},"oil":{"tPerGj":0.074,"tPerM3":0.845,"gjPerT":42.8},"lpg":{"tPerGj":0.0655,"gjPerT":46}}',
  'co2.price|2021-01-01|2021-12-31|25',
  'co2.price|2022-01-01|2022-12-31|30',
  'co2.price|2023-01-01|2023-12-31|30',
  'co2.price|2024-01-01|2024-12-31|45',
  'co2.price|2025-01-01|2025-12-31|55',
  'co2.price|2026-01-01|2026-12-31|60',
  'co2.price|2027-01-01||null',
  'co2.price-ets|2023-01-01|2023-12-31|80.4',
  'co2.price-ets|2024-01-01|2024-12-31|83.68',
  'co2.price-ets|2025-01-01|2025-12-31|65.01',
  'co2.price-ets|2026-01-01|2026-12-31|73.86',
  'co2.price-ets|2027-01-01||null',
  'ustg.gas-heat-network-rate|2022-10-01|2024-03-31|7',
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
  // Heizung PR 17 (Abweichung 3): Ein ausgelieferter Wert `null` (noch nicht veröffentlicht) darf einen
  // Wert bekommen und dabei sein offenes Ende schließen.
  const fills = (open: string, filled: string): boolean => {
    const [id, from, to, ...value] = parts(open)
    const [fid, ffrom, fto, ...fvalue] = parts(filled)
    return fid === id && ffrom === from && value.join('|') === 'null' && fvalue.join('|') !== 'null' && (to === '' || fto === to)
  }
  return [
    ...shipped.filter((line) => !now.some((n) => n === line || closes(line, n) || fills(line, n))).map((line) => `ausgelieferte Fassung geändert oder entfernt: ${line}`),
    ...now.filter((line) => !shipped.some((x) => x === line || closes(x, line) || fills(x, line))).map((line) => `neue Fassung ohne Zeile in law-history.test.ts: ${line}`),
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
  // Heizung PR 17 (Abweichung 3): Ein veröffentlichter Wert ersetzt null und darf das offene Ende schließen.
  const offen = ['p|2027-01-01||null']
  assert.deepEqual(historyProblems([...offen, 'p|2028-01-01||null'], ['p|2027-01-01|2027-12-31|64.2', 'p|2028-01-01||null']), [])
  assert.deepEqual(historyProblems(offen, ['p|2027-01-01||64.2']), [])
  // Ein Wert, der schon dastand, wird nicht still ersetzt, auch nicht durch null.
  assert.equal(historyProblems(['p|2026-01-01|2026-12-31|60'], ['p|2026-01-01|2026-12-31|null']).length, 2)
})
