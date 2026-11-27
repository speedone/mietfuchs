// „Ohne Passwort im Netz“ in der Seitenleiste (#528): Mietfuchs lauscht nur auf diesem Rechner, ist aber über einen Proxy
// ohne Passwort erreichbar (`transition`; ein Bestand im Netz startet seit #692 in der Einrichtung). Das soll man auf
// jeder Seite sehen, ruhig wie „Im Heimnetz erreichbar“ (NetworkHint.tsx); ein Klick führt zur Karte „Anmeldung“ in den
// Einstellungen. Im Programmfenster mit Heimnetz in der Einrichtung (`setup`, #692) sagt er, dass andere Geräte erst ein
// Passwort brauchen; festgelegt wird es dort ohne Code.
import type { AccessHintKind } from '../accessView'

const HINTS: Record<AccessHintKind, { label: string, title: string }> = {
  open: { label: 'Ohne Passwort im Netz', title: 'Jedes Gerät in Ihrem Netz kann Mietfuchs ohne Passwort öffnen. Zur Karte „Anmeldung“' },
  setup: { label: 'Passwort für andere Geräte festlegen', title: 'Andere Geräte in Ihrem Netz sehen erst Ihre Daten, wenn Sie ein Passwort festgelegt haben. Zur Karte „Anmeldung“' },
}

export default function AccessHint({ kind = 'open', onOpen }: { kind?: AccessHintKind, onOpen: () => void }) {
  const hint = HINTS[kind]
  return (
    <button type="button" className="mb-2 p-0 border-0 bg-transparent text-s text-muted hover:text-text" aria-description="Zur Karte „Anmeldung“ in den Einstellungen"
      title={hint.title}
      onClick={onOpen}>
      <span aria-hidden="true">🔓</span> {hint.label}
    </button>
  )
}
