# Mietfuchs mit Docker

Voraussetzung: [Docker](https://docs.docker.com/get-docker/) installiert (Docker Desktop unter
Windows/macOS, Docker Engine unter Linux). Ein einziges Image liefert App + API auf Port 3001;
die Daten (`mietfuchs.sqlite` + Belege) liegen im benannten Volume `mietfuchs-data` und überleben
Updates des Containers.

## Fertiges Image (ohne Clone)

Das Image liegt in der GitHub Container Registry für `linux/amd64` und `linux/arm64`
(Apple Silicon, Raspberry Pi):

```bash
docker run -d -p 3001:3001 -v mietfuchs-data:/app/server/data \
  --name mietfuchs ghcr.io/speedone/mietfuchs:latest
# App: http://localhost:3001
```

Als Compose-Datei; sie reicht allein, das Repo braucht man dafür nicht:

```yaml
services:
  mietfuchs:
    image: ghcr.io/speedone/mietfuchs:latest
    ports: ["3001:3001"]
    volumes: ["mietfuchs-data:/app/server/data"]
    restart: unless-stopped
    extra_hosts: ["host.docker.internal:host-gateway"]  # für Ollama auf dem Host
volumes:
  mietfuchs-data:
```

Aktualisieren: `docker compose pull && docker compose up -d`. Mit `docker run` gestartet:
`docker pull ghcr.io/speedone/mietfuchs:latest`, dann `docker rm -f mietfuchs` und den
`docker run`-Befehl von oben erneut ausführen. Die Daten im Volume bleiben dabei erhalten.
Statt `latest` lässt sich auch eine feste Version festhalten, z. B.
`ghcr.io/speedone/mietfuchs:0.3.0`.

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
