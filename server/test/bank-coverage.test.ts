// „Konto lückenlos eingelesen“ (#188): coverageOf über die Importe eines Kontos, dazu die Erkennung eines Auszugs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { coverageOf } from '../src/bank/coverage.ts'
import { looksLikeBankFile } from '../src/bank/read.ts'
import { readMt940 } from '../src/bank/mt940.ts'
import type { BankImport } from '../src/bank/model.ts'

const imp = (fromDate: string, toDate: string, opening: number | null, closing: number | null): BankImport => ({
  id: `${fromDate}`, accountId: 'a', fileSha256: fromDate, fileName: 'x.xml', format: 'camt.053', statementId: null,
  fromDate, toDate, openingBalanceCents: opening, closingBalanceCents: closing, importedAt: '2025-07-01T00:00:00Z', fingerprintVersion: 1,
})

test('coverageOf: anschließende Auszüge ergeben einen Zeitraum', () => {
  assert.deepEqual(coverageOf([imp('2025-02-01', '2025-02-28', 500, 700), imp('2025-01-01', '2025-01-31', 100, 500), imp('2025-03-01', '2025-03-31', 700, 900)]), { from: '2025-01-01', to: '2025-03-31' })
  assert.deepEqual(coverageOf([imp('2025-01-01', '2025-01-31', 100, 500)]), { from: '2025-01-01', to: '2025-01-31' })
})

test('coverageOf: ein fehlender Tag ist eine Lücke, die jüngste zählt', () => {
  assert.deepEqual(coverageOf([imp('2025-01-01', '2025-01-31', 100, 500), imp('2025-02-02', '2025-02-28', 500, 700)]), { gapAfter: '2025-01-31', gapBefore: '2025-02-02' })
})

test('coverageOf: Salden, die nicht anschließen, sind eine Lücke', () => {
  assert.deepEqual(coverageOf([imp('2025-01-01', '2025-01-31', 100, 500), imp('2025-02-01', '2025-02-28', 501, 700)]), { gapAfter: '2025-01-31', gapBefore: '2025-02-01' })
})

test('coverageOf: MT940 schließt an, gleich ob die Bank :60F: auf den Vortag oder den ersten Tag datiert (#644, Durchsicht)', () => {
  const chain = (...statements: string[][]) => coverageOf(readMt940(statements.flatMap((s) => [':20:STARTUMSE', ':25:DE00123456789012345678', ...s, '-']).join('\n')).statements.map((s) => {
    if (!s.fromDate || !s.toDate) assert.fail('Zeitraum erwartet')
    return imp(s.fromDate, s.toDate, s.openingBalanceCents, s.closingBalanceCents)
  }))
  // :60F: auf den Vortag (28.02.)
  assert.deepEqual(chain([':60F:C250131EUR0,00', ':61:2502030203C1,00NTRFNONREF', ':62F:C250228EUR1,00'], [':60F:C250228EUR1,00', ':61:2503030303C1,00NTRFNONREF', ':62F:C250310EUR2,00']),
    { from: '2025-01-31', to: '2025-03-10' })
  // :60F: auf den ersten Tag des Auszugs (01.03.), an dem nichts gebucht ist
  assert.deepEqual(chain([':60F:C250201EUR0,00', ':61:2502030203C1,00NTRFNONREF', ':62F:C250228EUR1,00'], [':60F:C250301EUR1,00', ':61:2503030303C1,00NTRFNONREF', ':62F:C250310EUR2,00']),
    { from: '2025-02-01', to: '2025-03-10' })
})

test('coverageOf: ohne Salden ist nichts zu sagen', () => {
  assert.equal(coverageOf([imp('2025-01-01', '2025-01-31', null, null)]), null)
  assert.equal(coverageOf([]), null)
})

const fixtures = path.join(import.meta.dirname, 'fixtures')
const filesIn = (dir: string): string[] => fs.readdirSync(path.join(fixtures, dir)).map((f) => path.join(fixtures, dir, f))

test('looksLikeBankFile: erkennt camt, MT940 und ein ZIP damit, nicht PDF, XRechnung oder ein ZIP mit PDFs', () => {
  for (const file of [...filesIn('camt'), ...filesIn('mt940')]) assert.equal(looksLikeBankFile(fs.readFileSync(file), path.basename(file)), true, file)
  const zip = new AdmZip()
  zip.addFile('2025/auszug.xml', fs.readFileSync(filesIn('camt')[0] ?? ''))
  assert.equal(looksLikeBankFile(zip.toBuffer(), 'auszuege.zip'), true)
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')
  assert.equal(looksLikeBankFile(pdf, 'beleg.pdf'), false)
  const pdfZip = new AdmZip()
  pdfZip.addFile('beleg.pdf', pdf)
  assert.equal(looksLikeBankFile(pdfZip.toBuffer(), 'belege.zip'), false)
  for (const file of filesIn('e-invoice').filter((f) => f.endsWith('.xml'))) assert.equal(looksLikeBankFile(fs.readFileSync(file), path.basename(file)), false, file)
})
