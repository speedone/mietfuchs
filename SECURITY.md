# Sicherheit

## Eine Sicherheitslücke melden

Bitte **nicht als öffentliches Issue**. Melde sie vertraulich über GitHub: im Repository unter
*Security* → *Report a vulnerability*, also
[github.com/speedone/mietfuchs/security/advisories/new](https://github.com/speedone/mietfuchs/security/advisories/new).
Die Meldung sehen nur du und der Herausgeber; behoben und veröffentlicht wird über ein Security
Advisory des Repositorys.

Hilfreich sind die Version, die Fassung (Microsoft Store, Installer, `.dmg`, Programmdatei,
Linux-Paket, Docker, aus dem Quellcode) und die Schritte zum Nachstellen. Keine echten Mieterdaten
mitschicken, Beispielwerte genügen. Mietfuchs ist ein Freizeitprojekt, eine Antwort kann ein paar
Tage dauern.

## Unterstützte Fassung

Sicherheitskorrekturen gibt es nur für die jeweils neueste veröffentlichte Version, als neues
Release. Ältere Versionen und Vorabversionen (`-rc`) werden nicht nachgebessert.

## Was signiert ist

| Fassung | Signatur |
| --- | --- |
| Microsoft Store | Von Microsoft signiert; Updates kommen über den Store. |
| Installer für Windows (`Mietfuchs-Setup-<Version>.exe`) | Keine Code-Signatur, Windows warnt beim ersten Start. Automatische Updates lädt Mietfuchs nur, wenn die Beschreibung des Updates (`latest.yml`) mit dem Ed25519-Schlüssel von Mietfuchs unterschrieben ist; die Prüfschlüssel stehen in [desktop/src/updateManifest.js](desktop/src/updateManifest.js). Die geladene Datei wird zusätzlich gegen ihre SHA-512 geprüft. |
| Programm für macOS (`.dmg`) | Nur ad hoc signiert, nicht bei Apple notarisiert; macOS verlangt beim ersten Start eine Freigabe. Keine automatischen Updates. |
| Programmdateien | macOS ad hoc signiert, Windows und Linux ohne Signatur. |
| Linux-Pakete, Docker-Image | Ohne Signatur. |

Das Programm für Windows und macOS prüft beim Lesen die Echtheit seines Programmarchivs (`app.asar`,
ASAR-Integrität von Electron) und beendet sich bei einer Abweichung.

## Download prüfen

Ab Version 0.15.0 hat jedes Release eine Datei `SHA256SUMS.txt` mit der SHA-256-Prüfsumme jeder Datei
und einen signierten Herkunftsnachweis (Artifact Attestation), dass die Dateien in der Release-Automatik
dieses Repos gebaut wurden. Wie du beides prüfst, steht in der Installationsanleitung unter
[Download prüfen](docs/installation.md#download-prüfen-für-fortgeschrittene).
