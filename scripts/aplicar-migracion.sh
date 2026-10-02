#!/usr/bin/env bash
# Aplica una o varias migraciones en producción vía la Management API de
# Supabase, cada una en su propia transacción (si falla, no deja nada a medias).
# Uso: bash scripts/aplicar-migracion.sh supabase/migrations/2026...sql [...]
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2- | tr -d '"\r')
REF=pkgvzwunazzkstlfubnq
for f in "$@"; do
  echo "== $f"
  python -c "import json,sys;print(json.dumps({'query':'begin;\n'+open(sys.argv[1],encoding='utf-8').read()+'\ncommit;'}))" "$f" > /tmp/migracion.json
  curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data-binary @/tmp/migracion.json
  echo
done
