// Die Schätzhilfe für den Betriebsstrom (Heizung PR 15, #212): nach Leistung und Heiztagen (BGH V ZR
// 166/15 Rn. 14) oder gemessen, als Anteil an der Stromrechnung (Abweichung 3), oder selbst geschätzt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { basisOf, operatingPowerRefusal, operatingPowerShare, ownEstimateShare, type OperatingPowerInput } from '../../shared/operatingPower.ts'

const GERAETE = [
  { label: 'Brenner', watts: 120, hoursPerDay: 6 },
  { label: 'Umwälzpumpe', watts: 45, hoursPerDay: 24 },
  { label: 'Regelung', watts: 5, hoursPerDay: 24 },
]
const geschaetzt = (over: Partial<OperatingPowerInput> = {}): OperatingPowerInput =>
  ({ devices: GERAETE, heatingDays: 220, measuredKwh: null, billKwh: 3000, billCents: 105000, ...over })

test('Schätzung: 120 W · 6 h + 45 W · 24 h + 5 W · 24 h an 220 Tagen = 422,4 kWh, 14,08 % des Rechnungsbetrags einschließlich Grundpreis (1.050,00 €) = 147,84 €', () => {
  const r = operatingPowerShare(geschaetzt())
  if ('error' in r) return assert.fail(r.error)
  assert.ok(Math.abs(r.kwh - 422.4) < 1e-9, String(r.kwh))
  assert.equal(r.measured, false)
  assert.ok(Math.abs(r.permille - 140.8) < 1e-9, String(r.permille))
  assert.equal(r.cents, 14784)
  assert.deepEqual(r.steps, [
    'Brenner: 120 W × 6 h × 220 Tage = 158,4 kWh',
    'Umwälzpumpe: 45 W × 24 h × 220 Tage = 237,6 kWh',
    'Regelung: 5 W × 24 h × 220 Tage = 26,4 kWh',
    'zusammen 422,4 kWh von 3.000 kWh der Stromrechnung = 14,08 %',
    '14,08 % des Rechnungsbetrags einschließlich Grundpreis (1.050,00 €) = 147,84 €',
  ])
})

test('Gemessen mit Zwischenzähler: 500 kWh von 3.000 kWh, Geräte und Heiztage zählen nicht', () => {
  const r = operatingPowerShare(geschaetzt({ devices: null, heatingDays: null, measuredKwh: 500 }))
  if ('error' in r) return assert.fail(r.error)
  assert.equal(r.measured, true)
  assert.equal(r.cents, 17500)
  assert.equal(r.steps[0], 'gemessen mit Zwischenzähler: 500 kWh von 3.000 kWh der Stromrechnung = 16,67 %')
})

test('Rundung kaufmännisch auf den Cent: 1 kWh von 3 kWh aus 1,00 € = 0,33 €; 2 von 3 = 0,67 €', () => {
  const a = operatingPowerShare({ devices: null, heatingDays: null, measuredKwh: 1, billKwh: 3, billCents: 100 })
  const b = operatingPowerShare({ devices: null, heatingDays: null, measuredKwh: 2, billKwh: 3, billCents: 100 })
  assert.deepEqual(['error' in a ? a.error : a.cents, 'error' in b ? b.error : b.cents], [33, 67])
})

test('Review Focus 4: mehr kWh als die Stromrechnung ist ein Fehler mit beiden Zahlen', () => {
  const r = operatingPowerShare(geschaetzt({ devices: [{ label: 'Brenner', watts: 120000, hoursPerDay: 6 }] }))
  assert.ok('error' in r)
  assert.match(r.error, /158\.400 kWh/)
  assert.match(r.error, /3\.000 kWh/)
})

