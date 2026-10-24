// Das Anschreiben zur Abrechnung (#415): Bausteine, Platzhalter, Vorgabetexte und das Einsetzen der
// Werte. Eine Stelle für Server und Oberfläche: Der Server setzt die Werte ein und friert das Ergebnis
// mit dem Abschluss ein, die Oberfläche zeigt beim Bearbeiten dieselbe Vorschau, und beide prüfen
// mit derselben Funktion, ob ein Text nur bekannte Platzhalter enthält.
//
// Die Vorlagen sind bewusst ohne Logik: Ein Baustein ist Text mit Platzhaltern wie `{Betrag}`, mehr
// nicht. Welcher Baustein erscheint (Guthaben oder Nachzahlung, Anpassung oder keine), entscheidet
// Mietfuchs in `chooseLetterBlocks`. Beträge und Daten formatiert Mietfuchs.
import type { LetterAdjustment, LetterAdjustmentMode, LetterBlock, LetterField, LetterTexts, Property, Settings, Settlement, StatementLetter, Tenancy, TenancyLetter } from './types.ts'
import { euro } from './costItem.ts'
import { formatIban } from './iban.ts'
import { effectiveLandlord, footerLine, recipientLines, returnLine } from './landlord.ts'
import { rateAtMonth } from './monthRate.ts'
import { addMonths, monthName } from './monthlyInfo.ts'

export type LetterBlockInfo = { id: LetterBlock; label: string; when: string; multiline: boolean }

// In der Reihenfolge, in der sie im Brief stehen.
export const LETTER_BLOCKS: readonly LetterBlockInfo[] = [
  { id: 'subject', label: 'Betreff', when: 'immer, fett über der Anrede', multiline: false },
  { id: 'salutation', label: 'Anrede', when: 'immer', multiline: false },
  { id: 'intro', label: 'Einleitung', when: 'immer', multiline: true },
  { id: 'credit', label: 'Guthaben', when: 'nur bei einem Guthaben', multiline: true },
  { id: 'backPayment', label: 'Nachzahlung', when: 'nur bei einer Nachzahlung', multiline: true },
  { id: 'balanced', label: 'Ausgeglichen', when: 'nur, wenn weder Nachzahlung noch Guthaben entsteht', multiline: true },
  { id: 'adjustSuggestion', label: 'Anpassung der Vorauszahlung (Vorschlag)', when: 'nur, wenn der Vorschlag von Mietfuchs angekündigt wird', multiline: true },
  { id: 'adjustCustom', label: 'Anpassung der Vorauszahlung (eigener Betrag)', when: 'nur, wenn ein eigener Betrag angekündigt wird', multiline: true },
  { id: 'receipts', label: 'Belegeinsicht', when: 'wenn keine Belegkopien mitgedruckt werden', multiline: true },
  { id: 'attachments', label: 'Belege beigefügt', when: 'wenn Belegkopien mitgedruckt werden', multiline: true },
  { id: 'closing', label: 'Schluss', when: 'immer', multiline: true },
  { id: 'greeting', label: 'Gruß', when: 'immer', multiline: false },
  { id: 'signature', label: 'Unterschrift', when: 'immer, unter dem Gruß', multiline: true },
]
export const LETTER_BLOCK_IDS: readonly LetterBlock[] = LETTER_BLOCKS.map((b) => b.id)
export const isLetterBlock = (x: unknown): x is LetterBlock => typeof x === 'string' && (LETTER_BLOCK_IDS as readonly string[]).includes(x)
export const blockLabel = (b: LetterBlock): string => LETTER_BLOCKS.find((x) => x.id === b)?.label ?? b

export type LetterFieldInfo = { id: LetterField; label: string; example: string; only?: readonly LetterBlock[] }

