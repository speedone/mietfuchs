// Prüfung von Host und Origin (#517): Eine fremde Webseite im Browser des Vermieters soll Mietfuchs weder über einen
// eigenen Namen erreichen, der auf 127.0.0.1 zeigt (DNS-Rebinding), noch darin speichern, löschen oder es beenden
// (CSRF). Docker und npm bleiben ohne Prüfung, solange NKA_ALLOWED_HOSTS nichts anderes sagt: Dort steht oft ein
// Reverse-Proxy mit eigener Domain davor, der den Host auch umschreiben kann.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRequest, guardPolicy, hostAllowed, originHostRefusal, type GuardPolicy } from '../src/requestGuard.ts'

const local: GuardPolicy = guardPolicy('binary', {})

test('Prüfung: an für Programmdatei, Paket, Store und Fenster, aus für Docker und npm', () => {
  for (const runtime of ['binary', 'package', 'store', 'desktop'] as const) assert.equal(guardPolicy(runtime, {}).enabled, true, runtime)
  for (const runtime of ['docker', 'npm'] as const) assert.equal(guardPolicy(runtime, {}).enabled, false, runtime)
})

test('Prüfung: NKA_ALLOWED_HOSTS schaltet sie in Docker ein, „*“ schaltet sie überall ab', () => {
  const docker = guardPolicy('docker', { NKA_ALLOWED_HOSTS: 'mietfuchs.example.org, .heim.example' })
  assert.equal(docker.enabled, true)
  assert.deepEqual(docker.extraHosts, ['mietfuchs.example.org', '.heim.example'])
  assert.equal(guardPolicy('binary', { NKA_ALLOWED_HOSTS: '*' }).enabled, false)
  assert.equal(guardPolicy('docker', { NKA_ALLOWED_HOSTS: ' ' }).enabled, false)
})

test('Host: IP-Adressen, localhost, Rechnernamen ohne Punkt und Namen im Heimnetz sind erlaubt', () => {
  for (const host of [
    '127.0.0.1:3001', '192.168.178.20:3001', '100.114.19.193:5180', '[::1]:3001', '[fe80::1]', 'localhost:17517',
    'app.localhost', 'raspberrypi:3001', 'nas.local', 'pi.fritz.box:3001', 'server.lan', 'pi.home.arpa', 'box.home',
    'pi.internal', 'pi.localdomain', 'pi.tail1234.ts.net', 'pi.netbird.cloud', 'PI.FRITZ.BOX',
  ]) {
    assert.equal(checkRequest({ method: 'GET', host }, local), null, host)
  }
})

test('Host: ein fremder Name mit Punkt wird abgelehnt (DNS-Rebinding), mit Erklärung', () => {
  const reason = checkRequest({ method: 'GET', host: 'angreifer.example.com:3001' }, local)
  assert.ok(reason, 'abgelehnt')
  assert.match(reason, /angreifer\.example\.com/)
  assert.match(reason, /NKA_ALLOWED_HOSTS/)
  // Auch ein Name, der nur so tut, als wäre er lokal
  assert.ok(checkRequest({ method: 'GET', host: 'fritz.box.angreifer.example' }, local))
  assert.ok(checkRequest({ method: 'GET', host: 'localhost.angreifer.example' }, local))
})

test('Host: eigene Namen aus NKA_ALLOWED_HOSTS, genau oder mit führendem Punkt als Endung', () => {
  const policy = guardPolicy('binary', { NKA_ALLOWED_HOSTS: 'mietfuchs.example.org,.heim.example' })
  assert.equal(checkRequest({ method: 'GET', host: 'mietfuchs.example.org' }, policy), null)
  assert.equal(checkRequest({ method: 'GET', host: 'pi.heim.example:3001' }, policy), null)
  assert.equal(checkRequest({ method: 'GET', host: 'heim.example' }, policy), null)
  assert.ok(checkRequest({ method: 'GET', host: 'andere.example.org' }, policy))
})

test('Host: ohne Kopfzeile (HTTP/1.0, eigene Skripte) wird nicht abgelehnt', () => {
  assert.equal(checkRequest({ method: 'GET' }, local), null)
})

test('Origin: speichern, löschen und beenden nur von der eigenen Seite (CSRF)', () => {
  const host = '127.0.0.1:3001'
  assert.equal(checkRequest({ method: 'POST', host, origin: 'http://127.0.0.1:3001' }, local), null)
  assert.equal(checkRequest({ method: 'DELETE', host: 'Pi.Fritz.Box:3001', origin: 'http://pi.fritz.box:3001' }, local), null)
  assert.match(checkRequest({ method: 'POST', host, origin: 'https://angreifer.example' }, local) ?? '', /angreifer\.example/)
  // Anderer Port ist eine andere Seite
  assert.ok(checkRequest({ method: 'PUT', host, origin: 'http://127.0.0.1:5173' }, local))
  // Sandbox und Dateien schicken „null“
  assert.ok(checkRequest({ method: 'POST', host, origin: 'null' }, local))
  // Lesen bleibt erlaubt, die Antwort bekommt die fremde Seite ohnehin nicht zu sehen
  assert.equal(checkRequest({ method: 'GET', host, origin: 'https://angreifer.example' }, local), null)
})

test('Origin: ohne Kopfzeile entscheidet Sec-Fetch-Site, ganz ohne bleibt es erlaubt (curl, Skripte)', () => {
  const host = '127.0.0.1:3001'
  assert.ok(checkRequest({ method: 'POST', host, secFetchSite: 'cross-site' }, local))
  assert.equal(checkRequest({ method: 'POST', host, secFetchSite: 'same-origin' }, local), null)
  assert.equal(checkRequest({ method: 'POST', host, secFetchSite: 'none' }, local), null)
  assert.equal(checkRequest({ method: 'POST', host }, local), null)
})

