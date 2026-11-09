// HTTPS auf demselben Port (#528, Schritt 2): Schlüssel und selbst ausgestelltes Zertifikat im Datenordner unter
// `tls/`. Das Programmfenster koppelt sich an den Fingerabdruck (`certSha256`), nicht an eine Kette; deshalb genügt ein
// eigenes Zertifikat, und es gilt 30 Jahre (das Fenster prüft die Laufzeit nicht).
//
// - **Erzeugt beim ersten Start** ohne eins, auch lokal lauschend (25 ms, eine Regel statt zwei): ECDSA P-256 mit
//   SHA-256 und CN „Mietfuchs“ über `selfsigned`, denn Node stellt selbst keine Zertifikate aus. Vor dem Binden des
//   Ports wird nur gelesen (`readCertificate`), erzeugt erst danach (`ensureCertificate`, siehe index.ts).
// - **Wie `zugang.json`** nie in der Datenbank: nicht im Backup, nicht in Vorversionen, nicht im Umzug. Nach dem
//   Wiederherstellen auf einem neuen Rechner entsteht ein neues Zertifikat, gekoppelte Fenster koppeln neu.
// - Schlüssel 0600, beide Dateien über Zwischendatei und Umbenennen. Ist eine Datei unlesbar oder gehören Schlüssel und
//   Zertifikat nicht zusammen (Absturz zwischen beiden), entsteht ein neues Paar.
// - **Nie ein Abbruch**: Lässt sich nichts anlegen, kommt ein Satz zurück, und der Server läuft nur über HTTP.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { generate } from 'selfsigned'

export const TLS_DIR = 'tls'
const KEY_FILE = 'mietfuchs.key'
const CERT_FILE = 'mietfuchs.crt'
const VALID_YEARS = 30

export type Certificate = { key: string, cert: string, certSha256: string }

// SHA-256 des DER, klein in Hex: so vergleicht das Fenster das Zertifikat beim Koppeln
export const certSha256 = (certPem: string): string => crypto.createHash('sha256').update(new crypto.X509Certificate(certPem).raw).digest('hex')

// Ein vorhandenes Paar, wenn beide Dateien lesbar sind und zusammengehören, sonst null
function readPair(keyFile: string, certFile: string): Certificate | null {
  try {
    const key = fs.readFileSync(keyFile, 'utf8')
    const cert = fs.readFileSync(certFile, 'utf8')
    if (!new crypto.X509Certificate(cert).checkPrivateKey(crypto.createPrivateKey(key))) return null
    return { key, cert, certSha256: certSha256(cert) }
  } catch {
    return null
  }
}

// Die Zwischendatei trägt die Prozessnummer: Zwei gleichzeitige erste Starts (Doppelklick) schreiben nicht in dieselbe
function writeReplacing(file: string, content: string, mode: number): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode })
  fs.renameSync(tmp, file)
  try {
    fs.chmodSync(file, mode)
  } catch {
    // Windows kennt keine Unix-Rechte
  }
}

// Nur lesen, nichts anlegen: vor dem Binden des Ports, denn ein zweiter Start auf belegtem Port rührt den Datenordner
// nicht an (#244), und ein umgezogener Ordner wird nur gelesen (#517)
export function readCertificate(dataDir: string): Certificate | null {
  const dir = path.join(dataDir, TLS_DIR)
  return readPair(path.join(dir, KEY_FILE), path.join(dir, CERT_FILE))
}

export async function ensureCertificate(dataDir: string, now: Date = new Date()): Promise<Certificate | { problem: string }> {
  const dir = path.join(dataDir, TLS_DIR)
  const keyFile = path.join(dir, KEY_FILE)
  const certFile = path.join(dir, CERT_FILE)
  const existing = readPair(keyFile, certFile)
  if (existing) return existing
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const notAfterDate = new Date(now)
    notAfterDate.setUTCFullYear(notAfterDate.getUTCFullYear() + VALID_YEARS)
    const pems = await generate([{ name: 'commonName', value: 'Mietfuchs' }], { keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notAfterDate })
    // Erst der Schlüssel: Bricht es dazwischen ab, passt das alte Zertifikat nicht, und der nächste Start erzeugt neu
    writeReplacing(keyFile, pems.private, 0o600)
    writeReplacing(certFile, pems.cert, 0o644)
    return { key: pems.private, cert: pems.cert, certSha256: certSha256(pems.cert) }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { problem: `Das Zertifikat ließ sich in ${dir} nicht anlegen (${reason}).` }
  }
}