// Die feste Liste der Platzhalter. `only`: nur in diesen Bausteinen (der neue Betrag gibt es nur, wo
// eine Anpassung angekündigt wird). `example` füllt die Vorschau der Vorlage ohne einen Mieter.
export const LETTER_FIELDS: readonly LetterFieldInfo[] = [
  { id: 'Name', label: 'Name des Mieters', example: 'Erika Mustermann' },
  { id: 'Wohnung', label: 'Wohnung', example: 'EG links' },
  { id: 'Objekt', label: 'Objekt', example: 'Lindenweg 12' },
  { id: 'Abrechnung', label: 'Bezeichnung der Abrechnung', example: 'Nebenkostenabrechnung 2025' },
  { id: 'Zeitraum', label: 'Zeitraum des Mieters', example: '01.01.2025 – 31.12.2025' },
  { id: 'Kosten', label: 'Ihre Kosten', example: '1.240,00 €' },
  { id: 'Vorauszahlungen', label: 'Ihre Vorauszahlungen', example: '1.200,00 €' },
  { id: 'Betrag', label: 'Betrag der Nachzahlung oder des Guthabens', example: '40,00 €' },
  { id: 'Zahlungsfrist', label: 'Zahlungsfrist in Tagen', example: '30' },
  { id: 'IBAN', label: 'IBAN des Vermieters', example: 'DE02 1203 0000 0000 2020 51' },
  { id: 'Konto', label: '„auf das Konto …“ samt Kontoinhaber, leer ohne IBAN', example: 'auf das Konto DE02 1203 0000 0000 2020 51 (Max Vermieter)' },
  { id: 'Vermieter', label: 'Name des Vermieters', example: 'Max Vermieter' },
  // Teil 2: die Anrede beim Mietverhältnis, ohne Angabe „Guten Tag {Name},“.
  { id: 'Anrede', label: 'Anrede beim Mietverhältnis, sonst „Guten Tag {Name},“', example: 'Guten Tag Erika Mustermann,' },
  { id: 'Vorauszahlungsart', label: 'Art der Vorauszahlung', example: 'monatliche Nebenkostenvorauszahlung', only: ['adjustSuggestion', 'adjustCustom'] },
  { id: 'VorauszahlungBisher', label: 'monatliche Vorauszahlung bisher', example: '100,00 €' },
  { id: 'VorauszahlungNeu', label: 'monatliche Vorauszahlung neu', example: '105,00 €', only: ['adjustSuggestion', 'adjustCustom'] },
  // #317: der Monat, ab dem die neue Vorauszahlung gilt („Januar 2027“).
  { id: 'AnpassungAb', label: 'Monat, ab dem die neue Vorauszahlung gilt', example: 'Januar 2027', only: ['adjustSuggestion', 'adjustCustom'] },
  { id: 'Grundlage', label: 'Wie der Vorschlag entsteht', example: 'ein Zwölftel Ihrer Jahreskosten, gerundet', only: ['adjustSuggestion'] },
  { id: 'AnzahlBelege', label: 'Zahl der beigefügten Belege', example: '3 Belege', only: ['attachments'] },
  { id: 'Datum', label: 'Datum des Briefs', example: '15.03.2026' },
]
export const LETTER_FIELD_IDS: readonly LetterField[] = LETTER_FIELDS.map((f) => f.id)
const isField = (x: string): x is LetterField => (LETTER_FIELD_IDS as readonly string[]).includes(x)
// Diese beiden setzt erst der Druck ein: das Datum des Briefs (Versanddatum, sonst der Tag des Drucks)
// und die Zahl der mitgedruckten Belege. Im eingefrorenen Text bleiben sie Platzhalter.
export const RENDER_FIELDS: readonly LetterField[] = ['Datum', 'AnzahlBelege']
export const fieldsFor = (b: LetterBlock): LetterFieldInfo[] => LETTER_FIELDS.filter((f) => !f.only || f.only.includes(b))
export const SAMPLE_LETTER_VALUES = Object.fromEntries(LETTER_FIELDS.map((f) => [f.id, f.example])) as Record<LetterField, string>

