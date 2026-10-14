// Die Prüfung einer IBAN nach ISO 13616 (#279), für Oberfläche und Server dieselbe.
//
// Drei Felder nahmen jeden Text an: die Bankverbindung des Vermieters in den Einstellungen, die
// abweichende IBAN eines Objekts und die IBAN des Mieters. Eine vertippte IBAN fällt erst auf,
// wenn eine Nachzahlung nicht ankommt oder eine Erstattung zurückgeht, und auf der gedruckten
// Abrechnung steht sie vor dem Mieter. Die Prüfziffer findet jeden einzelnen Tippfehler und
// jeden Dreher zweier benachbarter Ziffern; deshalb lohnt die Prüfung beim Speichern.
//
// **Geprüft wird nur beim Speichern über die Oberfläche und die Routen**, nicht beim Umstieg,
// Wiederherstellen oder im Validator: Eine falsche IBAN ändert keine Zahl der Abrechnung, sie
// ist krumm und nicht kaputt, und ein Bestand soll an ihr nicht scheitern.

// Länge der IBAN je Länderkennung, nach dem IBAN-Register der SWIFT (ISO 13616). Gebiete, die
// die Kennung eines anderen Landes führen (etwa Åland unter FI, Guernsey unter GB, die
// französischen Überseegebiete unter FR), stehen dort ebenfalls unter dieser Kennung.
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28,
  CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18,
  FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28,
  IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20,
  LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28,
  NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24,
  SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
}

export type IbanCheck = { ok: true, iban: string } | { ok: false, iban: string, problem: string }

// Ohne Leerraum und in Großbuchstaben, so wie sie gespeichert wird. Leerraum heißt dabei auch
// das geschützte Leerzeichen, das beim Kopieren aus einem PDF oder einer Banking-Seite mitkommt.
export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

// In Vierergruppen, wie sie auf Papier steht. Eine ungültige Eingabe bleibt, wie sie ist: Wer sie
// prüfen soll, muss sehen, was dasteht.
export function formatIban(input: string): string {
  const check = checkIban(input)
  if (!check.ok) return input
  return check.iban.replace(/(.{4})(?=.)/g, '$1 ')
}

// Rest der Division durch 97, Stelle für Stelle. Eine IBAN hat bis zu 34 Zeichen, als Zahl mit
// den Buchstaben in Ziffern also bis zu 68 Stellen; das passt in keine Gleitkommazahl. BigInt
// ginge, wird aber nicht gebraucht: Der Rest bleibt in jedem Schritt unter 97.
function mod97(text: string): number {
  let rest = 0
  for (const zeichen of text) {
    const wert = parseInt(zeichen, 36) // 0–9 und A=10 … Z=35
    rest = wert < 10 ? (rest * 10 + wert) % 97 : (rest * 100 + wert) % 97
  }
  return rest
}

export function checkIban(input: string): IbanCheck {
  const iban = normalizeIban(input)
  const fail = (problem: string): IbanCheck => ({ ok: false, iban, problem })
  if (iban === '') return fail('Es ist keine IBAN eingetragen.')
  if (!/^[A-Z0-9]+$/.test(iban)) {
    return fail('Die IBAN enthält unzulässige Zeichen; erlaubt sind nur Buchstaben und Ziffern.')
  }
  const land = iban.slice(0, 2)
  if (!/^[A-Z]{2}$/.test(land)) return fail('Eine IBAN beginnt mit der Länderkennung aus zwei Buchstaben, etwa DE.')
  const laenge = IBAN_LENGTHS[land]
  if (laenge === undefined) return fail(`Die Länderkennung „${land}“ gehört zu keinem Land, das IBANs vergibt.`)
  if (iban.length !== laenge) {
    return fail(`Eine IBAN mit der Länderkennung ${land} hat ${laenge} Zeichen, eingetragen sind ${iban.length}.`)
  }
  // Die Prüfziffer steht an Stelle 3 und 4 und liegt zwischen 02 und 98.
  const pruefziffer = iban.slice(2, 4)
  const rechnerisch = /^\d{2}$/.test(pruefziffer) && pruefziffer !== '00' && pruefziffer !== '01' && pruefziffer !== '99'
  if (!rechnerisch || mod97(iban.slice(4) + iban.slice(0, 4)) !== 1) {
    return fail('Die Prüfziffer stimmt nicht: Vermutlich ist ein Zeichen vertippt, oder zwei sind vertauscht.')
  }
  return { ok: true, iban }
}

export const isValidIban = (input: string): boolean => checkIban(input).ok

// Dieselbe IBAN, nur anders geschrieben (Leerzeichen, Kleinbuchstaben)?
export const sameIban = (a: string | null | undefined, b: string | null | undefined): boolean =>
  normalizeIban(a ?? '') === normalizeIban(b ?? '')
