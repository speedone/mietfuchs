// Die Ablesung auf der Zähler-Seite: Formular lesen und den Rumpf für POST /api/readings bauen.
// Eigene Datei, damit die Regeln ohne DOM prüfbar sind (#149).
import { parseQuantity } from './costForm'
import type { Problem } from './formProblems'
import { parseYearText } from './yearText'
import type { Meter, Reading } from './types'
import { fmtDate } from './api'
import { asksCalibration } from './meterForm'

// `newCalibratedUntil`: das Eichjahr des neuen Zählers beim Wechsel (Praxistest), als Text wie das Jahresfeld.
// `estimated` und `estimateReason` (#98): Der Stand ist geschätzt; die Begründung ist dann Pflicht und steht beim
// Verbrauch des Mieters.
export type ReadingForm = { date: string; value: string; replacement: boolean; oldEndValue: string; newCalibratedUntil: string; note: string; estimated: boolean; estimateReason: string }

export const EMPTY_READING: ReadingForm = { date: '', value: '', replacement: false, oldEndValue: '', newCalibratedUntil: '', note: '', estimated: false, estimateReason: '' }

export type ReadingBody = {
  meterId: string
  date: string
  value: number
  replacement: true | undefined
  oldEndValue: number | null | undefined
  note: string | undefined
  newCalibratedUntil?: number
  estimated?: true
  estimateReason?: string
}

// Ein leeres Feld ist kein Wert und nie 0 (#149). Vorher rechnete die Seite mit Number(''), und das
// ist 0: Ein leerer Endstand beim Zählerwechsel wurde zu 0 statt `null`, die Warnung „Endstand
// fehlt“ aus #83 entfiel, und ein falsches Segment verschob beim Verbrauchsschlüssel Geld zwischen
// Mietern. Deshalb: leerer Endstand heißt `null` (die Berechnung meldet es), leerer gewöhnlicher
// Stand ist eine Meldung. Gelesen wird wie jede Menge (#105): „1.234“ ist 1234 und nicht 1,234.
// Gemeldet werden alle Angaben auf einmal, je mit Feld (#346, Schritt 3): am Feld die kurze Fassung, in
// der Sammelmeldung der Satz.
//
// Eichjahr des neuen Zählers (Praxistest): Das Jahr am Zähler gilt für das heutige Gerät; nach dem Wechsel blieb
// sonst die Warnung des ausgebauten stehen. Gefragt nur beim Wechsel eines eichpflichtigen Zählers (`asksYear`, nie
// am Heizkostenverteiler); leer heißt „nicht bekannt“ und lässt das bisherige Jahr stehen, gesendet wird dann nichts.
// Geschätzt (#98): Ohne Haken geht nichts davon in den Rumpf, der Rumpf bleibt wie bisher.
export type ReadingField = 'date' | 'value' | 'oldEndValue' | 'newCalibratedUntil' | 'estimateReason'
export function buildReadingBody(form: ReadingForm, meterId: string, asksYear = false): { problems: Problem<ReadingField>[] } | { body: ReadingBody } {
  const problems: Problem<ReadingField>[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) problems.push({ field: 'date', short: 'Datum fehlt', text: 'Bitte das Datum der Ablesung angeben.' })
  const value = form.value.trim() ? parseQuantity(form.value) : null
  if (!form.value.trim()) problems.push({ field: 'value', short: 'Zählerstand fehlt', text: 'Bitte den Zählerstand eintragen.' })
  else if (value === null || value < 0) problems.push({ field: 'value', short: 'Keine Zahl', text: 'Den Zählerstand bitte als Zahl angeben, z. B. 1.234,5.' })
  let oldEndValue: number | null | undefined
  if (form.replacement) {
    if (!form.oldEndValue.trim()) oldEndValue = null
    else {
      oldEndValue = parseQuantity(form.oldEndValue)
      if (oldEndValue === null || oldEndValue < 0) {
        problems.push({ field: 'oldEndValue', short: 'Keine Zahl', text: 'Den Endstand des alten Zählers bitte als Zahl angeben oder leer lassen, wenn er fehlt.' })
      }
    }
  }
  const year = form.replacement && asksYear ? parseYearText(form.newCalibratedUntil) : null
  if (year?.kind === 'invalid') {
    problems.push({ field: 'newCalibratedUntil', short: year.short, text: `Eichjahr des neuen Zählers: ${year.text} Oder lassen Sie das Feld leer, wenn Sie es nicht kennen.` })
  }
  const reason = form.estimateReason.trim()
  if (form.estimated && reason === '') {
    problems.push({ field: 'estimateReason', short: 'Begründung fehlt', text: 'Bitte begründen Sie die Schätzung, etwa „Zähler defekt“ oder „Wohnung bei der Ablesung nicht zugänglich“. Die Begründung steht beim Verbrauch des Mieters.' })
  }
  if (problems.length > 0 || value === null) return { problems }
  return {
    body: {
      meterId,
      date: form.date,
      value,
      replacement: form.replacement || undefined,
      oldEndValue,
      note: form.note.trim() || undefined,
      ...(year?.kind === 'year' ? { newCalibratedUntil: year.year } : {}),
      ...(form.estimated ? { estimated: true as const, estimateReason: reason } : {}),
    },
  }
}