// Die Vorgaben von Mietfuchs, gesiezt. Wo es den Satz schon vor #415 unter der Aufstellung gab, ist
// er wortgleich übernommen (Zahlung, Frist und Konto, Erstattung, § 560 Abs. 4 BGB, Belegeinsicht);
// eine vorher abgeschlossene Abrechnung druckt sich so wie bisher (letter.test.ts). Seit #317 nennt die Anpassung
// statt „ab dem übernächsten Monat“ den Monat; eingefrorene Anschreiben behalten ihren Text.
export const DEFAULT_LETTER_TEXTS: Record<LetterBlock, string> = {
  subject: '{Abrechnung}, Wohnung {Wohnung}',
  // Seit Teil 2 über {Anrede}: ohne Anrede beim Mietverhältnis ergibt das wie vorher „Guten Tag {Name},“.
  salutation: '{Anrede}',
  intro: 'mit diesem Schreiben erhalten Sie die Abrechnung für den Zeitraum {Zeitraum}. Die Aufstellung auf den folgenden Seiten zeigt die Kosten, wie sie verteilt sind, und Ihren Anteil.',
  credit: 'Es ergibt sich ein Guthaben von {Betrag}. Der Betrag wird Ihnen erstattet bzw. mit der nächsten Mietzahlung verrechnet.',
  backPayment: 'Es ergibt sich eine Nachzahlung von {Betrag}. Bitte überweisen Sie den Betrag innerhalb von {Zahlungsfrist} Tagen nach Zugang dieser Abrechnung {Konto}.',
  balanced: 'Ihre Vorauszahlungen decken Ihre Kosten genau; es ergibt sich weder eine Nachzahlung noch ein Guthaben.',
  adjustSuggestion: 'Auf Basis dieser Abrechnung wird die {Vorauszahlungsart} gemäß § 560 Abs. 4 BGB ab {AnpassungAb} auf {VorauszahlungNeu} angepasst ({Grundlage}).',
  adjustCustom: 'Auf Basis dieser Abrechnung wird die {Vorauszahlungsart} gemäß § 560 Abs. 4 BGB ab {AnpassungAb} auf {VorauszahlungNeu} angepasst.',
  receipts: 'Die zugrunde liegenden Belege können nach Terminvereinbarung eingesehen werden.',
  attachments: 'Kopien der zugrunde liegenden Belege sind als Anlage beigefügt ({AnzahlBelege}).',
  closing: 'Für Rückfragen stehe ich Ihnen gern zur Verfügung.',
  greeting: 'Mit freundlichen Grüßen',
  signature: '{Vermieter}',
}

export const LETTER_TEXT_MAX = 2000

// Was an einem Text nicht stimmt, als ganze Sätze: unbekannte Platzhalter, Platzhalter, die es in
// diesem Baustein nicht gibt, und einzelne geschweifte Klammern. Ein unbekannter Platzhalter wird nie
// still leer gedruckt; er ist eine Meldung am Feld und beim Speichern eine 400.
export function templateProblems(block: LetterBlock, text: string): string[] {
  const out: string[] = []
  if (text.length > LETTER_TEXT_MAX) out.push(`Der Text ist zu lang (höchstens ${LETTER_TEXT_MAX.toLocaleString('de-DE')} Zeichen).`)
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const name = m[1] ?? ''
    if (!isField(name)) {
      out.push(`Den Platzhalter {${name}} gibt es nicht. Wählen Sie einen aus der Liste unter dem Feld.`)
      continue
    }
    const info = LETTER_FIELDS.find((f) => f.id === name)
    if (info?.only && !info.only.includes(block)) out.push(`Den Platzhalter {${name}} gibt es im Baustein „${blockLabel(block)}“ nicht.`)
  }
  const rest = text.replace(/\{[^{}]*\}/g, '')
  if (/[{}]/.test(rest)) out.push('Geschweifte Klammern stehen nur um einen Platzhalter, etwa {Betrag}.')
  return [...new Set(out)]
}

