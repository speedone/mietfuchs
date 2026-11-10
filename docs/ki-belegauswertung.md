# KI-Belegauswertung

Optional. Mietfuchs kann hochgeladene Belege von einem KI-Modell lesen lassen. Das Modell
schlägt Positionen, Beträge und Kostenarten vor, übernommen wird erst, was du geprüft hast.
Ohne KI funktioniert Mietfuchs vollständig.

Die Auswertung wird gespeichert und bleibt nach dem Neuladen erhalten; offene Auswertungen stehen
im Eingang der Seite Belege unter „Zu prüfen“, mit dem Beleg daneben. Je
Zeile entscheidest du: neu anlegen, mit einer vorhandenen Position verknüpfen (etwa der aus dem
Vorjahr übernommenen mit geschätztem Betrag) oder verwerfen. Eine Ampel markiert, was schon
erfasst sein könnte, die Vorschau zeigt, was mit jeder Position geschieht, und „Buchen“ tut genau
das. Doppelt klicken oder neu laden bucht nichts zweimal.

**E-Rechnungen brauchen keine KI.** Trägt ein PDF eine E-Rechnung (ZUGFeRD oder Factur-X, das XML steckt im PDF),
liest Mietfuchs Betrag, Datum, Rechnungssteller und Positionen direkt daraus, ohne Modell und ohne Netz, auch wenn
keine KI eingerichtet ist. Die Auswertung steht dann wie jede andere unter „Zu prüfen“, mit dem Satz „Aus der
E-Rechnung übernommen“. Einen Lohnanteil nach § 35a EStG schlägt Mietfuchs nur für Positionen vor, die erkennbar
Arbeit sind (Stunden, Arbeitszeit, Anfahrt), und lässt ihn dich bestätigen. Abschlags- und Teilrechnungen übernimmt
Mietfuchs nicht als Kosten, sonst zählte die Schlussrechnung doppelt; kommt dieselbe Rechnung zweimal, ist die zweite
rot.

Zwei Wege stehen zur Wahl:

- **Auf dem eigenen Rechner** mit [Ollama](https://ollama.com) oder LM Studio. Die Belege
  verlassen den Rechner nicht. Ohne Grafikkarte dauert eine Auswertung Minuten.
- **Über einen Dienst im Internet** wie OpenAI, IONOS oder Mistral. Das dauert Sekunden statt
  Minuten und kostet Bruchteile eines Cents je Beleg, dafür verlassen die Belege das Haus.
  Mietfuchs schickt erst dorthin, wenn du das in den Einstellungen einmal bestätigt hast.

## Einrichten mit Ollama

1. **Ollama installieren** von [ollama.com/download](https://ollama.com/download) (Windows,
   macOS, Linux). Danach läuft Ollama im Hintergrund.
2. **In Mietfuchs einrichten:** *Einstellungen*, Karte „KI-Belegauswertung“. Voreingestellt ist
   „Ollama auf diesem Rechner“. Mietfuchs findet Ollama unter `http://localhost:11434` selbst
   und listet die installierten Modelle auf, jeweils mit Größe und ob sie Bilder verstehen.
   Antwortet Ollama unter einer anderen üblichen Adresse, schlägt Mietfuchs sie zur Übernahme
   vor.
3. **Ein Modell laden:** Unter „Empfehlungen“ stehen einige Modelle mit Größe und den
   Messwerten des Prüflaufs. Ein Klick auf „Laden“ holt das Modell über Ollama, mit Fortschritt
   und Abbrechen; ein abgebrochener Download geht später dort weiter, wo er aufgehört hat.
   Lieber im Terminal? Dann `ollama pull qwen3.5:4b` (voreingestellt, 3,4 GB). Den passenden
   Befehl zeigt Mietfuchs auch an.
4. **Ausprobieren:** unter *Kosten* oder im Eingang der Seite *Belege* einen Beleg in die Fläche
   ziehen, oder dort bei einem Beleg unter „Ohne Position“ „Per KI auswerten“ wählen.

PDFs mit Textebene liest jedes Sprachmodell. Gescannte PDFs und Fotos brauchen ein Modell,
das Bilder versteht. Bei Scans schickt der Browser die ersten vier Seiten als Bilder mit. Ein
Modell ohne Bildverständnis bekommt keine Bilder, Mietfuchs meldet das stattdessen.

## Einen Dienst im Internet nutzen

In den Einstellungen bei „Anbieter“ eine Vorlage wählen. Sie belegt nur die Adresse vor,
ändern lässt sich alles:

| Vorlage | Läuft wo | Schlüssel nötig |
| --- | --- | --- |
| Ollama auf diesem Rechner (Standard) | hier | nein |
| Ollama auf einem anderen Rechner | im Heimnetz oder bei dir im Internet | je nach Aufbau |
| LM Studio | hier | nein |
| Ollama Cloud | USA und andere | ja |
| OpenAI | USA (EU nur nach Freischaltung) | ja |
| IONOS AI Model Hub | Deutschland | ja |
| Mistral | EU | ja |
| Eigener OpenAI-kompatibler Dienst | wie du es einrichtest | je nach Dienst |

Dann den Schlüssel eintragen („Schlüssel bekommen …“ führt zur passenden Seite des Anbieters),
ein Modell wählen und speichern. Zeigt die Adresse aus dem Haus, erscheint zuletzt die Frage
nach der Bestätigung. Erst danach schickt Mietfuchs Belege dorthin.

**Datenschutz.** In Belegen stehen personenbezogene Daten, etwa Namen und Adressen von
Mietern. Wer sie einem Dienst gibt, braucht dafür in der Regel einen Vertrag zur
Auftragsverarbeitung mit dem Anbieter. Die folgenden Angaben stammen aus der Dokumentation der
Anbieter, Stand September 2026, und können sich ändern:

| Anbieter | Verarbeitung | Training mit den Daten | Aufbewahrung | Vertrag |
| --- | --- | --- | --- | --- |
| [OpenAI](https://openai.com/policies/data-processing-addendum/) | USA, EU nach Freischaltung | nein | bis 30 Tage zur Missbrauchsprüfung | online |
| [IONOS](https://docs.ionos.com/cloud/ai/ai-model-hub/governance-and-compliance/data-handling) | nur Deutschland | nein | keine Protokolle | gilt ohne Unterschrift |
| [Mistral](https://legal.mistral.ai/terms/data-processing-addendum/) | EU | im kostenlosen Tarif ja, abschaltbar | 30 Tage | online |
| [Ollama Cloud](https://ollama.com/privacy) | vorwiegend USA | nein | keine Protokolle | keiner veröffentlicht |

**Kosten.** Gemessen mit `gpt-5.4-nano` bei OpenAI an den erfundenen Belegen des Prüflaufs:
13 Auswertungen als Text, Scan und Foto kosteten zusammen etwa 1,6 Cent, also gut 0,1 Cent je
Beleg. Größere Modelle kosten ein Vielfaches, bleiben aber für ein Mietshaus im Cent-Bereich.

**Schlüssel.** Sie liegen in `data/secrets.json` neben der Datenbank, unter Linux und macOS nur
für den eigenen Benutzer lesbar, und sind **nicht im Backup**. Nach einer Wiederherstellung auf
einem anderen Rechner trägt man sie dort neu ein. Mietfuchs gibt einen Schlüssel nie an den
Browser zurück und filtert ihn aus Fehlermeldungen.

## Welches Modell?

Voreingestellt ist `qwen3.5:4b` auf dem eigenen Rechner. Dieselben Empfehlungen stehen in den
Einstellungen; mit eingeschalteter Update-Prüfung holt Mietfuchs höchstens einmal am Tag die
aktuelle Liste aus dem Repo ([ki-modelle.json](../ki-modelle.json)), sonst gilt die mitgelieferte.
Die Übersicht zeigt, wie gut einige
Modelle frei erfundene Beispielbelege gelesen haben und wie lange sie im Schnitt brauchten.
Gemessen hat das der [KI-Prüflauf](../.github/workflows/ai-eval.yml) auf einem Rechner ohne
Grafikkarte mit 4 Prozessorkernen und 16 GB Arbeitsspeicher, Stand September 2026. Ein üblicher
Laptop ist meist etwas schneller.

| Modell | Arbeitsspeicher | PDF mit Textebene | Scan | Handyfoto |
| --- | --- | --- | --- | --- |
| `qwen3.5:4b` (voreingestellt) | 3,6 GB | 93 %, 2 Min. | 75 %, 6 Min. | 56 %, 4,5 Min. |
| `gemma4:12b` | 9,2 GB | 95 %, 5,5 Min. | 83 %, 6,5 Min. | 92 %, 5 Min. |
| `minicpm-v4.5:8b` | 7,8 GB | 86 %, 2 Min. | 64 %, 6,5 Min. | 61 %, 5 Min. |
| `gpt-5.4-nano` (OpenAI, Dienst) | – | 95 %, 4 Sek. | 86 %, 5 Sek. | 79 %, 13 Sek. |

Die Prozentzahl ist der Anteil richtig gelesener Angaben: Summe, Aussteller, Beträge,
Kostenarten und §35a-Anteil. Wer vor allem Fotos und Scans auswertet und genug
Arbeitsspeicher hat, nimmt `gemma4:12b`. Kleinere Modelle lasen die Belege in der Messung
deutlich schlechter. Mit Grafikkarte kommen auch größere Modelle in Frage, etwa
`qwen3.6:35b` (23 GB). Ein anderes Modell wählst du in den Einstellungen, auch eines, das
nicht in dieser Liste steht.

## Wie lange dauert das?

Auf einem Rechner ohne Grafikkarte rechnet das Modell auf dem Prozessor. Ein PDF mit Textebene
braucht dann meist unter einer Minute, ein gescannter Beleg einige Minuten. Mit Grafikkarte
oder auf einem Mac mit Apple-Chip geht es deutlich schneller, bei einem Dienst im Internet
dauert ein Beleg wenige Sekunden. Die Seiten eines Scans schickt Mietfuchs mit 1200 Bildpunkten
an der langen Kante: Der KI-Prüflauf hat gezeigt, dass mehr die Trefferquote nicht verbessert,
aber jede Auswertung verlängert. Wer ein Modell mit anderem Bedarf nutzt, ändert den Wert unter
*Einstellungen → KI → Erweitert* oder mit `NKA_AI_IMAGE_EDGE`; daneben steht, welchem dpi-Wert
er bei A4 entspricht. Während der Auswertung zeigt Mietfuchs, was das Modell
gerade tut und wie lange es schon läuft. Abbrechen stoppt auch das Modell.

## Ollama und Docker

Läuft Ollama auf dem Rechner, auf dem auch Docker läuft, ist es aus dem Container unter
`http://host.docker.internal:11434` erreichbar. Mietfuchs schlägt diese Adresse in den
Einstellungen selbst vor.

Mit der [`docker-compose.yml`](../docker-compose.yml) aus dem Repo läuft Ollama auch als eigener
Container mit:

```bash
docker compose --profile ki up -d        # startet Mietfuchs und Ollama, lädt das Modell einmalig
docker compose logs -f ollama-pull       # Fortschritt des Downloads
```

Danach in den Einstellungen die gefundene Adresse `http://ollama:11434` übernehmen. Ein
weiteres Modell lädt `docker compose exec ollama ollama pull NAME`, den passenden Befehl zeigt
Mietfuchs auch selbst an. Der Container rechnet auf dem Prozessor. Für eine NVIDIA-Grafikkarte
beschreibt die [Ollama-Dokumentation zu Docker](https://github.com/ollama/ollama/blob/main/docs/docker.mdx),
was nötig ist. Docker Desktop auf dem Mac hat keinen Zugriff auf die Grafik des Apple-Chips,
dort ist die Ollama-App die bessere Wahl.

## Für Fortgeschrittene

Unter *Einstellungen* klappt „Erweitert“ weitere Möglichkeiten auf: ein **eigener Anbieter für
Fotos und Scans** (so liest etwa ein Dienst im Internet die Bilder, während Belege mit
Textebene auf dem eigenen Rechner bleiben), Zeitlimit, Kontextgröße, Länge der Antwort, die
Stufe der strukturierten Ausgabe, der Denkaufwand und zusätzliche Hinweise an das Modell.

Dasselbe lässt sich über Umgebungsvariablen festlegen, etwa in einer `.env`-Datei neben der
`docker-compose.yml`. Gesetzte Werte gelten vor den gespeicherten, das Feld in den Einstellungen
ist dann gesperrt, und gespeichert werden sie nicht:

| Variable | Wirkung |
| --- | --- |
| `NKA_AI_PROVIDER` | Art der Schnittstelle: `ollama` oder `openai` (alle OpenAI-kompatiblen Dienste). |
| `NKA_AI_URL` | Adresse des Dienstes. |
| `NKA_AI_MODEL` | Modell. |
| `NKA_AI_API_KEY` | Schlüssel des Dienstes. |
| `NKA_AI_API_KEY_FILE` | Pfad einer Datei mit dem Schlüssel, etwa eines Docker-Secrets unter `/run/secrets/`. Nicht zusammen mit `NKA_AI_API_KEY`. Gilt für den Standard-Anbieter; den Schlüssel für einen eigenen Bilder-Anbieter trägt man in der Oberfläche ein. |
| `NKA_AI_TIMEOUT` | Zeitlimit je Auswertungsschritt in Sekunden, Standard 1200 für das Auslesen. |
| `NKA_AI_MAX_TOKENS` | Höchstlänge der Antwort in Token, Standard 16384 (nur OpenAI-kompatible Dienste). |
| `NKA_AI_IMAGE_EDGE` | Lange Kante der Seitenbilder eines Scans in Bildpunkten, Standard 1200 (etwa 103 dpi bei A4). Erlaubt sind 600 bis 2600. |
| `NKA_OLLAMA_URL` | Adresse von Ollama, gilt weiter, solange Ollama der Anbieter ist. |
| `NKA_OLLAMA_MODEL` | Modell für Ollama. Im Compose-Profil lädt `ollama-pull` dieses Modell. |
| `NKA_OLLAMA_NUM_CTX` | Kontextgröße in Token, Standard 16384. Kleiner spart Arbeitsspeicher, zu klein schneidet lange Belege ab. |

Ein falscher Wert verhindert den Start und wird beim Start genannt, statt später als
unverständlicher Fehler bei der ersten Auswertung aufzutauchen.

Mit Docker-Secrets sieht das so aus:

```yaml
services:
  mietfuchs:
    environment:
      NKA_AI_PROVIDER: openai
      NKA_AI_URL: https://openai.inference.de-txl.ionos.com/v1
      NKA_AI_MODEL: Qwen/Qwen3.5-9B
      NKA_AI_API_KEY_FILE: /run/secrets/ki_schluessel
    secrets: [ki_schluessel]
secrets:
  ki_schluessel:
    file: ./ki-schluessel.txt
```