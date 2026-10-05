// Das Rechtsregister (Heizung PR 1, Entwurf 4.2 und 4.7): Abfrage nach Zeitregel, Protokoll der
// benutzten Werte, Vollständigkeit der Fassungen und je Parameter die Stichtage.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLawLog, dayAfter, dayBefore, germanDate, law, onlyVersion, valueAt, versionAt, type LawParam } from '../../shared/law/register.ts'

const year = (y: number) => ({ period: { from: `${y}-01-01`, to: `${y}-12-31` } })

// Zwei erfundene Parameter für die Abfrage selbst, damit ihre Regeln nicht an einem echten Wert
// hängen, der sich bei einer Durchsicht ändern darf.
const source = { rank: 'law', cite: '§ 1 Beispielgesetz', url: 'https://example.org/1', retrieved: '2026-10-05', checked: 'checked' } as const
const rate: LawParam<number, 'periodStart'> = {
  id: 'test.rate', title: 'Satz', norm: '§ 1', timing: 'periodStart',
  versions: [
    { validTo: '2022-12-31', value: 10, source, enacted: 'a' },
    { validFrom: '2023-01-01', value: 12, source, enacted: 'b' },
  ],
  describe: (v) => `${v} %`,
}
const event: LawParam<number, 'eventDate'> = {
  id: 'test.event', title: 'Satz am Tag', norm: '§ 3', timing: 'eventDate',
  versions: [
    { validTo: '2020-06-30', value: 19, source, enacted: 'a' },
    { validFrom: '2020-07-01', validTo: '2020-12-31', value: 16, source, enacted: 'b' },
    { validFrom: '2021-01-01', value: 19, source, enacted: 'c' },
  ],
  describe: (v) => `${v} %`,
}
const window: LawParam<{ readonly note: string }, 'overlap'> = {
  id: 'test.window', title: 'Fenster', norm: '§ 2', timing: 'overlap',
  versions: [{ validFrom: '2024-03-01', validTo: '2024-06-30', value: { note: 'x' }, source, enacted: 'a' }],
  describe: (v) => v.note,
}

test('Register: periodStart nimmt die Fassung am Beginn des Zeitraums', () => {
  const log = createLawLog()
  assert.equal(law(rate, year(2022), log), 10)
  assert.equal(law(rate, year(2023), log), 12)
  // Ein Zeitraum über die Grenze: es gilt der Beginn.
  assert.equal(law(rate, { period: { from: '2022-07-01', to: '2023-06-30' } }, log), 10)
})

test('Register: eventDate nimmt die Fassung am Tag des Ereignisses', () => {
  assert.equal(law(event, { date: '2020-06-30' }, createLawLog()), 19)
  assert.equal(law(event, { date: '2020-07-01' }, createLawLog()), 16)
  assert.equal(law(event, { date: '2020-12-31' }, createLawLog()), 16)
  assert.equal(law(event, { date: '2021-01-01' }, createLawLog()), 19)
})

test('Register: overlap sagt voll, teilweise oder gar nicht, und nennt auch bei „gar nicht“ die Grenzen', () => {
  const log = createLawLog()
  assert.deepEqual(law(window, { period: { from: '2024-04-01', to: '2024-05-31' } }, log),
    { coverage: 'full', value: { note: 'x' }, validFrom: '2024-03-01', validTo: '2024-06-30' })
  assert.equal(law(window, year(2024), log).coverage, 'partial')
  const after = law(window, year(2025), log)
  assert.equal(after.coverage, 'none')
  assert.equal(after.validTo, '2024-06-30')
  assert.equal(law(window, year(2023), log).coverage, 'none')
})

test('Register: das Protokoll führt jede benutzte Fassung einmal, mit Wert in Worten und Fundstelle', () => {
  const log = createLawLog()
  law(rate, year(2023), log)
  law(rate, year(2024), log)
  assert.deepEqual(log.values, [{ id: 'test.rate', title: 'Satz', norm: '§ 1', cite: '§ 1 Beispielgesetz', value: 12, text: '12 %', validFrom: '2023-01-01' }])
  // Auch ein „gar nicht“ hat nach einer Fassung entschieden und steht deshalb im Protokoll.
  law(window, year(2025), log)
  law(window, year(2024), log)
  assert.deepEqual(log.values.map((v) => `${v.id} ${v.validFrom ?? ''}`), ['test.rate 2023-01-01', 'test.window 2024-03-01'])
})

test('Register: zwei Protokolle sind getrennt, es gibt keinen gemeinsamen Zustand', () => {
  const a = createLawLog()
  const b = createLawLog()
  law(rate, year(2023), a)
  assert.equal(a.values.length, 1)
  assert.equal(b.values.length, 0)
})

test('Register: ohne Fassung am Tag ist es ein Programmfehler, keine stille Antwort', () => {
  assert.throws(() => versionAt(window, '2025-01-01'), /Kein Rechtswert „test\.window“ am 2025-01-01/)
  assert.throws(() => valueAt(window, '2024-02-29'), /Kein Rechtswert/)
})

test('Register: Datumshelfer', () => {
  assert.equal(germanDate('2024-07-01'), '01.07.2024')
  assert.equal(dayAfter('2024-06-30'), '2024-07-01')
  assert.equal(dayAfter('2024-02-28'), '2024-02-29')
  assert.equal(dayBefore('2027-01-01'), '2026-12-31')
})

test('Register: onlyVersion verlangt genau eine Fassung', () => {
  assert.equal(onlyVersion(window).validTo, '2024-06-30')
  assert.throws(() => onlyVersion(rate), /nicht genau eine Fassung/)
})
