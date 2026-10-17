// Hochgeladene ZIP-Archive lesen, mit yauzl und mit allen Grenzen an einer Stelle.
//
// **Erst das Verzeichnis, dann die Daten.** `openZip` liest nur das Verzeichnis am Ende des
// Archivs und prüft dort, was sich prüfen lässt, ohne einen Eintrag auszupacken: wie viele
// Einträge es ankündigt (aus dem Ende des Archivs, bevor der erste gelesen ist), wie groß jeder
// ausgepackt wäre, wie groß alle zusammen, wie dicht gepackt und wie sie heißen. Erst danach
// entscheidet der Aufrufer, was er auspackt, und `read` oder `extract` tun es als Strom.
//
// **Beim Auspacken wird noch einmal gezählt**, denn die Größen im Verzeichnis sind Angaben des
// Archivs und keine Tatsachen. yauzl bricht ab, sobald ein Eintrag mehr hergibt als angekündigt
// (`validateEntrySizes`), und die Prüfsumme rechnet dieses Modul selbst nach, weil yauzl das nicht
// tut. Ein Eintrag, der beides nicht besteht, heißt „beschädigt“.
//
// **Namen** liest dieses Modul selbst und nicht yauzl, und zwar wie adm-zip, das Mietfuchs bis
// 0.11 benutzte: Ohne UTF-8-Kennzeichen liest die Norm einen Namen als CP437, adm-zip aber immer
// als UTF-8. Viele Packprogramme schreiben UTF-8 ohne Kennzeichen; wer sein Backup ausgepackt
// und neu gepackt hat, bekäme nach der Norm „M├╝ll.pdf“ statt „Müll.pdf“ zurück, und die
// Kostenposition verlöre still ihren Beleg. Deshalb: mit Kennzeichen oder Unicode-Feld wie yauzl,
// sonst UTF-8, wenn die Bytes gültiges UTF-8 sind, und nur sonst CP437. Danach wird
// zusammengesetzt (NFC), wie der Server Namen beim Hochladen ablegt (zerlegte Umlaute kommen
// von macOS). Geprüft wird dann mit yauzls eigener Regel (kein absoluter Pfad, kein „..“, kein
// Laufwerksbuchstabe, kein Gegenschrägstrich). Ein solcher Name lehnt das ganze Archiv ab, nicht
// nur den Eintrag: Ein Archiv mit so einem Namen hat kein Programm geschrieben, das wir kennen.
//
// Die Meldungen sind deutsch und sagen, was los ist; was der Nutzer tun soll, hängt der Aufrufer
// an, denn das ist beim Backup etwas anderes als beim Kontoauszug.

import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Transform, type TransformCallback } from 'node:stream'
import zlib from 'node:zlib'
import yauzl from 'yauzl'

export type ZipLimits = {
  // Einträge, wie das Ende des Archivs sie ankündigt, Ordner und Beiwerk eingeschlossen.
  maxEntries: number
  // Ausgepackte Größe je Eintrag und aller zusammen.
  maxEntryBytes: number
  maxTotalBytes: number
  // Packdichte: Ein Eintrag, der ausgepackt über `ratioAbove` Bytes hätte, darf höchstens
  // `maxRatio`-mal so groß sein wie gepackt; ebenso alle zusammen.
  maxRatio: number
  ratioAbove: number
  // Länge eines Namens in Bytes (UTF-8).
  maxNameBytes: number
}

export type ZipRefusalKind = 'not-zip' | 'entries' | 'entry-size' | 'total' | 'ratio' | 'name' | 'damaged'

