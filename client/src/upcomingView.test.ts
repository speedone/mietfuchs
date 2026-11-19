// „Demnächst fällig“ im Cockpit (#190): Texte, Stufe und Sprungziel je Eintrag, ohne DOM.
import { expect, test } from 'vitest'
import type { UpcomingDeadline, UpcomingDeadlines } from './types'
import { dueText, upcomingRows } from './upcomingView'
import { calendarPeriod } from '../../shared/period.ts'

const TODAY = '2026-11-20'
const list = (...items: UpcomingDeadline[]): UpcomingDeadlines => ({ today: TODAY, until: '2027-02-18', items })
const plain = (s: string) => s.replace(/ /g, ' ')

test('Tage bis zum Tag: heute, morgen, in N Tagen, seit N Tagen', () => {
  expect(dueText('2026-11-20', TODAY)).toBe('heute')
  expect(dueText('2026-11-21', TODAY)).toBe('morgen')
  expect(dueText('2026-12-31', TODAY)).toBe('in 41 Tagen')
  expect(dueText('2026-11-19', TODAY)).toBe('seit 1 Tag')
  expect(dueText('2026-11-10', TODAY)).toBe('seit 10 Tagen')
  // Über den Wechsel zur Sommerzeit und das Jahresende gerechnet in UTC.
  expect(dueText('2027-03-29', '2027-03-27')).toBe('in 2 Tagen')
})

test('Abrechnungsfrist offen: Frist mit Tagen, Sprung in den Zeitraum zur Abrechnung', () => {
  const [row] = upcomingRows(list({ kind: 'settlement', id: 'settlement:2025-01', date: '2026-12-31', period: calendarPeriod(2025), label: '2025', closed: false }))
  expect(row).toEqual({
    id: 'settlement:2025-01',
    level: 'open',
    levelText: 'offen',
    title: 'Abrechnung 2025 versenden',
    when: 'Frist bis 31.12.2026 (in 41 Tagen)',
    detail: 'Noch nicht abgeschlossen. Die Abrechnung muss den Mietern bis zum 31.12.2026 zugehen (§ 556 Abs. 3 Satz 2 BGB); es zählt der Zugang, nicht das Absenden.',
    action: { label: 'Zur Abrechnung', tab: 'abrechnung', period: calendarPeriod(2025) },
  })
})

test('Abrechnungsfrist: abgeschlossen ohne Versanddatum springt zum Versanddatum, abgelaufen nennt die Folge', () => {
  const [row] = upcomingRows(list({ kind: 'settlement', id: 'settlement:2024-01', date: '2025-12-31', period: calendarPeriod(2024), label: '2024', closed: true }))
  expect(row?.level).toBe('overdue')
  expect(row?.levelText).toBe('abgelaufen')
  expect(row?.when).toBe('Frist am 31.12.2025 abgelaufen')
  expect(row?.detail).toBe('Abgeschlossen, aber nicht als versendet markiert. Ist sie verschickt, tragen Sie das Versanddatum ein. Nach Ablauf der Frist können Sie eine Nachzahlung nur verlangen, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB); ein Guthaben der Mieter bleibt fällig.')
  expect(row?.action).toEqual({ label: 'Versanddatum eintragen', tab: 'abrechnung', focus: { kind: 'section', section: 'sentAt' }, period: calendarPeriod(2024) })
})

