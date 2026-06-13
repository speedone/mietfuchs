// Geometrischer Fuchskopf — die Marke „Mietfuchs". Flaches Low-Poly-Design, funktioniert hell
// wie dunkel. Dieselbe Geometrie zeichnet das Icon-Skript (server/scripts/make-icons.mjs) für die
// PWA-Icons nach — bei Änderungen hier dort mitziehen.
export default function FoxLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" role="img">
      {/* Kopf */}
      <path d="M32 13 L40 17 L58 9 L46 35 L32 53 L18 35 L6 9 L24 17 Z" fill="#ef6f2e" />
      {/* Ohren-Innenflächen */}
      <path d="M9 12 L24 17 L18 27 Z" fill="#d4541c" />
      <path d="M55 12 L40 17 L46 27 Z" fill="#d4541c" />
      {/* helle Schnauze */}
      <path d="M21 35 L43 35 L32 53 Z" fill="#fff7f2" />
      {/* Augen */}
      <path d="M21 27 L28 30 L21 33 Z" fill="#23282f" />
      <path d="M43 27 L36 30 L43 33 Z" fill="#23282f" />
      {/* Nase */}
      <path d="M29 47 L35 47 L32 53 Z" fill="#23282f" />
    </svg>
  )
}
