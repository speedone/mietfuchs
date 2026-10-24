// Integrationstests gegen den echten Server: Logo und Briefpapier (#415, Teil 2b). Ablage im Datenordner unter
// Namen, die der Server vergibt, Auslieferung nur aus der eigenen Liste, Aufräumen beim Ersetzen, Vorgabe der
// Installation und eigene Gestaltung je Objekt, Backup und Wiederherstellen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { LetterDesign, LetterDesigns, Property } from '../../shared/types.ts'
import { DEFAULT_LETTER_DESIGN } from '../../shared/letterDesign.ts'
import { type Server, archive, errorFrom, restore, startServer } from '../testing/api.ts'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const PNG2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9])
const PDF = Buffer.from('%PDF-1.4\n%Briefpapier\n')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')

type Change = 'keep' | 'remove' | 'new'
type Body = { own?: boolean, logo?: Change, paper?: Change, paperNextFile?: Change, paperNext?: string, margins?: unknown }
const fullBody = (b: Body) => ({ logo: 'keep', paper: 'keep', paperNextFile: 'keep', paperNext: 'same', margins: DEFAULT_LETTER_DESIGN.margins, ...b })

async function put(s: Server, url: string, body: Body, files: Partial<Record<'logo' | 'paper' | 'paperNextFile', [Buffer, string]>> = {}) {
  const fd = new FormData()
  fd.append('design', JSON.stringify(fullBody(body)))
  for (const [field, [data, name]] of Object.entries(files)) fd.append(field, new Blob([data]), name)
  return fetch(`${s.base}${url}`, { method: 'PUT', body: fd })
}
const designs = (s: Server, propertyId?: string) => s.api<LetterDesigns>(`/api/letter-design${propertyId ? `?property=${propertyId}` : ''}`)
const dir = (s: Server) => path.join(s.dataDir, 'briefpapier')
const filesOnDisk = (s: Server): string[] => (fs.existsSync(dir(s)) ? fs.readdirSync(dir(s)).sort() : [])
const fileOf = (d: LetterDesign, slot: 'logo' | 'paper'): string => d[slot]?.file ?? assert.fail(`kein ${slot}`)

test('Briefpapier: Logo und Briefpapier ablegen, ausliefern, ersetzen und entfernen', async () => {
  const s = await startServer()
  try {
    assert.deepEqual(await designs(s), { installation: DEFAULT_LETTER_DESIGN, property: null })
    const res = await put(s, '/api/letter-design', { logo: 'new', paper: 'new', paperNext: 'none', margins: { top: 45, right: 20, bottom: 30, left: 25 } }, { logo: [PNG, 'mein logo.png'], paper: [PDF, 'Briefbogen.pdf'] })
    assert.equal(res.status, 200, await res.clone().text())
    const d = (await designs(s)).installation
    assert.match(fileOf(d, 'logo'), /^logo-[0-9a-f]{16}\.png$/)
    assert.equal(d.paper?.type, 'pdf')
    assert.equal(d.paperNext, 'none')
    assert.deepEqual(d.margins, { top: 45, right: 20, bottom: 30, left: 25 })
    assert.deepEqual(filesOnDisk(s), [fileOf(d, 'logo'), fileOf(d, 'paper')].sort())

    // Ausgeliefert wird nur, was in der eigenen Liste steht, mit festem Typ und ohne Raten des Browsers.
    const logo = await fetch(`${s.base}/api/letter-design/files/${fileOf(d, 'logo')}`)
    assert.equal(logo.status, 200)
    assert.equal(logo.headers.get('content-type'), 'image/png')
    assert.equal(logo.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await logo.arrayBuffer()), PNG)
    fs.writeFileSync(path.join(dir(s), 'logo-ffffffffffffffff.png'), PNG) // liegt da, steht aber in keiner Liste
    for (const name of ['logo-ffffffffffffffff.png', '..%2Fmietfuchs.sqlite', 'mietfuchs.sqlite']) {
      assert.equal((await fetch(`${s.base}/api/letter-design/files/${name}`)).status, 404, name)
    }
    fs.rmSync(path.join(dir(s), 'logo-ffffffffffffffff.png'))

    // Ersetzen räumt die alte Datei weg, Entfernen ebenso.
    assert.equal((await put(s, '/api/letter-design', { logo: 'new', paperNext: 'none', margins: d.margins }, { logo: [JPG, 'logo.jpg'] })).status, 200)
    const d2 = (await designs(s)).installation
    assert.equal(d2.logo?.type, 'jpg')
    assert.equal(d2.paper?.file, d.paper?.file)
    assert.deepEqual(filesOnDisk(s), [fileOf(d2, 'logo'), fileOf(d2, 'paper')].sort())
    // Ausgeliefert mit einer Sperre für Skripte, falls jemand die Datei in einem eigenen Fenster öffnet.
    const jpg = await fetch(`${s.base}/api/letter-design/files/${fileOf(d2, 'logo')}`)
    assert.match(jpg.headers.get('content-security-policy') ?? '', /sandbox/)
    assert.equal((await put(s, '/api/letter-design', { logo: 'remove', paper: 'remove' })).status, 200)
    assert.deepEqual(await designs(s), { installation: DEFAULT_LETTER_DESIGN, property: null })
    assert.deepEqual(filesOnDisk(s), [])
  } finally {
    s.stop()
  }
})

