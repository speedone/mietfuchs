# Hinweise B: Begriffslexikon (#113)

Teil von #108. Baut auf #118 auf, damit auch die Hinweis-Codes des Hauptzählers eine Erklärung
bekommen.

## Ziel

Wer Mietfuchs ohne Vorkenntnisse bedient, soll jeden Fachbegriff dort nachschlagen können, wo
er ihm begegnet, und dabei etwas lernen: was der Begriff heißt, ein Beispiel mit Zahlen, die
Rechtsgrundlage und die Antwort auf „Brauche ich das?“.

## Daten: `shared/glossary.ts`

```ts
export type Term = { title: string; short: string; example: string; norm?: string; needed: string }
export const GLOSSARY = { … } satisfies Record<string, Term>
export type TermId = keyof typeof GLOSSARY
```

Der Ordner `shared/`, weil beide Seiten es brauchen: Der Server hängt an jeden Hinweis-Code die
passenden Begriffe (`Notice.terms?: TermId[]`), und der Client zeigt sie an. Es ist der erste
Laufzeitanteil in `shared/`; das Docker-Image übernimmt den Ordner schon (siehe CLAUDE.md), und
die Wurzel-`package.json` trägt `"type": "module"` genau dafür.

Die Texte folgen dem Maßstab aus #108: ein Satz Erklärung, ein Beispiel mit Zahlen, die Norm nur
wo es eine gibt. Eine Rechtsaussage steht nur da, wo sie im Gesetz steht; Rechtsprechung wird
ohne Aktenzeichen genannt, wo das Aktenzeichen nicht sicher belegt ist.

## Hinweise

`noticeKinds` in calc.ts bekommt je Code `terms`. **Ein Test verlangt für jeden Code mindestens
einen Begriff**, und jeder Begriff muss im Lexikon stehen (der Übersetzer prüft das zusätzlich).

## Oberfläche

- `<Term id="mea">Miteigentumsanteile</Term>`: gestrichelt unterstrichen, auf Antippen oder mit
  Enter eine Erklärung darunter, Escape schließt. Gebaut als `span` mit `role="button"`, nicht
  als `<button>`: Steht der Begriff in einem `<label>`, wäre ein Button das erste bedienbare
  Element und nähme dem Eingabefeld die Beschriftung. Der Klick verhindert die Aktivierung des
  Labels.
- **Einsatz:** Umlageschlüssel, § 35a-Lohnanteil, vereinbarte Anteile, Hausgeldabrechnung und
  Miteigentumsanteile, Einzelbeträge, Teilnehmer (Kosten); Nutzung der Wohnung,
  Miteigentumsanteile, Nebenkostenmodell, Vorauszahlung (Stammdaten); Hauptzähler (Zähler);
  Eigenanteil und die Begriffe jedes Hinweises (Abrechnung).
- **Seite „Hilfe“** mit allen Begriffen, alphabetisch nach deutscher Sortierung, mit Suchfeld.
  Die Logik (Sortieren, Filtern) liegt in `client/src/glossaryView.ts`.

## Tests

- Lexikon: jeder Eintrag vollständig, jedes Beispiel enthält eine Zahl.
- Server: jeder Hinweis-Code hat Begriffe, und die Hinweise tragen sie.
- Client: Sortieren und Filtern; jsdom: `<Term>` öffnet und schließt, und in einem Label bleibt
  das Eingabefeld beschriftet.
