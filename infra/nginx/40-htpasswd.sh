#!/bin/sh
# Gera /etc/nginx/.htpasswd para o Basic Auth do dashboard (docs/02 §8) a partir de
# STATS_USER/STATS_PASS, injetadas pelo Coolify em runtime — nunca no repo nem na
# imagem. As credenciais viajam em TEXTO PURO (sem '$') de propósito: '$' em valor de
# env quebra na interpolação do docker compose (foi o que derrubava o basicauth do
# Traefik com 503). O hash (bcrypt) é gerado aqui no boot. Roda antes do nginx subir
# (a imagem oficial executa /docker-entrypoint.d/*.sh como root).
set -e
HTPASSWD=/etc/nginx/.htpasswd
if [ -n "$STATS_USER" ] && [ -n "$STATS_PASS" ]; then
  htpasswd -bBc "$HTPASSWD" "$STATS_USER" "$STATS_PASS" >/dev/null 2>&1
  echo "[40-htpasswd] .htpasswd gerado para usuario '$STATS_USER'"
else
  # Falha alta, não silenciosa (R4): sem credencial o dashboard nega tudo (403),
  # nunca abre sem proteção.
  : > "$HTPASSWD"
  echo "[40-htpasswd] AVISO: STATS_USER/STATS_PASS ausentes — dashboard vai negar (403)"
fi
