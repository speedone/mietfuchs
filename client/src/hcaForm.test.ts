import { expect, test } from 'vitest'
import { cutoffReadingBody, ratedText, exactText, hcaFieldsBody, hcaFieldsOf, hcaSummary, HCA_SCALE_OPTIONS, isCutoffReading, serviceRowsOf, serviceValuesBody, setupDoneText } from './hcaForm'
import { periodKey } from '../../shared/period.ts'

test('Skala und Faktor: nur am Heizkostenverteiler, Faktor deutsch oder technisch, über 0', () => {
  expect(HCA_SCALE_OPTIONS.map((o) => o.value)).toEqual(['', 'unit', 'product'])
  expect(hcaFieldsOf({ hcaScale: 'unit', ratingFactor: 1.25 })).toEqual({ scale: 'unit', factor: '1,25' })
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: '0,8' })).toEqual({ body: { hcaScale: 'unit', ratingFactor: 0.8 } })
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: '0.825' })).toEqual({ body: { hcaScale: 'unit', ratingFactor: 0.825 } })
  expect(hcaFieldsBody('hkv', { scale: 'product', factor: '1,4' })).toEqual({ body: { hcaScale: 'product', ratingFactor: null } })
  expect(hcaFieldsBody('hkv', { scale: '', factor: '' })).toEqual({ body: { hcaScale: null, ratingFactor: null } })
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: '' })).toEqual({ body: { hcaScale: 'unit', ratingFactor: null } })
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: '0' })).toEqual({ error: 'Der Bewertungsfaktor ist eine Zahl über 0, etwa 0,8 oder 1,25.' })
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: 'viel' })).toEqual({ error: 'Bewertungsfaktor ist keine Zahl.' })
  expect(hcaFieldsBody('waerme', { scale: 'unit', factor: '1,25' })).toEqual({ body: { hcaScale: null, ratingFactor: null } })
})

test('Bewertungsfaktor „1.250“: drei Nachkommastellen oder Tausender? Das Formular fragt nach und rät nicht', () => {
  const r = hcaFieldsBody('hkv', { scale: 'unit', factor: '1.250' })
  expect('error' in r && r.error).toMatch(/Meinen Sie 1,250 oder 1250\?/)
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: '1,250' })).toEqual({ body: { hcaScale: 'unit', ratingFactor: 1.25 } })
})

test('Angezeigt wird, was gespeichert ist: alle Nachkommastellen, keine Tausenderpunkte', () => {
  expect(hcaFieldsOf({ hcaScale: 'unit', ratingFactor: 1.2345 })).toEqual({ scale: 'unit', factor: '1,2345' })
  expect(exactText(1250.5)).toBe('1250,5')
  // Hin und zurück derselbe Wert.
  const f = hcaFieldsOf({ hcaScale: 'unit', ratingFactor: 0.8125 })
  expect(hcaFieldsBody('hkv', f)).toEqual({ body: { hcaScale: 'unit', ratingFactor: 0.8125 } })
  expect(hcaSummary({ type: 'hkv', hcaScale: 'unit', ratingFactor: 0.8125 })).toBe('Einheitsskala, Bewertungsfaktor 0,8125')
  expect(hcaSummary({ type: 'hkv', hcaScale: 'unit', ratingFactor: null })).toBe('Einheitsskala, Bewertungsfaktor fehlt')
  expect(hcaSummary({ type: 'hkv', hcaScale: null })).toBe('Skala fehlt')
  expect(hcaSummary({ type: 'waerme' })).toBeNull()
})

test('Stichtagswert: eine Ablesung mit Wechsel, Wert danach 0', () => {
  expect(cutoffReadingBody('h1', { date: '2025-12-31', value: '842' })).toEqual({ body: { meterId: 'h1', date: '2025-12-31', value: 0, replacement: true, oldEndValue: 842 } })
  expect(cutoffReadingBody('h1', { date: '2025-12-31', value: '842,5' })).toEqual({ body: { meterId: 'h1', date: '2025-12-31', value: 0, replacement: true, oldEndValue: 842.5 } })
  expect(cutoffReadingBody('h1', { date: '', value: '842' })).toEqual({ error: 'Bitte wählen Sie den Stichtag des Geräts.' })
  expect(cutoffReadingBody('h1', { date: '2025-12-31', value: '' })).toEqual({ error: 'Bitte tragen Sie den Stichtagswert laut Anzeige ein.' })
  expect(cutoffReadingBody('h1', { date: '2025-12-31', value: '-3' })).toEqual({ error: 'Der Stichtagswert ist eine Zahl ab 0.' })
  const r = cutoffReadingBody('h1', { date: '2025-12-31', value: '1.250' })
  expect('error' in r && r.error).toMatch(/Meinen Sie/)
  expect(isCutoffReading('hkv', { replacement: true, value: 0 })).toBe(true)
  expect(isCutoffReading('waerme', { replacement: true, value: 0 })).toBe(false)
  expect(isCutoffReading('hkv', { replacement: true, value: 5 })).toBe(false)
})

