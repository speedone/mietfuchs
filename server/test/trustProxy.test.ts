// NKA_TRUST_PROXY (#528, Kopplung über einen Proxy): welche Peers Proxy-Kopfzeilen schicken dürfen. Adressen und Netze
// prüft net.BlockList, Namen löst Mietfuchs bei Bedarf über DNS auf; hier mit eingeschobenem `lookup` und eigener Uhr.
// Entwurf: docs/superpowers/specs/2026-11-09-kopplung-proxy-design.md, Abschnitt 3.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MISS_RETRY_MS, NAME_TTL_MS, createProxyTrust, parseTrustProxy } from '../src/trustProxy.ts'

test('NKA_TRUST_PROXY: Adressen, Netze und Namen, mit Komma getrennt', () => {
  const parsed = parseTrustProxy(' 127.0.0.1, ::1 ,172.16.0.0/12, caddy ')
  assert.deepEqual(parsed.problems, [])
  assert.equal(parsed.configured, true)
  assert.deepEqual(parsed.names, ['caddy'])
  assert.equal(parsed.addresses.check('127.0.0.1', 'ipv4'), true)
  assert.equal(parsed.addresses.check('::1', 'ipv6'), true)
  assert.equal(parsed.addresses.check('172.20.1.2', 'ipv4'), true)
  assert.equal(parsed.addresses.check('172.32.0.1', 'ipv4'), false)
  assert.equal(parsed.addresses.check('127.0.0.2', 'ipv4'), false)
  // zwei Adressen und ein Netz: genau diese Regeln
  assert.equal(parsed.addresses.rules.length, 3)
})

test('NKA_TRUST_PROXY: was jedem vertraute, gilt nicht, ebenso was keine Adresse, kein Netz und kein Name ist', () => {
  for (const entry of ['*', 'true', 'TRUE', '2', '0']) {
    const parsed = parseTrustProxy(entry)
    assert.equal(parsed.configured, false, entry)
    assert.deepEqual(parsed.problems, [`NKA_TRUST_PROXY: „${entry}“ vertraut jedem und gilt nicht. Tragen Sie die Adresse oder den Namen des Proxys ein.`], entry)
  }
  for (const entry of ['nas name', '300.1.1.1/8', '300.1.1.1', '10.0.0.0/33', '::1/129', '-caddy', 'caddy_1', '10.0.0.0/x']) {
    const parsed = parseTrustProxy(entry)
    assert.equal(parsed.configured, false, entry)
    assert.deepEqual(parsed.problems, [`NKA_TRUST_PROXY: „${entry}“ ist weder eine IP-Adresse noch ein Netz noch ein Name und gilt nicht.`], entry)
  }
  // ein gültiger Eintrag neben einem ungültigen gilt
  const mixed = parseTrustProxy('*, 192.0.2.1')
  assert.equal(mixed.configured, true)
  assert.equal(mixed.problems.length, 1)
})

test('NKA_TRUST_PROXY: leer heißt nichts vertraut, ohne DNS', async () => {
  for (const value of [undefined, '', ' , ']) {
    let lookups = 0
    const trust = createProxyTrust(value, { lookup: async () => { lookups++; return ['127.0.0.1'] } })
    assert.equal(trust.configured, false)
    assert.deepEqual(trust.problems, [])
    assert.equal(await trust.trusts('127.0.0.1'), false)
    assert.equal(await trust.trusts(undefined), false)
    assert.equal(lookups, 0)
  }
})

test('NKA_TRUST_PROXY: IPv4 in IPv6 gilt als IPv4, eine fremde Adresse nicht', async () => {
  const trust = createProxyTrust('172.18.0.0/16, ::1', { lookup: async () => assert.fail('kein Name eingetragen') })
  assert.equal(await trust.trusts('::ffff:172.18.0.3'), true)
  assert.equal(await trust.trusts('172.18.0.3'), true)
  assert.equal(await trust.trusts('0:0:0:0:0:0:0:1'), true)
  assert.equal(await trust.trusts('172.19.0.3'), false)
  assert.equal(await trust.trusts(''), false)
  assert.equal(await trust.trusts(undefined), false)
})

