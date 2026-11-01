// Das gebaute Frontend als eine Datei (#517), für das Programmfenster. Unter Windows bremst der Echtzeitschutz das
// Anlegen vieler kleiner Dateien beim Installieren stark, und client/dist sind rund 200 Dateien (vor allem die
// Zeichentabellen von pdf.js). scripts/package-desktop.mjs legt sie deshalb als client/dist.pack ab, und der Server im
// Bündel liefert sie daraus aus (server/src/index.ts). Unter Node, Docker und in der Programmdatei (Bun) bleibt alles,
// wie es ist.
//
// Aufbau: die Kennung MAGIC, die Länge des Verzeichnisses (4 Byte, little endian), das Verzeichnis als JSON
// (Adresse → [Versatz, Länge], der Versatz ab dem Ende des Verzeichnisses), danach die Dateien hintereinander.
import fs from 'node:fs'
import path from 'node:path'

const MAGIC = Buffer.from('MIETFUCHS-CLIENT-1\n', 'utf8')

type Index = Record<string, [number, number]>

export type ClientPack = {
  // Der Inhalt unter einer Adresse wie /index.html oder /assets/index-abc.js, sonst null
  read(urlPath: string): Buffer | null
  readonly size: number
}

function filesIn(dir: string, rel = ''): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...filesIn(dir, child))
    else if (entry.isFile()) files.push(child)
  }
  // Feste Reihenfolge, damit derselbe Ordner dieselbe Datei ergibt
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

// client/dist (oder einen anderen Ordner) in eine Datei schreiben; gibt die Zahl der Dateien zurück
export function writeClientPack(dir: string, outFile: string): number {
  const files = filesIn(dir)
  const index: Index = {}
  const contents: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = fs.readFileSync(path.join(dir, file))
    index[`/${file}`] = [offset, data.length]
    contents.push(data)
    offset += data.length
  }
  const header = Buffer.from(JSON.stringify(index), 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(header.length)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, Buffer.concat([MAGIC, length, header, ...contents]))
  return files.length
}

// Die Datei öffnen; liest nur das Verzeichnis, die Inhalte erst auf Anfrage
export function openClientPack(file: string): ClientPack {
  const fd = fs.openSync(file, 'r')
  let index: Index
  let dataStart: number
  try {
    const head = Buffer.alloc(MAGIC.length + 4)
    if (fs.readSync(fd, head, 0, head.length, 0) !== head.length || !head.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error(`${file} ist kein Frontend-Paket von Mietfuchs`)
    }
    const headerLength = head.readUInt32LE(MAGIC.length)
    const header = Buffer.alloc(headerLength)
    if (fs.readSync(fd, header, 0, headerLength, head.length) !== headerLength) throw new Error(`${file} ist unvollständig`)
    index = JSON.parse(header.toString('utf8')) as Index
    dataStart = head.length + headerLength
  } finally {
    fs.closeSync(fd)
  }
  const size = Object.keys(index).length
  return {
    size,
    read(urlPath) {
      const entry = Object.hasOwn(index, urlPath) ? index[urlPath] : undefined
      if (!entry) return null
      const [offset, length] = entry
      const data = Buffer.alloc(length)
      const handle = fs.openSync(file, 'r')
      try {
        if (fs.readSync(handle, data, 0, length, dataStart + offset) !== length) throw new Error(`${file} ist unvollständig`)
      } finally {
        fs.closeSync(handle)
      }
      return data
    },
  }
}
