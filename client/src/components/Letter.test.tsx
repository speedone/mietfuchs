// @vitest-environment jsdom
// Der Informationsblock des Briefs: Eine lange E-Mail brach im Druck mitten im Wort um („…wegen|er-musterstadt@…“), weil
// nur nach dem @ eine Umbruchstelle stand und der Rest `overflow-wrap: anywhere` überlassen war. Jetzt stehen
// Umbruchstellen nach dem @ und vor jedem Punkt; `anywhere` bleibt die Notbremse für ein Stück, das allein zu lang ist
// (Druck in Safari, #286: nichts ragt über den rechten Rand). Die Lage im Druck misst scripts/print-width-check.mjs.
import { afterEach, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { breakAfterAt } from './Letter'

afterEach(cleanup)

// Der Text mit „|“ an jeder Umbruchstelle (`<wbr>`)
const breaks = (text: string): string => {
  const { container } = render(<span>{breakAfterAt(text)}</span>)
  for (const wbr of container.querySelectorAll('wbr')) wbr.replaceWith('|')
  return container.textContent ?? ''
}

test('eine E-Mail darf nach dem @ und vor jedem Punkt umbrechen, sonst nirgends', () => {
  expect(breaks('hausverwaltung.klaus.wegener@beispiel-verwaltung.example.org')).toBe('hausverwaltung|.klaus|.wegener@|beispiel-verwaltung|.example|.org')
  expect(breaks('max@example.org')).toBe('max@|example|.org')
})

test('der Text selbst bleibt Zeichen für Zeichen gleich (Kopieren aus der PDF)', () => {
  const mail = 'hausverwaltung.klaus.wegener@beispiel-verwaltung.example.org'
  const { container } = render(<span>{breakAfterAt(mail)}</span>)
  expect(container.textContent).toBe(mail)
})

test('ohne @ bleibt der Wert, wie er ist: Name, Telefon, Ort mit Punkt', () => {
  expect(breaks('Dr. Klaus Wegener')).toBe('Dr. Klaus Wegener')
  expect(breaks('0123 456789')).toBe('0123 456789')
})
