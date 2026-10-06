// Warmwasseranteil α nach § 9 HeizkostenV (Heizung PR 11, Entwurf 8.3, 12.2). Jede Zahl ist von Hand
// nachgerechnet; der Kommentar am Test nennt die Rechnung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLawLog } from '../../shared/law/register.ts'
import { dhwShareOf, suppliedAreaOf, yearShare, type DhwInput, type DhwOutcome, type EnergyDelivery } from '../src/dhw.ts'

const H2025 = { from: '2025-01-01', to: '2025-12-31' }
const delivery = (over: Partial<EnergyDelivery>): EnergyDelivery => ({
  id: 'g', label: 'Gas 2025', invoiceTo: '2025-12-31', deliveredAt: null, invoiceDate: '2026-01-15',
  energyKwh: null, quantity: null, quantityUnit: null, gasBasis: null, heatingValue: null, fuelGrade: null, share: 1, ...over,
})
const gasKwh = (kwh: number, basis: 'hs' | 'hi' | null = 'hs', over: Partial<EnergyDelivery> = {}) => delivery({ energyKwh: kwh, gasBasis: basis, ...over })
const input = (over: Partial<DhwInput> = {}): DhwInput => ({
  energy: 'gas', heatGeneration: 'single', h: H2025, method: 'heatMeter',
  measured: { dhwKwh: 9000, totalKwh: null }, volumeM3: 120, tempC: 60, suppliedAreaM2: 200,
  generator: { deliveries: [gasKwh(60000)], stock: null, earlier: null },
  fuelCoveragePermille: 1000, fuelEstimated: false,
  ...over,
})
const share = (over: Partial<DhwInput> = {}, log = createLawLog()) => {
  const o: DhwOutcome = dhwShareOf(input(over), log)
  if (!o.ok) assert.fail(`kein Anteil: ${o.code} ${o.reasons.join('; ')}`)
  return o.statement
}
const failure = (over: Partial<DhwInput>) => {
  const o = dhwShareOf(input(over), createLawLog())
  if (o.ok) assert.fail(`erwartet: kein Anteil, bekommen: ${o.statement.alpha}`)
  return o
}
const reasons = (over: Partial<DhwInput>) => failure(over).reasons.join(' | ')
const pct = (alpha: number) => Math.round(alpha * 10000) / 100
const oil = (over: Partial<EnergyDelivery> = {}) => delivery({ id: 'o1', label: 'Öl Oktober', invoiceTo: null, deliveredAt: '2025-10-12', quantity: 3000, quantityUnit: 'l', heatingValue: 9.8, fuelGrade: 'heatingOilEL', ...over })
const oilInput = (over: Partial<DhwInput> = {}, d: EnergyDelivery[] = [oil()]): Partial<DhwInput> => ({
  energy: 'oil', method: 'volumeFormula', generator: { deliveries: d, stock: { unit: 'l', consumed: 6000 }, earlier: null }, ...over,
})

test('Beispiel 8.3: gemessen 15,0 %, Volumenformel 27,75 %, Flächenformel 11,84 %; der Faktor 1,11 nur bei den Formeln (G-B1)', () => {
  // 60.000 kWh Gas nach Brennwert. Gemessen 9.000 / 60.000. Volumen: 2,5 · 120 · 50 = 15.000 · 1,11 = 16.650.
  // Fläche: 32 · 200 = 6.400 · 1,11 = 7.104.
  const gemessen = share()
  assert.equal(gemessen.alpha, 0.15)
  assert.equal(gemessen.factor, null)
  assert.equal(gemessen.heatKwh, 9000)
  assert.deepEqual(gemessen.denominator, { kind: 'fuelKwh', value: 60000, unit: 'kWh' })
  const volumen = share({ method: 'volumeFormula' })
  assert.equal(pct(volumen.alpha), 27.75)
  assert.equal(volumen.formulaKwh, 15000)
  assert.deepEqual(volumen.factor, { kind: 'gasCalorific', value: 1.11 })
  assert.equal(Math.round(volumen.heatKwh), 16650)
  assert.deepEqual(volumen.steps, [
    'Q = 2,5 · 120 m³ · (60 °C − 10 °C) = 15.000 kWh (§ 9 Abs. 2 Satz 2 HeizkostenV)',
    'Erdgas nach Brennwert abgerechnet: 15.000 kWh · 1,11 = 16.650 kWh (§ 9 Abs. 2 Satz 6 Nr. 1 HeizkostenV)',
    'Warmwasseranteil = 16.650 kWh / 60.000 kWh Brennstoff laut Rechnung = 27,75 %',
  ])
  assert.equal(pct(share({ method: 'areaFormula' }).alpha), 11.84)
})

