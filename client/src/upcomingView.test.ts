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

// ---------- Mieterhöhung (#191, PR 4) ----------

const who = { tenancyId: 't1', unitName: 'EG links', tenantName: 'Erika Mustermann' }
const RENT_JUMP = { kind: 'rentIncrease', tenancyId: 't1' }

test('Staffelstufe: zur Information, letzte Stufe mit frühestem Verlangen danach, Sprung ins Fenster „Mieterhöhung“', () => {
  const [last, middle] = upcomingRows(list(
    { kind: 'rentStep', id: 'rentStep:t1:2027-01', date: '2027-01-01', ...who, fromCents: 54000, cents: 56000, last: true, comparisonFrom: '2028-01-02' },
    { kind: 'rentStep', id: 'rentStep:t2:2027-02', date: '2027-02-01', ...who, tenancyId: 't2', fromCents: 54000, cents: 56000, last: false, comparisonFrom: null },
  ))
  expect(last?.level).toBe('info')
  expect(last?.title).toBe('Neue Stufe der Staffelmiete, EG links')
  expect(last?.when).toBe('ab 01.01.2027 (in 42 Tagen)')
  expect(plain(last?.detail ?? '')).toBe('Erika Mustermann zahlt ab dann 560,00 € Kaltmiete statt 540,00 €. Die Stufe ist vereinbart und gilt ohne Erklärung (§ 557a BGB). Es ist die letzte eingetragene Stufe. Danach ist eine Erhöhung bis zur ortsüblichen Vergleichsmiete möglich (§ 557a Abs. 2 Satz 2, § 558 BGB); ein Verlangen kann frühestens am 02.01.2028 zugehen.')
  expect(last?.action).toEqual({ label: 'Mieterhöhung öffnen', tab: 'stammdaten', focus: RENT_JUMP })
  expect(plain(middle?.detail ?? '')).toBe('Erika Mustermann zahlt ab dann 560,00 € Kaltmiete statt 540,00 €. Die Stufe ist vereinbart und gilt ohne Erklärung (§ 557a BGB).')
})

test('Erhöhung möglich: schon erreicht oder kommend, Vergleichsmiete und Index, offene Frage zum Ausschluss', () => {
  const [reached, soon] = upcomingRows(list(
    { kind: 'rentIncrease', id: 'rentIncrease:t1', date: '2021-01-02', ...who, increaseKind: 'comparison', effectiveFrom: '2027-02', exclusionOpen: false, staggered: false },
    { kind: 'rentIncrease', id: 'rentIncrease:t2', date: '2027-02-18', ...who, increaseKind: 'index', effectiveFrom: '2027-04', exclusionOpen: true, staggered: false },
  ))
  expect(reached?.level).toBe('info')
  expect(reached?.title).toBe('Mieterhöhung möglich, EG links')
  expect(reached?.when).toBe('Zugang möglich seit 02.01.2021')
  expect(reached?.detail).toBe('Ein Verlangen an Erika Mustermann, der Erhöhung bis zur ortsüblichen Vergleichsmiete zuzustimmen (§ 558 BGB), kann schon jetzt zugehen; die erhöhte Miete wäre dann ab dem 01.02.2027 geschuldet. Wie viel möglich ist, rechnet das Fenster „Mieterhöhung“ aus Vergleichsmiete und Kappungsgrenze.')
  expect(reached?.action).toEqual({ label: 'Mieterhöhung öffnen', tab: 'stammdaten', focus: RENT_JUMP })
  expect(soon?.title).toBe('Indexanpassung möglich, EG links')
  expect(soon?.when).toBe('Zugang ab 18.02.2027 (in 90 Tagen)')
  expect(soon?.detail).toBe('Eine Erklärung an Erika Mustermann, die Miete an den Verbraucherpreisindex anzupassen (§ 557b BGB), kann frühestens am 18.02.2027 zugehen; die geänderte Miete wäre dann ab dem 01.04.2027 zu zahlen. Den neuen Indexwert geben Sie im Fenster „Mieterhöhung“ ein. Vorher ist am Mietverhältnis noch anzugeben, ob der Vertrag Mieterhöhungen ausschließt (§ 557 Abs. 3 BGB).')
})

