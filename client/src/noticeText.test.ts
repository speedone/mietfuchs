// Ein Hinweis in Sätze zerlegt (#346, Schritt 10, M8): verlustfrei, ohne an Abkürzungen, Daten oder
// Fundstellen zu brechen, und mit dem Satz „was tun“ vorn. Die Beispiele sind Texte der Berechnung
// (calc.ts), wie sie die Tests des Servers erzeugen.
import { describe, expect, test } from 'vitest'
import { isAction, sentences, splitNoticeText } from './noticeText'

const CO2_FUEL_UNKNOWN = 'Mietfuchs weiß nicht, womit das Haus geheizt wird. Heizen Sie mit Gas, Heizöl, Flüssiggas oder Kohle oder weist Ihr Wärmelieferant CO₂-Kosten aus, sind die CO₂-Kosten zwischen Ihnen und den Mietern aufzuteilen (§ 5 CO2KostAufG), und die Heizkostenabrechnung muss den Anteil der Mieter, die Einstufung des Gebäudes und die Berechnungsgrundlagen ausweisen (§ 7 Abs. 3 CO2KostAufG). Fehlt das, darf jeder Mieter seinen Anteil an den Heizkosten um 3 % kürzen (§ 7 Abs. 4 CO2KostAufG), hier: Xaver (Wohnung A) 9,00 € und Zora (Wohnung B) 15,00 €. Richten Sie unter Stammdaten die Heizung ein; dann sagt Mietfuchs, was zu tun ist. Bezieht der Mieter Brennstoff oder Wärme über einen eigenen Vertrag, stellen Sie sein Mietverhältnis unter Heizung auf „Mieter heizt selbst“; dann entfällt die Kürzung.'

describe('sentences', () => {
  test('setzt den Text verlustfrei wieder zusammen', () => {
    expect(sentences(CO2_FUEL_UNKNOWN).join('')).toBe(CO2_FUEL_UNKNOWN)
    expect(sentences(CO2_FUEL_UNKNOWN)).toHaveLength(5)
  })
  test('bricht nicht an Abkürzungen, Fundstellen und Daten', () => {
    for (const text of [
      'Nach § 7 Abs. 4 CO2KostAufG gilt das ab dem 01.01.2023 auch hier.',
      'Siehe BR-Drs. 643/21, S. 19 und BT-Drs. 21/7009, S. 154 dazu.',
      'Es gilt z. B. bei Gas, d. h. nicht bei Holz, nach § 11 Abs. 1 Nr. 3 Buchst. a a. F. HeizkostenV.',
      'Seit dem 6. April gilt vgl. Rn. 14 f. weiter.',
      'Der Wert ist bzw. bleibt ggf. gleich.',
    ]) expect(sentences(text), text).toHaveLength(1)
  })
  test('bricht nach einem Datum, einer Zahl oder einem einzelnen Buchstaben am Satzende', () => {
    expect(sentences('Die Frist endete am 31.12.2024. Danach gilt nichts.')).toHaveLength(2)
    expect(sentences('Das steht in § 7 Abs. 1 Satz 2. Nach ihm gilt es.')).toHaveLength(2)
    expect(sentences('Geschätzt bei A. Wird es gemessen, ändert es sich.')).toHaveLength(2)
    expect(sentences('Grundlage: Schätzung e. Ob sie stimmt, prüfen Sie.')).toHaveLength(2)
  })
})

describe('isAction', () => {
  test('erkennt die Aufforderung', () => {
    expect(isAction('Tragen Sie die Netzentgelte laut Gasrechnung bei der Lieferung ein.')).toBe(true)
    expect(isAction('Bitte prüfen Sie die Angaben.')).toBe(true)
    expect(isAction('Wollen Sie ihn nicht umlegen, ziehen Sie ihn trotzdem beim Allgemeinstrom ab.')).toBe(true)
  })
  test('ein Bedingungssatz mit derselben Stellung ist keine Aufforderung', () => {
    expect(isAction('Heizen Sie mit Gas, Heizöl, Flüssiggas oder Kohle, sind die CO₂-Kosten aufzuteilen.')).toBe(false)
    expect(isAction('Haben Sie beim Allgemeinstrom schon den geminderten Betrag eingetragen, ist die Abrechnung nicht unwirksam.')).toBe(false)
    expect(isAction('Tragen Sie den Strom eines eigenen Zählers selbst, ist nichts falsch.')).toBe(false)
    expect(isAction('Mietfuchs weiß nicht, womit das Haus geheizt wird.')).toBe(false)
  })
})

describe('splitNoticeText', () => {
  test('zeigt die Aufforderung und lässt alles andere in der Reihenfolge des Texts', () => {
    const { action, more } = splitNoticeText(CO2_FUEL_UNKNOWN)
    expect(action).toBe('Richten Sie unter Stammdaten die Heizung ein; dann sagt Mietfuchs, was zu tun ist.')
    expect(more.startsWith('Mietfuchs weiß nicht')).toBe(true)
    expect(more).not.toContain('Richten Sie')
    // Kein Wort geht verloren: Satz und Rest ergeben zusammen dieselben Sätze.
    expect([...sentences(more), action].map((s) => s.trim()).sort()).toEqual(sentences(CO2_FUEL_UNKNOWN).map((s) => s.trim()).sort())
  })
  test('ohne Aufforderung den ersten Satz', () => {
    expect(splitNoticeText('Die Position wird nicht verteilt. Der Betrag geht an den Vermieter.')).toEqual({
      context: '', action: 'Die Position wird nicht verteilt.', more: 'Der Betrag geht an den Vermieter.',
    })
  })
  test('ein Satz hat keinen Rest', () => {
    expect(splitNoticeText('„Wasser“: kein Verbrauch erfasst — Betrag geht an den Vermieter.')).toEqual({
      context: '', action: '„Wasser“: kein Verbrauch erfasst — Betrag geht an den Vermieter.', more: '',
    })
  })
  test('die Ortsangabe des ersten Satzes steht vor einer späteren Aufforderung', () => {
    const text = 'Heizanlage „Gas“, Heizperiode 2025: Für Mieter ta fehlt der Betrag. Tragen Sie ihn auf der Seite Heizkosten ein.'
    expect(splitNoticeText(text)).toEqual({
      context: 'Heizanlage „Gas“, Heizperiode 2025',
      action: 'Tragen Sie ihn auf der Seite Heizkosten ein.',
      more: 'Heizanlage „Gas“, Heizperiode 2025: Für Mieter ta fehlt der Betrag.',
    })
  })
})
