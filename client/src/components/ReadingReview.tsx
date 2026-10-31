// Ein erkannter Zählerstand zur Prüfung (Schuhkarton, #149), in der Schnellerfassung und auf der Seite Kosten (#490):
// Foto, Zähler, Stand, Datum, Zählerwechsel, Ampel mit Gründen und „Ablesung übernehmen“.
import type { Meter, Unit } from '../types'
import { parseNum, type ReadingCandidate, type scoreCandidate } from '../readingCandidate'

type Props = {
  reading: ReadingCandidate
  serverFile?: string
  score?: ReturnType<typeof scoreCandidate>
  meters: Meter[]
  units: Unit[]
  adopting: boolean
  onChange: (patch: Partial<ReadingCandidate>) => void
  onAdopt: () => void
}

export function ReadingReview({ reading, serverFile, score: rs, meters, units, adopting, onChange, onAdopt }: Props) {
  const unitName = (id: string | null) => (id ? units.find((u) => u.id === id)?.name ?? '?' : 'Haus (Hauptzähler)')
  return (
    <div className="row start">
      {serverFile && (
        <a href={`/uploads/${serverFile}`} target="_blank" rel="noreferrer">
          <img src={`/uploads/${serverFile}`} alt="Zählerfoto" className="meter-photo" />
        </a>
      )}
      <div className="grow stack">
        <div className="row center">
          <span className={`ampel ${rs?.level ?? 'gruen'}`} />
          <label className="field">
            Zähler
            <select value={reading.matchedMeterId} onChange={(e) => onChange({ matchedMeterId: e.target.value })}>
              <option value="">— zuordnen —</option>
              {meters.map((m) => (
                <option key={m.id} value={m.id}>{m.name} · {unitName(m.unitId)}{m.meterNumber ? ` · Nr. ${m.meterNumber}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Stand
            <input inputMode="decimal" value={reading.value} onChange={(e) => onChange({ value: e.target.value })} className="input-num" />
          </label>
          <label className="field">
            Datum
            <input type="date" value={reading.date} onChange={(e) => onChange({ date: e.target.value, hasDate: true })} />
          </label>
          <label className="field checkline">
            <span>
              <input type="checkbox" checked={reading.replacement} onChange={(e) => onChange({ replacement: e.target.checked })} />
              Zählerwechsel
            </span>
          </label>
          {reading.replacement && (
            <label className="field">
              Endstand alt
              <input inputMode="decimal" value={reading.oldEndValue} onChange={(e) => onChange({ oldEndValue: e.target.value })} className="input-num" />
            </label>
          )}
        </div>
        {reading.meterNumber && <div className="muted">Gelesene Zählernummer: {reading.meterNumber}</div>}
        {rs && rs.level !== 'gruen' && (
          <div>
            {rs.reasons.map((r, j) => <span key={j} className={`chip ${rs.level}`}>{r}</span>)}
          </div>
        )}
        <div className="row">
          <div className="grow" />
          <button className="btn" onClick={onAdopt} disabled={adopting || !reading.matchedMeterId || parseNum(reading.value) === null}>
            Ablesung übernehmen
          </button>
        </div>
      </div>
    </div>
  )
}
