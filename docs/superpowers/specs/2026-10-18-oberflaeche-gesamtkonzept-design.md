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

Die Farben bleiben, wie sie in `index.css` stehen (`--bg`, `--card`, `--text`, `--muted`, `--line`, `--accent`, `--accent-text`, `--green`, `--red`, `--amber` …, je hell und `[data-theme='dark']`). `uiRules.test.ts` S6 prüft schon den Kontrast. Neu kommen die Tokens hinzu, die heute als feste Pixelwerte verstreut sind:

| Gruppe | Tokens | Werte | Regel |
|---|---|---|---|
| Abstand | `--space-1 … --space-12` | 4, 8, 12, 16, 20, 24, 32, 48 px | 4er-Raster, angelehnt an Atlassian (Basis 8, Halbstufen 4/12/20). Kein `margin: 13px`. |
| Schrift | `--text-xs/s/m/l/xl/2xl` | 12, 13, 15, 17, 20, 24 px | Grundschrift 15 px wie heute; Feldbeschriftung 13 px **fett in `--text`** (heute `--muted`, schwach auf hellem Grund). |
| Gewicht | `--weight-normal/strong/bold` | 400/600/700 | |
| Radius | `--radius-s/m/l/xl` | 6, 8, 12, 16 px | Feld/Knopf `m`, Karte `l`, Dialog/Blatt `xl`. |
| Ebenen | `--shadow-1/2/pop`, `--overlay` | wie heute | Top-Layer (Dialog, Popover) ersetzt z-index-Stapel weitgehend. |
| Ziel | `--target` | 36 px (Maus), **44 px** bei `pointer: coarse` oder < 640 px | WCAG 2.2 verlangt mindestens 24 px (2.5.8); 44 px am Handy behebt MOB2 und N11 (Mülleimer 20 px). |
| Fokus | `--focus-ring` | 2 px Kartenfarbe + 2 px Akzent | ein Fokusrahmen für alles (`:focus-visible`). |
| Breite | `--page-max` 1080, `--drawer-width` 480 | | Tabellenseiten dürfen `--page-max-wide` (1320) nehmen (M10). |

**Hell/Dunkel:** wie heute über `data-theme`. Neue Farben nur als Token-Paar. **Druck:** `@media print` setzt die Tokens auf Hell, blendet Bedienung, Begriffsauslöser und Navigation aus (N5) und setzt `break-after: avoid` für Überschriften und `break-inside: avoid` für Karten.

## 2. Layout und Navigation

- **Desktop (≥ 900 px):** Die Seitenleiste bleibt und ist **der einzige Ort für Objekt und Abrechnungsjahr** (M13). Beide stehen oben und sehen gleich aus (N1, eigenes `appearance: none` mit gleichem Pfeil). Der Fuß ist Teil der Scrollfläche (M15). Die Navigation folgt den Arbeitsphasen wie heute.
- **Seitenkopf:** Kontextzeile „Lindenweg 12 · Abrechnungsjahr 2025“ (nur Anzeige), `h1`, ein Satz Untertitel, **höchstens eine** Primäraktion rechts. Seiten zeigen Jahr und Objekt nur an und wählen sie nicht noch einmal. Ausnahme: „Jahr der Buchung“ in der Schnellerfassung ist eine Eigenschaft des Belegs, kein Filter, und bekommt eine andere Beschriftung.
- **Handy (< 900 px):** ersetzt den 477 px hohen Block (MOB2) durch:
  - einen **angehefteten Kopf** von 56 px mit ☰-Menü (`aria-expanded`), Seitentitel und „Lindenweg 12 · 2025“ darunter sowie ⇅ für Objekt und Jahr;
  - ein **Menüblatt** als `<dialog>` von links mit derselben Navigation samt Objekt und Jahr;
  - eine **untere Leiste** mit Cockpit, Erfassen, Zähler, Stammdaten und „Mehr“ (52 px hoch, `safe-area-inset-bottom`). Das sind die Wege, die man vor Ort mit dem Handy geht (Zähler ablesen, Beleg fotografieren).

## 3. Formularmuster: eines statt vier

