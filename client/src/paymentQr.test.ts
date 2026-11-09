// Ob und mit welchen Angaben der Zahlungs-QR-Code erscheint (#624). Die Werte kommen aus dem Anschreiben, abgeschlossen
// also eingefroren; der Inhalt des Codes aus shared/epcQr.ts.
import { describe, expect, test } from 'vitest'
import type { StatementLetter } from './types'
import { DEFAULT_LETTER_TEXTS, buildLetter } from '../../shared/letter.ts'
import { paymentQrOf } from './paymentQr'

const PRINT = { date: '2026-03-15', attachments: 0 }
function letterWith(over: { iban?: string, landlordName?: string } = {}): StatementLetter {
  return buildLetter({
    texts: DEFAULT_LETTER_TEXTS,
    adjustment: { mode: 'none', cents: null },
    suggestedCents: 0,
    from: '2027-01',
    facts: {
      tenantName: 'Erika Mustermann', unitName: 'EG links', propertyName: 'Lindenweg 12', title: 'Nebenkostenabrechnung 2025',
      periodStart: '2025-01-01', periodEnd: '2025-12-31', totalShareCents: 124000, prepaymentCents: 120000, balanceCents: -4000,
      paymentDeadlineDays: 30, iban: over.iban ?? 'DE02120300000000202051', landlordName: over.landlordName ?? 'Max Vermieter',
      prepaymentKind: 'monatliche Nebenkostenvorauszahlung', prepaymentBeforeCents: 10000, basis: '',
    },
  })
}

describe('Zahlungs-QR-Code (#624)', () => {
  test('Code nur bei Nachzahlung und eingeschaltet', () => {
    const l = letterWith()
    const qr = paymentQrOf(l, -4000, PRINT, true)
    expect(qr?.amountCents).toBe(4000)
    expect(qr?.purpose).toBe('Erika Mustermann, EG links, Nebenkostenabrechnung 2025')
    expect(qr?.payload.split('\n')[7]).toBe('EUR40.00')
    expect(paymentQrOf(l, 4000, PRINT, true)).toBeNull()
    expect(paymentQrOf(l, 0, PRINT, true)).toBeNull()
    expect(paymentQrOf(l, -4000, PRINT, false)).toBeNull()
    expect(paymentQrOf(null, -4000, PRINT, true)).toBeNull()
  })

  test('eingefrorenes Anschreiben ohne Verwendungszweck ergibt keinen Code', () => {
    const l = letterWith()
    const { paymentPurpose: _gone, ...older } = l.texts
    // So liegt ein Anschreiben vor, das vor #624 eingefroren wurde: ohne den Baustein.
    const frozen = { ...l, texts: older } as unknown as StatementLetter
    expect(paymentQrOf(frozen, -4000, PRINT, true)).toBeNull()
    // Ein leerer Zweck ist eine Angabe: Code ohne Verwendungszweck.
    const empty = paymentQrOf({ ...l, texts: { ...l.texts, paymentPurpose: '' } }, -4000, PRINT, true)
    expect(empty?.purpose).toBe('')
    expect(empty?.payload.endsWith('EUR40.00')).toBe(true)
  })

  test('Verwendungszweck mit Datum und maskierter Klammer', () => {
    const l = letterWith()
    const qr = paymentQrOf({ ...l, texts: { ...l.texts, paymentPurpose: 'NK {Datum} \uE000x\uE001' } }, -4000, PRINT, true)
    expect(qr?.purpose).toBe('NK 15.03.2026 x')
    expect(qr?.payload.split('\n')[10]).toBe('NK 15.03.2026 x')
  })

  test('IBAN und Empfänger aus dem Anschreiben, also auch die des Objekts', () => {
    const qr = paymentQrOf(letterWith({ iban: 'AT611904300234573201', landlordName: 'Erbengemeinschaft Becker' }), -4000, PRINT, true)
    expect(qr?.iban).toBe('AT61 1904 3002 3457 3201')
    expect(qr?.name).toBe('Erbengemeinschaft Becker')
    expect(qr?.payload).toContain('\nAT611904300234573201\n')
  })

  test('ohne gültige IBAN aus dem EWR oder ohne Empfänger kein Code', () => {
    expect(paymentQrOf(letterWith({ iban: 'CH9300762011623852957' }), -4000, PRINT, true)).toBeNull()
    expect(paymentQrOf(letterWith({ iban: '' }), -4000, PRINT, true)).toBeNull()
    expect(paymentQrOf(letterWith({ landlordName: '' }), -4000, PRINT, true)).toBeNull()
  })
})
