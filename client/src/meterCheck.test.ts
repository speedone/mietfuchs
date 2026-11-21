// Die Ampel „Zählerstände“ im Cockpit (#136): Sie muss den Hauptzähler mitzählen, denn seit #116
// kann er die Verteilbasis des Verbrauchsschlüssels sein.
import { expect, test } from 'vitest'
import type { Meter, Notice } from './types'
import { calibrationDetail, gapNotice, heatingWithoutConsumption, incompleteDetail, meterReadiness, overdueMeters, slackDetail, selfHeatingReadings } from './meterCheck'

const meter = (id: string, unitId: string | null, type: Meter['type'] = 'kaltwasser'): Meter =>
  ({ id, propertyId: 'p', name: id, type, unitId, unit: 'm³' })
const ok = (meterId: string) => ({ meterId, readingCount: 2, warnings: [] })

test('Hauptzähler ohne Endstand: die Ampel nennt ihn', () => {
  const r = meterReadiness([meter('haupt', null), meter('zwischen', 'u1')], [ok('zwischen'), { meterId: 'haupt', readingCount: 1, warnings: [] }], new Set(['kaltwasser']))
  expect(r.incomplete.map((m) => m.id)).toEqual(['haupt'])
})

test('Hauptzähler und Zwischenzähler vollständig: beide gezählt', () => {
  const r = meterReadiness([meter('haupt', null), meter('zwischen', 'u1')], [ok('haupt'), ok('zwischen')], new Set(['kaltwasser']))
  expect(r.relevant.map((m) => m.id)).toEqual(['haupt', 'zwischen'])
  expect(r.incomplete).toEqual([])
})

// Systemprüfung: Ab dem zweiten Jahr hat jeder Zähler mindestens zwei Ablesungen, die Ampel war dann immer grün.
test('Zwei Ablesungen aus dem Vorjahr, der gewählte Zeitraum ist nicht gedeckt: unvollständig', () => {
  const r = meterReadiness([meter('haupt', null), meter('zwischen', 'u1')],
    [{ meterId: 'haupt', readingCount: 2, periodCovered: false, warnings: [] }, { meterId: 'zwischen', readingCount: 2, periodCovered: true, warnings: [] }], new Set(['kaltwasser']))
  expect(r.incomplete.map((m) => m.id)).toEqual(['haupt'])
})

test('Im Zeitraum eingebaut, eine Ablesung davor gibt es nicht: gedeckt heißt vollständig, gleich wie viele Ablesungen', () => {
  const r = meterReadiness([meter('neu', 'u1')], [{ meterId: 'neu', readingCount: 1, periodCovered: true, warnings: [] }], new Set(['kaltwasser']))
  expect(r.incomplete).toEqual([])
})

test('Text der Zeile: ohne Angabe des Servers wie bisher, mit Lücke die fehlenden Tage', () => {
  const ms = [meter('haupt', null), meter('zwischen', 'u1')]
  expect(incompleteDetail(ms, [{ meterId: 'haupt', readingCount: 1, warnings: [] }])).toBe('Anfang/Ende fehlt oder unplausibel bei: haupt und zwischen')
  expect(incompleteDetail(ms, [
    { meterId: 'haupt', readingCount: 2, periodCovered: false, periodGap: { from: '2025-12-17', to: '2025-12-31' }, lastReadingOn: '2025-12-16', warnings: [] },
    { meterId: 'zwischen', readingCount: 2, periodCovered: true, periodGap: null, lastReadingOn: '2025-12-31', warnings: ['unplausibel'] },
  ])).toBe('Anfang/Ende fehlt oder unplausibel bei: haupt (ohne Ablesung vom 17.12.2025 bis 31.12.2025) und zwischen')
})

test('Text der Zeile: ein vor dem Zeitraum länger nicht abgelesener Zähler bekommt den Tag und den Weg beim Tausch genannt', () => {
  const text = incompleteDetail([meter('alt', 'u1')], [{ meterId: 'alt', readingCount: 3, periodCovered: false, periodGap: { from: '2025-01-01', to: '2025-12-31' }, lastReadingOn: '2023-06-30', longUnread: true, warnings: [] }])
  expect(text).toBe('Anfang/Ende fehlt oder unplausibel bei: alt (ohne Ablesung vom 01.01.2025 bis 31.12.2025). Schon länger nicht abgelesen: alt (zuletzt abgelesen am 30.06.2023). Wurde ein solcher Zähler getauscht, erfassen Sie die erste Ablesung des neuen Geräts als Zählerwechsel.')
})

