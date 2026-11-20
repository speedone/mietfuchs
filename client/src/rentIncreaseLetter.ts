// Das Schreiben einer Mieterhöhung (#191, PR 3) als Text, ohne DOM (rentIncreaseLetter.test.ts). Gedruckt wird nur aus der
// eingefrorenen Grundlage (`RentIncrease.basis`), nie aus dem heutigen Bestand: Ein Nachdruck sagt dasselbe wie das
// verschickte Schreiben. Die Rechnung ist die des Entwurfs (`basis.plan`), auch nach dem Versand; die Rechnung zum
// tatsächlichen Zugang (`basis.sentPlan`) liest nur die Liste (Durchsicht M1). Gezeichnet wird es in
// components/RentIncreaseLetter.tsx mit dem Briefkopf des Anschreibens; Logo und Briefpapier lädt der Druck aktuell.
//
// Inhalt nach dem Entwurf („Schreiben“, R7, R8) und der Recherche (2.4 Pflichtinhalt, 5.6 Indexmiete, 8.1 Muster):
// - Vergleichsmiete (§ 558 BGB): Bitte um Zustimmung, bisherige und neue Nettokaltmiete als Betrag mit Fläche und Miete je
//   m², bei Inklusivmiete der enthaltene Betriebskostenanteil mit Vergleichsrechnung (VIII ZR 108/20 Rn. 16 f.); der
//   Gesamtbetrag heißt dann „Miete (einschließlich Betriebskosten)“, Nettokaltmiete nur in der Vergleichsrechnung,
//   Begründungsmittel mit seinen Angaben, ein qualifizierter Mietspiegel immer (§ 558a Abs. 3 BGB, M6), Kappungsgrenze,
//   Zustimmungsfrist als Datum (nach § 193 BGB verlängert, wenn sie auf einen Sonnabend, Sonntag oder Feiertag fiele),
//   sachlich die Möglichkeit der Klage (§ 558b Abs. 2 BGB) ohne Drohung, Vorauszahlungen unverändert. Schweigen gilt
//   nirgends als Zustimmung (S8). Dazu eine Zustimmungserklärung zum Zurücksenden.
// - Indexmiete (§ 557b BGB): beide Indexwerte mit Monat und Basis, bisherige und neue Miete, Änderung in Euro, ab Monat.
// - Frei ist nur der Zusatzabsatz; alle Pflichtangaben stehen fest.
import type { RentIncreaseBasis, RentSurveyInfo } from './types'
import type { LabeledRow } from './letterView'
import { infoRows } from './letterView'
import { fmtDate, fmtEuro } from './api'
import { monthLabel } from './monthText'
import { valueAt } from '../../shared/law/register.ts'
import { bgbRentCap, bgbRentIncreaseConsent } from '../../shared/law/bgb-betrkv.ts'

export type RentLetterComparable = { address: string; location: string; area: string; perM2: string }
export type RentIncreaseLetterView = {
  head: { sender: string; senderAddress: string; returnLine: string; recipient: string[]; info: LabeledRow[] }
  subject: string
  salutation: string
  paragraphs: string[]
  comparables: { after: number; rows: RentLetterComparable[] } | null // Tabelle nach dem Absatz `after`
  greeting: string
  signature: string
  footer: string
  // Die Zustimmungserklärung zum Zurücksenden (nur Vergleichsmiete): Überschrift und Zeilen.
  consentForm: { title: string; lines: string[] } | null
}

const area = (m2: number): string => `${m2.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²`
const perM2 = (cents: number, m2: number): string => (m2 > 0 ? fmtEuro(Math.floor(cents / m2)) : '')
const firstOf = (month: string): string => fmtDate(`${month}-01`)
const points = (v: { value: number; base: number }): string =>
  `${v.value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Punkte (Basis ${v.base} = 100)`
const indexText = (v: { month: string; value: number; base: number }): string =>
  `${v.value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Punkte im ${monthLabel(v.month)} (Basis ${v.base} = 100)`

