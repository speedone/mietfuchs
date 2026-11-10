// Text in die Zwischenablage (#528, Rückmeldung zur Kopplung). navigator.clipboard gibt es nur in sicherem Kontext:
// Über http im Heimnetz oder mit einem Zertifikat, dem der Browser nicht traut, fehlt es oder lehnt ab. Dann kopiert
// ein verstecktes Textfeld mit execCommand('copy'), das noch überall geht. `false`, wenn beides scheitert; der Aufrufer
// bittet dann, den Text von Hand zu markieren.
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // weiter mit dem Textfeld
    }
  }
  return copyWithField(text)
}

function copyWithField(text: string): boolean {
  if (typeof document === 'undefined') return false
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.setAttribute('aria-hidden', 'true')
  // außer Sicht, aber nicht display:none (sonst lässt sich nichts markieren)
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.left = '-9999px'
  field.style.opacity = '0'
  document.body.append(field)
  try {
    field.focus()
    field.select()
    // iOS Safari markiert mit select() allein nichts (Durchsicht)
    field.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    before?.focus()
  }
}