test('15.1 Nr. 9: dasselbe Gas in kWh nach Brennwert 13,51 %, in m³ mit Heizwert 15,00 %; gemessen ohne Faktor', () => {
  // 6.000 m³ · 10 kWh/m³ = 60.000 kWh nach Heizwert = 66.600 kWh nach Brennwert (· 1,11).
  assert.equal(pct(share({ generator: { deliveries: [gasKwh(66600)], stock: null, earlier: null } }).alpha), 13.51)
  const m3 = { deliveries: [gasKwh(0, null, { energyKwh: null, quantity: 6000, quantityUnit: 'm3', heatingValue: 10 })], stock: null, earlier: null }
  const gemessen = share({ generator: m3 })
  assert.equal(gemessen.alpha, 0.15)
  assert.deepEqual(gemessen.fuelForDhw, { quantity: 900, unit: 'm3', heatingValue: 10 })
  assert.deepEqual(gemessen.denominator, { kind: 'fuelQuantity', value: 6000, unit: 'm3' })
  // Abgerechnet nach Heizwert in m³: kein Faktor 1,11, auch nicht bei der Formel. B = 15.000 / 10 = 1.500 m³.
  const formel = share({ method: 'volumeFormula', generator: m3 })
  assert.equal(formel.factor, null)
  assert.equal(formel.alpha, 0.25)
})

test('Wärmepumpe (F1): Volumenformel · 0,30 gegen den Strom 37,5 %; vor 10/2024 kein Faktor; mehrere Erzeuger oder ohne Antwort keine Formel', () => {
  const strom = { deliveries: [delivery({ label: 'Strom 2025', energyKwh: 12000 })], stock: null, earlier: null }
  const wp = share({ energy: 'heatPump', method: 'volumeFormula', generator: strom })
  assert.equal(pct(wp.alpha), 37.5)
  assert.deepEqual(wp.factor, { kind: 'heatPump', value: 0.3 })
  assert.equal(wp.denominator.kind, 'electricity')
  assert.match(reasons({ energy: 'heatPump', method: 'volumeFormula', generator: strom, h: { from: '2024-01-01', to: '2024-12-31' } }), /keinen Faktor für die Wärmepumpe/)
  assert.match(reasons({ method: 'volumeFormula', heatGeneration: 'mixed' }), /nicht allein/)
  assert.match(reasons({ method: 'areaFormula', heatGeneration: null }), /ob die Anlage die Wärme allein erzeugt/)
})

test('Wärmepumpe mit Wärmezähler am Warmwasser (A8): ohne Gesamtwärme heat-pump-dhw-basis, mit Gesamtwärme Q / Wärme', () => {
  const strom = { deliveries: [delivery({ label: 'Strom 2025', energyKwh: 12000 })], stock: null, earlier: null }
  const o = failure({ energy: 'heatPump', measured: { dhwKwh: 4500, totalKwh: null }, generator: strom })
  assert.equal(o.code, 'heating.heat-pump-dhw-basis')
  const mit = share({ energy: 'heatPump', measured: { dhwKwh: 4500, totalKwh: 36000 }, generator: strom })
  assert.equal(mit.alpha, 0.125)
  assert.deepEqual(mit.denominator, { kind: 'measuredTotalHeat', value: 36000, unit: 'kWh' })
  // Mehrere Erzeuger: gemessen nur gegen die gemessene Gesamtwärme (§ 9 Abs. 1 Satz 5).
  assert.match(reasons({ heatGeneration: 'mixed' }), /Gesamtwärme/)
  assert.equal(share({ heatGeneration: 'mixed', measured: { dhwKwh: 9000, totalKwh: 45000 } }).alpha, 0.2)
})

