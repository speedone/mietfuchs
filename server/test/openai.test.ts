// Hilfsfunktionen des Moduls für OpenAI-kompatible Dienste (#18): Umformung des JSON-Schemas
// für den strikten Modus, Lesen der Fehlerformate verschiedener Dienste, Lesen des SSE-Stroms
// und das Herauslösen von JSON aus einer Antwort. Das Zusammenspiel mit einem nachgebauten
// Dienst prüft api.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toStrictSchema, stripAddedNulls, readProviderError, readCompletionStream, parseJsonContent } from '../src/ai/openai.ts'
import type { JsonSchema, ProviderProgressEvent } from '../src/ai/ollama.ts'

// Ein Schritt in ein Teilschema hinein. `properties` und `items` sind im Typ optional, weil
// nicht jedes Schema sie hat. Fehlt hier eines, ist die Umformung falsch, und das soll der Test
// mit Ansage melden statt am Zugriff auf undefined zu scheitern.
const prop = (schema: JsonSchema, name: string): JsonSchema => {
  const child = schema.properties?.[name]
  if (!child) assert.fail(`Teilschema „${name}“ fehlt`)
  return child
}
const itemsOf = (schema: JsonSchema): JsonSchema => {
  if (!schema.items) assert.fail('Teilschema „items“ fehlt')
  return schema.items
}

const SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string' },
    periodStart: { type: ['string', 'null'] },
    positions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          category: { type: 'string', enum: ['A', 'B'] },
          labor35aEur: { type: ['number', 'null'] },
          note: { type: 'string', enum: ['x', 'y'] },
        },
        required: ['description', 'category'],
      },
    },
    totalGrossEur: { type: 'number' },
  },
  required: ['vendor', 'positions'],
}

// ---------- Schema für den strikten Modus ----------

test('Striktes Schema: überall additionalProperties false und alle Felder Pflicht', () => {
  const strict = toStrictSchema(SCHEMA)
  assert.equal(strict.additionalProperties, false)
  assert.deepEqual(strict.required, ['vendor', 'periodStart', 'positions', 'totalGrossEur'])
  const item = itemsOf(prop(strict, 'positions'))
  assert.equal(item.additionalProperties, false)
  assert.deepEqual(item.required, ['description', 'category', 'labor35aEur', 'note'])
})

test('Striktes Schema: bisher optionale Felder dürfen null sein, Pflichtfelder bleiben, wie sie sind', () => {
  const strict = toStrictSchema(SCHEMA)
  assert.deepEqual(prop(strict, 'totalGrossEur').type, ['number', 'null'])
  assert.deepEqual(prop(strict, 'periodStart').type, ['string', 'null']) // schon vorher erlaubt
  assert.equal(prop(strict, 'vendor').type, 'string')
  const item = itemsOf(prop(strict, 'positions'))
  assert.deepEqual(prop(item, 'note').type, ['string', 'null'])
  assert.deepEqual(prop(item, 'note').enum, ['x', 'y', null])
  assert.equal(prop(item, 'category').type, 'string')
  assert.deepEqual(prop(item, 'category').enum, ['A', 'B'])
  // Das Original bleibt unverändert
  assert.equal(SCHEMA.properties.totalGrossEur.type, 'number')
})

test('Striktes Schema: Nullwerte, die nur der strikte Modus erzwingt, fallen wieder weg', () => {
  const data = {
    vendor: 'Stadtwerke', periodStart: null, totalGrossEur: null,
    positions: [{ description: 'Wasser', category: 'A', labor35aEur: null, note: null }],
  }
  assert.deepEqual(stripAddedNulls(data, SCHEMA), {
    vendor: 'Stadtwerke', periodStart: null,
    positions: [{ description: 'Wasser', category: 'A', labor35aEur: null }],
  })
})

// ---------- Fehlerformate ----------