// Zweite Durchsicht (Muss 1): Zuletzt am 28.12.2025 abgelesen, Blick auf 2026. Es fehlt schlicht der Endstand; ein Rat
// zum Löschen nähme der offenen Abrechnung 2025 den Zähler.
test('Text der Zeile: fehlt nur der Endstand, steht nichts von „länger nicht abgelesen“, und zum Löschen rät sie nie', () => {
  const normal = incompleteDetail([meter('wasser', 'u1')], [{ meterId: 'wasser', readingCount: 2, periodCovered: false, periodGap: { from: '2026-01-01', to: '2026-12-31' }, lastReadingOn: '2025-12-28', longUnread: false, warnings: [] }])
  expect(normal).toBe('Anfang/Ende fehlt oder unplausibel bei: wasser (ohne Ablesung vom 01.01.2026 bis 31.12.2026)')
  const lange = incompleteDetail([meter('alt', 'u1')], [{ meterId: 'alt', readingCount: 3, periodCovered: false, periodGap: { from: '2025-01-01', to: '2025-12-31' }, lastReadingOn: '2023-06-30', longUnread: true, warnings: [] }])
  for (const text of [normal, lange]) expect(text).not.toMatch(/lösch/i)
})

// Ein im Lauf des Jahres eingebauter Zähler (erste Ablesung am 30.06.) ist ohne Einbaudatum rot; die Zeile nennt den
// Ausweg. Fehlt dagegen der Endstand, steht der Satz nicht da.
test('Text der Zeile: fehlt der Anfang, nennt sie das Einbaudatum am Zähler als Ausweg', () => {
  const spaet = incompleteDetail([meter('neu', 'u1')], [{ meterId: 'neu', readingCount: 2, periodCovered: false, periodGap: { from: '2025-01-01', to: '2025-06-30' }, lastReadingOn: '2025-12-31', longUnread: false, warnings: [] }])
  expect(spaet).toBe('Anfang/Ende fehlt oder unplausibel bei: neu (ohne Ablesung vom 01.01.2025 bis 30.06.2025). Wurde der Zähler erst im Zeitraum eingebaut, tragen Sie am Zähler das Einbaudatum ein.')
  const ende = incompleteDetail([meter('neu', 'u1')], [{ meterId: 'neu', readingCount: 2, periodCovered: false, periodGap: { from: '2025-12-17', to: '2025-12-31' }, lastReadingOn: '2025-12-16', longUnread: false, warnings: [] }])
  expect(ende).not.toContain('Einbaudatum')
})

// #693: Die Seite Zähler sagt am Zähler dasselbe wie die Cockpit-Zeile, aus denselben Angaben des Servers.
test('Satz am Zähler: dieselben Tage und Auswege wie die Cockpit-Zeile; gedeckt oder ohne Angabe des Servers kein Satz', () => {
  const gap = { meterId: 'm', readingCount: 2, periodCovered: false, periodGap: { from: '2025-12-17', to: '2025-12-31' }, lastReadingOn: '2025-12-16', longUnread: false, warnings: [] }
  expect(gapNotice(gap)).toBe('Ohne Ablesung vom 17.12.2025 bis 31.12.2025.')
  expect(incompleteDetail([meter('m', 'u1')], [gap])).toContain('ohne Ablesung vom 17.12.2025 bis 31.12.2025')
  expect(gapNotice({ ...gap, periodGap: { from: '2025-01-01', to: '2025-12-31' }, lastReadingOn: '2023-06-30', longUnread: true }))
    .toBe('Ohne Ablesung vom 01.01.2025 bis 31.12.2025. Zuletzt abgelesen am 30.06.2023. Wurde der Zähler getauscht, erfassen Sie die erste Ablesung des neuen Geräts als Zählerwechsel.')
  expect(gapNotice({ ...gap, periodGap: { from: '2025-01-01', to: '2025-06-30' }, lastReadingOn: '2025-12-31' }))
    .toBe('Ohne Ablesung vom 01.01.2025 bis 30.06.2025. Wurde der Zähler erst im Zeitraum eingebaut, tragen Sie am Zähler das Einbaudatum ein.')
  expect(gapNotice({ ...gap, periodCovered: true, periodGap: null })).toBeNull()
  expect(gapNotice({ meterId: 'm', readingCount: 1, warnings: [] })).toBeNull()
  expect(gapNotice(undefined)).toBeNull()
})

