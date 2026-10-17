// ZIP-Archive von Hand, für Tests, die ein präpariertes Archiv brauchen: eine Größe im Verzeichnis,
// die nicht stimmt, Zehntausende Einträge, ein Name, den kein Packprogramm schriebe. adm-zip und
// yazl bereinigen oder berechnen all das selbst und taugen dafür nicht.

import zlib from 'node:zlib'

export type CraftEntry = {
  name: string
  // Die Daten, so wie sie im Archiv stehen (bei `deflate` also schon gepackt).
  stored: Buffer
  method?: 0 | 8
  // Angaben im Verzeichnis; ohne Angabe die echten Werte.
  uncompressedSize?: number
  crc?: number
  // Bit 11: Name in UTF-8. Ohne Angabe gesetzt. Der Name steht trotzdem als UTF-8 im Archiv,
  // wie ältere Packprogramme ihn ohne Kennzeichen schreiben, außer `rawName` gibt die Bytes vor.
  utf8?: boolean
  rawName?: Buffer
}

// Ein Eintrag mit `size` Nullbytes, gepackt, ohne sie je am Stück im Speicher zu halten. So
// entsteht aus wenigen Megabyte ein Eintrag von Gigabytes, wie in einer Entpackbombe.
export async function zeroEntry(name: string, size: number, declaredSize = size): Promise<CraftEntry> {
  const chunk = Buffer.alloc(Math.min(size, 1024 * 1024))
  const deflate = zlib.createDeflateRaw({ level: 9 })
  const parts: Buffer[] = []
  deflate.on('data', (d: Buffer) => parts.push(d))
  const done = new Promise<void>((resolve, reject) => { deflate.on('end', resolve); deflate.on('error', reject) })
  let crc = 0
  for (let left = size; left > 0; left -= chunk.length) {
    const piece = left >= chunk.length ? chunk : chunk.subarray(0, left)
    crc = zlib.crc32(piece, crc)
    if (!deflate.write(piece)) await new Promise((resolve) => deflate.once('drain', resolve))
  }
  deflate.end()
  await done
  return { name, stored: Buffer.concat(parts), method: 8, uncompressedSize: declaredSize, crc }
}

export function storedEntry(name: string, data: Buffer | string): CraftEntry {
  return { name, stored: Buffer.from(data), method: 0 }
}

export function craftZip(entries: CraftEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const n = e.rawName ?? Buffer.from(e.name, 'utf8')
    const method = e.method ?? 0
    const size = e.uncompressedSize ?? (method === 0 ? e.stored.length : 0)
    const crc = e.crc ?? (method === 0 ? zlib.crc32(e.stored) : 0)
    const flags = e.utf8 === false ? 0 : 0x0800
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(e.stored.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(n.length, 26)
    locals.push(local, n, e.stored)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(e.stored.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, n)
    offset += 30 + n.length + e.stored.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Math.min(entries.length, 0xffff), 8)
  end.writeUInt16LE(Math.min(entries.length, 0xffff), 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// Die Hülle eines Archivs, das im ZIP64-Ende `count` Einträge ankündigt, ohne sie zu enthalten.
// Ein Leser, der erst zählt, lehnt es ab, bevor er einen Eintrag sucht.
export function zip64Claim(count: number): Buffer {
  const end64 = Buffer.alloc(56)
  end64.writeUInt32LE(0x06064b50, 0)
  end64.writeBigUInt64LE(44n, 4)
  end64.writeUInt16LE(45, 12)
  end64.writeUInt16LE(45, 14)
  end64.writeBigUInt64LE(BigInt(count), 24)
  end64.writeBigUInt64LE(BigInt(count), 32)
  end64.writeBigUInt64LE(0n, 40) // Größe des Verzeichnisses
  end64.writeBigUInt64LE(0n, 48) // Beginn des Verzeichnisses
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeBigUInt64LE(0n, 8) // das ZIP64-Ende steht am Anfang
  locator.writeUInt32LE(1, 16)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0xffff, 8)
  end.writeUInt16LE(0xffff, 10)
  end.writeUInt32LE(0xffffffff, 12)
  end.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([end64, locator, end])
}
