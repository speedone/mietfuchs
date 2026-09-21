// Die Datenbank öffnen, mit allem, was beim Start geprüft werden muss (#55).
//
// Geprüft wird hier das Öffnen selbst: der Datenordner, die Fremdschlüssel, die Unversehrtheit
// der Datei, eine Datei aus einer neueren Version, der Hinweis auf ein Netzlaufwerk und die
// Reihung der Schreibvorgänge. Dass der Server sie beim Start wirklich öffnet, prüft
// api.test.ts gegen den laufenden Prozess.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { connect } from '../src/db/client.ts'
import { createWriteQueue, databaseFile, integrityProblem, networkLocation, openDatabase } from '../src/db/open.ts'
import { readings, units } from '../src/db/schema.ts'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-db-'))

// Gibt die Kontrolle ab, so wie es jede Anweisung einer Transaktion mit asynchronem Rumpf tut.
const yieldControl = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

const unit = (id: string) => ({ id, name: id, areaM2: 50, participates: true })

// Drizzle verpackt jeden Fehler von SQLite in einen eigenen („Failed query: …“) und hängt den
// echten Grund als `cause` daran. Wer nur die oberste Meldung liest, erfährt nie, woran es lag.
const reasons = (err: unknown): string => {
  const texte: string[] = []
  let current: unknown = err
  while (current instanceof Error) {
    texte.push(current.message)
    current = current.cause
  }
  return texte.join(' | ')
}

