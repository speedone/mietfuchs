import { Fragment, useCallback, useEffect, useState } from 'react'
import type { Settings, TaxReport } from '../types'
import { api, fmtEuro } from '../api'
import { useYear, YEAR_OPTIONS } from '../year'

type Props = { settings: Settings | null }

// Einnahmen lassen sich nach zwei Prinzipien ansetzen: das vereinbarte Soll oder das
// tatsächlich Zugeflossene (Zuflussprinzip — steuerlich maßgeblich). Beide werden geliefert,
// umschaltbar, damit der Nutzer abgleichen kann.
type Basis = 'soll' | 'ist'

export default function Steuer({ settings }: Props) {
  const { year, setYear } = useYear()
  const [data, setData] = useState<TaxReport | null>(null)
  // Standard: vereinbartes Soll — liefert auch ohne erfasste Zahlungen eine sinnvolle Zahl.
  // Wer die Eingänge im Mietkonto pflegt, kann auf das (steuerlich maßgebliche) Ist umschalten.
  const [basis, setBasis] = useState<Basis>('soll')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return api<TaxReport>(`/api/taxreport/${year}`)
      .then((d) => { setData(d); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year])

  useEffect(() => { void load() }, [load])

  function print() {
    const prevTitle = document.title
    document.title = `Steuerübersicht Anlage V ${year}`.replace(/[\\/:*?"<>|]/g, '-')
    const restore = () => { document.title = prevTitle; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    setTimeout(() => window.print(), 60)
  }

  const incomeCents = data ? (basis === 'soll' ? data.income.sollCents : data.income.paidCents) : 0
  const surplusCents = data ? (basis === 'soll' ? data.surplusSollCents : data.surplusPaidCents) : 0
  const sharePct = data ? Math.round(data.rentedAreaShare * 1000) / 10 : 0

  return (
    <>
      <div className="no-print">
        <h1>Steuer · Anlage V</h1>
        <p className="sub">Jahresübersicht für die Einkünfte aus Vermietung — Einnahmen, Werbungskosten und Überschuss. Als PDF speichern über „Drucken".</p>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card no-print">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field">
            Jahr
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="field">
            Einnahmen ansetzen als
            <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              <option value="soll">vereinbart (Soll)</option>
              <option value="ist">tatsächlich gezahlt (Zuflussprinzip)</option>
            </select>
          </label>
          <div className="field grow" />
          <button className="btn secondary" onClick={print} disabled={!data}>🖨 Drucken / PDF</button>
        </div>
      </div>

      {data && (
        <>
          <div className="kpis no-print">
            <div className="kpi">
              <div className="v">{fmtEuro(incomeCents)}</div>
              <div className="l">Einnahmen {year}</div>
            </div>
            <div className="kpi">
              <div className="v">{fmtEuro(data.expenses.totalCents)}</div>
              <div className="l">Werbungskosten</div>
            </div>
            <div className="kpi">
              <div className="v" style={{ color: surplusCents >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtEuro(surplusCents)}
              </div>
              <div className="l">{surplusCents >= 0 ? 'Überschuss' : 'Verlust'} (Einkünfte)</div>
            </div>
          </div>

          <div className="card">
            <div className="muted" style={{ marginBottom: 8 }}>
              {settings?.landlordName && <>{settings.landlordName} · </>}
              {settings?.houseName}{settings?.address ? ` · ${settings.address}` : ''}
            </div>
            <h2 style={{ marginBottom: 2 }}>Steuerübersicht {year} — Einkünfte aus Vermietung und Verpachtung</h2>
            <div className="muted" style={{ marginBottom: 14 }}>
              Einnahmen angesetzt als {basis === 'soll' ? 'vereinbartes Soll' : 'tatsächlich gezahlt (Zuflussprinzip)'}.
              Werbungskosten nach Abflussprinzip (im Jahr gebuchte Kosten).
            </div>

            <h3>Einnahmen</h3>
            <table>
              <tbody>
                <tr>
                  <td>Mieteinnahmen ohne Umlagen (Kaltmiete, vereinbart)</td>
                  <td className="num">{fmtEuro(data.income.baseRentSollCents)}</td>
                </tr>
                <tr>
                  <td>Umlagen / Nebenkosten-Vorauszahlungen (vereinbart)</td>
                  <td className="num">{fmtEuro(data.income.prepaymentSollCents)}</td>
                </tr>
                <tr className="subtotal">
                  <td><strong>Summe Soll (brutto)</strong></td>
                  <td className="num"><strong>{fmtEuro(data.income.sollCents)}</strong></td>
                </tr>
                <tr>
                  <td>davon tatsächlich eingegangen {data.income.paidCents < data.income.sollCents && <span className="muted">(Rückstand offen)</span>}</td>
                  <td className="num">{fmtEuro(data.income.paidCents)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Angesetzte Einnahmen ({basis === 'soll' ? 'Soll' : 'Ist'})</td>
                  <td className="num">{fmtEuro(incomeCents)}</td>
                </tr>
              </tfoot>
            </table>

            <h3 style={{ marginTop: 18 }}>Werbungskosten</h3>
            {data.expenses.groups.length === 0 ? (
              <div className="empty">Keine Kostenpositionen für {year} erfasst.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Position</th>
                    <th className="num">Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.groups.map((g) => (
                    <Fragment key={g.group}>
                      {g.categories.map((c) => (
                        <tr key={c.category}>
                          <td>
                            <span className="muted">{g.group} · </span>{c.category}
                          </td>
                          <td className="num">{fmtEuro(c.amountCents)}</td>
                        </tr>
                      ))}
                      {g.categories.length > 1 && (
                        <tr className="subtotal">
                          <td>Summe {g.group}</td>
                          <td className="num">{fmtEuro(g.amountCents)}</td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Summe Werbungskosten</td>
                    <td className="num">{fmtEuro(data.expenses.totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            <h3 style={{ marginTop: 18 }}>Ergebnis</h3>
            <table>
              <tbody>
                <tr>
                  <td>Einnahmen ({basis === 'soll' ? 'Soll' : 'Ist'})</td>
                  <td className="num">{fmtEuro(incomeCents)}</td>
                </tr>
                <tr>
                  <td>abzüglich Werbungskosten</td>
                  <td className="num">− {fmtEuro(data.expenses.totalCents)}</td>
                </tr>
                <tr className="subtotal">
                  <td><strong>{surplusCents >= 0 ? 'Überschuss (Einkünfte)' : 'Verlust (negative Einkünfte)'}</strong></td>
                  <td className="num">
                    <strong style={{ color: surplusCents >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtEuro(surplusCents)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>

            {data.expenses.labor35aCents > 0 && (
              <p className="muted" style={{ marginTop: 14 }}>
                In den Werbungskosten enthaltene Arbeitskosten (§35a EStG, haushaltsnahe
                Dienstleistungen/Handwerker): <strong>{fmtEuro(data.expenses.labor35aCents)}</strong>.
                Diese werden den Mietern in der Nebenkostenabrechnung bescheinigt.
              </p>
            )}

            {data.selfOccupiedExists && (
              <div className="notice" style={{ marginTop: 14 }}>
                <strong>Gemischt genutztes Gebäude.</strong> Es gibt selbstgenutzte (nicht vermietete)
                Einheiten — der vermietete Flächenanteil beträgt <strong>{sharePct.toLocaleString('de-DE')} %</strong>.
                Werbungskosten, die das gesamte Gebäude betreffen, sind nur anteilig (nach Fläche) abziehbar;
                der auf die selbstgenutzte Wohnung entfallende Teil ist privat. Bitte den abziehbaren Anteil
                mit dem Steuerberater abstimmen — diese Übersicht nimmt die Aufteilung nicht automatisch vor.
              </div>
            )}

            <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
              Diese Übersicht ist eine Aufbereitung der erfassten Daten und <strong>keine Steuerberatung</strong>.
              Maßgeblich sind die amtlichen Formulare und Hinweise der Anlage V des jeweiligen Jahres.
            </p>
          </div>
        </>
      )}
    </>
  )
}
