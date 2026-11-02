// Sprungmarken des README und Verweise der Doku. Die App, ältere Programmdateien und Release-Notes verlinken
// Stellen im README (`github.com/speedone/mietfuchs#macos` …); seit die Einzelheiten in docs/ stehen, muss jede
// dieser Marken im README weiter existieren, als Überschrift oder als `<a id="…">`. Dazu zeigt jeder relative
// Verweis in README.md und docs/*.md auf eine vorhandene Datei, und ein Anker darin auf eine vorhandene Stelle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Verlinkt aus client/src (Update.tsx, AiSettings.tsx), aus Release-Notes und aus der Doku älterer Versionen
const KEPT_ANCHORS = [
  'herunterladen--starten-ohne-installation',
  'ki-belegauswertung',
  'mit-docker',
  'macos',
  'installation-unter-windows-und-macos',
  'download-prüfen-für-fortgeschrittene',
  'windows-aus-dem-microsoft-store-empfohlen',
  'windows-mit-dem-installer',
  'umzug-von-der-bisherigen-programmdatei',
  'zugriff-vom-handy-oder-einem-zweiten-rechner',
]

// Zeilen außerhalb von Codeblöcken; in ``` steht kein Verweis und keine Überschrift
function proseLines(text: string): string[] {
  let fenced = false
  return text.split('\n').filter((line) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return false }
    return !fenced
  })
}

// Wie GitHub aus einer Überschrift die Marke bildet: Text ohne Auszeichnung, klein, nur Buchstaben, Ziffern,
// Leerzeichen, Binde- und Unterstriche, Leerzeichen werden zu Bindestrichen, Wiederholungen bekommen -1, -2 …
function githubSlug(heading: string): string {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*]/g, '')
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-')
}

function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>()
  const seen = new Map<string, number>()
  for (const line of proseLines(text)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      const slug = githubSlug(heading[1] ?? '')
      const n = seen.get(slug) ?? 0
      seen.set(slug, n + 1)
      anchors.add(n === 0 ? slug : `${slug}-${n}`)
    }
    for (const m of line.matchAll(/\b(?:id|name)="([^"]+)"/g)) if (m[1]) anchors.add(m[1])
  }
  return anchors
}

function linksOf(text: string): string[] {
  const links: string[] = []
  for (const line of proseLines(text)) {
    const plain = line.replace(/`[^`]*`/g, '')
    for (const m of plain.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) if (m[1]) links.push(m[1])
    for (const m of plain.matchAll(/\b(?:href|src)="([^"]+)"/g)) if (m[1]) links.push(m[1])
  }
  return links
}

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)

test('README: jede verlinkte Sprungmarke existiert weiter', () => {
  const anchors = anchorsOf(read('README.md'))
  const missing = KEPT_ANCHORS.filter((a) => !anchors.has(a))
  assert.deepEqual(missing, [], `Im README fehlen Sprungmarken, die App, Release-Notes oder Doku verlinken: ${missing.join(', ')}`)
})

test('README und docs/: jeder relative Verweis zeigt auf eine vorhandene Datei und Stelle', () => {
  const broken: string[] = []
  for (const file of ['README.md', ...docs]) {
    for (const link of linksOf(read(file))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue
      const [target = '', anchor] = link.split('#', 2)
      const resolved = target === '' ? path.join(ROOT, file) : path.resolve(path.dirname(path.join(ROOT, file)), decodeURIComponent(target))
      if (!fs.existsSync(resolved)) { broken.push(`${file}: ${link} (Datei fehlt)`); continue }
      if (anchor && resolved.endsWith('.md') && !anchorsOf(fs.readFileSync(resolved, 'utf8')).has(decodeURIComponent(anchor))) {
        broken.push(`${file}: ${link} (Stelle fehlt)`)
      }
    }
  }
  assert.deepEqual(broken, [], `Verweise ins Leere:\n${broken.join('\n')}`)
})

test('Sprungmarke: GitHub-Schreibweise der Überschriften', () => {
  const anchors = anchorsOf('## Windows: aus dem Microsoft Store (empfohlen)\n### Download prüfen (für Fortgeschrittene)\n## Mit Docker\n## Mit Docker\n<a id="herunterladen--starten-ohne-installation"></a>\n```\n# kein Titel\n```')
  assert.deepEqual([...anchors].sort(), ['download-prüfen-für-fortgeschrittene', 'herunterladen--starten-ohne-installation', 'mit-docker', 'mit-docker-1', 'windows-aus-dem-microsoft-store-empfohlen'])
})
