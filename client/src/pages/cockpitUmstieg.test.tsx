// @vitest-environment jsdom
// Der Hinweis auf das eigene Programmfenster (#517) im Cockpit: nur, wenn der Server ihn anbietet (Programmdatei unter
// Windows oder macOS), und nach „Später“ für diese Version nicht mehr. Inhalt und Knöpfe prüft Update.test.tsx.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Settings, UpdateStatus } from '../types'
import { PeriodProvider } from '../period'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Cockpit from './Cockpit'

vi.setConfig({ testTimeout: 20000 })
const SLOW = { timeout: 5000 }
const TITLE = 'Mietfuchs gibt es jetzt als eigenes Programm'

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: false, current: '0.15.0', mode: 'binary', desktopOffer: 'windows', latest: null, available: false,
  releaseUrl: null, downloadUrl: null, checkedAt: null, error: null, ...patch,
})
const settings = (patch: Partial<Settings> = {}): Settings => ({
  houseName: '', address: '', landlordName: 'Erika', iban: '', paymentDeadlineDays: 30, ollamaUrl: '', ollamaModel: '', updateCheck: 'off', ...patch,
})

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.split('?')[0] ?? url
    const body = path === '/api/properties' ? [{ id: 'objekt-1', name: 'Lindenweg 12', kind: 'mfh', address: '' }] : []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const page = (s: Settings, st: UpdateStatus | null) => render(
  <PeriodProvider>
    <PropertyProvider>
      <UIProvider>
        <Cockpit units={[]} tenancies={[]} settings={s} updateStatus={st} reload={async () => {}} onNavigate={() => {}} />
      </UIProvider>
    </PropertyProvider>
  </PeriodProvider>,
)

test('Programmdatei unter Windows: der Hinweis steht im Cockpit, auch ohne Zustimmung zur Update-Prüfung', async () => {
  page(settings(), status())
  expect(await screen.findByRole('heading', { name: TITLE }, SLOW)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Aus dem Microsoft Store laden' })).toBeTruthy()
})

test('Ohne Angebot, nach „Später“ für diese Version und vor dem Stand des Servers kein Hinweis', async () => {
  for (const [s, st] of [
    [settings(), status({ desktopOffer: null, mode: 'desktop' })],
    [settings({ desktopHintDismissed: '0.15.0' }), status()],
    [settings(), null],
  ] as const) {
    page(s, st)
    expect(await screen.findByRole('heading', { name: /Cockpit/ }, SLOW)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
    cleanup()
  }
})