// Setzt die Werte ein. Platzhalter ohne Wert in `values` bleiben stehen (so bleiben `{Datum}` und
// `{AnzahlBelege}` für den Druck). Ein leerer Wert nimmt das Leerzeichen davor mit: „nach Zugang
// dieser Abrechnung {Konto}.“ ergibt ohne IBAN „nach Zugang dieser Abrechnung.“, wie bisher.
//
// Geschweifte Klammern in einem Wert (ein Name wie „Max {Datum}“) werden maskiert, damit sie im zweiten
// Durchgang beim Druck nie als Platzhalter gelesen werden (Durchsicht K2); `unmaskLetterText` stellt sie
// für die Anzeige wieder her.
const MASK_OPEN = '\uE000'
const MASK_CLOSE = '\uE001'
const mask = (v: string): string => v.replace(/\{/g, MASK_OPEN).replace(/\}/g, MASK_CLOSE)
export const unmaskLetterText = (t: string): string => t.replace(/\uE000/g, '{').replace(/\uE001/g, '}')
export function resolveTemplate(text: string, values: Partial<Record<LetterField, string>>): string {
  return text
    .replace(/( ?)\{([^{}]*)\}/g, (whole, space: string, name: string) => {
      if (!isField(name)) return whole
      const value = values[name]
      if (value === undefined) return whole
      return value === '' ? '' : `${space}${mask(value)}`
    })
    .trim()
}

// Die Ebenen übereinander: Vorgaben von Mietfuchs, Installation, Objekt, Mieter. Je Baustein gilt die
// oberste Ebene, die ihn führt; ein leerer Text gilt (bewusst weggelassen).
export function mergeLetterTexts(...layers: (LetterTexts | null | undefined)[]): Record<LetterBlock, string> {
  const out = { ...DEFAULT_LETTER_TEXTS }
  for (const layer of layers) {
    if (!layer) continue
    for (const b of LETTER_BLOCK_IDS) {
      const t = layer[b]
      if (typeof t === 'string') out[b] = t
    }
  }
  return out
}

const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

// „Betriebskosten 2026, darin Heiz- und Warmwasserkosten 01.05.2025–30.04.2026“ (Heizung PR 5, 3.1).
// Steht hier, weil Druckkopf und Betreff des Anschreibens dieselbe Bezeichnung tragen.
export function settlementTitle(s: Pick<Settlement, 'period' | 'heatingPeriods' | 'scope'>): string {
  if (s.scope?.kind === 'heating') return `Heizkostenabrechnung ${s.period.label}`
  const other = (s.heatingPeriods ?? []).filter((h) => !(h.period.from === s.period.from && h.period.to === s.period.to))
  if (other.length === 0) return `Nebenkostenabrechnung ${s.period.label}`
  return `Betriebskosten ${s.period.label}, darin Heiz- und Warmwasserkosten ${other.map((h) => `${fmtDate(h.period.from)}–${fmtDate(h.period.to)}`).join(' und ')}`
}

// Welche Vorauszahlung angepasst wird (Heizung PR 5): in der Heizkostenabrechnung die Heizvorauszahlung,
// bei getrennt abgerechneter Heizung die übrigen Nebenkosten.
export const adjustedPrepaymentLabel = (st: { scope?: 'all' | 'heating' }, separate: boolean): string =>
  st.scope === 'heating' ? 'monatliche Heizkostenvorauszahlung' : separate ? 'monatliche Vorauszahlung für die übrigen Nebenkosten (ohne Heizung)' : 'monatliche Nebenkostenvorauszahlung'

// Wie der Vorschlag für die neue Vorauszahlung (§ 560 Abs. 4 BGB) entsteht (#134). Bei Einzug im
// Jahr ist der Anteil zuerst auf ein volles Jahr hochgerechnet; der Satz sagt das, sonst ergäbe ein
// Zwölftel der angezeigten Kosten nicht den angezeigten Betrag (zweite Browserabnahme).
export function suggestionBasis(st: { days: number }, daysInYear: number): string {
  return st.days < daysInYear
    ? `Ihr Anteil für ${st.days} Tage, auf ein volles Jahr hochgerechnet, davon ein Zwölftel, gerundet`
    : 'ein Zwölftel Ihrer Jahreskosten, gerundet'
}

