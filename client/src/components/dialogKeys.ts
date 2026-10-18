// Tab bleibt im Dialog (#346, Schritt 1 und 2): vom letzten bedienbaren Element zum ersten und mit
// Umschalt+Tab umgekehrt. Ein modaler `<dialog>` macht den Hintergrund zwar inert, nach dem letzten
// Element ginge der Fokus aber in die Bedienleiste des Browsers; ein Ring im Dialog ist für die Tastatur
// verlässlicher und in jsdom prüfbar. Gelenkt wird jeder Schritt hier, damit die Reihenfolge nicht davon
// abhängt, was der Browser für bedienbar hält. Enter fasst diese Stelle bewusst nicht an (Wächter S13):
// Enter wirkt auf den Knopf mit dem Fokus, und das tut der Browser selbst.
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

type TabKey = { key: string; shiftKey: boolean; preventDefault: () => void; stopPropagation: () => void }

export function keepTabInside(e: TabKey, box: HTMLElement): void {
  if (e.key !== 'Tab') return
  const focusable = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => !el.hasAttribute('disabled') && !el.closest('[hidden], [inert]'))
  e.preventDefault()
  e.stopPropagation()
  if (focusable.length === 0) return
  const at = focusable.indexOf(document.activeElement as HTMLElement)
  const next = e.shiftKey ? (at <= 0 ? focusable.length - 1 : at - 1) : (at < 0 || at === focusable.length - 1 ? 0 : at + 1)
  focusable[next]?.focus()
}