test('Einwendungsfrist: nur zur Information, als genähert gekennzeichnet', () => {
  const [row] = upcomingRows(list({ kind: 'objection', id: 'objection:2025-01', date: '2027-01-31', period: calendarPeriod(2025), label: '2025', sentAt: '2026-01-20' }))
  expect(row?.level).toBe('info')
  expect(row?.levelText).toBe('zur Information')
  expect(row?.title).toBe('Einwendungsfrist der Mieter, Abrechnung 2025')
  expect(row?.when).toBe('bis etwa 31.01.2027 (in 72 Tagen)')
  expect(row?.detail).toBe('Versendet am 20.01.2026. Einwendungen gegen die Abrechnung müssen die Mieter bis zum Ablauf des zwölften Monats nach Zugang mitteilen; danach sind sie ausgeschlossen, wenn die Mieter die Verspätung zu vertreten haben (§ 556 Abs. 3 Satz 5 und 6 BGB). Den Zugang kennt Mietfuchs nicht: Gerechnet ist ab dem Versanddatum bis zum Monatsende. Geht die Abrechnung später zu oder fällt das Ende auf einen Sonnabend, Sonntag oder Feiertag, endet die Frist später.')
  expect(row?.action).toEqual({ label: 'Zur Abrechnung', tab: 'abrechnung', period: calendarPeriod(2025) })
})

test('Kaution nach Auszug: ohne behauptete Frist, Sprung ins Seitenfenster der Kaution', () => {
  const [row] = upcomingRows(list({ kind: 'deposit', id: 'deposit:t1', date: '2026-08-31', tenancyId: 't1', tenantName: 'Erika Mustermann', balanceCents: 160000 }))
  expect(row?.level).toBe('open')
  expect(row?.title).toBe('Kaution abrechnen')
  expect(row?.when).toBe('ausgezogen am 31.08.2026')
  expect(plain(row?.detail ?? '')).toBe('Bei Ihnen liegen noch 1.600,00 € von Erika Mustermann. Eine feste Frist nennt das Gesetz nicht; nach dem Bundesgerichtshof haben Sie nach dem Ende des Mietverhältnisses eine angemessene Frist, um abzurechnen, und wie lang sie ist, hängt vom Einzelfall ab (Urteil vom 18.01.2006, VIII ZR 71/05).')
  expect(row?.action).toEqual({ label: 'Kaution öffnen', tab: 'stammdaten', focus: { kind: 'deposit', tenancyId: 't1' } })
  expect(row?.detail).not.toMatch(/sechs Monate|6 Monate/)
})

test('Eichfrist: kommend und abgelaufen, Sprung zum Zähler', () => {
  const [soon, past] = upcomingRows(list(
    { kind: 'calibration', id: 'calibration:m1', date: '2026-12-31', meterId: 'm1', meterName: 'Kaltwasser EG' },
    { kind: 'calibration', id: 'calibration:m2', date: '2025-12-31', meterId: 'm2', meterName: 'Warmwasser OG' },
  ))
  expect(soon?.title).toBe('Eichfrist Kaltwasser EG')
  expect(soon?.when).toBe('endet am 31.12.2026 (in 41 Tagen)')
  expect(soon?.level).toBe('open')
  expect(soon?.action).toEqual({ label: 'Zähler öffnen', tab: 'zaehler', focus: { kind: 'meter', id: 'm1' } })
  expect(past?.level).toBe('overdue')
  expect(past?.when).toBe('am 31.12.2025 abgelaufen')
  expect(soon?.detail).toBe('Danach darf der Zähler nicht ungeeicht verwendet werden (§ 37 Abs. 1 MessEG). Lassen Sie ihn rechtzeitig tauschen oder eichen. Hat der Messdienst die Frist im Stichprobenverfahren verlängern lassen (§ 35 MessEV), tragen Sie das verlängerte Jahr am Zähler ein.')
})

test('Kein Name einer Person im Titel; Reihenfolge des Servers bleibt', () => {
  const rows = upcomingRows(list(
    { kind: 'deposit', id: 'deposit:t1', date: '2026-08-31', tenancyId: 't1', tenantName: 'Erika Mustermann', balanceCents: 1 },
    { kind: 'settlement', id: 'settlement:2025-01', date: '2026-12-31', period: calendarPeriod(2025), label: '2025', closed: false },
  ))
  expect(rows.map((r) => r.id)).toEqual(['deposit:t1', 'settlement:2025-01'])
  for (const r of rows) expect(r.title).not.toContain('Mustermann')
})
