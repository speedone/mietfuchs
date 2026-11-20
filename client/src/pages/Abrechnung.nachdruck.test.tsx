// @vitest-environment jsdom
// Nachdruck einer abgeschlossenen Abrechnung (#447, Kompatibilitätszusage „Zahlen“): Der Abschluss friert Zahlen und
// Anschreiben ein, gedruckt wird aber mit der Oberfläche von heute. Hier rendert die Seite Abrechnung eingefrorene
// Stände, **wie veröffentlichte Versionen sie geschrieben haben** (server/test/fixtures/releases/<Version>/expected.json,
// erzeugt von scripts/altbestand-fixture.mjs mit dem Server der Version), und der gedruckte Text jeder
// Mieterabrechnung (Anschreiben und Aufstellung, ohne die Bedienelemente des Bildschirms) wird wortgleich mit
// nachdruck.txt im selben Ordner verglichen (dort und nicht unter client/src, weil Tailwind jedes Wort unter src/ liest).
//
// **Wann die Textdatei erneuert werden darf.** Für einen Stand einer veröffentlichten Version: nur, wenn die Änderung
// am Nachdruck gewollt ist, im CHANGELOG steht und keinen Betrag, keine Zeile und keinen Satz des zugestellten
// Schreibens ändert oder weglässt (etwa eine neue Überschrift oder ein anderer Fußvermerk); der Unterschied der beiden
// Fassungen gehört dann in die PR-Beschreibung. Die Stände selbst (expected.json) werden nie erneuert. Kommt eine neue
// Art von Abschluss dazu (ein neues eingefrorenes Feld), entsteht zu ihrer Version ein neuer Stand daneben; die alten
// bleiben, denn solche Abschlüsse liegen bei Nutzern.
//
// Neu erzeugen: `NACHDRUCK=diff npm --prefix client test -- nachdruck` legt das Ist-Ergebnis als nachdruck.actual.txt
// daneben; übernommen wird von Hand.
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { PeriodProvider } from '../period'
import type { Property, Settings, Settlement, Tenancy, Unit } from '../types'
import { PropertyProvider } from '../property'
import { UIProvider } from '../components/feedback'
import Abrechnung from './Abrechnung'
import { DEFAULT_LETTER_TEXTS } from '../../../shared/letter.ts'

vi.setConfig({ testTimeout: 30000 })

// Die Stände und Texte lädt Vite (unter jsdom ist `import.meta.url` kein Pfad auf der Platte). Nur das Schreiben des
// Ist-Ergebnisses braucht node:fs; dessen Typen kennt der Client nicht (tsconfig), deshalb wie in letterCss.test.ts.
const STOCKS = import.meta.glob<string>('../../../server/test/fixtures/releases/*/expected.json', { eager: true, query: '?raw', import: 'default' })
const TEXTS = import.meta.glob<string>('../../../server/test/fixtures/releases/*/nachdruck.txt', { eager: true, query: '?raw', import: 'default' })
const versionOf = (file: string): string => file.split('/').at(-2) ?? ''
const byVersion = (files: Record<string, string>): Map<string, string> => new Map(Object.entries(files).map(([file, text]) => [versionOf(file), text]))
const node = (globalThis as { process?: { env: Record<string, string | undefined>, cwd: () => string } }).process
async function writeActual(version: string, text: string): Promise<void> {
  if (node?.env.NACHDRUCK !== 'diff') return
  const fsModule = 'node:fs'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { writeFileSync: (file: string, text: string, encoding: 'utf8') => void }
  // Der Lauf startet im Ordner client/ (npm --prefix client test).
  fs.writeFileSync(`${node.cwd()}/../server/test/fixtures/releases/${version}/nachdruck.actual.txt`, text, 'utf8')
}

type Fixture = {
  version: string
  year: number
  today: string
  settings: Settings
  properties: { id: string, name: string, property: Property, units: Unit[], tenancies: Tenancy[], settlement: Settlement }[]
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

// Der Text, wie er auf dem Papier steht: ohne alles, was im Druck verborgen ist (`no-print`, `print:hidden`), ohne
// Knöpfe und Felder; was nur am Bildschirm zugeklappt ist (`hidden` mit `print:block` oder `print-only`), steht im
// Druck und zählt mit. Eine Zeile je Block, die Zellen einer Tabellenzeile mit „ | “ getrennt, die Angaben des
// Informationsblocks (Raster aus `span`) je in einer Zeile, damit die Datei sich lesen und vergleichen lässt.
const BLOCKS = new Set(['DIV', 'P', 'TR', 'H1', 'H2', 'H3', 'H4', 'LI', 'TABLE', 'SECTION', 'HEADER', 'FOOTER', 'ADDRESS', 'BR', 'DT', 'DD', 'CAPTION', 'FIGCAPTION'])
function printedText(root: Element): string {
  let out = ''
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
      return
    }
    if (!(node instanceof Element)) return
    const shownInPrint = node.classList.contains('print:block') || node.classList.contains('print-only')
    if (node.classList.contains('no-print') || node.classList.contains('print:hidden') || (node.hasAttribute('hidden') && !shownInPrint)) return
    if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SVG', 'svg', 'STYLE'].includes(node.tagName)) return
    const block = BLOCKS.has(node.tagName) || [...node.classList].some((c) => c.startsWith('letter-info-'))
    if (block) out += '\n'
    node.childNodes.forEach(walk)
    if (node.tagName === 'TD' || node.tagName === 'TH') out += ' | '
    if (block) out += '\n'
  }
  walk(root)
  return out.split('\n').map((line) => line.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').replace(/( \|)+ *$/, '').trim()).filter(Boolean).join('\n')
}

