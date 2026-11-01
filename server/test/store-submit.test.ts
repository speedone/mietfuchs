// scripts/store-submit.mjs (#500): Was beim Release in den Microsoft Store geht. Die Aufrufe der API
// lassen sich hier nicht prüfen, wohl aber Texte, Bilder und der Umbau der Einreichung.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSubmission, commitOutcome, draftHint, LANGUAGE, parseListing, releaseNotes, SCREENSHOTS } from '../../scripts/store-submit.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const md = fs.readFileSync(path.join(root, 'packaging', 'msix', 'store-eintrag.md'), 'utf8')

test('Store-Eintrag: Beschreibung ohne harte Umbrüche, Aufzählung je Zeile', () => {
  const { description } = parseListing(md)
  const paragraphs = description.split('\n\n')
  assert.ok(paragraphs[0].startsWith('Mietfuchs erstellt die Nebenkostenabrechnung'))
  assert.ok(!paragraphs[0].includes('\n'), 'ein Absatz ist eine Zeile')
  const list = paragraphs.find((p) => p.startsWith('Was Mietfuchs abdeckt:'))
  if (!list) return assert.fail('Absatz „Was Mietfuchs abdeckt“ fehlt')
  const items = list.split('\n').slice(1)
  assert.ok(items.length >= 5 && items.every((l) => l.startsWith('• ')), 'jeder Punkt eine Zeile mit „• “')
  assert.ok(!description.includes('**'), 'keine Auszeichnung aus Markdown')
})

test('Store-Eintrag: Funktionen und Suchbegriffe innerhalb der Grenzen des Partner Centers', () => {
  const { features, keywords } = parseListing(md)
  assert.ok(features.length >= 1 && features.length <= 20)
  assert.ok(features.every((f) => f.length <= 200 && !f.startsWith('-')))
  assert.ok(features.some((f) => f.startsWith('Belege ')), 'die Seite heißt seit 0.14 „Belege“')
  assert.equal(keywords.length, 7)
  assert.ok(keywords.includes('Anlage V'), 'Suchbegriffe über den Zeilenumbruch hinweg')
})

test('Store-Eintrag: Website, Datenschutzrichtlinie und Supportkontakt aus den Eigenschaften', () => {
  const { websiteUrl, privacyPolicy, supportContact } = parseListing(md)
  assert.equal(websiteUrl, 'https://mietfuchs-app.de')
  assert.equal(privacyPolicy, 'https://github.com/speedone/mietfuchs/blob/main/docs/datenschutz.md')
  assert.equal(supportContact, 'https://github.com/speedone/mietfuchs/issues')
  for (const label of ['Website', 'Datenschutzrichtlinie', 'Supportkontakt']) {
    assert.throws(() => parseListing(md.replace(`- ${label}: `, `- ${label}x: `)), new RegExp(label), `${label} fehlt`)
  }
  assert.throws(() => parseListing(md.replace('- Website: https://', '- Website: http://')), /Website/, 'nur https')
})

test('Store-Eintrag: Hinweis auf fehlende Beratung und Gewähr in der Beschreibung', () => {
  const { description } = parseListing(md)
  assert.match(description, /ersetzt aber keine Rechts- oder Steuerberatung/)
  assert.match(description, /ohne Gewähr/)
})

test('Store-Eintrag: ein fehlender Abschnitt bricht ab, statt den Store-Text zu leeren', () => {
  assert.throws(() => parseListing(md.replace('**Funktionen**', '**Merkmale**')), /Funktionen/)
})

test('Bildschirmfotos: vorhanden, PNG, innerhalb der Maße für Desktop-Apps', () => {
  assert.ok(SCREENSHOTS.length >= 1 && SCREENSHOTS.length <= 10)
  for (const s of SCREENSHOTS) {
    const buf = fs.readFileSync(path.join(root, 'docs', 'screenshots', s.file))
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', s.file)
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)]
    // Partner Center: mindestens 1366 × 768 (quer oder hoch), höchstens 3840 × 2160
    assert.ok(Math.max(w, h) >= 1366 && Math.min(w, h) >= 768, `${s.file}: ${w} × ${h} zu klein`)
    assert.ok(Math.max(w, h) <= 3840 && Math.min(w, h) <= 2160, `${s.file}: ${w} × ${h} zu groß`)
  }
})

test('Neuigkeiten: Version ohne „v“ und Link aufs Release', () => {
  assert.equal(
    releaseNotes('v0.14.0'),
    'Mietfuchs 0.14.0. Was neu ist und was beim Update zu beachten ist, steht unter https://github.com/speedone/mietfuchs/releases/tag/v0.14.0',
  )
})

// Gekürzt nach der veröffentlichten Einreichung vom 31.10.2026
const published = () => ({
  id: '1',
  status: 'PendingCommit',
  targetPublishMode: 'Manual',
  pricing: { priceId: 'Free' },
  applicationPackages: [
    { id: 'p1', fileName: 'Mietfuchs_1.13.1.0.msixbundle', fileStatus: 'Uploaded' },
    { id: 'p0', fileName: 'alt.msix', fileStatus: 'Uploaded' },
    { fileName: 'halb.msixbundle', fileStatus: 'PendingUpload' },
  ],
  listings: {
    [LANGUAGE]: {
      baseListing: {
        title: 'Mietfuchs',
        copyrightAndTrademarkInfo: '© speedone',
        description: 'alt',
        releaseNotes: '',
        images: [
          { fileName: 'cockpit.png', fileStatus: 'Uploaded', imageType: 'Screenshot' },
          { fileName: 'halb.png', fileStatus: 'PendingUpload', imageType: 'Screenshot' },
          { fileName: 'logo.png', fileStatus: 'Uploaded', imageType: 'StoreLogo300x300' },
        ],
      },
      platformOverrides: {},
    },
  },
})
const input = {
  bundle: '/tmp/store/Mietfuchs_1.14.0.0.msixbundle',
  tag: 'v0.14.0',
  listing: { description: 'neu', features: ['F'], keywords: ['K'], websiteUrl: 'https://mietfuchs-app.de', privacyPolicy: 'https://example.org/datenschutz', supportContact: 'https://example.org/hilfe' },
  notes: 'N',
}

