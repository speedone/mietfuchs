// Signatur der Update-Beschreibung latest.yml (#551), im Format EBUM1 von electron-builder 27.
//
// Warum: electron-updater prüft den Installer gegen die SHA-512 aus latest.yml. Beide liegen im selben GitHub-Release, die
// Prüfsumme schützt also vor kaputten Downloads, nicht vor einem untergeschobenen Release. Eine Code-Signatur (Authenticode)
// hat Mietfuchs nicht (`verifyUpdateCodeSignature: false` in desktop/package.json). Deshalb signiert release.yml die
// Beschreibung mit einem eigenen Ed25519-Schlüssel (scripts/sign-update-manifest.mjs), und das Fenster lädt eine neue
// Version erst, wenn einer der Schlüssel unten die Signatur bestätigt (createUpdaterController in updater.js). Gedeckt sind
// Version und je Datei Name, SHA-512 und Größe; die Prüfsumme der geladenen Datei prüft danach electron-updater wie bisher.
//
// Woher: electron-builder 27 bringt genau das mit (`updateManifest` beim Bau, `updateManifestPublicKey` in
// electron-updater 7), bislang nur als Vorabversion. Bis es stabil ist, steht der Prüfteil hier, übernommen aus
// builder-util-runtime 10.0.0-alpha.13 (dist/updateManifestSignature.js, MIT, Copyright (c) 2015 Loopline Systems,
// https://github.com/electron-userland/electron-builder) und nur um Typangaben ergänzt. Das Format ist ein Vertrag
// zwischen Signierer und Prüfer; ein fester Prüfvektor aus dem Original steht in desktop/test/updateManifest.test.js.
// Beim Wechsel auf electron-builder 27 nehmen bestehende Installationen deshalb auch dessen Signaturen an.
//
// The MIT License (MIT), Copyright (c) 2015 Loopline Systems. Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without
// restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
// following conditions: The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
// WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
// OR OTHER DEALINGS IN THE SOFTWARE.
import { createHash, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'

/**
 * Die vertrauten Schlüssel (Ed25519, SPKI in Base64). Einer genügt. Der erste signiert die Releases (GitHub-Secret
 * MIETFUCHS_UPDATE_SIGNING_KEY); der zweite liegt nicht in der CI, sondern beim Herausgeber, und signiert nur, wenn der
 * erste verloren oder bekannt geworden ist. Ein Wechsel: ein Release, signiert mit einem bisherigen Schlüssel, bringt die
 * neue Liste mit. **Nie leeren und nie ohne diesen Weg ersetzen**: Installationen ohne passenden Schlüssel nehmen kein
 * Update mehr an und müssen von Hand neu installiert werden.
 */
export const UPDATE_MANIFEST_PUBLIC_KEYS = Object.freeze([
  'MCowBQYDK2VwAyEAO9G1eGu/3jbVdcqvVAEc1gZq3Z6UTr6170julLSoaBg=',
  'MCowBQYDK2VwAyEAgKZtEdOtDDw5O48ST4e6XDtbjD6ie+9k9Shan/NIxps=',
])

/** @typedef {{ url?: unknown, sha512?: unknown, size?: unknown, blockMapUrl?: unknown }} ManifestFile */
/** @typedef {{ path?: unknown, sha512?: unknown, size?: unknown, blockMapSize?: unknown, isAdminRightsRequired?: unknown }} ManifestPackage */
/** @typedef {{ keyId?: unknown, signature?: unknown }} ManifestSignature */
/**
 * Die Beschreibung, wie js-yaml sie aus latest.yml liest (ungeprüft)
 * @typedef {{ version?: unknown, stagingPercentage?: unknown, minimumSystemVersion?: unknown, allowCatalogSignature?: unknown, files?: unknown, packages?: unknown, signature?: unknown, signatures?: unknown, [key: string]: unknown }} Manifest
 */

// ---------- Übernommen aus builder-util-runtime 10.0.0-alpha.13 (MIT, siehe oben) ----------

export const UPDATE_MANIFEST_SIGNATURE_VERSION = 'EBUM1'

/** @param {unknown} value */
function encodeField(value) {
  if (value === undefined || value === null) {
    return ''
  }
  const encoded = JSON.stringify(value)
  return encoded === undefined ? '' : encoded
}

/** @param {Manifest} info @returns {string} */
export function canonicalizeForSigning(info) {
  const lines = [
    UPDATE_MANIFEST_SIGNATURE_VERSION,
    `version:${encodeField(info.version)}`,
    `staging:${encodeField(info.stagingPercentage)}`,
    `minimumSystemVersion:${encodeField(info.minimumSystemVersion)}`,
  ]
  if (readAllowCatalogSignature(info) === true) {
    lines.push('allowCatalogSignature:true')
  }
  const files = (/** @type {ManifestFile[]} */ (Array.isArray(info.files) ? info.files : [])).map((f) => {
    const record = `file:${encodeField(f?.url)}\t${encodeField(f?.sha512)}\t${encodeField(f?.size)}`
    return f?.blockMapUrl == null ? record : `${record}\t${encodeField(f.blockMapUrl)}`
  })
  files.sort()
  lines.push(...files)
  const packages = /** @type {Record<string, ManifestPackage | null> | null | undefined} */ (info.packages)
  if (packages != null) {
    const packageLines = Object.keys(packages).map((arch) => {
      const p = packages[arch] ?? {}
      return `package:${encodeField(arch)}\t${encodeField(p.path)}\t${encodeField(p.sha512)}\t${encodeField(p.size)}\t${encodeField(p.blockMapSize)}\t${p.isAdminRightsRequired === true ? '1' : ''}`
    })
    packageLines.sort()
    lines.push(...packageLines)
  }
  return lines.join('\n')
}

/** @param {Manifest} info */
function readAllowCatalogSignature(info) {
  return 'allowCatalogSignature' in info ? info.allowCatalogSignature : undefined
}

/** @param {string} value */
function hasControlCharacter(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

/** @param {unknown} value @returns {value is string} */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/** @param {Manifest} info @returns {string | null} */
export function validateSignedManifestShape(info) {
  if (!isNonEmptyString(info.version)) {
    return 'version must be a non-empty string'
  }
  /** @type {[string, string][]} */
  const strings = [['version', info.version]]
  if (info.stagingPercentage != null && typeof info.stagingPercentage !== 'number') {
    return 'stagingPercentage must be a number'
  }
  if (info.minimumSystemVersion != null) {
    if (typeof info.minimumSystemVersion !== 'string') {
      return 'minimumSystemVersion must be a string'
    }
    strings.push(['minimumSystemVersion', info.minimumSystemVersion])
  }
  const allowCatalogSignature = readAllowCatalogSignature(info)
  if (allowCatalogSignature != null && typeof allowCatalogSignature !== 'boolean') {
    return 'allowCatalogSignature must be a boolean'
  }
  const files = info.files
  if (!Array.isArray(files) || files.length === 0) {
    return 'files must be a non-empty array'
  }
  for (let i = 0; i < files.length; i++) {
    const file = /** @type {ManifestFile | null} */ (files[i])
    if (file == null || !isNonEmptyString(file.url) || !isNonEmptyString(file.sha512)) {
      return `files[${i}] must have a non-empty string url and sha512`
    }
    if (file.size != null && typeof file.size !== 'number') {
      return `files[${i}].size must be a number`
    }
    strings.push([`files[${i}].url`, file.url], [`files[${i}].sha512`, file.sha512])
    if (file.blockMapUrl != null) {
      if (!isNonEmptyString(file.blockMapUrl)) {
        return `files[${i}].blockMapUrl must be a non-empty string`
      }
      strings.push([`files[${i}].blockMapUrl`, file.blockMapUrl])
    }
  }
  const packages = info.packages
  if (packages != null) {
    if (typeof packages !== 'object' || Array.isArray(packages)) {
      return 'packages must be an object keyed by arch'
    }
    const byArch = /** @type {Record<string, ManifestPackage | null>} */ (packages)
    for (const arch of Object.keys(byArch)) {
      const p = byArch[arch]
      if (p == null || !isNonEmptyString(p.path) || !isNonEmptyString(p.sha512)) {
        return `packages.${arch} must have a non-empty string path and sha512`
      }
      if ((p.size != null && typeof p.size !== 'number') || (p.blockMapSize != null && typeof p.blockMapSize !== 'number')) {
        return `packages.${arch} size and blockMapSize must be numbers`
      }
      if (p.isAdminRightsRequired != null && typeof p.isAdminRightsRequired !== 'boolean') {
        return `packages.${arch}.isAdminRightsRequired must be a boolean`
      }
      strings.push([`packages arch key ${JSON.stringify(arch)}`, arch], [`packages.${arch}.path`, p.path], [`packages.${arch}.sha512`, p.sha512])
    }
  }
  for (const [name, value] of strings) {
    if (hasControlCharacter(value)) {
      return `${name} contains a control character`
    }
  }
  return null
}

/** @param {string} value @returns {import('node:crypto').KeyObject} */
export function parsePublicKey(value) {
  const trimmed = value.trim()
  const pem = trimmed.includes('-----BEGIN') ? trimmed : `-----BEGIN PUBLIC KEY-----\n${trimmed.replace(/\s+/g, '')}\n-----END PUBLIC KEY-----`
  const key = createPublicKey({ key: pem, format: 'pem' })
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`Update manifest public key must be Ed25519, got: ${key.asymmetricKeyType}`)
  }
  return key
}