test('Eingaben: ohne Gerät, ohne Heiztage, Laufzeit über 24 h, Heiztage über 366, Leistung 0, Stromrechnung ohne kWh oder Betrag', () => {
  const fehler = (i: OperatingPowerInput): string => { const r = operatingPowerShare(i); return 'error' in r ? r.error : '' }
  assert.match(fehler(geschaetzt({ devices: [] })), /mindestens ein Gerät/)
  assert.match(fehler(geschaetzt({ heatingDays: null })), /Heiztage/)
  assert.match(fehler(geschaetzt({ heatingDays: 400 })), /Heiztage/)
  assert.match(fehler(geschaetzt({ devices: [{ label: 'P', watts: 45, hoursPerDay: 25 }] })), /höchstens 24 Stunden/)
  assert.match(fehler(geschaetzt({ devices: [{ label: 'P', watts: 0, hoursPerDay: 24 }] })), /Leistung/)
  assert.match(fehler(geschaetzt({ billKwh: 0 })), /kWh der Stromrechnung/)
  assert.match(fehler(geschaetzt({ billCents: 0 })), /Betrag der Stromrechnung/)
  assert.match(fehler(geschaetzt({ devices: null, heatingDays: null, measuredKwh: 0 })), /gemessenen kWh/)
  assert.match(fehler(geschaetzt({ devices: [{ label: 'P', watts: 45, hoursPerDay: 24, days: 400 }] })), /Tage von „P“/)
})

// P-K8: Die Heizungs-Umwälzpumpe läuft nur in der Heizzeit, die Warmwasserpumpe das ganze Jahr.
test('Tage je Gerät: ohne Angabe die Heiztage, mit Angabe die eigenen Tage, im Rechenweg genannt', () => {
  const r = operatingPowerShare(geschaetzt({ devices: [
    { label: 'Umwälzpumpe Heizung', watts: 45, hoursPerDay: 24 },
    { label: 'Warmwasserpumpe', watts: 25, hoursPerDay: 4, days: 360 },
  ] }))
  if ('error' in r) return assert.fail(r.error)
  // 45 × 24 × 220 / 1000 = 237,6; 25 × 4 × 360 / 1000 = 36; Σ 273,6 kWh; 273,6 / 3.000 × 1.050,00 € = 95,76 €
  assert.ok(Math.abs(r.kwh - 273.6) < 1e-9, String(r.kwh))
  assert.equal(r.cents, 9576)
  assert.deepEqual(r.steps.slice(0, 2), [
    'Umwälzpumpe Heizung: 45 W × 24 h × 220 Tage = 237,6 kWh',
    'Warmwasserpumpe: 25 W × 4 h × 360 Tage = 36 kWh',
  ])
})

// P-W2: der Weg „Betrag selbst geschätzt“, etwa nach einem Bruchteil der Brennstoffkosten (V ZR 166/15
// Rn. 14). Mietfuchs gibt keinen Prozentsatz vor; die Grundlage ist Pflicht.
test('Selbst geschätzt: Betrag und Grundlage, kein Prozentsatz im Rechenweg', () => {
  const r = ownEstimateShare({ cents: 14784, basis: '5 % der Brennstoffkosten 2025 (2.956,80 €), Typenschilder nicht lesbar', billCents: 105000 })
  if ('error' in r) return assert.fail(r.error)
  assert.equal(r.cents, 14784)
  assert.deepEqual(r.steps, [
    'selbst geschätzt: 147,84 €',
    'Grundlage der Schätzung: 5 % der Brennstoffkosten 2025 (2.956,80 €), Typenschilder nicht lesbar',
  ])
  // Kein eigener Anteil am Allgemeinstrom: Der BGH nennt einen Bruchteil der Brennstoffkosten.
  assert.ok(!r.steps.some((s) => /des Rechnungsbetrags/.test(s)))
})

