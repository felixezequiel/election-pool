# Imagem do nginx que serve o site publicado no DEPLOY do Coolify.
#
# Por que uma imagem, e não bind mount como no docker-compose.yml local: o Coolify,
# num deploy de docker-compose, NÃO copia a árvore do repositório para o host de
# runtime — só o compose e as imagens buildadas. Bind mounts relativos a arquivos do
# repo (`./infra/nginx/...`) não resolvem lá e o container falha no init. Então a
# config e o fallback são ASSADOS na imagem. O `dist` publicado continua vindo por
# VOLUME nomeado (`publish_data`), montado em runtime — esse funciona.
#
# Contexto de build = raiz do repo (ver docker-compose.coolify.yml), por isso os
# caminhos do COPY começam em `infra/`.
FROM nginx:1.27-alpine

# tzdata + TZ: o `$time_local` do access_log (que o GoAccess parseia e exibe) sai
# em America/Sao_Paulo, não em UTC. Consistente com a regra de fuso do projeto
# (CLAUDE.md). A imagem alpine não traz tzdata por padrão.
RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo

# Config do site (docs/02 §2/§7): serve <PUBLISH_BASE_DIR>/dist, segue o symlink do
# swap atômico (T-13), fallback de marca, headers de cache/CORS do /data.json.
COPY infra/nginx/election-pool.conf /etc/nginx/conf.d/default.conf

# Página de fallback (offline.html) — fora de `dist`, existe mesmo antes da 1ª
# publicação. O .conf a serve via `error_page` a partir de /usr/share/nginx/fallback.
COPY infra/nginx/fallback/ /usr/share/nginx/fallback/
