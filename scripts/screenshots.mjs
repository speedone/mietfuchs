// Die Bildschirmfotos für das README (docs/screenshots/), reproduzierbar und zu jedem Release neu
// auszuführen:
//
//   npx playwright install chromium   # einmalig, lädt den Browser für Playwright
//   npm run screenshots               # baut die Oberfläche, startet einen Server, fotografiert
//   npm run screenshots -- --skip-build   # ohne den Bau, wenn client/dist schon aktuell ist
//
// Server und Beispielbestand kommen aus demo-stock.mjs, denselben nimmt der Browserlauf
// (browser-check.mjs). Dort steht auch, welche Angaben der Server bekommt; **alle Daten sind erfunden**.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { YEAR, loadPlaywright, startDemo } from './demo-stock.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const OUT = path.resolve(root, opt('out', 'docs/screenshots'))
const SKIP_BUILD = argv.includes('--skip-build')
// Feste Größe, damit die Bilder von Release zu Release vergleichbar bleiben
const VIEWPORT = { width: 1440, height: 900 }
const SCALE = Number(opt('scale', '1'))

// ---------- Fotografieren ----------
async function shoot(browser, base) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: 'light', locale: 'de-DE', timezoneId: 'Europe/Berlin',
  })
  // Helles Design fest, das erste Objekt gewählt
  await context.addInitScript(() => {
    try {
      localStorage.setItem('nka-theme', 'light')
    } catch {
      // ohne Speicher gilt das System, und das ist hier hell
    }
  })
  const page = await context.newPage()
  const problems = []
  page.on('pageerror', (err) => problems.push(`Fehler in der Seite: ${err.message}`))
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`Konsole: ${msg.text()}`) })
  await page.goto(base)
  await page.getByRole('button', { name: 'Cockpit' }).waitFor()

  const settle = async () => {
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
  }
  const go = async (label, { discard = false } = {}) => {
    await page.setViewportSize(VIEWPORT)
    await page.locator('nav.sidebar').getByRole('button', { name: label, exact: false }).first().click()
    if (discard) await page.getByRole('button', { name: 'Verwerfen', exact: true }).click()
    await settle()
    // Der Klick rollt die Seitenleiste mit, wenn der Eintrag unten steht; das Logo gehört ins Bild
    await page.evaluate(() => {
      const win = /** @type {any} */ (globalThis)
      win.scrollTo(0, 0)
      win.document.querySelector('nav.sidebar')?.scrollTo(0, 0)
    })
  }
  // Ein Element oben ins Bild holen, mit etwas Luft darüber
  const scrollTo = async (locator, gap = 24) => {
    await locator.evaluate((el, g) => {
      const win = /** @type {any} */ (globalThis)
      win.scrollTo(0, el.getBoundingClientRect().top + win.scrollY - g)
    }, gap)
    await page.waitForTimeout(200)
  }
  // Höher als der Bildschirm, wo das Wesentliche einer Seite sonst unter dem Rand läge
  const tall = async (height) => {
    await page.setViewportSize({ width: VIEWPORT.width, height })
    await settle()
  }
  const save = async (name) => {
    // Nichts Rotes im Bild: eine Fehlermeldung der Oberfläche hält das Skript an
    const alert = page.locator('.error, [role="alert"].error')
    if (await alert.count()) throw new Error(`${name}: Fehlermeldung im Bild: ${await alert.first().innerText()}`)
    const file = path.join(OUT, `${name}.png`)
    await page.screenshot({ path: file })
    console.log(`  ✓ ${path.relative(root, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`)
  }

  await settle()
  await save('cockpit')

  await go('Abrechnung')
  // Die Abrechnung des ersten Mieters, den Rechenweg ihrer ersten Zeile aufgeklappt
  await page.locator('button.calc-toggle').first().click()
  await scrollTo(page.locator('.card', { has: page.locator('tr.calc-steps') }).first())
  await save('abrechnung')

  await go('Mietkonto')
  await save('mietkonto')

  await go('Kosten')
  await save('kosten')

  await go('Kostenvergleich')
  await save('kostenvergleich')

  // Mit Eigennutzung: Werbungskosten je Position aufgeteilt in privat und abziehbar
  await go('Steuer (Anlage V)')
  await tall(1700)
  await save('steuer')

  await go('Zähler & Stände')
  await save('zaehler')

  await go('Stammdaten')
  await save('stammdaten')

  // Posteingang, Belegabdeckung, Mappen und die Register je Kostenart
  await go('Belegordner')
  await tall(1500)
  await page.waitForFunction(() => {
    // Im Browser ausgeführt; scripts/tsconfig.json kennt die Typen des DOM nicht
    const thumbs = [.../** @type {any} */ (globalThis).document.querySelectorAll('.receipt-thumb')]
    return thumbs.length > 0 && thumbs.every((/** @type {any} */ t) => {
      const img = t.querySelector('img')
      return img ? img.complete && img.naturalWidth > 0 : t.textContent?.trim() !== '…'
    })
  }, undefined, { timeout: 30000 })
  await save('belegordner')

  // Die offene Auswertung aus dem Posteingang: Ampel je Zeile, Vorschlag zum Verknüpfen
  await go('Schnellerfassung')
  const review = page.locator('.card', { hasText: 'bitte prüfen' }).first()
  await review.waitFor()
  // Die Rechnung gehört zur Position, die schon aus dem Vorjahr dasteht: verknüpfen statt doppelt
  // anlegen, dann zeigt die Vorschau, was mit der Position geschieht
  const action = review.locator('select').filter({ has: page.locator('option[value^="link:"]') }).first()
  const link = await action.locator('option[value^="link:"]').first().getAttribute('value')
  if (!link) throw new Error('Die Auswertung bietet kein Verknüpfen an.')
  await action.selectOption(link)
  await review.getByRole('button', { name: 'Vorschau' }).click()
  await review.locator('[aria-label="Vorschau"]').waitFor()
  await tall(1000)
  await save('auswertung-pruefen')

  // Eine Anleitung je Vermietungsart aufgeklappt
  // Die gewählte Aktion der Auswertung ist ein offener Entwurf (#355): Der Seitenwechsel fragt seit #356
  // nach, und die Aufnahme verwirft ihn ausdrücklich, statt dass die Rückfrage das Skript ausbremst.
  await go('Hilfe & Begriffe', { discard: true })
  const guide = page.locator('summary', { hasText: 'Haus mit Einliegerwohnung' }).first()
  await guide.click()
  await settle()
  await scrollTo(guide, 80)
  await save('hilfe')

  await context.close()
  if (problems.length) throw new Error(`Die Oberfläche hat Fehler gemeldet:\n${problems.join('\n')}`)
}