test('Briefpapier: Falsches wird abgelehnt, und nichts ändert sich', async () => {
  const s = await startServer()
  try {
    assert.equal((await put(s, '/api/letter-design', { logo: 'new' }, { logo: [PNG, 'a.png'] })).status, 200)
    const before = await designs(s)
    const cases: [string, Promise<Response>, RegExp][] = [
      ['GIF', put(s, '/api/letter-design', { logo: 'new' }, { logo: [Buffer.from('GIF89a……'), 'a.gif'] }), /PNG oder JPG/],
      ['PDF als Logo', put(s, '/api/letter-design', { logo: 'new' }, { logo: [PDF, 'a.pdf'] }), /PNG oder JPG/],
      // Durchsicht S1: SVG nimmt der Server gar nicht an, auch ohne Skript; der Browser wandelt es vorher in PNG um.
      ['SVG', put(s, '/api/letter-design', { logo: 'new' }, { logo: [SVG, 'a.svg'] }), /PNG oder JPG/],
      ['SVG mit Skript', put(s, '/api/letter-design', { paper: 'new' }, { paper: [Buffer.from('<svg><script>x</script></svg>'), 'a.svg'] }), /PNG, JPG oder eine PDF/],
      ['Rand oben über 70 mm', put(s, '/api/letter-design', { margins: { top: 71, right: 20, bottom: 20, left: 25 } }), /Rand oben.*10 und 70 mm/],
      ['Logo zu groß', put(s, '/api/letter-design', { logo: 'new' }, { logo: [Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), 'a.png'] }), /2 MB/],
      ['neu ohne Datei', put(s, '/api/letter-design', { paper: 'new' }), /Briefpapier/],
      ['Ränder', put(s, '/api/letter-design', { margins: { top: 5, right: 20, bottom: 20, left: 25 } }), /Rand oben.*10 und 70 mm/],
      ['Folgeseiten', put(s, '/api/letter-design', { paperNext: 'alle' }), /Folgeseiten/],
      ['zweites ohne Datei', put(s, '/api/letter-design', { paperNext: 'other' }), /Folgeseiten/],
    ]
    for (const [name, res, message] of cases) {
      const r = await res
      assert.equal(r.status, 400, name)
      assert.match(await errorFrom(r), message, name)
    }
    assert.deepEqual(await designs(s), before)
    assert.equal(filesOnDisk(s).length, 1)
  } finally {
    s.stop()
  }
})

