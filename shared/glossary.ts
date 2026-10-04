// Das Begriffslexikon (#113): jeder Fachbegriff, dem ein Vermieter in Mietfuchs begegnet, mit
// einer Erklärung in einem Satz, einem Beispiel mit Zahlen, der Rechtsgrundlage und der Antwort
// auf „Brauche ich das?“.
//
// Es liegt in shared/, weil beide Seiten es brauchen: Der Server hängt an jeden Hinweis die
// passenden Begriffe (`noticeKinds` in calc.ts), der Client zeigt sie an. Es ist der erste
// Laufzeitanteil hier; das Docker-Image übernimmt den Ordner (siehe CLAUDE.md).
//
// Maßstab für die Texte: einfache Worte, eine Rechtsaussage nur, wo sie im Gesetz steht, und
// Rechtsprechung ohne Aktenzeichen, wenn das Aktenzeichen nicht sicher belegt ist. Wer einen
// Eintrag ändert, prüft ihn bei der jährlichen Durchsicht mit (#110).

export type Term = {
  title: string
  // ein Satz
  short: string
  // mit Zahlen gerechnet
  example: string
  // Rechtsgrundlage, wo es eine gibt
  norm?: string
  // „Brauche ich das?“
  needed: string
}

export const GLOSSARY = {
  allocable: {
    title: 'Umlagefähige Betriebskosten',
    short: 'Laufende Kosten des Hauses, die Sie auf die Mieter umlegen dürfen, wenn der Mietvertrag das vorsieht; welche das sind, zählt die Betriebskostenverordnung auf.',
    example: 'Grundsteuer 600 €, Müllabfuhr 360 €, Gebäudeversicherung 540 € im Jahr: zusammen 1.500 € umlagefähig.',
    norm: '§ 556 Abs. 1 BGB, § 2 BetrKV',
    needed: 'Ja, das ist der Kern jeder Nebenkostenabrechnung.',
  },
  notAllocable: {
    title: 'Nicht umlagefähige Kosten',
    short: 'Kosten, die der Vermieter selbst trägt, vor allem Verwaltung, Reparaturen und Instandhaltung; Mietfuchs rechnet sie ganz dem Vermieter zu.',
    example: 'Reparatur der Heizung 800 € und Kontoführung 60 €: beide 860 € trägt der Vermieter, auf der Abrechnung erscheinen sie nicht beim Mieter.',
    norm: '§ 1 Abs. 2 BetrKV',
    needed: 'Nur wenn Sie solche Rechnungen trotzdem erfassen, etwa für die Steuer (Anlage V). Die Zuführung zur Erhaltungsrücklage einer Eigentumswohnung erfassen Sie bitte nicht hier, sondern als Kostenart „Zuführung Erhaltungsrücklage“: Sie ist erst abziehbar, wenn die Gemeinschaft das Geld ausgibt.',
  },
  allocationKey: {
    title: 'Umlageschlüssel',
    short: 'Die Regel, nach der eine Rechnung auf die Wohnungen verteilt wird: nach Wohnfläche, Personen, Wohneinheiten, Verbrauch oder einer vereinbarten Quote.',
    example: '900 € Müllabfuhr nach Wohnfläche: Eine Wohnung mit 60 von 180 m² trägt 300 €.',
    norm: '§ 556a Abs. 1 BGB',
    needed: 'Ja, für jede Kostenposition. Ist im Mietvertrag nichts vereinbart, gilt die Wohnfläche; für gemessenen Verbrauch der Verbrauch, für Heizung die Heizkostenverordnung und bei einer Eigentumswohnung der Schlüssel der Gemeinschaft.',
  },
  // #141: Der Hinweis „Umlageschlüssel anders als im Vorjahr“ verweist hierher. Wortlaut des
  // § 556a BGB und des § 6 Abs. 4 HeizkostenV nachgelesen auf gesetze-im-internet.de am 01.10.2026.
  keyChange: {
    title: 'Wechsel des Umlageschlüssels',
    short: 'Ein vereinbarter Umlageschlüssel gilt weiter, bis er geändert wird: mit Zustimmung der Mieter, oder einseitig durch Ihre Erklärung in Textform, aber nur vor Beginn eines Abrechnungszeitraums und nur hin zu einer Verteilung nach erfasstem Verbrauch oder erfasster Verursachung.',
    example: 'Müllabfuhr 900 € bisher nach Personen: Ein Haushalt mit 4 von 6 Personen trug 600 €. Nach Wohnfläche mit 60 von 180 m² wären es 300 €. Ohne Zustimmung der Mieter bleibt es bei den Personen, denn ein Wechsel zur Fläche ist keiner hin zum Verbrauch.',
    norm: '§ 556a Abs. 2 und Abs. 3 BGB, § 6 Abs. 4 HeizkostenV',
    needed: 'Nur wenn Sie einen Schlüssel anders wählen als im Vorjahr. Bei einer vermieteten Eigentumswohnung gilt, soweit nichts anderes vereinbart ist, der jeweils geltende Maßstab der Gemeinschaft; ändert die Gemeinschaft ihn, ändert er sich auch gegenüber dem Mieter. Widerspricht er billigem Ermessen, wird nach Absatz 1 umgelegt, in der Regel nach Wohnfläche. Für Heizung und Warmwasser gilt vorrangig § 6 Abs. 4 HeizkostenV: Dort darf der Maßstab für künftige Abrechnungszeiträume auch aus anderen sachgerechten Gründen geändert werden.',
  },
  distributionBasis: {
    title: 'Verteilbasis',
    short: 'Die Gesamtmenge, durch die geteilt wird, etwa die Summe aller Wohnflächen; jede Wohnung trägt ihren Teil davon.',
    example: 'Drei Wohnungen mit 50, 60 und 70 m² ergeben eine Verteilbasis von 180 m². Die Wohnung mit 60 m² trägt 60/180 = ein Drittel.',
    needed: 'Sie rechnen sie nicht selbst aus, Mietfuchs zeigt sie im Rechenweg. Wichtig ist nur, dass für jede Wohnung der Wert eingetragen ist.',
  },
  billingUnit: {
    title: 'Abrechnungseinheit',
    short: 'Die Wohnungen, die gemeinsam abgerechnet werden; eine Wohnung außerhalb, etwa ein Laden mit eigener Abrechnung, bleibt ganz außen vor.',
    example: 'Haus mit drei Wohnungen und einem Laden: Die drei Wohnungen bilden die Abrechnungseinheit. Von 1.200 € Grundsteuer ziehen Sie zuerst den Anteil des Ladens ab, etwa 300 €; nur die übrigen 900 € verteilen sich auf die Wohnungen.',
    needed: 'Nur wenn nicht alle Einheiten gemeinsam abgerechnet werden. Sonst gehört jede Wohnung dazu. Nehmen Sie eine Einheit heraus, gehört auch ihr Anteil an gemeinsamen Rechnungen heraus, sonst tragen ihn die Mieter mit.',
  },
  granny: {
    title: 'Einliegerwohnung',
    short: 'Eine kleinere zweite Wohnung in einem Haus, das Sie selbst bewohnen; Sie rechnen die Nebenkosten nur mit dieser einen Mietpartei ab, Ihren eigenen Anteil tragen Sie selbst.',
    example: 'Ihre Wohnung hat 120 m², die Einliegerwohnung 45 m², zusammen 165 m². Von 600 € Grundsteuer nach Wohnfläche trägt die Mieterin 600 € × 45/165 = 163,64 €, die übrigen 436,36 € sind Ihr Eigenanteil.',
    norm: '§ 556a Abs. 1 BGB, § 2 HeizkostenV',
    needed: 'Wenn Sie im eigenen Haus eine Einliegerwohnung vermieten. Legen Sie ein Objekt an, Ihre eigene Wohnung als selbstgenutzt mit Fläche und Personen, die Einliegerwohnung als vermietet. Hat nur die Einliegerwohnung einen Zwischenzähler, legen Sie den Zähler des Hauses als Hauptzähler ohne Wohnung an: Dann zahlt die Mieterin ihren gemessenen Verbrauch, und der Rest ist Ihr Eigenanteil. Dieser Eigenanteil ist privat und steuerlich nicht abziehbar; in die Anlage V gehören die Kosten des Gebäudes nur zu dem Teil, der auf die vermietete Fläche entfällt. Bei den Heizkosten dürfen Sie in einem Gebäude mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, mit der Mieterin etwas anderes vereinbaren als die Heizkostenverordnung, etwa eine Warmmiete; ohne eine solche Vereinbarung gilt sie.',
  },
  ownShare: {
    title: 'Eigenanteil',
    short: 'Der Teil der Kosten, der auf Ihre selbstgenutzte oder unentgeltlich überlassene Wohnung entfällt; Sie tragen ihn selbst, und er ist privat, also nicht als Werbungskosten abziehbar. Für die darin enthaltenen Arbeitskosten können Sie als Bewohner selbst die Steuerermäßigung nach § 35a nutzen. Was Sie wegen Leerstand oder als Rundungsrest tragen, gehört nicht dazu und bleibt Werbungskosten.',
    example: 'Grundsteuer 1.000 € nach Fläche, Ihre Wohnung hat 80 von 200 m²: 400 € sind Eigenanteil, nur die übrigen 600 € gehören in die Anlage V.',
    norm: '§ 9 Abs. 1, § 12 Nr. 1, § 35a EStG',
    needed: 'Wenn Sie selbst im Haus wohnen. Legen Sie Ihre Wohnung dann als selbstgenutzt an, sonst zahlen die Mieter Ihren Teil mit. Das gilt auch für eine Wohnung, die Sie unentgeltlich überlassen.',
  },
  mixedUse: {
    title: 'Teilweise selbstgenutztes Gebäude',
    short: 'Wohnen Sie selbst im Haus, sind dessen Kosten nur zu dem Teil Werbungskosten, der auf den vermieteten Teil entfällt: Was einer Wohnung direkt zuzuordnen ist, gehört ganz zu ihr, die Kosten des ganzen Gebäudes werden nach dem Verhältnis der Wohn- und Nutzflächen aufgeteilt.',
    example: 'Ihre Wohnung hat 120 m², die Einliegerwohnung 60 m², zusammen 180 m². Die Dachreparatur über 1.800 € ist zu 60/180 abziehbar, also 600 €; 1.200 € sind privat. Die Badrenovierung der Einliegerwohnung über 4.000 € ist ganz abziehbar, die in Ihrer Wohnung gar nicht.',
    norm: '§ 9 Abs. 1, § 12 Nr. 1 EStG; BFH, Urteil vom 24.06.2008, IX R 26/06',
    needed: 'Wenn Sie in einem Haus, in dem Sie vermieten, selbst wohnen oder eine Wohnung unentgeltlich überlassen. Legen Sie die eigene Wohnung als selbstgenutzt mit Fläche an; die Steuerübersicht teilt die Werbungskosten dann auf und zeigt den Rechenweg. Eine Reparatur, die nur eine Wohnung betrifft, ordnen Sie unter Kosten bei „Betrifft (für die Steuer)“ dieser Wohnung zu, eine Reparatur am Dach nur eines Gebäudeteils den betroffenen Einheiten. Wer zum ersten Mal verhältnismäßig aufteilt, erläutert dem Finanzamt den Maßstab in einer gesonderten Aufstellung; dafür taugt der Ausdruck der Steuerübersicht.',
  },
  vacancy: {
    title: 'Leerstand',
    short: 'Eine Wohnung ohne Mieter; ihren Anteil an den Kosten trägt der Vermieter und nicht die übrigen Mieter.',
    example: 'Eine von drei gleich großen Wohnungen steht vier Monate leer: Von 1.200 € Grundsteuer trägt der Vermieter für diese Zeit 400 € × 4/12 = 133,33 €. Beim Personenschlüssel zählt die leere Wohnung je Leerstandstag mit einer Person: Wohnen in den beiden anderen das ganze Jahr 2 und 1 Personen und steht die dritte leer, trägt der Vermieter von 600 € Müllabfuhr 600 € × 365/1.460 = 150 €.',
    norm: 'BGH, Urteil vom 31.05.2006, VIII ZR 159/05 (Grundsatz, am Flächenschlüssel); zum Personenschlüssel BGH, Beschluss vom 08.01.2013, VIII ZR 180/12',
    needed: 'Mietfuchs rechnet ihn von selbst heraus. Sie müssen nur Ein- und Auszug richtig eintragen. Wie eine leere Wohnung beim Personenschlüssel anzusetzen ist, regelt kein Gesetz und ist nicht abschließend geklärt; nach dem BGH kommt es auf den Einzelfall an, und eine fiktive Person für die Zeit des Leerstands kommt in Betracht; im Einzelfall hält er es auch für vertretbar, den Leerstand ganz außer Acht zu lassen. Mietfuchs setzt eine Person je Leerstandstag an; das ist eine Auslegung von Mietfuchs. Bei Kosten, die von der Personenzahl abhängen (etwa Wasser nach Personen), kann eine andere Aufteilung angemessener sein, zum Beispiel in Grund- und Verbrauchskosten.',
  },
  // #204: Der Hinweis „Mietverhältnisse überschneiden sich“ verweist hierher. Keine Rechtsgrundlage:
  // Es geht um einen Fehler in den erfassten Daten, nicht um eine Regel.
  tenancyOverlap: {
    title: 'Überschneidende Mietverhältnisse',
    short: 'Zwei Mietverhältnisse derselben Wohnung bestehen laut Ihren Angaben an mindestens einem Tag zugleich; für diese Zeit wird die Wohnung doppelt berechnet.',
    example: 'Auszug am 30.09. eingetragen, Nachmieter ab 01.09.: Bei 1.200 € Grundsteuer und einer Wohnung mit 50 von 100 m² tragen beide Mieter für dieselben 30 Tage je 1.200 € × 50/100 × 30/365 = 49,32 €, die Wohnung also 49,32 € zu viel.',
    needed: 'Nur wenn es Ihnen angezeigt wird. Meist ist ein Datum vertippt: Berichtigen Sie dann Auszug oder Einzug in den Stammdaten. Für den Wechsel gibt es dort den Mieterwechsel, der die Daten lückenlos setzt. Mietfuchs rechnet bis dahin wie erfasst.',
  },
  personDays: {
    title: 'Personentage',
    short: 'Beim Personenschlüssel zählt, wie viele Personen wie viele Tage im Jahr in der Wohnung gewohnt haben.',
    example: 'Zwei Personen das ganze Jahr sind 2 × 365 = 730 Personentage; zieht im Juli eine dritte ein, kommen 1 × 184 dazu.',
    needed: 'Nur beim Umlageschlüssel „Personen“. Tragen Sie Änderungen der Personenzahl mit Datum ein. Tage, an denen eine Wohnung leer steht, zählen mit einer Person; diesen Anteil tragen Sie als Vermieter (siehe Leerstand).',
  },
  prepayment: {
    title: 'Vorauszahlung',
    short: 'Ein monatlicher Betrag auf die Nebenkosten, über den einmal im Jahr abgerechnet wird; danach gibt es eine Nachzahlung oder ein Guthaben.',
    example: '150 € im Monat sind 1.800 € im Jahr. Betragen die Kosten 2.000 €, zahlt der Mieter 200 € nach.',
    norm: '§ 556 Abs. 2, § 560 Abs. 4 BGB',
    needed: 'Ja, wenn der Mietvertrag Vorauszahlungen vorsieht, der Normalfall. Nach der Abrechnung dürfen Sie sie angemessen anpassen.',
  },
  flatRate: {
    title: 'Betriebskostenpauschale',
    short: 'Ein fester monatlicher Betrag für die Nebenkosten, über den nicht abgerechnet wird; es gibt weder Nachzahlung noch Guthaben.',
    example: '120 € Pauschale im Monat sind 1.440 € im Jahr, gleich was die Kosten tatsächlich betragen.',
    norm: '§ 556 Abs. 2, § 560 Abs. 1 und 3 BGB',
    needed: 'Nur wenn der Mietvertrag eine Pauschale vereinbart. Erhöhen dürfen Sie sie nur, wenn der Vertrag das vorsieht und die Kosten tatsächlich gestiegen sind, mit einer begründeten Erklärung in Textform; sinken die Kosten, müssen Sie sie senken.',
  },
  inclusiveRent: {
    title: 'Inklusivmiete',
    short: 'Die Nebenkosten stecken in der Miete und werden weder gesondert ausgewiesen noch abgerechnet; steckt auch die Heizung darin, spricht man von einer Bruttowarmmiete. Nicht zu verwechseln mit der „Warmmiete“ im Alltag, die meist Kaltmiete plus Vorauszahlungen mit Abrechnung meint.',
    example: '750 € Miete im Monat einschließlich aller Nebenkosten: Es gibt keine Abrechnung, die Kosten trägt der Vermieter aus den 9.000 € Jahresmiete.',
    needed: 'Nur bei solchen Verträgen, häufig bei möblierten Zimmern oder Einliegerwohnungen. Für die Heizung gilt die Heizkostenverordnung trotzdem; eine Warmmiete ist nur im Haus mit höchstens zwei Wohnungen wirksam, von denen Sie eine selbst bewohnen, oder in den Ausnahmen des § 11 (siehe dort).',
  },
  heatingCostOrdinance: {
    title: 'Heizkostenverordnung',
    short: 'Heizkosten müssen zu 50 bis 70 Prozent nach Verbrauch verteilt werden, der Rest nach Fläche oder umbautem Raum; beim Warmwasser der Rest nur nach Fläche. Die Verordnung geht einer anderen Vereinbarung im Mietvertrag vor.',
    example: '3.000 € Heizkosten, 70 % nach Verbrauch: 2.100 € nach den Messwerten, 900 € nach Wohnfläche. Wird nicht nach Verbrauch abgerechnet, etwa nur nach Fläche, darf der Mieter seinen Anteil um 15 % kürzen. Unabhängig davon darf er um 3 % kürzen, wenn Zähler nicht fernablesbar sind, obwohl sie es sein müssten (neue Geräte seit Dezember 2021, alle übrigen ab 2027), oder wenn die vorgeschriebenen Verbrauchsinformationen fehlen.',
    norm: '§§ 1, 2, 5, 6a, 7, 8, 11, 12 HeizkostenV',
    needed: 'Bei einer Zentralheizung, bei Fernwärme und bei zentraler Warmwasserbereitung, nicht bei einer Gastherme in der Wohnung mit eigenem Vertrag des Mieters. Im Haus mit höchstens zwei Wohnungen, von denen Sie eine selbst bewohnen, dürfen Sie mit dem Mieter etwas anderes vereinbaren, etwa eine Warmmiete; ohne solche Vereinbarung gilt die Verordnung auch dort. Wenige weitere Ausnahmen nennt § 11, etwa wenn die Messung unverhältnismäßig teuer wäre. Wärmepumpen sind seit Oktober 2024 nicht mehr ausgenommen. Nicht fernablesbare Zähler und Heizkostenverteiler müssen bis zum 31.12.2026 nachgerüstet oder getauscht sein; klären Sie das bitte mit Ihrem Messdienst. Ab dem Abrechnungsjahr 2027 erinnert Mietfuchs in der Abrechnung daran.',
  },
  cableTv: {
    title: 'Kabelfernsehen',
    short: 'Die Gebühren für das TV-Signal eines Kabelanschlusses sind seit dem 01.07.2024 keine umlagefähigen Betriebskosten mehr, bei Anlagen ab dem 01.12.2021 waren sie es nie. Bei Anlagen, die vor dem 01.12.2021 errichtet wurden, bleibt der Betriebsstrom umlagefähig, bei einer Gemeinschaftsantenne des Hauses auch ihre Prüfung und Einstellung durch eine Fachkraft; bei neueren Anlagen auch das nicht.',
    example: 'Kabelgebühren 2024 von 240 € bei einer Anlage, die vor dem 01.12.2021 errichtet wurde: Umlegen dürfen Sie höchstens die 120 € für Januar bis Juni. Ab 2025 nichts mehr davon.',
    norm: '§ 2 Satz 1 Nr. 15 und Satz 2 BetrKV',
    needed: 'Nur wenn Ihr Haus einen Kabelanschluss über einen Sammelvertrag hat.',
  },
  consumptionKey: {
    title: 'Verbrauchsschlüssel',
    short: 'Die Kosten werden nach den Zählerständen verteilt, also danach, wie viel jede Wohnung tatsächlich verbraucht hat.',
    example: 'Wasser 1.000 €, gemessen 60 m³ in Wohnung A und 40 m³ in Wohnung B: A trägt 600 €, B 400 €.',
    norm: '§ 556a Abs. 1 Satz 2 BGB; BGH, Urteil vom 12.03.2008, VIII ZR 188/07',
    needed: 'Wenn alle vermieteten Wohnungen eigene Zähler haben; dann ist ohne andere Vereinbarung nach Verbrauch umzulegen. Fehlt einer Mietwohnung der Zähler, müssen Sie nicht nach Verbrauch abrechnen.',
  },
  mainMeter: {
    title: 'Hauptzähler und Zwischenzähler',
    short: 'Der Hauptzähler misst das ganze Haus, ein Zwischenzähler eine einzelne Wohnung. Fehlt nur Ihrer eigenen Wohnung der Zwischenzähler, gilt für sie der Rest des Hauptzählers, samt Messdifferenz. Fehlt er einer vermieteten Wohnung, rechnen Sie besser nach Fläche ab; zur Abrechnung nach Verbrauch sind Sie dann nicht verpflichtet. Rechnen Sie trotzdem so, lässt Mietfuchs den Rest des Hauptzählers beim Vermieter, sofern der Hauptzähler das ganze Jahr abgelesen ist; sonst tragen die übrigen Wohnungen diesen Verbrauch mit, und Mietfuchs warnt.',
    example: 'Hauptzähler 200 m³, Zwischenzähler der Einliegerwohnung 40 m³, Ihre Wohnung ohne Zähler: Die übrigen 160 m³ gelten als Ihr Verbrauch. Bei 1.000 € Wasser trägt der Mieter der Einliegerwohnung 200 €, 800 € sind Ihr Eigenanteil.',
    needed: 'Wenn nicht jede Wohnung einen eigenen Zähler hat, etwa bei einer Einliegerwohnung. Lesen Sie den Hauptzähler dann zum 31.12. ab. Weicht die Summe der Wohnungszähler um mehr als etwa 20 % vom Hauptzähler ab, ist das Umlegen der Differenz nach der Rechtsprechung der Instanzgerichte angreifbar; klären Sie dann die Ursache.',
  },
  meterReading: {
    title: 'Zählerstand und Zählerwechsel',
    short: 'Der Verbrauch ist der Unterschied zweier Ablesungen; wird ein Zähler getauscht, gehören der Endstand des alten und der Anfangsstand des neuen Geräts dazu.',
    example: 'Stand am 31.12.2024: 120 m³, am 31.12.2025: 165 m³, Verbrauch 45 m³. Beim Tausch im Juni: alter Zähler endet bei 140, neuer beginnt bei 0 und steht am Jahresende bei 25; zusammen ebenfalls 45 m³.',
    needed: 'Wenn Sie nach Verbrauch abrechnen. Ablesen am besten immer zum 31.12.',
  },
  directAssignment: {
    title: 'Direktzuordnung',
    short: 'Eine Rechnung gehört vollständig zu einer einzigen Wohnung und wird nicht verteilt.',
    example: 'Der Schornsteinfeger prüft nur die Gastherme in Wohnung B für 85 €: Die 85 € trägt allein Wohnung B.',
    needed: 'Selten, nur für Rechnungen, die eindeutig eine Wohnung betreffen.',
  },
  agreedShares: {
    title: 'Vereinbarte Anteile',
    short: 'Im Mietvertrag steht für jede Wohnung eine feste Quote in Prozent; was unter 100 Prozent bleibt, trägt der Vermieter.',
    example: 'Aufzug 2.000 €, vereinbart 40 % für Wohnung A und 35 % für B: A trägt 800 €, B 700 €, der Vermieter 500 €.',
    norm: '§ 556a Abs. 1 BGB',
    needed: 'Nur wenn Ihr Mietvertrag solche Quoten nennt.',
  },
  individualAmounts: {
    title: 'Einzelbeträge',
    short: 'Die Beträge je Mieter stehen schon fest, etwa in der Abrechnung eines Messdienstes, und werden unverändert übernommen.',
    example: 'Die Heizkostenabrechnung des Messdienstes über 3.000 € nennt 1.240 € für Wohnung A und 1.160 € für B; 600 € entfallen auf Ihre eigene Wohnung.',
    needed: 'Wenn ein Dienstleister wie ein Messdienst bereits je Wohnung abgerechnet hat.',
  },
  participants: {
    title: 'Teilnehmende Wohnungen',
    short: 'Eine Rechnung betrifft nur einen Teil der Wohnungen und wird nur auf diese verteilt.',
    example: 'Der Aufzug 1.800 € im Jahr dient nur den drei Wohnungen im Hinterhaus: Nur ihre 210 m² bilden die Verteilbasis.',
    needed: 'Nur wenn nicht alle Wohnungen eine Einrichtung nutzen, etwa Aufzug, Waschküche oder ein zweites Haus.',
  },
  mea: {
    title: 'Miteigentumsanteile (MEA)',
    short: 'Der Anteil einer Eigentumswohnung am gemeinsamen Eigentum, meist in Tausendsteln; nach ihm verteilt die Gemeinschaft ihre Kosten.',
    example: 'Ihre Wohnung hat 85 von 1.000 MEA. Die Gebäudeversicherung der Anlage über 6.000 € kostet Sie 85/1.000 × 6.000 = 510 €.',
    norm: '§ 16 Abs. 1 und 2 WEG, § 556a Abs. 3 BGB',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Ohne andere Vereinbarung gilt der Maßstab der Gemeinschaft auch gegenüber dem Mieter, sofern er nicht unbillig ist. Haben Sie mehrere Wohnungen in derselben Anlage, verteilt Mietfuchs den Betrag „laut Gemeinschaftsabrechnung“ auf sie nach Miteigentumsanteilen oder Fläche, nicht nach ihrem Verbrauch; für Heizkosten übernehmen Sie dann besser die Beträge je Wohnung aus der Heizkostenabrechnung als Einzelbeträge.',
  },
  noConnection: {
    title: 'Einheit ohne Anschluss',
    short: 'Eine Einheit, die für eine Zählerart gar keinen Anschluss hat, etwa eine Garage ohne Wasser; ihr fehlt dann kein Zähler, und Verbrauchskosten dieser Art betreffen sie nicht.',
    example: 'Wasser 600 € nach Verbrauch, zwei Wohnungen mit 40 und 20 m³ gemessen, dazu eine vermietete Garage ohne Wasser: Die Wohnungen tragen 400 € und 200 €, die Garage nichts, und Mietfuchs warnt nicht vor einem fehlenden Zähler.',
    needed: 'Nur wenn eine Einheit eines Objekts mit Zählern keinen Anschluss dieser Art hat. Im Normalfall bleiben alle Häkchen gesetzt.',
  },
  homeownersStatement: {
    title: 'Hausgeldabrechnung',
    short: 'Die Jahresabrechnung der Eigentümergemeinschaft; aus ihr übernehmen Sie für die Nebenkostenabrechnung nur die umlagefähigen Kosten.',
    example: 'Hausgeld 3.600 € im Jahr, davon 1.900 € umlagefähig (Versicherung, Müll, Allgemeinstrom, Hausmeister). Verwaltergebühr 360 € und Reparaturen 440 € tragen Sie selbst und setzen sie als Werbungskosten an. Die Zuführung zur Rücklage von 900 € tragen Sie ebenfalls selbst, abziehbar ist sie aber erst, wenn die Gemeinschaft sie ausgibt (siehe Erhaltungsrücklage). Die Grundsteuer steht nicht darin, sie kommt mit eigenem Bescheid an Sie.',
    norm: '§ 28 WEG, § 556a Abs. 3 BGB',
    needed: 'Nur bei einer vermieteten Eigentumswohnung.',
  },
  homeownersFee: {
    title: 'Hausgeld (Vorschuss)',
    short: 'Der monatliche Vorschuss, den Sie als Eigentümer an die Gemeinschaft zahlen, festgelegt im Wirtschaftsplan; er ist eine Vorauszahlung und noch keine Abrechnung. Erst die Hausgeldabrechnung nach Ende des Jahres sagt, welche Kosten wirklich angefallen sind, und ein Teil des Vorschusses ist meist die Zuführung zur Erhaltungsrücklage.',
    example: 'Hausgeld 300 € im Monat, also 3.600 € im Jahr, davon 900 € Zuführung zur Erhaltungsrücklage: Im Jahr der Zahlung sind 2.700 € als Werbungskosten abziehbar, die 900 € erst, wenn die Gemeinschaft sie für eine Erhaltungsmaßnahme ausgibt. Eine Nachzahlung aus der Hausgeldabrechnung zählt im Jahr, in dem Sie sie bezahlen.',
    norm: '§ 28 WEG; § 11 Abs. 2 EStG',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Für die Nebenkostenabrechnung Ihres Mieters zählt nicht der Vorschuss, sondern die Hausgeldabrechnung: Aus ihr übernehmen Sie die umlagefähigen Kosten. Für die Steuer zählt dagegen, wann das Geld abfließt, also der gezahlte Vorschuss im Jahr der Zahlung, ohne den Anteil der Erhaltungsrücklage. Mietfuchs führt Kosten nach dem Jahr der Abrechnung; weichen Zahlungsjahr und Abrechnungsjahr ab, gleichen Sie das für die Anlage V bitte selbst ab.',
  },
  reserveFund: {
    title: 'Erhaltungsrücklage',
    short: 'Ein Teil des Hausgelds einer Eigentumswohnung, den die Gemeinschaft für künftige Reparaturen ansammelt; als Werbungskosten abziehbar ist er erst, wenn und soweit die Gemeinschaft das Geld für Erhaltungsmaßnahmen ausgibt, nicht schon bei der Zahlung.',
    example: 'Hausgeld 3.600 € im Jahr, davon 900 € Zuführung zur Erhaltungsrücklage: Sofort abziehbar sind höchstens 3.600 − 900 = 2.700 €. Bezahlt die Gemeinschaft zwei Jahre später aus der Rücklage eine Dachreparatur, ist Ihr Anteil daran erst in diesem Jahr Werbungskosten.',
    norm: '§ 19 Abs. 2 Nr. 4 WEG; § 9 Abs. 1 EStG; BFH, Urteil vom 14.01.2025, IX R 19/24',
    needed: 'Nur bei einer vermieteten Eigentumswohnung. Erfassen Sie die Zuführung als Kostenart „Zuführung Erhaltungsrücklage“; Mietfuchs legt sie nicht auf den Mieter um und weist sie in der Steuerübersicht getrennt von den Werbungskosten aus.',
  },
  labor35a: {
    title: 'Lohnanteil nach § 35a EStG',
    short: 'Der Teil einer Rechnung, der auf Arbeit entfällt, einschließlich Maschinen- und Fahrtkosten und Umsatzsteuer, ohne Material. Weist die Abrechnung den Anteil des Mieters daran aus oder bescheinigen Sie ihn, kann er 20 Prozent davon unmittelbar von seiner Einkommensteuer abziehen, je Haushalt und Jahr höchstens 4.000 € für haushaltsnahe Dienstleistungen und 1.200 € für Handwerkerleistungen, über alle Rechnungen zusammen. Voraussetzung ist, dass die Rechnung unbar an den Handwerker oder Dienstleister bezahlt wurde.',
    example: 'Gartenpflege 1.000 €, davon Lohn 800 €: Trägt der Mieter 250 € der Rechnung, entfallen davon 200 € auf Lohn, und er kann 20 % davon abziehen, also 40 €.',
    norm: '§ 35a Abs. 2, 3 und 5 EStG; BMF-Schreiben vom 09.11.2016',
    needed: 'Nicht Pflicht, aber für Ihre Mieter bares Geld. Den Lohnanteil finden Sie auf der Rechnung des Handwerkers oder Dienstleisters.',
  },
  settlementDeadline: {
    title: 'Abrechnungsfrist',
    short: 'Die Abrechnung muss dem Mieter spätestens zwölf Monate nach Ende des Abrechnungszeitraums zugehen, sonst können Sie in der Regel keine Nachzahlung mehr verlangen; ausgenommen ist nur eine Verspätung, die Sie nicht zu vertreten haben.',
    example: 'Abrechnung für 2025: Sie muss bis zum 31.12.2026 beim Mieter sein. Kommt sie am 02.01.2027, entfällt eine Nachzahlung von 200 €; ein Guthaben des Mieters bleibt fällig.',
    norm: '§ 556 Abs. 3 BGB; BGH, Urteil vom 20.05.2026, VIII ZR 6/24',
    needed: 'Ja, für jede Abrechnung. Es zählt der Zugang beim Mieter, nicht das Absenden. Bei einer Eigentumswohnung gilt die Frist auch, wenn die Hausgeldabrechnung noch fehlt. Liegt der Grundsteuerbescheid ohne Ihr Verschulden noch nicht vor, oder haben Sie gegen ihn, den Grundsteuerwert- oder den Messbescheid Einspruch eingelegt, dürfen Sie mit der Grundsteuer warten, bis der endgültige Bescheid da oder über den Einspruch entschieden ist. Rechnen Sie das Übrige trotzdem fristgerecht ab, behalten Sie sich die Grundsteuer ausdrücklich vor und fordern Sie sie im Regelfall innerhalb von drei Monaten danach. Mietfuchs zeigt die Frist auf der Seite Abrechnung.',
  },
  largestRemainder: {
    title: 'Restcent-Verfahren',
    short: 'Beim Runden auf Cent fehlen oder bleiben oft einzelne Cent übrig; Mietfuchs gibt sie an die Anteile mit dem größten Rest hinter dem Komma, damit die Summe genau dem Rechnungsbetrag entspricht. Ihr eigener Anteil (Eigennutzung, Leerstand) zählt dabei mit; bei gleichem Rest bekommen Sie den Cent vor einem Mieter.',
    example: '100,00 € auf drei gleich große Wohnungen sind je 33,3333 €. Gerundet wären das zusammen 99,99 €; den fehlenden Cent bekommt eine der drei, die dann 33,34 € trägt.',
    needed: 'Nein, Mietfuchs erledigt das selbst. Es erklärt nur, warum ein Anteil einen Cent vom rechnerischen Wert abweicht.',
  },
  legalBasis: {
    title: 'Rechtsstand',
    short: 'Das Datum, auf dem die Regeln in Mietfuchs stehen, und die Regeln, die im Abrechnungsjahr gelten; beim Abschließen wird er mit der Abrechnung eingefroren.',
    example: 'Eine Abrechnung für 2023 mit Rechtsstand 30.09.2026 nennt die Regel zum Kabelfernsehen, denn 2023 war es bei Anlagen von vor dem 01.12.2021 noch umlagefähig; eine für 2025 nennt sie nicht mehr.',
    needed: 'Sie müssen nichts tun. Er zeigt, nach welchen Regeln eine Abrechnung erstellt wurde.',
  },
} satisfies Record<string, Term>

export type TermId = keyof typeof GLOSSARY
