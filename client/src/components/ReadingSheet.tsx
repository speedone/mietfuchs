// Das leere Ableseformular (#320): je Gruppe eine Tabelle mit dem letzten Stand und leeren Feldern für Datum, Stand
// und Unterschrift. Gedruckt wird allein dieses Blatt (reading-sheet.css, `print-reading-sheet`). Eine Unterschrift
// ist nirgends vorgeschrieben; die Spalte steht wie die übrigen, ohne Hinweis darauf.
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { fmtDate } from '../api'
import Table from './Table'
import type { CalibrationMark, ReadingSheet as Sheet } from '../readingSheet'

export function markText(mark: CalibrationMark): string {
  return mark.kind === 'overdue' ? `Eichfrist abgelaufen (Ende ${mark.year})` : `Eichfrist endet ${mark.year}`
}

export default function ReadingSheet({ sheet, propertyName, subtitle }: { sheet: Sheet; propertyName: string; subtitle?: string }) {
  return (
    <div className="reading-sheet-print">
      <h2>Ableseformular</h2>
      <p>{[propertyName, subtitle].filter((x) => x !== undefined && x !== '').join(' · ')}</p>
      <p>Ablesung am: ______________ Abgelesen von: ______________________</p>
      {sheet.groups.map((g) => (
        <section key={g.key}>
          <h3>{g.title}</h3>
          <Table>
            <thead>
              <tr>
                <th scope="col">Bezeichnung und Ort</th><th scope="col">Zählernummer</th><th scope="col">Art</th><th scope="col">Einheit</th>
                <th scope="col">Letzter Stand</th><th scope="col">Datum</th><th scope="col">Stand</th><th scope="col">Unterschrift</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {r.mark && <div className="reading-mark">{markText(r.mark)}</div>}
                  </td>
                  <td>{r.meterNumber}</td>
                  <td>{r.typeLabel}</td>
                  <td>{r.unit}</td>
                  <td>{r.last ? <>{r.last.value.toLocaleString('de-DE')}<br />{fmtDate(r.last.date)}</> : '—'}</td>
                  <td className="reading-fill" />
                  <td className="reading-fill" />
                  <td className="reading-fill" />
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ))}
    </div>
  )
}

/** Druckt das Blatt: als Portal an body, erst nach dem Rendern, und räumt nach dem Druck auf (wie die Monatsinformation). */
export function SheetPrinter({ sheet, propertyName, subtitle, onDone }: { sheet: Sheet; propertyName: string; subtitle?: string; onDone: () => void }) {
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    document.body.classList.add('print-reading-sheet')
    const done = () => {
      document.body.classList.remove('print-reading-sheet')
      doneRef.current()
    }
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 80)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      document.body.classList.remove('print-reading-sheet')
    }
  }, [])
  return createPortal(<ReadingSheet sheet={sheet} propertyName={propertyName} subtitle={subtitle} />, document.body)
}
