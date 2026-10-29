// Anschreiben und Ergebniskasten der gedruckten Abrechnung (#415), ohne DOM prüfbar. Gerechnet wird
// hier nichts: Die Texte setzt der Server ein (shared/letter.ts), die Zahlen stammen aus der Abrechnung.
import type { LetterBlock, LetterTemplates, Property, Settings, Settlement, Statement, StatementLetter, Tenancy } from './types'
import { chooseLetterBlocks, lettersOf, renderLetterText } from '../../shared/letter.ts'
import { fmtDate, fmtEuro } from './api'
import { countOf } from '../../shared/wording.ts'
import { localToday } from './periodForm'

// Eine Antwort von /api/letter-texts, wie sie sein soll; ein älterer Server oder eine Testattrappe liefert
// etwas anderes, dann gibt es nichts zu bearbeiten, und die Seite bleibt bedienbar.
export const asTemplates = (x: unknown): LetterTemplates | null =>
  x !== null && typeof x === 'object' && !Array.isArray(x) && 'defaults' in x && 'installation' in x ? (x as LetterTemplates) : null

export type LetterParagraph = { block: LetterBlock, text: string }

// Das Anschreiben eines Mieters, wie es gedruckt wird: die Bausteine, die Mietfuchs für ihn wählt, mit
// Datum und Zahl der Belege. Ohne Anschreiben in der Antwort (ein älterer Server) entsteht es aus den
// Vorgaben von Mietfuchs, wie der Server es für eine vor #415 abgeschlossene Abrechnung täte.
export function letterOf(
  data: Settlement,
  st: Statement,
  ctx: { settings: Pick<Settings, 'landlordName' | 'iban' | 'paymentDeadlineDays' | 'printAdjustSuggestion'> | null, property: Property | null, tenancies: readonly Tenancy[] },
): StatementLetter {
  const own = data.letters?.[st.tenancyId]
  if (own) return own
  const settings = ctx.settings ?? { landlordName: '', iban: '', paymentDeadlineDays: 30 }
  const built = lettersOf({ ...data, statements: [st] }, { settings, property: ctx.property, tenancies: ctx.tenancies, installation: {}, propertyTexts: {}, own: {}, asOf: localToday() })
  const letter = built[st.tenancyId]
  if (!letter) throw new Error('Das Anschreiben ließ sich nicht zusammenstellen.')
  return letter
}

export function letterParagraphs(letter: StatementLetter, balanceCents: number, print: { date: string, attachments: number }): LetterParagraph[] {
  return chooseLetterBlocks(letter, balanceCents, print.attachments).map((block) => ({ block, text: renderLetterText(letter.texts[block], print) }))
}

// Die Rücksendeangabe steht im Druck in höchstens zwei Zeilen zu 7 pt über der Anschrift (letter.css). Rund 55 Zeichen je
// Zeile bei Umbruch an Wortgrenzen; was länger ist, nennt die Seite vor dem Druck, statt es still abzuschneiden
// (Durchsicht zu PR #427, K7, nachgemessen mit page.pdf).
export const RETURN_LINE_MAX = 110
export const returnLineTooLong = (line: string): boolean => line.trim().length > RETURN_LINE_MAX

// Der Ergebniskasten oben in der Aufstellung: Kosten, Vorauszahlungen, Ergebnis, Frist. Die
// Nachzahlung steht neutral fett, nicht rot: In Rot las sie sich wie eine Mahnung.
export type ResultRow = { label: string, value: string, strong?: boolean }
// Der Zeitraum steht seit dem Kopf der Aufstellung (`statementHeadRows`) dort und nicht noch einmal im Kasten.
export function resultRows(st: Statement, paymentDeadlineDays: number | null | undefined): ResultRow[] {
  const rows: ResultRow[] = [
    { label: 'Ihre Kosten', value: fmtEuro(st.totalShareCents) },
    { label: 'Ihre Vorauszahlungen', value: fmtEuro(st.prepaymentCents) },
  ]
  if (st.balanceCents < 0) {
    rows.push({ label: 'Nachzahlung', value: fmtEuro(-st.balanceCents), strong: true })
    rows.push({ label: 'Zahlbar', value: `innerhalb von ${paymentDeadlineDays || 30} Tagen nach Zugang` })
  } else if (st.balanceCents > 0) {
    rows.push({ label: 'Guthaben', value: fmtEuro(st.balanceCents), strong: true })
  } else {
    rows.push({ label: 'Ergebnis', value: 'ausgeglichen', strong: true })
  }
  return rows
}

// ---------- Druck nach DIN 5008 (#415) ----------

// Eine Zeile aus Beschriftung und Wert; ohne Beschriftung steht der Wert allein (Freitext, „Ort, Datum“).
export type LabeledRow = { label: string | null, value: string }