test('die Datenbank entsteht neben den Daten, und die Migrationen laufen genau einmal', async () => {
  const dataDir = tempDir()
  try {
    const erste = await openDatabase({ dataDir })
    assert.equal(erste.file, databaseFile(dataDir))
    assert.ok(fs.existsSync(erste.file), 'die Datei liegt im Datenordner')
    assert.ok(erste.migrations >= 1, 'beim ersten Start laufen die Migrationen')
    erste.close()

    const zweite = await openDatabase({ dataDir })
    assert.equal(zweite.migrations, 0, 'beim zweiten Start ist nichts mehr nachzuholen')
    zweite.close()
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('ein Datenordner ohne Schreibrecht wird benannt, bevor irgendetwas geöffnet wird', async () => {
  // Der Schreibtest wird hineingereicht: Ein wirklich gesperrter Ordner ließe sich unter
  // Windows nicht herstellen, und die Meldung soll auf jedem System dieselbe sein.
  const dataDir = tempDir()
  try {
    await assert.rejects(
      () => openDatabase({ dataDir, canWrite: () => false }),
      (err: unknown) => {
        const text = String(err)
        assert.match(text, /NKA_DATA_DIR/, 'die Meldung nennt den Ausweg')
        assert.ok(text.includes(dataDir), 'die Meldung nennt den Ordner')
        return true
      },
    )
    assert.equal(fs.existsSync(databaseFile(dataDir)), false, 'es wurde nichts angelegt')
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('eine Ablesung ohne Zähler wird abgelehnt: die Fremdschlüssel gelten wirklich', async () => {
  // In SQLite ist diese Prüfung je Verbindung standardmäßig aus. Ohne das Pragma beim Öffnen
  // wären alle Verweise im Schema Zierde, und eine Ablesung ohne Zähler bliebe als verwaister
  // Datensatz liegen, der in keiner Abrechnung mehr auftaucht.
  const dataDir = tempDir()
  try {
    const opened = await openDatabase({ dataDir })
    try {
      await assert.rejects(
        () =>
          opened.db
            .insert(readings)
            .values({ id: 'r1', meterId: 'diesen-zaehler-gibt-es-nicht', date: '2024-06-30', value: 42, replacement: false }),
        (err: unknown) => {
          assert.match(reasons(err), /FOREIGN KEY/i)
          return true
        },
      )
      const gespeichert = await opened.db.select({ id: readings.id }).from(readings)
      assert.deepEqual(gespeichert, [], 'nichts davon ist gespeichert')
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('eine beschädigte Datenbankdatei wird nicht geöffnet und nicht angefasst', async () => {
  const dataDir = tempDir()
  try {
    const opened = await openDatabase({ dataDir })
    opened.close()
    const file = databaseFile(dataDir)
    // Eine Seite mitten in der Datei zerschießen, wie es ein Stromausfall oder ein
    // Netzlaufwerk hinterlässt. SQLite meldet das als „database disk image is malformed“.
    const kaputt = fs.readFileSync(file)
    kaputt.fill(0x5a, 4096, 8192)
    fs.writeFileSync(file, kaputt)

    await assert.rejects(
      () => openDatabase({ dataDir }),
      (err: unknown) => {
        const text = String(err)
        assert.match(text, /beschädigt/, 'die Meldung sagt, was los ist')
        assert.match(text, /Backup/, 'die Meldung sagt, was zu tun ist')
        // Die Meldung von SQLite steht am Ende und benannt, nicht anstelle einer Erklärung:
        // „database disk image is malformed“ allein hilft niemandem weiter.
        assert.match(text, /Technischer Befund:/, 'die Meldung von SQLite ist eingeordnet')
        return true
      },
    )
    assert.deepEqual(fs.readFileSync(file), kaputt, 'die Datei ist unverändert geblieben')
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('der Befund der Unversehrtheitsprüfung wird gelesen, nicht nur ihr Gelingen', () => {
  // SQLite antwortet mit genau einer Zeile „ok“ oder mit einer Zeile je Befund. Eine
  // beschädigte Datei kann beides: werfen (siehe oben) oder Befunde aufzählen.
  assert.equal(integrityProblem([['ok']]), null)
  assert.match(String(integrityProblem([['row 3 missing from index xy']])), /row 3 missing/)
  const viele = integrityProblem([['eins'], ['zwei'], ['drei'], ['vier']])
  assert.match(String(viele), /eins/)
  assert.match(String(viele), /weitere/, 'lange Listen werden gekürzt, aber die Zahl steht da')
  // Gar keine Antwort ist kein „in Ordnung“.
  assert.notEqual(integrityProblem([]), null)
})

test('eine Datei aus einer neueren Mietfuchs-Version wird erklärt, nicht migriert', async () => {
  const dataDir = tempDir()
  try {
    // Eine Datenbank, die nur die Buchführung kennt, und darin ein Schritt, den diese Version
    // nicht hat. Genau das findet vor, wer nach einer neueren Fassung wieder eine ältere
    // startet.
    const file = databaseFile(dataDir)
    fs.mkdirSync(dataDir, { recursive: true })
    const vorbereiten = await connect(file)
    vorbereiten.exec('CREATE TABLE __drizzle_migrations (id integer PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)')
    vorbereiten.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('ein-schritt-aus-der-zukunft', 4102444800000)")
    vorbereiten.close()

    await assert.rejects(
      () => openDatabase({ dataDir }),
      (err: unknown) => {
        const text = String(err)
        assert.match(text, /stammt aus einer neueren Mietfuchs-Version/, 'die Meldung sagt, was los ist')
        assert.match(text, /neuere Fassung/, 'die Meldung sagt, was zu tun ist')
        assert.match(text, /01\.01\.2100/, 'sie nennt den Stand, den sie nicht kennt')
        return true
      },
    )

    const nachher = await connect(file)
    const tabellen = nachher.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row[0]))
    nachher.close()
    assert.deepEqual(tabellen, ['__drizzle_migrations', 'sqlite_sequence'], 'keine einzige Tabelle wurde angelegt')
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('ein Netzlaufwerk wird erkannt und benannt', () => {
  // Unter Linux steht in /proc/self/mounts, welcher Ordner über welches Dateisystem eingebunden
  // ist. Maßgeblich ist der längste passende Einhängepunkt, sonst gewinnt immer „/“.
  const mounts = [
    '/dev/sda1 / ext4 rw,relatime 0 0',
    '//nas/daten /mnt/nas cifs rw,relatime 0 0',
    'nas:/export /mnt/nfs nfs4 rw 0 0',
    '/dev/sdb1 /mnt/nas/lokal ext4 rw 0 0',
  ].join('\n')
  const linux = (file: string) => networkLocation(file, { platform: 'linux', mounts: () => mounts })
  assert.match(String(linux('/mnt/nas/mietfuchs.sqlite')), /cifs/)
  assert.match(String(linux('/mnt/nfs/daten/mietfuchs.sqlite')), /nfs4/)
  assert.equal(linux('/home/erika/daten/mietfuchs.sqlite'), null)
  // Der längere Einhängepunkt gewinnt: Unterhalb des Netzordners liegt eine lokale Platte.
  assert.equal(linux('/mnt/nas/lokal/mietfuchs.sqlite'), null)
  // Ein Einhängepunkt darf nicht als Zeichenkettenanfang zählen: /mnt/nase ist nicht /mnt/nas.
  assert.equal(linux('/mnt/nase/mietfuchs.sqlite'), null)

  const windows = (file: string) => networkLocation(file, { platform: 'win32', mounts: () => null })
  assert.match(String(windows('\\\\nas\\daten\\mietfuchs.sqlite')), /\\\\nas\\daten/)
  assert.match(String(windows('\\\\?\\UNC\\nas\\daten\\mietfuchs.sqlite')), /\\\\nas\\daten/)
  assert.equal(windows('C:\\Users\\Erika\\Mietfuchs\\mietfuchs.sqlite'), null)
  assert.equal(windows('\\\\?\\C:\\Users\\Erika\\mietfuchs.sqlite'), null)

  // macOS lässt sich ohne fremdes Programm nicht befragen; dort gibt es keinen Hinweis.
  assert.equal(networkLocation('/Volumes/nas/mietfuchs.sqlite', { platform: 'darwin', mounts: () => null }), null)
})

test('ein Netzlaufwerk ist eine Warnung und kein Abbruch', async () => {
  const dataDir = tempDir()
  try {
    const opened = await openDatabase({
      dataDir,
      platform: 'linux',
      mounts: () => `//nas/daten ${dataDir.split(path.sep).join('/')} cifs rw 0 0`,
    })
    try {
      assert.equal(opened.warnings.length, 1, 'geöffnet wird trotzdem')
      assert.match(opened.warnings[0], /Netz/)
      assert.match(opened.warnings[0], /NKA_DATA_DIR/, 'die Warnung sagt, wie man es anders macht')
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

// ---------- Die Reihung der Schreibvorgänge ----------

test('zwei überlappende Transaktionen gehen beide durch', async () => {
  // Das ist der Fall, den Express von selbst herbeiführt: Zwei Anfragen kommen kurz
  // hintereinander, und weil eine Transaktion mit asynchronem Rumpf zwischen ihren Anweisungen
  // die Kontrolle abgibt, beginnt die zweite mitten in der ersten.
  const dataDir = tempDir()
  try {
    const opened = await openDatabase({ dataDir })
    try {
      const schreiben = (name: string) =>
        opened.write((db) =>
          db.transaction(async (tx) => {
            await tx.insert(units).values(unit(`${name}-1`))
            await yieldControl()
            await tx.insert(units).values(unit(`${name}-2`))
          }),
        )
      await Promise.all([schreiben('a'), schreiben('b'), schreiben('c')])
      const ids = (await opened.db.select({ id: units.id }).from(units)).map((row) => row.id).sort()
      assert.deepEqual(ids, ['a-1', 'a-2', 'b-1', 'b-2', 'c-1', 'c-2'])
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('Gegenprobe: ohne die Reihung bricht die zweite Transaktion ab', async () => {
  // Diese Probe begründet die Reihung und ist zugleich ihr Wachposten: Sollte eine künftige
  // Fassung von Drizzle oder der Laufzeit zwei nebenläufige Transaktionen von sich aus
  // auseinanderhalten, wird dieser Test rot, und dann gehört die Reihung überdacht statt
  // blind mitgeschleppt.
  const dataDir = tempDir()
  try {
    const opened = await openDatabase({ dataDir })
    try {
      const ohneReihung = (name: string) =>
        opened.db.transaction(async (tx) => {
          await tx.insert(units).values(unit(`${name}-1`))
          await yieldControl()
          await tx.insert(units).values(unit(`${name}-2`))
        })
      const ausgang = await Promise.allSettled([ohneReihung('x'), ohneReihung('y')])
      const gescheitert = ausgang.filter((e) => e.status === 'rejected')
      assert.equal(gescheitert.length, 1, 'genau die zweite Transaktion scheitert')
    } finally {
      opened.close()
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})

test('ein gescheiterter Schreibvorgang reißt die folgenden nicht mit', async () => {
  const reihen = createWriteQueue()
  const ablauf: string[] = []
  const scheitern = reihen(async () => {
    ablauf.push('erster')
    throw new Error('geht schief')
  })
  const danach = reihen(async () => {
    ablauf.push('zweiter')
    return 'fertig'
  })
  await assert.rejects(() => scheitern, /geht schief/)
  assert.equal(await danach, 'fertig')
  assert.deepEqual(ablauf, ['erster', 'zweiter'])
})

test('die Reihung hält die Vorgänge wirklich auseinander', async () => {
  const reihen = createWriteQueue()
  const ablauf: string[] = []
  const arbeiten = async (name: string) => {
    ablauf.push(`${name} beginnt`)
    await yieldControl()
    ablauf.push(`${name} endet`)
  }
  await Promise.all([reihen(() => arbeiten('a')), reihen(() => arbeiten('b'))])
  assert.deepEqual(ablauf, ['a beginnt', 'a endet', 'b beginnt', 'b endet'])
})

test('ein Schreibvorgang im Schreibvorgang meldet sich, statt stillzustehen', async () => {
  // Er würde auf sich selbst warten: Die Schlange ist erst frei, wenn der äußere Vorgang fertig
  // ist, und der wartet auf den inneren. Ohne diese Meldung hinge die Anfrage für immer, und
  // niemand sähe, warum.
  const reihen = createWriteQueue()
  await assert.rejects(
    () => reihen(async () => reihen(async () => 'innen')),
    /Mietfuchs/,
  )
  // Und danach läuft die Schlange weiter.
  assert.equal(await reihen(async () => 'geht wieder'), 'geht wieder')
})
