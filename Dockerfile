FROM node:24-bookworm-slim AS build

ARG PNPM_VERSION=11.19.0

RUN npm install --global "pnpm@${PNPM_VERSION}"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runtime

ARG PNPM_VERSION=11.19.0

RUN npm install --global "pnpm@${PNPM_VERSION}"

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 13000

CMD ["pnpm", "start", "--", "--hostname", "0.0.0.0", "--port", "13000"]
