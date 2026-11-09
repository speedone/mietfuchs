import { expect, test } from 'vitest'
import { deviceLine, expiresText, pairingNote } from './pairingView'
import type { AccessInfo } from './access'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()
const base: AccessInfo = { mode: 'password', required: true, signedIn: true, window: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker', pairing: { available: true, devices: 0 } }

test('expiresText nennt die Uhrzeit', () => {
  expect(expiresText(local(2026, 11, 9, 10, 42), new Date(2020, 0, 1))).toBe('gültig bis 10:42 Uhr')
  expect(expiresText(local(2026, 11, 9, 8, 5), new Date(2020, 0, 1))).toBe('gültig bis 08:05 Uhr')
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

import { addressOf } from './pairingView'
test('expiresText nach Ablauf', () => {
  expect(expiresText(local(2026, 11, 9, 10, 0), new Date(local(2026, 11, 9, 10, 1)))).toBe('abgelaufen')
})
test('addressOf: nur eine Adresse, die ein anderer Rechner erreicht', () => {
  expect(addressOf('192.168.1.5:3001', '192.168.1.5')).toBe('192.168.1.5:3001')
  expect(addressOf('localhost:3001', 'localhost')).toBeNull()
  expect(addressOf('127.0.0.1:5173', '127.0.0.1')).toBeNull()
  expect(addressOf('[::1]:3001', '[::1]')).toBeNull()
})