Heute gibt es vier Muster (M18): Seitenfenster, Inline-Karte, Inline in der Tabelle, Sofortspeichern. **Künftig gelten zwei, und eine Ausnahme.** Das folgt Primer: explizit speichern als Standard, nie beides in einem Formular, ein Speichern je Formular ([Primer Saving](https://primer.style/product/ui-patterns/saving/)).

| Muster | Wann | Speichern | Beispiele |
|---|---|---|---|
| **Seitenfenster** (Standard) | etwas **anlegen oder bearbeiten**, das einen Datensatz ergibt | fester Fuß: Primärknopf **„Anlegen“** (neu) bzw. **„Speichern“** (bearbeiten), daneben „Abbrechen“ (sekundär); Strg+S | Mietverhältnis, Wohnung, Kosten, Zahlung, Zähler, **Ablesung, Lieferung, Mieterwechsel, Zeitraumwechsel** (heute Inline-Karten, N16) |
| **Karte mit einem Speichern** | Einstellungen eines Objekts oder der App, die auf einer Seite stehen bleiben | Fuß der Karte, links: „Speichern“, daneben „Ungespeicherte Änderungen“ | Objekt, Einstellungen, Heizanlage (statt sechs Knöpfen, N8) |
| *Ausnahme:* **Entwurf am Feld** (#309, `useDraft`/`DraftActions`) | **ein** Wert in einer Liste, der sonst ein ganzes Fenster bräuchte | „Speichern“/„Verwerfen“ direkt am Feld, nur wenn geändert | Versanddatum, Art der Zahlung, „✎ anpassen“ der Vorauszahlung (H4) |

Sofortspeichern ohne Knopf entfällt. Wo es heute steht (Zahlungsart), kommt der Entwurf am Feld.

**Feste Verben** (N3): Anlegen · Speichern · Abbrechen · Verwerfen · Löschen … (mit Auslassungspunkten, wenn eine Rückfrage folgt). Kein OK, Übernehmen, Umstellen oder Hinzufügen als Primärknopf. Ein „+ … anlegen“ öffnet das Fenster.

**Knopfarten, nur drei:** primär (gefüllt Akzent, höchstens einer je Formular), sekundär (Rahmen, auch „Abbrechen“), Gefahr (rote Schrift und roter Rahmen, mit Abstand zu „Speichern“, M19). Textknöpfe gibt es nur für Links im Fließtext.

### Feld (`Field`)

Reihenfolge von oben nach unten, wie bei GOV.UK:
1. **Beschriftung** in `--text`, fett, mit dem Zusatz „(freiwillig)“ statt Sternchen bei Pflichtfeldern;
2. optional der Begriffsknopf „?“;
3. **Hinweis** (grau, ein Satz);
4. **Fehler** (rot, mit ⚠ und für Vorleser „Fehler:“);
5. das Eingabefeld.

`Field` vergibt `id`, `aria-describedby` (Hinweis + Fehler) und `aria-invalid` selbst, sodass keine Seite das vergessen kann. Das IBAN-Feld ist heute schon so gebaut und dient als Vorbild.

**Breiten nach Inhalt** (`width-s` für PLZ, Betrag; `width-m` für Monat, Auswahl). Ein Raster mit `auto-fit, minmax(220px, 1fr)` statt fester Spalten verhindert die abgeschnittenen Felder aus M11, N15, N16 und N16a.

### Begriffserklärung (`Term`)

Ein kleiner Knopf „?“ (Tippfläche 44 px über `::after`) direkt hinter der Beschriftung. Die Erklärung öffnet als **Popover im Top-Layer**: Sie schiebt nichts weg und wird nie zur Säule (M1, H2), am Handy erscheint sie als Blatt am unteren Rand mit `max-height: 60dvh` (MOB3). Darin stehen höchstens zwei Absätze und „Mehr in ‚Hilfe & Begriffe‘ →“. Lange §-Ketten (M8) wandern in die Hilfe.

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

### Entwurf, Speichern, Verwerfen (#309, #333)

- **Seitenfenster:** Mit Änderungen fragen Esc, ✕, Klick daneben und „Abbrechen“ nach „Änderungen verwerfen?“. Startfokus liegt auf **„Abbrechen“**, weil Verwerfen gefährlich ist. Ohne Änderungen schließt das Fenster sofort.
- **Karte:** Der Hinweis „Ungespeicherte Änderungen“ steht neben „Speichern“. Beim Verlassen der Seite wird gefragt (`useOpenForm` wie heute beim Objektwechsel, `beforeunload` wie bei Primer).
- **Entwurf am Feld:** `DraftActions` bleibt der Baustein.

### Datum, Monat, Geld

- **Tag:** natives `<input type="date">`. Es funktioniert in allen Engines, das Format folgt der Sprache des Browsers (deutsches System: TT.MM.JJJJ). In der Probe zeigten englisch eingestellte Browser MM/TT/JJJJ; das gehört in die Hilfe.
- **Monat:** `MonthField` ersetzt `MonthPicker` (#287). Es ist ein **Textfeld**, das „3.2025“, „03/25“, „2025-03“, „März 2025“ und „Mrz 27“ versteht, **plus** einem Knopf ▦ für das Raster: 12 Monate in 3 Spalten, Jahr mit ‹ ›, Tastatur nach dem APG-Grid-Muster (Pfeile, Pos1/Ende, Bild↑/↓ für das Jahr, Enter, Esc). GOV.UK sagt dazu: Kalender nie als einzige Eingabe ([Dates](https://design-system.service.gov.uk/patterns/dates/)). Ein ungültiger Text wird nicht verworfen, sondern ergibt einen Feldfehler. Die Personenstaffel nimmt ebenfalls den Monat statt eines Datums (M11) oder bewusst ein Datum, aber nicht gemischt.
- **Geld:** `MoneyInput` als Textfeld mit `inputMode="decimal"`, rechtsbündig, Ziffern gleich breit, Einheit „€“ als Anhängsel. Gelesen wird über `parseEuro`, ausgegeben über `fmtEuro` (wie heute). Kein `type="number"`, das „650,00“ je nach Browser anders liest.
- **Zahlen mit Einheit** (Zählerstand, m², kWh): dasselbe Anhängsel mit Einheit (N4, H5: die Einheit kommt vom Zähler).

## 4. Dialoge, Seitenfenster, Rückfragen, Mitteilungen

- **Seitenfenster:**
  - `<dialog class="drawer">` mit `showModal()`: Top-Layer und inerter Hintergrund (M4); Esc und Fokusrückgabe übernimmt der Browser.
  - Kopf (Titel `h2`, Untertitel, ✕), scrollender Körper, fester Fuß mit Sammelmeldung und Knöpfen.
  - Am Handy füllt es die volle Breite, die Knöpfe liegen nebeneinander über die ganze Breite, „Strg+S speichert“ ist ausgeblendet (MOB4).
  - **Zwei Pflichtregeln im Baustein:** `onClose`/`onCancel` nur bei `e.target === e.currentTarget` (React reicht verschachtelte Ereignisse weiter; in der Probe schloss sonst „Weiter bearbeiten“ das ganze Fenster), und das erste Feld nach `showModal()` selbst fokussieren (React setzt `autoFocus` beim Einhängen, solange der `<dialog>` noch geschlossen ist, und `showModal()` fokussiert dann das erste fokussierbare Element, also ✕).
  - Ein modaler `<dialog>` macht den Hintergrund inert. Nach dem letzten Element geht der Fokus in die Bedienleiste des Browsers und von dort zurück in den Dialog; das ist die Plattform und nicht das, was M4 beschreibt (dort landete Tab in der Seitenleiste). Einen harten Ring bräuchte zwei Wächter-Elemente und rund 15 Zeilen.
- **Rückfrage:**
  - `<dialog class="confirm" role="alertdialog">`, Titel als Frage, ein Satz Folge.
  - Knöpfe „Abbrechen“ und Verb, bei Gefahr ist das Verb rot und **der Startfokus liegt auf „Abbrechen“** (H1).
  - **Kein globaler Enter-Abfänger**: Enter wirkt auf den Knopf mit Fokus. In der Probe gemessen: Enter auf „Abbrechen“ lässt das Fenster offen, in allen drei Engines.
- **Mitteilung (Toast):**
  - Erfolg mit `role="status"` (höflich), Fehler mit `role="alert"` und 8 s Anzeigedauer.
  - Am Handy über der unteren Leiste.
  - Nur für Rückmeldungen nach einer Aktion, nie als einzige Stelle für einen Fehler, der ein Feld betrifft.
- **Begriff und Monatsraster:** `popover="auto"` (Klick daneben, Esc). Den Fokus gibt der Baustein im `toggle`-Ereignis zurück, das tut der Browser nicht in jedem Fall.
- **Ältere Browser:** `popover` braucht Safari 17 und Firefox 125. Ohne `HTMLElement.prototype.showPopover` wird das Raster inline unter dem Feld gezeigt (rund 10 Zeilen).

## 5. Tabellen und Listen, auch mobil

- **Breit:**
  - Kopf in Versalien, klein und grau; Zahlen rechtsbündig mit gleich breiten Ziffern.
  - Aktionen als Knopf „Bearbeiten“ mit `aria-label` „Anna Beispiel bearbeiten“ am rechten Rand, Mülleimer erst im Seitenfenster.
  - Die Tabelle scrollt in ihrer Karte (`Table.tsx` heute), die Seite nie (Breitentest „keine Seite breiter als 390 px“, siehe 9c).
- **Schmal (< 640 px): Karten statt Seitwärtsscrollen**, für Listen mit Datensätzen:
  - Die Zeile wird zum Block: erste Spalte fett als Titel, die übrigen mit ihrer Spaltenbeschriftung („Wohnung: EG links“), Aktion rechts.
  - Umgesetzt mit `.table.stack` und `data-label` am `td`, ohne zweites Markup und ohne JS. Für Vorleser bleibt es eine Tabelle.
- **Ausnahme Zahlenraster** (Mietkonto mit 12 Monaten, Abrechnungstabellen, Kostenvergleich): Dort trägt der Vergleich über Spalten die Bedeutung. Sie bleiben Tabellen mit Scrollen in der Karte, mit **erster Spalte angeheftet** (`position: sticky; left: 0`) und dem Hinweis „Weitere Spalten rechts“ nur, wenn wirklich gescrollt werden kann (N6).
- **Leere Liste:** ein Satz, was hier stehen wird, und der Knopf, mit dem man anfängt (siehe 6).

## 6. Hinweise, Ampel, Leerzustände

- **Hinweis (`Notice`)** in drei Stufen, wie `notices` (#112): `error` (rot), `warning` (gelb), `hint` (grau-blau). Die Stufe steht nicht nur in der Farbe, sondern auch im Symbol und im Wort. Aufbau: fetter Titel, **ein** Satz „was tun“, dann „Hier beheben →“. Der Rest liegt unter „Mehr dazu“ (M8).
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
| `ErrorSummary` / `FormError` | eigen | H3, H4, M5, 58 `className="error"`-Stellen | M |
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
| S12 Dialoge | `<dialog`, `role="dialog"`, `showModal` nur in `Drawer`, `ConfirmDialog`, `AppShell`; `popover` nur in `Term`, `MonthField` | eigene Overlays je Seite |
| S13 Enter | kein `'Enter'` in einem `keydown`-Handler eines Dialogbausteins | Wiederkehr von H1 |
| S14 Monat/Datum | kein `type="month"`, `type="number"` für Geld, kein zweites Monatsfeld | #287 |
| S15 Fehler | kein `className="error"`/`role="alert"` außerhalb `Field`, `ErrorSummary`, `Toast`, `DraftActions` | M5, H3 |
| S16 Verben | Primärknopf in `Drawer footer` nur `Anlegen`/`Speichern`; „Abbrechen“ nie primär | N3 |
| S17 Tokens | keine Hex-Farben und keine px-Abstände außerhalb der Token-Blöcke in `index.css`/`tw.css`; in Klassen keine beliebigen Werte (`[#…]`, `[13px]`), keine Standardpalette | Gestaltung driftet |
| S18 Jahr/Objekt | kein `<select>` mit Jahr/Objekt in `pages/` außer über `AppShell` | M13 |
| S19 Formularmuster | eine Seite hat entweder `Drawer` oder Karten-Speichern je Formular; kein zweites `type="submit"` in derselben Karte | M18, N8 |
| S20 Tailwind | keine neue Klasse in `index.css` mit dem Namen einer Utility (heute `grow`, `grow-2`, `sr-only`); `index.css` wird nur kleiner (Zeilenzahl als Obergrenze im Test) | Kollision, Rückfall ins alte CSS |
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

Jeder Schritt ist ein PR mit `Refs #346` (und, wo er einen Befund der Checkliste behebt, `Refs #341`), wirkt für sich und lässt die App in jedem Zwischenstand einheitlich. Reihenfolge: zuerst die Fehler, die Daten kosten (Rückfrage, Seitenfenster), dann Fehlermeldungen, dann die Formularmuster, zuletzt Mobil und Gestaltung.

| # | Schritt | Befunde | Aufwand | Wächter neu |
|---|---|---|---|---|
| 0 | **Tailwind einführen**: `tw.css` mit `index.css` als Schicht `legacy`, Tokens in `@theme`, `dark`- und `print`-Variante; Pixelvergleich alt gegen neu in drei Engines | Grundlage | 1 Tag | S17, S20 |
| 1 | **Rückfrage auf `<dialog>`**: Enter-Abfänger raus, Startfokus „Abbrechen“ bei Gefahr, `alertdialog`. *Teile schon mit PR #343 erledigt: Enter wirkt auf den Knopf mit Fokus, Startfokus bei Gefahr, Fokusfalle.* Offen bleibt die Umstellung auf `<dialog>` | H1 | ½ Tag | S13 |
| 2 | **`Drawer` auf `<dialog>.showModal()`**, Rückfrage beim Schließen mit Änderungen, Fokus zurück, `target`-Prüfung. Alle 9 Seitenfenster profitieren auf einmal | M4, MOB4 | 1 Tag | S12 |
| 3 | **`Field` + `ErrorSummary`** im Fensterfuß und in Karten, Feldfehler mit Ort; zuerst Zähler/Ablesung, Vorauszahlung, Mietkonto, HeatingSelfSetup, Heizkosten-Karten. *Teile schon mit PR #343 erledigt: `FormError` an der Ablesung auf der Zähler-Seite.* Offen bleiben `Field`, `ErrorSummary` und die übrigen Stellen | H3, H4, M5, M12 | 2–3 Tage | S15 |
| 4 | **Tokens** in `index.css` (Abstand, Schrift, Radius, Ziel, Fokus), Feldbeschriftung in `--text` | Grundlage | 1 Tag | S17 |
| 5 | **`MonthField`** statt `MonthPicker`, Personenstaffel einheitlich | #287, M11 | 1–2 Tage | S14 |
| 6 | **`Term` als Popover**, eigener Begriff `tightMarket` | M1, M2, MOB3 | 1 Tag | – |
| 7 | **Formularmuster zurückführen**: Ablesung, Lieferung, Mieterwechsel und Zeitraumwechsel ins Seitenfenster; Heizkosten auf ein Speichern je Karte; Sofortspeichern → Entwurf am Feld; feste Verben | M18, N3, N8, N16, M19 | 3–4 Tage | S16, S19 |
| 8 | **Jahr/Objekt nur in der Seitenleiste**, Seiten zeigen an | M13, N1 | 1 Tag | S18 |
| 9 | **Mobil**: angehefteter Kopf, Menüblatt, untere Leiste, Tabellen → Karten, `guide-norm` umbrechen | MOB1, MOB2, M10, M15 | 2–3 Tage | Breitentest |
| 10 | **Hinweise/Leerzustände/Druck**: „Was tun“ + „Mehr dazu“, Cockpit nach Versand, Druck-Rückfrage bei Fehlern, Druckkopf | M8, M9, M14, H6, N5, N12 | 2 Tage | – |
| 11 | **Browserlauf + axe** als Skript, Musterseite in `npm run screenshots` | alle | 1 Tag | c) |

**Zusammen etwa 16–21 Arbeitstage**; neue Abhängigkeit ist nur Tailwind (devDependency, MIT). Die Fachbefunde H5 (MWh), M3, M6, M7 und N2 sind keine Musterfragen und laufen getrennt. Schritt 1–3 decken alle hohen Befunde außer H5/H6 ab und sind in rund einer Woche zu haben.

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