test('Fehler: die Formate von OpenAI, Mistral, IONOS und Ollama werden gleich gelesen', () => {
  assert.deepEqual(
    readProviderError(JSON.stringify({ error: { message: "Unsupported value: 'temperature'", type: 'invalid_request_error', param: 'temperature', code: 'unsupported_value' } })),
    { message: "Unsupported value: 'temperature'", code: 'unsupported_value', param: 'temperature' },
  )
  assert.deepEqual(
    readProviderError(JSON.stringify({ object: 'error', message: 'Invalid model: x', type: 'invalid_request_error', param: 'model', code: 'unknown_model' })),
    { message: 'Invalid model: x', code: 'unknown_model', param: 'model' },
  )
  assert.deepEqual(
    readProviderError(JSON.stringify({ httpStatus: 401, messages: [{ errorCode: 'INVALID_TOKEN', message: 'Token abgelaufen' }] })),
    { message: 'Token abgelaufen', code: 'INVALID_TOKEN', param: null },
  )
  // IONOS schickt errorCode auch als Zahl, nicht nur als Zeichenkette
  assert.deepEqual(
    readProviderError(JSON.stringify({ httpStatus: 400, messages: [{ errorCode: 4001, message: 'Ungültige Anfrage' }] })),
    { message: 'Ungültige Anfrage', code: 4001, param: null },
  )
  assert.deepEqual(readProviderError(JSON.stringify({ error: 'model not found' })), { message: 'model not found', code: null, param: null })
  assert.deepEqual(readProviderError('<html>Bad Gateway</html>'), { message: '<html>Bad Gateway</html>', code: null, param: null })
})

// ---------- SSE-Strom ----------

async function* chunks(...parts: string[]) {
  const encoder = new TextEncoder()
  for (const part of parts) yield encoder.encode(part)
}
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
const delta = (d: unknown, extra: Record<string, unknown> = {}) =>
  event({ choices: [{ index: 0, delta: d, finish_reason: null }], ...extra })

test('Strom: Inhalt über Chunk-Grenzen hinweg, Kommentare, Kennzahlen und [DONE]', async () => {
  const progress: ProviderProgressEvent[] = []
  const stream = chunks(
    ': ping\n\n',
    delta({ role: 'assistant', content: '{"a":' }).slice(0, 20),
    delta({ role: 'assistant', content: '{"a":' }).slice(20),
    delta({ content: '1}' }),
    event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
    event({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 7 } }),
    'data: [DONE]\n\n',
  )
  const result = await readCompletionStream(stream, null, (p) => progress.push(p))
  assert.equal(result.content, '{"a":1}')
  assert.equal(result.finishReason, 'stop')
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 7 })
  assert.deepEqual(progress.at(-1), { phase: 'writing', chars: 7 })
})

test('Strom: Zeilenenden mit CRLF und ein Strom ohne [DONE]', async () => {
  const stream = chunks(delta({ content: '{"b":2}' }).replaceAll('\n', '\r\n'))
  assert.equal((await readCompletionStream(stream, null)).content, '{"b":2}')
})

test('Strom: Mistral schickt Inhalt als Liste, Denktext zählt nur für den Fortschritt', async () => {
  const progress: ProviderProgressEvent[] = []
  const stream = chunks(
    delta({ content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Ich prüfe die Summe.' }] }] }),
    delta({ reasoning_content: 'Noch mehr Gedanken.' }),
    delta({ content: [{ type: 'text', text: '{"c":3}' }] }),
  )
  const result = await readCompletionStream(stream, null, (p) => progress.push(p))
  assert.equal(result.content, '{"c":3}')
  assert.ok(result.reasoningChars > 0)
  assert.ok(progress.some((p) => p.phase === 'thinking'))
})

test('Strom: ein Fehler mitten im Strom wird zum Fehler, auch bei Status 200', async () => {
  await assert.rejects(readCompletionStream(chunks(delta({ content: '{' }), event({ error: { message: 'Server overloaded', code: 'overloaded' } })), null), /Server overloaded/)
  await assert.rejects(readCompletionStream(chunks('event: error\ndata: {"message":"kaputt"}\n\n'), null), /kaputt/)
})

// ---------- JSON aus der Antwort ----------

test('JSON: auch in Codeblöcken oder mit Text drumherum', () => {
  assert.deepEqual(parseJsonContent('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJsonContent('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonContent('Hier ist das Ergebnis:\n{"a":{"b":2}}\nViel Erfolg!'), { a: { b: 2 } })
  assert.equal(parseJsonContent('kein JSON'), undefined)
  assert.equal(parseJsonContent('[1,2]'), undefined) // erwartet wird ein Objekt
})
