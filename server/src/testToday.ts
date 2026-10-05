// Testgriff `NKA_TEST_TODAY` (Review der Laienprobe, Runden 2 und 3): ein fester Tag als JJJJ-MM-TT für
// die Uhr des Servers, nur für Tests. Prüfbestände mit festen Jahren sollen nicht an einem bestimmten
// Datum kippen (Fristen, Bestätigung abgelaufener Fristen). Ein Nutzer setzt ihn nie; er wirkt nur auf
// den Server, nicht auf die Uhr des Browsers. Ein Wert, der kein echtes Kalenderdatum ist, verhindert
// den Start mit Meldung, wie jeder andere ungültige Umgebungswert.
export function testTodayOf(raw: string | undefined): { value: string | null; error: string | null } {
  if (raw === undefined || raw === '') return { value: null, error: null }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  const valid = m !== null && (() => {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return d.toISOString().slice(0, 10) === raw
  })()
  return valid
    ? { value: raw, error: null }
    : { value: null, error: `NKA_TEST_TODAY „${raw}“ ist kein Kalenderdatum (JJJJ-MM-TT, etwa 2027-01-02). Dieser Testgriff ist nur für Tests gedacht; lassen Sie ihn sonst weg.` }
}
