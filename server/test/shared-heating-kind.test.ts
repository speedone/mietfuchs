// Art einer Heizposition nach ihrer Beschreibung (shared/heatingKind.ts, Nachprüfung von #721). Davon hängen die Warnung
// `heating.fuel-for-self-supply`, die Stille der Rückfrage „Dieselbe Rechnung?“ und die Betriebsstromfrage im
// Kostenformular ab. Unbekannt (`null`) ist die sichere Seite: keine Warnung, die Rückfrage bleibt. Eine falsche bekannte
// Art ist gefährlich, etwa Wartung als Brennstoff (die Warnung rät dann, umlegbare Wartung zu löschen).
import test from 'node:test'
import assert from 'node:assert/strict'
import { heatingKindOf, type HeatingKind } from '../../shared/heatingKind.ts'

const TABLE: readonly [string, HeatingKind | null][] = [
  // Brennstoff oder Energie: Die Beschreibung nennt den Brennstoff oder die Energie selbst.
  ['Gasrechnung Stadtwerke 2025', 'fuel'], ['Erdgas Jahresabrechnung', 'fuel'], ['Gas Abschläge Jan-Dez', 'fuel'],
  ['Abschlag Gas', 'fuel'], ['Jahresrechnung Erdgas', 'fuel'], ['Gas Schätzung', 'fuel'], ['Gutschrift Gas', 'fuel'],
  ['Fernwärme Jahresabrechnung', 'fuel'], ['Fernwärme Grundpreis', 'fuel'], ['Fernwärme Arbeitspreis', 'fuel'],
  ['Grundpreis Wärme', 'fuel'], ['Wärmelieferung Contracting', 'fuel'], ['Contracting Grundpreis', 'fuel'],
  ['Contractingrate', 'fuel'], ['Nahwärme Abschlag', 'fuel'], ['Heizöl 2.300 Liter', 'fuel'], ['Öllieferung', 'fuel'],
  ['Heizöllieferung Nov', 'fuel'], ['Pellets 6 t', 'fuel'], ['Holzpellets Lieferung', 'fuel'],
  ['Flüssiggas Tankfüllung', 'fuel'], ['Propan', 'fuel'], ['Brennholz', 'fuel'], ['Holz', 'fuel'], ['Hackschnitzel', 'fuel'],
  ['Strom Wärmepumpe', 'fuel'], ['Stromrechnung Wärmepumpe', 'fuel'], ['Wärmepumpenstrom', 'fuel'],
  ['Wärmepumpentarif', 'fuel'], ['Heizstrom', 'fuel'], ['Nachtspeicherstrom', 'fuel'], ['Nachtspeicherheizung Strom', 'fuel'],
  ['Biogas', 'fuel'],
  // Zu allgemein: „Energie“ kann auch der Energieausweis sein, „Stadtwerke“ auch Wasser oder Allgemeinstrom.
  ['Energie Heizung', null], ['Stadtwerke Abrechnung', null],
  // Wartung, Kundendienst, Reparatur, Prüfung und Reinigung, auch wenn die Beschreibung den Brennstoff nennt.
  ['Wartung Gastherme', 'maintenance'], ['Gasthermenwartung', 'maintenance'], ['Kundendienst Gastherme', 'maintenance'],
  ['Thermenservice', 'maintenance'], ['Inspektion Heizung', 'maintenance'], ['Brennerwartung', 'maintenance'],
  ['Reparatur Brenner', 'maintenance'], ['Reparatur Gastherme', 'maintenance'], ['Ölbrenner Service', 'maintenance'],
  ['Heizungsservice', 'maintenance'], ['Wartung Wärmepumpe', 'maintenance'], ['Kesselreinigung', 'maintenance'],
  ['Öltankreinigung', 'maintenance'], ['Tankreinigung', 'maintenance'], ['Heizöltank Reinigung', 'maintenance'],
  ['Gasleitung Dichtheitsprüfung', 'maintenance'], ['Öltank TÜV-Prüfung', 'maintenance'],
  ['Wasseraufbereitung Heizung', 'maintenance'], ['Heizungswasser Enthärtung', 'maintenance'],
  // Schornsteinfeger
  ['Schornsteinfeger', 'chimney'], ['Kehrgebühr', 'chimney'], ['Abgasmessung', 'chimney'], ['Feuerstättenschau', 'chimney'],
  ['Immissionsschutzmessung', 'chimney'], ['Bezirksschornsteinfeger Gebühr', 'chimney'], ['Kaminkehrer', 'chimney'],
  ['Emissionsmessung Gastherme', 'chimney'],
  // Messdienst
  ['Messdienst', 'metering'], ['Ablesung Heizkostenverteiler', 'metering'], ['Heizkostenabrechnung Messdienst', 'metering'],
  ['Gerätemiete Wärmezähler', 'metering'], ['Miete Wärmezähler', 'metering'], ['Verbrauchserfassung', 'metering'],
  ['Abrechnungsservice Wärme', 'metering'], ['Funkablesung', 'metering'], ['Eichung Wärmezähler', 'metering'],
  // „Heizkostenabrechnung“ allein kann die ganze Abrechnung sein; der Gaszähler ist ein Bauteil, kein Brennstoff.
  ['Heizkostenabrechnung', null], ['Gaszähler Miete', null],
  // Betriebsstrom
  ['Betriebsstrom Heizung', 'power'], ['Pumpenstrom', 'power'], ['Umwälzpumpe Strom', 'power'],
  ['Heizungspumpe Strom', 'power'], ['Strom für Brenner und Pumpe', 'power'],
  // An einer Wärmepumpe ist der Strom der Anlage die Energie, sonst Betriebsstrom: unbekannt.
  ['Strom Heizungsanlage', null],
]

