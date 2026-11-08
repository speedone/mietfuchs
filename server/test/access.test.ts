// Zugang (#528, Schritt 1): Lauscht Mietfuchs nicht nur auf diesem Rechner, schützt ein Passwort den Bestand. Hier der
// Kern ohne Server: Zustand aus Lausch-Adresse, NKA_AUTH, zugang.json und Bestand; Hash, Einmal-Code, Sitzungen und
// die Bremse nach Fehlversuchen. Die Routen prüft api-anmeldung.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ACCESS_FILE, CODE_ALPHABET, CODE_FILE, addressKey, authSetting, createBrake, createHashQueue, createSessions, formatCode,
  hashPassword, initialAccess, needsRehash, sameKey, newInstance, newSetupCode, normalizeCode, passwordProblem, readAccessFile, reachableOf,
  removeCodeFile, sameCode, verifyPassword, writeAccessFile, writeCodeFile, gate, viaProxy, viaHttps, cookieValues, sessionCookie,
  clearedCookie, isLoopback, type AccessFile, type AccessState, type GateDecision, type GateRequest,
} from '../src/access.ts'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-zugang-'))

// Ein schneller Hash für die Tests, die nur den Rundweg brauchen; die echten Parameter prüft ein eigener Test
const FAST = { logN: 10 }