// Der Kontakt des Vermieters ist ein freies Feld („Tel. 0123 456789, E-Mail …“). Für den Informationsblock wird er an
// Zeilenumbruch und Semikolon zerlegt; ein Komma, ein Mittelpunkt oder ein senkrechter Strich trennt nur, wenn danach
// erkennbar Telefon, Telefax, Mobil oder E-Mail folgt (Durchsicht K3: „Sprechzeiten Mo, Mi 9–12 Uhr“ bleibt eine Zeile).
// Telefon und E-Mail werden an ihrem Wort oder an ihrer Gestalt erkannt, alles andere bleibt ohne Beschriftung stehen.
const CONTACT_WORDS: readonly [RegExp, string][] = [
  [/^(?:tel(?:efon)?|fon|phone)\.?$/i, 'Telefon'],
  [/^(?:tele)?fax\.?$/i, 'Telefax'],
  [/^(?:mobil(?:funk)?|handy)\.?$/i, 'Mobil'],
  [/^(?:e-?mail|mail)$/i, 'E-Mail'],
]
function contactRow(part: string): LabeledRow {
  const m = part.match(/^([A-Za-z-]+\.?)\s*:?\s+(.+)$/)
  const word = m ? CONTACT_WORDS.find(([re]) => re.test(m[1] ?? '')) : undefined
  if (m && word) return { label: word[1], value: (m[2] ?? '').trim() }
  if (/^\S+@\S+\.\S+$/.test(part)) return { label: 'E-Mail', value: part }
  if (/^\+?\d[\d\s/()-]{4,}$/.test(part)) return { label: 'Telefon', value: part }
  return { label: null, value: part }
}
export function contactRows(contact: string | null | undefined): LabeledRow[] {
  const rows: LabeledRow[] = []
  for (const line of (contact ?? '').split(/\s*[\n;]\s*/)) {
    // Ungerade Stellen sind die Trenner; ein Stück ohne erkannte Angabe hängt mit seinem Trenner am vorigen.
    const pieces = line.split(/(\s*[,·|]\s*)/)
    let current = ''
    for (let i = 0; i < pieces.length; i += 2) {
      const piece = (pieces[i] ?? '').trim()
      if (current !== '' && piece !== '' && contactRow(piece).label !== null) {
        rows.push(contactRow(current))
        current = piece
      } else {
        current = current === '' ? piece : `${current}${i > 0 ? (pieces[i - 1] ?? '') : ''}${piece}`
      }
    }
    if (current.trim() !== '') rows.push(contactRow(current.trim()))
  }
  return rows
}

// Der Ort aus der Anschrift des Vermieters („Ahornstraße 3, 12345 Musterstadt“): was nach der Postleitzahl steht.
const placeOf = (address: string | undefined): string => (address ?? '').match(/\b\d{5}\s+([^,]+)$/)?.[1]?.trim() ?? ''

// Der Informationsblock rechts neben dem Anschriftfeld (DIN 5008, 125 mm von links): Ansprechpartner, Kontakt, darunter Ort und
// Datum. Aus dem Anschreiben, abgeschlossen also eingefroren; ein Anschreiben ohne Kontakt (vorher eingefroren) nennt nur, was
// es kennt. Ohne Ort steht das Datum mit Beschriftung.
export function infoRows(sender: StatementLetter['sender'] | null | undefined, date: string): LabeledRow[] {
  const rows: LabeledRow[] = []
  const name = (sender?.name ?? '').trim()
  if (name) rows.push({ label: 'Ansprechpartner', value: name })
  rows.push(...contactRows(sender?.contact))
  const place = placeOf(sender?.address)
  rows.push(place ? { label: null, value: `${place}, ${date}` } : { label: 'Datum', value: date })
  return rows
}

const areaText = (m2: number): string => `${m2.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²`
const span = (from: string, to: string): string => `${fmtDate(from)} – ${fmtDate(to)}`