function surveyLines(s: RentSurveyInfo, qualified: boolean): string {
  const range = s.rangeLowCentsPerM2 !== null && s.rangeHighCentsPerM2 !== null ? ` Die Spanne dieses Feldes reicht von ${fmtEuro(s.rangeLowCentsPerM2)} bis ${fmtEuro(s.rangeHighCentsPerM2)} je m².` : ''
  const where = s.availableAt !== '' ? ` Der Mietspiegel ist allgemein zugänglich: ${s.availableAt}.` : ' Der Mietspiegel liegt diesem Schreiben bei.'
  return `${qualified ? 'qualifizierten ' : ''}Mietspiegel „${s.name}“ (Stand ${monthLabel(s.asOf)}). Darin ist die Wohnung einzuordnen in: ${s.field}.${range}${where}`
}

export function rentIncreaseLetterView(b: RentIncreaseBasis): RentIncreaseLetterView {
  const p = b.plan
  // Mehrere Vermieter (Eheleute, Erbengemeinschaft) erklären gemeinsam (Recherche 7.2); ob es mehrere sind, sagt die
  // Angabe im Formular (Durchsicht S3), nicht der Name.
  const we = b.letter.severalLandlords
  const I = we ? 'wir' : 'ich'
  const Cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)
  const current = p.currentCents ?? 0
  const next = p.newCents ?? 0
  const effective = p.effectiveFrom ?? ''
  const where = [b.premises.unitName, b.premises.address].filter((x) => x !== '').join(', ')
  const paragraphs: string[] = []
  let comparables: RentIncreaseLetterView['comparables'] = null
  let consentForm: RentIncreaseLetterView['consentForm'] = null
  let subject: string

  const pre = b.prepayments
  const prepaymentText = pre.flatRateCents > 0
    ? `Die Betriebskostenpauschale von ${fmtEuro(pre.flatRateCents)} im Monat bleibt unverändert.`
    : pre.operatingCents > 0 || pre.heatingCents > 0
      ? `Die monatlichen Vorauszahlungen ${[pre.operatingCents > 0 ? `auf die Betriebskosten von ${fmtEuro(pre.operatingCents)}` : '', pre.heatingCents > 0 ? `auf die Heiz- und Warmwasserkosten von ${fmtEuro(pre.heatingCents)}` : ''].filter((x) => x !== '').join(' und ')} bleiben unverändert.`
      : ''

  if (p.kind === 'comparison') {
    subject = 'Mieterhöhungsverlangen nach § 558 BGB, Bitte um Zustimmung'
    const cmp = p.comparison
    const m2 = cmp?.areaM2 ?? b.premises.areaM2
    const operating = cmp?.operatingCostsCents ?? null
    // Inklusivmiete (Durchsicht M2): Der Gesamtbetrag ist keine Nettokaltmiete.
    const inclusive = b.inclusive || operating !== null
    const rentWord = inclusive ? 'Miete (einschließlich Betriebskosten)' : 'Nettokaltmiete'
    paragraphs.push(`${Cap(I)} ${we ? 'bitten' : 'bitte'} Sie, einer Erhöhung der monatlichen ${rentWord} für die Wohnung ${where} nach § 558 BGB auf die ortsübliche Vergleichsmiete zuzustimmen.`)
    if (operating === null) {
      paragraphs.push(`Die ${inclusive ? 'Miete' : 'Nettokaltmiete'} beträgt bisher ${fmtEuro(current)}, bei einer Wohnfläche von ${area(m2)} also ${perM2(current, m2)} je m². Sie soll ab ${monthLabel(effective)} ${fmtEuro(next)} betragen, das sind ${perM2(next, m2)} je m² und ${fmtEuro(next - current)} mehr im Monat.`)
    } else {
      // Teilinklusivmiete (R8, VIII ZR 108/20 Rn. 16 f.): Anteil nennen und vergleichbar machen.
      paragraphs.push(`Die Miete beträgt bisher ${fmtEuro(current)} und soll ab ${monthLabel(effective)} ${fmtEuro(next)} betragen, ${fmtEuro(next - current)} mehr im Monat. In der Miete sind Betriebskosten enthalten; auf die Wohnung entfallen davon ${fmtEuro(operating)} im Monat. Ohne sie beträgt die bisherige Miete ${fmtEuro(current - operating)}, die neue ${fmtEuro(next - operating)}, bei einer Wohnfläche von ${area(m2)} also ${perM2(next - operating, m2)} je m².`)
      if (cmp) paragraphs.push(`Zum Vergleich: Die ortsübliche Vergleichsmiete von ${fmtEuro(cmp.centsPerM2)} je m² ergibt für ${area(m2)} ${fmtEuro(cmp.rentCents)}, zuzüglich der enthaltenen Betriebskosten von ${fmtEuro(operating)} also ${fmtEuro(cmp.limitCents)}. Die verlangte Miete von ${fmtEuro(next)} liegt nicht darüber.`)
    }
    const l = b.letter
    const rate = cmp ? fmtEuro(cmp.centsPerM2) : ''
    if (l.justification === 'survey' && l.survey) {
      paragraphs.push(`Die ortsübliche Vergleichsmiete von ${rate} je m² ergibt sich aus dem ${surveyLines(l.survey, l.qualifiedSurvey === 'yes')}`)
    } else if (l.justification === 'expert' && l.expert) {
      paragraphs.push(`Die ortsübliche Vergleichsmiete von ${rate} je m² ergibt sich aus dem Gutachten des öffentlich bestellten und vereidigten Sachverständigen ${l.expert.name} vom ${fmtDate(l.expert.date)}. Das Gutachten liegt diesem Schreiben bei.`)
    } else if (l.justification === 'database' && l.database) {
      paragraphs.push(`Die ortsübliche Vergleichsmiete von ${rate} je m² ergibt sich aus der Auskunft der Mietdatenbank „${l.database.name}“ vom ${fmtDate(l.database.date)}.`)
    } else if (l.justification === 'comparables') {
      paragraphs.push(`Zur Begründung ${we ? 'nennen wir' : 'nenne ich'} drei vergleichbare Wohnungen und die Nettokaltmiete, die dort je m² gezahlt wird. Danach beträgt die ortsübliche Vergleichsmiete ${rate} je m².`)
      comparables = { after: paragraphs.length - 1, rows: l.comparables.map((c) => ({ address: c.address, location: c.location, area: area(c.areaM2), perM2: fmtEuro(c.centsPerM2) })) }
    }
    // § 558a Abs. 3 BGB (M6): Angaben des qualifizierten Mietspiegels auch bei anderer Begründung.
    if (l.qualifiedSurvey === 'yes' && l.justification !== 'survey' && l.qualified) {
      paragraphs.push(`Für die Gemeinde gibt es einen qualifizierten Mietspiegel. Nach § 558a Abs. 3 BGB ${we ? 'teilen wir' : 'teile ich'} Ihnen seine Angaben für die Wohnung mit: Es ist der ${surveyLines(l.qualified, true)}`)
    }
    if (p.cap) {
      const years = valueAt(bgbRentCap, `${effective}-01`).years
      paragraphs.push(`Die Kappungsgrenze ist eingehalten (§ 558 Abs. 3 BGB): Innerhalb von ${years} Jahren darf die Miete um höchstens ${p.cap.percent} % steigen. Am ${fmtDate(p.cap.baseDay)} betrug sie ${fmtEuro(p.cap.baseCents)}; zulässig sind danach höchstens ${fmtEuro(p.cap.limitCents)}${p.cap.modernizationCents > 0 ? `, einschließlich der Erhöhung wegen Modernisierung von ${fmtEuro(p.cap.modernizationCents)}` : ''}.`)
    }
    if (p.consent) {
      const v = valueAt(bgbRentIncreaseConsent, p.receivedOn)
      paragraphs.push(`Bitte teilen Sie ${we ? 'uns' : 'mir'} bis zum Ablauf des ${v.consentMonths === 2 ? 'zweiten' : `${v.consentMonths}.`} Kalendermonats nach dem Zugang dieses Schreibens mit, ob Sie der Erhöhung zustimmen, bei Zugang am ${fmtDate(p.receivedOn)} also bis zum ${fmtDate(p.consent.consentEndOnWorkday)}. Dafür können Sie die beigefügte Erklärung unterschrieben zurücksenden. Mit Ihrer Zustimmung ist die erhöhte Miete ab dem ${firstOf(effective)} zu zahlen.`)
      paragraphs.push(`Stimmen Sie bis dahin nicht zu, sieht das Gesetz vor, dass der Vermieter innerhalb von ${v.suitMonths} weiteren Monaten auf Zustimmung klagen kann (§ 558b Abs. 2 BGB).`)
    }
    consentForm = {
      title: 'Zustimmung zur Mieterhöhung',
      lines: [
        `An: ${[b.sender.name, b.sender.address].filter((x) => x !== '').join(', ')}`,
        `Der Erhöhung der monatlichen ${inclusive ? `Miete einschließlich Betriebskosten${operating !== null ? ` (darin ${fmtEuro(operating)} Betriebskosten)` : ''}` : 'Nettokaltmiete'} für die Wohnung ${where} von ${fmtEuro(current)} auf ${fmtEuro(next)} ab ${monthLabel(effective)} stimme ich zu bzw. stimmen wir zu.`,
        `Mieter: ${b.letter.recipientName}`,
        'Ort, Datum: ______________________________',
        'Unterschrift aller Mieter: ______________________________',
      ],
    }
  } else {
    subject = 'Anpassung der Miete nach § 557b BGB (Indexmiete)'
    const ix = p.index
    paragraphs.push(`Im Mietvertrag für die Wohnung ${where} ist eine Indexmiete vereinbart: Die Nettokaltmiete ändert sich im selben Verhältnis wie der vom Statistischen Bundesamt ermittelte Verbraucherpreisindex für Deutschland (§ 557b BGB). Hiermit ${we ? 'machen wir' : 'mache ich'} die Änderung geltend.`)
    if (ix) {
      paragraphs.push(`Der Index betrug bei der letzten Festsetzung der Miete ${indexText(ix.from)}. Im ${monthLabel(ix.to.month)} betrug er ${points(ix.to)}.`)
      const change = next - current
      const percent = (((ix.to.value / ix.from.value) - 1) * 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      paragraphs.push(`Die bisherige Nettokaltmiete von ${fmtEuro(current)} ändert sich deshalb im Verhältnis ${ix.to.value.toLocaleString('de-DE', { minimumFractionDigits: 1 })} zu ${ix.from.value.toLocaleString('de-DE', { minimumFractionDigits: 1 })} (${percent} %) auf ${fmtEuro(next)}, auf den Cent abgerundet. Das ist eine ${change >= 0 ? 'Erhöhung' : 'Senkung'} um ${fmtEuro(Math.abs(change))} im Monat.`)
    }
    paragraphs.push(`Die neue Miete von ${fmtEuro(next)} ist ab dem ${firstOf(effective)} zu zahlen.`)
  }
  if (prepaymentText) paragraphs.push(prepaymentText)
  if (b.letter.extraParagraph !== '') paragraphs.push(b.letter.extraParagraph)

  return {
    head: { sender: b.sender.name, senderAddress: b.sender.address, returnLine: b.sender.returnLine, recipient: b.recipient, info: infoRows({ name: b.sender.name, returnLine: b.sender.returnLine, address: b.sender.address, contact: b.sender.contact }, fmtDate(b.letterDate)) },
    subject,
    salutation: b.salutation,
    paragraphs,
    comparables,
    greeting: 'Mit freundlichen Grüßen',
    signature: b.sender.name,
    footer: b.sender.footer,
    consentForm,
  }
}

// Hinweise zum Schreiben, die nichts sperren (Gegenprüfung S5, M7): ein Mietspiegel älter als der Abstand seiner Anpassung,
// eine verlangte Miete je m² über der niedrigsten Vergleichswohnung.
export { surveyStale } from '../../shared/rentIncreaseLetter.ts'
