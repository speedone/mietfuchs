import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findings, report } from '../../scripts/virustotal-check.mjs'

// Ergebnis von v0.15.1 (gekürzt): Nur malicious und suspicious zählen, sortiert nach Scanner
test('VirusTotal: Befunde sind die Scanner mit malicious oder suspicious', () => {
  const found = findings({
    BitDefender: { category: 'malicious', result: 'GT:JS.PolinRider.2.D8C08B1B' },
    Kaspersky: { category: 'undetected', result: null },
    Avast: { category: 'type-unsupported', result: null },
    Arcabit: { category: 'malicious', result: 'GT:JS.PolinRider.2.D8C08B1B' },
    Zillya: { category: 'suspicious', result: 'Heur' },
  })
  assert.deepEqual(found.map((f) => `${f.engine}:${f.category}`), ['Arcabit:malicious', 'BitDefender:malicious', 'Zillya:suspicious'])
  assert.deepEqual(findings({}), [])
})

test('VirusTotal: Bericht nennt je Datei Befunde, sauber oder den Grund, warum nicht geprüft', () => {
  const md = report([
    { file: 'a/server.mjs', sha256: 'aa', stats: { undetected: 62 }, found: [] },
    { file: 'b/Mietfuchs-Setup-0.15.2.exe', sha256: 'bb', stats: null, found: [{ engine: 'BitDefender', category: 'malicious', result: 'GT:JS.X' }] },
    { file: 'c/Mietfuchs-0.15.2-intel.dmg', sha256: 'cc', stats: null, found: [], error: 'Analyse HTTP 500' },
  ])
  assert.match(md, /\| server\.mjs \| sauber \(62 ohne Befund\) \| \[Analyse\]\(https:\/\/www\.virustotal\.com\/gui\/file\/aa\) \|/)
  assert.match(md, /Mietfuchs-Setup-0\.15\.2\.exe \| BitDefender: malicious GT:JS\.X/)
  assert.match(md, /intel\.dmg \| nicht geprüft: Analyse HTTP 500/)
})
