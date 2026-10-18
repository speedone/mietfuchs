// `<dialog>` für jsdom (Spezifikation Abschnitt 9 b): jsdom kennt das Element und sein Attribut `open`,
// aber weder `showModal()` noch `close()` (jsdom 30). Nachgebildet wird nur, was die Bausteine
// brauchen und ein Browser von selbst tut:
//
// - `showModal()` setzt `open` und fokussiert das erste Element mit `autofocus`, sonst das erste
//   bedienbare im Dialog;
// - `close()` nimmt `open` weg und sendet `close`;
// - Esc im offenen Dialog sendet `cancel` (abbrechbar) und schließt danach.
//
// Was jsdom nicht rechnet, bleibt aus: kein Top-Layer, kein inerter Hintergrund, kein `::backdrop`.
// Das prüft der Browserlauf.
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function installDialogPolyfill(): void {
  const proto = window.HTMLDialogElement.prototype
  if (typeof proto.showModal === 'function') return
  const onKey = function (this: HTMLDialogElement, e: KeyboardEvent) {
    if (e.key !== 'Escape' || !this.open) return
    const cancel = new Event('cancel', { cancelable: true })
    if (this.dispatchEvent(cancel)) this.close()
  }
  proto.showModal = function (this: HTMLDialogElement) {
    if (this.open) return
    this.setAttribute('open', '')
    this.addEventListener('keydown', onKey)
    const target = this.querySelector<HTMLElement>('[autofocus]') ?? this.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
  }
  proto.show = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return
    if (returnValue !== undefined) this.returnValue = returnValue
    this.removeAttribute('open')
    this.removeEventListener('keydown', onKey)
    this.dispatchEvent(new Event('close'))
  }
}
