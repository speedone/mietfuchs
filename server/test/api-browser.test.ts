// „Mietfuchs öffnen mit“ (#735): die Wahl des Browsers in den Einstellungen, über die Schnittstelle. Nur dort, wo
// Mietfuchs beim Start selbst einen Browser öffnet (hier nachgestellt mit NKA_RUNTIME=binary). Gestartet wird kein
// Browser: startServerIn setzt CI, und der nachgestellte Browser ist eine Datei in einem Wegwerf-Ordner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { connect } from '../src/db/client.ts'
import { errorOf, jsonOf, startServerIn, type ClientSettings } from '../testing/api.ts'

const fakeBrowserDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-browser-'))
  const file = path.join(dir, 'brave-browser')
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(file, 0o755)
  return dir
}

const put = (base: string, body: unknown) => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('Programmdatei: gefundene Browser in den Einstellungen, Wahl nur als Kennung, gespeichert über einen Neustart', { skip: process.platform === 'win32' && 'nachgestellter Browser ist ein Shell-Skript' }, async () => {
  const bin = fakeBrowserDir()
  const env = { NKA_RUNTIME: 'binary', PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, BROWSER: '' }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
  const erster = await startServerIn(dataDir, env)
  try {
    const settings = await erster.api<ClientSettings>('/api/settings')
    assert.ok(settings.browsers, 'die Programmdatei nennt die gefundenen Browser')
    assert.ok(settings.browsers.found.some((b) => b.id === 'brave' && b.label === 'Brave'), JSON.stringify(settings.browsers))
    assert.equal(settings.browsers.fromEnv, false)
    assert.equal(settings.openWith, undefined, 'ohne Wahl der Standardbrowser')

    // Kein Pfad, kein Befehl, keine unbekannte Kennung
    for (const value of [path.join(bin, 'brave-browser'), 'brave --remote-debugging-port=9222', 'sh', 42]) {
      const res = await put(erster.base, { openWith: value })
      assert.equal(res.status, 400, String(value))
      assert.match(errorOf(await jsonOf<{ error?: string }>(res)), /Unbekannter Browser/)
    }
    assert.equal((await erster.api<ClientSettings>('/api/settings')).openWith, undefined, 'nach einer Ablehnung bleibt es beim Standardbrowser')

    // Was nur der Server liefert, geht beim Speichern nicht in die Datenbank
    assert.equal((await put(erster.base, { openWith: 'brave', browsers: { found: [], fromEnv: true } })).status, 200)
    const gespeichert = await erster.api<ClientSettings>('/api/settings')
    assert.equal(gespeichert.openWith, 'brave')
    assert.equal(gespeichert.browsers?.fromEnv, false)
    // Ein zweites Fenster, das noch den Standardbrowser sah, überschreibt die Wahl nicht still (#692)
    const veraltet = await put(erster.base, { openWith: null, ifUnchanged: { openWith: null } })
    assert.equal(veraltet.status, 409)
    assert.equal((await jsonOf<{ stale?: unknown }>(veraltet)).stale, true)
    assert.equal((await erster.api<ClientSettings>('/api/settings')).openWith, 'brave')
    // Der laufende Mietfuchs nennt die Wahl einem zweiten Start (belegter Port, derselbe Datenordner)
    assert.equal((await jsonOf<{ openWith?: unknown }>(await fetch(`${erster.base}/healthz`))).openWith, 'brave')

    const connection = await connect(path.join(dataDir, 'mietfuchs.sqlite'))
    try {
      assert.deepEqual(connection.rows('SELECT open_with FROM settings'), [['brave']])
    } finally {
      connection.close()
    }
    const ende = new Promise((r) => erster.child.on('exit', r))
    erster.child.kill()
    await ende
  } catch (err) {
    erster.stop()
    fs.rmSync(bin, { recursive: true, force: true })
    throw err
  }
  const zweiter = await startServerIn(dataDir, { ...env, BROWSER: 'brave-browser' })
  try {
    const nachNeustart = await zweiter.api<ClientSettings>('/api/settings')
    assert.equal(nachNeustart.openWith, 'brave')
    assert.equal(nachNeustart.browsers?.fromEnv, true, 'BROWSER nennt ein Programm, das Mietfuchs findet')
    // Zurück zum Standardbrowser
    assert.equal((await put(zweiter.base, { openWith: null })).status, 200)
    assert.equal((await zweiter.api<ClientSettings>('/api/settings')).openWith, undefined)
  } finally {
    zweiter.stop()
    fs.rmSync(bin, { recursive: true, force: true })
  }
})

test('npm-Betrieb: keine Wahl des Browsers, die Schnittstelle nimmt keine an', async () => {
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')))
  try {
    assert.equal((await s.api<ClientSettings>('/api/settings')).browsers, undefined)
    const res = await put(s.base, { openWith: 'firefox' })
    assert.equal(res.status, 400)
    assert.match(errorOf(await jsonOf<{ error?: string }>(res)), /keinen Browser/)
    // Der Standardbrowser (keine Wahl) geht immer, etwa aus einem Tab, der alle Einstellungen schickt
    assert.equal((await put(s.base, { openWith: null, landlordName: 'Erika' })).status, 200)
    assert.equal((await jsonOf<{ openWith?: unknown }>(await fetch(`${s.base}/healthz`))).openWith, undefined)
  } finally {
    s.stop()
  }
})

// Durchsicht K7: Womit sich Mietfuchs auf diesem Rechner öffnet, entscheidet, wer davor sitzt, wie die Update-Prüfung
// im Fenster. Von einem anderen Gerät (hier über einen Proxy auf demselben Rechner nachgestellt) lehnt der Server ab,
// und die Einstellungen sagen es der Karte.
test('Programmdatei: die Wahl nur am Rechner selbst, nicht von einem anderen Gerät', { skip: process.platform === 'win32' && 'nachgestellter Browser ist ein Shell-Skript' }, async () => {
  const bin = fakeBrowserDir()
  const s = await startServerIn(fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-')), { NKA_RUNTIME: 'binary', NKA_AUTH: 'off', PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, BROWSER: '' })
  try {
    const remote = { via: '1.1 caddy' }
    const fern = await jsonOf<ClientSettings>(await fetch(`${s.base}/api/settings`, { headers: remote }))
    assert.equal(fern.browsers?.atThisComputer, false)
    assert.equal((await s.api<ClientSettings>('/api/settings')).browsers?.atThisComputer, true)
    const res = await fetch(`${s.base}/api/settings`, { method: 'PUT', headers: { ...remote, 'content-type': 'application/json' }, body: JSON.stringify({ openWith: 'brave' }) })
    assert.equal(res.status, 403)
    assert.match(errorOf(await jsonOf<{ error?: string }>(res)), /legen Sie nur am Rechner fest, auf dem Mietfuchs läuft/)
    assert.equal((await s.api<ClientSettings>('/api/settings')).openWith, undefined)
    // Unverändert mitgeschickt geht durch, damit ein ganzes Formular von dort nicht scheitert
    assert.equal((await fetch(`${s.base}/api/settings`, { method: 'PUT', headers: { ...remote, 'content-type': 'application/json' }, body: JSON.stringify({ openWith: null, landlordName: 'Erika' }) })).status, 200)
    assert.equal((await put(s.base, { openWith: 'brave' })).status, 200)
  } finally {
    s.stop()
    fs.rmSync(bin, { recursive: true, force: true })
  }
})
