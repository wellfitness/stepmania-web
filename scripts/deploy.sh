#!/bin/bash
# Deploy Sincro a Hostinger via FTP.
# Sube el shell estático (HTML + sw + manifest + iconos + stepmania-web/) a
# public_html del subdominio play.movimientofuncional.app.
#
# Diferencia con cadencia/deploy.sh: sincro es vanilla JS sin bundler — no
# existe dist/. Subimos desde la raíz con LISTA DE INCLUSIÓN EXPLÍCITA:
# así, un archivo nuevo en raíz (.env.local accidental, tests/, docs
# internos, README.md, package.json, etc.) NUNCA se filtra a producción
# si no está listado abajo.
#
# Patron base mantenido (mismo que cadencia y KinesisLab): bash + curl,
# cero deps, lee credenciales de .env.local (gitignored).

set -e

# Permite invocar el script desde cualquier directorio. cwd queda en la raíz.
cd "$(dirname "$0")/.."

# Cargar variables FTP
if [ ! -f ".env.local" ]; then
  echo "ERROR: No existe .env.local en la raíz del proyecto."
  echo "Debe contener: FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_DIR"
  exit 1
fi
source .env.local

if [ -z "$FTP_HOST" ] || [ -z "$FTP_USER" ] || [ -z "$FTP_PASS" ]; then
  echo "ERROR: Faltan credenciales FTP en .env.local"
  echo "Necesitas: FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_DIR"
  exit 1
fi

BASE_URL="ftp://${FTP_HOST}${FTP_REMOTE_DIR}"
CURL_AUTH="--user ${FTP_USER}:${FTP_PASS}"
# --ftp-create-dirs : crea carpetas remotas al subir el primer archivo
# --ssl-allow-beast : workaround para algunos servidores FTPS antiguos
# -k                : ignora errores de certificado (Hostinger usa cert válido pero
#                     SChannel en Windows hace OCSP-strict por defecto)
CURL_OPTS="--ftp-create-dirs --ssl-allow-beast -k"
COUNTER=0
ERRORS=0
FAILED_FILES=()

upload_file() {
  local local_path="$1"
  local remote_path="$2"

  if [ ! -f "$local_path" ]; then
    ERRORS=$((ERRORS + 1))
    FAILED_FILES+=("$remote_path (no existe en local)")
    echo "  SKIP: $remote_path (no existe en local)"
    return
  fi

  if curl -s -S -T "$local_path" $CURL_AUTH $CURL_OPTS "${BASE_URL}${remote_path}" 2>/dev/null; then
    COUNTER=$((COUNTER + 1))
    echo "  OK: $remote_path"
  else
    ERRORS=$((ERRORS + 1))
    FAILED_FILES+=("$remote_path")
    echo "  FAIL: $remote_path"
  fi
}

echo "=========================================="
echo "  Deploy Sincro a Hostinger"
echo "=========================================="
echo "Host: $FTP_HOST"
echo "Dir:  $FTP_REMOTE_DIR (relativo al public_html del subdominio)"
echo ""

# ──────────────────────────────────────────────
# 1) Archivos HTML + PWA shell de la raíz
# ──────────────────────────────────────────────
# Lista EXPLÍCITA. Si añades un .html nuevo (gh-create.html, etc.), añádelo aquí
# manualmente — esa fricción intencional evita filtrar archivos accidentales.
ROOT_FILES=(
  index.html
  app.html
  play.html
  gh-play.html
  autostepper.html
  gh-autostepper.html
  test-pad.html
  manifest.webmanifest
  sw.js
)

echo "Raíz (HTML + PWA shell)..."
for f in "${ROOT_FILES[@]}"; do
  upload_file "$f" "$f"
done

# ──────────────────────────────────────────────
# 2) Carpetas recursivas (iconos + módulos JS + CSS)
# ──────────────────────────────────────────────
# `find` aquí sí descubre archivos automáticamente porque dentro de estas
# carpetas todo es shareable (ningún .env, ningún test). Si en el futuro
# añades carpetas (p.ej. fonts/, audio/, fixtures/), agrégalas a DIRS.
DIRS=(
  icons
  stepmania-web
)

for dir in "${DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    echo ""
    echo "SKIP: $dir/ (no existe)"
    continue
  fi
  echo ""
  echo "${dir}/ (recursivo)..."
  while IFS= read -r f; do
    upload_file "$f" "$f"
  done < <(find "$dir" -type f | sort)
done

echo ""
echo "=========================================="
echo "  Deploy completado"
echo "=========================================="
echo "Subidos: $COUNTER archivos"
if [ $ERRORS -gt 0 ]; then
  echo "ERRORES: $ERRORS archivos"
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f"
  done
else
  echo "Errores: 0"
fi
echo ""
echo "URL: https://play.movimientofuncional.app"
echo ""
echo "Recordatorios:"
echo "  - Si tocaste archivos del precache, asegúrate de haber bumpeado"
echo "    CACHE_VERSION en sw.js (regla CLAUDE.md)."
echo "  - Usuarios con PWA instalada verán el cambio en la próxima carga"
echo "    cuando el SW nuevo se active (self.clients.claim() lo fuerza)."