test('Fernwärme: Formelwert ÷ 1,15; gemessen gegen die gelieferte Wärme oder den Gesamtwärmezähler', () => {
  const fw = { deliveries: [delivery({ label: 'Fernwärme 2025', energyKwh: 40000 })], stock: null, earlier: null }
  // 6.400 / 1,15 = 5.565,22 kWh; / 40.000 = 13,91 %.
  const flaeche = share({ energy: 'districtHeating', method: 'areaFormula', generator: fw })
  assert.equal(pct(flaeche.alpha), 13.91)
  assert.deepEqual(flaeche.factor, { kind: 'heatSupply', value: 1.15 })
  assert.equal(flaeche.denominator.kind, 'deliveredHeat')
  assert.equal(share({ energy: 'districtHeating', measured: { dhwKwh: 6000, totalKwh: null }, generator: fw }).alpha, 0.15)
  assert.equal(share({ energy: 'districtHeating', measured: { dhwKwh: 6000, totalKwh: 30000 }, generator: fw }).alpha, 0.2)
})

test('Heizwert laut Rechnung vor Tabelle (R-A13): Heizöl aus dem Vorrat 25,51 % mit 9,8 kWh/l, 25,00 % mit der Tabelle; ohne beides kein Anteil', () => {
  // B = 15.000 / 9,8 = 1.530,61 l; / 6.000 l = 25,51 %. Tabelle: 15.000 / 10 = 1.500 l; 25,00 %.
  const rechnung = share(oilInput())
  assert.equal(pct(rechnung.alpha), 25.51)
  assert.deepEqual(rechnung.heatingValues, [{ label: 'Öl Oktober', kwh: 9.8, per: 'l', source: 'invoice', grade: 'heatingOilEL' }])
  assert.equal(rechnung.factor, null)
  const tabelle = share(oilInput({}, [oil({ heatingValue: null })]))
  assert.equal(tabelle.alpha, 0.25)
  assert.deepEqual(tabelle.heatingValues, [{ label: 'Öl Oktober', kwh: 10, per: 'l', source: 'table', grade: 'heatingOilEL' }])
  assert.match(reasons(oilInput({}, [oil({ heatingValue: null, fuelGrade: null })])), /„Öl Oktober“ nennt keinen Heizwert.*Zeile der Tabelle/)
  // Gemessen: B = 9.000 / 9,8 = 918,37 l; / 6.000 l = 15,31 %, ohne Faktor.
  assert.equal(pct(share(oilInput({ method: 'heatMeter' })).alpha), 15.31)
})

test('Mehrere Rechnungen: Heizwert mengengewichtet (Abweichung 6); ohne Lieferung in der Heizperiode der Heizwert der jüngsten früheren', () => {
  // (3.000 · 9,8 + 1.000 · 10,6) / 4.000 = 10,0 kWh/l; 15.000 / 10 / 6.000 = 25 %.
  assert.equal(share(oilInput({}, [oil(), oil({ id: 'o2', label: 'Öl Dezember', quantity: 1000, heatingValue: 10.6 })])).alpha, 0.25)
  const frueher = { deliveries: [], stock: { unit: 'l' as const, consumed: 6000 }, earlier: oil() }
  assert.equal(pct(share({ energy: 'oil', method: 'volumeFormula', generator: frueher }).alpha), 25.51)
  assert.match(reasons({ energy: 'oil', method: 'volumeFormula', generator: { ...frueher, earlier: null } }), /kein Heizwert bekannt/)
})

