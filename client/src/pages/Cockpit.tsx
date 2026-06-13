import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CostItem, Meter, Settlement, Unit } from '../types'
import { api, fmtEuro, fmtDate } from '../api'
import { useYear } from '../year'

type Props = {
  units: Unit[]
  onNavigate: (tab: string) => void
}

// Verbrauchsangaben des Servers (gleiche Form wie auf der Zähler-Seite)
type Consumption = { meterId: string; consumption: number; readingCount: number; warnings: string[] }

type Level = 'gruen' | 'gelb' | 'rot' | 'leer'

// Eine Zeile der Bereitschafts-Checkliste. `leer` = für dieses Haus nicht nötig (zählt nicht zum
// Fortschritt). `tab` verlinkt zur Stelle, an der man das Offene erledigt.
type Check = {
  title: string
  detail: string
  level: Level
  tab?: string
  cta?: string
}

// Ab dieser Abweichung zum Vorjahr gilt eine Kostenart als auffällig (wie in der Übersicht).
const AUFFAELLIG_PROZENT = 25

export default function Cockpit({ units, onNavigate }: Props) {
  const { year } = useYear()
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [consumption, setConsumption] = useState<Consumption[]>([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return Promise.all([
      api<Settlement>(`/api/settlement/${year}`),
      api<CostItem[]>('/api/costItems'),
      api<Meter[]>('/api/meters'),
      api<Consumption[]>(`/api/consumption/${year}`),
    ])
      .then(([s, c, m, k]) => { setSettlement(s); setCostItems(c); setMeters(m); setConsumption(k); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year])

  useEffect(() => { void load() }, [load])

  // ---------- Kennzahlen des Jahres ----------
  const yearItems = useMemo(() => costItems.filter((c) => c.year === year), [costItems, year])
  const belegSum = useMemo(() => yearItems.reduce((a, c) => a + c.amountCents, 0), [yearItems])
  const belegFiles = useMemo(() => new Set(yearItems.filter((c) => c.invoiceFile).map((c) => c.invoiceFile)).size, [yearItems])
  const participating = useMemo(() => units.filter((u) => u.participates), [units])

  // Vorjahresvergleich je Kostenart (wie in der Übersicht)
  const auffaellig = useMemo(() => {
    const sumByCat = (y: number) => {
      const m = new Map<string, number>()
      for (const c of costItems) if (c.year === y) m.set(c.category, (m.get(c.category) ?? 0) + c.amountCents)
      return m
    }
    const cur = sumByCat(year)
    const prev = sumByCat(year - 1)
    if (prev.size === 0) return { hasPrev: false, list: [] as { cat: string; pct: number }[] }
    const list: { cat: string; pct: number }[] = []
    for (const [cat, k] of cur) {
      const p = prev.get(cat) ?? 0
      if (p === 0 || k === 0) continue
      const pct = ((k - p) / p) * 100
      if (Math.abs(pct) >= AUFFAELLIG_PROZENT) list.push({ cat, pct })
    }
    return { hasPrev: true, list }
  }, [costItems, year])

  // §556 Abs. 3 BGB: Zugang beim Mieter binnen 12 Monaten nach Ende des Abrechnungszeitraums.
  const deadline = useMemo(() => new Date(Date.UTC(year + 1, 11, 31)), [year])
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86400000)

  // ---------- Bereitschafts-Checkliste ----------
  const checks = useMemo<Check[]>(() => {
    if (!settlement) return []
    const list: Check[] = []

    // 1. Mietverhältnisse & Flächen
    const noArea = participating.filter((u) => !u.areaM2)
    if (settlement.statements.length === 0) {
      list.push({ title: 'Mietverhältnisse & Flächen', level: 'rot', tab: 'stammdaten', cta: 'Stammdaten prüfen',
        detail: `Keine Mietverhältnisse im Jahr ${year} — ohne sie lässt sich nichts verteilen.` })
    } else if (noArea.length > 0) {
      list.push({ title: 'Mietverhältnisse & Flächen', level: 'gelb', tab: 'stammdaten', cta: 'Wohnfläche ergänzen',
        detail: `Wohnfläche fehlt bei: ${noArea.map((u) => u.name).join(', ')}` })
    } else {
      list.push({ title: 'Mietverhältnisse & Flächen', level: 'gruen',
        detail: `${settlement.statements.length} Mietverhältnis(se) · ${participating.length} beteiligte Wohnung(en) · vollständig` })
    }

    // 2. Belege & Kosten erfasst
    if (yearItems.length === 0) {
      list.push({ title: 'Belege erfasst', level: 'rot', tab: 'schnellerfassung', cta: 'Belege erfassen',
        detail: `Für ${year} sind noch keine Kosten erfasst.` })
    } else {
      list.push({ title: 'Belege erfasst', level: 'gruen',
        detail: `${yearItems.length} Position(en) · Summe ${fmtEuro(belegSum)}${belegFiles ? ` · ${belegFiles} Belegdatei(en)` : ''}` })
    }

    // 3. Zählerstände — nur relevant, wenn verbrauchsabhängig umgelegt wird
    const meterTypes = new Set(yearItems.filter((c) => c.key === 'meter').map((c) => c.meterType))
    if (meterTypes.size === 0) {
      list.push({ title: 'Zählerstände', level: 'leer',
        detail: 'Keine verbrauchsabhängige Umlage — Ablesungen nicht erforderlich.' })
    } else {
      const relevant = meters.filter((m) => m.unitId && meterTypes.has(m.type))
      const incomplete = relevant.filter((m) => {
        const c = consumption.find((x) => x.meterId === m.id)
        return !c || c.readingCount < 2 || c.warnings.length > 0
      })
      if (incomplete.length > 0) {
        list.push({ title: 'Zählerstände', level: 'rot', tab: 'zaehler', cta: 'Stände erfassen',
          detail: `Anfang/Ende fehlt oder unplausibel bei: ${incomplete.map((m) => m.name).join(', ')}` })
      } else {
        list.push({ title: 'Zählerstände', level: 'gruen',
          detail: `${relevant.length} Zähler mit Anfangs- und Endstand erfasst.` })
      }
    }

    // 4. Plausibilität zum Vorjahr
    if (yearItems.length === 0) {
      list.push({ title: 'Plausibilität zum Vorjahr', level: 'leer', detail: 'Noch keine Kosten zum Vergleichen.' })
    } else if (!auffaellig.hasPrev) {
      list.push({ title: 'Plausibilität zum Vorjahr', level: 'leer', detail: `Kein Vorjahr (${year - 1}) zum Vergleichen erfasst.` })
    } else if (auffaellig.list.length > 0) {
      const txt = auffaellig.list
        .map((a) => `${a.cat} (${a.pct > 0 ? '+' : ''}${Math.round(a.pct)} %)`)
        .join(', ')
      list.push({ title: 'Plausibilität zum Vorjahr', level: 'gelb', tab: 'uebersicht', cta: 'Vergleich ansehen',
        detail: `Auffällige Abweichung: ${txt} — Beleg prüfen, Mieter ggf. erklären.` })
    } else {
      list.push({ title: 'Plausibilität zum Vorjahr', level: 'gruen', detail: `Keine auffälligen Sprünge gegenüber ${year - 1}.` })
    }

    // 5. Hinweise der Berechnung (z. B. negativer Verbrauch)
    if (settlement.warnings.length > 0) {
      list.push({ title: 'Hinweise der Berechnung', level: 'gelb', tab: 'abrechnung', cta: 'Abrechnung ansehen',
        detail: settlement.warnings.join(' · ') })
    }

    // 6. Abschluss & Versand
    const closed = settlement.closed
    if (closed?.sentAt) {
      const ok = closed.sentAt <= `${year + 1}-12-31`
      list.push({ title: 'Abgeschlossen & versendet', level: ok ? 'gruen' : 'rot',
        detail: `Versendet am ${fmtDate(closed.sentAt)} — Frist nach §556 BGB ${ok ? 'gewahrt' : 'überschritten'}.` })
    } else if (closed) {
      list.push({ title: 'Abgeschlossen & versendet', level: 'gelb', tab: 'abrechnung', cta: 'Versanddatum eintragen',
        detail: 'Abgeschlossen, aber Versanddatum fehlt — für die §556-Frist nachtragen.' })
    } else {
      const fristTxt = daysLeft >= 0
        ? `Noch ${daysLeft} Tage bis zur Frist (31.12.${year + 1}).`
        : `Frist am 31.12.${year + 1} abgelaufen.`
      list.push({ title: 'Abgeschlossen & versendet', level: daysLeft < 0 ? 'rot' : 'gelb', tab: 'abrechnung', cta: 'Zur Abrechnung',
        detail: `Noch im Entwurf. ${fristTxt}` })
    }

    return list
  }, [settlement, participating, yearItems, belegSum, belegFiles, meters, consumption, auffaellig, daysLeft, year])

  const relevant = checks.filter((c) => c.level !== 'leer')
  const greenCount = relevant.filter((c) => c.level === 'gruen').length
  const pct = relevant.length ? Math.round((greenCount / relevant.length) * 100) : 0
  // Nächster Schritt: erst rote, dann gelbe offene Punkte
  const next = checks.find((c) => c.level === 'rot' && c.tab) ?? checks.find((c) => c.level === 'gelb' && c.tab)
  const offen = relevant.length - greenCount

  const statusBadge = settlement?.closed?.sentAt
    ? <span className="badge green">versendet</span>
    : settlement?.closed
      ? <span className="badge green">abgeschlossen</span>
      : <span className="badge gray">Entwurf</span>

  const distributed = settlement ? settlement.totalCostsCents - settlement.landlord.totalCents : 0
  const fresh = settlement && settlement.statements.length === 0 && yearItems.length === 0

  return (
    <>
      <div className="statement-head">
        <div>
          <h1 style={{ marginBottom: 2 }}>Abrechnung {year}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {settlement
              ? offen === 0
                ? 'Alles bereit — die Abrechnung ist vollständig.'
                : `Noch ${offen} ${offen === 1 ? 'Punkt' : 'Punkte'} offen, dann ist die Abrechnung versandfertig.`
              : 'Lade Abrechnungsstand …'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {statusBadge}
          {settlement && !settlement.closed && (
            <span className={`badge ${daysLeft < 0 ? 'red' : daysLeft < 90 ? 'gray' : 'gray'}`}>
              {daysLeft >= 0 ? `Frist in ${daysLeft} Tagen` : 'Frist abgelaufen'}
            </span>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {fresh ? (
        <div className="card">
          <div className="empty">
            <p>Noch nichts für {year} erfasst. So fängst du an:</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn secondary" onClick={() => onNavigate('stammdaten')}>🏠 Stammdaten anlegen</button>
              <button className="btn" onClick={() => onNavigate('schnellerfassung')}>📥 Belege zur Schnellerfassung</button>
            </div>
          </div>
        </div>
      ) : settlement && (
        <>
          {/* Fortschritt */}
          <div className="card">
            <div className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ flex: 1 }}>Fertigstellung</strong>
              <span className="muted">{greenCount} von {relevant.length} erledigt</span>
            </div>
            <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>

            <div className="checklist">
              {checks.map((c, i) => {
                const clickable = c.level !== 'gruen' && c.level !== 'leer' && c.tab
                return (
                  <div
                    key={i}
                    className={`check-row ${c.level}${clickable ? ' clickable' : ''}`}
                    onClick={clickable ? () => onNavigate(c.tab!) : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onNavigate(c.tab!) } : undefined}
                  >
                    <span className={`ampel ${c.level === 'leer' ? '' : c.level}`} style={c.level === 'leer' ? { background: 'var(--line)' } : undefined} />
                    <div className="grow">
                      <div className="check-title">{c.title}</div>
                      <div className="muted">{c.detail}</div>
                    </div>
                    {clickable && <span className="check-cta">{c.cta} →</span>}
                  </div>
                )
              })}
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              {next ? (
                <button className="btn" onClick={() => onNavigate(next.tab!)}>→ Nächster Schritt: {next.cta}</button>
              ) : (
                <button className="btn" onClick={() => onNavigate('abrechnung')}>✓ Zur Abrechnung — abschließen & versenden</button>
              )}
              <button className="btn ghost" onClick={() => onNavigate('uebersicht')}>Kostenvergleich</button>
            </div>
          </div>

          {/* Kennzahlen */}
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
          </div>

          {/* Ergebnis je Mieter */}
          {settlement.statements.length > 0 && (
            <div className="card">
              <h2>Voraussichtliches Ergebnis je Mieter</h2>
              <div className="tenant-cards">
                {settlement.statements.map((st) => {
                  const guthaben = st.balanceCents >= 0
                  return (
                    <button key={st.tenancyId} className="tenant-card" onClick={() => onNavigate('abrechnung')}>
                      <div className="muted">{st.unitName} · {st.tenantName}</div>
                      <div className="tenant-bal" style={{ color: guthaben ? 'var(--green)' : 'var(--red)' }}>
                        {fmtEuro(Math.abs(st.balanceCents))}
                      </div>
                      <div className="muted">{guthaben ? 'Guthaben' : 'Nachzahlung'}</div>
                    </button>
                  )
                })}
                {units.filter((u) => !u.participates).map((u) => (
                  <div key={u.id} className="tenant-card muted-card">
                    <div className="muted">{u.name}</div>
                    <div className="tenant-bal" style={{ color: 'var(--muted)' }}>—</div>
                    <div className="muted">selbst bewohnt</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
