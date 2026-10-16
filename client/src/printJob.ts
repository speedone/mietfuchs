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

export function startPrint(options: {
  title: string
  // Wird einmal aufgerufen, wenn der Druck vorbei ist und der Nutzer wieder bedient
  onDone?: () => void
  delayMs?: number
  win?: Window
}): PrintJob {
  const win = options.win ?? window
  const doc = win.document
  const previousTitle = doc.title
  doc.title = options.title.replace(/[\\/:*?"<>|]/g, '-')
  let finished = false
  const interactions = ['pointerdown', 'keydown', 'beforeprint'] as const

  const finish = () => {
    if (finished) return
    finished = true
    win.removeEventListener('afterprint', afterPrint)
    for (const type of interactions) win.removeEventListener(type, finish, true)
    doc.title = previousTitle
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
    },
  }
}
