import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, Settlement } from '../types'
import { api, fmtEuro } from '../api'

// Ab dieser Abweichung zum Vorjahr gilt eine Kostenart als auffällig.
// Mieter dürfen Belege einsehen — größere Sprünge sollte man erklären können.
const AUFFAELLIG_PROZENT = 25

type Props = { onNavigate: (tab: string) => void }

export default function Uebersicht({ onNavigate }: Props) {
  const [year, setYear] = useState(new Date().getFullYear() - 1)
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return Promise.all([
      api<CostItem[]>('/api/costItems'),
      api<Settlement>(`/api/settlement/${year}`),
    ])
      .then(([c, s]) => { setCostItems(c); setSettlement(s); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year])

  useEffect(() => { void load() }, [load])

  // Summe je Kostenart für ein Jahr
  const byCategory = useCallback((y: number) => {
    const map = new Map<string, number>()
    for (const c of costItems.filter((c) => c.year === y)) {
      map.set(c.category, (map.get(c.category) ?? 0) + c.amountCents)
    }
    return map
  }, [costItems])

  const cur = useMemo(() => byCategory(year), [byCategory, year])
  const prev = useMemo(() => byCategory(year - 1), [byCategory, year])
  const categories = useMemo(
    () => [...new Set([...cur.keys(), ...prev.keys()])].sort((a, b) => (cur.get(b) ?? 0) - (cur.get(a) ?? 0)),
    [cur, prev],
  )
  const maxCents = Math.max(1, ...categories.map((c) => Math.max(cur.get(c) ?? 0, prev.get(c) ?? 0)))
  const hasPrev = prev.size > 0

  // Auffällige Abweichungen zum Vorjahr (nur wenn es Vorjahresdaten gibt)
  const auffaellig = categories.filter((c) => {
    const p = prev.get(c) ?? 0
    const k = cur.get(c) ?? 0
    if (p === 0 || k === 0) return false
    return Math.abs(k - p) / p * 100 >= AUFFAELLIG_PROZENT
  })

  // Jahresüberblick über alle erfassten Jahre
  const years = useMemo(() => {
    const map = new Map<number, number>()
    for (const c of costItems) map.set(c.year, (map.get(c.year) ?? 0) + c.amountCents)
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [costItems])
  const maxYearCents = Math.max(1, ...years.map(([, v]) => v))

  const distributed = settlement ? settlement.totalCostsCents - settlement.landlord.totalCents : 0

  const pctText = (catKey: string) => {
    const p = prev.get(catKey) ?? 0
    const k = cur.get(catKey) ?? 0
    if (p === 0) return k > 0 ? 'neu' : ''
    const pct = ((k - p) / p) * 100
    const s = `${pct > 0 ? '+' : ''}${pct.toLocaleString('de-DE', { maximumFractionDigits: 0 })} %`
    return s
  }

  return (
    <>
      <h1>Übersicht</h1>
      <p className="sub">Kosten im Blick: Jahresvergleich, Auffälligkeiten und der Stand der Abrechnung.</p>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <label className="field">
            Abrechnungsjahr
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, k) => new Date().getFullYear() - k).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          {settlement?.closed ? (
            <div className="field" style={{ justifyContent: 'flex-end', paddingBottom: 8 }}>
              <span><span className="badge green">Abrechnung abgeschlossen</span></span>
            </div>
          ) : (
            <div className="field" style={{ justifyContent: 'flex-end', paddingBottom: 8 }}>
              <span><span className="badge gray">Abrechnung im Entwurf</span></span>
            </div>
          )}
        </div>
      </div>

      {auffaellig.length > 0 && (
        <div className="notice">
          <strong>Auffällige Abweichung zum Vorjahr:</strong>{' '}
          {auffaellig.map((c) => `${c} (${pctText(c)})`).join(', ')} — Belege prüfen, Mieter fragen
          bei großen Sprüngen erfahrungsgemäß nach.
        </div>
      )}

      {settlement && (
        <div className="kpis">
          <div className="kpi">
            <div className="v">{fmtEuro(settlement.totalCostsCents)}</div>
            <div className="l">Gesamtkosten {year}</div>
          </div>
          <div className="kpi">
            <div className="v">{fmtEuro(distributed)}</div>
            <div className="l">auf Mieter umgelegt</div>
          </div>
          <div className="kpi">
            <div className="v">{fmtEuro(settlement.landlord.totalCents)}</div>
            <div className="l">Vermieteranteil</div>
          </div>
          {settlement.statements.map((st) => (
            <div className="kpi" key={st.tenancyId}>
              <div className="v" style={{ color: st.balanceCents >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtEuro(Math.abs(st.balanceCents))}
              </div>
              <div className="l">{st.tenantName}: {st.balanceCents >= 0 ? 'Guthaben' : 'Nachzahlung'}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Kostenarten {year}{hasPrev ? ` im Vergleich zu ${year - 1}` : ''}</h2>
        {categories.length === 0 ? (
          <div className="empty">
            Für {year} sind noch keine Kosten erfasst —{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('kosten') }}>jetzt Belege erfassen</a>.
          </div>
        ) : (
          <table className="chart-table">
            <thead>
              <tr>
                <th>Kostenart</th>
                <th style={{ width: '40%' }}>Verlauf</th>
                <th className="num">{year - 1}</th>
                <th className="num">{year}</th>
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const p = prev.get(c) ?? 0
                const k = cur.get(c) ?? 0
                const warn = auffaellig.includes(c)
                return (
                  <tr key={c}>
                    <td>{c}</td>
                    <td>
                      {hasPrev && <div className="bar prev" style={{ width: `${(p / maxCents) * 100}%` }} title={`${year - 1}: ${fmtEuro(p)}`} />}
                      <div className="bar" style={{ width: `${(k / maxCents) * 100}%` }} title={`${year}: ${fmtEuro(k)}`} />
                    </td>
                    <td className="num muted">{hasPrev ? (p ? fmtEuro(p) : '—') : '—'}</td>
                    <td className="num">{k ? fmtEuro(k) : '—'}</td>
                    <td className="num">
                      {warn ? <span className="badge red">{pctText(c)}</span> : <span className="muted">{hasPrev ? pctText(c) : ''}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Summe</td>
                <td />
                <td className="num">{hasPrev ? fmtEuro([...prev.values()].reduce((a, b) => a + b, 0)) : '—'}</td>
                <td className="num">{fmtEuro([...cur.values()].reduce((a, b) => a + b, 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {years.length > 1 && (
        <div className="card">
          <h2>Gesamtkosten im Jahresverlauf</h2>
          <table className="chart-table">
            <tbody>
              {years.map(([y, v]) => (
                <tr key={y}>
                  <td style={{ width: 60 }}>{y}</td>
                  <td>
                    <div className={`bar${y === year ? '' : ' prev'}`} style={{ width: `${(v / maxYearCents) * 100}%` }} />
                  </td>
                  <td className="num" style={{ width: 120 }}>{fmtEuro(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
