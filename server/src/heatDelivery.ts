// Umstellung auf Wärmelieferung im laufenden Mietverhältnis (Heizung PR 16, #213): der Hinweis
// `heating.contracting`. Mietfuchs kann die Voraussetzungen des § 556c Abs. 1 BGB nicht prüfen (Effizienz,
// Kostenvergleich nach §§ 8 bis 10 WärmeLV); es nennt sie für die Mieter, deren Mietvertrag schon vor der
// Umstellung lief, und prüft nur, was es weiß: den Zugang der Umstellungsankündigung (§ 556c Abs. 2 BGB, § 11
// Abs. 1 und 3 WärmeLV). Hat der Mieter vorher selbst geheizt, gilt § 556c nicht (BGH, Urteile vom 20.05.2026,
// VIII ZR 46/25 und 47/25, Rn. 28; gelesen in der Kopie des Volltexts bei rws-verlag.de, ECLI und Randnummern
// geprüft am 11.10.2026).
//
// Die Sätze folgen dem Wortlaut der rechtlichen Gegenprüfung vom 12.10.2026 (R-M1 bis R-M3) und den Ersatztexten
// der Prüfung vom 11.10.2026 (R-S1, R-S4, R-S5, C-S7). Eine reine Datei: Die Berechnung reicht Anlagen, Positionen,
// Mietverhältnisse, den Rechtswert und das Datumsformat herein.
import type { CostItem, HeatingEnergy, PreviousSupply, Unit } from '../../shared/types.ts'
import { servesUnit } from '../../shared/heatingPeriod.ts'
import { isHeatDelivery } from '../../shared/heatDelivery.ts'

export type SwitchFinding = { plantId: string; since: string; previousSupply: PreviousSupply | null; announcedOn: string | null; tenants: string[] }

type PlantFacts = {
  id: string
  energy: HeatingEnergy
  units: readonly { unitId: string }[] | null
  contracting?: boolean
  heatDeliverySince?: string | null
  previousSupply?: PreviousSupply | null
  switchAnnouncedOn?: string | null
}

type TenancyFacts = { tenantName: string; unitId: string; start: string; end: string | null; contractDate?: string; heatingModel?: string }

// Je Anlage mit eingetragener Umstellung, deren Positionen diese Abrechnung verteilt, die Mieter, deren Mietvertrag
// vor dem Tag der Umstellung geschlossen wurde und am Tag der Umstellung noch lief. Maßgeblich ist der Vertrag
// (BGH, Urteil vom 20.05.2026, VIII ZR 46/25: ein „zum Zeitpunkt der beabsichtigten Umstellung bereits laufender Mietvertrag“);
// ohne eingetragenes Vertragsdatum nimmt Mietfuchs den Mietbeginn (Prüfung C-S7). Ausgenommen sind Mietverhältnisse
// mit Inklusivmiete bei der Heizung: Ohne Umlagevereinbarung tragen sie die Heizkosten nicht als Betriebskosten.
// Eine Betriebskostenpauschale zählt dagegen mit, denn § 556 Abs. 2 BGB lässt Betriebskosten „als Pauschale oder als
// Vorauszahlung“ ausweisen; der Mieter trägt sie also auch dann (Auslegung am Wortlaut; Durchsicht von #272, S1).
// Die Energie ist die der Abrechnung, bei Contracting also `districtHeating`.
export function switchFindings(
  plants: readonly PlantFacts[],
  items: readonly Pick<CostItem, 'heatingPlantId'>[],
  tenancies: readonly TenancyFacts[],
  units: readonly Pick<Unit, 'id' | 'noConnection'>[],
): SwitchFinding[] {
  const out: SwitchFinding[] = []
  for (const p of plants) {
    const since = p.heatDeliverySince ?? null
    if (since === null || !isHeatDelivery(p)) continue
    if (!items.some((c) => c.heatingPlantId === p.id)) continue
    const served = new Set(units.filter((u) => servesUnit(p, u)).map((u) => u.id))
    const tenants = tenancies
      .filter((t) => served.has(t.unitId) && (t.contractDate ?? t.start) < since && (t.end === null || t.end >= since))
      .filter((t) => t.heatingModel !== 'inclusive')
      .map((t) => t.tenantName)
    if (tenants.length === 0) continue
    out.push({ plantId: p.id, since, previousSupply: p.previousSupply ?? null, announcedOn: p.switchAnnouncedOn ?? null, tenants })
  }
  return out
}

