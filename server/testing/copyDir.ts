// Einen Datenordner kopieren, in dem ein anderer Prozess noch kurzlebige Dateien anlegt und löscht
// (scripts/fenster-umzug-praxislauf.mjs, #517).
//
// **Warum.** Eine alte Fassung löscht ihren Schnappschuss fürs Backup (`mietfuchs.sqlite.<id>.backup`) erst im
// `finally` der Route, also nachdem der Aufrufer die Antwort schon ganz gelesen hat. Gemessen lagen Löschen und
// Beginn der Kopie weniger als eine Zehntelmillisekunde auseinander. Listet `fs.cpSync` die Datei noch und findet
// sie beim Kopieren nicht mehr, bricht es mit ENOENT ab und nennt dabei das Ziel, nicht die Datei.
//
// **Was es tut.** Bei ENOENT das halbe Ziel wegräumen, kurz warten und von vorn kopieren, höchstens `attempts`
// Mal. Welche Dateien verschwunden sind, steht im Ergebnis (Liste vor dem Versuch gegen danach). Jeder andere
// Fehler bricht sofort ab. Die Datenbank selbst schreibt in diesem Moment niemand: Die Kopie entsteht erst, wenn
// alle Anfragen an die alte Fassung beantwortet sind.

import fs from 'node:fs'

export type CopyDirOptions = {
  attempts?: number
  pauseMs?: number
  // Nur für Tests: an Stelle von `fs.cpSync`
  copy?: (src: string, dst: string) => void
}

export type CopyDirResult = { attempts: number, vanished: string[] }

const listing = (dir: string): string[] => fs.readdirSync(dir, { recursive: true }).map(String)

export async function copyDirRetrying(src: string, dst: string, options: CopyDirOptions = {}): Promise<CopyDirResult> {
  const attempts = options.attempts ?? 3
  const pauseMs = options.pauseMs ?? 200
  const copy = options.copy ?? ((from: string, to: string) => fs.cpSync(from, to, { recursive: true }))
  const vanished: string[] = []
  for (let attempt = 1; ; attempt++) {
    const before = listing(src)
    try {
      copy(src, dst)
      return { attempts: attempt, vanished }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      const after = new Set(listing(src))
      for (const name of before) if (!after.has(name) && !vanished.includes(name)) vanished.push(name)
      fs.rmSync(dst, { recursive: true, force: true })
      if (attempt >= attempts) {
        throw new Error(`${src} ließ sich in ${attempts} Versuchen nicht kopieren (verschwunden: ${vanished.join(', ') || 'unbekannt'}): ${(err as Error).message}`)
      }
      await new Promise((resolve) => setTimeout(resolve, pauseMs))
    }
  }
}
