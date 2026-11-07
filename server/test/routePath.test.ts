// Ein Pfad, wie Express ihn einer Route zuordnet (#585). Gemessen an Express selbst: Jede Schreibweise, die Express
// auf eine Route bringt, ergibt mit `routePath` deren Pfad, und keine andere tut es.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { routePath } from '../src/routePath.ts'

const VARIANTS = (route: string): string[] => {
  const upper = route.toUpperCase()
  const mixed = route.replace(/\/(.)/g, (_, c: string) => `/${c.toUpperCase()}`)
  const encoded = route.replace(/[a-z](?=[a-z]*$)/, (c) => `%${c.charCodeAt(0).toString(16)}`)
  return [
    route, upper, mixed, `${route}/`, `${upper}/`, `${route}//`, `/${route}`, route.replace('/', '//'),
    route.replace(/\/([^/]*)$/, '//$1'), encoded, encoded.toUpperCase(), `${route}%2F`, `${route}%20`, `${route}.`,
    `${route};x`, route.replace(/\/([^/]*)$/, '/./$1'), route.replace(/\/([^/]*)$/, '/x/../$1'), `${route}?a=1`, `${route}/?a=1`,
  ]
}

async function routedBy(paths: string[], routes: string[]): Promise<Map<string, string | null>> {
  const app = express()
  for (const route of routes) app.all(route, (req, res) => void res.send(route))
  app.use((req, res) => void res.status(404).send(''))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  const result = new Map<string, string | null>()
  try {
    for (const urlPath of paths) {
      const answer = await new Promise<{ status: number, body: string }>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST' }, (res) => {
          let body = ''
          res.on('data', (c: Buffer) => { body += c })
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
        })
        req.on('error', reject)
        req.end()
      })
      result.set(urlPath, answer.status === 200 ? answer.body : null)
    }
  } finally {
    server.close()
  }
  return result
}

// Wie req.path: der Pfad, wie er kam, ohne Abfrage (parseurl), nicht über URL, das // und /./ umdeutet
const pathOf = (urlPath: string): string => urlPath.split('?')[0]

test('routePath: Groß und Klein und ein Schrägstrich am Ende wie bei Express, sonst nichts (#585)', async () => {
  const routes = ['/api/quit', '/api/update/check', '/api/ai/key', '/api/ai/consent']
  const paths = routes.flatMap(VARIANTS)
  const routed = await routedBy(paths, routes)
  for (const urlPath of paths) {
    const route = routed.get(urlPath) ?? null
    const normal = routePath(pathOf(urlPath))
    if (route) assert.equal(normal, route, `Express nimmt ${urlPath} als ${route}`)
    else assert.ok(!routes.includes(normal), `Express nimmt ${urlPath} nicht an, routePath ergibt ${normal}`)
  }
  // Die Probe deckt beide Seiten ab
  assert.ok([...routed.values()].filter(Boolean).length >= routes.length * 4)
  assert.ok([...routed.values()].filter((v) => v === null).length >= routes.length * 4)
})

test('routePath: Routen mit Kennung (/api/ai/key/:slot) bleiben unter ihrem Anfang', async () => {
  const routes = ['/api/ai/key/:slot', '/api/ai/consent/:slot']
  const paths = ['/api/ai/key/text', '/API/AI/KEY/TEXT', '/api/ai/key/text/', '/Api/Ai/Key/te%78t', '/api/ai/consent/%2e%2e', '/API/ai/consent/images/']
  const routed = await routedBy(paths, routes)
  for (const urlPath of paths) {
    const route = routed.get(urlPath)
    assert.ok(route, `Express nimmt ${urlPath} an`)
    assert.ok(routePath(pathOf(urlPath)).startsWith(route.replace(':slot', '')), urlPath)
  }
})

test('routePath: Wurzel und leerer Pfad bleiben', () => {
  assert.equal(routePath('/'), '/')
  assert.equal(routePath(''), '')
  assert.equal(routePath('/API/QUIT/'), '/api/quit')
})
