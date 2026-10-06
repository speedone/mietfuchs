import { useEffect, useRef, useState, type ComponentProps } from 'react'

// Jede Tabelle der Oberfläche liegt in einem eigenen waagerecht scrollbaren Bereich (#137). Auf
// dem Handy ist eine Tabelle mit sechs Spalten breiter als der Bildschirm; ohne den Bereich
// schob sie die ganze Seite in die Breite, und gelesen werden konnte sie nur mit waagerechtem
// Wischen über alles hinweg. So scrollt nur die Tabelle, und die Seite bleibt so breit wie der
// Bildschirm. Im Druck ist der Bereich wirkungslos (index.css), damit nichts abgeschnitten wird.
// Ein Wächter in Table.test.ts verlangt, dass Seiten und Bausteine Tabellen nur hierüber bauen.
//
// Sichtprüfung S10: Dass sich der Bereich seitlich wischen lässt, sah man nicht, und Betrag oder
// Bearbeiten lagen auf dem Handy außerhalb des Bildes. Ist die Tabelle breiter als ihr Bereich,
// steht deshalb ein Satz darüber; dazu zeigt ein Schatten am Rand (index.css), dass dort mehr kommt.
export default function Table(props: ComponentProps<'table'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [wider, setWider] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setWider(el.scrollWidth > el.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    const table = el.firstElementChild
    if (table) observer.observe(table)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      {wider && <div className="table-scroll-hint" aria-hidden="true">Weitere Spalten rechts: seitlich scrollen oder wischen →</div>}
      <div className="table-scroll" ref={ref}>
        <table {...props} />
      </div>
    </>
  )
}