test('Grüne Zeile: Tage am Rand, die fehlen und hingenommen sind, stehen als Zusatz da', () => {
  const ms = [meter('a', 'u1'), meter('b', 'u2')]
  expect(slackDetail(ms, [ok('a'), ok('b')])).toBe('')
  expect(slackDetail(ms, [{ ...ok('a'), periodCovered: true, periodSlack: [{ from: '2025-12-18', to: '2025-12-31' }] }, { ...ok('b'), periodCovered: true, periodSlack: [{ from: '2025-01-01', to: '2025-01-01' }] }]))
    .toBe(' Nicht erfasst und in der Abrechnung nicht mitgerechnet: a vom 18.12.2025 bis 31.12.2025 (14 Tage) und b vom 01.01.2025 bis 01.01.2025 (1 Tag).')
})

test('Zähler eines anderen Typs zählen nicht', () => {
  const r = meterReadiness([meter('strom', null, 'strom')], [], new Set(['kaltwasser']))
  expect(r.relevant).toEqual([])
})

// #140: Heizung und Warmwasser ohne Verbrauchsanteil. Die Ampel darf dann nicht sagen, dass keine
// Ablesungen nötig sind. Sie liest den Hinweis der Berechnung, damit beide dieselbe Regel anwenden
// (Mischfall, Teilnehmer, Direktzuordnung, § 2 HeizkostenV mit Garage, siehe shared/heating.ts).
const hinweis = (code: string, id = 'h'): Notice => ({ code, level: 'warning', title: '', text: '', subject: { kind: 'costItem', id } })

test('Kürzungshinweis der Berechnung: gemeldet, also nicht „Ablesungen nicht erforderlich“', () => {
  expect(heatingWithoutConsumption({ notices: [hinweis('heating.not-by-consumption'), hinweis('item.no-basis', 'x')] })).toEqual(['h'])
})

test('Ohne Kürzungshinweis nichts, auch nicht beim Hinweis zum Zweifamilienhaus oder zum Mischfall', () => {
  expect(heatingWithoutConsumption({ notices: [hinweis('heating.may-agree-otherwise'), hinweis('heating.consumption-share')] })).toEqual([])
  // Eine vor #112 abgeschlossene Abrechnung hat keine Hinweise.
  expect(heatingWithoutConsumption({})).toEqual([])
})

// Heizung PR 21 (#98, Prüfung des Plans M1): Die Eichfrist ist eine Warnung und keine Sperre. Die Ampel
// „Zählerstände“ bleibt davon unberührt; das Cockpit nennt sie in einer eigenen gelben Zeile.
const eichfrist = (meterId: string): Notice => ({ code: 'meter.calibration-overdue', level: 'warning', title: 'Eichfrist abgelaufen', text: `Zähler ${meterId}: abgelaufen`, subject: { kind: 'meter', id: meterId } })
const mitHinweisen = (meterId: string, notices: Notice[]) => ({ meterId, readingCount: 2, notices, warnings: notices.map((n) => n.text) })

test('Eichfrist abgelaufen: Zählerstände vollständig, der Zähler steht in der eigenen Liste', () => {
  const zaehler = [meter('k1', 'u1'), meter('k2', 'u2')]
  const verbrauch = [mitHinweisen('k1', [eichfrist('k1')]), ok('k2')]
  expect(meterReadiness(zaehler, verbrauch, new Set(['kaltwasser'])).incomplete).toEqual([])
  expect(overdueMeters(zaehler, verbrauch).map((m) => m.id)).toEqual(['k1'])
})

