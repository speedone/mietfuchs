import crypto from 'node:crypto'

// Kennungen neuer Datensätze: 16 Hexziffern, zufällig.
//
// Testgriff `NKA_TEST_IDS=seq` (#346 Schritt 12): fortlaufende Kennungen im selben Format, damit ein Beispielbestand
// in jedem Lauf dieselben hat. Bei Gleichstand entscheidet die Kennung, wer den Rest-Cent bekommt (`compareText` in
// calc.ts), und die Bilder fürs README sollen sich nicht von Lauf zu Lauf um einen Cent unterscheiden. Gelesen wird
// bei jedem Aufruf, nicht beim Laden. Ein Nutzer setzt ihn nie.
let sequence = 0n

export function newId(): string {
  if (process.env.NKA_TEST_IDS === 'seq') {
    sequence += 1n
    return sequence.toString(16).padStart(16, '0')
  }
  return crypto.randomBytes(8).toString('hex')
}
