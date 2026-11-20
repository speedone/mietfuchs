// Die Frage zur Kappungsgrenzen-Verordnung am Objekt (#191, Entwurf Oberfläche 2). Getrennt vom angespannten
// Wohnungsmarkt (TightMarketField): Das ist eine andere Verordnung. Keine Gemeindeliste; wo die Länder ihre Verordnungen
// veröffentlichen, sagt das Lexikon.
import Term from './Term'
import Field from './Field'
import { RENT_CAP_HINT, RENT_CAP_LABELS, RENT_CAP_QUESTION, type RentCapAnswer } from '../propertyForm'

const ANSWERS: readonly RentCapAnswer[] = ['unbekannt', 'ja', 'nein']

export default function RentCapField({ value, onChange }: { value: RentCapAnswer; onChange: (value: RentCapAnswer) => void }) {
  return (
    <Field label={<>Gilt in der Gemeinde eine <Term id="rentCap">Kappungsgrenzen-Verordnung</Term>?</>} className="hint-wide" hint={RENT_CAP_HINT}>
      <select aria-label={RENT_CAP_QUESTION} value={value} onChange={(e) => onChange(ANSWERS.find((a) => a === e.target.value) ?? 'unbekannt')}>
        {ANSWERS.map((a) => <option key={a} value={a}>{RENT_CAP_LABELS[a]}</option>)}
      </select>
    </Field>
  )
}