export class ZipRefusal extends Error {
  kind: ZipRefusalKind
  constructor(kind: ZipRefusalKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export type ZipItem = {
  name: string
  size: number
  compressedSize: number
  isDirectory: boolean
  // Aus dem Archiv: die genaue Zeit, wenn es eine führt (yazl schreibt sie), sonst die
  // DOS-Zeit in der Ortszeit dieses Rechners, wie adm-zip sie liest.
  time: Date
}

export type ZipReader = {
  items: ZipItem[]
  // Einen Eintrag in den Speicher, höchstens `maxBytes` (nach der Angabe im Verzeichnis).
  read(item: ZipItem, maxBytes: number): Promise<Buffer>
  // Einen Eintrag als Strom in eine Datei, die Zeit des Eintrags als Änderungszeit.
  extract(item: ZipItem, target: string): Promise<void>
  close(): void
}

const de = (n: number) => n.toLocaleString('de-DE')
const MB = (bytes: number) => `${de(Math.round(bytes / 1024 / 1024))} MB`

// `decodeStrings: false`: Die Namen liest `decodeName` (siehe oben); `strictFileNames` wirkt dann
// nicht, der Gegenschrägstrich fällt in `validateFileName`.
const OPTIONS: yauzl.Options = { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true }

const UTF8 = new TextDecoder('utf-8', { fatal: true })

function decodeName(entry: yauzl.Entry): string {
  const raw = entry.fileNameRaw
  const flagged = (entry.generalPurposeBitFlag & 0x800) !== 0 || entry.extraFields.some((f) => f.id === 0x7075)
  let name: string | null = null
  if (!flagged) {
    try {
      name = UTF8.decode(raw)
    } catch { /* kein UTF-8, also CP437 nach der Norm */ }
  }
  name ??= yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, raw, entry.extraFields, true)
  return name.normalize('NFC')
}

// Node hat zlib.crc32 seit 22.2, Bun ebenfalls; die Tabelle ist die Rückfallebene.
const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32: (data: Buffer, value?: number) => number = typeof zlib.crc32 === 'function'
  ? (data, value = 0) => zlib.crc32(data, value)
  : (data, value = 0) => {
    let c = ~value
    for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
    return ~c >>> 0
  }

// Fehler, die yauzl beim Lesen des Verzeichnisses meldet, sortiert: ein verbotener Name oder ein
// kaputtes Archiv.
const NAME_PROBLEM = /invalid relative path|absolute path|invalid characters in fileName|backslash/i // yauzl, falls es doch selbst prüft

function nameRefusal(detail: string): ZipRefusal {
  return new ZipRefusal('name', `Das Archiv enthält einen ungültigen Eintrag („${detail}“).`)
}

async function openRaw(source: string | Buffer): Promise<yauzl.ZipFile> {
  try {
    return typeof source === 'string' ? await yauzl.openPromise(source, OPTIONS) : await yauzl.fromBufferPromise(source, OPTIONS)
  } catch {
    throw new ZipRefusal('not-zip', 'Die Datei ist kein gültiges ZIP-Archiv.')
  }
}

export async function openZip(source: string | Buffer, limits: ZipLimits): Promise<ZipReader> {
  const zipfile = await openRaw(source)
  const entries = new Map<ZipItem, yauzl.Entry>()
  try {
    // Gezählt wird am Ende des Archivs, bevor der erste Eintrag gelesen ist.
    if (zipfile.entryCount > limits.maxEntries) {
      throw new ZipRefusal('entries', `Das Archiv enthält mehr als ${de(limits.maxEntries)} Einträge.`)
    }
    let total = 0
    let packed = 0
    for (;;) {
      let entry: yauzl.Entry | null
      try {
        entry = await nextEntry(zipfile)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (NAME_PROBLEM.test(message)) throw nameRefusal(message.replace(/^[^:]*:\s*/, ''))
        throw new ZipRefusal('not-zip', 'Die Datei ist kein gültiges ZIP-Archiv.')
      }
      if (!entry) break
      const name = decodeName(entry)
      const invalid = yauzl.validateFileName(name)
      if (invalid) throw nameRefusal(name)
      if (Buffer.byteLength(name) > limits.maxNameBytes || name.includes('\0')) throw nameRefusal(`${name.slice(0, 60)}…`)
      if (entry.isEncrypted()) throw new ZipRefusal('damaged', `Der Eintrag „${name}“ ist verschlüsselt und lässt sich nicht lesen.`)
      const size = entry.uncompressedSize
      if (size > limits.maxEntryBytes) {
        throw new ZipRefusal('entry-size', `Der Eintrag „${name}“ wäre ausgepackt zu groß (über ${MB(limits.maxEntryBytes)}).`)
      }
      if (size > limits.ratioAbove && size > limits.maxRatio * Math.max(entry.compressedSize, 1)) {
        throw new ZipRefusal('ratio', `Der Eintrag „${name}“ würde sich auf ein Vielfaches seiner Größe im Archiv auspacken, wie es bei keinem Beleg vorkommt.`)
      }
      total += size
      packed += entry.compressedSize
      if (total > limits.maxTotalBytes) {
        throw new ZipRefusal('total', `Das Archiv wäre ausgepackt zu groß (über ${MB(limits.maxTotalBytes)}).`)
      }
      const item: ZipItem = { name, size, compressedSize: entry.compressedSize, isDirectory: name.endsWith('/'), time: entry.getLastModDate() }
      entries.set(item, entry)
    }
    if (total > limits.ratioAbove && total > limits.maxRatio * Math.max(packed, 1)) {
      throw new ZipRefusal('ratio', 'Das Archiv würde sich auf ein Vielfaches seiner Größe auspacken, wie es bei keinem Backup vorkommt.')
    }
  } catch (err) {
    zipfile.close()
    throw err
  }

  const entryOf = (item: ZipItem): yauzl.Entry => {
    const entry = entries.get(item)
    if (!entry) throw new Error(`Eintrag ${item.name} gehört nicht zu diesem Archiv`)
    return entry
  }

  // Der Strom eines Eintrags, mit nachgerechneter Prüfsumme. Jeder Fehler beim Lesen heißt
  // „beschädigt“: Mehr als angekündigt, weniger als angekündigt, falsche Prüfsumme oder
  // ungültige Kompression sehen für den Nutzer gleich aus.
  async function stream(item: ZipItem): Promise<NodeJS.ReadableStream> {
    const entry = entryOf(item)
    let raw
    try {
      raw = await zipfile.openReadStreamPromise(entry)
    } catch {
      throw damaged(item)
    }
    let crc = 0
    const check = new Transform({
      transform(chunk: Buffer, _enc, cb: TransformCallback) {
        crc = crc32(chunk, crc)
        cb(null, chunk)
      },
      flush(cb: TransformCallback) {
        cb((crc >>> 0) === (entry.crc32 >>> 0) ? null : damaged(item))
      },
    })
    raw.on('error', (err) => check.destroy(err))
    return raw.pipe(check)
  }

  return {
    items: [...entries.keys()],
    async read(item, maxBytes) {
      if (item.size > maxBytes) throw new ZipRefusal('entry-size', `Der Eintrag „${item.name}“ ist zu groß (über ${MB(maxBytes)}).`)
      const parts: Buffer[] = []
      try {
        for await (const chunk of await stream(item)) parts.push(chunk as Buffer)
      } catch (err) {
        throw err instanceof ZipRefusal ? err : damaged(item)
      }
      return Buffer.concat(parts)
    },
    async extract(item, target) {
      try {
        await pipeline(await stream(item), fs.createWriteStream(target, { flags: 'wx' }))
      } catch (err) {
        fs.rmSync(target, { force: true })
        if (err instanceof ZipRefusal) throw err
        // Ein Fehler beim Schreiben (Platte voll, keine Rechte) ist kein kaputtes Archiv.
        if (err && typeof err === 'object' && 'syscall' in err) throw err
        throw damaged(item)
      }
      // Das Datum ist eine Auskunft: Scheitert es (etwa auf einem Netzlaufwerk), bleibt die Datei.
      try {
        fs.utimesSync(target, item.time, item.time)
      } catch { /* Datum bleibt das von heute */ }
    },
    close() {
      zipfile.close()
    },
  }
}

function damaged(item: ZipItem): ZipRefusal {
  return new ZipRefusal('damaged', `Das Archiv ist beschädigt: Der Eintrag „${item.name}“ lässt sich nicht fehlerfrei auspacken.`)
}

function nextEntry(zipfile: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zipfile.off('entry', onEntry)
      zipfile.off('end', onEnd)
      zipfile.off('error', onError)
    }
    const onEntry = (entry: yauzl.Entry) => { cleanup(); resolve(entry) }
    const onEnd = () => { cleanup(); resolve(null) }
    const onError = (err: Error) => { cleanup(); reject(err) }
    zipfile.on('entry', onEntry)
    zipfile.on('end', onEnd)
    zipfile.on('error', onError)
    zipfile.readEntry()
  })
}
