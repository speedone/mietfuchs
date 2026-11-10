// Rechnungsansicht einer E-Rechnung als XML-Datei (#189, PR 3). Was dasteht, entscheidet eInvoiceView.ts; dieselbe
// Gliederung trägt das PDF für Vorschau, Belegkopien und Mappe (eInvoicePdf.ts).
import type { EInvoiceView as View } from '../types'
import { eInvoiceDocument } from '../eInvoiceView'
import Card from './Card'
import Table from './Table'
import { NoticeBox } from './Notice'

// Angaben als Zeilen „Beschriftung: Wert“, als Tabelle mit Zeilenköpfen (Vorleser nennen die Beschriftung zum Wert)
function Facts({ rows, label }: { rows: [string, string][]; label: string }) {
  return (
    <Table aria-label={label}>
      <tbody>
        {rows.map(([name, value]) => <tr key={name}><th scope="row" className="text-muted">{name}</th><td>{value}</td></tr>)}
      </tbody>
    </Table>
  )
}

export function EInvoiceView({ view }: { view: View }) {
  const d = eInvoiceDocument(view)
  return (
    <div className="flex flex-col gap-4">
      {d.refusal && (
        <NoticeBox level="warning" title="Wird nicht in die Kosten übernommen" action={d.refusal} />
      )}
      {d.notes.length > 0 && (
        <NoticeBox level="hint" title="Hinweise zur Rechnung">
          <ul className="m-0">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </NoticeBox>
      )}
      {d.unreadable.length > 0 && (
        <NoticeBox level="warning" title="Nicht lesbare Angaben" action={`Diese Angaben stehen in der Datei, ließen sich aber nicht lesen: ${d.unreadable.join(', ')}.`} />
      )}
      <Card title="Rechnung">
        <Facts rows={d.facts} label="Angaben zur Rechnung" />
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {d.parties.map((p) => (
          <Card key={p.role} title={p.role} level={3}>
            <p className="m-0"><strong>{p.name || 'ohne Namen'}</strong></p>
            {p.lines.map((l, i) => <p key={i} className="m-0">{l}</p>)}
          </Card>
        ))}
      </div>
      <Card title="Positionen">
        <Table className="stacked">
          <thead>
            <tr><th>Nr.</th><th>Bezeichnung</th><th className="num">Menge</th><th className="num">Einzelpreis</th><th>USt</th><th className="num">Netto</th></tr>
          </thead>
          <tbody>
            {d.positions.map((p, i) => (
              <tr key={i}>
                <td data-label="Nr.">{p.nr}</td>
                <td data-label="Bezeichnung">{p.name}{p.description && p.description !== p.name && <div className="text-muted">{p.description}</div>}</td>
                <td data-label="Menge" className="num">{p.quantity}</td>
                <td data-label="Einzelpreis" className="num">{p.unitPrice}</td>
                <td data-label="USt">{p.vat}</td>
                <td data-label="Netto" className="num">{p.net}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {d.charges.length > 0 && (
        <Card title="Zu- und Abschläge">
          <Table className="stacked">
            <thead><tr><th>Art</th><th>Grund</th><th>USt</th><th className="num">Betrag (netto)</th></tr></thead>
            <tbody>
              {d.charges.map((c, i) => (
                <tr key={i}>
                  <td data-label="Art">{c.kind}</td>
                  <td data-label="Grund">{c.reason}</td>
                  <td data-label="USt">{c.vat}</td>
                  <td data-label="Betrag (netto)" className="num">{c.amount}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Umsatzsteuer" level={3}>
          <Table>
            <thead><tr><th>Satz</th><th className="num">Grundlage</th><th className="num">Steuer</th></tr></thead>
            <tbody>
              {d.vat.map((v, i) => <tr key={i}><td>{v.label}</td><td className="num">{v.basis}</td><td className="num">{v.tax}</td></tr>)}
            </tbody>
          </Table>
        </Card>
        <Card title="Summen" level={3}>
          <Facts rows={d.totals} label="Summen" />
        </Card>
      </div>
      {d.payment.length > 0 && (
        <Card title="Zahlung">
          <Facts rows={d.payment} label="Zahlung" />
        </Card>
      )}
    </div>
  )
}
