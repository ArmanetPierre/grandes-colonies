# Image de production de Grand Colonies.
#
# Un seul serveur, un seul port, une seule origine : il sert le client compilé
# sur `/`, l'écran de l'hôte sur `/hote`, l'API du maître de jeu sur `/api/*`
# et tient le WebSocket de la partie sur ce même port. C'est ce qui permet au
# client de déduire l'adresse du jeu de celle de la page — derrière un reverse
# proxy, aucun autre port n'est joignable.
#
# ⚠️ L'écran de l'hôte et `/api/*` n'ont aucune authentification : leur seule
#    protection était de vivre sur un port que les joueurs ne connaissaient
#    pas. Exposé publiquement, ce conteneur DOIT être servi derrière une règle
#    qui bloque `/hote` et `/api/*`.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json   packages/client/
COPY packages/engine/package.json   packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json   packages/server/
COPY packages/sim/package.json      packages/sim/
COPY apps/host/package.json         apps/host/
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Vite compile le client et recopie au passage les illustrations depuis
# assets/generated — voir le plugin dans packages/client/vite.config.ts.
RUN npm run build

# Les dépendances de production seules : ni vite, ni vitest, ni typescript.
# `tsx` reste : c'est lui qui exécute le serveur, écrit en TypeScript.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json   packages/client/
COPY packages/engine/package.json   packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json   packages/server/
COPY packages/sim/package.json      packages/sim/
COPY apps/host/package.json         apps/host/
RUN npm ci --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=2567
ENV CLIENT_DIST=/app/packages/client/dist

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages/engine   ./packages/engine
COPY packages/protocol ./packages/protocol
COPY packages/server   ./packages/server
COPY packages/sim      ./packages/sim
COPY apps/host         ./apps/host
# Les adversaires automatiques sont lancés dans leur propre processus.
COPY scripts ./scripts
# L'écran de l'hôte sert son illustration de fond depuis l'emplacement
# canonique, et non depuis le client compilé.
COPY assets/generated ./assets/generated
COPY --from=builder /app/packages/client/dist ./packages/client/dist

# Les journaux de partie s'écrivent ici. Sans volume, ils meurent avec le
# conteneur — c'est-à-dire à chaque déploiement.
RUN mkdir -p /app/parties && chown -R node:node /app/parties

USER node
EXPOSE 2567

# `node --import tsx` plutôt que `npx tsx` : un niveau de processus en moins,
# donc un SIGTERM qui arrive vraiment au serveur et une partie qui se ferme
# proprement au lieu d'être coupée.
CMD ["node", "--import", "tsx", "apps/host/src/main.ts"]
