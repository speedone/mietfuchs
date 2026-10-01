import { describe, expect, test } from 'vitest'
import { legalBasisLines, noticeClass, noticesNeedAttention, noticesOf, noticeTarget, NOTICE_LEVEL_LABELS } from './notices'
import type { Notice, NoticeSubject } from './types'

const n = (over: Partial<Notice>): Notice => ({ code: 'x', level: 'warning', title: 'Titel', text: 'Text', ...over })

describe('Hinweise (#112)', () => {
  test('mit notices: Fehler zuerst, sonst in der Reihenfolge der Berechnung', () => {
    const list = noticesOf({ warnings: ['a', 'b', 'c'], notices: [n({ text: 'a', level: 'hint' }), n({ text: 'b' }), n({ text: 'c', level: 'error' })] })
    expect(list.map((x) => x.text)).toEqual(['c', 'b', 'a'])
  })

  test('ohne notices (vor #112 abgeschlossen): die warnings als Warnungen ohne Titel', () => {
    expect(noticesOf({ warnings: ['alt'] })).toEqual([{ code: 'legacy', level: 'warning', title: '', text: 'alt' }])
  })

  test('der Knopf führt zur Seite, auf der man es behebt', () => {
    expect(noticeTarget({ kind: 'costItem', id: 'k' })).toEqual({ tab: 'kosten', label: 'Hier beheben → Kosten', focus: { kind: 'costItem', id: 'k' } })
    expect(noticeTarget({ kind: 'unit', id: 'u' })?.tab).toBe('stammdaten')
    expect(noticeTarget({ kind: 'tenancy', id: 't' })?.tab).toBe('stammdaten')
    expect(noticeTarget({ kind: 'meter', id: 'm' })?.tab).toBe('zaehler')
    expect(noticeTarget(undefined)).toBeNull()
  })

  test('„Hier beheben →“ nimmt den Eintrag mit, nicht nur die Seite (#142)', () => {
    expect(noticeTarget({ kind: 'tenancy', id: 't7' })?.focus).toEqual({ kind: 'tenancy', id: 't7' })
    expect(noticeTarget({ kind: 'meter', id: 'm3' })?.focus).toEqual({ kind: 'meter', id: 'm3' })
  })

  test('ein Rückstand führt ins Mietkonto (#133)', () => {
    expect(noticeTarget({ kind: 'rentLedger', id: 't' })).toEqual({ tab: 'mietkonto', label: 'Hier beheben → Mietkonto', focus: { kind: 'rentLedger', id: 't' } })
  })

  test('eine unbekannte Art aus einer eingefrorenen oder neueren Abrechnung ergibt keinen Knopf statt eines Absturzes', () => {
    const fremd: NoticeSubject = JSON.parse('{ "kind": "gibtEsNicht", "id": "x" }')
    expect(noticeTarget(fremd)).toBeNull()
  })

  test('Stufen haben ein Wort und eine Farbe', () => {
    expect(NOTICE_LEVEL_LABELS).toEqual({ error: 'Fehler', warning: 'Warnung', hint: 'Hinweis', info: 'Info' })
    expect(noticeClass('error')).toBe('error')
    expect(noticeClass('warning')).toBe('notice')
    expect(noticeClass('hint')).toBe('hint')
    expect(noticeClass('info')).toBe('hint')
  })

  test('Rechtsstand: Datum und Regeln mit Gültigkeit, und ein Satz, wenn er fehlt', () => {
    expect(legalBasisLines({ asOf: '2026-09-30', rules: [
      { code: 'tv-signal', title: 'Kabelfernsehen', norm: '§ 2 BetrKV', validTo: '2024-06-30' },
      { code: 'h', title: 'Heizung', norm: '§ 2 HeizkostenV' },
    ] })).toEqual({
      head: 'Rechtsstand 30.09.2026',
      rules: ['Kabelfernsehen (§ 2 BetrKV), gilt bis 30.06.2024', 'Heizung (§ 2 HeizkostenV)'],
    })
    expect(legalBasisLines(undefined).head).toMatch(/nicht erfasst/)
    expect(legalBasisLines(undefined).rules).toEqual([])
  })
})

// #135: 0 m² und 0 Personen sind Angaben (Garage, Stellplatz); ihr Hinweis soll die Cockpit-Ampel
// nicht gelb färben. Gelb heißt: Es gibt einen Fehler oder eine Warnung.
describe('Cockpit: verlangen die Hinweise etwas?', () => {
  test('ein Hinweis zur Gemeinschaftsabrechnung allein: ja, er ist ein offener Punkt', () => {
    expect(noticesNeedAttention({ warnings: ['a'], notices: [n({ code: 'external.amount-mismatch', level: 'hint' })] })).toBe(true)
  })
  test('nur die beiden Hinweise auf eine bewusst eingetragene 0: nein', () => {
    expect(noticesNeedAttention({ warnings: ['a', 'b'], notices: [
      n({ code: 'basis.unit-zero', level: 'hint' }), n({ code: 'basis.tenancy-zero', level: 'hint' }),
    ] })).toBe(false)
  })
  test('eine vergessene Wohnfläche (bewohnte Wohnung mit 0 m²): ja', () => {
    expect(noticesNeedAttention({ warnings: ['a'], notices: [n({ code: 'basis.unit-no-area', level: 'warning' })] })).toBe(true)
    expect(noticesNeedAttention({ warnings: ['a'], notices: [n({ code: 'basis.tenancy-no-persons', level: 'warning' })] })).toBe(true)
  })
  test('die 0 neben einem anderen Hinweis: ja', () => {
    expect(noticesNeedAttention({ warnings: ['a', 'b'], notices: [n({ code: 'basis.unit-zero', level: 'hint' }), n({ code: 'meter.main-gap', level: 'hint' })] })).toBe(true)
  })
  test('vor #112 abgeschlossen: die Texte gelten als Warnungen', () => {
    expect(noticesNeedAttention({ warnings: ['alt'] })).toBe(true)
    expect(noticesNeedAttention({ warnings: [] })).toBe(false)
  })
})
