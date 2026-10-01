# --- Build-Stufe: Frontend bauen ---
FROM node:24-slim AS build
WORKDIR /app

# Erst nur die Manifeste kopieren, damit npm-Layer gecacht werden.
# postinstall (siehe package.json) installiert Server + Client mit.
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm install

# Quellcode kopieren und Frontend nach client/dist bauen
COPY . .
RUN npm run build

# --- Laufzeit-Stufe: schlankes Image, nur was der Server braucht ---
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Bewusst NKA_PORT statt PORT (siehe CLAUDE.md / server/src/index.ts)
ENV NKA_PORT=3001
# Betriebsart für den Update-Hinweis: Im Container wird per Image aktualisiert, nicht per Download
ENV NKA_RUNTIME=docker

# Server inkl. node_modules und das gebaute Frontend übernehmen.
# Die Verzeichnisstruktur muss erhalten bleiben: server liefert ../../client/dist aus.
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
# Das gemeinsame Datenmodell (#48). Seit #140 lädt der Server daraus auch Code zur Laufzeit
# (shared/heating.ts); ohne den Ordner startet das Image nicht. Die Prüfläufe aus dem Quellcode
# bemerken das nicht, weil der Ordner dort ohnehin da ist, nur die Prüfung des Images selbst.
COPY --from=build /app/shared ./shared
# Die Wurzel-package.json mit "type": "module": Sie gilt für shared/, das keine eigene hat. Ohne sie
# läse Node shared/*.ts über einen Notpfad mit der Warnung MODULE_TYPELESS_PACKAGE_JSON (siehe
# CLAUDE.md, Datenmodell).
COPY --from=build /app/package.json ./package.json

EXPOSE 3001
# Persistente Daten (mietfuchs.sqlite + uploads/) als Volume — beim Start anhängen:
#   docker run -p 3001:3001 -v mietfuchs-data:/app/server/data <image>
VOLUME ["/app/server/data"]

# Zustand statt bloßer Prozess-Lebendigkeit: /healthz meldet 503, wenn die Datenbank den
# Bestand nicht trägt oder der Datenordner nicht beschreibbar ist (z. B. schreibgeschützt
# eingehängt). Hängt der
# Prozess, schlägt die Anfrage fehl. Im Image gibt es kein curl; Node bringt fetch selbst mit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NKA_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.ts"]
