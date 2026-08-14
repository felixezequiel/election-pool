# Imagem do serviço `api` (orquestrador + jobs + render). docs/02 §2 pina Node 22 LTS.
# O código roda direto em TypeScript via `tsx` (o repo não tem passo de build para a
# API; o `astro build` do site acontece em tempo de render, dentro do container).
FROM node:22-bookworm-slim

# pnpm na versão do repo (packageManager). corepack já vem no node:22.
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# 1. Manifests primeiro (camada de cache de dependências). Copiamos os package.json
#    de cada workspace + o lockfile, instalamos, e só então o código-fonte muda pouco.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/model/package.json packages/model/
COPY packages/adapters/package.json packages/adapters/

# Instala TODAS as deps do workspace (o render precisa do astro de apps/web, e o
# orquestrador roda TS via tsx — dev deps incluídas de propósito).
RUN pnpm install --frozen-lockfile

# 2. Código-fonte completo (as migrations em infra/ inclusive — o boot as roda).
COPY . .

# O orquestrador serve o /health interno nesta porta (não exposta ao público).
ENV HEALTH_PORT=8081
EXPOSE 8081

# docs/02 §7: migrations rodam no boot, ANTES dos jobs; falha de migration impede o
# boot. `main.ts` faz exatamente isso: migra e, só então, agenda. Rodamos direto com
# `tsx` (sem dotenv: as variáveis vêm do compose/ambiente, não de infra/.env).
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/main.ts"]
