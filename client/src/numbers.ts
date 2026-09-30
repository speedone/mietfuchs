// Eine Zahl, wie sie Menschen in Deutschland eintippen (#105): Komma für Nachkommastellen, ein
// Punkt vor genau drei Ziffern trennt Tausender, ein Punkt vor einer oder zwei Ziffern ist ein
// Dezimalpunkt in technischer Schreibweise. Vorher las das Wohnungsformular „78.43“ Miteigentumsanteile als
// 7843 und „1.200“ m² als 1,2; beides verschiebt eine Verteilung.
export function parseNumberDe(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '')
  if (!t) return null
  let normalized: string
  if (t.includes(',')) normalized = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) normalized = t.replace(/\./g, '')
  else normalized = t
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}
