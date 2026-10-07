// Einträge des Vermieters für Rechtswerte, die eine Behörde erst später veröffentlicht (Heizung PR 17,
// Entwurf 4.5). Erlaubt nur bei überschreibbaren Parametern des Registers und nur für ein Jahr, in dem
// das Register `null` hat; immer mit Quelle. Ein veröffentlichter Wert geht vor (`lawOverridable`), der
// Eintrag heißt dann „überholt“. Rechtswerte kommen nur mit einem Release, nie über das Netz.
import { and, eq } from 'drizzle-orm'
import { LAW_PARAMS } from '../../../shared/law/params.ts'
import { coversDate, valueAt, yearStart, type LawParam, type Timing } from '../../../shared/law/register.ts'
import type { LawOverride, LawOverrideSlot, LawValue } from '../../../shared/types.ts'
import type { Executor } from './client.ts'
import { lawOverrides } from './schema.ts'

// Eine Ablehnung mit fertigem Satz für den Nutzer; die Fehlerbehandlung in index.ts gibt sie als 400 aus.
export class LawOverrideError extends Error {
  status = 400
}

const overridable = (): LawParam<LawValue, Timing>[] => LAW_PARAMS.filter((p) => p.overridable !== undefined)

export async function readLawOverrides(db: Executor): Promise<LawOverride[]> {
  const rows = await db.select().from(lawOverrides).orderBy(lawOverrides.paramId, lawOverrides.validFrom)
  const out: LawOverride[] = []
  for (const r of rows) {
    const value: unknown = JSON.parse(r.valueJson)
    // Abweichung 10 des Plans: Was keine Zahl ist, kann kein Preis sein und bleibt ungenutzt.
    if (typeof value === 'number' && Number.isFinite(value)) out.push({ paramId: r.paramId, validFrom: r.validFrom, value, source: r.source, enteredAt: r.enteredAt })
  }
  return out
}

const officialAt = (p: LawParam<LawValue, Timing>, from: string): number | null => {
  if (!coversDate(p, from)) return null
  const v = valueAt(p, from)
  return typeof v === 'number' ? v : null
}

// Je überschreibbarem Parameter die Jahre, in denen das Register `null` hat, vom ersten solchen Jahr bis
// ins Folgejahr von heute, und jedes Jahr mit einem Eintrag (auch einem überholten, damit der Vermieter
// sieht, dass jetzt der amtliche Wert gilt).
export function lawOverrideSlots(overrides: readonly LawOverride[], today: string): LawOverrideSlot[] {
  const last = Number(today.slice(0, 4)) + 1
  const slots: LawOverrideSlot[] = []
  for (const p of overridable()) {
    const firstNull = p.versions.find((v) => v.value === null)?.validFrom
    const years = new Set<number>(overrides.filter((o) => o.paramId === p.id).map((o) => Number(o.validFrom.slice(0, 4))))
    if (firstNull) {
      for (let y = Number(firstNull.slice(0, 4)); y <= last; y++) if (coversDate(p, yearStart(y)) && valueAt(p, yearStart(y)) === null) years.add(y)
    }
    for (const year of [...years].sort((a, b) => a - b)) {
      const validFrom = yearStart(year)
      if (!coversDate(p, validFrom)) continue
      const official = officialAt(p, validFrom)
      const override = overrides.find((o) => o.paramId === p.id && o.validFrom === validFrom) ?? null
      slots.push({
        paramId: p.id, title: p.title, norm: p.norm, reason: p.overridable?.reason ?? '', year, yearLabel: p.overridable?.yearLabel?.(year) ?? String(year), validFrom, official, override,
        status: official !== null ? 'superseded' : override ? 'entered' : 'open',
      })
    }
  }
  return slots
}

export async function saveLawOverride(db: Executor, paramId: string, year: number, body: unknown, today: string): Promise<LawOverrideSlot> {
  const p = overridable().find((x) => x.id === paramId)
  if (!p) throw new LawOverrideError('Dieser Rechtswert lässt sich nicht eintragen; eintragen dürfen Sie nur Werte, die eine Behörde später veröffentlicht.')
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new LawOverrideError('Bitte nennen Sie das Jahr als vierstellige Zahl.')
  // Weiter als ins Folgejahr veröffentlicht niemand einen Wert; ein Tippfehler wie 2207 fiele sonst nicht auf (G-K4).
  const last = Number(today.slice(0, 4)) + 1
  if (year > last) throw new LawOverrideError(`Eintragen lässt sich ein Wert nur bis ${last}; ${year} ist vermutlich ein Tippfehler.`)
  const validFrom = yearStart(year)
  if (!coversDate(p, validFrom)) throw new LawOverrideError(`„${p.title}“ gibt es für ${year} nicht.`)
  if (valueAt(p, validFrom) !== null) throw new LawOverrideError(`Für ${year} steht der amtliche Wert schon im Programm; ein eigener Eintrag ist nicht nötig.`)
  const value: unknown = body !== null && typeof body === 'object' ? Reflect.get(body, 'value') : undefined
  const sourceRaw: unknown = body !== null && typeof body === 'object' ? Reflect.get(body, 'source') : undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) throw new LawOverrideError('Der Wert muss eine Zahl größer als 0 sein.')
  const max = p.overridable?.max ?? Infinity
  if (value > max) throw new LawOverrideError(`Der Wert darf höchstens ${max.toLocaleString('de-DE')} betragen; bitte prüfen Sie die Eingabe.`)
  const source = typeof sourceRaw === 'string' ? sourceRaw.trim() : ''
  if (source === '') throw new LawOverrideError('Bitte nennen Sie die Quelle, etwa „UBA, Bekanntmachung vom …“.')
  await db.insert(lawOverrides).values({ paramId, validFrom, valueJson: JSON.stringify(value), source, enteredAt: today })
    .onConflictDoUpdate({ target: [lawOverrides.paramId, lawOverrides.validFrom], set: { valueJson: JSON.stringify(value), source, enteredAt: today } })
  const slot = lawOverrideSlots(await readLawOverrides(db), today).find((s) => s.paramId === paramId && s.year === year)
  if (!slot) throw new Error('Der Eintrag ist nach dem Speichern nicht auffindbar.')
  return slot
}

export async function removeLawOverride(db: Executor, paramId: string, year: number): Promise<boolean> {
  if (!Number.isInteger(year)) return false
  const where = and(eq(lawOverrides.paramId, paramId), eq(lawOverrides.validFrom, yearStart(year)))
  const before = await db.select({ p: lawOverrides.paramId }).from(lawOverrides).where(where)
  if (before.length === 0) return false
  await db.delete(lawOverrides).where(where)
  return true
}