// Was das Anschreiben eines Mieters an Werten braucht. Gerechnet wird hier nichts: Die Zahlen kommen
// aus der Abrechnung, Vermieter und IBAN aus Objekt bzw. Einstellungen.
export type LetterFacts = {
  tenantName: string
  unitName: string
  propertyName: string
  title: string
  periodStart: string
  periodEnd: string
  totalShareCents: number
  prepaymentCents: number
  balanceCents: number
  paymentDeadlineDays: number
  iban: string
  landlordName: string
  prepaymentKind: string
  prepaymentBeforeCents: number | null
  basis: string
  // Die Anrede beim Mietverhältnis (Teil 2); leer heißt „Guten Tag {Name},“.
  salutation?: string
}

// Die Anrede im Brief (Teil 2): die beim Mietverhältnis eingetragene, sonst wie bisher „Guten Tag {Name},“.
// Ohne Satzzeichen am Ende kommt ein Komma dazu; „Sehr geehrte Frau Becker“ wird so zu einer Briefanrede.
export function salutationOf(tenantName: string, own: string | null | undefined): string {
  const text = (own ?? '').trim()
  if (text === '') return `Guten Tag ${tenantName},`
  return /[,.!?:;]$/.test(text) ? text : `${text},`
}

export function letterValues(f: LetterFacts, newCents: number | null, from: string | null = null): Omit<Record<LetterField, string>, 'Datum' | 'AnzahlBelege'> {
  const iban = f.iban.trim() === '' ? '' : formatIban(f.iban)
  const landlord = f.landlordName.trim()
  return {
    Name: f.tenantName,
    Wohnung: f.unitName,
    Objekt: f.propertyName,
    Abrechnung: f.title,
    Zeitraum: `${fmtDate(f.periodStart)} – ${fmtDate(f.periodEnd)}`,
    Kosten: euro(f.totalShareCents),
    Vorauszahlungen: euro(f.prepaymentCents),
    Betrag: euro(Math.abs(f.balanceCents)),
    // Wie vorher unter der Aufstellung: ohne Angabe 30 Tage.
    Zahlungsfrist: String(f.paymentDeadlineDays || 30),
    IBAN: iban,
    Konto: iban === '' ? '' : `auf das Konto ${iban}${landlord ? ` (${landlord})` : ''}`,
    Vermieter: landlord,
    Anrede: salutationOf(f.tenantName, f.salutation),
    Vorauszahlungsart: f.prepaymentKind,
    VorauszahlungBisher: f.prepaymentBeforeCents === null ? '' : euro(f.prepaymentBeforeCents),
    VorauszahlungNeu: newCents === null ? '' : euro(newCents),
    Grundlage: f.basis,
    AnpassungAb: from === null ? '' : monthName(from),
  }
}

// #317: Ab wann die neue Vorauszahlung gilt, wenn der Mieter nichts anderes festlegt: der übernächste Monat nach dem Tag
// des Briefs. § 560 Abs. 4 BGB nennt keine Frist; das ist eine vorsichtige Vorgabe von Mietfuchs (wie die Frist des
// Abs. 2), früher geht nach AG Mannheim, Urteil vom 06.02.2008, 8 C 552/06, Rn. 29 („zum nächsten Fälligkeitstermin“).
export const defaultAdjustFrom = (asOf: string): string => addMonths(asOf.slice(0, 7), 2)
export const isMonthKey = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x)

// Der neue Betrag zur gewählten Anpassung: beim Vorschlag der von Mietfuchs (nur über 0 €, wie bisher),
// beim eigenen Betrag dieser. `null` heißt, angekündigt wird nichts.
export function adjustedCents(adjustment: LetterAdjustment, suggestedCents: number): number | null {
  if (adjustment.mode === 'suggestion') return suggestedCents > 0 ? suggestedCents : null
  if (adjustment.mode === 'custom') return adjustment.cents !== null && adjustment.cents >= 0 ? adjustment.cents : null
  return null
}

