# Mietfuchs mit Docker

Ein einziges Image liefert App und API auf Port 3001, für `linux/amd64` und `linux/arm64`
(Apple Silicon, Raspberry Pi). Die Daten (`mietfuchs.sqlite`, Belege, Briefpapier) liegen im
benannten Volume `mietfuchs-data` und überleben Updates des Containers. Voraussetzung:
[Docker](https://docs.docker.com/get-docker/) installiert (Docker Desktop unter Windows/macOS,
Docker Engine unter Linux).

Fertige Compose-Dateien zum Kopieren liegen im Ordner [deploy/](../deploy). Das Repo brauchst du
dafür nicht: Lade die Datei in einen eigenen Ordner, etwa mit

```bash
mkdir mietfuchs && cd mietfuchs
curl -O https://raw.githubusercontent.com/speedone/mietfuchs/main/deploy/compose.yml
```

- [Zuerst: Sicherheit](#zuerst-sicherheit)
- [Welche Datei nehme ich?](#welche-datei-nehme-ich)
- [Nur Mietfuchs](#nur-mietfuchs-composeyml)
- [Mit HTTPS im Heimnetz](#mit-https-im-heimnetz-composecaddyyml)
- [Mit Ollama für die KI-Belegauswertung](#mit-ollama-für-die-ki-belegauswertung-composeollamayml)
- [Von unterwegs und mit HTTPS: über ein VPN](#von-unterwegs-und-mit-https-über-ein-vpn)
- [Daten sichern](#daten-sichern)
- [Ohne Compose](#ohne-compose) und [Selbst bauen](#selbst-bauen-aus-dem-clone)

## Zuerst: Sicherheit

**Mietfuchs hat kein Login.** Wer die Adresse im Netz erreicht, kann alle Daten lesen und ändern.
Deshalb:

- **Nie ins Internet stellen**, also keine Portfreigabe und keine Portweiterleitung am Router für
  3001, 80 oder 443. Von unterwegs geht es [über ein VPN](#von-unterwegs-und-mit-https-über-ein-vpn).
- Im Heimnetz ist Mietfuchs für jedes Gerät im Netz erreichbar. Teilst du das Netz mit anderen,
  setze im Proxy ein Passwort davor ([`basic_auth` im Caddyfile](#ein-passwort-davor)).

## Welche Datei nehme ich?

| Datei | Wann nehme ich das? |
| --- | --- |
| [`deploy/compose.yml`](../deploy/compose.yml) | Mietfuchs auf einem NAS oder Heimserver, aufgerufen im Browser unter `http://<gerät>:3001`. Der einfachste Weg. |
| [`deploy/compose.caddy.yml`](../deploy/compose.caddy.yml) mit [`deploy/Caddyfile`](../deploy/Caddyfile) | Du willst HTTPS im Heimnetz, etwa um Mietfuchs auf einem Android-Handy als App zu installieren, oder ein Passwort davor. |
| [`deploy/compose.ollama.yml`](../deploy/compose.ollama.yml) | Du willst die [KI-Belegauswertung](ki-belegauswertung.md) mit Ollama als eigenem Container, ohne Ollama auf dem Gerät zu installieren. |

## Nur Mietfuchs (`compose.yml`)

**Wann nehme ich das?** Für fast alle: Mietfuchs läuft auf einem Gerät, das immer an ist, und du
öffnest es vom PC, Tablet oder Handy im selben Netz.

**Starten** im Ordner mit der Datei:

```bash
docker compose up -d
# App: http://<name oder IP des Geräts>:3001, auf dem Gerät selbst http://localhost:3001
```

**Aktualisieren:**

```bash
docker compose pull && docker compose up -d
```

Die Daten im Volume bleiben dabei erhalten. Statt `latest` lässt sich auch eine feste Version
festhalten, z. B. `ghcr.io/speedone/mietfuchs:0.3.0`. **Stoppen:** `docker compose down`, das
Volume mit den Daten bleibt; erst `docker compose down -v` löscht es.

## Mit HTTPS im Heimnetz (`compose.caddy.yml`)

**Wann nehme ich das?** Wenn du Mietfuchs über HTTPS aufrufen willst. Erst mit HTTPS lässt sich
Mietfuchs auf einem Android-Handy als App installieren. Davor sitzt [Caddy](https://caddyserver.com)
(offizielles Image `caddy:2`): Er stellt mit `tls internal` selbst Zertifikate aus und leitet an
Mietfuchs weiter. Mietfuchs hat in dieser Datei keinen veröffentlichten Port, erreichbar ist es nur
über Caddy.

**Ehrlich vorweg:** Die Zertifikate unterschreibt Caddy mit einem eigenen Stammzertifikat, das kein
Gerät von sich aus kennt. Du installierst es **einmal auf jedem Gerät**, das Mietfuchs öffnet, sonst
warnt der Browser. Ohne diesen Schritt geht es mit einer [eigenen Domain](#eigene-domain-mit-gültigem-zertifikat)
oder [über ein VPN](#von-unterwegs-und-mit-https-über-ein-vpn).

**Einrichten:** `compose.caddy.yml` und `Caddyfile` in denselben Ordner legen. Im Caddyfile steht
als Adresse `localhost`; trage dort zusätzlich ein, unter welchem Namen und welcher IP-Adresse du
dein NAS aufrufst, mit Komma getrennt:

```
localhost, 192.168.178.23, nas.fritz.box {
```

**Starten:**

```bash
docker compose -f compose.caddy.yml up -d
# App: https://192.168.178.23 bzw. https://nas.fritz.box
```

Caddy braucht die Ports 80 und 443 auf dem Gerät. Sind sie schon belegt oder darf Docker sie nicht
nehmen, ändere in `compose.caddy.yml` die linke Seite, etwa `"8443:443"`, und rufe
`https://<gerät>:8443` auf.

**Stammzertifikat holen** (im Ordner mit der Datei, danach liegt `root.crt` dort):

```bash
docker compose -f compose.caddy.yml cp caddy:/data/caddy/pki/authorities/local/root.crt .
```

Die Datei bleibt gleich, solange das Volume `caddy-data` besteht. Löschst du es, erzeugt Caddy ein
neues Stammzertifikat, und du installierst es auf allen Geräten neu.

**Auf den Geräten installieren:**

- **iPhone und iPad:** `root.crt` aufs Gerät bringen (etwa per Mail oder AirDrop) und öffnen, dann
  unter *Einstellungen* das geladene Profil installieren. Danach zusätzlich unter *Einstellungen →
  Allgemein → Info → Zertifikatsvertrauenseinstellungen* das Vertrauen für das Zertifikat
  einschalten.
- **Android:** `root.crt` aufs Gerät bringen, dann unter *Einstellungen → Sicherheit → Zertifikat
  installieren* als CA-Zertifikat installieren. Je nach Hersteller heißt der Weg etwas anders.
- **PC und Mac:** das Zertifikat in der Zertifikatsverwaltung des Systems als vertrauenswürdige
  Stammzertifizierungsstelle aufnehmen; manche Browser führen eine eigene Liste.

**Aktualisieren:**

```bash
docker compose -f compose.caddy.yml pull && docker compose -f compose.caddy.yml up -d
```

### Ein Passwort davor

Im Caddyfile steht auskommentiert ein `basic_auth`-Block. Den Hash des Passworts erzeugt

```bash
docker compose -f compose.caddy.yml exec caddy caddy hash-password
```

Dann die Zeilen einkommentieren, Benutzernamen und Hash eintragen und Caddy neu starten:
`docker compose -f compose.caddy.yml restart caddy`. Der Browser fragt danach nach Name und
Passwort. Das schützt im Heimnetz vor Mitbewohnern und Gästen, ist aber kein Grund, Mietfuchs ins
Internet zu stellen.

### Eigene Domain mit gültigem Zertifikat

Hast du eine eigene Domain, kann Caddy ein öffentlich gültiges Zertifikat über die DNS-Challenge
holen. Dann muss kein Gerät ein Stammzertifikat installieren, und Mietfuchs muss dafür nicht aus dem
Internet erreichbar sein. Das Caddyfile beschreibt diese Variante als Kommentar. Voraussetzungen: Der
Name zeigt im Heimnetz auf die Adresse des NAS, du hast einen API-Schlüssel deines DNS-Anbieters,
und Caddy hat das Modul für diesen Anbieter. Im Image `caddy:2` ist keines enthalten; du baust dir
ein eigenes Image mit dem Modul, wie es die Caddy-Dokumentation zur DNS-Challenge beschreibt.

## Mit Ollama für die KI-Belegauswertung (`compose.ollama.yml`)

**Wann nehme ich das?** Wenn die [KI-Belegauswertung](ki-belegauswertung.md) auf demselben Gerät
laufen soll, ohne Ollama dort zu installieren. Ollama läuft als eigener Container und ist von außen
nicht erreichbar; Mietfuchs spricht es über den Dienstnamen an, die Datei setzt dafür
`NKA_OLLAMA_URL: http://ollama:11434`. Das gilt, solange in den Einstellungen Ollama der Anbieter
ist (die Voreinstellung); das Adressfeld ist dann gesperrt.

**Starten:**

```bash
docker compose -f compose.ollama.yml up -d
docker compose -f compose.ollama.yml logs -f ollama-pull    # Fortschritt des Modell-Downloads
```

Beim ersten Start lädt `ollama-pull` das Modell einmalig, voreingestellt `qwen3.5:4b` (3,4 GB).
Ein anderes Modell setzt du mit `NKA_OLLAMA_MODEL` in einer `.env`-Datei neben der Compose-Datei.
Der Container rechnet auf dem Prozessor; was eine Auswertung dauert und welches Modell sich eignet,
steht unter [KI-Belegauswertung](ki-belegauswertung.md).

**Aktualisieren:**

```bash
docker compose -f compose.ollama.yml pull && docker compose -f compose.ollama.yml up -d
```

## Von unterwegs und mit HTTPS: über ein VPN

Für alle Wege gilt: **Mietfuchs nie per Portfreigabe am Router ins Internet stellen.** Von unterwegs
kommst du über ein VPN ins Heimnetz.

**Mesh-VPN, etwa Tailscale.** Ein Mesh-VPN verbindet deine Geräte miteinander, auch unterwegs. Bei
Tailscale brauchst du ein Konto beim Anbieter; selbst betreiben lässt sich so ein Netz etwa mit
Headscale oder NetBird. Den Client installierst du auf dem Gerät, auf dem Mietfuchs läuft (NAS,
Heimserver, Raspberry Pi), und auf dem Handy. Mit Tailscale gibt dir dann der Befehl

```bash
tailscale serve --bg 3001
```

auf dem Gerät mit Mietfuchs eine Adresse wie `https://<gerät>.<tailnet>.ts.net` mit einem gültigen
Zertifikat: kein Stammzertifikat aufs Handy, Android kann Mietfuchs als App installieren, und es geht
auch unterwegs. Dafür müssen im Tailnet die HTTPS-Zertifikate eingeschaltet sein; der Befehl führt
dich sonst dorthin. Er leitet an Port 3001 auf dem Gerät weiter, passt also zu
[`compose.yml`](#nur-mietfuchs-composeyml) und zum Linux-Paket. Mit `--bg` bleibt die Freigabe auch
nach einem Neustart bestehen; `tailscale serve status` zeigt sie, `tailscale serve reset` hebt sie
auf. Bei selbst betriebenen Netzen schau in deren Dokumentation, ob und wie sie HTTPS-Adressen
vergeben. Gute Praxis:

- **Nur `tailscale serve`, nie `tailscale funnel`.** Funnel stellt Mietfuchs ins offene Internet,
  und Mietfuchs hat kein Login.
- **Zugriffsregeln (ACL)** im Tailnet so setzen, dass nur deine eigenen Geräte das Gerät mit
  Mietfuchs erreichen; sie gelten auch für `serve`.

**VPN des Routers, etwa WireGuard in der FRITZ!Box.** Unterwegs verbindet sich das Handy ins
Heimnetz, und du öffnest Mietfuchs wie zu Hause unter `http://<gerät>:3001`, allerdings ohne HTTPS
(außer mit dem [Caddy-Beispiel](#mit-https-im-heimnetz-composecaddyyml)).

## Daten sichern

Am einfachsten über die Oberfläche: *Einstellungen → Backup herunterladen (ZIP)*. Wie du ein Backup
wieder einspielst, steht unter [Daten & Backup](daten-backup.md).

Das ganze Volume sicherst du mit einem kurzen Container. Compose stellt dem Volume den Namen des
Ordners voran (`docker volume ls` zeigt ihn, etwa `mietfuchs_mietfuchs-data`); halte Mietfuchs
dafür kurz an, damit die Datenbank in Ruhe ist:

```bash
docker compose stop mietfuchs
docker run --rm -v mietfuchs_mietfuchs-data:/daten:ro -v "$PWD":/sicherung alpine \
  tar czf /sicherung/mietfuchs-daten.tar.gz -C /daten .
docker compose start mietfuchs
```

Zurückspielen in ein leeres Volume geht umgekehrt, mit `-v mietfuchs_mietfuchs-data:/daten` (ohne
`:ro`) und `tar xzf /sicherung/mietfuchs-daten.tar.gz -C /daten`.

## Ohne Compose

```bash
docker run -d -p 3001:3001 -v mietfuchs-data:/app/server/data \
  --name mietfuchs ghcr.io/speedone/mietfuchs:latest
# App: http://localhost:3001
```

Aktualisieren: `docker pull ghcr.io/speedone/mietfuchs:latest`, dann `docker rm -f mietfuchs` und den
`docker run`-Befehl von oben erneut ausführen. Die Daten im Volume bleiben dabei erhalten.

## Selbst bauen (aus dem Clone)

Mit **Docker Compose** (Konfiguration in [`docker-compose.yml`](../docker-compose.yml)):

```bash
docker compose up -d        # Image bauen + Container starten (im Hintergrund)
# App: http://localhost:3001
docker compose down         # stoppen, das Volume mit den Daten bleibt erhalten
```

Aktualisieren: `git pull && docker compose up -d --build`.

Ohne Compose geht es auch direkt:

```bash
docker build -t mietfuchs .
docker run -d -p 3001:3001 -v mietfuchs-data:/app/server/data --name mietfuchs mietfuchs
```

Für die optionale KI-Belegauswertung siehe [KI-Belegauswertung](ki-belegauswertung.md),
dort auch das Compose-Profil `ki`, das Ollama als eigenen Container mitstartet.