// Dazu, was das Kostenformular und die bisherigen Tests brauchen: Tätigkeiten an Pumpe, Brenner und Elektrik sind Wartung,
// ein Bauteil ohne Tätigkeit ist unbekannt, nie Brennstoff.
const MORE: readonly [string, HeatingKind | null][] = [
  ['Heizungspumpe getauscht', 'maintenance'], ['Austausch Umwälzpumpe', 'maintenance'], ['Pumpe Reparatur', 'maintenance'],
  ['Elektriker Heizung', 'maintenance'], ['Wartung Brenner', 'maintenance'], ['Wartung Ölheizung', 'maintenance'],
  ['Wartung Übergabestation', 'maintenance'], ['Instandsetzung Kessel', 'maintenance'],
  ['Gastherme', null], ['Öltank', null], ['Gasleitung', null], ['Ölkessel', null], ['Umwälzpumpe und Regelung', null],
  ['Brenner und Pumpe', null], ['Heizstab', null], ['Wärmepumpe 2025', null], ['Heizungsstrom', null], ['', null],
  ['Strom für Wärmepumpe', 'fuel'], ['Öltank Befüllung', 'fuel'], ['Gas 2025', 'fuel'], ['Messdienst Ablesung', 'metering'],
]

test('Nachprüfung #721: heatingKindOf ordnet jede Beschreibung der Tabelle ihrer Art zu', () => {
  const wrong = [...TABLE, ...MORE].map(([d, expected]) => [d, expected, heatingKindOf(d)] as const).filter(([, e, k]) => e !== k)
  assert.deepEqual(wrong.map(([d, e, k]) => `${d}: erwartet ${e}, ist ${k}`), [])
})

test('Nachprüfung #721: Die Tabelle trägt die 79 Beschreibungen der Probe', () => {
  assert.equal(TABLE.length, 79)
  assert.equal(new Set(TABLE.map(([d]) => d)).size, 79)
})

test('Nachprüfung #721: Bauteil und Brennstoff ist nie Brennstoff, Großschreibung und Zusammensetzung gleich', () => {
  for (const d of ['GASTHERME KUNDENDIENST', 'Gasthermenkundendienst', 'Ölbrennerservice', 'Gaszählermiete', 'Gas-Therme Reparatur']) {
    assert.notEqual(heatingKindOf(d), 'fuel', d)
  }
  assert.equal(heatingKindOf('WÄRMEPUMPENSTROM'), 'fuel')
  assert.equal(heatingKindOf(undefined), null)
  assert.equal(heatingKindOf(null), null)
})

// Integrationsdurchsicht mit #724: Dieselbe Liste erkennt in server/src/operatingPower.ts die Rechnung des Schornsteinfegers
// (`chimneySweepLike`). Auch das Kehren selbst; die Abgasanlage allein ist keine Messung, „Rückkehr“ kein Kehren.
test('Integrationsdurchsicht #724: Kehren am Wortanfang ist Schornsteinfeger, Reparatur der Abgasanlage ist Wartung', () => {
  assert.equal(heatingKindOf('Kehren 2025'), 'chimney')
  assert.equal(heatingKindOf('Kehrbezirk Gebühr'), 'chimney')
  assert.equal(heatingKindOf('Reparatur Abgasanlage'), 'maintenance')
  assert.equal(heatingKindOf('Rückkehr Monteur'), null)
})