// Eine neue Ablesung beginnt mit dem heutigen Datum. Entscheidung: heute und nicht das Ende des gewählten Zeitraums.
// Wer gleich nach dem Ablesen einträgt, hat damit das richtige Datum; das Zeitraumende wäre nur für die Jahresablesung
// richtig und läge im laufenden Zeitraum in der Zukunft. Vorbelegt gilt nicht als geändert: Das Fenster merkt sich den
// Stand vor der ersten Eingabe (kein `changedFrom`), wer ohne Eingabe schließt, wird nicht gefragt.
export const newReadingForm = (today: string): ReadingForm => ({ ...EMPTY_READING, date: today })

// Ein Stand als Text fürs Feld: deutsches Komma, ohne Tausenderpunkt, keine Stelle geht verloren.
const quantityText = (n: number): string => n.toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 20 })

// Bearbeiten: das Formular aus der gespeicherten Ablesung. Das Eichjahr des neuen Zählers gehört nicht dazu (es steht
// am Zähler und geht nur beim Anlegen des Wechsels mit).
export function readingToForm(r: Reading): ReadingForm {
  return {
    date: r.date,
    value: quantityText(r.value),
    replacement: r.replacement === true,
    oldEndValue: r.oldEndValue == null ? '' : quantityText(r.oldEndValue),
    newCalibratedUntil: '',
    note: r.note ?? '',
    estimated: r.estimated === true,
    estimateReason: r.estimateReason ?? '',
  }
}

// Der Rumpf für PUT /api/readings/:id. Der Server lässt stehen, was im Rumpf fehlt; was abgewählt oder geleert ist,
// geht deshalb ausdrücklich hinaus (`false`, `null`). Nie dabei: der Zähler (eine Ablesung wechselt ihn hier nicht) und
// `newCalibratedUntil` (im PUT eine 400).
export type ReadingUpdate = {
  date: string
  value: number
  replacement: boolean
  oldEndValue: number | null
  note: string | null
  estimated: boolean
  estimateReason?: string
}
export function buildReadingUpdate(form: ReadingForm): { problems: Problem<ReadingField>[] } | { body: ReadingUpdate } {
  const built = buildReadingBody(form, '')
  if ('problems' in built) return built
  const b = built.body
  return {
    body: {
      date: b.date,
      value: b.value,
      replacement: form.replacement,
      oldEndValue: form.replacement ? b.oldEndValue ?? null : null,
      note: b.note ?? null,
      estimated: form.estimated,
      ...(b.estimateReason !== undefined ? { estimateReason: b.estimateReason } : {}),
    },
  }
}

