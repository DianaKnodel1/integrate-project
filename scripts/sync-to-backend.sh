#!/bin/bash
# =============================================================================
#  SYNC-TO-BACKEND.SH — Abgleich von Server .124 zu Server .123
# =============================================================================
#  Dieses Skript wird auf dem PROJEKT-SERVER (.124) ausgeführt.
#  Es überträgt die Migrations-Dateien auf den Backend-Server (.123)
#  und führt sie dort im Datenbank-Container aus.
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
ssh "$BACKEND_USER@$BACKEND_IP" <<EOF
  set -euo pipefail
  cd $REMOTE_PATH
  
  # DB-Container finden
  CONTAINER=\$(docker ps --format "{{.Names}}" | grep -E "db|postgres" | head -n 1)
  
  if [ -z "\$CONTAINER" ]; then
    echo "Fehler: Kein Datenbank-Container auf .123 gefunden!"
    exit 1
  fi
  
  echo "Nutze Container: \$CONTAINER"
  
  for sql in \$(find supabase/manual-migrations -maxdepth 1 -type f -name '*.sql' | sort); do
    echo "Applying \$sql..."
    # Wir nutzen den superuser supabase_admin (Passwort wurde bereits gesetzt)
    docker exec -i -u postgres "\$CONTAINER" psql -d postgres -U supabase_admin \
      -v ON_ERROR_STOP=1 --single-transaction < "\$sql"
  done
EOF

ok "Backend (.123) erfolgreich aktualisiert! Alle Funktionen sind nun auf dem neuesten Stand. ✅"