test('Briefpapier: eigene Gestaltung je Objekt, gemeinsame Dateien bleiben, bis niemand sie nennt', async () => {
  const s = await startServer()
  try {
    const [house] = await s.api<Property[]>('/api/properties')
    const id = house?.id ?? assert.fail('kein Objekt')
    assert.equal((await put(s, '/api/letter-design', { logo: 'new' }, { logo: [PNG, 'a.png'] })).status, 200)
    const logo = fileOf((await designs(s)).installation, 'logo')
    assert.equal((await designs(s, id)).property, null)
    // Eigene Gestaltung, die mit dem Logo der Installation beginnt, dazu ein eigenes Briefpapier.
    assert.equal((await put(s, `/api/properties/${id}/letter-design`, { own: true, paper: 'new', paperNext: 'other', paperNextFile: 'new' }, { paper: [PDF, 'p.pdf'], paperNextFile: [PNG2, 'f.png'] })).status, 200)
    const own = (await designs(s, id)).property ?? assert.fail('keine eigene Gestaltung')
    assert.equal(own.logo?.file, logo)
    assert.equal(own.paperNext, 'other')
    assert.equal(own.paperNextFile?.type, 'png')
    // Die Installation entfernt ihr Logo: Das Objekt nennt es noch, die Datei bleibt.
    assert.equal((await put(s, '/api/letter-design', { logo: 'remove' })).status, 200)
    assert.ok(filesOnDisk(s).includes(logo))
    assert.equal((await fetch(`${s.base}/api/letter-design/files/${logo}`)).status, 200)
    // Zurück zur Vorgabe: Die Dateien des Objekts nennt niemand mehr.
    assert.equal((await put(s, `/api/properties/${id}/letter-design`, { own: false })).status, 200)
    assert.equal((await designs(s, id)).property, null)
    assert.deepEqual(filesOnDisk(s), [])
    assert.equal((await put(s, '/api/properties/nicht-da/letter-design', { own: true })).status, 404)

    // Ein Objekt wird gelöscht: seine Dateien gehen mit.
    const second = await s.api<Property>('/api/properties', { method: 'POST', body: JSON.stringify({ name: 'Zweites Haus' }) })
    assert.equal((await put(s, `/api/properties/${second.id}/letter-design`, { own: true, logo: 'new' }, { logo: [PNG2, 'b.png'] })).status, 200)
    assert.equal(filesOnDisk(s).length, 1)
    assert.equal((await fetch(`${s.base}/api/properties/${second.id}`, { method: 'DELETE' })).status, 200)
    assert.deepEqual(filesOnDisk(s), [])
  } finally {
    s.stop()
  }
})

test('Briefpapier: kommt mit dem Backup und wieder zurück; ein fremder Eintrag wird abgelehnt', async () => {
  const s = await startServer()
  try {
    assert.equal((await put(s, '/api/letter-design', { logo: 'new', paper: 'new' }, { logo: [PNG, 'a.png'], paper: [PDF, 'p.pdf'] })).status, 200)
    const d = (await designs(s)).installation
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    const names = new AdmZip(backup).getEntries().map((e) => e.entryName)
    assert.ok(names.includes(`briefpapier/${fileOf(d, 'logo')}`), names.join(', '))
    assert.ok(names.includes(`briefpapier/${fileOf(d, 'paper')}`))

    assert.equal((await put(s, '/api/letter-design', { logo: 'remove', paper: 'remove' })).status, 200)
    assert.deepEqual(filesOnDisk(s), [])
    const r = await restore(s, backup)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual((await designs(s)).installation, d)
    assert.deepEqual(filesOnDisk(s), [fileOf(d, 'logo'), fileOf(d, 'paper')].sort())
    assert.deepEqual(Buffer.from(await (await fetch(`${s.base}/api/letter-design/files/${fileOf(d, 'logo')}`)).arrayBuffer()), PNG)

    // Nur Namen der eigenen Gestalt, direkt im Ordner, und nicht größer als ein Briefpapier sein darf.
    for (const entry of ['briefpapier/boese.exe', 'briefpapier/unter/logo-0123456789abcdef.png', 'briefpapier/Logo-0123456789abcdef.png', 'briefpapier/logo-0123456789abcdef.svg']) {
      const bad = await restore(s, archive({ [entry]: PNG }))
      assert.equal(bad.status, 400, entry)
      assert.match(bad.body.error ?? '', /ungültigen Eintrag/, entry)
    }
    const big = await restore(s, archive({ 'briefpapier/paper-0123456789abcdef.pdf': Buffer.alloc(10 * 1024 * 1024 + 1) }))
    assert.equal(big.status, 400)
    assert.match(big.body.error ?? '', /Briefpapier.*10 MB/)
    assert.deepEqual((await designs(s)).installation, d)
  } finally {
    s.stop()
  }
})

