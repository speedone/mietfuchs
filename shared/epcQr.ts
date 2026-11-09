// Der Inhalt des Zahlungs-QR-Codes bei einer Nachzahlung (#624), nach EPC069-12 v3.0 (European Payments Council,
// „Quick Response Code: Guidelines to Enable the Data Capture for the Initiation of an SCT“, 13.09.2022). Reiner Text,
// eine Angabe je Zeile; gezeichnet wird er im Client. Hier, weil der Inhalt ohne Oberfläche prüfbar sein soll.
//
// - Fassung 002: Die BIC darf im EWR fehlen. Das Modell kennt keine BIC, also nur IBANs aus dem EWR.
// - Zeichensatz 1 (UTF-8), höchstens 331 Byte, Fehlerkorrektur M (die setzt der Client).
// - Nach dem letzten belegten Element kein Trenner (Abschnitt 3.2), also auch kein Zeilenumbruch am Ende.
import { checkIban, normalizeIban } from './iban.ts'

export type EpcInput = { name: string; iban: string; amountCents: number; purpose: string }

export const EPC_MAX_BYTES = 331
export const EPC_NAME_MAX = 70
export const EPC_PURPOSE_MAX = 140
const AMOUNT_MAX_CENTS = 99_999_999_999

// EU-27, Island, Liechtenstein, Norwegen. Französische Überseegebiete und Åland führen IBANs mit FR bzw. FI.
export const EEA_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'IS', 'LI', 'NO',
]

// Der SEPA-Zeichensatz mit der deutschen Erweiterung. Was eine Bank sonst ablehnen oder verstümmeln könnte, wird vorher
// abgebildet: Striche zu „-“ (sonst wird aus „01.05.2025–30.04.2026“ eine Ziffernkette), Anführungszeichen zu „'“.
const ALLOWED = /^[A-Za-z0-9 ':?,\-(+.)/&*$%ÄÖÜäöüß]$/u
const MAP: Readonly<Record<string, string>> = {
  '–': '-', '—': '-', '‑': '-', '−': '-', '‐': '-',
  '„': "'", '“': "'", '”': "'", '‚': "'", '‘': "'", '’': "'", '«': "'", '»': "'", '"': "'",
  '·': ',', '|': ',',
}

export function epcText(text: string): string {
  let out = ''
  for (const ch of text.replace(/\s+/gu, ' ')) {
    const mapped = MAP[ch] ?? ch
    if (ALLOWED.test(mapped)) { out += mapped; continue }
    // é → e: Buchstabe ohne sein Zeichen, wenn danach erlaubt
    const plain = mapped.normalize('NFD').replace(/\p{M}/gu, '')
    if ([...plain].every((c) => ALLOWED.test(c))) out += plain
  }
  return out.replace(/ {2,}/g, ' ').trim()
}

const bytes = (s: string): number => new TextEncoder().encode(s).length
const cut = (s: string, max: number): string => [...s].slice(0, max).join('').trim()

function amountText(cents: number): string | null {
  if (!Number.isInteger(cents) || cents < 1 || cents > AMOUNT_MAX_CENTS) return null
  return `EUR${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

function eeaIban(input: string): string | null {
  const check = checkIban(input)
  if (!check.ok) return null
  const iban = normalizeIban(input)
  return EEA_COUNTRIES.includes(iban.slice(0, 2)) ? iban : null
}

// `null`, wenn ein Pflichtteil fehlt oder ungültig ist; dann zeigt der Aufrufer keinen Code.
export function epcPayload(i: EpcInput): string | null {
  const iban = eeaIban(i.iban)
  const amount = amountText(i.amountCents)
  let name = cut(epcText(i.name), EPC_NAME_MAX)
  let purpose = cut(epcText(i.purpose), EPC_PURPOSE_MAX)
  if (iban === null || amount === null || name === '') return null
  const build = (): string => {
    const lines = ['BCD', '002', '1', 'SCT', '', name, iban, amount, '', '', purpose]
    while (lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  }
  // Zu lang: erst den Zweck vom Ende her kürzen, dann den Namen; immer ganze Zeichen.
  while (bytes(build()) > EPC_MAX_BYTES && purpose !== '') purpose = [...purpose].slice(0, -1).join('').trimEnd()
  while (bytes(build()) > EPC_MAX_BYTES && name !== '') name = [...name].slice(0, -1).join('').trimEnd()
  return name === '' ? null : build()
}

// Der ruhige Grund im Druckfenster, wenn der Schalter nichts bewirken kann.
export function epcBlocked(landlord: { landlordName: string; iban: string }): string | null {
  return epcText(landlord.landlordName) === '' || eeaIban(landlord.iban) === null ? '(braucht Vermieter und gültige IBAN aus dem EWR)' : null
}