test('Flüssiggas in Litern: Die Tabelle nennt nur Kilogramm, und eine Dichte wird nicht erfunden', () => {
  const liter = { deliveries: [delivery({ label: 'Flüssiggas', quantity: 5000, quantityUnit: 'l', fuelGrade: 'lpg' })], stock: { unit: 'l' as const, consumed: 5000 }, earlier: null }
  assert.match(reasons({ energy: 'lpg', method: 'areaFormula', suppliedAreaM2: 150, generator: liter }), /nur je Kilogramm/)
  // 32 · 150 = 4.800 kWh; / 13 kWh/kg = 369,23 kg; / 2.000 kg = 18,46 %.
  const kg = { deliveries: [delivery({ label: 'Flüssiggas', quantity: 2000, quantityUnit: 'kg', fuelGrade: 'lpg' })], stock: { unit: 'kg' as const, consumed: 2000 }, earlier: null }
  assert.equal(pct(share({ energy: 'lpg', method: 'areaFormula', suppliedAreaM2: 150, generator: kg }).alpha), 18.46)
})

test('Tabelle nur bei Heizkesseln: Fernwärme ohne Kilowattstunden rechnet nicht', () => {
  const ohne = { deliveries: [delivery({ label: 'Fernwärme 2025' })], stock: null, earlier: null }
  assert.match(reasons({ energy: 'districtHeating', generator: ohne }), /„Fernwärme 2025“ nennt keine Kilowattstunden/)
})

test('Holzhackschnitzel (Abweichung 2): 2021 in Schüttraummetern mit 650 kWh/SRm, ab 12/2021 nur in Kilogramm mit 4 kWh/kg', () => {
  const srm = { deliveries: [delivery({ label: 'Hackschnitzel', quantity: 40, quantityUnit: 'srm', fuelGrade: 'woodChips' })], stock: { unit: 'srm' as const, consumed: 40 }, earlier: null }
  // 32 · 200 = 6.400 kWh; / 650 = 9,85 SRm; / 40 = 24,62 %.
  assert.equal(pct(share({ energy: 'wood', method: 'areaFormula', h: { from: '2021-01-01', to: '2021-12-31' }, generator: srm }).alpha), 24.62)
  assert.match(reasons({ energy: 'wood', method: 'areaFormula', h: { from: '2022-01-01', to: '2022-12-31' }, generator: srm }), /Litern, Kubikmetern oder Kilogramm/)
  // 6.400 / 4 = 1.600 kg; / 8.000 kg = 20 %.
  const kg = { deliveries: [delivery({ label: 'Hackschnitzel', quantity: 8000, quantityUnit: 'kg', fuelGrade: 'woodChips' })], stock: { unit: 'kg' as const, consumed: 8000 }, earlier: null }
  assert.equal(share({ energy: 'wood', method: 'areaFormula', h: { from: '2022-01-01', to: '2022-12-31' }, generator: kg }).alpha, 0.2)
})

test('Rumpf (Abweichung 3): Flächenformel nach Tagen gekürzt, Volumenformel nicht', () => {
  const rumpf = { from: '2025-01-01', to: '2025-04-30' }
  assert.deepEqual(yearShare(rumpf), { share: 120 / 365, days: 120, yearDays: 365 })
  assert.deepEqual(yearShare({ from: '2025-05-01', to: '2026-04-30' }), { share: 1, days: 365, yearDays: 365 })
  const gas = { deliveries: [gasKwh(20000)], stock: null, earlier: null }
  // 6.400 · 120 / 365 = 2.104,11 kWh · 1,11 = 2.335,56 kWh; / 20.000 = 11,68 %.
  const flaeche = share({ method: 'areaFormula', h: rumpf, generator: gas })
  assert.equal(pct(flaeche.alpha), 11.68)
  assert.ok(flaeche.steps.some((s) => /120 von 365 Tagen.*§ 9b Abs\. 2/.test(s)), flaeche.steps.join('\n'))
  // 2,5 · 40 · 50 = 5.000 · 1,11 = 5.550; / 20.000 = 27,75 %.
  assert.equal(pct(share({ method: 'volumeFormula', volumeM3: 40, h: rumpf, generator: gas }).alpha), 27.75)
})