export function buildLetter(i: {
  texts: Record<LetterBlock, string>
  facts: LetterFacts
  adjustment: LetterAdjustment
  suggestedCents: number
  // #317: der Monat, ab dem die Anpassung gilt (eigene Angabe des Mieters, sonst die Vorgabe)
  from: string
}): StatementLetter {
  const newCents = adjustedCents(i.adjustment, i.suggestedCents)
  const from = newCents === null ? null : i.from
  const values = letterValues(i.facts, newCents, from)
  const texts = Object.fromEntries(LETTER_BLOCK_IDS.map((b) => [b, resolveTemplate(i.texts[b], values)])) as Record<LetterBlock, string>
  return {
    texts,
    adjustment: { mode: i.adjustment.mode, newCents, from },
    values: { ...values, Datum: '', AnzahlBelege: '' },
  }
}

// Welche Bausteine erscheinen, in der Reihenfolge des Briefs. `attachments`: Zahl der mitgedruckten
// Belege (0, wenn keine mitgedruckt werden). Ein leerer Baustein erscheint nicht.
export function chooseLetterBlocks(letter: Pick<StatementLetter, 'adjustment' | 'texts'>, balanceCents: number, attachments: number): LetterBlock[] {
  const result: LetterBlock = balanceCents > 0 ? 'credit' : balanceCents < 0 ? 'backPayment' : 'balanced'
  const adjust: LetterBlock[] = letter.adjustment.newCents === null ? [] : [letter.adjustment.mode === 'custom' ? 'adjustCustom' : 'adjustSuggestion']
  const order: LetterBlock[] = ['subject', 'salutation', 'intro', result, ...adjust, attachments > 0 ? 'attachments' : 'receipts', 'closing', 'greeting', 'signature']
  return order.filter((b) => (letter.texts[b] ?? '').trim() !== '')
}

// Ohne Anschreiben (Teil 2) stehen diese Bausteine unter der Aufstellung, mit denselben Texten: Ergebnis mit
// Zahlung, Frist und Konto, die Anpassung der Vorauszahlung und die Belegeinsicht.
const STATEMENT_BLOCKS: readonly LetterBlock[] = ['credit', 'backPayment', 'balanced', 'adjustSuggestion', 'adjustCustom', 'receipts', 'attachments']
export function statementBlocks(letter: Pick<StatementLetter, 'adjustment' | 'texts'>, balanceCents: number, attachments: number): LetterBlock[] {
  return chooseLetterBlocks(letter, balanceCents, attachments).filter((b) => STATEMENT_BLOCKS.includes(b))
}

// Wird das Anschreiben mitgedruckt? Am Objekt abweichend, sonst die Einstellungen, ohne Angabe ja (Teil 2).
export const printsLetter = (property: Pick<Property, 'printLetter'> | null | undefined, settings: Pick<Settings, 'printLetter'>): boolean =>
  property?.printLetter ?? settings.printLetter ?? true

// Die Werte, die erst der Druck kennt.
export function renderLetterText(text: string, print: { date: string; attachments: number }): string {
  return unmaskLetterText(resolveTemplate(text, {
    Datum: fmtDate(print.date),
    AnzahlBelege: `${print.attachments} ${print.attachments === 1 ? 'Beleg' : 'Belege'}`,
  }))
}

// Passt das Anschreiben auf eine Seite? Eine Schätzung nach Zeilen (Durchsicht S3): Der Brieftext steht ab
// 98,46 mm bis 15 mm vor dem unteren Rand, gut 33 Zeilen zu 11 pt; eine Zeile fasst rund 90 Zeichen, jeder
// Absatz kostet eine Dreiviertelzeile Abstand, die Unterschrift zwei. Ein längerer Brief druckt weiter, nur
// auf der zweiten Seite; die Oberfläche warnt dann.
export const LETTER_PAGE_LINES = 33
export function exceedsOnePage(paragraphs: readonly string[]): boolean {
  let lines = 2
  for (const p of paragraphs) {
    if (p.trim() === '') continue
    for (const part of p.split('\n')) lines += Math.max(1, Math.ceil(part.length / 90))
    lines += 0.75
  }
  return lines > LETTER_PAGE_LINES
}

