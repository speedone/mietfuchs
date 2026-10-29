# Oberfläche

React 19 ohne Router: [App.tsx](src/App.tsx) schaltet per State zwischen den Seiten (`pages/`),
gruppiert nach Arbeitsphase in der Seitenleiste; Objekt und Zeitraum liegen in `PropertyProvider`
([src/property.tsx](src/property.tsx)) und `PeriodProvider` ([src/period.tsx](src/period.tsx)).
`api()` und die Helfer `parseEuro`, `fmtEuro`, `fmtDate` stehen in [src/api.ts](src/api.ts). Dark
Mode über `data-theme` auf `<html>`; **gedruckt wird immer hell**. PWA-Manifest und Icons in
`public/` (erzeugt von `server/scripts/make-icons.mjs`). Druck und PDF laufen über die Druckfunktion
des Browsers; Belege rendert pdf.js ([src/pdf.ts](src/pdf.ts)) **in der legacy-Fassung**
(`pdfjs-dist/legacy/build`), sonst bräuchte es die neuesten Browser (pdfIntake.pdfjs.test.ts wacht
darüber). Die Assets kopiert `vite-plugin-static-copy` nach `dist/pdfjs/`.

## Stile und Tokens

- **Tailwind v4 neben index.css**: Einstieg [src/tw.css](src/tw.css) (über `@tailwindcss/vite`, nur zur
  Bauzeit). index.css liegt vollständig in der Schicht `legacy`, Utilities darüber gewinnen.
  Weiteres CSS nur über tw.css in eine Schicht (ungeschichtet gewönne es gegen alles); eine eigene
  Regeldatei wie [src/fields.css](src/fields.css) hängt als Schicht `components` dazwischen.
  `!important` in `legacy` schlägt jede Utility (gewollt für `.no-print`). `dark:` gilt nur am
  Bildschirm. **Kein Preflight**, solange index.css lebt.
- **Tailwind erzeugt eine Utility für jedes passende Wort in `src/`**, auch in Kommentaren (Tests
  ausgenommen). Deshalb **keine Markdown-Dateien unter `src/`**, und Namen, die mit index.css
  kollidieren, nimmt tw.css mit `@source not inline` heraus (`sr-only`, `grow`, `grow-2`).
  Animationen in index.css heißen nie wie eine aus dem Theme.
- **Die Tokens in index.css sind die einzige Quelle**: `@theme inline` macht sie als `bg-card`,
  `text-muted`, `border-line` … benutzbar; die Standardpalette und Standardskalen sind abgeschaltet.
  Abstand `--space-N` (N × 4 px), Schrift `--text-*`, Gewicht `--weight-*`, Radius `--radius-*`,
  `--target` (36 px, 44 px bei Finger oder < 640 px), `--focus-ring`. Dunkle Tokens in
  `@media not print`.
- **Farben nur in `:root`-Blöcken**, eine neue Farbe als Token-Paar hell/dunkel; S6 rechnet die
  Kontraste nach. Gestaltung „Mittelweg“ (Werte in
  [docs/superpowers/specs/2026-10-18-oberflaeche-gesamtkonzept-design.md](../docs/superpowers/specs/2026-10-18-oberflaeche-gesamtkonzept-design.md)):
  zinc-Flächen, weiße Karten, Indigo nur für Primärknopf, Links, Fortschritt, Fokus, aktiven
  Menüpunkt und Objekt-Marke. Knöpfe: `.btn`, `.btn.secondary`, `.btn.ghost`, `.btn.danger`.
- **Wächter in [src/uiRules.test.ts](src/uiRules.test.ts)** (sie fragen Tailwind selbst): S17 keine
  beliebigen Werte (`p-[13px]`), keine Standardpalette, keine Hex-/rgba-Werte außerhalb `:root`; S20
  keine Klasse in index.css mit Tailwind-Namen, Zahl der Regelzeilen von index.css darf nur sinken.
  Ausnahmelisten in den Wächtern nennen Grund und Anzahl und werden nur kürzer.

## Navigation und Seitenkopf

- **Objekt und Zeitraum wählt nur die Seitenleiste** (am Handy das Menüblatt mit demselben Inhalt),
  über den Baustein `Switcher`. Jede Seite zeigt beides in der **Kontextzeile** des `PageHeader`
  (`pageContextLine`; `context`: `period`, `calendar` für Mietkonto und Steuer, `property`, `none`).
  Auf Seiten bleiben nur andere Größen wählbar (Kalenderjahr bei abweichendem Zeitraum über
  `CalendarYearSelect`, Heizperiode, Jahr der Buchung, Objekt und Jahr eines Belegs im Posteingang,
  Jahr der Zahlung). Wächter S18; Seitentests, die den Zeitraum wechseln, stellen `<PeriodSelect />`
  daneben. Auf einer Seite trägt der Umschalter die Beschriftung eines Felds (`switcher-field`, S30).
- **Seitenwechsel nur über `navigate`** in App.tsx (Navigation wie Sprünge aus Seiten); bei offenem
  Formular fragt er „Ungespeicherte Änderungen verwerfen?“. Navigation nur aus
  [src/nav.ts](src/nav.ts) (`Tab`, `NAV`, `BOTTOM_TABS`; S22). Nach dem Wechsel in ein Objekt ohne
  Wohnungen steht „Zurück zu …“.
- **Handy** ([MobileNav.tsx](src/components/MobileNav.tsx)): unter 900 px (`MOBILE_QUERY`) statt der
  Seitenleiste ein angehefteter Kopf (☰, Titel, „Objekt · Zeitraum“, ⇅), ein Menüblatt als
  `<dialog>` mit `showModal()` und eine untere Leiste. Gezeichnet nach `matchMedia`, nicht nur per
  CSS, damit nichts doppelt im Baum steht. Objekt und Zeitraum wechseln im Blatt **ohne** es zu
  schließen (ein Auswahlfeld sendet bei jeder Pfeiltaste `change`). Ein offenes Seitenfenster macht
  Kopf und Leiste inert. Unter 640 px werden Datentabellen zu Karten (`<Table className="stacked">`,
  jede Zelle mit `data-label`, S23), Zahlenraster heften die erste Spalte an (`sticky-first`).
  Sicherheitsränder über `env(safe-area-inset-*)` an allem, was am Fensterrand steht (S24).

## Hinweise, Leerzustände, Druck

- **Jeder Hinweis über den Baustein `Notice`** ([Notice.tsx](src/components/Notice.tsx)): Stufe als
  Zeichen und Wort, Titel, Text, „Hier beheben →“; unter „Mehr dazu“ (eingeklappt, im Druck offen)
  **nur Begründungen aus Fundstellen**. Der Text des Servers wird nur in Sätze zerlegt
  ([noticeText.ts](src/noticeText.ts)), **sichtbar bleibt grundsätzlich alles**. Eingeklappt wird nur
  ein Satz, der nach Abzug seiner Fundstellen weder Prozent, Betrag, Datum, Kürzung, Aufforderung
  noch Folge trägt (`isCitationSentence`); ein `error` steht ganz offen. Geprüft gegen echte Texte
  je Code (`src/testing/noticeSamples.json`, neu erzeugen, wenn calc.ts Texte ändert). Kein Feld
  `action` am Server. Seitentexte nehmen `NoticeBox` oder `TextNotice`; Stufenklasse und -wort nur
  im Baustein (S26). Auch Ladefehler und Befunde einer Vorschau stehen als `NoticeBox level="error"`;
  freie Kästen gibt es nur noch an sechs Stellen mit Grund (Zeilen, die je nach Ergebnis rot oder grau
  stehen, die Region „Neues Objekt“, der Statustext unter „Bezahlt am“). Ein Erfolg ist kein Hinweis,
  sondern `div.ok` mit `role="status"`. Ein Rückverweis am Satzanfang oder mitten im Satz („deshalb“,
  „daher“, „folglich“ …) holt die eingeklappte Begründung davor wieder hervor.
