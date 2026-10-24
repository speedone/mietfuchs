// Drucken mit eigenem Dateinamen („Als PDF speichern“ nimmt den Seitentitel) und Aufräumen danach.
//
// **Aufgeräumt wird erst bei der nächsten Bedienung, nicht bei `afterprint`.** Chrome meldet
// `afterprint`, wenn der Druckdialog geschlossen ist. Safari meldet es schon, während der Dialog
// noch offen ist; wer dann Titel und Druckauswahl zurücksetzt, ändert die Seite, aus der Safari das
// PDF gerade erzeugt, und „Als PDF sichern“ endet mit der Meldung, die Datei existiere nicht. Was
// hier zurückgesetzt wird, wirkt nur im Druck (Titel, eine Klasse für @media print); es bis zum
// nächsten Klick oder Tastendruck stehen zu lassen, sieht man auf dem Bildschirm nicht. Ein
// späterer Druck über das Browsermenü erreicht die Seite ohne Klick; deshalb räumt nach `afterprint`
// auch das nächste `beforeprint` auf, synchron vor dem neuen Druck.
export type PrintJob = { cancel: () => void }

// „Seite x von y“ unten rechts im Seitenrand (#415, Teil 2). Nur beim Druck einer einzelnen Abrechnung: Beim Druck
// aller zählte der Zähler über alle Mieter hinweg, und ein Zurücksetzen je Mieter kann Chromium nicht (nachgemessen).
// Chromium kann Randfelder seit Version 131; ein Browser ohne sie druckt keine Seitenzahl, der Fußvermerk je Seite
// in der Hülle `PrintPages` steht trotzdem da.
//
// Druck (#415): Mit einem Fußvermerk steht er links im Randfeld, auf einer Linie mit der Seitenzahl rechts, und der
// Fußvermerk der Hülle entfällt (sonst stünde er doppelt und eine Zeile höher). Auf der Briefseite (`letterFirst`) steht
// links nichts, dort steht die Fußzeile des Briefs. Randfelder erben die Schrift der Seite nicht (gedruckt kam eine Serifenschrift
// heraus), deshalb steht sie hier. Die Abstände: 12 mm Seitenrand (letter.css) plus 13 mm ergibt den linken Rand des Texts
// (25 mm nach DIN 5008), 12 plus 8 den rechten (20 mm).
const FOOTER_FONT = "font-family: 'Inter', 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 7.5pt; vertical-align: top; padding-top: 2mm"
const cssString = (text: string): string => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ')}"`
export function pageFooterCss(options: { footnote: string | null, letterFirst: boolean }): string {
  const right = `@bottom-right { content: "Seite " counter(page) " von " counter(pages); ${FOOTER_FONT}; padding-right: 8mm; }`
  if (!options.footnote) return `@page { ${right} }`
  const left = `@bottom-left { content: ${cssString(options.footnote)}; ${FOOTER_FONT}; padding-left: 13mm; }`
  return [
    `@page { ${left} ${right} }`,
    options.letterFirst ? '@page :first { @bottom-left { content: none; } }' : '',
    '.statement-footnote { display: none !important; }',
  ].filter((x) => x !== '').join('\n')
}
export const PAGE_NUMBER_CSS = pageFooterCss({ footnote: null, letterFirst: false })

export function startPrint(options: {
  title: string
  // Wird einmal aufgerufen, wenn der Druck vorbei ist und der Nutzer wieder bedient
  onDone?: () => void
  delayMs?: number
  win?: Window
  // `true`: nur die Seitenzahl; mit Fußvermerk dazu links derselbe (`pageFooterCss`)
  pageNumbers?: boolean | { footnote: string | null, letterFirst: boolean }
}): PrintJob {
  const win = options.win ?? window
  const doc = win.document
  const previousTitle = doc.title
  doc.title = options.title.replace(/[\\/:*?"<>|]/g, '-')
  // Wie der Titel erst bei der nächsten Bedienung entfernt (siehe oben).
  const numbers = options.pageNumbers ? doc.createElement('style') : null
  if (numbers) {
    numbers.dataset.pageNumbers = ''
    numbers.textContent = typeof options.pageNumbers === 'object' ? pageFooterCss(options.pageNumbers) : PAGE_NUMBER_CSS
    doc.head.append(numbers)
  }
  let finished = false
  const interactions = ['pointerdown', 'keydown', 'beforeprint'] as const

  const finish = () => {
    if (finished) return
    finished = true
    win.removeEventListener('afterprint', afterPrint)
    for (const type of interactions) win.removeEventListener(type, finish, true)
    doc.title = previousTitle
    numbers?.remove()
    options.onDone?.()
  }
  const afterPrint = () => {
    // Erst die nächste Bedienung räumt auf (siehe oben)
    for (const type of interactions) win.addEventListener(type, finish, true)
  }
  win.addEventListener('afterprint', afterPrint)
  const timer = win.setTimeout(() => win.print(), options.delayMs ?? 80)

  return {
    // Beim Verlassen der Seite oder einem neuen Druck: sofort aufräumen, ohne onDone
    cancel: () => {
      win.clearTimeout(timer)
      if (finished) return
      finished = true
      win.removeEventListener('afterprint', afterPrint)
      for (const type of interactions) win.removeEventListener(type, finish, true)
      doc.title = previousTitle
      numbers?.remove()
    },
  }
}