test('NKA_TRUST_PROXY: ein Name wird bei Bedarf aufgelöst, höchstens alle 5 s neu, das Ergebnis gilt 60 s', async () => {
  let clock = 1_000_000
  const answers: Array<string[] | Error> = [new Error('ENOTFOUND'), ['172.18.0.5'], ['172.18.0.9']]
  const asked: string[] = []
  const errors: string[] = []
  const trust = createProxyTrust('caddy', {
    now: () => clock,
    logError: (line) => errors.push(line),
    lookup: async (name) => {
      asked.push(name)
      const answer = answers.shift()
      if (!answer) return assert.fail('mehr Auflösungen als erwartet')
      if (answer instanceof Error) throw answer
      return answer
    },
  })
  assert.equal(trust.configured, true)
  // Caddy startet nach Mietfuchs: beim ersten Mal nicht auflösbar, eine Zeile
  assert.equal(await trust.trusts('172.18.0.5'), false)
  assert.deepEqual(asked, ['caddy.'], 'absolut gefragt, ohne Suchliste')
  assert.deepEqual(errors, ['NKA_TRUST_PROXY: Der Name „caddy“ lässt sich (noch) nicht auflösen.'])
  // vor Ablauf der 5 s keine zweite Auflösung
  clock += MISS_RETRY_MS - 1
  assert.equal(await trust.trusts('172.18.0.5'), false)
  assert.equal(asked.length, 1)
  // danach aufgelöst und vertraut
  clock += 1
  assert.equal(await trust.trusts('172.18.0.5'), true)
  assert.equal(asked.length, 2)
  // im Ergebnis: ohne neue Auflösung, auch nach 5 s
  clock += MISS_RETRY_MS
  assert.equal(await trust.trusts('172.18.0.5'), true)
  assert.equal(asked.length, 2)
  // nach 60 s neu aufgelöst: Caddy hat eine neue Adresse bekommen
  clock += NAME_TTL_MS
  assert.equal(await trust.trusts('172.18.0.5'), false)
  assert.equal(asked.length, 3)
  assert.equal(await trust.trusts('172.18.0.9'), true)
  assert.equal(asked.length, 3)
  assert.equal(errors.length, 1)
})

test('NKA_TRUST_PROXY: eine unbekannte Adresse löst höchstens alle 5 s neu auf, ein neuer Container gilt danach', async () => {
  let clock = 0
  const answers = [['172.18.0.5'], ['172.18.0.7']]
  let lookups = 0
  const trust = createProxyTrust('caddy', { now: () => clock, lookup: async () => { lookups++; return answers.shift() ?? assert.fail('zu oft') } })
  assert.equal(await trust.trusts('172.18.0.5'), true)
  assert.equal(await trust.trusts('172.18.0.7'), false)
  assert.equal(lookups, 1)
  clock += MISS_RETRY_MS
  assert.equal(await trust.trusts('172.18.0.7'), true)
  assert.equal(lookups, 2)
})

test('NKA_TRUST_PROXY: zwei gleichzeitige Anfragen lösen einmal auf', async () => {
  let lookups = 0
  let release: (value: string[]) => void = () => {}
  const trust = createProxyTrust('caddy', {
    lookup: () => {
      lookups++
      return new Promise<string[]>((resolve) => { release = resolve })
    },
  })
  const first = trust.trusts('172.18.0.5')
  const second = trust.trusts('172.18.0.5')
  release(['::ffff:172.18.0.5'])
  assert.deepEqual(await Promise.all([first, second]), [true, true])
  assert.equal(lookups, 1)
})

