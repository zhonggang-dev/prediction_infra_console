# 旧版控制台（13000）。构建上下文是本目录：docker build -f legacy-console/Dockerfile legacy-console
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
ARG RELEASE_MERGE_SHA
ARG BACKEND_BINARY_SHA256

LABEL org.opencontainers.image.source-branch="main" \
      org.opencontainers.image.revision="$RELEASE_MERGE_SHA" \
      com.unipai.release-profile="legacy" \
      com.unipai.backend-binary-sha256="$BACKEND_BINARY_SHA256"

RUN npm install --global "pnpm@${PNPM_VERSION}"

ENV NODE_ENV=production
# 依赖只在构建阶段按锁文件安装；运行时根目录只读，pnpm 的依赖检查只告警、不自动安装。
ENV pnpm_config_verify_deps_before_run=warn
WORKDIR /app

COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 13000

CMD ["pnpm", "start", "--", "--hostname", "0.0.0.0", "--port", "13000"]
