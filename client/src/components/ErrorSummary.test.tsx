// @vitest-environment jsdom
// Feld und Sammelmeldung (#346, Schritt 3; Spezifikation Abschnitt 3 „Fehler: am Feld und als Sammelmeldung“):
// Das Feld verbindet Hinweis und Fehler über aria-describedby und markiert sich mit aria-invalid; die
// Sammelmeldung bekommt beim Absenden den Fokus, ihr Link fokussiert das Feld, und ändert der Nutzer das
// Feld, ist die Meldung an beiden Stellen weg. Im Seitenfenster steht sie im festen Fuß über den Knöpfen.
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import Field from './Field'
import Drawer from './Drawer'
import { ErrorSummary, summaryTitle, useFormError } from './ErrorSummary'
import { UIProvider } from './feedback'
import type { Problem } from '../formProblems'

afterEach(cleanup)

type F = 'date' | 'amount'
const check = (form: { date: string; amount: string }): Problem<F>[] => [
  ...(form.date ? [] : [{ field: 'date' as const, short: 'Datum fehlt', text: 'Zahlung: Geben Sie das Datum ein, an dem das Geld eingegangen ist.' }]),
  ...(form.amount ? [] : [{ field: 'amount' as const, short: 'Betrag fehlt', text: 'Zahlung: Geben Sie den Betrag ein.' }]),
]

function Karte() {
  const [form, setForm] = useState({ date: '', amount: '' })
  const errors = useFormError<F>()
  return (
    <div className="card">
      <h2>Zahlung</h2>
      <ErrorSummary errors={errors} />
      <Field label="Datum" hint="Tag des Eingangs" {...errors.field('date')}>
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      </Field>
      <Field label="Betrag €" width="s" {...errors.field('amount')}>
        <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      </Field>
      <Field label="Notiz" optional>
        <input />
      </Field>
      <button type="button" onClick={() => errors.report(check(form))}>Speichern</button>
      <button type="button" onClick={() => errors.set('Der Server lehnt ab.', { focus: false })}>Laden scheitert</button>
    </div>
  )
}

const describedTexts = (el: HTMLElement) => (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent)

test('das Feld: Beschriftung als Name, „(freiwillig)“ statt Sternchen, Hinweis über aria-describedby, Breite', () => {
  render(<Karte />)
  const date = screen.getByLabelText('Datum')
  expect(date.getAttribute('aria-invalid')).toBeNull()
  // Der Name ist nur die Beschriftung, nicht Hinweis und Fehler (sonst würden sie doppelt vorgelesen).
  expect(describedTexts(date)).toEqual(['Tag des Eingangs'])
  expect(screen.getByLabelText('Notiz (freiwillig)')).toBeTruthy()
  expect(screen.getByLabelText('Betrag €').closest('label')?.className).toContain('width-s')
})

test('Absenden: Fehler am Feld (kurz) und in der Sammelmeldung (mit Ort), die den Fokus bekommt', () => {
  render(<Karte />)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain(summaryTitle(2))
  expect(summaryTitle(1)).toBe('Bitte prüfen Sie 1 Angabe')
  // Fokus auf dem äußeren Element, role="alert" innen (GOV.UK)
  expect(document.activeElement).toBe(alert.parentElement)
  expect(alert.parentElement?.getAttribute('tabindex')).toBe('-1')
  const date = screen.getByLabelText('Datum')
  expect(date.getAttribute('aria-invalid')).toBe('true')
  expect(describedTexts(date)).toEqual(['Tag des Eingangs', '⚠ Fehler: Datum fehlt'])
  // Der Hinweis für Vorleser steht im Text, das Symbol ist für sie ausgeblendet.
  expect(screen.getAllByText('Fehler:').map((e) => e.className)).toEqual(['sr-only', 'sr-only'])
  // Die Sammelmeldung nennt den Satz mit Ort, das Feld nur die kurze Fassung.
  const links = within(alert).getAllByRole('link')
  expect(links.map((l) => l.textContent)).toEqual(['Zahlung: Geben Sie das Datum ein, an dem das Geld eingegangen ist.', 'Zahlung: Geben Sie den Betrag ein.'])
})

test('der Link der Sammelmeldung fokussiert sein Feld', () => {
  render(<Karte />)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  fireEvent.click(within(screen.getByRole('alert')).getByRole('link', { name: /Betrag/ }))
  expect(document.activeElement).toBe(screen.getByLabelText('Betrag €'))
})

