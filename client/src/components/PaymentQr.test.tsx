// @vitest-environment jsdom
// Der Kasten mit dem Zahlungs-QR-Code (#624): Der gezeichnete Code liest sich byte-gleich zurück, und daneben steht als
// Text, was im Code steht.
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import jsQR from 'jsqr'
import { epcPayload } from '../../../shared/epcQr.ts'
import PaymentQr, { qrMatrix } from './PaymentQr'

afterEach(cleanup)

function decode(payload: string): string {
  const m = qrMatrix(payload)
  const quiet = 4
  const scale = 4
  const side = (m.size + 2 * quiet) * scale
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.get(x, y)) continue
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0
        }
      }
    }
  }
  const found = jsQR(data, side, side)
  if (!found) throw new Error('Code nicht lesbar')
  return new TextDecoder().decode(new Uint8Array(found.binaryData))
}

test('der gezeichnete Code liest sich byte-gleich zurück, auch mit Umlauten und an der Grenze von 331 Byte', () => {
  for (const input of [
    { name: 'Max Vermieter', iban: 'DE02120300000000202051', amountCents: 4000, purpose: 'Erika Müller, EG links, Nebenkostenabrechnung 2025' },
    { name: 'ä'.repeat(70), iban: 'DE02120300000000202051', amountCents: 12345, purpose: 'ü'.repeat(70) },
  ]) {
    const payload = epcPayload(input)
    if (payload === null) throw new Error('kein Inhalt')
    expect(decode(payload)).toBe(payload)
  }
})

test('der Kasten nennt Empfänger, IBAN, Betrag und Verwendungszweck', () => {
  const payload = epcPayload({ name: 'Max Vermieter', iban: 'DE02120300000000202051', amountCents: 4000, purpose: 'Erika, EG' }) ?? ''
  render(<PaymentQr data={{ payload, name: 'Max Vermieter', iban: 'DE02 1203 0000 0000 2020 51', amountCents: 4000, purpose: 'Erika, EG' }} />)
  const img = screen.getByRole('img', { name: /QR-Code für die Überweisung von 40,00/ })
  expect(img.querySelector('path')?.getAttribute('d')).toBeTruthy()
  const box = img.closest('.payment-qr')
  const text = (box?.textContent ?? '').replace(/ /g, ' ')
  expect(text).toContain('Mit Ihrer Banking-App scannen')
  expect(text).toContain('Max Vermieter')
  expect(text).toContain('DE02 1203 0000 0000 2020 51')
  expect(text).toContain('40,00 €')
  expect(text).toContain('Erika, EG')
})

// Rückmeldung zum Satz (#624): Die Angaben neben dem Code standen ohne Beschriftung untereinander, der Code rückte durch
// seine weiße Ruhezone sichtbar ein. Jetzt beschriftet wie der Informationsblock des Briefs, und die Ruhezone ist immer
// ein Zehntel der Kante, damit letter.css sie mit einem festen Maß in den Rand schieben kann (Code bündig mit dem Text).
test('Angaben beschriftet: Empfänger, IBAN, Betrag, Verwendungszweck', () => {
  const payload = epcPayload({ name: 'Max Vermieter', iban: 'DE02120300000000202051', amountCents: 4000, purpose: 'Erika, EG' }) ?? ''
  render(<PaymentQr data={{ payload, name: 'Max Vermieter', iban: 'DE02 1203 0000 0000 2020 51', amountCents: 4000, purpose: 'Erika, EG' }} />)
  const rows = [...document.querySelectorAll('.payment-qr-facts dt')].map((dt) => `${dt.textContent}=${dt.nextElementSibling?.textContent?.replace(/\u00A0/g, ' ')}`)
  expect(rows).toEqual(['Empfänger=Max Vermieter', 'IBAN=DE02 1203 0000 0000 2020 51', 'Betrag=40,00 €', 'Verwendungszweck=Erika, EG'])
  cleanup()
  render(<PaymentQr data={{ payload, name: 'Max Vermieter', iban: 'DE02 1203 0000 0000 2020 51', amountCents: 4000, purpose: '' }} />)
  expect([...document.querySelectorAll('.payment-qr-facts dt')].map((dt) => dt.textContent)).toEqual(['Empfänger', 'IBAN', 'Betrag'])
})

test('die Ruhezone ist ein Zehntel der Kante, mindestens vier Module', () => {
  for (const purpose of ['', 'ü'.repeat(70)]) {
    const payload = epcPayload({ name: 'Max Vermieter', iban: 'DE02120300000000202051', amountCents: 4000, purpose }) ?? ''
    render(<PaymentQr data={{ payload, name: 'Max Vermieter', iban: 'DE02', amountCents: 4000, purpose }} />)
    const [x, , w] = (screen.getByRole('img').getAttribute('viewBox') ?? '').split(' ').map(Number)
    const size = qrMatrix(payload).size
    expect(-x).toBeGreaterThanOrEqual(4)
    expect(-x / w).toBeCloseTo(0.1, 6)
    expect(w).toBeCloseTo(size - 2 * x, 6)
    cleanup()
  }
})
