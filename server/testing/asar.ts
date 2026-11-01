// Ein Archiv im Format von Electrons asar, für die Prüfungen des Programmfensters (#517) ohne electron-builder. Aufbau
// wie bei @electron/asar: ein Pickle mit der Länge des Kopfs, der Kopf als Pickle mit einer Zeichenkette (JSON), danach
// die Dateien hintereinander. Je Datei Größe, Versatz (als Zeichenkette) und auf Wunsch `unpacked` und `integrity`.
import fs from 'node:fs'

export type AsarEntry = { content?: string, unpacked?: boolean, integrity?: boolean }

type Node = { files: Record<string, Node> } | { size: number, offset?: string, unpacked?: boolean, integrity?: { algorithm: string, hash: string, blockSize: number, blocks: string[] } }

export function writeAsar(file: string, entries: Record<string, AsarEntry>): void {
  const root: { files: Record<string, Node> } = { files: {} }
  const contents: Buffer[] = []
  let offset = 0
  for (const [name, entry] of Object.entries(entries)) {
    const parts = name.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      const next = dir.files[part] ?? { files: {} }
      if (!('files' in next)) throw new Error(`${name}: ${part} ist eine Datei`)
      dir.files[part] = next
      dir = next
    }
    const data = Buffer.from(entry.content ?? '', 'utf8')
    const integrity = entry.integrity === false ? undefined : { algorithm: 'SHA256', hash: '0'.repeat(64), blockSize: 4194304, blocks: ['0'.repeat(64)] }
    if (entry.unpacked) {
      dir.files[parts.at(-1) as string] = { size: data.length, unpacked: true, ...(integrity ? { integrity } : {}) }
      continue
    }
    dir.files[parts.at(-1) as string] = { size: data.length, offset: String(offset), ...(integrity ? { integrity } : {}) }
    contents.push(data)
    offset += data.length
  }
  const json = Buffer.from(JSON.stringify(root), 'utf8')
  // Der Kopf als Pickle: Länge der Nutzlast, Länge der Zeichenkette, die Zeichenkette auf vier Byte aufgefüllt
  const padded = Math.ceil(json.length / 4) * 4
  const header = Buffer.alloc(8 + padded)
  header.writeUInt32LE(4 + padded, 0)
  header.writeUInt32LE(json.length, 4)
  json.copy(header, 8)
  const size = Buffer.alloc(8)
  size.writeUInt32LE(4, 0)
  size.writeUInt32LE(header.length, 4)
  fs.writeFileSync(file, Buffer.concat([size, header, ...contents]))
}
