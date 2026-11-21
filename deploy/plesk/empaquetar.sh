#!/bin/bash
# Genera el paquete a desplegar (código fuente; se instala y compila en el servidor). Sin .env ni datos.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:-try-comercial.tgz}
git -c core.autocrlf=false archive --format=tar HEAD | gzip > "$OUT"
echo "$OUT ($(du -h "$OUT" | cut -f1)) desde $(git rev-parse --short HEAD)"