/** @param {string | import('node:crypto').KeyObject} publicKey @returns {string} */
export function computeUpdateManifestKeyId(publicKey) {
  let key = typeof publicKey === 'string' ? parsePublicKey(publicKey) : publicKey
  if (key.type === 'private') {
    key = createPublicKey(key)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`Update manifest key must be Ed25519, got: ${key.asymmetricKeyType}`)
  }
  return createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex')
}

/** @param {Manifest} info @returns {{ keyId?: string, signature: string }[]} */
export function collectManifestSignatures(info) {
  /** @type {{ keyId?: string, signature: string }[]} */
  const result = []
  for (const entry of /** @type {ManifestSignature[]} */ (Array.isArray(info.signatures) ? info.signatures : [])) {
    if (entry != null && typeof entry.signature === 'string' && entry.signature.length > 0) {
      result.push({ keyId: typeof entry.keyId === 'string' && entry.keyId.length > 0 ? entry.keyId : undefined, signature: entry.signature })
    }
  }
  const legacy = info.signature
  if (typeof legacy === 'string' && legacy.length > 0 && !result.some((it) => it.signature === legacy)) {
    result.push({ signature: legacy })
  }
  return result
}

/** @param {Buffer} data @param {import('node:crypto').KeyObject} key @param {string} signature */
function verifySignatureBytes(data, key, signature) {
  let signatureBuffer
  try {
    signatureBuffer = Buffer.from(signature, 'base64')
  } catch {
    return false
  }
  try {
    return cryptoVerify(null, data, key, signatureBuffer)
  } catch {
    return false
  }
}

