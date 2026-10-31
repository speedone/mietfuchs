// @vitest-environment jsdom
// Die Auswahlfelder der Karte „Abrechnungszeitraum“ zeigen den gewählten Wert (CLAUDE.md, Tests Ebene 3).
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EffectsList, MoveList, PreviewAnswers, RhythmFields } from './PeriodCard'
import { answersOf, initialAnswers } from '../periodForm'
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
  test('Wechsel: der Monat des Beginns im Monatsfeld, kein Beginnmonat', () => {
    render(<RhythmFields form={{ mode: 'change', month: 1, from: '2025-05' }} onChange={() => {}} />)
    // Das Monatsfeld statt `type="month"`, das Safari und Firefox nicht kennen (#287, #346 Schritt 5)
    const monat = screen.getByRole('textbox', { name: 'Neuer Zeitraum beginnt ab Monat' }) as HTMLInputElement
    expect(monat.value).toBe('Mai 2025')
    expect(screen.queryByRole('combobox', { name: 'Abrechnungszeitraum beginnt im' })).toBeNull()
  })
  test('Wechsel: getippt ergibt JJJJ-MM, auch in der Zukunft; ein ungültiger Text geht unverändert weiter', () => {
    const next: string[] = []
    render(<RhythmFields form={{ mode: 'change', month: 1, from: '2025-05' }} onChange={(f) => next.push(f.from)} />)
    const monat = screen.getByRole('textbox', { name: 'Neuer Zeitraum beginnt ab Monat' })
    const future = new Date().getFullYear() + 2
    fireEvent.change(monat, { target: { value: `5/${future}` } })
    fireEvent.change(monat, { target: { value: '13.2026' } })
    expect(next).toEqual([`${future}-05`, '13.2026'])
  })
  test('Wechsel: die Meldung der Prüfung steht am Monatsfeld', () => {
    render(<RhythmFields form={{ mode: 'change', month: 1, from: '13.2026' }} onChange={() => {}} fromField={{ id: 'f', error: 'Monat 13 gibt es nicht', onFix: () => {} }} />)
    const monat = screen.getByRole('textbox', { name: 'Neuer Zeitraum beginnt ab Monat' })
    expect(monat.getAttribute('aria-invalid')).toBe('true')
    expect(monat.id).toBe('f')
    expect(screen.getByText('Monat 13 gibt es nicht')).toBeTruthy()
  })
  test('Zuordnung einer Gruppe: der vorgeschlagene Zeitraum steht im Feld', () => {
    const preview: PeriodChangePreview = {
      rules: { startMonth: 1, changes: ['2025-05'] }, periods: [], newShort: [], blocked: [], moves: [], effects: [], overrides: [], assessments: [], token: 't', keptTaxYears: [],
      taxYears: [
        { key: 'mu|2025-05', costItemId: 'mu', description: 'Müll 2025', period: periodKey('2025-05'), label: '2025/2026', suggested: 2026, options: [2025, 2026, 2027] },
        { key: 'mu|2024-05', costItemId: 'mu', description: 'Müll 2025', period: periodKey('2024-05'), label: '2024/2025', suggested: 2025, options: [2024, 2025, 2026] },
      ],
      groups: [{ id: '2025-01', heating: false, split: null, taxShifts: [], from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'mu', description: 'Müll 2025', amountCents: 30000 }], options: [{ key: periodKey('2025-01'), label: '01.01.–30.04.2025' }, { key: periodKey('2025-05'), label: '2025/2026' }], suggested: periodKey('2025-05') }],
    }
    render(<PreviewAnswers preview={preview} answers={initialAnswers(preview)} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: /Zeitraum für „Müll 2025“/ }) as HTMLSelectElement
    expect([select.value, select.selectedOptions[0]?.textContent]).toEqual(['2025-05', 'ganz nach 2025/2026'])
    // Das Jahr der Zahlung (Durchsicht von #226, I1): nur für den gewählten Zeitraum, vorbelegt.
    const jahre = screen.getAllByRole('combobox', { name: /Jahr der Zahlung/ }) as HTMLSelectElement[]
    expect(jahre.map((j) => [j.value, j.selectedOptions[0]?.textContent])).toEqual([['2026', '2026']])
  })
})