test('NKA_TRUST_PROXY: Zeile erneut, wenn ein aufgelöster Name wieder nicht auflösbar ist', async () => {
  let clock = 0
  const answers: Array<string[] | Error> = [new Error('x'), new Error('x'), ['172.18.0.5'], new Error('x')]
  const errors: string[] = []
  const trust = createProxyTrust('caddy', {
    now: () => clock,
    logError: (line) => errors.push(line),
    lookup: async () => {
      const answer = answers.shift()
      if (!answer || answer instanceof Error) throw new Error('ENOTFOUND')
      return answer
    },
  })
  await trust.trusts('172.18.0.5')
  clock += MISS_RETRY_MS
  await trust.trusts('172.18.0.5')
  assert.equal(errors.length, 1, 'nicht bei jedem Versuch')
  clock += MISS_RETRY_MS
  assert.equal(await trust.trusts('172.18.0.5'), true)
  clock += NAME_TTL_MS
  assert.equal(await trust.trusts('172.18.0.5'), false)
  assert.equal(errors.length, 2)
})

// ---------- Durchsicht PR 1 (I1, M1, M2) ----------

test('NKA_TRUST_PROXY: ein Netz, das fast jedem vertraute (IPv4 unter /8, IPv6 unter /32), gilt nicht', () => {
  for (const entry of ['0.0.0.0/0', '10.0.0.0/7', '128.0.0.0/1', '::/0', '2000::/3', 'fc00::/31']) {
    const parsed = parseTrustProxy(entry)
    assert.equal(parsed.configured, false, entry)
    assert.deepEqual(parsed.problems, [`NKA_TRUST_PROXY: „${entry}“ vertraut fast jedem und gilt nicht. Tragen Sie die Adresse des Proxys oder ein engeres Netz ein.`], entry)
  }
  for (const entry of ['10.0.0.0/8', 'fd00::/32', '172.16.0.0/12']) assert.equal(parseTrustProxy(entry).configured, true, entry)
})

test('NKA_TRUST_PROXY: Schlüsselwörter von Express sind keine Namen und sagen, was stattdessen gilt', () => {
  const lines: Record<string, string> = {
    loopback: 'NKA_TRUST_PROXY: „loopback“ ist kein Name eines Rechners und gilt nicht. Für einen Proxy auf demselben Rechner tragen Sie 127.0.0.1,::1 ein.',
    uniquelocal: 'NKA_TRUST_PROXY: „uniquelocal“ vertraut jedem Gerät im Heimnetz und gilt nicht. Tragen Sie die Adresse oder den Namen des Proxys ein, in Docker Compose etwa caddy.',
    linklocal: 'NKA_TRUST_PROXY: „linklocal“ vertraut jedem Gerät im Heimnetz und gilt nicht. Tragen Sie die Adresse oder den Namen des Proxys ein, in Docker Compose etwa caddy.',
    false: 'NKA_TRUST_PROXY: „false“ ist kein Name eines Rechners und gilt nicht. Wer keinem Proxy vertraut, lässt NKA_TRUST_PROXY leer.',
  }
  for (const [entry, line] of Object.entries(lines)) {
    for (const spelled of [entry, entry.toUpperCase()]) {
      const parsed = parseTrustProxy(spelled)
      assert.equal(parsed.configured, false, spelled)
      assert.deepEqual(parsed.names, [], spelled)
      assert.deepEqual(parsed.problems, [line.replace(`„${entry}“`, `„${spelled}“`)], spelled)
    }
  }
})

test('NKA_TRUST_PROXY: ein Name ohne Punkt wird absolut aufgelöst, ohne die Suchliste des Systems', async () => {
  const asked: string[] = []
  const trust = createProxyTrust('caddy, proxy.fritz.box', { lookup: async (name) => { asked.push(name); return ['172.18.0.5'] } })
  assert.equal(await trust.trusts('172.18.0.5'), true)
  assert.deepEqual(asked.sort(), ['caddy.', 'proxy.fritz.box'])
})