test('Zustimmungsfrist: läuft (offen), abgelaufen mit Klagefrist, danach nur zur Information; Schweigen ist keine Zustimmung', () => {
  const consent = { kind: 'rentConsent' as const, ...who, increaseId: 'r1', receivedOn: '2026-11-10', consentEnd: '2027-01-31', consentEndOnWorkday: '2027-01-31', suitEnd: '2027-04-30' }
  const [running, suit, lapsed] = upcomingRows(list(
    { ...consent, id: 'rentConsent:r1', date: '2027-01-31', stage: 'running' },
    { ...consent, id: 'rentConsent:r2', date: '2027-04-30', stage: 'suit' },
    { ...consent, id: 'rentConsent:r3', date: '2027-04-30', stage: 'lapsed' },
  ))
  expect(running?.level).toBe('open')
  expect(running?.title).toBe('Zustimmungsfrist zur Mieterhöhung, EG links')
  expect(running?.when).toBe('bis 31.01.2027 (in 72 Tagen)')
  expect(running?.detail).toBe('Das Verlangen ist Erika Mustermann am 10.11.2026 zugegangen. Zustimmen kann der Mieter bis zum Ablauf des zweiten Kalendermonats nach dem Zugang (§ 558b Abs. 1 BGB). Tragen Sie die Antwort ein, sobald sie vorliegt; mit der Zustimmung trägt Mietfuchs die neue Miete in die Kaltmiete-Staffel ein.')
  expect(running?.action).toEqual({ label: 'Antwort eintragen', tab: 'stammdaten', focus: RENT_JUMP })
  expect(suit?.level).toBe('overdue')
  expect(suit?.title).toBe('Zustimmung zur Mieterhöhung fehlt, EG links')
  expect(suit?.when).toBe('Zustimmungsfrist am 31.01.2027 abgelaufen, Klagefrist bis 30.04.2027')
  expect(suit?.detail).toBe('Zum Verlangen, das Erika Mustermann am 10.11.2026 zugegangen ist, ist keine Antwort eingetragen. Schweigen ist keine Zustimmung. Stimmt der Mieter nicht zu, kann auf Zustimmung geklagt werden, bis zum 30.04.2027 (§ 558b Abs. 2 BGB). Ob eine Klage sinnvoll ist, prüft Mietfuchs nicht. Liegt eine Antwort vor, tragen Sie sie ein.')
  expect(lapsed?.level).toBe('info')
  expect(lapsed?.title).toBe('Klagefrist zur Mieterhöhung verstrichen, EG links')
  expect(lapsed?.when).toBe('am 30.04.2027 abgelaufen')
  expect(lapsed?.detail).toBe('Zum Verlangen, das Erika Mustermann am 10.11.2026 zugegangen ist, ist keine Antwort eingetragen, und die Frist für eine Klage auf Zustimmung (§ 558b Abs. 2 BGB) ist verstrichen. Schweigen ist keine Zustimmung; ohne sie gilt die erhöhte Miete nicht. Tragen Sie die Antwort ein oder nehmen Sie das Verlangen zurück, dann verschwindet der Eintrag.')
  for (const r of [running, suit, lapsed]) expect(r?.title).not.toContain('Mustermann')
})

test('Zustimmungsfrist: am Wochenende verschobenes Ende, bis zu diesem Werktag offen (Durchsicht S4)', () => {
  const item: UpcomingDeadline = {
    kind: 'rentConsent', id: 'rentConsent:r1', date: '2027-02-01', ...who, increaseId: 'r1', stage: 'running',
    receivedOn: '2026-11-10', consentEnd: '2027-01-31', consentEndOnWorkday: '2027-02-01', suitEnd: '2027-04-30',
  }
  const [row] = upcomingRows({ today: '2027-02-01', until: '2027-05-02', items: [item] })
  expect(row?.when).toBe('bis 01.02.2027 (heute)')
  expect(row?.detail).toMatch(/Das Monatsende, der 31\.01\.2027, fällt auf einen Sonnabend, Sonntag oder Feiertag; ob sich die Frist deshalb nach § 193 BGB bis zum 01\.02\.2027 verlängert, ist nicht geklärt\. Mietfuchs zählt sie bis dahin als laufend und rechnet eine Klage erst danach\./)
})

test('Erhöhung möglich bei Staffelmiete: Hinweis auf § 557a Abs. 2 und die eingetragenen Stufen (Durchsicht K5)', () => {
  const [row] = upcomingRows(list(
    { kind: 'rentIncrease', id: 'rentIncrease:t1', date: '2028-01-02', ...who, increaseKind: 'comparison', effectiveFrom: '2028-04', exclusionOpen: false, staggered: true },
  ))
  expect(row?.detail).toMatch(/Bei einer Staffelmiete ist das erst nach der letzten vereinbarten Stufe möglich \(§ 557a Abs\. 2 BGB\); Mietfuchs rechnet mit den eingetragenen Stufen, deshalb müssen alle vereinbarten Stufen eingetragen sein\.$/)
})
