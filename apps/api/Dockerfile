# Hostable @lumin/api image.
# BUILD CONTEXT MUST BE THE REPOSITORY ROOT (workspace path deps resolve there):
#   docker build -f apps/api/Dockerfile -t lumin-api .
#
# Runs the PRODUCTION entrypoint (src/main.ts, real Supabase-JWT auth) via tsx.
# The local harness (src/local.ts) is never used here.
FROM node:20-slim AS base
WORKDIR /app

# Install the full workspace (path-linked @lumin/* deps) from the lockfile.
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY supabase ./supabase
RUN npm ci

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/apps/api
# Required secrets/config (DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
# OWNER_ORIGINS, CUSTOMER_ORIGINS) are injected at runtime; main.ts fails fast
# if any is missing. No secret values are baked into this image.
CMD ["npm", "run", "start"]
