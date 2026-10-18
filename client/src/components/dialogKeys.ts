// Gemeinsames der Dialogbausteine (#346, Schritt 1 und 2).
//
// Tab lenkt hier niemand: `showModal()` macht den Rest der Seite inert, und der Browser hält Tab im Dialog
// bzw. lässt es nach dem letzten Element in die Bedienleiste und von dort zurück gehen (Spezifikation
// Abschnitt 4). Ein eigener Ring lenkte früher jeden Tab selbst und sperrte die Tastatur ein, sobald ein
// Feld in einem geschlossenen `<details>` lag (Durchsicht M2). Enter fasst diese Datei ebenso wenig an
// (Wächter S13): Enter wirkt auf den Knopf mit dem Fokus, das tut der Browser.

// Den Fokus an den Auslöser eines Dialogs zurückgeben (Rückfrage, Seitenfenster). Ist der inzwischen
// ausgehängt und lag er in der Navigation (Kopf und untere Leiste am Handy, Menüblatt, Seitenleiste; #346
// Schritt 9), etwa weil das Fenster über 900 px breit wurde, geht der Fokus an die aktuelle Seite in der
// Navigation, die jetzt steht, bzw. an ☰, statt auf BODY. `closest` findet die Navigation auch am
// ausgehängten Knopf oder Auswahlfeld, denn ausgehängt wird der ganze Zweig.
export function focusBack(el: HTMLElement | null): void {
  if (!el) return
  if (el.isConnected) el.focus()
  else if (el.closest('.mobile-head, .bottom-bar, .sidebar')) {
    document.querySelector<HTMLElement>('nav [aria-current="page"], button.menu-toggle')?.focus()
  }
}

// Der oberste offene modale Dialog, in Reihenfolge des Dokuments (die Rückfrage hängt hinter allem, was die
// Seite zeichnet). Ohne `:modal` (jsdom) gilt jeder offene Dialog.
export function topModalDialog(): HTMLDialogElement | null {
  const open = [...document.querySelectorAll('dialog')].filter((d) => {
    if (!d.open) return false
    try {
      return d.matches(':modal')
    } catch {
      return true
    }
  })
  return open[open.length - 1] ?? null
}
