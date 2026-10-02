// @vitest-environment jsdom
// Der Zeitgeber, der den hervorgehobenen Eintrag ins Bild holt, darf das Abbauen der Seite nicht
// überleben: Feuert er danach, trifft er auf eine abgebaute Testumgebung („document is not
// defined“) und lässt den ganzen Lauf scheitern, obwohl jeder Test grün war (wie beim Toast in
// components/feedback.tsx).
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { useScrollToFocus } from './focus'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Seite() {
  const scrollToFocus = useScrollToFocus()
  useEffect(() => { scrollToFocus() }, [scrollToFocus])
  return <div className="focus-target">Eintrag</div>
}

test('Zum Eintrag scrollen: der Zeitgeber wird beim Abbauen aufgeräumt', () => {
  vi.useFakeTimers()
  const { unmount } = render(<Seite />)
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test('Zum Eintrag scrollen: solange die Seite steht, holt der Zeitgeber den Eintrag ins Bild', () => {
  vi.useFakeTimers()
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  render(<Seite />)
  vi.advanceTimersByTime(50)
  expect(scroll).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
