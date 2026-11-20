// POST /api/upload in den Seitentests: Die Warteschlange der KI-Auswertung speichert jeden abgelegten Beleg, bevor sie
// ihn auswertet (evaluationQueue.ts). Der nachgestellte Server legt ihn unter dem Namen der Datei ab.
export function uploadAnswer(init?: RequestInit): Response {
  const file = init?.body instanceof FormData ? init.body.get('file') : null
  return new Response(JSON.stringify({ file: file instanceof File ? file.name : 'beleg' }), { status: 200, headers: { 'content-type': 'application/json' } })
}
