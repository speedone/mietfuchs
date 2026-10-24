// Der Papierkorb für Dateien (#318, Schritt 5): nur eigene Dateien, nie Ordner, nie ein Pfad.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DESIGN_DIR_NAME } from '../src/letterDesign.ts'
import { cleanTrash, FILE_STORES, moveToTrash, restoreFromTrash, trashDir } from '../src/trash.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-trash-'))

test('Papierkorb: Die Ablage für Logo und Briefpapier heißt wie ihr Ordner', () => {
  assert.ok((FILE_STORES as readonly string[]).includes(DESIGN_DIR_NAME))
})

test('Papierkorb: verschieben und zurückholen, ein Pfad statt eines Namens bewegt nichts', () => {
  const dir = tmp()
  try {
    fs.mkdirSync(path.join(dir, 'uploads'))
    fs.writeFileSync(path.join(dir, 'uploads', 'a.pdf'), 'A')
    fs.writeFileSync(path.join(dir, 'geheim.txt'), 'G')
    moveToTrash(dir, 'uploads', 'a.pdf')
    moveToTrash(dir, 'uploads', '../geheim.txt')
    assert.ok(fs.existsSync(path.join(trashDir(dir, 'uploads'), 'a.pdf')))
    assert.ok(fs.existsSync(path.join(dir, 'geheim.txt')))
    assert.throws(() => restoreFromTrash(dir, 'uploads', '../geheim.txt'))
    restoreFromTrash(dir, 'uploads', 'a.pdf')
    assert.equal(fs.readFileSync(path.join(dir, 'uploads', 'a.pdf'), 'utf8'), 'A')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Papierkorb: Aufräumen nimmt nur Dateien, die keiner mehr braucht, und keine Ordner', () => {
  const dir = tmp()
  try {
    const t = trashDir(dir, 'uploads')
    fs.mkdirSync(path.join(t, 'ordner'), { recursive: true })
    fs.writeFileSync(path.join(t, 'weg.pdf'), 'x')
    fs.writeFileSync(path.join(t, 'bleibt.pdf'), 'x')
    fs.writeFileSync(path.join(dir, 'papierkorb', 'fremd.txt'), 'x')
    assert.equal(cleanTrash(dir, new Map([['uploads', new Set(['bleibt.pdf'])]])), 1)
    assert.deepEqual(fs.readdirSync(t).sort(), ['bleibt.pdf', 'ordner'])
    assert.ok(fs.existsSync(path.join(dir, 'papierkorb', 'fremd.txt')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