test('ändert der Nutzer ein Feld, ist seine Meldung an beiden Stellen weg; ohne Meldung keine Sammelmeldung', () => {
  render(<Karte />)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  const date = screen.getByLabelText('Datum')
  fireEvent.change(date, { target: { value: '2025-06-30' } })
  expect(date.getAttribute('aria-invalid')).toBeNull()
  expect(describedTexts(date)).toEqual(['Tag des Eingangs'])
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain(summaryTitle(1))
  expect(alert.textContent).not.toContain('Datum ein')
  fireEvent.change(screen.getByLabelText('Betrag €'), { target: { value: '5' } })
  expect(screen.queryByRole('alert')).toBeNull()
})

test('ein Fehler beim Laden steht da, nimmt aber keinen Fokus', () => {
  render(<Karte />)
  const button = screen.getByRole('button', { name: 'Laden scheitert' })
  button.focus()
  fireEvent.click(button)
  expect(screen.getByRole('alert').textContent).toBe('Der Server lehnt ab.')
  expect(document.activeElement).toBe(button)
})

// Durchsicht, Kann 11 und 12: Ein Link auf ein Feld in einem zugeklappten Bereich klappt ihn auf; zwei gleiche
// Meldungen ohne Feld ergeben keine doppelten Schlüssel; die Sammelmeldung trägt kein aria-labelledby (S6).
function Zugeklappt() {
  const errors = useFormError<'deposit'>()
  return (
    <div className="card">
      <ErrorSummary errors={errors} />
      <details>
        <summary>Weitere Angaben</summary>
        <Field label="Kaution €" optional {...errors.field('deposit')}><input /></Field>
      </details>
      <button type="button" onClick={() => errors.report([{ field: 'deposit', short: 'Kein Betrag', text: 'Kaution: Geben Sie einen Betrag ein.' }, { text: 'Gleich.' }, { text: 'Gleich.' }])}>Speichern</button>
    </div>
  )
}

test('ein Link auf ein Feld in einem zugeklappten Bereich klappt ihn auf; gleiche Meldungen ohne Warnung', () => {
  const warned: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { warned.push(args) }
  try {
    render(<Zugeklappt />)
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    const alert = screen.getByRole('alert')
    expect(alert.parentElement?.hasAttribute('aria-labelledby')).toBe(false)
    const details = document.querySelector('details')
    expect(details?.open).toBe(false)
    fireEvent.click(within(alert).getByRole('link', { name: /Kaution/ }))
    expect(details?.open).toBe(true)
    expect(document.activeElement).toBe(screen.getByLabelText('Kaution € (freiwillig)'))
    expect(within(alert).getAllByText('Gleich.')).toHaveLength(2)
    expect(warned.filter((w) => String(w).includes('same key'))).toEqual([])
  } finally {
    console.error = original
  }
})

function Fenster() {
  const [form, setForm] = useState<{ date: string; amount: string } | null>({ date: '', amount: '' })
  const errors = useFormError<F>()
  if (!form) return null
  return (
    <Drawer open title="Zahlung erfassen" value={form} onClose={() => setForm(null)} errors={errors}
      actions={<button type="button" className="btn" onClick={() => errors.report(check(form))}>Speichern</button>}>
      <Field label="Datum" {...errors.field('date')}>
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      </Field>
      <Field label="Betrag €" {...errors.field('amount')}>
        <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      </Field>
    </Drawer>
  )
}

test('im Seitenfenster steht die Sammelmeldung im festen Fuß über den Knöpfen, begrenzt und scrollbar', () => {
  render(<UIProvider><Fenster /></UIProvider>)
  const save = screen.getByRole('button', { name: 'Speichern' })
  fireEvent.click(save)
  const summary = screen.getByRole('alert').parentElement
  const foot = save.closest('footer')
  expect(foot?.className).toContain('drawer-foot')
  expect(summary?.parentElement).toBe(foot)
  // vor den Knöpfen, über die volle Breite, höchstens 40 % der Fensterhöhe
  expect(foot?.firstElementChild).toBe(summary)
  expect(summary?.className).toContain('basis-full')
  expect(summary?.className).toContain('summary-cap')
  expect(document.activeElement).toBe(summary)
  fireEvent.click(within(screen.getByRole('alert')).getByRole('link', { name: /Datum/ }))
  expect(document.activeElement).toBe(screen.getByLabelText('Datum'))
})
