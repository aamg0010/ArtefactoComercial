#!/bin/bash
# Despliegue de try! Comercial en el servidor Plesk.
# Uso: bash desplegar.sh <paquete.tgz>   (el paquete lo genera deploy/plesk/empaquetar.sh)
# Estructura: ~/try-comercial/{releases/<fecha>, current -> releases/<fecha>, shared/.env, logs}
# Si la comprobación falla, vuelve a la versión anterior. Las migraciones de base son aditivas.
set -euo pipefail
PKG="$1"; HOME_APP="$HOME/try-comercial"; TS=$(date +%Y%m%d_%H%M%S); REL="$HOME_APP/releases/$TS"
mkdir -p "$HOME_APP/releases" "$HOME_APP/shared" "$HOME_APP/logs"
test -f "$HOME_APP/shared/.env" || { echo "Falta $HOME_APP/shared/.env"; exit 1; }
chmod 600 "$HOME_APP/shared/.env"
mkdir -p "$REL"; tar -xzf "$PKG" -C "$REL"
ln -sf "$HOME_APP/shared/.env" "$REL/.env"
cd "$REL"
echo "== Dependencias"; npm ci --no-audit --no-fund --loglevel=error
echo "== Prisma"; node node_modules/prisma/build/index.js generate >/dev/null
node node_modules/prisma/build/index.js migrate deploy
echo "== Compilación"; npm run -s build
PREV=$(readlink -f "$HOME_APP/current" 2>/dev/null || true)
ln -sfn "$REL" "$HOME_APP/current"
echo "== Arranque"
if pm2 describe try-comercial >/dev/null 2>&1; then pm2 reload try-comercial --update-env >/dev/null; else pm2 start "$REL/deploy/plesk/ecosystem.config.cjs" >/dev/null; fi
pm2 save >/dev/null
ok=0
for i in $(seq 1 30); do sleep 2; code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3041/login || true); [ "$code" = "200" ] && { ok=1; break; }; done
if [ "$ok" != "1" ]; then
  echo "FALLO: /login respondió $code. Volviendo a la versión anterior."
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then ln -sfn "$PREV" "$HOME_APP/current"; pm2 reload try-comercial --update-env >/dev/null; fi
  exit 1
fi
# Conservar las 3 últimas versiones.
ls -1dt "$HOME_APP"/releases/* | tail -n +4 | xargs -r rm -rf
echo "OK: try! Comercial $TS en marcha (anterior: ${PREV:-ninguna})."
