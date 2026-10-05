// @vitest-environment jsdom
// Die Auswahlfelder der Karte „Abrechnungszeitraum“ zeigen den gewählten Wert (CLAUDE.md, Tests Ebene 3).
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EffectsList, PreviewAnswers, RhythmFields } from './PeriodCard'
import { initialAnswers } from '../periodForm'
import { periodKey } from '../../../shared/period.ts'
import type { PeriodChangePreview } from '../types'


afterEach(cleanup)

describe('Karte „Abrechnungszeitraum“ (#208)', () => {
  test('Beginnmonat: der gewählte Monat steht im Feld', () => {
    render(<RhythmFields form={{ mode: 'start', month: 5, from: '' }} onChange={() => {}} />)
    const art = screen.getByRole('combobox', { name: 'Was möchten Sie ändern?' }) as HTMLSelectElement
    expect(art.value).toBe('start')
    const monat = screen.getByRole('combobox', { name: 'Abrechnungszeitraum beginnt im' }) as HTMLSelectElement
    expect([monat.value, monat.selectedOptions[0]?.textContent]).toEqual(['5', 'Mai'])
  })
  test('Wechsel: der Monat des Beginns, kein Beginnmonat', () => {
    render(<RhythmFields form={{ mode: 'change', month: 1, from: '2025-05' }} onChange={() => {}} />)
    expect((screen.getByLabelText(/Neuer Zeitraum beginnt ab \(Monat\/Jahr\)/) as HTMLInputElement).value).toBe('2025-05')
    expect(screen.queryByRole('combobox', { name: 'Abrechnungszeitraum beginnt im' })).toBeNull()
  })
  test('Zuordnung einer Gruppe: der vorgeschlagene Zeitraum steht im Feld', () => {
    const preview: PeriodChangePreview = {
      rules: { startMonth: 1, changes: ['2025-05'] }, periods: [], newShort: [], blocked: [], moves: [], effects: [], overrides: [], assessments: [], token: 't',
      taxYears: [
        { key: 'mu|2025-05', costItemId: 'mu', description: 'Müll 2025', period: periodKey('2025-05'), label: '2025/2026', suggested: 2026, options: [2025, 2026, 2027] },
        { key: 'mu|2024-05', costItemId: 'mu', description: 'Müll 2025', period: periodKey('2024-05'), label: '2024/2025', suggested: 2025, options: [2024, 2025, 2026] },
      ],
      groups: [{ id: '2025-01', heating: false, split: null, from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'mu', description: 'Müll 2025', amountCents: 30000 }], options: [{ key: periodKey('2025-01'), label: '01.01.–30.04.2025' }, { key: periodKey('2025-05'), label: '2025/2026' }], suggested: periodKey('2025-05') }],
    }
    render(<PreviewAnswers preview={preview} answers={initialAnswers(preview)} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: /Zeitraum für „Müll 2025“/ }) as HTMLSelectElement
    expect([select.value, select.selectedOptions[0]?.textContent]).toEqual(['2025-05', 'ganz nach 2025/2026'])
    // Das Jahr der Zahlung (Durchsicht von #226, I1): nur für den gewählten Zeitraum, vorbelegt.
    const jahre = screen.getAllByRole('combobox', { name: /Jahr der Zahlung/ }) as HTMLSelectElement[]
    expect(jahre.map((j) => [j.value, j.selectedOptions[0]?.textContent])).toEqual([['2026', '2026']])
  })
})