// Monate abziehen; ein Tag, den es im Zielmonat nicht gibt, wird zum letzten des Monats.
export function subtractMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = (y ?? 0) * 12 + ((m ?? 1) - 1) - months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(d ?? 1, last)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const names = (list: readonly string[]): string => (list.length === 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} und ${list.at(-1) ?? ''}`)

// Rechtzeitig ist die Ankündigung, wenn sie vor dem Tag zuging, der `noticeMonths` Monate vor der Umstellung liegt:
// bei einer Umstellung am 01.10. also bis zum 30.06. Rückwärts gerechnet entsprechend §§ 187, 188 Abs. 2 BGB; das ist
// eine Auslegung (eine Primärquelle zur Fristberechnung nach § 556c Abs. 2 gibt es nicht), und sie ist die
// vorsichtigere (Prüfung R-S6).
export const announcedInTime = (announcedOn: string, since: string, noticeMonths: number): boolean => announcedOn < subtractMonths(since, noticeMonths)
// Der letzte Tag, an dem die Ankündigung nach dieser Auslegung zugehen muss.
export const lastAnnouncementDay = (since: string, noticeMonths: number): string => {
  const limit = subtractMonths(since, noticeMonths)
  return new Date(Date.parse(`${limit}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
}

// `rule` ist null, wenn das Register für den Tag der Umstellung keine Fassung hat (vor dem 01.07.2013). `firstDay`
// ist der Beginn der ersten Fassung von `bgb.heat-delivery-switch` (calc.ts reicht ihn aus dem Register herein,
// damit hier kein Datum steht).
export function switchText(f: SwitchFinding, rule: { noticeMonths: number; efficiencyPercent: number } | null, fmtDay: (iso: string) => string, firstDay: string): string {
  const who = names(f.tenants)
  const lead = `Für ${who} lief der Mietvertrag schon vor der Umstellung auf Wärmelieferung am ${fmtDay(f.since)} (maßgeblich ist, ob der Mietvertrag vor der Umstellung geschlossen wurde; ohne eingetragenes Vertragsdatum nimmt Mietfuchs den Mietbeginn).`
  if (rule === null) {
    // Prüfung R-S5; BGH VIII ZR 46/25 Rn. 36 nennt VIII ZR 54/04 für die Rechtslage vor § 556c.
    return `${lead} Die Umstellung liegt vor dem ${fmtDay(firstDay)}; § 556c BGB und die Wärmelieferverordnung gelten erst für spätere Umstellungen. ` +
      'Die vollen Kosten der Wärmelieferung können Sie dann nur umlegen, wenn der Mietvertrag es ausdrücklich vorsieht oder der Mieter der Änderung zugestimmt hat (BGH, Urteil vom 6. April 2005, VIII ZR 54/04).'
  }
  if (f.previousSupply === 'tenant') {
    // VIII ZR 46/25: Rn. 28 (§ 556c weder unmittelbar noch entsprechend), Rn. 44 (die bloße Zahlung genügt nicht),
    // Rn. 46 (Feststellung im Einzelfall, Prüfung R-S4), Rn. 47 (der volle Umfang offen).
    return `${lead} Vorher ${f.tenants.length === 1 ? 'heizte dieser Mieter' : 'heizten diese Mieter'} selbst. § 556c BGB gilt dann nicht (BGH, Urteile vom 20.05.2026, VIII ZR 46/25 und 47/25). ` +
      'Die Heizkosten tragen diese Mieter nur auf Grund einer Vereinbarung, die auch stillschweigend entstehen kann; die bloße Zahlung von Vorauszahlungen genügt dafür nicht, es braucht besondere Umstände. ' +
      'In dem entschiedenen Fall hat der BGH eine solche Vereinbarung jedenfalls über die Kosten angenommen, die bei eigener zentraler Versorgung nach § 7 Abs. 2 und § 8 Abs. 2 HeizkostenV angefallen wären. ' +
      'Ob sie auch die vollen Kosten der Wärmelieferung nach § 7 Abs. 4 und § 8 Abs. 4 HeizkostenV einschließlich der kalkulatorischen Kosten umfasst, hat der BGH offengelassen; das hängt von der Auslegung im Einzelfall ab.'
  }
  // Prüfung R-S1: Ist nicht erfasst, wer vorher versorgte, steht die Einleitung bedingt da.
  const intro = f.previousSupply === 'landlord'
    ? ''
    : 'Haben Sie vorher mit einer eigenen Anlage versorgt und trugen diese Mieter die Heizkosten als Betriebskosten, gilt § 556c BGB: '
  // Prüfung R-M1 im Wortlaut der Gegenprüfung: Die Kostentragung hängt nur an § 556c Abs. 1 Nr. 1 und 2; die
  // Ankündigung nach Abs. 2 ist eine eigene Pflicht.
  const conditions = `${intro}Die Kosten der Wärmelieferung tragen sie als Betriebskosten nur, wenn die Wärme mit verbesserter Effizienz aus einer vom Lieferanten neu errichteten Anlage oder aus einem Wärmenetz kommt (hatte die bisherige Anlage einen Jahresnutzungsgrad von mindestens ${rule.efficiencyPercent} %, genügt eine verbesserte Betriebsführung) ` +
    'und die Kosten der Wärmelieferung die Betriebskosten der bisherigen Eigenversorgung mit Wärme oder Warmwasser nicht übersteigen (Kostenvergleich nach §§ 8 bis 10 WärmeLV; § 556c Abs. 1 BGB). ' +
    `Außerdem müssen Sie die Umstellung spätestens ${rule.noticeMonths} Monate vorher in Textform und mit den Angaben nach § 11 Abs. 2 WärmeLV ankündigen (§ 556c Abs. 2 BGB, § 11 Abs. 1 WärmeLV).`
  // Prüfung R-M2 im Wortlaut der Gegenprüfung. Die Umlage der Bestandteile ist eine Auslegung aus § 5 WärmeLV, nicht
  // ausdrücklich geregelt; § 5 greift nur, wenn eine Voraussetzung des § 556c Abs. 1 fehlt, nicht bei fehlender
  // Ankündigung.
  const missing = ' Fehlt eine der beiden Voraussetzungen nach § 556c Abs. 1 BGB, tragen diese Mieter die Kosten der Wärmelieferung nicht als Betriebskosten. ' +
    'Die Wärmelieferverordnung geht davon aus, dass Sie dann die Bestandteile umlegen, die den Kosten bei eigener Versorgung nach § 7 Abs. 2 und § 8 Abs. 2 HeizkostenV entsprechen; ' +
    'dafür können Sie vom Lieferanten verlangen, diese Bestandteile seines Preises gesondert auszuweisen (§ 5 WärmeLV).'
  // Prüfung R-M3: § 11 Abs. 3 WärmeLV im Wortlaut.
  const notice = f.announcedOn === null
    ? ' Ob und wann die Umstellungsankündigung zuging, ist nicht erfasst.'
    : announcedInTime(f.announcedOn, f.since, rule.noticeMonths)
      ? ''
      // Durchsicht von #272, S3: Die Frist ist im Text als vorsichtige Auslegung gekennzeichnet; ging die Ankündigung
      // erst nach der Umstellung zu, sagt der Satz das.
      : (f.announcedOn > f.since
        ? ` Die Umstellungsankündigung ging erst am ${fmtDay(f.announcedOn)} zu, nach der Umstellung. `
        : ` Die Umstellungsankündigung ging am ${fmtDay(f.announcedOn)} zu und damit nicht spätestens ${rule.noticeMonths} Monate vor der Umstellung (Mietfuchs rechnet vorsichtig: Bei einer Umstellung am ${fmtDay(f.since)} muss sie bis zum ${fmtDay(lastAnnouncementDay(f.since, rule.noticeMonths))} zugehen; das ist eine Auslegung). `) +
        'Ohne ordnungsgemäße Ankündigung beginnt die Frist für Einwendungen gegen die Abrechnung der Wärmelieferkosten (§ 556 Abs. 3 Satz 5 BGB) frühestens, wenn der Mieter eine Mitteilung erhalten hat, die § 11 Abs. 1 und 2 WärmeLV entspricht (§ 11 Abs. 3 WärmeLV).'
  return `${lead} ${conditions}${missing}${notice}`
}