const stocks = byVersion(STOCKS)
const texts = byVersion(TEXTS)
const versions = [...stocks.keys()].sort()

test('es gibt Stände zum Nachdrucken, darunter den aus 0.13.1', () => {
  expect(versions).toContain('0.13.1')
})

for (const version of versions) {
  test(`Nachdruck eines Abschlusses aus ${version}: der gedruckte Text jeder Mieterabrechnung bleibt wortgleich`, async () => {
    const fixture = JSON.parse(stocks.get(version) ?? '') as Fixture
    const closed = fixture.properties.find((p) => p.settlement.closed)
    if (!closed) throw new Error(`Der Stand aus ${version} enthält keine abgeschlossene Abrechnung`)
    // Der Tag, an dem die Version den Stand schrieb: Die Seite wählt damit denselben Zeitraum vor.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${fixture.today}T12:00:00`))
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      if (init?.method && init.method !== 'GET') throw new Error(`Der Nachdruck schreibt nichts: ${init.method} ${url}`)
      const route = url.split('?')[0] ?? url
      if (route === '/api/properties') return json([closed.property])
      if (route === `/api/settlement/${fixture.year}`) return json(closed.settlement)
      if (route === '/api/letter-texts') return json({ defaults: DEFAULT_LETTER_TEXTS, installation: {}, property: {}, adjustDefault: 'suggestion' })
      if (route === `/api/settlement/${fixture.year}/letters`) return json({})
      return json([])
    })
    render(
      <PeriodProvider>
        <PropertyProvider>
          <UIProvider><Abrechnung settings={fixture.settings} units={closed.units} tenancies={closed.tenancies} reload={async () => {}} /></UIProvider>
        </PropertyProvider>
      </PeriodProvider>,
    )
    const count = closed.settlement.statements.length
    expect(count).toBeGreaterThan(0)
    await waitFor(() => expect(document.querySelectorAll('.statement').length).toBe(count), { timeout: 15000 })
    await screen.findAllByRole('table')
    const actual = `${[...document.querySelectorAll('.statement')].map((card, i) => `===== Mieterabrechnung ${i + 1} von ${count} =====\n${printedText(card)}`).join('\n\n')}\n`

    await writeActual(version, actual)
    const message =
      `Der Nachdruck eines Abschlusses aus ${version} sieht anders aus als bisher. Der Stand ist eingefroren und wurde so zugestellt (Kompatibilitätszusage ab 1.0, „Zahlen“): ` +
      'Beträge, Zeilen und Sätze des zugestellten Schreibens dürfen sich nicht ändern oder fehlen. Ist die Änderung an der Darstellung gewollt, steht sie im CHANGELOG, und ' +
      `server/test/fixtures/releases/${version}/nachdruck.txt wird bewusst erneuert (NACHDRUCK=diff npm --prefix client test -- nachdruck, dann nachdruck.actual.txt übernehmen und den Unterschied in der PR-Beschreibung zeigen). ` +
      'Die Stände selbst (server/test/fixtures/releases/…/expected.json) werden nie erneuert; für eine neue Art von Abschluss kommt ein neuer Stand daneben.'
    expect(texts.has(version), `nachdruck.txt zu ${version} fehlt. ${message}`).toBe(true)
    expect(actual, message).toBe(texts.get(version))

    // Jeder eingefrorene Saldo und jeder Anteil steht im gedruckten Text, als Betrag in deutscher Schreibweise.
    const euro = (cents: number) => (Math.abs(cents) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    for (const st of closed.settlement.statements) {
      expect(actual, `Saldo von ${st.tenantName}`).toContain(euro(st.balanceCents))
      expect(actual, `Summe der Kosten von ${st.tenantName}`).toContain(euro(st.totalShareCents))
    }
  })
}
