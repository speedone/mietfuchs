// Reine Funktionen der Ollama-Anbindung (server/src/ai/ollama.ts), ohne Server
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultCandidates } from '../src/ai/ollama.ts'
import { DEFAULT_OLLAMA_MODEL } from '../src/store.ts'

// Das Compose-Profil „ki“ lädt ein Modell, das der Server als Standard erwartet. Die beiden
// Angaben stehen in verschiedenen Dateien und dürfen nicht auseinanderlaufen.
test('Standardmodell: Compose-Profil und Server nennen dasselbe Modell', () => {
  const compose = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docker-compose.yml'), 'utf8')
  const pulled = compose.match(/\$\{NKA_OLLAMA_MODEL:-([^}]+)\}/)?.[1]
  assert.equal(pulled, DEFAULT_OLLAMA_MODEL)
})

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
