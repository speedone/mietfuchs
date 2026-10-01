import type { ComponentProps } from 'react'

// Jede Tabelle der Oberfläche liegt in einem eigenen waagerecht scrollbaren Bereich (#137). Auf
// dem Handy ist eine Tabelle mit sechs Spalten breiter als der Bildschirm; ohne den Bereich
// schob sie die ganze Seite in die Breite, und gelesen werden konnte sie nur mit waagerechtem
// Wischen über alles hinweg. So scrollt nur die Tabelle, und die Seite bleibt so breit wie der
// Bildschirm. Im Druck ist der Bereich wirkungslos (index.css), damit nichts abgeschnitten wird.
// Ein Wächter in Table.test.ts verlangt, dass Seiten und Bausteine Tabellen nur hierüber bauen.
export default function Table(props: ComponentProps<'table'>) {
  return (
    <div className="table-scroll">
      <table {...props} />
    </div>
  )
}
