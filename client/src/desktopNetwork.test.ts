// Zugriff aus dem Heimnetz (#517): ob die Karte erscheint, was sie zeigt und was sie vor dem Speichern sagt.
import { describe, expect, test } from 'vitest'
import { askForPassword, networkBridge, networkView, passwordEntryProblem, type NetworkBridge, type NetworkState } from './desktopNetwork'

const bridge: NetworkBridge = {
  get: async () => ({ enabled: false, port: 17517, addresses: [] }),
  set: async (enabled) => ({ enabled, port: 17517, addresses: [] }),
}
const OFF: NetworkState = { enabled: false, port: 17517, addresses: ['http://192.168.178.23:17517'] }
const ON: NetworkState = { ...OFF, enabled: true }

describe('networkBridge', () => {
  test('nur im Programmfenster: im Browser und auf dem Handy gibt es keine Brücke', () => {
    expect(networkBridge(undefined)).toBeNull()
    expect(networkBridge({})).toBeNull()
    // Das Fenster vor dieser Fassung kannte nur das Drucken
    expect(networkBridge({ mietfuchsDesktop: { print: async () => {} } })).toBeNull()
    expect(networkBridge({ mietfuchsDesktop: { print: async () => {}, network: bridge } })).toBe(bridge)
    expect(networkBridge({ mietfuchsDesktop: { network: { get: bridge.get } } as never })).toBeNull()
  })
})

describe('networkView', () => {
  test('aus: keine Adressen, kein Hinweis auf Neustart', () => {
    expect(networkView(OFF, false)).toEqual({ addresses: null, noAddress: false, restart: false, firewall: false })
  })

  test('an und gespeichert: die Adressen fürs Handy', () => {
    expect(networkView(ON, true)).toEqual({ addresses: ['http://192.168.178.23:17517'], noAddress: false, restart: false, firewall: false })
  })

  test('an, aber ohne Netzwerkverbindung: das sagen statt einer leeren Liste', () => {
    expect(networkView({ ...ON, addresses: [] }, true)).toEqual({ addresses: null, noAddress: true, restart: false, firewall: false })
  })

  test('eingeschaltet, noch nicht gespeichert: Neustart und Firewall ankündigen, Adressen erst danach', () => {
    expect(networkView(OFF, true)).toEqual({ addresses: null, noAddress: false, restart: true, firewall: true })
  })

  test('ausgeschaltet, noch nicht gespeichert: Neustart ankündigen, die Adressen gelten bis dahin noch', () => {
    expect(networkView(ON, false)).toEqual({ addresses: ['http://192.168.178.23:17517'], noAddress: false, restart: true, firewall: false })
  })
})

// Anmeldung (#528): Beim Einschalten des Heimnetzes fragt die Karte nach einem Passwort, solange keines festgelegt ist
describe('askForPassword', () => {
  const off: NetworkState = { enabled: false, port: 17517, addresses: [] }
  const on: NetworkState = { enabled: true, port: 17517, addresses: [] }
  const access = (mode: string, envFixed = false) => ({ mode, envFixed, minLength: 15 })
  test('nur beim Einschalten und ohne Passwort', () => {
    expect(askForPassword(access('none'), off, true)).toBe(true)
    expect(askForPassword(access('off'), off, true)).toBe(true)
    expect(askForPassword(access('setup'), off, true)).toBe(true)
    expect(askForPassword(access('password'), off, true)).toBe(false)
    expect(askForPassword(access('none'), off, false)).toBe(false)
    expect(askForPassword(access('none'), on, true)).toBe(false)
    // NKA_AUTH legt es fest, oder der Stand ist unbekannt: nicht fragen
    expect(askForPassword(access('none', true), off, true)).toBe(false)
    expect(askForPassword(null, off, true)).toBe(false)
  })
  test('Eingabe: gleich und lang genug, gezählt nach Zeichen', () => {
    expect(passwordEntryProblem('Sonne Wolke Regen', 'Sonne Wolke Regen', 15)).toBeNull()
    expect(passwordEntryProblem('Sonne Wolke Regen', 'Sonne Wolke Regem', 15)).toBe('Die beiden Passwörter stimmen nicht überein.')
    expect(passwordEntryProblem('kurz', 'kurz', 15)).toBe('Das Passwort braucht mindestens 15 Zeichen.')
    expect(passwordEntryProblem('🦊'.repeat(14), '🦊'.repeat(14), 15)).toBe('Das Passwort braucht mindestens 15 Zeichen.')
  })
})