test('Was fehlt oder nicht passt, wird gesagt, und es wird nicht gerechnet', () => {
  assert.match(reasons({ method: 'volumeFormula', volumeM3: null }), /gemessene Volumen des Warmwassers/)
  assert.match(reasons({ method: 'volumeFormula', tempC: 10 }), /nicht über der Kaltwassertemperatur von 10 °C/)
  assert.match(reasons({ method: 'areaFormula', suppliedAreaM2: 0 }), /0 m²/)
  assert.match(reasons({ method: 'volumeFormula', generator: { deliveries: [gasKwh(60000, null)], stock: null, earlier: null } }), /nach Brennwert oder nach Heizwert.*1,11/)
  const gemischt = { deliveries: [gasKwh(30000, 'hs', { id: 'a', label: 'Gas I' }), gasKwh(30000, 'hi', { id: 'b', label: 'Gas II' })], stock: null, earlier: null }
  assert.match(reasons({ generator: gemischt }), /teils nach Brennwert, teils nach Heizwert/)
  assert.match(reasons({ measured: { dhwKwh: 61000, totalKwh: null } }), /ganze Energie/)
  assert.match(reasons({ energy: 'electric', method: 'areaFormula', generator: { deliveries: [delivery({ label: 'Strom', energyKwh: 20000 })], stock: null, earlier: null } }), /Strom/)
  assert.match(reasons({ measured: { dhwKwh: null, totalKwh: null } }), /gemessene Wärme für das Warmwasser fehlt/)
})

test('Protokoll: nur die Rechtswerte, mit denen gerechnet wurde', () => {
  const gemessen = createLawLog()
  share({}, gemessen)
  assert.deepEqual(gemessen.values, [])
  const formel = createLawLog()
  share({ method: 'volumeFormula' }, formel)
  assert.deepEqual(formel.values.map((v) => v.id).sort(), ['hkv.dhw.factors', 'hkv.dhw.volume-formula'])
  const tabelle = createLawLog()
  share(oilInput({}, [oil({ heatingValue: null })]), tabelle)
  assert.ok(tabelle.values.some((v) => v.id === 'hkv.heating-values'))
})

test('Versorgte Fläche: angeschlossene Wohnungen ohne „kein Anschluss: Warmwasser“', () => {
  assert.equal(suppliedAreaOf([{ areaM2: 80 }, { areaM2: 60, noConnection: ['warmwasser'] }, { areaM2: 45, noConnection: ['kaltwasser'] }]), 125)
})

test('Aus PR 10 übernommen: Lücke in den Rechnungen, Schätzung beim Abschluss, Anteil außerhalb von 0 bis 100 %', () => {
  // PR 10 Abweichung 11: Der Anteil braucht Rechnungen über die ganze Heizperiode.
  const luecke = failure({ fuelCoveragePermille: 848.71 })
  assert.deepEqual([luecke.code, luecke.problem], ['heating.dhw-share-invalid', 'fuelGap'])
  assert.match(luecke.reasons.join(' '), /Folgerechnung.*Schätzung/)
  assert.equal(failure({ fuelCoveragePermille: null }).problem, 'fuelGap')
  // Beim Vorrat zählt die verbrauchte Menge; die Abdeckung der Rechnungen spielt dort keine Rolle.
  assert.equal(pct(share(oilInput({ fuelCoveragePermille: null })).alpha), 25.51)
  // Die Schätzung beim Abschluss trägt die kWh der fehlenden Rechnung; α beruht dann auf ihr.
  assert.equal(share({ fuelEstimated: true }).estimated, true)
  assert.equal(share().estimated, false)
  assert.equal(share({ energy: 'districtHeating', measured: { dhwKwh: 6000, totalKwh: 30000 }, fuelEstimated: true }).estimated, false, 'gegen gemessene Gesamtwärme')
  // α außerhalb von (0, 1) ist ein Widerspruch, kein Anteil.
  assert.deepEqual([failure({ measured: { dhwKwh: 0, totalKwh: null } }).problem, failure({ measured: { dhwKwh: 60000, totalKwh: null } }).problem], ['outOfRange', 'outOfRange'])
  assert.equal(failure({ measured: { dhwKwh: null, totalKwh: null } }).problem, 'noDhwHeat')
  assert.equal(failure({ generator: { deliveries: [delivery({ label: 'Gas' })], stock: null, earlier: null } }).problem, 'noFuelEnergy')
  // Die Energie des Nenners in kWh, auch bei Brennstoff als Menge: 6.000 l · 9,8 kWh/l = 58.800 kWh.
  assert.equal(share().energyKwh, 60000)
  assert.equal(Math.round(share(oilInput()).energyKwh), 58800)
})