test('Einreichung: Website, Datenschutzrichtlinie und Supportkontakt aus dem Store-Eintrag', () => {
  const base = buildSubmission(published(), input).listings[LANGUAGE].baseListing
  assert.equal(base.websiteUrl, 'https://mietfuchs-app.de')
  assert.equal(base.privacyPolicy, 'https://example.org/datenschutz')
  assert.equal(base.supportContact, 'https://example.org/hilfe')
})

test('Einreichung: altes Bündel zum Löschen, neues hochladen, andere Pakete bleiben', () => {
  const next = buildSubmission(published(), input)
  assert.deepEqual(next.applicationPackages, [
    { id: 'p1', fileName: 'Mietfuchs_1.13.1.0.msixbundle', fileStatus: 'PendingDelete' },
    { id: 'p0', fileName: 'alt.msix', fileStatus: 'Uploaded' },
    { fileName: 'Mietfuchs_1.14.0.0.msixbundle', fileStatus: 'PendingUpload' },
  ])
})

// Flaches ZIP: Ob das Partner Center „/“ in Pfaden annimmt, ist nicht belegt (die Doku zeigt „\\“).
// Die neuen Bilder tragen den Tag im Namen und fallen so nicht mit den alten zusammen.
test('Einreichung: Bildschirmfotos ersetzt, Logo bleibt, neue Namen mit dem Tag', () => {
  const images = buildSubmission(published(), input).listings[LANGUAGE].baseListing.images
  assert.deepEqual(images.slice(0, 2), [
    { fileName: 'cockpit.png', fileStatus: 'PendingDelete', imageType: 'Screenshot' },
    { fileName: 'logo.png', fileStatus: 'Uploaded', imageType: 'StoreLogo300x300' },
  ])
  const added = images.slice(2)
  assert.equal(added.length, SCREENSHOTS.length)
  assert.ok(added.every((i: any) => i.fileStatus === 'PendingUpload' && i.imageType === 'Screenshot' && i.fileName.startsWith('v0.14.0-') && !i.fileName.includes('/')))
})

test('Einreichung: Texte, Neuigkeiten und sofort veröffentlichen; Unbekanntes bleibt, Vorlage unberührt', () => {
  const before = published()
  const next = buildSubmission(before, input)
  const base = next.listings[LANGUAGE].baseListing
  assert.equal(next.targetPublishMode, 'Immediate')
  assert.deepEqual([base.description, base.features, base.keywords, base.releaseNotes], ['neu', ['F'], ['K'], 'N'])
  assert.equal(base.copyrightAndTrademarkInfo, '© speedone', 'Felder, die das Skript nicht kennt, gehen nicht verloren')
  assert.deepEqual(next.pricing, { priceId: 'Free' })
  assert.deepEqual(before, published(), 'die Vorlage bleibt, wie sie war')
})

test('Einreichung: ohne deutschen Eintrag bricht sie ab', () => {
  const sub = published()
  sub.listings = {} as any
  assert.throws(() => buildSubmission(sub, input), /de-de/)
})

test('Store-Eintrag: Suchbegriffe zusammen höchstens 21 Wörter', () => {
  const words = (k: string[]) => k.join(' ').split(/\s+/).length
  assert.ok(words(parseListing(md).keywords) <= 21)
  const many = md.replace(/\*\*Suchbegriffe\*\*:[^\n]*\n[^\n]*/, '**Suchbegriffe**: ' + Array(7).fill('a b c d').join(', '))
  assert.throws(() => parseListing(many), /21 Wörter/)
})

test('Status nach dem Abschicken: nur die Schritte der Zertifizierung gelten als gut', () => {
  assert.equal(commitOutcome({ status: 'CommitStarted' }), 'wait')
  for (const status of ['PreProcessing', 'Certification', 'Release', 'Publishing', 'Published', 'PendingPublication']) {
    assert.equal(commitOutcome({ status }), 'ok', status)
  }
  for (const status of ['CommitFailed', 'PreProcessingFailed', 'CertificationFailed', 'Canceled', 'None', 'PendingCommit']) {
    assert.equal(commitOutcome({ status }), 'failed', status)
  }
  assert.equal(commitOutcome({ status: 'PreProcessing', statusDetails: { errors: [{ code: 'X' }] } }), 'failed')
})

// Beim Nachreichen von 0.14.0: Einen Entwurf, der im Partner Center von Hand begonnen wurde, darf die
// API nicht löschen. Die Meldung sagt dann, was zu tun ist, statt nur die Antwort der API zu zeigen.
test('Entwurf von Hand: Hinweis, ihn im Partner Center zu löschen', () => {
  const api = 'DELETE /applications/9PMHZ0ZJPZDZ/submissions/1: HTTP 400 {"code":"InvalidOperation","message":"Ingestion API can only update, delete, and commit submissions that are created through the API. Please delete the current in-progress submission and create one using the API"}'
  assert.match(draftHint(api) ?? '', /Löschen Sie ihn im Partner Center.*starten Sie store\.yml.*neu/s)
  assert.equal(draftHint('DELETE …: HTTP 409 {"code":"Conflict"}'), null)
})
