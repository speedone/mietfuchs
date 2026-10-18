// Die Frage zum angespannten Wohnungsmarkt am Objekt (Heizung PR 18; Entwurf 5.3). Gefragt wird nach dem Gebiet,
// in dem das Gebäude liegt, nicht nach der Gemeinde: Eine Verordnung kann nur Teile einer Gemeinde erfassen
// (§ 556d Abs. 2 Satz 2, § 558 Abs. 3 Satz 2, § 577a Abs. 2 Satz 1 BGB; Prüfung S9).
import Term from './Term'
import Field from './Field'
import { TIGHT_MARKET_LABELS, type TightMarketAnswer } from '../propertyForm'

type Change = { tightMarket?: TightMarketAnswer; tightMarketFrom?: string; tightMarketTo?: string }

export default function TightMarketField({ value, from, to, onChange }: { value: TightMarketAnswer; from: string; to: string; onChange: (c: Change) => void }) {
  const keys = Object.keys(TIGHT_MARKET_LABELS).filter((k): k is TightMarketAnswer => k === 'unbekannt' || k === 'ja' || k === 'nein')
  // Ohne eigenen Kasten (#346 Schritt 7b): Das Auswahlfeld ist so breit wie sein längster Eintrag, die Frage
  // steht in Lesebreite darüber, die beiden Daten der Verordnung als kurze Felder daneben im Raster.
  return (
    <>
      <Field label={<Term id="tightMarket">Angespannter Wohnungsmarkt</Term>} className="hint-wide" hint="Liegt das Gebäude in einem Gebiet, das eine Verordnung zur Mietpreisbremse (§ 556d BGB), zur Kappungsgrenze (§ 558 Abs. 3 BGB) oder zur Kündigungssperrfrist (§ 577a Abs. 2 BGB) bestimmt? Manche Verordnungen nennen nur Teile einer Gemeinde. Die Antwort braucht Mietfuchs nur bei einer Heizung nach § 43 GModG im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen.">
        <select value={value} onChange={(e) => onChange({ tightMarket: keys.find((k) => k === e.target.value) ?? 'unbekannt' })}>
          {keys.map((k) => <option key={k} value={k}>{TIGHT_MARKET_LABELS[k]}</option>)}
        </select>
      </Field>
      {value === 'ja' && (
        <>
          <Field label="Verordnung gilt seit">
            <input type="date" value={from} onChange={(e) => onChange({ tightMarketFrom: e.target.value })} />
          </Field>
          <Field label="Verordnung gilt bis" className="hint-wide" hint="Die Verordnungen sind befristet (§ 556d Abs. 2 Satz 4, § 558 Abs. 3 Satz 3, § 577a Abs. 2 Satz 2 BGB). Tragen Sie die Geltung laut Verordnung ein; leer heißt ohne bekannten Beginn bzw. ohne bekanntes Ende.">
            <input type="date" value={to} onChange={(e) => onChange({ tightMarketTo: e.target.value })} />
          </Field>
        </>
      )}
    </>
  )
}
