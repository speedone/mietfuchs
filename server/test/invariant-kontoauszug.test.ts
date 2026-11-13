// Invariante (#188, Teil 2): Die Verknüpfungen eines Kontoumsatzes übersteigen nie seinen Betrag. Zufällige Folgen aus
// Buchen (auch aufgeteilt und zu viel), Lösen, Ändern und Löschen verknüpfter Zahlungen und Kautionsbuchungen, mit
// festem Startwert; nach jedem angenommenen Schritt gilt für jeden Umsatz: Summe der zugeordneten Beträge hat sein
// Vorzeichen und ist dem Betrag nach höchstens so groß, und keine Zahlung hängt an zwei Umsätzen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openFreshDatabase } from '../testing/freshDatabase.ts'
import { applyBankImport, applyBankLinks, readBankState, removeBankLink } from '../src/db/bank.ts'
import { createEntity, removeEntity, updateEntity } from '../src/db/repository.ts'
import { updateDepositEntry } from '../src/db/deposits.ts'
import { planBankLinks, type LinkDecision, type LinkPart } from '../src/bank/linkPlan.ts'
import type { BankTransaction } from '../src/bank/model.ts'

function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ (t + t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEQUENCES = 10
const STEPS = 30

test('Invariante: die Verknüpfungen übersteigen nie den Umsatz', async () => {
  const rnd = random(188)
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let seq = 0; seq < SEQUENCES; seq++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mietfuchs-inv-bank-'))
    const opened = await openFreshDatabase(dir)
    let n = 0
    const newId = (): string => `id-${seq}-${++n}`
    try {
      await opened.write(async (db) => {
        await createEntity(db, 'units', 'u1', { propertyId: 'objekt-1', name: 'EG', areaM2: 50, participates: true })
        await createEntity(db, 'units', 'u2', { propertyId: 'objekt-1', name: 'OG', areaM2: 50, participates: true })
        await createEntity(db, 'tenancies', 't1', { unitId: 'u1', tenantName: 'A', persons: 1, start: '2025-01-01' })
        await createEntity(db, 'tenancies', 't2', { unitId: 'u2', tenantName: 'B', persons: 1, start: '2025-01-01' })
        const txs: BankTransaction[] = Array.from({ length: 6 }, (_, i) => ({
          id: `x${i}`, accountId: 'a', importId: 'i', bookingDate: `2025-03-0${i + 1}`, valueDate: null,
          amountCents: (i % 3 === 2 ? -1 : 1) * int(1, 2000) * 100, counterpartyName: null, counterpartyIban: null, ultimatePartyName: null,
          purpose: `Umsatz ${i}`, bankReference: null, endToEndId: null, reversal: false, fingerprint: `f${i}`,
          batchReference: null, batchPart: null, batchParts: null, batchTotalCents: null, setAside: null,
        }))
        await applyBankImport(db, {
          accounts: [{ id: 'a', iban: 'DE89370400440532013000', otherId: null, label: 'Konto', kind: 'rental', rentalConfirmedAt: '2025-01-01T00:00:00Z' }],
          imports: [{ id: 'i', accountId: 'a', fileSha256: 's', fileName: 'x.xml', format: 'camt.053', statementId: null, fromDate: '2025-03-01', toDate: '2025-03-31', openingBalanceCents: null, closingBalanceCents: null, importedAt: '2025-04-01T00:00:00Z', fingerprintVersion: 1 }],
          days: txs.map((t) => ({ accountId: 'a', date: t.bookingDate, importId: 'i', entryCount: 1, creditCents: Math.max(0, t.amountCents), debitCents: Math.max(0, -t.amountCents) })),
          transactions: txs, replaced: [], payers: [],
        })
      })
      for (let step = 0; step < STEPS; step++) {
        await opened.write(async (db) => {
          const { ctx, views } = await readBankState(db, () => null)
          const allLinks = views.flatMap((v) => v.links)
          const op = rnd()
          try {
            if (op < 0.45) {
              const open = views.filter((v) => v.openCents !== 0)
              const v = open[int(0, open.length - 1)]
              if (!v) return
              const sign = Math.sign(v.openCents)
              const partCount = int(1, 2)
              const parts: LinkPart[] = Array.from({ length: partCount }, () => {
                const cents = sign * int(1, Math.abs(v.openCents) + 500)
                const deposit = rnd() < 0.3
                return { tenancyId: rnd() < 0.5 ? 't1' : 't2', amountCents: cents, target: deposit ? { type: 'deposit', kind: sign > 0 ? 'received' : 'refunded' } : { type: 'newPayment', kind: 'rent' } }
              })
              const decisions: LinkDecision[] = [{ transactionId: v.id, parts }]
              const plan = planBankLinks(decisions, open.map((o) => ({ tx: o, openCents: o.openCents })), ctx)
              if (plan.problems.length === 0) await applyBankLinks(db, plan.writes, newId)
            } else if (op < 0.6) {
              const l = allLinks[int(0, allLinks.length - 1)]
              if (l) await removeBankLink(db, l.id, rnd() < 0.5)
            } else if (op < 0.85) {
              const l = allLinks[int(0, allLinks.length - 1)]
              if (!l) return
              const cents = int(1, 3000) * 100 * (rnd() < 0.2 ? -1 : 1)
              if (l.paymentId) {
                const p = ctx.payments.find((x) => x.id === l.paymentId)
                if (p) await updateEntity(db, 'payments', p.id, { ...p, amountCents: Math.sign(p.amountCents) * Math.abs(cents) * (rnd() < 0.1 ? -1 : 1), tenancyId: rnd() < 0.1 ? (p.tenancyId === 't1' ? 't2' : 't1') : p.tenancyId })
              } else if (l.depositEntryId) {
                await updateDepositEntry(db, l.depositEntryId, { amountCents: Math.abs(cents) }, newId)
              }
            } else {
              const l = allLinks.find((x) => x.paymentId)
              if (l?.paymentId) await removeEntity(db, 'payments', l.paymentId)
            }
          } catch (err) {
            // Abgelehnt ist erlaubt (Wächter, Stand der Kaution); geprüft wird, dass nichts Falsches stehen bleibt.
            if (!(err instanceof Error) || !('status' in err)) throw err
          }
        })
        await opened.write(async (db) => {
          const { views } = await readBankState(db, () => null)
          const seen = new Set<string>()
          for (const v of views) {
            const sum = v.links.reduce((a, l) => a + l.cents, 0)
            assert.ok(v.links.every((l) => Math.sign(l.cents) === Math.sign(v.amountCents)), `Folge ${seq}, Schritt ${step}: Vorzeichen an ${v.id}`)
            assert.ok(Math.abs(sum) <= Math.abs(v.amountCents), `Folge ${seq}, Schritt ${step}: ${v.id} mit ${sum} über ${v.amountCents}`)
            for (const l of v.links) {
              const key = l.paymentId ?? l.depositEntryId ?? ''
              assert.ok(!seen.has(key), `Folge ${seq}, Schritt ${step}: Ziel ${key} an zwei Umsätzen`)
              seen.add(key)
            }
          }
        })
      }
    } finally {
      opened.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})
