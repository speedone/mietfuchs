// Ein Tastendruck, wie ihn der Browser ausführt (#346, Schritt 1): `keydown` an das Element mit dem Fokus,
// und wird es nicht verhindert, die Folge, die der Browser selbst hätte. Für Enter und Leertaste auf einem
// Knopf ist das ein Klick. jsdom tut das nicht von selbst, und `fireEvent.keyDown` allein prüfte nur, ob
// ein Abfänger im Code Enter abfängt; genau den gibt es nicht mehr (Wächter S13).
// Esc schließt über den Polyfill (testing/dialog.ts) den obersten modalen Dialog, als Mikroaufgabe danach.
import { fireEvent } from '@testing-library/react'

export function press(key: string, init: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
  const target = document.activeElement ?? document.body
  const notPrevented = fireEvent.keyDown(target, { key, ...init })
  if (notPrevented && (key === 'Enter' || key === ' ') && target instanceof HTMLButtonElement && !target.disabled) target.click()
}
