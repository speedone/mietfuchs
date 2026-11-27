// @vitest-environment jsdom
// Der Verwendungszweck des Zahlungs-QR-Codes im Editor des Anschreibens (#624): kein Absatz des Briefs, erscheint bei
// einer Nachzahlung, und ein Hinweis, wenn er im Code gekürzt würde.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_LETTER_TEXTS, SAMPLE_LETTER_VALUES } from '../../../shared/letter.ts'
import type { LetterBlock } from '../types'
import { UIProvider } from './feedback'
import LetterDrawer from './LetterDrawer'

afterEach(cleanup)

const TENANCY_SHOWN: LetterBlock[] = ['subject', 'salutation', 'intro', 'backPayment', 'receipts', 'closing', 'greeting', 'signature']

function show(over: { own?: Partial<Record<LetterBlock, string>>, shown?: LetterBlock[], level?: 'installation' | 'tenancy' } = {}) {
  render(
    <UIProvider>
      <LetterDrawer
        open
        level={over.level ?? 'installation'}
        title="Anschreiben"
        intro=""
        base={DEFAULT_LETTER_TEXTS}
        own={over.own ?? {}}
        values={SAMPLE_LETTER_VALUES}
        {...(over.shown ? { shown: over.shown } : {})}
        onClose={() => {}}
        onSave={async () => {}}
      />
    </UIProvider>,
  )
}

const purposeHint = () => screen.getByLabelText('Verwendungszweck (QR-Code)').closest('.letter-edit')?.textContent ?? ''

test('#624: der Verwendungszweck zählt nicht zur Länge des Briefs', () => {
  show({ own: { paymentPurpose: 'Wort '.repeat(500) } })
  expect(screen.queryAllByText(/länger als eine Seite/)).toHaveLength(0)
})

test('#624: auf Mieterebene mit Nachzahlung erscheint der Verwendungszweck', () => {
  show({ level: 'tenancy', shown: TENANCY_SHOWN })
  expect(purposeHint()).not.toContain('(in diesem Anschreiben nicht)')
  cleanup()
  show({ level: 'tenancy', shown: TENANCY_SHOWN.map((b) => (b === 'backPayment' ? 'credit' : b)) })
  expect(purposeHint()).toContain('(in diesem Anschreiben nicht)')
})

test('#624: Hinweis, wenn der Verwendungszweck im Code gekürzt würde', () => {
  show({ own: { paymentPurpose: 'x'.repeat(150) } })
  expect(purposeHint()).toContain('Wird im QR-Code auf 140 Zeichen gekürzt.')
  cleanup()
  show()
  expect(purposeHint()).not.toContain('gekürzt')
})

// #704 Teil 2: Führt das Mietverhältnis zwei Staffeln, fragt das Fenster beim eigenen Betrag den Teil für Heizung und
// Warmwasser, zeigt den Satz in der Vorschau und schickt den Teil mit.
function showSplit(mode: 'suggestion' | 'custom', saved: { cents: number | null, heatingCents: number | null }, onSave: (s: unknown) => void, split = true) {
  render(
    <UIProvider>
      <LetterDrawer
        open
        level="tenancy"
        title="Anschreiben an Erika"
        intro=""
        base={DEFAULT_LETTER_TEXTS}
        own={{}}
        values={SAMPLE_LETTER_VALUES}
        shown={[...TENANCY_SHOWN, mode === 'custom' ? 'adjustCustom' : 'adjustSuggestion']}
        adjust={{
          mode, cents: saved.cents, suggestedCents: 29200, own: true, defaultMode: 'suggestion', from: null, defaultFrom: '2027-01',
          ...(split ? { split: { suggestedHeatingCents: 12500, heatingCents: saved.heatingCents, at: () => ({ beforeCents: 12000, unchangedCents: 12000, totalBeforeCents: 30000 }) } } : {}),
        }}
        onClose={() => {}}
        onSave={async (s) => { onSave(s) }}
      />
    </UIProvider>,
  )
}
const text = () => (document.body.textContent ?? '').replace(/[  ]/g, ' ')

test('#704: Vorschlag bei zwei Staffeln: das Fenster nennt beide Teile, und die Vorschau des Satzes auch', () => {
  showSplit('suggestion', { cents: null, heatingCents: null }, () => {})
  expect(text()).toContain('Vom Vorschlag entfallen 125,00 € auf Heizung und Warmwasser und 167,00 € auf die übrigen Nebenkosten')
  expect(text()).toContain('Davon entfallen 125,00 € auf Heizung und Warmwasser (bisher 120,00 €) und 167,00 € auf die übrigen Nebenkosten (bisher 180,00 €).')
  expect(screen.queryByLabelText(/Davon für Heizung und Warmwasser/)).toBeNull()
})

test('#704: eigener Betrag bei zwei Staffeln: der Teil für die Heizung ist Pflicht, steht in der Vorschau und wird gespeichert', async () => {
  const saves: unknown[] = []
  showSplit('custom', { cents: 31000, heatingCents: null }, (s) => saves.push(s))
  const field = screen.getByLabelText(/Davon für Heizung und Warmwasser/) as HTMLInputElement
  expect(field.value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findAllByText(/Davon für Heizung und Warmwasser: Geben Sie einen Betrag in Euro ein/)).not.toHaveLength(0)
  expect(saves).toEqual([])
  fireEvent.change(field, { target: { value: '140,00' } })
  expect(text()).toContain('Davon entfallen 140,00 € auf Heizung und Warmwasser (bisher 120,00 €) und 170,00 € auf die übrigen Nebenkosten (bisher 180,00 €).')
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(saves).toHaveLength(1))
  expect(saves[0]).toMatchObject({ adjust: { mode: 'custom', cents: 31000, heatingCents: 14000 } })
})

