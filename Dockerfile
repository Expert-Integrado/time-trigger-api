# ---- Stage 1: builder ----
FROM node:22-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy lockfile + manifests first — maximises layer cache hits
COPY package.json pnpm-lock.yaml ./

# Install ALL deps (including devDependencies) for TypeScript build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm run build

# ---- Stage 2: runner ----
FROM node:22-slim AS runner

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main.js"]
