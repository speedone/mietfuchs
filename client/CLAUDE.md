# Oberfläche

Aus der CLAUDE.md im Wurzelordner hierher verschoben: Bausteine, Konventionen der Oberfläche,
Hinweise, Lexikon, Anleitungen, Navigation, Stile.

**Dargestellt wird jeder Hinweis über den Baustein `Notice`** (#346, Schritt 10, M8;
[client/src/components/Notice.tsx](src/components/Notice.tsx)): Stufe als Zeichen und Wort, fetter
Titel, der Text, „Hier beheben →“, und unter „Mehr dazu“ (eingeklappt, im Druck immer da) **nur
Begründungen aus Fundstellen**. Für Hinweise der Berechnung (`CalcNotice`) wird der Text des Servers nur in
Sätze zerlegt ([client/src/noticeText.ts](src/noticeText.ts)). **Sichtbar bleibt grundsätzlich
alles**: Ein Satz, der zuerst „ein Satz was tun“ zeigte, verlor bei allen Kürzungs-Codes Prozentzahl und
Beträge und ließ Pronomen ohne Bezug stehen (Durchsicht M1, M2). Eingeklappt wird nur ein Satz, der nach
Abzug seiner Fundstellen (Normen, Urteile mit Aktenzeichen, Drucksachen, Randnummern) weder eine
Prozentzahl, einen Betrag, ein Datum, eine Kürzung, eine Aufforderung noch eine Folge für Geld oder
Pflichten trägt und überwiegend aus Fundstellen besteht oder ein Urteil oder eine Drucksache als Beleg
nennt (`isCitationSentence`); verweist ein sichtbarer Satz danach mit einem Pronomen auf ihn, bleibt er
sichtbar. Ein Fehler (Stufe `error`) steht ganz offen (#236). Geprüft über echte Texte je Code
(`client/src/testing/noticeSamples.json`, je Code der längste Text aus den Server-Tests; neu erzeugen, wenn
calc.ts Texte ändert). Kein Feld `action` am Server: Es wären rund 180 zweite Texte, die vom ersten
wegliefen, und eingefrorene Abrechnungen hätten es nicht. Abkürzungen („Abs.“, „S.“, „z. B.“), Daten und
„am 6. April“ beenden keinen Satz. Seitentexte nehmen `NoticeBox` (Titel, Text, Rest von Hand gesetzt) oder
`TextNotice` für einen fertigen Text. Wächter S26: Stufenklasse und -wort nur im Baustein, und freie Kästen
`className="notice|error|hint"` nur noch nach Ausnahmeliste mit Anzahl, die nur sinkt.
**Leerzustände** (`EmptyState`, [client/src/emptyStock.ts](src/emptyStock.ts)): Im leeren Zeitraum
nennen Cockpit und Abrechnung den ersten fehlenden Schritt mit Knopf (Wohnung, Mietverhältnis, Belege),
ohne „Entwurf“, Frist, Kennzahlen, Druckeinstellungen und Rechtsstand; ein gesperrter Knopf nennt seinen
Grund daneben (`aria-describedby`). Nach dem Abschluss nennt die Unterzeile des Cockpits den Stand und die
offenen Punkte beim Namen (`cockpitSubtitle`, M9); abgeschlossen ohne Versanddatum zeigt sie die Frist, die
weiterläuft, und ein Versand nach Ablauf der Frist steht ausdrücklich da. Die Kopfzeile im Druck lässt einen
Objektnamen weg, der schon am Anfang der Adresse steht (`letterhead`), und die Abrechnung trägt Datum und
Anschrift des Mieters (`recipientLines`, N5); ist der Mieter ausgezogen und fehlt die Anschrift für den
Schriftverkehr, warnt die Seite vor dem Druck (`printsFormerAddress`, #229).

**Begriffslexikon** (#113): [shared/glossary.ts](../shared/glossary.ts) hält jeden Fachbegriff mit
Erklärung, Beispiel mit Zahlen, Rechtsgrundlage und „Brauche ich das?“. Es war der **erste
Laufzeitanteil in `shared/`**; der Client bündelt ihn (dafür `allowImportingTsExtensions` in
client/tsconfig.json), der Server braucht nur den Typ `TermId`. Seit #140 lädt auch der Server
Laufzeitanteile aus `shared/` (seit #141 `allocation.ts` und `duplicates.ts`, seit #170
`costItem.ts`, `assessment.ts` und `categories.ts`), zuerst [shared/heating.ts](../shared/heating.ts): Heizkostenart, § 2 HeizkostenV
(eine Garage zählt nicht als Wohnung) und welche Wohnung bei welcher Heizposition ohne
Verbrauchsanteil dasteht. Das Cockpit wendet die Regel nicht selbst an, sondern liest den Hinweis
`heating.not-by-consumption` der Abrechnung (client/src/meterCheck.ts). Jeder Hinweis-Code in
`noticeKinds` trägt mindestens einen Begriff (`terms`, als nicht leeres Tupel getippt, dazu
[glossary.test.ts](../server/test/glossary.test.ts)). In der Oberfläche zeigt
[Term.tsx](src/components/Term.tsx) die Erklärung, und zwar über einen Auslöser als `span`
mit `role="button"`: In einem `<label>` wäre ein `<button>` das erste bedienbare Element und
nähme dem Eingabefeld die Beschriftung. Seit #346 Schritt 6 ist die Erklärung ein Popover
(`usePopover`, siehe „Ein Monat ist ein Monatsfeld“): hinter dem Begriff ein „?“ (gezeichnet von CSS,
Utility `term-q`, inline und für Vorleser ausgeblendet, damit der Name des Felds seine Beschriftung
bleibt; Tippfläche `--target` über `::after`), die Erklärung im Top-Layer, nicht im Label, am Handy als
Blatt unten (höchstens 60 % der Höhe). Sie zeigt Erklärung und Beispiel; Rechtsgrundlage und „Brauche ich
das?“ stehen in der Hilfe, dorthin führt „Mehr in ‚Hilfe & Begriffe‘ →“ (ein Link, über `TermHelp` aus
App.tsx mit `navigate`, also mit Rückfrage bei offenem Formular; die Hilfe springt mit `focusTerm` zum
Begriff, einmal: danach meldet sie `onFocusTermDone`, und die App vergisst den Sprung). Esc schließt nur die Erklärung, auch im Seitenfenster. Die Seite „Hilfe & Begriffe“ listet alle. Rechtsaussagen
nur, wo sie im Gesetz stehen; Beispiele werden nachgerechnet. Lexikon und Anleitungen nehmen ihre
Rechtszahlen aus dem Rechtsregister.

**Anleitungen je Vermietungsart** (#164): [shared/guides.ts](../shared/guides.ts) hält acht
Anleitungen (Einliegerwohnung, Mehrfamilienhaus, Eigentumswohnung, mehrere Objekte, Garage,
Pauschale/Inklusivmiete, Messdienst, Mieterwechsel/Leerstand), jede mit „Trifft das auf Sie zu?“,
Schritten mit Sprung, „Was Mietfuchs daraus macht“, Beispiel, „Worauf Sie achten müssen“
(Rechtliches nur mit `norm`) und „Was Mietfuchs (noch) nicht kann“ (mit `issue`). Die Seite
„Hilfe & Begriffe“ zeigt sie aufklappbar über den Begriffen, eine Suche gilt für beide. Die
Sprungziele (`GUIDE_PAGES`) sind Kennungen der Navigation; [client/src/nav.ts](src/nav.ts)
hält `Tab` und `NAV` (aus App.tsx herausgezogen) und übersetzt nur, wenn jede davon eine Seite
ist. [guides.test.ts](../server/test/guides.test.ts) **rechnet jedes Beispiel mit der Berechnung
nach** (`computeSettlement`, `taxReport`) und verlangt die Beträge wörtlich im Text, und es
verlangt jede Beschriftung in „…“ der Schritte wörtlich in der Oberfläche: Wer eine Schaltfläche
umbenennt oder die Verteilung ändert, sieht die Anleitung rot werden. **Die Grenze dieses
Wächters**: Er sucht den Wortlaut im Quelltext (client/src und shared/, `&amp;` aufgelöst), nicht in
der gerenderten Seite; ein Zitat besteht also auch, wenn der Text nur in einem Kommentar oder auf
einer anderen Seite steht, und Text, den JSX zerlegt (ein `<Term>` im Satz, `{year}` im Knopf),
findet er nicht und darf deshalb nicht zitiert werden. Beschrieben wird nur, was Mietfuchs auf dem
Stand des Zweigs kann; wo Mietfuchs eine nicht abschließend geklärte Frage selbst auslegt
(Leerstand beim Personenschlüssel, #177), sagt die Anleitung das, statt einen Ausweg zu raten. Auf der Seite sind
Anleitungstitel und Begriffe `h3`, die Abschnitte einer Anleitung `h4`; bei einer Suche sind die
Treffer aufgeklappt, und ein Sprung beginnt oben auf der Zielseite.

**Client** ([client/src/](src)): React ohne Router — `App.tsx` schaltet per State
zwischen den Seiten (`pages/`: Cockpit, Schnellerfassung, Zaehler, Kosten, Mietkonto,
Abrechnung, Uebersicht/Kostenvergleich, Steuer, Stammdaten, Belege, Einstellungen), gruppiert
nach Arbeitsphase in der Sidebar (das Abrechnungsjahr liegt zentral im `YearProvider`,
[client/src/year.tsx](src/year.tsx)). Dark Mode über `data-theme` auf `<html>` + CSS-Variablen (Umschalter in der
Sidebar, Druck ist immer hell); PWA-Manifest und Icons liegen in `client/public/` (Icons
erzeugt `server/scripts/make-icons.mjs`).

**Mobile Navigation** (#346, Schritt 9, [MobileNav.tsx](src/components/MobileNav.tsx)): Unter
900 px (`MOBILE_QUERY`, dieselbe Grenze wie in index.css) zeichnet App.tsx statt der Seitenleiste einen
angehefteten Kopf (☰, Seitentitel, „Objekt · Zeitraum“, ⇅), ein Menüblatt als `<dialog>` mit
`showModal()` und eine untere Leiste (`BOTTOM_TABS` in nav.ts, kurze Beschriftung `short`). Das Blatt
zeigt **denselben Inhalt wie die Seitenleiste** (`sidebar(close)` in App.tsx), ⇅ öffnet es mit dem Fokus
auf der Objektwahl. Die Wahl einer Seite schließt es; Objekt und Zeitraum wechseln darin **ohne** zu
schließen, wie in der Seitenleiste, denn ein Auswahlfeld sendet bei jeder Pfeiltaste `change`. Eine
Rückfrage (offenes Formular, Beenden) liegt seit Schritt 1 im Top-Layer über dem Blatt; es bleibt dafür
offen, und eine Seite schließt es erst, wenn der Wechsel feststeht. Ein Seitenfenster ist
modal; solange es offen ist, sind Kopf und untere Leiste inert, das Blatt lässt sich darüber nicht öffnen. Der Fokus geht an den Knopf zurück, der es geöffnet hat,
und nach einem Wechsel über die Grenze an die aktuelle Seite bzw. ☰. Gezeichnet wird nach
`matchMedia` und nicht nur per CSS, damit kein Eintrag doppelt im Baum steht; Tests stellen den Query
samt `change` nach (mobileNav.test.tsx) und nehmen für `showModal` den Nachbau aus
[client/src/testing/dialog.ts](src/testing/dialog.ts). Tabellen mit Datensätzen werden unter
640 px zu Karten (`<Table className="stacked">`, jede Zelle mit `data-label`), Zahlenraster heften die
erste Spalte an (`sticky-first`), beides nur am Bildschirm. Sicherheitsränder (Kerbe, Home-Indikator) über
`viewport-fit=cover` in index.html und `env(safe-area-inset-*)`, auch an Seitenfenster, Rückfrage, Toasts und
Fuß der Seitenleiste. Wächter in uiRules.test.ts: S24 (was am Fensterrand steht, nimmt die Sicherheitsränder),
S12 (Dialoge nur in erlaubten Bausteinen), S22 (Navigation nur aus nav.ts), S23 (Karten mit `data-label`).

Zentraler Fetch-Wrapper `api()` und Geld-/Datums-Helfer (`parseEuro`, `fmtEuro`, `fmtDate`) in
[client/src/api.ts](src/api.ts). Druck/PDF läuft über die Browser-Druckfunktion;
hochgeladene Belege werden für den Druck per **pdf.js** auf Canvas gerendert
([client/src/pdfPreview.ts](src/pdfPreview.ts)) — die zugehörigen pdf.js-WASM/Font-
Assets werden im Build via `vite-plugin-static-copy` nach `dist/pdfjs/` kopiert. pdf.js wird
für Druck und Upload über [client/src/pdf.ts](src/pdf.ts) geladen, bewusst in der
legacy-Fassung (`pdfjs-dist/legacy/build`): Die moderne setzt die allerneuesten Browser voraus.
Ein Test mit echtem pdf.js ([pdfIntake.pdfjs.test.ts](src/pdfIntake.pdfjs.test.ts))
schlägt fehl, wenn jemand auf die moderne Fassung zurückwechselt.

**Stile: Tailwind v4 neben index.css** (#346): Einstieg ist [client/src/tw.css](src/tw.css),
eingebunden in main.tsx über `@tailwindcss/vite` (nur Bauzeit, das native `@tailwindcss/oxide`
läuft unter Node beim `vite build`; die Programmdatei bettet fertiges CSS ein). index.css steht
dort vollständig in der Schicht `legacy`, Utilities liegen darüber und gewinnen gegen jede alte
Regel. Weiteres CSS kommt nur über tw.css in eine Schicht; ungeschichtet gewönne es gegen alle.
`!important` in `legacy` gewinnt dagegen gegen jede Utility, auch gegen `!flex` oder `print:`
(bei wichtigen Deklarationen kehrt sich die Reihenfolge der Schichten um); das ist für
`.no-print` und die Ausblendungen im Druck gewollt. `dark:` gilt nur am Bildschirm, denn der
Druck ist immer hell. **Die Tokens in index.css bleiben die einzige Quelle**: `@theme inline` macht sie als
`bg-card`, `text-muted`, `border-line` … benutzbar und wechselt so mit `data-theme` von selbst;
die Standardpalette ist abgeschaltet (`--color-*: initial`). **Kein Preflight**, solange index.css
lebt, denn das bisherige Aussehen beruht auf den Vorgaben des Browsers. Tailwind erzeugt eine
Utility für jedes passende Wort in client/src (Tests ausgenommen), auch in Kommentaren; wo das mit
einer Klasse aus index.css zusammenfällt (`sr-only`, `grow`, `grow-2`), nimmt tw.css sie mit
`@source not inline` heraus, und Animationen in index.css heißen nicht wie eine aus dem Theme
(deshalb `spinner-spin`). Wächter in [uiRules.test.ts](src/uiRules.test.ts), die Tailwind
selbst fragen: S4 nimmt Utilities als Regel an, S17 verbietet beliebige Werte (`p-[13px]`) und
die Standardpalette in jedem Wort, das Tailwinds Scanner in .ts und .tsx findet (nicht nur in
`className`), S20 verbietet eine neue Klasse oder Animation in index.css mit
einem Namen aus Tailwind und hält die Zahl der Regelzeilen von index.css als Obergrenze (nur kleiner; Token-Deklarationen zählen nicht, neue Farben gehören als Token-Paar dorthin).
Schritt 0 hat nichts sichtbar geändert: Pixelvergleich alt gegen neu in Chromium, Firefox und
WebKit, hell und dunkel, 1440 und 390 Bildpunkte und im Druck.

**Gestaltung „Mittelweg“ und Tokens** (#346, Schritt 4; Werte und Kontraste in Abschnitt 1 von
[docs/superpowers/specs/2026-10-18-oberflaeche-gesamtkonzept-design.md](../docs/superpowers/specs/2026-10-18-oberflaeche-gesamtkonzept-design.md)):
neutrale zinc-Flächen, weiße Karten mit feiner Linie, helle Seitenleiste; Indigo nur für
Primärknopf, Links, Fortschritt, Fokus, aktiven Menüpunkt und Objekt-Marke. Drei Knopfarten:
`.btn` (primär), `.btn.secondary` und `.btn.ghost` (beide weiß mit Rahmen), `.btn.danger`. Neben
den Farben stehen in `:root` Abstand (`--space-N` = N × 4 px), Schrift (`--text-xs … --text-2xl`),
Gewicht (`--weight-*`), Radius (`--radius-s/m/l/xl`), `--target` (36 px, 44 px bei Finger oder
< 640 px) und `--focus-ring`; tw.css bildet sie mit `@theme inline reference` auf `p-N`, `text-s`,
`font-strong`, `rounded-l`, `shadow-1` ab und entfernt die Standardskalen (auch die Schatten, die feste Farben tragen). Die dunklen Tokens stehen in
`@media not print`, gedruckt wird also immer mit den hellen. **Farben nur in Blöcken mit dem
Selektor `:root`**: S17 verbietet Hex- und rgba-Werte in jeder anderen Regel von index.css und
tw.css, eine neue Farbe kommt als Token-Paar hell/dunkel, und S6 rechnet die Kontraste der
Paare nach (Text, Nebentext, Links, Knöpfe, aktiver Menüpunkt, Hover-Fläche, Hinweise, Feldrand mit 3:1).
Kästchen und Optionsfelder haben eine eigene Fokusregel (Wächter), kleine Knöpfe am Handy eine
Tippfläche von `--target` über `::after`, und printCss.test.ts verlangt den dunklen Block in `@media not print`.

## Konventionen der Oberfläche

- **Eine Meldung steht am Feld und in der Sammelmeldung** (#341, #346 Schritt 3, nach GOV.UK). Eine
  Fehler-API: `useFormError<F>()` mit `<ErrorSummary errors>`
  ([client/src/components/ErrorSummary.tsx](src/components/ErrorSummary.tsx)) und `<Field>`
  ([client/src/components/Field.tsx](src/components/Field.tsx)); `FormError` aus #343 ist darin
  aufgegangen. Die Prüfungen der umgestellten Formulare liefern `Problem`e
  ([client/src/formProblems.ts](src/formProblems.ts)): Feld, kurze Fassung für das Feld („Datum
  fehlt“) und Satz mit Ort für die Sammelmeldung, **alle auf einmal und je mit Feld**, kein Sammelsatz für
  mehrere Felder (M5). So arbeiten `paymentBody`, `buildReadingBody`, `buildUnitBody`, `tenancyRequired`,
  `meterBody`/`meterPlantId`, `propertyBody` und `selfSetupBody` (die letzten drei nennen zusätzlich die
  erste Meldung als `error`, für ältere Aufrufer). Die Kostenposition meldet ihre Felder (Beschreibung,
  Betrag, §35a-Lohn, Ziel) zusammen über `costFieldProblems` in costForm.ts; die übrigen Regeln der
  gemeinsamen Prüfung in shared/costItem.ts geben weiter die erste Meldung, als Satz mit Ort und ohne Feld.
  Die Staffeln des Mietverhältnisses ebenso. `report(problems)` meldet, `show(text)` eine Meldung ohne Feld (die
  Ablehnung durch den Server), `set(text)` ersetzt das frühere `setError`. Jedes Melden setzt den Fokus auf
  die Sammelmeldung und rollt sie ins Bild, auch beim selben Text (`seq`); ein Ladefehler nimmt mit
  `{ focus: false }` keinen Fokus. `role="alert"` sitzt **innen**, der Fokus außen; ein `aria-labelledby`
  trägt das äußere `<div>` nicht (ohne Rolle untersagt, axe `aria-prohibited-attr`). Ihre Zeilen sind Links
  aufs Feld (`idFor`), die einen zugeklappten `<details>` aufklappen. **`<Field label hint optional width>`**
  ist ein `<label class="field">` wie bisher (Raster und Seitenfenster setzen es unverändert) und vergibt
  `id`, `aria-labelledby` (nur die Beschriftung, sonst gehörten Hinweis und Fehler zum Namen),
  `aria-describedby` (Hinweis, Fehler) und `aria-invalid` selbst; `{...errors.field('date')}` reicht `id`,
  Meldung und `onFix` hinein, und `onFix` nimmt die Meldung beim Ändern des Felds an beiden Stellen weg.
  **Pflichtfelder tragen `required`**: ein Sternchen hinter der Beschriftung (für Vorleser ausgeblendet,
  außerhalb des Namens) und das HTML-Attribut `required` am Eingabefeld (Semantik für Vorleser, Browser,
  Autofill). Das Sternchen ist das bekannte Muster für die Zielgruppe; erklärt wird es durch die Legende
  „* Pflichtangabe“ (WCAG 3.3.2). Pflicht sind genau die Felder, deren Fehlen die Prüfung meldet
  (pages/requiredFields.test.tsx: „… fehlt“ ⇔ `required`); wo ein Feld als optional erklärt wird, heißt es
  „optional“. Die Legende zeigt der Drawer von selbst, sobald ein `<Field required>` darin steht
  (`RequiredScope`); außerhalb eines Seitenfensters setzt die Datei `<RequiredLegend />` (Wächter S25). Die
  Prüfung des Browsers greift nie vor: Ein `<form>` trägt immer `noValidate` (S25), ohne `<form>` prüft er
  nicht; gestaltet wird nie über `:invalid`/`:required` (S25), markiert nur über `aria-invalid`.
  Die Breitenstufen (`width`) und das Raster `field-grid` stehen unter „Felder in Stufen“. Die Fehlermeldung am Feld trägt ⚠ (für Vorleser ausgeblendet) und „Fehler:“
  (nur für Vorleser). **Im Seitenfenster** bekommt der Drawer die API (`errors`) und zeigt die
  Sammelmeldung im festen Fuß über den Knöpfen, höchstens 40 % der Höhe; **in einer Karte** steht sie oben
  in der Karte. Ein Eingabefeld mitten im Text (Entwurf am Feld, „✎ anpassen“) nimmt `FieldMessage`.
  **Aktionen ohne Formular** (Löschen) melden einen Fehler als Mitteilung (`toast(text, 'error')`, 8 s
  statt 3,2 s). Die Meldung oben auf der Seite bleibt für Ladefehler. Wächter S15 (uiRules.test.ts):
  `className="error"` und `role="alert"` nur in Field, ErrorSummary, feedback.tsx (Mitteilung, Ansage der
  Rückfrage) und DraftActions; was heute noch so steht (Ladefehler, Befunde einer Vorschau, die Ergebnisse
  der Belegauswertung), steht dort mit Anzahl und Grund und darf nur weniger werden.
- **Rückfragen** (`useConfirm`, [client/src/components/feedback.tsx](src/components/feedback.tsx),
  #341, #346 Schritt 1): ein `<dialog role="alertdialog">` mit `showModal()`, benannt durch den Titel
  (`aria-labelledby`) und beschrieben durch die Nachricht (`aria-describedby`). Er liegt im Top-Layer, auch
  über dem Menüblatt am Handy oder einem Seitenfenster; das Blatt muss deshalb vor einer Rückfrage nicht
  mehr schließen und bleibt nach „Abbrechen“ offen. **Es gibt keinen Abfänger für Enter** (Wächter S13):
  Enter wirkt auf den Knopf mit dem Fokus, das tut der Browser; auf einem anderen Element (etwa einem
  Begriff) erreicht es dieses. Bei `danger` steht der Startfokus auf „Abbrechen“, `defaultChoice:
  'confirm'` überstimmt das, `cancel` setzt ihn auch sonst dorthin; gesetzt wird er nach `showModal()`
  selbst, denn `autoFocus` griffe vor dem Öffnen. **Tab lenkt kein Baustein selbst**: `showModal()` macht
  den Rest inert, der Browser hält Tab im Dialog (nach dem letzten Element über die Bedienleiste zurück); ein
  eigener Ring sperrte einmal die Tastatur vor einem geschlossenen `<details>` ein. Esc bricht ab, schon am
  `keydown` (verhindert, damit Chrome ein zweites `cancel` ohne Nutzeraktion nicht durchlässt), außer ein
  Element darin hat Esc schon verhindert; ein Klick daneben auch, wenn er dort begann. Ein `close`, das
  ankommt, wenn der Dialog schon wieder offen ist, zählt nicht (der Browser sendet es als eigene Aufgabe).
  Beim Schließen geht der Fokus an den Auslöser zurück (`focusBack` in
  [dialogKeys.ts](src/components/dialogKeys.ts)); ist der ausgehängt und lag er in der Navigation,
  an die aktuelle Seite bzw. ☰. Eine zweite Rückfrage beantwortet eine offene mit „nein“; die dritte Wahl
  (`onAlternative`) läuft erst nach dem Schließen, damit eine Rückfrage daraus offen bleibt. **Mitteilungen**
  (`useToast`) sind ein `popover="manual"` und liegen damit über offenen Dialogen; weil alles außerhalb des
  obersten modalen Dialogs inert ist und nicht angesagt würde, steht jede Mitteilung dann zusätzlich in einer
  Ansage (`role="status"`, bei Fehlern `alert`, `sr-only`) in diesem Dialog.
  Safari fokussiert einen Knopf beim Mausklick nicht; dort greift die Rückgabe nur über die Tastatur. In
  jsdom bildet [testing/dialog.ts](src/testing/dialog.ts) `showModal()` nach (für jede Datei mit
  jsdom in vitestSetup.ts installiert, Esc erst nach einem nicht verhinderten `keydown`, `close` wie der
  Browser als eigene Aufgabe, `:modal`), und [testing/keys.ts](src/testing/keys.ts) (`press`) drückt
  eine Taste wie der Browser: Enter auf einem Knopf als Klick, Tab zum nächsten bedienbaren Element im
  obersten modalen Dialog (ohne Felder in geschlossenem `<details>`, mit `<summary>`). Tests suchen die Rückfrage mit `getByRole('alertdialog')`.
- **Seitenfenster** (`Drawer`, [client/src/components/Drawer.tsx](src/components/Drawer.tsx), #346
  Schritt 2): ein `<dialog>` mit `showModal()` von rechts, im Top-Layer, Hintergrund inert. Kopf mit Titel
  (`h2`) und ✕, scrollender Körper, fester Fuß mit Hinweis (`hint`), **„Abbrechen“ aus dem Baustein**
  (`cancelLabel`, `busy` sperrt alle Wege zum Schließen) und den Knöpfen des Formulars (`actions`).
  **Schließen mit Änderungen** (Esc, ✕, Klick daneben, „Abbrechen“) fragt „Änderungen verwerfen?“ mit
  Startfokus „Abbrechen“; ohne Änderungen schließt es sofort. Erkannt wird die Änderung am Pflicht-Prop
  `value` (der Stand des Formulars): verglichen mit `sameDraft` gegen den Stand vor der ersten Eingabe oder
  dem ersten Klick im Körper, gemerkt in der Einfangphase, also bevor React die Änderung verarbeitet. Nicht
  beim Öffnen, sonst gälte ein Formular, das nach dem Öffnen Vorgaben nachträgt, als geändert;
  zurückgesetzt gilt nicht als Änderung. **Nur ein geändertes Fenster meldet sich bei `useOpenForm` an**:
  Seite, Objekt und Zeitraum fragen bei einem unveränderten nicht nach. **`value` umfasst jeden Zustand,
  den das Fenster bearbeitet**, auch wenn er neben dem Formularobjekt liegt (Kosten: `{ form,
  heatingPlantId, heatingPeriod }`), aber nichts, was das Fenster nachlädt (Kesseltausch: `swap.form`, nicht
  die Zähler) und keine bloße Hilfe ohne Speicherwert (Zähler: die Jahreszahl für den Vorschlag der
  Eichfrist); was ein Feld nur umschreibt, wird vorher normalisiert (IBAN). **Zeigt ein offenes Fenster einen
  anderen Datensatz** („Stattdessen … bearbeiten“, „Hier beheben →“), ist das ein neues Formular: Die
  Aufrufer setzen `key` auf die Kennung (`form.id ?? 'neu'`). Esc wird am `keydown` verhindert (sonst ließe
  Chrome ein zweites `cancel` ohne Nutzeraktion nicht abbrechen), gilt aber nicht dem Fenster, wenn es zuerst
  etwas darin schließt: ein Element, das Esc schon verhindert hat (ein offener Begriff), ein offenes Popover,
  eine IME-Eingabe. `cancel` und `close` zählen nur am Fenster selbst (`e.target === e.currentTarget`), denn
  React reicht sie aus verschachtelten Dialogen weiter, und ein `close`, das ankommt, wenn das Fenster schon
  wieder offen ist, zählt nicht (StrictMode baut den Effekt ab und wieder auf, der Browser sendet `close` als
  eigene Aufgabe; sonst schloss im Entwicklungsbetrieb jedes Fenster sofort). Schließt der Browser es doch
  selbst, öffnet es mit Änderungen wieder und fragt. Tab lenkt der Browser (dialogKeys.ts). Das erste Feld bekommt den
  Fokus nach `showModal()` und, falls der Inhalt nachlädt, nach 60 ms noch einmal, wenn er noch auf ✕ steht
  (#352). Beim Aushängen geht der Fokus an den Auslöser zurück (`focusBack` in dialogKeys.ts). Mitteilungen
  liegen als `popover="manual"` über offenen Dialogen und werden im obersten angesagt (siehe Rückfragen). Wächter
  S12b in uiRules.test.ts: jedes `<Drawer>` hat `value` (kein fester Wert, auch kein `{}`), kein `footer`,
  und in `actions` keinen eigenen Weg zum Schließen (die Wörter des Bausteins, der Schließer des Aufrufers,
  kein `set…(null)`). Grenze: Ob `value` den ganzen Zustand umfasst, sieht der Wächter nicht; das prüft die
  Durchsicht. **Gespeichert wird über `useSaving`** ([client/src/useSaving.ts](src/useSaving.ts), Durchsicht S1 zu Schritt 7): `run(save)` lässt einen zweiten Aufruf fallen, solange der erste läuft (Sperre über eine Referenz), `busy` geht an den Drawer (dann sperrt er alle Wege zum Schließen und ruft bei Strg+S kein `onSubmit`) und an den Knopf; vorher legte ein Doppelklick die Ablesung zweimal an (doubleSave.test.tsx und je Aufrufer). **`changedFrom`** gibt einen Vergleichsstand von Anfang an vor: Ein vorbelegt geöffnetes Fenster (Lieferung mit KI-Vorschlag) gilt sofort als geändert und fragt auch bei Esc. Tests: `<dialog>` hat die Rolle `dialog`, die Rückfrage `alertdialog`;
  wer in einem Test mit Eingabe „Abbrechen“ klickt, bestätigt danach „Verwerfen“.
- **Feste Verben auf Knöpfen** (#346 Schritt 7, #341 N3 und M19). Im Seitenfenster heißt der Primärknopf
  „Anlegen“ (neu) oder „Speichern“ (bearbeiten), „Abbrechen“ kommt aus dem Baustein und ist nie primär. Kein
  „OK“, „Übernehmen“, „Hinzufügen“ oder „Umstellen“ als Primärknopf; eine Rückfrage nennt immer ihr Verb
  (`confirmLabel` ist Pflicht). Ein Knopf mit „+“ öffnet ein Fenster („+ Zähler anlegen“) oder fügt eine Zeile an
  („+ weitere Teilmenge“, „+ Erhöhung ab Monat …“); „… hinzufügen“ gibt es nicht. Ein Entwurf am Feld hat
  „Speichern“ und „Verwerfen“. Fachliche Verben bleiben, wo sie eine Handlung mit Folgen benennen und kein
  Seitenfenster speichern: „… abschließen“, „Buchen“, „Positionen anlegen“, „Zuordnen“, in Rückfragen auch
  „Umstellen“. Die eine Ausnahme im Seitenfenster ist „Anlegen und zu … wechseln“ (`createButtonLabel`): Es
  beginnt mit dem Verb und nennt die Folge. **Gefahrknöpfe** (`btn ghost danger-ghost`, rot beim Überfahren)
  tragen „…“, wenn eine Rückfrage folgt („Objekt löschen …“, „Wieder öffnen …“), und stehen mit `ml-auto` von
  einem „Speichern“ derselben Zeile ab. Wächter S16 in uiRules.test.ts; die Gefahrknöpfe ohne Rückfrage stehen
  dort mit Grund. Wer einen Knopf umbenennt, zieht die Anleitungen (shared/guides.ts, geprüft von
  guides.test.ts) und die Meldungen des Servers (ui-labels.test.ts) mit.
- **Etwas anlegen oder bearbeiten heißt Seitenfenster** (#346 Schritt 7, #341 M18, N16, N16a). Auch Ablesung
  (Zähler-Seite, „+ Ablesung anlegen“ im aufgeklappten Zähler), Lieferung (FuelCard, „+ Lieferung anlegen“ und „Ändern“),
  Mieterwechsel (`TenantChangeDrawer` in Stammdaten.tsx) und Zeitraumwechsel (PeriodCard, „Abrechnungszeitraum ändern“
  und „Wechsel ab … entfernen …“) sind `<Drawer>` mit `Field`, Sammelmeldung im Fuß und `required`. **Die Anfragen und
  Rümpfe sind dieselben wie vorher**, festgehalten mit `toEqual` in Zaehler.test.tsx, FuelCard.test.tsx,
  tenantChange.test.tsx und PeriodCard.flow.test.tsx (vor dem Umbau gegen die alte Oberfläche gelaufen). Der
  Mieterwechsel ist ein Formular statt dreier Schritte: `tenantChangeProblems` (tenantChange.ts) meldet alles auf einmal
  je Feld, danach baut `buildTenantChange` unverändert den Rumpf für `POST /api/tenancies/:id/change`; der Einzug folgt
  dem Auszug, bis er selbst geändert wird. Scheitert nach dem Speichern nur das Neuladen, ist das Fenster zu und die
  Karte „Mietverhältnisse“ sagt es. Beim Zeitraumwechsel bleibt die Vorschau mit `token` unverändert; „Speichern“ ist bis
  zur Vorschau gesperrt (mit Satz), bei abgelaufener Frist bis zur Bestätigung, und **jede Änderung des Formulars nach der
  Vorschau verwirft sie** samt Antworten und Bestätigung (Durchsicht M2: vorher wurde die alte Vorschau gespeichert). Die Lieferung prüft zuerst die
  Pflichtangaben je Feld (`fuelRequiredProblems` in fuelForm.ts), dann wie bisher `fuelBody`/`stockFuelBody`; eine mit der
  KI gelesene Rechnung meldet sich schon beim Öffnen bei `useOpenForm` an, ein von Hand geöffnetes Fenster erst mit der
  ersten Eingabe.
- **Eine Karte, ein Speichern; der Kopf ist der Baustein `Card`** (#346 Schritt 7, #341 N8, M18;
  [client/src/components/Card.tsx](src/components/Card.tsx)). `Card` setzt `section.card` mit `CardHeader`
  (Titel samt Begriff, höchstens eine Aktion rechts); Karten unter einem Abschnittstitel wie „Heizanlage, Heizperiode
  2025“ sind `level={3}` und sehen trotzdem aus wie jede Karte, ohne die Heizperiode im Titel zu wiederholen (außer
  „Ableseergebnis · …“, das gedruckt wird und dort ohne Abschnittstitel steht). Trägt eine
  Karte ein Formular, ist es ein Entwurf (`useDraft`) mit **einem** `<DraftActions layout="card">` am Fuß; die Prüfung
  meldet über die Sammelmeldung oben in der Karte und gibt `keepDraft` zurück (Co2FactsCard, HalfSplitCard, der Anteil
  in SelfHeatingCards). Was je Zeile einer Liste gespeichert wird, ist ein Entwurf am Feld in einer eigenen kleinen
  Komponente (`NoticeRow`, `MonthRow`, `TempField`, `GapReason`, `SlotGroup` in LawOverridesCard): `DraftActions` ohne
  `layout`, eine Meldung der Prüfung als geworfener Fehler, der am Feld steht. Wächter S19 in uiRules.test.ts: je Karte
  (`className="card…"` oder `<Card>`, verschachtelte Karten und Seitenfenster für sich) höchstens ein Speichern (ein
  Knopf „… speichern“, `type="submit"`, `layout="card"`); ein Knopf in einer Schleife zählt mehrfach. Und eine Karte,
  die ein Seitenfenster öffnet, speichert ihr Formular dort (Ausnahme mit Grund: PropertyCard). **Grenze**: Der Wächter
  liest den Quelltext; ein Speichern, das eine Unterkomponente in derselben Karte zeichnet, sieht er nicht.
- **Felder in Stufen, Neues anlegen oben rechts** (#346 Schritt 7b, nach einer Rückmeldung zur Objekt-Karte und zur
  Zähler-Seite). Die Breite gehört dem Eingabefeld: `<Field width>` mit `s` (`--field-s`, 8,5rem: Betrag, Datum, Monat
  samt ▦, PLZ, Fläche, Personen, Zählerstand), `m` (13rem, kurze Freitexte), `l` (21rem: Adresse, Name, Bezeichnung,
  IBAN) und `full` (Textfelder); ein Auswahlfeld ist so breit wie sein längster Eintrag, die Stufe ist dort nur
  die Mindestbreite. **Ohne Angabe gilt die Vorgabe nach Feldart** (`widthOf` in Field.tsx): Datum, Uhrzeit,
  `inputMode` decimal/numeric und Monat kurz, `<textarea>` voll, Auswahl nach Inhalt, sonst lang; dieselbe Regel steht
  per `:has()` in [client/src/fields.css](src/fields.css) und gilt damit auch für ein `label.field` von Hand.
  Ein Betrag oder eine Zahl braucht deshalb `inputMode`, sonst ist das Feld lang. fields.css hängt in tw.css als
  Schicht `components` (über index.css, unter den Utilities `width-s` … `width-full`, die nur `--field-w` und
  `--select-min` setzen); eine eigene Datei, weil Tailwind Regeln in tw.css für Utilities hielte (S20). Die Hülle
  ist `fit-content`, Hinweis und Meldung brechen darin um (`contain: inline-size`, mindestens `--field-hint`, 15rem;
  `hint-wide` 36rem für eine lange Frage). `field-grid` ist eine Zeile mit Umbruch, jedes Feld in seiner Breite, die
  Eingabefelder auf einer Linie; die frühere Spaltenteilung (`auto-fit, minmax(220px, 1fr)`) streckte und schnitt
  ab. Am Handy (bis 640 px) ist jedes Feld voll breit. `grow` und `wide` an Feldern und die px-Breiten `input-xs`
  usw. sind entfallen. **Aktionen:** Neues anlegen steht oben rechts, für die ganze Seite im Seitenkopf
  (`PageHeader actions`: Kosten, Zähler, Mietkonto), für eine Liste oder Karte im Kartenkopf (`Card`/`CardHeader
  aside`: Objekt, Wohnungen, Mietverhältnisse, Heizung, Lieferungen, Ablesungen im aufgeklappten Zähler); im Fuß
  einer Karte nur „Speichern“ links und Gefahrknöpfe rechts. Wächter S27 (jedes „+ … anlegen“ in einer dieser
  Props) und S28 (`<Field>` mit Funktion nennt `width`, keine Breite als Inline-Stil an Feldern, keine px-Breite an
  Eingabefeldern in index.css). **Der Browserlauf misst abgeschnittene Felder** je Seite und in jedem Seitenfenster
  (`clippedFields` in browser-check.mjs): ein Eingabefeld mit Wert über `scrollWidth` > `clientWidth` + 1, ein leeres
  mit Platzhalter über die Textbreite des Platzhalters gegen die Innenbreite (ein Platzhalter ist meist ein Beispiel
  und gehört zum Inhalt; die Quellen der Karte „Angaben zur Abrechnung (§ 6a)“ und die Suche im Belegordner sind
  deshalb voll breit, Durchsicht von #243, R-K11), ein Auswahlfeld gegen einen Klon mit nur dem gewählten Eintrag.
  Die Fenster öffnet `checkDrawers` über „+ … anlegen“, „… bearbeiten“ und die Knöpfe zum Ändern; mindestens 17 je
  Engine und Ansicht (`MIN_DRAWERS`), und ein Fenster, das mit Esc nicht schließt, ist ein Befund. Schneidet ein
  Feld ab, das schon die ganze verfügbare Breite nimmt (am Handy jedes), heißt der Befund „voll breit, Inhalt passt
  nicht“: Abhilfe ist ein kürzerer Eintrag oder Platzhalter mit der Erklärung als Hinweis am Feld (so „unbekannt“
  beim Bundesland, „Niemand“ bei der Frage, wer abrechnet). Was so bleiben soll, steht mit Grund in
  [scripts/browser-check-fields.json](../scripts/browser-check-fields.json) und wird nur weniger (heute leer). Die
  Selbstprobe bei jedem Aufruf setzt drei zu schmale Felder (Wert, Auswahl, Platzhalter) und ein voll breites ein.
  **Grenze:** Gemessen wird der gewählte Eintrag eines Auswahlfelds im Beispielbestand; lange Einträge, die dort nicht
  gewählt sind (gut 80 Einträge über 32 Zeichen, etwa in heatingForm.ts und heatingSelfForm.ts), sieht die Messung
  nicht. Ein Wächter im Quelltext dafür ist bewusst nicht gebaut: Die Einträge stehen verstreut in Konstanten und
  Funktionen, und gekürzt wird, was die Messung findet.
- **Ein Monat ist ein Monatsfeld** (`MonthField`, [client/src/components/MonthField.tsx](src/components/MonthField.tsx),
  #287, #346 Schritt 5): ein Textfeld in `Field`, das „3.2025“, „03/25“, „2025-03“, „März 2025“ und „Mrz 27“ liest
  (`parseMonthText` in [client/src/monthText.ts](src/monthText.ts), ohne DOM: ein Tag nur als Erster,
  zweistellige Jahre wie POSIX, Jahre 1900 bis 2100, ein Punkt am Ende zählt nicht; „1.10“ oder „01.12“ sind mehrdeutig,
  Tag.Monat ohne Jahr oder Monat.Jahr, und ergeben eine Meldung statt Januar 2010), dazu ▦ mit einem Raster als Popover (APG-Grid: Pfeile, Pos1/Ende,
  Bild auf/ab fürs Jahr, die Zellen sind Knöpfe mit `role="gridcell"`, Esc schließt nur das Raster, der Fokus geht an
  ▦ zurück; am Handy ein Blatt unten). Der Wert ist 'JJJJ-MM', ist der Text kein Monat, der Text selbst: Er wird nie
  verworfen, beim Verlassen steht die Meldung am Feld, und die Prüfung des Formulars meldet sie mit Ort (Staffeln je
  Zeile und Feld, `buildSchedule` mit `scheduleField`). Das Popover (`usePopover`,
  [client/src/components/popover.tsx](src/components/popover.tsx)) hängt über ein Portal im nächsten
  `<dialog>` bzw. in `body` und nicht im `<label>`, positioniert sich am Auslöser und gibt den Fokus selbst zurück.
  **Die Personenstaffel bleibt ein Datum**, denn `personDaysInPeriod` rechnet tagesgenau. Wächter S14 (kein
  `type="month"`, kein `type="number"`, kein zweites Monatsfeld, Monatsnamen nur in monthText.ts) und S12 (Popover nur
  in popover.tsx und den Mitteilungen; `usePopover` nehmen nur MonthField und Term). Den Inhalt zeichnet das Popover
  nur, solange es offen ist; sonst fände eine Abfrage nach Beschriftung auch die geschlossene Erklärung. In jsdom
  bildet testing/dialog.ts `beforetoggle`/`toggle` nach und macht ein offenes Popover sichtbar, damit Abfragen nach
  Rolle es finden. **Bekannte Grenze:** Ohne `showPopover` (Safari vor 17, Firefox
  vor 125) steht das Popover `position: fixed` über `hidden`; ist der umgebende `<dialog>` transformiert (Einfahren
  des Seitenfensters), bezieht sich `fixed` auf ihn, und die Lage aus `getBoundingClientRect` stimmt dann nicht. Nicht
  geprüft, kein alter Browser zur Hand (Durchsicht K6).
- **Objekt und Abrechnungszeitraum wählt nur die Seitenleiste** (#346 Schritt 8, #341 M13 und N1), am Handy
  das Menüblatt mit demselben Inhalt. Beide sind ein Baustein, `Switcher`
  ([client/src/components/Switcher.tsx](src/components/Switcher.tsx), Utility `switcher` in tw.css): der
  gewählte Eintrag als umbrechender Text mit ▾, das echte Auswahlfeld unsichtbar darüber, gleiche Höhe und Schrift.
  Jede Seite zeigt beides im Seitenkopf als **Kontextzeile** an („Lindenweg 12 · Abrechnungsjahr 2025“,
  `pageContextLine` in client/src/propertyView.ts; `PageHeader` mit `context`: `period` als Vorgabe, `calendar` für
  Mietkonto und Steuer, `property` für Stammdaten, `none` für Einstellungen und Hilfe). Am Bildschirm des Handys entfällt die
  Zeile, dort steht dieselbe Angabe im angehefteten Kopf; gedruckt wird sie immer. Der Fuß der Seitenleiste ist
  Teil der Scrollfläche und nicht angeheftet (#341 M15). Auf einer Seite bleiben nur andere Größen: das Kalenderjahr von
  Mietkonto und Steuer bei abweichendem Zeitraum (`CalendarYearSelect`), die Heizperiode, das „Jahr der Buchung“
  einer Auswertung, Objekt und Jahr eines Belegs im Posteingang und das Jahr der Zahlung einer Position. Der Wächter
  S18 (uiRules.test.ts) lässt die Bausteine der Seitenleiste nur in App.tsx zu und kein `<select>` in `pages/` oder
  `components/`, das Objekte, Jahre oder Zeiträume anbietet, außer den benannten Ausnahmen; Tests einer Seite, die
  den Zeitraum wechseln, stellen dafür `<PeriodSelect />` daneben wie die Seitenleiste.
- **Auswahlfelder und Häkchen speichern nicht beim Anklicken** (#309). Sofort gespeichert wird nur,
  was keine Daten ändert: der Wechsel von Zeitraum, Objekt oder Design und die Antwort auf die
  Frage nach der Update-Prüfung im Cockpit. Alles andere ist zuerst ein Entwurf: `useDraft(saved,
  { scope })` ([client/src/useDraft.ts](src/useDraft.ts), Logik ohne React in
  [client/src/draft.ts](src/draft.ts)) hält angezeigten Wert, `set`, `dirty`, `discard` und
  `save(fn)` (Doppelklick-Sperre, ein Fehler lässt den Entwurf stehen), übernimmt einen neuen
  gespeicherten Wert nur ohne offenen Entwurf und meldet sich, solange etwas geändert ist, bei
  `useOpenForm` an, damit ein Wechsel von Objekt oder Zeitraum nachfragt. `<DraftActions>`
  ([DraftActions.tsx](src/components/DraftActions.tsx)) zeigt „Speichern“ und „Verwerfen“
  nur bei einer Änderung, hinter dem Feld; `what` steht unsichtbar **hinter** dem sichtbaren Text
  („Speichern (Versanddatum)“) und nicht als `aria-label`, damit der Name mit dem beginnt, was auf
  dem Knopf steht (WCAG 2.5.3), auch bei „Speichert …“. Ein anderer `scope` verwirft den Entwurf;
  wechselt die Seite ihn selbst (der Reiter zwischen Betriebs- und Heizkostenabrechnung), fragt sie
  vorher mit `useConfirmDiscard` („Ungespeicherte Änderung verwerfen?“, Startfokus „Abbrechen“).
  **Auch der Seitenwechsel fragt** (#346, Schritt 7a): Jeder Wechsel der Seite geht über `navigate` in
  App.tsx, aus der Navigation (Seitenleiste, Menüblatt, untere Leiste) wie aus einer Seite („Hier
  beheben →“, „Position öffnen“, „Weiter prüfen“, Anleitung zum Update). Bei offenem Formular fragt es
  „Ungespeicherte Änderungen verwerfen?“ (Startfokus „Abbrechen“; das Menüblatt schließt vorher);
  wechselt dabei auch das Objekt, fragt nur dessen Rückfrage (`goViaProperty`). Mit offenem Formular
  fragt der Browser beim Schließen oder Neuladen des Tabs (`beforeunload`), und das Blatt „CO₂-Angaben
  für den Messdienst“, das die Seite Heizkosten ersetzt, fragt vor dem Öffnen. **Karten mit eigenem
  Formularzustand melden sich an**: mit `useOpenWhenDiffers(gezeigt, gespeichert)`, verglichen mit dem
  aus Props oder dem geladenen Stand abgeleiteten Wert in derselben Gestalt und ohne verborgene Felder;
  das zurückgegebene `markSaved()` nach dem Speichern aufrufen, dann fällt die Marke auch, wenn die Seite
  die Karte nicht neu einhängt oder der Server die Zahl anders schreibt. Ein Formular, das nur offen
  oder zu ist, nimmt `useOpenForm(offen)` und muss beim Abbrechen und Speichern wirklich zugehen. Schließt
  ein Knopf ein Formular und springt zugleich weg, schließt er es mit `flushSync` vorher (Belege, „Betrag
  prüfen“), sonst fände der Sprung die Marke noch. Der Wächter
  [openFormGuard.test.ts](src/openFormGuard.test.ts) findet Karten mit Eingaben und `api(` ohne
  Anmeldung (Ausnahmen mit Grund); Karten prüfen ihre Anmeldung mit `OpenFormScope` und `hasOpenForm`
  aus client/src/testing/openForm.tsx (Ändern, Speichern, Abbrechen). **Ein Auswahlfeld
  gibt `isValid` mit** (`useDraft(saved, { isValid })`): Fällt der Wert eines Entwurfs aus den
  Optionen (die Liste folgt einem anderen Feld, eine Position ist weg), ist der Entwurf verworfen;
  sonst zeigte der Browser den ersten Eintrag, und „Speichern“ schickte einen unsichtbaren Wert. Für
  eine Karte mit mehreren solchen Feldern gibt es **ein** „Speichern“ am Fuß (`<DraftActions
  layout="card">`, mit „Ungespeicherte Änderungen“; Muster „Karte mit einem Speichern“ der
  Spezifikation zu #346); der Entwurf ist dann ein Objekt, und gesendet wird nur, was sich geändert
  hat, damit eine geerbte Angabe nicht als eigene gespeichert wird (HeatingRulesCard, `rulesBody`).
  Kommt vor dem Speichern eine Rückfrage, ergibt `onSave` bei „Abbrechen“ `keepDraft`: Der Entwurf
  bleibt ohne Fehlermeldung stehen. Der Wächter
  [saveOnChange.test.ts](src/saveOnChange.test.ts) liest den Quelltext: Ein `<select>` oder
  ein `<input>` vom Typ checkbox, radio oder date, dessen `onChange` speichert (`api(`, eine
  Methode PUT/POST/PATCH/DELETE, ein Name mit save/persist/submit, auch über Funktionen derselben
  Datei und relativ importierte Helfer), ist verboten. Die Ausnahmeliste dort nennt Grund und
  Anzahl und enthält nur noch die Art einer Zahlung im Mietkonto (`changeKind`), deren Umstellung
  mit #281 kommt; Neues kommt nicht hinzu. Rückrufe aus den Props mit anderem Namen sieht er nicht.
  Eine Auswahl, die eine Aktion auslöst (Beleg einer Position zuordnen), ist ebenso ein Entwurf mit
  leerem gespeichertem Wert (`AttachPicker` in Belege.tsx). Im Posteingang sind Objekt und Jahr ein
  Entwurf mit einem „Speichern“; die Positionen zum Zuordnen folgen schon dem Entwurf, und eine
  gewählte Position, die dabei aus der Liste fällt, ist verworfen (`isValid`). **Was an einem
  gespeicherten Wert vorbei handelt, wartet auf den Entwurf daneben**: Das Jahr der Buchung einer
  Auswertung sperrt, solange es ungespeichert ist, Vorschau und Buchen der Karte, und „Alle grünen
  übernehmen“ lässt diese Auswertung aus (die Leiste nennt sie; `onYearDraft`), denn gebucht würde
  im gespeicherten Jahr, während die Karte das neue zeigt. Ebenso sind „Per KI auswerten“ und
  „Weiter prüfen“ im Posteingang gesperrt, solange Objekt oder Jahr des Belegs einen Entwurf haben
  („Erst Objekt und Jahr speichern oder verwerfen.“).
