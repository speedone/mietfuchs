// Die eine Schreibweise, in der die Hilfe sucht (Durchsicht von #488, S4): Filter, Rangfolge und Markierung vergleichen
// beide Seiten erst nach `searchText`. Sie erhält die Länge, damit die Stellen im Original dieselben bleiben: klein
// geschrieben (deutsch) und tiefgestellte Ziffern als Ziffern, „CO2“ findet also „CO₂“.
const SUBSCRIPT = /[₀-₉]/g

export function searchText(text: string): string {
  const out = text.toLocaleLowerCase('de').replace(SUBSCRIPT, (d) => String(d.charCodeAt(0) - 0x2080))
  return out.length === text.length ? out : text.replace(SUBSCRIPT, (d) => String(d.charCodeAt(0) - 0x2080))
}

// Die Anfrage dazu: getrimmt, und ein Paragraf ohne Leerzeichen („§556“) wie im Text („§ 556“).
export function searchQuery(query: string): string {
  return searchText(query.trim()).replace(/§(?=[^\s§])/g, '§ ')
}
