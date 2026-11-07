// Der Pfad einer Anfrage so, wie Express ihn einer Route zuordnet (#585). Express 5 unterscheidet bei Routen nicht
// zwischen Groß und Klein (`case sensitive routing` aus) und nimmt einen Schrägstrich am Ende an (`strict routing`
// aus); `/API/QUIT` und `/api/quit/` erreichen also `app.post('/api/quit')`. Wer `req.path` selbst mit einem Pfad
// vergleicht, statt sich auf eine Route zu verlassen, vergleicht `routePath(req.path)`, sonst greift eine Sperre bei
// anderer Schreibweise nicht.
//
// Nicht mehr: Doppelte Schrägstriche, `/./`, `%`-Kodierung im festen Teil des Pfads und ein zweiter Schrägstrich am
// Ende führen bei Express zu keiner Route (nachgemessen in routePath.test.ts, an Express selbst). Kennungen wie
// `:slot` dekodiert Express zwar (`/api/ai/key/te%78t` ist `text`), ihr Anfang bleibt aber derselbe; wer auf solche
// Routen prüft, vergleicht den Anfang samt Schrägstrich.
export const routePath = (path: string): string => path.toLowerCase().replace(/(.)\/$/, '$1')