test('Selbst geschätzt: ohne Grundlage, ohne Betrag oder über der Stromrechnung ein Fehler mit Satz', () => {
  const fehler = (i: Parameters<typeof ownEstimateShare>[0]): string => { const r = ownEstimateShare(i); return 'error' in r ? r.error : '' }
  assert.match(fehler({ cents: 14784, basis: '  ', billCents: 105000 }), /Grundlage der Schätzung/)
  assert.match(fehler({ cents: null, basis: 'x', billCents: 105000 }), /Betrag/)
  assert.match(fehler({ cents: 0, basis: 'x', billCents: 105000 }), /Betrag/)
  assert.match(fehler({ cents: 105001, basis: 'x', billCents: 105000 }), /1\.050,01 € liegen über dem Betrag der Stromrechnung \(1\.050,00 €\)/)
  // Genau der Betrag der Stromrechnung ist erlaubt.
  assert.equal(fehler({ cents: 105000, basis: 'x', billCents: 105000 }), '')
})

// P-W5, R2-W1, R-W2 (Durchsicht von #252): § 7 Abs. 2 HeizkostenV nennt seit dem 01.10.2024 die „Kosten des
// zur Wärmeerzeugung verbrauchten Stroms“ neben den Brennstoffen; der Strom ist also kein Brennstoff, aber
// auch kein Betriebsstrom. Dass er aus dem Allgemeinstrom herauszurechnen ist, ist eine Auslegung.
// Umwälzpumpen und Regelung über den Hauszähler bleiben Betriebsstrom (V ZR 166/15 Rn. 13).
test('Wärmepumpe und Stromheizung: keine Schätzhilfe, eigener Satz mit dem Weg für Pumpen und Regelung; jede andere Energie: Hilfe', () => {
  for (const [energy, erzeuger] of [['heatPump', 'Wärmepumpe'], ['electric', 'Stromheizung']] as const) {
    const satz = operatingPowerRefusal(energy) ?? assert.fail(`${energy}: keine Ablehnung`)
    assert.match(satz, new RegExp(`Bei einer ${erzeuger} gehört der Strom, den .* zur Wärmeerzeugung verbraucht, zu den Heiz- und Warmwasserkosten, und zwar nicht als Betriebsstrom`))
    assert.match(satz, /seit dem 01\.10\.2024 eigens neben den Brennstoffen \(„Kosten des zur Wärmeerzeugung verbrauchten Stroms“, § 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV\)/)
    assert.match(satz, /Teil „Brennstoff\/Energie“/)
    assert.match(satz, /ist eine Auslegung von Mietfuchs/)
    // R-W2: Den Abzug für diesen Strom kann Mietfuchs jetzt mit der Heizposition verknüpfen.
    assert.match(satz, /kennzeichnen Sie die Heizposition im Kostenformular/)
    assert.doesNotMatch(satz, /Brennstoff und kein Betriebsstrom|ist der Strom Brennstoff|Kosten der verbrauchten Brennstoffe|noch nicht mit der Heizposition verknüpfen/)
    assert.match(satz, /Umwälzpumpen oder Regelung/)
    assert.match(satz, /beim Allgemeinstrom abzuziehen \(§ 7 Abs\. 2, § 8 Abs\. 2 HeizkostenV; BGH, Urteil vom 03\.06\.2016, V ZR 166\/15, Rn\. 13\)/)
    assert.match(satz, /im Kostenformular als Betriebsstrom/)
    assert.match(satz, /verknüpfen Sie den Abzug/)
    // Der frühere Satz erklärte jeden Strom zum Brennstoff.
    assert.doesNotMatch(satz, /ist der Strom Brennstoff, nicht Betriebsstrom/)
  }
  assert.match(operatingPowerRefusal('electric') ?? '', /Elektrokessel/)
  for (const energy of ['gas', 'oil', 'lpg', 'pellets', 'wood', 'districtHeating', 'coal', 'other'] as const) {
    assert.equal(operatingPowerRefusal(energy), null, energy)
  }
})

test('Grundlage (P-W1): die Zeilen des Rechenwegs, je eine Zeile', () => {
  assert.equal(basisOf(['a: 1 kWh', 'b: 2 kWh']), 'a: 1 kWh\nb: 2 kWh')
})
