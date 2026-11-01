# Store-Eintrag im Partner Center

Texte für den Store-Eintrag (#500). Die erste Einreichung ging von Hand; seitdem schreibt
[scripts/store-submit.mjs](../../scripts/store-submit.mjs) bei jedem Release Beschreibung, Funktionen und
Suchbegriffe aus dieser Datei in den Store, dazu die Bildschirmfotos aus `docs/screenshots`. **Geändert
wird hier, nicht im Partner Center**, sonst überschreibt das nächste Release die Änderung. Das Format der
drei Abschnitte liest das Skript: fette Überschrift, in der Beschreibung Aufzählungen mit „• “ (so
zeigt sie der Store), unter „Funktionen“ je Zeile ein Punkt mit „- “. Die Texte siezen, wie die Oberfläche.

## Preise und Verfügbarkeit

- Preis: kostenlos
- Märkte: Deutschland, Österreich, Schweiz, Luxemburg, Liechtenstein (die Abrechnung folgt deutschem
  Recht; Österreich und die Schweiz bleiben drin, weil dort auch Vermieter mit Objekten in Deutschland wohnen)
- Sichtbarkeit: öffentlich

## Eigenschaften

- Kategorie: Business, Unterkategorie Buchhaltung und Finanzen
- Datenschutzrichtlinie: https://github.com/speedone/mietfuchs/blob/main/docs/datenschutz.md
- Website: https://github.com/speedone/mietfuchs
- Supportkontakt: https://github.com/speedone/mietfuchs/issues
- Systemanforderungen: Tastatur und Maus empfohlen, 4 GB Arbeitsspeicher

## Altersfreigabe

Fragebogen: keine Gewalt, keine Inhalte von Nutzern für andere, kein Kauf in der App, kein
Standort. Ergibt „ab 3“ (USK 0).

## Einreichungsoptionen: Begründung für runFullTrust

> Mietfuchs is a desktop application (Win32, packaged with the MSIX packaging tool) that runs a
> local web server on 127.0.0.1 and shows its user interface in the user's browser. It needs
> runFullTrust to run as a regular desktop process, to bind a local port and to store the user's
> data in %USERPROFILE%\Mietfuchs. It does not install drivers or services and does not modify
> other applications.

## Beschreibung (Deutsch)

**Kurzbeschreibung**

Nebenkostenabrechnung für private Vermieter: lokal auf Ihrem Rechner, ohne Konto und ohne Cloud.

**Beschreibung**

Mietfuchs erstellt die Nebenkostenabrechnung für Ihre Mieter, Schritt für Schritt und nachvollziehbar.
Sie erfassen Wohnungen, Mieter und Vorauszahlungen, legen Rechnungen als Beleg ab und tragen
Zählerstände ein. Am Jahresende rechnet Mietfuchs jede Kostenart nach dem passenden Schlüssel um und
druckt für jeden Mieter eine fertige Abrechnung mit Anschreiben.

Mietfuchs läuft vollständig auf Ihrem Rechner. Es gibt kein Konto, keine Anmeldung und keine Cloud;
Ihre Daten liegen im Ordner Mietfuchs in Ihrem Benutzerordner und bleiben auch bei einer Deinstallation
erhalten.

Was Mietfuchs abdeckt:
• Verteilung nach Wohnfläche, Personen, Wohneinheiten, Verbrauch oder vereinbarten Anteilen
• Heizkosten nach Heizkostenverordnung, CO₂-Kostenaufteilung, Abrechnung eines Messdienstes
• Mieterwechsel und Leerstand innerhalb des Jahres, auf den Tag genau
• mehrere Häuser und vermietete Eigentumswohnungen
• Mietkonto, Fristen und Hinweise, wenn etwas fehlt oder rechtlich angreifbar ist
• Übersicht für die Anlage V der Steuererklärung
• auf Wunsch KI-Auswertung von Belegen, auf dem eigenen Rechner oder bei einem Dienst Ihrer Wahl

Mietfuchs ist freie Software (AGPL-3.0) und kostenlos.

Sie nutzen bisher die heruntergeladene Programmdatei? Laden Sie dort unter Einstellungen ein Backup
herunter und spielen Sie es in der App aus dem Store unter Einstellungen wieder ein.

**Funktionen** (je eine Zeile)

- Nebenkostenabrechnung mit Anschreiben für jeden Mieter
- Heizkosten nach Heizkostenverordnung und CO₂-Aufteilung
- Belege mit optionaler KI-Auswertung
- Mietkonto, Fristen und Hinweise
- Übersicht für die Anlage V
- Läuft lokal, ohne Konto und ohne Cloud

**Suchbegriffe**: Nebenkostenabrechnung, Betriebskostenabrechnung, Nebenkosten, Vermieter,
Heizkostenabrechnung, Mieter, Anlage V

## Bildschirmfotos

Aus `docs/screenshots` (erfundener Bestand), festgelegt in `SCREENSHOTS` in store-submit.mjs: Cockpit,
Kosten, Abrechnung, Belege.

## Paket

Das `.msixbundle` aus dem Artefakt `mietfuchs-store` des Laufs „Release-Binaries“ zum Tag.