async function main() {
  const { chromium } = await loadPlaywright()
  if (!SKIP_BUILD) {
    console.log('Oberfläche bauen …')
    execSync('npm run build', { cwd: root, stdio: 'inherit' })
  }
  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
    throw new Error('client/dist fehlt. Bitte ohne --skip-build ausführen.')
  }
  fs.mkdirSync(OUT, { recursive: true })
  /** @type {{ base: string, stop: () => Promise<unknown> } | null} */
  let demo = null
  /** @type {import('playwright').Browser | null} */
  let browser = null
  try {
    // Eingebaute Felder wie das Monatsfeld nehmen die Sprache des Browsers, nicht `locale` des
    // Kontexts; ohne die Angabe stand dort auf einem englischen System „October 2026“.
    browser = await chromium.launch({ args: ['--lang=de-DE'], env: { ...process.env, LANG: 'de_DE.UTF-8' } })
    // Die Belege druckt derselbe Browser, der danach fotografiert (Bestand in demo-stock.mjs)
    const printer = await browser.newPage()
    const pdf = async (html) => {
      await printer.setContent(html)
      return printer.pdf({ format: 'A4', printBackground: true })
    }
    console.log(`Beispielbestand anlegen (Abrechnungsjahr ${YEAR}) …`)
    const started = await startDemo({ pdf, prefix: 'mietfuchs-screenshots-' })
    demo = started
    await printer.close()
    console.log(`Fotografieren nach ${path.relative(root, OUT)}/ …`)
    await shoot(browser, started.base)
  } finally {
    await browser?.close()
    await demo?.stop()
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
})
