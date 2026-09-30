# Hinweise A: feste Gestalt, Regelverzeichnis, Rechtsstand (#112)

Teil von #108. Baut auf `feat/mietmodell` (#106) auf, weil dort die meisten Warnungen stehen.

## Ziel

Heute erzeugt die Berechnung lose Sätze. Wer eine Warnung liest, erfährt weder, wie ernst sie
ist, noch, wo er sie beheben kann, noch, auf welcher Regel sie beruht. Und eine Regel, die nur
für bestimmte Jahre gilt (Kabelfernsehen, #107), steht als `if (year …)` mitten in calc.ts.

## Die Zusage

**Der Wortlaut bleibt.** Jede bisherige Warnung behält ihren Text Zeichen für Zeichen, und
`warnings` bleibt als daraus abgeleitete Liste bestehen. Damit bleiben alle bisherigen Tests,
das Cockpit, ältere Tabs und die schon abgeschlossenen Abrechnungen unberührt.

## Datenmodell (shared/types.ts)

```ts
export type NoticeLevel = 'info' | 'hint' | 'warning' | 'error'
export type NoticeSubject = { kind: 'costItem' | 'unit' | 'tenancy' | 'meter'; id: string }
export type Notice = {
  code: string          // fest, englisch, z. B. 'item.no-basis'
  level: NoticeLevel
  title: string         // kurz, deutsch
  text: string          // der bisherige Wortlaut
  subject?: NoticeSubject
  rule?: string         // Code im Regelverzeichnis
}
export type AppliedRule = { code: string; title: string; norm: string; validFrom?: string; validTo?: string }
export type LegalBasis = { asOf: string; rules: AppliedRule[] }
```

`Settlement` bekommt `notices?: Notice[]` und `legalBasis?: LegalBasis`. Beide sind optional,
weil eine vorher abgeschlossene Abrechnung sie nicht kennt. `warnings` ist immer
`notices.map((n) => n.text)`.

**Die Stufen sind fachlich definiert**, damit sie nicht nach Gefühl vergeben werden:

- `error`: Die Angaben widersprechen sich, und eine Position wird deshalb gar nicht verteilt
  (Einzelbeträge über dem Rechnungsbetrag, vereinbarte Anteile über 100 %).
- `warning`: Geld landet anders, als der Vermieter vermutlich will, oder eine Rechtsregel ist
  verletzt. Das ist der Normalfall der heutigen Meldungen.
- `hint`: etwas, das man prüfen sollte, ohne dass sicher ein Fehler vorliegt.
- `info`: reine Auskunft. Heute gibt es keine; die Stufe ist für Teil B und C.

**Weggelassen gegenüber dem Entwurf in #108:** `amountCents` und `terms`. Einen Betrag nennt der
Text schon, wo es ihn gibt, und die Begriffe kommen mit dem Lexikon in Teil B (#113). Beide
Felder lassen sich ergänzen, ohne etwas zu brechen.

## Regelverzeichnis (server/src/rules.ts)

```ts
export type Rule = { code: string; title: string; norm: string; summary: string; validFrom?: string; validTo?: string }
export const RULES_AS_OF: string        // Datum der letzten Durchsicht, ISO
export const RULES: readonly Rule[]
export function rulesFor(from: string, to: string): Rule[]        // Gültigkeit überschneidet den Zeitraum
export function ruleCoverage(code: string, from: string, to: string): 'full' | 'partial' | 'none'
```

Grenzen sind inklusiv und ISO, wie in calc.ts. Aufgenommen wird nur eine Regel, die die
Berechnung wirklich anwendet; das Verzeichnis ist keine Rechtsbibliothek.

- `tv-signal`: „Kabelfernsehen über die Nebenkosten“, bis `2024-06-30`,
  § 2 Nr. 15 BetrKV a. F. mit § 230 Abs. 4 TKG. Die Kabel-Prüfung fragt `ruleCoverage` statt das
  Jahr: `partial` ergibt den Text für 2024, `none` nach dem Ende den Text für die Zeit danach.
- `heating-flat-rate`: „Pauschale oder Warmmiete bei Heizung und Warmwasser“, ohne Grenzen,
  § 2 und § 12 HeizkostenV.

## Rechtsstand je Abrechnung

`computeSettlement` setzt `legalBasis = { asOf: RULES_AS_OF, rules: rulesFor(01.01., 31.12.) }`.
Weil die abgeschlossene Abrechnung das Ergebnis wortgleich als JSON einfriert, friert der
Rechtsstand ohne weitere Regel mit ein. Eine später verschärfte Regel ändert eine versandte
Abrechnung also nicht.

## Codes

Jede Meldung der Berechnung bekommt einen Code, auch die der Zähler (`meterSegments`): Diese
geben neben `warnings` künftig `notices` zurück, und `consumptionOverview` reicht beide weiter.
Die Liste steht als Tabelle im Plan; ein Test verlangt, dass jede Meldung einen Code aus einer
festen Liste trägt und kein Code zwei Stufen hat.

## Oberfläche (Seite Abrechnung)

- Hinweise erscheinen mit Stufe (Farbe und Wort), fettem Titel und dem Text.
- Mit `subject` gibt es einen Knopf „Hier beheben →“ zur Seite, auf der man es behebt:
  `costItem` → Kosten, `unit` und `tenancy` → Stammdaten, `meter` → Zähler. Dorthin, nicht zum
  einzelnen Eintrag; das Anspringen eines Eintrags ist eine eigene Aufgabe.
- Eine alte abgeschlossene Abrechnung ohne `notices` zeigt ihre `warnings` als Warnungen ohne
  Titel, wie bisher.
- Unter den Hinweisen steht klein der Rechtsstand: „Rechtsstand 30.09.2026“ mit den geltenden
  Regeln zum Aufklappen. Fehlt er, weil die Abrechnung vorher abgeschlossen wurde, steht das da.
- Die Logik (Rückfall, Ziel des Knopfes, Beschriftung der Stufe) liegt in
  `client/src/notices.ts` und ist ohne DOM getestet.

## Tests

- rules: `rulesFor` und `ruleCoverage` an den Grenzen (2023 voll, 2024 teilweise, 2025 keine).
- calc: jede Meldung hat Code und Stufe; `warnings` gleich den Texten; Kabel-Meldung trägt
  `rule: 'tv-signal'` und `subject` der Position; Rechtsstand für 2023 enthält `tv-signal`, für
  2025 nicht.
- API: eine abgeschlossene Abrechnung behält ihren `legalBasis`.
- Client: `noticesOf` mit und ohne `notices`, `noticeTarget` je Art.