// Rückfrage vor dem Speichern (Anlegen und Bearbeiten), kein Verbot: Der Vermieter darf speichern. Gefragt wird bei
// einem Datum nach heute und bei einem Stand, der mit dem Stand unmittelbar davor oder danach einen negativen Verbrauch
// ergäbe, außer die spätere der beiden Ablesungen ist ein Zählerwechsel. Verglichen wird nur mit Ablesungen desselben
// Zählers an anderen Tagen; beim Bearbeiten zählt die Ablesung selbst nicht.
export type ReadingQuestion = { title: string; message: string; confirmLabel: string }
export function readingQuestion(
  candidate: { meterId: string; date: string; value: number; replacement: boolean },
  readings: readonly Reading[],
  opts: { today: string; unit?: string; editingId?: string },
): ReadingQuestion | null {
  const text = (n: number) => `${n.toLocaleString('de-DE', { maximumFractionDigits: 20 })}${opts.unit ? ` ${opts.unit}` : ''}`
  const others = readings.filter((r) => r.meterId === candidate.meterId && r.id !== opts.editingId)
  const previous = others.filter((r) => r.date < candidate.date).reduce<Reading | null>((a, r) => (a === null || r.date > a.date ? r : a), null)
  const next = others.filter((r) => r.date > candidate.date).reduce<Reading | null>((a, r) => (a === null || r.date < a.date ? r : a), null)
  const lines: string[] = []
  if (candidate.date > opts.today) lines.push(`Das Datum ${fmtDate(candidate.date)} liegt in der Zukunft.`)
  if (previous && !candidate.replacement && candidate.value < previous.value) {
    lines.push(`Der Stand ${text(candidate.value)} liegt unter dem vorigen Stand ${text(previous.value)} vom ${fmtDate(previous.date)}; der Verbrauch dazwischen wäre negativ. Wurde der Zähler getauscht, haken Sie „Zählerwechsel“ an.`)
  }
  if (next && next.replacement !== true && next.value < candidate.value) {
    lines.push(`Der Stand ${text(candidate.value)} liegt über dem folgenden Stand ${text(next.value)} vom ${fmtDate(next.date)}; der Verbrauch dazwischen wäre negativ.`)
  }
  if (lines.length === 0) return null
  const editing = opts.editingId !== undefined
  return { title: editing ? 'Ablesung trotzdem speichern?' : 'Ablesung trotzdem anlegen?', message: lines.join(' '), confirmLabel: editing ? 'Trotzdem speichern' : 'Trotzdem anlegen' }
}

// Das Eichjahr des neuen Geräts fragt das Fenster nach derselben Regel wie das Zählerformular (nie am
// Heizkostenverteiler).
export const asksReplacementCalibration = (meter: Pick<Meter, 'type'>): boolean => asksCalibration(meter)

// Was mit dem bisherigen Jahr geschieht: Es bleibt, wenn das Feld leer ist, und gilt dann weiter als das des Zählers.
export function replacementCalibrationHint(meter: Pick<Meter, 'calibratedUntil'>): string {
  return meter.calibratedUntil == null
    ? 'Leer lassen, wenn Sie es nicht kennen.'
    : `Bisher eingetragen: geeicht bis Ende ${meter.calibratedUntil}, das Jahr des ausgebauten Zählers. Leer gelassen bleibt es stehen.`
}

// Die Hilfe am Haken „geschätzt“ (#98): wann geschätzt werden darf, und dass sich keine Zahl ändert.
export const ESTIMATE_HELP = 'Haken Sie das an, wenn der Stand nicht abgelesen, sondern geschätzt ist, etwa weil der Zähler defekt oder die Wohnung nicht zugänglich war. Mietfuchs rechnet mit dem Stand wie mit einem abgelesenen und nennt die Schätzung mit Ihrer Begründung beim Verbrauch des Mieters. Bei Wärme und Warmwasser darf nur bei Geräteausfall oder aus anderen zwingenden Gründen geschätzt werden (§ 9a HeizkostenV).'
