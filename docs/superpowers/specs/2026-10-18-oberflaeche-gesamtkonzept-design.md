# Gesamtkonzept für die Oberfläche von Mietfuchs

Stand 18.10.2026. Sammel-Issue ist [#346](https://github.com/speedone/mietfuchs/issues/346). Es geht aus der UI-Durchsicht hervor, deren Checkliste in [#341](https://github.com/speedone/mietfuchs/issues/341) steht (41 Befunde), und baut auf dem Monatsfeld aus [#287](https://github.com/speedone/mietfuchs/issues/287) auf. Die Befundkürzel in diesem Text (H1 bis H6 hoch, M1 bis M19 mittel, N1 bis N16 niedrig, MOB1 bis MOB4 mobil) beziehen sich auf die Checkliste in #341.

Die Frage nach einer UI-Bibliothek ist hier ein Baustein (Abschnitt „Bibliotheken“): Mietfuchs bekommt eigene Bausteine auf Plattform-Mitteln, und React Aria ist die benannte Ausnahme für eine spätere Combobox.

## Leitgedanke

Die Durchsicht hat kaum „hässliche“ Stellen gefunden, sondern **Muster, die je Seite neu erfunden wurden**: vier Formularmuster, Fehler oben auf der Seite, sechs Speichern-Knöpfe auf einer Seite, Jahr dreimal wählbar, Begriffe, die das Layout sprengen. Das Konzept legt deshalb **wenige verbindliche Bausteine** fest und eine **Prüfung, dass nichts daran vorbeigeht**. Die Gestaltung selbst bleibt fast wie heute, denn sie ist sauber, auch im dunklen Design. Leitplanke ist CLAUDE.md: Vermieter ohne Vorkenntnisse, also **eine** Art, etwas zu tun, mit festen Wörtern.

Vorbilder: GOV.UK Design System (Fehler und Formulare), Primer (Speichern), Atlassian (Abstands-Tokens) und die WAI-ARIA Authoring Practices (Dialog, Grid). Quellen am Ende.

---

## Bibliotheken

Verglichen wurden eigene Bausteine, React Aria Components, Ark UI, Radix, Base UI, Headless UI, MUI mit MUI X, Mantine, Chakra und shadcn/ui, jeweils mit einer gebauten Musterseite in Chromium, Firefox und WebKit. Das Ergebnis:

- **Eigene Bausteine auf Plattform-Mitteln** (`<dialog>`, `popover`, natives `<select>` und `type="date"`), gestaltet mit Tailwind v4. Die Befunde der Durchsicht sind fast alle Musterfehler und keine Fehler, die eine fertige Komponente behöbe; ein Framework hätte nur die Fokusfalle (M4) und H1 erledigt. Für Dialog, Fokus und Esc verhalten sich die Engines inzwischen gleich, das hat die Probe in allen dreien bestätigt.
- **MUI (mit MUI X) nicht.** Die Probe maß rund +324 KB JS gzip. Die stabile Datumsauswahl (X 8) läuft nicht mit dem aktuellen Material 9, sondern verlangt Material 7. Der freie DataGrid zeigt höchstens 100 Zeilen je Seite, die Funktionen, die man sich davon verspricht (Listenansicht fürs Handy, mehrere Sortierungen und Filter), sind Pro. Das Aussehen bliebe Material, ein Neubau jeder Seite wäre nötig, und Emotion erzeugt die Klassen zur Laufzeit.
- **shadcn/ui nicht als Grundlage.** Es bringt Radix-Modale statt `<dialog>` mit; in der Probe lag nach der verschachtelten Rückfrage in allen drei Engines der Fokus auf `BODY`, und `pointer-events: none` blieb am `body` stehen. Sein Preflight verschiebt das bestehende Aussehen um rund 4.400 bis 11.500 Pixel je Musterzustand, und es kostet rund +97 KB JS gzip. Kopierter Code driftet zudem, denn jede Komponente ist eine lange Klassenkette.
- **shadcn/ui nur als Vorlage fürs Aussehen:** Klassenmuster und Aufbau dürfen abgeschaut werden (neutralere Flächen, Radien, Schriftgrößen), ohne es einzubinden.
- **React Aria Components als benannte Ausnahme:** Wird eine Auswahl mit Suche gebraucht (Kostenart, Mieter, Wohnung bei vielen Einträgen), kommt allein dieser eine Baustein (`ComboBox`) aus React Aria (Apache-2.0), oder ein eigener nach dem cmdk-Muster. Zwei Dialogsysteme nebeneinander führen zum Auseinanderlaufen, deshalb gilt die Ausnahme nur für diesen einen Baustein.
- **Keine kostenpflichtigen Teile.** Pro- und Premium-Lizenzen sowie Lizenzschlüssel sind ausgeschlossen; für ein AGPL-Projekt mit Mitwirkenden passt eine Lizenz je Entwickler nicht.

## 0. Tailwind als Gestaltungsschicht

Tailwind v4 ist gesetzt. Es ersetzt keine Bausteine, sondern das Schreiben von CSS. Die Bausteine bleiben eigene auf `<dialog>` und `popover` (siehe Abschnitt „Bibliotheken“).

- **Einbindung:** `@tailwindcss/vite` 4.3.3 als devDependency, eine Datei `client/src/tw.css`:
  ```css
  @layer theme, base, legacy, components, utilities;
  @import "tailwindcss/theme.css" layer(theme);
  @import "./index.css" layer(legacy);          /* bis es leer ist */
  @import "tailwindcss/utilities.css" layer(utilities);
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
  @theme inline { --color-*: initial; --color-text: var(--text); --color-muted: var(--muted); /* … alle Tokens aus Abschnitt 1 … */ }
  ```
  Kein Preflight, solange `index.css` lebt.
  - In einer Probe gemessen: 0 abweichende Pixel in drei Engines (je 12 Zustände, hell und dunkel, 1440 und 390 px).
  - Mit Preflight 4.400 bis 11.500 Pixel je Zustand.
- **Die Tokens bleiben die einzige Quelle.** `@theme inline` setzt die Tailwind-Namen auf unsere Variablen, `--color-*: initial` entfernt die Standardpalette. Damit gibt es kein `bg-blue-500`, nur `bg-accent`, `text-muted`, `p-4` (4er-Raster), `rounded-l`.
  - Hell und dunkel wechseln über `data-theme` ohne `dark:`; `dark:` gibt es nur für echte Ausnahmen.
  - Gedruckt wird mit `print:` (z. B. `print:hidden`).
- **Namensgleiche Klassen:** Tailwind liest alle Quelldateien. Am echten Client entstanden in der Probe 39 Utilities aus vorhandenen Wörtern; wirklich als Klasse benutzt sind davon nur `grow`, `grow-2` und `sr-only`, und sie bedeuten dort dasselbe. Es gibt kein Präfix, dafür den Wächter S20.
- **Umstellung:** Seite für Seite; jede umgestellte Seite nimmt ihre Regeln aus `index.css` heraus. Die Bausteine (Abschnitt 8) bekommen ihre Klassen zuerst, die Seiten danach.
- **Bauzeit:** in der Probe +0,2 s am echten Client; neu ist nur das native Paket `@tailwindcss/oxide`, lightningcss und rolldown bringt Vite 8 schon mit. In der Programmdatei steckt nur fertiges CSS, zur Laufzeit gibt es keine Abhängigkeit.
- **Aussehen:** Wer es moderner will, ändert Tokens (neutralere Flächen, Radien, Schriftgrößen); Klassenmuster dürfen von shadcn/ui abgeschaut werden, ohne es einzubinden.

## 1. Gestaltungsgrundlagen (Tokens)

**Gewählte Gestaltung: „Mittelweg“.** Verglichen wurden die bisherige Gestaltung, eine behutsame Auffrischung (A), eine an shadcn/ui angelehnte neutrale Gestaltung (B) und der Mittelweg aus beiden, je hell, dunkel und am Handy. Der Mittelweg nimmt von B die neutralen zinc-Flächen, weiße Karten mit 1-px-Linie und kaum Schatten und die helle Seitenleiste, von A die Feldbeschriftung und behält das Indigo von Mietfuchs für das, was handeln lässt: Primärknopf, Links, Fortschritt, Fokusring, aktiver Menüpunkt (hell getönte Fläche) und Objekt-Marke. Das dunkle Design ist fast schwarz mit zinc-Tönen. Umgesetzt mit Schritt 4 (#346).

Farben stehen nur in den Token-Blöcken von `index.css` (`:root`, `[data-theme='dark']` nur am Bildschirm, der Druck nimmt immer die hellen); Wächter S17 verbietet Hex- und rgba-Werte außerhalb. Neue Farben nur als Token-Paar.

| Token | hell | dunkel | wofür |
|---|---|---|---|
| `--bg` | `#fafafa` (zinc-50) | `#09090b` (zinc-950) | Seitengrund |
| `--card` | `#ffffff` | `#111113` | Karten, Seitenfenster |
| `--text` | `#09090b` | `#fafafa` | Text, Feldbeschriftung |
| `--muted` | `#63636b` | `#a1a1aa` | Nebentext |
| `--line` | `#e4e4e7` | `#27272a` | Linien, Kartenrand |
| `--input-border` / `--control-border` | `#8e8e96` / `#d4d4d8` | `#63636b` / `#3f3f46` | Feldrand (auch Auswahlfelder der Seitenleiste) / Rand sekundärer Knöpfe, Linien in Tabellen |
| `--hover` | `#f4f4f5` | `#1f1f23` | Überfahren, Summen-, Gruppen- und Rechenwegzeilen |
| `--chip` | `#f4f4f5` | `#27272a` | Segmente, gesperrte Felder, Hover sekundärer Knöpfe |
| `--sidebar` / `--sidebar-text` | `#fafafa` / `#3f3f46` | `#09090b` / `#d4d4d8` | Seitenleiste |
| `--accent` / `--accent-text` | `#4f46e5` / `#4f46e5` | `#5558e3` / `#a5b4fc` | Fortschritt, Fokus / Links |
| `--accent-soft` / `--accent-strong` | `#eef0ff` / `#4338ca` | `#1e1d3d` / `#a5b4fc` | aktiver Menüpunkt, Objekt-Marke |
| `--primary` / `--primary-hover` / `--primary-text` | `#4f46e5` / `#4338ca` / `#ffffff` | `#5558e3` / `#4a4dd6` / `#ffffff` | Primärknopf |
| `--danger` / `--danger-hover` | `#b91c1c` / `#991b1b` | wie hell | Gefahrknopf |
| `--red`, `--amber`, `--green` (je mit `-soft`) | `#b91c1c`, `#92400e`, `#15803d` | `#f87171`, `#fbbf24`, `#4ade80` | Fehler, Warnung, Erfolg |
| `--brand` | `#ef6f2e` | wie hell | nur Update-Hinweis (Orange des Fuchses) |

**Kontraste** (WCAG 2.1 AA verlangt 4,5:1 für Fließtext; S6 in `uiRules.test.ts` rechnet jedes Paar nach):

| Paar | hell | dunkel |
|---|---|---|
| Text auf Karte | 19,9 | 18,1 |
| Nebentext auf Karte / Seitengrund / Hover-Fläche | 5,95 / 5,70 / 5,42 | 7,36 / 7,76 / 6,41 |
| Link auf Karte / Seitengrund | 6,29 / 6,02 | 9,46 / 9,98 |
| Weiß auf Primärknopf / beim Überfahren | 6,29 / 7,90 | 5,40 / 6,32 |
| Weiß auf Gefahrknopf | 6,47 | 6,47 |
| aktiver Menüpunkt (Schrift auf getönter Fläche) | 6,98 | 8,11 |
| Menüpunkt auf Seitenleiste | 10,0 | 13,5 |
| Fehler / Warnung / Erfolg auf ihrer Fläche | 5,91 / 6,84 / 4,79 | 6,48 / 10,4 / 9,82 |
| Feldrand auf Karte / Seitengrund (WCAG 1.4.11 verlangt 3:1) | 3,25 / 3,11 | 3,17 / 3,34 |

Dazu die Tokens, die vorher als feste Pixelwerte verstreut waren. Die Namen von Schrift und Radius sind die Namensräume von Tailwind; `tw.css` bildet sie mit `@theme inline reference` ab, sodass `text-s`, `rounded-l`, `p-4`, `font-strong` und `shadow-1` genau diese Werte nehmen. Auf Tokens gelegt sind Farbe, Abstand, Schrift, Gewicht, Radius und Schatten; deren Standardskalen entfallen (die Schatten von Tailwind tragen feste Farben). Zeilenhöhe, Laufweite, Containerbreiten und Breakpoints bleiben aus der Standardskala, sie haben keine Farbe:

| Gruppe | Tokens | Werte | Regel |
|---|---|---|---|
| Abstand | `--space-1 … --space-12` | 4, 8, 12, 16, 20, 24, 32, 48 px | 4er-Raster, angelehnt an Atlassian (Basis 8, Halbstufen 4/12/20); `--space-N` = N × 4 px wie `p-N`. Kein `margin: 13px`. |
| Schrift | `--text-xs/s/m/base/l/xl/2xl` | 12, 13, 14, 15, 17, 20, 24 px | Grundschrift 15 px; Felder, Knöpfe, Tabellen und Navigation 14 px; Feldbeschriftung 13 px **fett in `--text`** (vorher `--muted`, schwach auf hellem Grund). |
| Gewicht | `--weight-normal/medium/strong/bold` | 400/500/600/700 | |
| Radius | `--radius-s/m/l/xl` | 6, 8, 12, 16 px | Feld/Knopf `m`, Karte `l`, Dialog/Blatt `xl`. |
| Ebenen | `--shadow-1/2/pop`, `--overlay` | Karten kaum Schatten, im Dunkeln keiner | Top-Layer (Dialog, Popover) ersetzt z-index-Stapel weitgehend. |
| Ziel | `--target` | 36 px (Maus), **44 px** bei `pointer: coarse` oder bis 640 px Breite | WCAG 2.2 verlangt mindestens 24 px (2.5.8); 44 px am Handy behebt MOB2 und N11 (Mülleimer 20 px). Kleine Knöpfe (`.btn.small`, Schließen ✕, „Hier beheben“) behalten ihr Aussehen, ihre Tippfläche wächst über `::after`; die Navigation am Handy folgt mit Schritt 9. |
| Fokus | `--focus-ring` | 2 px Kartenfarbe + 2 px Akzent | ein Fokusrahmen für alles (`:focus-visible`); Felder zeigen Akzentrand und Ring `--ring`. |
| Breite | `--page-max` 1120 | | Tabellenseiten dürfen später `--page-max-wide` (1320) nehmen (M10). |

**Hell/Dunkel:** über `data-theme`. **Druck:** Die dunklen Tokens gelten nur `@media not print`, gedruckt wird also immer mit den hellen; `@media print` setzt den Grund auf Weiß, hält Überschriften bei ihrem Inhalt (`break-after: avoid`) und teilt kleine Blöcke nicht (`break-inside: avoid` für Kennzahlen, Hinweise und Tabellenzeilen; Karten dürfen umbrechen, weil eine Abrechnung oft länger als eine Seite ist), und blendet Bedienung, Begriffsauslöser und Navigation aus (N5).

## 2. Layout und Navigation

- **Desktop (≥ 900 px):** Die Seitenleiste bleibt und ist **der einzige Ort für Objekt und Abrechnungsjahr** (M13). Beide stehen oben und sehen gleich aus (N1, eigenes `appearance: none` mit gleichem Pfeil; umgesetzt mit Schritt 8 als Baustein `Switcher`: der gewählte Eintrag als umbrechender Text mit ▾, das echte Auswahlfeld unsichtbar darüber, wie vorher schon beim Objekt wegen langer Namen, #180). Der Fuß ist Teil der Scrollfläche (M15; umgesetzt mit Schritt 8: nicht mehr angeheftet, bei 1440 × 900 sind „Einstellungen“ und „Hilfe & Begriffe“ auch mit dreizeiligem Objektnamen ohne Scrollen frei, bei 1280 × 720 nach Scrollen, nie verdeckt). Die Navigation folgt den Arbeitsphasen wie heute.
- **Seitenkopf:** Kontextzeile „Lindenweg 12 · Abrechnungsjahr 2025“ (nur Anzeige), `h1`, ein Satz Untertitel, **höchstens eine** Primäraktion rechts. Seiten zeigen Jahr und Objekt nur an und wählen sie nicht noch einmal. Ausnahme: „Jahr der Buchung“ in der Schnellerfassung ist eine Eigenschaft des Belegs, kein Filter, und bekommt eine andere Beschriftung. *Umgesetzt mit Schritt 8:* Die Zeile nennt das Objekt auch bei einem einzigen (die Seite hat keine eigene Auswahl mehr, die es nennen würde), Mietkonto und Steuer nennen bei abweichendem Zeitraum das Kalenderjahr, das sie auf der Seite wählen (eine andere Größe, beschriftet „Kalenderjahr“), Stammdaten nur das Objekt, Einstellungen und Hilfe nichts. Am Bildschirm des Handys entfällt die Zeile, der angeheftete Kopf nennt dasselbe; gedruckt wird sie (Abrechnung und Steuer drucken ihren Seitenkopf ohnehin nicht). „Jahr der Buchung“ heißt schon so und bleibt.
- **Wo Aktionen stehen** (*Schritt 7b*, nach der Rückmeldung zur Objekt-Karte und zur Zähler-Seite): **Neues anlegen steht oben rechts.** Eine Aktion für die ganze Seite steht im Seitenkopf (`PageHeader actions`, höchstens eine Primäraktion: „+ Kostenposition anlegen“, „+ Zähler anlegen“, „+ Zahlung anlegen“), eine für eine Liste oder Karte im Kartenkopf rechts (`Card`/`CardHeader aside`, sekundär: „+ Wohnung anlegen“, „+ Mietverhältnis anlegen“, „+ Weiteres Objekt anlegen“, „+ Heizanlage anlegen“, „+ Lieferung anlegen“, im aufgeklappten Zähler „+ Ablesung anlegen“). Im Fuß einer Karte stehen nur „Speichern“ (links, primär) und die Gefahrknöpfe (rechts, `ml-auto`). Am Handy brechen Kopfaktionen unter den Titel um. Zeilen anfügen („+ weitere …“, „+ … ab Monat …“) bleibt an der Staffel. Wächter S27.
- **Handy (< 900 px):** ersetzt den 477 px hohen Block (MOB2) durch (umgesetzt mit Schritt 9, `components/MobileNav.tsx`):
  - einen **angehefteten Kopf** von 56 px (plus `safe-area-inset-top`; `viewport-fit=cover` in index.html) mit ☰-Menü (`aria-expanded`, `aria-controls`), Seitentitel und „Lindenweg 12 · 2025“ darunter sowie ⇅ für Objekt und Jahr;
  - ein **Menüblatt** als `<dialog>` mit `showModal()` von links. Es zeigt **denselben Inhalt wie die Seitenleiste** (App.tsx reicht ihn herein): Objekt und Jahr oben, die Navigation aus `nav.ts`, unten Design und, nur in der Programmdatei, „Mietfuchs beenden“; den Update-Hinweis nicht, aktualisiert wird am Rechner. Es schließt bei der Wahl einer Seite, Esc, ✕ und Klick daneben (nur `e.target === e.currentTarget`), der Fokus geht an den Knopf zurück, der es geöffnet hat. Esc im Blatt erreicht ein offenes Seitenfenster darunter nicht. Es heißt „Menü“ (`aria-label`, ohne sichtbaren Titel, deshalb nicht `aria-labelledby` wie in Abschnitt 7), die Navigation darin wie die Seitenleiste „Hauptnavigation“, die untere Leiste „Schnellzugriff“;
  - **⇅ öffnet dasselbe Blatt** mit dem Fokus auf der Objektwahl (bei einem Objekt auf dem Zeitraum), statt eines zweiten, kleinen Blatts: Objekt und Jahr bleiben an einem Ort (M13), und die Rückfrage bei offenem Formular ist dieselbe (`useSwitchProperty`, `useSwitchPeriod`). Objekt und Zeitraum wechseln im Blatt, **ohne es zu schließen**: Ein Auswahlfeld sendet unter Windows und Linux bei jeder Pfeiltaste `change`, und ein Blatt, das dabei zuginge, ließe per Tastatur nur den nächsten Eintrag erreichen; Maus und Finger sehen den Wechsel sofort in der Auswahl und in der Kopfzeile dahinter. Nur wenn eine Rückfrage kommt (offenes Formular, Beenden), schließt das Blatt **vorher**, denn die Rückfrage stünde sonst hinter dem modalen Blatt (bis sie mit Schritt 1 selbst ein `<dialog>` ist);
  - eine **untere Leiste** mit Cockpit, Erfassen, Zähler, Stammdaten und „Mehr“ (52 px hoch, `safe-area-inset-bottom`; die Auswahl steht als `BOTTOM_TABS` in `nav.ts`, die kurzen Beschriftungen als `short` am Eintrag). Das sind die Wege, die man vor Ort mit dem Handy geht (Zähler ablesen, Beleg fotografieren). Die aktuelle Seite trägt `aria-current="page"`; liegt sie nicht in der Leiste, ist „Mehr“ getönt, aber nicht „aktuelle Seite“;
  - der Inhalt hält unten Abstand zur Leiste, Toasts stehen darüber, Sprungziele (`scroll-padding`) unter dem Kopf frei; Kopf, Blatt, Leiste, Inhalt, Seitenfenster, Rückfrage, Toasts und der Fuß der Seitenleiste halten die Sicherheitsränder (`env(safe-area-inset-*)`) ein, hochkant wie quer und auf dem Tablet (nachgemessen mit nachgestellten Rändern in Chromium; Wächter S24).
  - Wechselt die Breite über die Grenze (Drehen, Fenster), bleibt die Seite samt offenem Formular stehen; lag der Fokus im ausgehängten Teil, geht er an die aktuelle Seite in der Seitenleiste bzw. an ☰. Ebenso nach einer Rückfrage, deren Auslöser (☰, ⇅, untere Leiste) inzwischen ausgehängt ist.
  - Am Handy zeichnet App.tsx die Seitenleiste gar nicht (und am Rechner Kopf und Leiste nicht), entschieden mit `matchMedia` an derselben Grenze wie im CSS: Sonst stünden die Einträge doppelt im Baum. Am Rechner ändert sich kein Pixel (nachgemessen bei 1440 px, hell und dunkel).

## 3. Formularmuster: eines statt vier

Heute gibt es vier Muster (M18): Seitenfenster, Inline-Karte, Inline in der Tabelle, Sofortspeichern. **Künftig gelten zwei, und eine Ausnahme.** Das folgt Primer: explizit speichern als Standard, nie beides in einem Formular, ein Speichern je Formular ([Primer Saving](https://primer.style/product/ui-patterns/saving/)).

| Muster | Wann | Speichern | Beispiele |
|---|---|---|---|
| **Seitenfenster** (Standard) | etwas **anlegen oder bearbeiten**, das einen Datensatz ergibt | fester Fuß: Primärknopf **„Anlegen“** (neu) bzw. **„Speichern“** (bearbeiten), daneben „Abbrechen“ (sekundär); Strg+S | Mietverhältnis, Wohnung, Kosten, Zahlung, Zähler, **Ablesung, Lieferung, Mieterwechsel, Zeitraumwechsel** (heute Inline-Karten, N16) |
| **Karte mit einem Speichern** | Einstellungen eines Objekts oder der App, die auf einer Seite stehen bleiben | Fuß der Karte, links: „Speichern“, daneben „Ungespeicherte Änderungen“ | Objekt, Einstellungen, Heizanlage (statt sechs Knöpfen, N8) |
| *Ausnahme:* **Entwurf am Feld** (#309, `useDraft`/`DraftActions`) | **ein** Wert in einer Liste, der sonst ein ganzes Fenster bräuchte | „Speichern“/„Verwerfen“ direkt am Feld, nur wenn geändert | Versanddatum, Art der Zahlung, „✎ anpassen“ der Vorauszahlung (H4) |

Sofortspeichern ohne Knopf entfällt. Wo es heute steht (Zahlungsart), kommt der Entwurf am Feld.

**Feste Verben** (N3): Anlegen · Speichern · Abbrechen · Verwerfen · Löschen … (mit Auslassungspunkten, wenn eine Rückfrage folgt). Kein OK, Übernehmen, Umstellen oder Hinzufügen als Primärknopf. Ein „+ … anlegen“ öffnet das Fenster.

**Knopfarten, nur drei:** primär (gefüllt Indigo, höchstens einer je Formular), sekundär (weiß mit sichtbarem Rahmen und grauer Fläche beim Überfahren, auch „Abbrechen“), Gefahr (rot gefüllt; als Knopf, der nur beim Überfahren rot wird, `danger-ghost`; mit Abstand zu „Speichern“, M19). Textknöpfe gibt es nur für Links im Fließtext.

### Feld (`Field`)

Reihenfolge von oben nach unten, wie bei GOV.UK:
1. **Beschriftung** in `--text`, fett, bei Pflichtfeldern mit Sternchen (in Fehlerfarbe, für Vorleser ausgeblendet; am Eingabefeld das HTML-Attribut `required`) und einmal je Formular der Legende „* Pflichtangabe“. *Geändert in Schritt 3:* Vorgesehen war „(freiwillig)“ statt Sternchen; das Sternchen ist aber das bekannte Muster für die Zielgruppe, und die Legende erklärt es (WCAG 3.3.2). Damit die Prüfung des Browsers nicht vor unserer greift, trägt jedes `<form>` `noValidate`, und nichts wird über `:invalid`/`:required` gestaltet (Wächter S25);
2. optional der Begriffsknopf „?“;
3. **Hinweis** (grau, ein Satz);
4. **Fehler** (rot, mit ⚠ und für Vorleser „Fehler:“);
5. das Eingabefeld.

`Field` vergibt `id`, `aria-describedby` (Hinweis + Fehler) und `aria-invalid` selbst, sodass keine Seite das vergessen kann. Das IBAN-Feld ist heute schon so gebaut und dient als Vorbild.

**Breiten nach Inhalt** (*Schritt 7b*, vorher `width-s`/`width-m` und ein Raster mit `auto-fit, minmax(220px, 1fr)`, dessen gleiche Spalten Adresse und Kabelanlage abschnitten). Die Breite gehört dem Eingabefeld, in Stufen über `<Field width>`: **kurz** `s` (`--field-s`, 8,5rem: Betrag, Datum, Monat samt Rasterknopf direkt am Feld, Postleitzahl, Fläche, Personen, Zählerstand), **mittel** `m` (13rem: kurze Freitexte wie Etage, Zählernummer), **lang** `l` (21rem: Adresse, Name, Bezeichnung, IBAN), **voll** `full` (Textfelder, lange Erklärungen). Ein **Auswahlfeld** ist so breit wie sein längster Eintrag, höchstens die volle Breite; eine Stufe ist für es nur die Mindestbreite. Ohne Angabe gilt die **Vorgabe nach Feldart** (`widthOf` in Field.tsx, dieselbe Regel in `fields.css` auch für ein `label.field` von Hand): Datum, Uhrzeit, `inputMode` decimal/numeric und Monat kurz, `<textarea>` voll, Auswahl nach Inhalt, sonst lang. Die Hülle ist so breit wie Beschriftung und Eingabefeld (`fit-content`); Hinweis und Meldung brechen darin um, mindestens in Lesebreite (`--field-hint`, 15rem; für eine lange Frage `hint-wide`, 36rem), und weiten sie nicht (`contain: inline-size`). Das **Raster** `field-grid` setzt die Felder nebeneinander in ihrer eigenen Breite (Flex mit Umbruch, Eingabefelder auf einer Linie) statt in gleich breiten Spalten, die strecken oder abschneiden; das Raster aus `auto-fit, minmax(…)` wurde dafür verworfen, weil seine Spuren gleich breit sind. **Am Handy (bis 640 px) ist jedes Feld voll breit.** Keine festen Breiten in px an Feldern (Wächter S28). **Kein Feld schneidet ab, was der Browserlauf sieht**: Er misst je Seite und in jedem Seitenfenster den Wert eines Eingabefelds (`scrollWidth` ≤ `clientWidth` + 1), bei leerem Feld den Platzhalter (er ist meist ein Beispiel; Quellen und Suche sind deshalb voll breit) und den gewählten Eintrag eines Auswahlfelds (gegen einen Klon mit nur diesem Eintrag). Ein voll breites Feld, dessen Inhalt nicht passt, ist ein eigener Befund („voll breit, Inhalt passt nicht“, Ausnahmen mit Grund in `browser-check-fields.json`, nur sinkend); die Abhilfe ist ein kürzerer Eintrag mit der Erklärung als Hinweis am Feld („unbekannt“ beim Bundesland, „Niemand“ bei der Frage, wer abrechnet, „Wechsel ab einem Monat“). Nicht gesehen werden lange Einträge, die im Beispielbestand nicht gewählt sind; davon gibt es gut 80 über 32 Zeichen.

### Begriffserklärung (`Term`)

Ein kleiner Knopf „?“ (Tippfläche 44 px über `::after`) direkt hinter der Beschriftung. Die Erklärung öffnet als **Popover im Top-Layer**: Sie schiebt nichts weg und wird nie zur Säule (M1, H2), am Handy erscheint sie als Blatt am unteren Rand mit `max-height: 60dvh` (MOB3). Darin stehen höchstens zwei Absätze und „Mehr in ‚Hilfe & Begriffe‘ →“. Lange §-Ketten (M8) wandern in die Hilfe. *Umgesetzt (Schritt 6):* Der Begriff bleibt gestrichelt unterstrichen und ist mit dem „?“ dahinter **ein** Auslöser (`span role="button"`, kein `<button>`, siehe CLAUDE.md „Begriffslexikon“); das „?“ zeichnet CSS (`::before`, Utility `term-q`), die Tippfläche `::after`, das Element selbst ist inline und für Vorleser ausgeblendet: So bleibt der Name eines Felds genau seine Beschriftung (als Kasten fügte Chromium dem Namen ein Leerzeichen hinzu). Die Erklärung nimmt `usePopover` wie das Monatsraster, hängt also im nächsten `<dialog>` bzw. in `body` und nicht im `<label>`, bekommt beim Öffnen den Fokus (nicht modaler Dialog, benannt durch den Titel) und gibt ihn beim Schließen zurück. Die zwei Absätze sind Erklärung und Beispiel; Rechtsgrundlage und „Brauche ich das?“ stehen in der Hilfe. Der Verweis ist ein Link (`<a>`, kein Knopf) und springt über `navigate` (mit der Rückfrage bei offenem Formular) zum Begriff, die Hilfe leert dafür die Suche und setzt den Fokus auf ihn. Der eigene Begriff `tightMarket` (M2) bestand schon.

### Fehler: am Feld **und** als Sammelmeldung

Nach GOV.UK ([Error summary](https://design-system.service.gov.uk/components/error-summary/)):
- Die Meldung steht **immer am Feld** *und* in einer Sammelmeldung „Bitte prüfen Sie N Angaben“, auch bei nur einer.
- Jede Zeile der Sammelmeldung ist ein **Link auf ihr Feld**.
- Beim Absenden geht der Fokus auf die Sammelmeldung, `role="alert"` sitzt **innen**: GOV.UK hat ihn wegen JAWS vom äußeren Element dorthin verlegt.
- **Im Seitenfenster steht die Sammelmeldung im festen Fuß** über den Knöpfen. Damit ist sie immer sichtbar, das Gegenteil von M5 (oben angeschnitten). Sie ist auf `max-height: 40dvh` begrenzt.
- **In einer Karte steht sie oben in der Karte.**
- **Wortlaut:** Am Feld steht die kurze Fassung („Monat fehlt“), in der Sammelmeldung die Fassung mit Ort („Kaltmiete, Zeile 2: Geben Sie den Monat ein, ab dem der Betrag gilt.“). Keine Sammelsätze wie „Mieter, Wohnung und Einzugsdatum prüfen“.
- **Aktionen ohne Formular** (Löschen, Monatsklick) melden einen Fehler als Mitteilung `role="alert"` mit längerer Anzeigedauer, nicht oben auf der Seite (H3, betrifft elf Seiten).
- **Nie still verwerfen** (H4), **Pflichtfelder prüfen** (M12).
- *Umgesetzt (Schritt 3):* Der Fokus geht nur bei einem Melden nach einer Handlung auf die Sammelmeldung; ein Fehler beim Laden steht da, ohne den Fokus zu nehmen. Ein Link aufs Feld klappt einen zugeklappten Bereich (`<details>`) auf. `Field` bleibt ein `<label class="field">`, damit Zeilen, Raster und Seitenfenster es wie jedes Feld setzen; benannt wird das Eingabefeld über `aria-labelledby` nur durch die Beschriftung.

### Entwurf, Speichern, Verwerfen (#309, #333)

- **Seitenfenster:** Mit Änderungen fragen Esc, ✕, Klick daneben und „Abbrechen“ nach „Änderungen verwerfen?“. Startfokus liegt auf **„Abbrechen“**, weil Verwerfen gefährlich ist. Ohne Änderungen schließt das Fenster sofort.
- **Karte:** Der Hinweis „Ungespeicherte Änderungen“ steht neben „Speichern“. Beim Verlassen der Seite wird gefragt (`useOpenForm` wie beim Objektwechsel, `beforeunload` wie bei Primer). *Umgesetzt mit Schritt 7a: Seitenleiste, Menüblatt und untere Leiste fragen „Ungespeicherte Änderungen verwerfen?“, Startfokus „Abbrechen“; Karten mit eigenem Formular melden sich über `useOpenWhenDiffers` (Vergleich mit dem gespeicherten Stand) bzw. `useOpenForm` an, Sprünge aus einer Seite und das Blatt für den Messdienst fragen ebenso.*
- **Entwurf am Feld:** `DraftActions` bleibt der Baustein.

### Datum, Monat, Geld

- **Tag:** natives `<input type="date">`. Es funktioniert in allen Engines, das Format folgt der Sprache des Browsers (deutsches System: TT.MM.JJJJ). In der Probe zeigten englisch eingestellte Browser MM/TT/JJJJ; das gehört in die Hilfe.
- **Monat:** `MonthField` ersetzt `MonthPicker` (#287). Es ist ein **Textfeld**, das „3.2025“, „03/25“, „2025-03“, „März 2025“ und „Mrz 27“ versteht, **plus** einem Knopf ▦ für das Raster: 12 Monate in 3 Spalten, Jahr mit ‹ ›, Tastatur nach dem APG-Grid-Muster (Pfeile, Pos1/Ende, Bild↑/↓ für das Jahr, Enter, Esc). GOV.UK sagt dazu: Kalender nie als einzige Eingabe ([Dates](https://design-system.service.gov.uk/patterns/dates/)). Ein ungültiger Text wird nicht verworfen, sondern ergibt einen Feldfehler. Die Personenstaffel nimmt ebenfalls den Monat statt eines Datums (M11) oder bewusst ein Datum, aber nicht gemischt. *Umgesetzt (Schritt 5):* Regel in `monthText.ts` (`parseMonthText`, auch „3 2025“, „Sept. 2024“, „Jänner 2026“, ein Tag nur als Erster; zweistellige Jahre wie POSIX, 00 bis 68 → 20xx; Jahre 1900 bis 2100; „1.10“, „01.12“ sind mehrdeutig und ergeben einen Feldfehler; ein Punkt am Ende zählt nicht), Baustein `components/MonthField.tsx` in `Field`. Der Wert ist 'JJJJ-MM', sonst der getippte Text unverändert; die Meldung steht beim Verlassen am Feld („Monat 13 gibt es nicht“) und beim Speichern mit Ort („Kaltmiete, Zeile 2: …“), je Staffelzeile mit eigenem Feld für Monat und Betrag. Das Raster hängt im nächsten `<dialog>` bzw. in `body` (Portal, `components/popover.tsx`), nicht im `<label>`: Dort nähme ein Knopf dem Feld die Beschriftung, und außerhalb des Dialogs wäre es inert. **Die Personenstaffel bleibt bewusst ein Datum:** `personDaysInPeriod` in calc.ts rechnet Personentage tagesgenau ab dem Stichtag der Stufe; ein Monat verlöre den Tag eines Zuzugs mitten im Monat. Von M11 bleibt damit das abgeschnittene „ab Einz“, das das Textfeld behebt.
- **Geld:** `MoneyInput` als Textfeld mit `inputMode="decimal"`, rechtsbündig, Ziffern gleich breit, Einheit „€“ als Anhängsel. Gelesen wird über `parseEuro`, ausgegeben über `fmtEuro` (wie heute). Kein `type="number"`, das „650,00“ je nach Browser anders liest.
- **Zahlen mit Einheit** (Zählerstand, m², kWh): dasselbe Anhängsel mit Einheit (N4, H5: die Einheit kommt vom Zähler).

## 4. Dialoge, Seitenfenster, Rückfragen, Mitteilungen

- **Seitenfenster:**
  - `<dialog class="drawer">` mit `showModal()`: Top-Layer und inerter Hintergrund (M4). *Umgesetzt (Schritt 2) mit zwei Abweichungen:* Esc behandelt der Baustein selbst am `keydown` (für die Rückfrage bei Änderungen; Chrome ließe ein zweites `cancel` ohne Nutzeraktion nicht abbrechen), und den Fokus gibt er selbst zurück, weil die Seiten das Fenster aushängen, statt `close()` zu rufen. Esc gilt nicht dem Fenster, wenn es zuerst etwas darin schließt (ein offenes Popover, einen Begriff, eine IME-Eingabe). Ein `close`, das ankommt, wenn das Fenster schon wieder offen ist (StrictMode), zählt nicht.
  - Kopf (Titel `h2`, Untertitel, ✕), scrollender Körper, fester Fuß mit Sammelmeldung und Knöpfen.
  - Am Handy füllt es die volle Breite, die Knöpfe liegen nebeneinander über die ganze Breite, „Strg+S speichert“ ist ausgeblendet (MOB4).
  - **Zwei Pflichtregeln im Baustein:** `onClose`/`onCancel` nur bei `e.target === e.currentTarget` (React reicht verschachtelte Ereignisse weiter; in der Probe schloss sonst „Weiter bearbeiten“ das ganze Fenster), und das erste Feld nach `showModal()` selbst fokussieren (React setzt `autoFocus` beim Einhängen, solange der `<dialog>` noch geschlossen ist, und `showModal()` fokussiert dann das erste fokussierbare Element, also ✕).
  - Ein modaler `<dialog>` macht den Hintergrund inert. Nach dem letzten Element geht der Fokus in die Bedienleiste des Browsers und von dort zurück in den Dialog; das ist die Plattform und nicht das, was M4 beschreibt (dort landete Tab in der Seitenleiste). Einen harten Ring bräuchte zwei Wächter-Elemente und rund 15 Zeilen. *Umgesetzt ohne Ring:* Ein erster eigener Ring, der jeden Tab selbst lenkte, sperrte die Tastatur vor einem geschlossenen `<details>` ein (Durchsicht M2).
  - **Schließen mit Änderungen** fragt „Änderungen verwerfen?“. Erkannt am Pflicht-Prop `value`: Er umfasst jeden Zustand, den das Fenster bearbeitet, auch neben dem Formularobjekt (Heizanlage, Heizperiode); nur Eingegebenes, nichts Nachgeladenes. Zeigt ein offenes Fenster einen anderen Datensatz, bekommt es einen neuen `key`.
- **Rückfrage:**
  - `<dialog class="confirm" role="alertdialog">`, Titel als Frage, ein Satz Folge.
  - Knöpfe „Abbrechen“ und Verb, bei Gefahr ist das Verb rot und **der Startfokus liegt auf „Abbrechen“** (H1).
  - **Kein globaler Enter-Abfänger**: Enter wirkt auf den Knopf mit Fokus. In der Probe gemessen: Enter auf „Abbrechen“ lässt das Fenster offen, in allen drei Engines.
  - *Umgesetzt (Schritt 1):* Esc wird am `keydown` verhindert und vom Baustein behandelt (Chrome ließe ein zweites `cancel` ohne Nutzeraktion sonst nicht abbrechen), außer ein Element darin hat Esc schon genommen. Den Fokus gibt der Baustein zurück, denn er hängt den Dialog aus, statt ihn mit `close()` zu schließen. Tab lenkt der Browser.
  - Mitteilungen über einem modalen Dialog: `popover="manual"` für die Sicht, eine Ansage im obersten Dialog für Vorleser.
- **Mitteilung (Toast):**
  - Erfolg mit `role="status"` (höflich), Fehler mit `role="alert"` und 8 s Anzeigedauer.
  - Am Handy über der unteren Leiste.
  - Nur für Rückmeldungen nach einer Aktion, nie als einzige Stelle für einen Fehler, der ein Feld betrifft.
- **Begriff und Monatsraster:** `popover="auto"` (Klick daneben, Esc). Den Fokus gibt der Baustein im `toggle`-Ereignis zurück, das tut der Browser nicht in jedem Fall. *Umgesetzt (Schritt 5 und 6):* ein Baustein `usePopover` (`components/popover.tsx`) für beide; er setzt das Popover an den Auslöser (unter ihn, sonst darüber, im Fenster gehalten), schließt bei Tab hinter dem letzten bzw. Umschalt+Tab vor dem ersten Element und gibt den Fokus an den Auslöser zurück, wenn er im Popover lag. Den Inhalt zeichnet er nur, solange es offen ist.
- **Ältere Browser:** `popover` braucht Safari 17 und Firefox 125. Ohne `HTMLElement.prototype.showPopover` wird das Raster inline unter dem Feld gezeigt (rund 10 Zeilen).

## 5. Tabellen und Listen, auch mobil

- **Breit:**
  - Kopf klein und grau (seit der Gestaltung „Mittelweg“ ohne Versalien); Zahlen rechtsbündig mit gleich breiten Ziffern.
  - Aktionen als Knopf „Bearbeiten“ mit `aria-label` „Anna Beispiel bearbeiten“ am rechten Rand, Mülleimer erst im Seitenfenster.
  - Die Tabelle scrollt in ihrer Karte (`Table.tsx` heute), die Seite nie (Breitentest „keine Seite breiter als 390 px“, siehe 9c).
- **Schmal (< 640 px): Karten statt Seitwärtsscrollen**, für Listen mit Datensätzen:
  - Die Zeile wird zum Block: erste Spalte fett als Titel, die übrigen mit ihrer Spaltenbeschriftung („Wohnung: EG links“), Aktion rechts.
  - Umgesetzt mit `<Table className="stacked">` und `data-label` am `td`, ohne zweites Markup und ohne JS (`.table` und `.stack` hießen wie eine Utility bzw. eine vorhandene Klasse). Seit Schritt 9 in den Stammdaten (Wohnungen, Mietverhältnisse), auf der Zähler-Seite, bei den Kosten und den Zahlungen im Mietkonto; Wächter S23. Die Aktionen stehen rechts neben dem Titel (höchstens 45 % der Breite), Zeilen mit einer Zelle über mehrere Spalten (Summen, Belegkopf, Ablesungen) füllen den Block. Das Markup bleibt eine Tabelle; ob Safari mit VoiceOver sie bei `display: block` noch als Tabelle ansagt, gehört in die Probe je Release (Abschnitt 7).
- **Ausnahme Zahlenraster** (Mietkonto mit 12 Monaten, Abrechnungstabellen, Kostenvergleich): Dort trägt der Vergleich über Spalten die Bedeutung. Sie bleiben Tabellen mit Scrollen in der Karte, mit **erster Spalte angeheftet** (`position: sticky; left: 0`, Klasse `sticky-first`, unter 900 px; das Mietkonto ist ein Raster aus Kacheln und scrollt nicht) und dem Hinweis „Weitere Spalten rechts“ nur, wenn wirklich gescrollt werden kann (N6, so schon in `Table.tsx`).
- **Leere Liste:** ein Satz, was hier stehen wird, und der Knopf, mit dem man anfängt (siehe 6).

## 6. Hinweise, Ampel, Leerzustände

- **Hinweis (`Notice`)** in drei Stufen, wie `notices` (#112): `error` (rot), `warning` (gelb), `hint` (grau-blau). Die Stufe steht nicht nur in der Farbe, sondern auch im Symbol und im Wort. Aufbau: fetter Titel, der Text, „Hier beheben →“. Unter „Mehr dazu“ liegen nur Begründungen aus Fundstellen (M8); Kürzungen, Beträge, Daten und Aufforderungen bleiben sichtbar, ein Fehler ganz (Entscheidung nach der Durchsicht von Schritt 10: Ein einziger sichtbarer Satz verlor Kürzungsbeträge und Bezüge).
- **Ampel im Cockpit:** bleibt, aber mit **Zustand nach dem Versand** („Versendet am …; noch offen: Belege“, M9). Leere Kacheln bekommen ausreichend Kontrast (N11).
- **Leerzustand:** Er benennt die **Voraussetzung** und führt dorthin („Legen Sie zuerst eine Wohnung an“ mit dem Knopf dazu), statt Felder vorzubelegen oder Knöpfe ohne Grund zu sperren (M14, N12). Ein gesperrter Knopf hat immer einen sichtbaren Grund daneben.
- **Druck mit offenen Fehlern** (H6): Rückfrage vor dem Druck, im Entwurf der Vermerk „Entwurf, nicht versenden“.

## 7. Barrierefreiheit

Ziel ist WCAG 2.2 AA.
- **Dialog:** `showModal()` mit `aria-labelledby` am Titel. Fokus aufs erste Feld, zurück auf den Auslöser; die Probe hat das in drei Engines bestätigt. Rückfragen bekommen `role="alertdialog"`.
- **Feld:** echte `<label for>`, Hinweise und Fehler mit `aria-describedby`, `aria-invalid`. Die Sammelmeldung bekommt den Fokus und `role="alert"` innen.
- **Raster:** APG-Grid (`role="grid"`, wandernder `tabindex`, `aria-selected`, `aria-label` „März 2025“ je Zelle). Die Jahresanzeige ist `aria-live="polite"`.
- **Ziele:** 44 px mit Finger, mindestens 24 px überall.
- **Kontrast:** S6 rechnet schon nach. Es kommen die Fälle aus N11 dazu (leere Kacheln, Link nur durch Farbe → unterstreichen).
- **Fokus:** ein Fokusrahmen, nie `outline: none` ohne Ersatz.
- **Sprache:** `lang="de"`. Der Hinweis für Vorleser „Fehler:“ steht im Text und nicht nur als Symbol.
- **Prüfen:** axe-core in den Playwright-Lauf, dazu einmal je Release NVDA + Firefox und VoiceOver + Safari über die Wege Seitenfenster, Monat und Fehler.

## 8. Bausteinkatalog

| Baustein | Quelle | ersetzt / behebt | Aufwand |
|---|---|---|---|
| Tokens (`index.css` → `@theme` in `tw.css`) | eigen, mit Tailwind | verstreute px-Werte | S |
| `AppShell` (Seitenleiste, Kopf mobil, Menüblatt, untere Leiste) | eigen, `<dialog>` | MOB2, M15, N1 | M |
| `PageHeader` (Kontext, Titel, eine Aktion) | eigen, vorhanden | M13 (Jahr nur anzeigen) | S |
| `Card` + `CardHeader` (Titel, Begriff, Aktion) | eigen | uneinheitliche Kartenköpfe (N8) | S |
| `Button` (primär/sekundär/Gefahr, feste Verben) | eigen, CSS + Typ für Verben | N3, M19 | S |
| `Field` | eigen | M5, M11, Fehler am Feld | M |
| `ErrorSummary` (mit `useFormError`, `FormError` ist darin aufgegangen) | eigen | H3, H4, M5, 58 `className="error"`-Stellen | M |
| `Term` (Popover) | eigen, `popover` | M1, M2, MOB3, H2 | S |
| `MoneyInput`, `NumberWithUnit` | eigen | N4, H5 | S |
| `DateField` | **nativ** `type="date"` | – | – |
| `MonthField` | eigen, `popover` + Raster | #287, M11 | M |
| `Select` | **nativ** `<select>` (mit `appearance: none` bei eigener Farbe, sonst zeichnet WebKit unter Linux die Auswahl hell) | N1, N7 | S |
| `Combobox` mit Suche (erst bei Bedarf) | **React Aria Components `ComboBox`** | – | M |
| `Drawer` + Formularrahmen | eigen, `<dialog>` | M4, M5, M18, MOB4 | M |
| `ConfirmDialog` | eigen, `<dialog>` | H1 | S |
| `Toast` | eigen, vorhanden | Fehler `role="alert"` | S |
| `DraftActions` / `useDraft` | eigen, vorhanden (#309, #333) | H4, Sofortspeichern | – |
| `DataTable` (Tabelle → Karten < 640 px) | eigen, CSS | Seitwärtsscrollen am Handy, M10 | M |
| `Notice` | eigen, vorhanden (#112) | M8 | S |
| `EmptyState` | eigen | M14, N12 | S |

S ≈ bis ½ Tag, M ≈ 1–2 Tage, jeweils mit Tests. Fremd ist nur die Combobox, und die erst, wenn sie gebraucht wird.

## 9. Wächter-Tests gegen das Auseinanderlaufen

Drei Ebenen, wie die Tests von Mietfuchs ohnehin aufgebaut sind.

**a) Quelltext-Wächter** in `client/src/uiRules.test.ts` (dort gibt es S1–S11; dieselbe Technik):

| Regel | prüft | gegen |
|---|---|---|
| S12 Dialoge | `<dialog`, `role="dialog"`, `showModal` nur in `Drawer`, `ConfirmDialog`, `AppShell`; `popover` nur in `Term`, `MonthField`. Seit Schritt 9 für `<dialog`, `showModal` und `role="(alert)dialog"` (heute `MobileNav.tsx`, `Drawer.tsx`, `feedback.tsx`); seit Schritt 5 `popover`, `showPopover()` usw. nur im Baustein `popover.tsx` (dort auch `role="dialog"` des nicht modalen Popovers) und in den Mitteilungen (`feedback.tsx`), und `usePopover` nur in den Bausteinen, die es brauchen (Schritt 5: `MonthField`, Schritt 6: `Term`) | eigene Overlays je Seite |
| S12b Seitenfenster | jedes `<Drawer>` nennt seinen Stand (`value`, kein fester Wert), kein `footer`, in `actions` kein eigener Weg zum Schließen (seit Schritt 2) | ein Fenster ohne Rückfrage beim Schließen |
| S13 Enter | kein `'Enter'` in einem `keydown`-Handler eines Dialogbausteins (seit Schritt 1: die Bausteine aus S12 und `dialogKeys.ts`, ohne Kommentare) | Wiederkehr von H1 |
| S14 Monat/Datum | kein `type="month"`, `type="number"` für Geld, kein zweites Monatsfeld (seit Schritt 5: ohne Kommentare kein `type="month"`/`"number"`, keine Jahresauswahl „– Jahr –“, kein `MonthPicker`/`MonthSelect`/`MonthInput`, die Monatsnamen im Client nur in `monthText.ts`) | #287 |
| S15 Fehler | kein `className="error"`/`role="alert"` außerhalb `Field`, `ErrorSummary`, `Toast` und Ansage der Rückfrage (`feedback.tsx`), `DraftActions`; die übrigen Stellen als Ausnahmeliste mit Anzahl, die nur sinken darf (seit Schritt 3) | M5, H3 |
| S16 Verben | Primärknopf in `Drawer footer` nur `Anlegen`/`Speichern`; „Abbrechen“ nie primär. *Seit Schritt 7:* im `actions` jedes `<Drawer>` nur „Anlegen“/„Speichern“ (Ausnahme mit Grund: „Anlegen und zu … wechseln“); nirgends „OK“, „Übernehmen“, „Hinzufügen“, „Umstellen“ oder „Abbrechen“ als Primärknopf, kein „… hinzufügen“, „+ …“ nur als „+ … anlegen“ oder „+ weitere …“; Gefahrknöpfe (`danger-ghost`) mit „…“, wenn eine Rückfrage folgt (die ohne stehen mit Grund im Test), und mit `ml-auto` hinter einem „Speichern“ derselben Zeile; `confirmLabel` einer Rückfrage ist Pflicht | N3, M19 |
| S17 Tokens | keine Hex-Farben und keine px-Abstände außerhalb der Token-Blöcke in `index.css`/`tw.css`; in Klassen keine beliebigen Werte (`[#…]`, `[13px]`), keine Standardpalette | Gestaltung driftet |
| S18 Jahr/Objekt | kein `<select>` mit Jahr/Objekt in `pages/` außer über `AppShell`. Seit Schritt 8: die Bausteine der Seitenleiste (`PeriodSelect`, `PropertySwitcher`) nur in `App.tsx`, `Switcher` nur in ihnen, `CalendarYearSelect` nur in Mietkonto und Steuer; in `pages/` und `components/` kein `<select>`, das Objekte, Jahre oder Zeiträume anbietet oder damit umschaltet, außer den benannten Ausnahmen (Objekt und Jahr eines Belegs im Posteingang, „Jahr der Buchung“, Jahr der Zahlung) | M13 |
| S19 Formularmuster | eine Seite hat entweder `Drawer` oder Karten-Speichern je Formular; kein zweites `type="submit"` in derselben Karte. *Seit Schritt 7:* je Karte (verschachtelte Karten und Seitenfenster für sich) höchstens ein Knopf „… speichern“, `type="submit"` oder `DraftActions layout="card"`, ein Knopf in einer Schleife zählt mehrfach (je Zeile ist ein Entwurf am Feld); eine Karte, die ein Seitenfenster öffnet, speichert nicht zusätzlich am Fuß (Ausnahme mit Grund: Objekt) | M18, N8 |
| S20 Tailwind | keine neue Klasse in `index.css` mit dem Namen einer Utility (heute `grow`, `grow-2`, `sr-only`); `index.css` wird nur kleiner (Regelzeilen ohne Token-Deklarationen als Obergrenze im Test) | Kollision, Rückfall ins alte CSS |
| S22 Navigation | Einträge mit Kennung und Beschriftung nur in `nav.ts`; Seitenleiste, Menüblatt und untere Leiste lesen `navFor`/`bottomNav` (seit Schritt 9) | zweite Liste |
| S23 Karten | die Tabellen mit Datensätzen tragen `stacked`, jede Zelle `data-label` (außer Aktionen und Zeilen mit `colSpan`) (seit Schritt 9) | Wert ohne Spalte am Handy |
| S24 Sicherheitsränder | was fest oder angeheftet am Fensterrand steht (Regel in index.css oder Utility `fixed`/`sticky top-0`), nimmt `env(safe-area-inset-*)`; `viewport-fit=cover` in index.html (seit Schritt 9) | Bedienbares unter Kerbe oder Home-Indikator |
| S25 Pflichtangabe | ein `<Field required>` außerhalb eines Seitenfensters braucht `<RequiredLegend />` in derselben Datei (im Seitenfenster zeigt der Drawer sie selbst); jedes `<form>` hat `noValidate`; keine Gestaltung über `:invalid`/`:required` (seit Schritt 3) | Sternchen ohne Erklärung, Browserblase vor der Sammelmeldung, rote Felder beim Öffnen |
| S26 Hinweise | Stufenklasse (`noticeClass`), Stufenwort (`NOTICE_LEVEL_LABELS`) und `notice-level` nur in `components/Notice.tsx`; freie Kästen `className="notice|error|hint"` nur nach Ausnahmeliste mit Anzahl, die nur sinkt (seit Schritt 10) | Textwand, Stufe nur in der Farbe (M8) |
| S27 Anlegen oben rechts | jeder Knopf „+ … anlegen“ steht im Ausdruck von `PageHeader actions` oder `Card`/`CardHeader aside`; Zeilen anfügen („+ weitere …“) zählt nicht (seit Schritt 7b) | „+ Zähler anlegen“ unten in der Karte, „Weiteres Objekt anlegen“ neben „Speichern“ |
| S28 Feldbreiten | ein `<Field>` mit Funktion als Kind nennt `width`; keine Breite als Inline-Stil an Eingabefeld, Beschriftung oder Feld; in index.css keine Breite in px an Eingabefeldern (außer Kästchen und Optionsfeld); die Stufen und die Vorgabe nach Feldart stehen in tw.css und fields.css (seit Schritt 7b) | gestreckte und abgeschnittene Felder (M11, N15, N16) |
| S21 Klassenketten | lange Klassenketten nur in `components/`; Seiten setzen Bausteine zusammen und tragen höchstens Abstände und Raster | jede Seite ihr eigener Knopf |

**b) Verhaltenstests in jsdom** je Baustein:
- Esc mit Änderung fragt nach.
- Enter auf „Abbrechen“ bricht ab.
- Ein verschachteltes `close` schließt das Fenster nicht.
- Die Sammelmeldung bekommt den Fokus, und ihr Link fokussiert das Feld.
- `parseMonthText` und `parseEuro` gelten für alle Schreibweisen.

jsdom kennt `showModal` nur teilweise, deshalb ein kleiner Polyfill in `testing/`.

**c) Browserlauf** (Playwright, drei Engines):
- je Seite hell/dunkel bei 1440 und 390 px;
- **`document.documentElement.scrollWidth === 390`** (fängt MOB1);
- axe-core ohne neue Befunde;
- die Tastaturfolge für Seitenfenster und Monat.

Dieser Lauf läuft vor jedem Release und im wöchentlichen vollen Umfang, nicht in jedem PR, wie der Prüfumfang in CLAUDE.md. WebKit läuft im Container `mcr.microsoft.com/playwright:<version>-noble`, wenn dem Rechner GTK4 fehlt.

Zusätzlich gilt: Eine **Musterseite** (als `?muster` in der App oder in den Tests) zeigt alle Bausteine in hell und dunkel, und `npm run screenshots` fotografiert sie mit. Wer einen Baustein ändert, sieht ihn dort.

## 10. Einführungsplan (auslieferbare Schritte)

Jeder Schritt ist ein PR mit `Refs #346` (und, wo er einen Befund der Checkliste behebt, `Refs #341`), wirkt für sich und lässt die App in jedem Zwischenstand einheitlich. Reihenfolge der Umsetzung: 0 (Tailwind), 4 (Tokens und Gestaltung „Mittelweg“), dann 9 (Mobil), dann 1, 2, 3, 5, 6, 7, 8, 10, 11. Die Gestaltung kommt vor den Bausteinen, damit jeder Baustein gleich in ihr entsteht, und Mobil direkt danach, weil die neue Seitenleiste dort die meiste Wirkung hat. Die Nummern bleiben, damit Verweise in Issues und PRs gültig sind.

| # | Schritt | Befunde | Aufwand | Wächter neu |
|---|---|---|---|---|
| 0 | **Tailwind einführen**: `tw.css` mit `index.css` als Schicht `legacy`, Tokens in `@theme`, `dark`- und `print`-Variante; Pixelvergleich alt gegen neu in drei Engines | Grundlage | 1 Tag | S17, S20 |
| 1 | **Rückfrage auf `<dialog>`**: Enter-Abfänger raus, Startfokus „Abbrechen“ bei Gefahr, `alertdialog`. *Umgesetzt: `<dialog role="alertdialog">` mit `showModal()`, `aria-labelledby`/`aria-describedby`, kein Abfänger für Enter, Esc und Klick daneben brechen ab, Fokus zurück an den Auslöser. Die Rückfrage liegt im Top-Layer über Menüblatt und Seitenfenster; das Blatt schließt vor ihr nicht mehr.* | H1 | ½ Tag | S13 |
| 2 | **`Drawer` auf `<dialog>.showModal()`**, Rückfrage beim Schließen mit Änderungen, Fokus zurück, `target`-Prüfung. Alle 9 Seitenfenster profitieren auf einmal. *Umgesetzt: „Abbrechen“ und Hinweis kommen aus dem Baustein, die Formulare reichen ihren Stand als Pflicht-Prop `value` (Vergleich gegen den Stand vor der ersten Eingabe); nur ein geändertes Fenster meldet sich bei `useOpenForm` an; Tab lenkt der Browser (inerter Hintergrund, kein eigener Ring); Mitteilungen liegen als `popover="manual"` darüber. Wächter S12b.* | M4, MOB4 | 1 Tag | S12, S12b |
| 3 | **`Field` + `ErrorSummary`** im Fensterfuß und in Karten, Feldfehler mit Ort; zuerst Zähler/Ablesung, Vorauszahlung, Mietkonto, HeatingSelfSetup, Heizkosten-Karten. *Umgesetzt: eine Fehler-API `useFormError` mit `Field` und `ErrorSummary` (`FormError` aus #343 ist darin aufgegangen); die Prüfungen liefern alle Angaben auf einmal, je mit Feld, kurzer Fassung und Satz mit Ort. Umgestellt sind die Ablesung, die Seitenfenster für Zähler, Zahlung, Wohnung, Mietverhältnis, Kostenposition, Heizung, Kesseltausch, eigene Heizkostenabrechnung und „Weiteres Objekt anlegen“, die Karten der Seite Heizkosten, „Objekt“ (Bezeichnung als Pflicht, M12) und „Vermieter & Zahlung“; Löschen meldet als Mitteilung (8 s). Die Vorauszahlung („✎ anpassen“) bleibt Entwurf am Feld mit `FieldMessage`, auch für die Ablehnung durch den Server. Offen: Ladefehler, Befunde von Vorschauen und die Ergebnisse der Belegauswertung (Ausnahmeliste S15), feste Verben (Schritt 7).* | H3, H4, M5, M12 | 2–3 Tage | S15 |
| 4 | **Tokens** in `index.css` (Abstand, Schrift, Radius, Ziel, Fokus) und Gestaltung „Mittelweg“ (Abschnitt 1), Feldbeschriftung in `--text` | Grundlage | 1 Tag | S17 (Farben) |
| 5 | **`MonthField`** statt `MonthPicker`, Personenstaffel einheitlich. *Umgesetzt: Textfeld plus Raster als Popover (Baustein `popover.tsx`), in den Staffeln, im Zeitraumwechsel und bei der Heizperiode; Staffeln melden je Zeile am Feld; die Personenstaffel bleibt bewusst ein Datum (tagesgenau), siehe Abschnitt 3.* | #287, M11 | 1–2 Tage | S14 |
| 6 | **`Term` als Popover**, eigener Begriff `tightMarket`. *Umgesetzt: „?“ hinter dem Begriff mit Tippfläche `--target`, Erklärung als Popover (am Handy Blatt unten, 60dvh) mit Erklärung, Beispiel und „Mehr in ‚Hilfe & Begriffe‘ →“; `tightMarket` gab es schon (M2 erledigt); S12 um `Term` erweitert.* | M1, M2, MOB3 | 1 Tag | – |
| 7 | **Formularmuster zurückführen**: Ablesung, Lieferung, Mieterwechsel und Zeitraumwechsel ins Seitenfenster; Heizkosten auf ein Speichern je Karte; Sofortspeichern → Entwurf am Feld; feste Verben. *Umgesetzt in drei Teilen:* (1) feste Verben, „+ … anlegen“, Gefahrknöpfe mit „…“ und `ml-auto`, `confirmLabel` Pflicht (S16); (2) die vier Formulare als `<Drawer>` mit `Field`, Sammelmeldung und `required`, Anfragen und Rümpfe vorher und nachher mit `toEqual` festgehalten; der Mieterwechsel ist ein Formular statt dreier Schritte, der Zeitraumwechsel behält Vorschau und `token`; (3) Baustein `Card`/`CardHeader`, ein Speichern je Karte mit `DraftActions layout="card"`, je Zeile ein Entwurf am Feld (S19). Offen: Sofortspeichern der Art einer Zahlung (Ausnahme in saveOnChange.test.ts, mit #281), weitere Karten außerhalb der Seite Heizkosten auf `Card`. | M18, N3, N8, N16, M19 | 3–4 Tage | S16, S19 |
| 7a | **Seitenwechsel mit ungespeicherter Eingabe fragt nach** (Seitenleiste, Menüblatt, untere Leiste, `beforeunload`; Eingaben in Karten melden sich bei `useOpenForm` an). *Erledigt.* | M18 | ½ Tag | – |
| 8 | **Jahr/Objekt nur in der Seitenleiste**, Seiten zeigen an. *Umgesetzt: ein Baustein `Switcher` für Objekt und Zeitraum (gleicher Pfeil, Höhe `--target`, gleiche Schrift), die Kontextzeile im `PageHeader` (am Handy steht sie im angehefteten Kopf); die Jahresauswahl auf Abrechnung, Kosten, Schnellerfassung, Kostenvergleich und Zähler entfällt, im Belegordner werden Objekt und Jahr zu „Belege aller Objekte zeigen“ und „Belege aller Jahre zeigen“ (gefiltert wird weiter nach dem Jahr, in dem ein Zeitraum beginnt; bei abweichendem Rhythmus sagt ein Satz das). Der Fuß der Seitenleiste ist nicht mehr angeheftet (M15). Das Kalenderjahr von Mietkonto und Steuer bleibt auf der Seite, nur bei abweichendem Zeitraum und als „Kalenderjahr“ beschriftet; Heizperiode und „Jahr der Buchung“ bleiben als andere Größen.* | M13, N1, M15 | 1 Tag | S18 |
| 7b | **Raster für Felder und Aktionen**: Neues anlegen oben rechts (Seitenkopf bzw. Kartenkopf), im Kartenfuß nur „Speichern“ und Gefahr; Felder mit Breitenstufen, kein Feld schneidet ab. *Umgesetzt: `Field width` mit `s`/`m`/`l`/`full` und Vorgabe nach Feldart (`fields.css` in der Schicht `components`), Raster `field-grid` ohne gestreckte Spalten, am Handy volle Breite; Objekt-Karte (Bezeichnung und Adresse lang, Auswahlfelder nach Inhalt, Wohnungsmarkt ohne eigenen Kasten), Zeitraumwechsel (Monat kurz mit ▦ am Feld, Auswahl nach Inhalt), „+ Zähler anlegen“ im Seitenkopf wie „+ Kostenposition anlegen“, die übrigen „+ … anlegen“ im Kartenkopf; `grow` an Feldern und die festen Breiten `input-xs` usw. entfallen. Im Browserlauf die Messung abgeschnittener Felder je Seite und in jedem Seitenfenster samt Platzhalter, „voll breit, Inhalt passt nicht“ als eigener Befund mit Ausnahmeliste, eine Mindestzahl geöffneter Fenster und eine Selbstprobe mit vier Feldern.* | M11, N15, N16, N16a | 1 Tag | S27, S28, Browserlauf |
| 9 | **Mobil**: angehefteter Kopf, Menüblatt, untere Leiste, Tabellen → Karten, `guide-norm` umbrechen. *Umgesetzt bis auf `guide-norm`; Breitentest als Skript außerhalb des Repos in drei Engines gelaufen, ins Repo kommt er mit Schritt 11* | MOB1, MOB2, M10, M15 | 2–3 Tage | Breitentest, S12, S22, S23 |
| 10 | **Hinweise/Leerzustände/Druck**: „Was tun“ + „Mehr dazu“, Cockpit nach Versand, Druck-Rückfrage bei Fehlern, Druckkopf. *Umgesetzt: Baustein `Notice` (`NoticeBox`, `CalcNotice`, `TextNotice`) mit Stufe als Zeichen und Wort; Hinweise der Berechnung werden nur in Sätze zerlegt (`noticeText.ts`, eingeklappt nur Begründungen aus Fundstellen, geprüft über echte Texte je Code), kein zweites Feld am Server; „Mehr dazu“ wird mitgedruckt. Abrechnung und Steuerübersicht umgestellt, in der Steuer die Beschreibung vor Gruppe und Kostenart. Cockpit nach Abschluss und Versand mit den offenen Punkten beim Namen. Baustein `EmptyState` mit dem ersten fehlenden Schritt (`emptyStock.ts`) in Cockpit und Abrechnung, Grund am gesperrten „+ Mietverhältnis hinzufügen“, Heizung erst nach den Wohnungen. Druckkopf ohne doppelten Objektnamen, mit Datum und Anschrift des Mieters. Die Druck-Rückfrage (H6) kam schon mit #343. Offen und bei Schritt 7: Zeitraumwechsel hinter „Zeitraum ändern …“; die Karten der Seite Heizkosten (deren Textwand zu „Niemand“ ist mit #367 behoben).* | M8, M9, M14, H6, N5, N12 | 2 Tage | S26 |
| 11 | **Browserlauf + axe** als Skript, Musterseite in `npm run screenshots`. *Umgesetzt; die Musterseite (`?muster`, client/src/pages/Muster.tsx) kam mit Schritt 12 dazu und steht in Browserlauf und `npm run screenshots`: `scripts/browser-check.mjs` (`npm run browser-check`) mit dem Bestand der Bildschirmfotos (`scripts/demo-stock.mjs`), jede Seite der Navigation in drei Engines bei 1440 und 390 px, hell und dunkel (Konsole, sichtbare Fehler, `scrollWidth`, axe serious/critical mit Ausnahmeliste `browser-check-axe.json`, heute leer), Bedienproben für Seitenfenster, Monatsfeld, Begriff, Fehler nach dem Speichern und Navigation am Handy, axe auch auf den offenen Zuständen; in release.yml je Engine im vollen Prüfumfang, Bedingung für das Anhängen ans Release. Behoben, was der erste Lauf fand: Dateifeld ohne Namen, Links im Fließtext nur durch Farbe erkennbar, seitlich rollende Bereiche ohne Tastaturzugang. „Als PDF sichern“ in Safari bleibt Probe von Hand (#286).* | alle | 1 Tag | c), Dateifeld mit Namen, Links im Fließtext, `<pre>` mit tabIndex |

**Zusammen etwa 16–21 Arbeitstage**; neue Abhängigkeit ist nur Tailwind (devDependency, MIT). Die Fachbefunde H5 (MWh), M3, M6, M7 und N2 sind keine Musterfragen und laufen getrennt. Die hohen Befunde H1 bis H6 sind schon mit PR #343 und #344 behoben; Schritt 1 bis 3 führen sie in die Bausteine über und sind in rund einer Woche zu haben.

**Was es nicht kostet:** keine Migration von 30 Seiten auf fremde Komponenten. Die Seiten werden Baustein für Baustein umgestellt, die Wächter verhindern Rückfälle, und jede Zwischenstufe ist auslieferbar.

---

## Probe: was gemessen wurde

Die Bausteine wurden vorab als Musterseiten gebaut (Stammdaten mit Seitenfenster, Formularseite „Objekt“, Menüblatt) und in Chromium, Firefox und WebKit fotografiert, hell und dunkel, bei 1440 und 390 px. Größe der Musterseite mit Rahmen und allen Bausteinen: +7,6 KB JS gzip und 4,0 KB CSS gzip gegen React allein.

- **Gemessen in allen drei Engines:**
  - keine Seite breiter als 390 px;
  - Seitenfenster öffnet mit Fokus im ersten Feld;
  - Esc mit Änderung führt zur Rückfrage mit Fokus auf „Abbrechen“, Enter lässt das Fenster offen;
  - „3.26“ wird zu „März 2026“, „Mrz 2027“ zu „März 2027“, „13.2025“ zum Feldfehler;
  - Strg+S mit Fehlern fokussiert die Sammelmeldung, deren Link das Feld.
- **Gefundene Feinheiten:**
  - Englisch eingestellte Browser zeigen im Datumsfeld MM/TT/JJJJ.
  - WebKit unter Linux zeichnet farbige `<select>` nur mit `appearance: none` richtig.
  - Lange Feldfehler in schmalen Staffelspalten brechen mehrzeilig um; deshalb steht am Feld die Kurzfassung.
  - Das Rezept „App-Leiste über dem festen Drawer“ aus anderen Bibliotheken legt die Leiste auch über ein vorübergehendes Seitenfenster; mit `<dialog>` im Top-Layer entfällt das.

## Quellen

- GOV.UK Error summary: https://design-system.service.gov.uk/components/error-summary/
- GOV.UK Dates (Kalender nie als einzige Eingabe): https://design-system.service.gov.uk/patterns/dates/
- GOV.UK Date input: https://design-system.service.gov.uk/components/date-input/
- Primer Saving (explizit vs. automatisch, ein Speichern je Formular, Knopfplatz): https://primer.style/product/ui-patterns/saving/
- Atlassian Spacing (8-px-Basis, Stufen 2–80 px): https://atlassian.design/foundations/spacing
- MDN `<dialog>` (inert, Esc, `closedby`): https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
- MDN `input type=month` / caniuse: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/month, https://caniuse.com/mdn-html_elements_input_type_month
- WAI-ARIA APG Dialog (Modal) und Grid: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/, https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- WCAG 2.2, 2.5.8 Target Size (Minimum): https://www.w3.org/TR/WCAG22/#target-size-minimum
- React Aria (Screenreader-Tests): https://react-aria.adobe.com/quality
- MUI X Lizenz: https://mui.com/x/introduction/licensing/
- MUI X DataGrid Pagination (frei bis 100 Zeilen je Seite): https://mui.com/x/react-data-grid/pagination/
