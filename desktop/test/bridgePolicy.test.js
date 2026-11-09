// Was die Seite im Fenster über die Brücke darf (#528, Schritt 2): lokal alles, verbunden mit einem Mietfuchs im
// Heimnetz nur Drucken, Updates des Fensters und Stand oder Trennen der Verbindung; eine fremde Seite nie etwas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANNELS, allowed } from '../src/bridgePolicy.js'

test('Brücke: Matrix aller Kanäle, lokal und verbunden', () => {
  /** @type {Record<string, { local: boolean, remote: boolean }>} */
  const expected = {
    'print': { local: true, remote: true },
    'network-get': { local: true, remote: false },
    'network-set': { local: true, remote: false },
    'choose-folder': { local: true, remote: false },
    'updater-get': { local: true, remote: true },
    'updater-check': { local: true, remote: true },
    'updater-later': { local: true, remote: true },
    'updater-restart': { local: true, remote: true },
    'remote-get': { local: true, remote: true },
    'remote-connect': { local: true, remote: false },
    'remote-disconnect': { local: true, remote: true },
  }
  assert.deepEqual([...CHANNELS].sort(), Object.keys(expected).sort())
  for (const [channel, { local, remote }] of Object.entries(expected)) {
    assert.equal(allowed(channel, { remote: false, ownPage: true }), local, `${channel} lokal`)
    assert.equal(allowed(channel, { remote: true, ownPage: true }), remote, `${channel} verbunden`)
    // Nie für einen Beleg, einen Rahmen oder eine fremde Seite
    assert.equal(allowed(channel, { remote: false, ownPage: false }), false, `${channel} lokal, fremd`)
    assert.equal(allowed(channel, { remote: true, ownPage: false }), false, `${channel} verbunden, fremd`)
  }
  // Unbekannte Kanäle nie
  for (const channel of ['', 'quit', 'updater-', 'remote-connect ', 'network-get\n']) {
    assert.equal(allowed(channel, { remote: false, ownPage: true }), false, JSON.stringify(channel))
  }
})
