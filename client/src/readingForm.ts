// Die Ablesung auf der Zähler-Seite: Formular lesen und den Rumpf für POST /api/readings bauen.
// Eigene Datei, damit die Regeln ohne DOM prüfbar sind (#149).
import { parseQuantity } from './costForm'
import type { Problem } from './formProblems'

export type ReadingForm = { date: string; value: string; replacement: boolean; oldEndValue: string; note: string }

export const EMPTY_READING: ReadingForm = { date: '', value: '', replacement: false, oldEndValue: '', note: '' }

export type ReadingBody = {
  meterId: string
  date: string
  value: number
  replacement: true | undefined
  oldEndValue: number | null | undefined
  note: string | undefined
}

// Ein leeres Feld ist kein Wert und nie 0 (#149). Vorher rechnete die Seite mit Number(''), und das
// ist 0: Ein leerer Endstand beim Zählerwechsel wurde zu 0 statt `null`, die Warnung „Endstand
// fehlt“ aus #83 entfiel, und ein falsches Segment verschob beim Verbrauchsschlüssel Geld zwischen
// Mietern. Deshalb: leerer Endstand heißt `null` (die Berechnung meldet es), leerer gewöhnlicher
// Stand ist eine Meldung. Gelesen wird wie jede Menge (#105): „1.234“ ist 1234 und nicht 1,234.
// Gemeldet werden alle Angaben auf einmal, je mit Feld (#346, Schritt 3): am Feld die kurze Fassung, in
// der Sammelmeldung der Satz.
export type ReadingField = 'date' | 'value' | 'oldEndValue'
export function buildReadingBody(form: ReadingForm, meterId: string): { problems: Problem<ReadingField>[] } | { body: ReadingBody } {
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
  if (problems.length > 0 || value === null) return { problems }
  return {
    body: {
      meterId,
      date: form.date,
      value,
      replacement: form.replacement || undefined,
      oldEndValue,
      note: form.note.trim() || undefined,
    },
  }
}