test('#704: ohne zwei Staffeln fragt das Fenster nichts dazu und schickt keinen Teil', async () => {
  const saves: unknown[] = []
  showSplit('custom', { cents: 31000, heatingCents: null }, (s) => saves.push(s), false)
  expect(screen.queryByLabelText(/Davon für Heizung und Warmwasser/)).toBeNull()
  fireEvent.change(screen.getByLabelText(/Neue monatliche Vorauszahlung/), { target: { value: '320,00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(saves).toHaveLength(1))
  expect(saves[0]).toEqual({ texts: {}, adjust: { mode: 'custom', cents: 32000, from: null } })
})

// Durchsicht von Teil 2, M2: Eine vor #704 abgeschlossene Abrechnung trägt Werte ohne „Aufteilung“; die Vorschau der
// Objektvorlage zeigte dann den nackten Platzhalter.
test('#704: Vorschau mit Werten ohne „Aufteilung“ (eingefroren von vorher) zeigt keinen nackten Platzhalter', () => {
  const { Aufteilung: _ohne, ...frozen } = SAMPLE_LETTER_VALUES
  render(
    <UIProvider>
      <LetterDrawer open level="property" title="Vorlage" intro="" base={DEFAULT_LETTER_TEXTS} own={{}} values={frozen as typeof SAMPLE_LETTER_VALUES} onClose={() => {}} onSave={async () => {}} />
    </UIProvider>,
  )
  const previews = [...document.querySelectorAll('.letter-preview')].map((p) => p.textContent ?? '').join('\n')
  expect(previews).toContain('angepasst')
  expect(previews).not.toContain('{Aufteilung}')
})

// Durchsicht von Teil 2, K1: Gleiche Summe, andere Teile ist eine Anpassung; das Fenster darf dann nicht sagen, der Brief
// kündige nichts an.
test('#704: gleiche Summe mit anderen Teilen: kein Hinweis „kündigt keine Anpassung an“; mit gleichen Teilen schon', () => {
  const show = (heatingCents: number) => render(
    <UIProvider>
      <LetterDrawer
        open level="tenancy" title="Anschreiben an Erika" intro="" base={DEFAULT_LETTER_TEXTS} own={{}} values={SAMPLE_LETTER_VALUES} shown={[...TENANCY_SHOWN, 'adjustCustom']}
        adjust={{ mode: 'custom', cents: 30000, suggestedCents: 29200, own: true, from: null, defaultFrom: '2027-01', currentAt: () => 30000,
          split: { suggestedHeatingCents: 12500, heatingCents, at: () => ({ beforeCents: 12000, unchangedCents: 12000, totalBeforeCents: 30000 }) } }}
        onClose={() => {}} onSave={async () => {}}
      />
    </UIProvider>,
  )
  show(14000)
  expect(text()).not.toMatch(/kündigt deshalb keine Anpassung an/)
  cleanup()
  show(12000)
  expect(text()).toMatch(/kündigt deshalb keine Anpassung an/)
})

// #712: Deckt die zweite Vorauszahlung laut Aufstellung auch Wasser/Abwasser, heißen Feld, Satz und Vorschau so.
test('#712: zweite Vorauszahlung auch für Wasser/Abwasser: Feld, Satz zum Vorschlag und Vorschau nennen sie so', () => {
  const show = (mode: 'suggestion' | 'custom') => render(
    <UIProvider>
      <LetterDrawer
        open level="tenancy" title="Anschreiben an Erika" intro="" base={DEFAULT_LETTER_TEXTS} own={{}} values={SAMPLE_LETTER_VALUES}
        shown={[...TENANCY_SHOWN, mode === 'custom' ? 'adjustCustom' : 'adjustSuggestion']}
        adjust={{
          mode, cents: mode === 'custom' ? 31000 : null, suggestedCents: 29200, own: true, defaultMode: 'suggestion', from: null, defaultFrom: '2027-01',
          split: { suggestedHeatingCents: 17500, heatingCents: mode === 'custom' ? 19000 : null, coversWater: true, at: () => ({ beforeCents: 17000, unchangedCents: 17000, totalBeforeCents: 30000 }) },
        }}
        onClose={() => {}} onSave={async () => {}}
      />
    </UIProvider>,
  )
  show('suggestion')
  expect(text()).toContain('Vom Vorschlag entfallen 175,00 € auf Heizung, Warmwasser und Wasser/Abwasser und 117,00 € auf die übrigen Nebenkosten')
  expect(text()).toContain('Davon entfallen 175,00 € auf Heizung, Warmwasser und Wasser/Abwasser (bisher 170,00 €) und 117,00 € auf die übrigen Nebenkosten (bisher 130,00 €).')
  cleanup()
  show('custom')
  const field = screen.getByLabelText(/Davon für Heizung, Warmwasser und Wasser\/Abwasser/)
  expect((field as HTMLInputElement).value).toBe('190,00')
  expect(text()).toContain('Bisher 170,00 € für Heizung, Warmwasser und Wasser/Abwasser.')
  expect(text()).toContain('Davon entfallen 190,00 € auf Heizung, Warmwasser und Wasser/Abwasser (bisher 170,00 €) und 120,00 € auf die übrigen Nebenkosten (bisher 130,00 €).')
})