describe('Laienprobe (B2, B3, B4)', () => {
  const basis: PeriodChangePreview = {
    rules: { startMonth: 1, changes: ['2025-07'] }, newShort: [{ key: periodKey('2025-01'), label: '01.01.–30.06.2025' }], blocked: [], moves: [], effects: [], overrides: [], assessments: [], token: 't', taxYears: [],
    periods: [{ key: periodKey('2025-01'), label: '01.01.–30.06.2025', short: true }, { key: periodKey('2025-07'), label: '2025/2026', short: false }],
    groups: [
      { id: '2025-01', heating: false, from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'gs', description: 'Grundsteuer 2025', amountCents: 42000 }],
        options: [{ key: periodKey('2025-01'), label: '01.01.–30.06.2025' }, { key: periodKey('2025-07'), label: '2025/2026' }],
        split: { range: '01.01.–31.12.2025', items: [{ costItemId: 'gs', parts: [{ period: periodKey('2025-01'), label: '01.01.–30.06.2025', amountCents: 20827 }, { period: periodKey('2025-07'), label: '2025/2026', amountCents: 21173 }] }] },
        suggested: 'split' },
      { id: '2025-01|heizung', heating: true, from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'gas', description: 'Erdgas 2025', amountCents: 260000 }],
        options: [{ key: periodKey('2025-01'), label: '01.01.–30.06.2025' }, { key: periodKey('2025-07'), label: '2025/2026' }], split: null, suggested: '2025-01' },
    ],
  }
  test('B2: kalte Jahresrechnung vorbelegt mit dem Aufteilen nach Tagen, mit den Beträgen; Heizkosten im Rumpf mit Warnung und Betrag', () => {
    render(<PreviewAnswers preview={basis} answers={initialAnswers(basis)} onChange={() => {}} />)
    const kalt = screen.getByRole('combobox', { name: /Zeitraum für „Grundsteuer 2025“/ }) as HTMLSelectElement
    expect([kalt.value, kalt.selectedOptions[0]?.textContent]).toEqual(['split', 'Nach Tagen auf die neuen Zeiträume aufteilen (Vorgabe)'])
    expect(screen.getByText(/„Grundsteuer 2025“ 01\.01\.–30\.06\.2025: 208,27 €, 2025\/2026: 211,73 €/)).toBeTruthy()
    expect(screen.getByText(/2\.600,00 € stehen danach ganz im Rumpfzeitraum 01\.01\.–30\.06\.2025/)).toBeTruthy()
  })
  test('B2: wer eine kalte Rechnung doch ganz in einen Zeitraum legt, bekommt den Betrag genannt', () => {
    render(<PreviewAnswers preview={basis} answers={{ ...initialAnswers(basis), groups: { '2025-01': '2025-01', '2025-01|heizung': '2025-07' } }} onChange={() => {}} />)
    expect(screen.getByText(/420,00 € kommen ganz nach 01\.01\.–30\.06\.2025/)).toBeTruthy()
    expect(screen.queryByText(/stehen danach ganz im Rumpfzeitraum/)).toBeNull()
  })
  test('B3: abgelaufene Frist rot, mit Folge, Betrag und frühestem Wechsel', () => {
    render(<EffectsList earliest="2025-11" effects={[{ label: '01.01.–30.06.2025', deadline: '2026-06-30', passed: true, replaces: [{ label: '2025', deadline: '2026-12-31' }],
      tenants: [{ tenantName: 'Familie Beispiel', beforeCents: 157882, afterCents: -25154 }], lostClaimsCents: 25154 }]} />)
    expect(screen.getByText(/Abrechnung bis 30\.06\.2026 zustellen – diese Frist ist schon abgelaufen\. Bisher: 2025 \(Frist 31\.12\.2026\)/)).toBeTruthy()
    expect(screen.getByText(/Familie Beispiel: vorher Guthaben 1\.578,82 €, nachher Nachzahlung 251,54 €/)).toBeTruthy()
    expect(screen.getByText(/§ 556 Abs\. 3 Satz 3 BGB\); hier wären das 251,54 €\. Damit keine abgelaufene Abrechnung entsteht, wechseln Sie frühestens ab November 2025\./)).toBeTruthy()
  })
  test('B4: „von Anfang an“ sagt, dass es auch frühere Abrechnungen ändert', () => {
    render(<RhythmFields form={{ mode: 'start', month: 7, from: '' }} onChange={() => {}} />)
    expect(screen.getByText(/ändert auch alle früheren Abrechnungszeiträume/)).toBeTruthy()
    cleanup()
    render(<RhythmFields form={{ mode: 'change', month: 1, from: '2026-10' }} onChange={() => {}} />)
    expect(screen.queryByText(/ändert auch alle früheren Abrechnungszeiträume/)).toBeNull()
  })
})