test('Ablesedienst: Zeilen ins Formular und zurück; leere Zeilen fallen weg; Warmwasser leer heißt keiner', () => {
  const p = periodKey('2025-01')
  const rows = serviceRowsOf([{ plantId: 'hp', period: p, unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340.5, waterValue: null, heatUnit: 'units' }])
  expect(rows).toEqual([{ unitId: 'a', from: '2025-01-01', to: '2025-09-30', heat: '340,5', water: '', heatUnit: 'units' }])
  expect(serviceValuesBody([...rows, { unitId: '', from: '', to: '', heat: '', water: '', heatUnit: 'units' }])).toEqual({
    body: { values: [{ unitId: 'a', from: '2025-01-01', to: '2025-09-30', heatValue: 340.5, waterValue: null, heatUnit: 'units' }] },
  })
  expect(serviceValuesBody([{ unitId: 'a', from: '2025-01-01', to: '2025-12-31', heat: 'viel', water: '', heatUnit: 'units' }])).toEqual({ error: 'Heizung in Zeile 1 ist keine Zahl.' })
  expect(serviceValuesBody([{ unitId: 'a', from: '2025-01-01', to: '2025-12-31', heat: '', water: '3', heatUnit: 'units' }])).toEqual({ error: 'Bitte tragen Sie in Zeile 1 den Wert für die Heizung ein.' })
  expect(serviceValuesBody([{ unitId: '', from: '2025-01-01', to: '2025-12-31', heat: '3', water: '', heatUnit: 'units' }])).toEqual({ error: 'Bitte wählen Sie in Zeile 1 die Wohnung.' })
  const zweifelhaft = serviceValuesBody([{ unitId: 'a', from: '2025-01-01', to: '2025-12-31', heat: '1.250', water: '', heatUnit: 'units' }])
  expect('error' in zweifelhaft && zweifelhaft.error).toMatch(/Meinen Sie 1,250 oder 1250\?/)
  expect(serviceValuesBody([{ unitId: 'a', from: '2025-01-01', to: '2025-12-31', heat: '1.250,5', water: '12,25', heatUnit: 'units' }])).toEqual({
    body: { values: [{ unitId: 'a', from: '2025-01-01', to: '2025-12-31', heatValue: 1250.5, waterValue: 12.25, heatUnit: 'units' }] },
  })
})

test('Nach der Einrichtung: was je Erfassung zu tun ist', () => {
  expect(setupDoneText('hca')).toMatch(/Heizkostenverteiler mit Skala und Bewertungsfaktor/)
  expect(setupDoneText('serviceValues')).toMatch(/Werte des Ablesedienstes auf der Seite Heizkosten/)
  expect(setupDoneText('heatMeter')).toBe('Eigene Heizkostenabrechnung eingerichtet. Tragen Sie die Zählerstände auf der Seite Zähler ein.')
})

test('Durchsicht #241 M3: ein Faktor über 10 braucht eine Bestätigung', () => {
  const r = hcaFieldsBody('hkv', { scale: 'unit', factor: '1.250,5' })
  expect('error' in r && r.error).toMatch(/ungewöhnlich hoch/)
  expect(hcaFieldsBody('hkv', { scale: 'unit', factor: '1.250,5', confirmed: true })).toEqual({ body: { hcaScale: 'unit', ratingFactor: 1250.5 } })
  expect(hcaFieldsOf({ hcaScale: 'unit', ratingFactor: 12 })).toEqual({ scale: 'unit', factor: '12', confirmed: true })
  expect(ratedText({ type: 'hkv', hcaScale: 'unit', ratingFactor: 1.25 }, 500)).toBe('bewertet: 625 Einheiten')
  expect(ratedText({ type: 'hkv', hcaScale: 'product', ratingFactor: null }, 500)).toBeNull()
})