test('Integrationsdurchsicht 0.13.0: Backup und Wiederherstellen tragen nur Dateien, auf die eine Gestaltung verweist', async () => {
  const s = await startServer()
  try {
    assert.equal((await put(s, '/api/letter-design', { logo: 'new' }, { logo: [PNG, 'a.png'] })).status, 200)
    const logo = fileOf((await designs(s)).installation, 'logo')
    // Eine liegengebliebene Datei, etwa nach einem abgebrochenen Ersetzen.
    const orphan = 'paper-0123456789abcdef.pdf'
    fs.writeFileSync(path.join(dir(s), orphan), PDF)
    const backup = Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())
    const names = new AdmZip(backup).getEntries().map((e) => e.entryName)
    assert.ok(names.includes(`briefpapier/${logo}`), names.join(', '))
    assert.ok(!names.includes(`briefpapier/${orphan}`), names.join(', '))
    // Ein Archiv mit einer Datei ohne Verweis (etwa aus einer früheren Version): Eingespielt bleibt sie liegen, denn die
    // Sicherung vor dem Einspielen kann noch auf Dateien verweisen (Durchsicht zu PR #436, S3); ins nächste Backup kommt sie
    // nicht.
    const zip = new AdmZip(backup)
    zip.addFile('briefpapier/logo-0123456789abcdef.jpg', JPG)
    const r = await restore(s, zip.toBuffer())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.ok(filesOnDisk(s).includes(orphan))
    const next = new AdmZip(Buffer.from(await (await fetch(`${s.base}/api/backup`)).arrayBuffer())).getEntries().map((e) => e.entryName).filter((n) => n.startsWith('briefpapier/'))
    assert.deepEqual(next, [`briefpapier/${logo}`])
  } finally {
    s.stop()
  }
})

test('Briefpapier: beim Wiederherstellen zählt der Inhalt wie beim Hochladen (Durchsicht K1)', async () => {
  const s = await startServer()
  try {
    for (const [entry, content] of [['briefpapier/logo-0123456789abcdef.png', Buffer.from('<svg onload=alert(1)>')], ['briefpapier/logo-0123456789abcdef.png', PDF], ['briefpapier/paper-0123456789abcdef.pdf', PNG]] as const) {
      const bad = await restore(s, archive({ [entry]: content }))
      assert.equal(bad.status, 400, entry)
      assert.match(bad.body.error ?? '', /logo-0123456789abcdef\.png|paper-0123456789abcdef\.pdf/, entry)
    }
    assert.deepEqual(filesOnDisk(s), [])
  } finally {
    s.stop()
  }
})

test('Briefpapier: eine fehlende Datei meldet die Liste, statt sie zu nennen (Durchsicht M2)', async () => {
  const s = await startServer()
  try {
    assert.equal((await put(s, '/api/letter-design', { logo: 'new', paper: 'new' }, { logo: [PNG, 'a.png'], paper: [PDF, 'p.pdf'] })).status, 200)
    const d = (await designs(s)).installation
    // Etwa nach dem Einspielen einer Vorversion, aus einem Archiv ohne Datei oder von Hand gelöscht.
    fs.rmSync(path.join(dir(s), fileOf(d, 'paper')))
    const now = await designs(s)
    assert.equal(now.installation.paper, null)
    assert.equal(now.installation.logo?.file, fileOf(d, 'logo'))
    assert.deepEqual(now.missing, ['Briefpapier'])
    // Die Route der Datei antwortet 404 statt mit einem Serverfehler.
    assert.equal((await fetch(`${s.base}/api/letter-design/files/${fileOf(d, 'paper')}`)).status, 404)
  } finally {
    s.stop()
  }
})
