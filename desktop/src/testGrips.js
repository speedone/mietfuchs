// Testgriffe des Programmfensters (#517): andere Adresse des Servers (MIETFUCHS_SERVER_URL), andere Quelle der Updates
// (MIETFUCHS_UPDATE_FEED), Selbstprüfung, kein Angebot zum Verschieben auf dem Mac, und die Umgebung, die das Fenster an
// den Server weiterreicht (CI, NKA_TEST_*, NKA_ALLOWED_HOSTS, NKA_UPDATE_URL), dazu die Selbstprüfung der Kopplung
// (`selftestPlan`, #528).
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

// Die Knöpfe der Rückfrage, wenn der gekoppelte Mietfuchs nicht lädt (main.js, remoteTrouble), in ihrer Reihenfolge
const TROUBLE_ANSWERS = Object.freeze(['retry', 'disconnect', 'quit'])
// Server, mit denen sich die Selbstprüfung koppeln darf: nur dieser Rechner, als IP und als Name
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])

/**
 * Was die Selbstprüfung der Kopplung tut (#528, scripts/desktop-check.mjs), nur mit beiden Schranken und einem Ordner
 * für die Ergebnisse (`MIETFUCHS_SELFTEST_OUT`), sonst `null`:
 * - `MIETFUCHS_SELFTEST_PAIR` (JSON `{ address, code }`): über die Brücke der eigenen Seite koppeln, nur mit einem
 *   Server auf diesem Rechner (127.0.0.1, [::1] oder localhost; wie MIETFUCHS_SERVER_URL);
 * - `MIETFUCHS_SELFTEST_DISCONNECT=1`: danach über die Brücke der gekoppelten Seite trennen;
 * - `MIETFUCHS_SELFTEST_QUIT=1`: danach beenden;
 * - `MIETFUCHS_SELFTEST_WINDOW` (`hidden`, `minimized`): das Fenster vor dem Laden der gekoppelten Seite verbergen
 *   oder ablegen;
 * - `MIETFUCHS_SELFTEST_TROUBLE` (`retry`, `disconnect`, `quit`): die Rückfrage nicht zeigen, sondern festhalten, in
 *   welchem Zustand sie erschiene, und so beantworten (der Index des Knopfs).
 * Ein unbekannter Wert gilt nicht.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ out: string, pair: { address: string, code: string } | null, disconnect: boolean, quit: boolean, window: 'hidden' | 'minimized' | null, trouble: number | null } | null}
 */
export function selftestPlan(env) {
  const out = env.MIETFUCHS_SELFTEST_OUT
  if (!out || !testGripsAllowed(env)) return null
  /** @type {{ address: string, code: string } | null} */
  let pair = null
  try {
    const request = /** @type {unknown} */ (JSON.parse(env.MIETFUCHS_SELFTEST_PAIR ?? 'null'))
    const { address, code } = /** @type {{ address?: unknown, code?: unknown }} */ (request ?? {})
    const host = typeof address === 'string' ? address.replace(/:\d+$/, '') : ''
    if (typeof address === 'string' && typeof code === 'string' && code && LOOPBACK_HOSTS.has(host)) pair = { address, code }
  } catch {
    // kein JSON: keine Kopplung
  }
  const window = env.MIETFUCHS_SELFTEST_WINDOW === 'hidden' || env.MIETFUCHS_SELFTEST_WINDOW === 'minimized' ? env.MIETFUCHS_SELFTEST_WINDOW : null
  const answer = TROUBLE_ANSWERS.indexOf(env.MIETFUCHS_SELFTEST_TROUBLE ?? '')
  return {
    out,
    pair,
    disconnect: env.MIETFUCHS_SELFTEST_DISCONNECT === '1',
    quit: env.MIETFUCHS_SELFTEST_QUIT === '1',
    window,
    trouble: answer >= 0 ? answer : null,
  }
}
