// Die Anmeldeseite (#528, Entwurf „Oberfläche“): Fuchs, „Mietfuchs“, ein Feld, „Anmelden“; kein Seitenmenü, denn ohne
// Anmeldung gibt es nichts zu navigieren. Welche Seite gilt, entscheidet accessView.ts.
import type { AccessInfo } from '../access'
import FoxLogo from '../components/Logo'
import { LoginForm, type LoginResult } from '../components/LoginDialog'

export default function Anmeldung({ info, onSignedIn, onStale }: { info: AccessInfo; onSignedIn: (result: LoginResult) => void; onStale: (message: string) => void }) {
  return (
    <main className="stopped">
      <div className="card text-left">
        <div className="flex items-center gap-3 mb-4">
          <FoxLogo size={40} />
          <h1 className="m-0">Mietfuchs</h1>
        </div>
        <LoginForm info={info} onSignedIn={onSignedIn} onStale={onStale} autoFocus />
      </div>
    </main>
  )
}
