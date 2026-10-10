import { describe, expect, test } from 'vitest'
import { deviationView } from './deviation'
import { VALUE_CHANGE_LABEL } from '../../shared/law/register.ts'
import type { SettlementComparison } from './types'

const cmp = (over: Partial<SettlementComparison>): SettlementComparison => ({ comparable: true, deviations: [], valueChanges: [], deadline: '2026-12-31', deadlinePassed: false, ...over })

describe('Abweichung eines abgeschlossenen Jahres (#56)', () => {
  test('ohne Abweichung: nichts zu sagen', () => {
    expect(deviationView(cmp({}))).toBeNull()
    expect(deviationView(undefined)).toBeNull()
  })

  test('zugunsten des Mieters: Korrektur möglich, und die Richtung steht dabei', () => {
    const v = deviationView(cmp({ deviations: [{ tenancyId: 't', tenantName: 'Meier', unitName: 'EG', frozenBalanceCents: 6667, currentBalanceCents: 8000, differenceCents: 1333, direction: 'tenant' }] }))
    expect(v?.lines[0]?.text).toMatch(/Meier \(EG\): abgeschlossen Guthaben 66,67\s€, heute Guthaben 80,00\s€ — 13,33\s€ zugunsten des Mieters/)
    expect(v?.lines[0]?.text).toMatch(/Korrektur/)
  })

  test('zugunsten des Vermieters: je nach Frist noch möglich oder in der Regel ausgeschlossen', () => {
    const d = { tenancyId: 't', tenantName: 'Meier', unitName: 'EG', frozenBalanceCents: -1000, currentBalanceCents: -2500, differenceCents: -1500, direction: 'landlord' as const }
    expect(deviationView(cmp({ deviations: [d] }))?.lines[0]?.text).toMatch(/Nachzahlung 10,00\s€, heute Nachzahlung 25,00\s€ — 15,00\s€ zugunsten des Vermieters.*zulasten des Mieters \(Nachforderung oder geringeres Guthaben\).*bis zum 31\.12\.2026/)
    expect(deviationView(cmp({ deviations: [d], deadlinePassed: true }))?.lines[0]?.text).toMatch(/Frist ist abgelaufen.*in der Regel ausgeschlossen/)
  })

  test('ein Mietverhältnis nur auf einer Seite, und ein nicht lesbarer Stand', () => {
    const neu = deviationView(cmp({ deviations: [{ tenancyId: 'n', tenantName: 'Neu', unitName: 'OG', frozenBalanceCents: null, currentBalanceCents: -500, differenceCents: -500, direction: 'added' }] }))
    expect(neu?.lines[0]?.text).toMatch(/Neu \(OG\): kam nach dem Abschluss hinzu, heute Nachzahlung 5,00\s€/)
    expect(neu?.lines[0]?.text).not.toMatch(/zugunsten/)
    expect(deviationView(cmp({ comparable: false }))?.lines).toEqual([])
    expect(deviationView(cmp({ comparable: false }))?.intro).toMatch(/nicht mit der heutigen Berechnung vergleichen/)
    expect(deviationView(cmp({ comparable: false }))?.title).toBe('Vergleich mit der heutigen Berechnung nicht möglich')
    expect(deviationView(cmp({ deviations: [{ tenancyId: 'n', tenantName: 'Neu', unitName: 'OG', frozenBalanceCents: null, currentBalanceCents: -500, differenceCents: -500, direction: 'added' }] }))?.title).toBe('Die heutige Berechnung weicht vom abgeschlossenen Stand ab')
  })

  // Heizung PR 1: ein geänderter Rechtswert, allein oder neben einer Abweichung der Salden
  test('Rechtswert geändert: eigene Zeile, allein mit eigenem Titel', () => {
    const change = { id: 'hkv.cut.not-by-consumption', title: 'Kürzung bei nicht verbrauchsabhängiger Abrechnung', frozenText: '15 %', currentText: '12 %' }
    const allein = deviationView(cmp({ valueChanges: [change] }))
    expect(allein?.title).toBe('Rechtswerte seit dem Abschluss geändert')
    expect(allein?.lines).toEqual([{ id: 'law:hkv.cut.not-by-consumption', text: 'Rechtswert geändert: Kürzung bei nicht verbrauchsabhängiger Abrechnung von 15 % auf 12 %.' }])
    const mit = deviationView(cmp({ valueChanges: [change], deviations: [{ tenancyId: 't', tenantName: 'Meier', unitName: 'EG', frozenBalanceCents: 0, currentBalanceCents: 100, differenceCents: 100, direction: 'tenant' }] }))
    expect(mit?.title).toBe('Die heutige Berechnung weicht vom abgeschlossenen Stand ab')
    expect(mit?.lines.map((l) => l.id)).toEqual(['t', 'law:hkv.cut.not-by-consumption'])
  })

  // Durchsicht von #246, G-K6: Mit einem Wert, der nur der Prüfung dient, wurde nichts gerechnet.
  test('Prüfwert geändert: der Text sagt „geprüft“ und nicht „gerechnet“', () => {
    const change = { id: 'co2.price', title: 'CO₂-Preis je Tonne (Plausibilität)', frozenText: '64,20 €/t', currentText: '65,10 €/t', checkOnly: true as const }
    const v = deviationView(cmp({ valueChanges: [change] }))
    expect(v?.title).toBe('Prüfwerte seit dem Abschluss geändert')
    expect(v?.intro).toMatch(/mit dem diese Abrechnung geprüft wurde/)
    expect(v?.intro).not.toMatch(/gerechnet/)
    expect(v?.lines).toEqual([{ id: 'law:co2.price', text: 'Prüfwert geändert: CO₂-Preis je Tonne (Plausibilität) von 64,20 €/t auf 65,10 €/t.' }])
    // N1 (Runde 2): dieselbe Beschriftung, die der Hinweis `law.value-overridden` nennt.
    expect(v?.lines[0]?.text.startsWith(`${VALUE_CHANGE_LABEL.check}:`)).toBe(true)
  })
})