// Ein eigener Betrag über dem Vorschlag (§ 560 Abs. 4 BGB: Anpassung „auf eine angemessene Höhe“).
// Nur ein Hinweis, keine Sperre: Ob ein höherer Betrag angemessen ist, hängt am Einzelfall.
export function adjustmentHint(mode: LetterAdjustmentMode, cents: number | null, suggestedCents: number): string | null {
  if (mode !== 'custom' || cents === null || suggestedCents <= 0 || cents <= suggestedCents) return null
  return `Der Betrag liegt über dem Vorschlag von ${euro(suggestedCents)}. Nach § 560 Abs. 4 BGB ist eine Anpassung nur auf eine angemessene Höhe zulässig; prüfen Sie, ob Sie den höheren Betrag begründen können.`
}

export const ADJUSTMENT_MODES: readonly { id: LetterAdjustmentMode; label: string }[] = [
  { id: 'none', label: 'Keine Anpassung ankündigen' },
  { id: 'suggestion', label: 'Vorschlag von Mietfuchs ankündigen' },
  { id: 'custom', label: 'Eigenen Betrag ankündigen' },
]

// Eigene Texte aus einem Rumpf, geprüft. `null` an einem Baustein heißt „Ebene darüber gilt“. Ergibt
// eine Meldung, wenn etwas nicht stimmt; der Server antwortet damit 400.
export function parseLetterTexts(input: unknown): { texts: Partial<Record<LetterBlock, string | null>> } | { error: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { error: 'Die Texte des Anschreibens fehlen.' }
  const texts: Partial<Record<LetterBlock, string | null>> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!isLetterBlock(key)) return { error: `Einen Baustein „${key}“ gibt es im Anschreiben nicht.` }
    if (value === null) { texts[key] = null; continue }
    if (typeof value !== 'string') return { error: `Der Baustein „${blockLabel(key)}“ ist kein Text.` }
    const text = value.replace(/\r\n?/g, '\n').trimEnd()
    const problems = templateProblems(key, text)
    if (problems.length > 0) return { error: `Baustein „${blockLabel(key)}“: ${problems.join(' ')}` }
    texts[key] = text
  }
  return { texts }
}

export function parseLetterAdjustment(input: unknown): LetterAdjustment | null | { error: string } {
  if (input === undefined || input === null) return null
  if (typeof input !== 'object') return { error: 'Die Anpassung der Vorauszahlung ist keine gültige Angabe.' }
  const mode: unknown = Reflect.get(input, 'mode')
  const cents: unknown = Reflect.get(input, 'cents')
  const rawFrom: unknown = Reflect.get(input, 'from')
  if (mode !== 'none' && mode !== 'suggestion' && mode !== 'custom') return { error: 'Die Anpassung der Vorauszahlung ist „keine“, „Vorschlag“ oder „eigener Betrag“.' }
  // #317: der Monat als JJJJ-MM; ohne Angabe die Vorgabe.
  if (rawFrom !== undefined && rawFrom !== null && !isMonthKey(rawFrom)) return { error: 'Der Monat, ab dem die neue Vorauszahlung gilt, ist ungültig (erwartet etwa „Januar 2027“).' }
  const from = isMonthKey(rawFrom) ? rawFrom : null
  if (mode !== 'custom') return { mode, cents: null, from }
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0) return { error: 'Bitte nennen Sie die neue monatliche Vorauszahlung als Betrag in Euro, nicht negativ.' }
  return { mode, cents, from }
}

export type LetterSource = {
  settings: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'printAdjustSuggestion' | 'landlordAddress' | 'landlordContact'>
  property: Property | null
  tenancies: readonly (Pick<Tenancy, 'id' | 'end' | 'prepayments' | 'heatingPrepayments' | 'correspondenceAddress' | 'letterSalutation'>)[]
  installation: LetterTexts
  propertyTexts: LetterTexts
  own: Record<string, TenancyLetter>
  // #317: der Tag des Briefs für die Vorgabe des Monats (der Server nimmt heute; der Abschluss friert ihn ein)
  asOf: string
}

