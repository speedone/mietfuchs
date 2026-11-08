// „Ohne Passwort im Netz“ in der Seitenleiste (#528, Stufe A): Ein bestehender Bestand, der im Netz erreichbar ist, bleibt
// bis zur Entscheidung offen (Übergang). Das soll man auf jeder Seite sehen, ruhig wie „Im Heimnetz erreichbar“
// (NetworkHint.tsx); ein Klick führt zur Karte „Anmeldung“ in den Einstellungen, dort steht, ab wann ein Passwort Pflicht ist.
export default function AccessHint({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="mb-2 p-0 border-0 bg-transparent text-s text-muted hover:text-text" aria-description="Zur Karte „Anmeldung“ in den Einstellungen"
      title="Jedes Gerät in Ihrem Netz kann Mietfuchs ohne Passwort öffnen. Zur Karte „Anmeldung“"
      onClick={onOpen}>
      <span aria-hidden="true">🔓</span> Ohne Passwort im Netz
    </button>
  )
}
