// Testgriffe des Programmfensters (#517): andere Adresse des Servers (MIETFUCHS_SERVER_URL), andere Quelle der Updates
// (MIETFUCHS_UPDATE_FEED), Selbstprüfung, kein Angebot zum Verschieben auf dem Mac, und die Umgebung, die das Fenster an
// den Server weiterreicht (CI, NKA_TEST_*, NKA_ALLOWED_HOSTS, NKA_UPDATE_URL).
//
// **Zwei Schranken** (Durchsicht Daten und Sicherheit): Bisher genügte `CI`, und das setzen manche Entwicklungsumgebungen
// dauerhaft für den ganzen Benutzer, unter Windows auch als `CI=false`. Wer das hatte, dem konnte eine untergeschobene
// Variable Updates von einem fremden Server oder eine fremde Seite mit der Druckbrücke unterjubeln, und ein beliebig
// gesetztes CI schaltete im ausgelieferten Fenster Umzug und Verschieben ab. Jetzt gilt beides nur mit `CI` gleich `1`
// oder `true` **und** `MIETFUCHS_TESTGRIFFE=1`, das niemand zufällig gesetzt hat; die Prüfskripte setzen beides.

/** @param {NodeJS.ProcessEnv} env @returns {boolean} */
export function ciSet(env) {
  const value = env.CI?.trim().toLowerCase()
  return value === '1' || value === 'true'
}

/** @param {NodeJS.ProcessEnv} env @returns {boolean} */
export function testGripsAllowed(env) {
  return ciSet(env) && env.MIETFUCHS_TESTGRIFFE === '1'
}

/**
 * Eine Adresse nur über http auf 127.0.0.1 oder ::1, sonst `null`: Testgriffe zeigen immer auf diesen Rechner.
 * @param {string | undefined} value
 * @returns {string | null}
 */
export function loopbackUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]') ? value : null
  } catch {
    return null
  }
}
