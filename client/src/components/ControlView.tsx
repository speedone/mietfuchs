// Die Kontrollansicht der Abrechnung (#321): aufklappbar, nur am Bildschirm. Je Position stehen alle Mieter und die
// Gründe des Vermieters nebeneinander, die Summe gegen den Rechnungsbetrag. Logik in controlView.ts.

import { useState } from 'react'
import { fmtEuro } from '../api'
import { controlView } from '../controlView'
import type { Settlement } from '../types'
import Card from './Card'
import { NoticeBox } from './Notice'
import Table from './Table'

const cell = (cents: number) => (cents === 0 ? '–' : fmtEuro(cents))

export default function ControlView({ data }: { data: Pick<Settlement, 'statements' | 'landlord' | 'separateHeating'> }) {
  const [open, setOpen] = useState(false)
  const view = controlView(data)
  if (view.items.length === 0 && view.extras.length === 0) return null
  const columns = view.landlordColumns
  const span = 2 + view.tenants.length + columns.length + 2
  return (
    <Card title="Kontrollansicht" className="no-print">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Alle Empfänger je Position nebeneinander</summary>
        {open && (
          <>
            <p className="muted">
              Zur Probe vor dem Abschließen: Jede Zeile zeigt, wie sich der Rechnungsbetrag auf die Mieter und den Vermieter verteilt. Die Summe muss dem Rechnungsbetrag entsprechen. Angezeigt wird nur, was die Abrechnung schon enthält.
              {data.separateHeating && data.separateHeating.length > 0 && ' Getrennt abgerechnete Heizkosten stehen nicht darin.'}
            </p>
            {view.hasDifference && (
              <NoticeBox level="error" title="Die Verteilung geht nicht auf" action="Mindestens eine Position oder ein Mieter weicht von der Summe ab (Spalte „Differenz“ bzw. Zeile „Abweichung“). Das darf nicht vorkommen; bitte prüfen Sie die Hinweise der Abrechnung, bevor Sie sie abschließen." />
            )}
            {view.legacy && <p className="muted">Diese Abrechnung wurde abgeschlossen, bevor Mietfuchs die Gründe des Vermieteranteils festhielt; sie stehen deshalb pauschal in einer Spalte.</p>}
            <Table className="sticky-first" aria-label="Kontrollansicht: Verteilung je Position">
              <thead>
                <tr>
                  <th>Position</th>
                  <th className="num">Rechnungsbetrag</th>
                  {view.tenants.map((t) => <th key={t.tenancyId} className="num">{t.name}<div className="muted">{t.unit}</div></th>)}
                  {columns.map((c) => <th key={c.key} className="num">Vermieter: {c.label}</th>)}
                  <th className="num">Summe</th>
                  <th className="num">Differenz</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((l) => (
                  <tr key={l.id}>
                    <td>{l.category}<div className="muted">{l.description}</div></td>
                    <td className="num">{fmtEuro(l.totalCents)}</td>
                    {l.tenantCents.map((c, i) => <td key={i} className="num">{cell(c)}</td>)}
                    {l.landlordCents.map((c, i) => <td key={i} className="num">{cell(c)}</td>)}
                    <td className="num">{fmtEuro(l.sumCents)}</td>
                    <td className="num">{l.differenceCents === 0 ? 'stimmt' : <strong>{fmtEuro(l.differenceCents)}</strong>}</td>
                  </tr>
                ))}
                {view.extras.length > 0 && (
                  <tr><th colSpan={span} scope="colgroup">Zeilen ohne eigene Kostenposition (nicht Teil der Summenprüfung)</th></tr>
                )}
                {view.extras.map((x) => (
                  <tr key={x.id}>
                    <td>{x.category}<div className="muted">{x.description}</div></td>
                    <td className="num muted">–</td>
                    {x.tenantCents.map((c, i) => <td key={i} className="num">{cell(c)}</td>)}
                    <td className="num" colSpan={Math.max(columns.length, 1)}>{cell(x.landlordCents)}</td>
                    <td className="num">{fmtEuro(x.sumCents)}</td>
                    <td className="num muted">–</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Kosten je Mieter</td>
                  <td />
                  {view.tenants.map((t) => <td key={t.tenancyId} className="num">{fmtEuro(t.costCents)}</td>)}
                  <td colSpan={columns.length + 2} />
                </tr>
                <tr>
                  <td>Vorauszahlung</td>
                  <td />
                  {view.tenants.map((t) => <td key={t.tenancyId} className="num">{fmtEuro(t.prepaymentCents)}</td>)}
                  <td colSpan={columns.length + 2} />
                </tr>
                <tr>
                  <td>Saldo (Nachzahlung, bei Guthaben negativ)</td>
                  <td />
                  {view.tenants.map((t) => <td key={t.tenancyId} className="num"><strong>{fmtEuro(t.balanceCents)}</strong></td>)}
                  <td colSpan={columns.length + 2} />
                </tr>
                {view.tenants.some((t) => t.rowsDifferenceCents !== 0) && (
                  <tr>
                    <td>Abweichung (Summe der Zeilen minus Kosten)</td>
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
    </Card>
  )
}
