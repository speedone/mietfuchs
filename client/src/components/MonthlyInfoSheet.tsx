// Das Blatt „Ihre Verbrauchsinformation“ für einen Monat, je Mieter eine Seite (Heizung PR 22, § 6a Abs. 2
// HeizkostenV). Jede Seite nennt nur die Zahlen ihres Mieters. Gedruckt wird allein dieses Blatt (index.css,
// `print-monthly-info`).
import type { MonthlyInfoMonth } from '../types'
import { sheetLines } from '../monthlyInfoForm'
import { monthName } from '../../../shared/monthlyInfo.ts'

export default function MonthlyInfoSheet({ month, propertyName }: { month: MonthlyInfoMonth; propertyName: string }) {
  return (
    <div className="monthly-info-print">
      {month.users.map((u) => (
        <section key={u.tenancyId} className="monthly-info-page">
          <h2>Ihre Verbrauchsinformation für {monthName(month.month)}</h2>
          <p>{[u.tenantName, propertyName, u.unitName].filter((x) => x !== '').join(' · ')}</p>
          <ul>{sheetLines(month, u).map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="muted">
            Diese Information steht Ihnen nach § 6a Abs. 1 und 2 HeizkostenV zu, weil Zähler in Ihrem Gebäude aus der Ferne ablesbar sind. Die Zahlen
            beruhen auf den Zählerständen am Monatsende. Die Wärme für Warmwasser ist mit der Formel gerechnet, die die Heizkostenverordnung für die
            Warmwasseranlage vorsieht, und enthält die Verluste der Erzeugung; deshalb steht sie getrennt von der gemessenen Heizwärme. Der
            Durchschnittsnutzer stammt aus Vergleichsdaten und nicht aus Ihrem Haus.
          </p>
        </section>
      ))}
    </div>
  )
}