test('Ohne Prüfung (Docker, npm) geht alles durch, auch hinter einem Proxy mit umgeschriebenem Host', () => {
  const open = guardPolicy('docker', {})
  assert.equal(checkRequest({ method: 'POST', host: 'mietfuchs:3001', origin: 'https://mietfuchs.example.org' }, open), null)
  assert.equal(checkRequest({ method: 'GET', host: 'angreifer.example.com' }, open), null)
})

// Durchsicht M1: Hinter einem Reverse-Proxy kommt der Host umgeschrieben an (nginx: 127.0.0.1:3001), die Seite selbst
// heißt wie in NKA_ALLOWED_HOSTS. Deren Änderungen müssen durch, eine fremde Seite auf localhost dagegen nicht.
test('Origin: ein Name aus NKA_ALLOWED_HOSTS darf ändern, auch wenn der Proxy den Host umschreibt', () => {
  const policy = guardPolicy('package', { NKA_ALLOWED_HOSTS: 'mietfuchs.example.org,.heim.example' })
  assert.equal(checkRequest({ method: 'POST', host: '127.0.0.1:3001', origin: 'https://mietfuchs.example.org' }, policy), null)
  assert.equal(checkRequest({ method: 'POST', host: '127.0.0.1:3001', origin: 'https://pi.heim.example' }, policy), null)
  assert.ok(checkRequest({ method: 'POST', host: '127.0.0.1:3001', origin: 'http://localhost:8000' }, policy))
  assert.ok(checkRequest({ method: 'POST', host: '127.0.0.1:3001', origin: 'https://andere.example.org' }, policy))
})

// Durchsicht K16: absolute Namen mit Schlusspunkt
test('Host: ein Schlusspunkt am Namen ändert nichts', () => {
  assert.equal(checkRequest({ method: 'GET', host: 'localhost.:3001' }, local), null)
  assert.equal(checkRequest({ method: 'GET', host: 'pi.fritz.box.:3001' }, local), null)
  assert.ok(checkRequest({ method: 'GET', host: 'angreifer.example.com.' }, local))
})

// Der Ursprung, den ein vertrauter Proxy beim Koppeln weiterreicht, besteht dieselbe Regel wie der Host (#528, I2)
test('Ursprung der Kopplung: dieselbe Regel wie der Host, ohne Prüfung jeder Name', () => {
  const listed = guardPolicy('docker', { NKA_ALLOWED_HOSTS: 'nas.example' })
  assert.equal(hostAllowed('nas.example', listed), true)
  assert.equal(hostAllowed('NAS.example.', listed), true)
  assert.equal(hostAllowed('andere.example', listed), false)
  assert.equal(hostAllowed('nas.fritz.box', listed), true)
  assert.equal(hostAllowed('[::1]', listed), true)
  assert.equal(hostAllowed('andere.example', guardPolicy('docker', {})), true)
  assert.equal(hostAllowed('andere.example', guardPolicy('docker', { NKA_ALLOWED_HOSTS: '*' })), true)
  // derselbe Satz wie am Host einer Anfrage
  assert.equal(originHostRefusal('nas.example', listed), null)
  assert.equal(originHostRefusal('Andere.Example.', listed), checkRequest({ method: 'GET', host: 'andere.example' }, listed))
  assert.match(originHostRefusal('andere.example', listed) ?? '', /^Mietfuchs antwortet nicht unter dem Namen „andere\.example“\./)
})

test('Ursprung der Kopplung mit NKA_ALLOWED_HOSTS: nur eingetragen, private IP oder Name ohne Punkt (Durchsicht m3)', () => {
  // Fängt ein Proxy jeden Namen auf (nginx: der erste `server` am Port), reicht er auch einen fremden Namen weiter. Mit
  // einer Liste bindet deshalb keine öffentliche IP und keine Endung des Heimnetzes von selbst, auch wenn der Host sie
  // weiter durchlässt.
  const listed = guardPolicy('docker', { NKA_ALLOWED_HOSTS: 'nas.example, .heim.example, nas.fritz.box' })
  for (const name of ['nas.example', 'NAS.example.', 'a.heim.example', 'nas.fritz.box', 'nas', 'localhost',
    '127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.178.23', '100.114.19.193', '[::1]', '[fd00::5]', '[fe80::1]', '169.254.1.1', '[::ffff:192.168.1.5]']) {
    assert.equal(originHostRefusal(name, listed), null, name)
  }
  for (const name of ['andere.fritz.box', 'pi.ts.net', 'x.netbird.cloud', 'nas.local', 'nas.home.arpa', 'a.localhost',
    '8.8.8.8', '203.0.113.7', '[2001:db8::1]', '[::ffff:8.8.8.8]', 'andere.example']) {
    const plain = name.replace(/^\[|\]$/g, '')
    assert.equal(originHostRefusal(name, listed), checkRequest({ method: 'GET', host: 'nicht.example' }, listed)?.replace('nicht.example', plain), name)
  }
  // Am Host bleibt alles beim Alten
  for (const name of ['andere.fritz.box', 'pi.ts.net', '8.8.8.8']) assert.equal(hostAllowed(name, listed), true, name)
  // Ohne Liste (Programmdatei, Fenster) die Regel des Hosts, ohne Prüfung jeder Name
  assert.equal(originHostRefusal('nas.fritz.box', guardPolicy('binary', {})), null)
  assert.equal(originHostRefusal('8.8.8.8', guardPolicy('binary', {})), null)
  assert.equal(originHostRefusal('pi.ts.net', guardPolicy('docker', {})), null)
})
