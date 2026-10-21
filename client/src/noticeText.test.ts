// Ein Hinweis in Sätze zerlegt (#346, Schritt 10, M8): verlustfrei, ohne an Abkürzungen, Daten oder
// Fundstellen zu brechen; eingeklappt werden nur Begründungen aus Fundstellen (Durchsicht M1, M2, S1).
// Die Beispiele sind Texte der Berechnung (calc.ts), wie sie die Tests des Servers erzeugen.
import { describe, expect, test } from 'vitest'
import { isAction, isCitationSentence, sentences, splitNoticeText } from './noticeText'
import samplesRaw from './testing/noticeSamples.json?raw'

// Je Code der längste Text aus den Tests des Servers, dazu je Code einer mit eingeklapptem Teil (erzeugt
// mit einem vorübergehenden Mitschnitt in makeNotice, nicht eingecheckt). Neu erzeugen, wenn calc.ts Texte ändert.
const samples = JSON.parse(samplesRaw) as { code: string, text: string }[]

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
  test('Kürzung, Beträge und Aufforderung bleiben sichtbar (Durchsicht M1)', () => {
    const { visible, more } = splitNoticeText(CO2_FUEL_UNKNOWN, 'warning')
    for (const part of ['3 %', '9,00 €', '15,00 €', 'Richten Sie unter Stammdaten']) expect(visible).toContain(part)
    expect(more).toBe('')
  })
  test('eine Begründung aus einem Urteil kommt unter „Mehr dazu“', () => {
    const text = 'Die Rechnung „Gas“ reicht über den Zeitraum hinaus. Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11). Tragen Sie den Leistungszeitraum ein.'
    expect(splitNoticeText(text, 'warning')).toEqual({
      visible: 'Die Rechnung „Gas“ reicht über den Zeitraum hinaus. Tragen Sie den Leistungszeitraum ein.',
      more: 'Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11).',
    })
  })
  test('ein Satz, der auf die Begründung verweist, holt sie zurück (Durchsicht M2)', () => {
    const text = 'Die Rechnung „Gas“ reicht über den Zeitraum hinaus. Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11). Das gilt auch hier.'
    expect(splitNoticeText(text, 'warning').more).toBe('')
  })
  test('ein Fehler steht ganz offen da (#236, Durchsicht S1)', () => {
    const text = 'Die Rechnung „Gas“ reicht über den Zeitraum hinaus. Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11). Tragen Sie den Leistungszeitraum ein.'
    expect(splitNoticeText(text, 'error')).toEqual({ visible: text, more: '' })
  })
  test('nur Fundstellen allein werden nicht eingeklappt', () => {
    expect(splitNoticeText('Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11).', 'hint').more).toBe('')
  })
})

// Über echte Texte je Code: Was eingeklappt ist, ist eine Fundstelle; jede Prozentzahl, jeder Betrag, jedes
// Datum und jede Aufforderung bleibt sichtbar, und kein sichtbarer Satz verweist auf einen eingeklappten.
describe('Hinweistexte der Berechnung', () => {
  const PERCENT = /\d+(?:,\d+)?\s*%/
  const DATE = /\b\d{1,2}\.\d{1,2}\.\d{4}\b|\b\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/
  const CITATION = /§|Art\.|\b(?:BGH|BFH|BVerfG|OLG|LG|AG)\b|\b(?:BT|BR)-Drs\.|\bRn\.|\b[IVX]+ [A-Z]{1,3} \d+\/\d+/
  const POINTS_BACK = /^(?:[A-ZÄÖÜ][a-zäöüß]+ Sie (?:sie|ihn|es|das|dies\w*|diese\w*|dort|dann)\b|(?:Das|Dies\w*|Dort|Dann|Dafür|Damit|Deshalb|Daher)\b)|bis dahin/
  test('die Stichprobe deckt die Codes ab', () => {
    expect(new Set(samples.map((s) => s.code)).size).toBeGreaterThan(150)
  })
  for (const { code, text } of samples) {
    test(code, () => {
      for (const level of ['warning', 'hint'] as const) {
        const { visible, more } = splitNoticeText(text, level)
        const all = sentences(text).map((s) => s.trim())
        const hidden = sentences(more).map((s) => s.trim()).filter(Boolean)
        const shown = sentences(visible).map((s) => s.trim())
        // Verlustfrei, in der Reihenfolge des Texts
        expect([...shown, ...hidden].sort()).toEqual([...all].sort())
        for (const s of hidden) {
          expect(s, `${code}: ${s}`).toMatch(CITATION)
          expect(isCitationSentence(s)).toBe(true)
          expect(s).not.toMatch(PERCENT)
          expect(s).not.toContain('€')
          expect(s).not.toMatch(DATE)
          expect(s).not.toMatch(/kürz|Kürz/)
          expect(isAction(s)).toBe(false)
        }
        if (hidden.length > 0) expect(shown.join('')).not.toBe('')
        all.forEach((s, i) => {
          if (i > 0 && !hidden.includes(s) && POINTS_BACK.test(s)) expect(hidden, `${code}: ${s}`).not.toContain(all[i - 1])
        })
      }
      expect(splitNoticeText(text, 'error').more).toBe('')
    })
  }
  test('mindestens ein Text klappt eine Begründung ein', () => {
    expect(samples.some(({ text }) => splitNoticeText(text, 'warning').more !== '')).toBe(true)
  })
})


// #346 Schritt 12 (aus den Durchsichten): Ein Rückverweis mitten im Satz („rechnet deshalb …“) braucht den Satz davor
// genauso wie einer am Anfang; sonst stünde „deshalb“ ohne Grund da, während der Grund unter „Mehr dazu“ liegt.
test('ein Rückverweis im Satzinneren holt die eingeklappte Begründung davor hervor', () => {
  const ground = 'Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11).'
  const inner = splitNoticeText(`Die Rechnung reicht über zwei Heizperioden. ${ground} Mietfuchs teilt sie deshalb nach Gradtagen auf.`, 'warning')
  expect(inner.more).toBe('')
  expect(inner.visible).toContain('BGH VIII ZR 156/11')
  // Ohne Rückverweis bleibt die Begründung eingeklappt
  const plain = splitNoticeText(`Die Rechnung reicht über zwei Heizperioden. ${ground} Mietfuchs teilt sie nach Gradtagen auf.`, 'warning')
  expect(plain.more).toBe(ground)
})

// Durchsicht: Am Satzanfang greift REFERS_BACK; dort fehlten Darum, Dadurch, Demnach, Folglich, Insofern und Insoweit.
test('dieselben Rückverweise am Satzanfang holen die Begründung ebenso hervor', () => {
  const ground = 'Heizkosten gehören in die Heizperiode, in der sie verbraucht wurden (BGH VIII ZR 156/11).'
  for (const word of ['Darum', 'Dadurch', 'Demnach', 'Folglich', 'Insofern', 'Insoweit']) {
    expect(splitNoticeText(`Die Rechnung reicht über zwei Heizperioden. ${ground} ${word} teilt Mietfuchs sie auf.`, 'warning').more, word).toBe('')
  }
})