// Die Vorgabe der Einstellungen. Der frühere Schalter „Neue Vorauszahlung vorschlagen“ war ohne
// Angabe an; sein Wert ist die Vorgabe für alle Mieter.
export const adjustmentDefault = (s: Pick<Settings, 'printAdjustSuggestion'>): LetterAdjustment =>
  ({ mode: s.printAdjustSuggestion === false ? 'none' : 'suggestion', cents: null })

// Die bisherige monatliche Vorauszahlung: die Rate im letzten Monat des Mieters im Zeitraum, in
// derselben Abgrenzung wie der Vorschlag (Heizkostenabrechnung nur die Heizstaffel, bei getrennt
// abgerechneter Heizung ohne sie).
function prepaymentBefore(st: Settlement['statements'][number], t: LetterSource['tenancies'][number] | undefined, separate: boolean): number | null {
  if (!t) return null
  const last = (t.end && t.end < st.periodEnd ? t.end : st.periodEnd).slice(0, 7)
  const heating = rateAtMonth(t.heatingPrepayments ?? [], last)
  if (st.scope === 'heating') return heating
  return rateAtMonth(t.prepayments, last) + (separate ? 0 : heating)
}

// Das Anschreiben je Mietverhältnis einer Abrechnung. Der Server ruft es mit den Texten aller Ebenen auf; die
// Oberfläche nur, wenn eine Antwort keines trägt (dann mit den Vorgaben von Mietfuchs).
export function lettersOf(s: Pick<Settlement, 'statements' | 'period' | 'heatingPeriods' | 'scope' | 'daysInYear' | 'suggestionWithoutHeating' | 'separateHeating'>, src: LetterSource): Record<string, StatementLetter> {
  const landlord = effectiveLandlord(src.property, src.settings)
  const title = settlementTitle(s)
  // Wie die Seite bisher (Durchsicht #297 S-C): Eine vorher abgeschlossene Abrechnung kennt das Feld
  // nicht, dann zählt, ob in ihrem Zeitraum eine getrennte Heizkostenabrechnung endet.
  const separate = s.scope?.kind !== 'heating' && (s.suggestionWithoutHeating ?? (s.separateHeating ?? []).length > 0)
  const out: Record<string, StatementLetter> = {}
  for (const st of s.statements) {
    const own = src.own[st.tenancyId]
    const tenancy = src.tenancies.find((t) => t.id === st.tenancyId)
    const built = buildLetter({
      texts: mergeLetterTexts(src.installation, src.propertyTexts, own?.texts),
      adjustment: own?.adjustment ?? adjustmentDefault(src.settings),
      suggestedCents: st.suggestedMonthlyCents,
      from: own?.adjustment?.from ?? defaultAdjustFrom(src.asOf),
      facts: {
        tenantName: st.tenantName,
        unitName: st.unitName,
        propertyName: src.property?.name ?? '',
        title,
        periodStart: st.periodStart,
        periodEnd: st.periodEnd,
        totalShareCents: st.totalShareCents,
        prepaymentCents: st.prepaymentCents,
        balanceCents: st.balanceCents,
        paymentDeadlineDays: landlord.paymentDeadlineDays,
        iban: landlord.iban,
        landlordName: landlord.landlordName,
        prepaymentKind: adjustedPrepaymentLabel(st, separate),
        prepaymentBeforeCents: prepaymentBefore(st, tenancy, separate),
        basis: suggestionBasis(st, s.daysInYear),
        salutation: tenancy?.letterSalutation ?? '',
      },
    })
    out[st.tenancyId] = {
      ...built,
      sender: { name: landlord.landlordName, returnLine: returnLine(landlord, src.property), address: landlord.landlordAddress, footer: footerLine(landlord) },
      recipient: recipientLines(st.tenantName, st.unitName, tenancy, src.property),
    }
  }
  return out
}
