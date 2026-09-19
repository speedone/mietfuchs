// Reine Funktionen der Ollama-Anbindung (server/src/ai/ollama.js), ohne Server
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultCandidates } from '../src/ai/ollama.js'

// Außerhalb von Docker fragt die Suche nur diesen Rechner. Die Docker-Namen würden dort per DNS
// oder unter Windows per Broadcast ins Netz gehen, ohne je zu helfen.
test('Adresssuche: auf dem Rechner nur dieser Rechner', () => {
  for (const runtime of ['npm', 'binary']) {
    assert.deepEqual(defaultCandidates(runtime), ['http://localhost:11434', 'http://127.0.0.1:11434'], runtime)
  }
})

test('Adresssuche: im Container der Host und der Compose-Dienst', () => {
  assert.deepEqual(defaultCandidates('docker'), ['http://host.docker.internal:11434', 'http://ollama:11434'])
})
