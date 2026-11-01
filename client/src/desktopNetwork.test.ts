// Zugriff aus dem Heimnetz (#517): ob die Karte erscheint, was sie zeigt und was sie vor dem Speichern sagt.
import { describe, expect, test } from 'vitest'
import { networkBridge, networkView, type NetworkBridge, type NetworkState } from './desktopNetwork'

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