- **Seite Abrechnung in drei Zonen** ([pages/Abrechnung.tsx](src/pages/Abrechnung.tsx), Logik in
  [settlementOverview.ts](src/settlementOverview.ts)): eine Kopfzeile (Stand und Frist, der eine Primärknopf des Zustands,
  „🖨 Drucken / PDF“, „Mehr“ als Ausklapper mit Anschreiben, Briefpapier und Export; einen Menü-Baustein gibt es nicht,
  Popover nur über `usePopover`, S12), „Zu prüfen“ (`checkList`: Fehler, Warnungen und Hinweise mit Betrag, Kürzung oder
  Aufforderung offen als `CalcNotice`, eingeklappt nur „Mehr dazu“, „Hier beheben →“ ohne Aufklappen; kein Einzelbetrag im
  Kopf, denn der erste Betrag eines Texts ist oft nur der Anteil des ersten Mieters. Nur stille Hinweise (`isQuietHint`,
  erkannt mit `PROTECTED` und `isAction` aus noticeText.ts) stehen zusammen in `NoticeGroup`. Dazu die Prüfungen der Seite
  selbst, Anschrift, Länge und fehlender Absender (`senderMissing`: bis zum Versand, nicht mit Briefpapier oder eigener
  Unterschrift; offen „Hier beheben →“ in die Einstellungen, abgeschlossen „wieder öffnen“, auch in der Vorschau), als
  Hinweise derselben Gestalt, `pageChecks`. **Gleiche Hinweise mehrerer Mieter stehen
  in einem Kasten** (`groupNotices` in [noticeGroups.ts](src/noticeGroups.ts), `CalcNoticeGroup`): nur bei gleichem
  Code, Stufe, Titel und Bezug auf ein Mietverhältnis der Abrechnung, wenn der Text nach Abzug von Name, Wohnung und
  Zahlen gleich ist; Sätze, die bei allen wörtlich gleich sind und nichts aus `PROTECTED` tragen, stehen einmal, jeder
  andere Satz wörtlich beim Mieter mit „Hier beheben →“ (Name `sr-only` im Knopf, Titel als Beschreibung), also jeder
  Betrag; sonst bleibt der Hinweis einzeln. Den Zeitraum nennt die Zeile nur bei gleichem Namen und gleicher Wohnung. Hat die Abrechnung Fehler, sagt es auch die
  Vorschau, mit „Zurück zu „Zu prüfen““), die Übersicht (Kennzahlen,
  Tabelle je Mieter `tenantRows` mit den Mietverhältnissen ohne Abrechnung, `stacked`; die Karte zu § 560 bleibt eine
  eigene Karte darunter, als Spalte wäre sie zu eng) und „Kontrolle“ (Kontrollansicht, Vermieteranteil, Rechtsstand je als
  `<details>`). „Ansehen“ öffnet die **Vorschau eines Mieters** über die ganze Breite (Zustand `previewId`, kein Router):
  Fokus auf ihre Überschrift, beim Zurück auf „Ansehen“; Blättern mit `neighbors`; ein Schalter „Rechenweg zeigen“
  (`CalcSteps` mit `open`, ohne Knopf je Zeile). **Die Mieterabrechnungen stehen immer alle im Dokument**, wie vorher, und
  sind am Bildschirm außer der Vorschau ausgeblendet (`statement-hidden`, nur `@media screen` in letter.css); deshalb
  druckt die Seite genau wie vorher, alle mit `.card.statement ~ .card.statement` oder einer mit `print-one`. Gedruckt wird
  über das Fenster „Drucken“ ([PrintDrawer.tsx](src/components/PrintDrawer.tsx), Ausnahme „Drucken“ in S16): „Was
  drucken?“ (alle Mieter ohne Seitenzahl, einer mit), die vier Häkchen wie vorher (Anschreiben nur für diesen Druck, die
  drei übrigen ein Entwurf der Einstellungen mit eigenem „Speichern“), die Prüfungen der Seite für die gewählten Mieter;
  „Abbrechen“ stellt die Häkchen von vorher her; nach „Speichern“ im Fenster gilt der gespeicherte Stand als der von
  vorher (Fenster über `key` neu eingehängt), „Abbrechen“ fragt dann nicht. Erst danach fragen die Rückfragen vor dem Druck (Fehler, Monat der
  Anpassung); „Nicht drucken“ lässt das Fenster offen. Bleibt nach dem Druck ein Entwurf der Häkchen, steht er mit
  „Speichern“ in der Kopfzeile. Nachweis, dass sich der Druck nicht ändert: PDFs des Beispielbestands (alle, einer, ohne
  Anschreiben, mit Anlagen) vorher und nachher, Seitenzahl, Text und Lage jedes Textstücks gleich. Ein Wächter in printCss.test.ts
  verlangt `.statement-hidden` nur in `@media screen`.
- **Nicht gedruckt** wird, was nicht zur Abrechnung gehört: Hinweise der Datenbank (Database.tsx), Hinweis im leeren
  Objekt, Mitteilungen, Kopf und Leiste am Handy tragen `no-print`.
- **Fehler vor dem Druck**: Hat eine offene Abrechnung Fehler der Stufe `error`, fragt die Seite vor
  dem Drucken ([despiteErrors.ts](src/despiteErrors.ts)), und jede Mieterabrechnung trägt im Druck
  „Entwurf, nicht versenden“ (`print-only`, auch bei Strg+P). Eine abgeschlossene nie. Die erste
  Rückfrage zum Abschließen zu denselben Fehlern gilt dann als beantwortet (`sameErrors`).
- **Leerzustände** (`EmptyState`, [emptyStock.ts](src/emptyStock.ts)): im leeren Zeitraum der erste
  fehlende Schritt mit Knopf, ohne Entwurf, Frist, Kennzahlen; ein gesperrter Knopf nennt seinen
  Grund (`aria-describedby`). Nach dem Abschluss nennt die Unterzeile des Cockpits Stand und offene
  Punkte (`cockpitSubtitle`).
- **Anschreiben als Seite 1** (#415, [Letter.tsx](src/components/Letter.tsx), Logik in
  [letterView.ts](src/letterView.ts)): ein Brief nach DIN 5008 Form B vor jeder Aufstellung. Die Druckmaße stehen in
  [letter.css](src/letter.css) (Schicht `components` wie fields.css, weil index.css nur kleiner wird; S4, S17 und S20
  lesen die Datei mit): **jede Seite hat 12 mm Rand** (`@page`), denn Chromium legt alle Seiten in einer Breite an,
  und andere Ränder auf der Briefseite schnitten die Aufstellung rechts ab (nachgemessen). Den Rest bis zu den Rändern nach
