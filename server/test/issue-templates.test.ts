// Weg für Rückfragen (#447): Issue-Vorlagen als Formulare, Fragen über die Diskussionen, Sicherheitslücken vertraulich.
// Der Wächter liest die Dateien als Text (kein YAML-Paket im Projekt) und hält fest, was nicht verloren gehen darf: die
// Warnung vor echten Mieterdaten, die Labels des Projekts (Art ohne Präfix, keine Bereichs-Labels) und dieselben Adressen
// wie in der App, im README und in der Doku.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DISCUSSIONS_URL, NEW_ISSUE_URL, SECURITY_REPORT_URL } from '../../shared/support.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = path.join(ROOT, '.github/ISSUE_TEMPLATE')
const read = (file: string): string => {
  const full = path.join(ROOT, file)
  if (!fs.existsSync(full)) return assert.fail(`${file} fehlt`)
  return fs.readFileSync(full, 'utf8')
}
// Die Labels der Art aus CLAUDE.md („Labels“); Priorität und Status vergibt der Herausgeber, nicht die Vorlage.
const KIND_LABELS = ['bug', 'enhancement', 'documentation', 'chore']

test('Issue-Vorlagen: Formulare auf Deutsch mit einem Label der Art, Pflichtfeldern und der Warnung vor echten Daten', () => {
  const forms = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.yml') && f !== 'config.yml') : []
  assert.ok(forms.includes('fehler.yml'), 'Vorlage „Fehler melden“ fehlt')
  for (const f of forms) {
    const text = read(`.github/ISSUE_TEMPLATE/${f}`)
    assert.match(text, /^name: .+$/m, `${f}: name`)
    assert.match(text, /^description: .+$/m, `${f}: description`)
    assert.match(text, /^body:$/m, `${f}: body`)
    const labels = /^labels: \[(.*)\]$/m.exec(text)?.[1]?.split(',').map((l) => l.trim().replace(/^["']|["']$/g, '')) ?? []
    assert.equal(labels.length, 1, `${f}: genau ein Label der Art`)
    assert.ok(KIND_LABELS.includes(labels[0] ?? ''), `${f}: unbekanntes Label ${labels[0]}`)
    // Issues sind öffentlich: Die Warnung steht in jeder Vorlage, sichtbar vor den Feldern.
    assert.match(text, /keine echten Mieterdaten, Namen oder Belege/i, `${f}: Warnung fehlt`)
    assert.match(text, /öffentlich/, `${f}: „öffentlich“ fehlt`)
    // Kennungen der Felder sind eindeutig, sonst lehnt GitHub das Formular ab.
    const ids = [...text.matchAll(/^ {4}id: (\S+)$/gm)].map((m) => m[1])
    assert.equal(new Set(ids).size, ids.length, `${f}: doppelte Kennung`)
  }
  const bug = read('.github/ISSUE_TEMPLATE/fehler.yml')
  assert.match(bug, /^labels: \[bug\]$/m)
  for (const id of ['version', 'betriebsart', 'schritte', 'erwartet', 'geschehen']) assert.match(bug, new RegExp(`^ {4}id: ${id}$`, 'm'), `Feld ${id} fehlt`)
  // Die Betriebsarten, in denen Mietfuchs ausgeliefert wird (wie in SECURITY.md)
  for (const mode of ['Microsoft Store', 'Installer', 'macOS', 'Linux-Paket', 'Programmdatei', 'Docker', 'Quellcode']) assert.ok(bug.includes(mode), `Betriebsart ${mode} fehlt`)
  assert.ok(bug.includes('Über Mietfuchs'), 'wo die Version steht')
})

test('Issue-Vorlagen: Fragen gehen in die Diskussionen, Sicherheitslücken vertraulich', () => {
  const config = read('.github/ISSUE_TEMPLATE/config.yml')
  assert.match(config, /^blank_issues_enabled: (true|false)$/m)
  assert.match(config, /^contact_links:$/m)
  assert.ok(config.includes(`url: ${DISCUSSIONS_URL}`), 'Diskussionen fehlen')
  assert.ok(config.includes(`url: ${SECURITY_REPORT_URL}`), 'vertrauliche Meldung fehlt')
  assert.equal([...config.matchAll(/^ {2}- name: /gm)].length, [...config.matchAll(/^ {4}about: /gm)].length)
})

test('README, Doku und CONTRIBUTING nennen denselben Weg für Fragen und Fehler und die Anleitung für den Anfang', () => {
  for (const file of ['README.md', 'docs/README.md', 'CONTRIBUTING.md']) {
    const text = read(file)
    assert.ok(text.includes(DISCUSSIONS_URL), `${file}: Diskussionen fehlen`)
    assert.ok(text.includes(NEW_ISSUE_URL), `${file}: Fehler melden fehlt`)
  }
  const readme = read('README.md')
  assert.match(readme, /^## Erste Schritte$/m)
  assert.match(readme, /^## Fragen und Fehler$/m)
  assert.ok(readme.includes('„Die erste Abrechnung von Anfang bis Ende“'), 'README nennt die Anleitung nicht')
  assert.ok(read('docs/README.md').includes('„Die erste Abrechnung von Anfang bis Ende“'), 'docs/README.md nennt die Anleitung nicht')
  // Die Sprungmarken, auf die App und Release-Notes verlinken, bleiben.
  for (const h of ['## Funktionen', '## Herunterladen', '### macOS', '### Mit Docker', '## KI-Belegauswertung', '## Mitmachen']) assert.ok(readme.includes(`\n${h}\n`), `README: ${h} fehlt`)
})