// Folge-PR zu #252, Geld H2, seit #268 umgekehrt: Bis #268 stand beim gewählten Jahr des Betriebsstroms ein Satz, dass
// sich ein Teil des Abzugs in der Anlage V zwischen den Jahren verschiebt. Seit #268 gleicht die Steuerübersicht je
// Steuerjahr aus, es verschiebt sich nichts, und die Auswahl des Jahres steht ohne Warnung da.
describe('Jahr des Betriebsstroms: kein Satz zur Verschiebung (#268)', () => {
  const preview: PeriodChangePreview = {
    rules: { startMonth: 1, changes: ['2025-05'] }, periods: [], newShort: [], blocked: [], moves: [], effects: [], overrides: [], assessments: [], token: 't', groups: [], keptTaxYears: [],
    taxYears: [{ key: 'bs|2025-05', costItemId: 'bs', description: 'Betriebsstrom', period: periodKey('2025-05'), label: '2025/2026', suggested: 2025, options: [2025, 2026] }],
  }
  test('bei 2025 und bei 2026 keine Warnung an der Auswahl', () => {
    for (const year of ['2025', '2026']) {
      const { container } = render(<PreviewAnswers preview={preview} answers={{ ...initialAnswers(preview), taxYears: { 'bs|2025-05': year } }} onChange={() => {}} />)
      const select = screen.getByLabelText(/Jahr der Zahlung \(Steuer\) für „Betriebsstrom“/) as HTMLSelectElement
      expect(select.value).toBe(year)
      expect(select.closest('label')?.querySelector('.warn')).toBeNull()
      expect(container.textContent).not.toMatch(/verschiebt sich/)
      cleanup()
    }
  })
})

