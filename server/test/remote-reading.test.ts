// Fernablesbarkeit der Erfassungsgeräte (Heizung PR 4, Entwurf 3.13, 4.7, R-A1, G-C2). Geprüft wird
// die Entscheidung allein; Hinweise und Beträge stehen in calc-heizanlage.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLawLog, type Period } from '../../shared/law/register.ts'
import type { DevicesInstalledAfter, DevicesRemote } from '../../shared/types.ts'
import { plantDevices, plantVerdict, remoteReadingVerdict, type RemoteLevel, type RemoteMeter, type RemotePlant, type RemoteUnit } from '../src/remoteReading.ts'

const year = (y: number): Period => ({ from: `${y}-01-01`, to: `${y}-12-31` })
const anlage = (over: Partial<RemotePlant> = {}): RemotePlant => ({ id: 'hp1', devicesRemote: 'unknown', devicesInstalledAfter2021: 'unknown', units: null, ...over })
const hkv = (id: string, over: Partial<RemoteMeter> = {}): RemoteMeter => ({
  id, unitId: 'a', type: 'hkv', heatingPlantId: null, heatingRole: null, remoteReadable: null, installedOn: null, ...over,
})
const UNITS: RemoteUnit[] = [{ id: 'a' }, { id: 'b' }, { id: 'garage', noConnection: ['waerme'] }]
const level = (plant: RemotePlant, meters: RemoteMeter[], period: Period): RemoteLevel => plantVerdict(plant, meters, UNITS, period, createLawLog()).level

test('4.7: Gerät eingebaut 15.11.2021, nicht fernablesbar: 2026 keine Kürzung, 2027 die volle', () => {
  const m = [hkv('m1', { remoteReadable: false, installedOn: '2021-11-15' })]
  assert.equal(level(anlage(), m, year(2026)), 'fine')
  assert.equal(level(anlage(), m, year(2027)), 'required')
  // Ein Zeitraum, der 2027 nur berührt: „bis zu“ (Entwurf 3.13, 15.1 Nr. 7).
  assert.equal(level(anlage(), m, { from: '2026-07-01', to: '2027-06-30' }), 'possible')
})

test('4.7 und R-A1: Gerät eingebaut 15.12.2021, nicht fernablesbar: Kürzung schon 2022 und 2025', () => {
  const m = [hkv('m1', { remoteReadable: false, installedOn: '2021-12-15' })]
  assert.equal(level(anlage(), m, year(2022)), 'required')
  assert.equal(level(anlage(), m, year(2025)), 'required')
})

test('3.13: Einbaudatum unbekannt, nicht fernablesbar: „bis zu“ schon heute, ab 2027 sicher', () => {
  const m = [hkv('m1', { remoteReadable: false })]
  assert.equal(level(anlage(), m, year(2025)), 'possible')
  assert.equal(level(anlage(), m, year(2027)), 'required')
})

test('Erst nach dem Zeitraum eingebaut: in diesem Zeitraum nichts', () => {
  assert.equal(level(anlage(), [hkv('m1', { remoteReadable: false, installedOn: '2026-03-01' })], year(2025)), 'fine')
})

test('Fernablesbar, unbekannt, gemischt', () => {
  assert.equal(level(anlage(), [hkv('m1', { remoteReadable: true })], year(2027)), 'fine')
  assert.equal(level(anlage(), [hkv('m1')], year(2027)), 'unknown')
  assert.equal(level(anlage(), [hkv('m1', { remoteReadable: true }), hkv('m2')], year(2027)), 'unknown')
  assert.equal(level(anlage(), [], year(2027)), 'unknown')
})

test('Angabe an der Anlage, wenn Mietfuchs die Geräte nicht kennt (G-C2)', () => {
  const faelle: [DevicesRemote, DevicesInstalledAfter, Period, RemoteLevel][] = [
    ['all', 'all', year(2027), 'fine'],
    ['unknown', 'all', year(2027), 'unknown'],
    ['none', 'all', year(2025), 'required'],
    ['none', 'all', year(2020), 'fine'],
    ['none', 'some', year(2025), 'required'],
    ['partial', 'all', year(2025), 'required'],
    ['partial', 'some', year(2025), 'possible'],
    ['partial', 'some', year(2027), 'required'],
    ['none', 'none', year(2025), 'fine'],
    ['none', 'none', year(2027), 'required'],
    ['none', 'none', { from: '2026-07-01', to: '2027-06-30' }, 'possible'],
    ['none', 'unknown', year(2025), 'possible'],
  ]
  for (const [remote, after, period, erwartet] of faelle) {
    assert.equal(level(anlage({ devicesRemote: remote, devicesInstalledAfter2021: after }), [], period), erwartet, `${remote}/${after} ab ${period.from}`)
  }
})

test('Angabe und Zähler zusammen: das Schwerere gilt; unbekannte Zähler zählen neben einer Angabe nicht', () => {
  assert.equal(level(anlage({ devicesRemote: 'all' }), [hkv('m1', { remoteReadable: false, installedOn: '2021-12-15' })], year(2025)), 'required')
  assert.equal(level(anlage({ devicesRemote: 'all' }), [hkv('m1')], year(2027)), 'fine')
  assert.equal(level(anlage(), [hkv('m1', { remoteReadable: true })], year(2027)), 'fine')
})

test('Geräte der Anlage: Wärme, Warmwasser und HKV ihrer Wohnungen und ihre eigenen Wärmezähler, nicht der Gaszähler', () => {
  const meters: RemoteMeter[] = [
    hkv('a-hkv'),
    hkv('b-kalt', { unitId: 'b', type: 'kaltwasser' }),
    hkv('b-warm', { unitId: 'b', type: 'warmwasser' }),
    hkv('garage-waerme', { unitId: 'garage', type: 'waerme' }),
    hkv('gas', { unitId: null, type: 'sonstig', heatingPlantId: 'hp1', heatingRole: 'supply' }),
    hkv('speicher', { unitId: null, type: 'waerme', heatingPlantId: 'hp1', heatingRole: 'dhwHeat' }),
    hkv('haus', { unitId: null, type: 'waerme' }),
  ]
  assert.deepEqual(plantDevices(anlage(), meters, UNITS).map((m) => m.id), ['a-hkv', 'b-warm', 'speicher'])
  assert.deepEqual(plantDevices(anlage({ units: [{ unitId: 'b', heatedAreaM2: null }] }), meters, UNITS).map((m) => m.id), ['b-warm', 'speicher'])
  assert.deepEqual(plantDevices(anlage({ units: [] }), meters, UNITS).map((m) => m.id), ['speicher'])
})

test('Mehrere Anlagen: das Schwerere gilt, die Zähler dieser Stufe werden genannt', () => {
  const v = remoteReadingVerdict(
    [anlage({ devicesRemote: 'all' }), anlage({ id: 'hp2', units: [{ unitId: 'b', heatedAreaM2: null }] })],
    [hkv('b-hkv', { unitId: 'b', remoteReadable: false, installedOn: '2023-05-01' })],
    UNITS, year(2025), createLawLog(),
  )
  assert.deepEqual(v, { level: 'required', meterIds: ['b-hkv'], byAnswer: false })
  assert.equal(remoteReadingVerdict([], [], UNITS, year(2025), createLawLog()), null)
})

test('Protokoll: ohne Angabe und ohne bekannte Geräte wird kein Rechtswert abgefragt', () => {
  const log = createLawLog()
  plantVerdict(anlage(), [hkv('m1')], UNITS, year(2027), log)
  assert.deepEqual(log.values, [])
})
