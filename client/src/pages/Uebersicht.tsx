import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, HeatingPlant, Settlement } from '../types'
import { api, fmtEuro } from '../api'
import { usePeriod } from '../period'
import { periodCosts } from '../costPeriods'
import { PeriodSelect } from '../components/PeriodSelect'
import { useProperty, withProperty } from '../property'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'

// Ab dieser Abweichung zum Vorjahr gilt eine Kostenart als auffällig.
// Mieter dürfen Belege einsehen — größere Sprünge sollte man erklären können.
const NOTABLE_CHANGE_PCT = 25

type Props = { onNavigate: (tab: string) => void }

export default function Uebersicht({ onNavigate }: Props) {
  const { key, label, param, at, rules } = usePeriod()
  const { property } = useProperty()
  const propertyId = property?.id
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [plants, setPlants] = useState<HeatingPlant[]>([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return Promise.all([
      api<CostItem[]>(withProperty('/api/costItems', propertyId)),
      api<Settlement>(withProperty(`/api/settlement/${param}`, propertyId)),
      // Die Anlagen sagen, in welchem Zeitraum eine Heizposition abgerechnet wird (E48). Fehlen sie
      // (älterer Server), bleibt jede Position bei ihrem Schlüssel.
      api<HeatingPlant[]>(withProperty('/api/heating-plants', propertyId)).catch(() => []),
    ])
      .then(([c, s, h]) => { setCostItems(c); setSettlement(s); setPlants(h); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [param, propertyId])

  useEffect(() => { void load() }, [load])

  // Die Kosten je Abrechnungszeitraum (#208), Heizpositionen im Zeitraum, in dem ihre Heizperiode
  // endet (E48), wie auf der Seite Kosten und in der Abrechnung.
  const periods = useMemo(() => periodCosts(costItems, rules, plants), [costItems, rules, plants])
  const cur = useMemo(() => periods.find((p) => p.key === key)?.byCategory ?? new Map<string, number>(), [periods, key])
  const prev = useMemo(() => periods.find((p) => p.key === at.previous)?.byCategory ?? new Map<string, number>(), [periods, at.previous])
  // Nach Weg d stehen die Heizkosten in einer eigenen Heizkostenabrechnung; die Kennzahl zählt sie
  // mit, sonst wiche sie von der Summe der Kostenarten ab.
  const separateCents = periods.find((p) => p.key === key)?.separateCents ?? 0
  // Die Salden gehören zur Betriebskostenabrechnung; ohne deren Kosten sind sie kein Ergebnis (#142).
  const settledCosts = (periods.find((p) => p.key === key)?.totalCents ?? 0) - separateCents !== 0
  // Ohne Kosten im Jahr gibt es nichts zu vergleichen (#142): Jede Kostenart des Vorjahres stünde
  // sonst mit „−100 %“ da, und das hieße nur, dass noch nichts erfasst ist.
  const hasCosts = cur.size > 0
  const categories = useMemo(
    () => (hasCosts ? [...new Set([...cur.keys(), ...prev.keys()])].sort((a, b) => (cur.get(b) ?? 0) - (cur.get(a) ?? 0)) : []),
    [cur, prev, hasCosts],
  )
  const maxCents = Math.max(1, ...categories.map((c) => Math.max(cur.get(c) ?? 0, prev.get(c) ?? 0)))
  const hasPrev = prev.size > 0

  // Auffällige Abweichungen zum Vorjahr (nur wenn es Vorjahresdaten gibt)
  const notable = categories.filter((c) => {
    const p = prev.get(c) ?? 0
    const k = cur.get(c) ?? 0
    if (p === 0 || k === 0) return false
    return Math.abs(k - p) / p * 100 >= NOTABLE_CHANGE_PCT
  })

  const maxYearCents = Math.max(1, ...periods.map((p) => p.totalCents))

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
      <PageHeader title="Übersicht" subtitle="Kosten im Blick: Jahresvergleich, Auffälligkeiten und der Stand der Abrechnung." />
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <PeriodSelect />
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

      {notable.length > 0 && (
        <div className="notice">
          <strong>Auffällige Abweichung zum Vorjahr:</strong>{' '}
          {notable.map((c) => `${c} (${pctText(c)})`).join(', ')} — Belege prüfen, Mieter fragen
          bei großen Sprüngen erfahrungsgemäß nach.
        </div>
      )}

      {settlement && (
        <div className="kpis">
          <div className="kpi">
            <div className="v">{fmtEuro(settlement.totalCostsCents + separateCents)}</div>
            <div className="l">Gesamtkosten {label}</div>
          </div>
          <div className="kpi">
            <div className="v">{fmtEuro(distributed)}</div>
            <div className="l">auf Mieter umgelegt</div>
          </div>
          <div className="kpi">
            <div className="v">{fmtEuro(settlement.landlord.totalCents)}</div>
            <div className="l">Vermieteranteil</div>
          </div>
          {/* Ohne Kosten erstattete die Berechnung die volle Vorauszahlung (#142); das ist kein Ergebnis. */}
          {settledCosts && settlement.statements.map((st) => (
            <div className="kpi" key={st.tenancyId}>
              <div className="v" style={{ color: st.balanceCents >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtEuro(Math.abs(st.balanceCents))}
              </div>
              <div className="l">{st.tenantName}: {st.balanceCents >= 0 ? 'Guthaben' : 'Nachzahlung'}</div>
            </div>
          ))}
        </div>
      )}
      {settlement && separateCents > 0 && (
        <p className="muted">
          Darin {fmtEuro(separateCents)} Heizkosten, die eine eigene Heizkostenabrechnung abrechnet. „Auf Mieter umgelegt“,
          „Vermieteranteil“ und die Salden gelten für die Betriebskostenabrechnung {label} ohne diese Heizkosten.
        </p>
      )}

      <div className="card">
        <h2>Kostenarten {label}{hasCosts && hasPrev ? ` im Vergleich zu ${at.previousLabel}` : ''}</h2>
        {categories.length === 0 ? (
          <div className="empty">
            Für {label} sind noch keine Kosten erfasst —{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('kosten') }}>jetzt Belege erfassen</a>.
          </div>
        ) : (
          <Table className="chart-table">
            <thead>
              <tr>
                <th>Kostenart</th>
                <th style={{ width: '40%' }}>Verlauf</th>
                <th className="num">{at.previousLabel}</th>
                <th className="num">{label}</th>
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const p = prev.get(c) ?? 0
                const k = cur.get(c) ?? 0
                const warn = notable.includes(c)
                return (
                  <tr key={c}>
                    <td>{c}</td>
                    <td>
                      {hasPrev && <div className="bar prev" style={{ width: `${(p / maxCents) * 100}%` }} title={`${at.previousLabel}: ${fmtEuro(p)}`} />}
                      <div className="bar" style={{ width: `${(k / maxCents) * 100}%` }} title={`${label}: ${fmtEuro(k)}`} />
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
          </Table>
        )}
      </div>

      {periods.length > 1 && (
        <div className="card">
          <h2>Gesamtkosten im Verlauf</h2>
          <Table className="chart-table">
            <tbody>
              {periods.map((p) => (
                <tr key={p.key}>
                  <td style={{ width: 140 }}>{p.label}</td>
                  <td>
                    <div className={`bar${p.key === key ? '' : ' prev'}`} style={{ width: `${(p.totalCents / maxYearCents) * 100}%` }} />
                  </td>
                  <td className="num" style={{ width: 120 }}>{fmtEuro(p.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  )
}