test('Eichfrist neben einem anderen Befund: unvollständig wegen des anderen', () => {
  const negativ: Notice = { code: 'meter.negative', level: 'warning', title: 'Negativer Verbrauch', text: 'negativ', subject: { kind: 'meter', id: 'k1' } }
  const verbrauch = [mitHinweisen('k1', [negativ, eichfrist('k1')])]
  expect(meterReadiness([meter('k1', 'u1')], verbrauch, new Set(['kaltwasser'])).incomplete.map((m) => m.id)).toEqual(['k1'])
})

// Geschätzte Ablesung (#98, Browserprüfung 0.16.0 M1): Der Server meldet sie als Hinweis. Anfang und Ende sind da,
// die Ampel bleibt grün; maßgeblich ist die Stufe der Meldung, nicht eine Liste von Codes.
test('Hinweis zu einem Zähler (geschätzte Ablesung): Zählerstände vollständig', () => {
  const geschaetzt: Notice = { code: 'meter.reading-estimated', level: 'hint', title: 'Ablesung geschätzt', text: 'geschätzt', subject: { kind: 'meter', id: 'k1' } }
  const info: Notice = { code: 'meter.irgendwas', level: 'info', title: 'Info', text: 'info', subject: { kind: 'meter', id: 'k1' } }
  expect(meterReadiness([meter('k1', 'u1')], [mitHinweisen('k1', [geschaetzt, info])], new Set(['kaltwasser'])).incomplete).toEqual([])
})

test('Ohne Hinweise (älterer Server) zählen die Texte wie bisher', () => {
  expect(meterReadiness([meter('k1', 'u1')], [{ meterId: 'k1', readingCount: 2, warnings: ['x'] }], new Set(['kaltwasser'])).incomplete.map((m) => m.id)).toEqual(['k1'])
  expect(overdueMeters([meter('k1', 'u1')], [{ meterId: 'k1', readingCount: 2, warnings: ['x'] }])).toEqual([])
})

test('Cockpit-Zeile „Eichfrist“: nennt die Zähler, dass Mietfuchs rechnet, und die Beweislast', () => {
  const text = calibrationDetail([meter('Kaltwasser EG', 'u1'), meter('Wärme OG', 'u2', 'waerme')])
  expect(text).toMatch(/^Eichfrist abgelaufen bei: Kaltwasser EG und Wärme OG\./)
  expect(text).toMatch(/Mietfuchs rechnet mit den Werten/)
  expect(text).toMatch(/müssen Sie beweisen, dass sie stimmen/)
  expect(text).toMatch(/Stichprobenverfahren/)
})

// #721: Mit eigener Heizkostenabrechnung (`method: 'self'`) verteilt Mietfuchs die Heizkosten nach Ablesungen, ohne dass
// eine Position den Schlüssel „nach Zähler“ trägt. Das Cockpit sagte „Ablesungen nicht erforderlich“. Gelesen wird, was
// die Berechnung meldet (`heating.self-incomplete`), nicht noch einmal ihre Regel.
const SELF = { ok: true }
const selfStatement = (over: Record<string, unknown> = {}) => ({ plantId: 'hp1', plantName: '', from: '2025-01-01', to: '2025-12-31', self: SELF, ...over })
const unvollstaendig = (text: string, plantId = 'hp1'): Notice => ({ code: 'heating.self-incomplete', level: 'error', title: 'Heizkostenabrechnung unvollständig', text, subject: { kind: 'heatingCosts', id: plantId } })

test('#721: ohne eigene Heizkostenabrechnung keine Aussage; nach Vereinbarung „nach Wohnfläche“ sind keine Ablesungen nötig', () => {
  expect(selfHeatingReadings({})).toBeNull()
  expect(selfHeatingReadings({ heating: [{ plantId: 'hp1', from: '2025-01-01', to: '2025-12-31' }] })).toBeNull()
  expect(selfHeatingReadings({ heating: [selfStatement({ self: { ok: true, agreedArea: true } })] })).toBeNull()
})

