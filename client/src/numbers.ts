// Eine Zahl, wie sie Menschen in Deutschland eintippen (#105): Komma für Nachkommastellen, ein
// Punkt vor genau drei Ziffern trennt Tausender, ein Punkt vor einer oder zwei Ziffern ist ein
// Dezimalpunkt in technischer Schreibweise. Vorher las das Wohnungsformular „78.43“ Miteigentumsanteile als
// 7843 und „1.200“ m² als 1,2; beides verschiebt eine Verteilung.
export function parseNumberDe(raw: string): number | null {
  // Das typografische Minus (U+2212) kommt aus kopierten Texten und von manchen Tastaturen und
  // meint dasselbe wie „-“ (#139). Wo ein negativer Wert fachlich falsch ist, lehnt ihn der
  // Aufrufer oder die Prüfbedingung der Datenbank ab, gleich mit welchem Zeichen er kam.
  const t = raw.trim().replace(/\s/g, '').replace(/\u2212/g, '-')
  if (!t) return null
  let normalized: string
  // Mit Komma dürfen Punkte nur als Tausendertrenner stehen; „78.43,5“ oder „1,234.56“ sind
  // keine Zahl, sondern ein Vertippen, und still falsch gelesen wären sie schlimmer als abgelehnt.
  if (t.includes(',')) {
    if (!/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t) && !/^-?\d+,\d+$/.test(t)) return null
    normalized = t.replace(/\./g, '').replace(',', '.')
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) normalized = t.replace(/\./g, '')
  else normalized = t
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

// „11.325“ ohne Komma: Tausenderpunkt oder Nachkommastellen? Bei Mengen meint man fast immer Tausender, beim
// Heizwert (kWh je Liter) und beim Volumen des Warmwassers kommen drei Nachkommastellen ebenso vor
// (Nachprüfung von #240, W1). Dort fragt das Formular nach, statt zu raten.
export const ambiguousThousands = (raw: string): boolean => /^-?\d{1,3}\.\d{3}$/.test(raw.trim())
export const ambiguousText = (raw: string): string => {
  const t = raw.trim()
  return `Meinen Sie ${t.replace('.', ',')} oder ${t.replace('.', '')}? Bitte schreiben Sie Nachkommastellen mit Komma (${t.replace('.', ',')}) und Tausender ohne Punkt (${t.replace('.', '')}).`
}
