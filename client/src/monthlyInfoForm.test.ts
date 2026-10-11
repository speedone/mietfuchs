// Formularlogik der Karte „Monatliche Verbrauchsinformation“ und das Blatt je Mieter (Heizung PR 22).
import { expect, test } from 'vitest'
import { gapText, monthStatus, periodReferenceText, rowBody, rowToForm, sheetLines } from './monthlyInfoForm'
import type { MonthlyInfoMonth, MonthlyInfoUser } from './types'

const user: MonthlyInfoUser = {
  tenancyId: 't1', tenantName: 'Erika Mustermann', unitName: 'EG', areaM2: 60, from: '2025-11-01', to: '2025-11-30', remote: true,
  heatKwh: 700, dhwM3: 2.5, dhwKwh: 281.25,
  previousMonth: { heatKwh: 400, dhwM3: 2, dhwKwh: 225 }, previousYear: { heatKwh: 350, dhwM3: 2, dhwKwh: 225 },
  referenceKwh: 600, gaps: [],
}
const nov: MonthlyInfoMonth = {
  month: '2025-11', due: true, complete: true, sent: true, mixed: false, users: [user],
  row: { plantId: 'hp', month: '2025-11', referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel', sentOn: '2025-12-05' },
}

test('Zeile ins Formular und zurück; leer ist null; Fehler mit einem Satz', () => {
  const form = rowToForm(nov.row)
  expect(form).toEqual({ reference: '10', source: 'Ablesedienst Beispiel', sentOn: '2025-12-05' })
  expect(rowBody(form)).toEqual({ body: { referenceKwhPerM2: 10, referenceSource: 'Ablesedienst Beispiel', sentOn: '2025-12-05' } })
  expect(rowToForm({ plantId: 'hp', month: '2025-11', referenceKwhPerM2: 12.5, referenceSource: 'x', sentOn: null }).reference).toBe('12,5')
  expect(rowBody({ reference: '', source: '', sentOn: '' })).toEqual({ body: { referenceKwhPerM2: null, referenceSource: null, sentOn: null } })
  expect(rowBody({ reference: '12,5', source: '', sentOn: '' })).toEqual({ error: 'Bitte nennen Sie die Quelle des Vergleichswerts, etwa die Vergleichsdaten Ihres Ablesedienstes.' })
  expect(rowBody({ reference: 'viel', source: 'x', sentOn: '' })).toEqual({ error: 'Der Vergleichswert ist eine Zahl größer als 0 (kWh je m² Wohnfläche im Monat).' })
  expect(rowBody({ reference: '0', source: 'x', sentOn: '' })).toEqual({ error: 'Der Vergleichswert ist eine Zahl größer als 0 (kWh je m² Wohnfläche im Monat).' })
  expect(rowToForm(null)).toEqual({ reference: '', source: '', sentOn: '' })
})

test('Status eines Monats: offen, unvollständig mit Grund, mitgeteilt, nicht fällig, ohne Mieter', () => {
  expect(monthStatus(nov)).toEqual({ text: 'mitgeteilt am 05.12.2025', tone: 'ok' })
  expect(monthStatus({ ...nov, sent: false, row: null })).toEqual({ text: 'noch nicht mitgeteilt', tone: 'open' })
  expect(monthStatus({ ...nov, complete: false, users: [{ ...user, gaps: ['reference'] }] })).toEqual({ text: 'unvollständig: Vergleich mit einem Durchschnittsnutzer fehlt', tone: 'warn' })
  expect(monthStatus({ ...nov, due: false })).toEqual({ text: 'noch nicht fällig', tone: 'none' })
  expect(monthStatus({ ...nov, users: [] })).toEqual({ text: 'kein Mieter in diesem Monat', tone: 'none' })
  expect(gapText('hca')).toBe('Heizkostenverteiler zeigen keine Kilowattstunden, lassen Sie die Information vom Ablesedienst erstellen')
})

test('Blatt: Heizung und Warmwasser getrennt, Warmwasser umgerechnet mit Herkunft, Vergleiche je Größe, Durchschnittsnutzer mit Quelle', () => {
  expect(sheetLines(nov, user)).toEqual([
    'Ihr Verbrauch im November 2025:',
    'Heizung: 700 kWh (gemessen)',
    'Warmwasser: 2,5 m³ (gemessen); umgerechnet etwa 281 kWh, angelehnt an § 9 Abs. 2 Satz 2 HeizkostenV einschließlich der Verluste der Erzeugung',
    'Oktober 2025: Heizung 400 kWh, Warmwasser 2 m³ (umgerechnet etwa 225 kWh)',
    'November 2024: Heizung 350 kWh, Warmwasser 2 m³ (umgerechnet etwa 225 kWh)',
    'Ein Durchschnittsnutzer mit 60 m² Wohnfläche: 600 kWh (Quelle: Ablesedienst Beispiel)',
  ])
  expect(sheetLines(nov, { ...user, previousMonth: null, previousYear: null, dhwM3: null, dhwKwh: null })).toEqual([
    'Ihr Verbrauch im November 2025:',
    'Heizung: 700 kWh (gemessen)',
    'Oktober 2025: nicht erhoben',
    'November 2024: nicht erhoben',
    'Ein Durchschnittsnutzer mit 60 m² Wohnfläche: 600 kWh (Quelle: Ablesedienst Beispiel)',
  ])
  // Ohne Temperatur: m³ ja, kWh nicht. Nie eine Summe aus Heizung und Warmwasser.
  expect(sheetLines(nov, { ...user, dhwKwh: null })[2]).toBe('Warmwasser: 2,5 m³ (gemessen), nicht in kWh umgerechnet (Temperatur fehlt)')
  expect(sheetLines(nov, user).join(' ')).not.toMatch(/981|zusammen|insgesamt/)
  // Teile eines Monats (Ein- oder Auszug) nennen ihre Tage.
  expect(sheetLines(nov, { ...user, from: '2025-11-16' })[0]).toBe('Ihr Verbrauch im November 2025 (16.11.2025 bis 30.11.2025):')
})

test('Prüfung S13: der Vergleichswert der Heizperiode als Hinweis, nicht übernommen', () => {
  expect(periodReferenceText(null)).toBe(null)
  expect(periodReferenceText({ kwhPerM2: 150, source: 'Ablesedienst 2025' })).toBe(
    'Für die Angaben zur Heizkostenabrechnung haben Sie für die ganze Heizperiode 150 kWh je m² eingetragen (Quelle: Ablesedienst 2025). Für jeden Monat braucht es einen eigenen Wert; Mietfuchs teilt den Wert der Heizperiode nicht auf, denn der Verbrauch verteilt sich nicht gleichmäßig über das Jahr.',
  )
})
