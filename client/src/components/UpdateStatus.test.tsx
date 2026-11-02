// @vitest-environment jsdom
// Die Betriebsart kommt mit /api/update. Daran hängt „Mietfuchs beenden“ in der Seitenleiste (canQuit). Gefragt wurde
// erst nach geladenen Einstellungen, und die kommen aus der Datenbank: Ließ die sich nicht öffnen, fehlte der Knopf, und
// aus Store oder Programmdatei ging Mietfuchs nur noch über den Task-Manager zu beenden.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { UpdateStatus } from '../types'
import { canQuit } from '../update'
import { useUpdateStatus } from './Update'

const status: UpdateStatus = {
  enabled: false, current: '0.15.0', mode: 'store', desktopOffer: null, latest: null, available: false,
  releaseUrl: null, downloadUrl: null, checkedAt: null, error: null,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('ohne Einstellungen (Datenbank zu) kommt die Betriebsart trotzdem, und „Mietfuchs beenden“ bleibt da', async () => {
  vi.stubGlobal('fetch', async (url: string) => String(url) === '/api/update'
    ? new Response(JSON.stringify(status), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }))
  const { result } = renderHook(() => useUpdateStatus(null))
  await waitFor(() => expect(result.current.status?.mode).toBe('store'))
  expect(canQuit(result.current.status)).toBe(true)
})
