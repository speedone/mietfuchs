// Läuft eine Prüfung? Nur `CI=1` oder `CI=true` (GitHub setzt `true`, die Tests und Skripte `1` oder `true`). Ein anders
// gesetztes CI, unter Windows etwa dauerhaft `CI=false` aus einer Entwicklungsumgebung, schaltet nichts ab: weder den
// Browser beim Start der Programmdatei noch die Ortsdatei oder die Suche beim Umzug (Durchsicht Sicherheit K2).
export function ciSet(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI?.trim().toLowerCase()
  return value === '1' || value === 'true'
}
