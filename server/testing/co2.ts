// Eine Abrechnung ohne das, was die CO₂-Aufteilung (Heizung PR 6) hinzufügt: die Hinweise `co2.*`
// samt ihren Texten in `warnings`, die Rechtswerte `co2.*` und die Bewertung je Heizanlage. Für
// Tests, die zeigen, dass eine Heizanlage sonst nichts ändert (Entwurf 11.2, 12.1).
import type { HeatingStatement, LegalBasis, Notice } from '../../shared/types.ts'

type WithCo2 = { notices?: Notice[]; warnings: string[]; legalBasis?: LegalBasis; heating?: HeatingStatement[] }

export function withoutCo2<T extends WithCo2>(s: T): Omit<T, 'heating'> {
  const co2Texts = new Set((s.notices ?? []).filter((n) => n.code.startsWith('co2.')).map((n) => n.text))
  const { heating: _heating, ...rest } = s
  return {
    ...rest,
    ...(s.notices ? { notices: s.notices.filter((n) => !n.code.startsWith('co2.')) } : {}),
    warnings: s.warnings.filter((w) => !co2Texts.has(w)),
    ...(s.legalBasis
      ? { legalBasis: { ...s.legalBasis, ...(s.legalBasis.values ? { values: s.legalBasis.values.filter((v) => !v.id.startsWith('co2.')) } : {}) } }
      : {}),
  }
}
