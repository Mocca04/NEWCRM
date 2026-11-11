# Imagen de la API. Se construye desde la raíz del repositorio:
#   docker build -f apps/api/Dockerfile -t newcrm-api .
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @newcrm/api...

COPY packages/database packages/database
COPY apps/api apps/api
RUN pnpm --filter @newcrm/database generate

ENV NODE_ENV=production
EXPOSE 3001
# El proveedor de alojamiento define PORT; la API lo respeta.
CMD ["pnpm", "--filter", "@newcrm/api", "start:prod"]
