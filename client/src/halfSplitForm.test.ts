// Die Karte „Heizung nach § 43 GModG“ (Heizung PR 18, #215): Was aus dem Formular in den Rumpf der Anlage wird.
import { expect, test } from 'vitest'
import { halfSplitAvailable, halfSplitBody, halfSplitToForm, noticeBody, noticeTenancies, PRIOR_DUTY_QUESTION, type HalfSplitForm } from './halfSplitForm'
import type { HeatingEnergy } from './types'

const leer = { gmodg43InstalledOn: null, emergencyInstall: null, emergencyPriorDuty: null, newBuildingFirstUse: null, buildingApplicationBefore20260513: null }
const form = (over: Partial<HalfSplitForm>): HalfSplitForm => ({ ...halfSplitToForm(leer), ...over })

test('nur bei Gas, Öl und Flüssiggas', () => {
  const energies: HeatingEnergy[] = ['gas', 'oil', 'lpg', 'districtHeating', 'heatPump', 'pellets']
  expect(energies.map((e) => halfSplitAvailable(e))).toEqual([true, true, true, false, false, false])
})

test('ohne Tag des Einbaus gehen alle Merkmale leer', () => {
  expect(halfSplitBody(form({ emergency: true, priorDuty: 'no' }))).toEqual({ body: leer })
})

test('Notfalleinbau mit ja/nein/unbekannt, Neubau mit Bauantrag', () => {
  expect(halfSplitBody(form({ installedOn: '2027-06-15', emergency: true, priorDuty: 'no' }))).toEqual({
    body: { ...leer, gmodg43InstalledOn: '2027-06-15', emergencyInstall: true, emergencyPriorDuty: false },
  })
  expect(halfSplitBody(form({ installedOn: '2027-06-15', emergency: true, priorDuty: 'yes' }))).toMatchObject({ body: { emergencyInstall: true, emergencyPriorDuty: true } })
  expect(halfSplitBody(form({ installedOn: '2027-06-15', emergency: false, priorDuty: 'yes' }))).toMatchObject({ body: { emergencyInstall: false, emergencyPriorDuty: null } })
  expect(halfSplitBody(form({ installedOn: '2027-06-15', newBuilding: true, firstUse: '2028-02-01', applicationBefore: 'unknown' }))).toMatchObject({
    body: { newBuildingFirstUse: '2028-02-01', buildingApplicationBefore20260513: null },
  })
  expect(halfSplitBody(form({ installedOn: '2027-06-15', newBuilding: true, firstUse: '' }))).toEqual({ error: 'Bitte geben Sie den Tag an, an dem das neue Gebäude erstmals genutzt wurde.' })
})

test('Hin und zurück', () => {
  const p = { ...leer, gmodg43InstalledOn: '2028-03-01', emergencyInstall: true, emergencyPriorDuty: true }
  expect(halfSplitBody(halfSplitToForm(p))).toEqual({ body: p })
})

test('Prüfung M8: gefragt wird nach dem Einbau der ausgefallenen Heizung, nicht nach der Pflicht', () => {
  expect(PRIOR_DUTY_QUESTION).toBe('War die ausgefallene Heizung eine Gas-, Öl- oder Flüssiggasheizung, die nach dem 29.07.2026 in das bestehende Gebäude eingebaut wurde?')
})

test('Mitteilung nach § 5d Abs. 4 je Mietverhältnis (Abweichung 3)', () => {
  const t = (id: string, unitId: string, end: string | null) => ({ id, unitId, tenantName: id, start: '2020-01-01', end })
  const plant = { units: [{ unitId: 'oben', heatedAreaM2: null }] }
  // Nur Wohnungen an der Anlage, nur Mietverhältnisse, die am Tag der Teilung noch laufen.
  expect(noticeTenancies([t('a', 'oben', null), t('b', 'oben', '2026-12-31'), t('c', 'garage', null)], plant, '2028-01-01').map((x) => x.id)).toEqual(['a'])
  expect(noticeTenancies([t('a', 'oben', null), t('c', 'garage', null)], { units: null }, '2028-01-01').map((x) => x.id)).toEqual(['a', 'c'])
  expect(noticeBody('')).toEqual({ body: { halfSplitNoticeOn: null } })
  expect(noticeBody('2028-03-15')).toEqual({ body: { halfSplitNoticeOn: '2028-03-15' } })
  expect(noticeBody('15.03.2028')).toEqual({ error: 'Bitte wählen Sie den Tag der Mitteilung im Kalender.' })
})