/**
 * @param {Manifest} info
 * @param {readonly (string | import('node:crypto').KeyObject)[]} publicKeys
 * @returns {{ ok: boolean, keyId?: string, reason?: string }}
 */
export function verifyManifestSignatures(info, publicKeys) {
  const candidates = collectManifestSignatures(info)
  if (candidates.length === 0 || publicKeys.length === 0) {
    return { ok: false }
  }
  const shapeProblem = validateSignedManifestShape(info)
  if (shapeProblem != null) {
    return { ok: false, reason: shapeProblem }
  }
  const data = Buffer.from(canonicalizeForSigning(info), 'utf8')
  const seen = new Set()
  for (const publicKey of publicKeys) {
    const key = typeof publicKey === 'string' ? parsePublicKey(publicKey) : publicKey
    const keyId = computeUpdateManifestKeyId(key)
    if (seen.has(keyId)) {
      continue
    }
    seen.add(keyId)
    const tagged = candidates.filter((it) => it.keyId === keyId)
    const untagged = candidates.filter((it) => it.keyId == null)
    for (const candidate of [...tagged, ...untagged]) {
      if (verifySignatureBytes(data, key, candidate.signature)) {
        return { ok: true, keyId }
      }
    }
  }
  return { ok: false }
}

// ---------- Mietfuchs ----------

/**
 * Der Eintrag für `signatures` in latest.yml, wie electron-builder 27 ihn schreibt (createManifestSignatureEntry). Wirft,
 * wenn die Beschreibung nicht die Gestalt hat, die der Prüfer verlangt: Was er ablehnte, wird gar nicht erst signiert.
 * @param {Manifest} info
 * @param {import('node:crypto').KeyObject} privateKey
 * @returns {{ keyId: string, signature: string }}
 */
export function signManifest(info, privateKey) {
  const problem = validateSignedManifestShape(info)
  if (problem != null) throw new Error(`latest.yml lässt sich so nicht signieren: ${problem}`)
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error(`Der Schlüssel muss Ed25519 sein, nicht ${privateKey.asymmetricKeyType}.`)
  const signature = cryptoSign(null, Buffer.from(canonicalizeForSigning(info), 'utf8'), privateKey).toString('base64')
  return { keyId: computeUpdateManifestKeyId(privateKey), signature }
}
