import { expect, test } from 'vitest'
import { deviceLine, expiresText, pairingNote } from './pairingView'
import type { AccessInfo } from './access'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()
const base: AccessInfo = { mode: 'password', required: true, signedIn: true, window: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker', pairing: { available: true, devices: 0 } }

test('expiresText nennt die Uhrzeit', () => {
  expect(expiresText(local(2026, 11, 9, 10, 42), new Date())).toBe('gültig bis 10:42 Uhr')
  expect(expiresText(local(2026, 11, 9, 8, 5), new Date())).toBe('gültig bis 08:05 Uhr')
})

test('deviceLine: gekoppelt am, zuletzt', () => {
  expect(deviceLine({ pairedAt: local(2026, 11, 9, 12), lastSeen: local(2026, 11, 10, 12) })).toBe('gekoppelt am 09.11.2026, zuletzt 10.11.2026')
  expect(deviceLine({ pairedAt: local(2026, 11, 9, 12), lastSeen: null })).toBe('gekoppelt am 09.11.2026, noch nicht benutzt')
})

test('pairingNote: nur lokal nichts, ohne Passwort ein Satz, ohne HTTPS ein Satz', () => {
  expect(pairingNote({ ...base, reachable: 'local' })).toEqual({ kind: 'hidden' })
  expect(pairingNote({ ...base, mode: 'off' })).toMatchObject({ kind: 'note' })
  expect(pairingNote({ ...base, mode: 'transition' })).toMatchObject({ kind: 'note' })
  expect(pairingNote({ ...base, pairing: { available: false, devices: 0 } })).toMatchObject({ kind: 'note' })
  expect(pairingNote({ ...base, pairing: undefined })).toMatchObject({ kind: 'note' })
  expect(pairingNote(base)).toEqual({ kind: 'section' })
})