test('NKA_TRUST_PROXY: IPv6 mit eingebetteter IPv4 wird nicht verkürzt (M1)', async () => {
  const trust = createProxyTrust('::1.2.3.4, 64:ff9b::192.0.2.0/120', { lookup: async () => assert.fail('kein Name') })
  assert.equal(trust.configured, true)
  assert.equal(await trust.trusts('::1'), false)
  assert.equal(await trust.trusts('::102:304'), true)
  assert.equal(await trust.trusts('64:ff9b::c000:205'), true)
  assert.equal(await trust.trusts('64:ff9b::c000:305'), false)
})

test('NKA_TRUST_PROXY: eine vertraute Adresse wartet nicht auf eine laufende Auflösung (M2)', async () => {
  let clock = 0
  const pendingAnswers: Array<(value: string[]) => void> = []
  let lookups = 0
  const trust = createProxyTrust('caddy', {
    now: () => clock,
    lookup: () => {
      lookups++
      if (lookups === 1) return Promise.resolve(['172.18.0.5'])
      return new Promise<string[]>((resolve) => { pendingAnswers.push(resolve) })
    },
  })
  assert.equal(await trust.trusts('172.18.0.5'), true)
  clock += MISS_RETRY_MS
  // eine unbekannte Adresse löst neu auf, die Antwort lässt auf sich warten
  const unknown = trust.trusts('172.18.0.9')
  // die bekannte Adresse aus dem frischen Ergebnis gilt sofort
  const known = await Promise.race([trust.trusts('172.18.0.5'), new Promise<string>((resolve) => setTimeout(() => resolve('wartet'), 200))])
  assert.equal(known, true)
  pendingAnswers.forEach((resolve) => resolve(['172.18.0.5']))
  assert.equal(await unknown, false)
})

test('NKA_TRUST_PROXY: eine hängende Auflösung bricht nach der Wartezeit ab (M2)', async () => {
  const errors: string[] = []
  const trust = createProxyTrust('caddy', { lookupTimeoutMs: 50, logError: (line) => errors.push(line), lookup: () => new Promise<string[]>(() => {}) })
  const started = Date.now()
  assert.equal(await trust.trusts('172.18.0.5'), false)
  assert.ok(Date.now() - started < 2000, 'nicht länger als die Wartezeit')
  assert.deepEqual(errors, ['NKA_TRUST_PROXY: Der Name „caddy“ lässt sich (noch) nicht auflösen.'])
})

// ---------- Durchsicht PR 1, zweite Runde (Minor 1) ----------

test('NKA_TRUST_PROXY: IPv4 in IPv6 als Netz gilt als IPv4-Netz, mit derselben Untergrenze /8', async () => {
  for (const entry of ['::ffff:0:0/96', '::ffff:0.0.0.0/96', '0:0:0:0:0:FFFF:0:0/100', '::ffff:0:0/103']) {
    const parsed = parseTrustProxy(entry)
    assert.equal(parsed.configured, false, entry)
    assert.deepEqual(parsed.problems, [`NKA_TRUST_PROXY: „${entry}“ vertraut fast jedem und gilt nicht. Tragen Sie die Adresse des Proxys oder ein engeres Netz ein.`], entry)
    const trust = createProxyTrust(entry, { lookup: async () => assert.fail('kein Name') })
    assert.equal(await trust.trusts('8.8.8.8'), false, entry)
  }
  for (const entry of ['::ffff:ac12:0/112', '::ffff:172.18.0.0/112']) {
    const trust = createProxyTrust(entry, { lookup: async () => assert.fail('kein Name') })
    assert.equal(trust.configured, true, entry)
    assert.equal(await trust.trusts('172.18.0.3'), true, entry)
    assert.equal(await trust.trusts('::ffff:172.18.0.3'), true, entry)
    assert.equal(await trust.trusts('172.19.0.3'), false, entry)
  }
  const single = createProxyTrust('0:0:0:0:0:ffff:ac12:5', { lookup: async () => assert.fail('kein Name') })
  assert.equal(await single.trusts('172.18.0.5'), true)
  assert.equal(await single.trusts('172.18.0.6'), false)
})
