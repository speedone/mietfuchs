# Wohnung und Zimmer (#573)

Stand: Entwurf vom 05.11.2026, nach einer Gegenprüfung aus Sicht der Umsetzung und des Rechts überarbeitet, noch nicht
freigegeben. Teil von #91, baut auf dem Bezugszähler und dem verteilten Rest
aus #98 (PR #574, Entwurf 2026-11-04-virtuelle-zaehler-design.md) auf.

## Ziel

Ein Vermieter, der eine Wohnung zimmerweise vermietet (WG, jedes Zimmer mit eigenem Mietvertrag), soll das ohne Umweg
abbilden können. Heute legt er jedes Zimmer als eigene Wohnung an (so empfohlen im Kommentar zu #573). Das trägt bei
Fläche und Personen, aber nicht an drei Stellen:

1. **Zähler der Wohnung:** Ein Wasser- oder Stromzähler misst die ganze WG. Hängt er an einem Zimmer, trägt dessen
   Mieter den Verbrauch aller; ohne Zähler bleibt der Verbrauch beim Vermieter oder sperrt die Position
   (`meter.rest-mixed`).
2. **Kosten nach Wohneinheiten:** Jedes Zimmer zählt als Einheit, die WG trägt ein Vielfaches.
3. **Zahl der Wohnungen:** Die Ausnahme des § 2 HeizkostenV (höchstens zwei Wohnungen, eine selbst bewohnt) und die des
   § 5d Abs. 3 CO2KostAufG zählen Zimmer als Wohnungen.

Dazu soll die Abrechnung das Zimmer erkennbar benennen: „Zimmer 1 in der Wohnung 1. OG links“.

**Wer keine Zimmer anlegt, merkt nichts.** Ohne die neue Angabe rechnet alles wie bisher, die Golden-Tests bleiben
centgenau grün.

## Rechtliche Grundlage

- Jeder Zimmermieter mit eigenem Vertrag ist eigener Mieter; seine Abrechnung richtet sich nach seinem Vertrag und
  § 556a BGB. Fehlt eine Vereinbarung, gilt die Wohnfläche (§ 556a Abs. 1 Satz 1 BGB). Wird ein Verbrauch erfasst, ist
  er nach einem Maßstab umzulegen, der ihm Rechnung trägt (§ 556a Abs. 1 Satz 2 BGB). Der Zähler der WG erfasst den
  Verbrauch der Wohnung, nicht den des Zimmers; nach Verbrauch geht er deshalb auf die Wohnung. Ihn vorweg auf die Wohnung zu nehmen und innerhalb nach Fläche oder Personen zu teilen, entspricht der
  Lage in BGH, Urteil vom 25.11.2009, VIII ZR 69/09 (Vorwegabzug unbedenklich, Rn. 12, 13; Rest nach Wohnfläche
  zulässig, Rn. 18; keine Pflicht, Nutzergruppen gesondert zu erfassen, Rn. 14, 15). Für Zimmer ohne eigenen Zähler gibt
  es keinen erfassten Verbrauch, der vorginge. Der Fall des BGH (Gewerbe vorweg) passt nur entsprechend.
- Heizung: Jeder Zimmermieter ist Nutzer im Sinne von § 1 HeizkostenV, die Verordnung geht abweichenden Vereinbarungen
  vor (§ 2). Gemeinschaftlich genutzte Räume sind von der Pflicht zur Verbrauchserfassung ausgenommen, außer solchen
  mit nutzungsbedingt hohem Wärme- oder Warmwasserverbrauch wie Schwimmbäder oder Saunen (§ 4 Abs. 3 Sätze 1 und 2).
  Ob Küche und Bad einer WG solche Räume sind, ist nicht entschieden; die Vorschrift zielt auf Räume des Gebäudes.
  **Auslegung von Mietfuchs:** Erfassung in den Zimmern genügt. Ein Wärmezähler der ganzen Wohnung, nach Fläche auf die
  Zimmer geteilt, ist keine Verbrauchserfassung je Nutzer; der Mieter darf dann um 15 % kürzen (§ 12 Abs. 1). Ob eine
  Gastherme, die nur die WG beheizt, bei mehreren Nutzern unter die Verordnung fällt, ist ungeklärt; eine Entscheidung
  dazu ist nicht bekannt.
- Strom der Wohnung und Internet sind keine Betriebskosten (§ 556 Abs. 1 BGB, § 1 BetrKV; auch „sonstige“ nach § 2
  Nr. 17 BetrKV setzt Betriebskosten voraus), und eine Vereinbarung macht sie nicht dazu (§ 556 Abs. 4 BGB). Zulässig
  ist eine gesonderte Zahlungsabrede neben den Betriebskosten, etwa eine Pauschale oder eine Abrechnung nach Zähler; wer
  Strom nach Zähler weitergibt, ist dabei Energielieferant mit Pflichten nach dem EnWG. Mietfuchs rechnet solche
  Positionen auf Wunsch mit ab, weist aber darauf hin.
- Zahl der Wohnungen nach § 2 HeizkostenV: Die WG ist eine Wohnung, die Zimmer sind Teile davon. Ob eine WG, in der der
  Vermieter ein Zimmer bewohnt und die übrigen vermietet, „selbst bewohnt“ im Sinne der Vorschrift ist, ist nicht
  entschieden. **Festlegung von Mietfuchs** (vorsichtig, denn sie lässt die Verordnung eher gelten): Eine Wohnung mit
  vermieteten Zimmern gilt nicht als selbst bewohnt.

## Nicht-Ziele

- **Wechsel zwischen WG und Vermietung im Ganzen.** Eine Wohnung mit Zimmern hat selbst kein Mietverhältnis. Wer eine
  bisher im Ganzen vermietete Wohnung zur WG macht, behält sie für die alten Jahre, nimmt sie ab dem Umbau per
  Nutzungswechsel heraus („ausgenommen“) und legt eine neue Wohnung mit Zimmern an. Das steht im Lexikon.
- **Wärme-, Warmwasser- und Heizkostenverteiler-Zähler an der Wohnung mit Zimmern.** Sie fließen in die eigene
  Heizkostenabrechnung, den CO₂-Anteil und deren Deckungsprüfung (wie in #98 ausgeklammert). Sie hängen an den Zimmern,
  oder die Heizung der WG läuft mit freien Schlüsseln oder Einzelbeträgen eines Messdienstes; die vorhandenen Hinweise
  zur Kürzung nach § 12 HeizkostenV gelten. Die Gastherme als eigene Anlage nur einer Wohnung ist nicht Teil davon.
- **Mehrstufige Gliederung** (Zimmer in Zimmern, Wohnung in Gebäudeteil): nur eine Ebene.
- **Neue Kostenarten** für Strom der Wohnung oder Internet. Sie bleiben „Sonstige“; dazu kommt nur ein Hinweis.

## Anti-Ziele

- Ein Zimmermieter trägt den Verbrauch der ganzen WG, oder der Vermieter still den der WG.
- Die Wohnung zählt neben ihren Zimmern ein zweites Mal (Fläche, Einheiten, Wohnungszahl, Leerstand).
- Der Rest-Cent entsteht zweimal (#202): Die Teilung des WG-Zählers auf die Zimmer und deren Verteilung runden nicht
  getrennt.

## Datenmodell

- `Unit.parentUnitId?: string | null`: die Wohnung, in der die Einheit als Zimmer liegt. Fehlend oder null: keine.
  (`Unit.rooms` ist die Zimmerzahl und bleibt, was es ist.) Spalte `units.parent_unit_id`, Fremdschlüssel auf
  `units.id` mit `ON DELETE RESTRICT`, CHECK ungleich der eigenen Kennung. Neue Spalte mit Einschränkung in zwei
  Migrationsschritten (server/src/db/CLAUDE.md). Den Umstieg berührt es nicht (die db.json kennt keine Zimmer, die Spalte
  bleibt NULL); server/src/legacy bleibt unangetastet.
- Eine Einheit **mit Zimmern** (mindestens eine Einheit verweist auf sie) heißt im Folgenden Wohnung, die anderen
  Zimmer. Regeln, geprüft in `guardUnit` und `crossPropertyViolations` (Wiederherstellen), sonst 400 mit Satz:
  - Wohnung und Zimmer im selben Objekt; eine Wohnung mit Zimmern wechselt das Objekt nicht.
  - Eine Ebene: Ein Zimmer hat keine Zimmer, eine Wohnung liegt in keiner anderen.
  - Die Wohnung hat kein Mietverhältnis, keine Nutzungswechsel und ist weder selbstgenutzt noch Empfänger: nicht in
    `participantUnitIds`, `directUnitId`, `customShares`, `selfAmounts`, `meterRest.unitIds` oder einer Zielgruppe eines
    Zwischenzählers. Dasselbe beim Anlegen eines Mietverhältnisses und beim Speichern einer Position.
  - An der Wohnung hängen nur Zähler der Sparten `kaltwasser`, `strom` und `sonstig` (Strom mit Hinweis
    `rooms.household-cost`, siehe Rechtliche Grundlage). Wird eine Einheit mit anderen Zählern zur Wohnung mit Zimmern,
    400 mit Satz.
- Löschen einer Wohnung mit Zimmern: 409 mit Satz („Lösen oder löschen Sie zuerst die Zimmer …“); `UnitDependents`
  zählt die Zimmer.
- Kostenposition: `CostItem.roomSplit?: 'area' | 'persons'`, wie der Zähler einer Wohnung auf ihre Zimmer geht.
  Fehlend: `area` (§ 556a Abs. 1 Satz 1 BGB). Spalte `cost_items.room_split` mit CHECK. Nur bei Schlüssel `meter`
  bedeutsam; bei anderen Schlüsseln wird sie nicht gespeichert.
- Schnappschuss und Backup: `SnapshotUnit` nimmt `parentUnitId` mit. Abgeschlossene Abrechnungen speichern
  Abrechnungszeilen, nicht Einheiten, und bleiben, wie sie sind.

## Rechnung

1. **Die Wohnung selbst** ist in keiner Verteilbasis: nicht bei Fläche, Personen, Einheiten, Leerstand, nicht als
   bewohnt oder ungemessen.
   **Fläche:** Maßgeblich ist die Fläche der Wohnung, sie geht nach dem Verhältnis der Zimmerflächen auf die Zimmer
   (wirksame Fläche eines Zimmers = Wohnungsfläche × Zimmerfläche / Summe der Zimmerflächen). So zählt die ganze Wohnung
   mit Küche, Bad und Flur genau einmal, gleich ob die Zimmer mit oder ohne Anteil an den Gemeinschaftsflächen
   eingetragen sind, und die übrigen Mieter im Haus tragen nicht mehr als ohne WG. Die wirksame Fläche wird beim Bilden
   des Schnappschusses gesetzt, damit jeder Leser der Fläche sie bekommt (Flächenschlüssel, Grundkosten der Heizung,
   CO₂, § 5a, Leerstand); der Rechenweg nennt beides („12,50 m², Anteil an 80 m²“). Ist die Fläche der Wohnung 0 oder
   leer, gelten die Zimmerflächen, wie sie stehen, mit Hinweis `unit.rooms-area` (`warning`): Fehlen Küche, Bad und
   Flur darin, tragen die übrigen Mieter im Haus zu viel.
2. **Zähler der Wohnung auf die Zimmer** (Schlüssel `meter`, je Position): Der Verbrauch eines Zählers mit
   `unitId` = Wohnung wird im Zeitraum der Position auf die Zimmer der Wohnung geteilt, die in der Verteilbasis der
   Wohnung, nach `roomSplit`: wirksame Fläche mal Tage oder Personentage, je wie der Flächen- bzw. Personenschlüssel
   heute (einschließlich der Regel für leerstehende Tage beim Personenschlüssel). Geteilt wird **immer auf alle Zimmer
   der Wohnung**: Leerstehende Tage eines Zimmers, ein Zimmer außerhalb der Verteilbasis der Position und ein
   ausgenommenes Zimmer tragen ihren Teil beim Vermieter, nie die übrigen Zimmer (wie `outside` in #98); für ein Zimmer
   außerhalb der Basis Hinweis `rooms.outside-basis` mit Betrag. Ein selbstgenutztes Zimmer (der Vermieter wohnt in
   der WG) ist zulässig; sein Teil ist Eigenanteil (privat), wie der gemessene Verbrauch einer selbstgenutzten Wohnung
   heute. Dafür dient der
   Baustein aus #98: Bezugszähler ist der Wohnungszähler, die Gruppe sind die Zimmer (ungemessen), der Schlüssel ist
   `roomSplit`, verteilt über `keyRaws` und **ein** `distributeCents` je Position (#202). Die Zimmer gelten danach für
   die Sparte als gemessen: Im Rest des Hauptzählers (#116) und in `meterRest` (`behindMeterIds` darf den
   Wohnungszähler nennen, sein Wert steht für die Zimmer) zählen sie wie Wohnungen mit eigenem Zähler.
   - Hat ein Zimmer selbst einen Zähler der Sparte, ist die Wohnung gemischt: `meter.rest-mixed` wie in #98, die
     Position wird nicht verteilt, der Vermieter trägt sie sichtbar.
   - Lückenhafter oder fehlender Wohnungszähler: die Hinweise wie bei jedem Zähler (`meter.unit-partial`,
     Ungemessene), bezogen auf die Wohnung.
3. **Einheiten:** Eine Wohnung mit Zimmern zählt als eine Einheit. Das Gewicht eines Zimmers ist sein Anteil an der
   Fläche der Zimmer seiner Wohnung (alle Flächen 0: zu gleichen Teilen), mal Tage wie heute, immer bezogen auf alle
   Zimmer der Wohnung. Ein leeres Zimmer oder eines außerhalb der Basis trägt sein Gewicht beim Vermieter
   (`rooms.outside-basis` wie oben), ein selbstgenutztes als Eigenanteil. Der Rechenweg nennt „1 von N Einheiten, davon x % für dieses Zimmer“.
4. **Wohnungszahl** (`mayAgreeOtherwise` in shared/heating.ts, `agreeableFor` in server/src/db/heatingInfo.ts, die
   Ausnahme nach § 5d Abs. 3 CO2KostAufG, `property.kind-mismatch`, der Hinweis zur Einliegerwohnung): Zimmer zählen
   nicht, eine Wohnung mit Zimmern zählt einmal, wenn eines ihrer Zimmer Wohnung im Sinne von `isDwelling` ist. Die
   Regel sieht dafür statt der Zimmer einen Eintrag für die Wohnung: selbst bewohnt, wenn ein Zimmer im Zeitraum
   selbstgenutzt und keines vermietet ist (Festlegung oben); vermietet, sobald ein Zimmer vermietet ist. Die zweite Fassung der Regel in
   heatingInfo.ts wird dabei auf dieselbe Funktion umgestellt.
5. **Personen** bleiben je Zimmer, wie heute.

## Name

Abrechnung, Anschreiben, Export, Steuer und Hinweise nennen ein Zimmer „<Zimmer> in der Wohnung <Wohnung>“, etwa
„Zimmer 1 in der Wohnung 1. OG links“. Ein Helfer in shared/ bildet den Namen; gesetzt wird er dort, wo der
Schnappschuss die Einheiten übernimmt, damit alle Leser (`Statement.unitName`, Steuer, Hinweise) ihn ohne Umbau
erhalten. Die Stammdaten zeigen Zimmer eingerückt unter ihrer Wohnung mit ihrem eigenen Namen.

## Hinweise

- `unit.rooms-area` (`warning`), siehe Rechnung 1.
- `rooms.outside-basis` (`warning`, mit Betrag), siehe Rechnung 2 und 3.
- `rooms.household-cost` (`warning`): Eine Position, deren Verteilbasis nur Zimmer einer Wohnung sind und deren
  Kostenart nicht Wasser, Entwässerung oder Heizung ist, oder die einen Stromzähler einer Wohnung mit Zimmern verteilt:
  „Kosten nur dieser Wohnung, etwa Strom oder Internet der WG, sind keine Betriebskosten, auch nicht mit einer
  Vereinbarung im Mietvertrag. Verlangen können Sie sie nur aus einer gesonderten Abrede, etwa als Pauschale. In der
  Betriebskostenabrechnung kann der Mieter sie zurückweisen.“
- Beide in `noticeKinds`, im Stil der vorhandenen (gesiezt, ohne Geviertstrich).

## Oberfläche

- Stammdaten, Wohnung: Feld „Liegt als Zimmer in der Wohnung“ (Auswahl über die Wohnungen desselben Objekts ohne
  eigenen Verweis, leer = keine). Hat die Wohnung Zimmer, entfallen Nutzung, Personen und Nutzungswechsel; ein Satz
  erklärt, dass die Zimmer vermietet werden.
- Liste: Zimmer eingerückt unter der Wohnung, die Wohnung mit „N Zimmer“.
- Kostenposition nach Verbrauch: Liegt in der Verteilbasis eine Wohnung mit Zimmern und einem Zähler der Sparte, die
  Auswahl „Zähler der Wohnung auf die Zimmer verteilen nach: Fläche / Personentagen“. Der angezeigte Wert entspricht dem
  gespeicherten (Optionen über die vorhandenen Helfer, client/CLAUDE.md).
- Zählerformular: An einer Wohnung mit Zimmern nur die drei Sparten.
- Lexikon: „Zimmer einer Wohnung (WG)“ mit Beispiel, Wechsel zur WG (Nicht-Ziel oben), Heizung und § 12.
- Anleitung in docs/ (Funktionsweise) und Changelog.

## Tests

- Engine: Beispielfälle (WG mit Wasserzähler nach Fläche und nach Personentagen, leeres Zimmer, Mieterwechsel im Zimmer,
  gemischte WG, Einheiten-Schlüssel, Wohnungszahl mit WG und Einliegerwohnung). Invarianten über zufällige Bestände mit
  Zimmern (Summe, keine negativen Anteile, Eigenanteil ≤ Vermieteranteil), Golden-Dateien unverändert.
- Orakel Fläche: Bestand mit WG gegen denselben Bestand, in dem die WG eine Wohnung mit ihrer Fläche ist; jede andere
  Wohnung trägt bei Fläche, Einheiten und Grundkosten der Heizung centgleich.
- Orakel Zähler: Bestand mit Zimmern gegen den gleichen Bestand, in dem die WG eine Wohnung mit eigenem Zähler und einem
  Mieter ist, Summe je WG gleich.
- API: Regeln aus dem Datenmodell je mit 400/409, Wiederherstellen eines Backups mit verbotener Verknüpfung.
- Client: Formularlogik in unitForm.ts und costForm.ts; jsdom-Test für das neue Auswahlfeld.

## Zuschnitt

1. Datenmodell, Prüfungen, Name, wirksame Fläche, Wohnungszahl (Rechnung 1, 4, 5).
2. Zähler der Wohnung auf die Zimmer, Einheiten-Schlüssel, Hinweise (Rechnung 2, 3).
3. Oberfläche, Lexikon, Doku.

Ein PR, Durchsicht je Aufgabe und am Ende unter den Blickwinkeln Geld und Daten.

## Dem Umsetzenden überlassen

- Genaue Stelle der Teilung in calc.ts (vor `perUnit` oder in `unitUse`), solange Rest-Cent und #116 unverändert
  bleiben.
- Wortlaut der Hinweise und Oberflächentexte.
