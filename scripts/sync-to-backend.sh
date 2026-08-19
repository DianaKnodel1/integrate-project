#!/bin/bash
# =============================================================================
#  SYNC-TO-BACKEND.SH — Abgleich von Server .124 zu Server .123
# =============================================================================

set -euo pipefail

BACKEND_IP="190.97.167.123"
BACKEND_USER="root"
REMOTE_PATH="/opt/apps/portal"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
err() { printf "\033[1;31m  ✗ %s\033[0m\n" "$*"; exit 1; }

log "1/3  Projekt-Verzeichnis auf Backend (.123) sicherstellen"
ssh "$BACKEND_USER@$BACKEND_IP" "mkdir -p '$REMOTE_PATH/supabase/manual-migrations'"
ok "Verzeichnis auf .123 bereit"

log "2/3  Migrations-Dateien übertragen (.124 -> .123)"
scp supabase/manual-migrations/*.sql "$BACKEND_USER@$BACKEND_IP:$REMOTE_PATH/supabase/manual-migrations/"
ok "Dateien kopiert"

log "3/3  Migrationen auf Backend-Datenbank anwenden"
# Wir führen das Kommando direkt via SSH auf dem Backend aus
ssh "$BACKEND_USER@$BACKEND_IP" "bash -s" <<'EOF'
  set -euo pipefail
  cd /opt/apps/portal
  
  # DB-Container finden - Pfad-Check für Docker
  DOCKER_BIN=$(which docker || echo "/usr/bin/docker")
  CONTAINER=$($DOCKER_BIN ps --format "{{.Names}}" | grep -E "db|postgres" | head -n 1)
  
  if [ -z "$CONTAINER" ]; then
    echo "Fehler: Kein Datenbank-Container auf .123 gefunden!"
    exit 1
  fi
  
  echo "Nutze Container: $CONTAINER"
  
  # Status-Datei auf dem Backend-Server
  STATE_FILE="/opt/apps/portal/.backend-migrations-applied"
  touch "$STATE_FILE"

  for sql in $(find supabase/manual-migrations -maxdepth 1 -type f -name '*.sql' | sort); do
    name=$(basename "$sql")
    if ! grep -qxF "$name" "$STATE_FILE"; then
      echo "Applying $name..."
      if $DOCKER_BIN exec -i -u postgres "$CONTAINER" psql -d postgres -U supabase_admin \
        -v ON_ERROR_STOP=1 --single-transaction < "$sql"; then
        echo "$name" >> "$STATE_FILE"
      else
        echo "Fehler bei $name"
        exit 1
      fi
    else
      echo "Skipping $name (already applied)"
    fi
  done
EOF

ok "Backend (.123) erfolgreich aktualisiert! ✅"
