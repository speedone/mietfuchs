// @vitest-environment jsdom
// Der Verwendungszweck des Zahlungs-QR-Codes im Editor des Anschreibens (#624): kein Absatz des Briefs, erscheint bei
// einer Nachzahlung, und ein Hinweis, wenn er im Code gekürzt würde.
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_LETTER_TEXTS, SAMPLE_LETTER_VALUES } from '../../../shared/letter.ts'
import type { LetterBlock } from '../types'
import { UIProvider } from './feedback'
import LetterDrawer from './LetterDrawer'

afterEach(cleanup)

const TENANCY_SHOWN: LetterBlock[] = ['subject', 'salutation', 'intro', 'backPayment', 'receipts', 'closing', 'greeting', 'signature']

function show(over: { own?: Partial<Record<LetterBlock, string | null>>, shown?: LetterBlock[], level?: 'installation' | 'tenancy' } = {}) {
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