DIN 5008 (links 25, rechts 20 mm) hält im Brief der Text, in der Aufstellung die Zelle der Hülle `PrintPages` frei
(letterCss.test.ts). In WebKit ist `body` im Druck so breit wie die Seite ohne Rand (186 mm): WebKit legt die
Druckseite sonst 1,25-mal so breit an, wie sie in Punkt misst (`printingMinimumShrinkFactor` in WebCore), und druckte
ohne breiten Inhalt alles rund 7 % größer (nachgemessen; das ist Safari selbst, nicht der Prüfaufbau). Nur dort
(Klasse `print-fixed-width` an `html`, beim Start von `markPrintWidth` gesetzt, wenn `canPagePaper` fehlt; ein
`@supports not (box-decoration-break: clone)` schreibt der Build mit der Angabe mit Präfix um, die WebKit kennt): In
Chromium und Firefox schaltete die feste Breite die Skalierung des Druckdialogs ab. Die Maße der Norm stehen
  abzüglich dieser 12 mm (`--page`): Anschriftfeld 20/45 mm, 85 × 45 mm mit Rücksendeangabe in der Vermerkzone,
  Informationsblock 125/50 mm, Betreff ab 98,46 mm, Falz- und Lochmarken bei 105, 148,5 und 210 mm (12 bis 17 mm von
  der Kante, im Seitenrand schneidet Chromium ab) nur mit der Druckeinstellung „Falz- und Lochmarken drucken“. Ein
  langer Brief druckt auf einer Folgeseite mit Rand weiter; Seite und Seitenfenster warnen vorher
  (`exceedsOnePage`, eine Schätzung nach Zeilen). Die Texte setzt der Server ein (`Settlement.letters`); die Seite
  wählt die Bausteine (`chooseLetterBlocks`) und setzt nur `{Datum}` und `{AnzahlBelege}` ein. Absender,
  Rücksendeangabe, Anschrift und (abgeschlossen) die Zahlungsfrist im Ergebniskasten kommen aus dem Anschreiben,
  also eingefroren. **Eine vor #415 abgeschlossene Abrechnung** (ohne `letters`) druckt im bisherigen Aufbau
  ([LegacyStatement.tsx](src/components/LegacyStatement.tsx)): kein Anschreiben, kein Ergebniskasten, Kopf und Sätze
  wie damals. Fehlt `letters` bei einer offenen (Testattrappe), entsteht es aus den Vorgaben (`letterOf`). Der Vermerk
  „Entwurf, nicht versenden“ steht dann auf beiden Seiten. **Kopf der Aufstellung** (`statementHeadRows`, `dl.statement-facts`): Mieter,
  Mietobjekt, Wohnung, Wohnfläche, Abrechnungszeitraum (bei Ein- oder Auszug dazu „Ihr Nutzungszeitraum“) und Personen;
  Anschrift und Fläche aus dem Anschreiben (`premises`, eingefroren, vorher abgeschlossen ohne). Der Zeitraum steht nur
  dort. **Ergebniskasten** (`resultRows`) darunter, die Nachzahlung neutral fett. Die Sätze zu Zahlung, Erstattung,
  § 560 und Belegeinsicht stehen nur im Anschreiben; unter der Tabelle die Tabelle nach § 35a EStG (`labor35aTable`:
  Leistung, Gesamtbetrag, Lohnanteil, Ihr Anteil; Rechnungsbetrag und Lohnanteil aus `labor35a` des Anschreibens, fehlt
  es, nur Leistung und Ihr Anteil). **Informationsblock** (`infoRows`): Ansprechpartner, Kontakt (`contactRows` trennt das
  freie Feld an Umbruch und Semikolon, an einem Komma nur vor einer erkannten Telefonnummer oder E-Mail), „Ort, Datum“.
  Vor #415 abgeschlossen bleibt alles wie damals (Kopfzeile, Liste zu § 35a, „Abgerechnet werden die Kosten …“).
- **Anschreiben bearbeiten** ([LetterDrawer.tsx](src/components/LetterDrawer.tsx), Logik in
  [letterForm.ts](src/letterForm.ts)): ein Seitenfenster für drei Ebenen, die Vorlage aller Objekte
  ([LetterTemplateCard.tsx](src/components/LetterTemplateCard.tsx) in den Einstellungen, mit der Vorgabe der Anpassung),
  das Objekt („Vorlage für dieses Objekt bearbeiten“ unter „Mehr“ in der Kopfzeile der Seite Abrechnung) und den Mieter
  („Anschreiben bearbeiten“ in seiner Vorschau, nur offen).
  Je Baustein ein Textfeld, darunter die Platzhalter als Chips (fügen an der Einfügemarke ein) und „Auf Vorgabe
  zurücksetzen“, dazu die Vorschau mit den Werten des Mieters bzw. Beispielwerten. Ein Text gleich der Ebene darüber
  ist keine eigene Angabe (`setText`), geschickt wird nur, was sich geändert hat (`textChanges`); ein unbekannter
  Platzhalter ist eine Meldung am Feld (`letterProblems`, dieselbe Prüfung wie der Server). Ein eigener Betrag über
  dem Vorschlag bekommt den Hinweis zu § 560 Abs. 4 BGB (`adjustmentHint`, nur wenn es einen Vorschlag gibt),
  gesperrt wird nichts. Die Vorschau setzt den neuen Betrag aus dem Entwurf ein (`draftNewCents`); „Anpassung auf
  Vorgabe zurücksetzen“ nimmt die eigene Wahl des Mieters weg (`adjustment: null`). Ein gesperrter Knopf nennt den
  Grund daneben.
