// `<dialog>` für jsdom (Spezifikation Abschnitt 9 b): jsdom kennt das Element und sein Attribut `open`,
// aber weder `showModal()` noch `close()` (jsdom 30). Nachgebildet wird nur, was die Bausteine
// brauchen und ein Browser von selbst tut:
//
// - `showModal()` setzt `open` und fokussiert das erste Element mit `autofocus`, sonst das erste
//   bedienbare im Dialog;
// - `close()` nimmt `open` weg und sendet `close`, wie der Browser als eigene Aufgabe danach (`setTimeout`):
//   Ein Baustein, der auf ein verspätetes `close` eines inzwischen wieder geöffneten Dialogs hereinfällt
//   (StrictMode baut Effekte einmal ab und wieder auf), fällt so auch im Test auf (Durchsicht M1);
// - Popover öffnen und schließen sich, `:popover-open` trifft die offenen, und Esc schließt zuerst ein offenes
//   Popover (`auto`) statt des Dialogs;
// - `:modal` trifft die mit `showModal()` geöffneten Dialoge (jsdom kennt die Pseudoklasse nicht);
// - Esc sendet dem obersten modalen Dialog `cancel` (abbrechbar) und schließt ihn danach, aber nur, wenn
//   das `keydown` nicht verhindert wurde. So hält es der Browser auch (eine „close request“ folgt erst auf
//   ein nicht verhindertes `keydown`); deshalb wird erst nach dem Ereignis entschieden, als Mikroaufgabe.
//   Wer prüft, wartet also einen Augenblick (`waitFor`, `await act(async () => {})`).
//
// Was jsdom nicht rechnet, bleibt aus: kein Top-Layer, kein inerter Hintergrund, kein `::backdrop`.
// Das prüft der Browserlauf. Installiert wird in vitestSetup.ts für jede Datei mit jsdom.
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// Die offenen modalen Dialoge, der zuletzt geöffnete zuletzt (das ist der oberste im Top-Layer).
const modals: HTMLDialogElement[] = []
// Die offenen Popover, das zuletzt geöffnete zuletzt.
const popovers: HTMLElement[] = []

let topModal: () => HTMLDialogElement | null = () => null
/** Der oberste mit `showModal()` geöffnete Dialog, sonst `null`. */
export const topModalInTest = (): HTMLDialogElement | null => topModal()

export function installDialogPolyfill(): void {
  const proto = window.HTMLDialogElement.prototype
  if (typeof proto.showModal === 'function') return
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    queueMicrotask(() => {
      if (e.defaultPrevented) return
      // Ein offenes Popover schließt zuerst, der Dialog bleibt (wie im Browser)
      const popover = [...popovers].reverse().find((p) => p.isConnected && p.getAttribute('popover') !== 'manual')
      if (popover) { popover.hidePopover(); return }
      const top = [...modals].reverse().find((d) => d.open && d.isConnected)
      if (!top) return
      const cancel = new Event('cancel', { cancelable: true })
      if (top.dispatchEvent(cancel)) top.close()
    })
  }, true)
  proto.showModal = function (this: HTMLDialogElement) {
    if (this.open) return
    this.setAttribute('open', '')
    modals.push(this)
    const target = this.querySelector<HTMLElement>('[autofocus]') ?? this.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
  }
  // Die offenen modalen Dialoge, der oberste zuletzt (für Tests, die Tab wie der Browser drücken).
  topModal = () => [...modals].reverse().find((d) => d.open && d.isConnected) ?? null
  proto.show = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return
    if (returnValue !== undefined) this.returnValue = returnValue
    this.removeAttribute('open')
    const at = modals.indexOf(this)
    if (at >= 0) modals.splice(at, 1)
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)
  }
  // Popover (`popover="auto"`/`"manual"`): nur Öffnen, Schließen und `:popover-open`, ohne Top-Layer.
  const html = window.HTMLElement.prototype
  html.showPopover = function (this: HTMLElement) { if (!popovers.includes(this)) popovers.push(this) }
  html.hidePopover = function (this: HTMLElement) { const at = popovers.indexOf(this); if (at >= 0) popovers.splice(at, 1) }
  html.togglePopover = function (this: HTMLElement) {
    if (popovers.includes(this)) { this.hidePopover(); return false }
    this.showPopover()
    return true
  }
  const matches = window.Element.prototype.matches
  const patched = function (this: Element, selector: string): boolean {
    if (selector === ':popover-open') return popovers.includes(this as HTMLElement)
    if (selector === ':modal') return this instanceof window.HTMLDialogElement && modals.includes(this)
    return matches.call(this, selector)
  }
  window.Element.prototype.matches = patched as typeof matches
}
