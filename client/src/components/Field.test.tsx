// @vitest-environment jsdom
// Breitenstufen des Felds (#346 Schritt 7b): ohne Angabe die Vorgabe nach Feldart, mit Angabe die Stufe.
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import Field, { widthOf } from './Field'

test('Vorgabe nach Feldart: Datum, Betrag und Zahl kurz, Textfeld voll, Auswahl nach Inhalt, sonst lang', () => {
  expect(widthOf(undefined, <input type="date" />)).toBe('s')
  expect(widthOf(undefined, <input inputMode="decimal" />)).toBe('s')
  expect(widthOf(undefined, <input inputMode="numeric" />)).toBe('s')
  expect(widthOf(undefined, <textarea />)).toBe('full')
  expect(widthOf(undefined, <select />)).toBe('select')
  expect(widthOf(undefined, <input />)).toBe('l')
  expect(widthOf(undefined, () => <input />)).toBe('l')
  expect(widthOf('m', <input type="date" />)).toBe('m')
})

test('die Stufe steht als Klasse an der Hülle, ein Auswahlfeld ohne Stufe bekommt keine', () => {
  render(
    <>
      <Field label="Datum"><input type="date" /></Field>
      <Field label="Adresse" width="l"><input /></Field>
      <Field label="Art"><select><option>Mehrfamilienhaus</option></select></Field>
    </>,
  )
  expect(screen.getByLabelText('Datum').closest('label')?.className).toBe('field width-s')
  expect(screen.getByLabelText('Adresse').closest('label')?.className).toBe('field width-l')
  expect(screen.getByLabelText('Art').closest('label')?.className).toBe('field')
})
