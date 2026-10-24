// Die Kontrollansicht der Abrechnung (#321): aufklappbar, nur am Bildschirm. Je Position stehen alle Mieter und die
// Gründe des Vermieters nebeneinander, die Summe gegen den Rechnungsbetrag. Logik in controlView.ts.

import { useMemo, useState } from 'react'
import { fmtEuro } from '../api'
import { controlView } from '../controlView'
import type { Settlement } from '../types'
import Card from './Card'
import { NoticeBox } from './Notice'
import Table from './Table'

const cell = (cents: number) => (cents === 0 ? '–' : fmtEuro(cents))

// `embedded`: nur der aufklappbare Abschnitt, ohne eigene Karte (in der Karte „Kontrolle“ der Seite Abrechnung).
export default function ControlView({ data, embedded = false }: { data: Pick<Settlement, 'statements' | 'landlord'> & Partial<Pick<Settlement, 'separateHeating' | 'closed'>>, embedded?: boolean }) {
  const [open, setOpen] = useState(false)
  const view = useMemo(() => controlView(data), [data])
  if (view.items.length === 0 && view.extras.length === 0) return null
  const columns = view.landlordColumns
  const span = 2 + view.tenants.length + columns.length + 2
  const section = (
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{embedded ? 'Kontrollansicht: alle Empfänger je Position nebeneinander' : 'Alle Empfänger je Position nebeneinander'}</summary>
        {open && (
          <>
            <p className="muted">
              Zur Probe vor dem Abschließen: Jede Zeile zeigt, wie sich der Rechnungsbetrag auf die Mieter und den Vermieter verteilt. Die Summe muss dem Rechnungsbetrag entsprechen. Angezeigt wird nur, was die Abrechnung schon enthält.
              {data.separateHeating && data.separateHeating.length > 0 && ' Getrennt abgerechnete Heizkosten stehen nicht darin.'}
            </p>
            {view.hasDifference && (
              <NoticeBox level="error" title="Die Verteilung geht nicht auf" action={`Mindestens eine Position, ein Mieter oder die Sonderzeilen weichen von der Summe ab (Spalte „Differenz“, Zeile „Abweichung“ bzw. „Sonderzeilen zusammen“). Das darf nicht vorkommen. ${data.closed ? 'Diese Abrechnung ist abgeschlossen: Der eingefrorene Stand weicht ab. Vergleichen Sie ihn mit der Abweichung der Seite oder öffnen Sie sie mit „Wieder öffnen“, um sie neu zu prüfen.' : 'Prüfen Sie die Hinweise der Abrechnung, bevor Sie abschließen.'}`} />
            )}
            {view.legacy && <p className="muted">Diese Abrechnung wurde abgeschlossen, bevor Mietfuchs die Gründe des Vermieteranteils festhielt; sie stehen deshalb pauschal in einer Spalte.</p>}
            <Table className="sticky-first" aria-label="Kontrollansicht: Verteilung je Position">
              <thead>
                <tr>
                  <th scope="col">Position</th>
                  <th scope="col" className="num">Rechnungsbetrag</th>
                  {view.tenants.map((t) => <th scope="col" key={t.tenancyId} className="num">{t.name}<div className="muted">{t.unit}</div></th>)}
                  {columns.map((c) => <th scope="col" key={c.key} className="num">Vermieter: {c.label}</th>)}
                  <th scope="col" className="num">Summe</th>
                  <th scope="col" className="num">Differenz</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">{l.category}<div className="muted">{l.description}</div></th>
                    <td className="num">{fmtEuro(l.totalCents)}</td>
                    {l.tenantCents.map((c, i) => <td key={i} className="num">{cell(c)}</td>)}
                    {l.landlordCents.map((c, i) => <td key={i} className="num">{cell(c)}</td>)}
                    <td className="num">{fmtEuro(l.sumCents)}</td>
                    <td className="num">{l.differenceCents === 0 ? 'stimmt' : <strong>{fmtEuro(l.differenceCents)}</strong>}</td>
                  </tr>
                ))}
              </tbody>
              {view.extras.length > 0 && (
                <tbody>
                  <tr><th colSpan={span} scope="rowgroup">Zeilen ohne eigene Kostenposition (nicht Teil der Summenprüfung je Position)</th></tr>
                  {view.extras.map((x) => (
                    <tr key={x.id}>
                      <th scope="row">{x.category}<div className="muted">{x.description}</div></th>
                      <td className="num muted">–</td>
                      {x.tenantCents.map((c, i) => <td key={i} className="num">{cell(c)}</td>)}
                      {columns.length > 0 && <td className="num" colSpan={columns.length}>{cell(x.landlordCents)}</td>}
                      <td className="num">{fmtEuro(x.sumCents)}</td>
                      <td className="num muted">–</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Sonderzeilen zusammen<div className="muted">Übertrag und Gegenbuchung heben sich auf: Die Summe muss 0 sein.</div></th>
                    <td />
                    <td colSpan={view.tenants.length + columns.length} />
                    <td className="num">{fmtEuro(view.extrasSumCents)}</td>
                    <td className="num">{view.extrasSumCents === 0 ? 'stimmt' : <strong>{fmtEuro(view.extrasSumCents)}</strong>}</td>
                  </tr>
                </tbody>
              )}
              <tfoot>
                <tr>
                  <th scope="row">Kosten je Mieter</th>
                  <td />
                  {view.tenants.map((t) => <td key={t.tenancyId} className="num">{fmtEuro(t.costCents)}</td>)}
                  <td colSpan={columns.length + 2} />
                </tr>
                <tr>
                  <th scope="row">Vorauszahlung</th>
                  <td />
                  {view.tenants.map((t) => <td key={t.tenancyId} className="num">{fmtEuro(t.prepaymentCents)}</td>)}
                  <td colSpan={columns.length + 2} />
                </tr>
                <tr>
                  <th scope="row">Saldo (Nachzahlung, bei Guthaben negativ)</th>
                  <td />
                  {view.tenants.map((t) => <td key={t.tenancyId} className="num"><strong>{fmtEuro(t.balanceCents)}</strong></td>)}
                  <td colSpan={columns.length + 2} />
                </tr>
                {view.tenants.some((t) => t.rowsDifferenceCents !== 0) && (
                  <tr>
                    <th scope="row">Abweichung (Summe der Zeilen minus Kosten)</th>
                    <td />
                    {view.tenants.map((t) => <td key={t.tenancyId} className="num">{t.rowsDifferenceCents === 0 ? 'stimmt' : <strong>{fmtEuro(t.rowsDifferenceCents)}</strong>}</td>)}
                    <td colSpan={columns.length + 2} />
                  </tr>
                )}
              </tfoot>
            </Table>
          </>
        )}
      </details>
  )
  return embedded ? section : <Card title="Kontrollansicht" className="no-print">{section}</Card>
}
