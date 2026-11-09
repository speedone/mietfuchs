# Store-Eintrag im Partner Center

Texte für den Store-Eintrag (#500). Die erste Einreichung ging von Hand; seitdem schreibt
[scripts/store-submit.mjs](../../scripts/store-submit.mjs) bei jedem Release Beschreibung, Funktionen,
Suchbegriffe sowie Website, Datenschutzrichtlinie und Supportkontakt aus dieser Datei in den Store, dazu
die Bildschirmfotos aus `docs/screenshots`. **Geändert wird hier, nicht im Partner Center**, sonst
überschreibt das nächste Release die Änderung. Dort auch keine
Einreichung beginnen: Einen von Hand begonnenen Entwurf darf die API nicht löschen, er blockiert das nächste
Release. Das Format der drei Abschnitte liest das Skript: fette Überschrift, in der Beschreibung
Aufzählungen mit „• “ (so zeigt sie der Store), unter „Funktionen“ je Zeile ein Punkt mit „- “. Die Texte
siezen, wie die Oberfläche.

## Preise und Verfügbarkeit

- Preis: kostenlos
- Märkte: Deutschland, Österreich, Schweiz, Luxemburg, Liechtenstein (die Abrechnung folgt deutschem
  Recht; Österreich und die Schweiz bleiben drin, weil dort auch Vermieter mit Objekten in Deutschland wohnen)
- Sichtbarkeit: öffentlich

## Eigenschaften

- Kategorie: Business, Unterkategorie Buchhaltung und Finanzen
- Datenschutzrichtlinie: https://github.com/speedone/mietfuchs/blob/main/docs/datenschutz.md
- Website: https://mietfuchs-app.de
- Supportkontakt: https://github.com/speedone/mietfuchs/issues
- Systemanforderungen: Tastatur und Maus empfohlen, 4 GB Arbeitsspeicher

## Altersfreigabe

Fragebogen: keine Gewalt, keine Inhalte von Nutzern für andere, kein Kauf in der App, kein
Standort. Ergibt „ab 3“ (USK 0).

## Einreichungsoptionen: Begründung für runFullTrust

> Mietfuchs is a desktop application (Win32, built with Electron, packaged as MSIX) that shows its
> user interface in its own application window; no browser is needed. Inside the app, a helper
> process of Mietfuchs.exe runs a local server on 127.0.0.1 that the window displays. Only if the
> user enables "access from the home network" in the settings is it reachable from other devices
> in the local network. Optionally, the user can pair the window with a Mietfuchs server in the home
> network (for example on a NAS); the window then connects to that server over HTTPS, pinned to the
> certificate it verified during pairing. It needs runFullTrust to run as a regular desktop process with this helper
> process, to bind a local port and to store the user's data in %USERPROFILE%\Mietfuchs, outside
> the package, so the data survives uninstalling. It does not install drivers or services and
> does not modify other applications.

## Beschreibung (Deutsch)

**Kurzbeschreibung**

Nebenkostenabrechnung für private Vermieter: lokal auf Ihrem Rechner, ohne Konto und ohne Cloud.

**Beschreibung**

Mietfuchs erstellt die Nebenkostenabrechnung für Ihre Mieter, Schritt für Schritt und nachvollziehbar.
Sie erfassen Wohnungen, Mieter und Vorauszahlungen, legen Rechnungen als Beleg ab und tragen
Zählerstände ein. Am Jahresende rechnet Mietfuchs jede Kostenart nach dem passenden Schlüssel um und
druckt für jeden Mieter eine fertige Abrechnung mit Anschreiben.

Mietfuchs läuft vollständig auf Ihrem Rechner, in einem eigenen Programmfenster, ohne Browser. Es gibt
kein Konto und keine Cloud, und solange nur Ihr Rechner Mietfuchs erreicht, auch keine Anmeldung. Schalten Sie
den Zugriff aus dem Heimnetz ein, schützt ein Passwort Ihre Daten vor anderen Geräten.
Ihre Daten liegen im Ordner Mietfuchs in Ihrem Benutzerordner und bleiben auch bei einer Deinstallation
erhalten. Läuft Mietfuchs schon auf einem NAS oder einem anderen Rechner im Heimnetz, verbinden Sie das
Programmfenster auf Wunsch mit einem Code damit und arbeiten verschlüsselt mit denselben Daten.

Was Mietfuchs abdeckt:
• Verteilung nach Wohnfläche, Personen, Wohneinheiten, Verbrauch oder vereinbarten Anteilen
• Heizkosten nach Heizkostenverordnung, CO₂-Kostenaufteilung, Abrechnung eines Messdienstes
• Mieterwechsel und Leerstand innerhalb des Jahres, auf den Tag genau
• mehrere Häuser und vermietete Eigentumswohnungen
• Mietkonto mit Fälligkeit der Miete je Mietverhältnis und den Feiertagen des Bundeslands, Fristen und Hinweise,
  wenn etwas fehlt oder rechtlich angreifbar ist
• Übersicht für die Anlage V der Steuererklärung
• auf Wunsch KI-Auswertung von Belegen, auf dem eigenen Rechner oder bei einem Dienst Ihrer Wahl

Mietfuchs ist freie Software (AGPL-3.0) und kostenlos. Es unterstützt Sie bei der Abrechnung, ersetzt aber
keine Rechts- oder Steuerberatung; prüfen Sie die Ergebnisse, bevor Sie eine Abrechnung versenden.
Mietfuchs wird ohne Gewähr bereitgestellt, soweit das Gesetz es zulässt. Mehr unter mietfuchs-app.de.

Sie nutzen bisher die heruntergeladene Programmdatei? Beim ersten Start sucht Mietfuchs Ihre bisherigen
Daten und übernimmt sie mit einem Klick auf „Daten übernehmen“ als Kopie; Ihr bisheriger Ordner bleibt
erhalten. Findet es sie nicht, wählen Sie den Ordner der alten Programmdatei oder spielen ein Backup ein.

**Funktionen** (je eine Zeile)

- Nebenkostenabrechnung mit Anschreiben für jeden Mieter
- Heizkosten nach Heizkostenverordnung und CO₂-Aufteilung
- Belege mit optionaler KI-Auswertung
- Mietkonto mit Fälligkeit je Mietverhältnis, Fristen und Hinweise
- Übersicht für die Anlage V
- Läuft lokal, ohne Konto und ohne Cloud
- Eigenes Programmfenster, kein Browser nötig
- Auf Wunsch verschlüsselt verbunden mit Mietfuchs auf NAS oder Heimserver

**Suchbegriffe**: Nebenkostenabrechnung, Betriebskostenabrechnung, Nebenkosten, Vermieter,
Heizkostenabrechnung, Mieter, Anlage V

## Bildschirmfotos

Aus `docs/screenshots` (erfundener Bestand), festgelegt in `SCREENSHOTS` in store-submit.mjs: Cockpit,
Kosten, Abrechnung, Belege.

## Paket

Das `.msixbundle` aus dem Artefakt `mietfuchs-store` des Laufs „Release-Binaries“ zum Tag.
