# Teil 2: Nebenkostenmodell am Mietverhältnis (#93)

Teil von #91. Baut auf #101 auf.

## Ziel

Nicht jedes Mietverhältnis wird abgerechnet. Gelebt werden neben der Vorauszahlung mit
Abrechnung die Betriebskostenpauschale (§ 556 Abs. 2 BGB), die Inklusivmiete und die feste
Warmmiete. Typische Fälle sind die Einliegerwohnung, möblierte Wohnungen, WG-Zimmer und
Altverträge. Heute bekäme ein solcher Mieter trotzdem eine Nachforderung oder ein Guthaben
ausgewiesen.

## Die Zusage aus #91

**Wer das nicht braucht, merkt nichts.** Die Voreinstellung ist „Vorauszahlung mit
Abrechnung“, und ohne Angabe rechnet alles wie bisher. Die Golden-Tests bleiben grün.

## Datenmodell

Zwei Angaben am Mietverhältnis, weil kalte Kosten und Heizung verschieden geregelt sein können,
etwa eine Pauschale für die kalten Kosten und eine Abrechnung über den Messdienst für die
Heizung:

- `Tenancy.costModel?: 'settlement' | 'flatRate' | 'inclusive'`: kalte Betriebskosten.
- `Tenancy.heatingModel?: 'settlement' | 'flatRate' | 'inclusive'`: Heizung und Warmwasser.
- Fehlt eine Angabe, gilt `settlement`.

**Heizung erkennt Mietfuchs an der Kostenart.** Die neue Kostenart „Heizung und Warmwasser“ steht
an allen drei Stellen:

- in `CATEGORIES` (Oberfläche) samt `matchCategory`. Dort steht die Heizung **vor** „Wasser“,
  sonst fiele „Warmwasser“ unter Wasser/Abwasser.
- im Kategorie-Schema der KI-Auswertung (extract.ts)
- in `ANLAGE_V_GROUP` als „Laufende Betriebskosten“

## Berechnung

- **Die Wohnung bleibt in der Verteilbasis**, sonst trügen die übrigen Mieter ihren Teil mit. Der
  Anteil eines Mietverhältnisses, dessen Modell für die Kostenart nicht `settlement` ist, wird
  ihm **nicht zugebucht und fällt dem Vermieter zu**. Anders als bei `selfUsed` ist er **nicht**
  Eigenanteil, also als Werbungskosten abziehbar. `selfUsedShareCents` bleibt deshalb
  unberührt.
- **Abrechnung für den Mieter:**
  - Bei `settlement` für beide Arten wie bisher.
  - Ist eine Art nicht abzurechnen, stehen deren Zeilen nicht in der Abrechnung.
  - Bleibt keine Zeile übrig, **erhält das Mietverhältnis keine Abrechnung**. Es fehlt dann in
    `statements` und steht mit Namen und Modell in einer eigenen Liste `notSettled` des
    Ergebnisses, damit die Oberfläche es erklären kann statt es verschwinden zu lassen.
  - Nachzahlung oder Guthaben entstehen so nur aus Zeilen, die tatsächlich abgerechnet werden.
- **Mietkonto und Steuer unverändert:**
  - Eine Pauschale wird als Staffel „Vorauszahlung“ eingetragen, eine Inklusivmiete ganz in der
    Kaltmiete.
  - Das Soll des Mietkontos und die Einnahmen der Steuerübersicht stimmen damit ohne weitere
    Regel.
  - Die Oberfläche beschriftet die Staffel bei einer Pauschale als „Pauschale“.
- **Warnung nach § 2 HeizkostenV**, wenn für die Heizung `flatRate` oder `inclusive` gilt und
  das Objekt die Ausnahme nicht erfüllt. Die Ausnahme verlangt höchstens zwei Wohnungen, von
  denen eine selbstgenutzt ist.
  - Wortlaut: „Für Heizung und Warmwasser gilt die Heizkostenverordnung vor der Vereinbarung
    (§ 2 HeizkostenV); eine Pauschale oder Warmmiete ist nur im Zweifamilienhaus mit
    selbstbewohnter Wohnung zulässig. Der Mieter kann eine verbrauchsabhängige Abrechnung
    verlangen und bis dahin um 15 % kürzen (§ 12).“
  - Die Warnung erscheint **nur, wenn im Jahr eine Heizposition existiert**.
  - Einen Betrag nennt sie nicht, solange der Rechenweg nach BGH VIII ZR 212/05 nicht geprüft
    ist (#93, „Offen“).

## Oberfläche

- **Stammdaten, Formular Mietverhältnis:** zwei Auswahlfelder „Nebenkosten“ und „Heizung und
  Warmwasser“, voreingestellt „Vorauszahlung mit Abrechnung“. Sie stehen unter den erweiterten
  Angaben. Heißt die Auswahl „Pauschale“, wird die Staffel „Vorauszahlung“ als „Pauschale“
  beschriftet.
- **Abrechnung:** Unter den Abrechnungen erscheint ein Kasten „Ohne Abrechnung“, der die
  Mietverhältnisse aus `notSettled` mit ihrem Modell nennt.
- **Kostenarten:** Die neue Kostenart erscheint in der Auswahl. Die Vorbelegung des Schlüssels
  ist `amounts`, wenn Einzelbeträge naheliegen; sonst Fläche.

## Datenbank

- **Spalten** `tenancies.cost_model` und `tenancies.heating_model`, beide Text mit CHECK-Liste,
  NULL heißt `settlement`.
- **Migration:** Erst die Spalten erzeugen (0005), dann die Bedingungen (0006). Das ist das
  Muster aus dem README gegen die Falle von drizzle-kit beim Neubau mit neuen Spalten.
- **Prüfbedingungen** sprechen ihre Spalten unqualifiziert an, siehe den Wächter in
  migrations.test.ts.
- **Die eingefrorene Kette bleibt unberührt:** Die alte `db.json` kennt beide Felder nicht, und
  `LegacyTenancy` lässt sie weg.

## Tests

- **calc**:
  - Pauschale für kalte Kosten: keine Abrechnung, Anteil beim Vermieter, Eigenanteil
    unverändert.
  - Gemischt: kalt Pauschale, Heizung per Einzelbetrag; die Abrechnung enthält nur die
    Heizung.
  - Inklusivmiete: `notSettled`.
  - Die Warnung nach § 2 mit und ohne Ausnahme sowie ohne Heizposition.
  - Die Invariante „Mieter + Vermieter = Gesamt“ mit zufälligen Modellen.
- **Repository und Schema**: Rundreise und Prüfbedingung.
- **Client**: das Formular des Mietverhältnisses, `matchCategory` („Warmwasser“ ist Heizung) und
  der Kasten „Ohne Abrechnung“.