// Der Kopf der Aufstellung: wen und was sie betrifft. Die Mindestangaben einer Abrechnung (BGH, Urteil vom 9. April 2008,
// VIII ZR 84/07, Rn. 15: Gesamtkosten, Verteilerschlüssel, Anteil, Vorauszahlungen) stehen in der Tabelle; hier stehen
// Mieter, Mietobjekt, Wohnung und Abrechnungszeitraum, ohne die sich die Abrechnung keinem Mietverhältnis und keinem Jahr
// zuordnen ließe (§ 556 Abs. 3 Satz 1 BGB: jährlich abzurechnen), und die Größen, auf denen die Schlüssel beruhen
// (Wohnfläche, Personen). Der eigene Nutzungszeitraum nur, wenn er vom Abrechnungszeitraum abweicht (Ein- oder Auszug).
export function statementHeadRows(st: Statement, letter: StatementLetter | null, ctx: { period: { from: string, to: string }, persons: string | null }): LabeledRow[] {
  const rows: LabeledRow[] = [{ label: 'Mieter', value: st.tenantName }]
  const premises = (letter?.premises?.address ?? '').trim() || (letter?.values.Objekt ?? '').trim()
  if (premises) rows.push({ label: 'Mietobjekt', value: premises })
  rows.push({ label: 'Wohnung', value: st.unitName })
  const area = letter?.premises?.areaM2
  if (typeof area === 'number' && area > 0) rows.push({ label: 'Wohnfläche', value: areaText(area) })
  const days = countOf(st.days, 'Tag', 'Tage')
  const whole = st.periodStart === ctx.period.from && st.periodEnd === ctx.period.to
  rows.push({ label: 'Abrechnungszeitraum', value: whole ? `${span(ctx.period.from, ctx.period.to)} (${days})` : span(ctx.period.from, ctx.period.to) })
  if (!whole) rows.push({ label: 'Ihr Nutzungszeitraum', value: `${span(st.periodStart, st.periodEnd)} (${days})` })
  if (ctx.persons) rows.push({ label: 'Personen', value: ctx.persons })
  return rows
}

// Der Fußvermerk je Druckseite: welche Abrechnung, welches Objekt, welche Wohnung. Der Name des Mieters steht im Anschriftfeld
// und im Kopf, Kontakt und Bank auf der Briefseite (DIN 5008, Fuß des Geschäftsbriefs), nicht auf jeder Seite. Nennt die
// Wohnung das Ende des Objektnamens schon (Eigentumswohnung „WE 7“), steht es nicht doppelt da.
export function footnoteText(letter: Pick<StatementLetter, 'values'>): string {
  const object = (letter.values.Objekt ?? '').trim()
  const parts = (letter.values.Wohnung ?? '').split(/\s*,\s*/).filter((p) => p !== '')
  const last = object.split(/\s*,\s*/).pop() ?? ''
  const unit = (parts[0] === last && parts.length > 1 ? parts.slice(1) : parts).join(', ')
  return [letter.values.Abrechnung, [object, unit].filter((x) => x).join(', ')].filter((x) => x).join(' · ')
}

// Die Tabelle nach § 35a EStG: je Position mit Lohnanteil die Leistung, der Rechnungsbetrag, der Lohnanteil der Rechnung und
// der Anteil des Mieters daran. Rechnungsbetrag und Lohnanteil kommen aus dem Anschreiben (eingefroren). Ein Anschreiben, das
// vor dieser Änderung eingefroren wurde, kennt sie nicht (`full: false`): Dann zeigt die Tabelle nur Leistung und Ihren
// Anteil, statt leerer Spalten (Durchsicht K2).
export type Labor35aRow = { service: string, total: string, labor: string, share: string }
export function labor35aTable(st: Statement, letter: Pick<StatementLetter, 'labor35a'> | null): { full: boolean, rows: Labor35aRow[] } {
  const frozen = letter?.labor35a
  return {
    full: frozen !== undefined,
    rows: st.rows.filter((r) => (r.labor35aCents ?? 0) > 0).map((r) => {
      const own = frozen?.[r.costItemId]
      return {
        service: r.description && r.description !== r.category ? `${r.category}: ${r.description}` : r.category,
        total: own ? fmtEuro(own.amountCents) : '',
        labor: own ? fmtEuro(own.laborCents) : '',
        share: fmtEuro(r.labor35aCents ?? 0),
      }
    }),
  }
}

// Absender fehlt (Praxistest): Ohne Namen des Vermieters (Einstellungen oder Objekt) druckt das Anschreiben weder
// Absender noch Unterschrift, denn beide sind `{Vermieter}`. Eine Anpassung der Vorauszahlungen nach § 560 Abs. 4 BGB
// braucht Textform, und dafür muss die Person des Erklärenden genannt sein (§ 126b BGB). Eine eigene Unterschrift mit
// Namen genügt dafür; mit Briefpapier trägt das Papier den Absender, und Mietfuchs sieht nicht, was darauf steht.
// Eine Warnung, keine Sperre: Gedruckt wird trotzdem.
export function senderMissing(p: { sender: string, signature: string | null, paper: boolean }): boolean {
  if (p.paper) return false
  return p.sender.trim() === '' && (p.signature ?? '').trim() === ''
}
export const SENDER_MISSING_TEXT =
  'Im Anschreiben steht kein Name des Vermieters: Gedruckt werden weder Absender noch Unterschrift. ' +
  'Eine Anpassung der Vorauszahlungen nach § 560 Abs. 4 BGB braucht Textform, und dafür muss die Person des Erklärenden genannt sein (§ 126b BGB). ' +
  'Tragen Sie Ihren Namen in den Einstellungen unter „Name des Vermieters“ ein, bei einem Objekt mit eigenem Vermieter in den Stammdaten des Objekts.'
