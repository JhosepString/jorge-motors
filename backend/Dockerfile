# syntax=docker/dockerfile:1
# Contexto: raíz jorge-motors, no la carpeta backend.
FROM node:24-bookworm-slim AS tooling
WORKDIR /app/backend
RUN npm install --global pnpm@11.25.0

FROM tooling AS build
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
# Sin scripts de terceros. Las dependencias opcionales de esbuild conservan el binario de plataforma.
# El driver Windows opcional no se compila ni se usa en esta imagen Linux.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN pnpm build

FROM tooling AS production-dependencies
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
RUN pnpm install --prod --no-optional --frozen-lockfile --ignore-scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app/backend
COPY --from=production-dependencies --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --chown=node:node backend/package.json ./package.json
COPY --chown=node:node database/azure-sql/migrations /app/database/azure-sql/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# No se aplican migraciones ni se ejecuta el worker automáticamente al arrancar.
CMD ["node", "dist/server.js"]