test('Stromheizung (Abweichung 7, Prüfbericht A6): gemessen gegen den Strom laut Rechnung wie in PR 10; die Formeln rechnen nicht', () => {
  const strom = { deliveries: [delivery({ label: 'Strom 2025', energyKwh: 30000 })], stock: null, earlier: null }
  // 4.500 kWh am Wärmezähler des Speichers gegen 30.000 kWh Strom: 15 %. Ein Elektrokessel setzt Strom
  // nahezu ohne Verlust in Wärme um; das ist der Fall des § 9 Abs. 1 Satz 2 („Energieverbrauch“).
  const gemessen = share({ energy: 'electric', measured: { dhwKwh: 4500, totalKwh: null }, generator: strom })
  assert.equal(gemessen.alpha, 0.15)
  assert.deepEqual(gemessen.denominator, { kind: 'electricity', value: 30000, unit: 'kWh' })
  const formel = failure({ energy: 'electric', method: 'volumeFormula', generator: strom })
  assert.equal(formel.problem, 'formulaInput')
  assert.match(formel.reasons.join(' '), /Stromheizung.*keinen Faktor.*Wärmezähler am Warmwasserspeicher/)
})

test('Kesseltausch (PR 9): Flächenformel nach den Tagen der Laufzeit, Volumen nur der Laufzeit; kWh der Rechnung aus der Bewertung', () => {
  // Die neue Anlage läuft ab 01.07.2025: 184 von 365 Tagen. 6.400 · 184 / 365 = 3.226,30 kWh · 1,11 = 3.581,19 kWh; / 30.000 = 11,94 %.
  const gas = { deliveries: [gasKwh(30000)], stock: null, earlier: null }
  const neu = share({ method: 'areaFormula', running: { from: '2025-07-01', to: '2025-12-31' }, generator: gas })
  assert.equal(pct(neu.alpha), 11.94)
  assert.ok(neu.steps.some((s) => /Anlage lief in dieser Heizperiode 184 von 365 Tagen/.test(s)), neu.steps.join('\n'))
  assert.match(reasons({ method: 'volumeFormula', volumeM3: null, running: { from: '2025-07-01', to: '2025-12-31' } }), /Volumen des Warmwassers in der Laufzeit dieser Anlage/)
  // Die Bewertung der Lieferungen (PR 7) weist die kWh in der Heizperiode aus, samt Teilmengen; sie geht vor.
  const teil = { deliveries: [delivery({ label: 'Gas mit Teilmengen', energyKwh: null, gasBasis: 'hs', kwhInPeriod: 60000 })], stock: null, earlier: null }
  assert.equal(share({ generator: teil }).alpha, 0.15)
  const nurTeile = { deliveries: [delivery({ label: 'Gas mit Teilmengen', energyKwh: null, parts: [{ energyKwh: 20000 }, { energyKwh: 40000 }] })], stock: null, earlier: null }
  assert.equal(share({ generator: nurTeile }).alpha, 0.15)
})
