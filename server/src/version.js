// Version und Betriebsart des laufenden Mietfuchs — eine Quelle für /healthz und den
// Update-Hinweis.
//
// Die Version steht in server/package.json. Als JSON-Import statt per Dateizugriff: Buns
// Bundler baut importiertes JSON beim Kompilieren fest ein, sodass auch die Programmdatei ihre
// Version kennt. Dort gibt es keine package.json im Dateisystem.
import pkg from '../package.json' with { type: 'json' }

export const APP_VERSION = pkg.version

// 'binary' in der Programmdatei (Bun), 'docker' im Container (das Dockerfile setzt
// NKA_RUNTIME), sonst 'npm'. Bestimmt, wie der Update-Hinweis das Aktualisieren erklärt.
export const RUNTIME = globalThis.Bun ? 'binary' : process.env.NKA_RUNTIME === 'docker' ? 'docker' : 'npm'
