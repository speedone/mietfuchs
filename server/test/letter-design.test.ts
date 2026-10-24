// Logo und Briefpapier (#415, Teil 2b): die reinen Regeln in shared/letterDesign.ts. Welche Dateien angenommen
// werden (am Inhalt erkannt, nicht am Namen), wie sie heißen, welche Ränder gehen und welche Gestaltung gilt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LetterDesign } from '../../shared/types.ts'
import {
  DEFAULT_LETTER_DESIGN, LETTER_DESIGN_LIMITS, MARGIN_LIMITS, designFileName, effectiveLetterDesign, isDesignFileName, isSvgFile,
  letterDesignFiles, marginProblems, parseMargins, sniffDesignFile,
} from '../../shared/letterDesign.ts'

const bytes = (s: string | number[]): Uint8Array => (typeof s === 'string' ? new TextEncoder().encode(s) : Uint8Array.from(s))
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]

test('Briefpapier: Dateien werden am Inhalt erkannt, nicht am Namen', () => {
  assert.equal(sniffDesignFile(bytes(PNG), 'logo'), 'png')
  assert.equal(sniffDesignFile(bytes(JPG), 'logo'), 'jpg')
  assert.equal(sniffDesignFile(bytes('%PDF-1.7\n…'), 'paper'), 'pdf')
  // Ein Logo ist ein Bild; eine PDF nur als Briefpapier.
  assert.match(String(sniffDesignFile(bytes('%PDF-1.7\n'), 'logo')), /PNG oder JPG/)
  // Was nichts davon ist, wird abgelehnt, mit einem Satz.
  assert.match(String(sniffDesignFile(bytes('GIF89a'), 'paper')), /PNG, JPG oder eine PDF/)
  // SVG nimmt der Server nicht an (Durchsicht S1): Eine Prüfung auf Skripte nach Mustern ließ sich umgehen. Der Browser
  // wandelt ein gewähltes SVG vor dem Hochladen in ein PNG um; der Server sieht nur PNG, JPG und PDF.
  assert.match(String(sniffDesignFile(bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'logo')), /PNG oder JPG/)
  assert.match(String(sniffDesignFile(bytes('<svg viewBox="0 0 10 10"/>'), 'paper')), /PNG, JPG oder eine PDF/)
  // Erkennen kann die Oberfläche es trotzdem, um es umzuwandeln.
  assert.equal(isSvgFile(bytes('\ufeff<?xml version="1.0"?>\n<!-- Logo -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), true)
  assert.equal(isSvgFile(bytes('<html><svg/></html>')), false)
})

test('Briefpapier: Namen vergibt Mietfuchs, und nur diese Gestalt gilt', () => {
  assert.equal(designFileName('logo', '0123456789abcdef', 'png'), 'logo-0123456789abcdef.png')
  assert.equal(designFileName('paper', '0123456789abcdef', 'pdf'), 'paper-0123456789abcdef.pdf')
  for (const ok of ['logo-0123456789abcdef.png', 'paper-0123456789abcdef.pdf', 'paper-0123456789abcdef.jpg']) assert.equal(isDesignFileName(ok), true, ok)
  for (const bad of ['../logo-0123456789abcdef.png', 'logo-0123456789abcdef.png/..', 'logo-0123.png', 'logo-0123456789abcdef.exe', 'logo-0123456789abcdef.svg', 'Logo-0123456789abcdef.png', 'logo-0123456789abcdef.png ', '']) {
    assert.equal(isDesignFileName(bad), false, bad)
  }
})

test('Briefpapier: Ränder in ganzen Millimetern innerhalb der Grenzen, alle Meldungen auf einmal', () => {
  assert.deepEqual(parseMargins({ top: 30, right: 20, bottom: 25, left: 25 }), { margins: { top: 30, right: 20, bottom: 25, left: 25 } })
  const bad = parseMargins({ top: 5, right: 20.5, bottom: 'x', left: 99 })
  assert.ok('problems' in bad)
  assert.deepEqual(bad.problems.map((p) => p.field), ['top', 'right', 'bottom', 'left'])
  assert.match(bad.problems[0]?.message ?? '', new RegExp(`${MARGIN_LIMITS.top.min} und ${MARGIN_LIMITS.top.max} mm`))
  assert.deepEqual(marginProblems(DEFAULT_LETTER_DESIGN.margins), [])
  // Oben höchstens 70 mm (Durchsicht M1): Chromium wiederholt einen Tabellenkopf ab rund einem Viertel der Seitenhöhe
  // nicht mehr, und ab 76 mm druckte der Inhalt der Folgeseiten in den Briefkopf (nachgemessen mit page.pdf).
  assert.equal(MARGIN_LIMITS.top.max, 70)
  assert.ok('margins' in parseMargins({ top: 70, right: 20, bottom: 20, left: 25 }))
  assert.ok('problems' in parseMargins({ top: 71, right: 20, bottom: 20, left: 25 }))
})

test('Briefpapier: das Objekt hat eine eigene Gestaltung oder die der Einstellungen gilt', () => {
  const own: LetterDesign = { ...DEFAULT_LETTER_DESIGN, logo: { file: 'logo-0123456789abcdef.png', type: 'png' } }
  assert.equal(effectiveLetterDesign({ installation: own, property: null }), own)
  assert.equal(effectiveLetterDesign({ installation: own, property: DEFAULT_LETTER_DESIGN }), DEFAULT_LETTER_DESIGN)
  // Die Dateien einer Gestaltung, für Aufräumen und Backup; „dasselbe“ auf Folgeseiten braucht keine zweite.
  const paper: LetterDesign = { ...own, paper: { file: 'paper-0123456789abcdef.pdf', type: 'pdf' }, paperNext: 'other', paperNextFile: { file: 'paper-1123456789abcdef.png', type: 'png' } }
  assert.deepEqual(letterDesignFiles(paper), ['logo-0123456789abcdef.png', 'paper-0123456789abcdef.pdf', 'paper-1123456789abcdef.png'])
  assert.deepEqual(letterDesignFiles({ ...paper, paperNext: 'same' }), ['logo-0123456789abcdef.png', 'paper-0123456789abcdef.pdf'])
  assert.ok(LETTER_DESIGN_LIMITS.logo < LETTER_DESIGN_LIMITS.paper)
})

test('Briefpapier: die Grenzen der Ränder stehen in der Datenbank wie in shared/letterDesign.ts', () => {
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle', '0070_briefpapier.sql'), 'utf8')
  for (const [key, { min, max }] of Object.entries(MARGIN_LIMITS)) {
    assert.match(sql, new RegExp(`"margin_${key}" BETWEEN ${min} AND ${max}`), key)
  }
})