- **Ab Monat und „In die Staffel übernehmen“** (#317): Das Seitenfenster des Mieters hat bei einer Anpassung ein
  Monatsfeld „Ab Monat“ (`adjustFrom` im Entwurf, `null` = Vorgabe `adjustFromFor`), mit Hinweis bei einem Monat
  nicht in der Zukunft (`adjustFromHint`) und bei einem eigenen Text ohne `{AnpassungAb}` (auf jeder Ebene,
  `monthlessAdjustTexts`). Beim Versanddatum und vor dem Druck einer abgeschlossenen Abrechnung fragt die Seite, wenn
  der Versand nach dem Monat des Schreibens oder später als zwei Monate davor liegt (`sentMonthLines`, Weg: wieder
  öffnen, Monat ändern). Auf einer abgeschlossenen
  Abrechnung mit Anschreiben steht [PrepaymentStepsCard.tsx](src/components/PrepaymentStepsCard.tsx) (Logik in
  [prepaymentSteps.ts](src/prepaymentSteps.ts)): Stand je Mieter, Warnung „Angekündigt, aber nicht übernommen“, ein
  Seitenfenster mit „Ab Monat“ je Mieter (ein geänderter Monat plant neu; ein gesetzter ungültiger oder leerer Monat
  ist eine Meldung am Feld und wird nie durch den des Schreibens ersetzt), Rückfrage aus `stepQuestion` (auch zu Stufen
  zwischen Zeitraumende und Monat), gesendet wird die Marke des Plans.
- **Kontrollansicht** (#321, [ControlView.tsx](src/components/ControlView.tsx), Logik in
  [controlView.ts](src/controlView.ts)): auf der Seite Abrechnung ein aufklappbarer Abschnitt der Karte „Kontrolle“ (`embedded`), immer `no-print`. Je
  Position alle Mieter und die Gründe des Vermieters (`landlordParts`) nebeneinander, Summe gegen den Rechnungsbetrag,
  darunter Kosten, Vorauszahlung und Saldo je Mieter. Nur Anzeige aus `statements` und `landlord`; eine Differenz
  ungleich 0 wird als Fehler benannt. Zeilen ohne Position (Pseudo-Kennung mit „:“, sie allein entscheidet) stehen gesondert, ihre Summe muss 0 sein, und
  zählen nicht in die Summenprüfung; ohne `landlordParts` (vor #142) steht eine pauschale Spalte. Die Tabelle ist
  `sticky-first` und scrollt seitlich.
- **Ableseformular** (#320, [ReadingSheet.tsx](src/components/ReadingSheet.tsx), Logik in
  [readingSheet.ts](src/readingSheet.ts), Regeln in [reading-sheet.css](src/reading-sheet.css), Schicht `components`
  wie letter.css, S4/S17/S20 lesen die Datei mit): reine Druckseite ohne eigene Datenhaltung. Das Blatt hängt als
  Portal an `body` (`SheetPrinter`, Klasse `print-reading-sheet` blendet `#root` und Dialoge aus, erst nach dem Rendern
  `window.print()`). Gruppen: Hauptzähler, Wohnungen in ihrer Reihenfolge, Heizanlage; `name` gilt als Bezeichnung und
  Ort (kein Feld „Einbauort“). Die Eichfrist kommt aus `calibratedUntil` (das Ergebnis von `calibrationEnd`): abgelaufen
  vor dem laufenden Jahr, „endet“ im laufenden oder folgenden, Heizkostenverteiler nie. Einstieg: „Ableseformular
  drucken“ auf der Seite Zähler (Auswahl im Seitenfenster, dessen Primärknopf „Drucken“ heißt, S16) und im Mieterwechsel
  mit `unitId` (nur die Zähler der Wohnung). Die Unterschrift steht als Spalte wie die übrigen. Playwright
  schaltet mit `page.pdf()` `afterprint` aus: erst fotografieren, dann PDF. Ohne Zähler ist „Drucken“ gesperrt und
  nennt den Grund daneben (`aria-describedby`), auch im Mieterwechsel; zur Wahl stehen nur Wohnungen mit Zählern
  (`unitsWithMeters`). Ausgelassen werden Zähler stillgelegter Anlagen (`endsOn` vor heute), Stände nach heute zählen
  nicht, und ein Heizkostenverteiler gilt nach der Regel von `inUseAt` (server/src/monthlyInfo.ts) als ausgebaut,
  wenn in derselben Wohnung ein Nachfolger abgelesen wird; **bekannte Grenze**: bei anderen Zählern gibt es kein
  sicheres Merkmal „ausgebaut“, sie bleiben auf dem Blatt. **Entscheidung**: `value` des Fensters ist die Auswahl,
  wer ein Häkchen ändert und schließt, wird gefragt (wie bei jedem Fenster). Die Ausnahme vom Verb „Anlegen“/
  „Speichern“ („Drucken“, nur in ReadingSheetDrawer.tsx) steht in `DRAWER_VERB_EXCEPTIONS` (S16).
- **Teil 2 von #415: ohne Anschreiben, Fußvermerk, Seitenzahl.** „Anschreiben mitdrucken“ hat eine Vorgabe in der
  Vorlage der Installation (Häkchen im Seitenfenster) und am Objekt (Auswahl „wie in den Einstellungen“, ja, nein, im
  Seitenfenster der Objektvorlage); beides liefert `/api/letter-texts` (`printLetter`, `propertyPrintLetter`), es gilt
  `printsLetter` (shared/letter.ts). Das Häkchen im Fenster „Drucken“ der Seite Abrechnung gilt nur für diesen Druck und speichert nichts.
  Ohne Anschreiben zeichnet `StatementHead` (Letter.tsx) denselben Kopf mit denselben Druckmaßen (`.letter.letter-top`,
  danach beginnt die Aufstellung auf der Höhe des Betreffs), der Betreff ist die Überschrift, und `statementBlocks`
  setzt Ergebnis, Anpassung und Belegeinsicht unter die Tabelle (`p.statement-letter-text`), aus den eingefrorenen
  Texten. **Fußvermerk** (`footnoteText`: Abrechnung, Objekt und Wohnung, kein Name, keine
  Bank): `PrintPages` legt eine echte `<table role="presentation">` um die Aufstellung, der Vermerk steht in ihrem `tfoot`,
  denn nur den einer echten Tabelle wiederholen Chromium und Firefox auf jeder Seite (eine Tabelle aus CSS nicht,
  nachgemessen); Safari wiederholt ihn nicht und druckt ihn einmal am Ende der Aufstellung. Er steht also immer im Fluss,
  je Seite, wo der Browser es kann, und wird nie ausgeblendet (Wächter in letterCss.test.ts);
  am Bildschirm ist die Hülle `display: block` und der Fuß weg, und weil index.css jede Tabellenzeile zusammenhält, darf
  ihre eine Zeile umbrechen. Table.test.ts lässt genau diese Hülle zu. **„Seite x von y“** setzt `startPrint` mit
  `pageNumbers` nur beim Druck einer Abrechnung als Randfeld (`@bottom-right`, `PAGE_NUMBER_CSS`, Chromium ab 131;
  Safari und Firefox kennen die Randfelder nicht und drucken keine, bewusst hingenommen). Ein Randfeld trägt nur, was
  fehlen darf, nie den Fußvermerk (Wächter in printJob.test.ts; Randfelder bekommen ihre Schrift ausdrücklich, sonst
  druckt Chromium eine Serifenschrift). Ein Zähler je Mieter lässt sich in
  Chromium nicht zurücksetzen, beim Druck aller zählte er also über alle. **Fußzeile mit Kontakt und Bank** ist eine
  Druckeinstellung (`printFooter`) und steht nur auf der Briefseite; ihr Text (`sender.footer`) friert mit dem
  Anschreiben ein; ein Abschluss ohne `sender.footer` druckt keine. Mit Fußzeile hält der Brieftext unten Platz frei (`.letter-with-footer`),
  sonst überdruckte sie bei einem Brief über zwei Seiten die Unterschrift (letterCss.test.ts). Die Belegkopien liegen in
  der Hülle und tragen den Fußvermerk. Die Rücksendeangabe bricht in höchstens zwei Zeilen um; über `RETURN_LINE_MAX`
  (110 Zeichen, nachgemessen) warnt die Seite (`returnLineTooLong`). Eine vor #415 abgeschlossene Abrechnung bekommt
  nichts davon.
- **Teil 2b von #415: Logo und Briefpapier** ([letterDesignView.ts](src/letterDesignView.ts),
  [letterPaper.ts](src/letterPaper.ts), Seitenfenster [LetterDesignDrawer.tsx](src/components/LetterDesignDrawer.tsx) mit
  Logik in [letterDesignForm.ts](src/letterDesignForm.ts); Karte „Logo und Briefpapier“ in den Einstellungen, am Objekt
  über „Mehr“ in der Kopfzeile der Seite Abrechnung). Das Logo steht oben rechts im Briefkopf (im Anschreiben und im Kopf
  ohne Anschreiben), immer als `<img>`, nie eingefügtes SVG. **Mit Briefpapier druckt die Seite ohne Seitenrand**
  (`PAPER_PAGE_CSS`: `@page { margin: 0 }`, nur solange die Seite Abrechnung mit Briefpapier offen ist): Chromium schneidet ab, was in den Rand von 12 mm ragt (nachgemessen), ein Briefpapier bis zur Blattkante
  käme sonst mit weißem Rahmen heraus. Die Maße des Briefs gelten dann ab der Blattkante (`--page: 0mm`); die
  Aufstellung steht in einem Rahmen (`.print-pages-frame`), dessen Innenabstand oben und unten `box-decoration-break:
  clone` auf jeder Druckseite wiederholt, die Seiten hält die Zelle (`--paper-*` an der Karte). Kein Tabellenkopf oder
  -fuß hält einen Rand frei (Wächter in letterCss.test.ts). Das Papier der ersten Seite liegt als Bild im Kopf des
  Briefs, das der Folgeseiten ohne eigene Höhe im `thead` der Hülle (`follow`, Verzierung: Chromium und Firefox
  wiederholen ihn); die Belegkopien stehen in einer eigenen Hülle ohne Briefpapier (`newPage`: ein Umbruch vor dem ersten
  Inhalt einer Zelle wirkte nicht). Deshalb hat die Karte im Druck keinen Grund. **Briefpapier nur, wo der Browser die
  Ränder je Seite wiederholen kann** (`canPagePaper`: `CSS.supports('box-decoration-break', 'clone')`, Chromium ab 130
  und Firefox). WebKit nimmt die Ränder der ersten Seite für alle Seiten, auch die aus `@page :first`, wiederholt weder
  `thead`/`tfoot` noch ein fest positioniertes Element und schneidet ab, was in den Seitenrand ragt; `page` (benannte
  Seiten) nimmt es an, wirkt aber nicht (alles nachgemessen mit dem Workflow „Druck in Safari“, #286). Papier bis zur
  Blattkante und Ränder auf den Folgeseiten gehen dort nicht zusammen. Safari druckt deshalb wie ohne Briefpapier (mit
  Rand und Absender, die Fußzeile nur mit `printFooter`, das Logo bleibt; `printDesign` mit `paperSkipped`), und die
  Seite (`no-print`, auch für Strg+P) und das Fenster „Drucken“ sagen es.
  Rand oben höchstens 70 mm (Grenze aus der Zeit des wiederholten Tabellenkopfs, beibehalten). Ein Bild druckt der Browser immer, auch ohne „Hintergrundgrafiken“. Eine PDF rendert
  pdf.js vorab zu einem Bild, ein Bild wird vorher nachgefragt; bis dahin ist „Drucken“ im Fenster „Drucken“ gesperrt. **Fehlt eine
  Datei**, druckt die Seite ohne sie, mit Rand, Absender und Fußzeile, und nennt es (`printedDesign`, Durchsicht M2).
  Im Seitenfenster wird nur eine einseitige PDF angenommen, und ein SVG wird dort mit Canvas zu einem PNG (`svgToPng`). Mit Briefpapier entfallen Absender (`.letter-head`) und Fußzeile von Mietfuchs; Rücksendeangabe und
  Fußvermerk bleiben. Die Seitenzahl im Rand entfällt (kein Rand). Gewählte Dateien gehen erst mit „Speichern“ hinaus.
  Eine vor #415 abgeschlossene Abrechnung bekommt nichts davon. Druckprobe: Anschriftfeld, Datum und Betreff an den
  Stellen wie ohne Briefpapier (Rücksendeangabe 61 mm, Anschrift ab 66 mm, Datum 53,4 mm).
- **Druckkopf**: `letterhead` lässt einen Objektnamen weg, der schon in der Adresse steht, und ist die
  Rücksendeangabe des Anschreibens; Anschrift des Mieters (`recipientLines`: eine eigene Anschrift für den
  Schriftverkehr geht vor, jedes Komma ist eine Zeile; die Lage der Wohnung steht nicht darin, sondern in Betreff und Kopf.
  Eingefroren mit ihr als zweiter Zeile ist dieselbe Anschrift, `formerRecipientLines`). **Anschrift vor dem Versand** (#229, `addressCheck` in
  landlord.ts): `former`, wenn der Mieter ausgezogen ist und gedruckt die Wohnung im Anschriftfeld stünde; `outdated`,
  wenn die eingefrorene Anschrift (`letters[…].recipient`) von der heutigen abweicht (dann hilft nur Wiederöffnen);
  verglichen wird der Inhalt (an Komma und Umbruch getrennt, Leerraum zusammengezogen), nicht die Zeilen, denn vor #229
  wurde nur vor der Postleitzahl getrennt. Passt die Anschrift nicht ins Fensterfeld (mehr als 6 Zeilen, je rund 45
  Zeichen, nachgemessen; `addressFieldWarning`), warnt die Seite vor dem Druck, und Mieterwechsel und Stammdaten nennen
  es als Hinweis am Feld (`ownAddressWarning`).
  Nach dem Versand nichts. Die Seite Abrechnung nennt es je Mieter, das Cockpit in einer gelben Zeile „Anschrift für den
  Versand“ (`addressFindings`). Bewusst kein Hinweis der Berechnung: Der Schnappschuss kennt keine Kontaktdaten. Der
  Mieterwechsel fragt nach neuer Anschrift, E-Mail und Telefon (vorbelegt, freiwillig); gesendet wird nur, was sich
  geändert hat (`contactChanges` in tenantChange.ts, Rumpf `contact`), und geprüft wird ebenso nur Geändertes (eine
  gespeicherte, ungültige Angabe sperrt den Wechsel nicht, wie bei der IBAN). Der Rechenweg ([CalcSteps.tsx](src/components/CalcSteps.tsx)) ist immer
  `no-print`.

## Lexikon und Anleitungen

- **Begriffslexikon** ([shared/glossary.ts](../shared/glossary.ts)): Erklärung, Beispiel mit Zahlen,
  Rechtsgrundlage, „Brauche ich das?“. Rechtsaussagen nur, wo sie im Gesetz stehen; Beispiele werden
  nachgerechnet; Rechtszahlen aus dem Register. Jeder Hinweis-Code trägt mindestens einen Begriff
  (`terms`, glossary.test.ts).
- **[Term.tsx](src/components/Term.tsx)**: Auslöser ist ein `span` mit `role="button"` (ein `<button>`
  im `<label>` nähme dem Feld die Beschriftung), dahinter ein „?“ aus CSS (`term-q`, für Vorleser
  ausgeblendet). Die Erklärung ist ein Popover (am Handy Blatt unten) mit Erklärung und Beispiel und
  „Mehr in ‚Hilfe & Begriffe‘ →“ (über `navigate`, springt mit `focusTerm` einmal zum Begriff). Esc
  schließt nur die Erklärung.
- **Anleitungen je Vermietungsart** ([shared/guides.ts](../shared/guides.ts)), angezeigt in „Hilfe &
  Begriffe“; Sprungziele sind Kennungen aus nav.ts. [guides.test.ts](../server/test/guides.test.ts)
  **rechnet jedes Beispiel nach** und verlangt die Beträge wörtlich, und **jede Beschriftung in „…“
  muss wörtlich in der Oberfläche stehen**. Grenze: Es sucht im Quelltext, nicht in der gerenderten
  Seite; Text, den JSX zerlegt (`<Term>` im Satz, `{year}` im Knopf), darf nicht zitiert werden.
  Beschrieben wird nur, was Mietfuchs auf dem Stand des Zweigs kann; eigene Auslegungen werden als
  solche genannt.

## Formulare und Meldungen

- **Eine Meldung steht am Feld und in der Sammelmeldung** (nach GOV.UK): `useFormError<F>()` mit
  `<ErrorSummary errors>` und `<Field>`. Prüfungen liefern `Problem`e
  ([formProblems.ts](src/formProblems.ts)): Feld, kurze Fassung fürs Feld, Satz mit Ort für die
  Sammelmeldung, **alle auf einmal und je mit Feld**. `report(problems)`, `show(text)` (ohne Feld,
  etwa die Ablehnung des Servers), `set(text)`. Jedes Melden fokussiert die Sammelmeldung (ein
  Ladefehler mit `{ focus: false }` nicht); `role="alert"` sitzt innen, der Fokus außen. Ihre Zeilen
  sind Links aufs Feld und klappen ein `<details>` auf. Im Seitenfenster steht sie im Fuß, in einer
  Karte oben; ein Feld mitten im Text nimmt `FieldMessage`. Aktionen ohne Formular melden über
  `toast(text, 'error')`; oben auf der Seite stehen nur Ladefehler, als `NoticeBox level="error"`. Wächter S15.
- **`<Field label hint optional width required>`** ist ein `<label class="field">` und vergibt `id`,
  `aria-labelledby` (nur die Beschriftung), `aria-describedby` und `aria-invalid`;
  `{...errors.field('date')}` reicht Meldung und `onFix` hinein.
- **Nicht vereinbarte Kosten im Kostenformular** (#258): Wer eine Wohnung aus den Teilnehmern nimmt,
  beantwortet „Warum trägt <Wohnung> diese Kosten nicht?“ (leer, eigengenutzt, nicht im Mietvertrag
  …); bei mehreren Mietverhältnissen je eines als Kontrollkästchen. Der stille Textlink „Ein Mieter
  trägt das laut Mietvertrag nicht …“ öffnet dieselbe Frage ohne Umweg. Bei „Sonstige“ steht je Mieter
  eine Ja/Nein-Frage (`namedTenancyIds`), bei Heizung nur ein Satz zur Inklusivmiete. Die Musterseite
  zeigt alles.
- **Pflichtfelder tragen `required`**: Sternchen (für Vorleser ausgeblendet) und das HTML-Attribut;
  erklärt durch die Legende „* Pflichtangabe“ (der Drawer zeigt sie selbst, sonst
  `<RequiredLegend />`). Pflicht sind genau die Felder, deren Fehlen die Prüfung meldet
  (requiredFields.test.tsx). **Der Browser prüft nie vor**: `<form noValidate>`, nie über
  `:invalid`/`:required` gestalten (S25).
- **Felder in Stufen**: Die Breite gehört dem Eingabefeld, `width` = `s` (8,5rem: Betrag, Datum,
  Monat, PLZ, Fläche), `m` (13rem), `l` (21rem: Adresse, Name, IBAN), `full`. **Ohne Angabe nach
  Feldart** (`widthOf`, dieselbe Regel per `:has()` in fields.css): Datum, Monat und `inputMode`
  decimal/numeric kurz, `<textarea>` voll, Auswahl nach Inhalt, sonst lang; **ein Betrag braucht
  deshalb `inputMode`**. `field-grid` ist eine umbrechende Zeile, am Handy ist jedes Feld voll breit.
  Keine Breite als Inline-Stil, keine px-Breiten (S28).
- **Der Browserlauf misst abgeschnittene Felder** je Seite und in jedem Seitenfenster
  (`clippedFields` in scripts/browser-check.mjs, auch den Platzhalter). Abhilfe ist ein kürzerer
  Eintrag mit der Erklärung als Hinweis am Feld. Ausnahmen in scripts/browser-check-fields.json
  (heute leer). Grenze: nur der gewählte Eintrag eines Auswahlfelds im Beispielbestand wird gemessen.
- **Ein Monat ist ein Monatsfeld** ([MonthField.tsx](src/components/MonthField.tsx)): Text, der
  „3.2025“, „03/25“, „2025-03“, „März 2025“ liest (`parseMonthText` in [monthText.ts](src/monthText.ts);
  Mehrdeutiges wie „1.10“ ergibt eine Meldung), dazu ▦ mit Raster als Popover. Der Wert ist
  `'JJJJ-MM'` oder, wenn kein Monat, der Text selbst; er wird nie verworfen. **Die Personenstaffel
  bleibt ein Datum** (tagesgenau). Kein `type="month"`, kein `type="number"`, Monatsnamen nur in
  monthText.ts (S14). Popover nur über `usePopover` ([popover.tsx](src/components/popover.tsx), Portal
  im nächsten `<dialog>` bzw. `body`; S12). Bekannte Grenze: ohne `showPopover` (alte Safari/Firefox)
  stimmt die Lage im einfahrenden Seitenfenster nicht.
- **Ein reines Jahr ist ein Jahresfeld** ([YearField.tsx](src/components/YearField.tsx)): Textfeld mit
  `inputMode="numeric"` und ‹ › zum Blättern (leer ab dem Jahr von `today`, Grenzen `YEAR_MIN`/`YEAR_MAX`
  aus monthText.ts), **kein Raster**. `parseYearText` ([yearText.ts](src/yearText.ts)) liest nur vierstellige
  Jahre, ein zweistelliges ergibt eine Meldung. Wert ist der Text, wie beim Monatsfeld nie verworfen. Eine
  Zeile, die mehrere Blöcke unterscheidet, setzt den Block als `sr-only` hinter die Beschriftung
  (ServiceImportReview).

## Rückfragen, Seitenfenster, Mitteilungen

- **Rückfragen** (`useConfirm`, [feedback.tsx](src/components/feedback.tsx)): `<dialog
  role="alertdialog">` mit `showModal()`, im Top-Layer auch über Menüblatt und Seitenfenster.
  **Kein Abfänger für Enter** (S13): Enter wirkt auf den Knopf mit dem Fokus. Bei `danger` Startfokus
  „Abbrechen“ (`defaultChoice` überstimmt), gesetzt nach `showModal()`. **Tab lenkt kein Baustein
  selbst**, der Browser hält ihn im Dialog. Esc bricht schon am `keydown` ab, außer ein Element darin
  hat es verhindert. Ein `close`, das ankommt, wenn der Dialog wieder offen ist, zählt nicht. Fokus
  zurück an den Auslöser (`focusBack` in [dialogKeys.ts](src/components/dialogKeys.ts)). Eine zweite
  Rückfrage beantwortet die offene mit „nein“; `onAlternative` läuft nach dem Schließen.
  `confirmLabel` ist Pflicht.
- **Mitteilungen** (`useToast`) sind `popover="manual"` über offenen Dialogen und werden zusätzlich im
  obersten modalen Dialog angesagt (`role="status"`/`alert`, `sr-only`).
- **Seitenfenster** (`Drawer`, [Drawer.tsx](src/components/Drawer.tsx)): `<dialog>` mit `showModal()`
  von rechts; Kopf mit Titel und ✕, scrollender Körper, fester Fuß mit `hint`, **„Abbrechen“ aus dem
  Baustein** und den Knöpfen des Formulars (`actions`). **Schließen mit Änderungen fragt**
  „Änderungen verwerfen?“. Erkannt am Pflicht-Prop **`value`**, verglichen mit `sameDraft` gegen den
  Stand vor der ersten Eingabe (in der Einfangphase gemerkt, nicht beim Öffnen). **`value` umfasst
  jeden Zustand, den das Fenster bearbeitet**, aber nichts Nachgeladenes und keine bloße Hilfe;
  Umgeschriebenes (IBAN) wird normalisiert. `changedFrom` gibt einen Vergleichsstand von Anfang an
  (vorbelegt geöffnet gilt als geändert). Nur ein geändertes Fenster meldet sich bei `useOpenForm`.
  Zeigt ein offenes Fenster einen anderen Datensatz, setzt der Aufrufer `key` auf dessen Kennung.
  Esc gilt nicht dem Fenster, wenn es zuerst etwas darin schließt (Begriff, Popover, IME). `cancel`
  und `close` zählen nur am Fenster selbst. Das erste Feld bekommt den Fokus, bei nachladendem Inhalt
  nach 60 ms noch einmal. Wächter S12b: `value` immer (kein fester Wert), kein `footer`, kein eigener
  Schließer in `actions`; ob `value` alles umfasst, prüft die Durchsicht.
- **Gespeichert wird über `useSaving`** ([useSaving.ts](src/useSaving.ts)): `run(save)` lässt einen
  zweiten Aufruf fallen, `busy` sperrt im Drawer alle Wege zum Schließen und Strg+S.
- **Tests**: jsdom bekommt `showModal()`, Popover-Ereignisse und `:modal` aus
  [src/testing/dialog.ts](src/testing/dialog.ts), Tastendrücke wie im Browser aus
  [src/testing/keys.ts](src/testing/keys.ts) (`press`). `<dialog>` hat die Rolle `dialog`, die
  Rückfrage `alertdialog`; wer nach einer Eingabe „Abbrechen“ klickt, bestätigt danach „Verwerfen“.
- **Verlauf** ([pages/Verlauf.tsx](src/pages/Verlauf.tsx), Logik in [journalRevert.ts](src/journalRevert.ts) und
  [journalView.ts](src/journalView.ts), #318): Filterzeile über der Liste (`field-grid` mit `Field`: Objekt als „Nur
  gewähltes Objekt / Alle Objekte“, weil die Seitenleiste das Objekt wählt; Bereich aus `KIND_OPTIONS`; „Von“/„Bis“ als
  Datum, Breite `s`, gerechnet in der Zeitzone des Browsers; Suche nach 300 ms Pause). Ein Filter beginnt die Liste neu,
  Blättern bleibt `before` in Stücken zu 50. Aufgeklappt trägt ein Eintrag Gefahrknöpfe mit Rückfrage (`useConfirm`,
  `danger`): an der neuesten Gruppe insgesamt „Rückgängig …“ (der Server sagt es mit `newest`; der oberste Eintrag der
  Liste ist es nicht immer, denn sie zeigt nur das gewählte Objekt), sonst „Diese und alle späteren Änderungen
  zurücknehmen …“ und „Nur die späteren Änderungen zurücknehmen …“. Die Rückfrage kommt aus der Vorschau des Servers
  (`revertQuestion`: Titel „Zum Stand vor/nach „…“ zurückkehren?“, die ersten acht Einträge, Dateien aus dem
  Papierkorb, die Sätze des Servers wie „Zustimmungen bleiben“); eine Grenze steht als `NoticeBox` am Eintrag, ohne
  Rückfrage. Danach eine Mitteilung (`revertedMessage`: ein Eintrag mit Titel, mehrere mit ihrer Zahl), das Objekt neu
  geladen (`reload`, Zeitraum und Namen können sich geändert haben) und die Liste neu. Zurückgenommene Einträge tragen
  „zurückgenommen“, Schranken haben keine Knöpfe; nur lesbare tragen beide Knöpfe, denn die Vorschau entscheidet, ob
  der Stand über eine Sicherung erreichbar ist. „Rückgängig“ in der Mitteilung nach einer Speicheraktion gibt es noch
  nicht (die Mitteilungen haben keine Aktion).
- **Sicherungspunkte in der Zeitachse** (#318, server/src/db/CLAUDE.md „Sicherungspunkte im Verlauf“): Die Liste kommt
  mit `snapshots=1` (`journalQuery`); `isSnapshot` trennt die Zeilen, geblättert wird ab der ältesten **Gruppe**, und eine
  Seite ist voll, wenn sie 50 Gruppen trägt. Eine Sicherung ist eine eigene, ruhige Zeile (`SnapshotRow`, `data-snapshot`,
  `bg-chip`, 💾, kein `<details>`): Zeitpunkt (`snapshotWhen`, „laut Datei“ bei der Dateizeit), Titel, Größe
  (`fileSize`) und „Zu diesem Stand zurückkehren …“ (Gefahrknopf, `aria-describedby` auf die Zeile). Vorschau, dann die
  Rückfrage aus `snapshotQuestion` (`danger`, also Startfokus „Abbrechen“; „Zurückkehren“): alles danach wird ersetzt,
  die aktuellen Daten werden vorher als `mietfuchs.sqlite.vor-restore` gesichert, fehlende Belege, Belege aus dem
  Papierkorb, die Zustimmungen. Kommt die Vorschau eines Eintrags mit `kind: 'snapshot'`, steht der Eintrag im Titel und
  darunter „Schritt für Schritt geht das nicht, nur über die Sicherung …“ mit den Gründen; über einen Abschluss hinweg
  schickt der Server diese Vorschau nie, die Ablehnung nennt dann die Abrechnungen und „Wieder öffnen“ (Durchsicht von
  PR #442, M2). Ohne sichere Zählung (`later: null`) nennt die Rückfrage keine Zahl. Die Einleitung der Seite ist kurz
  (drei Sätze), die Einzelheiten stehen in einem eingeklappten „Mehr dazu“. Nach dem Einspielen lädt die
  Seite **immer** neu (`reloadPage`, im Test hineingereicht); die Sätze des Servers stehen danach einmal oben
  (sessionStorage, `keepRestoreNotes`/`readRestoreNotes`, mit try/catch). In den Einstellungen steht an Stelle der
  früheren Karte „Automatische Vorversionen“ nur „Automatische Sicherungen und frühere Stände finden Sie im Verlauf.“
  mit Link (`onNavigate`); das ZIP-Backup bleibt dort.

## Knöpfe, Karten, Anlegen

- **Feste Verben**: Im Seitenfenster heißt der Primärknopf „Anlegen“ oder „Speichern“, „Abbrechen“
  ist nie primär; kein „OK“, „Übernehmen“, „Hinzufügen“, „Umstellen“ als Primärknopf. „+ … anlegen“
  öffnet ein Fenster, „+ weitere …“ fügt eine Zeile an; „… hinzufügen“ gibt es nicht. Fachliche
  Verben mit Folgen bleiben („… abschließen“, „Buchen“, „Zuordnen“). Ausnahme: „Anlegen und zu …
  wechseln“. **Gefahrknöpfe** (`btn ghost danger-ghost`) tragen „…“, wenn eine Rückfrage folgt, und
  stehen mit `ml-auto` rechts. Wächter S16. **Wer einen Knopf umbenennt, zieht die Anleitungen und
  die Meldungen des Servers mit** (guides.test.ts, ui-labels.test.ts).
- **Anlegen oder Bearbeiten heißt Seitenfenster**, auch Ablesung, Lieferung, Mieterwechsel,
  Zeitraumwechsel, der Zeitraum der Heizung, die getrennte Heizkostenabrechnung, die Schätzung nach § 9a
  (geöffnet aus der Zeile der Wohnung, „Schätzen“/„Ändern“) und das Objekt (die Karte „Objekt“ zeigt nur an,
  `propertySummary`). Mit Vorschau
  verwirft **jede Änderung nach der Vorschau die Vorschau** (auch eine verspätete Antwort gilt dann
  nicht, Folgenummer je Anfrage), und ein Satz sagt, dass sie neu nötig ist.
- **Neues anlegen steht oben rechts**: für die Seite in `PageHeader actions`, für eine Karte in
  `CardHeader aside` (S27). Im Fuß einer Karte nur „Speichern“ links und Gefahrknöpfe rechts.
  Ein weiteres Objekt legt die Karte „Weitere Objekte“ der Stammdaten an („+ Objekt anlegen“); ab
  zwei Objekten steht als Abkürzung ein „+“ neben dem Umschalter (einzige Ausnahme von S27). Beide
  öffnen dasselbe Fenster (`NewPropertyProvider`) mit denselben Feldern wie „Objekt bearbeiten“
  (`PropertyFields`).
- **Eine Karte mit Überschrift ist `Card`** (Titel, höchstens eine Aktion als `aside`, weitere Angaben
  wie Drag-Handler gehen an die `section`). Wächter S31 erkennt auch `className` als Ausdruck, einen
  Kommentar vor der Überschrift und einen eigenen Kopf als `div` um sie.
- **Eine Karte, ein Speichern** ([Card.tsx](src/components/Card.tsx)): Trägt eine Karte ein Formular,
  ist es ein Entwurf mit **einem** `<DraftActions layout="card">` am Fuß. Was je Zeile einer Liste
  gespeichert wird, ist ein Entwurf am Feld in einer eigenen kleinen Komponente. Eine Karte, die ein
  Seitenfenster öffnet, speichert dort. Wächter S19 (sieht keine Unterkomponenten).

## Entwürfe: nichts speichert beim Anklicken

- **Auswahlfelder und Häkchen speichern nicht beim Anklicken** (#309). Sofort gespeichert wird nur,
  was keine Daten ändert (Zeitraum, Objekt, Design, Antwort zur Update-Prüfung). Alles andere ist
  ein Entwurf: `useDraft(saved, { scope, isValid })` ([useDraft.ts](src/useDraft.ts), Logik in
  [draft.ts](src/draft.ts)) mit `set`, `dirty`, `discard`, `save(fn)` (Doppelklick-Sperre, Fehler
  lässt den Entwurf stehen); ein neuer gespeicherter Wert wird nur ohne offenen Entwurf übernommen.
  `<DraftActions>` zeigt „Speichern“/„Verwerfen“ nur bei Änderung; `what` steht unsichtbar **hinter**
  dem sichtbaren Text, nicht als `aria-label` (WCAG 2.5.3). Wechselt die Seite den `scope` selbst,
  fragt sie vorher (`useConfirmDiscard`).
- **`isValid`**: Fällt der Wert eines Entwurfs aus den Optionen, ist der Entwurf verworfen, sonst
  zeigte der Browser den ersten Eintrag und „Speichern“ schickte einen unsichtbaren Wert. Bei einer
  Karte mit mehreren Feldern wird nur gesendet, was sich geändert hat (sonst würde eine geerbte
  Angabe als eigene gespeichert). Eine Rückfrage vor dem Speichern ergibt bei „Abbrechen“ `keepDraft`.
- **Offene Formulare melden sich an**, damit Wechsel von Seite, Objekt und Zeitraum und das
  Schließen des Tabs (`beforeunload`) fragen: Entwürfe von selbst, Karten mit eigenem Zustand über
  `useOpenWhenDiffers(gezeigt, gespeichert)` (nach dem Speichern `markSaved()`), auf/zu-Formulare
  über `useOpenForm(offen)`. Wer ein Formular schließt und zugleich wegspringt, schließt es mit
  `flushSync` vorher. Wächter [openFormGuard.test.ts](src/openFormGuard.test.ts); Karten prüfen ihre
  Anmeldung mit `OpenFormScope`/`hasOpenForm` aus src/testing/openForm.tsx.
- **Wächter [saveOnChange.test.ts](src/saveOnChange.test.ts)**: Ein `<select>` oder ein `<input>` vom
  Typ checkbox, radio oder date, dessen `onChange` speichert, ist verboten (einzige Ausnahme heute:
  die Art einer Zahlung im Mietkonto bis #281). Rückrufe aus Props mit anderem Namen sieht er nicht.
- **Was an einem gespeicherten Wert vorbei handelt, wartet auf den Entwurf daneben**: Ein
  ungespeichertes Jahr der Buchung sperrt Vorschau und Buchen und nimmt die Auswertung aus „Alle
  grünen übernehmen“; ein ungespeichertes Objekt oder Jahr im Posteingang sperrt „Per KI auswerten“
  und „Weiter prüfen“.

## Musterseite und Schreibweisen

- **Musterseite** ([pages/Muster.tsx](src/pages/Muster.tsx)) unter `?muster`, dunkel `?muster=dunkel`: alle
  Bausteine mit festen Werten, ohne Server und ohne Navigation. Browserlauf und `npm run screenshots`
  nehmen sie mit (scripts/CLAUDE.md). Wer einen Baustein ändert oder einen neuen baut, ergänzt ihn dort.
- **Paragrafen** frei stehend mit Leerzeichen („§ 556 BGB“), Feldnamen wie „§35a-Lohn“ bleiben (S29).