// #455: Kommt ein Anteil zum stehenden Teil derselben Rechnung, entsteht keine zweite Zeile, und die Vorschau sagt es.
describe('Wechsel nach Quelle (#455)', () => {
  test('zeigt, mit welchem Teil zusammengefasst wird', () => {
    render(<MoveList moves={[{ costItemId: 'gs-2', description: 'Grundsteuer 2025', amountCents: 24500, parts: [
      { period: periodKey('2025-01'), label: '2025', amountCents: 24500, mergedInto: 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)' },
    ] }, { costItemId: 'ws', description: 'Wasser', amountCents: 15000, parts: [{ period: periodKey('2025-02'), label: '2025/2026', amountCents: 15000 }] }]} />)
    expect(screen.getByText(/„Grundsteuer 2025“ \(245,00 €\) wird nach Tagen aufgeteilt: 2025: 245,00 €\. Der Anteil für 2025 wird mit dem Teil „Grundsteuer 2025 \(anteilig 01\.01\.–30\.04\.2025\)“ zusammengefasst\./)).toBeTruthy()
    expect(screen.getByText(/„Wasser“/).textContent).not.toMatch(/zusammengefasst/)
  })
  // Integrationsdurchsicht zu #455, M1: Hängt das Zusammenfassen am gefragten Jahr der Zahlung, gilt der Satz nur dafür.
  test('mit Frage nach dem Jahr der Zahlung nur unter Bedingung', () => {
    render(<MoveList moves={[{ costItemId: 'gs-2', description: 'Grundsteuer 2025', amountCents: 12000, parts: [
      { period: periodKey('2025-05'), label: '2025/2026', amountCents: 12000, mergedInto: 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)', mergeDependsOnYear: true },
    ] }]} />)
    expect(screen.getByText(/Bleibt es beim vorbelegten Jahr der Zahlung, wird der Anteil für 2025\/2026 mit dem Teil „Grundsteuer 2025 \(anteilig 01\.05\.–31\.12\.2025\)“ zusammengefasst; mit einem anderen Jahr bleibt er eine eigene Zeile\./)).toBeTruthy()
  })
  // Befund 3 zu #455: Nennt der Zusatz der zusammengefassten Zeile danach eine längere Spanne, sagt die Vorschau den
  // neuen Namen.
  test('nennt den neuen Namen der zusammengefassten Zeile', () => {
    render(<MoveList moves={[{ costItemId: 'gv', description: 'Gebäudeversicherung', amountCents: 97182, parts: [
      { period: periodKey('2025-07'), label: '2025/2026', amountCents: 72167, mergedInto: 'Gebäudeversicherung (anteilig 01.10.–31.12.2025)', mergedAs: 'Gebäudeversicherung (anteilig 01.10.2025–30.06.2026)' },
    ] }]} />)
    expect(screen.getByText(/Der Anteil für 2025\/2026 wird mit dem Teil „Gebäudeversicherung \(anteilig 01\.10\.–31\.12\.2025\)“ zusammengefasst; die Zeile heißt danach „Gebäudeversicherung \(anteilig 01\.10\.2025–30\.06\.2026\)“\./)).toBeTruthy()
  })
  test('nennt den neuen Namen auch, wenn erst ein anderes Jahr zusammenfasst', () => {
    render(<MoveList moves={[{ costItemId: 'gs', description: 'Grundsteuer 2025', amountCents: 3935, parts: [
      { period: periodKey('2025-05'), label: '2025/2026', amountCents: 3935, mergeWithYear: { into: 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)', year: 2025, mergedAs: 'Grundsteuer 2025 (anteilig 01.05.2025–30.04.2026)' } },
    ] }]} />)
    expect(screen.getByText(/mit dem Jahr 2025 für beide wird er mit dem Teil „Grundsteuer 2025 \(anteilig 01\.05\.–31\.12\.2025\)“ zusammengefasst; die Zeile heißt dann „Grundsteuer 2025 \(anteilig 01\.05\.2025–30\.04\.2026\)“\./)).toBeTruthy()
  })
  // #471: der umgekehrte Fall, das Zusammenfassen entsteht erst mit einem anderen Jahr.
  test('nennt das Jahr, mit dem erst zusammengefasst wird', () => {
    render(<MoveList moves={[{ costItemId: 'gs-2', description: 'Grundsteuer 2025', amountCents: 12000, parts: [
      { period: periodKey('2025-05'), label: '2025/2026', amountCents: 12000, mergeWithYear: { into: 'Grundsteuer 2025 (anteilig 01.05.2025–31.12.2025)', year: 2025 } },
    ] }]} />)
    expect(screen.getByText(/Mit dem vorbelegten Jahr der Zahlung bleibt der Anteil für 2025\/2026 eine eigene Zeile; mit dem Jahr 2025 für beide wird er mit dem Teil „Grundsteuer 2025 \(anteilig 01\.05\.2025–31\.12\.2025\)“ zusammengefasst\./)).toBeTruthy()
  })
  // #471: Trägt die verbleibende Zeile die ganze Rechnung, nennt die Vorschau ihre neue Beschreibung.
  test('nennt die neue Beschreibung, wenn die Zeile die ganze Rechnung trägt', () => {
    render(<MoveList moves={[{ costItemId: 'gs-2', description: 'Grundsteuer 2025', amountCents: 24500, renamedTo: 'Grundsteuer 2025', parts: [
      { period: periodKey('2025-01'), label: '2025', amountCents: 24500, mergedInto: 'Grundsteuer 2025 (anteilig 01.01.–30.04.2025)' },
    ] }]} />)
    expect(screen.getByText(/zusammengefasst\. Die Zeile trägt danach die ganze Rechnung und heißt „Grundsteuer 2025“\./)).toBeTruthy()
  })
  // Durchsicht zu #471, M2: Hängt das Zusammenfassen am vorbelegten Jahr, gilt auch der neue Name nur dann; und entsteht es
  // erst mit einem anderen Jahr, nennt der Satz dazu den neuen Namen.
  test('der neue Name unter derselben Bedingung wie das Zusammenfassen', () => {
    const { container } = render(<MoveList moves={[{ costItemId: 'gs-2', description: 'Grundsteuer 2025', amountCents: 12000, renamedTo: 'Grundsteuer 2025', parts: [
      { period: periodKey('2025-05'), label: '2025/2026', amountCents: 12000, mergedInto: 'Grundsteuer 2025 (anteilig 01.05.–31.12.2025)', mergeDependsOnYear: true },
    ] }]} />)
    expect(container.textContent).toMatch(/eine eigene Zeile\. Bleibt es beim vorbelegten Jahr, trägt die Zeile danach die ganze Rechnung und heißt „Grundsteuer 2025“\./)
    expect(container.textContent).not.toMatch(/ Die Zeile trägt danach/)
    cleanup()
    const mirror = render(<MoveList moves={[{ costItemId: 'gs-3', description: 'Grundsteuer 2025', amountCents: 12000, parts: [
      { period: periodKey('2025-05'), label: '2025/2026', amountCents: 12000, mergeWithYear: { into: 'Grundsteuer 2025 (anteilig 01.05.2025–31.12.2025)', year: 2025, renamedTo: 'Grundsteuer 2025' } },
    ] }]} />)
    expect(mirror.container.textContent).toMatch(/zusammengefasst; die Zeile trägt dann die ganze Rechnung und heißt „Grundsteuer 2025“\./)
  })
})

// #478 (E3): Die Vorschau nennt ein gehaltenes Jahr der Zahlung, das danach außerhalb der Kalenderjahre des Zeitraums
// liegt (bei einer Gruppe nur für den gewählten Zeitraum), und jede Verschiebung zwischen Steuerjahren beim Teilen.
describe('Gehaltenes Jahr der Zahlung (#478)', () => {
  const satz = '„Gartenpflege“ behält das Jahr der Zahlung 2025; im Zeitraum 2026 steht sie für die Steuer deshalb als verschoben.'
  const preview: PeriodChangePreview = {
    rules: { startMonth: 5, changes: ['2026-01'] }, periods: [], newShort: [], blocked: [], moves: [], effects: [], overrides: [], assessments: [], token: 't', taxYears: [],
    keptTaxYears: [{ costItemId: 'garten', description: 'Gartenpflege', taxYear: 2025, period: periodKey('2026-01'), label: '2026', text: satz }],
    groups: [{ id: '2025-05', heating: false, split: { range: '01.05.2025–30.04.2026', items: [], notes: [] }, taxShifts: [], from: periodKey('2025-05'), fromLabel: '2025/2026', items: [{ costItemId: 'garten', description: 'Gartenpflege', amountCents: 68298 }], options: [{ key: periodKey('2025-05'), label: '01.05.–31.12.2025' }, { key: periodKey('2026-01'), label: '2026' }], suggested: 'split' }],
  }
  test('beim Teilen und ganz im betroffenen Zeitraum der Satz, ganz in einem anderen nicht', () => {
    for (const [chosen, shown] of [['split', true], ['2026-01', true], ['2025-05', false]] as const) {
      const { container } = render(<PreviewAnswers preview={preview} answers={{ ...initialAnswers(preview), groups: { '2025-05': chosen } }} onChange={() => {}} />)
      expect(container.textContent?.includes(satz), chosen).toBe(shown)
      cleanup()
    }
  })
  test('eine Verschiebung beim Teilen einer Rechnung steht unter ihr', () => {
    const { container } = render(<MoveList moves={[{ costItemId: 'gs', description: 'Grundsteuer', amountCents: 36500, taxShift: 'Für die Steuer kämen 120,00 € aus dem Jahr der Zahlung 2024 nach 2025, obwohl sich an der Zahlung nichts ändert. Prüfen Sie danach das Jahr der Zahlung der Teile.', parts: [
      { period: periodKey('2024-05'), label: '01.05.–31.12.2024', amountCents: 24500 }, { period: periodKey('2025-01'), label: '2025', amountCents: 12000 },
    ] }]} />)
    expect(container.querySelector('.warn')?.textContent).toMatch(/Für die Steuer kämen 120,00 € aus dem Jahr der Zahlung 2024 nach 2025/)
  })
})

describe('Laienprobe (B2, B3, B4)', () => {
  const basis: PeriodChangePreview = {
    rules: { startMonth: 1, changes: ['2025-07'] }, newShort: [{ key: periodKey('2025-01'), label: '01.01.–30.06.2025' }], blocked: [], moves: [], effects: [], overrides: [], assessments: [], token: 't', taxYears: [], keptTaxYears: [],
    periods: [{ key: periodKey('2025-01'), label: '01.01.–30.06.2025', short: true }, { key: periodKey('2025-07'), label: '2025/2026', short: false }],
    groups: [
      { id: '2025-01', heating: false, taxShifts: [], from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'gs', description: 'Grundsteuer 2025', amountCents: 42000 }],
        options: [{ key: periodKey('2025-01'), label: '01.01.–30.06.2025' }, { key: periodKey('2025-07'), label: '2025/2026' }],
        split: { range: '01.01.–31.12.2025', items: [{ costItemId: 'gs', parts: [{ period: periodKey('2025-01'), label: '01.01.–30.06.2025', amountCents: 20827 }, { period: periodKey('2025-07'), label: '2025/2026', amountCents: 21173 }] }], notes: [] },
        suggested: 'split' },
      { id: '2025-01|heizung', heating: true, taxShifts: [], from: periodKey('2025-01'), fromLabel: '2025', items: [{ costItemId: 'gas', description: 'Erdgas 2025', amountCents: 260000 }],
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
  test('#454: Einzelbeträge in eigener Gruppe, ohne Aufteilen, mit dem Satz, warum', () => {
    const kabel = { id: '2025-01|einzelbetraege', heating: false, individualAmounts: true as const, taxShifts: [], from: periodKey('2025-01'), fromLabel: '2025',
      items: [{ costItemId: 'kabel', description: 'Kabel 2025', amountCents: 12000 }],
      options: [{ key: periodKey('2025-01'), label: '01.01.–30.06.2025' }, { key: periodKey('2025-07'), label: '2025/2026' }], split: null, suggested: periodKey('2025-01') }
    const preview = { ...basis, groups: [kabel] }
    render(<PreviewAnswers preview={preview} answers={initialAnswers(preview)} onChange={() => {}} />)
    const feld = screen.getByRole('combobox', { name: /Zeitraum für „Kabel 2025“/ }) as HTMLSelectElement
    expect([...feld.options].map((o) => o.value)).toEqual(['2025-01', '2025-07'])
    expect(feld.value).toBe('2025-01')
    expect(screen.getByText(/Einzelbeträge teilt Mietfuchs nicht nach Tagen/)).toBeTruthy()
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
    // Review Runde 1: begründet (zu vertreten), mit Vorsicht zum rückwirkenden Wechsel, und gerechnet mit den Vorschlägen.
    expect(screen.getByText(/Weil Sie selbst umstellen, haben Sie die Verspätung zu vertreten/)).toBeTruthy()
    expect(screen.getByText(/§ 556 Abs\. 3 Satz 3 BGB\); das sind hier 251,54.€ mehr als bisher/)).toBeTruthy()
    expect(screen.getByText(/üblich ist ein Wechsel nur für die Zukunft/)).toBeTruthy()
    expect(screen.getByText(/wechseln Sie frühestens ab November 2025\./)).toBeTruthy()
    expect(screen.getByText(/Gerechnet mit den Vorschlägen dieser Vorschau/)).toBeTruthy()
  })
  test('B4: „von Anfang an“ sagt, dass es auch frühere Abrechnungen ändert', () => {
    render(<RhythmFields form={{ mode: 'start', month: 7, from: '' }} onChange={() => {}} />)
    expect(screen.getByText(/ändert auch alle früheren Abrechnungszeiträume/)).toBeTruthy()
    cleanup()
    render(<RhythmFields form={{ mode: 'change', month: 1, from: '2026-10' }} onChange={() => {}} />)
    expect(screen.queryByText(/ändert auch alle früheren Abrechnungszeiträume/)).toBeNull()
  })
})

describe('Review Runde 1', () => {
  test('Ohne Vorgabe: „bitte wählen“, die Sätze zum Steuerjahr, und ohne Wahl kein Speichern', () => {
    const p: PeriodChangePreview = {
      rules: { startMonth: 1, changes: ['2025-01'] }, periods: [], newShort: [], blocked: [], moves: [], effects: [], overrides: [], assessments: [], token: 't', taxYears: [], keptTaxYears: [],
      groups: [{ id: '2024-05', heating: false, from: periodKey('2024-05'), fromLabel: '2024/2025', items: [{ costItemId: 'mu', description: 'Müll 2024/2025', amountCents: 36500 }],
        options: [{ key: periodKey('2024-05'), label: '01.05.–31.12.2024' }, { key: periodKey('2025-01'), label: '2025' }],
        split: { range: '01.05.2024–30.04.2025', items: [], notes: ['Geteilt kämen für die Steuer 245,00 € aus dem Jahr der Zahlung 2025 nach 2024, obwohl sich an der Zahlung nichts ändert.'] },
        taxShifts: [{ key: periodKey('2024-05'), text: 'Ganz nach 01.05.–31.12.2024 verschoben, kämen für die Steuer 365,00 € aus dem Jahr der Zahlung 2025 nach 2024.' }],
        suggested: '' }],
    }
    render(<PreviewAnswers preview={p} answers={initialAnswers(p)} onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: /Zeitraum für „Müll 2024\/2025“/ }) as HTMLSelectElement
    expect([select.value, select.selectedOptions[0]?.textContent]).toEqual(['', '– bitte wählen –'])
    expect(screen.getByText(/Geteilt kämen für die Steuer 245,00 €/)).toBeTruthy()
    expect(answersOf(p, initialAnswers(p))).toEqual({ error: 'Bitte wählen Sie, wohin „Müll 2024/2025“ kommen: nach Tagen aufteilen oder ganz in einen Zeitraum.' })
    cleanup()
    render(<PreviewAnswers preview={p} answers={{ ...initialAnswers(p), groups: { '2024-05': '2024-05' } }} onChange={() => {}} />)
    expect(screen.getByText(/kämen für die Steuer 365,00 € aus dem Jahr der Zahlung 2025 nach 2024/)).toBeTruthy()
  })
})
