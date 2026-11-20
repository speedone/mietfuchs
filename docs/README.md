# Dokumentation

Die Kurzfassung mit Funktionen und Downloads steht im [README](../README.md). Hier die Einzelheiten:

| Seite | Inhalt |
| --- | --- |
| [Installation](installation.md) | Windows (Microsoft Store, Installer), macOS, Umzug von der bisherigen Programmdatei, Zugriff vom Handy mit Passwort, Programmfenster mit Mietfuchs im Heimnetz verbinden, Download prüfen, Programmdatei ohne Installation, Linux-Pakete, `NKA_HOST`, `NKA_AUTH` und `NKA_TRUST_PROXY`, Liste aller Umgebungsvariablen |
| [Docker](docker.md) | Passwort und Anmeldung, fertiges Image, Compose-Dateien, HTTPS mit Caddy, Programmfenster koppeln (direkt oder über Caddy), VPN, Aktualisieren, selbst bauen |
| [Funktionsweise](funktionsweise.md) | Die Bereiche von den Stammdaten bis zur Steuer, Umlageschlüssel, Ansichten |
| [KI-Belegauswertung](ki-belegauswertung.md) | Einrichten mit Ollama, Dienste im Internet, Datenschutz, Modellwahl, Umgebungsvariablen |
| [Daten & Backup](daten-backup.md) | Wo der Datenordner liegt, Backup, Wiederherstellen, Umzug aus `db.json`, Exporte (JSON, CSV) und ihre Form |
| [Datenschutzerklärung](datenschutz.md) | Was Mietfuchs speichert und wohin es Verbindungen aufbaut |
| [Entwickeln](entwickeln.md) | Aus dem Quellcode starten, Programmfenster, Binaries bauen, Produktivbetrieb |
| [Heizung (Entwicklerdoku)](heizung.md) | Heizanlage, Heizperiode, CO₂, Lieferungen, eigene Heizkostenabrechnung im Code |

## Erste Schritte

Den Weg von der leeren Installation bis zur versendeten Abrechnung beschreibt in der App die Anleitung
„Die erste Abrechnung von Anfang bis Ende“ auf der Seite *Hilfe & Begriffe*; das leere Cockpit verlinkt
sie. Was die einzelnen Seiten tun, steht unter [Funktionsweise](funktionsweise.md).

## Fragen und Fehler

Fragen zur Bedienung gehören in die
[Diskussionen](https://github.com/speedone/mietfuchs/discussions/categories/q-a), Fehler meldest du mit
dem [Formular](https://github.com/speedone/mietfuchs/issues/new/choose), Sicherheitslücken vertraulich
wie in [SECURITY.md](../SECURITY.md) beschrieben. Diskussionen und Issues sind öffentlich: keine echten
Mieterdaten, Namen oder Belege posten, sondern Beispielwerte.

Den Umstieg aus älteren Versionen beschreibt [MIGRATION.md](../MIGRATION.md), Mitmachen
[CONTRIBUTING.md](../CONTRIBUTING.md).
