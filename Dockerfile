# --- Build-Stufe: Frontend bauen ---
FROM node:22-slim AS build
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
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Bewusst NKA_PORT statt PORT (siehe CLAUDE.md / server/src/index.js)
ENV NKA_PORT=3001

# Server inkl. node_modules und das gebaute Frontend übernehmen.
# Die Verzeichnisstruktur muss erhalten bleiben: server liefert ../../client/dist aus.
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3001
# Persistente Daten (db.json + uploads/) als Volume — beim Start anhängen:
#   docker run -p 3001:3001 -v mietfuchs-data:/app/server/data <image>
VOLUME ["/app/server/data"]

CMD ["node", "server/src/index.js"]
