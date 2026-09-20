// Version und Betriebsart des laufenden Mietfuchs. Beides ist die gemeinsame Quelle für
// /healthz und den Update-Hinweis.
//
// Die Version steht in server/package.json. Als JSON-Import statt per Dateizugriff: Buns
// Bundler baut importiertes JSON beim Kompilieren fest ein, sodass auch die Programmdatei ihre
// Version kennt. Dort gibt es keine package.json im Dateisystem. Node lädt JSON-Module erst ab
// 22.12 ohne Warnung und bricht vor 20.10 mit einem Syntaxfehler ab; das allein verlangte nur
// diese Version. `engines` steht heute höher, bei >=24.12, weil TypeScript-Dateien erst ab
// dort ohne Build-Schritt als stabil ausführbar gelten.
import pkg from '../package.json' with { type: 'json' }
import { systemLocation } from './paths.js'

export const APP_VERSION: string = pkg.version

export type Runtime = 'binary' | 'package' | 'docker' | 'npm'

// 'binary' in der Programmdatei (Bun), 'package' bei derselben Datei aus einem
// Installationspaket (#25: sie liegt dann an einem Ort, der dem System gehört), 'docker' im
// Container (das Dockerfile setzt NKA_RUNTIME), sonst 'npm'. Bestimmt, wie der Update-Hinweis
// das Aktualisieren erklärt: Datei austauschen, Paket neu installieren, Container ziehen oder
// neu bauen.
// `NKA_RUNTIME=binary` gibt die Programmdatei vor, ohne eine zu sein. Gedacht für Tests, die
// das Verhalten beim Start aus dem Startmenü prüfen (Browser öffnen, Beenden aus der
// Oberfläche, belegter Port). Die Auslieferung des Frontends hängt weiterhin an Bun selbst.
export const RUNTIME: Runtime = globalThis.Bun
  ? systemLocation() ? 'package' : 'binary'
  : process.env.NKA_RUNTIME === 'docker' ? 'docker'
    : process.env.NKA_RUNTIME === 'binary' ? 'binary' : 'npm'

// Von einem Menschen gestartet und für sich selbst verantwortlich: Nur dann öffnet Mietfuchs
// den Browser, bietet das Beenden aus der Oberfläche an und behandelt einen belegten Port als
// „läuft schon“. Im Container und im npm-Betrieb übernimmt das die Umgebung.
export const STANDALONE: boolean = RUNTIME === 'binary' || RUNTIME === 'package'
