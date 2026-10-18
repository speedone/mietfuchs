// Ein Tastendruck, wie ihn der Browser ausführt (#346, Schritt 1): `keydown` an das Element mit dem Fokus,
// und wird es nicht verhindert, die Folge, die der Browser selbst hätte. jsdom tut das nicht von selbst, und
// `fireEvent.keyDown` allein prüfte nur, ob ein Abfänger im Code die Taste abfängt.
//
// - Enter und Leertaste auf einem Knopf: ein Klick. Genau den fängt kein Dialogbaustein mehr ab (Wächter S13).
// - Tab: der Fokus geht zum nächsten bedienbaren Element (Umschalt: zum vorigen), wie der Browser es täte.
//   Ist ein modaler Dialog offen, nur innerhalb von ihm (der Rest ist inert), am Ende wieder vorn; im
//   Browser ginge es dazwischen durch die Bedienleiste. Nicht bedienbar ist, was in einem geschlossenen
//   `<details>` steht (außer dessen `<summary>`), was `hidden` oder `inert` ist und was gesperrt ist.
//   Lenkt der Code Tab selbst (verhindert), geschieht nichts weiter.
// - Esc schließt über den Polyfill (testing/dialog.ts) den obersten modalen Dialog, als Mikroaufgabe danach.
import { fireEvent } from '@testing-library/react'
import { topModalInTest } from './dialog'

const TABBABLE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]'

export function tabbables(root: ParentNode = topModalInTest() ?? document.body): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => {
    if (el.getAttribute('tabindex') === '-1' || (el as HTMLButtonElement).disabled) return false
    if (el.closest('[hidden], [inert]')) return false
    const closed = el.closest('details:not([open])')
    if (closed && !(el.tagName === 'SUMMARY' && el.parentElement === closed)) return false
    // Ein `<summary>` in einem geschlossenen äußeren `<details>` ist ebenso verborgen
    if (closed && closed.parentElement?.closest('details:not([open])')) return false
    return true
  })
}

export function press(key: string, init: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
  const target = document.activeElement ?? document.body
  const notPrevented = fireEvent.keyDown(target, { key, ...init })
  if (!notPrevented) return
  if ((key === 'Enter' || key === ' ') && target instanceof HTMLButtonElement && !target.disabled) target.click()
  if (key === 'Tab') {
    const list = tabbables()
    if (list.length === 0) return
    const at = list.indexOf(target as HTMLElement)
    const next = init.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : (at < 0 || at === list.length - 1 ? 0 : at + 1)
    list[next]?.focus()
  }
}
