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
- [Programmfenster koppeln](#programmfenster-koppeln)
- [Mit Ollama für die KI-Belegauswertung](#mit-ollama-für-die-ki-belegauswertung-composeollamayml)
- [Von unterwegs und mit HTTPS: über ein VPN](#von-unterwegs-und-mit-https-über-ein-vpn)
- [Daten sichern](#daten-sichern)
- [Ohne Compose](#ohne-compose) und [Selbst bauen](#selbst-bauen-aus-dem-clone)

## Zuerst: Sicherheit

**Mietfuchs fragt nach einem Passwort**, sobald andere Geräte es erreichen können, und im
Container ist das immer so. Ein neues Volume startet deshalb in der Einrichtung, erst danach sieht
jemand Daten. Trotzdem gilt:

- **Nie ins Internet stellen**, also keine Portfreigabe und keine Portweiterleitung am Router für
  3001, 80 oder 443. Das Passwort ist für das Heimnetz gedacht. Von unterwegs geht es
  [über ein VPN](#von-unterwegs-und-mit-https-über-ein-vpn).
- **Über `http://` lässt sich im Heimnetz mitlesen**, auch das Passwort beim Anmelden. Teilst du das
  Netz mit anderen, nimm [HTTPS mit Caddy](#mit-https-im-heimnetz-composecaddyyml) oder ein VPN.

### Erster Start: Passwort festlegen

1. Nach `docker compose up -d` steht im Protokoll ein Einrichtungscode aus zwölf Zeichen:

   ```bash
   docker compose logs mietfuchs
   # Mietfuchs ist im Netz erreichbar und noch ohne Passwort.
   # Einrichtungscode: K7QM-4XPA-9TRW  (auch in /app/server/data/einrichtungscode.txt)
   ```

2. Mietfuchs im Browser öffnen, den Code eintragen und ein Passwort festlegen: 15 bis 128 Zeichen,
   Leerzeichen erlaubt. Die Seite schlägt einen Satz aus mehreren Wörtern vor. Der Code gilt einmal,
   jeder Neustart vor der Einrichtung erzeugt einen neuen.
3. Jedes Gerät meldet sich danach mit dem Passwort an. Die Anmeldung endet nach 30 Minuten ohne
   Aktivität, spätestens nach 8 Stunden; ein Neustart des Containers meldet alle Geräte ab.

„Ohne Passwort weiter“ auf derselben Seite lässt Mietfuchs offen wie früher; ein Passwort legst du
dann später unter *Einstellungen → Anmeldung* fest, mit dem Code, den das Protokoll bei jedem Start
nennt. Dort änderst du auch das Passwort, meldest alle anderen Geräte ab oder schaltest die
Anmeldung aus. Nach Fehlversuchen wird Mietfuchs langsamer (ab dem fünften eine
Sekunde Wartezeit, je weiterem doppelt so lang, höchstens eine Minute), es sperrt aber nie aus.

### Passwort beim ersten Start vorgeben (`NKA_PASSWORD_FILE`)

Willst du das Passwort nicht im Browser festlegen, etwa bei einer Einrichtung über Portainer, Unraid
oder ein Skript, gib es beim Start vor. Am besten als Datei, zum Beispiel als
[Docker Secret](https://docs.docker.com/compose/how-tos/use-secrets/):

```yaml
services:
  mietfuchs:
    environment:
      NKA_PASSWORD_FILE: /run/secrets/mietfuchs_passwort
    secrets:
      - mietfuchs_passwort
secrets:
  mietfuchs_passwort:
    file: ./mietfuchs_passwort.txt
```

`NKA_PASSWORD` nimmt das Passwort auch direkt, steht dann aber im Klartext in der `compose.yml` und
in `docker inspect`; sind beide gesetzt, gilt die Datei. Es gelten dieselben Regeln wie im Browser
(15 bis 128 Zeichen); ein Zeilenumbruch am Ende der Datei zählt nicht. Mietfuchs übernimmt es **nur,
solange nichts entschieden ist**: beim ersten Start, bei bestehenden Daten ohne Passwort und nach dem
Zurücksetzen. Ein Passwort, das du später unter *Einstellungen → Anmeldung* änderst, und eine dort
ausgeschaltete Anmeldung bleiben; die Angabe kannst du danach entfernen. Mit `NKA_AUTH=off` wird es
nicht übernommen. Ist die Angabe unbrauchbar (Datei fehlt, Passwort zu kurz), startet Mietfuchs
geschützt in der Einrichtung mit Code, auch mit bestehenden Daten. Das Protokoll sagt bei jedem
Start, was mit der Angabe geschehen ist, nennt das Passwort aber nie.

### Passwort vergessen

Zurücksetzen kann nur, wer an den Datenordner kommt:

```bash
docker compose exec mietfuchs touch /app/server/data/passwort-zuruecksetzen
```

Dann die Seite im Browser neu laden (oder den Container neu starten). Mietfuchs löscht das
Passwort, meldet alle Geräte ab, entfernt die Datei und schreibt einen neuen Einrichtungscode ins
Protokoll: `docker compose logs mietfuchs`. Mit ihm legst du ein neues Passwort fest. Deine Daten
bleiben unberührt. Steht `NKA_PASSWORD_FILE` oder `NKA_PASSWORD` noch in der Einrichtung, gilt nach
dem Zurücksetzen wieder dieses Passwort.

### Anmeldung ein- und ausschalten (`NKA_AUTH`)

| Wert | Wirkung |
| --- | --- |
| ohne Angabe oder `auto` | Passwort, sobald Mietfuchs im Netz lauscht. Im Container also immer, auch mit `-p 127.0.0.1:3001:3001`, denn Mietfuchs sieht nur das Netz des Containers. |
| `off` | Keine Anmeldung. Nur, wenn außer diesem Gerät niemand an den Port kommt (`-p 127.0.0.1:3001:3001`) oder ein Proxy davor selbst nach einem Passwort fragt ([Ein Passwort davor](#ein-passwort-davor)). |
| `on` | Anmeldung auch dann, wenn Mietfuchs nur auf `127.0.0.1` lauscht, etwa hinter einem Proxy, der keine Proxy-Kopfzeilen setzt. |

In der Compose-Datei unter dem Dienst `mietfuchs`:

```yaml
    environment:
      NKA_AUTH: "off"
```

Ein anderer Wert verhindert den Start, damit ein Tippfehler die Anmeldung nicht still abschaltet.
Mit `NKA_AUTH=on` oder `off` zeigt die Karte in den Einstellungen nur noch an, was gilt.

### Container von vor Version 0.17

Ein Volume, das schon Daten hatte, bleibt nach dem Update **offen wie bisher**: Unten in der
Seitenleiste steht „Ohne Passwort im Netz“, und das Protokoll nennt einen Einrichtungscode. Mit
ihm legst du unter *Einstellungen → Anmeldung* ein Passwort fest, ab dann gilt es. **Ab Version
1.0 verlangt Mietfuchs hier ein Passwort.** Für die Daten selbst ist nichts zu tun.

## Welche Datei nehme ich?

| Datei | Wann nehme ich das? |
| --- | --- |
| [`deploy/compose.yml`](../deploy/compose.yml) | Mietfuchs auf einem NAS oder Heimserver, aufgerufen im Browser unter `http://<gerät>:3001`. Der einfachste Weg. |
| [`deploy/compose.caddy.yml`](../deploy/compose.caddy.yml) mit [`deploy/Caddyfile`](../deploy/Caddyfile) | Du willst HTTPS im Heimnetz, etwa um Mietfuchs auf einem Android-Handy als App zu installieren, oder die Anmeldung im Proxy statt in Mietfuchs. |
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

**Einrichten:** `compose.caddy.yml` und `Caddyfile` in denselben Ordner legen. Daneben legst du
eine Datei `.env` an und trägst dort ein, unter welchem Namen und welcher IP-Adresse du dein NAS
aufrufst, mit Komma getrennt:

```
MIETFUCHS_HOSTS=localhost, 192.168.178.23, nas.fritz.box
```

Caddy stellt für jede dieser Adressen ein Zertifikat aus, und Mietfuchs antwortet nur unter ihnen
(`NKA_ALLOWED_HOSTS` in compose.caddy.yml liest dieselbe Angabe). Ohne `.env` gilt nur `localhost`.
Trag nur Namen und IP-Adressen ein, ohne `https://` und ohne Port.

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
- **Windows:** `root.crt` doppelklicken → „Zertifikat installieren …“ → „Aktueller Benutzer“ →
  „Alle Zertifikate in folgendem Speicher speichern“ → „Durchsuchen …“ → „Vertrauenswürdige
  Stammzertifizierungsstellen“ → „Weiter“ → „Fertig stellen“, die Sicherheitswarnung mit „Ja“
  bestätigen. Dasselbe in einer Eingabeaufforderung im Ordner der Datei, ohne Adminrechte:

  ```bat
  certutil -user -addstore Root root.crt
  ```

  Nachsehen kannst du mit `certmgr.msc` unter *Vertrauenswürdige Stammzertifizierungsstellen →
  Zertifikate* („Caddy Local Authority“).
- **macOS:** `root.crt` doppelklicken, die Schlüsselbundverwaltung öffnet sich; als Schlüsselbund
  „System“ wählen. Dann das Zertifikat („Caddy Local Authority“) doppelklicken, „Vertrauen“
  aufklappen und bei „Bei Verwendung dieses Zertifikats“ „Immer vertrauen“ wählen, Fenster schließen
  und mit dem Passwort des Macs bestätigen. Dasselbe im Terminal im Ordner der Datei:

  ```bash
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain root.crt
  ```

- Firefox führt eine eigene Liste; dort unter *Einstellungen → Datenschutz & Sicherheit →
  Zertifikate anzeigen → Zertifizierungsstellen → Importieren*. Chrome, Edge, Safari und das
  Programmfenster von Mietfuchs nehmen die des Systems.

**Aktualisieren:**

```bash
docker compose -f compose.caddy.yml pull && docker compose -f compose.caddy.yml up -d
```

Lädst du `compose.caddy.yml` aus 0.17 neu herunter und hattest vorher Adressen von Hand im Caddyfile vor der Klammer, trag dieselben Adressen in `.env` als `MIETFUCHS_HOSTS` ein und nimm auch das neue Caddyfile (oder schreib dort `{$MIETFUCHS_HOSTS:localhost}` vor die Klammer). Sonst kennt Mietfuchs nur `localhost` und lehnt eine eigene Domain wie `mietfuchs.example.org` ab. Wer nur `pull` und `up -d` ausführt, behält seine Dateien und muss nichts tun.

### Ein Passwort davor

Mietfuchs fragt selbst nach einem Passwort (siehe [Zuerst: Sicherheit](#zuerst-sicherheit)), hinter
Caddy genauso wie ohne. Willst du die Anmeldung lieber im Proxy haben, etwa weil dort schon andere
Dienste mit demselben Passwort hängen, steht im Caddyfile auskommentiert ein `basic_auth`-Block. Den
Hash des Passworts erzeugt

```bash
docker compose -f compose.caddy.yml exec caddy caddy hash-password
```

Dann die Zeilen einkommentieren, Benutzernamen und Hash eintragen und Caddy neu starten:
`docker compose -f compose.caddy.yml restart caddy`. Der Browser fragt danach nach Name und
Passwort. Damit nicht beide fragen, schaltest du die Anmeldung von Mietfuchs ab: `NKA_AUTH: "off"`
unter `environment` des Dienstes `mietfuchs` in compose.caddy.yml (der Kommentar dort zeigt die
Stelle), dann `docker compose -f compose.caddy.yml up -d`. Das gilt nur, solange Mietfuchs keinen
eigenen Port veröffentlicht, sonst ginge es am Proxy vorbei. Auch so ist es kein Grund, Mietfuchs ins
Internet zu stellen.

Ein [Programmfenster](#programmfenster-koppeln) lässt sich so nicht koppeln: Es kann das Passwort
von Caddy nicht beantworten, und ohne Passwort in Mietfuchs gibt es keinen Code. Wer koppeln will,
lässt die Anmeldung bei Mietfuchs.

Schreibt ein anderer Proxy den Namen der Anfrage um und gibt den ursprünglichen nicht als
`X-Forwarded-Host` weiter, lehnt Mietfuchs Änderungen aus älteren Browsern ab („Änderungen nimmt Mietfuchs nur von seiner eigenen Seite
an.“). Dann den Namen in `NKA_ALLOWED_HOSTS` eintragen, siehe
[Installation](installation.md#linux-installationspaket-mit-startmenü-eintrag).

### Eigene Domain mit gültigem Zertifikat

Hast du eine eigene Domain, kann Caddy ein öffentlich gültiges Zertifikat über die DNS-Challenge
holen. Dann muss kein Gerät ein Stammzertifikat installieren, und Mietfuchs muss dafür nicht aus dem
Internet erreichbar sein. Das Caddyfile beschreibt diese Variante als Kommentar. Voraussetzungen: Der
Name zeigt im Heimnetz auf die Adresse des NAS, du hast einen API-Schlüssel deines DNS-Anbieters,
und Caddy hat das Modul für diesen Anbieter. Im Image `caddy:2` ist keines enthalten; du baust dir
ein eigenes Image mit dem Modul, wie es die Caddy-Dokumentation zur DNS-Challenge beschreibt.
Den Namen trägst du in `.env` als `MIETFUCHS_HOSTS` ein.

## Programmfenster koppeln

Am Windows-PC oder Mac kannst du statt im Browser im Programmfenster mit dem Mietfuchs im Container
arbeiten, verschlüsselt und ohne jedes Mal das Passwort einzutippen. Wie das geht, steht unter
[Programmfenster mit Mietfuchs im Heimnetz verbinden](installation.md#programmfenster-mit-mietfuchs-im-heimnetz-verbinden).
Gekoppelt wird entweder direkt mit dem Port von Mietfuchs oder über Caddy (oder einen anderen
Proxy). Als Adresse gibst du im Fenster ein, was im Browser in der Adresszeile steht.

### Direkt mit dem Port von Mietfuchs (`compose.yml`)

- **Port 3001 spricht HTTP und HTTPS.** Mietfuchs legt dafür beim ersten Start ein eigenes
  Zertifikat im Volume an (`/app/server/data/tls/`). An `compose.yml`, Ports und Firewall änderst du
  nichts; der Browser bleibt bei `http://<gerät>:3001`. Im Fenster ist die Adresse `nas:3001` oder
  `192.168.178.23:3001`.
- Das Fenster merkt sich beim Koppeln genau dieses Zertifikat und nimmt danach kein anderes an. Der
  Code selbst geht nie über die Leitung: Das Fenster beweist mit ihm, welches Zertifikat es gesehen
  hat, und Mietfuchs prüft das gegen sein eigenes. Umgekehrt bestätigt Mietfuchs mit dem Code, dass
  es ihn kennt; fehlt diese Bestätigung, koppelt das Fenster nicht. Ein Gerät dazwischen fällt so in
  beide Richtungen auf.
- **Das Zertifikat bleibt**, solange das Volume `mietfuchs-data` besteht, auch über Updates des
  Containers. Das Backup über die Oberfläche nimmt es nicht mit; nach dem Wiederherstellen in einem
  neuen Volume entsteht ein neues, und du koppelst die Fenster neu. Sicherst du das ganze Volume
  ([Daten sichern](#daten-sichern)), kommt es mit.
- Im Browser zeigt `https://<gerät>:3001` nur eine Warnung, weil kein Browser dieses Zertifikat
  kennt. Für HTTPS im Browser bleibt [Caddy](#mit-https-im-heimnetz-composecaddyyml) oder
  [ein VPN](#von-unterwegs-und-mit-https-über-ein-vpn).

### Über Caddy (`compose.caddy.yml`)

Im Fenster ist die Adresse dann `https://nas.fritz.box` (oder ein anderer Name aus
`MIETFUCHS_HOSTS`), mit `https://` davor: Ohne Port heißt das 443 wie im Browser. Läuft Caddy auf
einem anderen Port, etwa `"8443:443"`, gibst du ihn mit an: `https://nas.fritz.box:8443`. An
Mietfuchs änderst du nichts, `compose.caddy.yml` setzt schon `NKA_TRUST_PROXY: caddy` (siehe
[unten](#der-proxy-muss-eingetragen-sein-nka_trust_proxy)). Das Fenster muss dem Zertifikat trauen,
das Caddy zeigt. Dafür gibt es drei Wege:

1. **Eigene Domain mit Let's Encrypt** ([Eigene Domain](#eigene-domain-mit-gültigem-zertifikat)):
   Das Zertifikat ist öffentlich gültig, auf dem PC ist nichts zu tun.
2. **`tls internal`** (die Voreinstellung im Caddyfile): Das Stammzertifikat `root.crt` von Caddy
   muss auf dem PC oder Mac installiert sein, genau wie für den Browser, siehe
   [Stammzertifikat holen](#mit-https-im-heimnetz-composecaddyyml) und die Schritte für Windows und
   macOS dort. Fehlt es, sagt das Fenster beim Koppeln, dass es das Zertifikat nicht kennt.
3. **Caddy liefert das Zertifikat von Mietfuchs aus**: Auf dem PC ist nichts zu installieren, das
   Fenster prüft wie beim direkten Port das eigene Zertifikat von Mietfuchs. Der Browser warnt dafür
   wie bei `https://<gerät>:3001`. In `compose.caddy.yml` beim Dienst `caddy` die Zeile
   `- mietfuchs-data:/mietfuchs:ro` einkommentieren (Caddy liest den Datenordner, nur lesend) und im
   Caddyfile statt `tls internal`:

   ```
   tls /mietfuchs/tls/mietfuchs.crt /mietfuchs/tls/mietfuchs.key
   ```

   Dann `docker compose -f compose.caddy.yml up -d`. Beim allerersten Start startet Caddy einmal neu,
   bis Mietfuchs das Zertifikat angelegt hat. Nimm diese Variante nur allein in einem Caddy, nicht
   neben anderen Blöcken.

In den Wegen 1 und 2 bindet das Fenster den Code an die Adresse, die es selbst geprüft hat, und
merkt sich kein bestimmtes Zertifikat; Caddy darf seine Zertifikate also wie gewohnt erneuern.
Danach prüft das Fenster bei jedem Start Kette und Namen. Ist das Stammzertifikat auf dem PC
später nicht mehr installiert, fragt das Fenster beim Start nach.

**Mit `basic_auth` in Caddy** geht es nicht, siehe [Ein Passwort davor](#ein-passwort-davor).

**Über ein VPN** (Tailscale, WireGuard der FRITZ!Box) koppelst du wie im Heimnetz: mit der Adresse,
unter der du Mietfuchs über das VPN im Browser öffnest, direkt mit dem Port oder über Caddy.

### Der Proxy muss eingetragen sein (`NKA_TRUST_PROXY`)

Caddy spricht mit Mietfuchs über HTTP und meldet in Kopfzeilen (`X-Forwarded-Proto`,
`X-Forwarded-Host`), dass die Verbindung zum Fenster verschlüsselt ist und unter welcher Adresse.
Diese Angaben glaubt Mietfuchs nur einem Proxy aus `NKA_TRUST_PROXY`; jedes andere Gerät im Heimnetz
könnte sie sonst fälschen. Fehlt der Eintrag, sagt das Fenster beim Koppeln, dass Mietfuchs die
Verbindung nicht als verschlüsselt ansieht.

- Mit Komma getrennt: IP-Adressen (`192.168.178.5`, `::1`), Netze (`10.0.0.0/24`) oder Namen
  (`caddy`). Einen Proxy auf demselben Rechner trägst du als `127.0.0.1,::1` ein.
- **Namen** löst Mietfuchs bei Bedarf über DNS auf, auch neu, wenn ein Container neu erstellt wurde.
  In Docker Compose ist der Dienstname (`caddy`) der sichere Weg: Docker kennt ihn genau, aus dem
  Heimnetz lässt er sich nicht fälschen. Außerhalb von Docker nimm IP-Adressen; ein Name hinge am
  DNS des Routers. Schreib den Namen ohne Punkt am Ende (`caddy`, nicht `caddy.`); einen solchen
  Eintrag nimmt Mietfuchs nicht an. Kennt dein Mietfuchs den Proxy nur über `extra_hosts` (ein selbst gebautes Image
  auf Alpine, musl), nimm ebenfalls seine IP-Adresse.
- **Nicht angenommen** werden, mit einer Zeile im Protokoll: `*`, `true`, Zahlen von Sprüngen, die
  Wörter `loopback`, `uniquelocal`, `linklocal` und `false`, und Netze, die fast jedem vertrauen
  (`0.0.0.0/0`, alles weiter als `/8` bei IPv4 und `/32` bei IPv6). Trag die Adresse oder den Namen
  des Proxys ein, kein ganzes Heimnetz.

**nginx oder ein anderer Proxy** muss beide Kopfzeilen setzen und darf die eines Clients nicht
durchreichen. In nginx schreibst du den Namen fest hinein, nicht `$host`: nginx macht den ersten
`server` auf einem Port zum Auffang für jeden Namen, `server_name` hin oder her, und `$host` wäre
dann jeder Name, den ein Client schickt. Etwa:

```nginx
server {
    listen 443 ssl;
    server_name mietfuchs.example.org;
    # ssl_certificate … wie gewohnt
    # Optional: andere Namen gar nicht erst weiterleiten
    if ($host != "mietfuchs.example.org") { return 421; }
    location / {
        proxy_pass http://192.168.178.23:3001;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host mietfuchs.example.org;
    }
}
```

Lauscht nginx nicht auf 443, gehört der Port dazu: `proxy_set_header X-Forwarded-Host
mietfuchs.example.org:8443;`.

Dazu bei Mietfuchs `NKA_TRUST_PROXY` mit der Adresse des Rechners mit nginx und
`NKA_ALLOWED_HOSTS=mietfuchs.example.org`. Mit `proxy_pass` wie oben schickt nginx als `Host` die
Adresse von Mietfuchs; den öffentlichen Namen erfährt Mietfuchs nur aus `X-Forwarded-Host`. Ist die
Prüfung des Namens an (immer in der Programmdatei, im Linux-Paket und im Programmfenster, in Docker
sobald `NKA_ALLOWED_HOSTS` gesetzt ist), muss der öffentliche Name deshalb in `NKA_ALLOWED_HOSTS`
stehen. Sonst sagt das Fenster beim Koppeln „Mietfuchs antwortet nicht unter dem Namen …“ und nennt
`NKA_ALLOWED_HOSTS`.

**Restrisiko:** Die Bindung an die Adresse ist nur so gut wie der Name, den der Proxy meldet. Ein
Proxy, der `X-Forwarded-Host` eines Clients durchreicht oder jede Adresse annimmt (in Caddy ein
Block nur für `:443`, in nginx jeder Server, der als einziger oder `default_server` auf dem Port für
jeden Namen einspringt), meldet auch einen fremden Namen. Wer dich auf eine eigene Adresse mit gültigem
Zertifikat lockt und den Code in die Hand bekommt, könnte dann ein Fenster koppeln. Caddy
überschreibt die Kopfzeile selbst, nginx mit dem fest eingetragenen Namen oben. Nenne die Adressen
deshalb ausdrücklich (`MIETFUCHS_HOSTS`, in nginx im `X-Forwarded-Host`) und setze
`NKA_ALLOWED_HOSTS`: Mietfuchs bindet einen Code dann nur an einen dort eingetragenen Namen, eine
private IP-Adresse oder einen Namen ohne Punkt, nicht von selbst an Namen wie `irgendwas.ts.net`. `compose.caddy.yml` macht beides schon.

**Proxy auf demselben Rechner:** Eine Anfrage mit einer dieser Kopfzeilen (`X-Forwarded-For`,
`X-Forwarded-Host`, `X-Forwarded-Proto`, `Forwarded`, `X-Real-IP`, `Via`) gilt nie als „von diesem Rechner“, auch wenn sie von 127.0.0.1
kommt. Über einen Proxy braucht deshalb jede Anfrage eine Anmeldung, und `/healthz` antwortet nur
knapp (`{ "app": "mietfuchs", "status": "ok" }`, ohne Datenordner und Datenbank). Eine Überwachung,
die mehr lesen will, fragt Mietfuchs direkt an seinem Port. Der `HEALTHCHECK` im Image tut das
schon.

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
  und das Passwort von Mietfuchs ist für das Heimnetz gedacht, nicht dafür.
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
docker logs mietfuchs    # Einrichtungscode für das Passwort beim ersten Start
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