test('Zugang: Lausch-Adresse entscheidet, ob Mietfuchs von außen erreichbar ist', () => {
  for (const host of [undefined, '', '0.0.0.0', '::', '192.168.1.5', 'fe80::1', '10.0.0.2']) assert.equal(reachableOf(host), 'network', String(host))
  for (const host of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', ' 127.0.0.1 ']) assert.equal(reachableOf(host), 'local', host)
})

test('Zugang: NKA_AUTH kennt auto, on und off, alles andere ist ein Satz', () => {
  assert.equal(authSetting({}), 'auto')
  assert.equal(authSetting({ NKA_AUTH: '' }), 'auto')
  assert.equal(authSetting({ NKA_AUTH: ' auto ' }), 'auto')
  assert.equal(authSetting({ NKA_AUTH: 'on' }), 'on')
  assert.equal(authSetting({ NKA_AUTH: 'OFF' }), 'off')
  const problem = authSetting({ NKA_AUTH: 'ja' })
  assert.equal(typeof problem, 'object')
  assert.match((problem as { problem: string }).problem, /NKA_AUTH „ja“/)
  assert.match((problem as { problem: string }).problem, /auto, on oder off/)
})

const passwordFile: AccessFile = { version: 1, mode: 'password', instance: 'abc123', hash: 'scrypt$10$8$1$AA$AA', changedAt: '2026-11-07T10:00:00.000Z' }
const offFile: AccessFile = { version: 1, mode: 'off', instance: 'abc123', changedAt: '2026-11-07T10:00:00.000Z' }

test('Zugang: Anfangszustand als Tabelle (Stufe A und B)', () => {
  const cases: [string, Parameters<typeof initialAccess>[0], { mode: string, required: boolean, writes: boolean }][] = [
    ['lokal, nichts eingestellt', { reachable: 'local', setting: 'auto', file: null, hasStock: false, stage: 'A' }, { mode: 'none', required: false, writes: false }],
    ['lokal mit Bestand', { reachable: 'local', setting: 'auto', file: null, hasStock: true, stage: 'B' }, { mode: 'none', required: false, writes: false }],
    ['im Netz, neuer Ordner', { reachable: 'network', setting: 'auto', file: null, hasStock: false, stage: 'A' }, { mode: 'setup', required: true, writes: true }],
    ['im Netz, Bestand, Stufe A', { reachable: 'network', setting: 'auto', file: null, hasStock: true, stage: 'A' }, { mode: 'transition', required: false, writes: false }],
    ['im Netz, Bestand, Stufe B', { reachable: 'network', setting: 'auto', file: null, hasStock: true, stage: 'B' }, { mode: 'setup', required: true, writes: true }],
    ['Datei off, Stufe A', { reachable: 'network', setting: 'auto', file: offFile, hasStock: true, stage: 'A' }, { mode: 'off', required: false, writes: false }],
    ['Datei off, Stufe B', { reachable: 'network', setting: 'auto', file: offFile, hasStock: true, stage: 'B' }, { mode: 'off', required: false, writes: false }],
    ['Datei password im Netz', { reachable: 'network', setting: 'auto', file: passwordFile, hasStock: true, stage: 'A' }, { mode: 'password', required: true, writes: false }],
    ['Datei password lokal', { reachable: 'local', setting: 'auto', file: passwordFile, hasStock: true, stage: 'A' }, { mode: 'password', required: false, writes: false }],
    ['NKA_AUTH=off schlägt alles', { reachable: 'network', setting: 'off', file: passwordFile, hasStock: false, stage: 'B' }, { mode: 'password', required: false, writes: false }],
    ['NKA_AUTH=off ohne Datei', { reachable: 'network', setting: 'off', file: null, hasStock: false, stage: 'B' }, { mode: 'none', required: false, writes: false }],
    ['NKA_AUTH=on lokal mit password', { reachable: 'local', setting: 'on', file: passwordFile, hasStock: true, stage: 'A' }, { mode: 'password', required: true, writes: false }],
    ['NKA_AUTH=on lokal, neuer Ordner', { reachable: 'local', setting: 'on', file: null, hasStock: false, stage: 'A' }, { mode: 'setup', required: true, writes: true }],
    ['NKA_AUTH=on mit Bestand, Stufe A: kein Übergang', { reachable: 'local', setting: 'on', file: null, hasStock: true, stage: 'A' }, { mode: 'setup', required: true, writes: true }],
    ['NKA_AUTH=on im Netz mit Bestand, Stufe A', { reachable: 'network', setting: 'on', file: null, hasStock: true, stage: 'A' }, { mode: 'setup', required: true, writes: true }],
    ['verdorbene Datei gilt als setup', { reachable: 'network', setting: 'auto', file: 'corrupt', hasStock: true, stage: 'A' }, { mode: 'setup', required: true, writes: false }],
  ]
  for (const [name, input, expected] of cases) {
    const { state, write } = initialAccess(input)
    assert.equal(state.mode, expected.mode, name)
    assert.equal(state.required, expected.required, name)
    assert.equal(write !== null, expected.writes, name)
    if (write) {
      assert.equal(write.mode, 'setup', name)
      assert.match(write.instance, /^[0-9a-f]{6}$/, name)
      assert.equal(write.hash, undefined, name)
    }
  }
})

test('Zugang: die Kennung der Installation bleibt, eine neue ist zufällig', () => {
  const { state } = initialAccess({ reachable: 'network', setting: 'auto', file: passwordFile, hasStock: true, stage: 'A' })
  assert.equal(state.instance, 'abc123')
  assert.match(newInstance(), /^[0-9a-f]{6}$/)
  assert.notEqual(newInstance(), newInstance())
})

test('Zugang: Hash mit den Parametern aus OWASP, Rundweg und falsches Passwort', async () => {
  const stored = await hashPassword('ein langes Testpasswort')
  assert.match(stored, /^scrypt\$17\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  const [, , , , salt, key] = stored.split('$')
  assert.equal(Buffer.from(salt, 'base64').length, 16)
  assert.equal(Buffer.from(key, 'base64').length, 32)
  assert.equal(await verifyPassword('ein langes Testpasswort', stored), true)
  assert.equal(await verifyPassword('ein langes Testpasswort!', stored), false)
})

test('Zugang: zwei Hashes desselben Passworts unterscheiden sich, verdorbene Werte sind false ohne Wurf', async () => {
  const a = await hashPassword('ein langes Testpasswort', FAST)
  const b = await hashPassword('ein langes Testpasswort', FAST)
  assert.notEqual(a, b)
  assert.match(a, /^scrypt\$10\$8\$1\$/)
  assert.equal(await verifyPassword('ein langes Testpasswort', a), true)
  for (const broken of ['', 'scrypt', 'scrypt$17$8$1$$', 'bcrypt$10$8$1$AA$AA', 'scrypt$99$8$1$AAAA$AAAA', 'scrypt$x$8$1$AAAA$AAAA', 'scrypt$10$8$1$AAAA$AAAA$', 'scrypt$10$8$1$AAAA$']) {
    assert.equal(await verifyPassword('ein langes Testpasswort', broken), false, broken)
  }
})

test('Zugang: Unicode zählt als NFC, zusammengesetzt und zerlegt gleich', async () => {
  const composed = 'Mühle am Bach und Fluss'.normalize('NFC')
  const decomposed = composed.normalize('NFD')
  assert.notEqual(composed, decomposed)
  const stored = await hashPassword(composed, FAST)
  assert.equal(await verifyPassword(decomposed, stored), true)
})

test('Zugang: Regeln für das Passwort', () => {
  assert.match(passwordProblem('a'.repeat(3) + 'bcdefghijk1') ?? '', /mindestens 15 Zeichen/) // 14
  assert.equal(passwordProblem('abcdefghijklmno'), null) // 15
  assert.equal(passwordProblem('Sonne Wolke Regen'), null)
  assert.equal(passwordProblem('x'.repeat(128).replace(/^x/, 'y')), null)
  assert.match(passwordProblem('ab'.repeat(64) + 'c') ?? '', /höchstens 128 Zeichen/) // 129
  assert.match(passwordProblem('aaaaaaaaaaaaaaa') ?? '', /nur aus einem Zeichen/)
  assert.match(passwordProblem('MeinMietfuchs2026!!') ?? '', /„Mietfuchs“/)
  assert.match(passwordProblem('') ?? '', /mindestens 15 Zeichen/)
  // 15 Zeichen nach NFC, nicht nach Einheiten von UTF-16: ein Emoji zählt als eins
  assert.match(passwordProblem('🦊'.repeat(7)) ?? '', /mindestens 15 Zeichen/)
  assert.equal(passwordProblem('🦊🦊🦊 Fuchsbau am Wald'), null)
  // In NFD hätte „ü“ zwei Zeichen; gezählt wird nach NFC
  assert.match(passwordProblem('Mühleabcdefghi'.normalize('NFD')) ?? '', /mindestens 15 Zeichen/)
  assert.equal(passwordProblem(42 as unknown as string) !== null, true)
})

test('Zugang: Einmal-Code aus 12 Zeichen ohne Verwechslung, Eingabe ohne Rücksicht auf Schreibweise', () => {
  assert.equal(CODE_ALPHABET.length >= 31, true)
  for (const c of '0O1IL') assert.equal(CODE_ALPHABET.includes(c), false, c)
  const seen = new Set<string>()
  for (let i = 0; i < 50; i++) {
    const code = newSetupCode()
    assert.match(code, new RegExp(`^[${CODE_ALPHABET}]{12}$`))
    seen.add(code)
  }
  assert.equal(seen.size, 50)
  assert.equal(formatCode('K7QM4XPA9TRW'), 'K7QM-4XPA-9TRW')
  assert.equal(normalizeCode('k7qm 4xpa-9trw'), 'K7QM4XPA9TRW')
  assert.equal(normalizeCode(' K7QM–4XPA 9TRW '), 'K7QM4XPA9TRW')
  assert.equal(normalizeCode(42), '')
  assert.equal(sameCode('k7qm-4xpa-9trw', 'K7QM4XPA9TRW'), true)
  assert.equal(sameCode('K7QM4XPA9TRX', 'K7QM4XPA9TRW'), false)
  assert.equal(sameCode('', 'K7QM4XPA9TRW'), false)
  assert.equal(sameCode('K7QM4XPA9TRW', null), false)
})

test('Zugang: Fensterschlüssel zeitkonstant, leer zählt nie', () => {
  assert.equal(sameKey('abc', 'abc'), true)
  assert.equal(sameKey('abd', 'abc'), false)
  assert.equal(sameKey('', ''), false)
  assert.equal(sameKey('abc', null), false)
  assert.equal(sameKey(['abc'], 'abc'), false)
})

test('Zugang: Datei über Zwischendatei, nur für den eigenen Benutzer', () => {
  const dir = freshDir()
  try {
    assert.deepEqual(readAccessFile(dir), { file: null, problem: null })
    const file: AccessFile = { version: 1, mode: 'setup', instance: 'abcdef', changedAt: '2026-11-07T10:00:00.000Z' }
    writeAccessFile(dir, file)
    assert.deepEqual(readAccessFile(dir), { file, problem: null })
    assert.deepEqual(fs.readdirSync(dir), [ACCESS_FILE])
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, ACCESS_FILE)).mode & 0o777, 0o600)
    writeCodeFile(dir, 'K7QM4XPA9TRW')
    assert.equal(fs.readFileSync(path.join(dir, CODE_FILE), 'utf8').trim(), 'K7QM-4XPA-9TRW')
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, CODE_FILE)).mode & 0o777, 0o600)
    removeCodeFile(dir)
    assert.equal(fs.existsSync(path.join(dir, CODE_FILE)), false)
    removeCodeFile(dir) // schon weg ist kein Fehler
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Zugang: verdorbene oder fremde Datei gilt als Einrichtung, mit Satz', () => {
  const dir = freshDir()
  try {
    for (const content of ['{kaputt', 'null', '[]', '{"version":2,"mode":"password"}', '{"version":1,"mode":"offen","instance":"abcdef"}', '{"version":1,"mode":"password","instance":"abcdef"}', '{"version":1,"mode":"off","instance":"../x"}']) {
      fs.writeFileSync(path.join(dir, ACCESS_FILE), content)
      const read = readAccessFile(dir)
      assert.equal(read.file, 'corrupt', content)
      assert.match(read.problem ?? '', /zugang\.json/, content)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Zugang: Sitzungen mit Leerlauf und Höchstdauer', () => {
  let now = 0
  const sessions = createSessions({ now: () => now })
  const a = sessions.create()
  const b = sessions.create()
  assert.notEqual(a, b)
  assert.match(a, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(sessions.check(a), true)
  assert.equal(sessions.check('falsch'), false)
  assert.equal(sessions.check(''), false)
  // Leerlauf: 29 Minuten genutzt bleibt, 30 Minuten ohne Anfrage endet
  now += 29 * 60_000
  assert.equal(sessions.check(a), true)
  now += 30 * 60_000
  assert.equal(sessions.check(a), false)
  assert.equal(sessions.check(b), false)
  // Höchstdauer: trotz Nutzung nach 8 Stunden zu Ende
  const c = sessions.create()
  for (let i = 0; i < 8 * 3; i++) {
    now += 20 * 60_000
    assert.equal(sessions.check(c), i < 8 * 3 - 1, `nach ${(i + 1) * 20} Minuten`)
  }
})

test('Zugang: höchstens 50 Sitzungen, abmelden einzeln, alle und alle außer der eigenen', () => {
  const sessions = createSessions({ now: () => 0 })
  const first = sessions.create()
  const others = Array.from({ length: 49 }, () => sessions.create())
  assert.equal(sessions.check(first), true)
  sessions.create() // die 51.
  assert.equal(sessions.check(first), false)
  assert.equal(sessions.check(others[0]), true)
  sessions.revoke(others[0])
  assert.equal(sessions.check(others[0]), false)
  const own = others[1]
  sessions.revokeAllExcept(own)
  assert.equal(sessions.check(own), true)
  assert.equal(sessions.check(others[2]), false)
  sessions.revokeAll()
  assert.equal(sessions.check(own), false)
})

test('Zugang: die Adresse der Bremse, IPv4 in IPv6 und IPv6 je /64', () => {
  assert.equal(addressKey('::ffff:192.168.1.5'), '192.168.1.5')
  assert.equal(addressKey('192.168.1.5'), '192.168.1.5')
  // je volle Adresse: Im Heimnetz teilen sich alle Geräte ein /64
  assert.notEqual(addressKey('2001:db8:1:2:aaaa::1'), addressKey('2001:db8:1:2:bbbb::2'))
  assert.equal(addressKey('2001:db8::1'), addressKey('2001:0db8:0000:0000:0000:0000:0000:0001'))
  assert.equal(addressKey('fe80::1%eth0'), addressKey('fe80::1'))
  assert.equal(addressKey(undefined), 'unbekannt')
})

test('Zugang: Bremse bucht vor dem Ergebnis und nimmt bei Erfolg zurück', () => {
  let now = 0
  const brake = createBrake({ now: () => now })
  const ticket = brake.begin('1.1.1.1', 'password')
  assert.equal(ticket.ok, true)
  assert.equal(brake.failures('1.1.1.1', 'password'), 1)
  // ein zweiter Versuch derselben Adresse, solange der erste rechnet
  const second = brake.begin('1.1.1.1', 'password')
  assert.equal(second.ok, false)
  if (ticket.ok) brake.finish(ticket, true)
  assert.equal(brake.failures('1.1.1.1', 'password'), 0)
  now += 1
  const third = brake.begin('1.1.1.1', 'password')
  assert.equal(third.ok, true)
})

test('Zugang: Bremse, ein anderes Gerät im selben /64 wird nicht mitgebremst', () => {
  const brake = createBrake({ now: () => 0 })
  for (let i = 0; i < 6; i++) {
    const t = brake.begin('2001:db8:1:2:aaaa:bbbb:cccc:1', 'password')
    if (t.ok) brake.finish(t, false)
  }
  assert.equal(brake.begin('2001:db8:1:2:aaaa:bbbb:cccc:1', 'password').ok, false)
  assert.equal(brake.begin('2001:db8:1:2:1111:2222:3333:4', 'password').ok, true)
})

test('Zugang: Hash mit älteren Parametern wird bei der nächsten Anmeldung neu gerechnet', () => {
  assert.equal(needsRehash('scrypt$17$8$1$AA$AA'), false)
  assert.equal(needsRehash('scrypt$16$8$1$AA$AA'), true)
  assert.equal(needsRehash(null), false)
})

test('Zugang: Bremse hat höchstens zwei Plätze für Berechnungen', () => {
  const brake = createBrake({ now: () => 0 })
  const a = brake.begin('1.1.1.1', 'password')
  const b = brake.begin('2.2.2.2', 'password')
  const c = brake.begin('3.3.3.3', 'code')
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(c.ok, false)
  if (!c.ok) assert.equal(c.retryAfter, 1)
  if (a.ok) brake.finish(a, false)
  assert.equal(brake.begin('3.3.3.3', 'code').ok, true)
})

test('Zugang: Bremse je Adresse, vier Fehlversuche frei, dann 1 s verdoppelt bis 60 Sekunden', () => {
  let now = 0
  const brake = createBrake({ now: () => now })
  const fail = () => {
    const t = brake.begin('1.1.1.1', 'password')
    assert.equal(t.ok, true, `Versuch nach ${brake.failures('1.1.1.1', 'password')} Fehlversuchen`)
    if (t.ok) brake.finish(t, false)
  }
  for (let i = 0; i < 4; i++) fail()
  const blocked = brake.begin('1.1.1.1', 'password')
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.equal(blocked.retryAfter, 1)
  // eine andere Adresse merkt davon nichts
  const other = brake.begin('2.2.2.2', 'password')
  assert.equal(other.ok, true)
  if (other.ok) brake.finish(other, true)
  const waits: number[] = []
  for (let i = 0; i < 14; i++) {
    const t = brake.begin('1.1.1.1', 'password')
    assert.equal(t.ok, false)
    if (!t.ok) {
      waits.push(t.retryAfter)
      now += t.retryAfter * 1000
    }
    fail()
  }
  assert.deepEqual(waits, [1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60, 60, 60, 60])
  // nie gesperrt: nach der Wartezeit geht es wieder, ein Erfolg setzt den Zähler zurück
  now += 60_000
  const t = brake.begin('1.1.1.1', 'password')
  assert.equal(t.ok, true)
  if (t.ok) brake.finish(t, true)
  assert.equal(brake.failures('1.1.1.1', 'password'), 0)
})

test('Zugang: Bremse für das Konto nur +1 s, Code und Passwort zählen getrennt, reset leert alles', () => {
  let now = 0
  const brake = createBrake({ now: () => now })
  for (let i = 0; i < 25; i++) {
    const t = brake.begin(`10.0.0.${i}`, 'password')
    assert.equal(t.ok, true)
    if (t.ok) {
      assert.equal(t.delayMs, i >= 20 ? 1000 : 0, `Versuch ${i + 1}`)
      brake.finish(t, false)
    }
  }
  assert.equal(brake.recentFailures(), 25)
  // der Code hat eigene Zähler, auch für das Konto
  const code = brake.begin('10.0.0.1', 'code')
  assert.equal(code.ok, true)
  if (code.ok) {
    assert.equal(code.delayMs, 0)
    brake.finish(code, false)
  }
  // 15 Minuten später zählt das Konto die alten nicht mehr
  now += 15 * 60_000 + 1
  const later = brake.begin('10.0.0.99', 'password')
  assert.equal(later.ok, true)
  if (later.ok) {
    assert.equal(later.delayMs, 0)
    brake.finish(later, false)
  }
  for (let i = 0; i < 5; i++) {
    const t = brake.begin('10.0.0.200', 'password')
    if (t.ok) brake.finish(t, false)
  }
  assert.equal(brake.begin('10.0.0.200', 'password').ok, false)
  brake.reset()
  assert.equal(brake.begin('10.0.0.200', 'password').ok, true)
  assert.equal(brake.recentFailures(), 1)
})

test('Zugang: die Tabelle der Bremse bleibt begrenzt', () => {
  const brake = createBrake({ now: () => 0, maxAddresses: 100 })
  for (let i = 0; i < 1000; i++) {
    const t = brake.begin(`10.${i >> 8}.${i & 255}.1`, 'password')
    if (t.ok) brake.finish(t, false)
  }
  assert.equal(brake.size() <= 100, true)
})

test('Zugang: Hash-Schlange rechnet eine Berechnung nach der anderen', async () => {
  const queue = createHashQueue()
  let running = 0
  let most = 0
  const job = () => queue.run(async () => {
    running++
    most = Math.max(most, running)
    await new Promise((resolve) => setTimeout(resolve, 10))
    running--
    return running
  })
  await Promise.all([job(), job(), job(), job()])
  assert.equal(most, 1)
})

// ---------- Vorschaltung ----------

const stateOf = (over: Partial<AccessState> = {}): AccessState => ({ reachable: 'network', setting: 'auto', mode: 'password', required: true, instance: 'abcdef', hash: 'x', ...over })
const request = (over: Partial<GateRequest> = {}): GateRequest => ({ method: 'GET', path: '/api/units', loopback: false, viaProxy: false, signedIn: false, host: '192.168.1.5:3001', allowedHosts: [], ...over })
const passes = (d: GateDecision): boolean => d.pass

test('Vorschaltung: geschützt ist /api, /uploads und /healthz in jeder Schreibweise', () => {
  const state = stateOf()
  for (const p of ['/api/units', '/API/units', '/api/Units', '/API/backup', '/api/backup/', '/uploads/x.pdf', '/UPLOADS/x.pdf', '/Uploads/x.pdf',
    '/api/update', '/api/auth/../units', '/api/%61uth/x', '//api/units', '/api//units', '/%61pi/units', '/api', '/API/', '/uploads', '/api/auth/login/x', '/api/authx', '/api/quit',
    '/api/%61uth/login', '/api/auth%2Flogin', '/%2561pi/backup', '/%252561pi/backup']) {
    const d = gate(state, request({ path: p }))
    assert.equal(d.pass, false, p)
    if (!d.pass) {
      assert.equal(d.status, 401, p)
      assert.equal(d.body.login, true, p)
      assert.equal(d.body.error, 'Bitte melden Sie sich an.', p)
    }
  }
  assert.equal(passes(gate(state, request({ method: 'HEAD', path: '/api/backup' }))), false)
})

test('Vorschaltung: frei sind die Oberfläche und die Routen der Anmeldung', () => {
  const state = stateOf()
  for (const [method, p] of [['GET', '/'], ['GET', '/assets/index-abc.js'], ['HEAD', '/manifest.webmanifest'], ['GET', '/einstellungen'], ['GET', '/apiary'],
    ['GET', '/api/auth'], ['GET', '/API/Auth/'], ['HEAD', '/api/auth'], ['POST', '/api/auth/login'], ['POST', '/api/auth/setup'], ['POST', '/API/AUTH/LOGOUT/'], ['GET', '/healthz'], ['GET', '/HEALTHZ'], ['GET', '/healthz/']]) {
    assert.equal(passes(gate(state, request({ method, path: p }))), true, `${method} ${p}`)
  }
  // nur lesend: ein POST auf die Oberfläche braucht eine Sitzung
  assert.equal(passes(gate(state, request({ method: 'POST', path: '/' }))), false)
  assert.equal(passes(gate(state, request({ method: 'GET', path: '/api/auth/login' }))), false)
  assert.equal(passes(gate(state, request({ method: 'PUT', path: '/api/auth/password' }))), false)
  assert.equal(passes(gate(state, request({ method: 'POST', path: '/healthz' }))), false)
})

test('Vorschaltung: /healthz gekürzt ohne Sitzung von außen, voll vom Rechner selbst und mit Sitzung', () => {
  const state = stateOf()
  const outside = gate(state, request({ path: '/HEALTHZ' }))
  assert.equal(outside.pass && outside.shortHealth, true)
  const here = gate(state, request({ path: '/healthz', loopback: true }))
  assert.equal(here.pass && here.shortHealth, false)
  // ein Proxy auf demselben Rechner bekommt den vollen Bericht (hingenommen, keine Mieterdaten)
  const proxied = gate(state, request({ path: '/healthz', loopback: true, viaProxy: true }))
  assert.equal(proxied.pass && proxied.shortHealth, false)
  const signedIn = gate(state, request({ path: '/healthz/', signedIn: true }))
  assert.equal(signedIn.pass && signedIn.shortHealth, false)
  // ohne Anmeldung wie bisher voll
  const open = gate(stateOf({ mode: 'transition', required: false }), request({ path: '/healthz' }))
  assert.equal(open.pass && open.shortHealth, false)
})

test('Vorschaltung: Beenden vom Rechner selbst ohne Sitzung, über einen Proxy oder von außen nicht', () => {
  const state = stateOf()
  assert.equal(passes(gate(state, request({ method: 'POST', path: '/api/quit', loopback: true }))), true)
  assert.equal(passes(gate(state, request({ method: 'POST', path: '/API/QUIT/', loopback: true }))), true)
  assert.equal(passes(gate(state, request({ method: 'POST', path: '/api/quit', loopback: true, viaProxy: true }))), false)
  assert.equal(passes(gate(state, request({ method: 'POST', path: '/api/quit' }))), false)
  // sonst gilt vom Rechner selbst dasselbe wie von außen
  assert.equal(passes(gate(state, request({ path: '/api/units', loopback: true }))), false)
})

test('Vorschaltung: Einrichtung offen meldet setup, mit Sitzung geht alles, Cache-Control nur wo geschützt', () => {
  const setup = gate(stateOf({ mode: 'setup', hash: null }), request())
  assert.equal(setup.pass, false)
  if (!setup.pass) {
    assert.equal(setup.body.setup, true)
    assert.equal(setup.body.login, undefined)
  }
  const ok = gate(stateOf(), request({ signedIn: true }))
  assert.equal(ok.pass && ok.noStore, true)
  const ui = gate(stateOf(), request({ path: '/' }))
  assert.equal(ui.pass && ui.noStore, false)
})

test('Vorschaltung: nicht nötig lokal, bei NKA_AUTH=off, im Übergang und bei off', () => {
  for (const state of [
    stateOf({ reachable: 'local', required: false }),
    stateOf({ setting: 'off', required: false }),
    stateOf({ mode: 'transition', required: false }),
    stateOf({ mode: 'off', required: false }),
    stateOf({ reachable: 'local', mode: 'none', required: false }),
  ]) {
    const d = gate(state, request({ method: 'POST', path: '/API/backup' }))
    assert.equal(d.pass && !d.noStore, true, JSON.stringify(state))
  }
})

test('Vorschaltung: Proxy-Kopfzeilen machen einen lokalen Server mit Passwort streng, ohne Passwort nicht', () => {
  const local = stateOf({ reachable: 'local', required: false })
  assert.equal(passes(gate(local, request({ loopback: true }))), true)
  assert.equal(passes(gate(local, request({ loopback: true, viaProxy: true }))), false)
  assert.equal(passes(gate(stateOf({ reachable: 'local', mode: 'none', required: false }), request({ loopback: true, viaProxy: true }))), true)
  // eine Einrichtung von früher (im Netz) sperrt lokal keinen Proxy aus: lokal gibt es keinen Code
  assert.equal(passes(gate(stateOf({ reachable: 'local', mode: 'setup', required: false, hash: null }), request({ loopback: true, viaProxy: true }))), true)
  // nach dem Zurücksetzen eines Passworts (mit Code) bleibt der Proxy streng
  assert.equal(passes(gate(stateOf({ reachable: 'local', mode: 'setup', required: false, hash: null, proxyStrict: true }), request({ loopback: true, viaProxy: true }))), false)
  assert.equal(passes(gate(stateOf({ reachable: 'local', mode: 'setup', required: false, hash: null, proxyStrict: true }), request({ loopback: true }))), true)
  assert.equal(passes(gate(stateOf({ reachable: 'local', setting: 'off', required: false }), request({ loopback: true, viaProxy: true }))), true)
})

test('Vorschaltung: Origin bei Schreibzugriffen, auch für die Anmeldung selbst', () => {
  const state = stateOf()
  const write = (over: Partial<GateRequest>) => gate(state, request({ method: 'POST', path: '/api/units', signedIn: true, ...over }))
  const status = (d: GateDecision) => (d.pass ? 200 : d.status)
  assert.equal(status(write({ origin: 'http://evil.example' })), 403)
  assert.equal(status(write({ secFetchSite: 'same-site', origin: 'http://192.168.1.5:3001' })), 403)
  assert.equal(status(write({ secFetchSite: 'cross-site' })), 403)
  assert.equal(status(write({ secFetchSite: 'same-origin', host: 'mietfuchs:3001', origin: 'https://mietfuchs.example.org' })), 200)
  assert.equal(status(write({ secFetchSite: 'none' })), 200)
  assert.equal(status(write({ origin: 'http://192.168.1.5:3001' })), 200)
  assert.equal(status(write({ origin: 'HTTP://192.168.1.5:3001' })), 200)
  assert.equal(status(write({ host: 'mietfuchs:3001', forwardedHost: 'mietfuchs.example.org, other', origin: 'https://mietfuchs.example.org' })), 200)
  assert.equal(status(write({ host: 'mietfuchs:3001', forwardedHost: 'other, mietfuchs.example.org', origin: 'https://mietfuchs.example.org' })), 403)
  assert.equal(status(write({ host: 'mietfuchs:3001', allowedHosts: ['.example.org'], origin: 'https://mietfuchs.example.org' })), 200)
  assert.equal(status(write({ origin: 'null' })), 403)
  assert.equal(status(write({ origin: 'kein url' })), 403)
  assert.equal(status(write({})), 200)
  assert.equal(status(write({ signedIn: false })), 401)
  // die Anmeldung selbst, ohne Sitzung
  const login = (over: Partial<GateRequest>) => gate(state, request({ method: 'POST', path: '/api/auth/login', ...over }))
  assert.equal(status(login({ origin: 'http://evil.example' })), 403)
  assert.equal(status(login({ secFetchSite: 'cross-site' })), 403)
  assert.equal(status(login({ secFetchSite: 'same-origin' })), 200)
  // lesend prüft die Origin nicht
  assert.equal(status(gate(state, request({ signedIn: true, secFetchSite: 'cross-site' }))), 200)
})

test('Vorschaltung: im Übergang und bei off weist Sec-Fetch-Site fremde Seiten ab, sonst bleibt alles offen', () => {
  for (const mode of ['transition', 'off'] as const) {
    const state = stateOf({ mode, required: false })
    const d = gate(state, request({ method: 'POST', path: '/api/units', secFetchSite: 'cross-site' }))
    assert.equal(d.pass, false, mode)
    assert.equal(passes(gate(state, request({ method: 'POST', path: '/api/units', secFetchSite: 'same-origin' }))), true, mode)
    assert.equal(passes(gate(state, request({ method: 'POST', path: '/api/units', origin: 'http://evil.example' }))), true, mode)
  }
  // lokal und mit NKA_AUTH=off wie bisher
  assert.equal(passes(gate(stateOf({ reachable: 'local', mode: 'none', required: false }), request({ method: 'POST', secFetchSite: 'cross-site' }))), true)
  assert.equal(passes(gate(stateOf({ setting: 'off', required: false }), request({ method: 'POST', secFetchSite: 'cross-site' }))), true)
})

test('Vorschaltung: Proxy-Kopfzeilen, Cookies und HTTPS erkennen', () => {
  assert.equal(viaProxy({}), false)
  for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'via']) assert.equal(viaProxy({ [name]: 'x' }), true, name)
  assert.deepEqual(cookieValues('a=1; mietfuchs_abcdef=eins; b=2; mietfuchs_abcdef=zwei', 'mietfuchs_abcdef'), ['eins', 'zwei'])
  assert.deepEqual(cookieValues(undefined, 'mietfuchs_abcdef'), [])
  assert.deepEqual(cookieValues('mietfuchs_abcdefx=1', 'mietfuchs_abcdef'), [])
  assert.equal(viaHttps({}), false)
  assert.equal(viaHttps({ 'x-forwarded-proto': 'https' }), true)
  assert.equal(viaHttps({ 'x-forwarded-proto': 'https, http' }), true)
  assert.equal(viaHttps({ forwarded: 'for=1.2.3.4;proto=https;host=x' }), true)
  assert.equal(viaHttps({ origin: 'https://mietfuchs.example.org' }), true)
  assert.equal(viaHttps({ origin: 'http://192.168.1.5:3001' }), false)
  assert.match(sessionCookie('abcdef', 'tok', false), /^mietfuchs_abcdef=tok; Path=\/; HttpOnly; SameSite=Strict$/)
  assert.match(sessionCookie('abcdef', 'tok', true), /; Secure$/)
  assert.match(clearedCookie('abcdef', false), /^mietfuchs_abcdef=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/)
  assert.equal(isLoopback('127.0.0.1'), true)
  assert.equal(isLoopback('::ffff:127.0.0.1'), true)
  assert.equal(isLoopback('::1'), true)
  assert.equal(isLoopback('192.168.1.5'), false)
  assert.equal(isLoopback(undefined), false)
})
