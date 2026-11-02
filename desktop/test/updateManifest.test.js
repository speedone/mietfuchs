// Signatur der Update-Beschreibung latest.yml (#551): Format EBUM1 aus electron-builder 27 (updateManifestSignature.js in
// builder-util-runtime 10), hier nachgebaut, bis electron-updater 7 stabil ist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { UPDATE_MANIFEST_PUBLIC_KEYS, canonicalizeForSigning, computeUpdateManifestKeyId, signManifest, verifyManifestSignatures } from '../src/updateManifest.js'

const manifest = () => ({
  version: '0.15.1',
  files: [{ url: 'Mietfuchs-Setup-0.15.1.exe', sha512: 'q2wK7v2mQ0f1Yy6N3S0Zr0x9QmG8g1m3k5L7p9R1t3V5x7Z9b1D3f5H7j9L1n3P5r7T9v1X3z5B7d9F1h3J5Q==', size: 241234567 }],
  path: 'Mietfuchs-Setup-0.15.1.exe',
  sha512: 'q2wK7v2mQ0f1Yy6N3S0Zr0x9QmG8g1m3k5L7p9R1t3V5x7Z9b1D3f5H7j9L1n3P5r7T9v1X3z5B7d9F1h3J5Q==',
  releaseDate: '2026-11-02T10:00:00.000Z',
})

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  return { pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey }
}

// Erzeugt mit dem Original (builder-util-runtime 10.0.0-alpha.13, createManifestSignatureEntry und crypto.sign über
// canonicalizeForSigning): Liest unser Nachbau dasselbe, nehmen bestehende Installationen später auch Beschreibungen an,
// die electron-builder 27 selbst signiert.
const UPSTREAM = {
  pub: 'MCowBQYDK2VwAyEAL7FGgDIPip4i/ic/7vFwuM5LPzppw+Bjrf4BQm7Mysc=',
  keyId: 'c48df4b03371cbdf22b8a95bba0eb3dbab15638e5dd2299f71e1638c32b20c52',
  signature: 'xBC5Tpv2y8QN7SKMiz7SoyGcnnPg/f+btRzpgseZXVCeeRzfk8zUa4Q8wSVF1eu5ctVDLVd1ckmhQ1e3xWwrCw==',
  canonical: 'EBUM1\nversion:"0.15.1"\nstaging:\nminimumSystemVersion:\nfile:"Mietfuchs-Setup-0.15.1.exe"\t"q2wK7v2mQ0f1Yy6N3S0Zr0x9QmG8g1m3k5L7p9R1t3V5x7Z9b1D3f5H7j9L1n3P5r7T9v1X3z5B7d9F1h3J5Q=="\t241234567',
}

test('EBUM1: dieselben Bytes und dieselbe Schlüsselkennung wie das Original', () => {
  assert.equal(canonicalizeForSigning(manifest()), UPSTREAM.canonical)
  assert.equal(computeUpdateManifestKeyId(UPSTREAM.pub), UPSTREAM.keyId)
  const signed = { ...manifest(), signatures: [{ keyId: UPSTREAM.keyId, signature: UPSTREAM.signature }] }
  assert.deepEqual(verifyManifestSignatures(signed, [UPSTREAM.pub]), { ok: true, keyId: UPSTREAM.keyId })
})

test('signiert und geprüft: gilt nur unverändert und nur mit einem vertrauten Schlüssel', () => {
  const { pub, privateKey } = keyPair()
  const signed = { ...manifest(), signatures: [signManifest(manifest(), privateKey)] }
  assert.equal(verifyManifestSignatures(signed, [pub]).ok, true)
  // Geändert, was installiert wird: Prüfsumme, Datei, Version
  assert.equal(verifyManifestSignatures({ ...signed, files: [{ ...signed.files[0], sha512: 'AAAA' }] }, [pub]).ok, false)
  assert.equal(verifyManifestSignatures({ ...signed, files: [{ ...signed.files[0], url: 'boese.exe' }] }, [pub]).ok, false)
  assert.equal(verifyManifestSignatures({ ...signed, version: '9.9.9' }, [pub]).ok, false)
  // Ein fremder Schlüssel, keine Signatur, keine vertrauten Schlüssel
  assert.equal(verifyManifestSignatures(signed, [keyPair().pub]).ok, false)
  assert.equal(verifyManifestSignatures(manifest(), [pub]).ok, false)
  assert.equal(verifyManifestSignatures(signed, []).ok, false)
  // Was nicht installiert wird, darf sich ändern (Datum, Notizen)
  assert.equal(verifyManifestSignatures({ ...signed, releaseDate: '2027-01-01T00:00:00.000Z', releaseNotes: 'neu' }, [pub]).ok, true)
})

test('Schlüsselwechsel: einer von mehreren vertrauten Schlüsseln genügt', () => {
  const alt = keyPair()
  const neu = keyPair()
  const signed = { ...manifest(), signatures: [signManifest(manifest(), neu.privateKey)] }
  assert.equal(verifyManifestSignatures(signed, [alt.pub, neu.pub]).ok, true)
})

test('eine Beschreibung ohne Dateiliste gilt nicht, auch signiert', () => {
  const { pub, privateKey } = keyPair()
  const { files, ...ohne } = manifest()
  void files
  const result = verifyManifestSignatures({ ...ohne, signatures: [signManifest(manifest(), privateKey)] }, [pub])
  assert.equal(result.ok, false)
  assert.match(String(result.reason), /files/)
})

test('im Programm stehen gültige Ed25519-Schlüssel', () => {
  assert.ok(UPDATE_MANIFEST_PUBLIC_KEYS.length >= 1)
  for (const key of UPDATE_MANIFEST_PUBLIC_KEYS) assert.match(computeUpdateManifestKeyId(key), /^[0-9a-f]{64}$/)
})
