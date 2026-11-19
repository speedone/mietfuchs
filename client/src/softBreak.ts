// Unsichtbare Umbruchstellen in überlangen Wörtern (#647). In einer Tabelle mit automatischer Breite ist eine Spalte
// mindestens so breit wie ihr längstes Wort. Ein Wort ohne Trennstelle (Beschreibung, Firmenname, Adresse) machte die
// Tabelle im Druck breiter als die Seite, und der Browser verkleinerte den ganzen Druck samt Anschreiben. CSS hilft dort
// nicht ohne Nebenwirkung: `overflow-wrap: anywhere` senkt die Mindestbreite jeder Zelle, Chromium verteilt die Spalten
// dann neu und trennte auch normale Wörter („Allgemeinstro-m“, nachgemessen). Deshalb bekommen nur Wörter über
// `SOFT_BREAK_MIN` Zeichen alle `SOFT_BREAK_CHUNK` Zeichen ein U+200B; so lange Wörter kommen in echten Angaben praktisch
// nicht vor, normale Abrechnungen drucken also unverändert. Geprüft mit scripts/print-width-check.mjs.
export const SOFT_BREAK_MIN = 40
export const SOFT_BREAK_CHUNK = 20

const LONG_WORD = new RegExp(`\\S{${SOFT_BREAK_MIN + 1},}`, 'gu')
// Ein Zeichen samt seiner kombinierenden Zeichen (NFD: „ü“ als u + U+0308): Dazwischen darf keine Umbruchstelle stehen,
// sonst stünden die Punkte allein am Anfang der nächsten Zeile (Durchsicht)
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu

export function softBreak(text: string): string {
  return text.replace(LONG_WORD, (word) => {
    const chars = word.match(CLUSTER) ?? [word]
    const parts: string[] = []
    for (let i = 0; i < chars.length; i += SOFT_BREAK_CHUNK) parts.push(chars.slice(i, i + SOFT_BREAK_CHUNK).join(''))
    return parts.join('​')
  })
}
