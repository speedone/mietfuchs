# Nicht vereinbarte Betriebskosten trägt der Vermieter (#258)

## Ziel und Warum

Betriebskosten trägt ein Mieter nur, soweit sein Vertrag es vereinbart (§ 556 Abs. 1 Satz 1 BGB). Die
meisten Verträge legen mit „Der Mieter trägt die Betriebskosten“ alles um; das genügt (BGH, Urteil vom
10.02.2016, VIII ZR 137/15, Rn. 11–21). Zwei Fälle kommen bei privaten Vermietern trotzdem vor:

1. **Ein Vertrag zählt nur einige Kostenarten auf** („Wasser, Müll, Grundsteuer, Heizung“). Dann gilt nur
   die Liste (BGH, Urteil vom 10.10.2007, VIII ZR 279/06, Rn. 19 f.).
2. **„Sonstige Betriebskosten“ (§ 2 Nr. 17 BetrKV) sind im Vertrag nicht ausdrücklich benannt.** Dann trägt
   sie der Mieter nicht, auch nicht beim Pauschalverweis (BGH, Urteil vom 07.04.2004, VIII ZR 167/03,
   Leitsatz b, Rn. 19 f.; VIII ZR 137/15, Rn. 12; BGH, Urteil vom 14.02.2007, VIII ZR 123/06).

