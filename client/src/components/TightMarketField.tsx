// Die Frage zum angespannten Wohnungsmarkt am Objekt (Heizung PR 18; Entwurf 5.3). Gefragt wird nach dem Gebiet,
// in dem das Gebäude liegt, nicht nach der Gemeinde: Eine Verordnung kann nur Teile einer Gemeinde erfassen
// (§ 556d Abs. 2 Satz 2, § 558 Abs. 3 Satz 2, § 577a Abs. 2 Satz 1 BGB; Prüfung S9).
import Term from './Term'
import { TIGHT_MARKET_LABELS, type TightMarketAnswer } from '../propertyForm'

type Change = { tightMarket?: TightMarketAnswer; tightMarketFrom?: string; tightMarketTo?: string }

export default function TightMarketField({ value, from, to, onChange }: { value: TightMarketAnswer; from: string; to: string; onChange: (c: Change) => void }) {
  const keys = Object.keys(TIGHT_MARKET_LABELS).filter((k): k is TightMarketAnswer => k === 'unbekannt' || k === 'ja' || k === 'nein')
  return (
    <div className="field-group">
      <label className="field">
        <span><Term id="tightMarket">Angespannter Wohnungsmarkt</Term></span>
        <select aria-label="Angespannter Wohnungsmarkt" value={value} onChange={(e) => onChange({ tightMarket: keys.find((k) => k === e.target.value) ?? 'unbekannt' })}>
          {keys.map((k) => <option key={k} value={k}>{TIGHT_MARKET_LABELS[k]}</option>)}
        </select>
        <span className="muted">Liegt das Gebäude in einem Gebiet, das eine Verordnung zur Mietpreisbremse (§ 556d BGB), zur Kappungsgrenze (§ 558 Abs. 3 BGB) oder zur Kündigungssperrfrist (§ 577a Abs. 2 BGB) bestimmt? Manche Verordnungen nennen nur Teile einer Gemeinde. Die Antwort braucht Mietfuchs nur bei einer Heizung nach § 43 GModG im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen.</span>
      </label>
      {value === 'ja' && (
        <>
          <div className="row">
            <label className="field">
              Verordnung gilt seit
              <input type="date" aria-label="Verordnung gilt seit" value={from} onChange={(e) => onChange({ tightMarketFrom: e.target.value })} />
            </label>
            <label className="field">
              Verordnung gilt bis
              <input type="date" aria-label="Verordnung gilt bis" value={to} onChange={(e) => onChange({ tightMarketTo: e.target.value })} />
            </label>
          </div>
          <span className="muted">Die Verordnungen sind befristet (§ 556d Abs. 2 Satz 4, § 558 Abs. 3 Satz 3, § 577a Abs. 2 Satz 2 BGB). Tragen Sie die Geltung laut Verordnung ein; leer heißt ohne bekannten Beginn bzw. ohne bekanntes Ende.</span>
        </>
      )}
    </div>
  )
}
