// HTTPS auf demselben Port (#528, Schritt 2): Schlüssel und Zertifikat im Datenordner unter `tls/`. Hier nur das
// Anlegen und Wiederverwenden; den Port mit beiden Protokollen prüfen dualPort.test.ts und api-https.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TLS_DIR, certSha256, ensureCertificate, readCertificate } from '../src/tls.ts'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-tls-'))
const keyFile = (dir: string) => path.join(dir, TLS_DIR, 'mietfuchs.key')
const certFile = (dir: string) => path.join(dir, TLS_DIR, 'mietfuchs.crt')

type Pair = { key: string, cert: string, certSha256: string }
const pairOf = (result: Pair | { problem: string }): Pair => ('problem' in result ? assert.fail(`kein Zertifikat: ${result.problem}`) : result)

test('TLS: ein frischer Datenordner bekommt Schlüssel und Zertifikat, ECDSA und 30 Jahre gültig', async () => {
  const dir = freshDir()
  try {
    const now = new Date()
    const pair = pairOf(await ensureCertificate(dir, now))
    assert.equal(fs.readFileSync(keyFile(dir), 'utf8'), pair.key)
    assert.equal(fs.readFileSync(certFile(dir), 'utf8'), pair.cert)
    if (process.platform !== 'win32') assert.equal(fs.statSync(keyFile(dir)).mode & 0o777, 0o600)
    const x509 = new crypto.X509Certificate(pair.cert)
    assert.equal(x509.publicKey.asymmetricKeyType, 'ec')
    assert.equal(x509.publicKey.asymmetricKeyDetails?.namedCurve, 'prime256v1')
    assert.match(x509.subject, /CN=Mietfuchs/)
    assert.ok(x509.checkPrivateKey(crypto.createPrivateKey(pair.key)), 'Schlüssel und Zertifikat gehören zusammen')
    const years29 = new Date(now)
    years29.setUTCFullYear(years29.getUTCFullYear() + 29)
    assert.ok(new Date(x509.validTo).getTime() >= years29.getTime(), `gültig bis ${x509.validTo}`)
    assert.equal(pair.certSha256, certSha256(pair.cert))
    // Keine Zwischendatei bleibt liegen
    assert.deepEqual(fs.readdirSync(path.join(dir, TLS_DIR)).sort(), ['mietfuchs.crt', 'mietfuchs.key'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: der Fingerabdruck ist der SHA-256 des DER, klein in Hex', async () => {
  const dir = freshDir()
  try {
    const pair = pairOf(await ensureCertificate(dir))
    const expected = crypto.createHash('sha256').update(new crypto.X509Certificate(pair.cert).raw).digest('hex')
    assert.equal(certSha256(pair.cert), expected)
    assert.match(expected, /^[0-9a-f]{64}$/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: ein zweiter Start nimmt dasselbe Zertifikat', async () => {
  const dir = freshDir()
  try {
    const first = pairOf(await ensureCertificate(dir))
    const second = pairOf(await ensureCertificate(dir))
    assert.equal(second.certSha256, first.certSha256)
    assert.equal(second.key, first.key)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: eine kaputte Datei wird ersetzt, die Rückgabe trägt das neue Zertifikat', async () => {
  const dir = freshDir()
  try {
    const first = pairOf(await ensureCertificate(dir))
    fs.writeFileSync(certFile(dir), '-----BEGIN CERTIFICATE-----\nkaputt\n-----END CERTIFICATE-----\n')
    const second = pairOf(await ensureCertificate(dir))
    assert.notEqual(second.certSha256, first.certSha256)
    assert.equal(fs.readFileSync(certFile(dir), 'utf8'), second.cert)
    assert.equal(second.certSha256, certSha256(fs.readFileSync(certFile(dir), 'utf8')))
    // Auch ein unlesbarer Schlüssel
    fs.writeFileSync(keyFile(dir), 'kein Schlüssel')
    const third = pairOf(await ensureCertificate(dir))
    assert.notEqual(third.certSha256, second.certSha256)
    assert.equal(fs.readFileSync(keyFile(dir), 'utf8'), third.key)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: Schlüssel und Zertifikat, die nicht zusammengehören, werden ersetzt', async () => {
  // Etwa nach einem Absturz zwischen dem Schreiben der beiden Dateien
  const a = freshDir()
  const b = freshDir()
  try {
    pairOf(await ensureCertificate(a))
    const other = pairOf(await ensureCertificate(b))
    fs.writeFileSync(certFile(a), other.cert)
    const pair = pairOf(await ensureCertificate(a))
    assert.notEqual(pair.certSha256, other.certSha256)
    assert.ok(new crypto.X509Certificate(pair.cert).checkPrivateKey(crypto.createPrivateKey(pair.key)))
  } finally {
    fs.rmSync(a, { recursive: true, force: true })
    fs.rmSync(b, { recursive: true, force: true })
  }
})

test('TLS: ein nicht beschreibbarer Datenordner ergibt einen Satz statt eines Fehlers', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'Rechte lassen sich hier nicht entziehen' : false }, async () => {
  const dir = freshDir()
  try {
    fs.chmodSync(dir, 0o500)
    const result = await ensureCertificate(dir)
    assert.ok('problem' in result, 'kein Zertifikat erwartet')
    assert.match(result.problem, /\S.*\./)
    assert.ok(result.problem.includes(path.join(dir, TLS_DIR)), result.problem)
  } finally {
    fs.chmodSync(dir, 0o700)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: steht an der Stelle des Ordners eine Datei, ergibt das einen Satz', async () => {
  const dir = freshDir()
  try {
    fs.writeFileSync(path.join(dir, TLS_DIR), 'keine Ablage')
    const result = await ensureCertificate(dir)
    assert.ok('problem' in result, 'kein Zertifikat erwartet')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: Lesen allein legt nichts an', async () => {
  // Vor dem Binden des Ports wird nur gelesen (#244: ein zweiter Start rührt den Datenordner nicht an)
  const dir = freshDir()
  try {
    assert.equal(readCertificate(dir), null)
    assert.deepEqual(fs.readdirSync(dir), [])
    const pair = pairOf(await ensureCertificate(dir))
    assert.equal(readCertificate(dir)?.certSha256, pair.certSha256)
    fs.writeFileSync(certFile(dir), 'kaputt')
    assert.equal(readCertificate(dir), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: liegengebliebene Zwischendateien eines Absturzes werden beim Erzeugen entfernt', async () => {
  // Zwischen Schreiben und Umbenennen abgestürzt: Die Zwischendatei kann einen privaten Schlüssel enthalten
  const dir = freshDir()
  try {
    fs.mkdirSync(path.join(dir, TLS_DIR))
    fs.writeFileSync(path.join(dir, TLS_DIR, 'mietfuchs.key.4711.tmp'), 'alter Schlüssel', { mode: 0o600 })
    fs.writeFileSync(path.join(dir, TLS_DIR, 'mietfuchs.crt.4711.tmp'), 'altes Zertifikat')
    pairOf(await ensureCertificate(dir))
    assert.deepEqual(fs.readdirSync(path.join(dir, TLS_DIR)).sort(), ['mietfuchs.crt', 'mietfuchs.key'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: das Zertifikat nennt localhost, 127.0.0.1 und ::1, damit ein Client es ohne Abschalten der Prüfung annimmt', async () => {
  // Wer dem Zertifikat ausdrücklich vertraut (ca), prüft den Namen trotzdem; für Prüfungen und Smoke-Test auf diesem Rechner
  const dir = freshDir()
  try {
    const pair = pairOf(await ensureCertificate(dir))
    const x509 = new crypto.X509Certificate(pair.cert)
    assert.deepEqual((x509.subjectAltName ?? '').split(', ').sort(), ['DNS:localhost', 'IP Address:0:0:0:0:0:0:0:1', 'IP Address:127.0.0.1'])
    assert.match(x509.subject, /CN=Mietfuchs/)
    assert.equal(x509.checkHost('localhost'), 'localhost')
    assert.equal(x509.checkIP('127.0.0.1'), '127.0.0.1')
    assert.equal(x509.checkIP('::1'), '::1')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('TLS: ein vorhandenes Zertifikat ohne diese Namen bleibt gültig und wird nicht ersetzt', async () => {
  // Gekoppelte Fenster prüfen den Fingerabdruck; ein neues Zertifikat hieße neu koppeln
  const dir = freshDir()
  try {
    const { generate } = await import('selfsigned')
    const old = await generate([{ name: 'commonName', value: 'Mietfuchs' }], { keyType: 'ec', curve: 'P-256', algorithm: 'sha256' })
    fs.mkdirSync(path.join(dir, TLS_DIR))
    fs.writeFileSync(keyFile(dir), old.private)
    fs.writeFileSync(certFile(dir), old.cert)
    const pair = pairOf(await ensureCertificate(dir))
    assert.equal(pair.certSha256, certSha256(old.cert))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
