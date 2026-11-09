import { expect, test } from 'vitest'
import { deviceLine, expiresText, pairingNote } from './pairingView'
import type { AccessInfo } from './access'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()
const base: AccessInfo = { mode: 'password', required: true, signedIn: true, window: false, device: false, reachable: 'network', envFixed: false, minLength: 15, runtime: 'docker', pairing: { available: true, devices: 0 } }

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
const at = (protocol: string, host: string) => ({ protocol, host, hostname: host.replace(/:\d+$/, '') })
test('addressOf: nur eine Adresse, die ein anderer Rechner erreicht', () => {
  expect(addressOf(at('http:', '192.168.1.5:3001'))).toBe('192.168.1.5:3001')
  expect(addressOf(at('http:', 'localhost:3001'))).toBeNull()
  expect(addressOf(at('http:', '127.0.0.1:5173'))).toBeNull()
  expect(addressOf(at('http:', '[::1]:3001'))).toBeNull()
  expect(addressOf(at('https:', 'localhost:8443'))).toBeNull()
})
// Hinter einem Proxy wie Caddy (#528): mit https:// davor, sonst nähme das Fenster Port 3001
test('addressOf: über HTTPS mit https:// davor, über HTTP wie bisher', () => {
  expect(addressOf({ protocol: 'https:', host: 'nas.fritz.box', hostname: 'nas.fritz.box' })).toBe('https://nas.fritz.box')
  expect(addressOf({ protocol: 'https:', host: 'nas.fritz.box:8443', hostname: 'nas.fritz.box' })).toBe('https://nas.fritz.box:8443')
  expect(addressOf({ protocol: 'http:', host: 'nas:3001', hostname: 'nas' })).toBe('nas:3001')
})
