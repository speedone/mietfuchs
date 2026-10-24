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
//
// Robust zuerst, Verfeinerung, wo der Browser sie kann: Die Randfelder von `@page` kennt nur Chromium (ab 131); Safari und
// Firefox drucken sie nicht (WebKit standards-positions #275, Bug 85062; nachgemessen mit dem Workflow „Druck in Safari“).
// Deshalb steht hier nur die Seitenzahl, die ohne Randfeld eben fehlt. Der Fußvermerk steht nie allein im Randfeld,
// sondern im Fluss, im Fuß der Hülle `PrintPages` (Letter.tsx); Chromium und Firefox wiederholen ihn je Seite, Safari
// druckt ihn einmal am Ende der Aufstellung. Randfelder erben die Schrift der Seite nicht (gedruckt kam eine
// Serifenschrift heraus), deshalb steht sie hier. 12 mm Seitenrand (letter.css) plus 8 mm ergibt den rechten Rand des
// Texts (20 mm nach DIN 5008); oben im Randfeld, damit die Zahl nah unter dem Fußvermerk steht.
const FOOTER_FONT = "font-family: 'Inter', 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 7.5pt; vertical-align: top; padding-top: 2mm"
export const PAGE_NUMBER_CSS = `@page { @bottom-right { content: "Seite " counter(page) " von " counter(pages); ${FOOTER_FONT}; padding-right: 8mm; } }`

export function startPrint(options: {
  title: string
  // Wird einmal aufgerufen, wenn der Druck vorbei ist und der Nutzer wieder bedient
  onDone?: () => void
  delayMs?: number
  win?: Window
  // „Seite x von y“ im Rand (`PAGE_NUMBER_CSS`)
  pageNumbers?: boolean
}): PrintJob {
  const win = options.win ?? window
  const doc = win.document
  const previousTitle = doc.title
  doc.title = options.title.replace(/[\\/:*?"<>|]/g, '-')
  // Wie der Titel erst bei der nächsten Bedienung entfernt (siehe oben).
  const numbers = options.pageNumbers ? doc.createElement('style') : null
  if (numbers) {
    numbers.dataset.pageNumbers = ''
    numbers.textContent = PAGE_NUMBER_CSS
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
