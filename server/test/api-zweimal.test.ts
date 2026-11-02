// Zwei Mietfuchs auf demselben Datenordner (#517, Durchsicht M2): Lauf-Datei, Frage nach /healthz auf dem Port aus der
// Lauf-Datei und den Standardports (hier über NKA_TEST_TWIN_PORTS vorgegeben), Meldung im Fenster, Oberfläche bei der
// Programmdatei, und dass ein einzelner Start nie verhindert wird.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { listenInTestRange, removeDataDir, startServerIn, startServerRaw, waitForExit } from '../testing/api.ts'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-test-'))
const RUN_FILE = 'mietfuchs.laeuft.json'

// Ein Mietfuchs vor 0.15 (ohne Lauf-Datei, ohne `dataDir`), nachgestellt: /healthz nennt nur die Datenbank
async function oldMietfuchs(dataDir: string): Promise<{ port: number, close: () => void }> {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ app: 'mietfuchs', status: 'ok', version: '0.14.1', database: { open: true, file: path.join(dataDir, 'mietfuchs.sqlite') } }))
  })
  const port = await listenInTestRange(server)
  return { port, close: () => server.close() }
}

const until = async (check: () => boolean, ms = 15000) => {
  const deadline = Date.now() + ms
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
}

test('Zweimal derselbe Ordner: die Programmdatei sieht das laufende Mietfuchs über die Lauf-Datei und öffnet dessen Oberfläche', async () => {
  const erster = await startServerIn(freshDir(), { NKA_RUNTIME: 'binary', NKA_TEST_TWIN_PORTS: '[]' })
  try {
    const lauf = JSON.parse(fs.readFileSync(path.join(erster.dataDir, RUN_FILE), 'utf8'))
    assert.equal(lauf.port, Number(new URL(erster.base).port))
    assert.equal(lauf.pid, erster.child.pid)
    const zweiter = startServerRaw(erster.dataDir, { NKA_PORT: '0', NKA_RUNTIME: 'binary', NKA_TEST_TWIN_PORTS: '[]' })
    try {
      assert.equal(await waitForExit(zweiter.child, 20000), 0)
      assert.match(zweiter.out(), /läuft bereits mit denselben Daten/)
      assert.match(zweiter.out(), /Die Oberfläche wird geöffnet/)
      assert.doesNotMatch(zweiter.out(), /Mietfuchs-Server läuft auf/)
      // Die Lauf-Datei des ersten bleibt
      assert.equal(JSON.parse(fs.readFileSync(path.join(erster.dataDir, RUN_FILE), 'utf8')).pid, erster.child.pid)
    } finally {
      zweiter.child.kill()
    }
  } finally {
    erster.stop()
  }
})

test('Zweimal derselbe Ordner: das Fenster erkennt eine ältere Fassung ohne Lauf-Datei am Standardport und startet nicht', async () => {
  const dataDir = freshDir()
  const alt = await oldMietfuchs(dataDir)
  const fenster = startServerRaw(dataDir, { NKA_PORT: '0', NKA_RUNTIME: 'desktop', NKA_TEST_TWIN_PORTS: JSON.stringify([alt.port]) })
  try {
    assert.equal(await waitForExit(fenster.child, 20000), 1)
    assert.match(fenster.out(), new RegExp(`Mietfuchs läuft bereits mit denselben Daten \\(.*Port ${alt.port}\\)\\. Bitte beenden Sie das andere Mietfuchs zuerst\\.`))
    // Die Datenbank ist nicht angefasst
    assert.equal(fs.existsSync(path.join(dataDir, 'mietfuchs.sqlite')), false)
    assert.equal(fs.existsSync(path.join(dataDir, RUN_FILE)), false)
  } finally {
    fenster.child.kill()
    alt.close()
    removeDataDir(dataDir)
  }
})

test('Zweimal derselbe Ordner: eine liegengebliebene Lauf-Datei und ein Mietfuchs auf anderem Ordner verhindern keinen Start', async () => {
  const dataDir = freshDir()
  const fremd = freshDir()
  const alt = await oldMietfuchs(fremd)
  // Nach einem Absturz: Die Datei nennt einen Port, auf dem nichts mehr läuft
  fs.writeFileSync(path.join(dataDir, RUN_FILE), JSON.stringify({ version: 1, port: 9, pid: 999999, startedAt: '2026-01-01T00:00:00.000Z', appVersion: '0.15.0' }))
  const s = await startServerIn(dataDir, { NKA_RUNTIME: 'desktop', NKA_TEST_TWIN_PORTS: JSON.stringify([alt.port]) })
  try {
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, RUN_FILE), 'utf8')).pid, s.child.pid)
    const health = await s.api<{ dataDir?: string }>('/healthz')
    assert.equal(health.dataDir, dataDir)
    // Beim Beenden geht die Lauf-Datei weg
    assert.equal((await fetch(`${s.base}/api/quit`, { method: 'POST' })).status, 200)
    assert.equal(await waitForExit(s.child), 0)
    assert.equal(fs.existsSync(path.join(dataDir, RUN_FILE)), false)
  } finally {
    s.stop()
    alt.close()
    removeDataDir(fremd)
  }
})

test('Zweimal derselbe Ordner: zwei gleichzeitige Starts auf verschiedenen Ports, genau einer läuft', async () => {
  const dataDir = freshDir()
  // Zwei feste Ports, damit jeder den anderen kennt
  const probeA = http.createServer()
  const probeB = http.createServer()
  const portA = await listenInTestRange(probeA)
  const portB = await listenInTestRange(probeB)
  await new Promise<void>((r) => probeA.close(() => r()))
  await new Promise<void>((r) => probeB.close(() => r()))
  const a = startServerRaw(dataDir, { NKA_PORT: String(portA), NKA_RUNTIME: 'desktop', NKA_TEST_TWIN_PORTS: JSON.stringify([portB]) })
  const b = startServerRaw(dataDir, { NKA_PORT: String(portB), NKA_RUNTIME: 'desktop', NKA_TEST_TWIN_PORTS: JSON.stringify([portA]) })
  try {
    await until(() => [a, b].filter((s) => /Mietfuchs-Server läuft auf/.test(s.out())).length + [a, b].filter((s) => s.child.exitCode !== null).length >= 2, 30000)
    const running = [a, b].filter((s) => /Mietfuchs-Server läuft auf/.test(s.out()))
    const refused = [a, b].filter((s) => /läuft bereits mit denselben Daten/.test(s.out()))
    assert.equal(running.length, 1, `${a.out()}\n----\n${b.out()}`)
    assert.equal(refused.length, 1, `${a.out()}\n----\n${b.out()}`)
  } finally {
    a.child.kill()
    b.child.kill()
    await new Promise((r) => setTimeout(r, 300))
    removeDataDir(dataDir)
  }
})

test('Zweimal derselbe Ordner: npm und Docker fragen nicht (kein Fenster, kein Startmenü) und schreiben keine Lauf-Datei', async () => {
  const dataDir = freshDir()
  const alt = await oldMietfuchs(dataDir)
  const s = await startServerIn(dataDir, { NKA_TEST_TWIN_PORTS: JSON.stringify([alt.port]) })
  try {
    assert.equal(fs.existsSync(path.join(dataDir, RUN_FILE)), false)
    // Aber /healthz nennt den Ordner, damit ein Fenster einen npm-Server auf demselben Ordner erkennt
    assert.equal((await s.api<{ dataDir?: string }>('/healthz')).dataDir, dataDir)
  } finally {
    s.stop()
    alt.close()
  }
})