test('#721: eigene Heizkostenabrechnung vollständig: die Zeile nennt die Heizperiode', () => {
  expect(selfHeatingReadings({ heating: [selfStatement()], notices: [] }))
    .toEqual({ state: 'complete', detail: 'Eigene Heizkostenabrechnung: Die Stände für die Heizperiode 01.01.2025 bis 31.12.2025 sind vollständig.' })
})

test('#721: fehlt ein Stand für die Heizperiode, sagt es die Zeile mit dem Satz der Berechnung und springt zur Seite Zähler', () => {
  const text = 'Heizanlage, Heizperiode 2025: Für „WZ a“ (A) fehlt ein Stand zum 31.12.2025. Tragen Sie die Ablesung ein; liegt sie einige Tage daneben, gilt sie, wie sie ist. Lässt sich der Verbrauch nicht ordnungsgemäß erfassen, weil das Gerät ausgefallen ist oder ein anderer zwingender Grund vorliegt, schätzen Sie den Verbrauch auf der Seite Heizkosten unter „Schätzung (§ 9a)“. Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht; sie stehen beim Vermieter.'
  const r = selfHeatingReadings({ heating: [selfStatement({ self: { ok: false } })], notices: [unvollstaendig(text), unvollstaendig(text.replace('WZ a“ (A)', 'WZ b“ (B)'))] })
  expect(r).toEqual({
    state: 'incomplete', plantId: 'hp1', target: 'zaehler',
    detail: 'Die Heizkosten werden nach der Heizkostenverordnung mit Ablesungen verteilt. Für die eigene Heizkostenabrechnung fehlt noch:',
    lines: ['Heizanlage, Heizperiode 2025: Für „WZ a“ (A) fehlt ein Stand zum 31.12.2025.', 'Heizanlage, Heizperiode 2025: Für „WZ b“ (B) fehlt ein Stand zum 31.12.2025.'],
  })
})

test('#721: fehlen Werte des Ablesedienstes oder der Anteil nach Verbrauch, führt der Sprung zur Seite Heizkosten', () => {
  const dienst = 'Heizanlage, Heizperiode 2025: Für OG fehlen die Werte des Ablesedienstes, die übrigen Wohnungen haben welche. Tragen Sie sie auf der Seite Heizkosten in der Karte „Werte des Ablesedienstes“ ein. Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht; sie stehen beim Vermieter.'
  expect(selfHeatingReadings({ heating: [selfStatement({ self: { ok: false, capture: 'serviceValues' } })], notices: [unvollstaendig(dienst)] }))
    .toMatchObject({ state: 'incomplete', target: 'heizkosten', lines: ['Heizanlage, Heizperiode 2025: Für OG fehlen die Werte des Ablesedienstes, die übrigen Wohnungen haben welche.'] })
  const anteil = 'Heizanlage, Heizperiode 2025: Für diese Heizperiode ist kein Anteil nach Verbrauch festgelegt. Tragen Sie auf der Seite Heizkosten ein, mit welchem Anteil Sie bisher abgerechnet haben. Bis dahin verteilt Mietfuchs die Heizkosten dieser Anlage nicht; sie stehen beim Vermieter.'
  expect(selfHeatingReadings({ heating: [selfStatement({ self: { ok: false } })], notices: [unvollstaendig(anteil)] })).toMatchObject({ state: 'incomplete', target: 'heizkosten' })
  // Ein Hinweis zu einer Anlage ohne eigene Abrechnung in dieser Abrechnung zählt nicht.
  expect(selfHeatingReadings({ heating: [selfStatement()], notices: [unvollstaendig(anteil, 'andere')] })).toMatchObject({ state: 'complete' })
})

test('#721: unvollständig ohne Hinweis (ältere Abrechnung): die Zeile verweist auf die Seite Heizkosten', () => {
  expect(selfHeatingReadings({ heating: [selfStatement({ self: { ok: false } })] }))
    .toEqual({ state: 'incomplete', plantId: 'hp1', target: 'heizkosten', detail: 'Die Heizkosten werden nach der Heizkostenverordnung mit Ablesungen verteilt. Die eigene Heizkostenabrechnung ist noch unvollständig; was fehlt, steht auf der Seite Heizkosten.', lines: [] })
})