Heute behilft man sich, indem man die Wohnung bei der Position aus den Teilnehmern nimmt (#94). Dann
tragen **die übrigen Mieter** ihren Anteil, weil die Wohnung aus der Verteilbasis fällt. Das ist eine
falsche Zahl: Den Anteil an einer nicht vereinbarten Art trägt der Vermieter. Dafür gibt es keine
ausdrückliche Entscheidung; es folgt daraus, dass jeder Mieter nur aus seinem Vertrag schuldet, und aus
der Leerstandsrechtsprechung, nach der der Schlüssel nicht so geändert werden darf, dass andere den Anteil
tragen (BGH, Urteil vom 31.05.2006, VIII ZR 159/05, schon in `shared/law/practice.ts`). **Auslegung von
Mietfuchs**, wird als solche genannt.

## Ziele, Nicht-Ziele, Anti-Ziele

- **Ziel:** In beiden Fällen rechnet Mietfuchs richtig, und der Anteil steht beim Vermieter mit eigenem Grund.
- **Ziel:** Wer einen üblichen Vertrag hat, sieht **nichts Neues**. Gefragt wird nur, wo es um Geld geht, und
  dort, wo man ohnehin arbeitet.
- **Nicht-Ziel:** den Mietvertrag am Mietverhältnis vollständig erfassen (Liste je Kostenart, Staffel „gilt
  ab“). Das wäre ein neuer Ort für alle, gebraucht von wenigen.
- **Anti-Ziel:** Eine neue Pflichtfrage oder ein neues Formularfeld für jeden. Eine Änderung an bestehenden
  Abrechnungen ohne Zutun (Golden-Tests bleiben centgenau grün).

## Entscheidungen

### 1. Datenmodell: zwei Listen an der Kostenposition

```ts
CostItem.notAgreedTenancyIds?: string[] | null   // diese Mietverhältnisse tragen die Position nicht (Vertrag)
CostItem.namedTenancyIds?: string[] | null       // nur bei „Sonstige“: im Vertrag ausdrücklich benannt (bestätigt)
```

- Fehlt beides, rechnet Mietfuchs wie heute.
- Gespeichert wird an der Position, nicht am Mietverhältnis: So bleibt alles an einer Stelle, und „Aus dem
  Vorjahr übernehmen“ (#141) nimmt beide Listen mit, denn die Mietverhältnisse sind im Folgejahr dieselben.
  Ein Mietverhältnis, das im Zeitraum der neuen Position nicht besteht, fällt beim Übernehmen heraus.
- **Mieterwechsel beim Übernehmen:** Hatte die Vorjahresposition einen Mieter in `notAgreedTenancyIds` oder
  `namedTenancyIds` und hat dieselbe Wohnung im neuen Zeitraum ein anderes Mietverhältnis, fragt die Zeile der
  Vorschau: „Neuer Mieter in EG links (Lea Schneider): Trägt sie diese Kosten laut Vertrag?“ mit „Ja“ / „Nein“
  (bei „Sonstige“: „im Vertrag ausdrücklich genannt?“). Ohne Antwort wird übernommen, als trüge sie sie, und
  bei „Sonstige“ greift der Hinweis aus 5. So wandert kein Geld still zum neuen Mieter. *Entscheidung von
  Claude nach der Bauprüfung.*
- Migration: zwei Spalten (JSON-Text wie `participant_unit_ids`) in der Tabelle der Kostenpositionen, ein
  Migrationsschritt, Validator (nur Kennungen bestehender Mietverhältnisse derselben Wohnungen des Objekts),
  Backup und Umstieg wie die übrigen Felder der Position.
- Nicht erlaubt in den Kostenarten „Heizung und Warmwasser“, „Nicht umlagefähig“, „Zuführung
  Erhaltungsrücklage“ (siehe 4); der Server lehnt sie dort mit Satz ab.

### 2. Berechnung

- Die Wohnung **bleibt in der Verteilbasis**; verteilt wird wie heute. Danach geht der Anteil jedes
  Mietverhältnisses aus `notAgreedTenancyIds` an den Vermieter: neuer `LandlordReason` **`notAgreed`**,
  mit eigenem Satz im Rechenweg und in der Übersicht des Vermieters.
- Das gilt für jeden Schlüssel, auch Einzelbeträge (`tenancyAmounts`) und Direktzuordnung: Der Betrag des
  Mietverhältnisses wird nicht ihm, sondern dem Vermieter zugerechnet.
- „Sonstige“ ohne Antwort (weder in `notAgreedTenancyIds` noch in `namedTenancyIds`): Rechnung wie heute,
  dazu ein Hinweis (siehe 5).
- **Invariante** im Zufallstest: Mieteranteile + Vermieteranteil = Gesamtkosten, und die Anteile der
  übrigen Mieter ändern sich nicht, wenn ein Mietverhältnis in `notAgreedTenancyIds` aufgenommen wird.
- Steuer unverändert: Die Kosten sind voll Werbungskosten; nur die Erstattung durch den Mieter entfällt.
- Gedruckte Abrechnung des Mieters: Die Position fehlt bei ihm (formell genügt das, BGH, Urteil vom
  19.01.2016, VIII ZR 93/15, Leitsätze 1 und 2, Rn. 8).

### 3. Oberfläche, Fall 1: beim Abwählen der Teilnehmer

Im Seitenfenster der Kostenposition erscheint beim Abwählen einer Wohnung in den Teilnehmern direkt
darunter eine kurze Frage (kein Dialog), nur für diese Wohnung:

> Warum trägt EG links diese Kosten nicht?
> ( ) Betrifft die Wohnung nicht, etwa Aufzug für das Erdgeschoss. Die übrigen Wohnungen tragen den Anteil.
> ( ) Steht nicht im Mietvertrag von Anna Becker. Den Anteil trägt der Vermieter.

- Voreinstellung: keine Wahl; „Speichern“ meldet am Feld „Bitte wählen Sie, warum“ (wie jede Pflichtangabe).
- Hat die Wohnung im Zeitraum mehrere Mietverhältnisse, steht je Mietverhältnis ein Häkchen unter der
  zweiten Antwort („… im Mietvertrag von: [x] Anna Becker  [ ] Lea Schneider“).
- Leerstehende Wohnung ohne Mietverhältnis im Zeitraum: keine Frage, wie heute.
- In der Liste der Positionen steht wie heute „nur EG rechts, OG“ bzw. neu „trägt nicht: Anna Becker
  (Vertrag)“.

### 3a. Oberfläche, Fall 1 ohne Teilnehmerliste

Die Teilnehmerliste gibt es nur bei mehreren Wohnungen und den Schlüsseln mit Verteilbasis. Für die übrigen
Fälle (Objekt mit einer Wohnung, vermietete Eigentumswohnung, Direktzuordnung, vereinbarte Prozente) und
als zweiter Weg für alle steht unten im Abschnitt Schlüssel ein **unauffälliger Textlink** „Ein Mieter trägt
das laut Mietvertrag nicht …“. Er klappt die Mietverhältnisse auf, die im Zeitraum an der Position
teilnehmen, je mit Häkchen („trägt nicht, steht nicht im Vertrag“). Ist schon eines angehakt, steht der
Abschnitt offen. Nicht bei den Kostenarten aus Entscheidung 1 (Heizung, nicht umlagefähig, Rücklage).
*Entscheidung von Claude nach der Bauprüfung.*

### 4. Heizung und Warmwasser

Bei „Heizung und Warmwasser“ gibt es die zweite Antwort nicht. Ein Satz darunter: „Die
Heizkostenverordnung gilt auch, wenn der Mietvertrag die Heizkosten nicht nennt; der Heizanteil der Miete
wird dann als Vorauszahlung angerechnet (BGH VIII ZR 212/05). Stellen Sie dafür beim Mietverhältnis die
Heizkosten auf ‚in der Miete enthalten‘.“ Das ist der vorhandene Weg (`heatingModel` `inclusive`,
Regel `heating-flat-rate`), kein zweiter.

### 5. Oberfläche, Fall 2: „Sonstige Betriebskosten“

Im Seitenfenster einer Position der Kostenart „Sonstige Betriebskosten“ steht ein Abschnitt:

> Im Mietvertrag ausdrücklich genannt? Sonstige Betriebskosten trägt ein Mieter nur, wenn der Vertrag sie
> beim Namen nennt, etwa „Dachrinnenreinigung“ (BGH VIII ZR 167/03).
> Anna Becker   ( ) Ja  ( ) Nein
> Jonas Hartmann ( ) Ja  ( ) Nein

- Je Mietverhältnis, das an der Position teilnimmt und im Zeitraum besteht. „Ja“ → `namedTenancyIds`,
  „Nein“ → `notAgreedTenancyIds`. Keine Pflicht: ohne Antwort wird gespeichert.
- Gilt für jede **gebuchte** Position dieser Kostenart. „Sonstige“ ist auch die Auffangkategorie der
  Belegbuchung, aber unklare Belege meldet der Posteingang schon vor dem Buchen („Kategorie unklar“); eine
  gebuchte Position ist bewusst zugeordnet. Der Abschnitt beginnt deshalb mit dem Satz „Gehört die Position
  eigentlich zu einer anderen Kostenart, wählen Sie diese oben.“ Kein neues Kennzeichen „unklar“.
  *Entscheidung von Claude nach der Bauprüfung.*
- Hinweis `allocation.other-unanswered` (Stufe `hint`) in der Abrechnung, solange eine Position „Sonstige“
  Mietverhältnisse ohne Antwort hat, mit Betrag je Mieter und „Hier beheben →“ zur Position. Begriff
  `namedOtherCosts` im Lexikon (Erklärung, Beispiel mit Zahlen, Rechtsgrundlage, „Brauche ich das?“).

### 6. Hinweise

| Code | Stufe | Wann |
|---|---|---|
| `allocation.not-agreed` | `hint` | Eine Position trägt ein Mieter nicht, weil sie nicht vereinbart ist: „… trägt der Vermieter (§ 556 Abs. 1 BGB)“, mit Betrag. Information, kein Fehler. |
| `allocation.other-unanswered` | `hint` | Siehe 5. |

Mit Begriffen im Lexikon; der Satz zur Auslegung (Vermieter trägt) steht unter „Mehr dazu“ mit
VIII ZR 159/05.

## Was dem Bauenden bleibt

- Wortlaut der Sätze im Rahmen von client/CLAUDE.md (Hinweise, Verben, Schreibweise), Lage des Abschnitts
  im Seitenfenster.
- Spaltennamen und Schritt der Migration nach server/src/db/CLAUDE.md.
- Wo in calc.ts die Zurechnung an den Vermieter geschieht, solange die Invariante gilt.

## Prüfung

Ein PR, Label `full-check`, Durchsicht unter den Blickwinkeln Geld (Invariante, Golden-Tests, Steuer,
Mietkonto unberührt) und Daten (Migration, Validator, Backup, Umstieg, „Aus dem Vorjahr übernehmen“).
