import { useEffect, useState } from 'react'
import type { Settings, Tenancy, Unit } from '../types'
import { api, fmtDate, fmtEuro, parseEuro } from '../api'

type Props = {
  units: Unit[]
  tenancies: Tenancy[]
  settings: Settings | null
  reload: () => Promise<void>
}

type UnitForm = { id?: string; name: string; areaM2: string; participates: boolean }
type TenancyForm = {
  id?: string
  unitId: string
  tenantName: string
  personHistory: { from: string; persons: string }[]
  start: string
  end: string
  prepayments: { from: string; amount: string }[]
}

const EMPTY_UNIT: UnitForm = { name: '', areaM2: '', participates: true }

export default function Stammdaten({ units, tenancies, settings, reload }: Props) {
  const [house, setHouse] = useState({ houseName: '', address: '' })
  const [houseSaved, setHouseSaved] = useState(false)
  const [unitForm, setUnitForm] = useState<UnitForm | null>(null)
  const [tenForm, setTenForm] = useState<TenancyForm | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (settings) setHouse({ houseName: settings.houseName, address: settings.address })
  }, [settings])

  async function saveHouse() {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(house) })
    await reload()
    setHouseSaved(true)
    setTimeout(() => setHouseSaved(false), 2500)
  }

  async function saveUnit() {
    if (!unitForm) return
    const area = Number(unitForm.areaM2.replace(',', '.'))
    if (!unitForm.name.trim() || !Number.isFinite(area) || area <= 0) {
      setError('Bitte Name und gültige Wohnfläche angeben.')
      return
    }
    setError('')
    const body = JSON.stringify({ name: unitForm.name.trim(), areaM2: area, participates: unitForm.participates })
    if (unitForm.id) await api(`/api/units/${unitForm.id}`, { method: 'PUT', body })
    else await api('/api/units', { method: 'POST', body })
    setUnitForm(null)
    await reload()
  }

  async function deleteUnit(u: Unit) {
    if (!confirm(`Wohnung „${u.name}" und zugehörige Mietverhältnisse wirklich löschen?`)) return
    await api(`/api/units/${u.id}`, { method: 'DELETE' })
    await reload()
  }

  async function saveTenancy() {
    if (!tenForm) return
    if (!tenForm.tenantName.trim() || !tenForm.unitId || !tenForm.start) {
      setError('Bitte Mieter, Wohnung und Einzugsdatum prüfen.')
      return
    }
    const personHistory: { from: string; persons: number }[] = []
    for (const [i, row] of tenForm.personHistory.entries()) {
      const persons = Number(row.persons)
      const from = row.from || (i === 0 ? tenForm.start : '')
      if (!Number.isInteger(persons) || persons < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        setError('Bitte Personen-Staffel prüfen (Datum und ganze Personenzahl).')
        return
      }
      personHistory.push({ from, persons })
    }
    if (personHistory.length === 0) {
      setError('Mindestens eine Personenzahl angeben.')
      return
    }
    personHistory.sort((a, b) => a.from.localeCompare(b.from))
    const prepayments: { from: string; monthlyCents: number }[] = []
    for (const row of tenForm.prepayments) {
      if (!row.from && !row.amount.trim()) continue // leere Zeile überspringen
      const cents = parseEuro(row.amount)
      const from = row.from || tenForm.start.slice(0, 7)
      if (cents === null || !/^\d{4}-\d{2}$/.test(from)) {
        setError('Bitte Vorauszahlungs-Staffel prüfen (Monat und Betrag).')
        return
      }
      prepayments.push({ from, monthlyCents: cents })
    }
    setError('')
    const body = JSON.stringify({
      unitId: tenForm.unitId,
      tenantName: tenForm.tenantName.trim(),
      persons: personHistory[personHistory.length - 1].persons,
      personHistory,
      start: tenForm.start,
      end: tenForm.end || null,
      prepayments,
    })
    if (tenForm.id) await api(`/api/tenancies/${tenForm.id}`, { method: 'PUT', body })
    else await api('/api/tenancies', { method: 'POST', body })
    setTenForm(null)
    await reload()
  }

  async function deleteTenancy(t: Tenancy) {
    if (!confirm(`Mietverhältnis „${t.tenantName}" wirklich löschen?`)) return
    await api(`/api/tenancies/${t.id}`, { method: 'DELETE' })
    await reload()
  }

  const participating = units.filter((u) => u.participates)

  return (
    <>
      <h1>Stammdaten</h1>
      <p className="sub">Haus, Wohnungen und Mietverhältnisse — die Grundlage jeder Abrechnung.</p>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2>Haus</h2>
        <div className="row">
          <label className="field grow">
            Bezeichnung
            <input value={house.houseName} onChange={(e) => setHouse({ ...house, houseName: e.target.value })} placeholder="z. B. Mehrfamilienhaus Musterstraße" />
          </label>
          <label className="field grow">
            Adresse
            <input value={house.address} onChange={(e) => setHouse({ ...house, address: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
          </label>
          <button className="btn" onClick={saveHouse}>Speichern</button>
        </div>
        {houseSaved && <div className="ok">Gespeichert.</div>}
      </div>

      <div className="card">
        <h2>Wohnungen</h2>
        {units.length === 0 && <div className="empty">Noch keine Wohnungen angelegt. Lege alle Wohnungen des Hauses an — auch die selbstgenutzte.</div>}
        {units.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Wohnfläche</th>
                <th>Kostenverteilung</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="num">{u.areaM2.toLocaleString('de-DE')} m²</td>
                  <td>
                    {u.participates ? (
                      <span className="badge green">beteiligt</span>
                    ) : (
                      <span className="badge gray">Eigennutzung — nicht beteiligt</span>
                    )}
                  </td>
                  <td className="num no-print">
                    <button className="btn small secondary" onClick={() => setUnitForm({ id: u.id, name: u.name, areaM2: String(u.areaM2).replace('.', ','), participates: u.participates })}>Bearbeiten</button>{' '}
                    <button className="btn small ghost" onClick={() => deleteUnit(u)}>Löschen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {unitForm ? (
          <div className="row" style={{ marginTop: 16 }}>
            <label className="field grow">
              Name
              <input value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} placeholder="z. B. OG links" />
            </label>
            <label className="field">
              Wohnfläche (m²)
              <input value={unitForm.areaM2} onChange={(e) => setUnitForm({ ...unitForm, areaM2: e.target.value })} style={{ width: 110 }} placeholder="z. B. 85,5" />
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 9 }}>
              <input type="checkbox" checked={unitForm.participates} onChange={(e) => setUnitForm({ ...unitForm, participates: e.target.checked })} />
              an Kostenverteilung beteiligt
            </label>
            <button className="btn" onClick={saveUnit}>{unitForm.id ? 'Übernehmen' : 'Anlegen'}</button>
            <button className="btn ghost" onClick={() => setUnitForm(null)}>Abbrechen</button>
          </div>
        ) : (
          <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => setUnitForm({ ...EMPTY_UNIT })}>+ Wohnung hinzufügen</button>
        )}
        {units.length > 0 && participating.length === 0 && (
          <div className="notice" style={{ marginTop: 14 }}>Keine Wohnung ist an der Kostenverteilung beteiligt — die Abrechnung wäre leer.</div>
        )}
      </div>

      <div className="card">
        <h2>Mietverhältnisse</h2>
        <p className="muted">
          Personenzahl und Vorauszahlung werden als Staffel erfasst („ab X gilt Y") — Änderungen
          wie Geburt, Auszug einzelner Personen oder Vorauszahlungs-Erhöhungen brauchen kein
          neues Mietverhältnis. Nur bei echtem Mieterwechsel das alte Mietverhältnis beenden
          und ein neues anlegen.
        </p>
        {tenancies.length === 0 && <div className="empty">Noch keine Mietverhältnisse angelegt.</div>}
        {tenancies.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Mieter</th>
                <th>Wohnung</th>
                <th className="num">Personen</th>
                <th>Zeitraum</th>
                <th className="num">Vorauszahlung/Monat</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {tenancies.map((t) => (
                <tr key={t.id}>
                  <td>{t.tenantName}</td>
                  <td>{units.find((u) => u.id === t.unitId)?.name ?? '—'}</td>
                  <td className="num">
                    {(t.personHistory ?? []).map((p, i) => (
                      <div key={i}>
                        {(t.personHistory?.length ?? 0) > 1 && <span className="muted">ab {fmtDate(p.from)}: </span>}
                        {p.persons}
                      </div>
                    ))}
                  </td>
                  <td>
                    {fmtDate(t.start)} – {t.end ? fmtDate(t.end) : 'laufend'}
                  </td>
                  <td className="num">
                    {t.prepayments.length === 0 && '—'}
                    {t.prepayments.map((p, i) => (
                      <div key={i}>
                        {t.prepayments.length > 1 && <span className="muted">ab {p.from.slice(5, 7)}/{p.from.slice(0, 4)}: </span>}
                        {fmtEuro(p.monthlyCents)}
                      </div>
                    ))}
                  </td>
                  <td className="num no-print">
                    <button
                      className="btn small secondary"
                      onClick={() =>
                        setTenForm({
                          id: t.id,
                          unitId: t.unitId,
                          tenantName: t.tenantName,
                          personHistory: (t.personHistory ?? [{ from: t.start, persons: t.persons }]).map((p) => ({
                            from: p.from,
                            persons: String(p.persons),
                          })),
                          start: t.start,
                          end: t.end ?? '',
                          prepayments: t.prepayments.map((p) => ({
                            from: p.from,
                            amount: (p.monthlyCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }),
                          })),
                        })
                      }
                    >
                      Bearbeiten
                    </button>{' '}
                    <button className="btn small ghost" onClick={() => deleteTenancy(t)}>Löschen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tenForm ? (
          <div className="row" style={{ marginTop: 16 }}>
            <label className="field grow">
              Mieter
              <input value={tenForm.tenantName} onChange={(e) => setTenForm({ ...tenForm, tenantName: e.target.value })} placeholder="z. B. Familie Müller" />
            </label>
            <label className="field">
              Wohnung
              <select value={tenForm.unitId} onChange={(e) => setTenForm({ ...tenForm, unitId: e.target.value })}>
                <option value="">— wählen —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Einzug
              <input type="date" value={tenForm.start} onChange={(e) => setTenForm({ ...tenForm, start: e.target.value })} />
            </label>
            <label className="field">
              Auszug (leer = laufend)
              <input type="date" value={tenForm.end} onChange={(e) => setTenForm({ ...tenForm, end: e.target.value })} />
            </label>
            <div style={{ width: '100%' }}>
              <div className="field" style={{ marginBottom: 4 }}>Personenzahl (Staffel — bei Geburt/Auszug einzelner Personen neue Zeile hinzufügen)</div>
              {tenForm.personHistory.map((p, i) => (
                <div className="row" key={i} style={{ marginBottom: 6 }}>
                  <label className="field">
                    gültig ab
                    <input type="date" value={p.from} onChange={(e) => setTenForm({ ...tenForm, personHistory: tenForm.personHistory.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                  </label>
                  <label className="field">
                    Personen
                    <input value={p.persons} style={{ width: 80 }} onChange={(e) => setTenForm({ ...tenForm, personHistory: tenForm.personHistory.map((x, k) => (k === i ? { ...x, persons: e.target.value } : x)) })} />
                  </label>
                  {tenForm.personHistory.length > 1 && (
                    <button className="btn small ghost" onClick={() => setTenForm({ ...tenForm, personHistory: tenForm.personHistory.filter((_, k) => k !== i) })}>entfernen</button>
                  )}
                </div>
              ))}
              <button className="btn small secondary" onClick={() => setTenForm({ ...tenForm, personHistory: [...tenForm.personHistory, { from: '', persons: '' }] })}>+ Änderung ab Datum …</button>
            </div>
            <div style={{ width: '100%' }}>
              <div className="field" style={{ marginBottom: 4 }}>Vorauszahlung pro Monat (Staffel — bei Erhöhung neue Zeile hinzufügen)</div>
              {tenForm.prepayments.map((p, i) => (
                <div className="row" key={i} style={{ marginBottom: 6 }}>
                  <label className="field">
                    gültig ab
                    <input type="month" value={p.from} placeholder="Einzugsmonat" onChange={(e) => setTenForm({ ...tenForm, prepayments: tenForm.prepayments.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                  </label>
                  <label className="field">
                    Betrag €/Monat
                    <input value={p.amount} style={{ width: 120 }} placeholder="z. B. 150,00" onChange={(e) => setTenForm({ ...tenForm, prepayments: tenForm.prepayments.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                  </label>
                  {tenForm.prepayments.length > 1 && (
                    <button className="btn small ghost" onClick={() => setTenForm({ ...tenForm, prepayments: tenForm.prepayments.filter((_, k) => k !== i) })}>entfernen</button>
                  )}
                </div>
              ))}
              <button className="btn small secondary" onClick={() => setTenForm({ ...tenForm, prepayments: [...tenForm.prepayments, { from: '', amount: '' }] })}>+ Erhöhung ab Monat …</button>
            </div>
            <button className="btn" onClick={saveTenancy}>{tenForm.id ? 'Übernehmen' : 'Anlegen'}</button>
            <button className="btn ghost" onClick={() => setTenForm(null)}>Abbrechen</button>
          </div>
        ) : (
          <button
            className="btn secondary"
            style={{ marginTop: 14 }}
            onClick={() => setTenForm({ unitId: units[0]?.id ?? '', tenantName: '', personHistory: [{ from: '', persons: '2' }], start: '', end: '', prepayments: [{ from: '', amount: '' }] })}
            disabled={units.length === 0}
          >
            + Mietverhältnis hinzufügen
          </button>
        )}
      </div>
    </>
  )
}
