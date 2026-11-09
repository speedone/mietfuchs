// Programmfenster koppeln (#528, Schritt 2): Sätze und Entscheidungen der Karte, ohne Seite prüfbar
// (pairingView.test.ts); PairingSection.tsx rendert nur.
import type { AccessInfo } from './access'

export type PairingDevice = { id: string; name: string; pairedAt: string; lastSeen: string | null; current: boolean }

const two = (n: number): string => String(n).padStart(2, '0')
const dayOf = (iso: string): string => {
  const d = new Date(iso)
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`
}

// „gültig bis 10:42 Uhr“ in der Ortszeit des Browsers
export function expiresText(expiresAt: string, _now: Date): string {
  const d = new Date(expiresAt)
  return `gültig bis ${two(d.getHours())}:${two(d.getMinutes())} Uhr`
}

export function deviceLine(d: Pick<PairingDevice, 'pairedAt' | 'lastSeen'>): string {
  return `gekoppelt am ${dayOf(d.pairedAt)}, ${d.lastSeen ? `zuletzt ${dayOf(d.lastSeen)}` : 'noch nicht benutzt'}`
}

export const NO_PASSWORD_NOTE = 'Legen Sie zuerst ein Passwort fest, dann können Sie hier ein Programmfenster auf einem anderen Rechner koppeln.'
export const NO_HTTPS_NOTE = 'Ohne HTTPS lässt sich kein Programmfenster koppeln. Warum HTTPS fehlt, steht im Protokoll von Mietfuchs.'

export type PairingNote = { kind: 'hidden' } | { kind: 'note'; text: string } | { kind: 'section' }

// Nur im Netz und mit Passwort gibt es den Abschnitt; nur lokal steht auf der Karte ohnehin, dass Mietfuchs lokal bleibt
export function pairingNote(info: AccessInfo): PairingNote {
  if (info.reachable !== 'network') return { kind: 'hidden' }
  if (info.mode !== 'password') return { kind: 'note', text: NO_PASSWORD_NOTE }
  if (!info.pairing?.available) return { kind: 'note', text: NO_HTTPS_NOTE }
  return { kind: 'section' }
}
