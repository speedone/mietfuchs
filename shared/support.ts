// Wege für Fragen und Fehler (#447): dieselben Adressen in der Hilfe der App, in den Issue-Vorlagen, im README und in
// der Doku. Hier, weil die Oberfläche sie zeigt und ein Wächter im Server (issue-templates.test.ts) prüft, dass die
// Dateien des Repos dieselben nennen.
const REPO_URL = 'https://github.com/speedone/mietfuchs'

// Fragen zur Bedienung: die Diskussionen des Repos, Kategorie „Q&A“
export const DISCUSSIONS_URL = `${REPO_URL}/discussions/categories/q-a`
// Fehler melden: die Auswahl der Issue-Vorlagen
export const NEW_ISSUE_URL = `${REPO_URL}/issues/new/choose`
// Sicherheitslücken vertraulich (SECURITY.md)
export const SECURITY_REPORT_URL = `${REPO_URL}/security/advisories/new`
